// Applicant account endpoints: meta, me, request-code, verify-code, recover,
// link, prefs and signout.

import { uid, safeEq } from '../env.js';
import { json } from '../http.js';
import { hashCode, sameOrigin, setSessionCookie, clearSessionCookie } from '../auth.js';
import { queueMail } from '../mail.js';
import {
  audit, cleanStr, normEmail, validAppId, typeById, siteUrl,
  mailConfigured, signInEmail, scheduleFlush, currentUser,
} from './misc.js';

function ensureAccount(db, email) {
  email = normEmail(email);
  let a = (db.accounts || []).find(x => x.email === email);
  if (!a) {
    a = {
      id: uid('acc_', 12),
      email, createdAt: new Date().toISOString(), emailUpdates: true,
    };
    db.accounts.push(a);
    if (db.accounts.length > 5000) db.accounts = db.accounts.slice(-5000);
  }
  for (const s of db.submissions) if (normEmail(s.email) === email) s.accountId = a.id;
  return a;
}

function appsForAccount(db, a) {
  return db.submissions
    .filter(s => s.accountId === a.id || normEmail(s.email) === a.email)
    .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')))
    .map(s => {
      const t = typeById(db, s.type);
      return {
        appId: s.appId, type: s.type, typeName: t ? t.name : s.type,
        date: s.date, status: s.status || 'pending', adminNote: s.adminNote || '',
        email: s.email || '', emailUpdates: s.emailUpdates !== false,
      };
    });
}

function accountPayload(db, a) {
  const tickets = (db.tickets || [])
    .filter(t => t.accountId === a.id || (t.email && normEmail(t.email) === a.email))
    .sort((x, y) => String(y.updatedAt || y.createdAt || '').localeCompare(String(x.updatedAt || x.createdAt || '')))
    .slice(0, 100)
    .map(t => ({ id: t.id, subject: t.subject, status: t.status || 'open', createdAt: t.createdAt, updatedAt: t.updatedAt }));
  return { email: a.email, createdAt: a.createdAt, emailUpdates: a.emailUpdates !== false, apps: appsForAccount(db, a), tickets };
}

function linkAppToAccount(db, a, appId) {
  const id = cleanStr(appId, 40).trim().toUpperCase();
  if (!validAppId(id)) return { error: 'Enter a valid Application ID (e.g. MOD-ABC123).' };
  const s = db.submissions.find(x => (x.appId || '').toUpperCase() === id);
  if (!s) return { error: 'No application found for that ID.' };
  const em = normEmail(s.email);
  if (em && em !== a.email) return { error: 'That application is linked to a different email.' };
  if (!em) { s.email = a.email; s.emailUpdates = s.emailUpdates !== false; }
  s.accountId = a.id;
  return { app: s };
}

function rand6() {
  const limit = 0x100000000 - (0x100000000 % 1000000);
  const a = new Uint8Array(4);
  let v;
  do {
    crypto.getRandomValues(a);
    v = (a[0] | (a[1] << 8) | (a[2] << 16) | (a[3] << 24)) >>> 0;
  } while (v >= limit);
  return String(v % 1000000).padStart(6, '0');
}

