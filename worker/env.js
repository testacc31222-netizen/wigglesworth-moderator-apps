// Small environment/formatting helpers shared by the Worker modules.

export function cfg(env, key, def = '') {
  const v = env?.[key];
  return v === undefined || v === null || String(v) === '' ? def : String(v);
}

export function boolCfg(env, key, def = false) {
  const v = cfg(env, key, def ? 'true' : '');
  return String(v).toLowerCase() === 'true';
}

export function intCfg(env, key, def) {
  const n = Number.parseInt(cfg(env, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

export function publicUrl(env, req) {
  return (cfg(env, 'PUBLIC_URL') || new URL(req.url).origin).replace(/\/$/, '');
}

export function originOf(req) {
  try { return new URL(req.url).origin; } catch { return ''; }
}

export function nowMs() { return Date.now(); }

export function uid(prefix, bytes = 12) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Constant-time byte comparison, equivalent to crypto.timingSafeEqual.
export function safeEq(a, b) {
  const x = typeof a === 'string' ? new TextEncoder().encode(a) : a;
  const y = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function stripTrailingSlash(s) { return String(s || '').replace(/\/$/, ''); }

export function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

export function roleList(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;]+/)
    .map(v => v.replace(/\D/g, ''))
    .filter(v => v.length >= 17 && v.length <= 20))];
}
