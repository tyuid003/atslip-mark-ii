// Duplicate Check Service
// Checks admin backend for existing transactions matching slip amount + time (±2 min)

import type { Env } from '../types';

const DUPCHECK_TIMEOUT_MS = 3000;

interface TransactionItem {
  id: number;
  creditAmount: number;
  bonusAmount: number;
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
    const slipAccNum = String(opts.receiverAccountNumber || '').replace(/[^0-9]/g, '');

    // 1. Resolve full account number from KV banks (slip may have masked/partial number)
    let fullAccNum = slipAccNum;
    try {
      const banksRaw = await env.BANK_KV.get(`tenant:${opts.tenantId}:banks`);
      if (banksRaw) {
        const banksData = JSON.parse(banksRaw);
        const accounts = (banksData.accounts || []) as Array<{ accountNumber?: string; account_number?: string }>;
        for (const acc of accounts) {
          const kvAccNum = String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, '');
          if (!kvAccNum) continue;
          // Exact match
          if (kvAccNum === slipAccNum) { fullAccNum = kvAccNum; break; }
          // Full contains partial (suffix match) - slip often shows last N digits
          if (kvAccNum.endsWith(slipAccNum) && slipAccNum.length >= 4) { fullAccNum = kvAccNum; break; }
          // Chunk match: visible digit groups from masked number must appear in order
          const rawAcc = String(opts.receiverAccountNumber || '');
          const chunks = rawAcc.split(/[^0-9]+/).filter(c => c.length >= 2);
          if (chunks.length > 0) {
            let startAt = 0;
            let allMatch = true;
            for (const chunk of chunks) {
              const idx = kvAccNum.indexOf(chunk, startAt);
              if (idx < 0) { allMatch = false; break; }
              startAt = idx + chunk.length;
            }
            if (allMatch) { fullAccNum = kvAccNum; break; }
          }
        }
      }
    } catch (err: any) {
      log('[DupCheck] Failed to resolve full account number from KV:', err?.message || String(err));
    }

    log('[DupCheck] Account resolution:', { slipAccNum, fullAccNum });

    // 2. Check if dupcheck is enabled for this account
    const dupcheckKey = `dupcheck:${opts.tenantId}:${fullAccNum}`;
    const flag = await env.BANK_KV.get(dupcheckKey);
    if (flag !== '1') {
      log('[DupCheck] Dupcheck NOT enabled for key:', dupcheckKey);
      return { isDuplicate: false, skipped: true, reason: 'dupcheck_disabled' };
    }

    log('[DupCheck] Enabled for account:', fullAccNum, '- checking transactions...');

    // 3. Resolve the admin backend numeric userId
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

    // 4. Get transaction list for the slip date
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

      // 5. Filter deposits and check for matching amount + time ±2 minutes
      const TWO_MINUTES_MS = 2 * 60 * 1000;
      const slipTime = slipDateObj.getTime();
      const slipAmount = Number(opts.amount);

      for (const tx of transactions) {
        // Only check deposits
        if (tx.directionId !== 1 && tx.directionName !== 'DEPOSIT') continue;

        const txAmount = Number(tx.creditAmount || 0) + Number(tx.bonusAmount || 0);
        if (txAmount !== slipAmount) continue;

        const txTime = new Date(tx.transferAt).getTime();
        const timeDiff = Math.abs(txTime - slipTime);

        if (timeDiff <= TWO_MINUTES_MS) {
          log('[DupCheck] ⚠️ DUPLICATE MATCH FOUND:', {
            txId: tx.id,
            txCreditAmount: tx.creditAmount,
            txTotalAmount: txAmount,
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
