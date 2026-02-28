// Bank Accounts Refresh Service
// ดึงรายชื่อบัญชีธนาคารสำหรับทุก tenant ที่มี active session

interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
}

export class BankRefreshService {
  /**
   * ดึงบัญชีธนาคารสำหรับ tenant ที่มี active session
   */
  static async refreshAllTenantBankAccounts(env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // ดึง TTL จาก system_settings
    const ttlSetting = await env.DB.prepare(
      `SELECT value FROM system_settings WHERE key = 'bank_account_cache_ttl'`
    ).first();
    const cacheTtl = ttlSetting ? parseInt(ttlSetting.value as string) : 3600;

    // ดึงรายการ tenant ที่มี active session
    const tenants = await env.DB.prepare(
      `SELECT DISTINCT t.id, t.admin_api_url, s.session_token
       FROM tenants t
       INNER JOIN admin_sessions s ON s.tenant_id = t.id
       WHERE s.expires_at > ? AND t.status = 'active'`
    )
      .bind(now)
      .all();

    if (!tenants.results || tenants.results.length === 0) {
      console.log('[BankRefresh] No active tenants with sessions found');
      return;
    }

    console.log(`[BankRefresh] Starting refresh for ${tenants.results.length} tenant(s)`);

    // ดึงบัญชีธนาคารสำหรับแต่ละ tenant
    const promises = tenants.results.map(async (tenant: any) => {
      try {
        const tenantId = tenant.id as string;
        const adminApiUrl = tenant.admin_api_url as string;
        const sessionToken = tenant.session_token as string;

        // เช็คว่า cache ยังไม่หมดอายุหรือไม่ (ป้องกัน over-fetching)
        const bankKey = `tenant:${tenantId}:banks`;
        const existingCache = await env.BANK_KV.get(bankKey);
        
        if (existingCache) {
          const cacheData = JSON.parse(existingCache);
          const timeSinceUpdate = now - (cacheData.updated_at || 0);
          
          // ถ้ายัง refresh ไปไม่ถึง 80% ของ TTL ให้ข้ามไป
          if (timeSinceUpdate < cacheTtl * 0.8) {
            console.log(`[BankRefresh] Skipping ${tenantId} - cache still fresh`);
            return;
          }
        }

        console.log(`[BankRefresh] Fetching accounts for tenant: ${tenantId}`);

        // ดึงรายชื่อบัญชีธนาคาร
        const accountsResponse = await fetch(`${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Accept': 'application/json',
          },
        });

        if (!accountsResponse.ok) {
          console.error(`[BankRefresh] Failed to fetch accounts for ${tenantId}: ${accountsResponse.statusText}`);
          
          // ถ้า 401 Unauthorized ให้ลบ session ออก
          if (accountsResponse.status === 401) {
            await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?')
              .bind(tenantId)
              .run();
            await env.BANK_KV.delete(bankKey);
            console.log(`[BankRefresh] Removed expired session for ${tenantId}`);
          }
          return;
        }

        const accountsData = await accountsResponse.json() as any;
        const accounts = accountsData.list || [];

        // บันทึกบัญชีธนาคารลง KV Storage
        // ไม่ใช้ expirationTtl เพื่อให้ข้อมูลอยู่ตลอดจนกว่าจะ refresh ใหม่
        // ป้องกันการขาดช่วงถ้า scheduled job ล่าช้า
        await env.BANK_KV.put(
          bankKey,
          JSON.stringify({
            accounts: accounts,
            total: accountsData.total || accounts.length,
            updated_at: now,
            ttl_seconds: cacheTtl,
          })
        );

        console.log(`[BankRefresh] ✅ Updated ${accounts.length} accounts for ${tenantId}`);
      } catch (error: any) {
        console.error(`[BankRefresh] Error refreshing tenant ${tenant.id}:`, error.message);
      }
    });

    await Promise.allSettled(promises);
    console.log('[BankRefresh] Refresh completed');
  }
}
