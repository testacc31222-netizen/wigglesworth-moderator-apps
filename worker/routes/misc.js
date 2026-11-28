// Shared ported helpers plus the two leftover endpoints (/health, /api/clientlog).
// The helpers here are the verbatim server.js utilities used by every route file.

import { cfg, publicUrl } from '../env.js';
import { json } from '../http.js';
import {
  accountFromReq, staffFromReq, isAdmin, canViewApplications, staffOwner,
} from '../auth.js';
import { queueMail, flushOutbox } from '../mail.js';
import { discordNotify } from '../discord.js';

// index.js may hand handlers a context whose user/staff were not populated;
// resolve from the signed cookies as a fallback. Passing req/env to the role
// helpers is also what makes the legacy x-edit-code owner path work.
export function currentUser(c) { return c.user || accountFromReq(c.req, c.db, c.env); }
export function currentStaff(c) { return c.staff || staffFromReq(c.req, c.db, c.env); }
export function staffId(c) { const s = currentStaff(c); return s ? s.id : ''; }
export function isStaffAdmin(c) { return isAdmin(c.db, staffId(c), c.req, c.env); }
export function canStaffView(c) { return canViewApplications(c.db, staffId(c), c.req, c.env); }
export function isStaffOwner(c) { return staffOwner(c.db, staffId(c), c.req, c.env); }

const FAQ_STOP = new Set('a,an,the,and,or,but,if,then,so,for,to,of,in,on,at,by,do,does,did,is,are,was,were,be,been,am,i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,our,their,what,when,where,who,whom,which,how,why,can,could,should,would,will,just,very,here,there,this,that,these,those,any,all,anyone,anybody,please,thanks,thank,hi,hello,hey,get,got,have,has,had'.split(','));
const SLURS = [/\bnigg?[ae]rs?\b/i, /\bf+ag+g+o+t+s?\b/i, /\bkike?s?\b/i, /\bch[i1]nks?\b/i, /\bspi+c+s?\b/i, /\btrann(y|ies)\b/i];
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function cleanStr(v, max = 2000) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

export function cleanText(v, max = 2000) {
  return String(v ?? '').replace(/[^\S\n\t ]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

export function normEmail(v) {
  const s = cleanStr(v, 180).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : '';
}

export function validAppId(id) {
  return /^[A-Z0-9]{2,4}-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}

export function validTicketId(id) {
  return /^TKT-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}

export function validReportId(id) {
  return /^RPT-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}

export function validDiscordId(id) {
  return /^\d{17,20}$/.test(String(id || '').replace(/\D/g, ''));
}

export function hasSlur(s) { return SLURS.some(re => re.test(String(s || ''))); }

// crypto.randomInt() unbiased equivalent using WebCrypto.
function randInt(n) {
  const limit = 256 - (256 % n);
  const a = new Uint8Array(1);
  let v;
  do { crypto.getRandomValues(a); v = a[0]; } while (v >= limit);
  return v % n;
}

export function genId(prefix) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ID_ALPHABET[randInt(ID_ALPHABET.length)];
  return prefix + '-' + s;
}

export function displayName(s) {
  return cleanStr(s.discordName || s.discord || s.username || 'Applicant', 80);
}

export function faqMatch(text, faqs) {
  const words = s => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !FAQ_STOP.has(w));
  const tw = new Set(words(text));
  if (!tw.size) return null;
  let best = null;
  for (const f of faqs || []) {
    const qw = [...new Set(words(f.q))];
    if (!qw.length) continue;
    const hit = qw.filter(w => tw.has(w)).length;
    const score = hit / qw.length;
    if (hit >= 2 && score >= 0.4 && (!best || score > best.score)) best = { f, score };
  }
  return best;
}

export function typeById(db, id) {
  return (db.config.applicationTypes || []).find(t => t.id === id);
}

export function publicConfig(db) {
  const { editCode, ...rest } = db.config;
  rest.applicationTypes = (rest.applicationTypes || []).map(t => {
    const { successMessage, ...pub } = t;
    return pub;
  });
  return rest;
}

