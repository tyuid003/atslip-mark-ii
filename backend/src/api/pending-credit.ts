import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';
import { CreditService } from '../services/credit.service';

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

  // 1) API จริงตาม contract
  try {
    const tenant = await env.DB.prepare(
      `SELECT admin_api_url FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`
    )
      .bind(tenantId)
      .first<{ admin_api_url: string }>();

    if (tenant?.admin_api_url) {
      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
      )
        .bind(tenantId, Math.floor(Date.now() / 1000))
        .first<{ session_token: string }>();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.session_token) {
        headers.Authorization = `Bearer ${session.session_token}`;
      }

      const response = await fetch(`${tenant.admin_api_url}/api/accounting/bankaccounts/list?limit=100`, {
        method: 'GET',
        headers,
      });

      if (response.ok) {
        const data = await response.json() as { list?: BankAccountListItem[] };
        const list = data.list || [];
        const candidates = list
          .map((acc) => ({
            id: Number(acc.id),
            accountNumber: normalizeAccount(acc.accountNumber || acc.account_number || ''),
          }))
          .filter((acc) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

        const resolvedFromApi = pickAccountIdFromCandidates(receiver, candidates);
        if (resolvedFromApi) {
          return resolvedFromApi;
        }
      }
    }
  } catch {
    // fallback KV below
  }

  const accountListKey = `tenant:${tenantId}:bank-accounts-list`;
  const bankAccountsData = await env.BANK_KV.get(accountListKey);
  if (!bankAccountsData) {
    return null;
  }

  const cache = JSON.parse(bankAccountsData) as { accounts?: BankAccountListItem[] };
  const kvAccounts = cache.accounts || [];

  if (kvAccounts.length === 0) {
    return null;
  }

  const candidates = kvAccounts
    .map((acc) => ({
      id: Number(acc.id),
      accountNumber: normalizeAccount(acc.accountNumber || acc.account_number || ''),
    }))
    .filter((acc) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

  return pickAccountIdFromCandidates(receiver, candidates);
}

export async function handleCreditPendingTransaction(
  env: Env,
  transactionId: string,
  request: Request
): Promise<Response> {
  try {
    await request.text().catch(() => '');

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
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        newStatus,
        creditResult.resolvedMemberCode || null,
        creditResult.resolvedUsername || null,
        now,
        transactionId
      )
      .run();

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
       SET status = ?, error_message = NULL, updated_at = ?
       WHERE id = ?`
    )
      .bind(rollbackStatus, now, transactionId)
      .run();

    return successResponse({
      id: transactionId,
      status: rollbackStatus,
      message: withdrawResult.message || 'Withdraw success',
    });
  } catch (error: any) {
    return errorResponse(error.message || 'Internal server error', 500);
  }
}
