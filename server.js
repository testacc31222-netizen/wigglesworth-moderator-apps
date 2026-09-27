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
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = path.join(__dirname, 'data.json');
const ENV_EDIT_CODE = process.env.EDIT_CODE || '';

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', setHeaders(res, filePath) {
  if (filePath.endsWith('index.html') || filePath.endsWith('app.js')) res.set('Cache-Control', 'no-store');
} }));

const general = rateLimit({ windowMs: 60 * 1000, max: 120 });
const submitLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: { error: 'Too many applications, try again later.' } });
const adminLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: { error: 'Too many attempts, slow down.' } });
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
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
];

const DEFAULT_CONFIG = {
  title: 'Wigglesworth — Join the Team',
  subtitle: 'Three ways in. Pick the role that fits you and send one honest application.',
  announcement: 'Applications are OPEN',
  rules: '• Must be 13+\n• One role per application — pick the closest fit\n• Be honest — lying = instant deny\n• Spamming applications = blacklist',
  accent: '#6cb8f0', bg: '#0e1218',
  editCode: 'MOD123',
  showApproved: true, approvedTitle: 'New team members',
  bannerImage: '', logoImage: '', backgroundImage: '',
  topText: '',
  bottomText: 'Questions? Contact staff on Discord.',
  decor: [],
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
  if (!db || typeof db !== 'object') return { config: structuredClone(DEFAULT_CONFIG), submissions: [] };
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
  // fixups for DBs saved before these fields existed
  for (const t of db.config.applicationTypes) if (t.open === undefined) t.open = true;
  if (db.config.accent === '#6366f1') db.config.accent = '#6cb8f0';
  if (db.config.bg === '#080a12') db.config.bg = '#0e1218';
  return db;
}
function saveDB(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
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
  return rest;
}
function typeById(db, id) {
  return db.config.applicationTypes.find(t => t.id === id);
}
function validAppId(id) {
  return /^[A-Z0-9]{2,4}-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}
function displayName(s) {
  return cleanStr(s.username || s.discord || s.appId, 80);
}

// --- public ---
app.get('/api/config', (req, res) => {
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
  res.json({ appId: entry.appId, type: entry.type });
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
      out.push({ appId: s.appId, type: t.id, typeName: t.name, date: s.date, username: displayName(s) });
    });
  }
  res.json(out.slice(0, 200));
});

// --- admin ---
app.get('/api/admin/applications', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.submissions.slice().reverse().slice(0, 1000));
});

function cleanQuestion(q, i) {
  return {
    id: cleanStr(q.id || ('q' + i), 40).replace(/[^a-zA-Z0-9_-]/g, '') || ('q' + i),
    label: cleanStr(q.label, 200) || 'Question',
    type: ['text', 'number', 'textarea', 'select'].includes(q.type) ? q.type : 'text',
    placeholder: cleanStr(q.placeholder, 200),
    required: !!q.required,
    options: cleanStr(q.options, 500),
  };
}
function cleanType(t) {
  return {
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
  saveDB(db);
  res.json({ ok: true });
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
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/applications/:id', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  db.submissions = db.submissions.filter(x => x.appId !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/applications', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const only = cleanStr(req.query.type, 40);
  db.submissions = only ? db.submissions.filter(x => x.type !== only) : [];
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/reset', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const keepCode = db.config.editCode;
  db.config = structuredClone(DEFAULT_CONFIG);
  db.config.editCode = keepCode;
  saveDB(db);
  res.json(publicConfig(db));
});

app.get('/api/admin/backup', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json({ version: 1, exportedAt: new Date().toISOString(), config: db.config, submissions: db.submissions });
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
  saveDB(db);
  res.json({ ok: true, submissions: db.submissions.length });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, HOST, () => {
  console.log(`Moderator site on http://${HOST}:${PORT} (bound to ${HOST} only — home IP not exposed)`);
});
