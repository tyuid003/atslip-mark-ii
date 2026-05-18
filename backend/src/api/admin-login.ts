// API: Admin Login with Captcha
// GET /api/tenants/:id/captcha
// POST /api/tenants/:id/login

import { jsonResponse, errorResponse } from '../utils/helpers';

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
   * POST /api/tenants/:id/login
   * Login ไปที่ Admin Backend พร้อม captcha และบันทึก session
   */
  async handleLogin(env: Env, request: Request, tenantId: string): Promise<Response> {
    try {
      const body = await request.json() as {
        captcha_key: string;
        captcha_code: string;
      };

      if (!body.captcha_key || !body.captcha_code) {
        return errorResponse('Missing captcha_key or captcha_code', 400);
      }

      // ดึงข้อมูล tenant
      const tenant = await env.DB.prepare(
        `SELECT id, admin_api_url, admin_username, admin_password 
         FROM tenants WHERE id = ?`
      )
        .bind(tenantId)
        .first();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const adminApiUrl = tenant.admin_api_url as string;
      const username = tenant.admin_username as string;
      const password = tenant.admin_password as string;

      // ดึง User-Agent และ IP Address จาก request
      const userAgent = request.headers.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';

      // Login ไปที่ admin backend
      // Admin API ต้องการ: username, password, captchaId, captchaValue, agent, ipAddress (camelCase)
      const loginResponse = await fetch(`${adminApiUrl}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
          captchaId: body.captcha_key,  // captcha_key คือ id ที่ได้จาก /api/captcha
          captchaValue: body.captcha_code,  // captcha_code คือค่าที่ผู้ใช้กรอก
          agent: userAgent,
          ipAddress: ipAddress,
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json() as any;
        throw new Error(errorData.error || errorData.message || 'Login failed');
      }

      const loginData = await loginResponse.json() as any;

      // ดึง token และ refreshToken
      const sessionToken = loginData.token;
      const refreshToken = loginData.refreshToken;

      if (!sessionToken) {
        throw new Error('No session token received');
      }

      // บันทึก session token ใน admin_sessions table (D1 เท่านั้น)
      const now = Math.floor(Date.now() / 1000);
      const sessionId = crypto.randomUUID();
      const expiresAt = now + (24 * 60 * 60); // expires in 24 hours

      // ลบ session เก่าก่อน
      await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?')
        .bind(tenantId)
        .run();

      // สร้าง session ใหม่ พร้อม refreshToken
      await env.DB.prepare(
        `INSERT INTO admin_sessions 
         (id, tenant_id, session_token, expires_at, created_at) 
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(sessionId, tenantId, sessionToken, expiresAt, now)
        .run();

      // อัพเดท updated_at
      await env.DB.prepare('UPDATE tenants SET updated_at = ? WHERE id = ?')
        .bind(now, tenantId)
        .run();

      // Hard-coded TTL (30 นาที = 1800 วินาที)
      const cacheTtl = 1800;

      // ดึงรายชื่อบัญชีธนาคาร
      const accountsResponse = await fetch(`${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Accept': 'application/json',
        },
      });

      let accountCount = 0;
      let connected = false;

      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json() as any;
        const accounts = accountsData.list || []; // Admin API ใช้ 'list' แทน 'data'
        accountCount = accounts.length;
        connected = true;

        // บันทึกบัญชีธนาคารลง KV Storage พร้อม TTL
        const bankKey = `tenant:${tenantId}:banks`;
        await env.BANK_KV.put(
          bankKey,
          JSON.stringify({
            accounts: accounts,
            total: accountsData.total || accounts.length,
            updated_at: now,
          }),
          {
            expirationTtl: cacheTtl, // ใช้ TTL จาก settings
          }
        );
      }

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          connected: connected,
          account_count: accountCount,
        },
        message: connected ? 'Login successful and bank accounts loaded' : 'Login successful but failed to load bank accounts',
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
      // ดึงข้อมูล tenant และ session
      const tenant = await env.DB.prepare(
        `SELECT t.id, t.admin_api_url, s.session_token
         FROM tenants t
         LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
         WHERE t.id = ?
         LIMIT 1`
      )
        .bind(Math.floor(Date.now() / 1000), tenantId)
        .first();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const sessionToken = tenant.session_token as string | null;
      if (!sessionToken) {
        return errorResponse('No active session. Please login first.', 401);
      }

      const adminApiUrl = tenant.admin_api_url as string;

      // Hard-coded TTL (30 นาที = 1800 วินาที)
      const cacheTtl = 1800;

      // ดึงรายชื่อบัญชีธนาคาร
      const accountsResponse = await fetch(`${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Accept': 'application/json',
        },
      });

      if (!accountsResponse.ok) {
        // ถ้าดึงไม่สำเร็จ ลบ session ออก (token หมดอายุหรือไม่ valid)
        await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?')
          .bind(tenantId)
          .run();

        // ลบบัญชีเก่าออกจาก KV
        const bankKey = `tenant:${tenantId}:banks`;
        await env.BANK_KV.delete(bankKey);

        return errorResponse('Failed to refresh bank accounts. Session expired.', 401);
      }

      const accountsData = await accountsResponse.json() as any;
      const accounts = accountsData.list || [];
      const now = Math.floor(Date.now() / 1000);

      // บันทึกบัญชีธนาคารลง KV Storage พร้อม TTL
      const bankKey = `tenant:${tenantId}:banks`;
      await env.BANK_KV.put(
        bankKey,
        JSON.stringify({
          accounts: accounts,
          total: accountsData.total || accounts.length,
          updated_at: now,
        }),
        {
          expirationTtl: cacheTtl,
        }
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
