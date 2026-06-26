-- Migration 013: Telegram User Authentication
-- เพิ่มตาราง telegram_users และ device_sessions สำหรับระบบ login ด้วย Telegram

-- ============================================================
-- 1. ตาราง telegram_users
--    เก็บข้อมูลผู้ใช้จาก Telegram + display_name ที่ผู้ใช้ตั้งเอง
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id         TEXT    NOT NULL UNIQUE,
  telegram_first_name TEXT    NOT NULL DEFAULT '',
  telegram_last_name  TEXT    NOT NULL DEFAULT '',
  telegram_username   TEXT    NOT NULL DEFAULT '',
  telegram_phone      TEXT    NOT NULL DEFAULT '',
  display_name        TEXT    DEFAULT NULL,  -- NULL = ใช้ชื่อ Telegram เดิม
  session_string      TEXT    NOT NULL DEFAULT '',
  photo_kv_key        TEXT    DEFAULT NULL,  -- key ใน BANK_KV สำหรับรูปโปรไฟล์
  created_at          INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at          INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_telegram_id ON telegram_users(telegram_id);

-- ============================================================
-- 2. ตาราง device_sessions
--    1 device = 1 session เท่านั้น (device_token เก็บใน localStorage)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  device_token     TEXT    NOT NULL,           -- UUID ที่สร้างครั้งแรกต่อ device
  telegram_user_id INTEGER NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  app_session_token TEXT   NOT NULL UNIQUE,    -- token ที่ใช้ authenticate กับ backend
  is_active        INTEGER NOT NULL DEFAULT 1, -- 1=active, 0=revoked
  created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_device_token    ON device_sessions(device_token);
CREATE INDEX IF NOT EXISTS idx_device_sessions_app_token       ON device_sessions(app_session_token);
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id         ON device_sessions(telegram_user_id);
