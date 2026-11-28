// Private tickets (public submit/read/reply) and admin ticket tools.

import { json } from '../http.js';
import { aiChat } from '../ai.js';
import {
  audit, cleanStr, cleanText, normEmail, validTicketId, hasSlur, genId, faqMatch,
  mailConfigured, queueTicketOpenedEmail, queueTicketReplyEmail, scheduleFlush, notify,
  currentUser, isStaffAdmin,
} from './misc.js';

function ticketForAccount(t, a) {
  if (!t || !a) return false;
  if (t.accountId) return t.accountId === a.id;
  if (t.email) return normEmail(t.email) === a.email;
  return true;
}

async function claimTicketForAccount(c, t, a) {
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
  if (changed) await c.store.save();
  return changed;
}

export function register(router) {
  router.post('/api/tickets', async c => {
    const db = c.db;
    const account = currentUser(c);
    if (!account) return json({ error: 'Sign in with your email before opening a ticket.' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const name = cleanStr(b.name, 80).trim();
    const subject = cleanStr(b.subject, 120).trim();
    const message = cleanStr(b.message, 3000).trim();
    if (!name) return json({ error: 'Add your name.' }, 400);
    if (!subject) return json({ error: 'Add a subject.' }, 400);
    if (message.length < 10) return json({ error: 'Message is too short.' }, 400);
    if (hasSlur(name + ' ' + subject + ' ' + message)) return json({ error: 'Message rejected.' }, 400);
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
      audit(c, 'auto_faq', t.id);
    }
    const emailed = queueTicketOpenedEmail(c, t, autoReply);
    await c.store.save();
    scheduleFlush(c);
    notify(c, `New ticket **${t.id}** — ${t.subject}\nFrom **${t.name}**: ${t.replies[0].text.slice(0, 500)}`);
    return json({ id: t.id, email: t.email, emailed, mailConfigured: mailConfigured(c.env) });
  });

  router.get('/api/tickets/:id', async c => {
    if (!validTicketId(c.params.id)) return json({ error: 'Not found' }, 404);
    const db = c.db;
    const account = currentUser(c);
    if (!account) return json({ error: 'Sign in to open your ticket.' }, 401);
    const t = db.tickets.find(x => (x.id || '').toUpperCase() === c.params.id.toUpperCase());
    if (!t || !ticketForAccount(t, account)) return json({ error: 'Not found' }, 404);
    await claimTicketForAccount(c, t, account);
    return json({ id: t.id, name: t.name, subject: t.subject, status: t.status,
      createdAt: t.createdAt, updatedAt: t.updatedAt, replies: t.replies });
  });

  router.post('/api/tickets/:id/reply', async c => {
    if (!validTicketId(c.params.id)) return json({ error: 'Not found' }, 404);
    const db = c.db;
    const t = db.tickets.find(x => (x.id || '').toUpperCase() === c.params.id.toUpperCase());
    if (!t) return json({ error: 'Not found' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const staff = b.staff === true && await isStaffAdmin(c);
    if (b.staff === true && !staff) return json({ error: 'Unauthorized' }, 401);
    const account = currentUser(c);
    if (!staff) {
      if (!account) return json({ error: 'Sign in to reply to your ticket.' }, 401);
      if (!ticketForAccount(t, account)) return json({ error: 'Not found' }, 404);
      if (t.status !== 'open') return json({ error: 'This ticket is closed.' }, 400);
      await claimTicketForAccount(c, t, account);
    }
    const text = cleanStr(b.text, 2000).trim();
    if (text.length < 1) return json({ error: 'Empty reply.' }, 400);
    if (!staff && hasSlur(text)) return json({ error: 'Reply rejected.' }, 400);
    if (t.replies.length >= 200) return json({ error: 'Thread is full.' }, 400);
    const name = staff ? 'Staff' : cleanStr(b.name || t.name, 80);
    const reply = { by: staff ? 'staff' : 'user', name, text, at: new Date().toISOString() };
    t.replies.push(reply);
    t.updatedAt = new Date().toISOString();
    t.unread = !staff;
    const emailed = staff ? queueTicketReplyEmail(c, t, reply) : false;
    if (staff) audit(c, 'ticket_reply', t.id);
    await c.store.save();
    scheduleFlush(c);
    if (!staff) notify(c, `Reply on ticket **${t.id}** (${t.subject}) from **${name}**:\n${text.slice(0, 500)}`);
    return json({ ok: true, emailed, mailConfigured: mailConfigured(c.env) });
  });

  router.post('/api/admin/tickets/:id/suggest', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!cfgKey(c)) return json({ error: 'AI not configured (set AI_API_KEY)' }, 400);
    if (!validTicketId(c.params.id)) return json({ error: 'Not found' }, 404);
    const t = db.tickets.find(x => x.id === c.params.id);
    if (!t) return json({ error: 'Not found' }, 404);
    const thread = (t.replies || []).slice(-8)
      .map(m => `${m.by === 'staff' ? 'Staff' : 'Player'}: ${cleanText(m.text, 400)}`)
      .join('\n').slice(0, 2500);
    const roles = db.config.applicationTypes.map(x => x.name).join(', ');
    const faq = (db.config.faq || []).slice(0, 8)
      .map(f => `Q: ${f.q} A: ${f.a}`).join('\n').slice(0, 1200);
    try {
      let out = await aiChat(c.env,
        'You draft replies for Wigglesworth game community staff answering a player support ticket. Be short, warm and human. Never invent policies, links, dates or promises. If the answer is unknown, ask one clarifying question. Output ONLY the reply text, no quotes, no preamble.',
        `Ticket subject: ${t.subject}\nRoles offered: ${roles}\nKnown answers:\n${faq}\n\nThread so far:\n${thread}\n\nDraft the next staff reply:`,
        0.3, 700);
      const text = cleanText(typeof out === 'string' ? out : (out && (out.content || out.text || out.suggestion)) || '', 1500).trim();
      if (!text) return json({ error: 'AI unavailable' }, 502);
      return json({ suggestion: text });
    } catch (e) {
      return json({ error: 'AI unavailable' }, 502);
    }
  });

  router.get('/api/admin/tickets', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    return json(c.db.tickets.slice().reverse().slice(0, 1000).map(t => ({
      id: t.id, name: t.name, subject: t.subject, status: t.status, unread: !!t.unread,
      email: t.email || '', accountId: t.accountId || '',
      createdAt: t.createdAt, updatedAt: t.updatedAt, replies: t.replies,
    })));
  });

  router.post('/api/admin/tickets/:id/status', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validTicketId(c.params.id)) return json({ error: 'Not found' }, 404);
    const t = db.tickets.find(x => x.id === c.params.id);
    if (!t) return json({ error: 'Not found' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const status = b.status;
    if (!['open', 'closed'].includes(status)) return json({ error: 'Bad status' }, 400);
    t.status = status;
    t.updatedAt = new Date().toISOString();
    audit(c, 'ticket_' + status, t.id);
    await c.store.save();
    return json({ ok: true });
  });

  router.delete('/api/admin/tickets/:id', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    db.tickets = db.tickets.filter(x => x.id !== c.params.id);
    audit(c, 'ticket_deleted', c.params.id);
    await c.store.save();
    return json({ ok: true });
  });
}

function cfgKey(c) { return !!(c.env && c.env.AI_API_KEY); }
