# Render → Cloudflare Workers migration runbook

This runbook covers the **infrastructure and data-migration artifacts only**.
It is written against `worker/CONTRACT.md`, `render.yaml`, `server.js` and the
current `data.live.json`.

## 0. What this port did NOT change

- **Frontend:** `public/**` is copied verbatim into the assets directory. No
  HTML/JS/CSS edits, including the stale `onrender.com` OG meta tags in
  `public/index.html` lines 12, 13 and 18 (those need explicit approval).
- **Data:** `data.live.json` is untouched. No record was rewritten, deleted or
  added by this work. The GitHub `data-backup` branch is read-only during this
  work; nothing was pushed anywhere.
- **Existing files:** `server.js`, `staff-profiles.js`, `package.json`,
  `render.yaml`, `Dockerfile`, `README.md`, `.gitignore`, all pre-existing
  `scripts/*` and `docs/*`, and `evidence/**` are unchanged.
- **No deployment, no commit, no push, and no `wrangler d1 execute` against a
  real database** was performed while producing these files.

New files created here: `wrangler.jsonc`, `migrations/0001_schema.sql`,
`docs/MIGRATION.md`, `scripts/export-merged-snapshot.mjs`,
`scripts/split-assets.mjs`, `scripts/seed-d1.mjs`. Runtime output directories
(`migration-out/`) are generated only when an operator runs the scripts.
Recommendation (not applied, because `.gitignore` is an existing file): add
`migration-out/` and `.dev.vars` to `.gitignore` before local use.

## 1. Binding / service mapping

| Express / Render mechanism | Worker binding | Notes |
| --- | --- | --- |
| `data.live.json` (single JSON file) | `DB` (D1) + `STORE_LOCK` (DO) | One row per record, full record shape in `json`. Reads cached per isolate; writes are serialized through `STORE_LOCK`. |
| `evidence/` on local disk | `MEDIA` (R2) via `ASSETS` gate | `/evidence/ev-…` is served from R2 by `worker/index.js`. |
| Uploaded video / offloaded images | `MEDIA` (R2) | Absolute HTTPS URLs so the 70,000-char validator in `staff-profiles.js` still passes. |
| `public/` static files | `ASSETS` (Workers static assets) | Same-origin `/api/...` calls; no frontend edits. |
| `express-rate-limit` ×14 | `RATE_LIMITER` (DO) | One DO call checks all 14 windows per request. |
| `setInterval(flushOutbox, 5min)` | `triggers.crons` `*/5 * * * *` → `scheduled()` | Outbox flush; 6 messages per run. |
| Inline `setTimeout` mail / Discord retries | `MAIL_JOBS`, `DISCORD_JOBS` (Queues) | Producers and consumers are both this worker; retries >30 s cannot sleep in a request. |
| Node HTTP server / HOST / PORT | none | Workers have no host/port; `HOST`, `PORT`, `NODE_ENV` are not ported. |

`wrangler.jsonc` contains **only non-secret defaults**. Before first deploy:

```sh
wrangler d1 create wigglesworth-db          # copy database_id into wrangler.jsonc
wrangler r2 bucket create wigglesworth-media
wrangler queues create wigglesworth-mail-jobs
wrangler queues create wigglesworth-discord-jobs
```

## 2. Environment variable mapping (Render → Workers)

`vars` in `wrangler.jsonc` are public defaults; anything that grants access must
be a **secret** (`wrangler secret put NAME`) or a per-environment deploy var.

