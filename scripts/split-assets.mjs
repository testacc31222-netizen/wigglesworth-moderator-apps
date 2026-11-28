#!/usr/bin/env node
/**
 * READ-ONLY with respect to the snapshot: decodes base64 data URLs found in
 * migration-out/snapshot.json into real files under migration-out/assets and
 * emits migration-out/asset-manifest.json describing every URL replacement.
 *
 * The snapshot itself, data.live.json and the original base64 strings are
 * never rewritten or re-encoded. Decoded bytes are written verbatim; content
 * hashes give deterministic, de-duplicated filenames.
 *
 * Set R2_PUBLIC_BASE to the real R2 public/custom-domain origin when known;
 * otherwise a placeholder URL is written and can be substituted later by
 * seed-d1.mjs (also via R2_PUBLIC_BASE).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'migration-out');
const ASSET_DIR = path.join(OUT_DIR, 'assets');
const SNAPSHOT_FILE = path.join(OUT_DIR, 'snapshot.json');
const MANIFEST_FILE = path.join(OUT_DIR, 'asset-manifest.json');
const PLACEHOLDER_BASE = 'https://REPLACE-WITH-R2-PUBLIC-HOST';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || PLACEHOLDER_BASE).replace(/\/$/, '');

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

const EXT_BY_MIME = new Map([
  ['image/jpeg', 'jpg'], ['image/jpg', 'jpg'], ['image/png', 'png'],
  ['image/gif', 'gif'], ['image/webp', 'webp'], ['image/svg+xml', 'svg'],
  ['image/bmp', 'bmp'], ['image/avif', 'avif'], ['image/x-icon', 'ico'],
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/ogg', 'ogv'],
  ['audio/mpeg', 'mp3'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'],
  ['application/octet-stream', 'bin'], ['application/pdf', 'pdf'],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseDataUrl(str) {
  if (typeof str !== 'string' || !str.startsWith('data:')) return null;
  const comma = str.indexOf(',');
  if (comma < 0) return null;
  const meta = str.slice(5, comma);
  const payload = str.slice(comma + 1);
  const parts = meta.split(';');
  const mime = (parts.shift() || '').toLowerCase();
  if (!parts.some(p => p.toLowerCase() === 'base64')) return null;
  if (!/^(image|video|audio|application)\//i.test(mime)) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(payload)) return null;
  return { mime, payload };
}

function extFor(mime) {
  if (EXT_BY_MIME.has(mime)) return EXT_BY_MIME.get(mime);
  // Never invent bytes: derive a conservative extension from the declaration.
  const subtype = mime.split('/')[1] || 'bin';
  return subtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

function pointerFor(parts) {
  return '/' + parts.map(p => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function walk(value, parts, visit) {
  if (typeof value === 'string') {
    visit(value, parts);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, [...parts, i], visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) walk(value[key], [...parts, key], visit);
  }
}

function recordId(table, record, index) {
  if (table === 'config') return 'singleton';
  const spec = TABLES.find(t => t.table === table);
  if (spec && spec.id && record && record[spec.id]) return String(record[spec.id]);
  // Match seed-d1.mjs's row ids exactly so replacements can be looked up.
  if (spec && spec.n) return String(index + 1);
  return `${table}-${String(index + 1).padStart(4, '0')}`;
}

function main() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  fs.mkdirSync(ASSET_DIR, { recursive: true });

  const assets = new Map();
  const replacements = [];
  const skipped = [];
  let dataUrlsFound = 0;

  for (const { table, collection, id: idField } of TABLES) {
    const list = collection ? snapshot[collection] : [snapshot.config];
    if (!Array.isArray(list)) continue;
    list.forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      const id = idField && record[idField] ? String(record[idField]) : recordId(table, record, index);
      walk(record, [], (str, parts) => {
        const parsed = parseDataUrl(str);
        if (!parsed) return;
        dataUrlsFound++;
        const pointer = pointerFor(parts);
        const fieldPath = parts.reduce((acc, p) =>
          /^\d+$/.test(String(p)) ? `${acc}[${p}]` : (acc ? `${acc}.${p}` : String(p)), '');
        const bytes = Buffer.from(parsed.payload.replace(/\s/g, ''), 'base64');
        if (!bytes.length) {
          skipped.push({ table, id, pointer, reason: 'empty decoded payload' });
          return;
        }
        const fileSha256 = sha256(bytes);
        const ext = extFor(parsed.mime);
        const fileName = `${fileSha256.slice(0, 24)}.${ext}`;
        const file = `assets/${fileName}`;
        const key = fileName;
        const url = `${PUBLIC_BASE}/${file}`;
        let asset = assets.get(key);
        if (!asset) {
          asset = {
            file,
            mime: parsed.mime,
            bytes: bytes.length,
            sha256: fileSha256,
            url,
            dataUrlSha256s: [],
            locations: [],
          };
          assets.set(key, asset);
          const target = path.join(ROOT, 'migration-out', file);
          const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
          if (!existing || sha256(existing) !== fileSha256) fs.writeFileSync(target, bytes);
        }
        const dataUrlSha256 = sha256(str);
        if (!asset.dataUrlSha256s.includes(dataUrlSha256)) asset.dataUrlSha256s.push(dataUrlSha256);
        asset.locations.push({ table, id, pointer });
        replacements.push({
          table, id, pointer, fieldPath,
          dataUrlSha256,
          file,
          sha256: fileSha256,
          url,
        });
      });
    });
  }

  const manifest = {
    generatedBy: 'scripts/split-assets.mjs',
    note: 'Original snapshot and data URLs are untouched. Apply `replacements` when seeding D1; upload each `assets/*` file to R2 at the matching key.',
    publicBase: PUBLIC_BASE,
    placeholderBase: PLACEHOLDER_BASE,
    assets: Object.fromEntries([...assets.keys()].sort().map(k => [k, assets.get(k)])),
    replacements,
    skipped,
    summary: {
      dataUrlsFound,
      replacements: replacements.length,
      uniqueAssets: assets.size,
      totalBytes: [...assets.values()].reduce((n, a) => n + a.bytes, 0),
    },
  };
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Decoded ${dataUrlsFound} base64 data URLs into ${assets.size} asset file(s).`);
  console.log(`Wrote ${path.relative(ROOT, MANIFEST_FILE)} (${replacements.length} replacements).`);
  if (skipped.length) console.warn(`${skipped.length} data URL(s) skipped; see manifest.skipped.`);
}

main();
