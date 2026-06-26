-- Migration 019: สร้าง table team_join_requests สำหรับ approval system
-- เมื่อ user เข้า URL ของทีมที่ยังไม่มี user_presence row → ส่ง join request
-- สมาชิกในทีมสามารถ approve/reject ผ่าน realtime notification

CREATE TABLE IF NOT EXISTS team_join_requests (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  telegram_id  TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  photo        TEXT DEFAULT NULL,       -- base64 profile photo (สำหรับ notification)
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by  TEXT DEFAULT NULL,       -- telegram_id ของคนที่ approve/reject
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  UNIQUE (team_id, telegram_id)         -- ต่อทีม 1 คนมีได้แค่ 1 request ที่ active
);

CREATE INDEX IF NOT EXISTS idx_join_requests_team_status
  ON team_join_requests (team_id, status);
