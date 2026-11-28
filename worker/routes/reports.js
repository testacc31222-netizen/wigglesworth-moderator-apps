// Public staff reports plus admin review/status/delete.

import { cfg } from '../env.js';
import { json } from '../http.js';
import {
  audit, cleanStr, validReportId, hasSlur, genId, notify, isStaffAdmin,
} from './misc.js';

export function register(router) {
  router.post('/api/reports', async c => {
    const db = c.db;
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const reporter = cleanStr(b.reporter, 80).trim();
    const staffName = cleanStr(b.staffName, 80).trim();
    const details = cleanStr(b.details, 3000).trim();
    const files = Array.isArray(b.files)
      ? b.files.slice(0, 3).map(f => cleanStr(f, 300)).filter(f => /^\/evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(f))
      : [];
    if (!staffName) return json({ error: 'Name the staff member.' }, 400);
    if (details.length < 20) return json({ error: 'Describe what happened (20+ characters).' }, 400);
    if (hasSlur(staffName + ' ' + details)) return json({ error: 'Submission rejected.' }, 400);
    const r = {
      id: genId('RPT'), reporter, staffName, details, files,
      status: 'open', adminNote: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.reports.push(r);
    if (db.reports.length > 2000) db.reports = db.reports.slice(-2000);
    await c.store.save();
    notify(c, `New staff report **${r.id}** against **${staffName}** from **${reporter || 'Anonymous'}** (${files.length} file${files.length === 1 ? '' : 's'})`);
    return json({ id: r.id });
  });

  router.get('/api/admin/reports', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    return json(c.db.reports.slice().reverse().slice(0, 1000));
  });

  router.post('/api/admin/reports/:id/status', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    if (!validReportId(c.params.id)) return json({ error: 'Not found' }, 404);
    const r = db.reports.find(x => x.id === c.params.id);
    if (!r) return json({ error: 'Not found' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const { status, adminNote } = b;
    if (status !== undefined) {
      if (!['open', 'closed'].includes(status)) return json({ error: 'Bad status' }, 400);
      r.status = status;
      r.updatedAt = new Date().toISOString();
    }
    if (adminNote !== undefined) r.adminNote = cleanStr(adminNote, 2000);
    audit(c, 'report_' + r.status, r.id);
    await c.store.save();
    return json({ ok: true });
  });

  router.delete('/api/admin/reports/:id', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const r = db.reports.find(x => x.id === c.params.id);
    db.reports = db.reports.filter(x => x.id !== c.params.id);
    audit(c, 'report_deleted', c.params.id);
    await c.store.save();
    const env = c.env;
    if (r && cfg(env, 'GITHUB_TOKEN')) {
      const base = cfg(env, 'GITHUB_API_BASE', 'https://api.github.com').replace(/\/$/, '');
      const repo = cfg(env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps');
      const branch = cfg(env, 'GITHUB_BRANCH', 'main');
      const H = { 'User-Agent': 'wigglesworth-apps', Authorization: `Bearer ${cfg(env, 'GITHUB_TOKEN')}`, Accept: 'application/vnd.github+json' };
      for (const f of r.files || []) {
        const fp = 'evidence/' + String(f).split('/').pop();
        if (!/^evidence\/ev-[a-z0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(fp)) continue;
        try {
          const g = await fetch(`${base}/repos/${repo}/contents/${fp}?ref=${branch}`, { headers: H });
          if (!g.ok) continue;
          const sha = (await g.json()).sha;
          await fetch(`${base}/repos/${repo}/contents/${fp}`, {
            method: 'DELETE',
            headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'remove report evidence ' + fp, sha, branch }),
          });
        } catch (e) { console.error('evidence delete error', e.message); }
      }
    }
    return json({ ok: true });
  });
}
