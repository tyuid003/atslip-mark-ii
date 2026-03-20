import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

function extractGeneratedMemberCode(raw: any): string {
  if (!raw) {
    return '';
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }

  const candidates = [
    raw.memberCode,
    raw.member_code,
    raw.username,
    raw.user,
    raw.data?.memberCode,
    raw.data?.member_code,
    raw.data?.username,
    raw.data?.user,
    raw.data?.new_memberCode,
    raw.new_memberCode,
    raw.result,
    raw.value,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

async function searchUserByKeyword(
  adminApiUrl: string,
  sessionToken: string,
  keyword: string
): Promise<any | null> {
  const categories = ['member', 'non-member'];

  for (const category of categories) {
    const searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=50&search=${encodeURIComponent(keyword)}&userCategory=${category}`;
    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        continue;
      }

      const body = await response.json() as any;
      const users = body.list || [];
      if (users.length === 0) {
        continue;
      }

      const key = String(keyword || '').trim();
      const exact = users.find((user: any) => {
        const memberCode = String(user.memberCode || '').trim();
        const username = String(user.username || '').trim();
        const userId = String(user.id || '').trim();
        return memberCode === key || username === key || userId === key;
      });

      if (exact) {
        return exact;
      }

      continue;
    } catch {
      continue;
    }
  }

  return null;
}

async function generateMemberCode(
  adminApiUrl: string,
  sessionToken: string,
  userId: string
): Promise<string> {
  const url = `${adminApiUrl}/api/admin/gen-membercode/${encodeURIComponent(userId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return '';
  }

  const body = await response.json().catch(() => null);
  return extractGeneratedMemberCode(body);
}

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

    console.log('[Manual Match] Request received:', { transactionId, userId: body.matched_user_id, userName: body.matched_username, tenantId: body.tenant_id });

    // Check if transaction exists
    const existing = await env.DB.prepare(
      `SELECT id, status, tenant_id FROM pending_transactions WHERE id = ?`
    )
      .bind(transactionId)
      .first<{ id: string; status: string; tenant_id: string }>();

    if (!existing) {
      return errorResponse('Transaction not found', 404);
    }

    console.log('[Manual Match] Transaction found:', { id: existing.id, currentTenantId: existing.tenant_id });

    // ✅ Validate user exists before matching
    const tenantId = body.tenant_id || existing.tenant_id;
    const tenant = await env.DB.prepare(
      `SELECT id, admin_api_url FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
    )
      .bind(tenantId)
      .first<{ id: string; admin_api_url: string }>();

    if (!tenant) {
      console.log('[Manual Match] ❌ Tenant not found:', tenantId);
      return errorResponse('Tenant not found', 404);
    }

    // Get active session for this tenant
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare(
      `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
    )
      .bind(tenantId, now)
      .first<{ session_token: string }>();

    if (!session) {
      console.log('[Manual Match] ⚠️ No active session for tenant:', tenantId);
      return errorResponse('Session not active. Please login first.', 401);
    }

    // ✅ Resolve user and ensure matched_user_id is memberCode
    console.log('[Manual Match] 🔍 Validating user:', { userId: body.matched_user_id, userName: body.matched_username });
    const resolvedUser = await searchUserByKeyword(
      tenant.admin_api_url,
      session.session_token,
      body.matched_user_id
    );

    let resolvedMemberCode = '';
    let resolvedUsername = body.matched_username;

    if (!resolvedUser) {
      const sourceUserId = String(body.matched_user_id || '').trim();
      if (!sourceUserId) {
        return errorResponse('Cannot generate memberCode: user id is missing', 400);
      }

      console.log('[Manual Match] ⚠️ User lookup miss, trying generate directly from selected id:', sourceUserId);
      resolvedMemberCode = await generateMemberCode(tenant.admin_api_url, session.session_token, sourceUserId);
      if (!resolvedMemberCode) {
        console.log('[Manual Match] ❌ User not found in system and generate failed:', sourceUserId);
        return errorResponse(`ผู้ใช้ "${body.matched_username}" (${body.matched_user_id}) ไม่พบในระบบ - กรุณาสร้างยูสเซอร์ใหม่`, 404);
      }

      console.log('[Manual Match] ✅ Generated memberCode from selected id:', { sourceUserId, memberCode: resolvedMemberCode });
    } else {
      resolvedMemberCode = String(resolvedUser.memberCode || '').trim();
      if (!resolvedMemberCode) {
        const sourceUserId = String(resolvedUser.id || body.matched_user_id || '').trim();
        if (!sourceUserId) {
          return errorResponse('Cannot generate memberCode: user id is missing', 400);
        }

        console.log('[Manual Match] 🧾 memberCode missing, generating from user id:', sourceUserId);
        resolvedMemberCode = await generateMemberCode(tenant.admin_api_url, session.session_token, sourceUserId);
        if (!resolvedMemberCode) {
          return errorResponse('ไม่สามารถสร้าง memberCode อัตโนมัติได้', 500);
        }
      }

      resolvedUsername = String(
        resolvedUser.fullname || resolvedUser.username || body.matched_username || ''
      ).trim() || body.matched_username;
    }

    console.log('[Manual Match] ✅ User resolved:', {
      sourceUserId: resolvedUser?.id || body.matched_user_id,
      memberCode: resolvedMemberCode,
      username: resolvedUsername,
    });

    // Update matched info, status, and optionally tenant_id if different
    let updateQuery = `UPDATE pending_transactions 
       SET matched_user_id = ?, 
           matched_username = ?,
           status = 'matched'`;
    
    const bindings: any[] = [resolvedMemberCode, resolvedUsername];
    
    // If tenant_id is provided and different from existing, update it
    if (body.tenant_id && body.tenant_id !== existing.tenant_id) {
      updateQuery += `, tenant_id = ?`;
      bindings.push(body.tenant_id);
      console.log(`[Manual Match] Updating tenant_id from ${existing.tenant_id} to ${body.tenant_id}`);
    }
    
    updateQuery += ` WHERE id = ?`;
    bindings.push(transactionId);
    
    const result = await env.DB.prepare(updateQuery)
      .bind(...bindings)
      .run();

    if (!result.success) {
      return errorResponse('Failed to update transaction', 500);
    }

    console.log(`[Manual Match] Transaction ${transactionId} matched to ${resolvedUsername} (${resolvedMemberCode})`);

    // Return updated transaction
    const updated = await env.DB.prepare(
      `SELECT p.id, p.team_id, tm.slug AS team_slug, p.tenant_id, t.name AS tenant_name,
              p.slip_ref, p.amount, p.sender_name, p.receiver_name, p.status, p.slip_data,
              p.matched_user_id, p.matched_username, p.created_at, p.updated_at
       FROM pending_transactions
       p
       LEFT JOIN tenants t ON t.id = p.tenant_id
       LEFT JOIN teams tm ON tm.id = p.team_id
       WHERE p.id = ?`
    )
      .bind(transactionId)
      .first();

    // Broadcast realtime update so all clients refresh pending card fields (including tenant name)
    try {
      const nowTs = Math.floor(Date.now() / 1000);
      const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
      const doStub = env.PENDING_NOTIFICATIONS.get(doId);

      const broadcastPayload = {
        type: 'transaction_updated',
        data: {
          id: updated?.id || transactionId,
          team_id: (updated as any)?.team_id || null,
          team_slug: (updated as any)?.team_slug || null,
          tenant_id: (updated as any)?.tenant_id || tenantId,
          tenant_name: (updated as any)?.tenant_name || null,
          status: (updated as any)?.status || 'matched',
          matched_user_id: (updated as any)?.matched_user_id || resolvedMemberCode,
          matched_username: (updated as any)?.matched_username || resolvedUsername,
          receiver_name: (updated as any)?.receiver_name || null,
          updated_at: (updated as any)?.updated_at || nowTs,
          message: 'manual_rematch',
        },
      };

      const broadcastResponse = await doStub.fetch('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(broadcastPayload),
      });

      if (!broadcastResponse.ok) {
        const responseBody = await broadcastResponse.text();
        console.error('[Manual Match] ⚠️ Broadcast failed:', broadcastResponse.status, responseBody);
      } else {
        const broadcastResult = await broadcastResponse.json();
        console.log('[Manual Match] ✅ Broadcasted transaction_updated:', broadcastResult);
      }
    } catch (broadcastError) {
      console.error('[Manual Match] ⚠️ Broadcast exception:', {
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      });
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
