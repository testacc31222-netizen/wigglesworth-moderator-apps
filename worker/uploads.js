// Media port of server.js: /api/report-evidence (2473-2490), /api/admin/upload-video
// (2428-2461), detectImage (2463-2470) and the data:image offload needed by the
// 70,000-char validator in public/staff-profiles.js.
// Local disk/evidence/ becomes R2 (env.MEDIA); GitHub mirroring stays as a
// background job and never reads or overwrites data.live.json.

import { cfg, publicUrl } from './env.js';
import { json, text } from './http.js';

// Report edits in routes/reports.js must use this exact original validation.
const EVIDENCE_REPORT_RE = /^\/evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/;
// The GET route also serves audio teaser uploads; it is still strictly ev-*.
const EVIDENCE_SERVE_RE = /^\/evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm|m4a|mp3|wav|ogg)$/;

export function isValidEvidencePath(p) { return EVIDENCE_REPORT_RE.test(String(p || '')); }

// node:crypto comes from nodejs_compat; keep WebCrypto fallbacks so a partial
// polyfill cannot break uploads at module load time.
const nodeCrypto = (() => {
  try {
    return (globalThis.process && typeof globalThis.process.getBuiltinModule === 'function'
      ? globalThis.process.getBuiltinModule('node:crypto') : null) || null;
  } catch { return null; }
})();

function randomInt(n) {
  if (nodeCrypto && typeof nodeCrypto.randomInt === 'function') return nodeCrypto.randomInt(n);
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return (new DataView(a.buffer).getUint32(0) >>> 0) % Math.max(1, n);
}

async function sha256Hex(s) {
  if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
    return nodeCrypto.createHash('sha256').update(s).digest('hex');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64');
  const binary = atob(s);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function u8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && typeof buf.byteLength === 'number' && buf.buffer) {
    return new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
  }
  return new Uint8Array(0);
}

function ascii(b, start, len) {
  let s = '';
  const end = Math.min(b.length, start + len);
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

function imageExt(buf) {
  const b = u8(buf);
  if (!b.length || b.length < 12) return '';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (/^GIF8[79]a/.test(ascii(b, 0, 6))) return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return '';
}
function isMp4(b) { return b.length > 12 && ascii(b, 4, 4) === 'ftyp'; }
function isWebm(b) { return b.length > 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3; }
function isMp3(b) { return b.length > 3 && (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)); }
function isWav(b) { return b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE'; }
function isOgg(b) { return b.length > 4 && ascii(b, 0, 4) === 'OggS'; }

export function isImage(buf) { return !!imageExt(buf); }
export function isVideo(buf) {
  const b = u8(buf);
  return isMp4(b) || isWebm(b);
}
export function isAudio(buf) {
  const b = u8(buf);
  return isMp3(b) || isWav(b) || isOgg(b);
}

const CONTENT_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg',
};
function contentType(ext, fallback = '') { return CONTENT_TYPES[ext] || fallback || 'application/octet-stream'; }

function randomName() {
  return Date.now().toString(36) + '-' + randomInt(46656).toString(36);
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) { out.set(ch, at); at += ch.length; }
  return out;
}

// Use c.raw when index.js already parsed the body; otherwise pull the first
// 16 bytes from the request stream to sniff the type, then hand the *remaining
// stream* (prefix + reader) to R2. No 60 MB ArrayBuffer is created here.
async function readSource(c, prefixLen = 16) {
  if (c.raw && (c.raw.byteLength ?? c.raw.length)) {
    const bytes = u8(c.raw);
    return { bytes, stream: null, prefix: bytes.subarray(0, Math.min(prefixLen, bytes.length)) };
  }
  const req = c.req;
  if (!req || !req.body || req.bodyUsed) {
    return { bytes: new Uint8Array(0), stream: null, prefix: new Uint8Array(0) };
  }
  const reader = req.body.getReader();
  const chunks = [];
  let len = 0;
  while (len < prefixLen) {
    const { value, done } = await reader.read();
    if (done) break;
    const ch = u8(value);
    if (ch.length) { chunks.push(ch); len += ch.length; }
  }
  const prefix = concat(chunks, len);
  const stream = new ReadableStream({
    start(ctrl) { for (const ch of chunks) ctrl.enqueue(ch); },
    async pull(ctrl) {
      try {
        const { value, done } = await reader.read();
        if (done) { ctrl.close(); return; }
        ctrl.enqueue(u8(value));
      } catch (e) { ctrl.error(e); }
    },
    cancel(reason) { try { reader.cancel(reason); } catch {} },
  });
  return { bytes: null, stream, prefix };
}

