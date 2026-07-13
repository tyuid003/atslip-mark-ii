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
      // ดึงข้อมูล tenant + session token พร้อมกัน
      const now = Math.floor(Date.now() / 1000);

      const tenant = await env.DB.prepare(
        'SELECT id, team_id, admin_api_url FROM tenants WHERE id = ?'
      )
        .bind(tenantId)
        .first<any>();

      if (!tenant) {
        return errorResponse('Tenant not found', 404);
      }

      const teamId = tenant.team_id as string;

      // ดึง session token จาก D1 เพื่อใช้ auth กับ admin API
      const sessionRow = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions WHERE tenant_id = ? AND expires_at > ? LIMIT 1`
      ).bind(tenantId, now).first<{ session_token: string }>();
      const sessionToken = sessionRow?.session_token || '';

      // ──────────────────────────────────────────────────────────────
      // ดึงบัญชีสดจาก admin API (ใช้ auth ถ้ามี) → อัปเดท KV ด้วย
      // ──────────────────────────────────────────────────────────────
      let accounts: any[] = [];
      if (sessionToken) {
        try {
          const freshResp = await fetch(
            `${tenant.admin_api_url}/api/accounting/bankaccounts/list?limit=200`,
            { headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' } },
          );
          if (freshResp.ok) {
            const freshData = await freshResp.json() as { list?: any[]; data?: any[]; accounts?: any[] };
            accounts = freshData.list || freshData.data || freshData.accounts || [];
            // อัปเดท KV `tenant:{id}:banks` ด้วยข้อมูลสด
            const expiresAt = now + 24 * 60 * 60;
            await env.BANK_KV.put(
              `tenant:${tenantId}:banks`,
              JSON.stringify({ tenant_id: tenantId, accounts, cached_at: now, expires_at: expiresAt }),
              { expirationTtl: 24 * 60 * 60 },
            );
            console.log('[BankAccountsAPI] 🔄 Fresh accounts from admin API:', accounts.length);
          } else {
            console.warn('[BankAccountsAPI] ⚠️ admin API returned', freshResp.status, '— falling back to KV');
          }
        } catch (e: any) {
          console.warn('[BankAccountsAPI] ⚠️ admin API fetch error:', e?.message);
        }
      }

      // Fallback: ใช้ KV ถ้าไม่มี session หรือ fetch ล้มเหลว
      if (accounts.length === 0) {
        const bankKey = `tenant:${tenantId}:banks`;
        const bankData = await env.BANK_KV.get(bankKey);
        if (!bankData) {
          return errorResponse('No bank accounts found. Please reconnect the website first.', 404);
        }
        const cache = JSON.parse(bankData);
        accounts = cache.accounts || [];
        console.log('[BankAccountsAPI] 📦 Using KV cache:', accounts.length, 'accounts');
      }

      // ──────────────────────────────────────────────────────────────
      // เรียก /api/accounting/banks/list เพื่อ cache master bank list
      // ──────────────────────────────────────────────────────────────
      const bankIdToCode: { [key: number]: string } = {};
      try {
        const authHeaders: Record<string, string> = { Accept: 'application/json' };
        if (sessionToken) authHeaders['Authorization'] = `Bearer ${sessionToken}`;
        const banksResponse = await fetch(`${tenant.admin_api_url}/api/accounting/banks/list`, {
          headers: authHeaders,
        });
        if (banksResponse.ok) {
          const banksData = await banksResponse.json() as { list?: Array<{ id: number; code: string; name: string }> };
          const masterBanks = banksData.list || [];
          masterBanks.forEach(bank => { bankIdToCode[bank.id] = bank.code; });
          await env.BANK_KV.put(
            `tenant:${tenantId}:master-banks`,
            JSON.stringify({ banks: masterBanks, cached_at: now }),
            { expirationTtl: 86400 },
          );
          console.log('[BankAccountsAPI] 🏦 Master banks fetched:', masterBanks.length);
        }
      } catch (e: any) {
        console.warn('[BankAccountsAPI] ⚠️ master banks fetch error:', e?.message);
      }

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

      // Deactivate accounts ที่ไม่อยู่ใน sync list ปัจจุบัน
      // Normalize id: "10.0" → "10" เพื่อ comparison ถูกต้อง
      const normalizeId = (v: any): string => {
        const s = String(v ?? '');
        // ถ้าเป็น numeric string ที่มี .0 ต่อท้าย ให้ตัดออก
        return s.replace(/\.0+$/, '');
      };
      const currentAccountIds = accounts
        .map((a: any) => a.id ?? a.accountId ?? null)
        .filter((v: any) => v != null)
        .map(normalizeId);

      let deactivatedCount = 0;
      if (currentAccountIds.length > 0) {
        // ดึง account_id ทั้งหมดจาก D1 ที่ยัง active
        const existingRows = await env.DB.prepare(
          `SELECT account_id FROM tenant_bank_accounts WHERE tenant_id = ? AND status = 'active'`
        ).bind(tenantId).all<{ account_id: string }>();

        const toDeactivate = (existingRows.results || [])
          .map(r => r.account_id)
          .filter(id => !currentAccountIds.includes(normalizeId(id)));

        for (const accountId of toDeactivate) {
          await env.DB.prepare(
            `UPDATE tenant_bank_accounts SET status = 'inactive', updated_at = ? WHERE tenant_id = ? AND account_id = ?`
          ).bind(now, tenantId, accountId).run();
          deactivatedCount++;
        }

        if (deactivatedCount > 0) {
          console.log(`[BankAccountsAPI] 🗑️ Deactivated ${deactivatedCount} removed account(s)`);
        }
      }

      return successResponse(
        {
          synced: syncedCount,
          updated: skippedCount,
          deactivated: deactivatedCount,
          total: accounts.length,
        },
        `Synced ${syncedCount} new accounts, updated ${skippedCount} existing accounts, deactivated ${deactivatedCount}`
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
      
      // ค้นหาบัญชีโดย accountNumber หรือ numeric id (รองรับทั้งสองรูปแบบ)
      const searchId = String(accountId);
      const account = accounts.find((acc: any) => {
        const byNumber = String(acc.accountNumber || acc.account_number || '') === searchId;
        const byId = String(acc.id || '') === searchId;
        return byNumber || byId;
      });

      if (!account) {
        console.warn('[BankAccountsAPI] Account not found for id:', searchId, 'available:', accounts.map((a: any) => ({ id: a.id, num: a.accountNumber })));
        return errorResponse('Account not found', 404);
      }

      // สร้าง metadata ใหม่
      const id = `tba-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);
      const accountNumber = account.accountNumber || account.account_number || '';
      const accountName = account.accountName || account.name || account.account_name || '';
      // ใช้ accountNumber เป็น account_id เสมอ (สอดคล้องกับ matchReceiver ใน scan.service.ts)
      const storedAccountId = accountNumber || searchId;
      const bankId = account.bankId || account.bank_id || '';
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
          storedAccountId, // account_id = accountNumber (consistent with matchReceiver)
          accountNumber,
          accountName,
          '', // account_name_en (empty, user fills later)
          bankId,
          bankName,
          bankShort,
          'active',
          now,
          now
        )
        .run();

      return successResponse(
        { id, account_id: storedAccountId, created: true },
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
