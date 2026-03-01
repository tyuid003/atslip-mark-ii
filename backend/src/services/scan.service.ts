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
      'นาย', 'นาง', 'นางสาว', 'น.ส.', 'น.ส', 
      'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'ด.ช', 'ด.ญ',
      'mr.', 'mrs.', 'miss', 'ms.', 'mr', 'mrs', 'ms'
    ];
    let cleaned = name.trim();

    for (const prefix of prefixes) {
      const regex = new RegExp(`^${prefix}\\s*`, 'i');
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
    receiverNameEn?: string
  ): Promise<MatchedTenant | null> {
    const now = Math.floor(Date.now() / 1000);

    console.log('[ScanService] 🏦 ===== RECEIVER MATCHING START =====');
    console.log('[ScanService] 📥 Input:', {
      bank: receiverBank?.name || receiverBank?.short || receiverBank?.id || 'N/A',
      account: receiverAccount,
      nameTh: receiverNameTh,
      nameEn: receiverNameEn,
    });

    // Hard-coded matching settings
    const minNameChars = 4;
    const minAccountDigits = 3;

    console.log('[ScanService] ⚙️ Matching Settings:', {
      minNameChars,
      minAccountDigits,
    });

    // ดึงรายการ tenant ที่ active และมี session
    const tenants = await env.DB.prepare(
      `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, s.session_token
       FROM tenants t
       INNER JOIN admin_sessions s ON s.tenant_id = t.id
       WHERE s.expires_at > ? AND t.status = 'active'`
    )
      .bind(now)
      .all();

    if (!tenants.results || tenants.results.length === 0) {
      console.log('[ScanService] ❌ No active tenants with sessions found');
      console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (NO TENANTS) =====');
      return null;
    }

    console.log(`[ScanService] 🔍 Checking ${tenants.results.length} tenant(s)...`);

    // Loop แต่ละ tenant และเช็ค bank accounts
    for (const tenant of tenants.results) {
      const tenantId = tenant.id as string;
      const tenantName = tenant.name as string;
      const bankKey = `tenant:${tenantId}:banks`;

      console.log(`[ScanService] 🔎 Checking tenant: "${tenantName}" (${tenantId})`);

      // ดึงข้อมูลบัญชีจาก KV
      const bankData = await env.BANK_KV.get(bankKey);
      if (!bankData) {
        console.log(`[ScanService]   ⚠️ No bank accounts in cache for this tenant`);
        continue;
      }

      const cache = JSON.parse(bankData);
      const accounts = cache.accounts || [];

      console.log(`[ScanService]   📋 Found ${accounts.length} bank account(s)`);

      // ค้นหาบัญชีที่ตรงกัน
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        console.log(`[ScanService]   🔍 Checking account ${i + 1}/${accounts.length}...`);
        
        let bankMatched = false;
        let accountMatched = false;
        let nameMatched = false;

        // 1. Match ชื่อธนาคาร (จำเป็น)
        if (receiverBank.name || receiverBank.short || receiverBank.id) {
          const receiverBankVariants = this.normalizeBankName(
            receiverBank.name || receiverBank.short || receiverBank.id || ''
          );

          const accountBankName = account.bankName || account.bank_name || '';
          const accountBankVariants = this.normalizeBankName(accountBankName);

          bankMatched = receiverBankVariants.some(rv =>
            accountBankVariants.some(av => av.includes(rv) || rv.includes(av))
          );

          console.log('[ScanService] 🔍 Bank Match:', {
            receiverBankInput: receiverBank.name || receiverBank.short || receiverBank.id,
            receiverBankVariants,
            accountBankName,
            accountBankVariants,
            bankMatched,
          });
        }

        // ถ้าธนาคารไม่ตรง ข้ามไปบัญชีถัดไปเลย
        if (!bankMatched) {
          continue;
        }

        // 2. Match เลขบัญชี (ขั้นต่ำ 3 ตัว)
        const accountNumber = (account.accountNumber || account.account_number || '').replace(/[^0-9]/g, '');
        const receiverAccountClean = receiverAccount.replace(/[^0-9]/g, '');

        if (accountNumber.length >= minAccountDigits && receiverAccountClean.length >= minAccountDigits) {
          for (let i = 0; i <= receiverAccountClean.length - minAccountDigits; i++) {
            const substring = receiverAccountClean.substring(i, i + minAccountDigits);
            if (accountNumber.includes(substring)) {
              accountMatched = true;
              break;
            }
          }
        }

        console.log('[ScanService] 🔍 Account Match:', {
          receiverAccountInput: receiverAccount,
          receiverAccountClean,
          tenantAccountNumber: accountNumber,
          minAccountDigits,
          accountMatched,
        });

        // 3. Match ชื่อผู้รับ (ถ้าเลขบัญชีไม่ตรง)
        if (!accountMatched && (receiverNameTh || receiverNameEn)) {
          // ดึง metadata จาก D1 (ถ้ามี)
          const metadata = await env.DB.prepare(
            `SELECT account_name_th, account_name_en FROM tenant_bank_accounts 
             WHERE tenant_id = ? AND account_id = ?`
          )
            .bind(tenantId, account.accountNumber || account.account_number || account.id || account.accountId)
            .first();

          const accountNameTh = metadata?.account_name_th as string || account.accountName || account.name || account.account_name || '';
          const accountNameEn = metadata?.account_name_en as string || '';

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

          console.log('[ScanService] 🔍 Name Match:', {
            receiverNameTh,
            receiverNameEn,
            accountNameTh,
            accountNameEn,
            minNameChars,
            nameMatched,
          });
        }

        // ถ้า match ธนาคาร AND (เลขบัญชี OR ชื่อ) ให้ return tenant นี้
        if (bankMatched && (accountMatched || nameMatched)) {
          const matchedAccountId = account.id || account.accountId || account.accountNumber || account.account_number || '';
          console.log(`[ScanService]     ✅ MATCH! Bank: ✓ | Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'}`);
          console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (MATCHED) =====');
          console.log('[ScanService] ✅ Matched Tenant:', {
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
          console.log(`[ScanService]     ❌ No match - Bank: ${bankMatched ? '✓' : '✗'} | Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'}`);
        }
      }
    }

    console.log('[ScanService] ❌ No tenant matched');
    console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (NO MATCH) =====');
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
    
    log('[ScanService] 🔍 ===== SENDER MATCHING START =====');
    log('[ScanService] 📥 Input:', {
      nameTh: senderNameTh,
      nameEn: senderNameEn,
      account: senderAccount,
      bank: senderBank?.name || senderBank?.short || senderBank?.id || 'N/A',
    });

    // ตัดคำนำหน้าออกก่อนค้นหา
    const cleanedNameTh = senderNameTh ? this.removeTitlePrefix(senderNameTh) : null;
    const cleanedNameEn = senderNameEn ? this.removeTitlePrefix(senderNameEn) : null;
    
    log('[ScanService] 🔧 Cleaned names (removed title prefix):', {
      originalTh: senderNameTh,
      cleanedTh: cleanedNameTh,
      originalEn: senderNameEn,
      cleanedEn: cleanedNameEn,
    });

    const names = [cleanedNameTh, cleanedNameEn].filter(Boolean);
    let allCandidates: any[] = [];

    // ขั้นที่ 1: ค้นหาจากชื่อก่อน
    log('[ScanService] 🔎 STEP 1: Searching by name...');
    
    for (const name of names) {
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

    log(`[ScanService] ✅ Total candidates found: ${allCandidates.length}`);
    log('[ScanService] 📋 Candidates:', allCandidates.map(u => ({
      category: u.category,
      fullname: u.fullname,
      memberCode: u.memberCode,
      bankAccount: u.bankAccount || u.bank_account || 'N/A',
    })));

    // ถ้าเจอคนเดียว return เลย
    if (allCandidates.length === 1) {
      log('[ScanService] ✅ RESULT: Only 1 candidate, auto-matched!', {
        fullname: allCandidates[0].fullname,
        memberCode: allCandidates[0].memberCode,
        category: allCandidates[0].category,
      });
      log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
      return allCandidates[0];
    }

    // ขั้นที่ 2: Filter ด้วยเลขบัญชี (ถ้ามี)
    log('[ScanService] 🔎 STEP 2: Filtering by account number...');
    
    if (senderAccount && senderAccount.length >= 4) {
      const senderAccountClean = senderAccount.replace(/[^0-9]/g, '');
      const last4Sender = senderAccountClean.slice(-4);
      
      log(`[ScanService] 💳 Sender account (last 4): ${last4Sender}`);

      const accountMatched = allCandidates.filter(user => {
        const userAccount = user.bankAccount || user.bank_account || '';
        if (!userAccount) {
          log(`[ScanService]   ❌ ${user.fullname}: No bank account`);
          return false;
        }
        
        const userAccountClean = userAccount.replace(/[^0-9]/g, '');
        const last4User = userAccountClean.slice(-4);
        
        const matched = last4Sender === last4User;
        log(`[ScanService]   ${matched ? '✅' : '❌'} ${user.fullname}: ${last4User} ${matched ? '(MATCH!)' : '(no match)'}`);
        
        return matched;
      });

      if (accountMatched.length > 0) {
        log(`[ScanService] ✅ Filtered by account: ${accountMatched.length} match(es)`);
        allCandidates = accountMatched;
        
        if (allCandidates.length === 1) {
          log('[ScanService] ✅ RESULT: Matched by name + account!', {
            fullname: allCandidates[0].fullname,
            memberCode: allCandidates[0].memberCode,
            category: allCandidates[0].category,
            account: allCandidates[0].bankAccount || allCandidates[0].bank_account,
          });
          log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
          return allCandidates[0];
        }
      } else {
        log('[ScanService] ⚠️ No account matches, keeping all name matches');
      }
    } else {
      log('[ScanService] ⏭️ Skipped: No sender account or too short');
    }

    // ขั้นที่ 3: Filter ด้วยธนาคาร (ถ้ามี) - เช็คว่าตรงกับ tenant หรือไม่
    // เนื่องจากผู้ใช้อาจมีหลายธนาคาร เราไม่ filter ตรงนี้
    // เพราะอาจทำให้พลาด user ที่ถูกต้อง
    log('[ScanService] 🔎 STEP 3: Bank filtering skipped (users may have multiple banks)');

    // Return คนแรกที่ match ดีที่สุด
    log('[ScanService] ⚠️ RESULT: Multiple candidates remain, selecting first one:', {
      totalCandidates: allCandidates.length,
      selected: {
        fullname: allCandidates[0].fullname,
        memberCode: allCandidates[0].memberCode,
        category: allCandidates[0].category,
        account: allCandidates[0].bankAccount || allCandidates[0].bank_account || 'N/A',
      },
      otherCandidates: allCandidates.slice(1).map(u => ({
        fullname: u.fullname,
        memberCode: u.memberCode,
      })),
    });
    log('[ScanService] 🔍 ===== SENDER MATCHING END (BEST MATCH) =====');
    return allCandidates[0];
  }
}
