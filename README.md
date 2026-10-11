# Moderator Applications — Phone + Computer Site (Discord-safe)

DO NOT send your home IP to Discord. Host it on Render (free) and share that link instead — your IP stays hidden.

## Safe share (do this)

1. Push this folder to a GitHub repo (data.json is ignored, won't leak).
2. Go to render.com → New → Web Service → connect the repo.
   - Build: `npm install`, Start: `npm start`, plan Free.
   - Add env var: `EDIT_CODE` = a long random code (e.g. 20+ chars). This becomes your editor password.
3. You get `https://moderator-site-xxxx.onrender.com` — post THAT in Discord.
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

## Discord ticket alerts (optional)
New tickets and ticket replies ping you in Discord:

1. Discord → your **staff-only** channel → Edit channel → Integrations → Webhooks → New Webhook → Copy URL
2. Right-click yourself (Developer Mode on) → Copy User ID
3. Render → service → Environment → add `DISCORD_WEBHOOK_URL` = webhook URL and `DISCORD_PING_ID` = your user ID → Save
4. Open a test ticket — it lands in the channel with a ping

Use a staff-only channel: ticket contents are posted there. No webhook = feature silently off.

## Discord account linking (optional, recommended)

Forces applicants to verify Discord before applying or opening tickets:

1. https://discord.com/developers/applications → New Application → OAuth2
2. Add redirect: `https://wigglesworth-moderator-applications.onrender.com/api/link/callback`
3. Copy Client ID + Client Secret → Render Environment:
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
4. Optional: `LINK_SECRET` (random string — signing key; without it the key derives from your edit code, so changing the code unlinks everyone)
5. Redeploy happens automatically. The site then requires linking; verified names lock in and every record carries the Discord user ID.

## Files

- `server.js` (hardened API), `public/` (site), `render.yaml`, `.gitignore`
- Old `../moderator-application.html` is local-only — don't share that file's data, it won't sync.
