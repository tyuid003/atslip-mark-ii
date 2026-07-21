// Credit Service
// ฟังก์ชันสำหรับเติมเครดิตให้ผู้ใช้

import type { Env } from '../types';
import { getAdminAuthHeaders } from '../utils/helpers';

interface SubmitCreditRequest {
  tenantId: string;
  slipData: {
    amount?: {
      amount?: number;
    };
    date?: string;
    transRef?: string;
    // ข้อมูลผู้ส่ง (ใช้สำหรับ v2 deposit payload)
    sender?: {
      bank?: { id?: string; name?: string; short?: string };
      account?: {
        name?: { th?: string; en?: string };
        bank?: { account?: string };
        proxy?: { account?: string };
      };
    };
  };
  user: {
    id?: string;
    memberCode?: string;
    fullname?: string;
    bankAccount?: string;
    bank_account?: string;
  };
  toAccountId: string | number;
}

interface SubmitCreditResponse {
  success: boolean;
  isDuplicate?: boolean;
  message?: string;
  data?: any;
  resolvedMemberCode?: string;
  resolvedUsername?: string;
}

export class CreditService {
  // ──────────────────────────────────────────────────────────────────────────
  // Bank short-name (from EasySlip) → v2 API bank code mapping
  // ──────────────────────────────────────────────────────────────────────────
  private static readonly BANK_SHORT_TO_V2_CODE: Record<string, string> = {
    'KBANK': 'kbank', 'KTB': 'ktb', 'SCB': 'scb', 'BBL': 'bbl',
    'BAY': 'bay', 'TTB': 'ttb', 'TMB': 'ttb', 'GSB': 'gsb', 'BAAC': 'baac',
    'GHB': 'ghb', 'KKP': 'kkp', 'TISCO': 'tisco', 'UOBT': 'uob', 'UOB': 'uob',
    'CIMBT': 'cimb', 'CIMB': 'cimb', 'LHFG': 'lh', 'LH': 'lh',
    'ISBT': 'ibank', 'TMN': 'tmn', 'TRUE': 'tmn',
    'ICBCT': 'icbc', 'TCD': 'tcd', 'SME': 'sme',
  };

  private static extractGeneratedMemberCode(raw: any): string | null {
    if (!raw) {
      return null;
    }

    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }

