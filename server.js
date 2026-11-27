const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);



const PORT = process.env.PORT || 3000;
// HOST must be an IP or plain hostname — anything else falls back safely
// instead of crashing the deploy (e.g. a token pasted in the wrong field).
const RAW_HOST = process.env.HOST || '127.0.0.1';
const HOST = /^(\d{1,3}\.){3}\d{1,3}$|^(localhost|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(RAW_HOST) && RAW_HOST.length < 64
  ? RAW_HOST : '0.0.0.0';
if (HOST !== RAW_HOST) console.error('Bad HOST env value, falling back to 0.0.0.0');
// DATA_FILE can be pointed at a temp copy for safe local testing.
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(__dirname, 'data.live.json');
// Free Render wipes local files on sleep/restart, so every save is mirrored
// into the GitHub repo itself (needs GITHUB_TOKEN + GITHUB_REPO env vars).
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
// Must look like owner/repo — anything else disables sync instead of
// firing API calls at a garbage address (e.g. values swapped by accident).
const RAW_REPO = process.env.GITHUB_REPO || 'testacc31222-netizen/wigglesworth-moderator-apps';
const GH_REPO = /^[\w.-]+\/[\w.-]+$/.test(RAW_REPO)
  ? RAW_REPO : 'testacc31222-netizen/wigglesworth-moderator-apps';
if (GH_REPO !== RAW_REPO) console.error('Bad GITHUB_REPO value, using default repo');
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
// Data backups go on their own branch so autosave commits never trigger a
// Render auto-deploy of `main`. Every deploy wipes the local disk, and a
// deploy landing in the middle of a save used to lose the newest applications.
const GH_DATA_BRANCH = (process.env.GITHUB_DATA_BRANCH || 'data-backup')
  .trim().replace(/[^A-Za-z0-9._-]/g, '-') || 'data-backup';
const GH_PATH = 'data.live.json';
// Overridable so tests can point at a local mock instead of github.com.
const GITHUB_API_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
// Routine autosaves are debounced. New applications and decisions push right
// away so the newest data is never sitting only on Render's ephemeral disk.
const GH_BACKUP_INTERVAL_MS = Math.max(30_000,
  Number(process.env.GITHUB_BACKUP_INTERVAL_MS) || 5 * 60 * 1000);
// Teaser uploads land in the countdown repo so the static site can serve them.
const GH_CD_REPO = process.env.GITHUB_COUNTDOWN_REPO || 'testacc31222-netizen/wigglesworth-countdown';
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch {}
app.use('/evidence', express.static(EVIDENCE_DIR, { maxAge: '7d' }));
const COUNTDOWN_PUBLIC_URL = (process.env.COUNTDOWN_PUBLIC_URL || 'https://wigglesworth-countdown.onrender.com').replace(/\/$/, '');
// Discord staff alerts (ticket created + user replies). URL stays server-side.
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const DISCORD_PING_ID = (process.env.DISCORD_PING_ID || '').replace(/\D/g, '');

// --- Discord role sync ------------------------------------------------------
// Approving an application adds the matching role through the bot token. The
// site stays usable when this is unset: the decision saves and staff can retry.
const DISCORD_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || '').trim();
const DISCORD_GUILD_ID = (process.env.DISCORD_GUILD_ID || '').replace(/\D/g, '');
const DISCORD_API_BASE = (process.env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/$/, '');
const roleList = (value) => [...new Set(String(value || '')
  .split(/[\s,;]+/)
  .map(v => v.replace(/\D/g, ''))
  .filter(v => v.length >= 17 && v.length <= 20))];
const DISCORD_ROLE_IDS = {
  moderator: roleList(process.env.DISCORD_ROLE_MOD),
  creator: roleList(process.env.DISCORD_ROLE_CC),
  developer: roleList(process.env.DISCORD_ROLE_DEV),
  };
const discordRoleConfigured = () => !!(DISCORD_BOT_TOKEN && DISCORD_GUILD_ID);
// Approval congratulations. Moderator only for now; other types fall through.
const DISCORD_ACCEPT_CHANNEL = (process.env.DISCORD_ACCEPT_CHANNEL || '').replace(/\D/g, '');
const TYPE_LABELS = {
  moderator: 'Moderator',
  creator: 'Content Creator',
  developer: 'Developer',
  };

// --- Email updates (Google Apps Script, Resend, Brevo, or Gmail/SMTP) ------
// Set one provider on Render to turn delivery on. Until then, mail is queued
// in data.live.json and shown to staff, so nothing is lost.
const MAIL_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || '').trim();
const APPS_SCRIPT_SECRET = (process.env.APPS_SCRIPT_SECRET || '').trim();
const APPS_SCRIPT_CONFIGURED = !!(APPS_SCRIPT_URL && APPS_SCRIPT_SECRET);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const SMTP_HOST = (process.env.SMTP_HOST || (SMTP_USER ? 'smtp.gmail.com' : '')).trim();
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10) || 587;
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
const SMTP_CONFIGURED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const MAIL_FROM = (process.env.MAIL_FROM || (SMTP_CONFIGURED
  ? `Wigglesworth Staff <${SMTP_USER}>`
  : APPS_SCRIPT_CONFIGURED
    ? 'Wigglesworth Staff'
    : 'Wigglesworth Applications <onboarding@resend.dev>')).trim();
const MAIL_REPLY_TO = (process.env.MAIL_REPLY_TO || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://wigglesworth-applications.onrender.com').replace(/\/$/, '');
function mailProvider() {
  const want = String(process.env.MAIL_PROVIDER || '').toLowerCase();
  if (want === 'apps_script' && APPS_SCRIPT_CONFIGURED) return 'apps_script';
  if (want === 'smtp' && SMTP_CONFIGURED) return 'smtp';
  if (want === 'brevo' && BREVO_API_KEY) return 'brevo';
  if (want === 'resend' && MAIL_API_KEY) return 'resend';
  if (APPS_SCRIPT_CONFIGURED) return 'apps_script';
  if (SMTP_CONFIGURED) return 'smtp';
  if (MAIL_API_KEY) return 'resend';
  if (BREVO_API_KEY) return 'brevo';
  return '';
}
const mailConfigured = () => !!mailProvider();
let smtpTransport = null;
function getSmtpTransport() {
  if (!SMTP_CONFIGURED) return null;
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    });
  }
  return smtpTransport;
}


async function discordPost(url, body, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (r.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
      let wait = 5000 * (attempt + 1);
      try {
        const j = await r.json();
        if (j.retry_after) wait = Math.min(120000, j.retry_after * 1000 + 500);
      } catch {}
      console.error(`discord alert throttled (try ${attempt + 1}), retrying in ${Math.round(wait / 1000)}s`);
      await new Promise(res => setTimeout(res, wait));
      return discordPost(url, body, attempt + 1);
    }
    if (!r.ok) console.error('discord alert failed', r.status);
    else if (attempt > 0) console.log('discord alert delivered after retry');
  } catch (e) { console.error('discord alert error', e.message); }
}
function discordNotify(text) {
  if (!DISCORD_WEBHOOK_URL) return;
  const body = { content: (DISCORD_PING_ID ? `<@${DISCORD_PING_ID}> ` : '') + text.slice(0, 1800) };
  discordPost(DISCORD_WEBHOOK_URL, body).catch(e => console.error('discord alert error', e.message));
}

function validDiscordId(id) {
  return /^\d{17,20}$/.test(String(id || '').replace(/\D/g, ''));
}
function roleIdsForType(type) {
  return DISCORD_ROLE_IDS[type] || [];
}
async function discordApi(method, apiPath, body) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(DISCORD_API_BASE + apiPath, {
      method,
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'wigglesworth-applications',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message || 'network error' };
  } finally {
    clearTimeout(to);
  }
}
// Applications no longer ask for a Discord User ID: the username on the form is
// matched against the guild at approval time. Staff can still paste an ID.
function normDiscordName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .split('#')[0]
    .replace(/\s+/g, ' ')
    .trim();
}
function compactName(value) {
  return normDiscordName(value).replace(/[^a-z0-9]/g, '');
}
async function resolveDiscordMemberId(sub) {
  const saved = String(sub.discordId || '').replace(/\D/g, '');
  if (validDiscordId(saved)) return { id: saved };
  const raw = String(sub.discord || '').trim();
  const query = raw.replace(/^@+/, '').split('#')[0].trim();
  if (!query) {
    return { error: 'No Discord username on file. Paste their Discord User ID on the card.' };
  }
  const r = await discordApi('GET',
    `/guilds/${DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(query)}&limit=100`);
  if (!r.ok) {
    return { error: r.status === 403
      ? 'The bot needs the Server Members intent to look up usernames. Enter their Discord User ID instead.'
      : `Discord lookup failed (${r.status || r.error || 'unknown'}).` };
  }
  const members = Array.isArray(r.data) ? r.data : [];
  const names = (m) => {
    const u = m.user || {};
    return [u.username, u.global_name, m.nick].map(normDiscordName).filter(Boolean);
  };
  const want = normDiscordName(query);
  const wantCompact = compactName(query);
  const exact = members.filter(m =>
    names(m).some(n => n === want || compactName(n) === wantCompact));
  if (exact.length === 1) return { id: exact[0].user.id };
  if (exact.length > 1) {
    return { error: 'More than one member matches that username. Paste their Discord User ID on the card.' };
  }
  // Tolerate small differences (spaces, punctuation, display name vs username).
  const loose = members.filter(m =>
    names(m).some(n => n.includes(want) || want.includes(n)));
  if (loose.length === 1) return { id: loose[0].user.id, fuzzy: true };
  if (loose.length > 1) {
    return { error: 'That username matches several members. Paste their Discord User ID on the card.' };
  }
  return { error: 'No member in the server matches that username. The username may have changed — paste their User ID.' };
}
function roleFailHint(status) {
  return status === 404
    ? 'That user is not in the Discord server.'
    : status === 403
      ? 'The bot needs Manage Roles, and its role must be above the role it is assigning.'
      : status === 401
        ? 'The Discord bot token is invalid.'
        : `Discord returned ${status || 'an error'}.`;
}
async function grantRoleForSubmission(sub, { force = false } = {}) {
  if (!discordRoleConfigured()) {
    return { assigned: false, error: 'Discord role sync is not configured (set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID).' };
  }
  const roleIds = roleIdsForType(sub.type);
  if (!roleIds.length) {
    return { assigned: false, error: `No Discord role ID configured for ${sub.type || 'this application'}.` };
  }
  const saved = Array.isArray(sub.roleAssignedRoleIds) ? sub.roleAssignedRoleIds : [];
  if (!force && sub.roleAssignedAt && saved.length === roleIds.length
      && roleIds.every(id => saved.includes(id))) {
    return { assigned: true, already: true, userId: sub.discordId || '', roleIds };
  }
  const who = await resolveDiscordMemberId(sub);
  if (!who.id) {
    sub.roleError = cleanStr(who.error, 300);
    return { assigned: false, error: sub.roleError };
  }
  sub.discordId = who.id;
  const failed = [];
  const assigned = [];
  for (const roleId of roleIds) {
    const r = await discordApi('PUT',
      `/guilds/${DISCORD_GUILD_ID}/members/${who.id}/roles/${roleId}`);
    if (r.ok) assigned.push(roleId);
    else failed.push({ roleId, status: r.status, error: r.error });
  }
  if (!failed.length) {
    sub.roleAssignedAt = new Date().toISOString();
    sub.roleAssignedRoleIds = roleIds;
    sub.roleAssignedRoleId = roleIds[0]; // older builds read the single-role field
    sub.roleError = '';
    return { assigned: true, userId: who.id, roleIds };
  }
  const label = roleIds.length === 1
    ? `Role ${failed[0].roleId} could not be assigned. `
    : `${failed.length} of ${roleIds.length} roles could not be assigned. `;
  sub.roleAssignedRoleIds = assigned;
  if (assigned.length) {
    sub.roleAssignedAt = new Date().toISOString();
    sub.roleAssignedRoleId = assigned[0];
  }
  sub.roleError = cleanStr(label + roleFailHint(failed[0].status), 300);
  return {
    assigned: false, partial: assigned.length > 0, userId: who.id,
    roleIds, failed: failed.map(f => f.roleId), error: sub.roleError,
  };
}

