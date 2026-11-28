// Application submit/status/approved and all admin application endpoints.

import { cfg } from '../env.js';
import { json } from '../http.js';
import { aiChat } from '../ai.js';
import { grantRoleForSubmission, announceAcceptance } from '../discord.js';
import {
  audit, cleanStr, cleanText, validAppId, validDiscordId, hasSlur, typeById,
  genId, displayName, mailConfigured, queueReceiptEmail, queueDecisionEmail, scheduleFlush,
  currentUser, isStaffAdmin, canStaffView,
} from './misc.js';

const AI_BASE = env => cfg(env, 'AI_BASE_URL', 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const AI_MODEL = env => cfg(env, 'AI_MODEL', 'openai/gpt-oss-20b');

function aiBody(messages, temperature, maxTokens, model) {
  const b = { model, temperature, max_tokens: maxTokens, messages };
  if (/gpt-oss/i.test(model)) b.reasoning_effort = 'low';
  return b;
}

async function aiAnswer(c, system, user, temp, maxTokens, max) {
  const out = await aiChat(c.env, system, user, temp, maxTokens);
  const text = typeof out === 'string' ? out
    : (out && (out.content || out.text || out.suggestion || out.summary)) || '';
  return cleanText(text, max).trim();
}

async function announce(c, sub) {
  try { return await announceAcceptance(c.env, c.store, sub, c.ctx); }
  catch (e) { return { posted: false, error: e.message }; }
}

async function grant(c, sub, force = false) {
  return await grantRoleForSubmission(c.env, c.store, sub, c.ctx, force ? { force: true } : undefined);
}

export function register(router) {
  router.post('/api/applications', async c => {
    const db = c.db;
    const account = currentUser(c);
    if (!account) return json({ error: 'Sign in with your email before applying.' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const t = typeById(db, cleanStr(b.type, 40));
    if (!t) return json({ error: 'Pick a role first.' }, 400);
    if (t.open === false) return json({ error: t.name + ' applications are currently closed.' }, 400);
    const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
    for (const q of t.questions) {
      const v = cleanStr(answers[q.id], 3000).trim();
      if (q.required && !v) return json({ error: 'Missing: ' + q.label }, 400);
      if (q.id === 'discordId' && v && !validDiscordId(v)) {
        return json({ error: 'Discord User ID must be the 17-20 digit number from Discord (not your username).' }, 400);
      }
      if ((q.id === 'why' || q.id === 'scenario' || q.id === 'bugscenario') && v.length < 20) {
        return json({ error: q.label + ' is too short.' }, 400);
      }
    }
    const entry = {
      appId: genId(t.prefix), type: t.id, date: new Date().toISOString(),
      status: 'pending', adminNote: '', email: account.email,
      emailUpdates: b.emailUpdates !== false,
      accountId: account.id, notifiedStatus: '',
    };
    account.emailUpdates = entry.emailUpdates;
    const ids = new Set(t.questions.map(q => q.id));
    for (const q of db.config.applicationTypes.flatMap(x => x.questions)) {
      if (ids.has(q.id)) entry[q.id] = cleanStr(answers[q.id], 3000);
    }
    if (hasSlur(Object.values(entry).join(' '))) return json({ error: 'Submission rejected.' }, 400);
    db.submissions.push(entry);
    if (db.submissions.length > 5000) db.submissions = db.submissions.slice(-5000);
    queueReceiptEmail(c, entry);
    await c.store.save();
    scheduleFlush(c);
    return json({
      appId: entry.appId, type: entry.type, successMessage: t.successMessage || '',
      email: entry.email, emailUpdates: entry.emailUpdates, mailConfigured: mailConfigured(c.env),
    });
  });

  router.get('/api/status/:id', c => {
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const db = c.db;
    const s = db.submissions.find(x => (x.appId || '').toUpperCase() === c.params.id.toUpperCase());
    if (!s) return json({ error: 'Not found' }, 404);
    const t = typeById(db, s.type);
    return json({ appId: s.appId, type: s.type, typeName: t ? t.name : s.type, date: s.date, status: s.status, adminNote: s.adminNote, who: displayName(s) });
  });

  router.get('/api/approved', c => {
    const db = c.db;
    const only = cleanStr(c.query.get('type'), 40);
    const out = [];
    for (const t of db.config.applicationTypes) {
      if (!db.config.showApproved || !t.showApproved) continue;
      if (only && only !== t.id) continue;
      db.submissions.filter(s => s.type === t.id && s.status === 'approved').reverse().slice(0, 100).forEach(s => {
        out.push({ type: t.id, typeName: t.name, date: s.date, username: displayName(s) });
      });
    }
    return json(out.slice(0, 200));
  });

  router.get('/api/admin/applications', async c => {
    if (!await canStaffView(c)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json(c.db.submissions.slice().reverse().slice(0, 1000));
  });

  router.post('/api/admin/applications/:id/decision', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const s = db.submissions.find(x => x.appId === c.params.id);
    if (!s) return json({ error: 'Not found' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const decision = b.decision;
    if (!['approved', 'denied'].includes(decision)) return json({ error: 'Bad decision' }, 400);
    if (!cfg(c.env, 'AI_API_KEY')) return json({ error: 'AI not configured (set AI_API_KEY)' }, 400);
    const t = typeById(db, s.type);
    const answers = (t ? t.questions : []).map(q => `${q.label}: ${cleanText(s[q.id], 500)}`).join('\n').slice(0, 2500);
    const verdict = decision === 'approved'
      ? 'Write a warm acceptance: congratulate them by name, mention one specific thing from their answers that stood out, tell them staff will reach out with next steps. Keep it short.'
      : 'Write a kind rejection: thank them for applying, give ONE general encouragement (gain experience, reapply later), never be harsh, never invent specific reasons. Keep it short.';
    try {
      const note = await aiAnswer(c,
        'You write decision messages for Wigglesworth community staff to applicants. Warm, human, concise. Never invent links, dates, usernames or promises. Output ONLY the message text, no quotes, no preamble.',
        `Role applied for: ${t ? t.name : s.type}\nApplicant: ${displayName(s)}\n\nTheir answers:\n${answers}\n\n${verdict}`,
        0.5, 700, 1500);
      if (!note) return json({ error: 'AI unavailable' }, 502);
      s.status = decision;
      s.adminNote = note;
      s.updatedAt = new Date().toISOString();
      let role = null;
      let announceResult = null;
      if (decision === 'approved') {
        role = await grant(c, s);
        audit(c, role.assigned ? 'role_assigned' : 'role_failed', s.appId);
        announceResult = await announce(c, s);
      }
      const emailed = queueDecisionEmail(c, s);
      audit(c, 'ai_' + decision, s.appId);
      await c.store.save();
      scheduleFlush(c);
      return json({ ok: true, emailed, mailConfigured: mailConfigured(c.env), role, announce: announceResult });
    } catch (e) {
      return json({ error: 'AI unavailable' }, 502);
    }
  });

  router.post('/api/admin/applications/:id/summarize', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const s = db.submissions.find(x => x.appId === c.params.id);
    if (!s) return json({ error: 'Not found' }, 404);
    if (!cfg(c.env, 'AI_API_KEY')) return json({ error: 'AI not configured (set AI_API_KEY)' }, 400);
    const t = typeById(db, s.type);
    const answers = (t ? t.questions : []).map(q => `${q.label}: ${cleanText(s[q.id], 600)}`).join('\n').slice(0, 3000);
    try {
      const summary = await aiAnswer(c,
        "You help Wigglesworth community staff triage applications fast. Summarize the applicant's answers so staff can decide without reading everything. Be factual, compact and neutral; never invent details; briefly note anything important that is missing. Output plain text only, exactly this shape:\nVerdict: (Strong / Good / Mixed / Weak) - one short sentence\n- Wants to join: ...\n- Experience: ...\n- Availability: ...\n- Watch-outs: ...\nKeep every line under 25 words. No preamble, no extra sections.",
        `Role applied for: ${t ? t.name : s.type}\nApplicant: ${displayName(s)}\n\nTheir answers:\n${answers}\n\nWrite the summary now.`,
        0.2, 700, 1200);
      if (!summary) return json({ error: 'AI unavailable' }, 502);
      s.aiSummary = summary;
      s.aiSummaryAt = new Date().toISOString();
      audit(c, 'ai_summary', s.appId);
      await c.store.save();
      return json({ summary, at: s.aiSummaryAt });
    } catch (e) {
      return json({ error: 'AI unavailable' }, 502);
    }
  });

  router.post('/api/admin/ai-check', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const key = cfg(c.env, 'AI_API_KEY');
    if (!key) return json({ error: 'AI not configured (set AI_API_KEY)' }, 400);
    const base = AI_BASE(c.env), model = AI_MODEL(c.env);
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      let r, body;
      try {
        r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(aiBody([{ role: 'user', content: 'Reply with the single word: ping' }], 0, 100, model)),
          signal: ctrl.signal,
        });
        body = (await r.text()).slice(0, 1500);
      } finally { clearTimeout(to); }
      return json({ ok: r.ok, status: r.status, base, model, body });
    } catch (e) {
      return json({ error: 'Request failed: ' + e.message }, 502);
    }
  });

  router.post('/api/admin/applications/:id/status', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const s = db.submissions.find(x => x.appId === c.params.id);
    if (!s) return json({ error: 'Not found' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const { status, adminNote, email, discordId } = b;
    const before = s.status;
    if (discordId !== undefined && String(discordId).trim() !== '') {
      const id = String(discordId).replace(/\D/g, '');
      if (!validDiscordId(id)) return json({ error: 'Discord User ID must be the 17-20 digit number from Discord.' }, 400);
      s.discordId = id;
    }
    if (status !== undefined) {
      if (!['pending', 'approved', 'denied'].includes(status)) return json({ error: 'Bad status' }, 400);
      s.status = status;
    }
    if (adminNote !== undefined) s.adminNote = cleanStr(adminNote, 2000);
    if (email !== undefined && String(email).trim() !== '') {
      const em = cleanStr(email, 180).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em)) return json({ error: 'Enter a valid applicant email.' }, 400);
      if (em !== s.email) { s.email = em; s.notifiedStatus = ''; }
    }
    let role = null;
    let announceResult = null;
    if (s.status === 'approved') {
      role = await grant(c, s);
      audit(c, role.assigned ? 'role_assigned' : 'role_failed', s.appId);
      announceResult = await announce(c, s);
    }
    let emailed = false;
    if (s.status !== before && (s.status === 'approved' || s.status === 'denied')) {
      emailed = queueDecisionEmail(c, s);
    }
    s.updatedAt = new Date().toISOString();
    audit(c, 'status_' + s.status, s.appId);
    await c.store.save();
    scheduleFlush(c);
    return json({ ok: true, emailed, mailConfigured: mailConfigured(c.env), role, announce: announceResult });
  });

  router.post('/api/admin/applications/:id/role', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const s = db.submissions.find(x => x.appId === c.params.id);
    if (!s) return json({ error: 'Not found' }, 404);
    if (s.status !== 'approved') return json({ error: 'Approve the application first.' }, 400);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    if (b.discordId !== undefined && String(b.discordId).trim() !== '') {
      const id = String(b.discordId).replace(/\D/g, '');
      if (!validDiscordId(id)) return json({ error: 'Discord User ID must be the 17-20 digit number from Discord.' }, 400);
      s.discordId = id;
    }
    const role = await grant(c, s, true);
    audit(c, role.assigned ? 'role_assigned' : 'role_failed', s.appId);
    const announceResult = await announce(c, s);
    s.updatedAt = new Date().toISOString();
    await c.store.save();
    return json({ ok: true, role, announce: announceResult });
  });

  router.post('/api/admin/applications/:id/notify', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validAppId(c.params.id)) return json({ error: 'Not found' }, 404);
    const s = db.submissions.find(x => x.appId === c.params.id);
    if (!s) return json({ error: 'Not found' }, 404);
    if (!s.email) return json({ error: 'This application has no email on file.' }, 400);
    if (!['approved', 'denied'].includes(s.status)) return json({ error: 'Decide the application first.' }, 400);
    if (!mailConfigured(c.env)) {
      return json({ error: 'Email delivery is not configured. Set APPS_SCRIPT_URL + APPS_SCRIPT_SECRET, SMTP_USER + SMTP_PASS, RESEND_API_KEY, or BREVO_API_KEY, plus MAIL_FROM.' }, 400);
    }
    const queued = queueDecisionEmail(c, s, true);
    audit(c, 'decision_email', s.appId);
    await c.store.save();
    scheduleFlush(c);
    return json({ ok: true, queued });
  });

  router.delete('/api/admin/applications/:id', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    db.submissions = db.submissions.filter(x => x.appId !== c.params.id);
    audit(c, 'deleted', c.params.id);
    await c.store.save();
    return json({ ok: true });
  });

  router.delete('/api/admin/applications', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const only = cleanStr(c.query.get('type'), 40);
    db.submissions = only ? db.submissions.filter(x => x.type !== only) : [];
    audit(c, 'cleared' + (only ? '_' + only : '_all'), '');
    await c.store.save();
    return json({ ok: true });
  });
}
