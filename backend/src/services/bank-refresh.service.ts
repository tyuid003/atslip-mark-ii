// Bank Accounts Refresh Service
// ดึงรายชื่อบัญชีธนาคารสำหรับทุก tenant — รองรับ v1 และ v2
// v2: auto re-login เมื่อ session หมด, proactive session renewal ก่อนหมดอายุ

import { CreditService } from './credit.service';
import { getAdminAuthHeaders } from '../utils/helpers';

interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
}

export class BankRefreshService {
  // Threshold: re-login เมื่อ session จะหมดใน 2 ชั่วโมง
  private static readonly SESSION_RENEW_BEFORE_SECONDS = 2 * 60 * 60;

  /**
   * ดึงบัญชีธนาคาร + จัดการ session สำหรับทุก active tenant
   * รัน: ทุก 1 นาที (cron)
   */
  static async refreshAllTenantBankAccounts(env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const cacheTtl = 1800; // 30 นาที

    // ดึง tenant ทั้งหมด (active) + session ปัจจุบัน (ถ้ามี)
    // รวม v2 ที่ยังไม่มี session ด้วย (จะ auto re-login)
    const tenants = await env.DB.prepare(
      `SELECT t.id, t.admin_api_url, t.api_version, t.admin_username, t.admin_password,
              s.session_token, s.expires_at as session_expires_at
       FROM tenants t
       LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at = (
         SELECT MAX(expires_at) FROM admin_sessions WHERE tenant_id = t.id
       )
       WHERE t.status = 'active'`
    ).all();

    if (!tenants.results || tenants.results.length === 0) {
      console.log('[BankRefresh] No active tenants found');
      return;
    }

    console.log(`[BankRefresh] Processing ${tenants.results.length} tenant(s)`);

    const promises = tenants.results.map(async (row: any) => {
      const tenantId = row.id as string;
      const adminApiUrl = row.admin_api_url as string;
      const apiVersion = String(row.api_version || 'v1');
      const bankKey = `tenant:${tenantId}:banks`;

      let sessionToken = row.session_token as string | null;
      const sessionExpiresAt = Number(row.session_expires_at || 0);
      const sessionExpired = !sessionToken || sessionExpiresAt <= now;
      const sessionExpiringSoon = !sessionExpired && (sessionExpiresAt - now) < this.SESSION_RENEW_BEFORE_SECONDS;

      // ──────────────────────────────────────────────
      // SESSION MANAGEMENT
      // ──────────────────────────────────────────────

      if (apiVersion === 'v2') {
        // v2: auto re-login เมื่อหมดหรือจะหมดเร็วๆ นี้
        if (sessionExpired || sessionExpiringSoon) {
          const reason = sessionExpired ? 'expired' : `expiring in ${Math.round((sessionExpiresAt - now) / 60)}min`;
          console.log(`[BankRefresh] 🔑 v2 session ${reason} for ${tenantId} — auto re-login...`);
          const newToken = await CreditService.autoRelogin(env as any, {
            id: tenantId,
            admin_api_url: adminApiUrl,
            api_version: apiVersion,
            admin_username: row.admin_username as string,
            admin_password: row.admin_password as string,
          }, console.log);

          if (newToken) {
            sessionToken = newToken;
            console.log(`[BankRefresh] ✅ v2 auto re-login success for ${tenantId}`);
          } else {
            console.error(`[BankRefresh] ❌ v2 auto re-login failed for ${tenantId} — skipping`);
            return;
          }
        }
      } else {
        // v1: ถ้าไม่มี session ให้ข้ามไป
        if (sessionExpired) {
          console.log(`[BankRefresh] ⏭️ v1 tenant ${tenantId} has no active session — skipping`);
          return;
        }
      }

      if (!sessionToken) return;

      // ──────────────────────────────────────────────
      // CHECK CACHE FRESHNESS
      // ──────────────────────────────────────────────
      const existingCache = await env.BANK_KV.get(bankKey);
      if (existingCache) {
        const cacheData = JSON.parse(existingCache);
        const timeSinceUpdate = now - (cacheData.updated_at || 0);
        if (timeSinceUpdate < cacheTtl * 0.8) {
          console.log(`[BankRefresh] ⏭️ Skipping ${tenantId} — cache still fresh (${Math.round(timeSinceUpdate / 60)}min old)`);
          return;
        }
      }

      // ──────────────────────────────────────────────
      // FETCH BANK ACCOUNTS
      // ──────────────────────────────────────────────
      try {
        console.log(`[BankRefresh] 🏦 Fetching accounts for ${tenantId} (${apiVersion})`);

        const accountsUrl = apiVersion === 'v2'
          ? `${adminApiUrl}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
          : `${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`;

        const accountsResponse = await fetch(accountsUrl, {
          method: 'GET',
          headers: getAdminAuthHeaders(sessionToken, apiVersion),
        });

        if (!accountsResponse.ok) {
          console.error(`[BankRefresh] ❌ Fetch failed for ${tenantId}: ${accountsResponse.status}`);

          if (accountsResponse.status === 401) {
            if (apiVersion === 'v2') {
              // v2: retry with re-login
              console.log(`[BankRefresh] 🔄 v2 401 — retrying with re-login for ${tenantId}`);
              const retryToken = await CreditService.autoRelogin(env as any, {
                id: tenantId,
                admin_api_url: adminApiUrl,
                api_version: apiVersion,
                admin_username: row.admin_username as string,
                admin_password: row.admin_password as string,
              }, console.log);

              if (!retryToken) {
                console.error(`[BankRefresh] ❌ Re-login failed — giving up for ${tenantId}`);
                return;
              }

              // Retry fetch with new token
              const retryResponse = await fetch(accountsUrl, {
                method: 'GET',
                headers: getAdminAuthHeaders(retryToken, apiVersion),
              });
              if (!retryResponse.ok) {
                console.error(`[BankRefresh] ❌ Retry fetch also failed for ${tenantId}: ${retryResponse.status}`);
                return;
              }
              // Use retry response
              const retryData = await retryResponse.json() as any;
              const retryAccounts = apiVersion === 'v2'
                ? (retryData?.data?.list || [])
                : (retryData?.list || []);
              await env.BANK_KV.put(bankKey, JSON.stringify({ accounts: retryAccounts, total: retryAccounts.length, updated_at: now, api_version: apiVersion }));
              console.log(`[BankRefresh] ✅ Retry OK — ${retryAccounts.length} accounts for ${tenantId}`);
              return;
            } else {
              // v1: delete session on 401
              await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?').bind(tenantId).run();
              await env.BANK_KV.delete(bankKey);
              console.log(`[BankRefresh] 🗑️ v1 session removed for ${tenantId} (401)`);
            }
          }
          return;
        }

        const accountsData = await accountsResponse.json() as any;
        // v1: accountsData.list | v2: accountsData.data.list
        const accounts = apiVersion === 'v2'
          ? (accountsData?.data?.list || [])
          : (accountsData?.list || []);

        await env.BANK_KV.put(bankKey, JSON.stringify({
          accounts,
          total: accountsData?.data?.total || accountsData?.total || accounts.length,
          updated_at: now,
          ttl_seconds: cacheTtl,
          api_version: apiVersion,
        }));

        console.log(`[BankRefresh] ✅ Updated ${accounts.length} accounts for ${tenantId}`);
      } catch (error: any) {
        console.error(`[BankRefresh] Error for tenant ${tenantId}:`, error.message);
      }
    });

    await Promise.allSettled(promises);
    console.log('[BankRefresh] Refresh cycle completed');
  }
}