// Congratulate a newly accepted moderator in the configured channel. Never
// blocks the decision: failures are stored on the application for staff retry.
async function announceAcceptance(sub, { force = false } = {}) {
  if (sub.type !== 'moderator') return { posted: false, skipped: 'not moderator' };
  if (!force && sub.acceptAnnouncedAt) return { posted: false, already: true };
  if (!DISCORD_ACCEPT_CHANNEL) return { posted: false, error: 'No congratulations channel set (DISCORD_ACCEPT_CHANNEL).' };
  if (!DISCORD_BOT_TOKEN) return { posted: false, error: 'DISCORD_BOT_TOKEN is not set.' };
  const who = await resolveDiscordMemberId(sub);
  if (!who.id) {
    sub.acceptAnnounceError = cleanStr(who.error || 'Discord member not found.', 300);
    return { posted: false, error: sub.acceptAnnounceError };
  }
  sub.discordId = who.id;
  const label = TYPE_LABELS[sub.type] || 'Staff';
  const content = `🎉 **Congratulations <@${who.id}>!** Your **${label}** application was accepted — welcome to the Wigglesworth team.`;
  const r = await discordApi('POST', `/channels/${DISCORD_ACCEPT_CHANNEL}/messages`, {
    content,
    // Ping only the new member: no @everyone, no role pings.
    allowed_mentions: { parse: [], users: [String(who.id)] },
  });
  if (!r.ok) {
    sub.acceptAnnounceError = r.status === 404
      ? 'Congratulations channel not found — check DISCORD_ACCEPT_CHANNEL.'
      : `Discord returned ${r.status || r.error || 'an error'}.`;
    return { posted: false, error: sub.acceptAnnounceError };
  }
  sub.acceptAnnouncedAt = new Date().toISOString();
  sub.acceptAnnounceError = '';
  return { posted: true, userId: who.id, messageId: r.data && r.data.id };
}

let ghPushBusy = false;
let ghPushQueued = false;
let ghPushTimer = null;
let ghPushLastAt = 0;
const GH_HEADERS = () => ({
  'User-Agent': 'wigglesworth-apps',
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
});

// The backup branch is created from `main` the first time a backup runs, so no
// manual setup is needed. Pushing there keeps `main` (and Render auto-deploy)
// untouched.
async function ensureDataBranch() {
  if (GH_DATA_BRANCH === GH_BRANCH) return;
  const base = `${GITHUB_API_BASE}/repos/${GH_REPO}`;
  const H = GH_HEADERS();
  try {
    const head = await fetch(`${base}/branches/${GH_DATA_BRANCH}`, { headers: H });
    if (head.ok) return;
    if (head.status !== 404) { console.error('gh data branch check failed', head.status); return; }
    const ref = await fetch(`${base}/git/ref/heads/${GH_BRANCH}`, { headers: H });
    if (!ref.ok) { console.error('gh base branch read failed', ref.status); return; }
    const sha = (await ref.json()).object.sha;
    const made = await fetch(`${base}/git/refs`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${GH_DATA_BRANCH}`, sha }),
    });
    if (made.ok) console.log(`Created GitHub data branch ${GH_DATA_BRANCH}`);
    else if (made.status !== 422) console.error('gh data branch create failed', made.status);
  } catch (e) { console.error('gh data branch error', e.message); }
}

// Read one backup copy. Returns null when the file is not there yet.
async function readGitHubData(branch) {
  const api = `${GITHUB_API_BASE}/repos/${GH_REPO}/contents/${GH_PATH}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(api, { headers: GH_HEADERS(), signal: AbortSignal.timeout(12000) });
  if (r.status === 404) return { missing: true, sha: null, data: null };
  if (!r.ok) throw new Error('GitHub data read HTTP ' + r.status);
  const file = await r.json();
  const sha = file.sha || null;
  let text = null;
  if (file.encoding === 'base64' && typeof file.content === 'string' && file.content) {
    text = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
  } else {
    // The JSON form of the contents API stops returning content at 1 MB, and
    // the database is already larger than that. The raw form handles 100 MB.
    const raw = await fetch(api, {
      headers: { ...GH_HEADERS(), Accept: 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!raw.ok) throw new Error('GitHub data download HTTP ' + raw.status);
    text = await raw.text();
  }
  if (!text) throw new Error('GitHub data backup invalid');
  return { missing: false, sha, data: JSON.parse(text) };
}

// Serialized autosave. Every push merges with what is already on GitHub first,
// so a stale local copy can add records to the backup but can never delete
// them. Racing writes used to silently drop whole applications.
async function pushToGitHub() {
  if (!GH_TOKEN) return;
  if (ghPushBusy) { ghPushQueued = true; return; }
  ghPushBusy = true;
  try {
    await ensureDataBranch();
    const api = `${GITHUB_API_BASE}/repos/${GH_REPO}/contents/${GH_PATH}`;
    const H = GH_HEADERS();
    for (let attempt = 0; attempt < 3; attempt++) {
      let sha = null;
      let remote = null;
      try {
        const g = await readGitHubData(GH_DATA_BRANCH);
        let source = g;
        // First run on a brand new branch: start from the `main` copy so no
        // history is dropped. It is copied into the new branch, so the PUT
        // must not reuse main's file sha.
        if (g.missing && GH_DATA_BRANCH !== GH_BRANCH) {
          const fb = await readGitHubData(GH_BRANCH).catch(() => null);
          if (fb && !fb.missing) source = { missing: true, sha: null, data: fb.data };
        }
        sha = source.missing ? null : source.sha;
        remote = source.data;
      } catch (e) {
        // Never write blind after a failed read: that is how recent data dies.
        console.error('gh read error', e.message);
        return;
      }
      if (sha && !remote) { console.error('gh backup unreadable, refusing to overwrite'); return; }
      const local = loadDB();
      const merged = remote ? mergeDatabases(remote, local) : local;
      const content = JSON.stringify(merged, null, 2);
      if (Buffer.byteLength(content) > 40_000_000) { console.error('gh backup too large, skip'); return; }
      const put = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'autosave site data', content: Buffer.from(content).toString('base64'),
          sha: sha || undefined, branch: GH_DATA_BRANCH }) });
      if (put.ok) { ghPushLastAt = Date.now(); return; }
      // 409/422 mean the branch moved while we were writing: refetch the sha,
      // re-read the file (it always holds the newest state) and try again.
      if (put.status === 409 || put.status === 422) continue;
      console.error('gh backup failed', put.status);
      return;
    }
    console.error('gh backup failed after retries');
  } catch (e) { console.error('gh backup error', e.message); }
  finally {
    ghPushBusy = false;
    if (ghPushQueued) { ghPushQueued = false; pushToGitHub().catch(e => console.error('gh backup error', e.message)); }
  }
}

// immediate=true is used for new applications and decisions, so the newest
// data never waits for a debounce window. Routine saves are throttled.
function scheduleGitHubBackup(immediate = false) {
  if (!GH_TOKEN) return;
  if (immediate) {
    if (ghPushTimer) { clearTimeout(ghPushTimer); ghPushTimer = null; }
    pushToGitHub().catch(e => console.error('gh backup error', e.message));
    return;
  }
  if (ghPushTimer) return;
  const wait = Math.max(5000, GH_BACKUP_INTERVAL_MS - (Date.now() - ghPushLastAt));
  ghPushTimer = setTimeout(() => {
    ghPushTimer = null;
    pushToGitHub().catch(e => console.error('gh backup error', e.message));
  }, wait);
  if (ghPushTimer.unref) ghPushTimer.unref();
}
const ENV_EDIT_CODE = process.env.EDIT_CODE || '';

app.use(helmet({
  contentSecurityPolicy: {
    // NOTE: no script-src-attr directive on purpose — the UI uses inline
    // onclick handlers, and helmet's default ('none') would disable them all.
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.youtube.com', 'https://s.ytimg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ['https://www.youtube-nocookie.com'],
      mediaSrc: ["'self'", 'https:'],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '200kb' }));
// The standalone countdown site reads public config cross-origin and,
// with the staff edit code, saves countdown changes back.
const COUNTDOWN_ORIGIN = 'https://wigglesworth-countdown.onrender.com';
app.use((req, res, next) => {
  if (req.headers.origin === COUNTDOWN_ORIGIN) {
    res.set('Access-Control-Allow-Origin', COUNTDOWN_ORIGIN);
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, x-edit-code');
      res.set('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
  }
  next();
});
// The public site is now account-only. Staff can still reach the editor shell
// with ?staff=1 and then unlock it with the edit code. Check the decoded path
// so encoded or repeated-slash variants cannot slip past the gate.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let pathname = req.path;
  try { pathname = decodeURIComponent(pathname); } catch { return next(); }
  pathname = pathname.replace(/\/{2,}/g, '/').toLowerCase();
  if (pathname !== '/' && pathname !== '/index.html') return next();
  if (req.query.staff === '1') return next();
  const db = loadDB();
  if (accountFromReq(req, db)) return next();
  if (staffFromReq(req, db)) return next();
  const nextPath = req.originalUrl && req.originalUrl.startsWith('/') ? req.originalUrl : (pathname === '/' ? '/' : '/index.html');
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, '/signin?next=' + encodeURIComponent(nextPath));
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', setHeaders(res, filePath) {
  if (/[\\/](index|signin)\.html$/.test(filePath) || /[\\/](app|signin)\.js$/.test(filePath)) {
    res.set('Cache-Control', 'no-store');
  }
} }));
app.get('/signin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'signin.html'));
});

