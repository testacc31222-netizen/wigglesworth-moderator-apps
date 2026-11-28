#!/usr/bin/env node
/**
 * Generate migration-out/seed.sql from the canonical snapshot.
 *
 * READ-ONLY with respect to databases: this script NEVER connects to D1,
 * Wrangler, or any remote service. It only writes migration-out/seed.sql.
 *
 * Row JSON is emitted verbatim from the canonical snapshot (same field order,
 * same values, no dropped fields). The ONLY permitted edit is applying the
 * URL replacements recorded by scripts/split-assets.mjs, so inline images
 * become absolute HTTPS R2 URLs and D1's 2 MB per-row limit is respected.
 * Set R2_PUBLIC_BASE to substitute the manifest's placeholder origin.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'migration-out');
const SNAPSHOT_FILE = path.join(OUT_DIR, 'snapshot.json');
const MANIFEST_FILE = path.join(OUT_DIR, 'asset-manifest.json');
const SEED_FILE = path.join(OUT_DIR, 'seed.sql');
const PLACEHOLDER_BASE = 'https://REPLACE-WITH-R2-PUBLIC-HOST';
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE ? process.env.R2_PUBLIC_BASE.replace(/\/$/, '') : '';

const TABLES = [
  { table: 'config', collection: null },
  { table: 'submissions', collection: 'submissions', id: 'appId' },
  { table: 'tickets', collection: 'tickets', id: 'id' },
  { table: 'reports', collection: 'reports', id: 'id' },
  { table: 'audit', collection: 'audit', n: true },
  { table: 'accounts', collection: 'accounts', id: 'id' },
  { table: 'loginCodes', collection: 'loginCodes', id: 'email' },
  { table: 'outbox', collection: 'outbox', id: 'id' },
  { table: 'diag', collection: 'diag' },
  { table: 'staffAccounts', collection: 'staffAccounts', id: 'id' },
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function decodeToken(t) {
  return t.replace(/~1/g, '/').replace(/~0/g, '~');
}
function setAtPointer(obj, pointer, value) {
  const tokens = pointer === '/' ? [] : String(pointer).split('/').slice(1).map(decodeToken);
  if (!tokens.length) return false;
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return false;
    cur = cur[tokens[i]];
  }
  if (!cur || typeof cur !== 'object') return false;
  const last = tokens[tokens.length - 1];
  if (typeof cur[last] !== 'string') return false;
  cur[last] = value;
  return true;
}
function resolveUrl(url) {
  if (PUBLIC_BASE && url.startsWith(PLACEHOLDER_BASE + '/')) {
    return PUBLIC_BASE + url.slice(PLACEHOLDER_BASE.length);
  }
  return url;
}
function rowId(spec, record, index) {
  if (spec.id && record && record[spec.id]) return String(record[spec.id]);
  if (spec.table === 'config') return 'singleton';
  if (spec.n) return String(index + 1); // explicit audit.n preserves old order
  return `${spec.table}-${String(index + 1).padStart(4, '0')}`;
}

function main() {
  const snapshotText = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
  const original = JSON.parse(snapshotText);
  const db = structuredClone(original);
  const snapshotSha256 = sha256(snapshotText);

  let replacements = [];
  let hasPlaceholder = false;
  if (fs.existsSync(MANIFEST_FILE)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    replacements = Array.isArray(manifest.replacements) ? manifest.replacements : [];
    for (const r of replacements) {
      const target = db[r.table];
      let record;
      if (r.table === 'config') record = target;
      else if (Array.isArray(target)) {
        // Prefer the recorded id, fall back to the same positional id rule
        // used by export-merged-snapshot.mjs / split-assets.mjs.
        record = target.find(x => x && String(x[
          TABLES.find(t => t.table === r.table)?.id || '']) === String(r.id))
          || target.find(x => rowId(TABLES.find(t => t.table === r.table) || {}, x,
            target.indexOf(x)) === String(r.id));
      }
      if (!record || !setAtPointer(record, r.pointer, resolveUrl(r.url))) {
        console.warn(`Replacement not applied (${r.table}/${r.id} ${r.pointer}); leaving original value`);
      }
      if (String(r.url).startsWith(PLACEHOLDER_BASE + '/')) hasPlaceholder = true;
    }
  } else {
    console.warn('No migration-out/asset-manifest.json: seeding raw snapshot. '
      + 'Inline data URLs may exceed D1\'s 2 MB row limit — run split-assets.mjs first.');
  }
  if (hasPlaceholder && !PUBLIC_BASE) {
    console.warn('Placeholder R2 URLs remain. Re-run with R2_PUBLIC_BASE=https://<r2-origin> '
      + 'to write usable absolute URLs.');
  }

  const rows = [];
  for (const spec of TABLES) {
    const list = spec.collection ? db[spec.collection] : [db.config];
    if (!Array.isArray(list)) continue;
    list.forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      rows.push({
        table: spec.table,
        id: rowId(spec, record, index),
        n: !!spec.n,
        json: JSON.stringify(record), // canonical snapshot order, unmodified fields
      });
    });
  }

  const statements = rows.map(r =>
    `INSERT OR REPLACE INTO ${r.table} (${r.n ? 'n' : 'id'}, json) VALUES `
    + `(${r.n ? Number(r.id) : q(r.id)}, ${q(r.json)});`);

  const header = [
    '-- Generated by scripts/seed-d1.mjs — DO NOT EDIT BY HAND.',
    '-- This file is only generated; the script never executes SQL or contacts D1.',
    `-- Source: migration-out/snapshot.json (sha256 ${snapshotSha256})`,
    `-- Replacements applied: ${replacements.length}`,
    `-- Rows: ${rows.length}`,
    '-- Row JSON is preserved verbatim from the canonical snapshot except for',
    '-- manifest-governed R2 URL substitutions. audit.n preserves original order.',
    '',
    'BEGIN TRANSACTION;',
  ];
  fs.writeFileSync(SEED_FILE, [...header, ...statements, 'COMMIT;', ''].join('\n'), 'utf8');

  const maxBytes = rows.reduce((n, r) => Math.max(n, Buffer.byteLength(r.json, 'utf8')), 0);
  const remaining = rows.filter(r => /data:(image|video|audio)\//.test(r.json));
  console.log(`Wrote ${path.relative(ROOT, SEED_FILE)}: ${rows.length} INSERTs.`);
  console.log(`Largest row JSON: ${maxBytes} bytes (D1 per-row limit: 2 MB).`);
  if (remaining.length) {
    console.warn(`${remaining.length} row(s) still contain inline data URLs; offload before seeding.`);
  }
}

main();
