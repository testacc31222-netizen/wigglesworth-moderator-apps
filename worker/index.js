// Cloudflare Worker entry point for the Wigglesworth applications site.
// Middleware order mirrors server.js exactly (see worker/CONTRACT.md).

import { Router, json, text, redirect, errorResponse, HttpError, readJson, readRaw } from './http.js';
import { cfg, boolCfg } from './env.js';
import { openStore } from './db.js';
import { readSession } from './auth.js';
import { checkLimits } from './rate-limits.js';
import { handleEvidenceGet, getMedia } from './uploads.js';
import { flushOutbox } from './mail.js';

import { register as registerConfig } from './routes/config.js';
import { register as registerApplications } from './routes/applications.js';
import { register as registerAccount } from './routes/account.js';
import { register as registerStaff } from './routes/staff.js';
import { register as registerTickets } from './routes/tickets.js';
import { register as registerAdmin } from './routes/admin.js';
import { register as registerReports } from './routes/reports.js';
import { register as registerMedia } from './routes/media.js';
import { register as registerMisc } from './routes/misc.js';
import { register as registerStaffProfiles } from './staff-profiles.js';
import { RateLimiter } from './durable/RateLimiter.js';
import { StoreLock } from './durable/StoreLock.js';

export { RateLimiter, StoreLock };

const router = new Router();
registerConfig(router);
registerApplications(router);
registerAccount(router);
registerStaff(router);
registerTickets(router);
registerAdmin(router);
registerReports(router);
registerMedia(router);
registerMisc(router);
registerStaffProfiles(router);

// Helmet's defaults (with crossOriginEmbedderPolicy disabled) reproduced
// manually because Workers have no helmet middleware.
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "frame-src https://www.youtube-nocookie.com",
    "media-src 'self' https:",
    'upgrade-insecure-requests',
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0',
};

const COUNTDOWN_ORIGIN = 'https://wigglesworth-countdown.onrender.com';

function withHeaders(res, extra) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function isRawContentType(ct) {
  return /^(image|video|audio)\//i.test(String(ct || ''));
}

async function accountFromRequest(req, env, db) {
  const s = await readSession(env, 'account', req).catch(() => null);
  if (!s) return null;
  return db.accounts?.find(a => a.id === s.id) || null;
}

async function staffFromRequest(req, env, db) {
  const s = await readSession(env, 'staff', req).catch(() => null);
  if (!s) return null;
  return db.staffAccounts?.find(a => a.id === s.id) || null;
}

