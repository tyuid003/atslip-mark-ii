import type { Env } from '../types';
import { successResponse, errorResponse, getAdminAuthHeaders } from '../utils/helpers';

/**
 * GET /api/users/search?q=<term>&category=<member|non-member>&tenant_id=<id>
 * Proxy search to Admin API — รองรับ v1 (member/non-member) และ v2 (single endpoint)
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

    // Get tenant info, session token, and api_version
    const tenant = await env.DB.prepare(
      `SELECT t.id, t.admin_api_url, COALESCE(t.api_version, 'v1') as api_version, s.session_token
       FROM tenants t
       LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
       WHERE t.id = ?
       LIMIT 1`
    )
      .bind(Math.floor(Date.now() / 1000), tenantId)
      .first() as any;

    if (!tenant) {
      return errorResponse('Tenant not found', 404);
    }

    const sessionToken = tenant.session_token as string | null;
    if (!sessionToken) {
      return errorResponse('Admin session not found. Please login first.', 401);
    }

    const adminApiUrl = tenant.admin_api_url as string;
    const apiVersion = String(tenant.api_version || 'v1');

    let users: any[] = [];

    if (apiVersion === 'v2') {
      // v2: single endpoint ไม่แยก category
      const searchUrl = `${adminApiUrl}/api/proxy/v1/admin/members?page=1&limit=100&search=${encodeURIComponent(searchTerm)}`;
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, 'v2'),
      });

      if (!response.ok) {
        return errorResponse(`Failed to search users from Admin API (v2): ${response.status}`, 500);
      }

      const data = await response.json() as any;
      const rawList: any[] = data?.data?.list || [];

      // Normalize v2 fields ให้ตรงกับ v1 format ที่ frontend ใช้
      users = rawList.map((u: any) => ({
        ...u,
        fullname: u.fullName || u.fullname || '',
        bankAccount: u.accountNumber || u.bankAccount || '',
        bank_account: u.accountNumber || u.bank_account || '',
        bank: u.bank?.code || u.bank || '',
        category: 'member',
      }));
    } else {
      // v1: แยก member/non-member
      if (category !== 'member' && category !== 'non-member') {
        return errorResponse('Invalid category. Must be "member" or "non-member"', 400);
      }
      const searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(searchTerm)}&userCategory=${category}`;
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: getAdminAuthHeaders(sessionToken, 'v1'),
      });

      if (!response.ok) {
        return errorResponse('Failed to search users from Admin API', 500);
      }

      const data = await response.json() as any;
      users = data.list || [];
    }

    return successResponse({
      users,
      category: apiVersion === 'v2' ? 'member' : category,
      searchTerm,
      count: users.length,
      api_version: apiVersion,
    });
  } catch (error: any) {
    return errorResponse(error.message, 500);
  }
}

/**
 * GET /api/users/gen-membercode?tenant_id=<id>&user_id=<admin_user_id>
 * Generate (or fetch existing) memberCode for a non-member user via Admin API.
 * v2: ไม่ต้อง gen — memberCode มีอยู่แล้ว คืนค่า memberCode จาก user search โดยตรง
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

    // Get tenant and session including api_version
    const row = await env.DB.prepare(
      `SELECT t.admin_api_url, COALESCE(t.api_version, 'v1') as api_version, s.session_token
       FROM tenants t
       LEFT JOIN admin_sessions s ON s.tenant_id = t.id AND s.expires_at > ?
       WHERE t.id = ? AND t.status = 'active'
       LIMIT 1`
    )
      .bind(Math.floor(Date.now() / 1000), tenantId)
      .first() as any;

    if (!row?.admin_api_url) return errorResponse('Tenant not found', 404);
    if (!row?.session_token) return errorResponse('Admin session expired. Please login again.', 401);

    const apiVersion = String(row.api_version || 'v1');

    // v2: ทุก user มี memberCode อยู่แล้ว ค้นหาด้วย userId แล้วคืน memberCode
    if (apiVersion === 'v2') {
      const searchUrl = `${row.admin_api_url}/api/proxy/v1/admin/members?page=1&limit=10&search=${encodeURIComponent(userId)}`;
      const searchResp = await fetch(searchUrl, {
        method: 'GET',
        headers: getAdminAuthHeaders(row.session_token, 'v2'),
      });
      if (!searchResp.ok) {
        return errorResponse(`v2 member search failed: ${searchResp.status}`, 502);
      }
      const searchData = await searchResp.json() as any;
      const list: any[] = searchData?.data?.list || [];
      // หา user ที่ id ตรงกัน
      const found = list.find((u: any) => String(u.id) === String(userId)) || list[0];
      if (!found) {
        return errorResponse(`v2: user id ${userId} not found`, 404);
      }
      return successResponse({
        memberCode: found.memberCode || found.username,
        raw: found,
        api_version: 'v2',
      });
    }

    // v1: เรียก gen-membercode endpoint
    const genUrl = `${row.admin_api_url}/api/admin/gen-membercode/${encodeURIComponent(userId)}`;
    const genResponse = await fetch(genUrl, {
      method: 'GET',
      headers: getAdminAuthHeaders(row.session_token, 'v1'),
    });

    const rawText = await genResponse.text();

    if (!genResponse.ok) {
      return errorResponse(`gen-membercode failed: ${genResponse.status} - ${rawText}`, 502);
    }

    let raw: any = null;
    try { raw = JSON.parse(rawText); } catch { raw = rawText; }

    const memberCode = extractMemberCode(raw);
    if (!memberCode) {
      return errorResponse('gen-membercode returned no memberCode. Raw: ' + rawText, 502);
    }

    return successResponse({ memberCode, raw });
  } catch (error: any) {
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
