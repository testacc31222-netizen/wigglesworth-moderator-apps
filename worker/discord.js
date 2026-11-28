// Discord port of server.js (lines 53-78, 128-326).
// Webhook alerts keep 4 attempts on 429; waits over 30s move to DISCORD_JOBS.
// Bot calls use fetch with a 12s AbortController. Every failure is swallowed
// into a result object so a Discord outage can never fail an HTTP response.

import { cfg, roleList } from './env.js';

const MAX_ATTEMPTS = 4;
const RETRY_PREFIX = '\u0000ws-discord-retry\u0000';

function cleanStr(v, max = 2000) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

function botToken(env) { return cfg(env, 'DISCORD_BOT_TOKEN').trim(); }
function guildId(env) { return cfg(env, 'DISCORD_GUILD_ID').replace(/\D/g, ''); }
function apiBase(env) {
  return cfg(env, 'DISCORD_API_BASE', 'https://discord.com/api/v10').replace(/\/$/, '');
}
function acceptChannel(env) { return cfg(env, 'DISCORD_ACCEPT_CHANNEL').replace(/\D/g, ''); }

const TYPE_LABELS = {
  moderator: 'Moderator',
  creator: 'Content Creator',
  developer: 'Developer',
};

export async function discordApi(env, path, init = {}) {
  const method = String((init && init.method) || 'GET').toUpperCase();
  const body = init && init.body !== undefined
    ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body))
    : undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(apiBase(env) + String(path), {
      method,
      headers: {
        Authorization: `Bot ${botToken(env)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'wigglesworth-applications',
        ...(init && init.headers || {}),
      },
      body,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'network error') };
  } finally { clearTimeout(timer); }
}

function validDiscordId(id) { return /^\d{17,20}$/.test(String(id || '').replace(/\D/g, '')); }
function roleIdsForType(env, type) {
  const key = type === 'moderator' ? 'DISCORD_ROLE_MOD'
    : type === 'creator' ? 'DISCORD_ROLE_CC'
      : type === 'developer' ? 'DISCORD_ROLE_DEV' : '';
  return key ? roleList(cfg(env, key)) : [];
}
function roleConfigured(env) { return !!(botToken(env) && guildId(env)); }

function normDiscordName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .split('#')[0]
    .replace(/\s+/g, ' ')
    .trim();
}
function compactName(value) { return normDiscordName(value).replace(/[^a-z0-9]/g, ''); }

// `who` may be a submission object (as in server.js) or a raw id/username tag.
export async function resolveDiscordMemberId(env, who) {
  const sub = who && typeof who === 'object' ? who : { discordId: who, discord: who };
  const saved = String(sub.discordId || '').replace(/\D/g, '');
  if (validDiscordId(saved)) return { id: saved };
  const raw = String(sub.discord || '').trim();
  const query = raw.replace(/^@+/, '').split('#')[0].trim();
  if (!query) {
    return { error: 'No Discord username on file. Paste their Discord User ID on the card.' };
  }
  let r;
  try {
    r = await discordApi(env,
      `/guilds/${guildId(env)}/members/search?query=${encodeURIComponent(query)}&limit=100`,
      { method: 'GET' });
  } catch (e) {
    return { error: `Discord lookup failed (${e.message || 'unknown'}).` };
  }
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

async function saveStore(store) {
  try { if (store && typeof store.save === 'function') await store.save(); }
  catch (e) { console.error('discord store save error', e.message); }
}

export async function grantRoleForSubmission(env, store, sub, ctx, opts = {}) {
  const force = opts === true || opts.force === true;
  if (!sub) return { assigned: false, error: 'No application found.' };
  try {
    if (!roleConfigured(env)) {
      return { assigned: false, error: 'Discord role sync is not configured (set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID).' };
    }
    const roleIds = roleIdsForType(env, sub.type);
    if (!roleIds.length) {
      return { assigned: false, error: `No Discord role ID configured for ${sub.type || 'this application'}.` };
    }
    const saved = Array.isArray(sub.roleAssignedRoleIds) ? sub.roleAssignedRoleIds : [];
    if (!force && sub.roleAssignedAt && saved.length === roleIds.length
        && roleIds.every(id => saved.includes(id))) {
      return { assigned: true, already: true, userId: sub.discordId || '', roleIds };
    }
    const who = await resolveDiscordMemberId(env, sub);
    if (!who.id) {
      sub.roleError = cleanStr(who.error, 300);
      await saveStore(store);
      return { assigned: false, error: sub.roleError };
    }
    sub.discordId = who.id;
    const failed = [];
    const assigned = [];
    for (const roleId of roleIds) {
      const r = await discordApi(env,
        `/guilds/${guildId(env)}/members/${who.id}/roles/${roleId}`, { method: 'PUT' });
      if (r.ok) assigned.push(roleId);
      else failed.push({ roleId, status: r.status, error: r.error });
    }
    if (!failed.length) {
      sub.roleAssignedAt = new Date().toISOString();
      sub.roleAssignedRoleIds = roleIds;
      sub.roleAssignedRoleId = roleIds[0]; // older builds read the single-role field
      sub.roleError = '';
      await saveStore(store);
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
    await saveStore(store);
    return {
      assigned: false, partial: assigned.length > 0, userId: who.id,
      roleIds, failed: failed.map(f => f.roleId), error: sub.roleError,
    };
  } catch (e) {
    console.error('discord role error', e.message);
    try { sub.roleError = cleanStr(e.message, 300); await saveStore(store); } catch {}
    return { assigned: false, error: sub.roleError || e.message };
  }
}

export async function announceAcceptance(env, store, sub, ctx, opts = {}) {
  const force = opts === true || opts.force === true;
  if (!sub) return { posted: false, error: 'No application found.' };
  try {
    if (sub.type !== 'moderator') return { posted: false, skipped: 'not moderator' };
    if (!force && sub.acceptAnnouncedAt) return { posted: false, already: true };
    if (!acceptChannel(env)) {
      return { posted: false, error: 'No congratulations channel set (DISCORD_ACCEPT_CHANNEL).' };
    }
    if (!botToken(env)) return { posted: false, error: 'DISCORD_BOT_TOKEN is not set.' };
    const who = await resolveDiscordMemberId(env, sub);
    if (!who.id) {
      sub.acceptAnnounceError = cleanStr(who.error || 'Discord member not found.', 300);
      await saveStore(store);
      return { posted: false, error: sub.acceptAnnounceError };
    }
    sub.discordId = who.id;
    const label = TYPE_LABELS[sub.type] || 'Staff';
    const content = `🎉 **Congratulations <@${who.id}>!** Your **${label}** application was accepted — welcome to the Wigglesworth team.`;
    const r = await discordApi(env, `/channels/${acceptChannel(env)}/messages`, {
      method: 'POST',
      body: {
        content,
        // Ping only the new member: no @everyone, no role pings.
        allowed_mentions: { parse: [], users: [String(who.id)] },
      },
    });
    if (!r.ok) {
      sub.acceptAnnounceError = r.status === 404
        ? 'Congratulations channel not found — check DISCORD_ACCEPT_CHANNEL.'
        : `Discord returned ${r.status || r.error || 'an error'}.`;
      await saveStore(store);
      return { posted: false, error: sub.acceptAnnounceError };
    }
    sub.acceptAnnouncedAt = new Date().toISOString();
    sub.acceptAnnounceError = '';
    await saveStore(store);
    return { posted: true, userId: who.id, messageId: r.data && r.data.id };
  } catch (e) {
    console.error('accept announce error', e.message);
    try { sub.acceptAnnounceError = cleanStr(e.message, 300); await saveStore(store); } catch {}
    return { posted: false, error: sub.acceptAnnounceError || e.message };
  }
}

function scheduleRetry(env, ctx, state, delaySeconds) {
  try {
    const q = env && env.DISCORD_JOBS;
    if (!q || typeof q.send !== 'function') return false;
    const p = q.send({ kind: 'discord', text: RETRY_PREFIX + JSON.stringify(state) }, { delaySeconds });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(Promise.resolve(p).catch(() => {}));
    return true;
  } catch (e) {
    console.error('discord job schedule failed', e.message);
    return false;
  }
}

async function discordPost(env, url, body, attempt, ctx) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    if (r.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
      let wait = 5000 * (attempt + 1);
      try {
        const j = await r.json();
        if (j && j.retry_after) wait = Math.min(120000, j.retry_after * 1000 + 500);
      } catch {}
      console.error(`discord alert throttled (try ${attempt + 1}), retrying in ${Math.round(wait / 1000)}s`);
      const state = { url, body, attempt: attempt + 1 };
      if (wait > 30000) {
        // Workers cannot sleep for minutes: hand it to the Queue/Cron retry.
        scheduleRetry(env, ctx, state, Math.ceil(wait / 1000));
        return;
      }
      await new Promise(res => setTimeout(res, wait));
      return discordPost(env, url, body, attempt + 1, ctx);
    }
    if (!r.ok) console.error('discord alert failed', r.status);
    else if (attempt > 0) console.log('discord alert delivered after retry');
  } catch (e) {
    console.error('discord alert error', e.message);
  }
}

export function discordNotify(env, text, ctx) {
  const url = cfg(env, 'DISCORD_WEBHOOK_URL').trim();
  if (!url) return;
  let target = url;
  let body;
  let attempt = 0;
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (raw.startsWith(RETRY_PREFIX)) {
    try {
      const state = JSON.parse(raw.slice(RETRY_PREFIX.length));
      target = state.url || url;
      body = state.body;
      attempt = Number(state.attempt) || 0;
    } catch {
      body = { content: raw.slice(0, 1800) };
    }
  } else {
    const ping = cfg(env, 'DISCORD_PING_ID').replace(/\D/g, '');
    body = { content: (ping ? `<@${ping}> ` : '') + raw.slice(0, 1800) };
  }
  if (!body) return;
  const job = discordPost(env, target, body, attempt, ctx);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else job.catch(e => console.error('discord alert error', e.message));
}
