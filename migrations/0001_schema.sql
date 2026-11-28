-- D1 schema for the Workers port (worker/CONTRACT.md).
--
-- One row per record. The entire record shape — including dynamic/unknown
-- fields — is stored verbatim in `json`. No field is promoted to a column,
-- so existing API response shapes are unchanged.
--
-- IMPORTANT: D1 limits a single row to 2 MB. data.live.json contains inline
-- `data:image/...;base64,` blobs; seeding those verbatim can exceed the limit
-- and will break the config row in particular. Images MUST be offloaded to R2
-- first (scripts/split-assets.mjs + docs/MIGRATION.md) so each row holds only
-- absolute HTTPS URLs. Never re-encode image bytes during the offload.

CREATE TABLE IF NOT EXISTS config (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  appId TEXT PRIMARY KEY NOT NULL,
  json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

-- `n` is the original 1-based audit order from data.live.json. It is inserted
-- explicitly by seed-d1.mjs so order and historical positions are preserved.
CREATE TABLE IF NOT EXISTS audit (
  n    INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loginCodes (
  email TEXT PRIMARY KEY NOT NULL,
  json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diag (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staffAccounts (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);

-- Expression indexes only where a hot path filters on a JSON field. They add
-- no columns, so record shapes stay byte-for-byte identical.
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(json_extract(json, '$.status'));
CREATE INDEX IF NOT EXISTS idx_outbox_status      ON outbox(json_extract(json, '$.status'));
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(json_extract(json, '$.status'));
CREATE INDEX IF NOT EXISTS idx_accounts_email     ON accounts(json_extract(json, '$.email'));
