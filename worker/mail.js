// Mail port of server.js (lines 80-125, 1305-1482, 2401-2419).
// Workers have no TCP, so nodemailer/SMTP is replaced by HTTP providers only:
// Apps Script (primary, free), Brevo and Resend. Queueing/dedupe/status rules
// are byte-for-byte compatible with the original outbox in data.live.json.

import { cfg, uid } from './env.js';
import { json } from './http.js';

const QUOTA_RE = /quota|too many (times|emails)|daily limit|limit exceeded/i;
const MAX_ATTEMPTS = 5;
const MAX_PER_FLUSH = 6;
const OUTBOX_CAP = 1000;

// Last seen bindings, so mailStats(db) still works when a route omits env.
let lastEnv = null;
function activeEnv(env) { return env || lastEnv || {}; }

// Keep these two helpers local so routes can reuse the exact server.js rules.
export function cleanStr(v, max = 2000) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

export function normEmail(v) {
  const s = cleanStr(v, 180).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : '';
}

function defaultFrom(env) {
  return (cfg(env, 'APPS_SCRIPT_URL') && cfg(env, 'APPS_SCRIPT_SECRET'))
    ? 'Wigglesworth Staff'
    : 'Wigglesworth Applications <onboarding@resend.dev>';
}

export function mailFrom(env) {
  return cfg(env, 'MAIL_FROM') || defaultFrom(env);
}

export function mailFromParts(env) {
  const from = mailFrom(env);
  const m = /^(.*?)\s*<([^>]+)>$/.exec(from);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || 'Wigglesworth', email: m[2].trim() };
  // Apps Script uses the Google account as the sender, so MAIL_FROM may be a name only.
  if (!from.includes('@')) return { name: from || 'Wigglesworth', email: '' };
  return { name: 'Wigglesworth', email: from };
}

function replyToEmail(env) {
  const reply = cfg(env, 'MAIL_REPLY_TO').trim();
  if (!reply) return '';
  return (/<([^>]+)>/.exec(reply) || [null, reply])[1];
}

export function mailProvider(env) {
  env = activeEnv(env);
  const want = String(cfg(env, 'MAIL_PROVIDER')).toLowerCase();
  const apps = !!(cfg(env, 'APPS_SCRIPT_URL').trim() && cfg(env, 'APPS_SCRIPT_SECRET').trim());
  const brevo = !!cfg(env, 'BREVO_API_KEY').trim();
  const resend = !!cfg(env, 'RESEND_API_KEY').trim();
  if (want === 'apps_script' && apps) return 'apps_script';
  // MAIL_PROVIDER=smtp cannot work in Workers (no TCP); fall through to HTTP.
  if (want === 'brevo' && brevo) return 'brevo';
  if (want === 'resend' && resend) return 'resend';
  if (apps) return 'apps_script';
  if (resend) return 'resend';
  if (brevo) return 'brevo';
  return '';
}

export function mailConfigured(env) { return !!mailProvider(activeEnv(env)); }

// Exact 503 body used by /api/account/request-code when delivery is off.
export function mailUnavailable() {
  return json({
    error: 'Email sign-in is not switched on yet. Use your Application ID below.',
    mailConfigured: false,
  }, 503);
}

export async function sendMail(env, msg) {
  if (env) lastEnv = env;
  const provider = mailProvider(env);
  if (!provider) return { ok: false, error: 'not_configured' };
  const m = msg || {};
  try {
    if (provider === 'apps_script') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const from = mailFromParts(env);
        const reply = replyToEmail(env);
        const r = await fetch(cfg(env, 'APPS_SCRIPT_URL').trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: cfg(env, 'APPS_SCRIPT_SECRET').trim(),
            to: m.to, subject: m.subject, text: m.text, html: m.html,
            fromName: from.name,
            ...(from.email ? { fromEmail: from.email } : {}),
            ...(reply ? { replyTo: reply } : {}),
          }),
          signal: ctrl.signal,
          redirect: 'follow',
        });
        const text = await r.text();
        let detail = text;
        try {
          const j = JSON.parse(text);
          if (j && j.ok === true) return { ok: true, provider };
          detail = (j && j.error) || text;
        } catch {}
        console.error('apps script mail failed', r.status, cleanStr(detail, 300));
        return { ok: false, error: (r.status + ' ' + cleanStr(detail, 200)).trim() };
      } finally { clearTimeout(timer); }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let url, headers, body;
    if (provider === 'brevo') {
      const from = mailFromParts(env);
      const reply = replyToEmail(env);
      url = 'https://api.brevo.com/v3/smtp/email';
      headers = {
        'api-key': cfg(env, 'BREVO_API_KEY').trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      body = {
        sender: from, to: [{ email: m.to }], subject: m.subject,
        htmlContent: m.html, textContent: m.text,
        ...(reply ? { replyTo: { email: reply } } : {}),
      };
    } else {
      url = 'https://api.resend.com/emails';
      headers = {
        Authorization: 'Bearer ' + cfg(env, 'RESEND_API_KEY').trim(),
        'Content-Type': 'application/json',
      };
      body = {
        from: mailFrom(env), to: [m.to], subject: m.subject,
        text: m.text, html: m.html,
        ...(cfg(env, 'MAIL_REPLY_TO') ? { reply_to: cfg(env, 'MAIL_REPLY_TO') } : {}),
      };
    }
    let r;
    try {
      r = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    let detail = '';
    try {
      const j = await r.json();
      detail = (j && (j.message || j.name || (j.error && (j.error.message || j.error)))) || '';
    } catch {}
    if (!r.ok) {
      console.error('mail send failed', provider, r.status, detail);
      return { ok: false, error: (r.status + ' ' + detail).trim() };
    }
    return { ok: true, provider };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'send error') };
  }
}

