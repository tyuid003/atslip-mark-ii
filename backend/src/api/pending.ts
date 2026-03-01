import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

export async function handleGetPendingTransactions(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') || '50');
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const results = await env.DB.prepare(
      `SELECT 
        pt.id, pt.tenant_id, pt.slip_ref, pt.amount, pt.sender_name, 
        pt.status, pt.slip_data, pt.matched_user_id, pt.matched_username, 
        pt.created_at,
        t.name as tenant_name
       FROM pending_transactions pt
       LEFT JOIN tenants t ON t.id = pt.tenant_id
       ORDER BY pt.created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    return successResponse(results.results || []);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

export async function handleDeletePendingTransaction(
  env: Env,
  transactionId: string
): Promise<Response> {
  try {
    // ตรวจสอบว่ามีรายการนี้อยู่จริง
    const existing = await env.DB.prepare(
      `SELECT id FROM pending_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first();

    if (!existing) {
      return errorResponse('Transaction not found', 404);
    }

    // ลบรายการ
    await env.DB.prepare(
      `DELETE FROM pending_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .run();

    console.log(`[PendingAPI] Deleted transaction: ${transactionId}`);
    return successResponse({ id: transactionId, deleted: true });
  } catch (error: any) {
    console.error('[PendingAPI] Delete error:', error);
    return errorResponse(error.message, 500);
  }
}
