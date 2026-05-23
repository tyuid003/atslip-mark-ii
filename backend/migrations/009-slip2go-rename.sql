-- Migration 009: rename slipok provider → slip2go in team_api_keys
-- เปลี่ยนผู้ให้บริการตัวที่สองจาก SlipOK (ต้อง branch ต่อร้าน) เป็น Slip2Go
-- (API Secret เดียวต่อทีม, ไม่ต้อง branch ID)
--
-- SQLite ไม่รองรับการ ALTER CHECK constraint โดยตรง ต้อง rebuild table

CREATE TABLE team_api_keys_new (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  service      TEXT NOT NULL CHECK (service IN ('easyslip', 'slip2go')),
  label        TEXT,
  api_key      TEXT NOT NULL,
  branch_id    TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO team_api_keys_new (id, team_id, service, label, api_key, branch_id, priority, status, created_at, updated_at)
SELECT id, team_id,
       CASE WHEN service = 'slipok' THEN 'slip2go' ELSE service END,
       label, api_key, branch_id, priority, status, created_at, updated_at
FROM team_api_keys;

DROP TABLE team_api_keys;
ALTER TABLE team_api_keys_new RENAME TO team_api_keys;

CREATE INDEX idx_team_api_keys_team ON team_api_keys(team_id, priority);
CREATE INDEX idx_team_api_keys_team_service ON team_api_keys(team_id, service, priority);