async function handleRequest(req, env, ctx) {
  let url;
  try { url = new URL(req.url); } catch { return text('Bad request', 400); }
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. Evidence is registered before all middleware on Express (line 50).
  if (/^\/evidence\//.test(path)) {
    return handleEvidenceGet({ req, env, ctx, url, path, method, query: url.searchParams });
  }

  // Offloaded config/staff-profile images: R2 when available, otherwise the
  // GitHub repo (free, no payment method required).
  if (/^\/assets\//.test(path)) {
    const key = path.slice(1);
    try {
      const obj = await getMedia(env, key);
      if (!obj) return text('Not found', 404);
      return new Response(obj.body, {
        status: 200,
        headers: {
          'Content-Type': obj.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      return errorResponse(err);
    }
  }

  // 2. Security headers on every response.
  const addSecurity = (res) => withHeaders(res, SECURITY_HEADERS);

  if (method === 'OPTIONS' && req.headers.get('origin') === COUNTDOWN_ORIGIN) {
    return addSecurity(new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': COUNTDOWN_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-edit-code',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    }));
  }

  // 3/4. Root gate (GET/HEAD / or /index.html only) before static assets.
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '/index.html')) {
    if (url.searchParams.get('staff') !== '1') {
      let store = null;
      try {
        store = await openStore(env, ctx);
        const account = await accountFromRequest(req, env, store.db);
        const staff = account ? null : await staffFromRequest(req, env, store.db);
        if (!account && !staff) {
          const next = req.url.startsWith('/') ? req.url : (path === '/' ? '/' : '/index.html');
          return addSecurity(redirect('/signin?next=' + encodeURIComponent(next)));
        }
        env.__wsStore = store; // reuse in the route layer
      } catch (err) {
        return addSecurity(errorResponse(err));
      }
    }
  }

  // 5. Static assets (no-store for the dynamic documents/scripts).
  if (!path.startsWith('/api/') && path !== '/health' && path !== '/signin') {
    const assetReq = new Request(req.url, req);
    const res = await env.ASSETS.fetch(assetReq);
    if (res.status === 404 && !/\.[a-z0-9]+$/i.test(path)) {
      // Let the router decide for unknown non-asset paths.
    } else {
      const noStore = /(^|\/)(index|signin)\.html$|(^|\/)(app|signin)\.js$/i.test(path);
      return addSecurity(withHeaders(res, noStore
        ? { 'Cache-Control': 'no-store' }
        : { 'Cache-Control': res.headers.get('Cache-Control') || 'public, max-age=3600' }));
    }
  }
  if (path === '/signin') {
    // The asset binding maps the clean URL /signin to public/signin.html.
    // Requesting /signin.html explicitly returns a 307 back to /signin.
    const res = await env.ASSETS.fetch(req);
    return addSecurity(withHeaders(res, { 'Cache-Control': 'no-store' }));
  }

  // 6. Parse the body with the same effective 200 KB cap as Express.
  // Upload endpoints keep the request stream for R2 (never buffer 60 MB here).
  const isStreamedUpload = method === 'POST' &&
    (path === '/api/admin/upload-video' || path === '/api/report-evidence');
  let body = {};
  let raw;
  if (!['GET', 'HEAD'].includes(method) && !isStreamedUpload) {
    const ct = req.headers.get('content-type') || '';
    if (isRawContentType(ct)) {
      raw = await readRaw(req, 60 * 1024 * 1024);
    } else if (/application\/json/i.test(ct)) {
      body = await readJson(req, 200 * 1024);
    }
  }

  // 7. Store + context object.
  let store = env.__wsStore;
  delete env.__wsStore;
  if (!store) store = await openStore(env, ctx);

  const c = {
    req, env, ctx, url, method, path,
    query: url.searchParams,
    headers: req.headers,
    params: {},
    body,
    raw,
    store,
    db: store.db,
    origin: req.headers.get('origin') || '',
    user: null,
    staff: null,
  };

  // 8. All 14 rate limits in one Durable Object call.
  await checkLimits(c, env);

  // 9. Countdown-origin CORS on API responses.
  const cors = req.headers.get('origin') === COUNTDOWN_ORIGIN
    ? { 'Access-Control-Allow-Origin': COUNTDOWN_ORIGIN, Vary: 'Origin' }
    : {};

  // Express answers HEAD with the GET handler but no body.
  const match = router.match(method === 'HEAD' ? 'GET' : method, path);
  if (!match) return addSecurity(json({ error: 'Not found' }, 404, cors));
  c.params = match.params;
  try {
    let res = await match.handler(c);
    if (method === 'HEAD') res = new Response(null, { status: res.status, headers: res.headers });
    return addSecurity(res.headers.has('Access-Control-Allow-Origin') ? res : withHeaders(res, cors));
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) {
      return addSecurity(errorResponse(err));
    }
    return addSecurity(withHeaders(errorResponse(err), cors));
  }
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handleRequest(req, env, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  },

  // Replaces setInterval(flushOutbox, 5 * 60 * 1000) on Render.
  async scheduled(controller, env, ctx) {
    try {
      await flushOutbox(env, ctx, null);
    } catch (err) {
      console.error('scheduled outbox flush failed', err);
    }
  },

  // Queued mail/Discord retries that cannot sleep >30s inside a request.
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      try {
        const job = message.body || {};
        if (job.kind === 'outbox') await flushOutbox(env, ctx, null);
        if (job.kind === 'discord') {
          const { discordNotify } = await import('./discord.js');
          discordNotify(env, job.text, ctx);
        }
        message.ack();
      } catch (err) {
        console.error('queue job failed', err);
        message.retry();
      }
    }
  },
};
