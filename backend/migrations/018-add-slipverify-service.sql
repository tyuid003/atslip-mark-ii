-- Migration 018: Add 'slipverify' to team_api_keys service CHECK constraint
-- SQLite does not support ALTER TABLE ... DROP CONSTRAINT, so we recreate the table.

PRAGMA foreign_keys = OFF;

-- Rename old table
ALTER TABLE team_api_keys RENAME TO team_api_keys_old;

-- Recreate with updated CHECK constraint (11 columns, matching actual schema)
CREATE TABLE team_api_keys (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  service      TEXT NOT NULL CHECK (service IN ('easyslip', 'slip2go', 'slipok', 'slipverify')),
  label        TEXT,
  api_key      TEXT NOT NULL,
  branch_id    TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_used_at INTEGER DEFAULT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing data
INSERT INTO team_api_keys SELECT * FROM team_api_keys_old;

-- Drop old table
DROP TABLE team_api_keys_old;

PRAGMA foreign_keys = ON;
