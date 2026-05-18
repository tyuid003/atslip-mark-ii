# ATslipMark-II

ระบบสแกนสลิปและเติมเครดิตอัตโนมัติแบบ Multi-tenant บน Cloudflare Workers โดยเชื่อมต่อ Admin API ของแต่ละ tenant เพื่อค้นหาผู้ใช้, จัดการบัญชีรับ, เติมเครดิต, และดึงเครดิตกลับ

## Production Deployment (Cloudflare)

โปรเจกต์นี้รันบน Cloudflare ทั้งหมด ใช้ edge network ของ Cloudflare เป็นตัวให้บริการ ทำให้ API/หน้าเว็บใช้งานได้ทั่วโลก (low latency จาก data center ใกล้ผู้ใช้ที่สุด) ไม่ต้องผูกกับ IP ของเซิร์ฟเวอร์เดี่ยว ๆ จึงไม่มีปัญหา "บางเครื่อง/บางเครือข่ายเข้าไม่ได้" แบบโฮสต์เดิม

| ส่วน | บริการ | ชื่อโปรเจกต์ Cloudflare | URL ใช้งานจริง |
| --- | --- | --- | --- |
| Backend API | Cloudflare Workers + D1 + KV + Durable Objects | `atslip-backend` | `https://app.atslip.biz/api/*` |
| Frontend | Cloudflare Pages (static) | `atslip-frontend` | preview: `https://<hash>.atslip-frontend.pages.dev` |

### คำสั่ง deploy ที่ใช้จริง

```powershell
# Backend (Workers)
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:PATH
cd backend
wrangler deploy

# Frontend (Pages) — รันจากในโฟลเดอร์ frontend
cd frontend
npx wrangler pages deploy . --project-name atslip-frontend
```

> ใน PowerShell ของเครื่องนี้ต้อง prepend PATH ของ Node.js ก่อน เพราะ `wrangler` ไม่ได้ติดตั้งแบบ global ของระบบ

### Bindings สำคัญ (อ้างอิงจาก `backend/wrangler.toml`)

- `DB` — D1 database `atslip_db`
- `BANK_KV` — KV namespace สำหรับ cache บัญชี/banks
- `REALTIME` — Durable Object สำหรับ WebSocket realtime
- `app.atslip.biz/api/*` — route ที่ผูกไว้บน zone `atslip.biz`
- cron `*/30 * * * *` — refresh bank accounts ของ tenant ที่ session ยัง active

## โครงสร้างโปรเจกต์ (ปัจจุบัน)

- `backend/` - Worker API + D1 + KV + Durable Object
- `frontend/` - หน้าแอดมินสำหรับจัดการ tenant และรายการ pending
- `document/OLDVERSION/` - โค้ดและเอกสารเวอร์ชันเก่า (archive)

## เทคโนโลยีหลัก

- Cloudflare Workers (TypeScript)
- D1 (ฐานข้อมูล)
- KV (cache บัญชีธนาคาร)
- Durable Objects (realtime pending notifications)
- Frontend HTML/CSS/Vanilla JS

## การทำงานหลักของระบบ

1. รับสลิปผ่าน `POST /api/scan/upload`
2. สแกนผ่าน EasySlip
3. จับคู่ tenant จากบัญชีผู้รับ
4. จับคู่ผู้โอนจาก Admin API (`/api/users/list`)
5. บันทึก `pending_transactions`
6. ถ้า tenant เปิด auto-deposit จะเรียกเติมเครดิตทันที
7. ถ้าไม่สำเร็จ/ไม่ match จะให้จัดการจากหน้า pending แบบ manual

---

## Internal API (Worker)

อ้างอิงจาก router ปัจจุบันใน `backend/src/index.ts`

### Teams

- `GET /api/teams`
- `GET /api/teams/:slug`

### Tenants

- `GET /api/tenants`
  - Header/Query ที่รองรับ: `X-Team-Slug` หรือ `?team=`
- `POST /api/tenants`
  - Body:
    - `name` (string)
    - `admin_api_url` (string)
    - `admin_username` (string)
    - `admin_password` (string)
    - `easyslip_token` (string)
- `GET /api/tenants/:id`
- `PUT /api/tenants/:id`
  - Body (partial): `name`, `admin_api_url`, `admin_username`, `admin_password`, `easyslip_token`, `status`
