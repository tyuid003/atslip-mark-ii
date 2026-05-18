import { nanoid } from 'nanoid';
import { getDB } from '../utils/helpers';

/**
 * POST /api/report
 * Body: { transactionId, senderName, detail, reportTypes, teamId, tenantId, tenantName }
 */
export async function onRequestPost(context: any) {
  const db = getDB(context);
  const body = await context.request.json();
  const {
    transactionId,
    senderName,
    detail,
    reportTypes,
    teamId,
    tenantId,
    tenantName
  } = body || {};

  if (!transactionId || !detail || !teamId || !tenantId) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ดึงข้อมูลรายการ + ชื่อทีม/เว็บ (snapshot ไว้เผื่อ pending_transactions ถูกลบ)
  const tx = await db
    .prepare(
      `SELECT pt.slip_data, pt.amount, pt.sender_name, pt.sender_account,
              pt.receiver_name, pt.receiver_account,
              pt.matched_user_id, pt.matched_username,
              pt.status, pt.source,
              pt.created_at AS tx_created_at, pt.updated_at AS tx_updated_at,
              t.name AS team_name,
              tn.name AS tenant_name_db
       FROM pending_transactions pt
       LEFT JOIN teams t ON t.id = pt.team_id
       LEFT JOIN tenants tn ON tn.id = pt.tenant_id
       WHERE pt.id = ?`
    )
    .bind(transactionId)
    .first<any>();

  // ค้นหาชื่อเจ้าของบัญชีปลายทาง (ตามเลขบัญชี) จาก tenant_bank_accounts
  let matchedReceiverNameTh: string | null = null;
  let matchedReceiverNameEn: string | null = null;
  if (tx?.receiver_account) {
    const cleanedAcc = String(tx.receiver_account).replace(/[^0-9]/g, '');
    const tba = await db
      .prepare(
        `SELECT account_name_th, account_name_en
         FROM tenant_bank_accounts
         WHERE tenant_id = ? AND REPLACE(REPLACE(REPLACE(account_number,'-',''),' ',''),'X','') LIKE ?
         LIMIT 1`
      )
      .bind(tenantId, '%' + cleanedAcc.slice(-6) + '%')
      .first<any>();
    matchedReceiverNameTh = tba?.account_name_th ?? null;
    matchedReceiverNameEn = tba?.account_name_en ?? null;
  }

  const metadata = {
    amount: tx?.amount ?? null,
    slip_sender_name: tx?.sender_name ?? null,
    slip_sender_account: tx?.sender_account ?? null,
    slip_receiver_name: tx?.receiver_name ?? null,
    slip_receiver_account: tx?.receiver_account ?? null,
    matched_user_id: tx?.matched_user_id ?? null,
    matched_username: tx?.matched_username ?? null,
    matched_receiver_name_th: matchedReceiverNameTh,
    matched_receiver_name_en: matchedReceiverNameEn,
    status: tx?.status ?? null,
    source: tx?.source ?? null,
    transaction_created_at: tx?.tx_created_at ?? null,
    transaction_updated_at: tx?.tx_updated_at ?? null,
    slip_data: tx?.slip_data ?? null,
    team_name: tx?.team_name ?? null,
  };

  const resolvedTenantName = tenantName || tx?.tenant_name_db || null;

  await db
    .prepare(
      `INSERT INTO report_logs
        (id, team_id, tenant_id, tenant_name, transaction_id, sender_name, detail, report_types, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      teamId,
      tenantId,
      resolvedTenantName,
      transactionId,
      senderName || null,
      detail,
      JSON.stringify(reportTypes || []),
      Math.floor(Date.now() / 1000),
      JSON.stringify(metadata)
    )
    .run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
