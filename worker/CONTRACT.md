# Worker port — internal contract

This file is the shared contract for the new Cloudflare Worker implementation.
All code in `worker/` must follow it exactly. The canonical source to port is
`../server.js` and `../staff-profiles.js` on branch `main`.

## Hard rules

- Create NEW files only. Never edit `server.js`, `staff-profiles.js`,
  `package.json`, `render.yaml`, `Dockerfile`, `README.md`, `data.live.json`,
  `public/**`, `scripts/*` (existing), `docs/*` (existing), or `evidence/**`.
- Never deploy, never run `wrangler d1 execute` against a real database, never
  write to `data.live.json`, never commit, never push.
- Do not drop any feature, endpoint, field, validation, status code, error
  message, or response shape from `server.js`. If a Node-only mechanism cannot
  exist in Workers, port its *behavior* with a Worker-native mechanism.
- Frontend calls are same-origin relative `/api/...`; keep all paths identical.

## Runtime assumptions

- `wrangler.jsonc` uses `compatibility_flags: ["nodejs_compat"]`, so `Buffer`,
  `node:crypto` (`createHash`, `randomBytes`, `randomInt`, `scryptSync`,
  `timingSafeEqual`) are available. WebCrypto (`crypto.subtle`) is also
  available. Use WebCrypto for HMAC if convenient, but keep byte-for-byte
  compatibility with existing cookies and login-code hashes.
- Bindings on `env`: `DB` (D1), `MEDIA` (R2), `ASSETS` (Workers static assets),
  `RATE_LIMITER` and `STORE_LOCK` (Durable Object namespaces),
  `MAIL_JOBS` / `DISCORD_JOBS` (Queues), plus all vars/secrets from
  `render.yaml` and `server.js`.
- Secrets `SESSION_SECRET`, `GITHUB_TOKEN`, and `EDIT_CODE` must be copied
  byte-for-byte from Render at deployment time. Their values determine every
  signed cookie and every pending login-code hash.

## Context object `c`

Handlers are `async (c) => Response`, where `c` has:

```js
{
  req,            // Request
  env,            // bindings + vars
  ctx,            // ExecutionContext (waitUntil)
  url,            // new URL(req.url)
  method,         // req.method
  path,           // url.pathname
  params,         // route params { id }
  query,          // URLSearchParams
  headers,        // req.headers
  body,           // parsed JSON ({} if none), parsed by index.js
  raw,            // Uint8Array raw body (for uploads)
  store,          // from db.openStore(env, ctx)
  db,             // c.store.db — the in-memory database object
  user,           // applicant account object or null (set by auth middleware)
  staff,          // staff account object or null
  origin,         // req origin string
}
```

Helpers in `worker/http.js` (provided separately):

```js
export class Router {
  add(method, pattern, handler) // pattern like '/api/tickets/:id'
  match(method, pathname)       // -> { handler, params } | null
}
export function json(data, status = 200, extraHeaders = {})
export function text(body, status = 200, extraHeaders = {})
export function redirect(location, status = 302)
export function fail(status, message, extra = {})
export async function readJson(req, limit = 200 * 1024) // throws HttpError 413
export async function readRaw(req, limit)
export class HttpError extends Error { constructor(status, message, extra) }
export function errorResponse(err)
```

`fail()` and `HttpError` must produce the same JSON body shape that
`server.js` currently produces (`{ error: '...' }`, or `{ ok: false, error }`
where the original does that). Preserve the original message strings exactly.

## Module contracts

### `worker/env.js` (provided separately)
```js
export function cfg(env, key, def = '')            // string env lookup
export function boolCfg(env, key, def = false)
export function intCfg(env, key, def)
export function publicUrl(env, req)                 // env.PUBLIC_URL || new URL(req.url).origin
export function originOf(req)                       // host-only origin string
export function nowMs()
export function uid(prefix, bytes = 12)             // hex id like acc_...
export function escapeHtml(s)
export function safeEq(a, b)                        // constant-time Uint8Array compare
```

