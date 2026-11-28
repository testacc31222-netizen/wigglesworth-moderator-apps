#!/usr/bin/env node
/**
 * READ-ONLY migration helper: build the canonical pre-cutover snapshot.
 *
 * Reads the local data.live.json, optionally reads the GitHub backup recorded
 * by server.js (data-backup branch, falling back to main), ports
 * mergeDatabases() + normalizeDB() exactly, and writes ONLY to migration-out/:
 *
 *   migration-out/snapshot.json         canonical merged database
 *   migration-out/snapshot.hashes.json  per-record SHA-256 hashes
 *
 * No writes to GitHub, no writes to data.live.json, no database access.
 * Uses only Node built-ins (node:crypto, node:fs, node:path, node:url) and
 * global fetch. `--local-only` skips GitHub entirely.
 *
 * Port notes:
 *  - server.js calls mergeDatabases(remote, local); the parameter names below
 *    keep that order so the merge semantics are identical to boot restore.
 *  - staffAccounts is the one intentional deviation from server.js: it is
 *    unioned by id instead of being taken wholesale from the spread (per
 *    worker/CONTRACT.md), so a stale backup cannot delete a newer staff login.
 */
import { createHash, scryptSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'migration-out');
const LOCAL_FILE = path.join(ROOT, 'data.live.json');
const LOCAL_ONLY = process.argv.includes('--local-only');

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const RAW_REPO = process.env.GITHUB_REPO || 'testacc31222-netizen/wigglesworth-moderator-apps';
const GH_REPO = /^[\w.-]+\/[\w.-]+$/.test(RAW_REPO)
  ? RAW_REPO : 'testacc31222-netizen/wigglesworth-moderator-apps';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GH_DATA_BRANCH = (process.env.GITHUB_DATA_BRANCH || 'data-backup')
  .trim().replace(/[^A-Za-z0-9._-]/g, '-') || 'data-backup';
const GH_PATH = 'data.live.json';
const GITHUB_API_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');

const GH_HEADERS = () => ({
  'User-Agent': 'wigglesworth-apps',
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
});

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Verbatim constants/fixups from server.js (needed by normalizeDB).
// ---------------------------------------------------------------------------
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

const STAFF_ROLES = ['owner', 'staff', 'viewer'];
const cleanStaffRole = (role) => STAFF_ROLES.includes(role) ? role : 'staff';
function hashStaffPassword(password, saltHex) {
  return scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}
function makeStaffAccount(username, password, role = 'staff', createdBy = '') {
  const salt = randomBytes(16).toString('hex');
  return {
    id: 'stf_' + randomBytes(10).toString('hex'),
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
function emptyDB() {
  return { config: structuredClone(DEFAULT_CONFIG), submissions: [], tickets: [], reports: [],
    audit: [], accounts: [], loginCodes: [], outbox: [], staffAccounts: [] };
}

// Verbatim port of server.js normalizeDB().
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
  // Staff sign-in accounts. Seeded once with the site owner (same as server.js;
  // the generated salt is random, just as on a fresh Render boot).
  if (!Array.isArray(db.staffAccounts) || !db.staffAccounts.length) {
    db.staffAccounts = [makeStaffAccount('khamari', 'wigglesworthrules', 'owner', 'system')];
  }
  for (const a of db.staffAccounts) {
    if (typeof a.username !== 'string') a.username = '';
    if (typeof a.role !== 'string' || !a.role) a.role = 'staff';
    if (!STAFF_ROLES.includes(a.role)) a.role = 'staff';
    if (a.active === undefined) a.active = true;
  }
  // Event Hoster is permanently retired.
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

// ---------------------------------------------------------------------------
// Verbatim port of server.js merge helpers.
// ---------------------------------------------------------------------------
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
    // CONTRACT.md deviation: union by id instead of letting the remote copy
    // replace the whole collection via the spread above.
    staffAccounts: mergeById(r.staffAccounts, l.staffAccounts, 'id'),
  };
}

// ---------------------------------------------------------------------------
// GitHub read (GET only), ported from server.js readGitHubData().
// ---------------------------------------------------------------------------
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
    // Contents API stops returning content above 1 MB; raw handles ~100 MB.
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

function validShape(db) {
  return !!db && typeof db === 'object'
    && Array.isArray(db.submissions)
    && !!db.config && typeof db.config === 'object' && !Array.isArray(db.config);
}

