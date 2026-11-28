// Short-lived read-modify-write lease for worker/db.js save() and outbox flush.
// POST /acquire -> { ok, token }   POST /release { token }

const LEASE_MS = 5000;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function newToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export class StoreLock {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.lock = null;
    this.ready = state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('lock');
      this.lock = saved && typeof saved === 'object' ? saved : null;
    });
  }

  async fetch(request) {
    await this.ready;
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === '/acquire') {
      if (this.lock && this.lock.until > now) {
        return reply({ ok: false, retryAfterMs: this.lock.until - now });
      }
      const token = newToken();
      this.lock = { token, until: now + LEASE_MS };
      await this.state.storage.put('lock', this.lock);
      await this.state.storage.setAlarm(this.lock.until + 100);
      return reply({ ok: true, token, leaseMs: LEASE_MS });
    }

    if (url.pathname === '/release') {
      let body;
      try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      if (this.lock && body && body.token === this.lock.token) {
        this.lock = null;
        await this.state.storage.delete('lock');
        await this.state.storage.deleteAlarm();
        return reply({ ok: true });
      }
      return reply({ ok: false });
    }

    if (url.pathname === '/status') {
      const held = !!(this.lock && this.lock.until > now);
      return reply({ ok: true, held, retryAfterMs: held ? this.lock.until - now : 0 });
    }

    return reply({ error: 'Not found' }, 404);
  }

  async alarm() {
    const now = Date.now();
    if (this.lock && this.lock.until <= now) {
      this.lock = null;
      await this.state.storage.delete('lock');
    }
    if (!this.lock) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(this.lock.until + 100);
  }
}

export default StoreLock;