const general = rateLimit({ windowMs: 60 * 1000, max: 120 });
const submitLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: { error: 'Too many applications, try again later.' } });
const adminLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: { error: 'Too many attempts, slow down.' } });
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
const configLimit = rateLimit({ windowMs: 60 * 1000, max: 40 });
const accountLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many sign-in emails. Wait a few minutes.' } });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many code attempts. Wait a few minutes.' } });
const recoverLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, message: { error: 'Too many attempts. Wait a few minutes.' } });
const staffLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { error: 'Too many staff sign-in attempts. Wait a few minutes.' } });
const ticketLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: { error: 'Too many tickets, try again later.' } });
// Blunt, tiny abuse filter for public text (matches stay staff-side).
const SLURS = [/\bnigg?[ae]rs?\b/i, /\bf+ag+g+o+t+s?\b/i, /\bkike?s?\b/i, /\bch[i1]nks?\b/i, /\bspi+c+s?\b/i, /\btrann(y|ies)\b/i];
function hasSlur(s) { return SLURS.some(re => re.test(String(s || ''))); }
const aiLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'AI limit reached, try later.' } });
// Optional AI drafts (Groq free tier works): set AI_API_KEY (+AI_BASE_URL, AI_MODEL).
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-oss-20b';
// gpt-oss models spend tokens on hidden reasoning before the visible answer —
// keep that cheap so the reply text never comes back empty.
function aiBody(messages, temperature, maxTokens) {
  const b = { model: AI_MODEL, temperature, max_tokens: maxTokens, messages };
  if (/gpt-oss/i.test(AI_MODEL)) b.reasoning_effort = 'low';
  return b;
}
function cleanText(v, max = 2000) {
  return String(v ?? '').replace(/[^\S\n\t ]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}
const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Too many uploads, try later.' } });
const evidenceLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many uploads, try later.' } });
const diagLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Slow down.' } });
app.use('/api/', general);

const Q = (id, label, type, placeholder, required, options = '') =>
  ({ id, label, type, placeholder, required, options });

const DEFAULT_TYPES = [
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
  // Event Hoster type removed
];

const DEFAULT_CONFIG = {
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
  applicationTypes: JSON.parse(JSON.stringify(DEFAULT_TYPES)),
};

// One shared in-memory database. Before this, every request parsed its own
// copy of the file and then wrote that whole copy back after a Discord/email
// await — two approvals at once meant the second write erased the first.
// ---- staff accounts (username + password sign-in) --------------------------
const STAFF_SESSION_DAYS = 30;
const STAFF_MIN_PASSWORD = 8;
function hashStaffPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
const STAFF_ROLES = ['owner', 'staff', 'viewer'];
function cleanStaffRole(role) {
  return STAFF_ROLES.includes(role) ? role : 'staff';
}
function makeStaffAccount(username, password, role = 'staff', createdBy = '') {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: 'stf_' + crypto.randomBytes(10).toString('hex'),
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
function setStaffPassword(acct, password) {
  acct.salt = crypto.randomBytes(16).toString('hex');
  acct.hash = hashStaffPassword(password, acct.salt);
}
function verifyStaffPassword(acct, password) {
  if (!acct || !acct.salt || !acct.hash) return false;
  let got;
  try { got = hashStaffPassword(password, acct.salt); } catch { return false; }
  return safeEq(got, acct.hash);
}
function publicStaffAccount(a) {
  return {
    id: a.id, username: a.username, role: a.role,
    active: a.active !== false, createdAt: a.createdAt || '',
    createdBy: a.createdBy || '', lastLoginAt: a.lastLoginAt || '',
  };
}

let cachedDB = null;
let dbLoaded = false;
function emptyDB() {
  return { config: structuredClone(DEFAULT_CONFIG), submissions: [], tickets: [], reports: [],
    audit: [], accounts: [], loginCodes: [], outbox: [], staffAccounts: [] };
}
function loadDB() {
  if (dbLoaded) return cachedDB;
  let db = null;
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  db = normalizeDB(db);
  cachedDB = db;
  dbLoaded = true;
  return db;
}
// Fixups for DBs saved before these fields existed. Also applied after a merge
// so a restored config always has the current question set and defaults.
function normalizeDB(db) {
  if (!db || typeof db !== 'object') db = emptyDB();
  if (!db.config || typeof db.config !== 'object') db.config = structuredClone(DEFAULT_CONFIG);
  if (!Array.isArray(db.submissions)) db.submissions = [];
  if (!Array.isArray(db.accounts)) db.accounts = [];
  if (!Array.isArray(db.loginCodes)) db.loginCodes = [];
  if (!Array.isArray(db.outbox)) db.outbox = [];
  // migrate v2 (single mod form) -> v3 (types)
  if (!Array.isArray(db.config.applicationTypes)) {
    const old = db.config;
    const mod = structuredClone(DEFAULT_TYPES[0]);
    if (Array.isArray(old.questions) && old.questions.length) mod.questions = old.questions;
    if (typeof old.successMessage === 'string' && old.successMessage) mod.successMessage = old.successMessage;
    old.applicationTypes = [mod, structuredClone(DEFAULT_TYPES[1]), structuredClone(DEFAULT_TYPES[2])];
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
  // Staff sign-in accounts. Seeded once with the site owner so the Staff tab
  // always has a way in. Passwords are salted-scrypt hashes, never plain text.
  if (!Array.isArray(db.staffAccounts) || !db.staffAccounts.length) {
    db.staffAccounts = [makeStaffAccount('khamari', 'wigglesworthrules', 'owner', 'system')];
  }
  for (const a of db.staffAccounts) {
    if (typeof a.username !== 'string') a.username = '';
    if (typeof a.role !== 'string' || !a.role) a.role = 'staff';
    if (!STAFF_ROLES.includes(a.role)) a.role = 'staff';
    if (a.active === undefined) a.active = true;
  }
  // fixups for DBs saved before these fields existed
  for (const t of db.config.applicationTypes) if (t.open === undefined) t.open = true;
  for (const t of db.config.applicationTypes) {
    if (!t.successMessage) {
      const d = DEFAULT_TYPES.find(x => x.id === t.id);
      t.successMessage = d ? d.successMessage : 'Thanks! Your application was received.';
    }
    // Discord User IDs are no longer asked for on the form. Applications are
    // matched to server members by username when they are approved; staff can
    // still paste an ID on the card if the lookup fails. One-time migration so a
    // staff-added "Discord User ID" question is not stripped on every load.
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
  if (!Array.isArray(db.config.faq)) db.config.faq = structuredClone(DEFAULT_CONFIG.faq);
  if (!db.config.copy || typeof db.config.copy !== 'object' || Array.isArray(db.config.copy)) db.config.copy = {};
  if (!db.config.about || typeof db.config.about !== 'object') db.config.about = structuredClone(DEFAULT_CONFIG.about);
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
  // Gothic horror palette: roll legacy accents/bgs and stale hero copy into the new theme.
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
function writeDBFile(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function saveDB(db, opts = {}) {
  // Cache first: even if the disk write fails, the running instance keeps the
  // mutation instead of falling back to an older copy for the next request.
  cachedDB = db;
  dbLoaded = true;
  writeDBFile(db);
  // persist off the ephemeral disk; never fail the request over it
  scheduleGitHubBackup(opts.immediate === true);
}

// --- merging two database snapshots ----------------------------------------
// Restoring or backing up must only ever ADD records. A newer backup and a
// stale local file are unioned by id, so an old copy cannot delete a recent
// application and a recent decision cannot be reverted to "pending".
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
  // One-off values that an older copy legitimately lacks.
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
function mergeDatabases(remote, local) {
  const r = remote && typeof remote === 'object' ? remote : {};
  const l = local && typeof local === 'object' ? local : {};
  return {
    ...l,
    ...r,
    config: mergeConfig(r.config, l.config),
    submissions: sortSubmissions(mergeById(r.submissions, l.submissions, 'appId')),
    accounts: mergeById(r.accounts, l.accounts, 'id'),
    tickets: mergeById(r.tickets, l.tickets, 'id'),
    reports: mergeById(r.reports, l.reports, 'id'),
    outbox: mergeOutbox(r.outbox, l.outbox),
    // Codes are short-lived and belong to the instance that issued them.
    loginCodes: (l.loginCodes && l.loginCodes.length) ? l.loginCodes : (r.loginCodes || []),
    audit: [...(l.audit || []), ...(r.audit || [])].slice(0, 100),
  };
}
function genId(prefix) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[crypto.randomInt(c.length)];
  return prefix + '-' + s;
}
function cleanStr(v, max = 2000) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}
function safeEq(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
const effectiveCode = db => ENV_EDIT_CODE || db.config.editCode;
function staffRole(req, db) {
  const got = req.headers['x-edit-code'];
  if (got && safeEq(got, effectiveCode(db))) return 'owner';
  const acct = staffFromReq(req, db);
  return acct ? cleanStaffRole(acct.role) : '';
}
// Full staff tools: edit the site, decide applications, manage tickets/reports.
// Read-only viewers are deliberately excluded.
function isAdmin(req, db) {
  const role = staffRole(req, db);
  return role === 'owner' || role === 'staff';
}
// Viewers may list/read applications but cannot change anything.
function canViewApplications(req, db) {
  return !!staffRole(req, db);
}
function publicConfig(db) {
  const { editCode, ...rest } = db.config;
  // success messages are only revealed after a real submission
  rest.applicationTypes = (rest.applicationTypes || []).map(t => {
    const { successMessage, ...pub } = t;
    return pub;
  });
  return rest;
}
function typeById(db, id) {
  return db.config.applicationTypes.find(t => t.id === id);
}
function validAppId(id) {
  return /^[A-Z0-9]{2,4}-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}
function validTicketId(id) {
  return /^TKT-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}
function validReportId(id) {
  return /^RPT-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}
async function githubPutFile(repo, fpath, buf, message) {
  const api = `${GITHUB_API_BASE}/repos/${repo}/contents/${fpath}`;
  const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
  try {
    const r = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: buf.toString('base64'), branch: GH_BRANCH }) });
    if (!r.ok) console.error('gh file store failed', r.status, fpath);
    return r.ok;
  } catch (e) { console.error('gh file store error', e.message); return false; }
}
function displayName(s) {
  return cleanStr(s.discordName || s.discord || s.username || 'Applicant', 80);
}

// ============================ Applicant accounts ============================
// Passwordless: a 6-digit code proves the email, plus an Application-ID
// fallback so people can still get in before mail delivery is configured.
const SESSION_DAYS = 30;
function parseCookies(req) {
  const out = {};
  for (const bit of String(req.headers.cookie || '').split(';')) {
    const i = bit.indexOf('=');
    if (i < 0) continue;
    const k = bit.slice(0, i).trim();
    if (!k) continue;
    const raw = bit.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(raw); } catch { out[k] = raw; }
  }
  return out;
}
function sessionKey() {
  return crypto.createHash('sha256').update(
    'ws-account|' + (process.env.SESSION_SECRET || '') + '|' + GH_TOKEN + '|' + ENV_EDIT_CODE
  ).digest();
}
function sessionSign(id, exp) {
  const payload = id + '.' + exp;
  return payload + '.' + crypto.createHmac('sha256', sessionKey()).update(payload).digest('base64url');
}
function sessionRead(req) {
  const raw = parseCookies(req).ws_account;
  if (!raw) return null;
  const bits = raw.split('.');
  if (bits.length !== 3) return null;
  const [id, exp, sig] = bits;
  if (!/^acc_[a-f0-9]{20,40}$/.test(id)) return null;
  if (!/^\d{10,16}$/.test(exp) || +exp < Date.now()) return null;
  const want = crypto.createHmac('sha256', sessionKey()).update(id + '.' + exp).digest('base64url');
  return safeEq(sig, want) ? id : null;
}
function setAccountCookie(req, res, id) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  res.cookie('ws_account', sessionSign(id, exp), {
    httpOnly: true, sameSite: 'lax', secure: !!req.secure,
    maxAge: SESSION_DAYS * 86400000, path: '/',
  });
}
function clearAccountCookie(res) {
  res.clearCookie('ws_account', { path: '/' });
}

