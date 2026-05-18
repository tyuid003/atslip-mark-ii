import { getDB } from '../utils/helpers';

/**
 * GET /api/report-logs?limit=50
 * Query: teamId, tenantId, transactionId (optional)
 */
export async function onRequestGet(context: any) {
  const db = getDB(context);
  const url = new URL(context.request.url);
  const teamId = url.searchParams.get('teamId');
  const tenantId = url.searchParams.get('tenantId');
  const transactionId = url.searchParams.get('transactionId');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const where: string[] = [];
  const params: any[] = [];
  if (teamId) { where.push('rl.team_id = ?'); params.push(teamId); }
  if (tenantId) { where.push('rl.tenant_id = ?'); params.push(tenantId); }
  if (transactionId) { where.push('rl.transaction_id = ?'); params.push(transactionId); }

  const sql = `SELECT rl.id, rl.team_id, rl.tenant_id, rl.tenant_name, rl.transaction_id,
      rl.sender_name, rl.detail, rl.report_types, rl.created_at, rl.metadata,
      t.name AS team_name
    FROM report_logs rl
    LEFT JOIN teams t ON t.id = rl.team_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY rl.created_at DESC
    LIMIT ?`;
  params.push(limit);

  const result = await db.prepare(sql).bind(...params).all();
  const rows = (result.results || []) as any[];

  // Backfill matched_receiver_name_th/en สำหรับรายการเก่าที่ยังไม่ได้ snapshot
  for (const r of rows) {
    let meta: any = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch (_) {}
    const needLookup = !meta.matched_receiver_name_th && !meta.matched_receiver_name_en
      && r.tenant_id && meta.slip_receiver_account;
    if (needLookup) {
      try {
        const raw = String(meta.slip_receiver_account);
        // เก็บเฉพาะตัวเลขกับ x/X แล้วแทน x/X ด้วย wildcard %
        const masked = raw.replace(/[^0-9xX]/g, '');
        const digitsOnly = masked.replace(/[xX]/g, '');
        if (digitsOnly.length >= 4) {
          const likePattern = '%' + masked.replace(/[xX]+/g, '%') + '%';
          const tba = await db
            .prepare(
              `SELECT account_name_th, account_name_en
               FROM tenant_bank_accounts
               WHERE tenant_id = ? AND REPLACE(REPLACE(account_number,'-',''),' ','') LIKE ?
               LIMIT 1`
            )
            .bind(r.tenant_id, likePattern)
            .first<any>();
          if (tba) {
            meta.matched_receiver_name_th = tba.account_name_th ?? null;
            meta.matched_receiver_name_en = tba.account_name_en ?? null;
            r.metadata = JSON.stringify(meta);
          }
        }
      } catch (_) { /* ignore */ }
    }
  }

  return new Response(JSON.stringify({ data: rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * DELETE /api/report-logs/:id
 * ลบรายการรีพอร์ตทิ้ง (เผื่อแก้ปัญหาเรียบร้อยแล้ว)
 */
export async function onRequestDelete(context: any, id: string) {
  const db = getDB(context);
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing report id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  await db.prepare('DELETE FROM report_logs WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
