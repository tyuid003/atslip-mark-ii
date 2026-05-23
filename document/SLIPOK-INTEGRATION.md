# SlipOK API — รายละเอียดการเชื่อมต่อ

> ใช้อ้างอิงสำหรับการเพิ่ม SlipOK เป็น provider ทางเลือกนอกจาก EasySlip ในระบบ ATslip

---

## 1. ภาพรวม

| รายการ | รายละเอียด |
|---|---|
| เว็บไซต์ | https://slipok.com |
| Base URL | `https://api.slipok.com/api/line/apikey` |
| Auth Header | `x-authorization: <API_KEY>` |
| Content-Type | `multipart/form-data` (ไฟล์) · `application/json` หรือ `application/x-www-form-urlencoded` (QR/URL) |
| ความแตกต่างจาก EasySlip | ต้องใช้ **Branch ID** คู่กับ **API Key** เสมอ |

---

## 2. Credentials ที่ต้องใช้

| ชื่อ | รูปแบบ | หมายเหตุ |
|---|---|---|
| `API Key` | string | ได้จาก SlipOK Dashboard |
| `Branch ID` | ตัวเลขเท่านั้น (`/^\d+$/`) | รหัสสาขาร้านค้า |

ทั้งสองต้องเก็บใน `tenants` table ควบคู่กัน (เช่น `slipok_api_key`, `slipok_branch_id`)

---

## 3. Endpoints

### 3.1 ตรวจสอบสลิป

```
POST https://api.slipok.com/api/line/apikey/{branchId}
x-authorization: {apiKey}
```

#### Input — 3 รูปแบบ (เลือกรูปแบบใดรูปแบบหนึ่ง)

| รูปแบบ | Field | Content-Type | หมายเหตุ |
|---|---|---|---|
| **ไฟล์ภาพ / base64** | `files` (File หรือ base64 string) | `multipart/form-data` หรือ `application/json` | รองรับ `.jpg .jpeg .png .jfif .webp` |
| **QR Code string** | `data` (string) | `application/json` | ค่า payload ที่อ่านจาก QR ขวาล่างของสลิป |
| **URL รูปภาพ** | `url` (string) | `application/json` | ไม่รองรับ Google Drive signed URL หรือ S3 signed URL |

#### Optional fields

| Field | Type | คำอธิบาย |
|---|---|---|
| `amount` | number | ยอดเงินที่ต้องการ verify — ถ้าไม่ตรงจะคืน error 1013 |
| `log` | boolean | `true` = ตรวจบัญชีผู้รับ + เก็บประวัติสลิปซ้ำ, `false` = ตรวจอย่างเดียวไม่เก็บ |

> **สำคัญ**: ควรส่ง `log: true` เพื่อป้องกันสลิปซ้ำ (ระบบจะ return error 1012 เมื่อส่งซ้ำ)

#### ตัวอย่าง Request (ไฟล์ภาพ)