| Render / server.js key | Workers destination | Value / handling |
| --- | --- | --- |
| `EDIT_CODE` | secret | Copy byte-for-byte from Render. |
| `SESSION_SECRET` | secret | Copy byte-for-byte from Render. |
| `GITHUB_TOKEN` | secret | Copy byte-for-byte from Render; read-only use during migration (`export-merged-snapshot.mjs` GETs only). |
| `DISCORD_BOT_TOKEN` | secret | As on Render. |
| `DISCORD_GUILD_ID`, `DISCORD_ROLE_MOD`, `DISCORD_ROLE_CC`, `DISCORD_ROLE_DEV`, `DISCORD_ACCEPT_CHANNEL` | secret | Same IDs/format; role lists accept comma-separated IDs. |
| `DISCORD_WEBHOOK_URL`, `DISCORD_PING_ID` | secret | Staff-channel ticket alerts; no webhook = feature silently off. |
| `RESEND_API_KEY`, `BREVO_API_KEY` | secret | Only used when the matching provider is selected. |
| `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET` | secret | Primary free mail provider (`MAIL_PROVIDER=apps_script`). |
| `SMTP_USER`, `SMTP_PASS` | **not used** | Workers cannot open TCP/SMTP; port the *behavior* with HTTP providers only. Keep on Render until cutover. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | **not used** | Node/nodemailer only. Documented, not ported. |
| `MAIL_FROM`, `MAIL_REPLY_TO` | secret | Copy from Render verbatim (they appear in outgoing mail and links). |
| `AI_API_KEY` | secret | Groq (or compatible) key. |
| `MAIL_PROVIDER` | var | `apps_script` in `wrangler.jsonc`; override if a different provider is configured. |
| `PUBLIC_URL` | var placeholder → real value | Set to the real Workers/custom-domain origin at cutover; used in email links. |
| `PREVIEW_MODE` | var | `0`; `1` disables GitHub hydration/backup (parity with server.js). |
| `GITHUB_REPO` | var | `testacc31222-netizen/wigglesworth-moderator-apps` (server.js default). |
| `GITHUB_BRANCH` | var | `main`. |
| `GITHUB_DATA_BRANCH` | var | `data-backup`. |
| `GITHUB_API_BASE` | var | `https://api.github.com` (test override only). |
| `GITHUB_BACKUP_INTERVAL_MS` | var | `300000` (min 30000). |
| `GITHUB_COUNTDOWN_REPO` | var | `testacc31222-netizen/wigglesworth-countdown`. |
| `COUNTDOWN_PUBLIC_URL` | var | `https://wigglesworth-countdown.onrender.com` (CORS + teaser uploads). |
| `DISCORD_API_BASE` | var | `https://discord.com/api/v10`. |
| `AI_BASE_URL`, `AI_MODEL` | var | `https://api.groq.com/openai/v1`, `openai/gpt-oss-20b`. |

Secrets are **not** listed in `wrangler.jsonc`. Set them with, for example:

```sh
wrangler secret put SESSION_SECRET
wrangler secret put GITHUB_TOKEN
wrangler secret put EDIT_CODE
# ...repeat for every "secret" row above
```

### Byte-identical secret verification

`SESSION_SECRET`, `GITHUB_TOKEN` and `EDIT_CODE` feed both session keys:

```
SHA256('ws-account|' + SESSION_SECRET + '|' + GITHUB_TOKEN + '|' + EDIT_CODE)
SHA256('ws-staff|'   + SESSION_SECRET + '|' + GITHUB_TOKEN + '|' + EDIT_CODE)
```

They also gate every pending login-code hash. A single different byte (including
a trailing newline, a shell-escaped `$`, or a copied trailing space) invalidates
every existing cookie and code. Copy from the Render dashboard / secret manager
directly into `wrangler secret put` (paste, do not retype). Verify by comparing
**hashes only, never printed values**, e.g. compare the first 12 hex chars of
`sha256(value)` from Render and from the Worker environment. Never put these
values in `wrangler.jsonc`, `.dev.vars` commits, shell history, or this document.

For local `wrangler dev`, put the same values in a local `.dev.vars` file and
keep it untracked; delete it after the parity checks.

## 3. Merge / canonical snapshot

`scripts/export-merged-snapshot.mjs` is read-only. It:

1. Reads `./data.live.json` (never writes it).
2. Reads `data.live.json` from `GITHUB_DATA_BRANCH` (`data-backup`) via the
   GitHub Contents API; on 404 or read error falls back to `GITHUB_BRANCH`
   (`main`). This reproduces `server.js hydrateProductionData()`.
3. Reproduces the Contents API >1 MB fallback: if `content` is missing, re-fetch
   with `Accept: application/vnd.github.raw+json` (the JSON form stops at 1 MB).
