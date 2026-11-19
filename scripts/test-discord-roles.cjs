'use strict';

// Regression test for site approval -> Discord role sync.
// Runs the real server against a tiny local mock of the Discord API.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const GUILD = '111111111111111111';
const ROLE = '222222222222222222';
const ROLE2 = '666666666666666666';
const USER = '333333333333333333';
const USER2 = '555555555555555555';
const RACE1 = '888888888888888888';
const RACE2 = '999999999999999999';
const ACCEPT_CHANNEL = '777777777777777777';
const MOCK_PORT = 45971;
const SITE_PORT = 45972;
const GH_PORT = 45970;
const GH_REPO_PATH = 'testacc31222-netizen/wigglesworth-moderator-apps';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wigglesworth-role-'));
const dataFile = path.join(tmp, 'data.json');
const base = {
  config: {
    applicationTypes: [{
      id: 'creator', name: 'Content Creator', prefix: 'CC', blurb: '', intro: '',
      successMessage: 'Thanks', open: true, showApproved: true,
      questions: [{ id: 'discord', label: 'Discord Username', type: 'text', required: true }],
    }, {
      id: 'moderator', name: 'Moderator', prefix: 'MOD', blurb: '', intro: '',
      successMessage: 'Thanks', open: true, showApproved: true,
      questions: [{ id: 'discord', label: 'Discord Username', type: 'text', required: true }],
    }],
  },
  submissions: [
    { appId: 'CC-ABC234', type: 'creator', status: 'pending', discord: 'MockUser',
      discordId: USER, email: '', adminNote: '' },
    { appId: 'CC-DEF567', type: 'creator', status: 'pending', discord: 'OtherUser',
      discordId: '444444444444444444', email: '', adminNote: '' },
    { appId: 'CC-GHI678', type: 'creator', status: 'pending', discord: 'ThirdUser',
      discordId: '', email: '', adminNote: '' },
    { appId: 'CC-JKL892', type: 'creator', status: 'pending', discord: 'MockUser',
      discordId: '', email: '', adminNote: '' },
    { appId: 'MOD-ABC234', type: 'moderator', status: 'pending', discord: 'MockUser',
      discordId: USER2, email: '', adminNote: '' },
    { appId: 'MOD-GHOST2', type: 'moderator', status: 'pending', discord: 'GhostUser',
      discordId: '', email: '', adminNote: '' },
    { appId: 'MOD-NOID23', type: 'moderator', status: 'pending', discord: '@MockUser#1234',
      discordId: '', email: '', adminNote: '' },
    { appId: 'MOD-FUZZ22', type: 'moderator', status: 'pending', discord: 'mock',
      discordId: '', email: '', adminNote: '' },
    { appId: 'MOD-RACE23', type: 'moderator', status: 'pending', discord: 'MockUser',
      discordId: RACE1, email: '', adminNote: '' },
    { appId: 'MOD-RACE24', type: 'moderator', status: 'pending', discord: 'OtherUser',
      discordId: RACE2, email: '', adminNote: '' },
  ],
  tickets: [], reports: [], audit: [], accounts: [], loginCodes: [], outbox: [],
};
fs.writeFileSync(dataFile, JSON.stringify(base, null, 2));

let denyRole = false;
let denyRole2 = false;
const calls = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body });
    const send = (code, obj) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    // Slow the two race-test members down so both approvals are definitely in
    // flight at the same time (this is what used to lose one of them).
    if (req.method === 'PUT'
        && (req.url.includes(`/members/${RACE1}/`) || req.url.includes(`/members/${RACE2}/`))) {
      if (denyRole) return send(403, { message: 'Missing Permissions' });
      return setTimeout(() => send(204), 150);
    }
    if (req.method === 'PUT' && req.url === `/api/v10/guilds/${GUILD}/members/${USER}/roles/${ROLE}`) {
      if (denyRole) return send(403, { message: 'Missing Permissions' });
      return send(204);
    }
    if (req.method === 'PUT' && req.url === `/api/v10/guilds/${GUILD}/members/${USER}/roles/${ROLE2}`) {
      if (denyRole) return send(403, { message: 'Missing Permissions' });
      return send(204);
    }
    if (req.method === 'PUT' && req.url === `/api/v10/guilds/${GUILD}/members/444444444444444444/roles/${ROLE}`) {
      if (denyRole) return send(403, { message: 'Missing Permissions' });
      return send(404, { message: 'Unknown Member' });
    }
    if (req.method === 'PUT' && req.url === `/api/v10/guilds/${GUILD}/members/${USER2}/roles/${ROLE}`) {
      if (denyRole) return send(403, { message: 'Missing Permissions' });
      return send(204);
    }
    if (req.method === 'PUT' && req.url === `/api/v10/guilds/${GUILD}/members/${USER2}/roles/${ROLE2}`) {
      if (denyRole || denyRole2) return send(403, { message: 'Missing Permissions' });
      return send(204);
    }
    if (req.method === 'POST' && req.url === `/api/v10/channels/${ACCEPT_CHANNEL}/messages`) {
      return send(200, { id: 'msg-' + calls.length, content: JSON.parse(body || '{}').content || '' });
    }
    if (req.method === 'GET' && req.url.startsWith(`/api/v10/guilds/${GUILD}/members/search`)) {
      if (req.url.includes('GhostUser')) return send(200, []);
      return send(200, [{ user: { id: USER, username: 'mockuser', global_name: 'MockUser' } }]);
    }
    send(404, { message: 'mock not found' });
  });
});

