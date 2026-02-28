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

      console.log('[ScanAPI] Received slip upload:', file.name, file.type, file.size);

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
          console.error('[ScanAPI] ❌ Tenant not found:', tenantId);
          return errorResponse('Tenant not found or inactive', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        console.log('[ScanAPI] Using tenant-specific token:', {
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
          console.error('[ScanAPI] ❌ No active tenant with EASYSLIP token found');
          return errorResponse('No active tenant with EASYSLIP token found. Please configure EASYSLIP token in tenant settings.', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        console.log('[ScanAPI] Using default tenant token:', {
          tenantId: tenant.id,
          tenantName: tenant.name,
          hasToken: !!easyslipToken,
          tokenLength: easyslipToken?.length || 0,
        });
      }

      // ตรวจสอบว่า token มีค่าหรือไม่
      if (!easyslipToken || easyslipToken.trim() === '' || easyslipToken === 'null') {
        console.error('[ScanAPI] ❌ EASYSLIP token is empty or invalid');
        return errorResponse('EASYSLIP token is not configured or invalid. Please update tenant settings with a valid EASYSLIP API token.', 400);
      }

      // สแกนสลิป
      let slipData: any;
      try {
        slipData = await ScanService.scanSlip(file, easyslipToken);
        console.log('[ScanAPI] ScanService.scanSlip() returned:', {
          success: slipData?.success,
          hasData: !!slipData?.data,
          dataKeys: slipData?.data ? Object.keys(slipData.data) : [],
        });
      } catch (scanError: any) {
        console.error('[ScanAPI] ❌ ScanService.scanSlip() threw exception:', scanError.message);
        return errorResponse(`EASYSLIP error: ${scanError.message}`, 400);
      }

      console.log('[ScanAPI] EASYSLIP response:', {
        success: slipData.success,
        status: slipData.data?.status,
        message: slipData.data?.message,
        hasData: !!slipData.data?.data,
      });

      if (!slipData.success) {
        console.error('[ScanAPI] ❌ EASYSLIP API call failed:', JSON.stringify(slipData, null, 2));
        return errorResponse(`EASYSLIP error: ${slipData.data?.message || 'API request failed'}`, 400);
      }

      if (slipData.data.status !== 200) {
        console.error('[ScanAPI] ❌ EASYSLIP returned non-200 status:', JSON.stringify(slipData.data, null, 2));
        return errorResponse(`EASYSLIP error (${slipData.data.status}): ${slipData.data?.message || 'Scan failed'}`, 400);
      }

      const slip = slipData.data.data;
      console.log('[ScanAPI] Slip scanned successfully:', slip.transRef);

      // Match receiver (บัญชีรับ)
      const receiverBank = slip.receiver.bank;
      const receiverAccount = slip.receiver.account.bank?.account || slip.receiver.account.proxy?.account || '';
      const receiverNameTh = slip.receiver.account.name.th;
      const receiverNameEn = slip.receiver.account.name.en;

      console.log('[ScanAPI] Matching receiver...', {
        bank: receiverBank.name,
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
        console.log('[ScanAPI] ❌ No matching tenant found');
        return errorResponse('No matching tenant found for this slip', 404);
      }

      console.log('[ScanAPI] ✅ Matched tenant:', matchedTenant.name);

      // Match sender (ผู้โอน)
      const senderNameTh = slip.sender.account.name.th;
      const senderNameEn = slip.sender.account.name.en;
      const senderAccount = slip.sender.account.bank?.account || slip.sender.account.proxy?.account || '';

      console.log('[ScanAPI] Matching sender...', {
        nameTh: senderNameTh,
        nameEn: senderNameEn,
        account: senderAccount,
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
        const sessionToken = session.session_token as string;
        matchedUser = await ScanService.matchSender(
          matchedTenant.admin_api_url,
          sessionToken,
          senderNameTh,
          senderNameEn
        );

        if (matchedUser) {
          console.log('[ScanAPI] ✅ Matched user:', matchedUser.fullname);
        } else {
          console.log('[ScanAPI] ❌ No matching user found');
        }
      } else {
        console.log('[ScanAPI] ⚠️ No active session for tenant');
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
          matchedUser?.id || null,
          matchedUser?.fullname || null,
          matchedUser ? 'matched' : 'pending',
          'upload',
          now,
          now
        )
        .run();

      console.log('[ScanAPI] ✅ Transaction saved:', transactionId);

      return successResponse({
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
      console.error('[ScanAPI] Error:', error);
      return errorResponse(error.message, 500);
    }
  },
};
