import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

/**
 * PATCH /api/pending-transactions/:id/match
 * Manually match a pending transaction with a user
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

    // Update matched info (and tenant_id if provided — ใช้เมื่อผู้ใช้เลือก tenant ใหม่ตอนจับคู่ใหม่)
    let result;
    if (body.tenant_id) {
      result = await env.DB.prepare(
        `UPDATE pending_transactions 
         SET matched_user_id = ?, 
             matched_username = ?,
             tenant_id = ?,
             status = 'matched'
         WHERE id = ?`
      )
        .bind(body.matched_user_id, body.matched_username, body.tenant_id, transactionId)
        .run();
    } else {
      result = await env.DB.prepare(
        `UPDATE pending_transactions 
         SET matched_user_id = ?, 
             matched_username = ?,
             status = 'matched'
         WHERE id = ?`
      )
        .bind(body.matched_user_id, body.matched_username, transactionId)
        .run();
    }

    if (!result.success) {
      return errorResponse('Failed to update transaction', 500);
    }

    console.log(`[Manual Match] Transaction ${transactionId} matched to ${body.matched_username} (${body.matched_user_id})` + (body.tenant_id ? ` → tenant ${body.tenant_id}` : ''));

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
            matched_user_id: body.matched_user_id,
            matched_username: body.matched_username,
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