// Separate signed cookie for staff tools. It only carries the account id, so a
// stolen cookie cannot reveal a username or password hash.
function staffSessionKey() {
  return crypto.createHash('sha256').update(
    'ws-staff|' + (process.env.SESSION_SECRET || '') + '|' + GH_TOKEN + '|' + ENV_EDIT_CODE
  ).digest();
}
function staffSessionSign(id, exp) {
  const payload = id + '.' + exp;
  return payload + '.' + crypto.createHmac('sha256', staffSessionKey()).update(payload).digest('base64url');
}
function staffSessionRead(req) {
  const raw = parseCookies(req).ws_staff;
  if (!raw) return null;
  const bits = raw.split('.');
  if (bits.length !== 3) return null;
  const [id, exp, sig] = bits;
  if (!/^stf_[a-f0-9]{16,32}$/.test(id)) return null;
  if (!/^\d{10,16}$/.test(exp) || +exp < Date.now()) return null;
  const want = crypto.createHmac('sha256', staffSessionKey()).update(id + '.' + exp).digest('base64url');
  return safeEq(sig, want) ? id : null;
}
function setStaffCookie(req, res, id) {
  const exp = Date.now() + STAFF_SESSION_DAYS * 86400000;
  res.cookie('ws_staff', staffSessionSign(id, exp), {
    httpOnly: true, sameSite: 'lax', secure: !!req.secure,
    maxAge: STAFF_SESSION_DAYS * 86400000, path: '/',
  });
}
function clearStaffCookie(res) {
  res.clearCookie('ws_staff', { path: '/' });
}
function staffFromReq(req, db) {
  const id = staffSessionRead(req);
  if (!id) return null;
  const acct = (db.staffAccounts || []).find(a => a.id === id && a.active !== false);
  return acct || null;
}
function staffOwner(req, db) {
  if (req.headers['x-edit-code'] && safeEq(req.headers['x-edit-code'], effectiveCode(db))) return true;
  const acct = staffFromReq(req, db);
  return !!(acct && acct.role === 'owner');
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return u.host === req.headers.host; } catch { return false; }
}
function normEmail(v) {
  const s = cleanStr(v, 180).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : '';
}
function hashCode(email, code) {
  return crypto.createHmac('sha256', sessionKey()).update(email + '|' + code).digest('hex');
}
function accountFromReq(req, db) {
  const id = sessionRead(req);
  if (!id) return null;
  return (db.accounts || []).find(a => a.id === id) || null;
}
function ensureAccount(db, email) {
  email = normEmail(email);
  let a = (db.accounts || []).find(x => x.email === email);
  if (!a) {
    a = {
      id: 'acc_' + crypto.randomBytes(12).toString('hex'),
      email, createdAt: new Date().toISOString(), emailUpdates: true,
    };
    db.accounts.push(a);
    if (db.accounts.length > 5000) db.accounts = db.accounts.slice(-5000);
  }
  // Link anything already submitted with this email.
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
    // Do not expose legacy tickets without an account/email association.
    .filter(t => t.accountId === a.id || (t.email && normEmail(t.email) === a.email))
    .sort((x, y) => String(y.updatedAt || y.createdAt || '').localeCompare(String(x.updatedAt || x.createdAt || '')))
    .slice(0, 100)
    .map(t => ({ id: t.id, subject: t.subject, status: t.status || 'open', createdAt: t.createdAt, updatedAt: t.updatedAt }));
  return { email: a.email, createdAt: a.createdAt, emailUpdates: a.emailUpdates !== false, apps: appsForAccount(db, a), tickets };
}
// Older tickets predate accounts. Their random ticket ID is still the secret,
// so a signed-in visitor who knows the ID may open them. New tickets are tied
// to the account that created them.
function ticketForAccount(t, a) {
  if (!t || !a) return false;
  if (t.accountId) return t.accountId === a.id;
  if (t.email) return normEmail(t.email) === a.email;
  return true;
}
// A signed-in applicant who opens an older ticket with its secret ID can claim
// it for their account. That lets future staff replies reach their inbox.
function claimTicketForAccount(db, t, a) {
  if (!t || !a) return false;
  let changed = false;
  if (!t.accountId && (!t.email || normEmail(t.email) === a.email)) {
    t.accountId = a.id;
    changed = true;
  }
  if (!t.email && t.accountId === a.id) {
    t.email = a.email;
    changed = true;
  }
  if (changed) saveDB(db);
  return changed;
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

// ================================ Email ====================================
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mailShell(inner, footer) {
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
function decisionEmail(db, s) {
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
    PUBLIC_URL + '/signin', '',
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
    + '<a href="' + escHtml(PUBLIC_URL + '/signin') + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">View my application</a>';
  return { subject, text, html: mailShell(inner) };
}
function receiptEmail(db, s) {
  const t = typeById(db, s.type);
  const role = t ? t.name : s.type;
  const subject = 'We received your Wigglesworth ' + role + ' application';
  const text = [
    'Hi ' + displayName(s) + ',', '',
    'Your ' + role + ' application (' + s.appId + ') is in the queue.', '',
    'We will email you again as soon as there is a decision.',
    'You can sign in any time to check its status:',
    PUBLIC_URL + '/signin', '',
    '— Wigglesworth Staff',
  ].join('\n');
  const inner = '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 18px;color:#F1ECE6">Application received</h1>'
    + '<p style="margin:0 0 14px">Hi ' + escHtml(displayName(s)) + ',</p>'
    + '<p style="margin:0 0 18px">Your <b>' + escHtml(role) + '</b> application is in the queue and will be read by a human.</p>'
    + '<div style="border:1px solid #2b2b31;background:#111114;padding:16px 20px;margin:0 0 20px">'
    + '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#AAA5A0;margin-bottom:6px">Application ID</div>'
    + '<div style="font-family:Georgia,serif;font-size:20px;color:#E6DED4">' + escHtml(s.appId) + '</div></div>'
    + '<p style="margin:0 0 18px;color:#AAA5A0;font-size:13px">We will email you again when there is a decision. Nothing else is needed from you right now.</p>'
    + '<a href="' + escHtml(PUBLIC_URL + '/signin') + '" style="display:inline-block;background:#741B24;color:#fff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Sign in to track it</a>';
  return { subject, text, html: mailShell(inner) };
}
function ticketReplyEmail(t, reply) {
  const link = PUBLIC_URL + '/signin?next=' + encodeURIComponent('/?ticket=' + t.id + '#contact');
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
function ticketOpenedEmail(t, autoReply) {
  const link = PUBLIC_URL + '/signin?next=' + encodeURIComponent('/?ticket=' + t.id + '#contact');
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
function signInEmail(code) {
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
function queueMail(db, opts) {
  if (!Array.isArray(db.outbox)) db.outbox = [];
  if (opts.key && db.outbox.some(m => m.key === opts.key && m.status !== 'failed')) return false;
  db.outbox.push({
    id: 'mail_' + crypto.randomBytes(9).toString('hex'),
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
  if (db.outbox.length > 1000) db.outbox = db.outbox.slice(-1000);
  return true;
}
function mailFromParts() {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(MAIL_FROM);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || 'Wigglesworth', email: m[2].trim() };
  // Apps Script uses the Google account as the sender, so MAIL_FROM can be a name only.
  if (!MAIL_FROM.includes('@')) return { name: MAIL_FROM || 'Wigglesworth', email: '' };
  return { name: 'Wigglesworth', email: MAIL_FROM };
}
async function sendMail(m) {
  const provider = mailProvider();
  if (!provider) return { ok: false, error: 'not_configured' };
  try {
    if (provider === 'apps_script') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const from = mailFromParts();
        const reply = MAIL_REPLY_TO ? (/<([^>]+)>/.exec(MAIL_REPLY_TO) || [null, MAIL_REPLY_TO])[1] : '';
        const r = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: APPS_SCRIPT_SECRET, to: m.to, subject: m.subject,
            text: m.text, html: m.html, fromName: from.name,
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
    if (provider === 'smtp') {
      const transport = getSmtpTransport();
      if (!transport) return { ok: false, error: 'not_configured' };
      const reply = MAIL_REPLY_TO ? (/<([^>]+)>/.exec(MAIL_REPLY_TO) || [null, MAIL_REPLY_TO])[1] : '';
      const info = await transport.sendMail({
        from: MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html,
        ...(reply ? { replyTo: reply } : {}),
      });
      return { ok: true, provider, id: info.messageId || '' };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let url, headers, body;
    if (provider === 'brevo') {
      const from = mailFromParts();
      const reply = MAIL_REPLY_TO ? /<([^>]+)>/.exec(MAIL_REPLY_TO) : null;
      url = 'https://api.brevo.com/v3/smtp/email';
      headers = { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
      body = {
        sender: from, to: [{ email: m.to }], subject: m.subject,
        htmlContent: m.html, textContent: m.text,
        ...(MAIL_REPLY_TO ? { replyTo: { email: reply ? reply[1] : MAIL_REPLY_TO } } : {}),
      };
    } else {
      url = 'https://api.resend.com/emails';
      headers = { Authorization: 'Bearer ' + MAIL_API_KEY, 'Content-Type': 'application/json' };
      body = {
        from: MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html,
        ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
      };
    }
    const r = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(timer);
    let detail = '';
    try { const j = await r.json(); detail = (j && (j.message || j.name || (j.error && (j.error.message || j.error)))) || ''; } catch {}
    if (!r.ok) { console.error('mail send failed', provider, r.status, detail); return { ok: false, error: (r.status + ' ' + detail).trim() }; }
    return { ok: true, provider };
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
}
let outboxBusy = false;
async function flushOutbox() {
  if (!mailConfigured() || outboxBusy) return;
  outboxBusy = true;
  try {
    for (let i = 0; i < 6; i++) {
      const db = loadDB();
      const m = (db.outbox || []).find(x => x.status === 'queued' && (x.attempts || 0) < 5);
      if (!m) break;
      const result = await sendMail(m);
      // Reload before writing so a concurrent request is not clobbered.
      const db2 = loadDB();
      const m2 = (db2.outbox || []).find(x => x.id === m.id);
      const quota = !result.ok && /quota|too many (times|emails)|daily limit|limit exceeded/i.test(result.error || '');
      if (m2) {
        if (!quota) m2.attempts = (m2.attempts || 0) + 1;
        if (result.ok) {
          m2.status = 'sent'; m2.sentAt = new Date().toISOString(); m2.error = '';
          // A decision is not notified until the email provider confirms success.
          if (m2.kind === 'decision' && m2.appId && m2.decisionStatus) {
            const application = (db2.submissions || []).find(x => x.appId === m2.appId);
            if (application && application.status === m2.decisionStatus) {
              application.notifiedStatus = m2.decisionStatus;
              application.notifiedAt = m2.sentAt;
            }
          }
          console.log('mail delivered to provider', m2.kind, m2.id, result.provider);
        }
        else { m2.status = (!quota && m2.attempts >= 5) ? 'failed' : 'queued'; m2.error = cleanStr(result.error, 200); }
        saveDB(db2);
      }
      if (!result.ok && result.error === 'not_configured') break;
      if (quota) break;
    }
  } catch (e) { console.error('outbox flush error', e.message); }
  finally { outboxBusy = false; }
}
function mailStats(db) {
  const out = db.outbox || [];
  const count = st => out.filter(m => m.status === st).length;
  return {
    configured: mailConfigured(), provider: mailProvider() || 'none', from: MAIL_FROM,
    queued: count('queued'), sent: count('sent'), failed: count('failed'),
  };
}
function queueDecisionEmail(db, s, force) {
  if (!s.email || s.emailUpdates === false) return false;
  if (!force && s.notifiedStatus === s.status) return false;
  // Avoid generating duplicate outstanding notifications for the same decision.
  if (!force && (db.outbox || []).some(m =>
    m.kind === 'decision' && m.appId === s.appId &&
    m.decisionStatus === s.status && m.status === 'queued')) return false;
  const mail = decisionEmail(db, s);
  const key = s.appId + ':' + s.status + ':' + Date.now();
  return queueMail(db, { ...mail, to: s.email, kind: 'decision',
    appId: s.appId, decisionStatus: s.status, key });

}
function queueReceiptEmail(db, s) {
  if (!s.email || s.emailUpdates === false) return false;
  const mail = receiptEmail(db, s);
  const ok = queueMail(db, { ...mail, to: s.email, kind: 'receipt', appId: s.appId, key: s.appId + ':receipt' });
  if (ok) s.receiptAt = new Date().toISOString();
  return ok;
}
function queueTicketReplyEmail(db, t, reply) {
  if (!t || !t.email || !reply) return false;
  const mail = ticketReplyEmail(t, reply);
  return queueMail(db, {
    ...mail, to: t.email, kind: 'ticket',
    key: 'ticket:' + t.id + ':' + (t.replies || []).length + ':' + (reply.at || Date.now()),
  });
}
function queueTicketOpenedEmail(db, t, autoReply) {
  if (!t || !t.email) return false;
  const mail = ticketOpenedEmail(t, autoReply);
  return queueMail(db, { ...mail, to: t.email, kind: 'ticket', key: 'ticket:' + t.id + ':opened' });
}

const FAQ_STOP = new Set('a,an,the,and,or,but,if,then,so,for,to,of,in,on,at,by,do,does,did,is,are,was,were,be,been,am,i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,our,their,what,when,where,who,whom,which,how,why,can,could,should,would,will,just,very,here,there,this,that,these,those,any,all,anyone,anybody,please,thanks,thank,hi,hello,hey,get,got,have,has,had'.split(','));
function faqMatch(text, faqs) {
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
function audit(db, act, id, req) {
  if (!Array.isArray(db.audit)) db.audit = [];
  let by = '';
  try { by = cleanStr(req && req.headers && req.headers['x-staff'], 40).replace(/[<>&"']/g, ''); } catch {}
  if (!by && req) {
    try { const acct = staffFromReq(req, db); if (acct) by = acct.username; } catch {}
  }
  db.audit.unshift({ t: new Date().toISOString(), act, id: cleanStr(id, 40), by });
  if (db.audit.length > 100) db.audit = db.audit.slice(0, 100);
}

// --- public ---
app.get('/api/config', configLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicConfig(loadDB()));
});

require('./staff-profiles').routes(app, { loadDB, saveDB, isAdmin, adminLimit, audit });

app.post('/api/applications', submitLimit, (req, res) => {
  const db = loadDB();
  const account = accountFromReq(req, db);
  if (!account) return res.status(401).json({ error: 'Sign in with your email before applying.' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const t = typeById(db, cleanStr(body.type, 40));
  if (!t) return res.status(400).json({ error: 'Pick a role first.' });
  if (t.open === false) return res.status(400).json({ error: t.name + ' applications are currently closed.' });
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  for (const q of t.questions) {
    const v = cleanStr(answers[q.id], 3000).trim();
    if (q.required && !v) return res.status(400).json({ error: 'Missing: ' + q.label });
    if (q.id === 'discordId' && v && !validDiscordId(v)) {
      return res.status(400).json({ error: 'Discord User ID must be the 17-20 digit number from Discord (not your username).' });
    }
    if ((q.id === 'why' || q.id === 'scenario' || q.id === 'bugscenario') && v.length < 20) {
      return res.status(400).json({ error: q.label + ' is too short.' });
    }
  }
  const email = account.email;
  const entry = {
    appId: genId(t.prefix), type: t.id, date: new Date().toISOString(),
    status: 'pending', adminNote: '', email,
    emailUpdates: body.emailUpdates !== false,
    accountId: account.id, notifiedStatus: '',
  };
  account.emailUpdates = entry.emailUpdates;
  const ids = new Set(t.questions.map(q => q.id));
  for (const q of db.config.applicationTypes.flatMap(x => x.questions)) {
    if (ids.has(q.id)) entry[q.id] = cleanStr(answers[q.id], 3000);
  }
  if (hasSlur(Object.values(entry).join(' '))) return res.status(400).json({ error: 'Submission rejected.' });
  db.submissions.push(entry);
  if (db.submissions.length > 5000) db.submissions = db.submissions.slice(-5000);
  queueReceiptEmail(db, entry);
  saveDB(db, { immediate: true });
  if (mailConfigured()) flushOutbox().catch(e => console.error('outbox error', e.message));
  res.json({
    appId: entry.appId, type: entry.type, successMessage: t.successMessage || '',
    email: entry.email, emailUpdates: entry.emailUpdates, mailConfigured: mailConfigured(),
  });
});

app.get('/api/status/:id', statusLimit, (req, res) => {
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const s = db.submissions.find(x => (x.appId || '').toUpperCase() === req.params.id.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Not found' });
  const t = typeById(db, s.type);
  res.json({ appId: s.appId, type: s.type, typeName: t ? t.name : s.type, date: s.date, status: s.status, adminNote: s.adminNote, who: displayName(s) });
});

app.get('/api/approved', statusLimit, (req, res) => {
  const db = loadDB();
  const only = cleanStr(req.query.type, 40);
  const out = [];
  for (const t of db.config.applicationTypes) {
    if (!db.config.showApproved || !t.showApproved) continue;
    if (only && only !== t.id) continue;
    db.submissions.filter(s => s.type === t.id && s.status === 'approved').reverse().slice(0, 100).forEach(s => {
      out.push({ type: t.id, typeName: t.name, date: s.date, username: displayName(s) });
    });
  }
  res.json(out.slice(0, 200));
});

// --- applicant accounts / sign-in -------------------------------------------
app.get('/api/account/meta', statusLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ mailConfigured: mailConfigured(), publicUrl: PUBLIC_URL });
});

app.get('/api/account/me', statusLimit, (req, res) => {
  const db = loadDB();
  const a = accountFromReq(req, db);
  if (!a) { clearAccountCookie(res); return res.status(401).json({ error: 'Not signed in' }); }
  res.set('Cache-Control', 'no-store');
  res.json(accountPayload(db, a));
});

// Step 1: email a 6-digit code. Always answers the same way so the endpoint
// cannot be used to discover which emails have accounts.
app.post('/api/account/request-code', accountLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const email = normEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!mailConfigured()) {
    return res.status(503).json({
      error: 'Email sign-in is not switched on yet. Use your Application ID below.',
      mailConfigured: false,
    });
  }
  const now = Date.now();
  db.loginCodes = (db.loginCodes || []).filter(c => c.exp > now);
  const last = db.loginCodes.filter(c => c.email === email).sort((a, b) => b.created - a.created)[0];
  if (last && now - last.created < 45000) return res.json({ ok: true, cooldown: true });
  // Only the newest code should work.
  db.loginCodes = db.loginCodes.filter(c => c.email !== email);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.loginCodes.push({ email, hash: hashCode(email, code), exp: now + 10 * 60 * 1000, tries: 0, created: now });
  if (db.loginCodes.length > 500) db.loginCodes = db.loginCodes.slice(-500);
  const mail = signInEmail(code);
  queueMail(db, { ...mail, to: email, kind: 'signin', key: 'signin:' + email + ':' + now });
  saveDB(db);
  flushOutbox().catch(e => console.error('outbox error', e.message));
  res.json({ ok: true });
});

// Step 2: exchange the code for a 30-day signed session cookie.
app.post('/api/account/verify-code', verifyLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const email = normEmail(req.body && req.body.email);
  const code = String((req.body && req.body.code) || '').replace(/\D/g, '').slice(0, 8);
  if (!email || code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  const now = Date.now();
  const rec = (db.loginCodes || [])
    .filter(c => c.email === email && c.exp > now)
    .sort((a, b) => b.created - a.created)[0];
  if (!rec) return res.status(400).json({ error: 'That code expired. Request a new one.' });
  if ((rec.tries || 0) >= 6) {
    db.loginCodes = db.loginCodes.filter(c => c !== rec);
    saveDB(db);
    return res.status(429).json({ error: 'Too many wrong attempts. Request a new code.' });
  }
  if (!safeEq(rec.hash, hashCode(email, code))) {
    rec.tries = (rec.tries || 0) + 1;
    saveDB(db);
    return res.status(400).json({ error: 'That code is not right. Check the email again.' });
  }
  db.loginCodes = (db.loginCodes || []).filter(c => c.email !== email);
  const a = ensureAccount(db, email);
  audit(db, 'account_login', a.id, req);
  saveDB(db);
  setAccountCookie(req, res, a.id);
  res.json({ ok: true, ...accountPayload(db, a) });
});

// Fallback that works even before email delivery is configured: prove the
// application belongs to you with the Application ID (already the status-check
// secret) plus the email it was submitted with.
app.post('/api/account/recover', recoverLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const email = normEmail(req.body && req.body.email);
  const appId = cleanStr(req.body && req.body.appId, 40).trim().toUpperCase();
  if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!validAppId(appId)) return res.status(400).json({ error: 'Enter a valid Application ID (e.g. MOD-ABC123).' });
  const s = db.submissions.find(x => (x.appId || '').toUpperCase() === appId);
  const mismatch = { error: 'Those details do not match an application.' };
  if (!s) return res.status(404).json(mismatch);
  const existing = normEmail(s.email);
  if (existing && existing !== email) return res.status(404).json(mismatch);
  if (!existing) { s.email = email; s.emailUpdates = s.emailUpdates !== false; }
  const a = ensureAccount(db, email);
  s.accountId = a.id;
  audit(db, 'account_recover', s.appId, req);
  saveDB(db);
  setAccountCookie(req, res, a.id);
  res.json({ ok: true, ...accountPayload(db, a) });
});

app.post('/api/account/link', recoverLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const a = accountFromReq(req, db);
  if (!a) return res.status(401).json({ error: 'Sign in first.' });
  const result = linkAppToAccount(db, a, req.body && req.body.appId);
  if (result.error) return res.status(400).json({ error: result.error });
  audit(db, 'account_link', result.app.appId, req);
  saveDB(db);
  res.json({ ok: true, ...accountPayload(db, a) });
});

app.post('/api/account/prefs', statusLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const a = accountFromReq(req, db);
  if (!a) return res.status(401).json({ error: 'Sign in first.' });
  a.emailUpdates = !!(req.body && req.body.emailUpdates);
  for (const s of db.submissions) {
    if (s.accountId === a.id || normEmail(s.email) === a.email) s.emailUpdates = a.emailUpdates;
  }
  saveDB(db);
  res.json({ ok: true, ...accountPayload(db, a) });
});

app.post('/api/account/signout', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  clearAccountCookie(res);
  res.json({ ok: true });
});

// --- staff sign-in (username + password) -----------------------------------
const STAFF_USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
function cleanUsername(v) {
  return String(v || '').trim().toLowerCase();
}
app.post('/api/staff/signin', staffLoginLimit, (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  const db = loadDB();
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const username = cleanUsername(b.username);
  const password = String(b.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  const acct = (db.staffAccounts || []).find(a =>
    a.active !== false && a.username === username);
  if (!acct || !verifyStaffPassword(acct, password)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  acct.lastLoginAt = new Date().toISOString();
  audit(db, 'staff_signin', acct.id, req);
  saveDB(db);
  setStaffCookie(req, res, acct.id);
  res.json({ ok: true, username: acct.username, role: acct.role });
});
app.post('/api/staff/signout', (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Bad origin' });
  clearStaffCookie(res);
  res.json({ ok: true });
});
app.get('/api/staff/session', (req, res) => {
  const db = loadDB();
  const acct = staffFromReq(req, db);
  if (!acct) return res.status(401).json({ error: 'Not signed in.' });
  res.set('Cache-Control', 'no-store');
  res.json({ staff: true, username: acct.username, role: acct.role });
});

// Owner-only staff management. The legacy edit code also counts as owner so the
// existing unlock flow keeps working.
function requireOwner(req, res, db) {
  if (!isAdmin(req, db)) { res.status(401).json({ error: 'Sign in first.' }); return false; }
  if (!staffOwner(req, db)) { res.status(403).json({ error: 'Only the owner can manage staff accounts.' }); return false; }
  return true;
}
app.get('/api/admin/staff', adminLimit, (req, res) => {
  const db = loadDB();
  if (!requireOwner(req, res, db)) return;
  res.json({ accounts: (db.staffAccounts || []).map(publicStaffAccount) });
});
app.post('/api/admin/staff', adminLimit, (req, res) => {
  const db = loadDB();
  if (!requireOwner(req, res, db)) return;
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const username = cleanUsername(b.username);
  const password = String(b.password || '');
  const role = cleanStaffRole(b.role);
  if (!STAFF_USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters: letters, numbers, _ . -' });
  }
  if (password.length < STAFF_MIN_PASSWORD) {
    return res.status(400).json({ error: 'Password must be at least ' + STAFF_MIN_PASSWORD + ' characters.' });
  }
  if ((db.staffAccounts || []).some(a => a.username === username)) {
    return res.status(409).json({ error: 'That username already exists.' });
  }
  const actor = staffFromReq(req, db);
  const acct = makeStaffAccount(username, password, role, actor ? actor.username : 'owner');
  db.staffAccounts.push(acct);
  audit(db, 'staff_account_add', acct.username, req);
  saveDB(db);
  res.json({ ok: true, account: publicStaffAccount(acct) });
});
app.post('/api/admin/staff/:id/password', adminLimit, (req, res) => {
  const db = loadDB();
  if (!requireOwner(req, res, db)) return;
  const acct = (db.staffAccounts || []).find(a => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'No such staff account.' });
  const password = String((req.body && req.body.password) || '');
  if (password.length < STAFF_MIN_PASSWORD) {
    return res.status(400).json({ error: 'Password must be at least ' + STAFF_MIN_PASSWORD + ' characters.' });
  }
  setStaffPassword(acct, password);
  audit(db, 'staff_account_password', acct.username, req);
  saveDB(db);
  res.json({ ok: true, account: publicStaffAccount(acct) });
});
app.post('/api/admin/staff/:id/role', adminLimit, (req, res) => {
  const db = loadDB();
  if (!requireOwner(req, res, db)) return;
  const acct = (db.staffAccounts || []).find(a => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'No such staff account.' });
  const role = String((req.body && req.body.role) || '');
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown access level.' });
  const owners = db.staffAccounts.filter(a => a.role === 'owner' && a.active !== false);
  if (acct.role === 'owner' && role !== 'owner' && owners.length <= 1) {
    return res.status(400).json({ error: 'Keep at least one owner account.' });
  }
  acct.role = role;
  audit(db, 'staff_account_role', acct.username, req);
  saveDB(db);
  res.json({ ok: true, account: publicStaffAccount(acct) });
});
app.delete('/api/admin/staff/:id', adminLimit, (req, res) => {
  const db = loadDB();
  if (!requireOwner(req, res, db)) return;
  const idx = (db.staffAccounts || []).findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No such staff account.' });
  const target = db.staffAccounts[idx];
  const owners = db.staffAccounts.filter(a => a.role === 'owner' && a.active !== false);
  if (target.role === 'owner' && owners.length <= 1) {
    return res.status(400).json({ error: 'Keep at least one owner account.' });
  }
  db.staffAccounts.splice(idx, 1);
  audit(db, 'staff_account_remove', target.username, req);
  saveDB(db);
  res.json({ ok: true });
});

// --- private tickets ---
app.post('/api/tickets', ticketLimit, (req, res) => {
  const db = loadDB();
  const account = accountFromReq(req, db);
  if (!account) return res.status(401).json({ error: 'Sign in with your email before opening a ticket.' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  let name = cleanStr(b.name, 80).trim();
  const subject = cleanStr(b.subject, 120).trim();
  const message = cleanStr(b.message, 3000).trim();
  if (!name) return res.status(400).json({ error: 'Add your name.' });
  if (!subject) return res.status(400).json({ error: 'Add a subject.' });
  if (message.length < 10) return res.status(400).json({ error: 'Message is too short.' });
  if (hasSlur(name + ' ' + subject + ' ' + message)) return res.status(400).json({ error: 'Message rejected.' });
  const t = {
    id: genId('TKT'), name, subject, status: 'open', unread: true,
    email: account.email, accountId: account.id,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    replies: [{ by: 'user', name, text: message, at: new Date().toISOString() }],
  };
  db.tickets.push(t);
  if (db.tickets.length > 2000) db.tickets = db.tickets.slice(-2000);
  let autoReply = null;
  const faqHit = faqMatch(subject + ' ' + message, db.config.faq);
  if (faqHit) {
    autoReply = { by: 'staff', name: 'Staff (auto)',
      text: `Quick answer from our FAQ:\n\n${faqHit.f.a}\n\nStill stuck? Just reply and a human will pick it up.`,
      at: new Date().toISOString() };
    t.replies.push(autoReply);
    audit(db, 'auto_faq', t.id, null);
  }
  const emailed = queueTicketOpenedEmail(db, t, autoReply);
  saveDB(db);
  if (emailed) flushOutbox().catch(e => console.error('outbox error', e.message));
  discordNotify(`New ticket **${t.id}** — ${t.subject}\nFrom **${t.name}**: ${t.replies[0].text.slice(0, 500)}`);
  res.json({ id: t.id, email: t.email, emailed, mailConfigured: mailConfigured() });
});

app.get('/api/tickets/:id', statusLimit, (req, res) => {
  if (!validTicketId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const account = accountFromReq(req, db);
  if (!account) return res.status(401).json({ error: 'Sign in to open your ticket.' });
  const t = db.tickets.find(x => (x.id || '').toUpperCase() === req.params.id.toUpperCase());
  if (!t || !ticketForAccount(t, account)) return res.status(404).json({ error: 'Not found' });
  claimTicketForAccount(db, t, account);
  res.json({ id: t.id, name: t.name, subject: t.subject, status: t.status,
             createdAt: t.createdAt, updatedAt: t.updatedAt, replies: t.replies });
});

app.post('/api/tickets/:id/reply', ticketLimit, (req, res) => {
  if (!validTicketId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const t = db.tickets.find(x => (x.id || '').toUpperCase() === req.params.id.toUpperCase());
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const staff = b.staff === true && isAdmin(req, db);
  if (b.staff === true && !staff) return res.status(401).json({ error: 'Unauthorized' });
  const account = accountFromReq(req, db);
  if (!staff) {
    if (!account) return res.status(401).json({ error: 'Sign in to reply to your ticket.' });
    if (!ticketForAccount(t, account)) return res.status(404).json({ error: 'Not found' });
    if (t.status !== 'open') return res.status(400).json({ error: 'This ticket is closed.' });
    claimTicketForAccount(db, t, account);
  }
  const text = cleanStr(b.text, 2000).trim();
  if (text.length < 1) return res.status(400).json({ error: 'Empty reply.' });
  if (!staff && hasSlur(text)) return res.status(400).json({ error: 'Reply rejected.' });
  if (t.replies.length >= 200) return res.status(400).json({ error: 'Thread is full.' });
  const name = staff ? 'Staff' : cleanStr(b.name || t.name, 80);
  const reply = { by: staff ? 'staff' : 'user', name, text, at: new Date().toISOString() };
  t.replies.push(reply);
  t.updatedAt = new Date().toISOString();
  t.unread = !staff;
  const emailed = staff ? queueTicketReplyEmail(db, t, reply) : false;
  if (staff) audit(db, 'ticket_reply', t.id, req);
  saveDB(db);
  if (emailed) flushOutbox().catch(e => console.error('outbox error', e.message));
  if (!staff) discordNotify(`Reply on ticket **${t.id}** (${t.subject}) from **${name}**:\n${text.slice(0, 500)}`);
  res.json({ ok: true, emailed, mailConfigured: mailConfigured() });
});

// AI-drafted staff reply (human reviews before sending — nothing auto-sends).
app.post('/api/admin/tickets/:id/suggest', aiLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!AI_API_KEY) return res.status(400).json({ error: 'AI not configured (set AI_API_KEY)' });
  if (!validTicketId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const t = db.tickets.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const thread = (t.replies || []).slice(-8)
    .map(m => `${m.by === 'staff' ? 'Staff' : 'Player'}: ${cleanText(m.text, 400)}`)
    .join('\n').slice(0, 2500);
  const roles = db.config.applicationTypes.map(x => x.name).join(', ');
  const faq = (db.config.faq || []).slice(0, 8)
    .map(f => `Q: ${f.q} A: ${f.a}`).join('\n').slice(0, 1200);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(aiBody([
        { role: 'system', content: 'You draft replies for Wigglesworth game community staff answering a player support ticket. Be short, warm and human. Never invent policies, links, dates or promises. If the answer is unknown, ask one clarifying question. Output ONLY the reply text, no quotes, no preamble.' },
        { role: 'user', content: `Ticket subject: ${t.subject}\nRoles offered: ${roles}\nKnown answers:\n${faq}\n\nThread so far:\n${thread}\n\nDraft the next staff reply:` },
      ], 0.3, 700)),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.error('ai suggest failed', r.status); return res.status(502).json({ error: 'AI unavailable' }); }
    const j = await r.json();
    const text = cleanText(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, 1500).trim();
    if (!text) return res.status(502).json({ error: 'AI unavailable' });
    res.json({ suggestion: text });
  } catch (e) { console.error('ai suggest error', e.message); res.status(502).json({ error: 'AI unavailable' }); }
});

app.get('/api/admin/tickets', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.tickets.slice().reverse().slice(0, 1000).map(t => ({
    id: t.id, name: t.name, subject: t.subject, status: t.status, unread: !!t.unread,
    email: t.email || '', accountId: t.accountId || '',
    createdAt: t.createdAt, updatedAt: t.updatedAt, replies: t.replies,
  })));
});

app.post('/api/admin/tickets/:id/status', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validTicketId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const t = db.tickets.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body || {};
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  t.status = status;
  t.updatedAt = new Date().toISOString();
  audit(db, 'ticket_' + status, t.id, req);
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/tickets/:id', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  db.tickets = db.tickets.filter(x => x.id !== req.params.id);
  audit(db, 'ticket_deleted', req.params.id, req);
  saveDB(db);
  res.json({ ok: true });
});
app.get('/api/admin/applications', adminLimit, (req, res) => {
  const db = loadDB();
  if (!canViewApplications(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.submissions.slice().reverse().slice(0, 1000));
});

function cleanLayout(l) {
  const out = {};
  if (!l || typeof l !== 'object') return out;
  // Keep saved positions for the larger set of copy targets exposed by design mode.
  for (const k of Object.keys(l).slice(0, 400)) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(k)) continue;
    const v = l[k] || {};
    const e = {};
    if (Number.isFinite(+v.dx)) e.dx = Math.min(2000, Math.max(-2000, Math.round(+v.dx)));
    if (Number.isFinite(+v.dy)) e.dy = Math.min(2000, Math.max(-2000, Math.round(+v.dy)));
    if (Number.isFinite(+v.fs)) e.fs = Math.min(96, Math.max(10, Math.round(+v.fs)));
    if (Number.isFinite(+v.rot)) e.rot = Math.min(180, Math.max(-180, Math.round(+v.rot)));
    if (Number.isFinite(+v.sx)) e.sx = Math.min(4, Math.max(0.2, Math.round(+v.sx * 100) / 100));
    if (Number.isFinite(+v.sy)) e.sy = Math.min(4, Math.max(0.2, Math.round(+v.sy * 100) / 100));
    if (v.hide === true) e.hide = true;
    if (typeof v.text === 'string' && v.text) e.text = cleanStr(v.text, 500);
    if (typeof v.orig === 'string' && v.orig) e.orig = cleanStr(v.orig, 500);
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}
function cleanQuestion(q, i) {  return {
    id: cleanStr(q.id || ('q' + i), 40).replace(/[^a-zA-Z0-9_-]/g, '') || ('q' + i),
    label: cleanStr(q.label, 200) || 'Question',
    type: ['text', 'number', 'textarea', 'select'].includes(q.type) ? q.type : 'text',
    placeholder: cleanStr(q.placeholder, 200),
    required: !!q.required,
    options: cleanStr(q.options, 500),
  };
}
function cleanType(t) {  return {
    id: cleanStr(t.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'role',
    name: cleanStr(t.name, 60) || 'Role',
    blurb: cleanStr(t.blurb, 160),
    prefix: cleanStr(t.prefix, 4).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'APP',
    intro: cleanStr(t.intro, 2000),
    successMessage: cleanStr(t.successMessage, 1000),
    showApproved: t.showApproved !== false,
    open: t.open !== false,
    questions: Array.isArray(t.questions) ? t.questions.slice(0, 40).map(cleanQuestion) : [],
  };
}

app.post('/api/admin/config', adminLimit, express.json({ limit: '8mb' }), (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const c = req.body || {};
  if (typeof c.title !== 'string' || !Array.isArray(c.applicationTypes) ||
      c.applicationTypes.length < 1 || c.applicationTypes.length > 5) {
    return res.status(400).json({ error: 'Bad config' });
  }
  const out = {
    // Profile edits use their own endpoint. A stale general editor must not erase them.
    staffProfiles: Array.isArray(db.config.staffProfiles) ? db.config.staffProfiles : [],
    title: cleanStr(c.title, 120) || 'WIGGLESWORTH',
    subtitle: cleanStr(c.subtitle, 300),
    announcement: cleanStr(c.announcement, 200),
    rules: cleanStr(c.rules, 3000),
    accent: /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#A62C35',
    bg: /^#[0-9a-fA-F]{6}$/.test(c.bg || '') ? c.bg : '#080809',
    editCode: cleanStr(c.editCode, 100) || db.config.editCode,
    showApproved: c.showApproved !== false,
    showBanner: c.showBanner === undefined ? db.config.showBanner === true : c.showBanner === true,
    approvedTitle: cleanStr(c.approvedTitle, 120),
    about: (() => {
      const a = c.about && typeof c.about === 'object' ? c.about : (db.config.about || DEFAULT_CONFIG.about);
      return Object.fromEntries(Object.keys(DEFAULT_CONFIG.about).map(k => [k,
        cleanStr(typeof a[k] === 'string' ? a[k] : (db.config.about?.[k] ?? DEFAULT_CONFIG.about[k]),
          k === 'lede' || k.startsWith('featureText') ? 500 : 120)
      ]));
    })(),
    copy: (() => {
      const source = c.copy && typeof c.copy === 'object' && !Array.isArray(c.copy) ? c.copy : (db.config.copy || {});
      const result = Object.create(null);
      for (const [key, value] of Object.entries(source).slice(0, 400)) {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key) || typeof value !== 'string') continue;
        result[key] = cleanStr(value, 1000);
      }
      return result;
    })(),
    bannerImage: cleanStr(c.bannerImage, 2000000),
    logoImage: cleanStr(c.logoImage, 2000000),
    backgroundImage: cleanStr(c.backgroundImage, 2000000),
    topText: cleanStr(c.topText, 8000),
    bottomText: cleanStr(c.bottomText, 8000),
    faq: Array.isArray(c.faq)
      ? c.faq.slice(0, 20).map(f => ({ q: cleanStr(f.q, 200), a: cleanStr(f.a, 1000) })).filter(f => f.q || f.a)
      : [],
    countdown: {
      show: !!(c.countdown && c.countdown.show),
      title: cleanStr(c.countdown && c.countdown.title, 120),
      endVideo: cleanStr(c.countdown && c.countdown.endVideo, 500),
      ambience: cleanStr(c.countdown && c.countdown.ambience, 500),
      daysLine: cleanStr(c.countdown && c.countdown.daysLine, 200) || 'day {d} left.',
      finalLine: cleanStr(c.countdown && c.countdown.finalLine, 200) || '{h}h {m}m {s}s left.',
      subLine: cleanStr(c.countdown && c.countdown.subLine, 200) || '{h}h {m}m {s}s to go',
      completedLine: cleanStr(c.countdown && c.countdown.completedLine, 200) || 'completed.',
      endCardLine: cleanStr(c.countdown && c.countdown.endCardLine, 200) || 'that was it.',
      soonLine: cleanStr(c.countdown && c.countdown.soonLine, 200) || 'soon.',
      target: (() => {
        const s = cleanStr(c.countdown && c.countdown.target, 40);
        const ms = Date.parse(s);
        return isNaN(ms) ? '' : new Date(ms).toISOString();
      })(),
    },
    layout: cleanLayout(c.layout),
    decor: Array.isArray(c.decor) ? c.decor.slice(0, 40).map(d => ({
      id: Number(d.id) || Date.now(),
      kind: d.kind === 'text' ? 'text' : 'img',
      src: cleanStr(d.src, 2000000),
      text: cleanStr(d.text, 200),
      color: /^#[0-9a-fA-F]{6}$/.test(d.color || '') ? d.color : '#ffffff',
      fontSize: Math.min(120, Math.max(12, Number(d.fontSize) || 28)),
      x: Math.min(95, Math.max(-5, Number(d.x) || 0)),
      y: Math.min(98, Math.max(0, Number(d.y) || 0)),
      w: Math.min(600, Math.max(30, Number(d.w) || 160)),
      r: Math.min(180, Math.max(-180, Number(d.r) || 0)),
      o: Math.min(1, Math.max(0.2, Number(d.o ?? 1))),
      z: Math.min(100, Math.max(1, Number(d.z) || 5)),
    })) : [],
    applicationTypes: c.applicationTypes.map(t => {
      const clean = cleanType(t);
      const old = db.config.applicationTypes.find(x => x.id === clean.id);
      // the public config hides successMessage, so an editor working from it
      // sends blanks — never let a blank wipe a real message
      if (old && old.successMessage && !clean.successMessage) clean.successMessage = old.successMessage;
      return clean;
    }),
  };
  if (ENV_EDIT_CODE) out.editCode = db.config.editCode;
  out.updatedAt = new Date().toISOString();
  db.config = out;
  audit(db, 'config_saved', '', req);
  saveDB(db, { immediate: true });
  res.json({ ok: true });
});

// One click: set the decision AND write a matching personal message.
// Nothing auto-sends to applicants beyond the note they already see;
// staff can still edit the note afterwards.
app.post('/api/admin/applications/:id/decision', aiLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { decision } = req.body || {};
  if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'Bad decision' });
  if (!AI_API_KEY) return res.status(400).json({ error: 'AI not configured (set AI_API_KEY)' });
  const t = typeById(db, s.type);
  const answers = (t ? t.questions : []).map(q => `${q.label}: ${cleanText(s[q.id], 500)}`).join('\n').slice(0, 2500);
  const verdict = decision === 'approved'
    ? 'Write a warm acceptance: congratulate them by name, mention one specific thing from their answers that stood out, tell them staff will reach out with next steps. Keep it short.'
    : 'Write a kind rejection: thank them for applying, give ONE general encouragement (gain experience, reapply later), never be harsh, never invent specific reasons. Keep it short.';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(aiBody([
        { role: 'system', content: 'You write decision messages for Wigglesworth community staff to applicants. Warm, human, concise. Never invent links, dates, usernames or promises. Output ONLY the message text, no quotes, no preamble.' },
        { role: 'user', content: `Role applied for: ${t ? t.name : s.type}\nApplicant: ${displayName(s)}\n\nTheir answers:\n${answers}\n\n${verdict}` },
      ], 0.5, 700)),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.error('ai decision failed', r.status); return res.status(502).json({ error: 'AI unavailable' }); }
    const j = await r.json();
    const note = cleanText(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, 1500).trim();
    if (!note) return res.status(502).json({ error: 'AI unavailable' });
    s.status = decision;
    s.adminNote = note;
    s.updatedAt = new Date().toISOString();
    let role = null;
    let announce = null;
    if (decision === 'approved') {
      role = await grantRoleForSubmission(s);
      audit(db, role.assigned ? 'role_assigned' : 'role_failed', s.appId, req);
      announce = await announceAcceptance(s).catch(e => {
        console.error('accept announce error', e.message);
        return { posted: false, error: e.message };
      });
    }
    const emailed = queueDecisionEmail(db, s);
    audit(db, 'ai_' + decision, s.appId, req);
    saveDB(db, { immediate: true });
    if (emailed) flushOutbox().catch(e => console.error('outbox error', e.message));
    res.json({ ok: true, emailed, mailConfigured: mailConfigured(), role, announce });
  } catch (e) { console.error('ai decision error', e.message); res.status(502).json({ error: 'AI unavailable' }); }
});

