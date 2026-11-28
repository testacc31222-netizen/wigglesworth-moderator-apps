// Port of the signed-cookie / staff-role logic in ../server.js.
// HMACs use node:crypto synchronously when available (nodejs_compat), with a
// byte-compatible JS fallback; therefore cookie helpers stay synchronous while
// the contract's signing/verifying exports are async.

import { cfg, safeEq } from './env.js';
import { HttpError } from './http.js';
import {
  sha256Bytes, hmacBytes, hmacHex, hmacBase64Url,
  envOf, hashStaffPassword, verifyStaffPassword,
  makeStaffAccount, setStaffPassword, publicStaffAccount,
  cleanStaffRole, STAFF_ROLES,
} from './db.js';

export {
  hashStaffPassword, verifyStaffPassword, makeStaffAccount,
  setStaffPassword, publicStaffAccount, cleanStaffRole, STAFF_ROLES,
};

const REQ_KEY = Symbol.for('worker.auth.request');

// rate-limits.js calls this once per request (before any route handler) so
// role helpers that only receive `db` can still honour the signed staff cookie
// and the legacy x-edit-code owner override. Non-enumerable: never in row JSON.
export function bindRequest(db, c) {
  if (!db || typeof db !== 'object' || !c) return;
  try {
    Object.defineProperty(db, REQ_KEY, { value: c, writable: true, configurable: true, enumerable: false });
  } catch { try { db[REQ_KEY] = c; } catch {} }
}

const SESSION_DAYS = 30;
const STAFF_SESSION_DAYS = 30;
const COOKIE_NAME = { account: 'ws_account', staff: 'ws_staff' };
const ID_RE = {
  account: /^acc_[a-f0-9]{20,40}$/,
  staff: /^stf_[a-f0-9]{16,32}$/,
};

function header(req, name) {
  if (!req) return '';
  const h = req.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(name) || '';
  return h[name] || h[name.toLowerCase()] || '';
}

function uppercaseFirst(s) { return String(s || '').toLowerCase(); }

export function parseCookies(req) {
  const out = {};
  const raw = header(req, 'cookie');
  for (const bit of String(raw || '').split(';')) {
    const i = bit.indexOf('=');
    if (i < 0) continue;
    const k = bit.slice(0, i).trim();
    if (!k) continue;
    const value = bit.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(value); } catch { out[k] = value; }
  }
  return out;
}

function secretParts(env) {
  return String(cfg(env, 'SESSION_SECRET', '')) + '|' +
    String(cfg(env, 'GITHUB_TOKEN', '')) + '|' +
    String(cfg(env, 'EDIT_CODE', ''));
}

function sessionKeySync(env, kind) {
  const prefix = kind === 'staff' ? 'ws-staff|' : 'ws-account|';
  return sha256Bytes(prefix + secretParts(env));
}

export async function sessionKey(env, kind) {
  return sessionKeySync(env, kind);
}

function signSessionSync(env, kind, id, exp) {
  const payload = String(id) + '.' + String(exp);
  return payload + '.' + hmacBase64Url(sessionKeySync(env, kind), payload);
}

export async function signSession(env, kind, id, exp) {
  return signSessionSync(env, kind, id, exp);
}

function readSessionSync(env, kind, req) {
  const raw = parseCookies(req)[COOKIE_NAME[kind] || COOKIE_NAME.account];
  if (!raw) return null;
  const bits = String(raw).split('.');
  if (bits.length !== 3) return null;
  const [id, exp, sig] = bits;
  if (!ID_RE[kind].test(id)) return null;
  if (!/^\d{10,16}$/.test(exp) || +exp < Date.now()) return null;
  const want = hmacBase64Url(sessionKeySync(env, kind), id + '.' + exp);
  return safeEq(sig, want) ? { id, exp: Number(exp) } : null;
}

export async function readSession(env, kind, req) {
  return readSessionSync(env, kind, req);
}

