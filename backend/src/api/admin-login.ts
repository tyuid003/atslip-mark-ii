// API: Admin Login with Captcha
// GET /api/tenants/:id/captcha
// POST /api/tenants/:id/login

import { jsonResponse, errorResponse, getAdminAuthHeaders } from '../utils/helpers';
import { generateTOTP, extractSecretFromOtpauth } from '../utils/totp';

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
        totp_code?: string;
      };

      // ดึงข้อมูล tenant รวม api_version + totp
      const tenant = await env.DB.prepare(
        `SELECT id, admin_api_url, admin_username, admin_password, api_version,
                COALESCE(totp_enabled, 0) as totp_enabled, totp_secret
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

        // ── Google Authenticator (TOTP) — v1 เท่านั้น ──
        // token จาก /api/login (เมื่อเปิด TOTP) = preAuthToken (stage totp_pending) ยังใช้เรียก API ไม่ได้
        if (Number(tenant.totp_enabled) === 1) {
          const preAuthToken = sessionToken;
          const adminId = loginData.id ?? loginData.adminId ?? loginData?.data?.id ?? null;
          const totpRes = await resolveTotpToken(
            env, tenantId, adminApiUrl, adminId, preAuthToken,
            tenant.totp_secret || null, body.totp_code
          );
          if (!totpRes.ok) {
            return jsonResponse({ success: false, need_totp: true, data: totpRes.needData, message: totpRes.message }, 200);
          }
          sessionToken = totpRes.token;
        }
      }

      return await finalizeSession(env, tenantId, adminApiUrl, apiVersion, sessionToken);
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },

  /**
   * POST /api/tenants/:id/totp-verify
   * ยืนยันรหัส Google Authenticator แบบกรอกเอง (fallback เมื่อ auto ไม่สำเร็จ)
   * body: { admin_id, pre_auth_token, totp_code }
   */
  async handleTotpVerify(env: Env, request: Request, tenantId: string): Promise<Response> {
    try {
      const body = await request.json() as { admin_id?: any; pre_auth_token?: string; totp_code?: string };
      if (!body.admin_id || !body.pre_auth_token || !body.totp_code) {
        return errorResponse('Missing admin_id, pre_auth_token or totp_code', 400);
      }

      const tenant = await env.DB.prepare(
        `SELECT id, admin_api_url, COALESCE(api_version, 'v1') as api_version FROM tenants WHERE id = ?`
      ).bind(tenantId).first() as any;
      if (!tenant) return errorResponse('Tenant not found', 404);

      const adminApiUrl = tenant.admin_api_url as string;
      const verifyResp = await fetch(`${adminApiUrl}/api/admins/totp-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ adminId: body.admin_id, totp: String(body.totp_code).trim(), preAuthToken: body.pre_auth_token }),
      });
      const verifyData = await verifyResp.json().catch(() => ({})) as any;
      if (!verifyResp.ok || verifyData?.totpVerify !== true || !verifyData?.token) {
        return errorResponse(verifyData?.message || 'รหัส Google Authenticator ไม่ถูกต้อง', 401);
      }

      return await finalizeSession(env, tenantId, adminApiUrl, String(tenant.api_version || 'v1'), verifyData.token);
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

// ============================================================
// TOTP helpers (Google Authenticator — v1)
// ============================================================

type TotpResult =
  | { ok: true; token: string }
  | { ok: false; needData: any; message: string };

/**
 * เช็ค/ตั้งค่า TOTP + สร้างรหัสอัตโนมัติ (หรือใช้รหัสที่ผู้ใช้กรอก) แล้วยืนยันเพื่อรับ token จริง
 * - ครั้งแรก: /api/admins/totp-secret คืน secret → เก็บไว้ + gen code auto
 * - ครั้งถัดไป: ใช้ secret ที่เก็บไว้ gen code auto
 * - ถ้าไม่มี secret และไม่มี manualCode → ส่ง need_totp ให้ frontend กรอกเอง
 */
