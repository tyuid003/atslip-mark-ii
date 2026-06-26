import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';
import { CreditService } from '../services/credit.service';

/**
 * PATCH /api/pending-transactions/:id/match
 * Manually match a pending transaction with a user.
 *
 * เพิ่มเติม (Non-member flow):
 * - ถ้า body.user.category === 'non-member' หรือ memberCode ว่าง จะเรียก gen-membercode
 *   (ผ่าน CreditService.resolveMemberCodeForUser) แล้วเก็บ memberCode ที่ได้ลง matched_user_id
 *   เพื่อให้ตอนกดเติมเครดิตใช้ memberCode ที่ถูกต้องทันที
 */
export async function handleMatchPendingTransaction(
  env: Env,
  transactionId: string,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as {
      matched_user_id?: string;
      matched_username?: string;
      tenant_id?: string;
      user?: {
        id?: string;
        memberCode?: string;
        username?: string;
        fullname?: string;
        category?: string;
      };
      scanned_by_id?: string | null;
      scanned_by_name?: string | null;
      scanned_by_photo?: string | null;
    };

    if (!body.matched_user_id || !body.matched_username) {
      return errorResponse('matched_user_id and matched_username are required', 400);
    }

    // Check if transaction exists
    const existing = await env.DB.prepare(
      `SELECT id, status FROM pending_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first<{ id: string; status: string }>();

    if (!existing) {
      return errorResponse('Transaction not found', 404);
    }

    // ===== Resolve memberCode (สำหรับ non-member / memberCode ว่าง) =====
    let finalMatchedUserId = String(body.matched_user_id || '').trim();
    let finalMatchedUsername = String(body.matched_username || '').trim();

    const incomingUser = body.user || {};
    const category = String(incomingUser.category || '').toLowerCase();
    const incomingMemberCode = String(incomingUser.memberCode || '').trim();
    const tenantIdForResolve = String(body.tenant_id || '').trim();

    // Debug: log full payload received
    console.log('[Manual Match] 📥 Incoming payload:', JSON.stringify({
      matched_user_id: body.matched_user_id,
      matched_username: body.matched_username,
      tenant_id: body.tenant_id,
      user: body.user,
    }));
    console.log('[Manual Match] Derived: category=', category, 'incomingMemberCode=', incomingMemberCode, 'tenantIdForResolve=', tenantIdForResolve);

    const needResolve =
      !!tenantIdForResolve &&
      (category === 'non-member' || !incomingMemberCode);

    console.log('[Manual Match] needResolve=', needResolve);

    if (needResolve) {
      const tenant = await env.DB.prepare(
        `SELECT admin_api_url FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
      )
        .bind(tenantIdForResolve)
        .first<{ admin_api_url: string }>();

      const session = tenant
        ? await env.DB.prepare(
            `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
          )
            .bind(tenantIdForResolve, Math.floor(Date.now() / 1000))
            .first<{ session_token: string }>()
        : null;

      console.log('[Manual Match] tenant found=', !!tenant, 'session found=', !!session?.session_token);

      if (tenant?.admin_api_url && session?.session_token) {
        const resolveResult = await CreditService.resolveMemberCodeForUser(
          tenant.admin_api_url,
          session.session_token,
          {
            id: incomingUser.id || finalMatchedUserId,
            memberCode: incomingMemberCode,
            fullname: incomingUser.fullname || finalMatchedUsername,
          },
          console.log
        );

        if (resolveResult.success && resolveResult.memberCode) {
          finalMatchedUserId = resolveResult.memberCode;
          const resolvedName =
            (resolveResult.user as any)?.fullname ||
            (resolveResult.user as any)?.username ||
            finalMatchedUsername;
          if (resolvedName) finalMatchedUsername = String(resolvedName);
          console.log('[Manual Match] ✅ Resolved memberCode for non-member:', finalMatchedUserId);
        } else {
          console.warn('[Manual Match] ⚠️ Cannot resolve memberCode:', resolveResult.message);
          return errorResponse(
            resolveResult.message || 'ไม่สามารถสร้าง memberCode สำหรับผู้ใช้รายนี้ได้',
            400
          );
        }
      } else {
        // ถ้าไม่เจอ tenant หรือ session → block ไม่ให้บันทึก admin id ลง DB
        console.error('[Manual Match] ❌ Cannot resolve memberCode: tenant or session not found for tenantId=', tenantIdForResolve);
        return errorResponse(
          'ไม่พบ session admin หรือข้อมูล tenant กรุณา login ระบบแอดมินใหม่ก่อนจับคู่',
          401
        );
      }
    }

    // scanned_by — ใช้ของที่ส่งมา ถ้าไม่มีก็ไม่ overwrite (NULL)
    const scannedById   = body.scanned_by_id   ? String(body.scanned_by_id).substring(0, 64)   : null;
    const scannedByName = body.scanned_by_name ? String(body.scanned_by_name).substring(0, 255) : null;
    const scannedByPhotoRaw = body.scanned_by_photo || null;
    const scannedByPhoto = scannedByPhotoRaw ? String(scannedByPhotoRaw).substring(0, 32768) : null;

    // Update matched info (and tenant_id if provided — ใช้เมื่อผู้ใช้เลือก tenant ใหม่ตอนจับคู่ใหม่)
    let result;
    if (body.tenant_id) {
      result = await env.DB.prepare(
        `UPDATE pending_transactions
         SET matched_user_id = ?, matched_username = ?, tenant_id = ?,
             scanned_by_id = ?, scanned_by_name = ?, scanned_by_photo = ?,
             status = 'matched'
         WHERE id = ?`
      )
        .bind(finalMatchedUserId, finalMatchedUsername, body.tenant_id,
              scannedById, scannedByName, scannedByPhoto,
              transactionId)
        .run();
    } else {
      result = await env.DB.prepare(
        `UPDATE pending_transactions
         SET matched_user_id = ?, matched_username = ?,
             scanned_by_id = ?, scanned_by_name = ?, scanned_by_photo = ?,
             status = 'matched'
         WHERE id = ?`
      )
        .bind(finalMatchedUserId, finalMatchedUsername,
              scannedById, scannedByName, scannedByPhoto,
              transactionId)
        .run();
    }

    if (!result.success) {
      return errorResponse('Failed to update transaction', 500);
    }

    console.log(`[Manual Match] Transaction ${transactionId} matched to ${finalMatchedUsername} (${finalMatchedUserId})` + (body.tenant_id ? ` → tenant ${body.tenant_id}` : ''));

    // Return updated transaction (includes tenant_name)
    const updated = await env.DB.prepare(
      `SELECT pt.id, pt.tenant_id, pt.slip_ref, pt.amount, pt.sender_name, pt.status, pt.slip_data,
              pt.matched_user_id, pt.matched_username, pt.created_at,
              t.name as tenant_name
       FROM pending_transactions pt
       LEFT JOIN tenants t ON t.id = pt.tenant_id
       WHERE pt.id = ?`
    )
      .bind(transactionId)
      .first();

    // 🔔 Broadcast realtime notification for manual match
    try {
      const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
      const doStub = env.PENDING_NOTIFICATIONS.get(doId);
      await doStub.fetch('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transaction_updated',
          data: {
            id: transactionId,
            status: 'matched',
            matched_user_id: finalMatchedUserId,
            matched_username: finalMatchedUsername,
            scanned_by_id: scannedById,
            scanned_by_name: scannedByName,
            scanned_by_photo: scannedByPhoto,
            tenant_id: body.tenant_id || (updated as any)?.tenant_id,
            tenant_name: (updated as any)?.tenant_name || null,
            updated_at: Math.floor(Date.now() / 1000),
          },
        }),
      });
    } catch (broadcastError) {
      console.warn('[Manual Match] Broadcast failed:', broadcastError);
    }

    return successResponse({
      message: 'Transaction matched successfully',
      transaction: updated
    });
  } catch (error: any) {
    console.error('[Manual Match] Error:', error);
    return errorResponse(error.message, 500);
  }
}