// One-click triage summary so staff can skim an application instead of reading every answer.
// Stored on the submission (one AI call per application; "Re-summarize" overwrites it).
app.post('/api/admin/applications/:id/summarize', aiLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (!AI_API_KEY) return res.status(400).json({ error: 'AI not configured (set AI_API_KEY)' });
  const t = typeById(db, s.type);
  const answers = (t ? t.questions : []).map(q => `${q.label}: ${cleanText(s[q.id], 600)}`).join('\n').slice(0, 3000);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(aiBody([
        { role: 'system', content: 'You help Wigglesworth community staff triage applications fast. Summarize the applicant\'s answers so staff can decide without reading everything. Be factual, compact and neutral; never invent details; briefly note anything important that is missing. Output plain text only, exactly this shape:\nVerdict: (Strong / Good / Mixed / Weak) - one short sentence\n- Wants to join: ...\n- Experience: ...\n- Availability: ...\n- Watch-outs: ...\nKeep every line under 25 words. No preamble, no extra sections.' },
        { role: 'user', content: `Role applied for: ${t ? t.name : s.type}\nApplicant: ${displayName(s)}\n\nTheir answers:\n${answers}\n\nWrite the summary now.` },
      ], 0.2, 700)),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.error('ai summarize failed', r.status); return res.status(502).json({ error: 'AI unavailable' }); }
    const j = await r.json();
    const summary = cleanText(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, 1200).trim();
    if (!summary) return res.status(502).json({ error: 'AI unavailable' });
    s.aiSummary = summary;
    s.aiSummaryAt = new Date().toISOString();
    audit(db, 'ai_summary', s.appId, req);
    saveDB(db);
    res.json({ summary, at: s.aiSummaryAt });
  } catch (e) { console.error('ai summarize error', e.message); res.status(502).json({ error: 'AI unavailable' }); }
});

