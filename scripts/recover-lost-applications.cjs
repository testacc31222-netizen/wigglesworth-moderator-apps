'use strict';

// Recover applications that exist in the git history of data.live.json but are
// missing from the current database. Earlier builds could overwrite newer data
// with a stale copy, which silently removed applications without writing a
// "deleted" audit entry.
//
// Safe by default: prints what it would restore. Pass --apply to write.
//
//   node scripts/recover-lost-applications.cjs
//   node scripts/recover-lost-applications.cjs --since=2026-11-14
//   node scripts/recover-lost-applications.cjs --since=2026-11-14 --apply
//   node scripts/recover-lost-applications.cjs --all --base=backup.json --write=fixed.json
//
// Options:
//   --base=<file>        database to repair (default data.live.json)
//   --write=<file>       write the repaired database here instead of --base
//   --since=<date>       only restore applications submitted on/after this date
//   --all                restore every missing application (ignore --since)
//   --include-deleted    also restore ids the audit log says staff deleted
//   --apply              write the result (without it, this is a dry run)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

const root = path.join(__dirname, '..');
const baseFile = path.resolve(root, String(opt('base', 'data.live.json')));
const writeFile = opt('write') ? path.resolve(root, String(opt('write'))) : baseFile;
const since = opt('since', '');
const restoreAll = opt('all', false) === true;
const includeDeleted = opt('include-deleted', false) === true;
const apply = opt('apply', false) === true;

if (!since && !restoreAll) {
  console.error('Pick a cutoff with --since=YYYY-MM-DD, or use --all.');
  console.error('Example: node scripts/recover-lost-applications.cjs --since=2026-11-14');
  process.exit(2);
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
}
function readCommit(sha) {
  try {
    return JSON.parse(git(['show', `${sha}:data.live.json`]));
  } catch {
    return null;
  }
}
const idOf = s => String((s && s.appId) || '').toUpperCase();

let base;
try {
  base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
} catch (e) {
  console.error(`Could not read ${baseFile}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(base.submissions)) base.submissions = [];
const present = new Set(base.submissions.map(idOf).filter(Boolean));

const commits = git(['log', '--format=%H', '--', 'data.live.json'])
  .trim().split(/\r?\n/).filter(Boolean);
if (!commits.length) {
  console.error('No data.live.json history in this repository.');
  process.exit(1);
}

// Newest first: the first commit that still contains an id has its most recent
// version. Deletion audit entries are seen before (newer than) the record.
const newestSeen = new Map();
const deletedIds = new Set();
for (let i = 0; i < commits.length; i++) {
  const db = readCommit(commits[i]);
  if (!db) continue;
  for (const a of (db.audit || [])) {
    const act = String((a && a.act) || '');
    if (/^deleted$/.test(act) && a.id) deletedIds.add(String(a.id).toUpperCase());
  }
  for (const s of (db.submissions || [])) {
    const id = idOf(s);
    if (!id || present.has(id) || newestSeen.has(id)) continue;
    newestSeen.set(id, { record: s, sha: commits[i] });
  }
  if (i % 250 === 0) console.error(`scanned ${i}/${commits.length} data commits...`);
}

const sinceMs = since ? Date.parse(since) : 0;
if (since && isNaN(sinceMs)) {
  console.error('--since must be a date like 2026-11-14');
  process.exit(2);
}

const restore = [];
const skippedDeleted = [];
const skippedOld = [];
for (const [id, hit] of newestSeen) {
  if (deletedIds.has(id) && !includeDeleted) { skippedDeleted.push(id); continue; }
  const when = Date.parse(hit.record.date || '');
  if (!restoreAll && (!when || when < sinceMs)) { skippedOld.push(id); continue; }
  restore.push({ ...hit, id });
}
restore.sort((a, b) => (Date.parse(a.record.date) || 0) - (Date.parse(b.record.date) || 0));

console.log(`\nDatabase: ${path.relative(root, baseFile)} (${base.submissions.length} applications)`);
console.log(`History:  ${commits.length} data commits`);
console.log(`Missing:  ${newestSeen.size} applications (${skippedDeleted.length} skipped as staff-deleted, ${skippedOld.length} older than the cutoff)`);
console.log(`\n${apply ? 'Restoring' : 'Would restore'} ${restore.length} application(s):`);
for (const r of restore) {
  const s = r.record;
  console.log(`  ${r.id}  ${String(s.type || '?').padEnd(9)} ${String(s.status || '?').padEnd(8)} `
    + `${String(s.date || '').slice(0, 16)}  ${s.discord || s.username || ''}  (last in ${r.sha.slice(0, 7)})`);
}
if (!restore.length) {
  console.log('  (nothing to restore)');
  process.exit(0);
}
if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these records.');
  process.exit(0);
}

const byId = new Map(base.submissions.map(s => [idOf(s), s]));
for (const r of restore) byId.set(r.id, r.record);
base.submissions = [...byId.values()]
  .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));

fs.mkdirSync(path.dirname(writeFile), { recursive: true });
fs.writeFileSync(writeFile, JSON.stringify(base, null, 2));
console.log(`\nWrote ${base.submissions.length} applications to ${path.relative(root, writeFile)}`);
