// Local, read-only smoke test for the Worker port.
// Uses in-memory storage (no D1, no R2 writes, no live data, no deploy).
// Run: node scripts/smoke-worker.mjs

import assert from 'node:assert/strict';

const { default: worker } = await import('../worker/index.js');

const env = {
  EDIT_CODE: 'MOD123',
  SESSION_SECRET: 'local-smoke-secret',
  GITHUB_TOKEN: '',
  PUBLIC_URL: 'https://example.test',
  MAIL_PROVIDER: '',
  AI_API_KEY: '',
  DISCORD_WEBHOOK_URL: '',
  PREVIEW_MODE: '0',
  ASSETS: {
    async fetch(req) {
      return new Response('<!doctype html><title>' + new URL(req.url).pathname + '</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  },
  MEDIA: {
    async put() {},
    async get() { return null; },
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

async function call(path, init = {}) {
  const req = new Request('https://example.test' + path, init);
  const res = await worker.fetch(req, env, ctx);
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch {}
  return { res, body, json };
}

function ok(label, cond, detail = '') {
  assert.ok(cond, label + (detail ? ' — ' + detail : ''));
  console.log('PASS', label);
}

// /health
let r = await call('/health');
ok('/health responds 200', r.res.status === 200, `status=${r.res.status} body=${r.body.slice(0, 100)}`);

// public config
r = await call('/api/config');
ok('GET /api/config responds 200', r.res.status === 200);
ok('config has applicationTypes', Array.isArray(r.json?.applicationTypes), JSON.stringify(r.json).slice(0, 120));
ok('config hides editCode', r.json?.editCode === undefined);

// root gate
r = await call('/');
ok('root gate redirects anonymous visitor', r.res.status === 302 && r.res.headers.get('location')?.startsWith('/signin?next='));

r = await call('/?staff=1');
ok('?staff=1 bypasses root gate', r.res.status === 200 && r.body.includes('/index.html') === false || r.res.status === 200);

r = await call('/signin');
ok('/signin serves the sign-in document', r.res.status === 200 && r.body.includes('signin'));

// admin config save with the default edit code
r = await call('/api/admin/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-edit-code': 'MOD123' },
  body: JSON.stringify({ title: 'Smoke Test', applicationTypes: [{ id: 'moderator', name: 'Moderator' }] }),
});
ok('POST /api/admin/config accepts x-edit-code', r.res.status === 200, `status=${r.res.status} body=${r.body.slice(0, 160)}`);

r = await call('/api/config');
ok('saved config title is readable', r.json?.title === 'Smoke Test', JSON.stringify(r.json?.title));

// staff sign-in using the seeded owner from normalizeDB()
r = await call('/api/staff/signin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'khamari', password: 'wigglesworthrules' }),
});
ok('seeded owner staff sign-in works', r.res.status === 200 && /ws_staff=/.test(r.res.headers.get('set-cookie') || ''),
  `status=${r.res.status} body=${r.body.slice(0, 160)}`);

// mail disabled: sign-in codes must be queued, not sent, and report 503 like server.js
r = await call('/api/account/request-code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://example.test' },
  body: JSON.stringify({ email: 'smoke@example.test' }),
});
ok('request-code reports 503 when no mail provider is configured', r.res.status === 503,
  `status=${r.res.status} body=${r.body.slice(0, 160)}`);

// an application submission requires a signed-in applicant
r = await call('/api/applications', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://example.test' },
  body: JSON.stringify({ type: 'moderator', username: 'smoke', discord: 'smoke#0001', age: '20', email: 'smoke@example.test', why: 'testing' }),
});
ok('anonymous application is rejected', r.res.status === 401, `status=${r.res.status} body=${r.body.slice(0, 160)}`);

const { openStore } = await import('../worker/db.js');
const { signSession } = await import('../worker/auth.js');
const { randomBytes } = await import('node:crypto');
const store = await openStore(env, ctx);
const applicant = {
  id: 'acc_' + randomBytes(12).toString('hex'),
  email: 'smoke@example.test',
  createdAt: new Date().toISOString(),
  emailUpdates: true,
};
store.db.accounts.push(applicant);
await store.save();
// server.js stores exp in milliseconds, not seconds.
const session = await signSession(env, 'account', applicant.id, Date.now() + 30 * 86400000);

r = await call('/api/applications', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://example.test',
    Cookie: 'ws_account=' + session,
  },
  body: JSON.stringify({ type: 'moderator', username: 'smoke', discord: 'smoke#0001', age: '20', email: 'smoke@example.test', why: 'testing' }),
});
ok('POST /api/applications succeeds for a signed-in applicant',
  r.res.status === 200 && (r.json?.ok === true || !!r.json?.appId),
  `status=${r.res.status} body=${r.body.slice(0, 200)}`);

// backup shape
r = await call('/api/admin/backup', { headers: { 'x-edit-code': 'MOD123' } });
ok('backup exposes only the legacy key set', r.res.status === 200 &&
  ['version', 'exportedAt', 'config', 'submissions', 'tickets', 'reports', 'accounts']
    .every(k => k in (r.json || {})), `keys=${Object.keys(r.json || {}).join(',')}`);
ok('backup omits staffAccounts/outbox/audit', !('staffAccounts' in (r.json || {})) &&
  !('outbox' in (r.json || {})) && !('audit' in (r.json || {})));

// security headers
ok('CSP copied from server.js', (r.res.headers.get('content-security-policy') || '').includes('youtube-nocookie'));
ok('frame-ancestors none', (r.res.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));

console.log('\nAll smoke checks passed.');