4. Ports `mergeDatabases()` + `normalizeDB()` exactly (including v2→v3 config
   migration, retired Event Hoster removal, 5,000-submission cap, 100-entry
   audit cap, local-only `loginCodes`, `sent`-wins outbox rule), with the one
   CONTRACT.md deviation: **`staffAccounts` is unioned by id** so a stale
   backup cannot delete a newer staff login.
5. Writes only `migration-out/snapshot.json` (canonical: recursively sorted
   keys, two-space indent) and `migration-out/snapshot.hashes.json` (SHA-256 of
   `JSON.stringify(record)` in canonical order, plus a whole-file hash).

```sh
# With the Render GITHUB_TOKEN (read-only GETs) for a complete snapshot:
GITHUB_TOKEN=... node scripts/export-merged-snapshot.mjs
# Offline/local-only sanity run (no network at all):
node scripts/export-merged-snapshot.mjs --local-only
```

Use `--local-only` for a quick smoke check, but **use the GitHub-backed run for
the real cutover snapshot** — the backup may contain applications that were
lost from the ephemeral Render disk. Compare per-record hashes between two runs
to detect drift. `migration-out/snapshot.hashes.json` records which branch was
used and whether the fallback was taken.

`normalizeDB()` seeds the default `khamari` staff account with a random salt
when `staffAccounts` is empty (same as a fresh Render boot). That is expected;
rotate its password immediately after cutover.

## 4. R2 image offload (D1 2 MB row limit)

D1 caps a **single row at 2 MB**. `data.live.json` contains inline
`data:image/...;base64,` blobs (banners, staff profile images, report evidence),
so seeding it raw can break the config or report rows offload first.

```sh
node scripts/split-assets.mjs
# Later, once the R2 custom domain / public URL is known:
R2_PUBLIC_BASE=https://media.example.com node scripts/split-assets.mjs
```

The script:

- walks all 10 collections, decodes every `data:…;base64,` payload into
  `migration-out/assets/<sha256-prefix>.<ext>` (bytes written **verbatim**, no
  re-encode or resize);
- de-duplicates by content hash;
- writes `migration-out/asset-manifest.json` with the JSON Pointer, table and
  record id of every occurrence, the content hash, the target R2 key and the
  replacement absolute HTTPS URL;
- **does not modify** `snapshot.json` or `data.live.json`.

Upload each manifest asset at its `file` key:

```sh
wrangler r2 object put wigglesworth-media/assets/<hash>.png \
  --file=migration-out/assets/<hash>.png --content-type=image/png
```

A custom domain (or the `*.r2.dev` public URL) must make those keys reachable at
`R2_PUBLIC_BASE`. Absolute HTTPS URLs are required because
`staff-profiles.js` rejects non-HTTPS/oversized values. Keep the max data-URL
length rule (70,000 chars) in mind when verifying the replacement.

## 5. D1 schema + seeding

```sh
# Local check only; no remote database is touched by the tooling in this work.
wrangler d1 migrations apply DB --local
node scripts/seed-d1.mjs                      # writes migration-out/seed.sql only
R2_PUBLIC_BASE=https://media.example.com node scripts/seed-d1.mjs
wrangler d1 execute DB --local --file=migration-out/seed.sql
```

`migrations/0001_schema.sql` creates the 10 tables from CONTRACT.md, each with
`json TEXT NOT NULL` and the exact id column (`config(id)`,
`submissions(appId)`, `tickets(id)`, `reports(id)`, `audit(n AUTOINCREMENT)`,
`accounts(id)`, `loginCodes(email)`, `outbox(id)`, `diag(id)`,
`staffAccounts(id)`). Hot-path indexes use `json_extract` expressions and add
no columns.

`scripts/seed-d1.mjs` emits `INSERT OR REPLACE` statements inside one
transaction:

- row JSON is the canonical snapshot record, unchanged except for
  manifest-governed URL substitutions;
- `audit.n` is the original 1-based position, so audit ordering is preserved;
- the single config row uses id `singleton` (the table is a singleton; keep this
  id consistent with `worker/db.js`);
- `diag` and other keyless records get deterministic `diag-0001` style ids;
- it prints the largest row size and warns about any remaining inline data URLs.

The script **never executes SQL** and never contacts a database. Applying
`seed.sql` to `--remote` is an operator action at cutover, after review.

