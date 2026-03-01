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

    // Update matched info and status
    const result = await env.DB.prepare(
      `UPDATE pending_transactions 
       SET matched_user_id = ?, 
           matched_username = ?,
           status = 'matched'
       WHERE id = ?`
    )
      .bind(body.matched_user_id, body.matched_username, transactionId)
      .run();

    if (!result.success) {
      return errorResponse('Failed to update transaction', 500);
    }

    console.log(`[Manual Match] Transaction ${transactionId} matched to ${body.matched_username} (${body.matched_user_id})`);

    // Return updated transaction
    const updated = await env.DB.prepare(
      `SELECT id, tenant_id, slip_ref, amount, sender_name, status, slip_data,
              matched_user_id, matched_username, created_at
       FROM pending_transactions
       WHERE id = ?`
    )
      .bind(transactionId)
      .first();

    return successResponse({
      message: 'Transaction matched successfully',
      transaction: updated
    });
  } catch (error: any) {
    console.error('[Manual Match] Error:', error);
    return errorResponse(error.message, 500);
  }
}