// --- GitHub mock -------------------------------------------------------------
// The backup contains a record that only exists remotely, plus an approval for
// a local pending application. Boot must union the two, never replace one with
// the other.
const remoteBackup = {
  config: JSON.parse(JSON.stringify(base.config)),
  submissions: [
    { appId: 'CC-REMOT', type: 'creator', status: 'pending', discord: 'RemoteUser',
      discordId: '', email: '', adminNote: '', date: '2026-01-01T00:00:00.000Z' },
    { appId: 'MOD-ABC234', type: 'moderator', status: 'approved', discord: 'MockUser',
      discordId: USER2, email: '', adminNote: 'decided before the deploy',
      date: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  ],
  outbox: [],
};
let ghBranch = false;
let ghWritten = false;
let ghSha = 'sha-1';
let ghData = JSON.parse(JSON.stringify(remoteBackup));
const ghPuts = [];
const ghMock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const url = req.url.split('?')[0];
    const ref = (req.url.match(/[?&]ref=([^&]+)/) || [])[1];
    if (req.method === 'GET' && url === `/repos/${GH_REPO_PATH}/branches/data-backup`) {
      return ghBranch ? send(200, { name: 'data-backup' }) : send(404, { message: 'Branch not found' });
    }
    if (req.method === 'GET' && url === `/repos/${GH_REPO_PATH}/git/ref/heads/main`) {
      return send(200, { object: { sha: 'main-sha' } });
    }
    if (req.method === 'POST' && url === `/repos/${GH_REPO_PATH}/git/refs`) {
      ghBranch = true;
      return send(201, { ref: 'refs/heads/data-backup' });
    }
    if (req.method === 'GET' && url === `/repos/${GH_REPO_PATH}/contents/data.live.json`) {
      if (ref === 'data-backup' && (!ghBranch || !ghWritten)) return send(404, { message: 'Not Found' });
      // The database is over 1 MB, where GitHub's JSON form stops returning
      // content. Emulate that so the raw-download fallback is really tested.
      if (String(req.headers.accept || '').includes('raw')) {
        res.statusCode = 200;
        return res.end(JSON.stringify(ghData));
      }
      return send(200, { sha: ghSha, encoding: 'none', content: '', size: 1_100_000 });
    }
    if (req.method === 'PUT' && url === `/repos/${GH_REPO_PATH}/contents/data.live.json`) {
      const put = JSON.parse(body || '{}');
      const decoded = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
      ghPuts.push(decoded);
      ghData = decoded;
      ghSha = 'sha-' + (ghPuts.length + 1);
      ghWritten = true;
      return send(200, { content: { sha: ghSha } });
    }
    send(404, { message: `mock github not found: ${req.method} ${req.url}` });
  });
});
async function waitUntil(fn, label, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for ' + label);
}
async function settlePushes() {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    if (ghPuts.length === last) return;
    last = ghPuts.length;
    await sleep(150);
  }
}

