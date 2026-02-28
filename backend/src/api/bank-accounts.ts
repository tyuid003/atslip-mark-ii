// Bank Accounts Management API
// สำหรับจัดการข้อมูล metadata ของบัญชีธนาคาร

import { jsonResponse, errorResponse, successResponse } from '../utils/helpers';
import type { Env } from '../types';

export const BankAccountsAPI = {
  /**
   * POST /api/tenants/:id/bank-accounts/sync
   * Sync bank accounts จาก KV ไปยัง D1 (สร้าง metadata records)
   */
  async handleSyncBankAccounts(env: Env, tenantId: string): Promise<Response> {
    try {
      // ดึงข้อมูล tenant
      const tenant = await env.DB.prepare(
        'SELECT id, team_id FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const teamId = tenant.team_id as string;

      // ดึงบัญชีจาก KV
      const bankKey = `tenant:${tenantId}:banks`;
      const bankData = await env.BANK_KV.get(bankKey);

      if (!bankData) {
        return errorResponse('No bank accounts found in cache', 404);
      }

      const cache = JSON.parse(bankData);
      const accounts = cache.accounts || [];
      const now = Math.floor(Date.now() / 1000);

      let syncedCount = 0;
      let skippedCount = 0;

      // Loop แต่ละบัญชีและ insert/update ใน D1
      for (const account of accounts) {
        const accountId = account.id || account.accountId || `acc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const accountNumber = account.accountNumber || account.account_number || '';
        const accountName = account.accountName || account.account_name || '';
        const bankId = account.bankId || account.bank_id || '';
        const bankName = account.bankName || account.bank_name || '';
        const bankShort = account.bankShort || account.bank_short || '';

        // ตรวจสอบว่ามีอยู่แล้วหรือไม่
        const existing = await env.DB.prepare(
          `SELECT id FROM tenant_bank_accounts WHERE tenant_id = ? AND account_id = ?`
        )
          .bind(tenantId, accountId)
          .first();

        if (existing) {
          // Update
          await env.DB.prepare(
            `UPDATE tenant_bank_accounts 
             SET account_number = ?, account_name_th = ?, bank_id = ?, bank_name = ?, bank_short = ?, updated_at = ?
             WHERE tenant_id = ? AND account_id = ?`
          )
            .bind(accountNumber, accountName, bankId, bankName, bankShort, now, tenantId, accountId)
            .run();

          skippedCount++;
        } else {
          // Insert
          const id = `tba-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          await env.DB.prepare(
            `INSERT INTO tenant_bank_accounts 
             (id, team_id, tenant_id, account_id, account_number, account_name_th, account_name_en, 
              bank_id, bank_name, bank_short, status, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              id,
              teamId,
              tenantId,
              accountId,
              accountNumber,
              accountName,
              '', // account_name_en (empty จนกว่า user จะแก้ไข)
              bankId,
              bankName,
              bankShort,
              'active',
              now,
              now
            )
            .run();

          syncedCount++;
        }
      }

      return successResponse(
        {
          synced: syncedCount,
          updated: skippedCount,
          total: accounts.length,
        },
        `Synced ${syncedCount} new accounts, updated ${skippedCount} existing accounts`
      );
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },

  /**
   * PATCH /api/bank-accounts/:id/english-name
   * แก้ไขชื่อภาษาอังกฤษของบัญชี
   */
  async handleUpdateEnglishName(request: Request, env: Env, accountId: string): Promise<Response> {
    try {
      const body = await request.json() as any;
      const englishName = body.english_name || '';

      if (!englishName || typeof englishName !== 'string') {
        return errorResponse('english_name is required and must be a string', 400);
      }

      const now = Math.floor(Date.now() / 1000);

      // Update English name
      const result = await env.DB.prepare(
        `UPDATE tenant_bank_accounts 
         SET account_name_en = ?, updated_at = ? 
         WHERE id = ?`
      )
        .bind(englishName, now, accountId)
        .run();

      if (result.meta.changes === 0) {
        return errorResponse('Bank account not found', 404);
      }

      return successResponse(
        {
          id: accountId,
          english_name: englishName,
          updated_at: now,
        },
        'English name updated successfully'
      );
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },

  /**
   * GET /api/tenants/:id/bank-accounts/metadata
   * ดึงข้อมูล metadata ของบัญชีธนาคาร (รวม English name)
   */
  async handleGetBankAccountsMetadata(env: Env, tenantId: string): Promise<Response> {
    try {
      // ดึงข้อมูลจาก D1
      const accounts = await env.DB.prepare(
        `SELECT id, account_id, account_number, account_name_th, account_name_en, 
                bank_id, bank_name, bank_short, status, created_at, updated_at
         FROM tenant_bank_accounts 
         WHERE tenant_id = ? AND status = ?
         ORDER BY created_at DESC`
      )
        .bind(tenantId, 'active')
        .all();

      return successResponse({
        accounts: accounts.results || [],
        total: accounts.results?.length || 0,
      });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  },
};
