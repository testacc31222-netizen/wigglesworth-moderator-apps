const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // correct client IPs behind Render/Cloudflare, needed for rate limits

const PORT = process.env.PORT || 3000;
// Bind to localhost by default so your home IP is NOT exposed on LAN.
// Only set HOST=0.0.0.0 if you intentionally want LAN testing.
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = path.join(__dirname, 'data.json');
// Set a strong code in hosting env vars. Falls back to data.json value.
const ENV_EDIT_CODE = process.env.EDIT_CODE || '';

app.use(helmet({
  contentSecurityPolicy: false, // single-file app uses inline handlers; keep XSS protection via validation below
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// --- rate limits (anti-spam / anti-brute-force) ---
const general = rateLimit({ windowMs: 60 * 1000, max: 120 });
const submitLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: { error: 'Too many applications, try again later.' } });
const adminLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: { error: 'Too many attempts, slow down.' } });
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use('/api/', general);

const DEFAULT_CONFIG = {
  title: "Moderator Application",
  subtitle: "Strictly for future moderators. Other applications will be ignored.",
  announcement: "Applications are OPEN ✅",
  rules: "• Must be 13+\n• Moderator applications ONLY here\n• Be honest — lying = instant deny\n• Spamming applications = blacklist",
  accent: "#e5384f", bg: "#080a12",
  editCode: "MOD123",
  successMessage: "Thanks! Your moderator application was received. Save your Application ID and check your status below.",
  showApproved: true, approvedTitle: "Approved Moderators",
  bannerImage: "", logoImage: "", backgroundImage: "",
  topText: "Welcome! Fill this out <b>only</b> if you want to be a <b>Moderator</b>.",
  bottomText: "Questions? Contact staff on Discord.",
  decor: [],
  questions: [
    { id: "username", label: "In-game Username", type: "text", placeholder: "Your username", required: true, options: "" },
    { id: "discord", label: "Discord Username", type: "text", placeholder: "Your Discord name", required: true, options: "" },
    { id: "age", label: "Age", type: "number", placeholder: "e.g. 16", required: true, options: "" },
    { id: "timezone", label: "Timezone / Availability", type: "text", placeholder: "e.g. EST, 3-5hrs daily", required: true, options: "" },
    { id: "experience", label: "Past Moderation Experience?", type: "textarea", placeholder: "List experience or write None", required: true, options: "" },
    { id: "why", label: "Why do you want to be Moderator?", type: "textarea", placeholder: "Give detail", required: true, options: "" },
    { id: "scenario", label: "Someone is spamming in chat. What do you do?", type: "textarea", placeholder: "Explain step-by-step", required: true, options: "" },
    { id: "rulebreak", label: "Have you ever been banned? If so, why?", type: "text", placeholder: "Be honest", required: true, options: "" }
  ]
};

function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const db = JSON.parse(raw);
    if (!db.config || typeof db.config !== 'object') db.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!Array.isArray(db.submissions)) db.submissions = [];
    return db;
  } catch {
    return { config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), submissions: [] };
  }
}
function saveDB(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function genId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[crypto.randomInt(c.length)];
  return 'MOD-' + s;
}
// strip control chars + cap length on all user input
function cleanStr(v, max = 2000) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}
function safeEq(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function effectiveCode(db) {
  return ENV_EDIT_CODE || db.config.editCode;
}
function isAdmin(req, db) {
  const got = req.headers['x-edit-code'];
  if (!got) return false;
  return safeEq(got, effectiveCode(db));
}
function publicConfig(db) {
  const { editCode, ...rest } = db.config;
  return rest;
}
function validAppId(id) {
  return /^MOD-[A-Z2-9]{6}$/.test(String(id || '').toUpperCase());
}

// --- public ---
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicConfig(loadDB()));
});

app.post('/api/applications', submitLimit, (req, res) => {
  const db = loadDB();
  const answers = req.body && typeof req.body === 'object' ? req.body : {};
  for (const q of db.config.questions) {
    const v = cleanStr(answers[q.id], 3000).trim();
    if (q.required && !v) return res.status(400).json({ error: 'Missing: ' + q.label });
    if ((q.id === 'why' || q.id === 'scenario') && v.length < 20) {
      return res.status(400).json({ error: q.label + ' is too short.' });
    }
  }
  const entry = { appId: genId(), date: new Date().toISOString(), status: 'pending', adminNote: '' };
  for (const q of db.config.questions) entry[q.id] = cleanStr(answers[q.id], 3000);
  db.submissions.push(entry);
  if (db.submissions.length > 5000) db.submissions = db.submissions.slice(-5000);
  saveDB(db);
  res.json({ appId: entry.appId });
});

app.get('/api/status/:id', statusLimit, (req, res) => {
  if (!validAppId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const db = loadDB();
  const s = db.submissions.find(x => (x.appId || '').toUpperCase() === req.params.id.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ appId: s.appId, date: s.date, status: s.status, adminNote: s.adminNote });
});

app.get('/api/approved', statusLimit, (req, res) => {
  const db = loadDB();
  if (!db.config.showApproved) return res.json([]);
  res.json(db.submissions.filter(s => s.status === 'approved').map(s => ({
    appId: s.appId, date: s.date,
    username: cleanStr(s.username || s.discord || s.appId, 80)
  })).reverse().slice(0, 200));
});

// --- admin (needs x-edit-code header) ---
app.get('/api/admin/applications', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'no-store');
  res.json(db.submissions.slice().reverse().slice(0, 1000));
});

app.post('/api/admin/config', adminLimit, express.json({ limit: '8mb' }), (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const c = req.body || {};
  if (typeof c.title !== 'string' || !Array.isArray(c.questions) || c.questions.length > 50) {
    return res.status(400).json({ error: 'Bad config' });
  }
  // sanitize config text fields, keep images/decor but cap sizes
  const out = {
    title: cleanStr(c.title, 120) || 'Moderator Application',
    subtitle: cleanStr(c.subtitle, 300),
    announcement: cleanStr(c.announcement, 200),
    rules: cleanStr(c.rules, 3000),
    accent: /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#6366f1',
    bg: /^#[0-9a-fA-F]{6}$/.test(c.bg || '') ? c.bg : '#080a12',
    editCode: cleanStr(c.editCode, 100) || db.config.editCode,
    successMessage: cleanStr(c.successMessage, 1000),
    showApproved: !!c.showApproved,
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
    questions: c.questions.slice(0, 50).map((q, i) => ({
      id: cleanStr(q.id || ('q' + i), 40).replace(/[^a-zA-Z0-9_-]/g, '') || ('q' + i),
      label: cleanStr(q.label, 200) || 'Question',
      type: ['text', 'number', 'textarea', 'select'].includes(q.type) ? q.type : 'text',
      placeholder: cleanStr(q.placeholder, 200),
      required: !!q.required,
      options: cleanStr(q.options, 500),
    })),
  };
  // If ENV code is set, never overwrite it from the editor
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
  db.submissions = [];
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/reset', adminLimit, (req, res) => {
  const db = loadDB();
  if (!isAdmin(req, db)) return res.status(401).json({ error: 'Unauthorized' });
  const keepCode = db.config.editCode;
  db.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!ENV_EDIT_CODE) db.config.editCode = keepCode;
  else db.config.editCode = keepCode;
  saveDB(db);
  res.json(publicConfig(db));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, HOST, () => {
  console.log(`Moderator site on http://${HOST}:${PORT} (bound to ${HOST} only — home IP not exposed)`);
});
