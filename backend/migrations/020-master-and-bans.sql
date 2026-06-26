-- Migration 020: Add is_master flag to telegram_users, create team_bans table

-- 1. Add is_master column to telegram_users
ALTER TABLE telegram_users ADD COLUMN is_master INTEGER DEFAULT 0 CHECK(is_master IN (0, 1));

-- 2. Create team_bans table
CREATE TABLE IF NOT EXISTS team_bans (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(team_id, telegram_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX idx_team_bans_team ON team_bans(team_id);
CREATE INDEX idx_team_bans_telegram ON team_bans(telegram_id);
