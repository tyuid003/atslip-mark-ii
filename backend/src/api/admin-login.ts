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

      // Login ไปที่ admin backend
      // Admin API ต้องการ captcha_id และ captcha_code
      const loginResponse = await fetch(`${adminApiUrl}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
          captcha_id: body.captcha_key,  // captcha_key คือ id ที่ได้จาก /api/captcha
          captcha_code: body.captcha_code,
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json() as any;
        throw new Error(errorData.error || errorData.message || 'Login failed');
      }

      const loginData = await loginResponse.json() as any;

      // ดึง session token
      const sessionToken = loginData.token || loginData.access_token || loginData.session_token;

      if (!sessionToken) {
        throw new Error('No session token received');
      }

      // บันทึก session token ใน admin_sessions table
      const now = Math.floor(Date.now() / 1000);
      const sessionId = crypto.randomUUID();
      const expiresAt = now + (24 * 60 * 60); // expires in 24 hours

      // ลบ session เก่าก่อน
      await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?')
        .bind(tenantId)
        .run();

      // สร้าง session ใหม่
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

      // ดึงรายชื่อบัญชีธนาคาร
      const accountsResponse = await fetch(`${adminApiUrl}/api/bank-accounts`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Accept': 'application/json',
        },
      });

      let accountCount = 0;

      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json() as any;
        const accounts = accountsData.data || accountsData.accounts || [];
        accountCount = accounts.length;

        // บันทึกบัญชีธนาคารลง KV Storage
        if (accounts.length > 0) {
          const bankKey = `tenant:${tenantId}:banks`;
          await env.BANK_KV.put(
            bankKey,
            JSON.stringify({
              accounts: accounts,
              updated_at: now,
            })
          );
        }
      }

      return jsonResponse({
        success: true,
        data: {
          tenant_id: tenantId,
          connected: true,
          account_count: accountCount,
        },
        message: 'Login successful',
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },
};
