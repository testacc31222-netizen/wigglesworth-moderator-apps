// Durable Object backing worker/rate-limits.js. One call checks all windows;
// only the limiters that actually apply to the current route are incremented.

import { LIMITS, LIMIT_NAMES } from '../rate-limits.js';

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.windows = {};
    this.ready = state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('windows');
      if (saved && typeof saved === 'object') this.windows = saved;
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (url.pathname === '/reset') {
      this.windows = {};
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return reply({ ok: true });
    }
    if (url.pathname !== '/check') return reply({ error: 'Not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    const ip = String(body && body.ip || 'unknown').slice(0, 200);
    const names = Array.isArray(body?.names) && body.names.length ? body.names : LIMIT_NAMES;
    const active = new Set(Array.isArray(body?.active) ? body.active : names);
    const defs = body?.limits && typeof body.limits === 'object' ? body.limits : LIMITS;
    const now = Date.now();
    const results = {};
    let changed = false;

    for (const name of names) {
      const def = defs[name] || LIMITS[name] || { max: 120, windowMs: 60_000 };
      const max = Number(def.max) || 1;
      const windowMs = Number(def.windowMs) || 60_000;
      const key = ip + '|' + name;
      let rec = this.windows[key];

      if (active.has(name)) {
        if (!rec || now >= rec.reset) rec = { count: 1, reset: now + windowMs };
        else rec.count += 1;
        this.windows[key] = rec;
        changed = true;
      }

      const retryAfter = rec
        ? Math.max(active.has(name) ? 1 : 0, Math.ceil((rec.reset - now) / 1000))
        : 0;
      results[name] = {
        ok: !rec || rec.count <= max,
        count: rec ? rec.count : 0,
        limit: max,
        remaining: Math.max(0, max - (rec ? rec.count : 0)),
        retryAfter,
        resetAt: rec ? rec.reset : 0,
      };
    }

    if (changed) {
      // Drop expired windows so the stored object cannot grow without bound.
      for (const [k, v] of Object.entries(this.windows)) {
        if (!v || v.reset <= now) delete this.windows[k];
      }
      await this.state.storage.put('windows', this.windows);
      await this.state.storage.setAlarm(now + 5 * 60_000);
    }
    return reply({ results });
  }

  async alarm() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of Object.entries(this.windows)) {
      if (!v || v.reset <= now) { delete this.windows[k]; changed = true; }
    }
    if (changed) await this.state.storage.put('windows', this.windows);
    if (Object.keys(this.windows).length) await this.state.storage.setAlarm(now + 5 * 60_000);
    else await this.state.storage.deleteAlarm();
  }
}

export default RateLimiter;
