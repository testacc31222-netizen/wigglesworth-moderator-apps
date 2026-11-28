// D1-backed port of the data layer in ../server.js.
//
// Everything here is JSON-in / JSON-out: one row per record, with the full
// record kept in the `json` column so dynamic fields survive a round trip.
// No filesystem or require() is used.

import { safeEq } from './env.js';

// nodejs_compat exposes node:crypto, but do not depend on it being complete:
// scryptSync (and even createHash) have a synchronous JS fallback below so old
// staff password hashes keep validating. Never reset a password.
const nodeCrypto = (() => {
  try {
    const p = globalThis.process;
    return (p && typeof p.getBuiltinModule === 'function'
      ? (p.getBuiltinModule('node:crypto') || p.getBuiltinModule('crypto'))
      : null) || null;
  } catch { return null; }
})();

const encoder = new TextEncoder();

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && v.buffer instanceof ArrayBuffer && typeof v.byteLength === 'number') {
    return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
  }
  return encoder.encode(String(v == null ? '' : v));
}

function concatBytes(...parts) {
  let n = 0;
  for (const p of parts) n += asBytes(p).length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { const b = asBytes(p); out.set(b, at); at += b.length; }
  return out;
}

function hexToBytes(hex) {
  const s = String(hex || '');
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) {
    const n = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function toHex(bytes) {
  let s = '';
  for (const b of asBytes(bytes)) s += b.toString(16).padStart(2, '0');
  return s;
}

function toBase64Url(bytes) {
  const b = asBytes(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(n >> 18) & 63];
    s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(n >> 12) & 63];
    if (i + 1 < b.length) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(n >> 6) & 63];
    if (i + 2 < b.length) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[n & 63];
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(n) {
  if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
    return Uint8Array.from(nodeCrypto.randomBytes(n));
  }
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export function randomInt(n) {
  if (nodeCrypto && typeof nodeCrypto.randomInt === 'function') return nodeCrypto.randomInt(n);
  const limit = 0x100000000 - (0x100000000 % n);
  const a = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(a); v = a[0]; } while (v >= limit);
  return v % n;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/* ---------------- synchronous SHA-256 / HMAC / PBKDF2 fallback ------------- */

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function jsSha256(input) {
  const data = asBytes(input);
  const buf = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  buf.set(data);
  buf[data.length] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = data.length * 8;
  dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(buf.length - 4, bits >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3];
    let e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + SHA_K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
  return out;
}

function jsHmac(keyInput, dataInput) {
  let key = asBytes(keyInput);
  if (key.length > 64) key = jsSha256(key);
  const k = new Uint8Array(64); k.set(key);
  const inner = new Uint8Array(64 + asBytes(dataInput).length);
  const outer = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(asBytes(dataInput), 64);
  const ih = jsSha256(inner);
  outer.set(ih, 64);
  return jsSha256(outer);
}

function jsPbkdf2(password, salt, iterations, dkLen) {
  const out = [];
  let block = 1;
  while (out.length < dkLen) {
    const counter = new Uint8Array([(block >>> 24) & 255, (block >>> 16) & 255, (block >>> 8) & 255, block & 255]);
    let u = jsHmac(password, concatBytes(salt, counter));
    const t = Uint8Array.from(u);
    for (let i = 1; i < iterations; i++) {
      u = jsHmac(password, u);
      for (let j = 0; j < t.length; j++) t[j] ^= u[j];
    }
    for (const b of t) out.push(b);
    block++;
  }
  return Uint8Array.from(out.slice(0, dkLen));
}

export function sha256Bytes(input) {
  if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
    try { return Uint8Array.from(nodeCrypto.createHash('sha256').update(asBytes(input)).digest()); } catch {}
  }
  return jsSha256(input);
}

export function hmacBytes(key, data) {
  if (nodeCrypto && typeof nodeCrypto.createHmac === 'function') {
    try { return Uint8Array.from(nodeCrypto.createHmac('sha256', asBytes(key)).update(asBytes(data)).digest()); } catch {}
  }
  return jsHmac(key, data);
}

export function hmacHex(key, data) { return toHex(hmacBytes(key, data)); }
export function hmacBase64Url(key, data) { return toBase64Url(hmacBytes(key, data)); }

/* ---------------- byte-compatible scrypt fallback (N=16384,r=8,p=1) -------- */

function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) | 0; }