// Tiny admin-only AI diagnostic: shows what the provider actually answers.
app.post('/api/admin/ai-check', aiLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!AI_API_KEY) return res.status(400).json({ error: 'AI not configured (set AI_API_KEY)' });
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(aiBody([{ role: 'user', content: 'Reply with the single word: ping' }], 0, 100)),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const body = (await r.text()).slice(0, 1500);
    res.json({ ok: r.ok, status: r.status, base: AI_BASE_URL, model: AI_MODEL, body });
  } catch (e) { res.status(502).json({ error: 'Request failed: ' + e.message }); }
});

app.post('/api/admin/applications/:id/status', adminLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { status, adminNote, email, discordId } = req.body || {};
  const before = s.status;
  if (discordId !== undefined && String(discordId).trim() !== '') {
    const id = String(discordId).replace(/\D/g, '');
    if (!validDiscordId(id)) return res.status(400).json({ error: 'Discord User ID must be the 17-20 digit number from Discord.' });
    s.discordId = id;
  }
  if (status !== undefined) {
    if (!['pending', 'approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    s.status = status;
  }
  if (adminNote !== undefined) s.adminNote = cleanStr(adminNote, 2000);
  if (email !== undefined && String(email).trim() !== '') {
    const em = normEmail(email);
    if (!em) return res.status(400).json({ error: 'Enter a valid applicant email.' });
    if (em !== s.email) { s.email = em; s.notifiedStatus = ''; }
  }
  let role = null;
  let announce = null;
  if (s.status === 'approved') {
    role = await grantRoleForSubmission(s);
    audit(db, role.assigned ? 'role_assigned' : 'role_failed', s.appId, req);
    announce = await announceAcceptance(s).catch(e => {
      console.error('accept announce error', e.message);
      return { posted: false, error: e.message };
    });
  }
  let emailed = false;
  if (s.status !== before && (s.status === 'approved' || s.status === 'denied')) {
    emailed = queueDecisionEmail(db, s);
  }
  s.updatedAt = new Date().toISOString();
  audit(db, 'status_' + s.status, s.appId, req);
  saveDB(db, { immediate: true });
  if (emailed) flushOutbox().catch(e => console.error('outbox error', e.message));
  res.json({ ok: true, emailed, mailConfigured: mailConfigured(), role, announce });
});

// Retry the Discord role without changing the decision. Useful when the member
// had not joined yet or the bot permissions were wrong at approval time.
app.post('/api/admin/applications/:id/role', adminLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.status !== 'approved') return res.status(400).json({ error: 'Approve the application first.' });
  if (req.body && req.body.discordId !== undefined && String(req.body.discordId).trim() !== '') {
    const id = String(req.body.discordId).replace(/\D/g, '');
    if (!validDiscordId(id)) return res.status(400).json({ error: 'Discord User ID must be the 17-20 digit number from Discord.' });
    s.discordId = id;
  }
  const role = await grantRoleForSubmission(s, { force: true });
  audit(db, role.assigned ? 'role_assigned' : 'role_failed', s.appId, req);
  // Also retries the congratulations post if it never went out.
  const announce = await announceAcceptance(s).catch(e => {
    console.error('accept announce error', e.message);
    return { posted: false, error: e.message };
  });
  s.updatedAt = new Date().toISOString();
  saveDB(db, { immediate: true });
  res.json({ ok: true, role, announce });
});