// QUEUES replace the old setInterval(flushOutbox, 5 * 60 * 1000).
function scheduleFlush(env, ctx, delaySeconds = 1) {
  try {
    const q = env && env.MAIL_JOBS;
    if (!q || typeof q.send !== 'function') return;
    const p = delaySeconds > 0
      ? q.send({ kind: 'outbox' }, { delaySeconds })
      : q.send({ kind: 'outbox' });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(Promise.resolve(p).catch(() => {}));
  } catch (e) {
    console.error('mail job schedule failed', e.message);
  }
}

export function queueMail(store, msg, env, ctx) {
  if (env) lastEnv = env;
  const db = store && store.db ? store.db : store;
  if (!db) return false;
  if (!Array.isArray(db.outbox)) db.outbox = [];
  const opts = msg || {};
  if (opts.key && db.outbox.some(m => m.key === opts.key && m.status !== 'failed')) return false;
  db.outbox.push({
    id: uid('mail_', 9), // mail_ + 18 hex chars, like crypto.randomBytes(9)
    key: cleanStr(opts.key || '', 120),
    to: normEmail(opts.to),
    subject: cleanStr(opts.subject, 160),
    text: String(opts.text || '').slice(0, 12000),
    html: String(opts.html || '').slice(0, 40000),
    kind: cleanStr(opts.kind || 'other', 30),
    appId: cleanStr(opts.appId || '', 40),
    decisionStatus: cleanStr(opts.decisionStatus || '', 16),
    status: 'queued', attempts: 0, error: '',
    createdAt: new Date().toISOString(), sentAt: '',
  });
  if (db.outbox.length > OUTBOX_CAP) db.outbox = db.outbox.slice(-OUTBOX_CAP);
  // The route saves the store itself (c.store.save()); just wake the outbox
  // worker. A 1s delay lets that save land before the queued flush reloads D1.
  if (mailConfigured(env)) scheduleFlush(env, ctx, 1);
  return true;
}

// STORE_LOCK single-flight: idFromName('mail-outbox') is deliberately different
// from the lock name used around store.save(), so a flush cannot deadlock it.
function lockStub(env, name) {
  const ns = env && env.STORE_LOCK;
  if (!ns) return null;
  try {
    const id = typeof ns.idFromName === 'function' ? ns.idFromName(name) : ns.newUniqueId();
    if (typeof ns.get === 'function') return ns.get(id);
    if (typeof ns.getStub === 'function') return ns.getStub(id);
  } catch {}
  return null;
}

async function acquireLock(env, name) {
  const stub = lockStub(env, name);
  if (!stub) return null; // no binding: in-isolate single-flight still applies
  try {
    const r = await stub.fetch('https://lock/acquire', { method: 'POST' });
    const j = await r.json().catch(() => null);
    return j && j.ok ? j.token : null;
  } catch { return null; }
}

