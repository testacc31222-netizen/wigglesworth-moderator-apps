const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
const DATA_FILE = path.join(__dirname, 'data.live.json');
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
const GH_PATH = 'data.live.json';
// Teaser uploads land in the countdown repo so the static site can serve them.
const GH_CD_REPO = process.env.GITHUB_COUNTDOWN_REPO || 'testacc31222-netizen/wigglesworth-countdown';
const COUNTDOWN_PUBLIC_URL = (process.env.COUNTDOWN_PUBLIC_URL || 'https://wigglesworth-countdown.onrender.com').replace(/\/$/, '');
// Discord staff alerts (ticket created + user replies). URL stays server-side.
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const DISCORD_PING_ID = (process.env.DISCORD_PING_ID || '').replace(/\D/g, '');

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

async function pushToGitHub() {
  if (!GH_TOKEN) return;
  try {
    const api = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
    const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
    let sha = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const g = await fetch(`${api}?ref=${GH_BRANCH}`, { headers: H });
        if (g.ok) sha = (await g.json()).sha;
        else if (g.status !== 404) { console.error('gh read failed', g.status); return; }
      } catch (e) { console.error('gh read error', e.message); return; }
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      if (Buffer.byteLength(content) > 40_000_000) { console.error('gh backup too large, skip'); return; }
      const put = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'autosave site data', content: Buffer.from(content).toString('base64'), sha: sha || undefined, branch: GH_BRANCH }) });
      if (put.ok) return;
      if (put.status === 422) { sha = null; continue; } // sha race: refetch and retry once
      console.error('gh backup failed', put.status);
      return;
    }
  } catch (e) { console.error('gh backup error', e.message); }
}
const ENV_EDIT_CODE = process.env.EDIT_CODE || '';

app.use(helmet({
  contentSecurityPolicy: {
    // NOTE: no script-src-attr directive on purpose — the UI uses inline
    // onclick handlers, and helmet's default ('none') would disable them all.
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', setHeaders(res, filePath) {
  if (filePath.endsWith('index.html') || filePath.endsWith('app.js')) res.set('Cache-Control', 'no-store');
} }));

const general = rateLimit({ windowMs: 60 * 1000, max: 120 });
const submitLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: { error: 'Too many applications, try again later.' } });
const adminLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: { error: 'Too many attempts, slow down.' } });
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
const configLimit = rateLimit({ windowMs: 60 * 1000, max: 40 });
const ticketLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: { error: 'Too many tickets, try again later.' } });
const aiLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'AI limit reached, try later.' } });
// Optional AI drafts (Groq free tier works): set AI_API_KEY (+AI_BASE_URL, AI_MODEL).
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-oss-20b';
function cleanText(v, max = 2000) {
  return String(v ?? '').replace(/[^\S\n\t ]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}
const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Too many uploads, try later.' } });
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
      Q('discord', 'Discord Username', 'text', 'Your Discord name', true),
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
      Q('discord', 'Discord Username', 'text', 'Your Discord name', true),
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
      Q('discord', 'Discord Username', 'text', 'Your Discord name', true),
      Q('age', 'Age', 'number', 'e.g. 16', true),
      Q('languages', 'Languages / Engines You Use', 'text', 'e.g. Luau, JS, Unity', true),
      Q('portfolio', 'Portfolio, GitHub, or Past Work Link', 'text', 'Paste the link', true),
      Q('experience', 'Development Experience', 'textarea', 'What have you built?', true),
      Q('why', 'Why build for Wigglesworth?', 'textarea', 'Give detail', true),
      Q('bugscenario', 'A game-breaking bug appears an hour before an event. What do you do?', 'textarea', 'Explain step-by-step', true),
      Q('teamwork', 'Do you prefer solo or team work?', 'text', 'Either is fine', false),
    ],
  },
  {
    id: 'event', name: 'Event Hoster', prefix: 'EVT',
    blurb: 'Run game nights, tournaments, and community events.',
    intro: 'Event Hosters run the fun stuff. Show us you can hype a crowd and handle chaos.',
    successMessage: 'Thanks! Your event hoster application was received. Save your Application ID and check your decision below.',
    showApproved: true,
    open: true,
    questions: [
      Q('username', 'In-game Username', 'text', 'Your username', true),
      Q('discord', 'Discord Username', 'text', 'Your Discord name', true),
      Q('age', 'Age', 'number', 'e.g. 16', true),
      Q('timezone', 'Timezone / Availability', 'text', 'e.g. EST, weekends', true),
      Q('experience', 'Any hosting experience?', 'textarea', 'Events run before, or write None', true),
      Q('eventidea', 'Describe an event you would host', 'textarea', 'Game, format, how it runs', true),
      Q('chaos', '30 players show up and the game breaks mid-event. What do you do?', 'textarea', 'Explain step-by-step', true),
      Q('reliable', 'Can you commit to a regular slot?', 'text', 'e.g. Saturdays 5pm EST', true),
    ],
  },
];