function salsa208(X) {
  const x0 = X[0] | 0, x1 = X[1] | 0, x2 = X[2] | 0, x3 = X[3] | 0;
  const x4 = X[4] | 0, x5 = X[5] | 0, x6 = X[6] | 0, x7 = X[7] | 0;
  const x8 = X[8] | 0, x9 = X[9] | 0, x10 = X[10] | 0, x11 = X[11] | 0;
  const x12 = X[12] | 0, x13 = X[13] | 0, x14 = X[14] | 0, x15 = X[15] | 0;
  let a = x0, b = x1, c = x2, d = x3, e = x4, f = x5, g = x6, h = x7;
  let i = x8, j = x9, k = x10, l = x11, m = x12, n = x13, o = x14, q = x15;
  for (let round = 0; round < 8; round += 2) {
    e ^= rotl((a + m) | 0, 7); i ^= rotl((e + a) | 0, 9); m ^= rotl((i + e) | 0, 13); a ^= rotl((m + i) | 0, 18);
    j ^= rotl((f + b) | 0, 7); n ^= rotl((j + f) | 0, 9); b ^= rotl((n + j) | 0, 13); f ^= rotl((b + n) | 0, 18);
    o ^= rotl((k + g) | 0, 7); c ^= rotl((o + k) | 0, 9); g ^= rotl((c + o) | 0, 13); k ^= rotl((g + c) | 0, 18);
    d ^= rotl((q + l) | 0, 7); h ^= rotl((d + q) | 0, 9); l ^= rotl((h + d) | 0, 13); q ^= rotl((l + h) | 0, 18);
    b ^= rotl((a + d) | 0, 7); c ^= rotl((b + a) | 0, 9); d ^= rotl((c + b) | 0, 13); a ^= rotl((d + c) | 0, 18);
    g ^= rotl((f + e) | 0, 7); h ^= rotl((g + f) | 0, 9); e ^= rotl((h + g) | 0, 13); f ^= rotl((e + h) | 0, 18);
    l ^= rotl((k + j) | 0, 7); i ^= rotl((l + k) | 0, 9); j ^= rotl((i + l) | 0, 13); k ^= rotl((j + i) | 0, 18);
    m ^= rotl((q + o) | 0, 7); n ^= rotl((m + q) | 0, 9); o ^= rotl((n + m) | 0, 13); q ^= rotl((o + n) | 0, 18);
  }
  X[0] = (x0 + a) | 0; X[1] = (x1 + b) | 0; X[2] = (x2 + c) | 0; X[3] = (x3 + d) | 0;
  X[4] = (x4 + e) | 0; X[5] = (x5 + f) | 0; X[6] = (x6 + g) | 0; X[7] = (x7 + h) | 0;
  X[8] = (x8 + i) | 0; X[9] = (x9 + j) | 0; X[10] = (x10 + k) | 0; X[11] = (x11 + l) | 0;
  X[12] = (x12 + m) | 0; X[13] = (x13 + n) | 0; X[14] = (x14 + o) | 0; X[15] = (x15 + q) | 0;
}

function blockmix(X, r) {
  // X is one 128*r-byte block (32*r words). Y_i are the 2*r transformed
  // 64-byte chunks; the output is Y_even followed by Y_odd.
  const last = (2 * r - 1) * 16;
  const carry = new Uint32Array(16);
  for (let i = 0; i < 16; i++) carry[i] = X[last + i];
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) carry[j] ^= X[i * 16 + j];
    salsa208(carry);
    for (let j = 0; j < 16; j++) X[i * 16 + j] = carry[j];
  }
  const out = new Uint32Array(32 * r);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < 16; j++) {
      out[i * 16 + j] = X[(2 * i) * 16 + j];
      out[(i + r) * 16 + j] = X[(2 * i + 1) * 16 + j];
    }
  }
  X.set(out);
}

function jsScrypt(password, salt, dkLen = 64, N = 16384, r = 8, p = 1) {
  const B = jsPbkdf2(password, salt, 1, p * 128 * r);
  const words = new Uint32Array(B.buffer, B.byteOffset, B.byteLength / 4);
  const blockWords = 32 * r;
  const V = new Uint32Array(N * blockWords);
  for (let i = 0; i < p; i++) {
    const X = words.slice(i * blockWords, (i + 1) * blockWords);
    for (let k = 0; k < N; k++) { V.set(X, k * blockWords); blockmix(X, r); }
    for (let k = 0; k < N; k++) {
      const j = (X[(2 * r - 1) * 16] >>> 0) % N;
      const off = j * blockWords;
      for (let m = 0; m < blockWords; m++) X[m] ^= V[off + m];
      blockmix(X, r);
    }
    words.set(X, i * blockWords);
  }
  return jsPbkdf2(password, B, 1, dkLen);
}

