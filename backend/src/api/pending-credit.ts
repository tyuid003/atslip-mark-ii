import type { Env } from '../types';
import { successResponse, errorResponse, getAdminAuthHeaders } from '../utils/helpers';
import { CreditService } from '../services/credit.service';
import { AntidupSettingsAPI } from './antidup-settings';

function normalizeAccount(value: string | null | undefined): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

interface BankAccountListItem {
  id: number;
  accountNumber?: string;
  account_number?: string;
}

function pickAccountIdFromCandidates(
  receiverAccount: string,
  candidates: Array<{ id: number; accountNumber: string }>
): number | null {
  const rawReceiver = String(receiverAccount || '');
  const normalizedReceiver = normalizeAccount(receiverAccount);

  if (!normalizedReceiver || candidates.length === 0) {
    return null;
  }

  const exact = candidates.find((acc) => acc.accountNumber === normalizedReceiver);
  if (exact && Number.isFinite(exact.id) && exact.id > 0) {
    return exact.id;
  }

  const visibleChunks = rawReceiver
    .split(/[^0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  if (visibleChunks.length > 0) {
    const chunkMatched = candidates.find((acc) => {
      let startAt = 0;
      for (const chunk of visibleChunks) {
        const idx = acc.accountNumber.indexOf(chunk, startAt);
        if (idx < 0) return false;
        startAt = idx + chunk.length;
      }
      return true;
    });

    if (chunkMatched && Number.isFinite(chunkMatched.id) && chunkMatched.id > 0) {
      return chunkMatched.id;
    }
  }

  for (const length of [6, 5, 4]) {
    const suffix = normalizedReceiver.slice(-length);
    if (suffix.length < 4) continue;
    const suffixMatched = candidates.find((acc) => acc.accountNumber.endsWith(suffix));
    if (suffixMatched && Number.isFinite(suffixMatched.id) && suffixMatched.id > 0) {
      return suffixMatched.id;
    }
  }

  return null;
}

async function resolveToAccountId(
  env: Env,
  tenantId: string,
  receiverAccount?: string | null
): Promise<number | null> {
  const receiver = String(receiverAccount || '');

  // 1) KV cache (bank-refresh saves here as tenant:${id}:banks)
  const bankKey = `tenant:${tenantId}:banks`;
  const bankAccountsData = await env.BANK_KV.get(bankKey);
  if (bankAccountsData) {
    const cache = JSON.parse(bankAccountsData) as { accounts?: any[]; api_version?: string };
    const kvAccounts = cache.accounts || [];
    if (kvAccounts.length > 0) {
      const candidates = kvAccounts
        .map((acc: any) => ({
          id: Number(acc.id),
          // v2 has accountNumber at top level; v1 has accountNumber/account_number
          accountNumber: normalizeAccount(acc.accountNumber || acc.account_number || ''),
        }))
        .filter((acc: any) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

      const fromKv = pickAccountIdFromCandidates(receiver, candidates);
      if (fromKv) return fromKv;
    }
  }

  // 2) API fallback (v1/v2 aware)
  try {
    const tenant = await env.DB.prepare(
      `SELECT admin_api_url, COALESCE(api_version, 'v1') as api_version FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
    )
      .bind(tenantId)
      .first<{ admin_api_url: string; api_version: string }>();

    if (tenant?.admin_api_url) {
      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
      )
        .bind(tenantId, Math.floor(Date.now() / 1000))
        .first<{ session_token: string }>();

      if (session?.session_token) {
        const apiVersion = tenant.api_version || 'v1';
        const accountsUrl = apiVersion === 'v2'
          ? `${tenant.admin_api_url}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
          : `${tenant.admin_api_url}/api/accounting/bankaccounts/list?limit=100`;

        const response = await fetch(accountsUrl, {
          method: 'GET',
          headers: getAdminAuthHeaders(session.session_token, apiVersion),
        });

        if (response.ok) {
          const data = await response.json() as any;
          // v1: data.list | v2: data.data.list
          const list: any[] = apiVersion === 'v2' ? (data?.data?.list || []) : (data?.list || []);
          const candidates = list
            .map((acc: any) => ({
              id: Number(acc.id),
              accountNumber: normalizeAccount(acc.accountNumber || acc.account_number || ''),
            }))
            .filter((acc: any) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

          const fromApi = pickAccountIdFromCandidates(receiver, candidates);
          if (fromApi) return fromApi;
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function handleCreditPendingTransaction(
  env: Env,
  transactionId: string,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as Record<string, any>)) as Record<string, any>;

    const scannedById   = body.scanned_by_id   ? String(body.scanned_by_id).substring(0, 64)   : null;
    const scannedByName = body.scanned_by_name ? String(body.scanned_by_name).substring(0, 255) : null;
    const scannedByPhoto = body.scanned_by_photo ? String(body.scanned_by_photo).substring(0, 32768) : null;

    const transaction = await env.DB.prepare(
      `SELECT id, tenant_id, slip_ref, amount, sender_account, receiver_account, slip_data,
              matched_user_id, matched_username, status
       FROM pending_transactions
       WHERE id = ?
       LIMIT 1`
    )
      .bind(transactionId)
      .first<any>();

    if (!transaction) {
      return errorResponse('Transaction not found', 404);
    }

    if (!transaction.matched_user_id) {
      return errorResponse('Transaction is not matched to any user', 400);
    }

    if (transaction.status === 'credited') {
      return errorResponse('Transaction already credited', 409);
    }

    if (transaction.status === 'duplicate') {
      return errorResponse('Transaction is duplicate and cannot be credited manually', 409);
    }

    // บังคับใช้ resolver เดียวกับ auto flow (ห้าม override toAccountId จาก client)
    const resolvedToAccountId = await resolveToAccountId(env, transaction.tenant_id, transaction.receiver_account);

    if (!resolvedToAccountId || !Number.isFinite(resolvedToAccountId)) {
      return errorResponse('Cannot resolve destination account (toAccountId)', 400);
    }

    const slip = transaction.slip_data ? JSON.parse(transaction.slip_data) : null;
    const slipData = slip || {
      amount: { amount: Number(transaction.amount || 0) },
      transRef: transaction.slip_ref,
      date: new Date().toISOString(),
    };

    // ── Anti-Dup check (v1 เท่านั้น — v2 เช็คใน submitCreditV2 อยู่แล้ว) ──
    // เส้น manual credit เดิม "ไม่ได้" เช็ค Anti-Dup ทำให้เติมซ้ำได้แม้เปิดตรวจสอบรายการซ้ำ
    try {
      const tenantRow = await env.DB.prepare(
        `SELECT admin_api_url, COALESCE(api_version, 'v1') as api_version, team_id
         FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
      )
        .bind(transaction.tenant_id)
        .first<{ admin_api_url: string; api_version: string; team_id: string }>();

      const isV1 = tenantRow && String(tenantRow.api_version || 'v1') !== 'v2';
      if (isV1 && tenantRow?.team_id) {
        const antidupEnabled = await AntidupSettingsAPI.isEnabled(
          env, tenantRow.team_id, resolvedToAccountId
        );
        if (antidupEnabled) {
          const sessionRow = await env.DB.prepare(
            `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
          )
            .bind(transaction.tenant_id, Math.floor(Date.now() / 1000))
            .first<{ session_token: string }>();

          if (sessionRow?.session_token) {
            const slipAmount = Number(slipData?.amount?.amount ?? transaction.amount ?? 0);
            const slipDate = String(slipData?.date || new Date().toISOString());
            const dup = await CreditService.checkManualDuplicateV1(
              tenantRow.admin_api_url,
              sessionRow.session_token,
              String(transaction.matched_user_id),
              slipAmount,
              slipDate,
              60 * 1000,
              console.log
            );
            if (dup.isDuplicate) {
              const nowDup = Math.floor(Date.now() / 1000);
              await env.DB.prepare(
                `UPDATE pending_transactions SET status = 'duplicate', updated_at = ? WHERE id = ?`
              ).bind(nowDup, transactionId).run();
              return errorResponse('พบรายการฝากซ้ำในระบบ (Anti-Dup) — ไม่เติมเครดิตซ้ำ', 409);
            }
          }
        }
      }
    } catch (antidupErr: any) {
      console.warn('[PendingCredit] Anti-dup check error (non-blocking):', antidupErr?.message || antidupErr);
    }

    const creditResult = await CreditService.submitCredit(
      env,
      {
        tenantId: transaction.tenant_id,
        slipData,
        user: {
          id: transaction.matched_user_id,
          memberCode: transaction.matched_user_id,
          fullname: transaction.matched_username,
          bankAccount: transaction.sender_account || '',
        },
        toAccountId: resolvedToAccountId,
      },
      console.log
    );

    const now = Math.floor(Date.now() / 1000);

    if (!creditResult.success) {
      await env.DB.prepare(
        `UPDATE pending_transactions
         SET status = 'failed', error_message = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(creditResult.message || 'Credit failed', now, transactionId)
        .run();

      return errorResponse(creditResult.message || 'Credit failed', 500);
    }

    const newStatus = creditResult.isDuplicate ? 'duplicate' : 'credited';

    await env.DB.prepare(
      `UPDATE pending_transactions
       SET status = ?, error_message = NULL,
           matched_user_id = COALESCE(?, matched_user_id),
           matched_username = COALESCE(?, matched_username),
           scanned_by_id = COALESCE(?, scanned_by_id),
           scanned_by_name = COALESCE(?, scanned_by_name),
           scanned_by_photo = COALESCE(?, scanned_by_photo),
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        newStatus,
        creditResult.resolvedMemberCode || null,
        creditResult.resolvedUsername || null,
        scannedById, scannedByName, scannedByPhoto,
        now,
        transactionId
      )
      .run();

    // 🔔 Broadcast realtime notification for credit completion
    try {
      const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
      const doStub = env.PENDING_NOTIFICATIONS.get(doId);

      const broadcastPayload = {
        type: 'transaction_updated',
        data: {
          id: transactionId,
          status: newStatus,
          matched_user_id: creditResult.resolvedMemberCode || null,
          matched_username: creditResult.resolvedUsername || null,
          scanned_by_id: scannedById,
          scanned_by_name: scannedByName,
          scanned_by_photo: scannedByPhoto,
          message: creditResult.message || (newStatus === 'credited' ? 'เติมเครดิตสำเร็จ' : 'ซ้ำ'),
          updated_at: now,
        },
      };

      console.log('[PendingCredit] 📡 Broadcasting credit update:', JSON.stringify(broadcastPayload).substring(0, 200));

      const broadcastResponse = await doStub.fetch('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(broadcastPayload),
      });

      const broadcastResult = await broadcastResponse.json();
      console.log('[PendingCredit] ✅ Credit update broadcasted:', broadcastResult);
    } catch (broadcastError) {
      console.log('[PendingCredit] ⚠️ Failed to broadcast credit update:', broadcastError instanceof Error ? broadcastError.message : String(broadcastError));
    }

    return successResponse({
      id: transactionId,
      status: newStatus,
      toAccountId: resolvedToAccountId,
      duplicate: !!creditResult.isDuplicate,
      message: creditResult.message || 'Credit submitted',
    });
  } catch (error: any) {
    return errorResponse(error.message || 'Internal server error', 500);
  }
}

export async function handleWithdrawPendingCredit(
  env: Env,
  transactionId: string,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as Record<string, any>)) as Record<string, any>;

    const withdrawScannedById   = body.scanned_by_id   ? String(body.scanned_by_id).substring(0, 64)   : null;
    const withdrawScannedByName = body.scanned_by_name ? String(body.scanned_by_name).substring(0, 255) : null;
    const withdrawScannedByPhoto = body.scanned_by_photo ? String(body.scanned_by_photo).substring(0, 32768) : null;

    const transaction = await env.DB.prepare(
      `SELECT id, tenant_id, amount, matched_user_id, matched_username, status
       FROM pending_transactions
       WHERE id = ?
       LIMIT 1`
    )
      .bind(transactionId)
      .first<any>();

    if (!transaction) {
      return errorResponse('Transaction not found', 404);
    }

    if (!transaction.matched_user_id) {
      return errorResponse('Transaction has no matched memberCode', 400);
    }

    const withdrawResult = await CreditService.withdrawCreditBack(
      env,
      {
        tenantId: transaction.tenant_id,
        amount: Number(transaction.amount || 0),
        memberCode: String(transaction.matched_user_id),
        remark: String(body?.remark || 'Manual withdraw from pending list'),
      },
      console.log
    );

    if (!withdrawResult.success) {
      return errorResponse(withdrawResult.message || 'Withdraw failed', 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const rollbackStatus = transaction.matched_user_id ? 'matched' : 'pending';

    await env.DB.prepare(
      `UPDATE pending_transactions
       SET status = ?, error_message = NULL,
           scanned_by_id = COALESCE(?, scanned_by_id),
           scanned_by_name = COALESCE(?, scanned_by_name),
           scanned_by_photo = COALESCE(?, scanned_by_photo),
           updated_at = ?
       WHERE id = ?`
    )
      .bind(rollbackStatus, withdrawScannedById, withdrawScannedByName, withdrawScannedByPhoto, now, transactionId)
      .run();

    // 🔔 Broadcast realtime for withdraw
    try {
      const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
      const doStub = env.PENDING_NOTIFICATIONS.get(doId);
      await doStub.fetch('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transaction_updated',
          data: {
            id: transactionId,
            status: rollbackStatus,
            scanned_by_id: withdrawScannedById,
            scanned_by_name: withdrawScannedByName,
            scanned_by_photo: withdrawScannedByPhoto,
            message: 'ดึงเครดิตกลับสำเร็จ',
            updated_at: now,
          },
        }),
      });
    } catch (_) {}

    return successResponse({
      id: transactionId,
      status: rollbackStatus,
      message: withdrawResult.message || 'Withdraw success',
    });
  } catch (error: any) {
    return errorResponse(error.message || 'Internal server error', 500);
  }
}
