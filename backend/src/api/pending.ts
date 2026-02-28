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
      `SELECT id, tenant_id, slip_ref, amount, sender_name, status, created_at
       FROM pending_transactions
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    return successResponse(results.results || []);
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}
