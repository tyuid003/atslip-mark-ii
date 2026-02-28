-- Auto Deposit System - D1 Database Schema

-- Pending Transactions Table
CREATE TABLE IF NOT EXISTS pending_transactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  amount REAL NOT NULL,
  senderName TEXT NOT NULL,
  senderAccount TEXT NOT NULL,
  slipRef TEXT UNIQUE NOT NULL,
  slipData TEXT NOT NULL,
  userId TEXT,
  userCategory TEXT,
  status TEXT DEFAULT 'pending',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_tenantId ON pending_transactions(tenantId);
CREATE INDEX idx_status ON pending_transactions(status);
CREATE INDEX idx_createdAt ON pending_transactions(createdAt);
CREATE INDEX idx_slipRef ON pending_transactions(slipRef);
CREATE INDEX idx_userId ON pending_transactions(userId);

-- Tenant Settings Table
CREATE TABLE IF NOT EXISTS tenant_settings (
  id TEXT PRIMARY KEY,
  tenantId TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  lineChannelId TEXT,
  lineChannelSecret TEXT,
  lineAccessToken TEXT,
  easyslipKey TEXT,
  apiBaseUrl TEXT,
  sessionMode TEXT DEFAULT 'per-tenant',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Message Templates Table
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  messageType TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  template TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(tenantId, messageType)
);

-- Bank Accounts Cache Table (alternative to KV)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  accountName TEXT NOT NULL,
  bankCode TEXT,
  isActive INTEGER DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(tenantId, accountNumber)
);

-- Indexes for settings and templates
CREATE INDEX idx_tenant_settings ON tenant_settings(tenantId);
CREATE INDEX idx_message_tenant ON message_templates(tenantId);
CREATE INDEX idx_message_type ON message_templates(messageType);
CREATE INDEX idx_bank_tenant ON bank_accounts(tenantId);
CREATE INDEX idx_bank_active ON bank_accounts(isActive);