export function hashStaffPassword(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const pw = String(password);
  if (nodeCrypto && typeof nodeCrypto.scryptSync === 'function') {
    try { return toHex(Uint8Array.from(nodeCrypto.scryptSync(pw, salt, 64))); } catch {}
  }
  return toHex(jsScrypt(asBytes(pw), salt, 64, 16384, 8, 1));
}

export function verifyStaffPassword(acct, password) {
  if (!acct || !acct.salt || !acct.hash) return false;
  let got;
  try { got = hashStaffPassword(password, acct.salt); } catch { return false; }
  return safeEq(got, acct.hash);
}

/* ---------------- defaults / staff account helpers (server.js verbatim) ---- */

const Q = (id, label, type, placeholder, required, options = '') =>
  ({ id, label, type, placeholder, required, options });

export const DEFAULT_TYPES = [
  {
    id: 'moderator', name: 'Moderator', prefix: 'MOD',
    blurb: 'Keep chat clean, enforce the rules, help players.',
    intro: 'Moderators keep the community safe and welcoming. Only apply here if that is the role you want.',
    successMessage: 'Thanks! Your moderator application was received. Save your Application ID and check your decision below.',
    showApproved: true,
    open: true,
    questions: [
      Q('username', 'In-game Username', 'text', 'Your username', true),
      Q('discord', 'Discord Username', 'text', 'Your exact Discord username, e.g. quantummzz', true),
      Q('age', 'Age', 'number', 'e.g. 16', true),
      Q('timezone', 'Timezone / Availability', 'text', 'e.g. EST, 3-5hrs daily', true),
      Q('experience', 'Past Moderation Experience?', 'textarea', 'List experience or write None', true),
      Q('why', 'Why do you want to be Moderator?', 'textarea', 'Give detail', true),
      Q('scenario', 'Someone is spamming in chat. What do you do?', 'textarea', 'Explain step-by-step', true),
      Q('rulebreak', 'Have you ever been banned? If so, why?', 'text', 'Be honest', true),
    ],
  },
  {
    id: 'creator', name: 'Content Creator', prefix: 'CC',
    blurb: 'Make videos and streams that grow the community.',
    intro: 'Creators represent Wigglesworth on their channels. Apply here with your best work.',
    successMessage: 'Thanks! Your creator application was received. Save your Application ID and check your decision below.',
    showApproved: true,
    open: true,
    questions: [
      Q('username', 'In-game Username', 'text', 'Your username', true),
      Q('discord', 'Discord Username', 'text', 'Your exact Discord username, e.g. quantummzz', true),
      Q('age', 'Age', 'number', 'e.g. 16', true),
      Q('platform', 'Main Platform', 'select', '', true, 'YouTube, Twitch, TikTok, Other'),
      Q('channel', 'Channel / Profile Link', 'text', 'Paste the link', true),
      Q('schedule', 'Upload / Stream Schedule', 'text', 'e.g. twice a week', true),
      Q('style', 'What kind of content do you make?', 'textarea', 'Describe it', true),
      Q('why', 'Why create for Wigglesworth?', 'textarea', 'Give detail', true),
      Q('strikes', 'Any strikes or bans on your channels? Be honest', 'text', 'Be honest', true),
    ],
  },
  {
    id: 'developer', name: 'Developer', prefix: 'DEV',
    blurb: 'Build the games, bots, and tools players use.',
    intro: 'Developers ship real things for players. Show us what you have built.',
    successMessage: 'Thanks! Your developer application was received. Save your Application ID and check your decision below.',
    showApproved: true,
    open: true,
    questions: [
      Q('username', 'In-game Username', 'text', 'Your username', true),
      Q('discord', 'Discord Username', 'text', 'Your exact Discord username, e.g. quantummzz', true),
      Q('age', 'Age', 'number', 'e.g. 16', true),
      Q('languages', 'Languages / Engines You Use', 'text', 'e.g. Luau, JS, Unity', true),
      Q('portfolio', 'Portfolio, GitHub, or Past Work Link', 'text', 'Paste the link', true),
      Q('experience', 'Development Experience', 'textarea', 'What have you built?', true),
      Q('why', 'Why build for Wigglesworth?', 'textarea', 'Give detail', true),
      Q('bugscenario', 'A game-breaking bug appears an hour before an event. What do you do?', 'textarea', 'Explain step-by-step', true),
      Q('teamwork', 'Do you prefer solo or team work?', 'text', 'Either is fine', false),
    ],
  },
];