function env() {
  return {
    ...process.env,
    PORT: String(SITE_PORT),
    HOST: '127.0.0.1',
    DATA_FILE: dataFile,
    EDIT_CODE: 'test-code',
    GITHUB_TOKEN: 'test-github-token',
    GITHUB_REPO: GH_REPO_PATH,
    GITHUB_API_BASE: `http://127.0.0.1:${GH_PORT}`,
    GITHUB_DATA_BRANCH: 'data-backup',
    GITHUB_BACKUP_INTERVAL_MS: '30000',
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_GUILD_ID: GUILD,
    DISCORD_ROLE_CC: ROLE,
    DISCORD_ROLE_MOD: `${ROLE},${ROLE2}`,
    DISCORD_API_BASE: `http://127.0.0.1:${MOCK_PORT}/api/v10`,
    DISCORD_WEBHOOK_URL: '',
    DISCORD_ACCEPT_CHANNEL: ACCEPT_CHANNEL,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not become ready: ' + url);
}
async function decide(appId, body) {
  const r = await fetch(`http://127.0.0.1:${SITE_PORT}/api/admin/applications/${appId}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-edit-code': 'test-code' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('PASS:', msg);
}

(async () => {
  let site;
  try {
    await new Promise(resolve => mock.listen(MOCK_PORT, '127.0.0.1', resolve));
    await new Promise(resolve => ghMock.listen(GH_PORT, '127.0.0.1', resolve));
    site = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'), env: env(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    site.stdout.on('data', d => { logs += d; });
    site.stderr.on('data', d => { logs += d; });
    await waitFor(`http://127.0.0.1:${SITE_PORT}/health`);

    const boot = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert(boot.submissions.some(s => s.appId === 'CC-REMOT'),
      'an application that only existed in the backup is recovered at boot');
    assert(boot.submissions.some(s => s.appId === 'MOD-RACE23'),
      'a local application is not deleted by the restore');
    assert((boot.submissions.find(s => s.appId === 'MOD-ABC234') || {}).status === 'approved',
      'a decision stored in the backup is not reverted to pending');

    const cfg = await (await fetch(`http://127.0.0.1:${SITE_PORT}/api/config`)).json();
    assert(!cfg.applicationTypes.some(t => t.questions.some(q => q.id === 'discordId')),
      'applications no longer ask for a Discord User ID');
    assert(cfg.applicationTypes[0].questions.some(q => q.id === 'discord'),
      'the Discord username is still collected');

    const ok = await decide('CC-ABC234', { status: 'approved' });
    if (ok.status !== 200) console.error('approval response:', ok.status, JSON.stringify(ok.body), '\nserver logs:\n' + logs);
    assert(ok.status === 200, 'approval returns 200');
    assert(ok.body.role && ok.body.role.assigned === true, 'approval reports role assigned');
    assert(calls.some(c => c.method === 'PUT' && c.url.endsWith(`/roles/${ROLE}`)),
      'bot calls Discord PUT member role');
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const row = saved.submissions.find(s => s.appId === 'CC-ABC234');
    assert(row.status === 'approved' && !!row.roleAssignedAt && row.roleAssignedRoleId === ROLE,
      'role assignment is persisted on the application');

    // A record that appears in the backup while this instance is running must
    // survive the next autosave: pushes merge before writing.
    await settlePushes();
    ghData.submissions.push({
      appId: 'CC-LATER', type: 'creator', status: 'pending', discord: 'LaterUser',
      discordId: '', email: '', adminNote: '', date: '2026-02-01T00:00:00.000Z',
    });
    const putsBefore = ghPuts.length;
    await decide('CC-ABC234', { status: 'approved' });
    await waitUntil(() => ghPuts.length > putsBefore, 'the autosave push');
    const pushed = ghPuts[ghPuts.length - 1];
    assert(pushed.submissions.some(s => s.appId === 'CC-LATER'),
      'an autosave merges the backup instead of overwriting it');
    assert(pushed.submissions.some(s => s.appId === 'CC-REMOT'),
      'the autosave keeps backup records the local file never saw');

    assert(!calls.some(c => c.method === 'POST' && c.url.includes('/channels/')),
      'creator approvals do not post a congratulations message');

    const fallback = await decide('CC-JKL892', { status: 'approved' });
    if (fallback.status !== 200 || !(fallback.body.role && fallback.body.role.assigned)) {
      console.error('fallback response:', fallback.status, JSON.stringify(fallback.body));
      console.error('calls:', calls.map(c => c.method + ' ' + c.url).join('\n'));
    }
    assert(fallback.status === 200 && fallback.body.role && fallback.body.role.assigned === true,
      'username fallback resolves the member and assigns the role');
    assert(calls.some(c => c.method === 'GET' && c.url.includes('/members/search?query=MockUser')),
      'bot searches the guild when no Discord ID is stored');

    // A type can map to more than one role (Moderator has two).
    const mod = await decide('MOD-ABC234', { status: 'approved' });
    assert(mod.status === 200 && mod.body.role && mod.body.role.assigned === true,
      'approval assigns every configured role for the type');
    const modPuts = calls.filter(c => c.method === 'PUT'
      && c.url.includes(`/members/${USER2}/roles/`));
    assert(modPuts.length === 2, 'both moderator roles are sent to Discord');
    const savedMod = JSON.parse(fs.readFileSync(dataFile, 'utf8')).submissions
      .find(s => s.appId === 'MOD-ABC234');
    assert(Array.isArray(savedMod.roleAssignedRoleIds)
      && savedMod.roleAssignedRoleIds.includes(ROLE)
      && savedMod.roleAssignedRoleIds.includes(ROLE2),
      'both role IDs are persisted on the application');

    const congrats = calls.filter(c => c.method === 'POST'
      && c.url === `/api/v10/channels/${ACCEPT_CHANNEL}/messages`);
    assert(congrats.length === 1, 'approving a moderator posts one congratulations message');
    const congratsBody = JSON.parse(congrats[0].body);
    assert(/Congratulations/.test(congratsBody.content) && congratsBody.content.includes(`<@${USER2}>`),
      'the congratulations message mentions the new moderator');
    assert(congratsBody.allowed_mentions && (congratsBody.allowed_mentions.parse || []).length === 0
      && congratsBody.allowed_mentions.users.includes(USER2),
      'only the new moderator can be pinged');

    await decide('MOD-ABC234', { status: 'approved' });
    const afterRepeat = calls.filter(c => c.method === 'POST'
      && c.url === `/api/v10/channels/${ACCEPT_CHANNEL}/messages`);
    assert(afterRepeat.length === 1, 're-approving does not post a second congratulations');

    const noId = await decide('MOD-NOID23', { status: 'approved' });
    assert(noId.status === 200 && noId.body.role && noId.body.role.assigned === true,
      'a moderator with no Discord ID is matched by username');
    const congratsNoId = calls.filter(c => c.method === 'POST'
      && c.url === `/api/v10/channels/${ACCEPT_CHANNEL}/messages`)[1];
    assert(congratsNoId && congratsNoId.body.includes(`<@${USER}>`),
      'the username lookup still pings the right member');
    const savedNoId = JSON.parse(fs.readFileSync(dataFile, 'utf8')).submissions
      .find(s => s.appId === 'MOD-NOID23');
    assert(savedNoId.discordId === USER, 'the resolved Discord ID is stored on the application');

    const fuzzy = await decide('MOD-FUZZ22', { status: 'approved' });
    assert(fuzzy.status === 200 && fuzzy.body.role && fuzzy.body.role.assigned === true,
      'a partial username still resolves to one member');

    const ghost = await decide('MOD-GHOST2', { status: 'approved' });
    assert(ghost.status === 200, 'approval still succeeds when the member cannot be found');
    const ghostPosts = calls.filter(c => c.method === 'POST'
      && c.url === `/api/v10/channels/${ACCEPT_CHANNEL}/messages`);
    assert(ghostPosts.length === 3,
      'no congratulations is posted for a member who is not in the server');
    const savedGhost = JSON.parse(fs.readFileSync(dataFile, 'utf8')).submissions
      .find(s => s.appId === 'MOD-GHOST2');
    assert(!!savedGhost.acceptAnnounceError, 'the skipped congratulations is recorded for staff');

    // Two staff clicking Approve at the same moment. Each request awaits
    // Discord, so without a shared database the second save used to erase the
    // first approval.
    const [raceA, raceB] = await Promise.all([
      decide('MOD-RACE23', { status: 'approved' }),
      decide('MOD-RACE24', { status: 'approved' }),
    ]);
    assert(raceA.status === 200 && raceB.status === 200,
      'two simultaneous approvals both succeed');
    const raced = JSON.parse(fs.readFileSync(dataFile, 'utf8')).submissions;
    assert((raced.find(s => s.appId === 'MOD-RACE23') || {}).status === 'approved'
      && (raced.find(s => s.appId === 'MOD-RACE24') || {}).status === 'approved',
      'simultaneous approvals do not overwrite each other');

    denyRole2 = true;
    const retry = await fetch(`http://127.0.0.1:${SITE_PORT}/api/admin/applications/MOD-ABC234/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-edit-code': 'test-code' },
      body: '{}',
    });
    const retryBody = await retry.json().catch(() => ({}));
    assert(retry.status === 200 && retryBody.role && retryBody.role.assigned === false
      && retryBody.role.partial === true, 'a partial role failure is reported, not hidden');
    assert(/1 of 2/.test(retryBody.role.error || ''), 'partial failure says how many roles failed');
    denyRole2 = false;

    denyRole = true;
    const bad = await decide('CC-DEF567', { status: 'approved' });
    assert(bad.status === 200 && bad.body.role && bad.body.role.assigned === false,
      'role failure does not block approval');
    assert(/Manage Roles/i.test(bad.body.role.error || ''), '403 explains the missing permission');
    const saved2 = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const row2 = saved2.submissions.find(s => s.appId === 'CC-DEF567');
    assert(row2.status === 'approved' && /Manage Roles/i.test(row2.roleError || ''),
      'role error is persisted for staff retry');

    const invalid = await decide('CC-GHI678', { status: 'approved', discordId: 'not-an-id' });
    assert(invalid.status === 400, 'invalid Discord ID is rejected');

    console.log('\nAll Discord role-sync checks passed.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    try { if (site) site.kill(); } catch {}
    await new Promise(resolve => mock.close(resolve));
    await new Promise(resolve => ghMock.close(resolve));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
})();

