-- 9. REPORT LOGS TABLE (บันทึกรีพอร์ตปัญหารายการ)
CREATE TABLE IF NOT EXISTS report_logs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  transaction_id TEXT NOT NULL,
  sender_name TEXT,
  detail TEXT NOT NULL,
  report_types TEXT, -- JSON array string
  created_at INTEGER NOT NULL,
  metadata TEXT, -- ข้อมูลอื่นๆ (JSON string)
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES pending_transactions(id) ON DELETE CASCADE
);

CREATE INDEX idx_report_logs_team ON report_logs(team_id);
CREATE INDEX idx_report_logs_tenant ON report_logs(tenant_id);
CREATE INDEX idx_report_logs_transaction ON report_logs(transaction_id);
CREATE INDEX idx_report_logs_created ON report_logs(created_at);
