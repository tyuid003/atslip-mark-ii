-- ATslip Mark-II Database Schema
-- Multi-tenant Auto Deposit System

-- ============================================================
-- 1. TEAMS TABLE (ทีม)
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
-- 2. TENANTS TABLE (เว็บ)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  admin_api_url TEXT NOT NULL,
  admin_username TEXT NOT NULL,
  admin_password TEXT NOT NULL,
  easyslip_token TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  auto_deposit_enabled INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX idx_tenants_team ON tenants(team_id);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_created ON tenants(created_at);

-- ============================================================
-- 3. LINE OA TABLE (LINE Official Accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS line_oas (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_secret TEXT NOT NULL,
  channel_access_token TEXT NOT NULL,
  webhook_enabled INTEGER DEFAULT 1 CHECK(webhook_enabled IN (0, 1)),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_line_oas_team ON line_oas(team_id);
CREATE INDEX idx_line_oas_tenant ON line_oas(tenant_id);
CREATE INDEX idx_line_oas_status ON line_oas(status);
CREATE UNIQUE INDEX idx_line_oas_channel ON line_oas(channel_id);

-- ============================================================
-- 4. ADMIN SESSIONS TABLE (เก็บ session token หลังจาก login)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  session_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_sessions_team ON admin_sessions(team_id);
CREATE INDEX idx_admin_sessions_tenant ON admin_sessions(tenant_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

-- ============================================================
-- 5. PENDING TRANSACTIONS TABLE (สลิปที่รอจับคู่)
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_transactions (
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
  source TEXT DEFAULT 'webhook' CHECK(source IN ('webhook', 'manual', 'upload')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (line_oa_id) REFERENCES line_oas(id) ON DELETE SET NULL
);

CREATE INDEX idx_pending_team ON pending_transactions(team_id);
CREATE INDEX idx_pending_tenant ON pending_transactions(tenant_id);
CREATE INDEX idx_pending_status ON pending_transactions(status);
CREATE INDEX idx_pending_created ON pending_transactions(created_at);
CREATE INDEX idx_pending_slip_ref ON pending_transactions(slip_ref);
CREATE INDEX idx_pending_source ON pending_transactions(source);

-- ============================================================
-- 6. CREDIT LOGS TABLE (บันทึกการเติมเครดิต)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_logs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  amount REAL NOT NULL,
  slip_ref TEXT NOT NULL,
  response_data TEXT,
  status TEXT DEFAULT 'success' CHECK(status IN ('success', 'failed', 'duplicate')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES pending_transactions(id) ON DELETE CASCADE
);

CREATE INDEX idx_credit_logs_team ON credit_logs(team_id);
CREATE INDEX idx_credit_logs_tenant ON credit_logs(tenant_id);
CREATE INDEX idx_credit_logs_user ON credit_logs(user_id);
CREATE INDEX idx_credit_logs_slip_ref ON credit_logs(slip_ref);
CREATE INDEX idx_credit_logs_created ON credit_logs(created_at);

-- ============================================================
-- 7. SYSTEM SETTINGS TABLE (ตั้งค่าระบบ)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO system_settings (key, value, description, updated_at) VALUES
('auto_deposit_enabled', 'true', 'เปิด/ปิดการเติมเครดิตอัตโนมัติ', unixepoch()),
('bank_account_cache_ttl', '3600', 'TTL สำหรับ cache บัญชีธนาคาร (วินาที)', unixepoch()),
('name_match_min_chars', '4', 'จำนวนตัวอักษรขั้นต่ำสำหรับการจับคู่ชื่อ', unixepoch()),
('account_match_min_digits', '3', 'จำนวนตัวเลขขั้นต่ำสำหรับการจับคู่บัญชี', unixepoch());

-- ============================================================
-- DEFAULT DATA
-- ============================================================

-- สร้าง default team
INSERT OR IGNORE INTO teams (id, name, slug, description, status, created_at, updated_at) VALUES
('default-team', 'Default Team', 'default', 'Default team for initial setup', 'active', unixepoch(), unixepoch());
