// /api/config, /api/admin/config (GET+POST) and /api/admin/reset.

import { cfg } from '../env.js';
import { json } from '../http.js';
import { audit, cleanStr, publicConfig, isStaffAdmin } from './misc.js';

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

function cleanLayout(l) {
  const out = {};
  if (!l || typeof l !== 'object') return out;
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

export function register(router) {
  router.get('/api/config', c => json(publicConfig(c.db)));

  router.get('/api/admin/config', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    return json(c.db.config);
  });

  // The route-level 8mb parser in server.js is shadowed by the global 200kb
  // parser; c.body is already capped by index.js, so no extra parsing here.
  router.post('/api/admin/config', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    if (typeof b.title !== 'string' || !Array.isArray(b.applicationTypes) ||
        b.applicationTypes.length < 1 || b.applicationTypes.length > 5) {
      return json({ error: 'Bad config' }, 400);
    }
    const out = {
      staffProfiles: Array.isArray(db.config.staffProfiles) ? db.config.staffProfiles : [],
      title: cleanStr(b.title, 120) || 'WIGGLESWORTH',
      subtitle: cleanStr(b.subtitle, 300),
      announcement: cleanStr(b.announcement, 200),
      rules: cleanStr(b.rules, 3000),
      accent: /^#[0-9a-fA-F]{6}$/.test(b.accent || '') ? b.accent : '#A62C35',
      bg: /^#[0-9a-fA-F]{6}$/.test(b.bg || '') ? b.bg : '#080809',
      editCode: cleanStr(b.editCode, 100) || db.config.editCode,
      showApproved: b.showApproved !== false,
      showBanner: b.showBanner === undefined ? db.config.showBanner === true : b.showBanner === true,
      approvedTitle: cleanStr(b.approvedTitle, 120),
      about: (() => {
        const a = b.about && typeof b.about === 'object' ? b.about : (db.config.about || DEFAULT_CONFIG.about);
        return Object.fromEntries(Object.keys(DEFAULT_CONFIG.about).map(k => [k,
          cleanStr(typeof a[k] === 'string' ? a[k] : (db.config.about?.[k] ?? DEFAULT_CONFIG.about[k]),
            k === 'lede' || k.startsWith('featureText') ? 500 : 120)
        ]));
      })(),
      copy: (() => {
        const source = b.copy && typeof b.copy === 'object' && !Array.isArray(b.copy) ? b.copy : (db.config.copy || {});
        const result = Object.create(null);
        for (const [key, value] of Object.entries(source).slice(0, 400)) {
          if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key) || typeof value !== 'string') continue;
          result[key] = cleanStr(value, 1000);
        }
        return result;
      })(),
      bannerImage: cleanStr(b.bannerImage, 2000000),
      logoImage: cleanStr(b.logoImage, 2000000),
      backgroundImage: cleanStr(b.backgroundImage, 2000000),
      topText: cleanStr(b.topText, 8000),
      bottomText: cleanStr(b.bottomText, 8000),
      faq: Array.isArray(b.faq)
        ? b.faq.slice(0, 20).map(f => ({ q: cleanStr(f.q, 200), a: cleanStr(f.a, 1000) })).filter(f => f.q || f.a)
        : [],
      countdown: {
        show: !!(b.countdown && b.countdown.show),
        title: cleanStr(b.countdown && b.countdown.title, 120),
        endVideo: cleanStr(b.countdown && b.countdown.endVideo, 500),
        ambience: cleanStr(b.countdown && b.countdown.ambience, 500),
        daysLine: cleanStr(b.countdown && b.countdown.daysLine, 200) || 'day {d} left.',
        finalLine: cleanStr(b.countdown && b.countdown.finalLine, 200) || '{h}h {m}m {s}s left.',
        subLine: cleanStr(b.countdown && b.countdown.subLine, 200) || '{h}h {m}m {s}s to go',
        completedLine: cleanStr(b.countdown && b.countdown.completedLine, 200) || 'completed.',
        endCardLine: cleanStr(b.countdown && b.countdown.endCardLine, 200) || 'that was it.',
        soonLine: cleanStr(b.countdown && b.countdown.soonLine, 200) || 'soon.',
        target: (() => {
          const s = cleanStr(b.countdown && b.countdown.target, 40);
          const ms = Date.parse(s);
          return isNaN(ms) ? '' : new Date(ms).toISOString();
        })(),
      },
      layout: cleanLayout(b.layout),
      decor: Array.isArray(b.decor) ? b.decor.slice(0, 40).map(d => ({
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
      applicationTypes: b.applicationTypes.filter(t => t && t.id !== 'event').map(t => {
        const clean = cleanType(t);
        const old = db.config.applicationTypes.find(x => x.id === clean.id);
        if (old && old.successMessage && !clean.successMessage) clean.successMessage = old.successMessage;
        return clean;
      }),
    };
    if (cfg(c.env, 'EDIT_CODE')) out.editCode = db.config.editCode;
    out.updatedAt = new Date().toISOString();
    db.config = out;
    audit(c, 'config_saved', '');
    await c.store.save();
    return json({ ok: true });
  });

  router.post('/api/admin/reset', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const keepCode = db.config.editCode;
    db.config = structuredClone(DEFAULT_CONFIG);
    db.config.editCode = keepCode;
    audit(c, 'reset', '');
    await c.store.save();
    return json(publicConfig(db));
  });
}

export { DEFAULT_CONFIG, DEFAULT_TYPES };
