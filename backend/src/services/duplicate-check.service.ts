// Duplicate Check Service
// Checks admin backend for existing transactions matching slip amount + time (±2 min)

import type { Env } from '../types';

const DUPCHECK_TIMEOUT_MS = 3000;

interface TransactionItem {
  id: number;
  amount: number;
  transferAt: string;
  directionId: number; // 1 = DEPOSIT
  directionName: string;
}

interface DupCheckResult {
  isDuplicate: boolean;
  matchedTransaction?: TransactionItem;
  skipped?: boolean;
  reason?: string;
}

export class DuplicateCheckService {
  /**
   * Check if a transaction already exists in the admin backend.
   * Returns { isDuplicate: true } if a matching deposit is found with
   * the same amount and transfer time within ±2 minutes of the slip date.
   */
  static async checkBeforeCredit(
    env: Env,
    opts: {
      tenantId: string;
      adminApiUrl: string;
      sessionToken: string;
      receiverAccountNumber: string;
      amount: number;
      slipDate: string; // ISO date string from slip
      matchedUserId: string; // memberCode or username to search
    },
    log: (...args: any[]) => void = console.log
  ): Promise<DupCheckResult> {
    const accNum = String(opts.receiverAccountNumber || '').replace(/[^0-9]/g, '');

    // 1. Check if dupcheck is enabled for this account
    const dupcheckKey = `dupcheck:${opts.tenantId}:${accNum}`;
    const flag = await env.BANK_KV.get(dupcheckKey);
    if (flag !== '1') {
      return { isDuplicate: false, skipped: true, reason: 'dupcheck_disabled' };
    }

    log('[DupCheck] Enabled for account:', accNum, '- checking transactions...');

    // 2. Resolve the admin backend numeric userId
    let userId: number | null = null;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), DUPCHECK_TIMEOUT_MS);

      const searchResp = await fetch(
        `${opts.adminApiUrl}/api/users/list?search=${encodeURIComponent(opts.matchedUserId)}&limit=5`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.sessionToken}`,
          },
          signal: controller.signal,
        }
      );
      clearTimeout(tid);

      if (searchResp.ok) {
        const body = (await searchResp.json()) as { list?: Array<{ id: number; memberCode?: string; username?: string }> };
        const users = body.list || [];
        // Try exact match on memberCode first
        const exact = users.find(
          (u) =>
            u.memberCode === opts.matchedUserId ||
            u.username === opts.matchedUserId ||
            String(u.id) === opts.matchedUserId
        );
        userId = exact?.id ?? users[0]?.id ?? null;
      }
    } catch (err: any) {
      log('[DupCheck] User search failed:', err?.message || String(err));
      return { isDuplicate: false, skipped: true, reason: 'user_search_failed' };
    }

    if (!userId) {
      log('[DupCheck] Could not resolve userId, skipping check');
      return { isDuplicate: false, skipped: true, reason: 'user_not_found' };
    }

    log('[DupCheck] Resolved userId:', userId);

    // 3. Get transaction list for the slip date
    const slipDateObj = new Date(opts.slipDate);
    const dateStr = opts.slipDate.split('T')[0]; // YYYY-MM-DD

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), DUPCHECK_TIMEOUT_MS);

      const txUrl = `${opts.adminApiUrl}/api/user-transactions/list?page=1&limit=20&sortCol=transfer_at&sortAsc=desc&userId=${userId}&fromDate=${dateStr}&toDate=${dateStr}`;

      const txResp = await fetch(txUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.sessionToken}`,
        },
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (!txResp.ok) {
        log('[DupCheck] Transaction list API returned:', txResp.status);
        return { isDuplicate: false, skipped: true, reason: 'tx_api_error' };
      }

      const txBody = (await txResp.json()) as { list?: TransactionItem[] };
      const transactions = txBody.list || [];

      log('[DupCheck] Found', transactions.length, 'transactions for date', dateStr);

      // 4. Filter deposits and check for matching amount + time ±2 minutes
      const TWO_MINUTES_MS = 2 * 60 * 1000;
      const slipTime = slipDateObj.getTime();
      const slipAmount = Number(opts.amount);

      for (const tx of transactions) {
        // Only check deposits
        if (tx.directionId !== 1 && tx.directionName !== 'DEPOSIT') continue;

        const txAmount = Number(tx.amount);
        if (txAmount !== slipAmount) continue;

        const txTime = new Date(tx.transferAt).getTime();
        const timeDiff = Math.abs(txTime - slipTime);

        if (timeDiff <= TWO_MINUTES_MS) {
          log('[DupCheck] ⚠️ MATCH FOUND:', {
            txId: tx.id,
            txAmount,
            txTime: tx.transferAt,
            slipAmount,
            slipTime: opts.slipDate,
            timeDiffSec: Math.round(timeDiff / 1000),
          });
          return { isDuplicate: true, matchedTransaction: tx };
        }
      }

      log('[DupCheck] No matching transaction found - OK to proceed');
      return { isDuplicate: false };
    } catch (err: any) {
      log('[DupCheck] Transaction check failed:', err?.message || String(err));
      return { isDuplicate: false, skipped: true, reason: 'tx_check_failed' };
    }
  }
}