## 6. `wrangler dev` parity checks

Run with the same secrets as Render in an untracked `.dev.vars`:

```sh
wrangler dev --local --persist
```

Check, against a frozen copy of the Render service (compare status codes and
JSON bodies, not just visual output):

- `GET /health`; security headers, including CSP copied verbatim from
  `server.js:459–481` (YouTube sources included) and no `x-powered-by`.
- Root gate: anonymous `/` → 302 `/signin?next=…`; `?staff=1`, valid account
  cookie and valid staff cookie each reach the app.
- `/api/config` (edit code must be stripped), admin config GET/POST,
  `/api/admin/reset`.
- Submit → status → approved list → decision → re-email → delete; verify
  decision statuses and `notifiedStatus` survive a reload.
- Accounts: request code, verify code, recover, link, prefs, signout; confirm a
  code issued on Render still verifies on the Worker (byte-identical secrets).
- Staff sign-in (scrypt), staff CRUD, staff profiles order/edit/delete and the
  HTTPS/data-URL validators.
- Tickets + replies, reports (including strict `^/evidence/ev-…$` edit rule),
  evidence GET, video upload (`{ url, rawUrl }` shape consumed by
  `public/staff-profiles.js:177`).
- Mail: queued/sent/failed counts, dedupe by `key`, quota regex parking,
  test mail via Apps Script; outbox flush on the 5-minute cron.
- Discord: grant role, congratulations post, 429 retry behavior, and that
  failures never fail the HTTP response.
- AI endpoints: prompt construction, `502 {error:'AI unavailable'}` and
  `reasoning_effort:'low'` for gpt-oss models.
- Countdown-origin CORS preflight from `https://wigglesworth-countdown.onrender.com`.
- All 14 rate-limit messages and `RateLimit-*` headers.

Keep the Render instance and the `data-backup` branch running and untouched
during these checks.

## 7. Freeze, delta, cutover and rollback

1. **Freeze.** Announce a short maintenance window and stop accepting writes on
   Render (do not edit `data.live.json` by hand). Render free services sleep,
   so allow one final autosave to reach `data-backup`. Take the final snapshot
   (section 3) with `GITHUB_TOKEN`; record `snapshot.hashes.json`.
2. **Delta.** Re-run the export immediately before cutover and diff the new
   per-record hashes against the frozen set. Any changed/new record must be
   re-exported, re-split (if it contains images) and re-seeded. Do **not** let
   the Worker write to GitHub during the delta window — both sides writing to
   `data-backup` would defeat the freeze.
3. **Cutover.** Set all secrets first, then `PUBLIC_URL` to the Workers origin,
   deploy, apply `0001_schema.sql` and the reviewed `seed.sql` to D1, upload R2
   assets, verify `/health`, a signed-in account and a staff session, then move
   the route/DNS to the Worker. Keep Render running and `data-backup` intact for
   the whole rollback window (recommend ≥7 days); do not archive/delete it.
4. **Rollback.** Point the route back to Render. Render's on-disk
   `data.live.json` and the `data-backup` branch were never modified, so it
   resumes from the pre-cutover state. Do not merge D1 rows back into Render
   automatically; diff them first. If Render's disk was wiped, its normal boot
   hydration restores from the untouched `data-backup` branch.

## 8. Free-plan limits (verify in the dashboard; they change)

- **Workers Free:** request/day cap and per-request CPU time are limited; the
  14-window limiter and the 200 KB JSON cap protect both. Long Discord waits
  must go through queues/cron, not `setTimeout`.
- **D1 Free:** daily rows read/written and database storage are capped, and a
  **single row is limited to 2 MB** — the reason for the R2 offload. The
  per-isolate cache in `openStore()` keeps row reads low.
- **R2 Free:** monthly storage and Class A/B operation caps; dedupe by content
  hash and serve evidence through the asset gate.
- **Queues / Cron Free:** operation and message caps apply; consumers batch
  (10) and the cron runs every 5 minutes, matching Render's flush interval.
- **GitHub:** the Contents API stops returning inline content above 1 MB — the
  export script already uses the raw-content fallback.

## 9. Known risks (R1–R6)

