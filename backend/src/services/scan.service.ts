// Scan Service
// ฟังก์ชันสำหรับสแกนสลิปและจับคู่กับบัญชีธนาคาร

import type { Env } from '../types';
import { getAdminAuthHeaders } from '../utils/helpers';

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
  api_version?: string;
  accountId?: string; // ID ของบัญชีธนาคารที่ match (สำหรับใช้ใน credit submission)
}

export class ScanService {
  /**
   * Bank code (รหัส 3 หลัก ตามมาตรฐาน BOT) → ข้อมูลธนาคาร
   * ใช้แปลงผลลัพธ์ Slip2Go ให้เข้าโครง EasySlip ที่ downstream matcher ใช้
   */
  private static readonly BANK_CODE_MAP: Record<string, { id: string; short: string; name: string }> = {
    '002': { id: '002', short: 'BBL',   name: 'ธนาคารกรุงเทพ' },
    '004': { id: '004', short: 'KBANK', name: 'ธนาคารกสิกรไทย' },
    '006': { id: '006', short: 'KTB',   name: 'ธนาคารกรุงไทย' },
    '011': { id: '011', short: 'TTB',   name: 'ธนาคารทหารไทยธนชาต' },
    '014': { id: '014', short: 'SCB',   name: 'ธนาคารไทยพาณิชย์' },
    '022': { id: '022', short: 'CIMBT', name: 'ธนาคารซีไอเอ็มบีไทย' },
    '024': { id: '024', short: 'UOBT',  name: 'ธนาคารยูโอบี' },
    '025': { id: '025', short: 'BAY',   name: 'ธนาคารกรุงศรีอยุธยา' },
    '030': { id: '030', short: 'GSB',   name: 'ธนาคารออมสิน' },
    '033': { id: '033', short: 'GHB',   name: 'ธนาคารอาคารสงเคราะห์' },
    '034': { id: '034', short: 'BAAC',  name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร' },
    '035': { id: '035', short: 'EXIM',  name: 'ธนาคารเพื่อการส่งออกและนำเข้า' },
    '067': { id: '067', short: 'TISCO', name: 'ธนาคารทิสโก้' },
    '069': { id: '069', short: 'KKP',   name: 'ธนาคารเกียรตินาคินภัทร' },
    '070': { id: '070', short: 'ICBCT', name: 'ธนาคารไอซีบีซี (ไทย)' },
    '071': { id: '071', short: 'TCD',   name: 'ธนาคารไทยเครดิตเพื่อรายย่อย' },
    '073': { id: '073', short: 'LHFG',  name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์' },
    '098': { id: '098', short: 'SME',   name: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม' },
  };

  private static bankFromCode(code: string | undefined): { id?: string; short?: string; name?: string } {
    if (!code) return {};
    return this.BANK_CODE_MAP[code] || { id: code };
  }
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch('https://developer.easyslip.com/api/v1/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${easyslipToken}`,
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('EASYSLIP timeout: ใช้เวลานานเกิน 30 วินาที');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();
    let result: any;
    try {
      // EASYSLIP คืนค่าโดยตรงเป็น { status: 200, data: {...} } หรือ { status: 400, message: "..." }
      result = rawText ? JSON.parse(rawText) : {};
    } catch {
      const snippet = String(rawText || '').trim().slice(0, 220);
      if (!response.ok) {
        throw new Error(`EASYSLIP API error (${response.status}): ${snippet || response.statusText || 'invalid response'}`);
      }
      throw new Error(`EASYSLIP invalid JSON response (${response.status})`);
    }
    
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
   * สแกนสลิปโดยใช้ Slip2Go API (https://connect.slip2go.com)
   * ใช้ API Secret เดียวต่อร้าน — ไม่ต้องระบุ branch ID
   * คืนค่าเป็นรูปแบบเดียวกับ EasySlip เพื่อให้ downstream matcher ใช้ได้โดยไม่ต้องแก้
   */
  static async scanSlipWithSlip2Go(
    imageFile: File,
    apiKey: string
  ): Promise<EasySlipResponse> {
    if (!apiKey || !apiKey.trim()) throw new Error('Slip2Go API key is empty');

    const formData = new FormData();
    formData.append('file', imageFile);

    console.log('[ScanService] Calling Slip2Go API...', {
      apiKeyLen: apiKey.length,
      fileSize: imageFile.size,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch('https://connect.slip2go.com/api/verify-slip/qr-image/info', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('Slip2Go timeout: ใช้เวลานานเกิน 30 วินาที');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let result: any;
    try { result = raw ? JSON.parse(raw) : {}; }
    catch {
      throw new Error(`Slip2Go invalid JSON (HTTP ${response.status}): ${String(raw).slice(0, 200)}`);
    }

    const code = String(result?.code ?? '');
    const msg = String(result?.message || response.statusText || 'Scan failed');

    console.log('[ScanService] 📥 Slip2Go Response:', {
      httpStatus: response.status,
      code,
      message: msg,
      hasData: !!result?.data,
    });

    // success codes: 200000 = found, 200200 = found+valid
    // 200501 = duplicate slip (จัดการแบบ EasySlip duplicate)
    // 200404 = slip not found
    // 400xxx / 401xxx / 500xxx = error
    if (!response.ok || (code !== '200000' && code !== '200200')) {
      throw new Error(`Slip2Go error (${code || response.status}): ${msg}`);
    }

    const s = result.data || {};
    const senderAccount = s.sender?.account?.bank?.account ? String(s.sender.account.bank.account) : '';
    const receiverAccount = s.receiver?.account?.bank?.account ? String(s.receiver.account.bank.account) : '';
    const senderName = String(s.sender?.account?.name || '');
    const receiverName = String(s.receiver?.account?.name || '');
    const senderBankId = s.sender?.bank?.id ? String(s.sender.bank.id) : '';
    const receiverBankId = s.receiver?.bank?.id ? String(s.receiver.bank.id) : '';

    // Map → EasySlip shape ที่ downstream คาดหวัง
    const mapped = {
      payload: String(s.referenceId || ''),
      transRef: String(s.transRef || ''),
      date: String(s.dateTime || ''),
      countryCode: 'TH',
      amount: {
        amount: Number(s.amount || 0),
        local: {
          amount: Number(s.amount || 0),
          currency: '764',
        },
      },
      fee: 0,
      ref1: s.ref1 || '',
      ref2: s.ref2 || '',
      ref3: s.ref3 || '',
      sender: {
        bank: this.bankFromCode(senderBankId),
        account: {
          name: { th: senderName, en: senderName },
          bank: senderAccount ? { type: 'BANKAC' as const, account: senderAccount } : undefined,
          proxy: s.sender?.account?.proxy?.account
            ? { type: (s.sender.account.proxy.type || 'MSISDN') as any, account: String(s.sender.account.proxy.account) }
            : undefined,
        },
      },
      receiver: {
        bank: this.bankFromCode(receiverBankId),
        account: {
          name: { th: receiverName, en: receiverName },
          bank: receiverAccount ? { type: 'BANKAC' as const, account: receiverAccount } : undefined,
          proxy: s.receiver?.account?.proxy?.account
            ? { type: (s.receiver.account.proxy.type || 'MSISDN') as any, account: String(s.receiver.account.proxy.account) }
            : undefined,
        },
      },
    };

    return {
      success: true,
      data: { status: 200, data: mapped as any },
    };
  }

  /**
   * สแกนสลิปโดยใช้ SlipOK API (https://slipok.com)
   * pipeToken รูปแบบ "url|apiKey" เช่น "https://api.slipok.com/api/line/apikey/68281|SLIPOK12VCAG3"
   * ไม่ส่ง log=true เพื่อให้ตรวจสอบสลิปได้โดยไม่จำกัดเฉพาะบัญชีที่ลงทะเบียนไว้
   * คืนค่าเป็นรูปแบบเดียวกับ EasySlip เพื่อให้ downstream matcher ใช้ได้โดยไม่ต้องแก้
   */
  static async scanSlipWithSlipOK(
    imageFile: File,
    pipeToken: string,
  ): Promise<EasySlipResponse> {
    const pipeIdx = pipeToken.indexOf('|');
    if (pipeIdx === -1) throw new Error('SlipOK token ต้องเป็นรูปแบบ url|apiKey');
    const slipokUrl = pipeToken.slice(0, pipeIdx).trim();
    const apiKey = pipeToken.slice(pipeIdx + 1).trim();
    if (!slipokUrl) throw new Error('SlipOK URL is empty');
    if (!apiKey) throw new Error('SlipOK API key is empty');

    const formData = new FormData();
    formData.append('files', imageFile);
    // ไม่ส่ง log=true เพื่อให้ตรวจสอบได้โดยไม่จำกัดเฉพาะบัญชีที่ลงทะเบียนไว้

    console.log('[ScanService] Calling SlipOK API...', {
      url: slipokUrl,
      apiKeyLen: apiKey.length,
      fileSize: imageFile.size,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(slipokUrl, {
        method: 'POST',
        headers: { 'x-authorization': apiKey },
        body: formData,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('SlipOK timeout: ใช้เวลานานเกิน 30 วินาที');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let result: any;
    try { result = raw ? JSON.parse(raw) : {}; }
    catch {
      throw new Error(`SlipOK invalid JSON (HTTP ${response.status}): ${String(raw).slice(0, 200)}`);
    }

    console.log('[ScanService] 📥 SlipOK Response:', {
      httpStatus: response.status,
      success: result?.success,
      code: result?.code,
      hasData: !!result?.data,
    });

    // Error code 1012 = duplicate (ยังถือว่าสแกนได้ — ใช้ข้อมูลสลิปจาก data)
    if (result?.code === 1012 && result?.data) {
      const dup = result.data;
      console.log('[ScanService] SlipOK duplicate (1012) — using data from existing slip');
      // map เหมือนกับ success แต่ใช้ข้อมูลจาก result.data โดยตรง
      return this._mapSlipOKToEasySlip(dup);
    }

    if (!result?.success || !result?.data) {
      const code = result?.code ?? response.status;
      const msg = result?.message || response.statusText || 'Scan failed';
      throw new Error(`SlipOK error (${code}): ${msg}`);
    }

    return this._mapSlipOKToEasySlip(result.data);
  }

  /**
   * แปลง SlipOK response → EasySlip shape เพื่อให้ downstream ใช้ได้
   */
  private static _mapSlipOKToEasySlip(s: any): EasySlipResponse {
    const sendingBankId = s.sendingBank ? String(s.sendingBank) : '';
    const receivingBankId = s.receivingBank ? String(s.receivingBank) : '';

    // SlipOK account มีรูปแบบ "xxx-x-x1234-x" → ตัด x ออก ได้เลขที่เห็นได้
    const senderAccountRaw = s.sender?.account?.value || '';
    const receiverAccountRaw = s.receiver?.account?.value || '';

    // parse transDate (yyyyMMdd) + transTime (HH:mm:ss) → ISO string
    let isoDate = '';
    try {
      const d = String(s.transDate || '');
      const t = String(s.transTime || '00:00:00');
      if (d.length === 8) {
        isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t}+07:00`;
      }
    } catch { /* ignore */ }

    const mapped = {
      payload: String(s.rqUID || ''),
      transRef: String(s.transRef || ''),
      date: isoDate || String(s.transTimestamp || ''),
      countryCode: String(s.countryCode || 'TH'),
      amount: {
        amount: Number(s.amount || 0),
        local: {
          amount: Number(s.paidLocalAmount || s.amount || 0),
          currency: String(s.paidLocalCurrency || '764'),
        },
      },
      fee: Number(s.transFeeAmount || 0),
      ref1: s.ref1 || '',
      ref2: s.ref2 || '',
      ref3: s.ref3 || '',
      sender: {
        bank: this.bankFromCode(sendingBankId),
        account: {
          name: {
            th: String(s.sender?.displayName || ''),
            en: String(s.sender?.name || ''),
          },
          bank: senderAccountRaw
            ? { type: 'BANKAC' as const, account: senderAccountRaw }
            : undefined,
          proxy: s.sender?.proxy?.value
            ? { type: (s.sender.proxy.type || 'MSISDN') as any, account: String(s.sender.proxy.value) }
            : undefined,
        },
      },
      receiver: {
        bank: this.bankFromCode(receivingBankId),
        account: {
          name: {
            th: String(s.receiver?.displayName || ''),
            en: String(s.receiver?.name || ''),
          },
          bank: receiverAccountRaw
            ? { type: 'BANKAC' as const, account: receiverAccountRaw }
            : undefined,
          proxy: s.receiver?.proxy?.value
            ? { type: (s.receiver.proxy.type || 'MSISDN') as any, account: String(s.receiver.proxy.value) }
            : undefined,
        },
      },
    };

    return {
      success: true,
      data: { status: 200, data: mapped as any },
    };
  }

  /**
   * สแกนสลิปโดยใช้ Slip Verify API (https://suba.rdcw.co.th)
   * Auth: Basic base64(clientId:clientSecret)
   * api_key = "clientId|clientSecret" (pipe-separated ใน field เดียว)
   * ส่งไฟล์แบบ multipart (field name "file")
   * คืนค่าเป็นรูปแบบเดียวกับ EasySlip เพื่อให้ downstream matcher ใช้ได้
   *
   * Actual success response shape (SlipVerify v2):
   * {
   *   valid: true,
   *   data: {
   *     transRef, sendingBank, receivingBank, transDate, transTime,
   *     amount, paidLocalAmount, paidLocalCurrency, transFeeAmount,
   *     countryCode, ref1, ref2, ref3,
   *     sender:   { displayName, name, account: { type, value }, proxy: { type, value } },
   *     receiver: { displayName, name, account: { type, value }, proxy: { type, value } },
   *   }
   * }
   */
  static async scanSlipWithSlipVerify(
    imageFile: File,
    pipeToken: string,
  ): Promise<EasySlipResponse> {
    if (!pipeToken || !pipeToken.includes('|')) {
      throw new Error('Slip Verify token ต้องเป็นรูปแบบ clientId|clientSecret');
    }
    const sepIdx = pipeToken.indexOf('|');
    const clientId = pipeToken.slice(0, sepIdx).trim();
    const clientSecret = pipeToken.slice(sepIdx + 1).trim();
    if (!clientId) throw new Error('Slip Verify clientId is empty');
    if (!clientSecret) throw new Error('Slip Verify clientSecret is empty');

    const cred = btoa(`${clientId}:${clientSecret}`);

    const formData = new FormData();
    formData.append('file', imageFile);

    console.log('[ScanService] Calling Slip Verify API...', {
      clientIdLen: clientId.length,
      fileSize: imageFile.size,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch('https://suba.rdcw.co.th/v2/inquiry', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${cred}` },
        body: formData,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('SlipVerify timeout: ใช้เวลานานเกิน 30 วินาที');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let result: any;
    try { result = raw ? JSON.parse(raw) : {}; }
    catch {
      throw new Error(`SlipVerify invalid JSON (HTTP ${response.status}): ${String(raw).slice(0, 200)}`);
    }

    console.log('[ScanService] 📥 SlipVerify Response:', {
      httpStatus: response.status,
      valid: result?.valid,
      code: result?.code,
      hasData: !!result?.data,
    });

    // Error response: { code: number, message: string }
    if (!response.ok || result?.valid !== true) {
      const code = result?.code ?? response.status;
      const msg = result?.message || response.statusText || 'Scan failed';
      // code 1007 = usage exceeded, 1008 = subscription expired
      throw new Error(`SlipVerify error (${code}): ${msg}`);
    }

    // All actual data is nested under result.data
    const s = result.data;
    const sendingBankId = s.sendingBank ? String(s.sendingBank) : '';
    const receivingBankId = s.receivingBank ? String(s.receivingBank) : '';

    const senderAccountRaw = s.sender?.account?.value || '';
    const receiverAccountRaw = s.receiver?.account?.value || '';
    const senderName = String(s.sender?.displayName || s.sender?.name || '');
    const receiverName = String(s.receiver?.displayName || s.receiver?.name || '');

    // parse transDate (yyyyMMdd) + transTime (HH:mm:ss) → ISO string
    let isoDate = '';
    try {
      const d = String(s.transDate || '');
      const t = String(s.transTime || '00:00:00');
      if (d.length === 8) {
        isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t}+07:00`;
      }
    } catch { /* ignore */ }

    const mapped = {
      payload: String(result.discriminator || ''),
      transRef: String(s.transRef || ''),
      date: isoDate || String(s.transDate || ''),
      countryCode: String(s.countryCode || 'TH'),
      amount: {
        amount: Number(s.amount || 0),
        local: {
          amount: Number(s.paidLocalAmount || s.amount || 0),
          currency: String(s.paidLocalCurrency || '764'),
        },
      },
      fee: Number(s.transFeeAmount || 0),
      ref1: s.ref1 || '',
      ref2: s.ref2 || '',
      ref3: s.ref3 || '',
      sender: {
        bank: this.bankFromCode(sendingBankId),
        account: {
          name: { th: senderName, en: String(s.sender?.name || senderName) },
          bank: senderAccountRaw ? { type: 'BANKAC' as const, account: senderAccountRaw } : undefined,
          proxy: s.sender?.proxy?.value
            ? { type: (s.sender.proxy.type || 'MSISDN') as any, account: String(s.sender.proxy.value) }
            : undefined,
        },
      },
      receiver: {
        bank: this.bankFromCode(receivingBankId),
        account: {
          name: { th: receiverName, en: String(s.receiver?.name || receiverName) },
          bank: receiverAccountRaw ? { type: 'BANKAC' as const, account: receiverAccountRaw } : undefined,
          proxy: s.receiver?.proxy?.value
            ? { type: (s.receiver.proxy.type || 'MSISDN') as any, account: String(s.receiver.proxy.value) }
            : undefined,
        },
      },
    };

    return {
      success: true,
      data: { status: 200, data: mapped as any },
    };
  }

  /**
   * สแกนสลิปโดยใช้ key เดียว (เรียกจาก scan.ts หลังจากเลือก key ด้วย round-robin แล้ว)
   * ใช้แทน _callProvider แบบ private เดิม
   */
  static async callProvider(
    imageFile: File,
    key: { service: 'easyslip' | 'slip2go' | 'slipok' | 'slipverify'; api_key: string; branch_id?: string | null },
  ): Promise<EasySlipResponse> {
    if (key.service === 'slip2go') {
      return this.scanSlipWithSlip2Go(imageFile, key.api_key);
    }
    if (key.service === 'slipok') {
      // api_key = "url|apiKey" (pipe-separated)
      return this.scanSlipWithSlipOK(imageFile, key.api_key);
    }
    if (key.service === 'slipverify') {
      // api_key = "clientId|clientSecret" (pipe-separated)
      return this.scanSlipWithSlipVerify(imageFile, key.api_key);
    }
    return this.scanSlip(imageFile, key.api_key);
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
   * ตรวจว่า "นามสกุล" ในชื่อจากสลิปถูกย่อเหลืออักษรเดียว หรือไม่มีนามสกุล
   * (ธนาคารไทยมักโชว์ "ชื่อจริง + อักษรแรกของนามสกุล" เช่น "สมชาย ก")
   * เคสนี้ยืนยันตัวตนด้วยชื่ออย่างเดียวไม่ได้ → ต้องใช้เลขบัญชีช่วยตัดสิน
   */
  static hasTruncatedSurname(rawName?: string): boolean {
    const cleaned = this.removeTitlePrefix(String(rawName || '')).trim();
    if (!cleaned) return true;
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return true; // มีแต่ชื่อจริง ไม่มีนามสกุล
    const last = tokens[tokens.length - 1].replace(/[.\u200b]/g, '');
    return last.length <= 1; // นามสกุลเหลืออักษรเดียว = ย่อ
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
   * ตรวจว่าเลขบัญชีจากสลิป (ถูก mask ด้วย x/X ตามธนาคาร) ตรงกับเลขบัญชีเต็มของลูกค้าหรือไม่
   *
   * วิธีหลัก (positional regex): mask รักษาตำแหน่ง+จำนวนหลักไว้ครบ → แปลง x→\d คงเลขจริง
   *   anchor หัวท้าย แล้วเทสต์กับเลขเต็ม (ใช้เมื่อความยาว mask == ความยาวเลขลูกค้า)
   *   เช่น "xxx-x-x5587-x" → ^\d{5}5587\d$  , "462-4-xxx278" → ^4624\d{3}278$
   * วิธีสำรอง (substring): ถ้าความยาวไม่ตรง (ธนาคารคนละแบบ) ใช้ช่วงเลขจริงต่อเนื่องที่ยาวสุด
   *   (>= 4 หลัก) เป็น substring; ถ้ามีหลายช่วงต้องเจอครบและเรียงตามลำดับ
   */
  static matchSlipAccount(
    maskedSlipAccount: string,
    fullCandidateAccount: string,
    minVisibleDigits = 3
  ): { matched: boolean; method: 'regex' | 'substring' | 'none'; visibleDigits: number } {
    const cand = String(fullCandidateAccount || '').replace(/[^0-9]/g, '');
    // คงเฉพาะหลัก + สัญลักษณ์ mask (ตัด dash/ช่องว่าง/อักษรอื่น) — x/X = หลักที่ถูกซ่อน
    const norm = String(maskedSlipAccount || '').replace(/[^0-9xX]/g, '');
    const visibleDigits = (norm.match(/[0-9]/g) || []).length;

    if (!cand || visibleDigits < minVisibleDigits) {
      return { matched: false, method: 'none', visibleDigits };
    }

    // ── วิธีหลัก: positional regex (ความยาวตรงกัน + มีการ mask) ──
    if (norm.length === cand.length && /[xX]/.test(norm)) {
      const pattern = '^' + norm.replace(/[xX]/g, '\\d') + '$';
      try {
        return { matched: new RegExp(pattern).test(cand), method: 'regex', visibleDigits };
      } catch {
        // ตกไปใช้ substring ด้านล่าง
      }
    }

    // ── วิธีสำรอง: ช่วงเลขจริงต่อเนื่อง เป็น substring (เรียงตามลำดับถ้ามีหลายช่วง) ──
    const runs = norm.split(/[xX]+/).filter((r) => r.length > 0);
    const longestRun = runs.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (longestRun.length >= Math.max(minVisibleDigits, 4)) {
      let idx = 0;
      let ok = true;
      for (const r of runs) {
        const found = cand.indexOf(r, idx);
        if (found < 0) { ok = false; break; }
        idx = found + r.length;
      }
      if (ok) return { matched: true, method: 'substring', visibleDigits };
    }

    return { matched: false, method: 'none', visibleDigits };
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
        `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, t.api_version, s.session_token
         FROM tenants t
         INNER JOIN admin_sessions s ON s.tenant_id = t.id
         INNER JOIN teams tm ON tm.id = t.team_id AND tm.slug = ?
         WHERE s.expires_at > ? AND t.status = 'active'`
      )
        .bind(teamSlug, now)
        .all();
    } else {
      tenants = await env.DB.prepare(
        `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, t.api_version, s.session_token
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
    logger?: (...args: any[]) => void,
    apiVersion?: string
  ): Promise<any | null> {
    const log = logger || console.log;
    const isV2 = String(apiVersion || 'v1') === 'v2';
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

      let memberResults: any[] = [];
      let nonMemberResults: any[] = [];

      if (isV2) {
        // v2: single endpoint, no category split
        const v2Url = `${adminApiUrl}/api/proxy/v1/admin/members?page=1&limit=100&search=${encodeURIComponent(name!)}`;
        log('[ScanService] 🔎 v2 member search:', v2Url);
        try {
          const resp = await fetch(v2Url, {
            method: 'GET',
            headers: getAdminAuthHeaders(sessionToken, 'v2'),
          });
          if (resp.ok) {
            const data = await resp.json() as any;
            const list: any[] = data?.data?.list || [];
            // Normalize v2 fields: fullName → fullname, accountNumber → bankAccount
            memberResults = list.map((u: any) => ({
              ...u,
              fullname: u.fullName || u.fullname,
              bankAccount: u.accountNumber || u.bankAccount,
              bank_account: u.accountNumber || u.bank_account,
              category: 'member',
            }));
            log(`[ScanService] ✅ v2 found ${memberResults.length} member(s)`);
          } else {
            log(`[ScanService] ⚠️ v2 search failed: ${resp.status}`);
          }
        } catch (e: any) {
          log(`[ScanService] ⚠️ v2 search exception:`, e.message);
        }
        allCandidates.push(...memberResults);
        continue; // skip v1 parallel fetch
      }

      // v1: ค้นหาทั้ง member และ non-member พร้อมกัน (parallel)
      const memberUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=member`;
      const nonMemberUrl = `${adminApiUrl}/api/users/list?page=1&limit=100&search=${encodeURIComponent(name!)}&userCategory=non-member`;

      log('[ScanService] 👥👤 Trying MEMBER and NON-MEMBER categories in parallel...');
      
      const [memberResponse, nonMemberResponse] = await Promise.all([
        fetch(memberUrl, {
          method: 'GET',
          headers: getAdminAuthHeaders(sessionToken, 'v1'),
        }),
        fetch(nonMemberUrl, {
          method: 'GET',
          headers: getAdminAuthHeaders(sessionToken, 'v1'),
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
    // ⚠️ ผูก category ไว้ใน key ด้วย เพื่อไม่ให้ member กับ non-member ถูกยุบรวมเป็นคนเดียว
    // กรณีที่ memberCode ของ member ดันตรงกับ id ของ non-member (ตัวเลขชนกัน) เดิมจะถูก
    // dedup รวมเหลือ candidate เดียว → auto-match เข้าคนผิด. แยกตาม category ทำให้ชื่อซ้ำ
    // ข้ามหมวด (member + non-member) ยังคงเป็น 2 candidates → เข้าเงื่อนไข pending รอจับคู่
    const dedupMap = new Map<string, any>();
    for (const user of allCandidates) {
      const category = String(user.category || '').toLowerCase();
      const identity = String(user.memberCode || user.id || user.username || user.fullname || JSON.stringify(user));
      const key = `${category}::${identity}`;
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

    // เตรียมข้อมูลเลขบัญชีจากสลิปสำหรับใช้ยืนยัน/ตัดสิน
    const senderAccountMasked = String(senderAccount || '');
    const slipVisibleDigits = (senderAccountMasked.match(/[0-9]/g) || []).length;
    const hasSlipAccount = slipVisibleDigits >= minAccountDigits;
    const candAcctOf = (u: any) => String(u.bankAccount || u.bank_account || u.accountNumber || '');
    const acctMatches = (u: any) =>
      hasSlipAccount && this.matchSlipAccount(senderAccountMasked, candAcctOf(u), minAccountDigits).matched;

    if (nameMatchedCandidates.length === 1) {
      // ── ตรวจ "ชื่อตรงเต็ม" หรือ "เลขบัญชีตรง" ก่อน auto-match ──
      // เงื่อนไข strong name: ชื่อที่สั้นกว่าต้องถูกครอบด้วยชื่อที่ยาวกว่าทั้งหมด (substring ต่อเนื่อง)
      // ถ้าชื่อไม่เต็มแต่เลขบัญชีจากสลิปตรง → ยืนยันด้วยบัญชีได้
      const only = nameMatchedCandidates[0];
      const stripPunct = (s: string) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '');
      const s1 = stripPunct(only.bestSlipName);
      const s2 = stripPunct(only.bestCandidateName);
      const shorterLen = Math.min(s1.length, s2.length);
      const lcsLen = this.getLongestCommonSubstring(s1, s2).length;
      // ── กันเข้าผิดคนกรณี "ชื่อจริงเหมือน + นามสกุลตัวแรกเหมือน" ──
      // ถ้าสลิปโชว์นามสกุลแค่อักษรเดียว (หรือไม่มีนามสกุล) จะยืนยันด้วยชื่ออย่างเดียวไม่ได้
      // ต้องมีชื่อใดชื่อหนึ่ง (TH/EN) ที่นามสกุลครบถึงจะถือว่า strong-full-name
      const slipHasFullSurname =
        (!!senderNameTh && !this.hasTruncatedSurname(senderNameTh)) ||
        (!!senderNameEn && !this.hasTruncatedSurname(senderNameEn));
      const isStrongFullNameMatch = slipHasFullSurname && shorterLen > 0 && lcsLen >= shorterLen;
      const accountConfirmed = acctMatches(only.user);

      if (isStrongFullNameMatch || accountConfirmed) {
        log('[ScanService] ✅ RESULT: Single candidate matched', {
          fullname: only.user.fullname,
          memberCode: only.user.memberCode,
          category: only.user.category,
          reason: isStrongFullNameMatch ? 'strong-full-name' : 'account-confirmed',
          accountConfirmed,
        });
        log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED) =====');
        return only.user;
      }

      log('[ScanService] ⚠️ RESULT: Single candidate but name NOT full match and account not confirmed — pending', {
        fullname: only.user.fullname,
        memberCode: only.user.memberCode,
        slipName: only.bestSlipName,
        candidateName: only.bestCandidateName,
        lcsLen,
        requiredLen: shorterLen,
        slipHasFullSurname,
        hasSlipAccount,
      });
      log('[ScanService] 🔍 ===== SENDER MATCHING END (WEAK NAME — PENDING) =====');
      return null;
    }

    // ── ขั้นที่ 3: ชื่อซ้ำ ≥ 2 คน → ใช้เลขบัญชีจากสลิปตัดให้เหลือคนเดียว ──
    // ต่างจากเดิมที่ชื่อชนแล้ว pending เสมอ: ถ้าเลขบัญชีจากสลิปตรงกับลูกค้า "คนเดียว" → auto-match คนนั้น
    log('[ScanService] 🔎 STEP 3: Account disambiguation for duplicate names...');
    if (hasSlipAccount) {
      const accScored = nameMatchedCandidates.map((x) => {
        const res = this.matchSlipAccount(senderAccountMasked, candAcctOf(x.user), minAccountDigits);
        return { cand: x, acctMatched: res.matched, acctMethod: res.method };
      });
      const accountMatched = accScored.filter((x) => x.acctMatched);
      log('[ScanService] 📊 Account disambiguation results:', accScored.map((x) => ({
        fullname: x.cand.user.fullname,
        memberCode: x.cand.user.memberCode,
        candidateAccount: candAcctOf(x.cand.user),
        slipAccount: senderAccountMasked,
        acctMatched: x.acctMatched,
        method: x.acctMethod,
      })));

      if (accountMatched.length === 1) {
        log('[ScanService] ✅ RESULT: Disambiguated by account — unique match', {
          fullname: accountMatched[0].cand.user.fullname,
          memberCode: accountMatched[0].cand.user.memberCode,
          method: accountMatched[0].acctMethod,
        });
        log('[ScanService] 🔍 ===== SENDER MATCHING END (MATCHED BY ACCOUNT) =====');
        return accountMatched[0].cand.user;
      }
      log('[ScanService] ⚠️ Account did not resolve to a unique candidate', { matches: accountMatched.length });
    } else {
      log('[ScanService] ⏭️ No usable slip account for disambiguation (missing or < 3 digits)');
    }

    // ยังกำกวม → pending (ให้ manual match)
    log('[ScanService] ⚠️ RESULT: Multiple name matches, not resolved by account — pending', {
      totalCandidates: nameMatchedCandidates.length,
      candidates: nameMatchedCandidates.map((x) => ({
        fullname: x.user.fullname,
        memberCode: x.user.memberCode,
        category: x.user.category,
        bestNameScore: x.bestNameScore,
      })),
    });
    log('[ScanService] 🔍 ===== SENDER MATCHING END (AMBIGUOUS — PENDING) =====');
    return null;
  }
}
