// Scan API
// POST /api/scan/upload - อัพโหลดสลิปและสแกน

import { jsonResponse, errorResponse, successResponse } from '../utils/helpers';
import { ScanService } from '../services/scan.service';
import type { Env } from '../types';

export const ScanAPI = {
  /**
   * POST /api/scan/upload
   * อัพโหลดและสแกนสลิป
   */
  async handleUploadSlip(request: Request, env: Env): Promise<Response> {
    try {
      // Debug logs array to send back to frontend
      const debugLogs: string[] = [];
      const log = (...args: any[]) => {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        debugLogs.push(message);
        console.log(...args);
      };

      // รับ form data
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return errorResponse('No file uploaded', 400);
      }

      // ตรวจสอบว่าเป็นไฟล์รูปหรือไม่
      if (!file.type.startsWith('image/')) {
        return errorResponse('File must be an image', 400);
      }

      log('[ScanAPI] Received slip upload:', file.name, file.type, file.size);

      // ส่งไปสแกนที่ EASYSLIP (ใช้ token ของ tenant ใดก็ได้ที่ active)
      // หรืออาจจะส่งมา tenant_id ใน form data
      const tenantId = formData.get('tenant_id') as string | null;

      let easyslipToken = '';

      if (tenantId) {
        // ดึง token ของ tenant นี้
        const tenant = await env.DB.prepare(
          'SELECT easyslip_token FROM tenants WHERE id = ? AND status = ?'
        )
          .bind(tenantId, 'active')
          .first();

        if (!tenant) {
          log('[ScanAPI] ❌ Tenant not found:', tenantId);
          return errorResponse('Tenant not found or inactive', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        log('[ScanAPI] Using tenant-specific token:', {
          tenantId,
          hasToken: !!easyslipToken,
          tokenLength: easyslipToken?.length || 0,
        });
      } else {
        // ใช้ token ของ tenant active ตัวแรก
        const tenant = await env.DB.prepare(
          'SELECT id, name, easyslip_token FROM tenants WHERE status = ? AND easyslip_token IS NOT NULL AND easyslip_token != ? LIMIT 1'
        )
          .bind('active', '')
          .first();

        if (!tenant) {
          log('[ScanAPI] ❌ No active tenant with EASYSLIP token found');
          return errorResponse('No active tenant with EASYSLIP token found. Please configure EASYSLIP token in tenant settings.', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        log('[ScanAPI] Using default tenant token:', {
          tenantId: tenant.id,
          tenantName: tenant.name,
          hasToken: !!easyslipToken,
          tokenLength: easyslipToken?.length || 0,
        });
      }

      // ตรวจสอบว่า token มีค่าหรือไม่
      if (!easyslipToken || easyslipToken.trim() === '' || easyslipToken === 'null') {
        log('[ScanAPI] ❌ EASYSLIP token is empty or invalid');
        return errorResponse('EASYSLIP token is not configured or invalid. Please update tenant settings with a valid EASYSLIP API token.', 400);
      }

      // สแกนสลิป
      let slipData: any;
      try {
        slipData = await ScanService.scanSlip(file, easyslipToken);
        log('[ScanAPI] ScanService.scanSlip() returned:', {
          success: slipData?.success,
          hasData: !!slipData?.data,
          dataKeys: slipData?.data ? Object.keys(slipData.data) : [],
        });
      } catch (scanError: any) {
        log('[ScanAPI] ❌ ScanService.scanSlip() threw exception:', scanError.message);
        return errorResponse(`EASYSLIP error: ${scanError.message}`, 400);
      }

      log('[ScanAPI] EASYSLIP response:', {
        success: slipData?.success,
        status: slipData?.data?.status,
        message: slipData.data?.message,
        hasData: !!slipData.data?.data,
      });

      if (!slipData.success) {
        log('[ScanAPI] ❌ EASYSLIP API call failed:', JSON.stringify(slipData, null, 2));
        return errorResponse(`EASYSLIP error: ${slipData.data?.message || 'API request failed'}`, 400);
      }

      if (slipData.data.status !== 200) {
        log('[ScanAPI] ❌ EASYSLIP returned non-200 status:', JSON.stringify(slipData.data, null, 2));
        return errorResponse(`EASYSLIP error (${slipData.data.status}): ${slipData.data?.message || 'Scan failed'}`, 400);
      }

      const slip = slipData.data.data;
      log('[ScanAPI] Slip scanned successfully:', slip.transRef);

      // Match receiver (บัญชีรับ)
      log('[ScanAPI] 🏦 ===== RECEIVER MATCHING START =====');
      
      const receiverBank = slip.receiver.bank;
      const receiverAccount = slip.receiver.account.bank?.account || slip.receiver.account.proxy?.account || '';
      const receiverNameTh = slip.receiver.account.name.th;
      const receiverNameEn = slip.receiver.account.name.en;

      log('[ScanAPI] 📥 Receiver Info from SLIP:', {
        bank: receiverBank?.name || receiverBank?.short || receiverBank?.id || 'N/A',
        account: receiverAccount,
        nameTh: receiverNameTh,
        nameEn: receiverNameEn,
      });

      const matchedTenant = await ScanService.matchReceiver(
        env,
        receiverBank,
        receiverAccount,
        receiverNameTh,
        receiverNameEn
      );

      if (!matchedTenant) {
        log('[ScanAPI] ❌ RESULT: No matching tenant found');
        log('[ScanAPI] 🏦 ===== RECEIVER MATCHING END (NO MATCH) =====');
        return errorResponse('No matching tenant found for this slip', 404);
      }

      log('[ScanAPI] ✅ MATCHED TENANT:', {
        id: matchedTenant.id,
        name: matchedTenant.name,
        admin_api_url: matchedTenant.admin_api_url,
      });
      log('[ScanAPI] 🏦 ===== RECEIVER MATCHING END (MATCHED) =====');

      // Match sender (ผู้โอน)
      const senderNameTh = slip.sender.account.name.th;
      const senderNameEn = slip.sender.account.name.en;
      const senderAccount = slip.sender.account.bank?.account || slip.sender.account.proxy?.account || '';
      const senderBank = slip.sender.bank; // { id, name, short }

      log('[ScanAPI] 🔍 ===== SENDER MATCHING START =====');
      log('[ScanAPI] 📥 Sender Info from SLIP:', {
        nameTh: senderNameTh,
        nameEn: senderNameEn,
        account: senderAccount,
        bank: senderBank?.name || senderBank?.short || senderBank?.id || 'N/A',
      });

      // ดึง session token ของ tenant ที่ match ได้
      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions 
         WHERE tenant_id = ? AND expires_at > ? 
         LIMIT 1`
      )
        .bind(matchedTenant.id, Math.floor(Date.now() / 1000))
        .first();

      let matchedUser = null;

      if (session) {
        log('[ScanAPI] ✅ Session found, calling matchSender...');
        const sessionToken = session.session_token as string;
        matchedUser = await ScanService.matchSender(
          matchedTenant.admin_api_url,
          sessionToken,
          senderNameTh,
          senderNameEn,
          senderAccount,
          senderBank,
          log
        );

        if (matchedUser) {
          log('[ScanAPI] ✅ MATCHED USER:', {
            id: matchedUser.id,
            memberCode: matchedUser.memberCode,
            fullname: matchedUser.fullname,
            category: matchedUser.category,
            bankAccount: matchedUser.bankAccount || matchedUser.bank_account || 'N/A',
          });
        } else {
          log('[ScanAPI] ❌ No matching user found');
        }
      } else {
        log('[ScanAPI] ❌ No active session for tenant, cannot search users');
      }

      log('[ScanAPI] 🔍 ===== SENDER MATCHING END =====');

      // ตรวจสอบสลิปซ้ำก่อนบันทึก
      const existingSlip = await env.DB.prepare(
        `SELECT id FROM pending_transactions WHERE slip_ref = ? LIMIT 1`
      )
        .bind(slip.transRef)
        .first();

      if (existingSlip) {
        log('[ScanAPI] ⚠️ Duplicate slip detected:', slip.transRef);
        return errorResponse('สลิปนี้เคยบันทึกไว้แล้ว (Duplicate slip)', 400);
      }

      // บันทึกใน pending_transactions
      const transactionId = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO pending_transactions 
         (id, team_id, tenant_id, line_oa_id, slip_ref, amount, sender_name, sender_account, 
          receiver_name, receiver_account, slip_data, matched_user_id, matched_username, 
          status, source, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          transactionId,
          matchedTenant.team_id,
          matchedTenant.id,
          null, // line_oa_id (null สำหรับการอัพโหลด)
          slip.transRef,
          slip.amount.amount,
          senderNameTh || senderNameEn || 'Unknown',
          senderAccount,
          receiverNameTh || receiverNameEn || '',
          receiverAccount,
          JSON.stringify(slip),
          matchedUser?.memberCode || null,
          matchedUser?.fullname || null,
          matchedUser ? 'matched' : 'pending',
          'upload',
          now,
          now
        )
        .run();

      log('[ScanAPI] ✅ Transaction saved:', transactionId);

      return successResponse({
        debug: debugLogs,
        transaction_id: transactionId,
        tenant: {
          id: matchedTenant.id,
          name: matchedTenant.name,
        },
        slip: {
          ref: slip.transRef,
          amount: slip.amount.amount,
          date: slip.date,
        },
        sender: matchedUser
          ? {
              id: matchedUser.id,
              name: matchedUser.fullname,
              matched: true,
            }
          : {
              name: senderNameTh || senderNameEn || 'Unknown',
              matched: false,
            },
        status: matchedUser ? 'matched' : 'pending',
      }, 'Slip scanned and saved successfully');
    } catch (error: any) {
      log('[ScanAPI] ❌ Error:', error.message || error);
      return jsonResponse({
        success: false,
        error: error.message || 'Internal server error',
        debug: debugLogs,
      }, 500);
    }
  },
};
