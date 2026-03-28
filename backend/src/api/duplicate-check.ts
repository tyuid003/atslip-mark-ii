// Duplicate Check API
// GET  /api/duplicate-check/accounts  - list all accounts with dupcheck status
// PATCH /api/duplicate-check/toggle    - toggle dupcheck for a specific account

import type { Env } from '../types';
import { successResponse, errorResponse } from '../utils/helpers';

interface AccountGroup {
  tenant_id: string;
  tenant_name: string;
  accounts: Array<{
    account_number: string;
    account_name: string;
    bank_icon_url: string;
    bank_name: string;
    dupcheck_enabled: boolean;
  }>;
}

export async function handleGetDuplicateCheckAccounts(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const teamSlug = request.headers.get('X-Team-Slug') || 'default';

    // Get team
    const team = await env.DB.prepare(
      `SELECT id FROM teams WHERE slug = ? AND status = 'active' LIMIT 1`
    )
      .bind(teamSlug)
      .first<{ id: string }>();

    if (!team) {
      return errorResponse('Team not found', 404);
    }

    // Get all tenants in this team
    const tenants = await env.DB.prepare(
      `SELECT id, name FROM tenants WHERE team_id = ? AND status = 'active' ORDER BY name`
    )
      .bind(team.id)
      .all<{ id: string; name: string }>();

    const groups: AccountGroup[] = [];

    for (const tenant of tenants.results || []) {
      // Get bank accounts from KV cache (same key as bank-refresh.service.ts)
      const kvKey = `tenant:${tenant.id}:banks`;
      const raw = await env.BANK_KV.get(kvKey);
      if (!raw) continue;

      let accounts: any[] = [];
      try {
        const parsed = JSON.parse(raw);
        accounts = parsed.accounts || [];
      } catch {
        continue;
      }

      if (accounts.length === 0) continue;

      const groupAccounts: AccountGroup['accounts'] = [];
      for (const acc of accounts) {
        const accNum = String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, '');
        if (!accNum) continue;

        // Check KV for dupcheck flag
        const dupcheckKey = `dupcheck:${tenant.id}:${accNum}`;
        const flag = await env.BANK_KV.get(dupcheckKey);

        groupAccounts.push({
          account_number: acc.accountNumber || acc.account_number || '',
          account_name: acc.accountName || acc.account_name || '',
          bank_icon_url: acc.bankIconUrl || acc.bank_icon_url || '',
          bank_name: acc.bankName || acc.bank_name || '',
          dupcheck_enabled: flag === '1',
        });
      }

      if (groupAccounts.length > 0) {
        groups.push({
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          accounts: groupAccounts,
        });
      }
    }

    return successResponse(groups);
  } catch (error: any) {
    return errorResponse(error.message || 'Internal server error', 500);
  }
}

export async function handleToggleDuplicateCheck(
  env: Env,
  request: Request
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      tenant_id: string;
      account_number: string;
      enabled: boolean;
    };

    if (!body.tenant_id || !body.account_number) {
      return errorResponse('tenant_id and account_number are required', 400);
    }

    const accNum = String(body.account_number).replace(/[^0-9]/g, '');
    const dupcheckKey = `dupcheck:${body.tenant_id}:${accNum}`;

    if (body.enabled) {
      await env.BANK_KV.put(dupcheckKey, '1');
    } else {
      await env.BANK_KV.delete(dupcheckKey);
    }

    return successResponse({
      tenant_id: body.tenant_id,
      account_number: body.account_number,
      enabled: !!body.enabled,
    });
  } catch (error: any) {
    return errorResponse(error.message || 'Internal server error', 500);
  }
}