export function audit(c, act, id) {
  const db = c.db;
  if (!Array.isArray(db.audit)) db.audit = [];
  let by = '';
  try { by = cleanStr(c.req.headers.get('x-staff') || '', 40).replace(/[<>&"']/g, ''); } catch {}
  if (!by) { const s = currentStaff(c); if (s) by = s.username || ''; }
  db.audit.unshift({ t: new Date().toISOString(), act, id: cleanStr(id, 40), by });
  if (db.audit.length > 100) db.audit = db.audit.slice(0, 100);
}

export function siteUrl(c) { return publicUrl(c.env, c.req); }

// Workers have no TCP/SMTP: HTTP providers only (contract: apps_script primary).
export function mailConfigured(env) {
  return !!(cfg(env, 'APPS_SCRIPT_URL') && cfg(env, 'APPS_SCRIPT_SECRET'))
    || !!cfg(env, 'RESEND_API_KEY') || !!cfg(env, 'BREVO_API_KEY');
}

export function scheduleFlush(c) {
  try {
    const p = flushOutbox(c.env, c.ctx, c.store);
    if (p && typeof p.then === 'function') {
      const done = Promise.resolve(p).catch(() => {});
      if (c.ctx && typeof c.ctx.waitUntil === 'function') c.ctx.waitUntil(done);
    }
  } catch {}
}

export function notify(c, text) {
  try {
    const p = discordNotify(c.env, text, c.ctx);
    if (p && typeof p.then === 'function') {
      const done = Promise.resolve(p).catch(() => {});
      if (c.ctx && typeof c.ctx.waitUntil === 'function') c.ctx.waitUntil(done);
    }
  } catch {}
}

// ------------------------------- email bodies -------------------------------

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

export function testMailHtml() {
  return mailShell('<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 16px;color:#F1ECE6">Email test</h1>'
    + '<p style="margin:0 0 12px">This is a test from the Wigglesworth applications site.</p>'
    + '<p style="margin:0;color:#AAA5A0;font-size:13px">If you can read this, decision emails will deliver the same way.</p>');
}

export function decisionEmail(db, s, base) {
  const t = typeById(db, s.type);
  const role = t ? t.name : s.type;
  const accepted = s.status === 'approved';
  const word = accepted ? 'Accepted' : 'Not accepted';
  const name = displayName(s);
  const note = String(s.adminNote || '').trim();
  const subject = accepted
    ? 'You are in — Wigglesworth ' + role + ' application'
    : 'Update on your Wigglesworth ' + role + ' application';
  const text = [
    'Hi ' + name + ',', '',
    'Your ' + role + ' application (' + s.appId + ') has been reviewed.', '',
    'Result: ' + word,
    note ? 'Note from staff: ' + note : '',
    '', 'You can sign in any time to view your application:',
    base + '/signin', '',
    '— Wigglesworth Staff',
  ].filter(l => l !== null).join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Application update</h1>'
    + '<p style="margin:0 0 14px">Hi ' + escHtml(name) + ',</p>'
    + '<p style="margin:0 0 20px">Your <b>' + escHtml(role) + '</b> application (<b>' + escHtml(s.appId) + '</b>) has been reviewed.</p>'
    + '<div style="border:1px solid ' + (accepted ? '#A62C35' : '#2b2b31') + ';background:#111114;padding:18px 20px;margin:0 0 20px">'
    + '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:6px">Result</div>'
    + '<div style="font-family:Georgia,serif;font-size:22px;color:' + (accepted ? '#E6DED4' : '#AAA5A0') + '">' + word + '</div>'
    + (note ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #2b2b31"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:5px">Note from staff</div>' + escHtml(note).replace(/\n/g, '<br>') + '</div>' : '')
    + '</div>'
    + '<p style="margin:0 0 18px;color:#AAA5A0;font-size:13px">Save your Application ID: <b style="color:#E6DED4">' + escHtml(s.appId) + '</b></p>'
    + '<a href="' + escHtml(base + '/signin') + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">View my application</a>';
  return { subject, text, html: mailShell(inner) };
}

export function receiptEmail(db, s, base) {
  const t = typeById(db, s.type);
  const role = t ? t.name : s.type;
  const subject = 'We received your Wigglesworth ' + role + ' application';
  const text = [
    'Hi ' + displayName(s) + ',', '',
    'Your ' + role + ' application (' + s.appId + ') is in the queue.', '',
    'We will email you again as soon as there is a decision.',
    'You can sign in any time to check its status:',
    base + '/signin', '',
    '— Wigglesworth Staff',
  ].join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Application received</h1>'
    + '<p style="margin:0 0 14px">Hi ' + escHtml(displayName(s)) + ',</p>'
    + '<p style="margin:0 0 18px">Your <b>' + escHtml(role) + '</b> application is in the queue and will be read by a human.</p>'
    + '<div style="border:1px solid #2b2b31;background:#111114;padding:16px 20px;margin:0 0 20px">'
    + '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:6px">Application ID</div>'
    + '<div style="font-family:Georgia,serif;font-size:20px;color:#E6DED4">' + escHtml(s.appId) + '</div></div>'
    + '<p style="margin:0 0 18px;color:#AAA5A0;font-size:13px">We will email you again when there is a decision. Nothing else is needed from you right now.</p>'
    + '<a href="' + escHtml(base + '/signin') + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Sign in to track it</a>';
  return { subject, text, html: mailShell(inner) };
}

export function ticketReplyEmail(t, reply, base) {
  const link = base + '/signin?next=' + encodeURIComponent('/?ticket=' + t.id + '#contact');
  const subject = 'Re: ' + t.subject + ' [' + t.id + ']';
  const auto = reply.name === 'Staff (auto)';
  const intro = auto
    ? 'An automatic answer was added to your Wigglesworth ticket ' + t.id + ' — ' + t.subject + ':'
    : 'Staff replied to your Wigglesworth ticket ' + t.id + ' — ' + t.subject + ':';
  const text = [
    'Hi ' + t.name + ',', '',
    intro, '',
    reply.text, '',
    'Open the ticket (sign in with ' + t.email + '):',
    link, '',
    'Ticket ID: ' + t.id, '',
    '— Wigglesworth Staff',
  ].join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Ticket update</h1>'
    + '<p style="margin:0 0 14px">Hi ' + escHtml(t.name) + ',</p>'
    + '<p style="margin:0 0 18px">' + (auto ? 'An automatic answer was added to' : 'Staff replied to') + ' your ticket <b>' + escHtml(t.id) + '</b> — ' + escHtml(t.subject) + '.</p>'
    + '<div style="border:1px solid #A62C35;background:#111114;padding:18px 20px;margin:0 0 20px">'
    + '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:8px">' + (auto ? 'Automatic answer' : 'Staff reply') + '</div>'
    + '<div style="color:#E6DED4">' + escHtml(reply.text).replace(/\n/g, '<br>') + '</div>'
    + '</div>'
    + '<p style="margin:0 0 18px;color:#AAA5A0;font-size:13px">Sign in with <b style="color:#E6DED4">' + escHtml(t.email) + '</b> to open the thread. Ticket ID: <b style="color:#E6DED4">' + escHtml(t.id) + '</b></p>'
    + '<a href="' + escHtml(link) + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Open my ticket</a>';
  return {
    subject,
    text,
    html: mailShell(inner, 'You are receiving this because you opened a support ticket with Wigglesworth.'),
  };
}

export function ticketOpenedEmail(t, autoReply, base) {
  const link = base + '/signin?next=' + encodeURIComponent('/?ticket=' + t.id + '#contact');
  const subject = 'We received your Wigglesworth support ticket [' + t.id + ']';
  const text = [
    'Hi ' + t.name + ',', '',
    'Your support request has been received and a private ticket is open.',
    'Subject: ' + t.subject,
    'Ticket ID: ' + t.id, '',
    ...(autoReply ? ['An automatic answer:', '', autoReply.text, ''] : []),
    'Staff replies will be emailed to ' + t.email + '.',
    'Open your ticket: ' + link, '',
    '— Wigglesworth Staff',
  ].join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Ticket received</h1>'
    + '<p style="margin:0 0 14px">Hi ' + escHtml(t.name) + ',</p>'
    + '<p style="margin:0 0 18px">Your support request has been received and a private ticket is open.</p>'
    + '<div style="border:1px solid #2b2b31;background:#111114;padding:16px 20px;margin:0 0 20px">'
    + '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:6px">' + escHtml(t.id) + '</div>'
    + '<div style="font-family:Georgia,serif;font-size:20px;color:#E6DED4">' + escHtml(t.subject) + '</div></div>'
    + (autoReply ? '<div style="border:1px solid #A62C35;background:#111114;padding:18px 20px;margin:0 0 20px"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:8px">Automatic answer</div><div style="color:#E6DED4">' + escHtml(autoReply.text).replace(/\n/g, '<br>') + '</div></div>' : '')
    + '<p style="margin:0 0 18px;color:#AAA5A0;font-size:13px">Staff replies will be emailed to <b style="color:#E6DED4">' + escHtml(t.email) + '</b>.</p>'
    + '<a href="' + escHtml(link) + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Open my ticket</a>';
  return { subject, text, html: mailShell(inner, 'You are receiving this because you opened a support ticket with Wigglesworth.') };
}

export function signInEmail(code, base) {
  const subject = 'Your Wigglesworth sign-in code';
  const text = [
    'Your Wigglesworth sign-in code is ' + code + '.', '',
    'It expires in 10 minutes. If you did not request it, ignore this email.',
  ].join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Sign in</h1>'
    + '<p style="margin:0 0 18px">Use this code to open your applications. It expires in 10 minutes.</p>'
    + '<div style="border:1px solid #A62C35;background:#111114;padding:20px;text-align:center;margin:0 0 18px;font-family:Georgia,serif;font-size:34px;letter-spacing:.35em;color:#E6DED4">' + code + '</div>'
    + '<p style="margin:0;color:#AAA5A0;font-size:13px">If you did not request this, you can ignore this email.</p>';
  return { subject, text, html: mailShell(inner) };
}

// ------------------------------- mail queueing ------------------------------

export function queueDecisionEmail(c, s, force = false) {
  if (!s.email || s.emailUpdates === false) return false;
  if (!force && s.notifiedStatus === s.status) return false;
  if (!force && (c.db.outbox || []).some(m =>
    m.kind === 'decision' && m.appId === s.appId &&
    m.decisionStatus === s.status && m.status === 'queued')) return false;
  const mail = decisionEmail(c.db, s, siteUrl(c));
  const key = s.appId + ':' + s.status + ':' + Date.now();
  return queueMail(c.store, { ...mail, to: s.email, kind: 'decision',
    appId: s.appId, decisionStatus: s.status, key }, c.env, c.ctx);
}

export function queueReceiptEmail(c, s) {
  if (!s.email || s.emailUpdates === false) return false;
  const mail = receiptEmail(c.db, s, siteUrl(c));
  const ok = queueMail(c.store, { ...mail, to: s.email, kind: 'receipt', appId: s.appId, key: s.appId + ':receipt' }, c.env, c.ctx);
  if (ok) s.receiptAt = new Date().toISOString();
  return ok;
}

export function queueTicketReplyEmail(c, t, reply) {
  if (!t || !t.email || !reply) return false;
  const mail = ticketReplyEmail(t, reply, siteUrl(c));
  return queueMail(c.store, {
    ...mail, to: t.email, kind: 'ticket',
    key: 'ticket:' + t.id + ':' + (t.replies || []).length + ':' + (reply.at || Date.now()),
  }, c.env, c.ctx);
}

export function queueTicketOpenedEmail(c, t, autoReply) {
  if (!t || !t.email) return false;
  const mail = ticketOpenedEmail(t, autoReply, siteUrl(c));
  return queueMail(c.store, { ...mail, to: t.email, kind: 'ticket', key: 'ticket:' + t.id + ':opened' }, c.env, c.ctx);
}

// -------------------------------- endpoints ---------------------------------

export function register(router) {
  router.get('/health', () => json({ ok: true }));

  router.post('/api/clientlog', c => {
    const db = c.db;
    if (!db.diag || !Array.isArray(db.diag)) db.diag = [];
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    db.diag.unshift({
      t: new Date().toISOString(),
      build: cleanStr(b.build, 20),
      hero: !!b.hero, gated: !!b.gated, token: !!b.token, failed: !!b.failed,
      ua: cleanStr(c.req.headers.get('user-agent') || '', 120),
    });
    if (db.diag.length > 50) db.diag = db.diag.slice(0, 50);
    return c.store.save().then(() => json({ ok: true }));
  });
}
