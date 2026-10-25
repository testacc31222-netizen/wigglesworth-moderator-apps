# Moderator Applications — Phone + Computer Site (Discord-safe)

**Live site:** https://wigglesworth-applications.onrender.com

DO NOT send your home IP to Discord. Host it on Render (free) and share that link instead — your IP stays hidden.

## Safe share (do this)

1. Push this folder to a GitHub repo (data.json is ignored, won't leak).
2. Go to render.com → New → Web Service → connect the repo.
   - Build: `npm install`, Start: `npm start`, plan Free.
   - Add env var: `EDIT_CODE` = a long random code (e.g. 20+ chars). This becomes your editor password.
3. You get `https://wigglesworth-applications.onrender.com` — post THAT in Discord.
4. Change Editor > General > edit code to match, Save.

Everyone (phone + PC) uses the Render link. Approvals update live everywhere.

## Local use only

- Double-click `start.bat` (binds to `127.0.0.1:3000` only — NOT exposed to LAN/internet).
- Open http://127.0.0.1:3000 on this PC.
- Only set `HOST=0.0.0.0` if you need same-WiFi phone testing, and never port-forward it.

## Security included

- No home IP to share; cloud URL hides origin
- `helmet` headers, `x-powered-by` off, rate limits (10 submits / 10min, 60 admin tries / 10min)
- Edit code never sent to public clients (`/api/config` strips it), timing-safe compare, generic `Unauthorized` errors
- Server-side validation + length caps + control-char stripping on all inputs, ID format checks
- `EDIT_CODE` env override so the code isn't stored in git; atomic `data.json` writes, 5000-sub cap
- Applicant sessions are HMAC-signed `HttpOnly` cookies; login codes are hashed, single-use, expire in 10 minutes, and account endpoints are rate-limited + same-origin checked

## Discord ticket alerts (optional)
New tickets and ticket replies ping you in Discord:

1. Discord → your **staff-only** channel → Edit channel → Integrations → Webhooks → New Webhook → Copy URL
2. Right-click yourself (Developer Mode on) → Copy User ID
3. Render → service → Environment → add `DISCORD_WEBHOOK_URL` = webhook URL and `DISCORD_PING_ID` = your user ID → Save
4. Open a test ticket — it lands in the channel with a ping

Use a staff-only channel: ticket contents are posted there. No webhook = feature silently off.

## Discord account linking (removed)

Removed — the site no longer uses Discord OAuth. Applicants just type their
Discord name manually. Delete any `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`LINK_SECRET`, `LINK_REDIRECT`, `LINK_REQUIRED` vars from Render if present.

## Applicant accounts + emailed decisions

Applicants can now sign in at `/signin` to see every application tied to their
email, read the staff note, and choose whether decisions are emailed.

- The application form collects a required **email** plus an opt-out checkbox.
- A receipt is emailed on submission. When staff approve or deny, a decision
  email goes out automatically (once, per decision).
- Sign-in is passwordless: a 6-digit code is emailed and lasts 10 minutes.
  Sessions are signed, `HttpOnly` cookies that last 30 days.
- **Application ID fallback:** enter the email you applied with plus your
  Application ID. This works even before email delivery is configured and also
  claims older applications that predate accounts. The dashboard has an
  "Add an older application" box for the rest.
- Staff can force a fresh decision email from Applications → **Re-email
  decision**, and see delivery state in Editor → General → **Applicant emails**.

### Turn on email delivery (Google Apps Script, Gmail SMTP, Resend, or Brevo)

Pick **one**. Important: **Render free web services block outbound SMTP ports**
(25, 465, and 587). Gmail SMTP therefore only works on a paid Render instance.
Google Apps Script is the free option that works on Render's free plan.

**Google Apps Script relay** — free, no domain, no organization address:

1. Open <https://script.new> and replace the code with:

   ```js
   const SECRET = 'PASTE_A_LONG_RANDOM_SECRET';

   function doPost(e) {
     try {
       const data = JSON.parse(e.postData.contents);
       if (!data || data.secret !== SECRET) {
         return json({ ok: false, error: 'unauthorized' });
       }
       const opts = {
         to: data.to,
         subject: data.subject,
         body: data.text || '',
         htmlBody: data.html || data.text || '',
         name: data.fromName || 'Wigglesworth Staff',
       };
       if (data.replyTo) opts.replyTo = data.replyTo;
       MailApp.sendEmail(opts);
       return json({ ok: true });
     } catch (err) {
       return json({ ok: false, error: String(err) });
     }
   }

   function json(o) {
     return ContentService.createTextOutput(JSON.stringify(o))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

2. Replace `PASTE_A_LONG_RANDOM_SECRET` with a long random string.
3. **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and authorize Gmail access.
4. Copy the web app URL (it ends in `/exec`).
5. On Render add:
   `APPS_SCRIPT_URL` = the web app URL
   `APPS_SCRIPT_SECRET` = the same random string
   Optional: `MAIL_FROM` = `Wigglesworth Staff`, and
   `MAIL_REPLY_TO` = your Gmail address.
6. Save/redeploy, then Editor → General → **Send test**.

Consumer Gmail allows about 100 recipients/day through Apps Script; the queue
retries later if you hit the limit. If you change the script, create a new
deployment version and update `APPS_SCRIPT_URL` if the URL changes.

**Gmail SMTP** — only after upgrading Render to a paid instance:

1. Turn on 2-Step Verification on the Google account, then open
   Google Account → Security → **App passwords** and create one named
   `Wigglesworth Render`.
2. Add these on Render:
   `SMTP_USER` = `you@gmail.com`
   `SMTP_PASS` = the 16-character app password
   `MAIL_FROM` = `Wigglesworth Staff <you@gmail.com>`
3. `SMTP_HOST` defaults to `smtp.gmail.com` and `SMTP_PORT` to `587`.
   Use `SMTP_PORT=465` and `SMTP_SECURE=true` only if 587 is blocked.
4. Save/redeploy, then Editor → General → **Send test**.

**Resend** — best if you own a domain:

1. Create a free account at resend.com → API Keys → create a key.
2. Add `RESEND_API_KEY` = `re_...` on Render.
3. Verify your domain in Resend, then set
   `MAIL_FROM` = `Wigglesworth Staff <applications@yourdomain.com>`.
   (`Wigglesworth <onboarding@resend.dev>` only delivers to the email on your
   Resend account, so it is only useful for a quick test.)

**Brevo** — easier if you only have a Gmail/Outlook address:

1. Create a free account at brevo.com → SMTP & API → API Keys → create a key.
2. In Brevo, verify the sender address you want to use (Senders domain &
   IP → Senders → add your address and click the confirmation email).
3. Add `BREVO_API_KEY` = your key and `MAIL_FROM` =
   `Wigglesworth Staff <your-verified-address@gmail.com>` on Render.
4. If more than one provider is configured, set `MAIL_PROVIDER` =
   `apps_script`, `smtp`, `resend`, or `brevo` to pick one. Otherwise Apps
   Script wins, then SMTP, then Resend, then Brevo.

Then set these optional but recommended values:

- `SESSION_SECRET` = a long random string (keeps sign-ins valid if other
  secrets change)
- `PUBLIC_URL` = `https://your-custom-domain.com` (used in email links)
- `MAIL_REPLY_TO` = a staff inbox

Save, wait for the deploy, then Editor → General → **Send test**. Auto-deploy is
off on the live service, so after changing env vars click **Manual Deploy →
Deploy latest commit** if Render does not redeploy automatically.

Until a provider is configured, nothing is lost: every email is queued in
`data.live.json` and the editor shows Queued / Sent / Failed counts. The queue
retries on deploy, every 5 minutes, and when a new message is queued. The
sign-in page automatically steers people to the Application ID method while
delivery is off.

**Privacy:** the data file now also holds account emails, hashed login codes,
and queued email bodies. Keep the GitHub repo private (it already holds
applications), and never commit a copy of `data.live.json` elsewhere.

## Files

- `server.js` (hardened API), `public/` (site), `render.yaml`, `.gitignore`
- Old `../moderator-application.html` is local-only — don't share that file's data, it won't sync.
