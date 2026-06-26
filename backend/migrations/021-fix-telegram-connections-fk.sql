-- Migration 021: Fix dangling FK in team_telegram_connections
--
-- Root cause: migration 018 did ALTER TABLE team_api_keys RENAME TO team_api_keys_old.
-- SQLite automatically updated team_telegram_connections.selected_api_key_id FK to point
-- to "team_api_keys_old". Migration 018 then dropped team_api_keys_old but the FK in
-- team_telegram_connections was never updated, leaving it referencing a non-existent table.
-- This caused DELETE FROM teams to fail with a 500 error because D1 has foreign_keys=1.
--
-- Fix: rebuild team_telegram_connections with FK pointing to the correct team_api_keys table.

PRAGMA foreign_keys = OFF;

ALTER TABLE team_telegram_connections RENAME TO team_telegram_connections_broken;

CREATE TABLE team_telegram_connections (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL UNIQUE,
  telegram_group_id    TEXT NOT NULL UNIQUE,
  telegram_group_title TEXT,
  telegram_bot_id      TEXT NOT NULL,
  telegram_bot_token   TEXT NOT NULL,
  webhook_secret       TEXT,
  status               TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  selected_api_key_id  TEXT REFERENCES team_api_keys(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

INSERT INTO team_telegram_connections SELECT * FROM team_telegram_connections_broken;

DROP TABLE team_telegram_connections_broken;

PRAGMA foreign_keys = ON;
