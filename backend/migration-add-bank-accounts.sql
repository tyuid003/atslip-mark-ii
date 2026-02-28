-- Migration: Add tenant_bank_accounts table for storing bank account metadata
-- This table stores additional information for bank accounts including English names
-- for better matching with slip data

-- ============================================================
-- TENANT BANK ACCOUNTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_bank_accounts (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,           -- ID จาก Admin API
  account_number TEXT NOT NULL,       -- เลขบัญชี
  account_name_th TEXT,                -- ชื่อบัญชีภาษาไทย (จาก Admin API)
  account_name_en TEXT,                -- ชื่อบัญชีภาษาอังกฤษ (ให้ผู้ใช้แก้ไข manual)
  bank_id TEXT,                        -- รหัสธนาคาร (เช่น 002, 004)
  bank_name TEXT,                      -- ชื่อธนาคาร (เช่น กรุงเทพ, กสิกรไทย)
  bank_short TEXT,                     -- ชื่อย่อธนาคาร (เช่น BBL, KBANK)
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX idx_tenant_bank_accounts_team ON tenant_bank_accounts(team_id);
CREATE INDEX idx_tenant_bank_accounts_tenant ON tenant_bank_accounts(tenant_id);
CREATE INDEX idx_tenant_bank_accounts_account_id ON tenant_bank_accounts(account_id);
CREATE INDEX idx_tenant_bank_accounts_account_number ON tenant_bank_accounts(account_number);
CREATE INDEX idx_tenant_bank_accounts_status ON tenant_bank_accounts(status);
CREATE UNIQUE INDEX idx_tenant_bank_accounts_unique ON tenant_bank_accounts(tenant_id, account_id);