// Force a fresh decision email (e.g. staff changed the note after deciding).
app.post('/api/admin/applications/:id/notify', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (!s.email) return res.status(400).json({ error: 'This application has no email on file.' });
  if (!['approved', 'denied'].includes(s.status)) return res.status(400).json({ error: 'Decide the application first.' });
  if (!mailConfigured()) return res.status(400).json({ error: 'Email delivery is not configured. Set APPS_SCRIPT_URL + APPS_SCRIPT_SECRET, SMTP_USER + SMTP_PASS, RESEND_API_KEY, or BREVO_API_KEY, plus MAIL_FROM.' });
  const queued = queueDecisionEmail(db, s, true);
  audit(db, 'decision_email', s.appId, req);
  saveDB(db);
  if (queued) flushOutbox().catch(e => console.error('outbox error', e.message));
  res.json({ ok: true, queued });
});

app.delete('/api/admin/applications/:id', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  db.submissions = db.submissions.filter(x => x.appId !== req.params.id);
  audit(db, 'deleted', req.params.id, req);
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/applications', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const only = cleanStr(req.query.type, 40);
  db.submissions = only ? db.submissions.filter(x => x.type !== only) : [];
  audit(db, 'cleared' + (only ? '_' + only : '_all'), '', req);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/reset', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const keepCode = db.config.editCode;
  db.config = structuredClone(DEFAULT_CONFIG);
  db.config.editCode = keepCode;
  audit(db, 'reset', '', req);
  saveDB(db);
  res.json(publicConfig(db));
});

app.get('/api/admin/backup', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json({
    version: 1, exportedAt: new Date().toISOString(), config: db.config,
    submissions: db.submissions, tickets: db.tickets || [], reports: db.reports || [],
    accounts: db.accounts || [],
  });
});

app.post('/api/admin/restore', adminLimit, express.json({ limit: '25mb' }), (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const b = req.body || {};
  if (!b.config || !Array.isArray(b.config.applicationTypes) || !Array.isArray(b.submissions)) {
    return res.status(400).json({ error: 'Bad backup file' });
  }
  const keepCode = db.config.editCode;
  db.config = b.config;
  if (ENV_EDIT_CODE) db.config.editCode = keepCode;
  if (!db.config.editCode) db.config.editCode = keepCode;
  db.submissions = b.submissions.filter(s => s && typeof s.appId === 'string').slice(-5000);
  if (Array.isArray(b.tickets)) {
    db.tickets = b.tickets.filter(t => t && typeof t.id === 'string' && Array.isArray(t.replies)).slice(-2000);
  }
  if (Array.isArray(b.reports)) {
    db.reports = b.reports.filter(r => r && typeof r.id === 'string').slice(-2000);
  }
  if (Array.isArray(b.accounts)) {
    db.accounts = b.accounts
      .filter(a => a && typeof a.id === 'string' && typeof a.email === 'string')
      .slice(-5000);
  }
  audit(db, 'restored', String(db.submissions.length), req);
  saveDB(db, { immediate: true });
  res.json({ ok: true, submissions: db.submissions.length });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/admin/sync', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({
    github: !!GH_TOKEN, repo: GH_REPO, branch: GH_BRANCH, dataBranch: GH_DATA_BRANCH,
    discord: !!DISCORD_WEBHOOK_URL, ai: !!AI_API_KEY, mail: mailStats(db),
  });
});