export const DEFAULT_CONFIG = {
  title: 'WIGGLESWORTH',
  subtitle: 'Moderator applications are open. Tell us who you are and why you belong on the team — every application is read by a human.',
  announcement: 'Applications are OPEN',
  rules: '• Must be 13+\n• One role per application — pick the closest fit\n• Be honest — lying = instant deny\n• Spamming applications = blacklist',
  accent: '#A62C35', bg: '#080809',
  editCode: 'MOD123',
  showApproved: true, approvedTitle: 'New team members',
  showBanner: false,
  copy: {},
  about: {
    eyebrow: 'About', titleA: 'Steward the world', titleB: 'we build together.',
    lede: 'The best communities are made by people who show up with care, judgment, and imagination. Find the work that feels like yours.',
    featureTitle1: 'Make an impact', featureText1: 'Help create a safer and better community for everyone.',
    featureTitle2: 'Stand with a team', featureText2: 'Work alongside dedicated and passionate members.',
    featureTitle3: 'Grow your craft', featureText3: 'Build valuable skills in moderation and community management.',
  },
  bannerImage: '', logoImage: '', backgroundImage: '',
  topText: '',
  bottomText: 'Questions? Contact staff on Discord.',
  decor: [],
  countdown: { show: false, title: 'Update drops in', target: '', endVideo: '', ambience: '',
    daysLine: 'day {d} left.', finalLine: '{h}h {m}m {s}s left.', subLine: '{h}h {m}m {s}s to go',
    completedLine: 'completed.', endCardLine: 'that was it.', soonLine: 'soon.' },
  faq: [
    { q: 'Who can apply?', a: 'Anyone 13 or older. No experience needed for Moderator — attitude matters more.' },
    { q: 'How long until I hear back?', a: 'Usually within a week. Check your decision above with your Application ID.' },
    { q: 'Can I apply for two roles?', a: 'Yes — one application per role. Pick the closest fit first.' },
    { q: 'What gets denied instantly?', a: 'Lying, copied answers, blank fields, or applying twice to skip the queue.' },
  ],
  applicationTypes: clone(DEFAULT_TYPES),
};

export const STAFF_ROLES = ['owner', 'staff', 'viewer'];

export function cleanStaffRole(role) {
  return STAFF_ROLES.includes(role) ? role : 'staff';
}

export function makeStaffAccount(username, password, role = 'staff', createdBy = '') {
  const salt = toHex(randomBytes(16));
  return {
    id: 'stf_' + toHex(randomBytes(10)),
    username: String(username || '').trim().toLowerCase(),
    role: cleanStaffRole(role),
    salt,
    hash: hashStaffPassword(password, salt),
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || ''),
    lastLoginAt: '',
  };
}

export function setStaffPassword(acct, password) {
  acct.salt = toHex(randomBytes(16));
  acct.hash = hashStaffPassword(password, acct.salt);
}

export function publicStaffAccount(a) {
  return {
    id: a.id, username: a.username, role: a.role,
    active: a.active !== false, createdAt: a.createdAt || '',
    createdBy: a.createdBy || '', lastLoginAt: a.lastLoginAt || '',
  };
}

export function emptyDB() {
  return { config: clone(DEFAULT_CONFIG), submissions: [], tickets: [], reports: [],
    audit: [], accounts: [], loginCodes: [], outbox: [], staffAccounts: [] };
}

