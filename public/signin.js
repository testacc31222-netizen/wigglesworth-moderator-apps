'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let meta = { mailConfigured: true };
let me = null;
let mode = 'email';
let codeEmail = '';
let redirecting = false;

function safeNext(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '';
  try {
    const u = new URL(raw, location.origin);
    if (u.origin !== location.origin) return '';
    if (/^\/api(\/|$)/.test(u.pathname)) return '';
    if (u.pathname === '/signin' || u.pathname === '/signin.html') return '';
    return u.pathname + u.search + u.hash;
  } catch { return ''; }
}
const nextUrl = safeNext(new URLSearchParams(location.search).get('next'));

function goNext() {
  if (!nextUrl || redirecting) return false;
  redirecting = true;
  setMsg('dashMsg', 'Signed in. Taking you back…', 'ok');
  setTimeout(() => location.replace(nextUrl), 350);
  return true;
}

function setMsg(box, text, kind) {
  const el = $(box);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
function busy(btn, on, text) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = text || 'Working…';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}
function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v || '').trim());
}
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function statusWord(status) {
  return status === 'approved' ? 'Accepted' : status === 'denied' ? 'Not accepted' : 'Under review';
}

function setMode(next) {
  mode = next === 'id' ? 'id' : 'email';
  const emailTab = $('tabEmail');
  const idTab = $('tabId');
  const emailForm = $('emailForm');
  const idForm = $('idForm');
  if (!emailForm || !idForm) return;
  emailTab.classList.toggle('active', mode === 'email');
  idTab.classList.toggle('active', mode === 'id');
  emailTab.setAttribute('aria-selected', mode === 'email' ? 'true' : 'false');
  idTab.setAttribute('aria-selected', mode === 'id' ? 'true' : 'false');
  emailForm.hidden = mode !== 'email';
  idForm.hidden = mode !== 'id';
  setMsg('authMsg', '');
  if (mode === 'id') {
    const e = ($('email').value || '').trim();
    if (e && !$('recEmail').value) $('recEmail').value = e;
    setTimeout(() => { const el = $('recEmail'); if (el && !el.value) el.focus(); }, 30);
  } else {
    setTimeout(() => { const el = $('email'); if (el && !$('codeStep').hidden) $('code').focus(); else if (el) el.focus(); }, 30);
  }
}

function showSignedOut() {
  $('signedIn').hidden = true;
  $('signedOut').hidden = false;
  setMode(meta.mailConfigured === false ? 'id' : mode);
}
function showSignedIn() {
  $('signedOut').hidden = true;
  $('signedIn').hidden = false;
}

function appCard(a) {
  const status = ['approved', 'denied'].includes(a.status) ? a.status : 'pending';
  const note = String(a.adminNote || '').trim();
  return '<article class="app ' + status + '">'
    + '<div class="app-top"><div>'
    + '<div class="role">' + esc(a.typeName || a.type || 'Application') + '</div>'
    + '<h4>' + esc(a.appId || '') + '</h4>'
    + '</div><span class="pill ' + status + '">' + esc(statusWord(status)) + '</span></div>'
    + '<p class="meta">Submitted ' + esc(fmtDate(a.date)) + '</p>'
    + (note ? '<div class="note"><b>Note from staff</b>' + esc(note).replace(/\n/g, '<br>') + '</div>' : '')
    + '</article>';
}

function renderDash() {
  if (!me) { showSignedOut(); return; }
  showSignedIn();
  $('acctEmail').textContent = me.email || '—';
  $('acctSince').textContent = fmtDate(me.createdAt);
  $('updatesPref').checked = me.emailUpdates !== false;
  const apps = Array.isArray(me.apps) ? me.apps : [];
  $('appList').innerHTML = apps.length
    ? apps.map(appCard).join('')
    : '<div class="empty">No applications linked yet.<br>Add one below with the Application ID from your confirmation.</div>';
  setMsg('dashMsg', '');
}

async function loadMe() {
  try {
    const r = await fetch('/api/account/me', { cache: 'no-store' });
    if (r.ok) { me = await r.json(); renderDash(); if (nextUrl) goNext(); return; }
    me = null;
  } catch { me = null; }
  showSignedOut();
}

async function loadMeta() {
  try {
    const r = await fetch('/api/account/meta', { cache: 'no-store' });
    if (r.ok) meta = await r.json();
  } catch {}
  const notice = $('mailOffNotice');
  if (notice) notice.hidden = meta.mailConfigured !== false;
}

function applyMailFallback(message) {
  meta.mailConfigured = false;
  const notice = $('mailOffNotice');
  if (notice) notice.hidden = false;
  setMode('id');
  setMsg('authMsg', message || 'Email delivery is not switched on yet. Use your Application ID to sign in.', 'err');
}

async function submitEmail(e) {
  e.preventDefault();
  if (!$('codeStep').hidden) return verifyCode();
  const email = ($('email').value || '').trim().toLowerCase();
  if (!validEmail(email)) { setMsg('authMsg', 'Enter a valid email address.', 'err'); $('email').focus(); return; }
  const btn = $('sendCodeBtn');
  busy(btn, true, 'Sending…');
  setMsg('authMsg', 'Sending your code…', 'busy');
  try {
    const r = await fetch('/api/account/request-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.mailConfigured === false) applyMailFallback(j.error);
      else setMsg('authMsg', j.error || 'Could not send the code. Try again.', 'err');
      return;
    }
    codeEmail = email;
    $('codeTo').textContent = email;
    $('emailStep').hidden = true;
    $('codeStep').hidden = false;
    $('code').value = '';
    setMsg('authMsg', j.cooldown ? 'A code was just sent. Give it a minute to arrive.' : 'Code sent. Check your inbox and spam folder.', 'ok');
    setTimeout(() => $('code').focus(), 40);
  } catch {
    setMsg('authMsg', 'Could not reach the server. Check your connection and try again.', 'err');
  } finally {
    busy(btn, false);
  }
}