- `DELETE /api/tenants/:id`
- `POST /api/tenants/:id/connect`
- `POST /api/tenants/:id/disconnect`
- `GET /api/tenants/:id/accounts`
- `PATCH /api/tenants/:id/auto-deposit`
  - Body: `{ "enabled": boolean }`

### Admin Login / Session

- `GET /api/tenants/:id/captcha`
- `POST /api/tenants/:id/login`
  - Body: `{ "captcha_key": string, "captcha_code": string }`
- `POST /api/tenants/:id/refresh-accounts`

### Tenant Bank Accounts Metadata

- `GET /api/tenants/:id/bank-accounts/metadata`
- `POST /api/tenants/:id/bank-accounts/sync`
- `POST /api/tenants/:tenantId/bank-accounts/:accountId/metadata`
- `PATCH /api/bank-accounts/:id/english-name`
  - Body: `{ "english_name": string }`

### LINE OA

- `GET /api/tenants/:tenantId/line-oas`
- `POST /api/tenants/:tenantId/line-oas`
  - Body:
    - `name`
    - `channel_id`
    - `channel_secret`
    - `channel_access_token`
- `GET /api/line-oas/:id`
- `PUT /api/line-oas/:id`
  - Body (partial): `name`, `channel_id`, `channel_secret`, `channel_access_token`, `webhook_enabled`, `status`
- `DELETE /api/line-oas/:id`

### Users

- `GET /api/users/search?q=<term>&category=<member|non-member>&tenant_id=<id>`

### Pending Transactions

- `GET /api/pending-transactions?limit=<1..50>`
- `GET /api/pending-transactions/search?page=<n>&limit=<1..50>&tenantId=<id>&status=<>&dateFrom=<unix>&dateTo=<unix>`
  - ใช้สำหรับหน้า "ดูเพิ่มเติม" (full scan log) — รองรับ pagination + filter ช่วงวันที่/สถานะ/tenant ภายในทีมเดียวกัน
- `DELETE /api/pending-transactions/:id`
- `PATCH /api/pending-transactions/:id/match`
  - Body: `{ "matched_user_id": string, "matched_username": string }`
- `POST /api/pending-transactions/:id/credit`
  - ใช้ resolver ฝั่ง backend เพื่อหา `toAccountId` จากเลขบัญชีผู้รับ (ไม่รับ override จาก client)
- `POST /api/pending-transactions/:id/withdraw`
  - Body (optional): `{ "remark": string }`

### Report Logs

- `POST /api/report`
  - บันทึก snapshot ของรายการที่ผู้ใช้รีพอร์ตว่ามีปัญหา (เก็บ slip_sender_name, slip_receiver_name/account, matched_username, matched_receiver_name_th/en, amount, status, slip_data, team_name)
- `GET /api/report-logs?teamId=&tenantId=&transactionId=&limit=`
  - ดึงรายการรีพอร์ต พร้อม back-fill `matched_receiver_name_th/en` อัตโนมัติสำหรับ record เก่าโดย lookup `tenant_bank_accounts` (รองรับเลขบัญชีแบบ mask เช่น `248-2-xxx183`)
- `DELETE /api/report-logs/:id`
  - ลบรายการที่แก้ไขเรียบร้อยแล้ว

### Scan