export async function hashCode(env, email, code) {
  return hmacHex(sessionKeySync(env, 'account'), String(email) + '|' + String(code));
}

export function hashCodeSync(env, email, code) {
  return hmacHex(sessionKeySync(env, 'account'), String(email) + '|' + String(code));
}

export function sameOrigin(req) {
  const origin = header(req, 'origin');
  if (!origin) return true;
  try {
    const u = new URL(origin);
    // Express always sets req.headers.host; Workers do too, but a locally
    // constructed Request may not — fall back to the URL host in that case.
    const host = header(req, 'host') || new URL(req.url).host;
    return u.host === host;
  } catch { return false; }
}

function requestIsSecure(req) {
  if (!req) return false;
  if (req.secure === true) return true;
  const proto = uppercaseFirst(header(req, 'x-forwarded-proto') || header(req, 'cf-visitor'));
  if (proto.includes('https')) return true;
  try { return new URL(req.url).protocol === 'https:'; } catch { return false; }
}

function appendCookie(res, line) {
  try {
    if (res && res.headers && typeof res.headers.append === 'function') {
      res.headers.append('Set-Cookie', line);
      return res;
    }
  } catch {}
  // Immutable headers (or a plain object): return a cloned Response.
  try {
    const headers = new Headers(res.headers || {});
    headers.append('Set-Cookie', line);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch { return res; }
}

export function setSessionCookie(res, env, kind, id, req) {
  const name = COOKIE_NAME[kind] || COOKIE_NAME.account;
  const days = kind === 'staff' ? STAFF_SESSION_DAYS : SESSION_DAYS;
  const exp = Date.now() + days * 86400000;
  const value = signSessionSync(env, kind, id, exp);
  const secure = requestIsSecure(req) ? '; Secure' : '';
  // Express maxAge is expressed in ms but serialized as seconds.
  const maxAgeSeconds = Math.floor(days * 86400000 / 1000);
  const line = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
  return appendCookie(res, line);
}

export function clearSessionCookie(res, kind, req) {
  const name = COOKIE_NAME[kind] || COOKIE_NAME.account;
  const line = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return appendCookie(res, line);
}

/* --------------------------- role helpers --------------------------------- */

function looksLikeDb(v) {
  return !!v && typeof v === 'object' && ('staffAccounts' in v || 'config' in v);
}
function looksLikeReq(v) {
  return !!v && typeof v === 'object' &&
    ((v.headers && typeof v.headers.get === 'function') || typeof v.url === 'string');
}
function looksLikeEnv(v) {
  return !!v && typeof v === 'object' && !looksLikeDb(v) && !looksLikeReq(v);
}

// Accepts both the contract signature (db, staffId, [req|env], [env]) and the
// original server.js signature (req, db). Passing the context object `c` as
// the second argument also works.
function unpack(a, b, c, d) {
  let db = null, staffId = null, req = null, env = null;
  if (looksLikeReq(a) && !looksLikeDb(a)) {
    req = a;
    db = looksLikeDb(b) ? b : null;
    env = looksLikeEnv(c) ? c : (looksLikeEnv(d) ? d : null);
  } else {
    db = looksLikeDb(a) ? a : null;
    if (typeof b === 'string' || b === null || b === undefined) {
      staffId = b;
    } else if (looksLikeReq(b)) {
      req = b;
    } else if (b && typeof b === 'object') {
      req = looksLikeReq(b.req) ? b.req : (looksLikeReq(b) ? b : null);
      env = b.env && looksLikeEnv(b.env) ? b.env : null;
      if (b.staff && typeof b.staff === 'object') staffId = b.staff.id || null;
    }
    if (looksLikeReq(c)) req = c;
    else if (looksLikeEnv(c)) env = c;
    if (looksLikeEnv(d)) env = d;
  }
  // A context bound by checkLimits() supplies the request when a route only
  // passes the db (the common contract signature).
  const bound = db && typeof db === 'object' ? db[REQ_KEY] : null;
  if (bound) {
    if (!req) req = looksLikeReq(bound.req) ? bound.req : (looksLikeReq(bound) ? bound : null);
    if (!env) env = looksLikeEnv(bound.env) ? bound.env : null;
    if (!staffId && bound.staff && bound.staff.id) staffId = bound.staff.id;
  }
  env = env || envOf(db) || {};
  return { db: db || {}, staffId, req, env };
}

export function effectiveCode(db, env) {
  const e = env || envOf(db) || {};
  return String(cfg(e, 'EDIT_CODE', '') || (db && db.config && db.config.editCode) || '');
}

export function staffFromReq(req, db, env) {
  const e = env || envOf(db) || {};
  const id = readSessionSync(e, 'staff', req);
  if (!id) return null;
  const acct = ((db && db.staffAccounts) || []).find(a => a.id === id.id && a.active !== false);
  return acct || null;
}

export function accountFromReq(req, db, env) {
  const e = env || envOf(db) || {};
  const id = readSessionSync(e, 'account', req);
  if (!id) return null;
  return ((db && db.accounts) || []).find(a => a.id === id.id) || null;
}

function resolveStaff(u) {
  if (!u.db) return null;
  let id = u.staffId;
  if (!id && u.req) id = staffFromReq(u.req, u.db, u.env)?.id || null;
  if (!id) return null;
  return ((u.db.staffAccounts) || []).find(a => a.id === id && a.active !== false) || null;
}

export function staffRole(db, staffId, req, env) {
  const u = unpack(db, staffId, req, env);
  const code = u.req ? header(u.req, 'x-edit-code') : '';
  if (code && safeEq(code, effectiveCode(u.db, u.env))) return 'owner';
  const acct = resolveStaff(u);
  return acct ? cleanStaffRole(acct.role) : '';
}

export function isAdmin(db, staffId, req, env) {
  const role = staffRole(db, staffId, req, env);
  return role === 'owner' || role === 'staff';
}

export function canViewApplications(db, staffId, req, env) {
  return !!staffRole(db, staffId, req, env);
}

export function staffOwner(db, staffId, req, env) {
  const u = unpack(db, staffId, req, env);
  const code = u.req ? header(u.req, 'x-edit-code') : '';
  if (code && safeEq(code, effectiveCode(u.db, u.env))) return true;
  const acct = resolveStaff(u);
  return !!(acct && acct.role === 'owner');
}

// Original server.js behaviour: 401 when not signed in, 403 when not owner.
// An optional third argument { targetId, newRole, remove } also enforces the
// "Keep at least one owner account." rule used by staff-management routes.
export function requireOwner(db, staffId, opts, env) {
  const extraReq = looksLikeReq(opts) ? opts : undefined;
  const extraEnv = looksLikeEnv(opts) ? opts : env;
  const u = unpack(db, staffId, extraReq, extraEnv);
  if (!isAdmin(u.db, u.staffId, u.req, u.env)) {
    throw new HttpError(401, 'Sign in first.');
  }
  if (!staffOwner(u.db, u.staffId, u.req, u.env)) {
    throw new HttpError(403, 'Only the owner can manage staff accounts.');
  }
  if (opts && typeof opts === 'object' && !looksLikeReq(opts) && !looksLikeEnv(opts)) {
    const { targetId, newRole, remove } = opts;
    if (targetId) {
      const target = (u.db.staffAccounts || []).find(a => a.id === targetId);
      const owners = (u.db.staffAccounts || []).filter(a => a.role === 'owner' && a.active !== false);
      if (target && target.role === 'owner' && owners.length <= 1 &&
          ((newRole && newRole !== 'owner') || remove)) {
        throw new HttpError(400, 'Keep at least one owner account.');
      }
    }
  }
  return true;
}
