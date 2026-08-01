-- Migration 024: เปลี่ยนระบบ login จาก Telegram เป็น username/password
-- และเพิ่ม role (admin/member) สำหรับแต่ละทีม

-- 1. เพิ่ม username และ password_hash ใน telegram_users
ALTER TABLE telegram_users ADD COLUMN username TEXT DEFAULT NULL;
ALTER TABLE telegram_users ADD COLUMN password_hash TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_users_username ON telegram_users(username) WHERE username IS NOT NULL;

-- 2. เพิ่ม role ใน user_presence (per-team role)
ALTER TABLE user_presence ADD COLUMN role TEXT DEFAULT 'member' CHECK(role IN ('admin', 'member'));
