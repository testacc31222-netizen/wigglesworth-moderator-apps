// Isolated visual preview: no production records, credentials, or writes.
process.env.PREVIEW_MODE = '1';
process.env.DATA_FILE = '/tmp/wigglesworth-design-preview-data.json';
for (const key of [
  'GITHUB_TOKEN','GITHUB_REPO','GITHUB_BRANCH','GITHUB_COUNTDOWN_REPO',
  'DISCORD_WEBHOOK_URL','DISCORD_PING_ID',
  'RESEND_API_KEY','BREVO_API_KEY','APPS_SCRIPT_URL','APPS_SCRIPT_SECRET',
  'SMTP_USER','SMTP_PASS','MAIL_PROVIDER',
  'AI_API_KEY','EDIT_CODE','SESSION_SECRET'
]) delete process.env[key];
require('./server.js');
