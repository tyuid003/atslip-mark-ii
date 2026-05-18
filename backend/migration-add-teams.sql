-- Migration: Add Multi-Team Support
-- เพิ่มระบบ multi-team โดยแต่ละทีมจะแยกการตั้งค่าด้วย path ในลิ้งก์

-- ============================================================
-- 1. สร้าง teams table
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_teams_slug ON teams(slug);
CREATE INDEX idx_teams_status ON teams(status);

-- ============================================================
-- 2. เพิ่ม team_id column ในทุก table ที่เกี่ยวข้อง
-- ============================================================

-- เพิ่ม team_id ใน tenants table
ALTER TABLE tenants ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX idx_tenants_team ON tenants(team_id);

-- เพิ่ม team_id ใน line_oas table
ALTER TABLE line_oas ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX idx_line_oas_team ON line_oas(team_id);

-- เพิ่ม team_id ใน pending_transactions table
ALTER TABLE pending_transactions ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX idx_pending_transactions_team ON pending_transactions(team_id);

-- เพิ่ม team_id ใน credit_logs table
ALTER TABLE credit_logs ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX idx_credit_logs_team ON credit_logs(team_id);

-- เพิ่ม team_id ใน admin_sessions table
ALTER TABLE admin_sessions ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX idx_admin_sessions_team ON admin_sessions(team_id);

-- ============================================================
-- 3. สร้าง default team สำหรับข้อมูลเดิม
-- ============================================================
INSERT INTO teams (id, name, slug, description, status, created_at, updated_at)
VALUES (
  'default-team',
  'Default Team',
  'default',
  'Default team for existing data',
  'active',
  unixepoch(),
  unixepoch()
);

-- ============================================================
-- 4. อัพเดท team_id สำหรับข้อมูลเดิมให้ใช้ default team
-- ============================================================
UPDATE tenants SET team_id = 'default-team' WHERE team_id IS NULL;
UPDATE line_oas SET team_id = 'default-team' WHERE team_id IS NULL;
UPDATE pending_transactions SET team_id = 'default-team' WHERE team_id IS NULL;
UPDATE credit_logs SET team_id = 'default-team' WHERE team_id IS NULL;
UPDATE admin_sessions SET team_id = 'default-team' WHERE team_id IS NULL;