// Verbatim port of server.js normalizeDB(). env is accepted for API symmetry.
export function normalizeDB(db, env = {}) {
  if (!db || typeof db !== 'object') db = emptyDB();
  if (!db.config || typeof db.config !== 'object') db.config = clone(DEFAULT_CONFIG);
  if (!Array.isArray(db.submissions)) db.submissions = [];
  if (!Array.isArray(db.accounts)) db.accounts = [];
  if (!Array.isArray(db.loginCodes)) db.loginCodes = [];
  if (!Array.isArray(db.outbox)) db.outbox = [];
  // migrate v2 (single mod form) -> v3 (types)
  if (!Array.isArray(db.config.applicationTypes)) {
    const old = db.config;
    const mod = clone(DEFAULT_TYPES[0]);
    if (Array.isArray(old.questions) && old.questions.length) mod.questions = old.questions;
    if (typeof old.successMessage === 'string' && old.successMessage) mod.successMessage = old.successMessage;
    old.applicationTypes = [mod, clone(DEFAULT_TYPES[1]), clone(DEFAULT_TYPES[2])];
    delete old.questions; delete old.successMessage;
    if (!old.title || old.title === 'Moderator Application') {
      old.title = DEFAULT_CONFIG.title;
      old.subtitle = DEFAULT_CONFIG.subtitle;
    }
  }
  for (const s of db.submissions) if (!s.type) s.type = 'moderator';
  for (const s of db.submissions) {
    if (typeof s.email !== 'string') s.email = '';
    if (s.emailUpdates === undefined) s.emailUpdates = true;
    if (typeof s.notifiedStatus !== 'string') s.notifiedStatus = '';
  }
  if (!Array.isArray(db.tickets)) db.tickets = [];
  if (!Array.isArray(db.reports)) db.reports = [];
  // Seeded once with the site owner so the Staff tab always has a way in.
  if (!Array.isArray(db.staffAccounts) || !db.staffAccounts.length) {
    db.staffAccounts = [makeStaffAccount('khamari', 'wigglesworthrules', 'owner', 'system')];
  }
  for (const a of db.staffAccounts) {
    if (typeof a.username !== 'string') a.username = '';
    if (typeof a.role !== 'string' || !a.role) a.role = 'staff';
    if (!STAFF_ROLES.includes(a.role)) a.role = 'staff';
    if (a.active === undefined) a.active = true;
  }
  if (Array.isArray(db.config.applicationTypes)) {
    db.config.applicationTypes = db.config.applicationTypes.filter(t => t && t.id !== 'event');
  }
  for (const t of db.config.applicationTypes) if (t.open === undefined) t.open = true;
  for (const t of db.config.applicationTypes) {
    if (!t.successMessage) {
      const d = DEFAULT_TYPES.find(x => x.id === t.id);
      t.successMessage = d ? d.successMessage : 'Thanks! Your application was received.';
    }
    if (!db.config.discordIdRemoved) {
      if (!Array.isArray(t.questions)) t.questions = [];
      t.questions = t.questions.filter(q => q.id !== 'discordId');
      const discordQ = t.questions.find(q => q.id === 'discord');
      if (discordQ) {
        discordQ.label = discordQ.label || 'Discord Username';
        discordQ.required = true;
        if (!discordQ.placeholder || discordQ.placeholder === 'Your Discord name') {
          discordQ.placeholder = 'Your exact Discord username, e.g. quantummzz';
        }
      }
    }
  }
  if (!db.config.discordIdRemoved) db.config.discordIdRemoved = true;
  if (!Array.isArray(db.config.faq)) db.config.faq = clone(DEFAULT_CONFIG.faq);
  if (!db.config.copy || typeof db.config.copy !== 'object' || Array.isArray(db.config.copy)) db.config.copy = {};
  if (!db.config.about || typeof db.config.about !== 'object') db.config.about = clone(DEFAULT_CONFIG.about);
  if (typeof db.config.showBanner !== 'boolean') db.config.showBanner = false;
  if (!db.config.countdown || typeof db.config.countdown !== 'object') {
    db.config.countdown = { show: false, title: 'Update drops in', target: '', endVideo: '' };
  }
  if (typeof db.config.countdown.endVideo !== 'string') db.config.countdown.endVideo = '';
  if (typeof db.config.countdown.ambience !== 'string') db.config.countdown.ambience = '';
  for (const [k, dflt] of [['daysLine', 'day {d} left.'], ['finalLine', '{h}h {m}m {s}s left.'],
      ['subLine', '{h}h {m}m {s}s to go'], ['completedLine', 'completed.'],
      ['endCardLine', 'that was it.'], ['soonLine', 'soon.']]) {
    if (typeof db.config.countdown[k] !== 'string' || !db.config.countdown[k]) db.config.countdown[k] = dflt;
  }
  if (!db.config.layout || typeof db.config.layout !== 'object') db.config.layout = {};
  const _accent = String(db.config.accent || '').toLowerCase();
  if (['#6366f1', '#5865f2', '#6cb8f0', '#8fa8ff', '#00bdba', '#d96b24', '#ff701f'].includes(_accent)) db.config.accent = '#A62C35';
  const _bg = String(db.config.bg || '').toLowerCase();
  if (['#080a12', '#0e1218', '#0e1015', '#07070b', '#050609', '#0a0c12'].includes(_bg)) db.config.bg = '#080809';
  if (/official applications and support/i.test(String(db.config.title || '')) || db.config.title === 'Wigglesworth — Join the Team') {
    db.config.title = 'WIGGLESWORTH';
    if (db.config.layout) delete db.config.layout.appTitle;
  }
  if (/discord linking issue is known/i.test(String(db.config.announcement || ''))) db.config.announcement = 'Applications are OPEN — scroll down to apply.';
  if (db.config.layout && db.config.layout.heroEyebrow && db.config.layout.heroEyebrow.text === 'Tickets and Applications') {
    db.config.layout.heroEyebrow.text = 'STAFF APPLICATIONS';
    db.config.layout.heroEyebrow.dx = 0; db.config.layout.heroEyebrow.dy = 0;
  }
  return db;
}

