// One Durable Object call per request checks every rate-limit window.
// Windows and messages mirror the express-rate-limit declarations in server.js.

import { HttpError } from './http.js';
import { bindRequest } from './auth.js';

const DEFAULT_MESSAGE = 'Too many requests, please try again later.';

// Fixed windows (express-rate-limit semantics): a window starts on the first
// hit and ends windowMs later; it is not extended by subsequent hits.
export const LIMITS = {
  general:   { windowMs: 60_000,           max: 120, message: DEFAULT_MESSAGE },
  submit:    { windowMs: 10 * 60_000,      max: 10,  message: 'Too many applications, try again later.' },
  admin:     { windowMs: 10 * 60_000,      max: 60,  message: 'Too many attempts, slow down.' },
  status:    { windowMs: 60_000,           max: 30,  message: DEFAULT_MESSAGE },
  config:    { windowMs: 60_000,           max: 40,  message: DEFAULT_MESSAGE },
  account:   { windowMs: 15 * 60_000,      max: 20,  message: 'Too many sign-in emails. Wait a few minutes.' },
  verify:    { windowMs: 15 * 60_000,      max: 30,  message: 'Too many code attempts. Wait a few minutes.' },
  recover:   { windowMs: 15 * 60_000,      max: 12,  message: 'Too many attempts. Wait a few minutes.' },
  staffLogin:{ windowMs: 15 * 60_000,      max: 15,  message: 'Too many staff sign-in attempts. Wait a few minutes.' },
  ticket:    { windowMs: 10 * 60_000,      max: 8,   message: 'Too many tickets, try again later.' },
  ai:        { windowMs: 60 * 60_000,      max: 20,  message: 'AI limit reached, try later.' },
  upload:    { windowMs: 60 * 60_000,      max: 30,  message: 'Too many uploads, try later.' },
  evidence:  { windowMs: 60 * 60_000,      max: 10,  message: 'Too many uploads, try later.' },
  diag:      { windowMs: 60 * 60_000,      max: 10,  message: 'Slow down.' },
};

export const LIMIT_NAMES = Object.keys(LIMITS);

const AI_PATHS = [
  /^\/api\/admin\/applications\/[^/]+\/(?:decision|summarize)$/,
  /^\/api\/admin\/ai-check$/,
  /^\/api\/admin\/tickets\/[^/]+\/suggest$/,
];

// Which per-route limiters server.js stacks on top of `general`.
export function activeLimits(c) {
  const path = String(c?.path || (c?.req?.url ? new URL(c.req.url).pathname : ''));
  const method = String(c?.method || c?.req?.method || 'GET').toUpperCase();
  const active = [];
  if (path.startsWith('/api/')) active.push('general');

  if (method === 'GET' && path === '/api/config') active.push('config');
  if (method === 'POST' && path === '/api/applications') active.push('submit');
  if ((method === 'GET' && (
      /^\/api\/status\/[^/]+$/.test(path) || path === '/api/approved' ||
      path === '/api/account/meta' || path === '/api/account/me' ||
      /^\/api\/tickets\/[^/]+$/.test(path))) ||
      (method === 'POST' && path === '/api/account/prefs')) active.push('status');
  if (method === 'POST' && path === '/api/account/request-code') active.push('account');
  if (method === 'POST' && path === '/api/account/verify-code') active.push('verify');
  if (method === 'POST' && (path === '/api/account/recover' || path === '/api/account/link')) active.push('recover');
  if (method === 'POST' && path === '/api/staff/signin') active.push('staffLogin');
  if (method === 'POST' && (path === '/api/tickets' ||
      /^\/api\/tickets\/[^/]+\/reply$/.test(path) || path === '/api/reports')) active.push('ticket');
  if (method === 'POST' && AI_PATHS.some(re => re.test(path))) active.push('ai');
  if (path.startsWith('/api/admin/') && !AI_PATHS.some(re => re.test(path)) &&
      path !== '/api/admin/upload-video') active.push('admin');
  if (method === 'POST' && path === '/api/admin/upload-video') active.push('upload');
  if (method === 'POST' && path === '/api/report-evidence') active.push('evidence');
  if (method === 'POST' && path === '/api/clientlog') active.push('diag');
  return [...new Set(active)];
}

function clientIp(c) {
  const get = n => {
    const h = c?.headers;
    if (!h) return '';
    return typeof h.get === 'function' ? (h.get(n) || '') : (h[n] || h[n.toLowerCase()] || '');
  };
  return String(get('cf-connecting-ip') || get('x-forwarded-for').split(',')[0].trim() ||
    get('x-real-ip') || 'unknown').slice(0, 200);
}

function throwLimited(name, result) {
  const def = LIMITS[name] || {};
  const err = new HttpError(429, def.message || DEFAULT_MESSAGE);
  // Kept off `extra` so errorResponse() still emits exactly { error: ... }.
  err.limiter = name;
  err.textBody = def.message === DEFAULT_MESSAGE; // express-rate-limit sends text by default
  err.headers = {
    'RateLimit-Limit': String(result.limit ?? def.max),
    'RateLimit-Remaining': '0',
    'RateLimit-Reset': String(result.retryAfter ?? 1),
    'Retry-After': String(result.retryAfter ?? 1),
  };
  throw err;
}

// Isolate-local fallback for environments where the DO binding is absent.
const localWindows = new Map();
function localCheck(ip, active) {
  const now = Date.now();
  const results = {};
  for (const name of LIMIT_NAMES) {
    const def = LIMITS[name];
    const key = ip + '|' + name;
    let rec = localWindows.get(key);
    if (!active.includes(name)) {
      results[name] = rec ? {
        ok: true, limit: def.max, remaining: Math.max(0, def.max - rec.count),
        retryAfter: Math.max(0, Math.ceil((rec.reset - now) / 1000)), resetAt: rec.reset,
      } : { ok: true, limit: def.max, remaining: def.max, retryAfter: 0, resetAt: 0 };
      continue;
    }
    if (!rec || now >= rec.reset) rec = { count: 1, reset: now + def.windowMs };
    else rec.count += 1;
    localWindows.set(key, rec);
    const retryAfter = Math.max(1, Math.ceil((rec.reset - now) / 1000));
    results[name] = {
      ok: rec.count <= def.max,
      limit: def.max,
      remaining: Math.max(0, def.max - rec.count),
      retryAfter,
      resetAt: rec.reset,
    };
  }
  if (localWindows.size > 10000) {
    for (const [k, v] of localWindows) if (v.reset < now) localWindows.delete(k);
  }
  return results;
}

export async function checkLimits(c, env = {}) {
  const e = env && Object.keys(env).length ? env : (c?.env || {});
  bindRequest(c?.db || c?.store?.db, c);
  const ip = clientIp(c);
  const active = activeLimits(c);
  if (!active.length) return {};

  const ns = e.RATE_LIMITER;
  if (!ns || typeof ns.idFromName !== 'function') return enforce(active, localCheck(ip, active));

  const stub = ns.get(ns.idFromName(ip));
  const res = await stub.fetch('https://rate-limiter/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, names: LIMIT_NAMES, active, limits: LIMITS }),
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || !data || !data.results) return enforce(active, localCheck(ip, active));
  return enforce(active, data.results);
}

function enforce(active, results) {
  for (const name of active) {
    const r = results[name];
    if (r && !r.ok) throwLimited(name, r);
  }
  return results;
}