```typescript
const formData = new FormData();
formData.append('files', imageFile);      // File object
formData.append('log', 'true');
formData.append('amount', '1000');        // optional

const res = await fetch(
  `https://api.slipok.com/api/line/apikey/${branchId}`,
  {
    method: 'POST',
    headers: { 'x-authorization': apiKey },
    body: formData,
  }
);
const data = await res.json();
```

#### ตัวอย่าง Request (QR Code string)

```typescript
const res = await fetch(
  `https://api.slipok.com/api/line/apikey/${branchId}`,
  {
    method: 'POST',
    headers: {
      'x-authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: '0041000600000101030040220013071152533APM077365102TH91048134',
      log: true,
      amount: 1000,
    }),
  }
);
```

---

### 3.2 ตรวจสอบ Quota

```
GET https://api.slipok.com/api/line/apikey/{branchId}/quota
x-authorization: {apiKey}
```

#### Response (success)
```json
{
  "success": true,
  "data": {
    "quota": 95,
    "overQuota": 0,
    "specialQuota": 0,
    "endDate": "2026-12-31",
    "specialEndDate": "2026-10-30"
  }
}
```

---

## 4. Response Format

### 4.1 สำเร็จ (`success: true`)

```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "✅",
    "rqUID": "783_20191108_v4UIS1K2Mobile",
    "language": "TH",
    "receivingBank": "014",
    "sendingBank": "004",
    "transRef": "010092101507665143",
    "transDate": "20240521",
    "transTime": "14:30:00",
    "transTimestamp": "2024-05-21T07:30:00.000Z",
    "amount": 1000,
    "paidLocalAmount": 1000,
    "paidLocalCurrency": "764",
    "countryCode": "TH",
    "transFeeAmount": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "toMerchantId": "",
    "sender": {
      "displayName": "นาย ธนาคาร ก",
      "name": "Mr. Thanakarn K",
      "proxy": { "type": null, "value": null },
      "account": { "type": "BANKAC", "value": "xxx-x-x0209-x" }
    },
    "receiver": {
      "displayName": "กสิกร ร",
      "name": "KASIKORN R",
      "proxy": { "type": "", "value": "" },
      "account": { "type": "BANKAC", "value": "xxx-x-x3109-x" }
    }
  }
}
```

> **หมายเหตุ**: `paidLocalCurrency` เป็น ISO 4217 numeric code เช่น `"764"` (บาทไทย) ไม่ใช่ `"THB"`

### 4.2 เกิดข้อผิดพลาด (`code` + `message`)

```json
{
  "code": 1012,
  "message": "สลิปซ้ำ สลิปนี้เคยส่งเข้ามาในระบบเมื่อ 2024-05-21T14:30:00.000Z",
  "data": { /* ข้อมูลสลิปเดิม SlipCheckInnerResponse */ }
}
```

---

## 5. Error Codes

| Code | ความหมาย | วิธีจัดการ |
|---|---|---|
| 1000 | ไม่มีข้อมูลใน field `data`, `files` หรือ `url` | ตรวจสอบว่าส่งข้อมูลมาครบ |
| 1001 | ไม่พบสาขา (Branch ID ผิด) | ตรวจสอบ Branch ID |
| 1002 | `x-authorization` header ผิด | ตรวจสอบ API Key |
| 1003 | Package หมดอายุ | ต่ออายุ Package |
| 1004 | ใช้โควต้าเกิน 400 บาท | ต่อ Package |
| 1005 | ไฟล์ไม่ใช่ภาพ | รองรับเฉพาะ `.jpg .jpeg .png .jfif .webp` |
| 1006 | รูปภาพไม่ถูกต้อง | ภาพเสียหายหรือไม่ใช่สลิป |
| 1007 | ไม่มี QR Code ในภาพ | ให้ผู้ใช้ส่งภาพสลิปจริง |
| 1008 | QR ไม่ใช่ QR การชำระเงิน | QR ผิดประเภท |
| 1009 | ระบบธนาคารขัดข้องชั่วคราว (ไม่เสียโควต้า) | Retry หลัง 15 นาที |
| 1010 | ต้องรอก่อน N นาที (สลิปธนาคาร X) | `data.delay` คือนาทีที่ต้องรอ |
| 1011 | QR หมดอายุ / ไม่มีรายการ | แจ้งผู้ใช้ว่าสลิปไม่ถูกต้อง |
| **1012** | **สลิปซ้ำ** | `data` มีข้อมูลสลิปเดิม — ใช้ detect duplicate ได้ |
| 1013 | ยอดเงินไม่ตรงกับที่ระบุ | `data.amount` คือยอดจริงในสลิป |
| 1014 | บัญชีผู้รับไม่ตรงกับที่ตั้งไว้ | ตรวจสอบบัญชีรับเงินใน SlipOK Dashboard |
| 1015 | ไม่พบข้อมูล Package | ตรวจสอบ Package ใน SlipOK Dashboard |

---

## 6. การตรวจสอบบัญชีผู้รับเงิน (เมื่อไม่ใช้ `log: true`)

ถ้าไม่ส่ง `log: true` ต้องตรวจสอบบัญชีปลายทางเองโดยอ้างอิงจาก 2 อย่าง:

### 6.1 เลขบัญชี

| กรณี | Field ที่ใช้ |
|---|---|
| ผู้รับเป็นบัญชีธนาคาร | `receiver.account.value` |
| ผู้รับเป็น PromptPay / proxy อื่น | `receiver.proxy.value` |
| รับชำระผ่าน Biller ID (EDC, KPlus Shop ฯลฯ) | `ref1` |

> **หมายเหตุ**: ค่าที่ได้ถูก mask ด้วย `x`/`X` เช่น บัญชี `9999991234` จะได้มาเป็น `XXX-X-XX123-4`  
> ต้อง normalize ก่อนเปรียบเทียบ: ตัดทุกอย่างที่ไม่ใช่ตัวเลขหรือ `x`/`X` ออก แล้วเทียบตำแหน่งของตัวเลขที่ไม่ถูก mask

### 6.2 ชื่อบัญชี

ใช้ `receiver.displayName` หรือ `receiver.name` (อาจมีแค่ field เดียว ขึ้นกับธนาคาร)

> **หมายเหตุ**: ข้อมูลอาจถูกตัดทอน ต้องใช้ **substring check** เช่น `"นาย สวัสดี ครับ"` อาจได้มาเป็น `"นาย สวัสดี ค"` เท่านั้น

---

## 7. Bank Code

| รหัส | ชื่อย่อ | ชื่อเต็ม |
|:---:|:---:|---|
| 002 | BBL | ธนาคารกรุงเทพ |
| 004 | KBANK | ธนาคารกสิกรไทย |
| 006 | KTB | ธนาคารกรุงไทย |
| 011 | TTB | ธนาคารทหารไทยธนชาต |
| 014 | SCB | ธนาคารไทยพาณิชย์ |
| 025 | BAY | ธนาคารกรุงศรีอยุธยา |
| 069 | KKP | ธนาคารเกียรตินาคินภัทร |
| 022 | CIMBT | ธนาคารซีไอเอ็มบีไทย |
| 067 | TISCO | ธนาคารทิสโก้ |
| 024 | UOBT | ธนาคารยูโอบี |
| 071 | TCD | ธนาคารไทยเครดิตเพื่อรายย่อย |
| 073 | LHFG | ธนาคารแลนด์ แอนด์ เฮ้าส์ |
| 070 | ICBCT | ธนาคารไอซีบีซี (ไทย) |
| 098 | SME | ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม |
| 034 | BAAC | ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร |
| 035 | EXIM | ธนาคารเพื่อการส่งออกและนำเข้า |
| 030 | GSB | ธนาคารออมสิน |
| 033 | GHB | ธนาคารอาคารสงเคราะห์ |

---

## 8. เปรียบเทียบกับ EasySlip (ที่ใช้อยู่)

| รายการ | EasySlip | SlipOK |
|---|---|---|
| Base URL | `https://developer.easyslip.com/api/v1/verify` | `https://api.slipok.com/api/line/apikey/{branchId}` |
| Auth | `Authorization: Bearer {token}` | `x-authorization: {apiKey}` |
| Credentials | token เดียว | apiKey + branchId |
| Input file field | `file` | `files` |
| Response root | `{ status: 200, data: {...} }` | `{ success: true, data: {...} }` |
| Sender name | `data.sender.account.name.th` | `data.sender.displayName` |
| Receiver name | `data.receiver.account.name.th` | `data.receiver.displayName` |
| Amount | `data.amount.amount` | `data.amount` (ตรงๆ) |
| Transaction ref | `data.transRef` | `data.transRef` |
| Date | `data.date` (ISO 8601) | `data.transDate` (yyyyMMdd) + `data.transTime` (HH:mm:ss) |
| Duplicate detect | ไม่มี built-in | Error 1012 + `data` ของสลิปเดิม |
| Quota check | ไม่มี | `GET /{branchId}/quota` |

