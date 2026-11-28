// Minimal Express-like routing/response helpers for the Workers port.
// Response shapes are deliberately kept identical to server.js.

const decoder = new TextDecoder('utf-8', { fatal: false });

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message || 'Error');
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function text(body, status = 200, extraHeaders = {}) {
  return new Response(String(body), {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders },
  });
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(String(body), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export function fail(status, message, extra = {}) {
  return json({ error: message, ...extra }, status);
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    const headers = { ...(err.headers || {}) };
    if (err.textBody) {
      return text(err.message, err.status, headers);
    }
    return json({ error: err.message, ...err.extra }, err.status, headers);
  }
  // Keep the original size-limit message even though Workers use a different
  // body parser; callers rely on this exact string.
  if (err && (err.type === 'entity.too.large' || err.message === 'BODY_TOO_LARGE')) {
    return json({ error: 'Too big (60MB max)' }, 413);
  }
  console.error('worker error', err);
  return json({ error: 'Server error' }, 500);
}

export async function readBytes(req, limit = 200 * 1024) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > limit) throw new HttpError(413, 'Too big (60MB max)');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > limit) throw new HttpError(413, 'Too big (60MB max)');
  return new Uint8Array(buf);
}

export async function readRaw(req, limit = 60 * 1024 * 1024) {
  return readBytes(req, limit);
}

export async function readJson(req, limit = 200 * 1024) {
  const bytes = await readBytes(req, limit);
  if (!bytes.length) return {};
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map(part => {
      if (!part) return '';
      if (part.startsWith(':')) {
        names.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp('^' + (source || '/') + '/?$'), names };
}

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const { re, names } = compile(pattern);
    this.routes.push({ method: method.toUpperCase(), re, names, handler, pattern });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    const m = method.toUpperCase();
    for (const r of this.routes) {
      if (r.method !== m) continue;
      const found = r.re.exec(pathname);
      if (!found) continue;
      const params = {};
      r.names.forEach((n, i) => {
        try { params[n] = decodeURIComponent(found[i + 1]); } catch { params[n] = found[i + 1]; }
      });
      return { handler: r.handler, params, pattern: r.pattern };
    }
    return null;
  }
}