- **R1 — Secret drift.** Any byte difference in `SESSION_SECRET`, `GITHUB_TOKEN`
  or `EDIT_CODE` invalidates all cookies and pending login codes. Mitigation:
  byte-identical paste from Render, hash-only verification, freeze logins during
  cutover.
- **R2 — Oversized D1 rows.** Inline base64 images can exceed the 2 MB row
  limit. Mitigation: mandatory `split-assets.mjs` → R2 upload → manifest-based
  URL substitution; check the printed largest-row size before seeding.
- **R3 — Merge/data-loss semantics.** A stale backup must only add records;
  `staffAccounts` union-by-id, local-only `loginCodes`, 100-entry audit cap and
  5,000-submission cap are deliberate. Mitigation: compare per-record hashes,
  freeze writes, keep `data-backup` untouched.
- **R4 — Mail transport.** Nodemailer/SMTP cannot run in Workers. Mitigation:
  Apps Script is primary (`MAIL_PROVIDER=apps_script`); Brevo and Resend paths
  are kept; SMTP values stay on Render. Queue retries and daily quotas still
  apply (≈100 Apps Script recipients/day on consumer Gmail).
- **R5 — Discord timing/idempotency.** Sleeps >30 s cannot happen in a request,
  and 429 retries need backoff. Mitigation: `DISCORD_JOBS` + cron, four retries
  on 429, preserved `roleAssignedAt`/`acceptAnnouncedAt`/`roleError` fields;
  Discord failures never fail the HTTP response.
- **R6 — Free ceilings + cutover safety.** Request/CPU, D1 rows, R2 operations
  and Queue caps are lower than a paid Render instance. Mitigation: keep the
  rate limiter and caching, watch dashboards, and retain Render + `data-backup`
  through the rollback window.

## 10. Command cheat sheet (in order)

```sh
wrangler d1 create wigglesworth-db                 # once; paste id into wrangler.jsonc
wrangler r2 bucket create wigglesworth-media       # once
wrangler queues create wigglesworth-mail-jobs      # once
wrangler queues create wigglesworth-discord-jobs   # once
wrangler secret put SESSION_SECRET                 # + all other secrets, byte-identical
node scripts/export-merged-snapshot.mjs            # with GITHUB_TOKEN in the environment
node scripts/split-assets.mjs
R2_PUBLIC_BASE=https://<r2-origin> node scripts/split-assets.mjs
wrangler d1 migrations apply DB --local
R2_PUBLIC_BASE=https://<r2-origin> node scripts/seed-d1.mjs
wrangler d1 execute DB --local --file=migration-out/seed.sql
wrangler dev --local --persist                     # parity checks
# Cutover only, explicitly by an operator:
wrangler d1 migrations apply DB --remote
wrangler d1 execute DB --remote --file=migration-out/seed.sql
wrangler deploy
```

## 11. Final deployment note (GitHub media fallback)

Cloudflare required a payment method to enable R2 on this account. To stay
**completely free with no card**, R2 is optional: `wrangler.jsonc` has no
`r2_buckets` binding, and `worker/uploads.js` stores evidence, videos and
offloaded config images in the existing `GITHUB_REPO` via `GITHUB_TOKEN`,
serving them back through `/evidence/...` and `/assets/...`. This is the same
GitHub storage the original Express server used for backups and evidence.

Actual cutover commands used:

```sh
node scripts/export-merged-snapshot.mjs     # with GITHUB_TOKEN (merged data-backup)
node scripts/split-assets.mjs
node scripts/upload-assets-github.mjs       # 10 offloaded image assets
R2_PUBLIC_BASE=https://wigglesworth-applications.testacc31222.workers.dev \
  node scripts/seed-d1.mjs
# seed-wrangler.sql is seed.sql with BEGIN TRANSACTION/COMMIT removed and
# submissions.id -> submissions.appId, loginCodes.id -> loginCodes.email
wrangler d1 execute wigglesworth-db --remote --file=migration-out/seed-wrangler.sql
wrangler deploy
```

Live URL: `https://wigglesworth-applications.testacc31222.workers.dev`.
`assets.run_worker_first = true` is required so the account-only gate and
security headers run before static assets are served.