---

## 9. การ Mapping ข้อมูลสู่ `pending_transactions`

| Field ใน DB | SlipOK field |
|---|---|
| `slip_ref` | `data.transRef` |
| `amount` | `data.amount` |
| `sender_name` | `data.sender.displayName` |
| `sender_account` | `data.sender.account.value` |
| `receiver_name` | `data.receiver.displayName` |
| `receiver_account` | `data.receiver.account.value` |
| `created_at` (timestamp) | parse `data.transDate` + `data.transTime` → Unix |

---

## 10. ขั้นตอนการเพิ่มใน ATslip Backend

### 8.1 เพิ่ม column ใน tenants table

```sql
ALTER TABLE tenants ADD COLUMN slipok_api_key TEXT;
ALTER TABLE tenants ADD COLUMN slipok_branch_id TEXT;
```

### 8.2 เพิ่ม field ใน `tenants` type (`types.ts`)

```typescript
slipok_api_key?: string;
slipok_branch_id?: string;
```

### 8.3 สร้าง `scanSlipWithSlipOK()` ใน `scan.service.ts`

```typescript
static async scanSlipWithSlipOK(
  imageFile: File,
  apiKey: string,
  branchId: string,
  amount?: number,
): Promise<SlipOKResponse> {
  const formData = new FormData();
  formData.append('files', imageFile);
  formData.append('log', 'true');
  if (amount) formData.append('amount', String(amount));

  const res = await fetch(
    `https://api.slipok.com/api/line/apikey/${branchId}`,
    {
      method: 'POST',
      headers: { 'x-authorization': apiKey },
      body: formData,
      signal: AbortSignal.timeout(30000),
    }
  );

  const data = await res.json<any>();

  if (data.success && data.data) {
    return { ok: true, data: data.data };
  }
  // error 1012 = dup slip — data ยังมีข้อมูลสลิป
  if (data.code === 1012) {
    return { ok: false, duplicate: true, data: data.data, code: 1012, message: data.message };
  }
  return { ok: false, code: data.code, message: data.message };
}
```

### 8.4 Logic การเลือก provider ใน `scan-queue.service.ts`

```typescript
// ถ้า tenant มี slipok_api_key → ใช้ SlipOK
// ถ้าไม่มี → fallback ไป EasySlip
const useSlipOK = !!tenant.slipok_api_key && !!tenant.slipok_branch_id;

const result = useSlipOK
  ? await ScanService.scanSlipWithSlipOK(imageFile, tenant.slipok_api_key, tenant.slipok_branch_id)
  : await ScanService.scanSlip(imageFile, tenant.easyslip_token);
```

---

## 11. ข้อควรระวัง

1. **`log: true` จำเป็นสำหรับ duplicate detection** — ถ้า `log: false` ระบบ SlipOK จะไม่จำสลิปที่ผ่านมา
2. **Branch ID ต้องเป็นตัวเลขเท่านั้น** — validate ด้วย `/^\d+$/` ก่อนเรียก API
3. **Error 1009** — ควร retry อัตโนมัติหลัง 15 นาที ไม่ใช่รายงานว่าสลิปผิด
4. **Error 1010** — `data.delay` บอกจำนวนนาทีที่ต้องรอ ควรแสดงต่อผู้ใช้
5. **ชื่อ field `files`** (ไม่ใช่ `file`) ต่างจาก EasySlip ที่ใช้ `file`
6. **Amount field** — SlipOK คืนเป็น `data.amount` (number ตรงๆ) ต่างจาก EasySlip ที่คืนเป็น `data.amount.amount`