async function releaseLock(env, name, token) {
  const stub = lockStub(env, name);
  if (!stub || !token) return;
  try {
    await stub.fetch('https://lock/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {}
}

let flushing = false;

export async function flushOutbox(env, ctx, store = null) {
  if (!mailConfigured(env) || flushing) return;
  flushing = true;
  let token = null;
  let ownedStore = false;
  try {
    token = await acquireLock(env, 'mail-outbox');
    if (token === null && lockStub(env, 'mail-outbox')) return; // another isolate owns it
    if (!store) {
      // Cron/Queue callers pass no store (see worker/index.js).
      const { openStore } = await import('./db.js');
      store = await openStore(env, ctx);
      ownedStore = true;
    }
    for (let i = 0; i < MAX_PER_FLUSH; i++) {
      await store.reload?.();
      const db = store.db;
      const m = (db && db.outbox || []).find(x => x.status === 'queued' && (x.attempts || 0) < MAX_ATTEMPTS);
      if (!m) break;
      const result = await sendMail(env, m);
      // Reload before writing so a concurrent request is not clobbered.
      await store.reload?.();
      const db2 = store.db;
      const m2 = (db2 && db2.outbox || []).find(x => x.id === m.id);
      if (!m2) continue;
      const quota = !result.ok && QUOTA_RE.test(result.error || '');
      if (!quota) m2.attempts = (m2.attempts || 0) + 1;
      if (result.ok) {
        m2.status = 'sent';
        m2.sentAt = new Date().toISOString();
        m2.error = '';
        // A decision is not notified until the provider confirms success.
        if (m2.kind === 'decision' && m2.appId && m2.decisionStatus) {
          const application = (db2.submissions || []).find(x => x.appId === m2.appId);
          if (application && application.status === m2.decisionStatus) {
            application.notifiedStatus = m2.decisionStatus;
            application.notifiedAt = m2.sentAt;
          }
        }
        console.log('mail delivered to provider', m2.kind, m2.id, result.provider);
      } else {
        m2.status = (!quota && m2.attempts >= MAX_ATTEMPTS) ? 'failed' : 'queued';
        m2.error = cleanStr(result.error, 200);
      }
      await store.save?.();
      if (!result.ok && result.error === 'not_configured') break;
      if (quota) {
        // Parked: attempts unchanged, retry on the next cron/queue tick.
        scheduleFlush(env, ctx, 3600);
        break;
      }
      if (!result.ok && (m2.attempts || 0) < MAX_ATTEMPTS) {
        scheduleFlush(env, ctx, Math.min(3600, 30 * Math.pow(2, Math.max(0, (m2.attempts || 1) - 1))));
      }
    }
    // If anything is still queued, keep the cron/queue chain alive.
    await store.reload?.();
    if ((store.db?.outbox || []).some(x => x.status === 'queued' && (x.attempts || 0) < MAX_ATTEMPTS)) {
      scheduleFlush(env, ctx, 60);
    }
  } catch (e) {
    console.error('outbox flush error', e.message);
  } finally {
    if (ownedStore) {
      try { await store?.reload?.(); } catch {}
    }
    await releaseLock(env, 'mail-outbox', token);
    flushing = false;
  }
}

export function mailStats(db, env) {
  const store = db && db.db && !Array.isArray(db.outbox) ? db : null;
  const d = store ? store.db : (db || {});
  // db.js attaches the bindings under a shared symbol; fall back to that
  // (and to the last env seen by sendMail/queueMail) when a route calls
  // mailStats(db) with one argument.
  const dbEnv = d && d[Symbol.for('worker.db.env')];
  const e = activeEnv(env || (store && store.env) || (store && store.db && store.db[Symbol.for('worker.db.env')]) || dbEnv);
  const out = Array.isArray(d.outbox) ? d.outbox : [];
  const count = st => out.filter(m => m.status === st).length;
  return {
    configured: mailConfigured(e), provider: mailProvider(e) || 'none', from: mailFrom(e),
    queued: count('queued'), sent: count('sent'), failed: count('failed'),
  };
}

// Test message markup copied from server.js line 2409 for identical output.
export function mailShell(inner, footer) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#080809">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080809">'
    + '<tr><td align="center" style="padding:0">'
    + '<div style="width:100%;max-width:560px;margin:0 auto;padding:34px 24px;background:#080809;color:#E6DED4;'
    + 'font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.65">'
    + '<div style="font-family:Georgia,serif;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#AAA5A0">Wigglesworth</div>'
    + '<div style="height:1px;background:#381217;margin:18px 0 26px"></div>'
    + inner
    + '<div style="height:1px;background:#381217;margin:28px 0 16px"></div>'
    + '<p style="margin:0;font-size:12px;color:#7d7873">' + (footer || 'You are receiving this because you applied to join the Wigglesworth staff team.') + '</p>'
    + '</div></td></tr></table></body></html>';
}

// Resolves to { ok, from?, error? }. routes/admin.js owns the HTTP status and
// adds the 'Send failed: ' prefix, matching server.js:2301-2302.
export async function sendTestMail(env, msg) {
  const m = msg || {};
  const to = normEmail(m.to);
  if (!to) return { ok: false, error: 'Enter a valid destination email.' };
  if (!mailConfigured(env)) return { ok: false, error: 'not_configured' };
  const html = m.html || mailShell('<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 16px;color:#F1ECE6">Email test</h1>'
    + '<p style="margin:0 0 12px">This is a test from the Wigglesworth applications site.</p>'
    + '<p style="margin:0;color:#AAA5A0;font-size:13px">If you can read this, decision emails will deliver the same way.</p>');
  const result = await sendMail(env, {
    to,
    subject: m.subject || 'Wigglesworth email test',
    text: m.text || 'This is a test from the Wigglesworth applications site. Decision emails will deliver the same way.',
    html,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, from: mailFrom(env) };
}
