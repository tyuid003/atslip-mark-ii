// Credit Service
// ฟังก์ชันสำหรับเติมเครดิตให้ผู้ใช้

import type { Env } from '../types';

interface SubmitCreditRequest {
  tenantId: string;
  slipData: {
    amount?: {
      amount?: number;
    };
    date?: string;
    transRef?: string;
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

    if (existingMemberCode) {
      const resolvedUser = await this.searchUserByKeyword(adminApiUrl, sessionToken, existingMemberCode, log);
      return {
        success: true,
        memberCode: existingMemberCode,
        user: resolvedUser || user,
      };
    }

    const userId = String(user.id || '').trim();
    if (!userId) {
      return {
        success: false,
        message: 'Missing memberCode and user.id for memberCode generation',
      };
    }

    const genMemberCodeUrl = `${adminApiUrl}/api/admin/gen-membercode/${encodeURIComponent(userId)}`;
    log('[CreditService] 🧾 memberCode is empty, generating via:', genMemberCodeUrl);

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
      user: resolvedUser || user,
    };
  }

  /**
   * เติมเครดิตให้ผู้ใช้ผ่าน Admin Backend API
   * 
   * @param env - Cloudflare environment
   * @param request - ข้อมูลสำหรับเติมเครดิต
   * @param logger - ฟังก์ชัน log (optional)
   * @returns ผลลัพธ์การเติมเครดิต
   */
  static async submitCredit(
    env: Env,
    request: SubmitCreditRequest,
    logger?: (...args: any[]) => void
  ): Promise<SubmitCreditResponse> {
    const log = logger || console.log;

    try {
      log('[CreditService] 💰 ===== CREDIT SUBMISSION START =====');
      
      // ดึงข้อมูล tenant
      const tenant = await env.DB.prepare(
        `SELECT id, name, admin_api_url FROM tenants WHERE id = ? AND status = ?`
      )
        .bind(request.tenantId, 'active')
        .first();

      if (!tenant) {
        log('[CreditService] ❌ Tenant not found:', request.tenantId);
        return { success: false, message: 'Tenant not found' };
      }

      log('[CreditService] 📦 Tenant found:', {
        id: tenant.id,
        name: tenant.name,
        admin_api_url: tenant.admin_api_url,
      });

      // ดึง session token
      const now = Math.floor(Date.now() / 1000);
      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions 
         WHERE tenant_id = ? AND expires_at > ? 
         LIMIT 1`
      )
        .bind(request.tenantId, now)
        .first();

      if (!session) {
        log('[CreditService] ❌ No active session found for tenant:', request.tenantId);
        return { success: false, message: 'Session not active. Please login first.' };
      }

      const sessionToken = session.session_token as string;
      log('[CreditService] ✅ Active session found');

      // ตรวจสอบ/สร้าง memberCode ก่อนเติมเครดิต
      const resolveResult = await this.resolveMemberCodeForUser(
        tenant.admin_api_url as string,
        sessionToken,
        request.user,
        log
      );

      if (!resolveResult.success || !resolveResult.memberCode) {
        log('[CreditService] ❌ Cannot resolve memberCode:', resolveResult.message);
        return {
          success: false,
          message: resolveResult.message || 'Cannot resolve memberCode',
        };
      }

      const memberCode = resolveResult.memberCode;
      const resolvedUser = resolveResult.user || request.user;
      const creditAmount = request.slipData.amount?.amount || 0;
      
      // ค้นหา user detail เพื่อได้ bankAccount ที่ถูกต้อง
      let actualBankAccount = request.user.bankAccount || request.user.bank_account || '';
      if (!actualBankAccount && memberCode) {
        log('[CreditService] 📋 Searching for user detail to get actual bank account...');
        const userDetail = await this.searchUserByKeyword(
          tenant.admin_api_url as string,
          sessionToken,
          memberCode,
          log
        );
        
        if (userDetail) {
          actualBankAccount = userDetail.bankAccount || userDetail.bank_account || actualBankAccount;
          log('[CreditService] ✅ Found user detail, using bank account:', actualBankAccount);
        }
      }
      
      const transferDate = request.slipData.date || new Date().toISOString();
      const toAccountIdNumber = Number(request.toAccountId);

      if (!Number.isFinite(toAccountIdNumber)) {
        log('[CreditService] ❌ Invalid toAccountId:', request.toAccountId);
        return {
          success: false,
          message: `Invalid toAccountId: ${request.toAccountId}`,
        };
      }

      if (!actualBankAccount) {
        log('[CreditService] ⚠️ Warning: actualBankAccount is empty');
      }

      log('[CreditService] 👤 Using memberCode for credit:', memberCode);

      const apiEndpoint = `${tenant.admin_api_url}/api/banking/transactions/deposit-record`;
      const payload = {
        memberCode,
        creditAmount: creditAmount,
        depositChannel: 'Mobile Banking (มือถือ)',
        toAccountId: toAccountIdNumber,
        transferAt: transferDate,
        auto: true,
        fromAccountNumber: actualBankAccount,
      };

      log('[CreditService] 🎯 API Endpoint:', apiEndpoint);
      log('[CreditService] 📤 Payload:', {
        ...payload,
        creditAmount: payload.creditAmount,
        toAccountId: payload.toAccountId,
      });

      // เรียก API
      log('[CreditService] 🔄 Calling Admin Backend API...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      let response: Response;
      try {
        response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        log('[CreditService] ❌ Fetch failed or timeout:', fetchError.message);
        return {
          success: false,
          message: fetchError.name === 'AbortError' 
            ? 'Request timeout (5 seconds exceeded)' 
            : fetchError.message || 'Network error',
        };
      } finally {
        clearTimeout(timeoutId);
      }

      log('[CreditService] 📥 Response Status:', response.status, response.ok ? '✅' : '❌');

      // Parse response
      let result: any;
      try {
        result = await response.json();
      } catch (parseError) {
        log('[CreditService] ❌ Failed to parse response:', parseError);
        return {
          success: false,
          message: `Credit failed: ${response.status} - Unable to parse response`,
        };
      }

      log('[CreditService] 📄 Response Body:', {
        status: response.status,
        message: result.message,
        hasData: !!result.data,
      });

      // ตรวจสอบ duplicate
      const duplicateMessage = String(result?.message || '').toUpperCase();
      const duplicateStatus = String(result?.status || '').toUpperCase();
      const isDuplicateMessage = duplicateMessage === 'DUPLICATE_WITH_ADMIN_RECORD' || duplicateMessage === 'DUPLICATED';
      const isDuplicateStatus = duplicateStatus === 'DUPLICATED';
      if (isDuplicateMessage || isDuplicateStatus) {
        log('[CreditService] ⚠️ DUPLICATE detected!');
        log('[CreditService] 💰 ===== CREDIT SUBMISSION END (DUPLICATE) =====');
        return {
          success: true,
          isDuplicate: true,
          message: '⚠️ รายการฝากซ้ำ - พบรายการนี้ในระบบแล้ว',
          resolvedMemberCode: memberCode,
          resolvedUsername: resolvedUser?.fullname || resolvedUser?.username || request.user.fullname,
        };
      }

      // ตรวจสอบ error
      if (!response.ok) {
        log('[CreditService] ❌ Credit failed:', result.message);
        log('[CreditService] 💰 ===== CREDIT SUBMISSION END (FAILED) =====');
        return {
          success: false,
          message: `Credit failed: ${response.status} - ${result.message || JSON.stringify(result)}`,
        };
      }

      log('[CreditService] ✅ Credit submitted successfully!');
      log('[CreditService] 💰 ===== CREDIT SUBMISSION END (SUCCESS) =====');

      return { 
        success: true,
        data: result.data,
        resolvedMemberCode: memberCode,
        resolvedUsername: resolvedUser?.fullname || resolvedUser?.username || request.user.fullname,
      };
    } catch (error: any) {
      log('[CreditService] ❌ Unexpected error:', error.message || error);
      log('[CreditService] 💰 ===== CREDIT SUBMISSION END (ERROR) =====');
      return {
        success: false,
        message: error.message || 'Unknown error',
      };
    }
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
   * ดึงเครดิตกลับผ่าน Admin Backend API
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
        `SELECT id, admin_api_url FROM tenants WHERE id = ? AND status = ?`
      )
        .bind(params.tenantId, 'active')
        .first();

      if (!tenant) {
        return { success: false, message: 'Tenant not found' };
      }

      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions 
         WHERE tenant_id = ? AND expires_at > ? 
         LIMIT 1`
      )
        .bind(params.tenantId, Math.floor(Date.now() / 1000))
        .first();

      if (!session) {
        return { success: false, message: 'Session not active. Please login first.' };
      }

      const endpoint = `${tenant.admin_api_url}/api/banking/transactions/user-credit-cancel`;
      const payload = {
        memberCode: params.memberCode,
        amount: params.amount,
        remark: params.remark,
      };

      log('[CreditService] ↩️ Withdraw credit endpoint:', endpoint);
      log('[CreditService] ↩️ Withdraw payload:', payload);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.session_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          message: `Withdraw failed: ${response.status} - ${result?.message || JSON.stringify(result)}`,
        };
      }

      return {
        success: true,
        message: result?.message || 'Withdraw credit success',
        data: result?.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Unknown error',
      };
    }
  }
}
