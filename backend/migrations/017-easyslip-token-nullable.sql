-- Migration 017: Make easyslip_token nullable (no longer required at tenant creation)
-- IMPORTANT: disable foreign keys so DROP TABLE does not cascade to child tables
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS tenants_new (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  admin_api_url       TEXT NOT NULL,
  admin_username      TEXT NOT NULL,
  admin_password      TEXT NOT NULL,
  easyslip_token      TEXT DEFAULT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  auto_deposit_enabled INTEGER NOT NULL DEFAULT 0,
  team_id             TEXT,
  created_at          INTEGER,
  updated_at          INTEGER
);

INSERT INTO tenants_new SELECT
  id, name, admin_api_url, admin_username, admin_password,
  NULLIF(easyslip_token, ''),
  status, auto_deposit_enabled, team_id, created_at, updated_at
FROM tenants;

DROP TABLE tenants;
ALTER TABLE tenants_new RENAME TO tenants;

PRAGMA foreign_keys = ON;
