-- 008 — Team-level API Keys for slip verification providers
-- รองรับหลาย key ต่อทีม, แยก service (easyslip / slipok), เรียงลำดับ priority (น้อย = บนสุด = ตัวหลัก)
-- ยังคงเก็บ teams.easyslip_token และ tenants.easyslip_token ไว้เป็น fallback (ไม่ลบในรอบนี้เพื่อไม่ให้ผู้ใช้ปัจจุบันสะดุด)

CREATE TABLE IF NOT EXISTS team_api_keys (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL,
  service      TEXT NOT NULL CHECK (service IN ('easyslip', 'slipok')),
  label        TEXT,
  api_key      TEXT NOT NULL,
  branch_id    TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_api_keys_team ON team_api_keys(team_id, priority);
CREATE INDEX IF NOT EXISTS idx_team_api_keys_team_service ON team_api_keys(team_id, service, priority);
