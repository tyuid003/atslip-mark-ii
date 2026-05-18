// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
  PENDING_NOTIFICATIONS: DurableObjectNamespace;
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
  source: 'webhook' | 'manual' | 'upload';
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
