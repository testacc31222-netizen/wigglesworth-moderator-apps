// Worker port of the root staff-profiles.js. Validators are kept verbatim;
// index.js calls register(router) directly, so no routes/*.js registers these.

import { json } from './http.js';
import { offloadDataUrls } from './uploads.js';
import { audit, isStaffAdmin } from './routes/misc.js';

function url(value, image = false) {
  if (typeof value !== 'string') return '';
  if (image && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) && value.length <= 70000) return value;
  if (value.length > 1500) return '';
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}

function clean(value) {
  const text = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  if (!value || !text(value.name, 60)) throw new Error('Enter a staff name.');
  const photo = url(value.photo, true);
  let clip = null;
  if (value.clip?.url) {
    const link = url(value.clip.url); if (!link) throw new Error('Use a complete HTTPS clip URL.');
    const u = new URL(link), host = u.hostname.replace(/^www\./, '');
    if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? u.pathname.split('/')[1] : u.searchParams.get('v') || (/^\/(shorts|embed)\//.test(u.pathname) ? u.pathname.split('/')[2] : '');
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error('Enter a YouTube video or Shorts link.');
      const stamp = u.searchParams.get('t') || u.searchParams.get('start') || '0';
      const start = /^\d+$/.test(stamp) ? Number(stamp) : [...stamp.matchAll(/(\d+)(h|m|s)/g)].reduce((sum, m) => sum + Number(m[1]) * ({ h: 3600, m: 60, s: 1 }[m[2]]), 0);
      clip = { kind: 'youtube', url: link, youtubeId: id, start: Math.min(start, 86400) };
    } else clip = { kind: 'video', url: link, start: 0 };
    if (value.clip.start !== undefined && value.clip.start !== '') {
      const start = Number(value.clip.start); if (!Number.isFinite(start) || start < 0 || start > 86400) throw new Error('Start time must be between 0 and 86400 seconds.'); clip.start = Math.floor(start);
    }
  }
  const banner = url(value.banner, true);
  if (value.banner && !banner) throw new Error('Use an HTTPS banner URL or an uploaded PNG, JPEG or WebP under 70 KB.');
  if (value.photo && !photo) throw new Error('Use an HTTPS image URL or an uploaded PNG, JPEG or WebP.');
  const badges = (Array.isArray(value.badges) ? value.badges : []).slice(0, 8).map(b => {
    const image = url(b.image, true);
    if (b.image && !image) throw new Error('A badge image URL is invalid.');
    return { label: text(b.label, 40), image };
  }).filter(b => b.label);
  const socials = (Array.isArray(value.socials) ? value.socials : []).slice(0, 8).map(s => {
    const link = url(s.url);
    if (!link) throw new Error('Social links must use a complete HTTPS URL.');
    return { label: text(s.label, 30) || 'Website', url: link };
  });
  return { name: text(value.name, 60), role: text(value.role, 80), bio: text(value.bio, 240), details: text(value.details, 3000), featured: value.featured === true, placement: ['left', 'center', 'right'].includes(value.placement) ? value.placement : 'team', cardSize: value.cardSize === 'large' ? 'large' : 'standard', glowColor: /^#[0-9a-f]{6}$/i.test(value.glowColor || '') ? value.glowColor : '#99d8f5', photo, banner, clip, badges, socials, visible: value.visible !== false };
}

export function register(router) {
  router.post('/api/admin/staff-profile-order', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const profiles = db.config.staffProfiles || [], ids = c.body && c.body.ids;
    if (!Array.isArray(ids) || ids.length !== profiles.length || new Set(ids).size !== ids.length || ids.some(id => !profiles.some(p => p.id === id))) {
      return json({ error: 'The team list changed. Reload before reordering.' }, 409);
    }
    db.config.staffProfiles = ids.map(id => profiles.find(p => p.id === id));
    audit(c, 'staff_profiles_reordered', '');
    await c.store.save();
    return json({ profiles: db.config.staffProfiles });
  });

  router.put('/api/admin/staff-profiles/:id', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    try {
      const profiles = Array.isArray(db.config.staffProfiles) ? db.config.staffProfiles : [];
      const index = profiles.findIndex(p => p.id === c.params.id);
      if (c.params.id !== 'new' && index < 0) return json({ error: 'Profile not found' }, 404);
      if (c.params.id === 'new' && profiles.length >= 40) return json({ error: 'Maximum 40 profiles.' }, 400);
      const profile = { ...clean(c.body), id: index < 0 ? crypto.randomUUID() : profiles[index].id };
      if (profile.placement !== 'team' && profiles.some(p => p.id !== profile.id && p.placement === profile.placement)) {
        return json({ error: 'That podium position is occupied. Move its current profile to the team grid first.' }, 409);
      }
      if (index < 0) profiles.push(profile); else profiles[index] = profile;
      db.config.staffProfiles = profiles;
      // Offload uploaded data URLs only after every validator has passed.
      await offloadDataUrls(c.env, c.store);
      audit(c, 'staff_profile_saved', profile.id);
      await c.store.save();
      return json({ profiles });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  });

  router.delete('/api/admin/staff-profiles/:id', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    db.config.staffProfiles = (db.config.staffProfiles || []).filter(p => p.id !== c.params.id);
    audit(c, 'staff_profile_deleted', c.params.id);
    await c.store.save();
    return json({ profiles: db.config.staffProfiles });
  });
}

export { clean, url };