export function register(router) {
  router.get('/api/account/meta', c => json({
    mailConfigured: mailConfigured(c.env),
    publicUrl: siteUrl(c),
  }));

  router.get('/api/account/me', c => {
    const db = c.db;
    const a = currentUser(c);
    if (!a) {
      const res = json({ error: 'Not signed in' }, 401);
      return clearSessionCookie(res, 'account', c.req);
    }
    return json(accountPayload(db, a));
  });

  router.post('/api/account/request-code', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const email = normEmail(c.body && c.body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!mailConfigured(c.env)) {
      return json({
        error: 'Email sign-in is not switched on yet. Use your Application ID below.',
        mailConfigured: false,
      }, 503);
    }
    const now = Date.now();
    db.loginCodes = (db.loginCodes || []).filter(x => x.exp > now);
    const last = db.loginCodes.filter(x => x.email === email).sort((a, b) => b.created - a.created)[0];
    if (last && now - last.created < 45000) return json({ ok: true, cooldown: true });
    db.loginCodes = db.loginCodes.filter(x => x.email !== email);
    const code = rand6();
    db.loginCodes.push({ email, hash: await hashCode(c.env, email, code), exp: now + 10 * 60 * 1000, tries: 0, created: now });
    if (db.loginCodes.length > 500) db.loginCodes = db.loginCodes.slice(-500);
    const mail = signInEmail(code, siteUrl(c));
    queueMail(c.store, { ...mail, to: email, kind: 'signin', key: 'signin:' + email + ':' + now }, c.env, c.ctx);
    await c.store.save();
    scheduleFlush(c);
    return json({ ok: true });
  });

  router.post('/api/account/verify-code', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const email = normEmail(b.email);
    const code = String(b.code || '').replace(/\D/g, '').slice(0, 8);
    if (!email || code.length !== 6) return json({ error: 'Enter the 6-digit code from your email.' }, 400);
    const now = Date.now();
    const rec = (db.loginCodes || [])
      .filter(x => x.email === email && x.exp > now)
      .sort((a, b) => b.created - a.created)[0];
    if (!rec) return json({ error: 'That code expired. Request a new one.' }, 400);
    if ((rec.tries || 0) >= 6) {
      db.loginCodes = db.loginCodes.filter(x => x !== rec);
      await c.store.save();
      return json({ error: 'Too many wrong attempts. Request a new code.' }, 429);
    }
    if (!safeEq(rec.hash, await hashCode(c.env, email, code))) {
      rec.tries = (rec.tries || 0) + 1;
      await c.store.save();
      return json({ error: 'That code is not right. Check the email again.' }, 400);
    }
    db.loginCodes = (db.loginCodes || []).filter(x => x.email !== email);
    const a = ensureAccount(db, email);
    audit(c, 'account_login', a.id);
    await c.store.save();
    const res = json({ ok: true, ...accountPayload(db, a) });
    return setSessionCookie(res, c.env, 'account', a.id, c.req);
  });

  router.post('/api/account/recover', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const email = normEmail(b.email);
    const appId = cleanStr(b.appId, 40).trim().toUpperCase();
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!validAppId(appId)) return json({ error: 'Enter a valid Application ID (e.g. MOD-ABC123).' }, 400);
    const s = db.submissions.find(x => (x.appId || '').toUpperCase() === appId);
    const mismatch = { error: 'Those details do not match an application.' };
    if (!s) return json(mismatch, 404);
    const existing = normEmail(s.email);
    if (existing && existing !== email) return json(mismatch, 404);
    if (!existing) { s.email = email; s.emailUpdates = s.emailUpdates !== false; }
    const a = ensureAccount(db, email);
    s.accountId = a.id;
    audit(c, 'account_recover', s.appId);
    await c.store.save();
    const res = json({ ok: true, ...accountPayload(db, a) });
    return setSessionCookie(res, c.env, 'account', a.id, c.req);
  });

  router.post('/api/account/link', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const a = currentUser(c);
    if (!a) return json({ error: 'Sign in first.' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const result = linkAppToAccount(db, a, b.appId);
    if (result.error) return json({ error: result.error }, 400);
    audit(c, 'account_link', result.app.appId);
    await c.store.save();
    return json({ ok: true, ...accountPayload(db, a) });
  });

  router.post('/api/account/prefs', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const a = currentUser(c);
    if (!a) return json({ error: 'Sign in first.' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    a.emailUpdates = !!b.emailUpdates;
    for (const s of db.submissions) {
      if (s.accountId === a.id || normEmail(s.email) === a.email) s.emailUpdates = a.emailUpdates;
    }
    await c.store.save();
    return json({ ok: true, ...accountPayload(db, a) });
  });

  router.post('/api/account/signout', c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const res = json({ ok: true });
    return clearSessionCookie(res, 'account', c.req);
  });
}
