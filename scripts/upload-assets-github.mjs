// Upload the offloaded image assets to the site repository using the
// existing GITHUB_TOKEN. New file; reads only migration-out/** and never
// touches data.live.json or any live data.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const token = process.env.GITHUB_TOKEN || '';
if (!token) { console.error('GITHUB_TOKEN required'); process.exit(1); }

const repo = process.env.GITHUB_REPO || 'testacc31222-netizen/wigglesworth-moderator-apps';
const branch = process.env.GITHUB_BRANCH || 'main';
const api = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const dir = path.join(process.cwd(), 'migration-out', 'assets');

const headers = {
  'User-Agent': 'wigglesworth-migration',
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function putFile(local, remote) {
  const bytes = await readFile(local);
  let sha = '';
  const get = await fetch(`${api}/repos/${repo}/contents/${remote}?ref=${encodeURIComponent(branch)}`, { headers });
  if (get.ok) sha = (await get.json()).sha || '';
  const body = {
    message: `migration: offloaded image ${remote}`,
    content: bytes.toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(`${api}/repos/${repo}/contents/${remote}`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${remote}: ${r.status} ${await r.text()}`);
  return bytes.length;
}

const files = (await readdir(dir)).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f));
let total = 0;
for (const f of files) {
  total += await putFile(path.join(dir, f), `assets/${f}`);
  console.log('uploaded assets/' + f);
}
console.log(`uploaded ${files.length} assets, ${total} bytes`);
