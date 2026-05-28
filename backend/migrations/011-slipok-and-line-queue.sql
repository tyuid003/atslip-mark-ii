-- Migration 011: เพิ่ม SlipOK กลับมาเป็น provider ตัวที่ 3 + เพิ่ม 'line' ใน scan_jobs source
-- SQLite ไม่รองรับ ALTER CHECK constraint โดยตรง ต้อง rebuild table ทั้ง 2 ตาราง

-- ============================================================
-- 1. Rebuild team_api_keys → เพิ่ม 'slipok' ใน service check
-- ============================================================
CREATE TABLE team_api_keys_v11 (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  service      TEXT NOT NULL CHECK (service IN ('easyslip', 'slip2go', 'slipok')),
  label        TEXT,
  api_key      TEXT NOT NULL,
  branch_id    TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_used_at INTEGER DEFAULT NULL,   -- Unix timestamp ล่าสุดที่ key ถูกเลือก (สำหรับ round-robin)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO team_api_keys_v11 (id, team_id, service, label, api_key, branch_id, priority, status, created_at, updated_at)
SELECT id, team_id, service, label, api_key, branch_id, priority, status, created_at, updated_at
FROM team_api_keys;

DROP TABLE team_api_keys;
ALTER TABLE team_api_keys_v11 RENAME TO team_api_keys;

CREATE INDEX idx_team_api_keys_team ON team_api_keys(team_id, priority);
CREATE INDEX idx_team_api_keys_team_service ON team_api_keys(team_id, service, priority);

-- ============================================================
-- 2. Rebuild scan_jobs → เพิ่ม 'line' ใน source check
-- ============================================================
CREATE TABLE scan_jobs_v11 (
  id                     TEXT PRIMARY KEY,
  team_id                TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tenant_id              TEXT,
  source                 TEXT NOT NULL CHECK(source IN ('webhook', 'manual', 'upload', 'telegram', 'line')),
  idempotency_key        TEXT NOT NULL,
  trace_id               TEXT NOT NULL,
  payload_json           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'queued'
                           CHECK(status IN ('queued', 'processing', 'success', 'failed', 'dead_letter')),
  attempts               INTEGER NOT NULL DEFAULT 0,
  max_attempts           INTEGER NOT NULL DEFAULT 5,
  next_attempt_at        INTEGER NOT NULL,
  last_error             TEXT,
  result_json            TEXT,
  pending_transaction_id TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  completed_at           INTEGER
);

INSERT INTO scan_jobs_v11 SELECT * FROM scan_jobs;

DROP TABLE scan_jobs;
ALTER TABLE scan_jobs_v11 RENAME TO scan_jobs;

CREATE INDEX idx_scan_jobs_team ON scan_jobs(team_id);
CREATE INDEX idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX idx_scan_jobs_next_attempt ON scan_jobs(next_attempt_at);
CREATE INDEX idx_scan_jobs_team_status ON scan_jobs(team_id, status);
CREATE UNIQUE INDEX idx_scan_jobs_idempotency ON scan_jobs(team_id, idempotency_key);