/* ------------------------ database merge (verbatim + staff union) ---------- */

function mergeKey(item, field) {
  return String((item && item[field]) || '').trim().toUpperCase();
}
function recordVersion(item) {
  if (!item || typeof item !== 'object') return 0;
  for (const k of ['updatedAt', 'statusChangedAt', 'decidedAt', 'sentAt',
    'roleAssignedAt', 'acceptAnnouncedAt', 'aiSummaryAt']) {
    const t = Date.parse(item[k] || '');
    if (t) return t;
  }
  return Date.parse(item.date || '') || 0;
}
function decisionRank(status) {
  return status === 'approved' || status === 'denied' ? 2 : status === 'pending' ? 1 : 0;
}
function mergeRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = recordVersion(a) >= recordVersion(b) ? a : b;
  const older = newer === a ? b : a;
  const out = { ...older, ...newer };
  if (decisionRank(older.status) > decisionRank(out.status)) out.status = older.status;
  for (const k of ['adminNote', 'email', 'discordId', 'roleAssignedAt', 'acceptAnnouncedAt',
    'acceptAnnounceError', 'aiSummary', 'aiSummaryAt', 'notifiedStatus']) {
    if (!out[k] && older[k]) out[k] = older[k];
  }
  return out;
}
function mergeById(remote, local, field) {
  const map = new Map();
  const keyless = [];
  for (const item of [...(local || []), ...(remote || [])]) {
    if (!item || typeof item !== 'object') continue;
    const k = mergeKey(item, field);
    if (!k) { keyless.push(item); continue; }
    map.set(k, mergeRecord(map.get(k), item));
  }
  return [...keyless, ...map.values()];
}
function mergeOutbox(remote, local) {
  const out = mergeById(remote, local, 'id');
  for (const m of out) {
    const copies = [...(local || []), ...(remote || [])].filter(x => x && x.id === m.id);
    const sent = copies.find(x => x.status === 'sent');
    if (sent) { m.status = 'sent'; if (sent.sentAt) m.sentAt = sent.sentAt; }
  }
  return out;
}
function mergeConfig(remote, local) {
  const r = remote && typeof remote === 'object' ? remote : null;
  const l = local && typeof local === 'object' ? local : null;
  if (!r) return l || {};
  if (!l) return r;
  const rv = Date.parse(r.updatedAt || '') || 0;
  const lv = Date.parse(l.updatedAt || '') || 0;
  const out = lv > rv ? { ...r, ...l } : { ...l, ...r };
  if (!out.editCode) out.editCode = l.editCode || r.editCode;
  return out;
}
function sortSubmissions(list) {
  return list.slice()
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))
    .slice(-5000);
}

// Positional behaviour matches server.js mergeDatabases(remote, local).
// The only deliberate difference: staffAccounts are unioned by id instead of
// being overwritten by the second snapshot.
export function mergeDatabases(l, r) {
  const remote = l && typeof l === 'object' ? l : {};
  const local = r && typeof r === 'object' ? r : {};
  return {
    ...local,
    ...remote,
    config: mergeConfig(remote.config, local.config),
    submissions: sortSubmissions(mergeById(remote.submissions, local.submissions, 'appId')),
    accounts: mergeById(remote.accounts, local.accounts, 'id'),
    tickets: mergeById(remote.tickets, local.tickets, 'id'),
    reports: mergeById(remote.reports, local.reports, 'id'),
    outbox: mergeOutbox(remote.outbox, local.outbox),
    loginCodes: (local.loginCodes && local.loginCodes.length) ? local.loginCodes : (remote.loginCodes || []),
    audit: [...(local.audit || []), ...(remote.audit || [])].slice(0, 100),
    staffAccounts: mergeById(remote.staffAccounts, local.staffAccounts, 'id'),
  };
}

/* --------------------------------- D1 store -------------------------------- */

const ENV_KEY = Symbol.for('worker.db.env');
const CACHE_TTL_MS = 1000;

