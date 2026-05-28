-- Migration 012: Add 'line' to source CHECK constraint in pending_transactions
-- Root cause: LINE queue jobs use source='line' but the CHECK constraint
-- only allows ('webhook', 'manual', 'upload', 'telegram'), causing DB INSERT to fail silently.
-- All LINE scan_jobs were marked 'success' at queue level but no pending_transactions were created.

PRAGMA foreign_keys = OFF;

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
  source TEXT DEFAULT 'webhook' CHECK(source IN ('webhook', 'manual', 'upload', 'telegram', 'line')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (line_oa_id) REFERENCES line_oas(id) ON DELETE SET NULL
);

INSERT INTO pending_transactions_new SELECT * FROM pending_transactions;

DROP TABLE pending_transactions;

ALTER TABLE pending_transactions_new RENAME TO pending_transactions;

CREATE INDEX IF NOT EXISTS idx_pending_team ON pending_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_pending_tenant ON pending_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_pending_slip_ref ON pending_transactions(slip_ref);
CREATE INDEX IF NOT EXISTS idx_pending_source ON pending_transactions(source);

PRAGMA foreign_keys = ON;
