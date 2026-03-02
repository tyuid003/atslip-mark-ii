// Tenant Repository - Database operations for tenant management

export interface TenantSettings {
  tenantId: string;
  tenantName: string;
  apiBaseUrl: string;
  adminUsername?: string;
  lineChannelId?: string;
  lineChannelSecret?: string;
  lineAccessToken?: string;
  sessionMode: string;
  accountListTtl: number;
}

export interface Tenant {
  tenantId: string;
  tenantName: string;
  apiBaseUrl: string;
  adminUsername?: string;
  lineChannelId?: string;
  lineChannelSecret?: string;
  lineAccessToken?: string;
  sessionMode: string;
  accountListTtl: number;
  adminAuthStatus: string;
  easyslipStatus: string;
}

export async function upsertTenant(env: any, settings: TenantSettings): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO tenants (
      tenant_id, tenant_name, api_base_url, admin_username,
      line_channel_id, line_channel_secret, line_access_token,
      session_mode, account_list_ttl_min, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      tenant_name = excluded.tenant_name,
      api_base_url = excluded.api_base_url,
      admin_username = excluded.admin_username,
      line_channel_id = excluded.line_channel_id,
      line_channel_secret = excluded.line_channel_secret,
      line_access_token = excluded.line_access_token,
      session_mode = excluded.session_mode,
      account_list_ttl_min = excluded.account_list_ttl_min,
      updated_at = excluded.updated_at
  `).bind(
    settings.tenantId,
    settings.tenantName,
    settings.apiBaseUrl,
    settings.adminUsername ?? null,
    settings.lineChannelId ?? null,
    settings.lineChannelSecret ?? null,
    settings.lineAccessToken ?? null,
    settings.sessionMode,
    settings.accountListTtl,
    now,
    now
  ).run();
}

export async function getTenant(env: any, tenantId: string): Promise<Tenant | null> {
  const result = await env.DB.prepare(`
    SELECT 
      t.tenant_id, t.tenant_name, t.api_base_url, t.admin_username, 
      t.line_channel_id, t.line_channel_secret, 
      t.line_access_token, t.session_mode, t.account_list_ttl_min,
      CASE 
        WHEN s.token IS NOT NULL AND s.status = 'ACTIVE' THEN 'connected'
        ELSE 'not_connected'
      END as admin_auth_status,
      CASE 
        WHEN e.token IS NOT NULL AND e.is_active = 1 THEN 'connected'
        ELSE 'not_connected'
      END as easyslip_status
    FROM tenants t
    LEFT JOIN tenant_sessions s ON t.tenant_id = s.tenant_id
    LEFT JOIN easyslip_configs e ON t.tenant_id = e.tenant_id
    WHERE t.tenant_id = ?
  `).bind(tenantId).first();

  if (!result) {
    return null;
  }

  return {
    tenantId: result.tenant_id,
    tenantName: result.tenant_name,
    apiBaseUrl: result.api_base_url,
    adminUsername: result.admin_username,
    lineChannelId: result.line_channel_id,
    lineChannelSecret: result.line_channel_secret,
    lineAccessToken: result.line_access_token,
    sessionMode: result.session_mode,
    accountListTtl: result.account_list_ttl_min,
    adminAuthStatus: result.admin_auth_status,
    easyslipStatus: result.easyslip_status
  };
}

export async function listTenants(env: any): Promise<Tenant[]> {
  const results = await env.DB.prepare(`
    SELECT 
      t.tenant_id, t.tenant_name, t.api_base_url, t.admin_username, 
      t.line_channel_id, t.line_channel_secret, 
      t.line_access_token, t.session_mode, t.account_list_ttl_min,
      CASE 
        WHEN s.token IS NOT NULL AND s.status = 'ACTIVE' THEN 'connected'
        ELSE 'not_connected'
      END as admin_auth_status,
      CASE 
        WHEN e.token IS NOT NULL AND e.is_active = 1 THEN 'connected'
        ELSE 'not_connected'
      END as easyslip_status,
      COALESCE((SELECT COUNT(*) FROM line_oas WHERE tenant_id = t.tenant_id), 0) as line_oa_count
    FROM tenants t
    LEFT JOIN tenant_sessions s ON t.tenant_id = s.tenant_id
    LEFT JOIN easyslip_configs e ON t.tenant_id = e.tenant_id
    ORDER BY t.created_at DESC
  `).all();

  return (results.results || []).map((row: any) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    apiBaseUrl: row.api_base_url,
    adminUsername: row.admin_username,
    lineChannelId: row.line_channel_id,
    lineChannelSecret: row.line_channel_secret,
    lineAccessToken: row.line_access_token,
    lineChannelName: row.line_oa_count > 0 ? `${row.line_oa_count} LINE OA(s)` : undefined,
    sessionMode: row.session_mode,
    accountListTtl: row.account_list_ttl_min,
    adminAuthStatus: row.admin_auth_status,
    easyslipStatus: row.easyslip_status
  }));
}

export async function deleteTenant(env: any, tenantId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM tenant_sessions WHERE tenant_id = ?`).bind(tenantId).run();
  await env.DB.prepare(`DELETE FROM easyslip_configs WHERE tenant_id = ?`).bind(tenantId).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE tenant_id = ?`).bind(tenantId).run();
  await env.SESSION_KV.delete(`tenant:${tenantId}:session`);
}
