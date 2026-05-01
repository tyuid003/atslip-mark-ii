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
  team_slug?: string;
  name: string;
  admin_api_url: string;
  accountId?: string; // ID ของบัญชีธนาคารที่ match (สำหรับใช้ใน credit submission)
}

interface ReceiverCandidate {
  tenantId: string;
  teamId: string;
  teamSlug?: string;
  tenantName: string;
  adminApiUrl: string;
  accountId: string;
  accountNumber: string;
  accountNameTh: string;
  accountNameEn: string;
  bankName: string;
  bankMatched: boolean;
  accountMatched: boolean;
  accountExact: boolean;
  nameScore: number;
  nameMatchType: 'thai' | 'english-mapping' | 'none';
  longestCommonChars: number;
  totalScore: number;
}

interface EnglishNameMapping {
  tenantId: string;
  accountId: string;
  accountNumber: string;
  accountNameTh: string;
  accountNameEn: string;
  bankName: string;
}

interface NameMatchScore {
  score: number;
  longestCommonChars: number;
  exact: boolean;
  contains: boolean;
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
    formData.append('image', imageFile);

    console.log('[ScanService] Calling EASYSLIP API v2...', {
      tokenLength: easyslipToken.length,
      tokenStart: easyslipToken.substring(0, 8),
      fileSize: imageFile.size,
      fileType: imageFile.type,
    });