    const candidates = [
      raw.memberCode,
      raw.member_code,
      raw.username,
      raw.user,
      raw.data?.memberCode,
      raw.data?.member_code,
      raw.data?.username,
      raw.data?.user,
      raw.result,
      raw.value,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private static async searchUserByKeyword(
    adminApiUrl: string,
    sessionToken: string,
    keyword: string,
    logger?: (...args: any[]) => void
  ): Promise<any | null> {
    const log = logger || console.log;
    const categories = ['member', 'non-member'];

    for (const category of categories) {
      const searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=50&search=${encodeURIComponent(keyword)}&userCategory=${category}`;
      try {
        const response = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          log(`[CreditService] ⚠️ User search failed (${category}):`, response.status);
          continue;
        }

        const body = await response.json() as any;
        const users = body.list || [];
        if (users.length === 0) {
          continue;
        }

        const exact = users.find((user: any) => {
          const memberCode = String(user.memberCode || '').trim();
          const username = String(user.username || '').trim();
          const userId = String(user.id || '').trim();
          const key = String(keyword || '').trim();
          return memberCode === key || username === key || userId === key;
        });

        return exact || users[0];
      } catch (error: any) {
        log(`[CreditService] ⚠️ User search exception (${category}):`, error.message || error);
      }
    }

    return null;
  }

  static async resolveMemberCodeForUser(
    adminApiUrl: string,
    sessionToken: string,
    user: SubmitCreditRequest['user'],
    logger?: (...args: any[]) => void
  ): Promise<{ success: boolean; memberCode?: string; user?: any; message?: string }> {
    const log = logger || console.log;
    const existingMemberCode = String(user.memberCode || '').trim();

    // Track the admin-system id we can use for gen-membercode
    let adminUserId = String(user.id || '').trim();
    let nonMemberUser: any = null;

    if (existingMemberCode) {
      const resolvedUser = await this.searchUserByKeyword(adminApiUrl, sessionToken, existingMemberCode, log);
      const realMemberCode = resolvedUser ? String(resolvedUser.memberCode || '').trim() : '';

      if (realMemberCode) {
        // existingMemberCode resolved to a proper member in the admin system
        log('[CreditService] ✅ Confirmed real memberCode:', realMemberCode);
        return {
          success: true,
          memberCode: realMemberCode,
          user: resolvedUser,
        };
      }

      // existingMemberCode was not a real memberCode (e.g. username of a non-member).
      // Capture the resolved admin id so we can gen-membercode for the right user.
      if (resolvedUser && resolvedUser.id) {
        adminUserId = String(resolvedUser.id).trim();
        nonMemberUser = resolvedUser;
        log('[CreditService] ⚠️ existingMemberCode is non-member; will gen-membercode using admin id:', adminUserId);
      } else {
        // No resolved user — fall back to using existingMemberCode itself as the id (last resort)
        if (!adminUserId) adminUserId = existingMemberCode;
        log('[CreditService] ⚠️ No admin user found by keyword; trying gen-membercode with id:', adminUserId);
      }
    }

    if (!adminUserId) {
      return {
        success: false,
        message: 'Missing memberCode and user.id for memberCode generation',
      };
    }

    const genMemberCodeUrl = `${adminApiUrl}/api/admin/gen-membercode/${encodeURIComponent(adminUserId)}`;
    log('[CreditService] 🧾 Generating memberCode via:', genMemberCodeUrl);

    let generatedMemberCode = '';
    try {
      const response = await fetch(genMemberCodeUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          message: `Generate memberCode failed: ${response.status} - ${text}`,
        };
      }

      const body = await response.json().catch(() => null);
      generatedMemberCode = this.extractGeneratedMemberCode(body) || '';
    } catch (error: any) {
      return {
        success: false,
        message: `Generate memberCode request failed: ${error.message || error}`,
      };
    }

    if (!generatedMemberCode) {
      return {
        success: false,
        message: 'Generate memberCode succeeded but no memberCode was returned',
      };
    }

    log('[CreditService] ✅ Generated memberCode:', generatedMemberCode);
    const resolvedUser = await this.searchUserByKeyword(adminApiUrl, sessionToken, generatedMemberCode, log);

    return {
      success: true,
      memberCode: generatedMemberCode,
      user: resolvedUser || nonMemberUser || user,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT — AUTO RE-LOGIN
  // ══════════════════════════════════════════════════════════════

  /**
   * Re-login ไปยัง admin backend และบันทึก session ใหม่ลง DB
   * v1: POST /api/login  →  response.token
   * v2: POST /api/auth/login  →  response.data.token
   */
  static async autoRelogin(
    env: Env,
    tenant: { id: string; admin_api_url: string; api_version?: string; admin_username: string; admin_password: string },
    log: (...args: any[]) => void
  ): Promise<string | null> {
    const apiVersion = String(tenant.api_version || 'v1');
    const loginUrl = apiVersion === 'v2'
      ? `${tenant.admin_api_url}/api/auth/login`
      : `${tenant.admin_api_url}/api/login`;

    log(`[CreditService] 🔑 Auto re-login (${apiVersion}):`, loginUrl);

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username: tenant.admin_username, password: tenant.admin_password }),
      });

      if (!response.ok) {
        log(`[CreditService] ❌ Auto re-login failed: ${response.status}`);
        return null;
      }

      const data = await response.json() as any;
      // v1: data.token  |  v2: data.data.token
      const token: string | null = data?.data?.token || data?.token || null;
      if (!token) {
        log('[CreditService] ❌ Auto re-login: no token in response');
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const sessionId = crypto.randomUUID();
      const expiresAt = now + 24 * 60 * 60; // 24h

      await env.DB.prepare('DELETE FROM admin_sessions WHERE tenant_id = ?').bind(tenant.id).run();
      await env.DB.prepare(
        `INSERT INTO admin_sessions (id, tenant_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, tenant.id, token, expiresAt, now).run();

      log('[CreditService] ✅ Auto re-login successful, session renewed 24h');
      return token;
    } catch (error: any) {
      log('[CreditService] ❌ Auto re-login exception:', error.message);
      return null;
    }
  }

  private static async ensureSession(
    env: Env,
    tenant: { id: string; admin_api_url: string; api_version?: string; admin_username: string; admin_password: string },
    log: (...args: any[]) => void
  ): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare(
      `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
    ).bind(tenant.id, now).first();

    if (session) return session.session_token as string;

    if (String(tenant.api_version || 'v1') !== 'v2') {
      log('[CreditService] ❌ No active session (v1 requires manual login)');
      return null;
    }

    log('[CreditService] ⚠️ No active session — auto re-login (v2)...');
    return this.autoRelogin(env, tenant, log);
  }

  // ══════════════════════════════════════════════════════════════
  // v2 HELPERS
  // ══════════════════════════════════════════════════════════════

  private static async searchUserV2(
    adminApiUrl: string,
    sessionToken: string,
    keyword: string,
    log: (...args: any[]) => void
  ): Promise<any | null> {
    const url = `${adminApiUrl}/api/proxy/v1/admin/members?page=1&limit=50&search=${encodeURIComponent(keyword)}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, 'v2'),
      });
      if (!response.ok) {
        log(`[CreditService][v2] ⚠️ Member search failed:`, response.status);
        return null;
      }
      const body = await response.json() as any;
      const users: any[] = body?.data?.list || [];
      if (users.length === 0) return null;
      const key = String(keyword).trim();
      const exact = users.find((u: any) =>
        String(u.memberCode || '').trim() === key ||
        String(u.username || '').trim() === key ||
        String(u.id || '') === key
      );
      return exact || users[0];
    } catch (error: any) {
      log('[CreditService][v2] ⚠️ Member search exception:', error.message);
      return null;
    }
  }

  private static async checkDuplicateV2(
    adminApiUrl: string,
    sessionToken: string,
    userId: number,
    amount: number,
    senderAccountLast6: string,
    slipDate: string,
    log: (...args: any[]) => void
  ): Promise<boolean> {
    try {
      const dateStr = new Date(slipDate).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const url = `${adminApiUrl}/api/proxy/v1/admin/transactions/completed?page=1&limit=100&userId=${userId}&dateFrom=${dateStr}&dateTo=${dateStr}`;
      log('[CreditService][v2] 🔍 Duplicate check:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, 'v2'),
      });
      if (!response.ok) {
        log('[CreditService][v2] ⚠️ Duplicate check failed:', response.status, '— skipping check');
        return false;
      }

      const body = await response.json() as any;
      const list: any[] = body?.data?.list || [];
      const slipTs = new Date(slipDate).getTime();
      const WINDOW_MS = 5 * 60 * 1000; // ±5 นาที

      for (const tx of list) {
        if (tx.transactionType !== 'deposit') continue;
        if (Number(tx.amount) !== Number(amount)) continue;

        // เช็คเลขบัญชีผู้ส่ง (6 หลักท้าย)
        if (senderAccountLast6) {
          const txAcc = String(tx.accountNumber || '').replace(/\D/g, '');
          const txLast6 = txAcc.length > 6 ? txAcc.slice(-6) : txAcc;
          if (txLast6 !== senderAccountLast6) continue;
        }

        // เช็คเวลา ±5 นาที
        const txTs = new Date(tx.createdAt).getTime();
        if (Math.abs(txTs - slipTs) <= WINDOW_MS) {
          log(`[CreditService][v2] ⚠️ DUPLICATE: tx#${tx.id}, amount=${tx.amount}, time=${tx.createdAt}`);
          return true;
        }
      }
      log('[CreditService][v2] ✅ No duplicate found');
      return false;
    } catch (error: any) {
      log('[CreditService][v2] ⚠️ Duplicate check exception:', error.message, '— skipping');
      return false;
    }
  }

  private static async submitCreditV2(
    tenant: { admin_api_url: string },
    sessionToken: string,
    request: SubmitCreditRequest,
    log: (...args: any[]) => void,
    creditAmount: number,
    transferDate: string
  ): Promise<SubmitCreditResponse> {
    // ค้นหา user ใน v2 system
    const keyword = String(request.user.memberCode || request.user.id || '').trim();
    if (!keyword) return { success: false, message: '[v2] No memberCode or userId to search' };

    log('[CreditService][v2] 🔍 Searching user:', keyword);
    const v2User = await this.searchUserV2(tenant.admin_api_url, sessionToken, keyword, log);
    if (!v2User) return { success: false, message: `[v2] User not found: ${keyword}` };

    const userId = Number(v2User.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return { success: false, message: `[v2] Invalid userId: ${v2User.id}` };
    }

    const memberCode = String(v2User.memberCode || '');
    const resolvedName = String(v2User.fullName || v2User.fullname || request.user.fullname || '');
    log('[CreditService][v2] ✅ User found:', { userId, memberCode, name: resolvedName });

    // Sender info จาก slip
    const slipRaw = request.slipData as any;
    const senderShort = String(slipRaw.sender?.bank?.short || '').toUpperCase();
    const fromBankCode = this.BANK_SHORT_TO_V2_CODE[senderShort] || senderShort.toLowerCase() || '';
    const fromAccountNumberFull = String(
      slipRaw.sender?.account?.bank?.account ||
      slipRaw.sender?.account?.proxy?.account ||
      request.user.bankAccount ||
      request.user.bank_account || ''
    ).replace(/[^0-9]/g, '');
    const fromAccountName = String(
      slipRaw.sender?.account?.name?.th ||
      slipRaw.sender?.account?.name?.en ||
      request.user.fullname || ''
    );

    const bankAccountId = Number(request.toAccountId);
    if (!Number.isFinite(bankAccountId)) {
      return { success: false, message: `[v2] Invalid bankAccountId: ${request.toAccountId}` };
    }

    // ตรวจสอบซ้ำก่อน submit
    log('[CreditService][v2] 🔍 Pre-submit duplicate check...');
    const senderLast6 = fromAccountNumberFull.length > 6 ? fromAccountNumberFull.slice(-6) : fromAccountNumberFull;
    const isDup = await this.checkDuplicateV2(tenant.admin_api_url, sessionToken, userId, creditAmount, senderLast6, transferDate, log);
    if (isDup) {
      log('[CreditService][v2] ⚠️ DUPLICATE — skipping submit');
      return {
        success: true,
        isDuplicate: true,
        message: '⚠️ รายการฝากซ้ำ - พบรายการนี้ในระบบแล้ว (v2 pre-check)',
        resolvedMemberCode: memberCode,
        resolvedUsername: resolvedName,
      };
    }

    const v2Endpoint = `${tenant.admin_api_url}/api/proxy/v1/admin/deposits`;
    // transferAt: แปลงเป็น ISO 8601 (…000Z) ตามที่ v2 (Betax2) ต้องการ — ถ้าไม่ส่งจะเตือน "กรุณากรอกเวลาที่โอน"
    let transferAtIso = transferDate;
    const parsedTransfer = new Date(transferDate);
    if (!Number.isNaN(parsedTransfer.getTime())) {
      transferAtIso = parsedTransfer.toISOString();
    }
    const v2Payload = {
      userId,
      amount: creditAmount,
      autoApprove: true,
      remark: `Auto deposit - ${String(request.slipData.transRef || '').substring(0, 50)}`,
      fromBankCode,
      fromAccountNumber: fromAccountNumberFull,
      fromAccountName,
      bankAccountId,
      isBonus: false,
      transferAt: transferAtIso,
    };

    log('[CreditService][v2] 🎯 Endpoint:', v2Endpoint);
    log('[CreditService][v2] 📤 Payload:', { userId: v2Payload.userId, amount: v2Payload.amount, fromBankCode, bankAccountId, transferAt: transferAtIso });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(v2Endpoint, {
        method: 'POST',
        headers: { ...getAdminAuthHeaders(sessionToken, 'v2'), 'Content-Type': 'application/json' },
        body: JSON.stringify(v2Payload),
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      return {
        success: false,
        message: fetchError.name === 'AbortError' ? 'Request timeout (5s)' : fetchError.message || 'Network error',
      };
    } finally {
      clearTimeout(timeoutId);
    }

    log('[CreditService][v2] 📥 Status:', response.status, response.ok ? '✅' : '❌');
    let result: any;
    try { result = await response.json(); } catch { result = {}; }
    log('[CreditService][v2] 📄 Response:', { success: result?.success, message: result?.message });

    if (!response.ok || result?.success === false) {
      return {
        success: false,
        message: `[v2] Credit failed: ${response.status} - ${result?.message || JSON.stringify(result)}`,
      };
    }

    log('[CreditService][v2] ✅ Credit submitted successfully!');
    return {
      success: true,
      data: result?.data,
      resolvedMemberCode: memberCode,
      resolvedUsername: resolvedName,
    };
  }

  /**
   * เติมเครดิตให้ผู้ใช้ผ่าน Admin Backend API (รองรับ v1 และ v2)
   */
  static async submitCredit(
    env: Env,
    request: SubmitCreditRequest,
    logger?: (...args: any[]) => void
  ): Promise<SubmitCreditResponse> {
    const log = logger || console.log;

    try {
      log('[CreditService] 💰 ===== CREDIT SUBMISSION START =====');

      // ดึงข้อมูล tenant รวม api_version, admin_username, admin_password
      const tenant = await env.DB.prepare(
        `SELECT id, name, admin_api_url, api_version, admin_username, admin_password
         FROM tenants WHERE id = ? AND status = ?`
      ).bind(request.tenantId, 'active').first() as any;

      if (!tenant) {
        log('[CreditService] ❌ Tenant not found:', request.tenantId);
        return { success: false, message: 'Tenant not found' };
      }

      const apiVersion = String(tenant.api_version || 'v1');
      log('[CreditService] 📦 Tenant:', { id: tenant.id, name: tenant.name, api_version: apiVersion });

      // ดึง session (auto re-login สำหรับ v2)
      const sessionToken = await this.ensureSession(env, tenant, log);
      if (!sessionToken) {
        return {
          success: false,
          message: apiVersion === 'v2'
            ? 'Auto re-login failed. Please check admin credentials.'
            : 'Session not active. Please login first.',
        };
      }
      log('[CreditService] ✅ Session ready');

      const creditAmount = request.slipData.amount?.amount || 0;
      const transferDate = request.slipData.date || new Date().toISOString();

      // ══════ V2 FLOW ══════
      if (apiVersion === 'v2') {
        return await this.submitCreditV2(tenant, sessionToken, request, log, creditAmount, transferDate);
      }

      // ══════ V1 FLOW ══════
      const resolveResult = await this.resolveMemberCodeForUser(
        tenant.admin_api_url as string, sessionToken, request.user, log
      );

      if (!resolveResult.success || !resolveResult.memberCode) {
        log('[CreditService] ❌ Cannot resolve memberCode:', resolveResult.message);
        return { success: false, message: resolveResult.message || 'Cannot resolve memberCode' };
      }

      const memberCode = resolveResult.memberCode;
      const resolvedUser = resolveResult.user || request.user;
      let actualBankAccount = request.user.bankAccount || request.user.bank_account || '';
      if (!actualBankAccount && memberCode) {
        const userDetail = await this.searchUserByKeyword(tenant.admin_api_url as string, sessionToken, memberCode, log);
        if (userDetail) {
          actualBankAccount = userDetail.bankAccount || userDetail.bank_account || actualBankAccount;
        }
      }

      const toAccountIdNumber = Number(request.toAccountId);
      if (!Number.isFinite(toAccountIdNumber)) {
        return { success: false, message: `Invalid toAccountId: ${request.toAccountId}` };
      }

      log('[CreditService] 👤 memberCode:', memberCode);

      // fromAccountNumber: ตัดเหลือ 6 หลักท้าย (v1 SMS bot matching)
      const digitsOnly = String(actualBankAccount || '').replace(/\D/g, '');
      const fromAccountNumberForApi = digitsOnly.length > 6 ? digitsOnly.slice(-6) : digitsOnly;

      const apiEndpoint = `${tenant.admin_api_url}/api/banking/transactions/deposit-record`;
      const payload = {
        memberCode,
        creditAmount,
        depositChannel: 'Mobile Banking (มือถือ)',
        toAccountId: toAccountIdNumber,
        transferAt: transferDate,
        auto: true,
        fromAccountNumber: fromAccountNumberForApi,
      };

      log('[CreditService] 🎯 Endpoint:', apiEndpoint);
      log('[CreditService] 📤 Payload:', { memberCode, creditAmount, toAccountId: toAccountIdNumber });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { ...getAdminAuthHeaders(sessionToken, 'v1'), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        return {
          success: false,
          message: fetchError.name === 'AbortError' ? 'Request timeout (5 seconds exceeded)' : fetchError.message || 'Network error',
        };
      } finally {
        clearTimeout(timeoutId);
      }

      log('[CreditService] 📥 Response Status:', response.status, response.ok ? '✅' : '❌');
      let result: any;
      try { result = await response.json(); } catch (e) {
        return { success: false, message: `Credit failed: ${response.status} - Unable to parse response` };
      }

      log('[CreditService] 📄 Response:', { status: response.status, message: result.message });

      const dupMsg = String(result?.message || '').toUpperCase();
      const dupSts = String(result?.status || '').toUpperCase();
      if (dupMsg === 'DUPLICATE_WITH_ADMIN_RECORD' || dupMsg === 'DUPLICATED' || dupSts === 'DUPLICATED') {
        log('[CreditService] ⚠️ DUPLICATE detected!');
        return {
          success: true,
          isDuplicate: true,
          message: '⚠️ รายการฝากซ้ำ - พบรายการนี้ในระบบแล้ว',
          resolvedMemberCode: memberCode,
          resolvedUsername: resolvedUser?.fullname || resolvedUser?.username || request.user.fullname,
        };
      }

      if (!response.ok) {
        return { success: false, message: `Credit failed: ${response.status} - ${result.message || JSON.stringify(result)}` };
      }

      log('[CreditService] ✅ Credit submitted successfully!');
      return {
        success: true,
        data: result.data,
        resolvedMemberCode: memberCode,
        resolvedUsername: resolvedUser?.fullname || resolvedUser?.username || request.user.fullname,
      };
    } catch (error: any) {
      log('[CreditService] ❌ Unexpected error:', error.message || error);
      return { success: false, message: error.message || 'Unknown error' };
    }
  }

  /**
   * Anti-Dup check สำหรับ v1 (ใช้กับเส้น manual credit)
   * เทียบยอด + เวลาในลิสต์ฝากของ user ภายในหน้าต่างเวลา (ดีฟอลต์ 60 วินาที) — mirror จาก scan.ts (auto)
   * คืน { isDuplicate, deposit } — ถ้าเช็คไม่ได้จะถือว่าไม่ซ้ำ (fail-open เหมือน auto flow)
   */
  static async checkManualDuplicateV1(
    adminApiUrl: string,
    sessionToken: string,
    memberCodeOrUserId: string,
    slipAmount: number,
    slipDate: string,
    windowMs: number = 60 * 1000,
    logger?: (...args: any[]) => void
  ): Promise<{ isDuplicate: boolean; deposit?: any }> {
    const log = logger || console.log;
    try {
      // 1) หา numeric userId จาก memberCode
      const user = await this.searchUserByKeyword(adminApiUrl, sessionToken, String(memberCodeOrUserId), log);
      const userId = user?.id;
      if (!userId) {
        log('[CreditService] ⚠️ Anti-dup(manual): resolve userId ไม่ได้ — ข้ามการเช็ค');
        return { isDuplicate: false };
      }

      const slipTime = this.normalizeTimeMs(slipDate);
      // 2) ดึงลิสต์ฝากล่าสุดของ user
      const resp = await fetch(
        `${adminApiUrl}/api/user-transactions/list?page=1&limit=20&sortCol=transfer_at&sortAsc=desc&userId=${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' } },
      );
      if (!resp.ok) {
        log('[CreditService] ⚠️ Anti-dup(manual): ดึงลิสต์ฝากไม่สำเร็จ', resp.status, '— ข้าม');
        return { isDuplicate: false };
      }
      const data = await resp.json() as { list?: any[] };
      const deposits = (data.list || []).filter((t: any) => t.typeName === 'ฝาก');

      for (const dep of deposits) {
        const sameAmount =
          typeof dep.creditAmount === 'number' && typeof slipAmount === 'number'
            ? Math.abs(dep.creditAmount - slipAmount) < 0.01
            : dep.creditAmount === slipAmount;
        if (!sameAmount) continue;
        if (dep.transferAt && slipTime) {
          const depTime = this.normalizeTimeMs(dep.transferAt);
          if (depTime !== null && Math.abs(depTime - slipTime) <= windowMs) {
            log('[CreditService] ⚠️ Anti-dup(manual): พบรายการฝากซ้ำ', { amount: slipAmount, transferAt: dep.transferAt });
            return { isDuplicate: true, deposit: dep };
          }
        }
      }
      return { isDuplicate: false };
    } catch (err: any) {
      log('[CreditService] ⚠️ Anti-dup(manual) error (non-blocking):', err?.message || err);
      return { isDuplicate: false };
    }
  }

  /** normalize เวลา → UTC unix ms (ถ้าไม่มี timezone ถือเป็นเวลาไทย UTC+7) */
  private static normalizeTimeMs(timeStr: string | null | undefined): number | null {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const trimmed = timeStr.trim();
    if (!trimmed) return null;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      const ms = new Date(trimmed).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const isoLike = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const ms = new Date(`${isoLike}+07:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * ตรวจสอบว่า tenant มีการเปิดใช้งาน auto-deposit หรือไม่
   */
  static async isAutoDepositEnabled(env: Env, tenantId: string): Promise<boolean> {
    const tenant = await env.DB.prepare(
      `SELECT auto_deposit_enabled FROM tenants WHERE id = ?`
    )
      .bind(tenantId)
      .first();

    return tenant?.auto_deposit_enabled === 1;
  }

  /**
   * ดึงเครดิตกลับผ่าน Admin Backend API (รองรับ v1 และ v2)
   */
  static async withdrawCreditBack(
    env: Env,
    params: {
      tenantId: string;
      amount: number;
      memberCode: string;
      remark: string;
    },
    logger?: (...args: any[]) => void
  ): Promise<{ success: boolean; message?: string; data?: any }> {
    const log = logger || console.log;

    try {
      const tenant = await env.DB.prepare(
        `SELECT id, admin_api_url, api_version, admin_username, admin_password
         FROM tenants WHERE id = ? AND status = ?`
      ).bind(params.tenantId, 'active').first() as any;

      if (!tenant) return { success: false, message: 'Tenant not found' };

      const apiVersion = String(tenant.api_version || 'v1');

      const sessionToken = await this.ensureSession(env, tenant, log);
      if (!sessionToken) {
        return {
          success: false,
          message: apiVersion === 'v2'
            ? 'Auto re-login failed. Please check admin credentials.'
            : 'Session not active. Please login first.',
        };
      }

      // ══════ V2 FLOW ══════
      if (apiVersion === 'v2') {
        // v2 ใช้ userId (int) → ค้นหาจาก memberCode
        log('[CreditService][v2] 🔍 Looking up userId for withdraw:', params.memberCode);
        const v2User = await this.searchUserV2(tenant.admin_api_url, sessionToken, params.memberCode, log);
        if (!v2User) {
          return { success: false, message: `[v2] User not found for withdraw: ${params.memberCode}` };
        }
        const userId = Number(v2User.id);
        if (!Number.isFinite(userId) || userId <= 0) {
          return { success: false, message: `[v2] Invalid userId: ${v2User.id}` };
        }

        const v2Endpoint = `${tenant.admin_api_url}/api/proxy/v1/admin/withdraws`;
        const v2Payload = { userId, amount: params.amount, autoApprove: true, remark: params.remark, withdrawType: 'cancel_credit' };
        log('[CreditService][v2] ↩️ Withdraw endpoint:', v2Endpoint);

        const response = await fetch(v2Endpoint, {
          method: 'POST',
          headers: { ...getAdminAuthHeaders(sessionToken, 'v2'), 'Content-Type': 'application/json' },
          body: JSON.stringify(v2Payload),
        });
        const result: any = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
          return { success: false, message: `[v2] Withdraw failed: ${response.status} - ${result?.message || JSON.stringify(result)}` };
        }
        return { success: true, message: result?.message || 'Withdraw credit success (v2)', data: result?.data };
      }

      // ══════ V1 FLOW ══════
      const endpoint = `${tenant.admin_api_url}/api/banking/transactions/withdraw-credit-back`;
      const payload = { amount: params.amount, memberCode: params.memberCode, remark: params.remark };
      log('[CreditService] ↩️ Withdraw endpoint:', endpoint);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...getAdminAuthHeaders(sessionToken, 'v1'), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { success: false, message: `Withdraw failed: ${response.status} - ${result?.message || JSON.stringify(result)}` };
      }
      return { success: true, message: result?.message || 'Withdraw credit success', data: result?.data };
    } catch (error: any) {
      return { success: false, message: error.message || 'Unknown error' };
    }
  }
}
