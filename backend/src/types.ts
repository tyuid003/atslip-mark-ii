// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
  PENDING_NOTIFICATIONS: DurableObjectNamespace;
  // Optional Telegram secret key สำหรับ encrypt bot_token ก่อนเก็บ DB
  // ตั้งค่าด้วย `npx wrangler secret put TELEGRAM_TOKEN_KEY`
  TELEGRAM_TOKEN_KEY?: string;
}

// ============================================================
// TENANT TYPES
// ============================================================

export interface Tenant {
  id: string;
  team_id: string;
  name: string;
  slug?: string;
  admin_api_url: string;
  admin_username: string;
  admin_password: string;
  easyslip_token: string;
  line_oa_id?: string | null;
  auto_deposit_enabled: number;
  status: 'active' | 'inactive';
  created_at: number;
  updated_at: number;
}

export interface TenantWithStats extends Tenant {
  line_oa_count: number;
  bank_account_count: number;
  pending_count: number;
  admin_connected: boolean;
}

export interface CreateTenantRequest {
  name: string;
  admin_api_url: string;
  admin_username: string;
  admin_password: string;
  easyslip_token: string;
}

export interface UpdateTenantRequest {
  name?: string;
  admin_api_url?: string;
  admin_username?: string;
  admin_password?: string;
  easyslip_token?: string;
  status?: 'active' | 'inactive';
}

// ============================================================
// LINE OA TYPES
// ============================================================

export interface LineOA {
  id: string;
  tenant_id: string;
  name: string;
  channel_id: string;
  channel_secret: string;
  channel_access_token: string;
  webhook_enabled: number;
  status: 'active' | 'inactive';
  created_at: number;
  updated_at: number;
}

export interface CreateLineOARequest {
  tenant_id: string;
  name: string;
  channel_id: string;
  channel_secret: string;
  channel_access_token: string;
}

export interface UpdateLineOARequest {
  name?: string;
  channel_id?: string;
  channel_secret?: string;
  channel_access_token?: string;
  webhook_enabled?: number;
  status?: 'active' | 'inactive';
}

// ============================================================
// BANK ACCOUNT TYPES
// ============================================================

export interface BankAccount {
  accountNumber: string;
  accountName: string;
  bankCode?: string;
  bankName?: string;
}

export interface BankAccountCache {
  tenant_id: string;
  accounts: BankAccount[];
  cached_at: number;
  expires_at: number;
}

// ============================================================
// ADMIN SESSION TYPES
// ============================================================

export interface AdminSession {
  id: string;
  tenant_id: string;
  session_token: string;
  expires_at: number;
  created_at: number;
}

// ============================================================
// TRANSACTION TYPES
// ============================================================

export interface PendingTransaction {
  id: string;
  tenant_id: string;
  line_oa_id: string | null;
  slip_ref: string;
  amount: number;
  sender_name: string;
  sender_account: string;
  receiver_name: string | null;
  receiver_account: string | null;
  slip_data: string;
  matched_user_id: string | null;
  matched_username: string | null;
  status: 'pending' | 'matched' | 'credited' | 'duplicate' | 'failed';
  source: 'webhook' | 'manual' | 'upload' | 'telegram';
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// TELEGRAM TYPES (Phase A scaffold)
// ============================================================

export interface TeamTelegramConnection {
  id: string;
  team_id: string;
  telegram_group_id: string;
  telegram_group_title: string | null;
  telegram_bot_id: string;
  telegram_bot_token: string; // stored encrypted; service layer must decrypt
  webhook_secret: string | null;
  status: 'active' | 'inactive';
  created_at: number;
  updated_at: number;
}

export interface CreateTelegramConnectionRequest {
  team_id: string;
  telegram_group_id: string;
  telegram_group_title?: string;
  telegram_bot_id: string;
  telegram_bot_token: string;
}

export interface UpdateTelegramConnectionRequest {
  telegram_group_id?: string;
  telegram_group_title?: string;
  telegram_bot_id?: string;
  telegram_bot_token?: string;
  status?: 'active' | 'inactive';
}

export interface TelegramMessageLink {
  id: string;
  team_id: string;
  telegram_group_id: string;
  telegram_message_id: string;
  pending_transaction_id: string;
  message_type: 'scan_result' | 'status_update' | 'manual_prompt';
  created_at: number;
}

export interface TelegramChatState {
  id: string;
  team_id: string;
  telegram_group_id: string;
  telegram_user_id: string;
  state_key: string;
  state_payload_json: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

// Scan queue job (shared by all sources)
export interface ScanJob {
  id: string;
  team_id: string;
  tenant_id: string | null;
  source: 'webhook' | 'manual' | 'upload' | 'telegram';
  idempotency_key: string;
  trace_id: string;
  payload_json: string;
  status: 'queued' | 'processing' | 'success' | 'failed' | 'dead_letter';
  attempts: number;
  max_attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  result_json: string | null;
  pending_transaction_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

// ============================================================
// TEAM TYPES (extension for telegram_enabled flag)
// ============================================================

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'inactive';
  telegram_enabled: number; // 0 = off, 1 = on
  easyslip_token: string | null; // team-level token สำหรับ Upload/Telegram (null = ใช้ token เว็บแรก)
  created_at: number;
  updated_at: number;
}

// ============================================================
// TEAM API KEYS (multi-provider, multi-key per team)
// ============================================================

export type SlipServiceProvider = 'easyslip' | 'slip2go';

export interface TeamApiKey {
  id: string;
  team_id: string;
  service: SlipServiceProvider;
  label: string | null;
  api_key: string;
  branch_id: string | null; // legacy column — Slip2Go ไม่ใช้ (always null)
  priority: number;         // น้อย = บนสุด = primary
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}
