-- Migration 005: Add Telegram integration tables
-- Date: 2026-05-20
-- Purpose: Foundation for Telegram version (additive, behind feature flag)
-- Safe to run in production: all changes are additive; no existing tables modified.

-- ============================================================
-- 1. Add feature flag to teams
-- ============================================================
-- ใช้สำหรับเปิด/ปิดฟีเจอร์ Telegram ต่อทีม
-- 0 = ปิด (ค่า default, browser-only เหมือนเดิม), 1 = เปิด
ALTER TABLE teams ADD COLUMN telegram_enabled INTEGER DEFAULT 0;

-- ============================================================
-- 2. team_telegram_connections (1 team : 1 group)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_telegram_connections (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL UNIQUE,
  telegram_group_id TEXT NOT NULL UNIQUE,
  telegram_group_title TEXT,
  telegram_bot_id TEXT NOT NULL,
  telegram_bot_token TEXT NOT NULL, -- เข้ารหัสก่อนเก็บ (ผ่าน util ใน service layer)
  webhook_secret TEXT,              -- secret_token สำหรับยืนยัน Telegram webhook
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tg_conn_team ON team_telegram_connections(team_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_group ON team_telegram_connections(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_status ON team_telegram_connections(status);

-- ============================================================
-- 3. telegram_message_links (map ข้อความ Telegram <-> pending tx)
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_message_links (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  telegram_group_id TEXT NOT NULL,
  telegram_message_id TEXT NOT NULL,
  pending_transaction_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK(message_type IN ('scan_result', 'status_update', 'manual_prompt')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (pending_transaction_id) REFERENCES pending_transactions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tg_msg_team ON telegram_message_links(team_id);
CREATE INDEX IF NOT EXISTS idx_tg_msg_group ON telegram_message_links(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_tg_msg_pending ON telegram_message_links(pending_transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_msg_unique
  ON telegram_message_links(telegram_group_id, telegram_message_id);

-- ============================================================
-- 4. telegram_chat_state (state คำสั่งสนทนาแบบมี TTL)
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_chat_state (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  telegram_group_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  state_payload_json TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tg_state_team ON telegram_chat_state(team_id);
CREATE INDEX IF NOT EXISTS idx_tg_state_user ON telegram_chat_state(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_state_expires ON telegram_chat_state(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_state_unique
  ON telegram_chat_state(telegram_group_id, telegram_user_id, state_key);

-- ============================================================
-- 5. scan_jobs (queue ส่วนกลาง รองรับหลายสลิปพร้อมกัน)
-- ============================================================
-- ใช้รับงานจากทุกช่องทาง (browser, telegram) แล้ว worker ดึงไปประมวลผล
-- FIFO ต่อทีม (partition by team_id) + idempotency
CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('webhook', 'manual', 'upload', 'telegram')),
  idempotency_key TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,     -- ข้อมูล input เช่น url รูป, line_oa_id, telegram_message_id
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued', 'processing', 'success', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  result_json TEXT,
  pending_transaction_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_team ON scan_jobs(team_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_next_attempt ON scan_jobs(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_team_status ON scan_jobs(team_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_jobs_idempotency
  ON scan_jobs(team_id, idempotency_key);