const DEFAULT_CONFIG = {
  title: 'Wigglesworth — Join the Team',
  subtitle: 'Four ways in. Pick the role that fits you and send one honest application.',
  announcement: 'Applications are OPEN',
  rules: '• Must be 13+\n• One role per application — pick the closest fit\n• Be honest — lying = instant deny\n• Spamming applications = blacklist',
  accent: '#6cb8f0', bg: '#0e1218',
  editCode: 'MOD123',
  showApproved: true, approvedTitle: 'New team members',
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

function loadDB() {
  let db;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(raw);
  } catch {
    db = null;
  }
  if (!db || typeof db !== 'object') return { config: structuredClone(DEFAULT_CONFIG), submissions: [], tickets: [], audit: [] };
  if (!db.config || typeof db.config !== 'object') db.config = structuredClone(DEFAULT_CONFIG);
  if (!Array.isArray(db.submissions)) db.submissions = [];
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
  if (!Array.isArray(db.tickets)) db.tickets = [];
  // fixups for DBs saved before these fields existed
  for (const t of db.config.applicationTypes) if (t.open === undefined) t.open = true;
  if (!db.config.applicationTypes.some(t => t.id === 'event')) {
    db.config.applicationTypes.push(structuredClone(DEFAULT_TYPES.find(t => t.id === 'event')));
  }
  if (!Array.isArray(db.config.faq)) db.config.faq = structuredClone(DEFAULT_CONFIG.faq);
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
  if (db.config.accent === '#6366f1') db.config.accent = '#6cb8f0';
  if (db.config.bg === '#080a12') db.config.bg = '#0e1218';
  return db;
}
function saveDB(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  // persist off the ephemeral disk; never fail the request over it
  if (GH_TOKEN) pushToGitHub().catch(e => console.error('gh backup error', e.message));
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
function isAdmin(req, db) {
  const got = req.headers['x-edit-code'];
  if (!got) return false;
  return safeEq(got, effectiveCode(db));
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
function displayName(s) {
  return cleanStr(s.username || s.discord || 'Applicant', 80);
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
  db.audit.unshift({ t: new Date().toISOString(), act, id: cleanStr(id, 40), by });
  if (db.audit.length > 100) db.audit = db.audit.slice(0, 100);
}

// --- public ---
app.get('/api/config', configLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicConfig(loadDB()));
});

app.post('/api/applications', submitLimit, (req, res) => {
  const db = loadDB();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const t = typeById(db, cleanStr(body.type, 40));
  if (!t) return res.status(400).json({ error: 'Pick a role first.' });
  if (t.open === false) return res.status(400).json({ error: t.name + ' applications are currently closed.' });
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  for (const q of t.questions) {
    const v = cleanStr(answers[q.id], 3000).trim();
    if (q.required && !v) return res.status(400).json({ error: 'Missing: ' + q.label });
    if ((q.id === 'why' || q.id === 'scenario' || q.id === 'bugscenario') && v.length < 20) {
      return res.status(400).json({ error: q.label + ' is too short.' });
    }
  }
  const entry = { appId: genId(t.prefix), type: t.id, date: new Date().toISOString(), status: 'pending', adminNote: '' };
  const ids = new Set(t.questions.map(q => q.id));
  for (const q of db.config.applicationTypes.flatMap(x => x.questions)) {
    if (ids.has(q.id)) entry[q.id] = cleanStr(answers[q.id], 3000);
  }
  db.submissions.push(entry);
  if (db.submissions.length > 5000) db.submissions = db.submissions.slice(-5000);
  saveDB(db);
  res.json({ appId: entry.appId, type: entry.type, successMessage: t.successMessage || '' });
});

