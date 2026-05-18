// Bank Accounts Management API
// สำหรับจัดการข้อมูล metadata ของบัญชีธนาคาร

import { jsonResponse, errorResponse, successResponse } from '../utils/helpers';
import type { Env } from '../types';

export const BankAccountsAPI = {
  /**
   * POST /api/tenants/:id/bank-accounts/sync
   * Sync bank accounts จาก KV ไปยัง D1 (สร้าง metadata records)
   * + เรียก /api/accounting/banks/list เพื่อ cache master bank list
   */
  async handleSyncBankAccounts(env: Env, tenantId: string): Promise<Response> {
    try {
      // ดึงข้อมูล tenant
      const tenant = await env.DB.prepare(
        'SELECT id, team_id, admin_api_url FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first<any>();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const teamId = tenant.team_id as string;

      // ✅ เรียก /api/accounting/bankaccounts/list เพื่อดึง Account List พร้อม Account IDs
      let bankAccountsList: Array<{ 
        id: number;           // ← Account ID (ใช้สำหรับ toAccountId!)
        accountNumber: string; 
        bankId: number; 
        bankCode?: string 
      }> = [];
      
      try {
        const accountsResponse = await fetch(`${tenant.admin_api_url}/api/accounting/bankaccounts/list`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (accountsResponse.ok) {
          const accountsData = await accountsResponse.json() as { list?: typeof bankAccountsList };
          bankAccountsList = accountsData.list || [];

          console.log('[BankAccountsAPI] 💳 Bank Accounts fetched:', bankAccountsList.length, 'accounts');
          console.log('[BankAccountsAPI] 📝 Sample account:', bankAccountsList[0] ? {
            id: bankAccountsList[0].id,
            accountNumber: bankAccountsList[0].accountNumber,
            bankId: bankAccountsList[0].bankId,
          } : 'none');

          // เก็บ account list ใน KV พร้อม Account IDs สำหรับ lookup
          const accountListKey = `tenant:${tenantId}:bank-accounts-list`;
          await env.BANK_KV.put(
            accountListKey,
            JSON.stringify({
              accounts: bankAccountsList,
              cached_at: Math.floor(Date.now() / 1000),
            }),
            { expirationTtl: 86400 } // 24 hours
          );

          console.log('[BankAccountsAPI] ✅ Bank accounts list cached in KV');
        } else {
          const errorText = await accountsResponse.text();
          console.log('[BankAccountsAPI] ⚠️ Failed to fetch bank accounts:', accountsResponse.status, errorText);
        }
      } catch (accountError: any) {
        console.log('[BankAccountsAPI] ⚠️ Network error fetching bank accounts:', accountError.message);
        // Continue even if account list fetch fails
      }

      // ✅ เรียก /api/accounting/banks/list เพื่อ cache master list
      let masterBanks: Array<{ id: number; code: string; name: string }> = [];
      const bankIdToCode: { [key: number]: string } = {};
      
      try {
        const banksResponse = await fetch(`${tenant.admin_api_url}/api/accounting/banks/list`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (banksResponse.ok) {
          const banksData = await banksResponse.json() as { list?: Array<{ id: number; code: string; name: string }> };
          masterBanks = banksData.list || [];

          // สร้าง mapping: bankId → code
          masterBanks.forEach(bank => {
            bankIdToCode[bank.id] = bank.code;
          });

          console.log('[BankAccountsAPI] 🏦 Master banks fetched:', masterBanks.length, 'banks');
          console.log('[BankAccountsAPI] 📝 Bank ID to Code mapping:', bankIdToCode);

          // เก็บ master list ใน KV
          const masterBankKey = `tenant:${tenantId}:master-banks`;
          await env.BANK_KV.put(
            masterBankKey,
            JSON.stringify({
              banks: masterBanks,
              cached_at: Math.floor(Date.now() / 1000),
            }),
            { expirationTtl: 86400 } // 24 hours
          );
        } else {
          const errorText = await banksResponse.text();
          console.log('[BankAccountsAPI] ⚠️ Failed to fetch master banks:', banksResponse.status, errorText);
        }
      } catch (bankError: any) {
        console.log('[BankAccountsAPI] ⚠️ Network error fetching master banks:', bankError.message);
        // Continue even if master list fetch fails
      }

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

      console.log('[BankAccountsAPI] 📥 Starting sync for', accounts.length, 'account(s)');

      // Loop แต่ละบัญชีและ insert/update ใน D1
      for (const account of accounts) {
        // ✅ CRITICAL: account.id จาก /api/accounting/bankaccounts/list คือ Account ID (ต้องเก็บไว้!)
        const accountId = account.id || account.accountId || `acc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const accountNumber = account.accountNumber || account.account_number || '';
        const accountName = account.accountName || account.account_name || '';
        const bankId = account.bankId || account.bank_id || '';
        
        // ดึง bankShort จากปัจจุบัน (ถ้าไม่มี try map จาก bankId)
        let bankShort = account.bankShort || account.bank_short || '';
        if (!bankShort && bankId && bankIdToCode[bankId]) {
          bankShort = bankIdToCode[bankId];
          console.log(`[BankAccountsAPI] 🔍 Mapped bankId ${bankId} → code ${bankShort}`);
        }

        const bankName = account.bankName || account.bank_name || '';

        console.log(`[BankAccountsAPI] 📋 Processing account: ${accountNumber} | bank_short=${bankShort}`);

        // ตรวจสอบว่ามีอยู่แล้วหรือไม่
        const existing = await env.DB.prepare(
          `SELECT id FROM tenant_bank_accounts WHERE tenant_id = ? AND account_id = ?`
        )
          .bind(tenantId, accountId)
          .first();

        if (existing) {
          // Update
          const result = await env.DB.prepare(
            `UPDATE tenant_bank_accounts 
             SET account_number = ?, account_name_th = ?, bank_id = ?, bank_name = ?, bank_short = ?, status = 'active', updated_at = ?
             WHERE tenant_id = ? AND account_id = ?`
          )
            .bind(accountNumber, accountName, bankId, bankName, bankShort, now, tenantId, accountId)
            .run();

          console.log(`[BankAccountsAPI] ✏️ Updated account: ${accountId}`);
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
                // ✅ Store Account ID (not account number!)
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

          console.log(`[BankAccountsAPI] ✅ Inserted account: ${accountId} with bank_short=${bankShort}`);
          syncedCount++;
        }
      }

      console.log(`[BankAccountsAPI] ✅ Sync complete: ${syncedCount} inserted, ${skippedCount} updated`);

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
   * POST /api/tenants/:tenantId/bank-accounts/:accountId/metadata
   * สร้าง metadata สำหรับบัญชีเดียว
   */
  async handleCreateMetadata(env: Env, tenantId: string, accountId: string): Promise<Response> {
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

      // ตรวจสอบว่ามี metadata อยู่แล้วหรือไม่
      const existing = await env.DB.prepare(
        `SELECT id FROM tenant_bank_accounts WHERE tenant_id = ? AND account_id = ?`
      )
        .bind(tenantId, accountId)
        .first();

      if (existing) {
        return successResponse(
          { id: existing.id, exists: true },
          'Metadata already exists'
        );
      }

      // ดึงข้อมูลบัญชีจาก KV
      const bankKey = `tenant:${tenantId}:banks`;
      const bankData = await env.BANK_KV.get(bankKey);

      if (!bankData) {
        return errorResponse('No bank accounts found in cache', 404);
      }

      const cache = JSON.parse(bankData);
      const accounts = cache.accounts || [];
      
      console.log('[BankAccountsAPI] Looking for account:', {
        accountId,
        totalAccounts: accounts.length,
        sampleAccount: accounts[0] ? {
          id: accounts[0].id,
          accountId: accounts[0].accountId,
          accountNumber: accounts[0].accountNumber || accounts[0].account_number,
        } : null,
      });
      
      const account = accounts.find((acc: any) => {
        const accId = String(acc.accountNumber || acc.account_number || acc.id || '');
        const searchId = String(accountId);
        console.log('[BankAccountsAPI] Comparing:', accId, '===', searchId, '=>', accId === searchId);
        return accId === searchId;
      });

      if (!account) {
        return errorResponse('Account not found', 404);
      }

      // สร้าง metadata ใหม่
      const id = `tba-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);
      const accountNumber = account.accountNumber || account.account_number || '';
      const accountName = account.accountName || account.name || account.account_name || '';
      const bankId = account.bankId || account.id || account.bank_id || '';
      const bankName = account.bankName || account.bank_name || '';
      const bankShort = account.bankShort || account.bank_short || '';

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
          accountId, // account_id = accountNumber
          accountNumber,
          accountName,
          '', // account_name_en (empty)
          bankId,
          bankName,
          bankShort,
          'active',
          now,
          now
        )
        .run();

      return successResponse(
        { id, account_id: accountId, created: true },
        'Metadata created successfully'
      );
    } catch (error: any) {
      console.error('[BankAccountsAPI] Error creating metadata:', error);
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
