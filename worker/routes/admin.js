// Backup/restore, sync status, mail test and audit log.

import { cfg } from '../env.js';
import { json } from '../http.js';
import { mailStats, sendTestMail } from '../mail.js';
import { audit, normEmail, mailConfigured, testMailHtml, isStaffAdmin } from './misc.js';

function mailFrom(env) {
  const apps = !!(cfg(env, 'APPS_SCRIPT_URL') && cfg(env, 'APPS_SCRIPT_SECRET'));
  return cfg(env, 'MAIL_FROM',
    apps ? 'Wigglesworth Staff' : 'Wigglesworth Applications <onboarding@resend.dev>').trim();
}

export function register(router) {
  router.get('/api/admin/backup', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const db = c.db;
    return json({
      version: 1, exportedAt: new Date().toISOString(), config: db.config,
      submissions: db.submissions, tickets: db.tickets || [], reports: db.reports || [],
      accounts: db.accounts || [],
    });
  });

  // The route-level 25mb parser is shadowed by the global 200kb JSON cap.
  router.post('/api/admin/restore', async c => {
    const db = c.db;
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    if (!b.config || !Array.isArray(b.config.applicationTypes) || !Array.isArray(b.submissions)) {
      return json({ error: 'Bad backup file' }, 400);
    }
    const keepCode = db.config.editCode;
    db.config = b.config;
    if (cfg(c.env, 'EDIT_CODE')) db.config.editCode = keepCode;
    if (!db.config.editCode) db.config.editCode = keepCode;
    db.submissions = b.submissions.filter(s => s && typeof s.appId === 'string').slice(-5000);
    if (Array.isArray(b.tickets)) {
      db.tickets = b.tickets.filter(t => t && typeof t.id === 'string' && Array.isArray(t.replies)).slice(-2000);
    }
    if (Array.isArray(b.reports)) {
      db.reports = b.reports.filter(r => r && typeof r.id === 'string').slice(-2000);
    }
    if (Array.isArray(b.accounts)) {
      db.accounts = b.accounts
        .filter(a => a && typeof a.id === 'string' && typeof a.email === 'string')
        .slice(-5000);
    }
    audit(c, 'restored', String(db.submissions.length));
    await c.store.save();
    return json({ ok: true, submissions: db.submissions.length });
  });

  router.get('/api/admin/sync', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const env = c.env;
    return json({
      github: !!cfg(env, 'GITHUB_TOKEN'),
      repo: cfg(env, 'GITHUB_REPO', 'testacc31222-netizen/wigglesworth-moderator-apps'),
      branch: cfg(env, 'GITHUB_BRANCH', 'main'),
      dataBranch: cfg(env, 'GITHUB_DATA_BRANCH', 'data-backup').trim().replace(/[^A-Za-z0-9._-]/g, '-') || 'data-backup',
      discord: !!cfg(env, 'DISCORD_WEBHOOK_URL'),
      ai: !!cfg(env, 'AI_API_KEY'),
      mail: mailStats(c.db),
    });
  });

  router.post('/api/admin/mail/test', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const to = normEmail(b.to);
    if (!to) return json({ error: 'Enter a valid destination email.' }, 400);
    if (!mailConfigured(c.env)) {
      return json({ error: 'Email delivery is not configured. Set APPS_SCRIPT_URL + APPS_SCRIPT_SECRET, SMTP_USER + SMTP_PASS, RESEND_API_KEY, or BREVO_API_KEY, plus MAIL_FROM on Render.', mailConfigured: false }, 400);
    }
    const result = await sendTestMail(c.env, {
      to,
      subject: 'Wigglesworth email test',
      text: 'This is a test from the Wigglesworth applications site. Decision emails will deliver the same way.',
      html: testMailHtml(),
    });
    if (!result.ok) return json({ error: 'Send failed: ' + result.error }, 502);
    return json({ ok: true, from: mailFrom(c.env) });
  });

  router.get('/api/admin/audit', async c => {
    if (!await isStaffAdmin(c)) return json({ error: 'Unauthorized' }, 401);
    return json((c.db.audit || []).slice(0, 50));
  });
}