### `worker/db.js`
```js
export function normalizeDB(db, env = {})           // verbatim port of normalizeDB()
export function mergeDatabases(l, r)                // verbatim port, except staffAccounts union by id
export async function openStore(env, ctx)           // -> { db, save(), reload(), snapshot() }
```
`openStore` caches per isolate (short TTL), reloads from D1, and `save()`
computes a diff against the load snapshot. Writes are serialized with
`STORE_LOCK` (acquire → reload fresh D1 → apply diff → `db.batch()` → release)
so concurrent approvals cannot lose updates. All ten collections keep their
exact record shapes; dynamic/unknown fields stay inside the row JSON.

Tables: `config(id)`, `submissions(appId)`, `tickets(id)`, `reports(id)`,
`audit(n AUTOINCREMENT)`, `accounts(id)`, `loginCodes(email)`, `outbox(id)`,
`diag(id)`, `staffAccounts(id)`, each with a `json TEXT NOT NULL` column.

### `worker/auth.js`
All signing/verification is async because WebCrypto HMAC is async.
```js
export function parseCookies(req)                   // header -> object
export async function sessionKey(env, kind)         // kind 'account' | 'staff'
export async function signSession(env, kind, id, exp)
export async function readSession(env, kind, req)   // -> { id, exp } | null
export async function hashCode(env, email, code)
export function sameOrigin(req)
export function setSessionCookie(res, env, kind, id, req)
export function clearSessionCookie(res, kind, req)
export function staffRole(db, staffId)
export function isAdmin(db, staffId)
export function canViewApplications(db, staffId)
export function staffOwner(db, staffId)
export function requireOwner(db, staffId)           // throws HttpError 403 on last owner
```
Cookie names and flags exactly as current: `ws_account` / `ws_staff`,
`HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/`, `Secure` when the request
is secure. Key derivation must stay:
`SHA256('ws-account|' + SESSION_SECRET + '|' + GH_TOKEN + '|' + EDIT_CODE)`
and `SHA256('ws-staff|' + ...)`. Session payload `id.exp.base64url(HMAC)`.
Staff passwords keep `scryptSync(password, salt, 64)` with salt 16 random
bytes hex (N=16384, r=8, p=1); verify with the same function.

### `worker/mail.js`
```js
export function queueMail(store, msg, env, ctx)     // msg: {key,to,subject,text,html,kind,appId,...}
export async function flushOutbox(env, ctx, store) // 6 per run, single-flight via STORE_LOCK
export function mailStats(db)
export async function sendMail(env, msg)            // apps_script | brevo | resend
export async function sendTestMail(env, msg)
```
Keep: dedupe by `key` unless status is `failed`; outbox cap 1000; `attempts`
up to 5; quota regex `/quota|too many (times|emails)|daily limit|limit exceeded/i`
(which parks the message as `queued` without incrementing attempts); reload
DB before writing results; `decisionStatus` field; `mail_+hex` ids.
SMTP/nodemailer is the one thing that cannot be ported (no TCP in Workers):
use HTTP providers only, with `apps_script` as the primary free provider.
Keep Brevo and Resend paths. `MAIL_JOBS` queue may trigger immediate flushes.

### `worker/discord.js`
```js
export async function discordApi(env, path, init = {})
export async function resolveDiscordMemberId(env, discordIdOrTag)
export async function grantRoleForSubmission(env, store, sub, ctx)
export async function announceAcceptance(env, store, sub, ctx)
export function discordNotify(env, text, ctx)
```
Port `discordNotify()` webhook alerts with 4 retries on 429; sleeps longer
than 30s must be scheduled via `DISCORD_JOBS`/Cron rather than `setTimeout`.
Port bot API (roles + congratulations post) with fetch and 12s aborts.
Keep idempotency fields (`roleAssignedAt`, `roleAssignedRoleId(s)`,
`roleError`) and the rule that Discord failures never fail the HTTP response.

### `worker/ai.js`
```js
export async function aiChat(env, system, user, temp, maxTokens, modelOpts = {})
```
Port the four endpoints' prompt construction and error mapping
(`502 {error:'AI unavailable'}`), including `reasoning_effort:'low'` for
gpt-oss models and the 12–25 s aborts. Endpoint handlers live in route modules.

