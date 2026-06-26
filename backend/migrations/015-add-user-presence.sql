-- Migration 015: User presence tracking (online users per team)
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      TEXT    NOT NULL,
  team_id      TEXT    NOT NULL,
  display_name TEXT,
  last_seen    INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_user_presence_team ON user_presence(team_id, last_seen);
