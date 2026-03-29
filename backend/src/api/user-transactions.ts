import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

export async function handleUserTransactionsList(
  env: Env,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const userId = url.searchParams.get('user_id');
  const page = url.searchParams.get('page') || '1';
  const limit = url.searchParams.get('limit') || '20';
  const fromDate = url.searchParams.get('from_date');
  const toDate = url.searchParams.get('to_date');

  if (!tenantId) return errorResponse('tenant_id is required', 400);
  if (!userId) return errorResponse('user_id is required', 400);

  const now = Math.floor(Date.now() / 1000);
  const tenant = await env.DB.prepare(
    `SELECT t.id, t.admin_api_url, s.session_token
     FROM tenants t
     LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
     WHERE t.id = ?
     LIMIT 1`
  )
    .bind(now, tenantId)
    .first<{ id: string; admin_api_url: string; session_token: string | null }>();

  if (!tenant) return errorResponse('Tenant not found', 404);
  if (!tenant.session_token) return errorResponse('Admin session not found. Please login first.', 401);

  const params = new URLSearchParams({
    page,
    limit,
    sortCol: 'transfer_at',
    sortAsc: 'desc',
    userId,
  });
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);

  const adminUrl = `${tenant.admin_api_url}/api/user-transactions/list?${params}`;

  try {
    const resp = await fetch(adminUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tenant.session_token}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      return errorResponse(`Admin API returned ${resp.status}`, 502);
    }

    const data = (await resp.json()) as { list?: any[]; total?: number };
    return successResponse({
      transactions: data.list || [],
      total: data.total || 0,
      page: Number(page),
    });
  } catch (err: any) {
    return errorResponse(`Failed to fetch transactions: ${err.message}`, 500);
  }
}
