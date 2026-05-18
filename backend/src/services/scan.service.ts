// Scan Service
// ฟังก์ชันสำหรับสแกนสลิปและจับคู่กับบัญชีธนาคาร

import type { Env } from '../types';

interface EasySlipResponse {
  success: boolean;
  data: {
    status: number;
    data: {
      payload: string;
      transRef: string;
      date: string;
      countryCode: string;
      amount: {
        amount: number;
        local: {
          amount?: number;
          currency?: string;
        };
      };
      fee?: number;
      ref1?: string;
      ref2?: string;
      ref3?: string;
      sender: {
        bank: {
          id?: string;
          name?: string;
          short?: string;
        };
        account: {
          name: {
            th?: string;
            en?: string;
          };
          bank?: {
            type: 'BANKAC' | 'TOKEN' | 'DUMMY';
            account: string;
          };
          proxy?: {
            type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID';
            account: string;
          };
        };
      };
      receiver: {
        bank: {
          id?: string;
          name?: string;
          short?: string;
        };
        account: {
          name: {
            th?: string;
            en?: string;
          };
          bank?: {
            type: 'BANKAC' | 'TOKEN' | 'DUMMY';
            account: string;
          };
          proxy?: {
            type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID';
            account: string;
          };
        };
      };
    };
  };
}

interface MatchedTenant {
  id: string;
  team_id: string;
  name: string;
  admin_api_url: string;
  accountId?: string; // ID ของบัญชีธนาคารที่ match (สำหรับใช้ใน credit submission)
}