app.post('/api/admin/mail/test', adminLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const to = normEmail(req.body && req.body.to);
  if (!to) return res.status(400).json({ error: 'Enter a valid destination email.' });
  if (!mailConfigured()) {
    return res.status(400).json({ error: 'Email delivery is not configured. Set APPS_SCRIPT_URL + APPS_SCRIPT_SECRET, SMTP_USER + SMTP_PASS, RESEND_API_KEY, or BREVO_API_KEY, plus MAIL_FROM on Render.', mailConfigured: false });
  }
  const html = mailShell('<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 16px;color:#F1ECE6">Email test</h1>'
    + '<p style="margin:0 0 12px">This is a test from the Wigglesworth applications site.</p>'
    + '<p style="margin:0;color:#AAA5A0;font-size:13px">If you can read this, decision emails will deliver the same way.</p>');
  const result = await sendMail({
    to, subject: 'Wigglesworth email test',
    text: 'This is a test from the Wigglesworth applications site. Decision emails will deliver the same way.',
    html,
  });
  if (!result.ok) return res.status(502).json({ error: 'Send failed: ' + result.error });
  res.json({ ok: true, from: MAIL_FROM });
});

app.get('/api/admin/config', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.config);
});

app.post('/api/admin/upload-video', uploadLimit, express.raw({ type: ['video/*', 'audio/*'], limit: '60mb' }), async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const buf = req.body;
  if (!buf || !buf.length) return res.status(400).json({ error: 'Empty file' });
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const audioCt = ct.startsWith('audio/');
  const isMp4 = buf.length > 12 && buf.subarray(4, 8).toString() === 'ftyp';
  const isWebm = buf.length > 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
  const isMp3 = buf.length > 3 && (buf.subarray(0, 3).toString() === 'ID3' || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0));
  const isWav = buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE';
  const isOgg = buf.length > 4 && buf.subarray(0, 4).toString() === 'OggS';
  let ext = '';
  if (isMp4) ext = audioCt ? 'm4a' : 'mp4';
  else if (isWebm && (ct === 'video/webm' || ct === 'audio/webm')) ext = 'webm';
  else if (isMp3 && audioCt) ext = 'mp3';
  else if (isWav && audioCt) ext = 'wav';
  else if (isOgg && (ct === 'audio/ogg' || ct === 'video/ogg')) ext = 'ogg';
  if (!ext) {
    return res.status(400).json({ error: 'Not a real video/audio file' });
  }
  if (!GH_TOKEN) return res.status(400).json({ error: 'GitHub sync not configured' });
  const name = 'vids/' + Date.now().toString(36) + '-' + crypto.randomInt(46656).toString(36) + '.' + ext;
  try {
    const api = `${GITHUB_API_BASE}/repos/${GH_CD_REPO}/contents/${name}`;
    const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
    const put = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'upload teaser ' + name, content: buf.toString('base64'), branch: GH_BRANCH }) });
    if (!put.ok) { console.error('video store failed', put.status); return res.status(502).json({ error: 'Video store failed' }); }
  } catch (e) { console.error('video store error', e.message); return res.status(502).json({ error: 'Video store failed' }); }
  audit(db, 'video_upload', name, req);
  saveDB(db);
  res.json({ url: `${COUNTDOWN_PUBLIC_URL}/${name}`, rawUrl: `https://raw.githubusercontent.com/${GH_CD_REPO}/${GH_BRANCH}/${name}` });
});

function detectImage(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (/^GIF8[79]a/.test(buf.subarray(0, 6).toString())) return 'gif';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return '';
}

// --- staff reports (public submit, staff-only review) ---
app.post('/api/report-evidence', evidenceLimit, express.raw({ type: ['image/*', 'video/*'], limit: '12mb' }), async (req, res) => {
  const buf = req.body;
  if (!buf || !buf.length) return res.status(400).json({ error: 'Empty file' });
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let ext = detectImage(buf);
  if (!ext) {
    const isMp4 = buf.length > 12 && buf.subarray(4, 8).toString() === 'ftyp';
    const isWebm = buf.length > 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
    if (isMp4 && ct.startsWith('video/')) ext = 'mp4';
    else if (isWebm && ct === 'video/webm') ext = 'webm';
  }
  if (!ext) return res.status(400).json({ error: 'Only pictures or short videos' });
  const name = 'ev-' + Date.now().toString(36) + '-' + crypto.randomInt(46656).toString(36) + '.' + ext;
  try { fs.writeFileSync(path.join(EVIDENCE_DIR, name), buf); }
  catch { return res.status(500).json({ error: 'Store failed' }); }
  res.json({ url: '/evidence/' + name });
  if (GH_TOKEN) githubPutFile(GH_REPO, 'evidence/' + name, buf, 'store report evidence ' + name);
});

app.post('/api/reports', ticketLimit, (req, res) => {
  const db = loadDB();
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const reporter = cleanStr(b.reporter, 80).trim();
  const staffName = cleanStr(b.staffName, 80).trim();
  const details = cleanStr(b.details, 3000).trim();
  const files = Array.isArray(b.files)
    ? b.files.slice(0, 3).map(f => cleanStr(f, 300)).filter(f => /^\/evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(f))
    : [];
  if (!staffName) return res.status(400).json({ error: 'Name the staff member.' });
  if (details.length < 20) return res.status(400).json({ error: 'Describe what happened (20+ characters).' });
  if (hasSlur(staffName + ' ' + details)) return res.status(400).json({ error: 'Submission rejected.' });
  const r = {
    id: genId('RPT'), reporter, staffName, details, files,
    status: 'open', adminNote: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.reports.push(r);
  if (db.reports.length > 2000) db.reports = db.reports.slice(-2000);
  saveDB(db);
  discordNotify(`New staff report **${r.id}** against **${staffName}** from **${reporter || 'Anonymous'}** (${files.length} file${files.length === 1 ? '' : 's'})`);
  res.json({ id: r.id });
});

app.get('/api/admin/reports', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.reports.slice().reverse().slice(0, 1000));
});

app.post('/api/admin/reports/:id/status', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validReportId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const r = db.reports.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { status, adminNote } = req.body || {};
  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    r.status = status;
    r.updatedAt = new Date().toISOString();
  }
  if (adminNote !== undefined) r.adminNote = cleanStr(adminNote, 2000);
  audit(db, 'report_' + r.status, r.id, req);
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/reports/:id', adminLimit, async (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const r = db.reports.find(x => x.id === req.params.id);
  db.reports = db.reports.filter(x => x.id !== req.params.id);
  audit(db, 'report_deleted', req.params.id, req);
  saveDB(db);
  if (r && GH_TOKEN) {
    for (const f of r.files || []) {
      const fp = 'evidence/' + path.basename(f);
      if (!/^evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(fp)) continue;
      try {
        const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
        const g = await fetch(`${GITHUB_API_BASE}/repos/${GH_REPO}/contents/${fp}?ref=${GH_BRANCH}`, { headers: H });
        if (!g.ok) continue;
        const sha = (await g.json()).sha;
        await fetch(`${GITHUB_API_BASE}/repos/${GH_REPO}/contents/${fp}`, { method: 'DELETE',
          headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'remove report evidence ' + fp, sha, branch: GH_BRANCH }) });
      } catch (e) { console.error('evidence delete error', e.message); }
    }
  }
  res.json({ ok: true });
});

app.get('/api/admin/audit', adminLimit, (req, res) => {  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json((db.audit || []).slice(0, 50));
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Too big (60MB max)' });
  next(err);
});

// Anonymous client diagnostics: what real browsers actually render.
// No IPs, no tokens, no identities — just build + visibility flags.
app.post('/api/clientlog', diagLimit, (req, res) => {
  const db = loadDB();
  if (!db.diag || !Array.isArray(db.diag)) db.diag = [];
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  db.diag.unshift({
    t: new Date().toISOString(),
    build: cleanStr(b.build, 20),
    hero: !!b.hero, gated: !!b.gated, token: !!b.token, failed: !!b.failed,
    ua: cleanStr(req.headers['user-agent'], 120),
  });
  if (db.diag.length > 50) db.diag = db.diag.slice(0, 50);
  saveDB(db);
  res.json({ ok: true });
});

// Render's local filesystem is ephemeral, so boot pulls the GitHub backup.
// The backup is MERGED into the local copy, never pasted over it: whichever
// side is stale can then only add records, never delete recent applications.
// A slow/failed GitHub read is retried in the background — and pushes refuse
// to run while a backup cannot be read, so a stale file cannot clobber it.
let hydrateRetryTimer = null;
async function hydrateProductionData() {
  if (!GH_TOKEN || process.env.PREVIEW_MODE === '1') return { skipped: true, added: 0 };
  let source = '';
  let remote = null;
  const primary = await readGitHubData(GH_DATA_BRANCH);
  if (!primary.missing && primary.data) { remote = primary.data; source = GH_DATA_BRANCH; }
  if (!remote) {
    // First boot after switching to the backup branch: fall back to `main`.
    const fallback = await readGitHubData(GH_BRANCH);
    if (!fallback.missing && fallback.data) { remote = fallback.data; source = GH_BRANCH; }
  }
  if (!remote) {
    console.log('No GitHub data backup found yet; starting from the local file');
    return { skipped: true, added: 0 };
  }
  if (!remote || typeof remote !== 'object'
      || !Array.isArray(remote.submissions)
      || !remote.config || typeof remote.config !== 'object') {
    throw new Error('GitHub database backup has unexpected shape');
  }
  const local = loadDB();
  const before = (local.submissions || []).length;
  const merged = normalizeDB(mergeDatabases(remote, local));
  writeDBFile(merged);
  cachedDB = merged;
  dbLoaded = true;
  const added = merged.submissions.length - before;
  // Applications that exist here but not in the backup also need a push, or
  // the next restart would only recover them again from this ephemeral disk.
  const remoteIds = new Set((remote.submissions || []).map(s => mergeKey(s, 'appId')));
  const onlyLocal = (local.submissions || []).filter(s => {
    const k = mergeKey(s, 'appId');
    return k && !remoteIds.has(k);
  }).length;
  console.log(`Restored application data from GitHub backup (${source}): `
    + `${merged.submissions.length} applications`
    + (added > 0 ? `, ${added} recovered from the backup` : '')
    + (onlyLocal > 0 ? `, ${onlyLocal} backed up now` : ''));
  if (added > 0 || onlyLocal > 0) scheduleGitHubBackup(true);
  return { skipped: false, added, onlyLocal };
}
function scheduleHydrateRetry(delay = 20_000) {
  if (hydrateRetryTimer) return;
  hydrateRetryTimer = setTimeout(async () => {
    hydrateRetryTimer = null;
    try {
      await hydrateProductionData();
      console.log('GitHub database restore recovered after a retry');
    } catch (error) {
      console.error('GitHub database restore retry failed:', error.message);
      scheduleHydrateRetry(Math.min(delay * 2, 5 * 60 * 1000));
    }
  }, delay);
  if (hydrateRetryTimer.unref) hydrateRetryTimer.unref();
}
async function startServer() {
  try { await hydrateProductionData(); }
  catch (error) {
    console.error('GitHub database restore unsuccessful; using local file:', error.message);
    scheduleHydrateRetry();
  }
  app.listen(PORT, HOST, () => {
  console.log(`Moderator site on http://${HOST}:${PORT} (bound to ${HOST} only — home IP not exposed)`);
  console.log(`Data backups: ${GH_TOKEN
    ? `ON (branch ${GH_DATA_BRANCH}, debounce ${Math.round(GH_BACKUP_INTERVAL_MS / 1000)}s)`
    : 'OFF (set GITHUB_TOKEN)'}`);
  console.log(`Discord ticket alerts: ${DISCORD_WEBHOOK_URL ? 'ON' : 'OFF (set DISCORD_WEBHOOK_URL)'}`);
  console.log(`Discord role sync: ${discordRoleConfigured()
    ? 'ON (guild ' + DISCORD_GUILD_ID + ')'
    : 'OFF (set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID)'}`);
  console.log(`Discord accept ping: ${DISCORD_ACCEPT_CHANNEL
    ? 'ON (moderator approvals -> channel ' + DISCORD_ACCEPT_CHANNEL + ')'
    : 'OFF (set DISCORD_ACCEPT_CHANNEL to a channel ID)'}`);
  console.log(`Applicant email: ${mailConfigured() ? 'ON via ' + mailProvider() + ' (' + MAIL_FROM + ')' : 'OFF (set APPS_SCRIPT_URL + APPS_SCRIPT_SECRET, SMTP_USER + SMTP_PASS, or RESEND_API_KEY / BREVO_API_KEY + MAIL_FROM; mail is queued)'}`);
  // Retry anything queued while the service was asleep, then periodically.
  setTimeout(() => flushOutbox().catch(e => console.error('outbox error', e.message)), 4000);
  setInterval(() => flushOutbox().catch(e => console.error('outbox error', e.message)), 5 * 60 * 1000).unref();
  });
}
startServer().catch(error => { console.error('startup error', error); process.exitCode = 1; });
