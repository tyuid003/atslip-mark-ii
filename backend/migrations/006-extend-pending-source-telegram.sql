-- Migration 006: Extend pending_transactions.source to include 'telegram'
-- Date: 2026-05-20
-- Reason: SQLite ไม่รองรับการแก้ CHECK constraint โดยตรง ต้อง rebuild ตาราง
--
-- ขั้นตอน:
--  1) ปิด foreign keys ชั่วคราว (D1: PRAGMA defer_foreign_keys)
--  2) สร้างตารางใหม่ที่มี CHECK รวม 'telegram'
--  3) copy ข้อมูล
--  4) drop ตารางเดิม + rename ตารางใหม่
--  5) recreate index เดิม
--
-- ปลอดภัย: รักษา column/data เดิมไว้ครบ และ default ยังเป็น 'webhook'

PRAGMA defer_foreign_keys = ON;

CREATE TABLE pending_transactions_new (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  line_oa_id TEXT,
  slip_ref TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  sender_name TEXT NOT NULL,
  sender_account TEXT NOT NULL,
  receiver_name TEXT,
  receiver_account TEXT,
  slip_data TEXT NOT NULL,
  matched_user_id TEXT,
  matched_username TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'matched', 'credited', 'duplicate', 'failed')),
  source TEXT DEFAULT 'webhook' CHECK(source IN ('webhook', 'manual', 'upload', 'telegram')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (line_oa_id) REFERENCES line_oas(id) ON DELETE SET NULL
);

INSERT INTO pending_transactions_new
  (id, team_id, tenant_id, line_oa_id, slip_ref, amount,
   sender_name, sender_account, receiver_name, receiver_account,
   slip_data, matched_user_id, matched_username, status, source,
   error_message, created_at, updated_at)
SELECT
   id, team_id, tenant_id, line_oa_id, slip_ref, amount,
   sender_name, sender_account, receiver_name, receiver_account,
   slip_data, matched_user_id, matched_username, status, source,
   error_message, created_at, updated_at
FROM pending_transactions;

DROP TABLE pending_transactions;
ALTER TABLE pending_transactions_new RENAME TO pending_transactions;

CREATE INDEX IF NOT EXISTS idx_pending_team ON pending_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_pending_tenant ON pending_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_pending_slip_ref ON pending_transactions(slip_ref);
CREATE INDEX IF NOT EXISTS idx_pending_source ON pending_transactions(source);
