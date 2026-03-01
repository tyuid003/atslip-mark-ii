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
  toAccountId: string;
}

interface SubmitCreditResponse {
  success: boolean;
  isDuplicate?: boolean;
  message?: string;
  data?: any;
}

export class CreditService {
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

      // ตรวจสอบว่า user มี memberCode หรือไม่
      const hasMemberCode = request.user.memberCode && request.user.memberCode.trim() !== '';
      const creditAmount = request.slipData.amount?.amount || 0;
      const userBankAccount = request.user.bankAccount || request.user.bank_account || '';
      const transferDate = request.slipData.date || new Date().toISOString();

      let apiEndpoint: string;
      let payload: any;

      if (hasMemberCode) {
        // สมาชิกเดิม - ใช้ memberCode
        log('[CreditService] 👤 User type: EXISTING MEMBER');
        log('[CreditService] MemberCode:', request.user.memberCode);

        apiEndpoint = `${tenant.admin_api_url}/api/banking/transactions/deposit-record`;
        payload = {
          memberCode: request.user.memberCode,
          creditAmount: creditAmount,
          depositChannel: 'Mobile Banking (มือถือ)',
          toAccountId: request.toAccountId,
          transferAt: transferDate,
          auto: true,
          fromAccountNumber: userBankAccount,
        };
      } else {
        // สมาชิกใหม่/ไม่มี memberCode - ใช้ userId
        log('[CreditService] 🆕 User type: NEW MEMBER / NON-MEMBER');
        log('[CreditService] UserId:', request.user.id);

        apiEndpoint = `${tenant.admin_api_url}/api/banking/transactions/first-time-deposit-record`;
        payload = {
          userId: request.user.id,
          creditAmount: creditAmount,
          depositChannel: 'Mobile Banking (มือถือ)',
          toAccountId: request.toAccountId,
          transferAt: transferDate,
          auto: true,
          fromAccountNumber: userBankAccount,
        };
      }

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
      const isDuplicateMessage = result.message === 'DUPLICATE_WITH_ADMIN_RECORD';
      if (isDuplicateMessage) {
        log('[CreditService] ⚠️ DUPLICATE detected!');
        log('[CreditService] 💰 ===== CREDIT SUBMISSION END (DUPLICATE) =====');
        return {
          success: true,
          isDuplicate: true,
          message: '⚠️ รายการฝากซ้ำ - พบรายการนี้ในระบบแล้ว',
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
}