    const response = await fetch('https://api.easyslip.com/v2/verify/bank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${easyslipToken}`,
      },
      body: formData,
    });

    // EASYSLIP v2 คืนค่า { success: true, data: {...} } หรือ { success: false, error: { code, message } }
    const result = await response.json() as any;
    
    console.log('[ScanService] 📥 EASYSLIP Response:', {
      httpStatus: response.status,
      httpOk: response.ok,
      resultSuccess: result.success,
      hasData: !!result.data,
      hasError: !!result.error,
    });

    // Log ข้อมูลสลิปที่ได้รับ (ถ้า success)
    if (result.success && result.data) {
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
        resultSuccess: result.success,
        message: result.error?.message || result.message,
      });
      throw new Error(`EASYSLIP API error (${response.status}): ${result.error?.message || result.message || response.statusText}`);
    }

    // ตรวจสอบ success ใน response body
    if (!result.success) {
      console.error('[ScanService] EASYSLIP returned unsuccessful response:', result);
      throw new Error(`EASYSLIP error: ${result.error?.message || result.message || 'Scan failed'}`);
    }

    // แปลงเป็นรูปแบบที่เราต้องการ (คง shape เดิมเพื่อ backward compat กับ scan.ts)
    return {
      success: true,
      data: { status: 200, data: result.data },
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
   * จัดรูปแบบชื่อเพื่อใช้ในการ match
   */
  static normalizePersonName(name: string): string {
    return this.removeTitlePrefix(name)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  static getLongestCommonSubstringLength(left: string, right: string): number {
    if (!left || !right) {
      return 0;
    }

    const previous = new Array(right.length + 1).fill(0);
    const current = new Array(right.length + 1).fill(0);
    let maxLength = 0;

    for (let i = 1; i <= left.length; i++) {
      for (let j = 1; j <= right.length; j++) {
        if (left[i - 1] === right[j - 1]) {
          current[j] = previous[j - 1] + 1;
          if (current[j] > maxLength) {
            maxLength = current[j];
          }
        } else {
          current[j] = 0;
        }
      }

      for (let j = 0; j <= right.length; j++) {
        previous[j] = current[j];
        current[j] = 0;
      }
    }

    return maxLength;
  }

  /**
   * ให้คะแนนการ match ของชื่อ โดยยังคงยอมรับ substring >= 4 ตัวอักษรเป็น candidate
   * แต่ไม่ให้ substring สั้น ๆ ชนะด้วยตัวเองง่ายเกินไป
   */
  static scoreNameMatch(name1: string, name2: string, minChars: number = 4): NameMatchScore {
    const cleaned1 = this.normalizePersonName(name1);
    const cleaned2 = this.normalizePersonName(name2);

    if (!cleaned1 || !cleaned2 || cleaned1.length < minChars || cleaned2.length < minChars) {
      return {
        score: 0,
        longestCommonChars: 0,
        exact: false,
        contains: false,
      };
    }

    if (cleaned1 === cleaned2) {
      return {
        score: 120,
        longestCommonChars: cleaned1.length,
        exact: true,
        contains: true,
      };
    }

    const contains = cleaned1.includes(cleaned2) || cleaned2.includes(cleaned1);
    if (contains) {
      return {
        score: 95,
        longestCommonChars: Math.min(cleaned1.length, cleaned2.length),
        exact: false,
        contains: true,
      };
    }

    const longestCommonChars = this.getLongestCommonSubstringLength(cleaned1, cleaned2);
    if (longestCommonChars < minChars) {
      return {
        score: 0,
        longestCommonChars,
        exact: false,
        contains: false,
      };
    }

    if (longestCommonChars >= 8) {
      return {
        score: 80,
        longestCommonChars,
        exact: false,
        contains: false,
      };
    }

    if (longestCommonChars >= 6) {
      return {
        score: 60,
        longestCommonChars,
        exact: false,
        contains: false,
      };
    }

    if (longestCommonChars >= 5) {
      return {
        score: 40,
        longestCommonChars,
        exact: false,
        contains: false,
      };
    }

    return {
      score: 20,
      longestCommonChars,
      exact: false,
      contains: false,
    };
  }

  static getAccountMatchDetails(receiverAccount: string, accountNumber: string, minDigits: number): {
    matched: boolean;
    exact: boolean;
  } {
    const receiverAccountClean = receiverAccount.replace(/[^0-9]/g, '');
    const tenantAccountNumber = accountNumber.replace(/[^0-9]/g, '');

    if (!receiverAccountClean || !tenantAccountNumber) {
      return {
        matched: false,
        exact: false,
      };
    }

    if (receiverAccountClean === tenantAccountNumber) {
      return {
        matched: true,
        exact: true,
      };
    }

    if (tenantAccountNumber.length < minDigits || receiverAccountClean.length < minDigits) {
      return {
        matched: false,
        exact: false,
      };
    }

    for (let i = 0; i <= receiverAccountClean.length - minDigits; i++) {
      const substring = receiverAccountClean.substring(i, i + minDigits);
      if (tenantAccountNumber.includes(substring)) {
        return {
          matched: true,
          exact: false,
        };
      }
    }

    return {
      matched: false,
      exact: false,
    };
  }

  static async loadEnglishNameMappings(
    env: Env,
    tenantIds: string[]
  ): Promise<Map<string, EnglishNameMapping[]>> {
    const mappingByTenant = new Map<string, EnglishNameMapping[]>();

    if (tenantIds.length === 0) {
      return mappingByTenant;
    }

    const placeholders = tenantIds.map(() => '?').join(', ');
    const result = await env.DB.prepare(
      `SELECT tenant_id, account_id, account_number, account_name_th, account_name_en, bank_name
       FROM tenant_bank_accounts
       WHERE tenant_id IN (${placeholders})
         AND account_name_en IS NOT NULL
         AND TRIM(account_name_en) != ''`
    )
      .bind(...tenantIds)
      .all();

    for (const row of result.results || []) {
      const tenantId = row.tenant_id as string;
      const mappings = mappingByTenant.get(tenantId) || [];
      mappings.push({
        tenantId,
        accountId: String(row.account_id || ''),
        accountNumber: String(row.account_number || '').replace(/[^0-9]/g, ''),
        accountNameTh: String(row.account_name_th || ''),
        accountNameEn: String(row.account_name_en || ''),
        bankName: String(row.bank_name || ''),
      });
      mappingByTenant.set(tenantId, mappings);
    }

    return mappingByTenant;
  }

  /**
   * Match receiver (บัญชีรับ) กับ tenant
   * ลำดับการ match:
   * 1. ชื่อธนาคาร
  * 2. เลขบัญชี (ขั้นต่ำ 4 ตัว)
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
    const minAccountDigits = 4;
    const minimumStandaloneNameScore = 40;
    const minimumWinningMargin = 15;

    console.log('[ScanService] ⚙️ Matching Settings:', {
      minNameChars,
      minAccountDigits,
      minimumStandaloneNameScore,
      minimumWinningMargin,
    });

    // ดึงรายการ tenant ที่ active และมี session
    const tenants = await env.DB.prepare(
      `SELECT DISTINCT t.id, t.team_id, tm.slug as team_slug, t.name, t.admin_api_url, s.session_token
       FROM tenants t
       INNER JOIN teams tm ON tm.id = t.team_id
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

    const activeTenants = tenants.results.map((tenant) => ({
      id: tenant.id as string,
      teamId: tenant.team_id as string,
      teamSlug: tenant.team_slug as string,
      name: tenant.name as string,
      adminApiUrl: tenant.admin_api_url as string,
    }));
    const receiverAccountClean = receiverAccount.replace(/[^0-9]/g, '');
    const hasReceiverThaiName = Boolean(receiverNameTh?.trim());
    const hasReceiverEnglishName = Boolean(receiverNameEn?.trim());
    const englishMappingsByTenant = hasReceiverEnglishName
      ? await this.loadEnglishNameMappings(env, activeTenants.map((tenant) => tenant.id))
      : new Map<string, EnglishNameMapping[]>();
    const candidates: ReceiverCandidate[] = [];

    // Loop แต่ละ tenant และเช็ค bank accounts
    for (const tenant of activeTenants) {
      const tenantId = tenant.id;
      const tenantName = tenant.name;
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
        let nameScore = 0;
        let longestCommonChars = 0;
        let nameMatchType: ReceiverCandidate['nameMatchType'] = 'none';

        // 1. Match ชื่อธนาคาร (จำเป็น)
        if (receiverBank?.name || receiverBank?.short || receiverBank?.id) {
          const receiverBankVariants = this.normalizeBankName(
            receiverBank?.name || receiverBank?.short || receiverBank?.id || ''
          );

          const accountBankName = account.bankName || account.bank_name || '';
          const accountBankVariants = this.normalizeBankName(accountBankName);

          bankMatched = receiverBankVariants.some(rv =>
            accountBankVariants.some(av => av.includes(rv) || rv.includes(av))
          );

          console.log('[ScanService] 🔍 Bank Match:', {
            receiverBankInput: receiverBank?.name || receiverBank?.short || receiverBank?.id,
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

        // 2. Match เลขบัญชี (ขั้นต่ำ 4 หลัก) - ใช้เป็นข้อมูลประกอบ
        const accountNumber = (account.accountNumber || account.account_number || '').replace(/[^0-9]/g, '');
        const accountMatch = this.getAccountMatchDetails(receiverAccount, accountNumber, minAccountDigits);
        accountMatched = accountMatch.matched;

        console.log('[ScanService] 🔍 Account Match:', {
          receiverAccountInput: receiverAccount,
          receiverAccountClean,
          tenantAccountNumber: accountNumber,
          minAccountDigits,
          accountMatched,
          accountExact: accountMatch.exact,
        });

        const accountId = String(
          account.id || account.accountId || account.accountNumber || account.account_number || ''
        );
        const accountNameTh = String(account.accountName || account.name || account.account_name || '');
        let accountNameEn = '';

        if (hasReceiverThaiName && accountNameTh) {
          const thaiNameMatch = this.scoreNameMatch(receiverNameTh || '', accountNameTh, minNameChars);
          nameScore = thaiNameMatch.score;
          longestCommonChars = thaiNameMatch.longestCommonChars;
          if (thaiNameMatch.score > 0) {
            nameMatched = true;
            nameMatchType = 'thai';
          }
        }

        if (!nameMatched && hasReceiverEnglishName) {
          const englishMappings = englishMappingsByTenant.get(tenantId) || [];
          const mapping = englishMappings.find((item) => {
            const mappingBankVariants = this.normalizeBankName(item.bankName || account.bankName || account.bank_name || '');
            const bankCompatible = receiverBank?.name || receiverBank?.short || receiverBank?.id
              ? this.normalizeBankName(receiverBank?.name || receiverBank?.short || receiverBank?.id || '').some(rv =>
                  mappingBankVariants.some(av => av.includes(rv) || rv.includes(av))
                )
              : true;

            if (!bankCompatible) {
              return false;
            }

            if (item.accountId && accountId && item.accountId === accountId) {
              return true;
            }

            return Boolean(item.accountNumber && accountNumber && item.accountNumber === accountNumber);
          });

          if (mapping?.accountNameEn) {
            const englishNameMatch = this.scoreNameMatch(receiverNameEn || '', mapping.accountNameEn, minNameChars);
            if (englishNameMatch.score > 0) {
              nameMatched = true;
              nameScore = englishNameMatch.score;
              longestCommonChars = englishNameMatch.longestCommonChars;
              nameMatchType = 'english-mapping';
              accountNameEn = mapping.accountNameEn;
            }
          }
        }

        console.log('[ScanService] 🔍 Name Match:', {
          receiverNameTh,
          receiverNameEn,
          accountNameTh,
          accountNameEn,
          minNameChars,
          nameMatched,
          nameScore,
          longestCommonChars,
          nameMatchType,
        });

        const hasReceiverName = hasReceiverThaiName || hasReceiverEnglishName;
        const hasStrongNameMatch = nameScore >= minimumStandaloneNameScore;

        const isCandidateMatched = hasReceiverName
          ? (bankMatched && (hasStrongNameMatch || (nameMatched && accountMatched)))
          : (bankMatched && accountMatched);
        const totalScore = nameScore
          + (accountMatch.exact ? 35 : accountMatched ? 15 : 0)
          + (bankMatched ? 5 : 0);

        if (isCandidateMatched) {
          candidates.push({
            tenantId,
            teamId: tenant.teamId,
            teamSlug: tenant.teamSlug,
            tenantName,
            adminApiUrl: tenant.adminApiUrl,
            accountId,
            accountNumber,
            accountNameTh,
            accountNameEn,
            bankName: String(account.bankName || account.bank_name || ''),
            bankMatched,
            accountMatched,
            accountExact: accountMatch.exact,
            nameScore,
            nameMatchType,
            longestCommonChars,
            totalScore,
          });
          console.log(`[ScanService]     ✅ CANDIDATE! Bank: ✓ | Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'} | Score: ${totalScore}`);
        } else {
          console.log(`[ScanService]     ❌ No match - Bank: ${bankMatched ? '✓' : '✗'} | Account: ${accountMatched ? '✓' : '✗'} | Name: ${nameMatched ? '✓' : '✗'}`);
        }
      }
    }

    if (candidates.length === 0) {
      console.log('[ScanService] ❌ No tenant matched');
      console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (NO MATCH) =====');
      return null;
    }

    const sortedCandidates = [...candidates].sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      if (right.nameScore !== left.nameScore) {
        return right.nameScore - left.nameScore;
      }
      if (right.longestCommonChars !== left.longestCommonChars) {
        return right.longestCommonChars - left.longestCommonChars;
      }
      if (right.accountExact !== left.accountExact) {
        return Number(right.accountExact) - Number(left.accountExact);
      }
      if (right.accountMatched !== left.accountMatched) {
        return Number(right.accountMatched) - Number(left.accountMatched);
      }
      return left.tenantName.localeCompare(right.tenantName);
    });

    console.log('[ScanService] 📊 Candidate Summary:', sortedCandidates.slice(0, 5).map((candidate) => ({
      tenant: candidate.tenantName,
      accountId: candidate.accountId,
      accountNumber: candidate.accountNumber,
      accountNameTh: candidate.accountNameTh,
      accountNameEn: candidate.accountNameEn,
      bankName: candidate.bankName,
      nameMatchType: candidate.nameMatchType,
      nameScore: candidate.nameScore,
      longestCommonChars: candidate.longestCommonChars,
      accountMatched: candidate.accountMatched,
      accountExact: candidate.accountExact,
      totalScore: candidate.totalScore,
    })));

    const bestCandidate = sortedCandidates[0];
    const secondCandidate = sortedCandidates[1];
    const isAmbiguous = Boolean(
      secondCandidate &&
      bestCandidate.totalScore - secondCandidate.totalScore < minimumWinningMargin
    );

    if (isAmbiguous) {
      console.log('[ScanService] ⚠️ Ambiguous receiver match - refusing auto match:', {
        bestCandidate,
        secondCandidate,
        minimumWinningMargin,
      });
      console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (AMBIGUOUS) =====');
      return null;
    }

    console.log(`[ScanService]     ✅ MATCH! Bank: ✓ | Account: ${bestCandidate.accountMatched ? '✓' : '✗'} | Name: ${bestCandidate.nameScore > 0 ? '✓' : '✗'} | Score: ${bestCandidate.totalScore}`);
    console.log('[ScanService] 🏦 ===== RECEIVER MATCHING END (MATCHED) =====');
    console.log('[ScanService] ✅ Matched Tenant:', {
      id: bestCandidate.tenantId,
      team_id: bestCandidate.teamId,
      team_slug: bestCandidate.teamSlug,
      name: bestCandidate.tenantName,
      admin_api_url: bestCandidate.adminApiUrl,
      accountId: bestCandidate.accountId,
      accountNumber: bestCandidate.accountNumber,
      accountNameTh: bestCandidate.accountNameTh,
      accountNameEn: bestCandidate.accountNameEn,
      nameMatchType: bestCandidate.nameMatchType,
      totalScore: bestCandidate.totalScore,
    });
    return {
      id: bestCandidate.tenantId,
      team_id: bestCandidate.teamId,
      team_slug: bestCandidate.teamSlug,
      name: bestCandidate.tenantName,
      admin_api_url: bestCandidate.adminApiUrl,
      accountId: bestCandidate.accountId,
    };
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

    // ⚠️ ถ้ายังเหลือหลายคน ไม่ควร auto-match เพราะอาจผิดคน → ให้บันทึกเป็น "รอจับคู่" แทน
    if (allCandidates.length > 1) {
      log('[ScanService] ⚠️ RESULT: Multiple candidates remain - SKIP AUTO-MATCH (ambiguous):', {
        totalCandidates: allCandidates.length,
        candidates: allCandidates.map(u => ({
          fullname: u.fullname,
          memberCode: u.memberCode,
          category: u.category,
          account: u.bankAccount || u.bank_account || 'N/A',
        })),
      });
      log('[ScanService] 🔍 ===== SENDER MATCHING END (NO AUTO-MATCH - AMBIGUOUS) =====');
      return null; // ไม่ match อัตโนมัติ ให้บันทึกเป็นรอจับคู่
    }

    // ถ้าเหลือคนเดียว return เลย
    log('[ScanService] ✅ RESULT: Final match after filtering:', {
      fullname: allCandidates[0].fullname,
      memberCode: allCandidates[0].memberCode,
      category: allCandidates[0].category,
    });
    log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
    return allCandidates[0];
  }
}
