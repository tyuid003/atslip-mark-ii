-- Migration 014: เพิ่ม 'ushop' ใน scan_jobs.source CHECK constraint
-- จำเป็นสำหรับการเชื่อมต่อ univers_shop (U-shop) ที่ enqueue งานสแกนด้วย source='ushop'
-- SQLite แก้ CHECK constraint ไม่ได้โดยตรง จึงต้อง rebuild ตาราง (เลียนแบบ migration 011)

-- ============================================================
-- Rebuild scan_jobs → เพิ่ม 'ushop' ใน source check
-- ============================================================
CREATE TABLE scan_jobs_v14 (
  id                     TEXT PRIMARY KEY,
  team_id                TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tenant_id              TEXT,
  source                 TEXT NOT NULL CHECK(source IN ('webhook', 'manual', 'upload', 'telegram', 'line', 'ushop')),
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

INSERT INTO scan_jobs_v14 SELECT * FROM scan_jobs;

DROP TABLE scan_jobs;
ALTER TABLE scan_jobs_v14 RENAME TO scan_jobs;

CREATE INDEX idx_scan_jobs_team ON scan_jobs(team_id);
CREATE INDEX idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX idx_scan_jobs_next_attempt ON scan_jobs(next_attempt_at);
CREATE INDEX idx_scan_jobs_team_status ON scan_jobs(team_id, status);
CREATE UNIQUE INDEX idx_scan_jobs_idempotency ON scan_jobs(team_id, idempotency_key);