### `worker/uploads.js`
```js
export async function handleEvidenceUpload(c)      // raw bytes -> MEDIA + mirror job
export async function handleEvidenceGet(c)         // /evidence/<name> from MEDIA
export async function handleVideoUpload(c)         // raw bytes -> MEDIA stream
export async function offloadDataUrls(env, store)  // data:image blobs -> absolute HTTPS URLs
export function isImage(buf), isVideo(buf), isAudio(buf)
```
Keep magic-byte sniffing and the strict `^/evidence/ev-...$` validation on
report edits. Return the same `{ url, rawUrl }` shape for video upload that
`public/staff-profiles.js:177` consumes. Offloaded URLs must be absolute
HTTPS so the existing 70,000-char validator in `staff-profiles.js` passes.
Do not re-encode image bytes.

### `worker/rate-limits.js` + `worker/durable/RateLimiter.js`
```js
export async function checkLimits(c, env)          // throws HttpError 429 with exact message
```
One DO call per request checks all 14 windows at once, keyed by
`CF-Connecting-IP` + limiter name. Windows: general 120/1m, submit 10/10m,
admin 60/10m, status 30/1m, config 40/1m, account 20/15m, verify 30/15m,
recover 12/15m, staffLogin 15/15m, ticket 8/10m, ai 20/1h, upload 30/1h,
evidence 10/1h, diag 10/1h. Preserve current error messages and
`RateLimit-*` headers as far as practical.

### `worker/durable/StoreLock.js`
Durable Object with `POST /acquire` → `{ok, token}` (5 s lease, alarm cleanup)
and `POST /release` `{token}`. Used only around read-modify-write DB saves
and outbox flush.

### `worker/staff-profiles.js`
Port all validators from `../staff-profiles.js` verbatim (HTTPS URL ≤1500,
data URL ≤70000, ≤8 badges/socials, ≤40 profiles, unique podium placement,
YouTube clip parsing) and the three handlers:
`POST /api/admin/staff-profile-order`,
`PUT /api/admin/staff-profiles/:id`,
`DELETE /api/admin/staff-profiles/:id`.
Exports `register(router)`.

### `worker/routes/*.js`
Each module exports `register(router)` and registers its exact subset of
server.js routes with `router.add(method, path, handler)`. Use `c.db` /
`c.store.save()` instead of `loadDB()` / `saveDB()`, `await` for auth helpers,
`c.body` instead of `req.body`, `c.params.id` instead of `req.params.id`,
`c.query.get(...)` instead of `req.query.x`, and `json(...)` instead of
`res.json(...)`. Preserve every response field and status code.

Suggested split (check `server.js` for the exact paths):
- `config.js`: `/api/config`, `/api/admin/config` GET+POST, `/api/admin/reset`
- `applications.js`: submit, status, approved, admin application list/decision/
  summarize/ai-check/status/notify/delete/delete-all
- `account.js`: meta, me, request-code, verify-code, recover, link, prefs,
  signout
- `staff.js`: staff signin/signout/session, admin staff CRUD, staff-profiles
  endpoints (delegate to `worker/staff-profiles.js`)
- `tickets.js`: tickets + admin tickets incl. suggest/status/delete/reply
- `admin.js`: backup, restore, sync, audit, mail/test, AI endpoints not in
  applications.js
- `reports.js`: reports + admin reports/status/delete
- `media.js`: upload-video (delegate to uploads.js), clientlog if unused elsewhere
- `misc.js`: `/health`, `/api/clientlog`, anything left over

## Entry point `worker/index.js` (provided separately)

Middleware order mirrors `server.js`:
preview gate → evidence static from R2 → manual security headers (CSP copied
verbatim from server.js lines 459–481, including YouTube sources) → JSON body
cap 200 KB → countdown-origin CORS → root gate (applicant cookie OR staff
cookie OR `?staff=1`) → static assets with no-store for dynamic docs →
14 rate-limit checks → routes → error handler → `ctx.waitUntil` jobs.

## Frontend

Copy `public/**` verbatim into the assets directory (no edits). The only
optional change — stale `onrender.com` OG meta URLs in `public/index.html`
lines 12, 13, 18 — requires explicit user approval and is NOT part of this
implementation.