// key column for every collection table
const COLLECTIONS = {
  submissions: { key: 'appId' },
  tickets: { key: 'id' },
  reports: { key: 'id' },
  accounts: { key: 'id' },
  loginCodes: { key: 'email' },
  outbox: { key: 'id' },
  diag: { key: 'id' },
  staffAccounts: { key: 'id' },
};

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS submissions (appId TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS audit (n INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS loginCodes (email TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS diag (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS staffAccounts (id TEXT PRIMARY KEY, json TEXT NOT NULL)',
];

let schemaReady = false;
let cache = null;
let loadInflight = null;
let saveChain = Promise.resolve();
const memory = {
  config: null, submissions: [], tickets: [], reports: [], audit: [],
  accounts: [], loginCodes: [], outbox: [], diag: [], staffAccounts: [],
};

export function envOf(db) {
  return db && typeof db === 'object' ? db[ENV_KEY] : undefined;
}

function setEnv(db, env) {
  try {
    Object.defineProperty(db, ENV_KEY, { value: env, writable: true, configurable: true, enumerable: false });
  } catch {}
  return db;
}

async function ensureSchema(env) {
  if (schemaReady || !env || !env.DB) return;
  try { await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql))); } catch {}
  schemaReady = true;
}

function parseRows(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row.json !== 'string') continue;
    try { out.push(JSON.parse(row.json)); } catch {}
  }
  return out;
}

async function safeAll(env, sql) {
  try { return (await env.DB.prepare(sql).all()).results || []; } catch { return []; }
}

async function loadFromD1(env) {
  await ensureSchema(env);
  const db = emptyDB();
  if (!env || !env.DB) {
    if (memory.config) db.config = clone(memory.config);
    for (const name of Object.keys(COLLECTIONS)) {
      db[name] = clone(memory[name] || []);
    }
    db.audit = clone(memory.audit || []);
    return normalizeDB(setEnv(db, env), env);
  }
  const configRows = parseRows(await safeAll(env, 'SELECT id, json FROM config LIMIT 1'));
  if (configRows.length && configRows[0] && typeof configRows[0] === 'object') db.config = configRows[0];
  for (const name of Object.keys(COLLECTIONS)) {
    db[name] = parseRows(await safeAll(env, `SELECT json FROM ${name}`));
  }
  // audit: newest first (server.js unshift + cap 100)
  db.audit = parseRows(await safeAll(env, 'SELECT n, json FROM audit ORDER BY n DESC')).slice(0, 100);
  if (!Array.isArray(db.diag)) db.diag = [];
  return normalizeDB(setEnv(db, env), env);
}

function loadOnce(env) {
  if (!loadInflight) {
    loadInflight = loadFromD1(env).finally(() => { loadInflight = null; });
  }
  return loadInflight;
}

function collect(db, name) {
  const key = COLLECTIONS[name].key;
  const map = new Map();
  for (const item of Array.isArray(db[name]) ? db[name] : []) {
    if (!item || typeof item !== 'object') continue;
    const k = String(item[key] || '');
    if (k) map.set(k, item);
  }
  return map;
}

function computeDiff(before, after) {
  const diff = {};
  if (stableStringify(before.config) !== stableStringify(after.config)) {
    diff.config = { json: JSON.stringify(after.config || {}) };
  }
  for (const name of Object.keys(COLLECTIONS)) {
    const key = COLLECTIONS[name].key;
    const oldMap = collect(before, name);
    const newMap = collect(after, name);
    const upserts = [];
    const deletes = [];
    for (const [k, item] of newMap) {
      const old = oldMap.get(k);
      if (!old || stableStringify(old) !== stableStringify(item)) upserts.push(item);
    }
    for (const k of oldMap.keys()) if (!newMap.has(k)) deletes.push(k);
    if (upserts.length || deletes.length) diff[name] = { upserts, deletes };
  }
  const oldAudit = Array.isArray(before.audit) ? before.audit : [];
  const newAudit = (Array.isArray(after.audit) ? after.audit : []).slice(0, 100);
  if (stableStringify(oldAudit) !== stableStringify(newAudit)) diff.audit = { rows: newAudit };
  return diff;
}