export class ScanService {
  /**
   * สแกนสลิปโดยใช้ EASYSLIP API
   */
  static async scanSlip(imageFile: File, easyslipToken: string): Promise<EasySlipResponse> {
    // Validate token ก่อน
    if (!easyslipToken || easyslipToken.trim() === '' || easyslipToken === 'null') {
      throw new Error('EASYSLIP token is empty or invalid. Please configure it in tenant settings.');
    }

    const formData = new FormData();
    formData.append('file', imageFile);

    console.log('[ScanService] Calling EASYSLIP API...', {
      tokenLength: easyslipToken.length,
      tokenStart: easyslipToken.substring(0, 8),
      fileSize: imageFile.size,
      fileType: imageFile.type,
    });

    const response = await fetch('https://developer.easyslip.com/api/v1/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${easyslipToken}`,
      },
      body: formData,
    });

    // EASYSLIP คืนค่าโดยตรงเป็น { status: 200, data: {...} } หรือ { status: 400, message: "..." }
    const result = await response.json() as any;
    
    console.log('[ScanService] 📥 EASYSLIP Response:', {
      httpStatus: response.status,
      httpOk: response.ok,
      resultStatus: result.status,
      hasData: !!result.data,
      hasMessage: !!result.message,
    });

    // Log ข้อมูลสลิปที่ได้รับ (ถ้า success)
    if (result.status === 200 && result.data) {
      const slip = result.data;
      console.log('[ScanService] 📋 Slip Data:', {
        transRef: slip.transRef,
        amount: slip.amount?.amount,
        date: slip.date,
        sender: {
          bank: slip.sender?.bank?.name || slip.sender?.bank?.short || slip.sender?.bank?.id,
          account: slip.sender?.account?.bank?.account || slip.sender?.account?.proxy?.account,
          name: slip.sender?.account?.name?.th || slip.sender?.account?.name?.en,
        },
        receiver: {
          bank: slip.receiver?.bank?.name || slip.receiver?.bank?.short || slip.receiver?.bank?.id,
          account: slip.receiver?.account?.bank?.account || slip.receiver?.account?.proxy?.account,
          name: slip.receiver?.account?.name?.th || slip.receiver?.account?.name?.en,
        },
      });
    }

    if (!response.ok) {
      console.error('[ScanService] EASYSLIP API HTTP error:', {
        httpStatus: response.status,
        statusText: response.statusText,
        resultStatus: result.status,
        message: result.message,
      });
      throw new Error(`EASYSLIP API error (${response.status}): ${result.message || response.statusText}`);
    }

    // ตรวจสอบ status ใน response body
    if (result.status !== 200) {
      console.error('[ScanService] EASYSLIP returned non-200 status:', result);
      throw new Error(`EASYSLIP error (${result.status}): ${result.message || 'Scan failed'}`);
    }

    // แปลงเป็นรูปแบบที่เราต้องการ
    return {
      success: true,
      data: result, // { status: 200, data: {...} }
    };
  }

  /**
   * จัดรูปแบบชื่อธนาคาร (normalize bank names)
   * เนื่องจากชื่อธนาคารอาจมีหลายรูปแบบ เช่น "กสิกร", "กสิกรไทย", "ธนาคารกสิกรไทย", "KBANK"
   */
  static normalizeBankName(name: string): string[] {
    const normalized = name.toLowerCase().trim();
    const variants: string[] = [normalized];

    // Mapping ชื่อธนาคารที่เป็นไปได้
    const bankNameMap: { [key: string]: string[] } = {
      'กสิกร': ['กสิกร', 'กสิกรไทย', 'ธนาคารกสิกรไทย', 'kbank', 'kasikorn'],
      'กรุงเทพ': ['กรุงเทพ', 'ธนาคารกรุงเทพ', 'bbl', 'bangkok bank'],
      'ไทยพาณิชย์': ['ไทยพาณิชย์', 'ธนาคารไทยพาณิชย์', 'scb', 'siam commercial'],
      'กรุงไทย': ['กรุงไทย', 'ธนาคารกรุงไทย', 'ktb', 'krung thai'],
      'ทหารไทย': ['ทหารไทย', 'ทหารไทยธนชาต', 'ธนาคารทหารไทย', 'ttb', 'tmb', 'tmbtthanachart'],
      'กรุงศรี': ['กรุงศรี', 'กรุงศรีอยุธยา', 'ธนาคารกรุงศรีอยุธยา', 'bay', 'krungsri'],
      'ออมสิน': ['ออมสิน', 'ธนาคารออมสิน', 'gsb', 'government savings'],
      'ธกส': ['ธกส', 'ธนาคารเพื่อการเกษตร', 'baac', 'bank for agriculture'],
      'เกียรตินาคิน': ['เกียรตินาคิน', 'เกียรตินาคินภัทร', 'ธนาคารเกียรตินาคิน', 'kkp', 'kiatnakin'],
      'ซีไอเอ็มบี': ['ซีไอเอ็มบี', 'cimb', 'cimb thai'],
      'ทิสโก้': ['ทิสโก้', 'tisco'],
      'ยูโอบี': ['ยูโอบี', 'uob', 'united overseas bank'],
      'แลนด์แอนด์เฮ้าส์': ['แลนด์แอนด์เฮ้าส์', 'lh', 'land and houses'],
      'ไอซีบีซี': ['ไอซีบีซี', 'icbc'],
    };

    // ค้นหาว่าชื่อนี้ตรงกับธนาคารไหน
    for (const [key, values] of Object.entries(bankNameMap)) {
      if (values.some(v => normalized.includes(v) || v.includes(normalized))) {
        return values;
      }
    }

    return variants;
  }

  /**
   * ตัดคำนำหน้าออกจากชื่อ
   */
  static removeTitlePrefix(name: string): string {
    const prefixes = [
      'เด็กหญิง', 'เด็กชาย', 'นางสาว',
      'ด.ญ.', 'ด.ช.', 'น.ส.',
      'ด.ญ', 'ด.ช', 'น.ส',
      'นาย', 'นาง',
      'miss', 'mrs.', 'mrs', 'mr.', 'mr', 'ms.', 'ms',
    ];
    let cleaned = name.trim();

    for (const prefix of prefixes) {
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escapedPrefix}\\s*`, 'i');
      cleaned = cleaned.replace(regex, '');
    }

    return cleaned.trim();
  }

  /**
   * ตรวจสอบว่าชื่อตรงกันหรือไม่ (ขั้นต่ำ 4 ตัวอักษร)
   */
  static matchName(name1: string, name2: string, minChars: number = 4): boolean {
    const cleaned1 = this.removeTitlePrefix(name1).toLowerCase().replace(/\s+/g, '');
    const cleaned2 = this.removeTitlePrefix(name2).toLowerCase().replace(/\s+/g, '');

    // ตรวจสอบว่ามีส่วนที่ตรงกัน >= minChars
    for (let i = 0; i <= cleaned1.length - minChars; i++) {
      const substring = cleaned1.substring(i, i + minChars);
      if (cleaned2.includes(substring)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize ชื่อสำหรับการ match
   * - ตัดคำนำหน้า
   * - แปลงเป็น lowercase
   * - ลบช่องว่างทั้งหมด
   */
  static normalizeNameForMatch(name: string): string {
    return this.removeTitlePrefix(name || '').toLowerCase().replace(/\s+/g, '').trim();
  }

  /**
   * หา longest common substring (ตำแหน่งใดก็ได้)
   */
  static getLongestCommonSubstring(a: string, b: string): { length: number; chunk: string } {
    const left = String(a || '');
    const right = String(b || '');
    const maxLen = Math.min(left.length, right.length);

    for (let len = maxLen; len >= 1; len--) {
      for (let start = 0; start <= left.length - len; start++) {
        const chunk = left.substring(start, start + len);
        if (right.includes(chunk)) {
          return { length: len, chunk };
        }
      }
    }

    return { length: 0, chunk: '' };
  }

  /**
   * Match receiver (บัญชีรับ) กับ tenant
   * ลำดับการ match:
   * 1. ชื่อธนาคาร
   * 2. เลขบัญชี (ขั้นต่ำ 3 ตัว)
   * 3. ชื่อผู้รับ (ทั้งภาษาไทยและอังกฤษ)
   */
  static async matchReceiver(
    env: Env,
    receiverBank: { id?: string; name?: string; short?: string },
    receiverAccount: string,
    receiverNameTh?: string,
    receiverNameEn?: string,
    teamSlug?: string,
    logger?: (...args: any[]) => void,
    traceMode: 'normal' | 'manual' = 'normal'
  ): Promise<MatchedTenant | null> {
    const log = logger || console.log;
    const isManualTrace = traceMode === 'manual';
    const now = Math.floor(Date.now() / 1000);

    log('[ScanService] 🏦 ===== RECEIVER MATCHING START =====');
    log('[ScanService] 📥 Input:', {
      bank: receiverBank?.name || receiverBank?.short || receiverBank?.id || 'N/A',
      account: receiverAccount,
      nameTh: receiverNameTh,
      nameEn: receiverNameEn,
    });

    if (isManualTrace) {
      const cleanedReceiverNameTh = receiverNameTh ? this.removeTitlePrefix(receiverNameTh) : '';
      const cleanedReceiverNameEn = receiverNameEn ? this.removeTitlePrefix(receiverNameEn) : '';
      log('[ScanService][ManualTrace] Customer receiver normalized:', {
        receiverAccountRaw: receiverAccount,
        receiverAccountClean: receiverAccount.replace(/[^0-9]/g, ''),
        receiverNameThOriginal: receiverNameTh || '',
        receiverNameThCleaned: cleanedReceiverNameTh,
        receiverNameThPrefixRemoved: !!receiverNameTh && cleanedReceiverNameTh !== receiverNameTh.trim(),
        receiverNameEnOriginal: receiverNameEn || '',
        receiverNameEnCleaned: cleanedReceiverNameEn,
        receiverNameEnPrefixRemoved: !!receiverNameEn && cleanedReceiverNameEn !== receiverNameEn.trim(),
      });
    }

    // Hard-coded matching settings
    const minNameChars = 4;
    const minAccountDigits = 3;

    log('[ScanService] ⚙️ Matching Settings:', {
      minNameChars,
      minAccountDigits,
      traceMode,
    });

    // ดึงรายการ tenant ที่ active และมี session
    // ถ้าระบุ teamSlug ให้กรองเฉพาะ tenant ในทีมนั้น (ป้องกัน match ผิด team)
    let tenants;
    if (teamSlug && teamSlug !== 'default') {
      tenants = await env.DB.prepare(
        `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, s.session_token
         FROM tenants t
         INNER JOIN admin_sessions s ON s.tenant_id = t.id
         INNER JOIN teams tm ON tm.id = t.team_id AND tm.slug = ?
         WHERE s.expires_at > ? AND t.status = 'active'`
      )
        .bind(teamSlug, now)
        .all();
    } else {
      tenants = await env.DB.prepare(
        `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, s.session_token
         FROM tenants t
         INNER JOIN admin_sessions s ON s.tenant_id = t.id
         WHERE s.expires_at > ? AND t.status = 'active'`
      )
        .bind(now)
        .all();
    }

    if (!tenants.results || tenants.results.length === 0) {
      log('[ScanService] ❌ No active tenants with sessions found');
      log('[ScanService] 🏦 ===== RECEIVER MATCHING END (NO TENANTS) =====');
      return null;
    }

    log(`[ScanService] 🔍 Checking ${tenants.results.length} tenant(s)...`);

    // Loop แต่ละ tenant และเช็ค bank accounts
    for (const tenant of tenants.results) {
      const tenantId = tenant.id as string;
      const tenantName = tenant.name as string;
      const bankKey = `tenant:${tenantId}:banks`;

      log(`[ScanService] 🔎 Checking tenant: "${tenantName}" (${tenantId})`);

      // ดึงข้อมูลบัญชีจาก KV
      const bankData = await env.BANK_KV.get(bankKey);
      if (!bankData) {
        log(`[ScanService]   ⚠️ No bank accounts in cache for this tenant`);
        continue;
      }

      const cache = JSON.parse(bankData);
      const accounts = cache.accounts || [];

      log(`[ScanService]   📋 Found ${accounts.length} bank account(s)`);

      // ค้นหาบัญชีที่ตรงกัน
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        log(`[ScanService]   🔍 Checking account ${i + 1}/${accounts.length}...`);

        if (isManualTrace) {
          log('[ScanService][ManualTrace] Tenant candidate account:', {
            tenantId,
            tenantName,
            accountIndex: i + 1,
            accountTotal: accounts.length,
            tenantBankName: account.bankName || account.bank_name || '',
            tenantAccountNumber: String(account.accountNumber || account.account_number || '').replace(/[^0-9]/g, ''),
            tenantAccountNameRaw: account.accountName || account.name || account.account_name || '',
          });
        }
        
        let accountMatched = false;
        let nameMatched = false;
        // ไม่ใช้ชื่อธนาคารเป็นเงื่อนไข match เพราะรูปแบบชื่อธนาคารไทยไม่คงที่
        log('[ScanService] 🔍 Bank Match: SKIPPED (using only name + account)');

        // 2. Match ชื่อผู้รับก่อน — ต้องเช็คเสมอ
        if (receiverNameTh || receiverNameEn) {
          // ดึง metadata จาก D1 (ถ้ามี)
          const metadata = await env.DB.prepare(
            `SELECT account_name_th, account_name_en FROM tenant_bank_accounts 
             WHERE tenant_id = ? AND account_id = ?`
          )
            .bind(tenantId, account.accountNumber || account.account_number || account.id || account.accountId)
            .first();

          const accountNameTh = metadata?.account_name_th as string || account.accountName || account.name || account.account_name || '';
          const accountNameEn = metadata?.account_name_en as string || '';

          const cleanedReceiverNameTh = receiverNameTh ? this.removeTitlePrefix(receiverNameTh).replace(/\s+/g, '') : '';
          const cleanedReceiverNameEn = receiverNameEn ? this.removeTitlePrefix(receiverNameEn).replace(/\s+/g, '') : '';
          const cleanedAccountNameTh = accountNameTh ? this.removeTitlePrefix(accountNameTh).replace(/\s+/g, '') : '';
          const cleanedAccountNameEn = accountNameEn ? this.removeTitlePrefix(accountNameEn).replace(/\s+/g, '') : '';

          if (isManualTrace) {
            log('[ScanService][ManualTrace] Name normalization (customer vs tenant):', {
              customer: {
                receiverNameThOriginal: receiverNameTh || '',
                receiverNameThCleaned: cleanedReceiverNameTh,
                receiverNameThPrefixRemoved: !!receiverNameTh && cleanedReceiverNameTh !== receiverNameTh.replace(/\s+/g, ''),
                receiverNameEnOriginal: receiverNameEn || '',
                receiverNameEnCleaned: cleanedReceiverNameEn,
                receiverNameEnPrefixRemoved: !!receiverNameEn && cleanedReceiverNameEn !== receiverNameEn.replace(/\s+/g, ''),
              },
              tenant: {
                accountNameThOriginal: accountNameTh,
                accountNameThCleaned: cleanedAccountNameTh,
                accountNameThPrefixRemoved: cleanedAccountNameTh !== accountNameTh.replace(/\s+/g, ''),
                accountNameEnOriginal: accountNameEn,
                accountNameEnCleaned: cleanedAccountNameEn,
                accountNameEnPrefixRemoved: cleanedAccountNameEn !== accountNameEn.replace(/\s+/g, ''),
              },
            });
          }

          // Match ภาษาไทย
          if (receiverNameTh && accountNameTh) {
            if (this.matchName(receiverNameTh, accountNameTh, minNameChars)) {
              nameMatched = true;
            }
          }

          // Match ภาษาอังกฤษ
          if (!nameMatched && receiverNameEn && accountNameEn) {
            if (this.matchName(receiverNameEn, accountNameEn, minNameChars)) {
              nameMatched = true;
            }
          }

          log('[ScanService] 🔍 Name Match:', {
            receiverNameTh,
            receiverNameEn,
            accountNameTh,
            accountNameEn,
            cleanedReceiverNameTh,
            cleanedReceiverNameEn,
            cleanedAccountNameTh,
            cleanedAccountNameEn,
            minNameChars,
            nameMatched,
          });
        }

        // 3. Match เลขบัญชีแบบตำแหน่งไหนก็ได้ (ขั้นต่ำ 3 ตัว)
        const accountNumber = (account.accountNumber || account.account_number || '').replace(/[^0-9]/g, '');
        const receiverAccountClean = receiverAccount.replace(/[^0-9]/g, '');
        const maxCommonLen = Math.min(accountNumber.length, receiverAccountClean.length);
        let matchedAccountChunk = '';
        let matchedAccountChunkLen = 0;

        if (accountNumber.length >= minAccountDigits && receiverAccountClean.length >= minAccountDigits) {
          // ใช้ common substring จากเลขบัญชีสลิปไปหาในเลขบัญชี tenant
          for (let len = maxCommonLen; len >= minAccountDigits && !accountMatched; len--) {
            for (let start = 0; start <= receiverAccountClean.length - len; start++) {
              const chunk = receiverAccountClean.substring(start, start + len);
              if (accountNumber.includes(chunk)) {
                accountMatched = true;
                matchedAccountChunk = chunk;
                matchedAccountChunkLen = len;
                break;
              }
            }
          }
        }

        log('[ScanService] 🔍 Account Match:', {
          receiverAccountInput: receiverAccount,
          receiverAccountClean,
          tenantAccountNumber: accountNumber,
          maxCommonLen,
          matchedAccountChunk,
          matchedAccountChunkLen,
          minAccountDigits,
          accountMatched,
        });

        // ตามเงื่อนไขใหม่: ต้อง match ชื่อ + เลขบัญชี
        if (accountMatched && nameMatched) {
          const matchedAccountId = account.id || account.accountId || account.accountNumber || account.account_number || '';
          log(`[ScanService]     ✅ MATCH! Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'}`);
          log('[ScanService] 🏦 ===== RECEIVER MATCHING END (MATCHED) =====');
          log('[ScanService] ✅ Matched Tenant:', {
            id: tenantId,
            team_id: tenant.team_id as string,
            name: tenantName,
            admin_api_url: tenant.admin_api_url as string,
            accountId: matchedAccountId,
          });
          return {
            id: tenantId,
            team_id: tenant.team_id as string,
            name: tenant.name as string,
            admin_api_url: tenant.admin_api_url as string,
            accountId: matchedAccountId,
          };
        } else {
          log(`[ScanService]     ❌ No match - Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'}`);
        }
      }
    }

    log('[ScanService] ❌ No tenant matched');
    log('[ScanService] 🏦 ===== RECEIVER MATCHING END (NO MATCH) =====');
    return null;
  }

  /**
   * Match sender (ผู้โอน) โดยค้นหาจาก Admin API
   * ค้นหาจากชื่อก่อน แล้ว filter ด้วยเลขบัญชีและธนาคาร (ถ้ามี)
   */
  static async matchSender(
    adminApiUrl: string,
    sessionToken: string,
    senderNameTh?: string,
    senderNameEn?: string,
    senderAccount?: string,
    senderBank?: { id?: string; name?: string; short?: string },
    logger?: (...args: any[]) => void
  ): Promise<any | null> {
    const log = logger || console.log;
    const minNameChars = 4;
    const minAccountDigits = 3;
    
    log('[ScanService] 🔍 ===== SENDER MATCHING START =====');
    log('[ScanService] 📥 Input:', {
      nameTh: senderNameTh,
      nameEn: senderNameEn,
      account: senderAccount,
      bank: senderBank?.name || senderBank?.short || senderBank?.id || 'N/A',
    });

    // เตรียมชื่อจากสลิป: ตัดคำนำหน้า + ลบช่องว่างทั้งหมด
    const cleanedNameTh = senderNameTh ? this.normalizeNameForMatch(senderNameTh) : '';
    const cleanedNameEn = senderNameEn ? this.normalizeNameForMatch(senderNameEn) : '';

    log('[ScanService] 🔧 Cleaned names (removed title prefix + all spaces):', {
      originalTh: senderNameTh,
      cleanedTh: cleanedNameTh,
      originalEn: senderNameEn,
      cleanedEn: cleanedNameEn,
    });

    const slipNames = Array.from(new Set([cleanedNameTh, cleanedNameEn].filter(Boolean)));
    const searchNames = Array.from(
      new Set([
        senderNameTh ? this.removeTitlePrefix(senderNameTh).trim() : '',
        senderNameEn ? this.removeTitlePrefix(senderNameEn).trim() : '',
      ].filter(Boolean))
    );

    if (slipNames.length === 0) {
      log('[ScanService] ❌ RESULT: No sender name from slip to match');
      log('[ScanService] 🔍 ===== SENDER MATCHING END (NO MATCH) =====');
      return null;
    }

    let allCandidates: any[] = [];

    // ขั้นที่ 1: ค้นหาจากชื่อก่อน
    log('[ScanService] 🔎 STEP 1: Searching by name...');
    
    for (const name of searchNames) {
      log(`[ScanService] 🔍 Searching for: "${name}"`);
      
      // ค้นหาทั้ง member และ non-member พร้อมกัน (parallel)
      const memberUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=member`;
      const nonMemberUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=non-member`;

      log('[ScanService] 👥👤 Trying MEMBER and NON-MEMBER categories in parallel...');
      
      const [memberResponse, nonMemberResponse] = await Promise.all([
        fetch(memberUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Accept': 'application/json',
          },
        }),
        fetch(nonMemberUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Accept': 'application/json',
          },
        })
      ]);

      // Process member results
      if (memberResponse.ok) {
        const data = await memberResponse.json() as any;
        if (data.list && data.list.length > 0) {
          log(`[ScanService] ✅ Found ${data.list.length} MEMBER(s)`);
          allCandidates.push(...data.list.map((u: any) => ({ ...u, category: 'member' })));
        } else {
          log('[ScanService] ❌ No members found');
        }
      } else {
        log(`[ScanService] ⚠️ Member search failed: ${memberResponse.status}`);
      }

      // Process non-member results
      if (nonMemberResponse.ok) {
        const data = await nonMemberResponse.json() as any;
        if (data.list && data.list.length > 0) {
          log(`[ScanService] ✅ Found ${data.list.length} NON-MEMBER(s)`);
          allCandidates.push(...data.list.map((u: any) => ({ ...u, category: 'non-member' })));
        } else {
          log('[ScanService] ❌ No non-members found');
        }
      } else {
        log(`[ScanService] ⚠️ Non-member search failed: ${nonMemberResponse.status}`);
      }
    }

    // ถ้าไม่เจอเลย
    if (allCandidates.length === 0) {
      log('[ScanService] ❌ RESULT: No candidates found by name');
      log('[ScanService] 🔍 ===== SENDER MATCHING END (NO MATCH) =====');
      return null;
    }

    // Deduplicate candidates
    const dedupMap = new Map<string, any>();
    for (const user of allCandidates) {
      const key = String(user.memberCode || user.id || user.username || user.fullname || JSON.stringify(user));
      if (!dedupMap.has(key)) {
        dedupMap.set(key, user);
      }
    }
    allCandidates = Array.from(dedupMap.values());

    log(`[ScanService] ✅ Total candidates found: ${allCandidates.length}`);
    log('[ScanService] 📋 Candidates:', allCandidates.map(u => ({
      category: u.category,
      fullname: u.fullname,
      memberCode: u.memberCode,
      bankAccount: u.bankAccount || u.bank_account || 'N/A',
    })));

    // ขั้นที่ 2: match ชื่อแบบตำแหน่งไหนก็ได้ ขั้นต่ำ 4 ตัว (ไทย/อังกฤษ)
    log('[ScanService] 🔎 STEP 2: Name scoring (any-position substring, >= 4 chars)...');

    const nameScored = allCandidates.map((user) => {
      const candidateNames = [
        this.normalizeNameForMatch(String(user.fullname || '')),
        this.normalizeNameForMatch(String(user.username || '')),
      ].filter(Boolean);

      let bestNameScore = 0;
      let bestSlipName = '';
      let bestCandidateName = '';

      for (const slipName of slipNames) {
        for (const candidateName of candidateNames) {
          const { length } = this.getLongestCommonSubstring(slipName, candidateName);
          if (length > bestNameScore) {
            bestNameScore = length;
            bestSlipName = slipName;
            bestCandidateName = candidateName;
          }
        }
      }

      return {
        user,
        bestNameScore,
        bestSlipName,
        bestCandidateName,
      };
    });

    const nameMatchedCandidates = nameScored.filter((x) => x.bestNameScore >= minNameChars);
    log('[ScanService] 📊 Name score results:', nameScored.map((x) => ({
      fullname: x.user.fullname,
      memberCode: x.user.memberCode,
      category: x.user.category,
      bestNameScore: x.bestNameScore,
      nameMatched: x.bestNameScore >= minNameChars,
    })));

    if (nameMatchedCandidates.length === 0) {
      log('[ScanService] ❌ RESULT: No candidates passed name matching (>= 4 chars)');
      log('[ScanService] 🔍 ===== SENDER MATCHING END (NO MATCH) =====');
      return null;
    }

    if (nameMatchedCandidates.length === 1) {
      log('[ScanService] ✅ RESULT: Single candidate after name matching', {
        fullname: nameMatchedCandidates[0].user.fullname,
        memberCode: nameMatchedCandidates[0].user.memberCode,
        category: nameMatchedCandidates[0].user.category,
        bestNameScore: nameMatchedCandidates[0].bestNameScore,
      });
      log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
      return nameMatchedCandidates[0].user;
    }

    // ขั้นที่ 3: ถ้าเจอชื่อซ้ำ ให้เช็คเลขบัญชีตำแหน่งไหนก็ได้ขั้นต่ำ 3 หลัก
    log('[ScanService] 🔎 STEP 3: Account scoring for duplicate names (any-position substring, >= 3 digits)...');
    const senderAccountClean = String(senderAccount || '').replace(/[^0-9]/g, '');

    if (senderAccountClean.length >= minAccountDigits) {
      const accountScored = nameMatchedCandidates.map((x) => {
        const candidateAccount = String(x.user.bankAccount || x.user.bank_account || '').replace(/[^0-9]/g, '');
        const { length: bestAccountScore, chunk: bestAccountChunk } = this.getLongestCommonSubstring(senderAccountClean, candidateAccount);

        return {
          ...x,
          candidateAccount,
          bestAccountScore,
          bestAccountChunk,
        };
      });

      const accountMatchedCandidates = accountScored.filter((x) => x.bestAccountScore >= minAccountDigits);
      log('[ScanService] 📊 Account score results:', accountScored.map((x) => ({
        fullname: x.user.fullname,
        memberCode: x.user.memberCode,
        bestNameScore: x.bestNameScore,
        bestAccountScore: x.bestAccountScore,
        bestAccountChunk: x.bestAccountChunk,
        accountMatched: x.bestAccountScore >= minAccountDigits,
      })));

      if (accountMatchedCandidates.length === 1) {
        log('[ScanService] ✅ RESULT: Unique candidate after account matching', {
          fullname: accountMatchedCandidates[0].user.fullname,
          memberCode: accountMatchedCandidates[0].user.memberCode,
          category: accountMatchedCandidates[0].user.category,
          bestNameScore: accountMatchedCandidates[0].bestNameScore,
          bestAccountScore: accountMatchedCandidates[0].bestAccountScore,
          bestAccountChunk: accountMatchedCandidates[0].bestAccountChunk,
        });
        log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
        return accountMatchedCandidates[0].user;
      }

      if (accountMatchedCandidates.length > 1) {
        // ถ้าชื่อซ้ำและเลขบัญชีซ้ำ ให้เลือกคนที่ชื่อตรงกันเยอะกว่า
        accountMatchedCandidates.sort((a, b) => {
          if (b.bestNameScore !== a.bestNameScore) return b.bestNameScore - a.bestNameScore;
          return b.bestAccountScore - a.bestAccountScore;
        });

        const selected = accountMatchedCandidates[0];
        log('[ScanService] ⚠️ RESULT: Multiple account matches, selected by highest name score', {
          totalCandidates: accountMatchedCandidates.length,
          selected: {
            fullname: selected.user.fullname,
            memberCode: selected.user.memberCode,
            category: selected.user.category,
            bestNameScore: selected.bestNameScore,
            bestAccountScore: selected.bestAccountScore,
          },
        });
        log('[ScanService] 🔍 ===== SENDER MATCHING END (BEST MATCH) =====');
        return selected.user;
      }
    } else {
      log('[ScanService] ⏭️ Skipped account scoring: sender account missing or < 3 digits');
    }

    // fallback: เลือกคนที่ชื่อตรงกันเยอะที่สุด
    nameMatchedCandidates.sort((a, b) => b.bestNameScore - a.bestNameScore);
    const selected = nameMatchedCandidates[0];
    log('[ScanService] ⚠️ RESULT: Selected by highest name score (no decisive account match)', {
      totalCandidates: nameMatchedCandidates.length,
      selected: {
        fullname: selected.user.fullname,
        memberCode: selected.user.memberCode,
        category: selected.user.category,
        bestNameScore: selected.bestNameScore,
      },
    });
    log('[ScanService] 🔍 ===== SENDER MATCHING END (BEST MATCH) =====');
    return selected.user;
  }
}
