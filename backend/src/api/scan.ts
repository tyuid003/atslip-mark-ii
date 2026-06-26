// Scan API
// POST /api/scan/upload - อัพโหลดสลิปและสแกน

import { jsonResponse, errorResponse, successResponse, getAdminAuthHeaders } from '../utils/helpers';
import { ScanService } from '../services/scan.service';
import { CreditService } from '../services/credit.service';
import { AntidupSettingsAPI } from './antidup-settings';
import type { Env } from '../types';

/**
 * Normalize เวลาจาก slip / admin API ให้เป็น UTC unix ms
 * - ถ้ามี timezone offset (Z, +07:00, -05:00) → parse ปกติ
 * - ถ้าไม่มี timezone → ถือว่าเป็นเวลาไทย (UTC+7) เพื่อให้เทียบกับ slip.date ได้ถูกต้อง
 *   (admin API บางตัวส่งเป็น "YYYY-MM-DD HH:mm:ss" หรือ ISO ไม่มี Z)
 */
function normalizeTimeMs(timeStr: string | null | undefined): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;
  // มี timezone อยู่แล้ว
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const ms = new Date(trimmed).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  // ไม่มี timezone → ถือว่าเป็นเวลาไทย (Asia/Bangkok = UTC+7)
  const isoLike = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const ms = new Date(`${isoLike}+07:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
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
  // 1) KV cache (bank-refresh saves at tenant:{id}:banks)
  const bankKey = `tenant:${tenantId}:banks`;
  const bankData = await env.BANK_KV.get(bankKey);
  if (bankData) {
    const cache = JSON.parse(bankData) as { accounts?: any[]; api_version?: string };
    const kvAccounts = cache.accounts || [];
    if (kvAccounts.length > 0) {
      const candidates = kvAccounts
        .map((acc: any) => ({
          id: Number(acc.id),
          accountNumber: String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, ''),
        }))
        .filter((acc: any) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);
      const fromKv = pickAccountIdFromCandidates(receiverAccount, candidates);
      if (fromKv) return fromKv;
    }
  }

  // 2) API fallback (v1/v2 aware)
  if (!sessionToken) return null;
  try {
    const tenantRow = await env.DB.prepare(
      `SELECT COALESCE(api_version, 'v1') as api_version FROM tenants WHERE id = ? LIMIT 1`
    ).bind(tenantId).first<{ api_version: string }>();
    const apiVersion = tenantRow?.api_version || 'v1';

    const accountsUrl = apiVersion === 'v2'
      ? `${adminApiUrl}/api/proxy/v1/admin/bank-accounts?page=1&limit=200`
      : `${adminApiUrl}/api/accounting/bankaccounts/list?limit=100`;

    const authHeaders = getAdminAuthHeaders(sessionToken, apiVersion);

    const response = await fetch(accountsUrl, { method: 'GET', headers: authHeaders });
    if (response.ok) {
      const data = await response.json() as any;
      const list: any[] = apiVersion === 'v2' ? (data?.data?.list || []) : (data?.list || []);
      const candidates = list
        .map((acc: any) => ({
          id: Number(acc.id),
          accountNumber: String(acc.accountNumber || acc.account_number || '').replace(/[^0-9]/g, ''),
        }))
        .filter((acc: any) => Number.isFinite(acc.id) && acc.id > 0 && acc.accountNumber.length > 0);
      const fromApi = pickAccountIdFromCandidates(receiverAccount, candidates);
      if (fromApi) return fromApi;
    }
  } catch {
    // ignore
  }

  return null;
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
      // รองรับ MIME type ที่ถูกต้อง, application/octet-stream (จาก Telegram), หรือ นามสกุลไฟล์รูป
      const isImageMime = file.type.startsWith('image/');
      const isOctetStream = file.type === 'application/octet-stream' || file.type === '';
      const isImageExt = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|heic)$/i.test(file.name);
      if (!isImageMime && !isOctetStream && !isImageExt) {
        log('[ScanAPI] Invalid file type:', file.name, file.type);
        return errorResponse('File must be an image', 400);
      }

      log('[ScanAPI] Received slip upload:', file.name, file.type, file.size);

      // ส่งไปสแกนที่ provider (EasySlip / Slip2Go) — เลือกตาม form field "service"
      // หรืออาจจะส่งมา tenant_id ใน form data (LINE OA flow)
      const tenantId = formData.get('tenant_id') as string | null;
      const requestedServiceRaw = String(formData.get('service') || '').toLowerCase().trim();
      const requestedService: 'easyslip' | 'slip2go' | 'slipok' | null =
        requestedServiceRaw === 'slip2go' ? 'slip2go'
        : requestedServiceRaw === 'slipok' ? 'slipok'
        : requestedServiceRaw === 'easyslip' ? 'easyslip'
        : null;
      const sourceRaw = String(formData.get('source') || '').trim().toLowerCase();
      const source: 'webhook' | 'manual' | 'upload' | 'telegram' | 'line' =
        sourceRaw === 'webhook' || sourceRaw === 'manual' || sourceRaw === 'telegram' || sourceRaw === 'line'
          ? (sourceRaw as 'webhook' | 'manual' | 'telegram' | 'line')
          : 'upload';
      const isManualScan = source === 'manual';
      const lineOAIdRaw = String(formData.get('line_oa_id') || '').trim();
      const lineOAId = lineOAIdRaw.length > 0 ? lineOAIdRaw : null;
      // api_key_id override: Telegram bot ส่งมาเมื่อผู้ใช้เลือก key ด้วย /changeapikey
      const apiKeyIdOverride = String(formData.get('api_key_id') || '').trim() || null;

      // scanned_by_* — ส่งมาจาก frontend เมื่อผู้ใช้ scan ด้วย Telegram account (source='manual')
      // สำหรับ auto/telegram/line จะเป็น null → frontend แสดงตาม source แทน
      const scannedById   = String(formData.get('scanned_by_id')    || '').trim() || null;
      const scannedByName = String(formData.get('scanned_by_name')   || '').trim() || null;
      // photo อาจเป็น base64 ขนาดใหญ่ — เก็บแค่ 32KB เพื่อประหยัด DB
      const scannedByPhotoRaw = (formData.get('scanned_by_photo') as string | null) || null;
      const scannedByPhoto = scannedByPhotoRaw ? scannedByPhotoRaw.substring(0, 32768) : null;

      log('[ScanAPI] Scan source:', {
        source,
        isManualScan,
        requestedService,
        teamSlugHeader: request.headers.get('X-Team-Slug') || null,
      });

      // pickedKeys = รายการ key เรียงตาม round-robin (id รวมอยู่ด้วยเพื่ออัพเดท last_used_at)
      type PickedKey = { id: string; service: 'easyslip' | 'slip2go' | 'slipok'; api_key: string; branch_id?: string | null };
      let pickedKeys: PickedKey[] = [];
      let overridePicked = false;

      // (0) api_key_id override — ใช้ key ที่ระบุโดยตรง (Telegram /changeapikey flow)
      if (apiKeyIdOverride) {
        const teamSlugHeader = request.headers.get('X-Team-Slug')?.trim() || null;
        if (teamSlugHeader) {
          const overrideRow = await env.DB.prepare(
            `SELECT k.id, k.service, k.api_key, k.branch_id
             FROM team_api_keys k
             JOIN teams tm ON tm.id = k.team_id
             WHERE k.id = ? AND tm.slug = ? AND k.status = 'active' LIMIT 1`
          ).bind(apiKeyIdOverride, teamSlugHeader).first<PickedKey>();
          if (overrideRow) {
            pickedKeys = [overrideRow];
            overridePicked = true;
            log('[ScanAPI] ✅ Using api_key_id override:', { keyId: apiKeyIdOverride, service: overrideRow.service });
          }
        }
      }

      if (!overridePicked) {
        if (tenantId) {
          // LINE OA flow — หา team_id ของ tenant แล้วดึง keys ทั้งหมดจาก team_api_keys
          const tenant = await env.DB.prepare(
            'SELECT id, team_id FROM tenants WHERE id = ? AND status = ?'
          ).bind(tenantId, 'active').first<{ id: string; team_id: string }>();

          if (!tenant) {
            log('[ScanAPI] ❌ Tenant not found:', tenantId);
            return errorResponse('Tenant not found or inactive', 404);
          }

          let q: string;
          let binds: any[];
          if (requestedService) {
            q = `SELECT k.id, k.service, k.api_key, k.branch_id
               FROM team_api_keys k
               WHERE k.team_id = ? AND k.service = ? AND k.status = 'active'
               ORDER BY COALESCE(k.last_used_at, 0) ASC, k.priority ASC`;
            binds = [tenant.team_id, requestedService];
          } else {
            q = `SELECT k.id, k.service, k.api_key, k.branch_id
               FROM team_api_keys k
               WHERE k.team_id = ? AND k.status = 'active'
               ORDER BY COALESCE(k.last_used_at, 0) ASC, k.priority ASC`;
            binds = [tenant.team_id];
          }
          const keyRows = await env.DB.prepare(q).bind(...binds).all<PickedKey>();
          pickedKeys = keyRows.results || [];

          if (pickedKeys.length === 0) {
            log('[ScanAPI] ❌ No API key found for team (LINE OA flow):', tenant.team_id);
            return errorResponse('ยังไม่มี API key สำหรับทีมนี้ — กรุณาไปที่เมนู "ตั้งค่า API Keys" เพื่อเพิ่ม EasySlip, Slip2Go หรือ SlipOK', 404);
          }
          log('[ScanAPI] ✅ Using team_api_keys (LINE OA flow):', {
            count: pickedKeys.length, services: pickedKeys.map(k => k.service), tenantId,
          });
        } else {
          // X-Team-Slug flow
          const teamSlugForToken = request.headers.get('X-Team-Slug')?.trim() || null;

          if (teamSlugForToken) {
            let q: string;
            let binds: any[];
            if (requestedService) {
              q = `SELECT k.id, k.service, k.api_key, k.branch_id
                 FROM team_api_keys k
                 JOIN teams tm ON tm.id = k.team_id
                 WHERE tm.slug = ? AND k.service = ? AND k.status = 'active'
                 ORDER BY COALESCE(k.last_used_at, 0) ASC, k.priority ASC`;
              binds = [teamSlugForToken, requestedService];
            } else {
              q = `SELECT k.id, k.service, k.api_key, k.branch_id
                 FROM team_api_keys k
                 JOIN teams tm ON tm.id = k.team_id
                 WHERE tm.slug = ? AND k.status = 'active'
                 ORDER BY COALESCE(k.last_used_at, 0) ASC, k.priority ASC`;
              binds = [teamSlugForToken];
            }
            const keyRows = await env.DB.prepare(q).bind(...binds).all<PickedKey>();
            pickedKeys = keyRows.results || [];
            if (pickedKeys.length > 0) {
              log('[ScanAPI] ✅ Using team_api_keys:', {
                count: pickedKeys.length, services: pickedKeys.map(k => k.service),
              });
            }
          }

          if (pickedKeys.length === 0) {
            log('[ScanAPI] ❌ No API key found for team');
            return errorResponse('ยังไม่มี API key สำหรับทีมนี้ — กรุณาไปที่เมนู "ตั้งค่า API Keys" เพื่อเพิ่ม EasySlip, Slip2Go หรือ SlipOK', 404);
          }
        }
      }

      // สแกนสลิป — round-robin: เลือก key ที่นานสุดที่ไม่ได้ใช้ก่อนเสมอ
      // ทำเครื่องหมาย last_used_at ก่อนสแกน → request อื่นๆ ที่มาพร้อมกันจะเลือก key ถัดไปแทน
      // ถ้า key แรกล้มเหลว → fallback ไป key ถัดไปแบบ sequential (ไม่ call ซ้อนกัน)
      log('[ScanAPI] Key pool:', pickedKeys.map(k => `${k.service}(${k.id.slice(0, 6)})`).join(', '));
      let slipData: any;
      let activeProvider = 'unknown';
      const scanErrors: string[] = [];

      for (const key of pickedKeys) {
        await env.DB.prepare(`UPDATE team_api_keys SET last_used_at = ? WHERE id = ?`)
          .bind(Math.floor(Date.now() / 1000), key.id)
          .run();

        log(`[ScanAPI] 🔑 Trying key ${key.service} (${key.id.slice(0, 6)}...)`);
        try {
          slipData = await ScanService.callProvider(file, key);
          activeProvider = key.service;
          log(`[ScanAPI] ✅ Provider ${key.service} succeeded`);
          break;
        } catch (err: any) {
          scanErrors.push(`${key.service}: ${err?.message || 'unknown'}`);
          log(`[ScanAPI] ❌ Provider ${key.service} failed: ${err?.message} — trying next key...`);
        }
      }

      if (!slipData) {
        return errorResponse(`Scan failed: ${scanErrors.join(' | ')}`, 400);
      }

      if (!slipData?.success || slipData?.data?.status !== 200) {
        return errorResponse(`${activeProvider.toUpperCase()} error: ${slipData?.data?.message || 'Scan failed'}`, 400);
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
          log,
          (matchedTenant as any).api_version
        );

        if (matchedUser) {
          log('[ScanAPI] ✅ MATCHED USER:', {
            id: matchedUser.id,
            memberCode: matchedUser.memberCode,
            fullname: matchedUser.fullname,
            category: matchedUser.category,
            bankAccount: matchedUser.bankAccount || matchedUser.bank_account || 'N/A',
          });

          // 🧾 ถ้าเป็น non-member หรือไม่มี memberCode → gen memberCode (v1 only)
          // v2: ทุก user มี memberCode อยู่แล้ว ไม่ต้อง gen
          const isV2User = String((matchedTenant as any).api_version || 'v1') === 'v2';
          const needGen =
            !isV2User &&
            (!String(matchedUser.memberCode || '').trim() ||
             String(matchedUser.category || '').toLowerCase() === 'non-member');

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

      // ── Anti-Dup check (v1 only — v2 does duplicate check inside submitCreditV2) ────────────────────
      const sessionTokenForAntidup = session?.session_token as string | null;
      const isV2Tenant = String((matchedTenant as any).api_version || 'v1') === 'v2';
      if (matchedUser && matchedUser.id && !isV2Tenant) {
        try {
          const accIdForAntidup = receiverAccount && sessionTokenForAntidup
            ? await resolveToAccountId(matchedTenant.id, matchedTenant.admin_api_url, sessionTokenForAntidup, receiverAccount, env)
            : null;
          const antidupEnabled = accIdForAntidup
            ? await AntidupSettingsAPI.isEnabled(env, matchedTenant.team_id, accIdForAntidup)
            : false;

          if (antidupEnabled && sessionTokenForAntidup) {
            log('[ScanAPI] 🔍 Anti-dup check enabled for account', accIdForAntidup);

            // window 1 นาที: สลิปยอดเท่ากัน เวลาต่างกันไม่เกิน 60 วินาที = ซ้ำ
            const ANTIDUP_WINDOW_MS = 1 * 60 * 1000;
            const slipTime = normalizeTimeMs(slip.date);
            const slipAmount = slip.amount?.amount;

            // ฟังก์ชันช่วย: ดึง deposits ของ user แล้วเช็คว่ามีรายการซ้ำหรือไม่
            const findDuplicate = async (): Promise<any | null> => {
              const txListResp = await fetch(
                `${matchedTenant.admin_api_url}/api/user-transactions/list?page=1&limit=20&sortCol=transfer_at&sortAsc=desc&userId=${matchedUser.id}`,
                { headers: { Authorization: `Bearer ${sessionTokenForAntidup}`, Accept: 'application/json' } },
              );
              if (!txListResp.ok) return null;
              const txListData = await txListResp.json() as { list?: any[] };
              const deposits = (txListData.list || []).filter((t: any) => t.typeName === 'ฝาก');
              for (const dep of deposits) {
                // ใช้ tolerance 0.01 กัน floating-point เปรียบเทียบยอด
                const sameAmount =
                  typeof dep.creditAmount === 'number' && typeof slipAmount === 'number'
                    ? Math.abs(dep.creditAmount - slipAmount) < 0.01
                    : dep.creditAmount === slipAmount;
                if (sameAmount && dep.transferAt && slipTime) {
                  const depTime = normalizeTimeMs(dep.transferAt);
                  if (depTime !== null && Math.abs(depTime - slipTime) <= ANTIDUP_WINDOW_MS) {
                    return dep;
                  }
                }
              }
              return null;
            };

            // รอบแรกและรอบเดียว
            let dupDeposit = await findDuplicate();

            if (dupDeposit) {
              log('[ScanAPI] ⚠️ Anti-dup: duplicate deposit detected', {
                amount: slipAmount,
                slipDate: slip.date,
                transferAt: dupDeposit.transferAt,
              });
              return jsonResponse({
                success: false,
                error: 'พบรายการฝากซ้ำในระบบ (Anti-Dup)',
                data: {
                  status: 'duplicate',
                  tenant: { id: matchedTenant.id, name: matchedTenant.name },
                  slip: { ref: slip.transRef, amount: slipAmount, date: slip.date },
                  sender: {
                    id: matchedUser.id,
                    name: matchedUser.fullname || senderNameTh || senderNameEn || 'Unknown',
                    username: matchedUser.memberCode || matchedUser.username || null,
                    matched: true,
                  },
                },
              }, 400);
            }
          }
        } catch (antidupErr: any) {
          log('[ScanAPI] ⚠️ Anti-dup check error (non-blocking):', antidupErr?.message);
        }
      }

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
            tenant: { id: matchedTenant.id, name: matchedTenant.name },
            slip: {
              ref: slip.transRef,
              amount: slip.amount?.amount || 0,
              date: slip.date,
            },
            sender: {
              id: null,
              name: senderNameTh || senderNameEn || 'Unknown',
              username: null,
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
            status, source, scanned_by_id, scanned_by_name, scanned_by_photo, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            scannedById,
            scannedByName,
            scannedByPhoto,
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
                    username: matchedUser.memberCode || matchedUser.username || null,
                    matched: true,
                  }
                : {
                    name: senderNameTh || senderNameEn || 'Unknown',
                    username: null,
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
              slipData: { ...slip, sender: (slip as any).sender },
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
              username: matchedUser.memberCode || matchedUser.username || null,
              matched: true,
            }
          : {
              name: senderNameTh || senderNameEn || 'Unknown',
              username: null,
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