app.get('/api/status/:id', statusLimit, (req, res) => {
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const s = db.submissions.find(x => (x.appId || '').toUpperCase() === req.params.id.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Not found' });
  const t = typeById(db, s.type);
  res.json({ appId: s.appId, type: s.type, typeName: t ? t.name : s.type, date: s.date, status: s.status, adminNote: s.adminNote });
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

// --- private tickets ---
app.post('/api/tickets', ticketLimit, (req, res) => {
  const db = loadDB();
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const name = cleanStr(b.name, 80).trim();
  const subject = cleanStr(b.subject, 120).trim();
  const message = cleanStr(b.message, 3000).trim();
  if (!name) return res.status(400).json({ error: 'Add your name.' });
  if (!subject) return res.status(400).json({ error: 'Add a subject.' });
  if (message.length < 10) return res.status(400).json({ error: 'Message is too short.' });
  const t = {
    id: genId('TKT'), name, subject, status: 'open', unread: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    replies: [{ by: 'user', name, text: message, at: new Date().toISOString() }],
  };
  db.tickets.push(t);
  if (db.tickets.length > 2000) db.tickets = db.tickets.slice(-2000);
  const faqHit = faqMatch(subject + ' ' + message, db.config.faq);
  if (faqHit) {
    t.replies.push({ by: 'staff', name: 'Staff (auto)',
      text: `Quick answer from our FAQ:\n\n${faqHit.f.a}\n\nStill stuck? Just reply and a human will pick it up.`,
      at: new Date().toISOString() });
    audit(db, 'auto_faq', t.id, null);
  }
  saveDB(db);
  discordNotify(`New ticket **${t.id}** — ${t.subject}\nFrom **${t.name}**: ${t.replies[0].text.slice(0, 500)}`);
  res.json({ id: t.id });
});

app.get('/api/tickets/:id', statusLimit, (req, res) => {
  if (!validTicketId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const t = db.tickets.find(x => (x.id || '').toUpperCase() === req.params.id.toUpperCase());
  if (!t) return res.status(404).json({ error: 'Not found' });
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
  if (!staff && t.status !== 'open') return res.status(400).json({ error: 'This ticket is closed.' });
  const text = cleanStr(b.text, 2000).trim();
  if (text.length < 1) return res.status(400).json({ error: 'Empty reply.' });
  if (t.replies.length >= 200) return res.status(400).json({ error: 'Thread is full.' });
  const name = staff ? 'Staff' : cleanStr(b.name || t.name, 80);
  t.replies.push({ by: staff ? 'staff' : 'user', name, text, at: new Date().toISOString() });
  t.updatedAt = new Date().toISOString();
  t.unread = !staff;
  if (staff) audit(db, 'ticket_reply', t.id, req);
  saveDB(db);
  if (!staff) discordNotify(`Reply on ticket **${t.id}** (${t.subject}) from **${name}**:\n${text.slice(0, 500)}`);
  res.json({ ok: true });
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
      body: JSON.stringify({
        model: AI_MODEL, temperature: 0.3, max_tokens: 300,
        messages: [
          { role: 'system', content: 'You draft replies for Wigglesworth game community staff answering a player support ticket. Be short, warm and human. Never invent policies, links, dates or promises. If the answer is unknown, ask one clarifying question. Output ONLY the reply text, no quotes, no preamble.' },
          { role: 'user', content: `Ticket subject: ${t.subject}\nRoles offered: ${roles}\nKnown answers:\n${faq}\n\nThread so far:\n${thread}\n\nDraft the next staff reply:` },
        ],
      }),
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
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.submissions.slice().reverse().slice(0, 1000));
});

function cleanLayout(l) {
  const out = {};
  if (!l || typeof l !== 'object') return out;
  for (const k of Object.keys(l).slice(0, 30)) {
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
    title: cleanStr(c.title, 120) || 'Wigglesworth — Join the Team',
    subtitle: cleanStr(c.subtitle, 300),
    announcement: cleanStr(c.announcement, 200),
    rules: cleanStr(c.rules, 3000),
    accent: /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#6cb8f0',
    bg: /^#[0-9a-fA-F]{6}$/.test(c.bg || '') ? c.bg : '#080a12',
    editCode: cleanStr(c.editCode, 100) || db.config.editCode,
    showApproved: c.showApproved !== false,
    approvedTitle: cleanStr(c.approvedTitle, 120),
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
    applicationTypes: c.applicationTypes.map(cleanType),
  };
  if (ENV_EDIT_CODE) out.editCode = db.config.editCode;
  db.config = out;
  audit(db, 'config_saved', '', req);
  saveDB(db);
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
      body: JSON.stringify({
        model: AI_MODEL, temperature: 0.5, max_tokens: 300,
        messages: [
          { role: 'system', content: 'You write decision messages for Wigglesworth community staff to applicants. Warm, human, concise. Never invent links, dates, usernames or promises. Output ONLY the message text, no quotes, no preamble.' },
          { role: 'user', content: `Role applied for: ${t ? t.name : s.type}\nApplicant: ${displayName(s)}\n\nTheir answers:\n${answers}\n\n${verdict}` },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.error('ai decision failed', r.status); return res.status(502).json({ error: 'AI unavailable' }); }
    const j = await r.json();
    const note = cleanText(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, 1500).trim();
    if (!note) return res.status(502).json({ error: 'AI unavailable' });
    s.status = decision;
    s.adminNote = note;
    audit(db, 'ai_' + decision, s.appId, req);
    saveDB(db);
    res.json({ ok: true });
  } catch (e) { console.error('ai decision error', e.message); res.status(502).json({ error: 'AI unavailable' }); }
});

app.post('/api/admin/applications/:id/status', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const s = db.submissions.find(x => x.appId === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { status, adminNote } = req.body || {};
  if (status !== undefined) {
    if (!['pending', 'approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    s.status = status;
  }
  if (adminNote !== undefined) s.adminNote = cleanStr(adminNote, 2000);
  audit(db, 'status_' + s.status, s.appId, req);
  saveDB(db);
  res.json({ ok: true });
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
  res.json({ version: 1, exportedAt: new Date().toISOString(), config: db.config, submissions: db.submissions, tickets: db.tickets || [] });
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
  audit(db, 'restored', String(db.submissions.length), req);
  saveDB(db);
  res.json({ ok: true, submissions: db.submissions.length });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/admin/sync', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ github: !!GH_TOKEN, repo: GH_REPO, branch: GH_BRANCH, discord: !!DISCORD_WEBHOOK_URL, ai: !!AI_API_KEY });
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
    const api = `https://api.github.com/repos/${GH_CD_REPO}/contents/${name}`;
    const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
    const put = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'upload teaser ' + name, content: buf.toString('base64'), branch: GH_BRANCH }) });
    if (!put.ok) { console.error('video store failed', put.status); return res.status(502).json({ error: 'Video store failed' }); }
  } catch (e) { console.error('video store error', e.message); return res.status(502).json({ error: 'Video store failed' }); }
  audit(db, 'video_upload', name, req);
  saveDB(db);
  res.json({ url: `${COUNTDOWN_PUBLIC_URL}/${name}` });
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

app.listen(PORT, HOST, () => {
  console.log(`Moderator site on http://${HOST}:${PORT} (bound to ${HOST} only — home IP not exposed)`);
  console.log(`Discord ticket alerts: ${DISCORD_WEBHOOK_URL ? 'ON' : 'OFF (set DISCORD_WEBHOOK_URL)'}`);
});
