// API: Admin Login with Captcha
// GET /api/tenants/:id/captcha
// POST /api/tenants/:id/login

import { jsonResponse, errorResponse, getAdminAuthHeaders } from '../utils/helpers';

interface Env {
  DB: D1Database;
  BANK_KV: KVNamespace;
}

export const AdminLoginAPI = {
  /**
   * GET /api/tenants/:id/captcha
   * ดึง captcha จาก Admin Backend API
   */
  async handleGetCaptcha(env: Env, tenantId: string): Promise<Response> {
    try {
      // ดึงข้อมูล tenant
      const tenant = await env.DB.prepare(
        'SELECT id, admin_api_url FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const adminApiUrl = tenant.admin_api_url as string;

      // เรียก API ของ admin backend เพื่อดึง captcha
      const captchaResponse = await fetch(`${adminApiUrl}/api/captcha`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!captchaResponse.ok) {
        throw new Error(`Failed to fetch captcha: ${captchaResponse.statusText}`);
      }

      const captchaData = await captchaResponse.json() as any;

      // Admin API ส่ง response เป็น {id: "...", base64: "data:image/png;base64,..."}
      return jsonResponse({
        success: true,
        data: {
          captcha_key: captchaData.id,
          captcha_image: captchaData.base64,
        },
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },

  /**
  /**
   * POST /api/tenants/:id/login
   * Login ไปที่ Admin Backend — รองรับ v1 (captcha) และ v2 (ไม่ต้องมี captcha)
   */
  async handleLogin(env: Env, request: Request, tenantId: string): Promise<Response> {
    try {
      const body = await request.json() as {
        captcha_key?: string;
        captcha_code?: string;
      };

      // ดึงข้อมูล tenant รวม api_version
      const tenant = await env.DB.prepare(
        `SELECT id, admin_api_url, admin_username, admin_password, api_version
         FROM tenants WHERE id = ?`
      ).bind(tenantId).first() as any;

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const adminApiUrl = tenant.admin_api_url as string;
      const username = tenant.admin_username as string;
      const password = tenant.admin_password as string;
      const apiVersion = String(tenant.api_version || 'v1');

      let sessionToken: string;

      if (apiVersion === 'v2') {
        // v2: ไม่ต้องการ captcha
        const loginResponse = await fetch(`${adminApiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!loginResponse.ok) {
          const errData = await loginResponse.json() as any;
          throw new Error(errData?.message || 'Login failed (v2)');
        }

        const loginData = await loginResponse.json() as any;
        // v2 token อยู่ที่ data.token
        sessionToken = loginData?.data?.token || loginData?.token || '';
        if (!sessionToken) throw new Error('No token in v2 login response');

      } else {
        // v1: ต้องการ captcha
        if (!body.captcha_key || !body.captcha_code) {
          return errorResponse('Missing captcha_key or captcha_code', 400);
        }

        const userAgent = request.headers.get('User-Agent') || 'Mozilla/5.0';
        const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';

        const loginResponse = await fetch(`${adminApiUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            username, password,
            captchaId: body.captcha_key,
            captchaValue: body.captcha_code,
            agent: userAgent,
            ipAddress,
          }),
        });

        if (!loginResponse.ok) {
          const errorData = await loginResponse.json() as any;
          throw new Error(errorData.error || errorData.message || 'Login failed');
        }

        const loginData = await loginResponse.json() as any;
        sessionToken = loginData.token || '';
        if (!sessionToken) throw new Error('No session token received');
      }

      // บันทึก session token
      const now = Math.floor(Date.now() / 1000);
      const sessionId = crypto.randomUUID();
      const expiresAt = now + (24 * 60 * 60); // 24h

      await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?').bind(tenantId).run();
      await env.DB.prepare(
        `INSERT INTO admin_sessions (id, tenant_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, tenantId, sessionToken, expiresAt, now).run();

      await env.DB.prepare('UPDATE tenants SET updated_at = ? WHERE id = ?').bind(now, tenantId).run();

      // Hard-coded TTL (30 นาที = 1800 วินาที)
      const cacheTtl = 1800;

      // ดึงรายชื่อบัญชีธนาคาร (v1 หรือ v2)
      const accountsUrl = apiVersion === 'v2'
        ? `${adminApiUrl}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
        : `${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`;

      const accountsResponse = await fetch(accountsUrl, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, apiVersion),
      });

      let accountCount = 0;
      let connected = true; // session สำเร็จแล้ว ถือว่า connected
      let bankErrorMsg: string | null = null;

      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json() as any;
        // v1: accountsData.list | v2: accountsData.data.list
        const accounts = apiVersion === 'v2'
          ? (accountsData?.data?.list || accountsData?.data?.items || [])
          : (accountsData?.list || []);
        accountCount = accounts.length;

        const bankKey = `tenant:${tenantId}:banks`;
        await env.BANK_KV.put(
          bankKey,
          JSON.stringify({
            accounts,
            total: accountsData?.data?.total || accountsData?.total || accounts.length,
            updated_at: now,
            api_version: apiVersion,
          }),
          { expirationTtl: cacheTtl }
        );
      } else {
        bankErrorMsg = `Bank accounts fetch failed: ${accountsResponse.status} ${accountsResponse.statusText}`;
        // session ยังใช้ได้ — ใส่ placeholder ใน KV เพื่อ mark as connected
        const bankKey = `tenant:${tenantId}:banks`;
        await env.BANK_KV.put(
          bankKey,
          JSON.stringify({
            accounts: [{ id: '__placeholder__', bank: 'unknown', accountNumber: '0000000000', accountName: 'Connected (accounts pending)' }],
            total: 0,
            updated_at: now,
            api_version: apiVersion,
          }),
          { expirationTtl: cacheTtl }
        );
      }

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          connected: connected,
          account_count: accountCount,
          bank_error: bankErrorMsg,
        },
        message: bankErrorMsg ? `Login successful. ${bankErrorMsg}` : 'Login successful and bank accounts loaded',
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },

  /**
   * POST /api/tenants/:id/refresh-accounts
   * รีเฟรชรายชื่อบัญชีธนาคารทันที
   */
  async handleRefreshAccounts(env: Env, tenantId: string): Promise<Response> {
    try {
      const tenant = await env.DB.prepare(
        `SELECT t.id, t.admin_api_url, t.api_version, s.session_token
         FROM tenants t
         LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
         WHERE t.id = ?
         LIMIT 1`
      ).bind(Math.floor(Date.now() / 1000), tenantId).first() as any;

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const sessionToken = tenant.session_token as string | null;
      if (!sessionToken) {
        return errorResponse('No active session. Please login first.', 401);
      }

      const adminApiUrl = tenant.admin_api_url as string;
      const apiVersion = String(tenant.api_version || 'v1');
      const cacheTtl = 1800;

      const refreshUrl = apiVersion === 'v2'
        ? `${adminApiUrl}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
        : `${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`;

      const accountsResponse = await fetch(refreshUrl, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, apiVersion),
      });

      if (!accountsResponse.ok) {
        await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?')
          .bind(tenantId)
          .run();

        // ลบบัญชีเก่าออกจาก KV
        const bankKey = `tenant:${tenantId}:banks`;
        await env.BANK_KV.delete(bankKey);

        return errorResponse('Failed to refresh bank accounts. Session expired.', 401);
      }

      const accountsData = await accountsResponse.json() as any;
      const accounts = apiVersion === 'v2'
        ? (accountsData?.data?.list || [])
        : (accountsData?.list || []);
      const now = Math.floor(Date.now() / 1000);

      const bankKey = `tenant:${tenantId}:banks`;
      await env.BANK_KV.put(
        bankKey,
        JSON.stringify({
          accounts,
          total: accountsData?.data?.total || accountsData?.total || accounts.length,
          updated_at: now,
          api_version: apiVersion,
        }),
        { expirationTtl: cacheTtl }
      );

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          account_count: accounts.length,
          updated_at: now,
        },
        message: 'Bank accounts refreshed successfully',
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },
};