// ---------------------------------------------------------------------------
// Canonical output + per-record hashes.
// ---------------------------------------------------------------------------
const TABLES = [
  { table: 'config', collection: null },
  { table: 'submissions', collection: 'submissions', id: 'appId' },
  { table: 'tickets', collection: 'tickets', id: 'id' },
  { table: 'reports', collection: 'reports', id: 'id' },
  { table: 'audit', collection: 'audit' },
  { table: 'accounts', collection: 'accounts', id: 'id' },
  { table: 'loginCodes', collection: 'loginCodes', id: 'email' },
  { table: 'outbox', collection: 'outbox', id: 'id' },
  { table: 'diag', collection: 'diag' },
  { table: 'staffAccounts', collection: 'staffAccounts', id: 'id' },
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function recordId(table, record, index) {
  if (table === 'config') return 'singleton';
  const spec = TABLES.find(t => t.table === table);
  if (spec && spec.id && record && record[spec.id]) return String(record[spec.id]);
  return `${table}-${String(index + 1).padStart(4, '0')}`;
}

function buildHashes(snapshot) {
  const out = {
    algorithm: 'sha256',
    hashInput: 'UTF-8 JSON.stringify(record) with object keys sorted recursively (canonical order)',
    snapshotSha256: sha256(JSON.stringify(snapshot, null, 2) + '\n'),
    records: {},
  };
  for (const { table, collection } of TABLES) {
    out.records[table] = {};
    const list = collection ? snapshot[collection] : [snapshot.config];
    if (!Array.isArray(list)) continue;
    list.forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      out.records[table][recordId(table, record, index)] = sha256(JSON.stringify(canonicalize(record)));
    });
  }
  return out;
}

async function main() {
  const localText = fs.readFileSync(LOCAL_FILE, 'utf8');
  const local = JSON.parse(localText);
  const source = { local: path.relative(ROOT, LOCAL_FILE), github: null, fallbackToMain: false };

  let remote = null;
  if (!LOCAL_ONLY) {
    try {
      const primary = await readGitHubData(GH_DATA_BRANCH);
      if (!primary.missing && primary.data) {
        remote = primary.data;
        source.github = GH_DATA_BRANCH;
      }
    } catch (err) {
      console.warn(`GitHub backup (${GH_DATA_BRANCH}) unreadable: ${err.message}; trying fallback`);
    }
    if (!remote && GH_DATA_BRANCH !== GH_BRANCH) {
      try {
        const fallback = await readGitHubData(GH_BRANCH);
        if (!fallback.missing && fallback.data) {
          remote = fallback.data;
          source.github = GH_BRANCH;
          source.fallbackToMain = true;
        }
      } catch (err) {
        console.warn(`GitHub fallback (${GH_BRANCH}) unreadable: ${err.message}; using local file only`);
      }
    }
    if (remote && !validShape(remote)) {
      console.warn('GitHub backup has unexpected shape; using local file only');
      remote = null;
      source.github = null;
      source.fallbackToMain = false;
    }
  }

  const merged = normalizeDB(mergeDatabases(remote, local));
  // Snapshot assembly safety: the schema has 10 tables, so guarantee all ten
  // collections are present. This does not change any merge/normalize rule.
  let diagFixed = false;
  if (!Array.isArray(merged.diag)) {
    merged.diag = [];
    diagFixed = true;
  }
  if (diagFixed) console.warn('diag collection was not an array; emitted as []');

  const snapshot = canonicalize(merged);
  const snapshotText = JSON.stringify(snapshot, null, 2) + '\n';
  const hashes = buildHashes(snapshot);
  hashes.source = source;
  const hashesText = JSON.stringify(canonicalize(hashes), null, 2) + '\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'snapshot.json'), snapshotText, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'snapshot.hashes.json'), hashesText, 'utf8');

  const counts = Object.fromEntries(TABLES.map(({ table, collection }) =>
    [table, collection ? (snapshot[collection]?.length ?? 0) : 1]));
  console.log('Wrote migration-out/snapshot.json and migration-out/snapshot.hashes.json');
  console.log('Source:', source.local, source.github ? `+ GitHub ${source.github}` : '(local only)');
  console.log('Counts:', JSON.stringify(counts));
  console.log('Snapshot SHA-256:', hashes.snapshotSha256);
}

main().catch(err => {
  console.error('export-merged-snapshot failed:', err.message);
  process.exitCode = 1;
});
