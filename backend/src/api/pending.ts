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

    const teamSlug = request.headers.get('X-Team-Slug') || 'default';

    let rawItems: any[];
    if (teamSlug && teamSlug !== 'default') {
      // Filter by team: เฉพาะ pending ของ tenant ที่อยู่ใน team นี้
      const results = await env.DB.prepare(
        `SELECT 
          pt.id, pt.tenant_id, pt.slip_ref, pt.amount, pt.sender_name, pt.sender_account,
          pt.receiver_name, pt.receiver_account,
          pt.status,
          json_extract(pt.slip_data, '$.date') as slip_date,
          pt.matched_user_id, pt.matched_username,
          pt.source, pt.scanned_by_id, pt.scanned_by_name,
          pt.created_at,
          t.name as tenant_name
         FROM pending_transactions pt
         LEFT JOIN tenants t ON t.id = pt.tenant_id
         INNER JOIN teams tm ON tm.id = t.team_id AND tm.slug = ?
         ORDER BY pt.created_at DESC
         LIMIT ?`
      ).bind(teamSlug, limit).all();
      rawItems = results.results || [];
    } else {
      // ไม่ระบุ team = ดึงทั้งหมด
      const results = await env.DB.prepare(
        `SELECT 
          pt.id, pt.tenant_id, pt.slip_ref, pt.amount, pt.sender_name, pt.sender_account,
          pt.receiver_name, pt.receiver_account,
          pt.status,
          json_extract(pt.slip_data, '$.date') as slip_date,
          pt.matched_user_id, pt.matched_username,
          pt.source, pt.scanned_by_id, pt.scanned_by_name,
          pt.created_at,
          t.name as tenant_name
         FROM pending_transactions pt
         LEFT JOIN tenants t ON t.id = pt.tenant_id
         ORDER BY pt.created_at DESC
         LIMIT ?`
      ).bind(limit).all();
      rawItems = results.results || [];
    }

    // Batch-fetch full photos from KV (parallel)
    const uniqueIds = [...new Set(rawItems.map((r: any) => r.scanned_by_id).filter(Boolean))] as string[];
    const photoMap: Record<string, string | null> = {};
    if (uniqueIds.length > 0) {
      await Promise.all(
        uniqueIds.map((id) =>
          env.BANK_KV.get(`tg_photo:${id}`)
            .then((p) => { photoMap[id] = p; })
            .catch(() => { photoMap[id] = null; })
        )
      );
    }
    const itemsWithPhotos = rawItems.map((r: any) => ({
      ...r,
      scanned_by_photo: (r.scanned_by_id && photoMap[r.scanned_by_id]) || null,
    }));

    return successResponse(itemsWithPhotos);
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

/**
 * GET /api/pending-transactions/search
 *   ?page=1&limit=50
 *   &tenantId=...
 *   &status=pending|matched|credited|duplicate|failed
 *   &dateFrom=<unix-sec>&dateTo=<unix-sec>
 * Filter ตาม team slug (X-Team-Slug) เสมอ
 * คืน { data, total, page, limit }
 */
export async function handleSearchPendingTransactions(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get('page') || '1'), 1);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '50'), 1), 50);
    const offset = (page - 1) * limit;

    const tenantId = url.searchParams.get('tenantId') || '';
    const status = url.searchParams.get('status') || '';
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');

    const teamSlug = request.headers.get('X-Team-Slug') || 'default';

    const where: string[] = [];
    const params: any[] = [];

    // Always scope by team (เว้น default)
    let fromClause = `FROM pending_transactions pt
       LEFT JOIN tenants t ON t.id = pt.tenant_id`;
    if (teamSlug && teamSlug !== 'default') {
      fromClause += ` INNER JOIN teams tm ON tm.id = t.team_id AND tm.slug = ?`;
      params.push(teamSlug);
    }
    if (tenantId) { where.push('pt.tenant_id = ?'); params.push(tenantId); }
    if (status) { where.push('pt.status = ?'); params.push(status); }
    if (dateFrom) { where.push('pt.created_at >= ?'); params.push(Number(dateFrom)); }
    if (dateTo) { where.push('pt.created_at <= ?'); params.push(Number(dateTo)); }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    // Count total
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total ${fromClause} ${whereSql}`
    ).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    // Fetch page — ดึง scanned_by_id เพื่อ lookup ภาพเต็มจาก KV (ไม่เก็บ photo ใน result ตรงๆ)
    const rows = await env.DB.prepare(
      `SELECT 
        pt.id, pt.tenant_id, pt.slip_ref, pt.amount, pt.sender_name, pt.sender_account,
        pt.receiver_name, pt.receiver_account,
        pt.status,
        json_extract(pt.slip_data, '$.date') as slip_date,
        pt.matched_user_id, pt.matched_username,
        pt.source, pt.scanned_by_id, pt.scanned_by_name,
        pt.created_at,
        t.name as tenant_name
       ${fromClause}
       ${whereSql}
       ORDER BY pt.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();

    const items = rows.results || [];

    // Batch-fetch full photos from KV using scanned_by_id (parallel — no truncation issues)
    const uniqueIds = [...new Set(
      items.map((r: any) => r.scanned_by_id).filter(Boolean)
    )] as string[];
    const photoMap: Record<string, string | null> = {};
    if (uniqueIds.length > 0) {
      await Promise.all(
        uniqueIds.map((id) =>
          env.BANK_KV.get(`tg_photo:${id}`)
            .then((p) => { photoMap[id] = p; })
            .catch(() => { photoMap[id] = null; })
        )
      );
    }
    const itemsWithPhotos = items.map((r: any) => ({
      ...r,
      scanned_by_photo: (r.scanned_by_id && photoMap[r.scanned_by_id]) || null,
    }));

    return successResponse({
      data: itemsWithPhotos,
      total,
      page,
      limit,
    });
  } catch (error: any) {
    console.error('[PendingAPI] Search error:', error);
    return errorResponse(error.message, 500);
  }
}