async function resolveTotpToken(
  env: Env,
  tenantId: string,
  adminApiUrl: string,
  adminId: any,
  preAuthToken: string,
  storedSecret: string | null,
  manualCode?: string
): Promise<TotpResult> {
  if (!adminId) {
    return { ok: false, needData: { admin_id: null, pre_auth_token: preAuthToken }, message: 'ไม่พบ admin id จากการล็อกอิน (TOTP)' };
  }

  let qrCode: string | null = null;
  let secret: string | null = storedSecret || null;

  // 1) เช็ค/ตั้งค่า TOTP (public — ไม่ต้องแนบ token)
  try {
    const secretResp = await fetch(`${adminApiUrl}/api/admins/totp-secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ adminId }),
    });
    const secretData = await secretResp.json().catch(() => ({})) as any;
    if (secretData?.secret) {
      secret = secretData.secret;
      qrCode = secretData.qrCode || null;
      await env.DB.prepare('UPDATE tenants SET totp_secret = ? WHERE id = ?').bind(secret, tenantId).run();
    } else if (secretData?.qrCode) {
      qrCode = secretData.qrCode;
      const fromUri = extractSecretFromOtpauth(secretData.qrCode);
      if (fromUri && !secret) {
        secret = fromUri;
        await env.DB.prepare('UPDATE tenants SET totp_secret = ? WHERE id = ?').bind(secret, tenantId).run();
      }
    }
  } catch (_) { /* ใช้ storedSecret / manual แทน */ }

  // 2) หา code: จากผู้ใช้ก่อน (ถ้ามี) → ไม่งั้น gen auto จาก secret
  let code: string | null = null;
  if (manualCode && String(manualCode).trim()) {
    code = String(manualCode).trim();
  } else if (secret) {
    try { code = await generateTOTP(secret); } catch { code = null; }
  }

  if (!code) {
    return {
      ok: false,
      needData: { admin_id: adminId, pre_auth_token: preAuthToken, qr_code: qrCode, first_time: !!qrCode },
      message: 'ต้องยืนยันรหัส Google Authenticator',
    };
  }

  // 3) ยืนยัน (auto: เผื่อ clock skew ลอง step -1/+1)
  const doVerify = async (c: string) => {
    const r = await fetch(`${adminApiUrl}/api/admins/totp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ adminId, totp: c, preAuthToken }),
    });
    const d = await r.json().catch(() => ({})) as any;
    return { ok: r.ok && d?.totpVerify === true && !!d?.token, token: d?.token as string, msg: d?.message as string };
  };

  let v = await doVerify(code);
  if (!v.ok && !manualCode && secret) {
    for (const off of [-1, 1]) {
      try {
        const c2 = await generateTOTP(secret, { offsetSteps: off });
        v = await doVerify(c2);
        if (v.ok) break;
      } catch { /* ignore */ }
    }
  }

  if (v.ok) return { ok: true, token: v.token };

  // auto ล้มเหลว → ให้กรอกเอง
  return {
    ok: false,
    needData: { admin_id: adminId, pre_auth_token: preAuthToken, qr_code: qrCode, first_time: !!qrCode },
    message: manualCode ? (v.msg || 'รหัส Google Authenticator ไม่ถูกต้อง') : 'ยืนยัน TOTP อัตโนมัติไม่สำเร็จ กรุณากรอกรหัสจากแอป',
  };
}

/**
 * บันทึก session token + โหลดบัญชีธนาคารเข้า KV + คืน response สำเร็จ
 * (ใช้ร่วมกันระหว่างเส้น login ปกติ และเส้น totp-verify แบบกรอกเอง)
 */
async function finalizeSession(
  env: Env,
  tenantId: string,
  adminApiUrl: string,
  apiVersion: string,
  sessionToken: string
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const expiresAt = now + (24 * 60 * 60);

  await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?').bind(tenantId).run();
  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, tenant_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, tenantId, sessionToken, expiresAt, now).run();
  await env.DB.prepare('UPDATE tenants SET updated_at = ? WHERE id = ?').bind(now, tenantId).run();

  const cacheTtl = 1800;
  const accountsUrl = apiVersion === 'v2'
    ? `${adminApiUrl}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
    : `${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`;

  const accountsResponse = await fetch(accountsUrl, {
    method: 'GET',
    headers: getAdminAuthHeaders(sessionToken, apiVersion),
  });

  let accountCount = 0;
  let bankErrorMsg: string | null = null;
  const bankKey = `tenant:${tenantId}:banks`;

  if (accountsResponse.ok) {
    const accountsData = await accountsResponse.json() as any;
    const accounts = apiVersion === 'v2'
      ? (accountsData?.data?.list || accountsData?.data?.items || [])
      : (accountsData?.list || []);
    accountCount = accounts.length;
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
      connected: true,
      account_count: accountCount,
      bank_error: bankErrorMsg,
    },
    message: bankErrorMsg ? `Login successful. ${bankErrorMsg}` : 'Login successful and bank accounts loaded',
  });
}