// Merge the caller's changed records into freshly loaded D1 state so a
// concurrent approval in another isolate is never dropped.
function applyDiff(fresh, diff, callerDb) {
  const merged = clone(fresh);
  setEnv(merged, envOf(fresh));
  merged.config = diff.config ? JSON.parse(diff.config.json) : clone(fresh.config);
  for (const name of Object.keys(COLLECTIONS)) {
    const key = COLLECTIONS[name].key;
    const d = diff[name];
    if (!d) continue;
    const beforeMap = collect(fresh, name);
    const freshMap = new Map(beforeMap);
    for (const k of d.deletes) freshMap.delete(k);
    for (const item of d.upserts) freshMap.set(String(item[key] || ''), item);
    // Keep the caller's ordering for records it can see, then append records
    // that arrived from D1 after this store was loaded.
    const seen = new Set();
    const order = [];
    for (const item of Array.isArray(callerDb && callerDb[name]) ? callerDb[name] : []) {
      const k = String((item && item[key]) || '');
      if (k && !seen.has(k)) { seen.add(k); order.push(k); }
    }
    for (const k of beforeMap.keys()) {
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
    for (const k of freshMap.keys()) if (!seen.has(k)) { seen.add(k); order.push(k); }
    merged[name] = order.map(k => freshMap.get(k)).filter(Boolean);
  }
  merged.audit = diff.audit ? clone(diff.audit.rows).slice(0, 100) : clone(fresh.audit || []);
  if (!Array.isArray(merged.diag)) merged.diag = [];
  return merged;
}

function writeStatements(env, diff) {
  const stmts = [];
  if (diff.config) {
    stmts.push(env.DB.prepare('INSERT INTO config (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
      .bind('config', diff.config.json));
  }
  for (const name of Object.keys(COLLECTIONS)) {
    const d = diff[name];
    if (!d) continue;
    const key = COLLECTIONS[name].key;
    for (const k of d.deletes) stmts.push(env.DB.prepare(`DELETE FROM ${name} WHERE ${key} = ?`).bind(k));
    for (const item of d.upserts) {
      stmts.push(env.DB.prepare(`INSERT INTO ${name} (${key}, json) VALUES (?, ?) ON CONFLICT(${key}) DO UPDATE SET json = excluded.json`)
        .bind(String(item[key] || ''), JSON.stringify(item)));
    }
  }
  if (diff.audit) {
    stmts.push(env.DB.prepare('DELETE FROM audit'));
    // Insert oldest first so the highest n is the newest audit entry; reload
    // orders by n DESC to reproduce server.js' unshift/cap semantics.
    for (const row of [...diff.audit.rows].reverse()) {
      stmts.push(env.DB.prepare('INSERT INTO audit (json) VALUES (?)').bind(JSON.stringify(row)));
    }
  }
  return stmts;
}

function applyToMemory(diff) {
  if (diff.config) memory.config = JSON.parse(diff.config.json);
  for (const name of Object.keys(COLLECTIONS)) {
    const d = diff[name];
    if (!d) continue;
    const key = COLLECTIONS[name].key;
    const map = collect(memory, name);
    for (const k of d.deletes) map.delete(k);
    for (const item of d.upserts) map.set(String(item[key] || ''), item);
    memory[name] = [...map.values()];
  }
  if (diff.audit) memory.audit = clone(diff.audit.rows);
}

function replaceInPlace(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
  return setEnv(target, envOf(source));
}

function lockStub(env) {
  if (!env || !env.STORE_LOCK) return null;
  try {
    const id = env.STORE_LOCK.idFromName('global-store');
    return env.STORE_LOCK.get(id);
  } catch { return null; }
}

async function acquireLease(env) {
  const stub = lockStub(env);
  if (!stub) return { release: async () => {} };
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await stub.fetch('https://store-lock/acquire', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.token) {
        return {
          release: async () => {
            try {
              await stub.fetch('https://store-lock/release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: data.token }),
              });
            } catch {}
          },
        };
      }
    } catch {}
    // Short bounded backoff; never lose a write just because the lease is busy.
    await new Promise(resolve => setTimeout(resolve, Math.min(10 * (attempt + 1), 60)));
  }
  return { release: async () => {} };
}

export async function openStore(env, ctx) {
  let db;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) db = cache.db;
  else db = await loadOnce(env || {});
  cache = { db, at: Date.now() };
  setEnv(db, env);

  let snapshot = clone(db);

  async function reload() {
    const fresh = await loadFromD1(env || {});
    replaceInPlace(db, fresh);
    setEnv(db, env);
    snapshot = clone(db);
    cache = { db, at: Date.now() };
    return db;
  }

  function save() {
    const diff = computeDiff(snapshot, db);
    if (!Object.keys(diff).length) return Promise.resolve(db);
    const run = async () => {
      const lease = await acquireLease(env);
      try {
        // Re-read inside the lease, then replay only this caller's changes.
        const fresh = await loadFromD1(env || {});
        const merged = applyDiff(fresh, diff, db);
        if (env && env.DB) {
          const stmts = writeStatements(env, diff);
          if (stmts.length) await env.DB.batch(stmts);
        } else {
          applyToMemory(diff);
        }
        replaceInPlace(db, merged);
        setEnv(db, env);
        snapshot = clone(db);
        cache = { db, at: Date.now() };
        return db;
      } finally {
        await lease.release();
      }
    };
    const result = saveChain.then(run, run);
    saveChain = result.catch(() => {});
    return result;
  }

  function snapshotNow() { return clone(db); }

  return { db, save, reload, snapshot: snapshotNow };
}
