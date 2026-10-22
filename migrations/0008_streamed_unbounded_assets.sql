-- Replace account attachment tables so storage is governed by the data volume,
-- not application-defined per-file or per-account byte quotas. Preserve all rows.
-- Incomplete uploads use a hidden metadata row and the same chunk table, avoiding
-- a second on-disk copy when a large upload is finalized.
DROP TRIGGER account_asset_quota;

ALTER TABLE account_asset_chunks RENAME TO account_asset_chunks_limited;
ALTER TABLE account_assets RENAME TO account_assets_limited;

CREATE TABLE account_assets (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  created INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 1 CHECK (complete IN (0, 1)),
  PRIMARY KEY (account_id, id)
);

CREATE TABLE account_asset_chunks (
  account_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (account_id, asset_id, ordinal),
  FOREIGN KEY (account_id, asset_id) REFERENCES account_assets(account_id, id) ON DELETE CASCADE
);

INSERT INTO account_assets(account_id, id, name, mime, size, created, complete)
SELECT account_id, id, name, mime, size, created, 1 FROM account_assets_limited;
INSERT INTO account_asset_chunks(account_id, asset_id, ordinal, data)
SELECT account_id, asset_id, ordinal, data FROM account_asset_chunks_limited;

DROP TABLE account_asset_chunks_limited;
DROP TABLE account_assets_limited;
