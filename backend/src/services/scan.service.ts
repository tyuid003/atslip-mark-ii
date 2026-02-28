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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ScanService] EASYSLIP API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`EASYSLIP API error (${response.status}): ${response.statusText}. Please verify your EASYSLIP token is correct.`);
    }

    return await response.json() as EasySlipResponse;
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
    const prefixes = ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'เด็กชาย', 'เด็กหญิง', 'mr.', 'mrs.', 'miss', 'ms.'];
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

    // ดึง settings
    const nameMinChars = await env.DB.prepare(
      `SELECT value FROM system_settings WHERE key = 'name_match_min_chars'`
    ).first();
    const accountMinDigits = await env.DB.prepare(
      `SELECT value FROM system_settings WHERE key = 'account_match_min_digits'`
    ).first();

    const minNameChars = nameMinChars ? parseInt(nameMinChars.value as string) : 4;
    const minAccountDigits = accountMinDigits ? parseInt(accountMinDigits.value as string) : 3;

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
      return null;
    }

    // Loop แต่ละ tenant และเช็ค bank accounts
    for (const tenant of tenants.results) {
      const tenantId = tenant.id as string;
      const bankKey = `tenant:${tenantId}:banks`;

      // ดึงข้อมูลบัญชีจาก KV
      const bankData = await env.BANK_KV.get(bankKey);
      if (!bankData) continue;

      const cache = JSON.parse(bankData);
      const accounts = cache.accounts || [];

      // ค้นหาบัญชีที่ตรงกัน
      for (const account of accounts) {
        let matched = false;

        // 1. Match ชื่อธนาคาร
        if (receiverBank.name || receiverBank.short || receiverBank.id) {
          const receiverBankVariants = this.normalizeBankName(
            receiverBank.name || receiverBank.short || receiverBank.id || ''
          );

          const accountBankName = account.bankName || account.bank_name || '';
          const accountBankVariants = this.normalizeBankName(accountBankName);

          const bankMatched = receiverBankVariants.some(rv =>
            accountBankVariants.some(av => av.includes(rv) || rv.includes(av))
          );

          if (bankMatched) {
            matched = true;
          }
        }

        // 2. Match เลขบัญชี (ขั้นต่ำ 3 ตัว)
        if (!matched) {
          const accountNumber = (account.accountNumber || account.account_number || '').replace(/[^0-9]/g, '');
          const receiverAccountClean = receiverAccount.replace(/[^0-9]/g, '');

          if (accountNumber.length >= minAccountDigits && receiverAccountClean.length >= minAccountDigits) {
            for (let i = 0; i <= receiverAccountClean.length - minAccountDigits; i++) {
              const substring = receiverAccountClean.substring(i, i + minAccountDigits);
              if (accountNumber.includes(substring)) {
                matched = true;
                break;
              }
            }
          }
        }

        // 3. Match ชื่อผู้รับ
        if (!matched && (receiverNameTh || receiverNameEn)) {
          // ดึง metadata จาก D1 (ถ้ามี)
          const metadata = await env.DB.prepare(
            `SELECT account_name_th, account_name_en FROM tenant_bank_accounts 
             WHERE tenant_id = ? AND account_id = ?`
          )
            .bind(tenantId, account.id || account.accountId)
            .first();

          const accountNameTh = metadata?.account_name_th as string || account.accountName || account.account_name || '';
          const accountNameEn = metadata?.account_name_en as string || '';

          // Match ภาษาไทย
          if (receiverNameTh && accountNameTh) {
            if (this.matchName(receiverNameTh, accountNameTh, minNameChars)) {
              matched = true;
            }
          }

          // Match ภาษาอังกฤษ
          if (!matched && receiverNameEn && accountNameEn) {
            if (this.matchName(receiverNameEn, accountNameEn, minNameChars)) {
              matched = true;
            }
          }
        }

        // ถ้า match แล้วให้ return tenant นี้
        if (matched) {
          return {
            id: tenantId,
            team_id: tenant.team_id as string,
            name: tenant.name as string,
            admin_api_url: tenant.admin_api_url as string,
          };
        }
      }
    }

    return null;
  }

  /**
   * Match sender (ผู้โอน) โดยค้นหาจาก Admin API
   */
  static async matchSender(
    adminApiUrl: string,
    sessionToken: string,
    senderNameTh?: string,
    senderNameEn?: string
  ): Promise<any | null> {
    const names = [senderNameTh, senderNameEn].filter(Boolean);

    for (const name of names) {
      // Try member first
      let searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=member`;

      let response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data.list && data.list.length > 0) {
          return data.list[0]; // ส่งคืน user แรกที่เจอ
        }
      }

      // Try non-member
      searchUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=non-member`;

      response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data.list && data.list.length > 0) {
          return data.list[0];
        }
      }
    }

    return null;
  }
}
