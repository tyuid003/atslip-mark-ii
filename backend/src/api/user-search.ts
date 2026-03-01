import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

/**
 * GET /api/users/search?q=<term>&category=<member|non-member>&tenant_id=<id>
 * Proxy search to Admin API
 */
export async function handleUserSearch(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const searchTerm = url.searchParams.get('q');
    const category = url.searchParams.get('category') || 'member';
    const tenantId = url.searchParams.get('tenant_id');

    if (!searchTerm || searchTerm.trim().length === 0) {
      return errorResponse('Search term is required', 400);
    }

    if (!tenantId) {
      return errorResponse('tenant_id parameter is required', 400);
    }

    if (category !== 'member' && category !== 'non-member') {
      return errorResponse('Invalid category. Must be "member" or "non-member"', 400);
    }

    // Get tenant info by ID
    const tenant = await env.DB.prepare(
      `SELECT id, admin_api_url FROM tenants WHERE id = ?`
    )
      .bind(tenantId)
      .first<{ id: string; admin_api_url: string }>();

    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    // Get session token from KV
    const sessionData = await env.BANK_KV.get(`session:${tenant.id}`, { type: 'json' });
    if (!sessionData || !sessionData.token) {
      return errorResponse('Admin session not found. Please login first.', 401);
    }

    // Call Admin API
    const adminApiUrl = tenant.admin_api_url;
    const searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(searchTerm)}&userCategory=${category}`;

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sessionData.token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[User Search] Admin API error: ${response.status}`);
      return errorResponse('Failed to search users from Admin API', 500);
    }

    const data = await response.json() as any;
    const users = data.list || [];

    console.log(`[User Search] Found ${users.length} users for term "${searchTerm}" (${category})`);

    return successResponse({
      users,
      category,
      searchTerm,
      count: users.length
    });
  } catch (error: any) {
    console.error('[User Search] Error:', error);
    return errorResponse(error.message, 500);
  }
}
