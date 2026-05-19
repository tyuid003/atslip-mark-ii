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

    // Get tenant info and session token
    const tenant = await env.DB.prepare(
      `SELECT t.id, t.admin_api_url, s.session_token
       FROM tenants t
       LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
       WHERE t.id = ?
       LIMIT 1`
    )
      .bind(Math.floor(Date.now() / 1000), tenantId)
      .first();

    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    // Check session token
    const sessionToken = tenant.session_token as string | null;
    if (!sessionToken) {
      return errorResponse('Admin session not found. Please login first.', 401);
    }

    // Call Admin API
    const adminApiUrl = tenant.admin_api_url as string;
    const searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(searchTerm)}&userCategory=${category}`;

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
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

/**
 * GET /api/users/gen-membercode?tenant_id=<id>&user_id=<admin_user_id>
 * Generate (or fetch existing) memberCode for a non-member user via Admin API.
 * Returns { memberCode, fullname, username } so the frontend can use it immediately.
 */
export async function handleGenMemberCode(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id');
    const userId = url.searchParams.get('user_id');

    if (!tenantId) return errorResponse('tenant_id is required', 400);
    if (!userId) return errorResponse('user_id is required', 400);

    // Get tenant and session
    const row = await env.DB.prepare(
      `SELECT t.admin_api_url, s.session_token
       FROM tenants t
       LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
       WHERE t.id = ? AND t.status = 'active'
       LIMIT 1`
    )
      .bind(Math.floor(Date.now() / 1000), tenantId)
      .first<{ admin_api_url: string; session_token: string }>();

    if (!row?.admin_api_url) return errorResponse('Tenant not found', 404);
    if (!row?.session_token) return errorResponse('Admin session expired. Please login again.', 401);

    const genUrl = `${row.admin_api_url}/api/admin/gen-membercode/${encodeURIComponent(userId)}`;
    console.log('[GenMemberCode] Calling:', genUrl);

    const genResponse = await fetch(genUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${row.session_token}`,
        'Accept': 'application/json',
      },
    });

    const rawText = await genResponse.text();
    console.log('[GenMemberCode] Raw response status:', genResponse.status, 'body:', rawText);

    if (!genResponse.ok) {
      return errorResponse(`gen-membercode failed: ${genResponse.status} - ${rawText}`, 502);
    }

    let raw: any = null;
    try { raw = JSON.parse(rawText); } catch { raw = rawText; }

    // Extract memberCode from any known response shape
    const memberCode = extractMemberCode(raw);
    if (!memberCode) {
      console.error('[GenMemberCode] Cannot extract memberCode from:', rawText);
      return errorResponse('gen-membercode returned no memberCode. Raw: ' + rawText, 502);
    }

    console.log('[GenMemberCode] ✅ memberCode:', memberCode);
    return successResponse({ memberCode, raw });
  } catch (error: any) {
    console.error('[GenMemberCode] Error:', error);
    return errorResponse(error.message, 500);
  }
}

function extractMemberCode(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const candidates = [
    raw.memberCode,
    raw.member_code,
    raw.username,
    raw.user,
    raw.data?.memberCode,
    raw.data?.member_code,
    raw.data?.username,
    raw.data?.user,
    raw.result,
    raw.value,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