- `POST /api/scan/upload`
  - `multipart/form-data`
  - Fields:
    - `file` (image/*, required)
    - `tenant_id` (optional)

### Realtime

- `GET /api/realtime/ws` (WebSocket Upgrade)
- `GET /api/realtime/health`

---

## Admin API Integration (Complete from current code)

Base URL = ค่า `tenant.admin_api_url`

> หมายเหตุสำคัญ: `toAccountId` ที่ใช้เติมเครดิตต้องเป็น `id` ของรายการบัญชีจาก endpoint `/api/accounting/bankaccounts/list` (ไม่ใช่ `bankId`)

### 1) Captcha

- **Endpoint:** `GET /api/captcha`
- **Used by:** `GET /api/tenants/:id/captcha`
- **Headers:** `Accept: application/json`
- **Expected response (used fields):**
  - `id` -> map เป็น `captcha_key`
  - `base64` -> map เป็น `captcha_image`

### 2) Login (captcha flow)

- **Endpoint:** `POST /api/login`
- **Used by:** `POST /api/tenants/:id/login`
- **Headers:** `Content-Type: application/json`, `Accept: application/json`
- **Payload:**

```json
{
  "username": "<admin_username>",
  "password": "<admin_password>",
  "captchaId": "<captcha_key>",
  "captchaValue": "<captcha_code>",
  "agent": "<user-agent>",
  "ipAddress": "<client-ip>"
}
```

- **Expected response (used fields):**
  - `token` (หลัก)
  - `refreshToken` (เก็บใช้งานต่อใน flow)

### 3) Login (legacy connect flow)

- **Endpoint:** `POST /api/login`
- **Used by:** `POST /api/tenants/:id/connect` ผ่าน `tenant.service.ts`
- **Headers:** `Content-Type: application/json`
- **Payload:**

```json
{
  "username": "<admin_username>",
  "password": "<admin_password>"
}
```

- **Expected response token fields:** `token` หรือ `access_token`

### 4) Bank Account List (source of toAccountId)

- **Endpoint:** `GET /api/accounting/bankaccounts/list?limit=100`
- **Used by:**
  - login refresh flow
  - scheduled bank refresh
  - scan auto-credit resolver
  - pending manual credit resolver
- **Headers:** `Authorization: Bearer <session_token>` (เมื่อมี session), `Accept: application/json`
- **Expected response shape:**

```json
{
  "list": [
    {
      "id": 123,
      "accountNumber": "1234567890",
      "bankId": 1
    }
  ],
  "total": 1
}
```

### 5) Bank Account List (sync route)

- **Endpoint:** `GET /api/accounting/bankaccounts/list`
- **Used by:** `POST /api/tenants/:id/bank-accounts/sync`
- **Purpose:** cache account list ลง KV (`tenant:<id>:bank-accounts-list`) และ sync metadata ลง D1

### 6) Master Banks List

- **Endpoint:** `GET /api/accounting/banks/list`
- **Used by:** `POST /api/tenants/:id/bank-accounts/sync`
- **Purpose:** map `bankId -> bank code` เพื่อเติมค่า bank short/code

### 7) User Search

- **Endpoint:** `GET /api/users/list?page=1&limit=<n>&search=<term>&userCategory=<member|non-member>`
- **Used by:**
  - sender matching จากสลิป
  - API `/api/users/search`
  - memberCode resolve flow ก่อนเติมเครดิต
- **Headers:** `Authorization: Bearer <session_token>`, `Accept: application/json`
- **Expected response field:** `list`

### 8) Generate Member Code

- **Endpoint:** `GET /api/admin/gen-membercode/:userId`
- **Used by:** credit flow เมื่อ user ไม่มี `memberCode`
- **Headers:** `Authorization: Bearer <session_token>`, `Accept: application/json`
- **Accepted response fields (any one):** `memberCode`, `member_code`, `username`, `user`, หรือ nested ใน `data`

### 9) Deposit Record (credit)

- **Endpoint:** `POST /api/banking/transactions/deposit-record`
- **Used by:** auto credit + manual credit
- **Headers:** `Authorization: Bearer <session_token>`, `Content-Type: application/json`
- **Payload:**

```json
{
  "memberCode": "MBR001",
  "creditAmount": 100,
  "depositChannel": "Mobile Banking (มือถือ)",
  "toAccountId": 123,
  "transferAt": "2026-01-01T10:00:00.000Z",
  "auto": true,
  "fromAccountNumber": "9876543210"
}
```

- **Duplicate detection in current code:**
  - message: `DUPLICATE_WITH_ADMIN_RECORD` หรือ `DUPLICATED`
  - status: `DUPLICATED`

### 10) Withdraw Credit Back

- **Endpoint:** `POST /api/banking/transactions/withdraw-credit-back`
- **Used by:** `POST /api/pending-transactions/:id/withdraw`
- **Headers:** `Authorization: Bearer <session_token>`, `Content-Type: application/json`
- **Payload:**

```json
{
  "amount": 100,
  "memberCode": "MBR001",
  "remark": "Manual withdraw from pending list"
}
```

### 11) Legacy Bank Accounts Endpoint

- **Endpoint:** `GET /api/bank-accounts`
- **Used by:** `POST /api/tenants/:id/connect` (legacy flow)
- **Headers:** `Authorization: Bearer <session_token>`
- **Expected response candidates:** `data` หรือ `accounts`

---

## การติดตั้งแบบย่อ

### Backend

```bash
cd backend
npm install
npm run dev
```

### Deploy

```bash
cd backend
npm run deploy
```

### Frontend

- ตั้งค่า backend base URL ในไฟล์ config ของ frontend
- เปิด `frontend/index.html` หรือ deploy บน Cloudflare Pages

---

## หมายเหตุการใช้งานสำคัญ

- ต้อง login admin ให้ tenant ก่อน เพื่อให้มี `admin_sessions.session_token`
- ระบบจะ refresh bank accounts ผ่าน cron (`scheduled`) สำหรับ tenant ที่ session ยัง active
- manual credit และ auto credit ใช้ logic resolve `toAccountId` เดียวกัน
- status ของ pending transaction สำคัญต่อสิทธิ์การกดปุ่ม (credited/duplicate ถูก block)

## Archive

โค้ดและเอกสารเก่าอยู่ที่ `document/OLDVERSION/`

---

## Changelog (ล่าสุด — May 2026)

### ระบบรีพอร์ตปัญหา (Report Logs)

- เพิ่มปุ่ม/หน้ารีพอร์ตรายการที่จับคู่ผิด พร้อมบันทึก snapshot ลง `report_logs` (table ใหม่)
- หน้า "ดูรายการรีพอร์ต" (เปิดจากลิงก์ใต้ Dashboard) เป็น full page พร้อมรายการ + รายละเอียดด้านขวา
- ในรายละเอียดรีพอร์ตจะแสดง **"อักษรที่ match"** ทั้งฝั่งผู้โอนและผู้รับ ด้วยการคำนวณ longest common substring ระหว่างชื่อบนสลิปกับชื่อในระบบ (TH/EN) — ช่วยให้เห็นว่าระบบใช้คำไหนตัดสินใจ match
- รองรับ **back-fill ข้อมูลย้อนหลัง**: รายการที่รีพอร์ตก่อนเพิ่ม field `matched_receiver_name_th/en` จะถูก lookup จาก `tenant_bank_accounts` ตอนเรียก API (รองรับเลขบัญชีที่ mask ด้วย `xxx` เช่น `248-2-xxx183` → matched กับ `2482502183`)
- เพิ่ม `DELETE /api/report-logs/:id` พร้อมปุ่มลบในหน้ารายการ เพื่อเคลียร์รายการที่แก้ไขเสร็จแล้ว

### Scan Log แบบเต็มหน้า

- เพิ่มลิงก์ "ดูเพิ่มเติม" บนการ์ดสแกน → เปิดหน้า full page ของรายการสแกน
- 50 รายการต่อหน้า + pagination + filter ตาม **ช่วงวันที่ (calendar datetime-local), สถานะ, tenant** — limit scope ตามทีมเสมอ
- realtime polling ทุก 10 วินาทีเมื่ออยู่หน้าแรกและไม่มี date filter
- ปรับ `#scanLogList` ให้แสดงครบ 50 รายการโดยไม่มี inner scrollbar
- เพิ่ม endpoint `GET /api/pending-transactions/search` รองรับ pagination/filter

### Global API Availability

- ย้าย backend ทั้งหมดมาอยู่บน **Cloudflare Workers** (route `app.atslip.biz/api/*`) และ frontend อยู่บน **Cloudflare Pages**
- เดิมเคยมีปัญหา "บางเครื่อง/บางเครือข่ายเข้าใช้ API ไม่ได้" จากการพึ่งโฮสต์ IP เดียว — ตอนนี้กระจายผ่าน edge network ของ Cloudflare กว่า 300 จุดทั่วโลก ผู้ใช้จากทุกประเทศจะถูก route ไป data center ที่ใกล้ที่สุดอัตโนมัติ
- D1/KV/Durable Object เป็น managed service ทำให้ไม่ต้องดูแล server เอง

### Frontend cache busting

- เวอร์ชันล่าสุดใช้ `js/api.js?v=1.5` และ `js/app.js?v=1.9` — เพิ่มเลขทุกครั้งที่แก้ JS เพื่อบังคับ browser โหลดใหม่