async function verifyCode() {
  const code = ($('code').value || '').replace(/\D/g, '');
  if (code.length !== 6) { setMsg('authMsg', 'Enter the 6-digit code from the email.', 'err'); $('code').focus(); return; }
  const btn = $('verifyBtn');
  busy(btn, true, 'Checking…');
  setMsg('authMsg', 'Checking your code…', 'busy');
  try {
    const r = await fetch('/api/account/verify-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: codeEmail, code }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg('authMsg', j.error || 'That code did not work.', 'err'); return; }
    me = j;
    renderDash();
    $('code').value = '';
    setMsg('dashMsg', 'Signed in. This device will stay signed in for 30 days.', 'ok');
    goNext();
  } catch {
    setMsg('authMsg', 'Could not reach the server. Try again.', 'err');
  } finally {
    busy(btn, false);
  }
}

async function resendCode() {
  if (!codeEmail) { backToEmail(); return; }
  setMsg('authMsg', 'Sending a new code…', 'busy');
  try {
    const r = await fetch('/api/account/request-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: codeEmail }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.mailConfigured === false) applyMailFallback(j.error);
      else setMsg('authMsg', j.error || 'Could not resend. Try again in a minute.', 'err');
      return;
    }
    setMsg('authMsg', j.cooldown ? 'A code was just sent. Give it a minute to arrive.' : 'A new code is on the way.', 'ok');
  } catch { setMsg('authMsg', 'Could not reach the server.', 'err'); }
}

function backToEmail() {
  $('codeStep').hidden = true;
  $('emailStep').hidden = false;
  setMsg('authMsg', '');
  $('email').focus();
}

async function recover(e) {
  e.preventDefault();
  const email = ($('recEmail').value || '').trim().toLowerCase();
  const appId = ($('recApp').value || '').trim().toUpperCase();
  if (!validEmail(email)) { setMsg('authMsg', 'Enter a valid email address.', 'err'); $('recEmail').focus(); return; }
  if (!/^[A-Z0-9]{2,4}-[A-Z2-9]{6}$/.test(appId)) { setMsg('authMsg', 'Enter a valid Application ID (e.g. MOD-ABC123).', 'err'); $('recApp').focus(); return; }
  const btn = $('recoverBtn');
  busy(btn, true, 'Signing in…');
  setMsg('authMsg', 'Checking those details…', 'busy');
  try {
    const r = await fetch('/api/account/recover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, appId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg('authMsg', j.error || 'Those details did not match an application.', 'err'); return; }
    me = j;
    renderDash();
    setMsg('dashMsg', 'Signed in. Add any other Application IDs below.', 'ok');
    goNext();
  } catch {
    setMsg('authMsg', 'Could not reach the server. Try again.', 'err');
  } finally {
    busy(btn, false);
  }
}

async function linkApp(e) {
  e.preventDefault();
  const appId = ($('linkId').value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}-[A-Z2-9]{6}$/.test(appId)) { setMsg('dashMsg', 'Enter a valid Application ID (e.g. MOD-ABC123).', 'err'); return; }
  const btn = e.target.querySelector('button[type=submit]');
  busy(btn, true, 'Linking…');
  setMsg('dashMsg', '');
  try {
    const r = await fetch('/api/account/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg('dashMsg', j.error || 'Could not link that application.', 'err'); return; }
    me = j;
    renderDash();
    $('linkId').value = '';
    setMsg('dashMsg', 'Application linked to this account.', 'ok');
  } catch {
    setMsg('dashMsg', 'Could not reach the server.', 'err');
  } finally {
    busy(btn, false);
  }
}

async function savePrefs() {
  const on = $('updatesPref').checked;
  try {
    const r = await fetch('/api/account/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailUpdates: on }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg('dashMsg', j.error || 'Could not save that preference.', 'err'); $('updatesPref').checked = !on; return; }
    me = j;
    setMsg('dashMsg', on ? 'Decision emails are on.' : 'Decision emails are off. Results will stay on this page.', 'ok');
  } catch {
    setMsg('dashMsg', 'Could not reach the server.', 'err');
    $('updatesPref').checked = !on;
  }
}

async function signOut() {
  try { await fetch('/api/account/signout', { method: 'POST' }); } catch {}
  me = null;
  $('signedOut').hidden = false;
  $('signedIn').hidden = true;
  $('updatesPref').checked = true;
  $('appList').innerHTML = '';
  setMode(meta.mailConfigured === false ? 'id' : 'email');
  setMsg('authMsg', 'Signed out.', 'ok');
}

$('code').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
['recApp', 'linkId'].forEach(id => $(id).addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
}));
(async function boot() {
  await loadMeta();
  if (meta.mailConfigured === false) {
    $('mailOffNotice').hidden = false;
    setMode('id');
  }
  await loadMe();
})();