function githubHeaders(env) {
  return {
    'User-Agent': 'wigglesworth-apps',
    Authorization: `Bearer ${cfg(env, 'GITHUB_TOKEN').trim()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

function githubApi(env) {
  return cfg(env, 'GITHUB_API_BASE', 'https://api.github.com').replace(/\/$/, '');
}

export function githubRawUrl(env, key) {
  const repo = cfg(env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps');
  const branch = cfg(env, 'GITHUB_BRANCH', 'main');
  return `https://raw.githubusercontent.com/${repo}/${branch}/${key}`;
}

async function collectBytes(source) {
  if (source.bytes) return u8(source.bytes);
  if (!source.stream) return new Uint8Array(0);
  const reader = source.stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const ch = u8(value);
    if (ch.length) { chunks.push(ch); total += ch.length; }
  }
  return concat(chunks, total);
}

// GitHub Contents API fallback: same repo/branch the original server.js used
// for backups and evidence. No R2 account or payment method required.
async function githubPut(env, key, bytes, ct, message) {
  const repo = cfg(env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps');
  const branch = cfg(env, 'GITHUB_BRANCH', 'main');
  const api = githubApi(env);
  let sha = '';
  try {
    const r = await fetch(`${api}/repos/${repo}/contents/${key}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(env),
    });
    if (r.ok) sha = (await r.json()).sha || '';
  } catch {}
  const body = { message, content: base64Of(bytes), branch };
  if (sha) body.sha = sha;
  const r = await fetch(`${api}/repos/${repo}/contents/${key}`, {
    method: 'PUT', headers: githubHeaders(env), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('GitHub store failed (' + r.status + ')');
  return true;
}

// R2 when available; otherwise GitHub. Returns true when the object was
// written straight to GitHub so callers can skip the redundant mirror job.
async function putObject(env, key, source, ct) {
  const media = env && env.MEDIA;
  if (media && typeof media.put === 'function') {
    await media.put(key, source.stream || source.bytes, {
      httpMetadata: { contentType: ct },
      customMetadata: { uploadedAt: new Date().toISOString() },
    });
    return false;
  }
  if (!cfg(env, 'GITHUB_TOKEN').trim()) throw new Error('MEDIA not configured');
  const bytes = await collectBytes(source);
  source.bytes = bytes; // allow callers that need the same bytes again
  await githubPut(env, key, bytes, ct, 'store ' + key);
  return true;
}

// Used by /evidence and /assets routes. Tries R2, then GitHub raw content.
export async function getMedia(env, key) {
  const media = env && env.MEDIA;
  if (media && typeof media.get === 'function') {
    try {
      const obj = await media.get(key);
      if (obj) return {
        body: obj.body,
        size: obj.size,
        contentType: obj.httpMetadata?.contentType || contentType(key.split('.').pop()),
      };
    } catch (e) { console.error('R2 read failed', e.message); }
  }
  if (!cfg(env, 'GITHUB_TOKEN').trim()) return null;
  const r = await fetch(githubRawUrl(env, key), { headers: githubHeaders(env) });
  if (!r.ok) return null;
  return {
    body: r.body,
    size: Number(r.headers.get('content-length')) || undefined,
    contentType: r.headers.get('content-type') || contentType(key.split('.').pop()),
  };
}

function base64Of(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// One-way local (R2) -> GitHub mirror. Reads only the object we just stored;
// never reads or writes data.live.json.
async function mirrorObject(env, key, repo, path, message) {
  try {
    if (!cfg(env, 'GITHUB_TOKEN').trim()) return;
    const obj = await env.MEDIA.get(key);
    if (!obj) return;
    const api = cfg(env, 'GITHUB_API_BASE', 'https://api.github.com').replace(/\/$/, '');
    const r = await fetch(`${api}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'User-Agent': 'wigglesworth-apps',
        Authorization: `Bearer ${cfg(env, 'GITHUB_TOKEN').trim()}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: base64Of(await obj.arrayBuffer()),
        branch: cfg(env, 'GITHUB_BRANCH', 'main'),
      }),
    });
    if (!r.ok) console.error('github mirror failed', r.status, path);
  } catch (e) {
    console.error('github mirror error', e.message);
  }
}

function queueMirror(env, ctx, key, repo, path, message) {
  if (!cfg(env, 'GITHUB_TOKEN').trim()) return;
  const job = mirrorObject(env, key, repo, path, message);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else job.catch(e => console.error('github mirror error', e.message));
}

export async function handleEvidenceUpload(c) {
  const ct = String(c.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(image|video)\//.test(ct)) return json({ error: 'Empty file' }, 400);
  let source;
  try { source = await readSource(c); } catch (e) {
    console.error('evidence read error', e.message);
    return json({ error: 'Store failed' }, 500);
  }
  if (!source.prefix.length) return json({ error: 'Empty file' }, 400);

  let ext = imageExt(source.prefix);
  if (!ext) {
    if (isMp4(source.prefix) && ct.startsWith('video/')) ext = 'mp4';
    else if (isWebm(source.prefix) && ct === 'video/webm') ext = 'webm';
  }
  if (!ext) return json({ error: 'Only pictures or short videos' }, 400);

  const name = 'ev-' + randomName() + '.' + ext;
  const key = 'evidence/' + name;
  try {
    const direct = await putObject(c.env, key, source, contentType(ext, ct));
    if (!direct) {
      const repo = cfg(c.env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps');
      queueMirror(c.env, c.ctx, key, repo, key, 'store report evidence ' + name);
    }
  } catch (e) {
    console.error('evidence store failed', e.message);
    return json({ error: 'Store failed' }, 500);
  }
  return json({ url: '/evidence/' + name });
}

export async function handleEvidenceGet(c) {
  const path = String(c.path || '');
  if (!EVIDENCE_SERVE_RE.test(path)) return text('Not found', 404);
  const key = path.slice(1);
  let obj = null;
  try { obj = await getMedia(c.env, key); }
  catch (e) { console.error('evidence get failed', e.message); }
  if (!obj) return text('Not found', 404);
  const headers = {
    'Content-Type': obj.contentType || contentType(key.split('.').pop()),
    'Cache-Control': 'public, max-age=604800', // express.static maxAge: '7d'
  };
  if (typeof obj.size === 'number') headers['Content-Length'] = String(obj.size);
  return new Response(c.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}

export async function handleVideoUpload(c) {
  const ct = String(c.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(video|audio)\//.test(ct)) return json({ error: 'Empty file' }, 400);
  let source;
  try { source = await readSource(c); } catch (e) {
    console.error('video read error', e.message);
    return json({ error: 'Video store failed' }, 502);
  }
  if (!source.prefix.length) return json({ error: 'Empty file' }, 400);

  const b = source.prefix;
  const audioCt = ct.startsWith('audio/');
  let ext = '';
  if (isMp4(b)) ext = audioCt ? 'm4a' : 'mp4';
  else if (isWebm(b) && (ct === 'video/webm' || ct === 'audio/webm')) ext = 'webm';
  else if (isMp3(b) && audioCt) ext = 'mp3';
  else if (isWav(b) && audioCt) ext = 'wav';
  else if (isOgg(b) && (ct === 'audio/ogg' || ct === 'video/ogg')) ext = 'ogg';
  if (!ext) return json({ error: 'Not a real video/audio file' }, 400);

  const base = randomName();
  const name = base + '.' + ext;
  // Store under the evidence prefix so the existing /evidence/ static route
  // (worker/index.js line 97) can serve the clip without an extra endpoint.
  const key = 'evidence/ev-' + name;
  try {
    const direct = await putObject(c.env, key, source, contentType(ext, ct));
    if (direct) {
      // Already in GitHub; mirror the same bytes to the countdown repo.
      const bytes = await collectBytes(source);
      const cdRepo = cfg(c.env, 'GITHUB_COUNTDOWN_REPO', 'testacc31222-netizen/wigglesworth-countdown');
      await githubPut(c.env, 'vids/' + name, bytes, contentType(ext, ct), 'upload teaser vids/' + name);
      void cdRepo;
    } else {
      const cdRepo = cfg(c.env, 'GITHUB_COUNTDOWN_REPO', 'testacc31222-netizen/wigglesworth-countdown');
      queueMirror(c.env, c.ctx, key, cdRepo, 'vids/' + name, 'upload teaser vids/' + name);
    }
  } catch (e) {
    console.error('video store error', e.message);
    return json({ error: 'Video store failed' }, 502);
  }

  const cdRepo = cfg(c.env, 'GITHUB_COUNTDOWN_REPO', 'testacc31222-netizen/wigglesworth-countdown');
  const branch = cfg(c.env, 'GITHUB_BRANCH', 'main');
  const ghPath = 'vids/' + name;

  // public/staff-profiles.js:177 reads j.rawUrl || j.url — both must be
  // complete HTTPS URLs that pass the profile clip validator.
  const countdown = cfg(c.env, 'COUNTDOWN_PUBLIC_URL', 'https://wigglesworth-countdown.onrender.com').replace(/\/$/, '');
  const ghRaw = cfg(c.env, 'GITHUB_TOKEN').trim()
    ? `https://raw.githubusercontent.com/${cdRepo}/${branch}/${ghPath}` : '';
  const playable = `${publicUrl(c.env, c.req)}/evidence/ev-${name}`;
  return json({
    url: ghRaw ? `${countdown}/${name}` : playable,
    rawUrl: ghRaw || playable,
  });
}

const DATA_IMAGE_RE = /data:image\/(png|jpe?g|gif|webp);base64,([a-zA-Z0-9+/=\s]+)/g;

// Auto-offload every base64 data:image value found in config (staffProfiles
// photo/banner/badges, bannerImage, logoImage, backgroundImage, decor.src, and
// inlineDataUrl embedded in copy/question text). Bytes are decoded, never
// re-encoded, and stored at assets/<sha256>.<ext>.
export async function offloadDataUrls(env, store) {
  const db = store && store.db ? store.db : store;
  if (!db || !db.config || !env) return 0;
  const hasR2 = !!(env.MEDIA && typeof env.MEDIA.put === 'function');
  if (!hasR2 && !cfg(env, 'GITHUB_TOKEN').trim()) return 0;
  const cache = new Map();
  const base = (cfg(env, 'PUBLIC_URL') || cfg(env, 'MEDIA_PUBLIC_URL') || 'https://wigglesworth-applications.onrender.com')
    .replace(/^http:\/\//, 'https://').replace(/\/$/, '');
  const repo = cfg(env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps');

  async function uploadOne(mime, payload) {
    const norm = String(payload).replace(/\s/g, '');
    if (!norm) return null;
    const hash = (await sha256Hex(norm)).slice(0, 40);
    const ext = mime === 'jpg' || mime === 'jpeg' ? 'jpg' : mime;
    const url = `${base}/assets/${hash}.${ext}`;
    if (cache.has(hash)) return cache.get(hash);
    const bytes = decodeBase64(norm);
    const key = `assets/${hash}.${ext}`;
    if (hasR2) {
      await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: `image/${mime === 'jpg' ? 'jpeg' : mime}` },
      });
      queueMirror(env, store && store.ctx, key, repo, key, 'offload image ' + hash);
    } else {
      await githubPut(env, key, bytes, `image/${mime === 'jpg' ? 'jpeg' : mime}`, 'offload image ' + hash);
    }
    cache.set(hash, url);
    return url;
  }

  async function replaceInString(value) {
    const matches = [...String(value).matchAll(DATA_IMAGE_RE)];
    if (!matches.length) return value;
    const urls = await Promise.all(matches.map(m => uploadOne(m[1], m[2])));
    let i = 0;
    return String(value).replace(DATA_IMAGE_RE, () => urls[i++] || '');
  }

  async function walk(value, seen) {
    if (typeof value === 'string') return replaceInString(value);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) value[i] = await walk(value[i], seen);
    } else {
      for (const k of Object.keys(value)) value[k] = await walk(value[k], seen);
    }
    return value;
  }

  const before = JSON.stringify(db.config);
  try {
    await walk(db.config, new WeakSet());
  } catch (e) {
    console.error('data URL offload failed', e.message);
    return cache.size;
  }
  if (JSON.stringify(db.config) !== before) {
    try { await store.save?.(); } catch (e) { console.error('offload save failed', e.message); }
  }
  return cache.size;
}
