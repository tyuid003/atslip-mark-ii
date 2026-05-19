// Scan API
// POST /api/scan/upload - อัพโหลดสลิปและสแกน

import { jsonResponse, errorResponse, successResponse } from '../utils/helpers';
import { ScanService } from '../services/scan.service';
import { CreditService } from '../services/credit.service';
import type { Env } from '../types';

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
  const normalizedReceiver = rawReceiver.replace(/[^0-9]/g, '');

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

// Helper function to resolve receiver account number to Account ID
async function resolveToAccountId(
  tenantId: string,
  adminApiUrl: string,
  sessionToken: string | null,
  receiverAccount: string,
  env: Env
): Promise<number | null> {
  // 1) ใช้ API จริงตาม contract: GET /api/accounting/bankaccounts/list?limit=100
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`, {
      method: 'GET',
      headers,
    });

    if (response.ok) {
      const data = await response.json() as { list?: BankAccountListItem[] };
      const list = data.list || [];
      const candidates = list
        .map((acc) => ({
          id: Number(acc.id),
          accountNumber: String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, ''),
        }))
        .filter((acc) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

      const resolvedFromApi = pickAccountIdFromCandidates(receiverAccount, candidates);
      if (resolvedFromApi) {
        return resolvedFromApi;
      }
    }
  } catch {
    // fallback to KV below
  }

  // 2) Fallback เป็น KV cache ของ endpoint เดียวกัน
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
    accountNumber: String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, ''),
    }))
    .filter((acc) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);

  return pickAccountIdFromCandidates(receiverAccount, candidates);
}

export const ScanAPI = {
  /**
   * POST /api/scan/upload
   * อัพโหลดและสแกนสลิป
   */
  async handleUploadSlip(request: Request, env: Env): Promise<Response> {
    // Debug logs array to send back to frontend
    const debugLogs: string[] = [];
    const log = (...args: any[]) => {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      debugLogs.push(message);
      console.log(...args);
    };

    try {
      // รับ form data
      const formData = await request.formData();
      const fileValue = formData.get('file');

      if (!fileValue || typeof fileValue === 'string') {
        return errorResponse('No file uploaded', 400);
      }

      const file = fileValue as File;

      // ตรวจสอบว่าเป็นไฟล์รูปหรือไม่
      if (!file.type.startsWith('image/')) {
        return errorResponse('File must be an image', 400);
      }

      log('[ScanAPI] Received slip upload:', file.name, file.type, file.size);

      // ส่งไปสแกนที่ EASYSLIP (ใช้ token ของ tenant ใดก็ได้ที่ active)
      // หรืออาจจะส่งมา tenant_id ใน form data
      const tenantId = formData.get('tenant_id') as string | null;
      const sourceRaw = String(formData.get('source') || '').trim().toLowerCase();
      const source: 'webhook' | 'manual' | 'upload' =
        sourceRaw === 'webhook' || sourceRaw === 'manual' ? (sourceRaw as 'webhook' | 'manual') : 'upload';
      const isManualScan = source === 'manual';
      const lineOAIdRaw = String(formData.get('line_oa_id') || '').trim();
      const lineOAId = lineOAIdRaw.length > 0 ? lineOAIdRaw : null;

      log('[ScanAPI] Scan source:', {
        source,
        isManualScan,
        teamSlugHeader: request.headers.get('X-Team-Slug') || null,
      });

      let easyslipToken = '';

      if (tenantId) {
        // ดึง token ของ tenant นี้
        const tenant = await env.DB.prepare(
          'SELECT easyslip_token FROM tenants WHERE id = ? AND status = ?'
        )
          .bind(tenantId, 'active')
          .first();

        if (!tenant) {
          log('[ScanAPI] ❌ Tenant not found:', tenantId);
          return errorResponse('Tenant not found or inactive', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        log('[ScanAPI] Using tenant-specific token:', {
          tenantId,
          hasToken: !!easyslipToken,
          tokenLength: easyslipToken?.length || 0,
        });
      } else {
        // ใช้ token ของ tenant active ตัวแรก
        const tenant = await env.DB.prepare(
          'SELECT id, name, easyslip_token FROM tenants WHERE status = ? AND easyslip_token IS NOT NULL AND easyslip_token != ? LIMIT 1'
        )
          .bind('active', '')
          .first();

        if (!tenant) {
          log('[ScanAPI] ❌ No active tenant with EASYSLIP token found');
          return errorResponse('No active tenant with EASYSLIP token found. Please configure EASYSLIP token in tenant settings.', 404);
        }

        easyslipToken = tenant.easyslip_token as string;
        log('[ScanAPI] Using default tenant token:', {
          tenantId: tenant.id,
          tenantName: tenant.name,
          hasToken: !!easyslipToken,
          tokenLength: easyslipToken?.length || 0,
        });
      }

      // ตรวจสอบว่า token มีค่าหรือไม่
      if (!easyslipToken || easyslipToken.trim() === '' || easyslipToken === 'null') {
        log('[ScanAPI] ❌ EASYSLIP token is empty or invalid');
        return errorResponse('EASYSLIP token is not configured or invalid. Please update tenant settings with a valid EASYSLIP API token.', 400);
      }

      // สแกนสลิป
      let slipData: any;
      try {
        slipData = await ScanService.scanSlip(file, easyslipToken);
        log('[ScanAPI] ScanService.scanSlip() returned:', {
          success: slipData?.success,
          hasData: !!slipData?.data,
          dataKeys: slipData?.data ? Object.keys(slipData.data) : [],
        });
      } catch (scanError: any) {
        log('[ScanAPI] ❌ ScanService.scanSlip() threw exception:', scanError.message);
        return errorResponse(`EASYSLIP error: ${scanError.message}`, 400);
      }

      log('[ScanAPI] EASYSLIP response:', {
        success: slipData?.success,
        status: slipData?.data?.status,
        message: slipData.data?.message,
        hasData: !!slipData.data?.data,
      });

      if (!slipData.success) {
        log('[ScanAPI] ❌ EASYSLIP API call failed:', JSON.stringify(slipData, null, 2));
        return errorResponse(`EASYSLIP error: ${slipData.data?.message || 'API request failed'}`, 400);
      }

      if (slipData.data.status !== 200) {
        log('[ScanAPI] ❌ EASYSLIP returned non-200 status:', JSON.stringify(slipData.data, null, 2));
        return errorResponse(`EASYSLIP error (${slipData.data.status}): ${slipData.data?.message || 'Scan failed'}`, 400);
      }

      const slip = slipData.data.data;
      log('[ScanAPI] Slip scanned successfully:', slip.transRef);

      // Match receiver (บัญชีรับ)
      log('[ScanAPI] 🏦 ===== RECEIVER MATCHING START =====');
      
      const receiverBank = slip.receiver.bank;
      const receiverAccount = slip.receiver.account.bank?.account || slip.receiver.account.proxy?.account || '';
      const receiverNameTh = slip.receiver.account.name.th;
      const receiverNameEn = slip.receiver.account.name.en;

      log('[ScanAPI] 📥 Receiver Info from SLIP:', {
        bank: receiverBank?.name || receiverBank?.short || receiverBank?.id || 'N/A',
        account: receiverAccount,
        nameTh: receiverNameTh,
        nameEn: receiverNameEn,
      });

      // อ่าน team slug จาก header เพื่อจำกัดการค้นหาเฉพาะ tenant ในทีมนั้น
      // (ป้องกัน match ผิด tenant ข้าม team สำหรับ manual scan)
      // สำหรับ webhook scan ไม่มี X-Team-Slug → ค้นหาทุก tenant ตามปกติ
      const teamSlug = request.headers.get('X-Team-Slug') || undefined;
      log('[ScanAPI] Team slug from header:', teamSlug || '(none — all teams)');

      const matchedTenant = await ScanService.matchReceiver(
        env,
        receiverBank,
        receiverAccount,
        receiverNameTh,
        receiverNameEn,
        teamSlug,
        log,
        isManualScan ? 'manual' : 'normal'
      );

      if (!matchedTenant) {
        log('[ScanAPI] ❌ RESULT: No matching tenant found');
        log('[ScanAPI] 🏦 ===== RECEIVER MATCHING END (NO MATCH) =====');
        return errorResponse('No matching tenant found for this slip', 404);
      }

      log('[ScanAPI] ✅ MATCHED TENANT:', {
        id: matchedTenant.id,
        name: matchedTenant.name,
        admin_api_url: matchedTenant.admin_api_url,
      });
      log('[ScanAPI] 🏦 ===== RECEIVER MATCHING END (MATCHED) =====');

      // Match sender (ผู้โอน)
      const senderNameTh = slip.sender.account.name.th;
      const senderNameEn = slip.sender.account.name.en;
      const senderAccount = slip.sender.account.bank?.account || slip.sender.account.proxy?.account || '';
      const senderBank = slip.sender.bank; // { id, name, short }

      log('[ScanAPI] 🔍 ===== SENDER MATCHING START =====');
      log('[ScanAPI] 📥 Sender Info from SLIP:', {
        nameTh: senderNameTh,
        nameEn: senderNameEn,
        account: senderAccount,
        bank: senderBank?.name || senderBank?.short || senderBank?.id || 'N/A',
      });

      // ดึง session token ของ tenant ที่ match ได้
      const session = await env.DB.prepare(
        `SELECT session_token FROM admin_sessions 
         WHERE tenant_id = ? AND expires_at > ? 
         LIMIT 1`
      )
        .bind(matchedTenant.id, Math.floor(Date.now() / 1000))
        .first();

      let matchedUser = null;

      if (session) {
        log('[ScanAPI] ✅ Session found, calling matchSender...');
        const sessionToken = session.session_token as string;
        matchedUser = await ScanService.matchSender(
          matchedTenant.admin_api_url,
          sessionToken,
          senderNameTh,
          senderNameEn,
          senderAccount,
          senderBank,
          log
        );

        if (matchedUser) {
          log('[ScanAPI] ✅ MATCHED USER:', {
            id: matchedUser.id,
            memberCode: matchedUser.memberCode,
            fullname: matchedUser.fullname,
            category: matchedUser.category,
            bankAccount: matchedUser.bankAccount || matchedUser.bank_account || 'N/A',
          });

          // 🧾 ถ้าเป็น non-member หรือไม่มี memberCode → gen memberCode ทันที
          // เพื่อให้ matched_user_id ถูกเก็บเป็น memberCode ที่ใช้เติมเครดิตได้จริง
          const needGen =
            !String(matchedUser.memberCode || '').trim() ||
            String(matchedUser.category || '').toLowerCase() === 'non-member';

          if (needGen) {
            log('[ScanAPI] 🧾 Auto-resolving memberCode for non-member matched user...');
            try {
              const resolved = await CreditService.resolveMemberCodeForUser(
                matchedTenant.admin_api_url,
                sessionToken,
                {
                  id: matchedUser.id,
                  memberCode: matchedUser.memberCode || '',
                  fullname: matchedUser.fullname || '',
                },
                log
              );

              if (resolved.success && resolved.memberCode) {
                matchedUser.memberCode = resolved.memberCode;
                if (resolved.user) {
                  matchedUser.fullname = (resolved.user as any).fullname || matchedUser.fullname;
                  matchedUser.username = (resolved.user as any).username || matchedUser.username;
                }
                log('[ScanAPI] ✅ memberCode resolved & attached:', resolved.memberCode);
              } else {
                log('[ScanAPI] ⚠️ Cannot auto-resolve memberCode:', resolved.message);
              }
            } catch (resolveError: any) {
              log('[ScanAPI] ⚠️ resolveMemberCodeForUser threw:', resolveError?.message || resolveError);
            }
          }
        } else {
          log('[ScanAPI] ❌ No matching user found');
        }
      } else {
        log('[ScanAPI] ❌ No active session for tenant, cannot search users');
      }

      log('[ScanAPI] 🔍 ===== SENDER MATCHING END =====');

      // ตรวจสอบสลิปซ้ำก่อนบันทึก
      const existingSlip = await env.DB.prepare(
        `SELECT id FROM pending_transactions WHERE slip_ref = ? LIMIT 1`
      )
        .bind(slip.transRef)
        .first();

      if (existingSlip) {
        log('[ScanAPI] ⚠️ Duplicate slip detected:', slip.transRef);
        return jsonResponse({
          success: false,
          error: 'สลิปนี้เคยบันทึกไว้แล้ว (Duplicate slip)',
          data: {
            status: 'duplicate',
            slip: {
              ref: slip.transRef,
              amount: slip.amount?.amount || 0,
              date: slip.date,
            },
            sender: {
              id: null,
              name: senderNameTh || senderNameEn || 'Unknown',
              matched: false,
            },
          },
        }, 400);
      }

      // บันทึกใน pending_transactions
      const transactionId = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      try {
        const insertResult = await env.DB.prepare(
          `INSERT INTO pending_transactions 
           (id, team_id, tenant_id, line_oa_id, slip_ref, amount, sender_name, sender_account, 
            receiver_name, receiver_account, slip_data, matched_user_id, matched_username, 
            status, source, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            transactionId,
            matchedTenant.team_id,
            matchedTenant.id,
            lineOAId,
            slip.transRef,
            slip.amount.amount,
            senderNameTh || senderNameEn || 'Unknown',
            senderAccount,
            receiverNameTh || receiverNameEn || '',
            receiverAccount,
            JSON.stringify(slip),
            matchedUser?.memberCode || matchedUser?.username || null,
            matchedUser?.fullname || null,
            (matchedUser && (matchedUser?.memberCode || matchedUser?.username)) ? 'matched' : 'pending',
            source,
            now,
            now
          )
          .run();

        log('[ScanAPI] ✅ Transaction saved:', {
          transactionId,
          insertSuccess: true,
          dbResponse: insertResult?.meta ?? 'unknown',
        });

        // 🔔 Broadcast realtime notification for new pending transaction
        try {
          const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
          const doStub = env.PENDING_NOTIFICATIONS.get(doId);
          
          const broadcastPayload = {
            type: 'new_pending',
            data: {
              id: transactionId,
              tenant_id: matchedTenant.id,
              team_id: matchedTenant.team_id,
              amount: slip.amount.amount,
              sender_name: senderNameTh || senderNameEn || 'Unknown',
              status: (matchedUser && (matchedUser?.memberCode || matchedUser?.username)) ? 'matched' : 'pending',
              created_at: now,
            },
          };
          
          log('[ScanAPI] 📡 Broadcasting payload:', JSON.stringify(broadcastPayload));
          
          const broadcastResponse = await doStub.fetch('https://internal/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(broadcastPayload),
          });
          
          const broadcastResult = await broadcastResponse.json();
          log('[ScanAPI] ✅ Realtime notification broadcasted:', broadcastResult);
        } catch (broadcastError) {
          log('[ScanAPI] ⚠️ Failed to broadcast realtime notification:', {
            error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
            stack: broadcastError instanceof Error ? broadcastError.stack : undefined,
          });
        }
      } catch (dbError) {
        log('[ScanAPI] ❌ DB INSERT FAILED:', {
          transactionId,
          error: dbError instanceof Error ? dbError.message : String(dbError),
          slipRef: slip.transRef,
          teamId: matchedTenant.team_id,
          tenantId: matchedTenant.id,
        });
        return errorResponse(
          `ไม่สามารถบันทึกสลิปได้ (DB Insert Error: ${dbError instanceof Error ? dbError.message : 'Unknown'})`,
          500
        );
      }

      // ถ้า matched user และ auto-deposit เปิดอยู่ → ทำการเติมเครดิตอัตโนมัติ
      let creditResult = null;
      if (matchedUser) {
        // ตรวจสอบว่า auto-deposit เปิดอยู่หรือไม่
        const autoDepositEnabled = await CreditService.isAutoDepositEnabled(env, matchedTenant.id);
        
        if (autoDepositEnabled) {
          log('[ScanAPI] 🎯 Auto-deposit is ENABLED - triggering credit submission...');

          const toAccountId = receiverAccount
            ? await resolveToAccountId(
                matchedTenant.id,
                matchedTenant.admin_api_url,
                session ? String((session as any).session_token || '') : null,
                receiverAccount,
                env
              )
            : null;

          if (!toAccountId) {
            log('[ScanAPI] ⚠️ toAccountId could not be resolved - skipping auto credit');
            return successResponse({
              debug: debugLogs,
              transaction_id: transactionId,
              tenant: {
                id: matchedTenant.id,
                name: matchedTenant.name,
              },
              slip: {
                ref: slip.transRef,
                amount: slip.amount.amount,
                date: slip.date,
              },
              sender: matchedUser
                ? {
                    id: matchedUser.id,
                    name: matchedUser.fullname,
                    matched: true,
                  }
                : {
                    name: senderNameTh || senderNameEn || 'Unknown',
                    matched: false,
                  },
              status: (matchedUser && (matchedUser?.memberCode || matchedUser?.username)) ? 'matched' : 'pending',
              credit: {
                attempted: false,
                success: false,
                duplicate: false,
                message: 'Cannot resolve toAccountId',
              },
            }, 'Slip scanned and saved successfully');
          }
          
          creditResult = await CreditService.submitCredit(
            env,
            {
              tenantId: matchedTenant.id,
              slipData: slip,
              user: matchedUser,
              toAccountId,
            },
            log
          );

          log('[ScanAPI] 🧾 Credit result summary:', {
            success: creditResult.success,
            isDuplicate: !!creditResult.isDuplicate,
            resolvedMemberCode: creditResult.resolvedMemberCode || null,
            resolvedUsername: creditResult.resolvedUsername || null,
            message: creditResult.message || null,
          });

          if (creditResult.success) {
            const updateTs = Math.floor(Date.now() / 1000);
            if (creditResult.isDuplicate) {
              log('[ScanAPI] ⚠️ Credit submission: DUPLICATE');
              // อัพเดทสถานะเป็น duplicate
              const duplicateUpdate = await env.DB.prepare(
                `UPDATE pending_transactions
                 SET status = ?,
                     matched_user_id = COALESCE(?, matched_user_id),
                     matched_username = COALESCE(?, matched_username),
                     error_message = NULL,
                     updated_at = ?
                 WHERE id = ?`
              )
                .bind(
                  'duplicate',
                  creditResult.resolvedMemberCode || matchedUser?.memberCode || matchedUser?.id || null,
                  creditResult.resolvedUsername || null,
                  updateTs,
                  transactionId
                )
                .run();

              log('[ScanAPI] 🗃️ DB status update (duplicate):', {
                transactionId,
                changes: duplicateUpdate?.meta?.changes ?? 0,
              });

              // 🔔 Broadcast realtime notification for status transition
              try {
                const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
                const doStub = env.PENDING_NOTIFICATIONS.get(doId);
                const statusPayload = {
                  type: 'transaction_updated',
                  data: {
                    id: transactionId,
                    status: 'duplicate',
                    matched_user_id: creditResult.resolvedMemberCode || matchedUser?.memberCode || matchedUser?.id || null,
                    matched_username: creditResult.resolvedUsername || matchedUser?.fullname || null,
                    tenant_id: matchedTenant.id,
                    tenant_name: matchedTenant.name,
                    updated_at: updateTs,
                  },
                };

                await doStub.fetch('https://internal/broadcast', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(statusPayload),
                });
                log('[ScanAPI] 📡 Broadcast status update (duplicate):', statusPayload);
              } catch (broadcastError) {
                log('[ScanAPI] ⚠️ Failed to broadcast duplicate update:', {
                  error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
                });
              }
            } else {
              log('[ScanAPI] ✅ Credit submission: SUCCESS');
              // อัพเดทสถานะเป็น credited (ไม่ใช้ credited_at เพราะ schema ปัจจุบันไม่มีคอลัมน์นี้)
              const creditedUpdate = await env.DB.prepare(
                `UPDATE pending_transactions
                 SET status = ?,
                     matched_user_id = COALESCE(?, matched_user_id),
                     matched_username = COALESCE(?, matched_username),
                     error_message = NULL,
                     updated_at = ?
                 WHERE id = ?`
              )
                .bind(
                  'credited',
                  creditResult.resolvedMemberCode || matchedUser?.memberCode || matchedUser?.id || null,
                  creditResult.resolvedUsername || null,
                  updateTs,
                  transactionId
                )
                .run();

              log('[ScanAPI] 🗃️ DB status update (credited):', {
                transactionId,
                changes: creditedUpdate?.meta?.changes ?? 0,
              });

              // 🔔 Broadcast realtime notification for status transition
              try {
                const doId = env.PENDING_NOTIFICATIONS.idFromName('global');
                const doStub = env.PENDING_NOTIFICATIONS.get(doId);
                const statusPayload = {
                  type: 'transaction_updated',
                  data: {
                    id: transactionId,
                    status: 'credited',
                    matched_user_id: creditResult.resolvedMemberCode || matchedUser?.memberCode || matchedUser?.id || null,
                    matched_username: creditResult.resolvedUsername || matchedUser?.fullname || null,
                    tenant_id: matchedTenant.id,
                    tenant_name: matchedTenant.name,
                    updated_at: updateTs,
                  },
                };

                await doStub.fetch('https://internal/broadcast', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(statusPayload),
                });
                log('[ScanAPI] 📡 Broadcast status update (credited):', statusPayload);
              } catch (broadcastError) {
                log('[ScanAPI] ⚠️ Failed to broadcast credited update:', {
                  error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
                });
              }
            }
          } else {
            log('[ScanAPI] ❌ Credit submission FAILED:', creditResult.message);
            // สถานะยังคงเป็น matched (ไม่เปลี่ยน)
          }
        } else {
          log('[ScanAPI] ⏭️ Auto-deposit is DISABLED - skipping credit submission');
        }
      } else {
        log('[ScanAPI] ⏭️ No matched user - skipping credit submission');
      }

      return successResponse({
        debug: debugLogs,
        transaction_id: transactionId,
        matched_user_id: matchedUser?.memberCode || matchedUser?.id || null,
        matched_username: matchedUser?.fullname || null,
        tenant: {
          id: matchedTenant.id,
          name: matchedTenant.name,
        },
        slip: {
          ref: slip.transRef,
          amount: slip.amount.amount,
          date: slip.date,
        },
        sender: matchedUser
          ? {
              id: matchedUser.id,
              name: matchedUser.fullname,
              matched: true,
            }
          : {
              name: senderNameTh || senderNameEn || 'Unknown',
              matched: false,
            },
        status: creditResult?.success 
          ? (creditResult.isDuplicate ? 'duplicate' : 'credited')
          : (matchedUser ? 'matched' : 'pending'),
        credit: creditResult ? {
          attempted: true,
          success: creditResult.success,
          duplicate: creditResult.isDuplicate || false,
          message: creditResult.message,
          resolved_memberCode: creditResult.resolvedMemberCode || null,
        } : null,
      }, 'Slip scanned and saved successfully');
    } catch (error: any) {
      log('[ScanAPI] ❌ Error:', error.message || error);
      return jsonResponse({
        success: false,
        error: error.message || 'Internal server error',
        debug: debugLogs,
      }, 500);
    }
  },
};

