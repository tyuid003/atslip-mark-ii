# ATslipMark-II

ระบบสแกนสลิปและเติมเครดิตอัตโนมัติแบบ multi-tenant สำหรับหลายเว็บในหลายทีม โดยใช้ Cloudflare Workers เป็น backend, D1 เป็นฐานข้อมูล, KV สำหรับ cache บัญชีธนาคาร, Durable Object สำหรับ realtime, และ frontend แบบ static บน Cloudflare Pages

README นี้ตั้งใจอัปเดตให้ตรงกับสภาพโปรเจกต์ปัจจุบันมากที่สุด รวมถึงคำสั่ง deploy ที่ใช้งานจริง เพื่อให้ทั้งคนและ AI ใช้อ้างอิงได้ตรงกัน

## ภาพรวมระบบ

- รับสลิปจากหน้าเว็บหรือ LINE webhook
- ส่งรูปสลิปไปตรวจผ่าน EasySlip
- จับคู่บัญชีผู้รับเพื่อหา tenant ที่เกี่ยวข้อง
- พยายามจับคู่ผู้โอนกับผู้ใช้ในระบบของ tenant
- บันทึกเป็น pending transaction
- ถ้า tenant เปิด auto deposit จะลองเติมเครดิตทันที
- ถ้าไม่สามารถจับคู่หรือมีความกำกวม จะค้างในสถานะรอให้แอดมินจัดการเอง
- แจ้งอัปเดตแบบ realtime ไปยังหน้าเว็บและ Chrome extension

## โครงสร้างโปรเจกต์

```text
ATslipMark-II/
├── backend/                     Cloudflare Worker API ตัวหลัก
├── frontend/                    หน้าแอดมินแบบ static สำหรับใช้งานจริง
├── chrome-extension/            Chrome Extension แบบ Side Panel
├── document/OLDVERSION/         โค้ดและเอกสารเวอร์ชันเก่า
├── NEXT_SESSION_MULTI_PROVIDER_LAB_PLAN.md
├── SlipOK API Guide.md
├── popup-alrt.md
└── README.md
```

## ส่วนที่ใช้งานจริงในปัจจุบัน

### Backend

อยู่ใน `backend/`

ใช้สำหรับ:

- จัดการ teams และ tenants
- login ไปยัง admin API ของแต่ละ tenant
- cache และ sync บัญชีธนาคารของ tenant
- รับอัปโหลดสลิปและสแกนผ่าน EasySlip
- จับคู่รายการ pending กับ user
- เติมเครดิตและดึงเครดิตกลับ
- จัดการ LINE OA และ reply settings
- รับ LINE webhook
- broadcast realtime ผ่าน Durable Object

### Frontend

อยู่ใน `frontend/`

เป็นหน้าแอดมินที่ deploy บน Cloudflare Pages และใช้งานผ่านโดเมน `app.atslip.biz`

ฟีเจอร์หลักที่มีอยู่ตอนนี้:

- หน้า dashboard สำหรับแต่ละทีมผ่าน route แบบ hash เช่น `/#/hengdragon-ruayruay`
- แสดง tenant card แบบ slider
- อัปโหลดสลิปจากหน้าเว็บ
- ดูและจัดการรายการ pending transaction
- ค้นหา user แล้วจับคู่แบบ manual
- สั่งเติมเครดิตแบบ manual
- ตั้งค่า LINE OA reply/flex message
- realtime notification
- popup alert ที่โหลดเนื้อหาจากไฟล์ markdown แยก
- flex message preview สำหรับงานออกแบบข้อความตอบกลับ

### Chrome Extension

อยู่ใน `chrome-extension/`

เป็น Side Panel extension สำหรับ Chrome ที่ใช้ backend เดียวกับระบบหลัก โดยทำหน้าที่ใกล้เคียง frontend หลัก เช่น:

- เลือกทีม
- ดู tenant
- อัปโหลดสลิป
- ดู pending transactions
- ค้นหาและจับคู่ user
- เติมเครดิต
- รับ realtime update

หมายเหตุ:

- source ของ extension อยู่ใน repo
- มีไฟล์ `chrome-extension.zip` อยู่ใน repo ปัจจุบันด้วย แต่ตัว source หลักคือโฟลเดอร์ `chrome-extension/`

## สถาปัตยกรรมปัจจุบัน

### Backend stack

- Cloudflare Workers
- TypeScript
- D1 Database
- KV Namespace
- Durable Objects
- Cron trigger

### Frontend stack

- HTML
- CSS
- Vanilla JavaScript
- Lucide icons ผ่าน CDN
- Google Fonts: Kanit
- Cloudflare Pages

### External integrations

- EasySlip API สำหรับตรวจสลิป
- Admin API ของแต่ละ tenant สำหรับค้นหาผู้ใช้, ดึงบัญชีธนาคาร, เติมเครดิต, ดึงเครดิตกลับ
- LINE Messaging API ผ่าน webhook / push / reply flow

## Production configuration ที่มีอยู่ตอนนี้

อ้างอิงจาก `backend/wrangler.toml`

- Worker name: `atslip-backend`
- Main entry: `backend/src/index.ts`
- Production route: `*.atslip.app/api/*`
- Zone: `atslip.app`
- D1 binding: `DB`
- KV binding: `BANK_KV`
- Durable Object binding: `PENDING_NOTIFICATIONS`
- Cron: ทุก 30 นาที
- Logs: เปิด observability logs แล้ว

อ้างอิงจากสถานะ deploy ปัจจุบัน

- Frontend Pages project: `atslip-frontend`
- Frontend pages domain: `atslip-frontend.pages.dev`
- Frontend custom domain: `app.atslip.biz`

## Backend routes หลัก

อ้างอิงจาก `backend/src/index.ts`

### Teams

- `GET /api/teams`
- `GET /api/teams/:slug`

### Tenants

- `GET /api/tenants`
- `POST /api/tenants`
- `GET /api/tenants/:id`
- `PUT /api/tenants/:id`
- `DELETE /api/tenants/:id`
- `POST /api/tenants/:id/connect`
- `POST /api/tenants/:id/disconnect`
- `GET /api/tenants/:id/accounts`
- `PATCH /api/tenants/:id/auto-deposit`

### Admin login / bank refresh

- `GET /api/tenants/:id/captcha`
- `POST /api/tenants/:id/login`
- `POST /api/tenants/:id/refresh-accounts`

### Tenant bank accounts metadata

- `GET /api/tenants/:id/bank-accounts/metadata`
- `POST /api/tenants/:id/bank-accounts/sync`
- `POST /api/tenants/:tenantId/bank-accounts/:accountId/metadata`
- `PATCH /api/bank-accounts/:id/english-name`

### LINE OA

- `GET /api/tenants/:tenantId/line-oas`
- `POST /api/tenants/:tenantId/line-oas`
- `GET /api/line-oas/:id`
- `PUT /api/line-oas/:id`
- `DELETE /api/line-oas/:id`
- `GET /api/line-oas/:id/reply-settings`
- `PUT /api/line-oas/:id/reply-settings`
- `POST /webhook/:tenantId/:lineOAId`

### Users

- `GET /api/users/search?q=<term>&category=<member|non-member>&tenant_id=<id>`

### Pending transactions

- `GET /api/pending-transactions`
- `DELETE /api/pending-transactions/:id`
- `PATCH /api/pending-transactions/:id/match`
- `POST /api/pending-transactions/:id/credit`
- `POST /api/pending-transactions/:id/withdraw`

### Scan

- `POST /api/scan/upload`

### Realtime

- `GET /api/realtime/ws`
- `GET /api/realtime/health`

## โครงสร้างข้อมูลหลักในฐานข้อมูล

อ้างอิงจาก `backend/schema.sql`

- `teams`
- `tenants`
- `line_oas`
- `admin_sessions`
- `pending_transactions`
- `credit_logs`
- `system_settings`
- `tenant_bank_accounts`

ค่าตั้งต้นที่สำคัญ:

- มี default team slug เป็น `default`
- `tenants.auto_deposit_enabled` ใช้กำหนดว่าร้านนั้นจะเติมอัตโนมัติหรือไม่
- `pending_transactions.status` ใช้สถานะ `pending`, `matched`, `credited`, `duplicate`, `failed`

## พฤติกรรมการจับคู่ปัจจุบัน

### Receiver matching

backend ปัจจุบันพยายามจับคู่ tenant จาก:

- ธนาคารผู้รับ
- เลขบัญชีผู้รับ
- ชื่อผู้รับ

มีการปรับ logic ให้ระวังมากขึ้น:

- ถ้าเจอ candidate หลายตัวและคะแนนใกล้กันเกินไป จะไม่ auto match
- ถ้ากำกวม จะปล่อยเป็นยอดรอแทน

### Sender matching

backend ปัจจุบันพยายามค้นหาผู้ใช้จากชื่อผู้โอนผ่าน admin API

พฤติกรรมสำคัญ:

- ถ้าเจอผู้ใช้ชัดเจนคนเดียว จะจับคู่อัตโนมัติ
- ถ้ายังเหลือหลาย candidate หลัง filter แล้ว จะไม่ auto match
- กรณีกำกวม จะปล่อยเป็น pending ให้แอดมินเลือกเอง

## ข้อควรรู้เรื่อง popup alert

popup หน้า frontend ถูกทำให้แก้ไขง่ายโดยแยก content ออกมาเป็น markdown

ไฟล์ที่เกี่ยวข้อง:

- `frontend/js/popup-alert.js` ตัว logic popup
- `frontend/popup-alert.md` เนื้อหา popup ที่ frontend ใช้งานจริง
- `frontend/css/global.css` style ของ popup
- `popup-alrt.md` เอกสารต้นทางที่ใช้เก็บข้อความอ้างอิงในระดับ root

พฤติกรรมของ popup:

- แสดงบนหน้า frontend หลัก
- มีปุ่มปิด
- มีตัวเลือก “ไม่ต้องแสดงอีกในวันนี้”
- ตอน popup เปิด จะ blur พื้นหลัง

## เอกสารสำคัญอื่นใน repo

### `NEXT_SESSION_MULTI_PROVIDER_LAB_PLAN.md`

แผนการทำ multi-provider ในอนาคต โดยเฉพาะ EasySlip และ SlipOK

สถานะปัจจุบัน:

- production ตอนนี้ยังผูกกับ EasySlip เป็นหลัก
- เอกสารนี้เป็นแผนสำหรับทำในโปรเจกต์ copy / lab ไม่ใช่คำสั่งให้แก้ production ทันที

### `SlipOK API Guide.md`

คู่มือ API ของ SlipOK สำหรับใช้เป็น reference ตอนทำ multi-provider ภายหลัง

### `document/OLDVERSION/`

archive ของโค้ดและเอกสารรุ่นเก่า ไม่ใช่ source หลักที่ควร deploy ในตอนนี้

## การรันแบบ local

### Backend local dev

```powershell
cd backend
npm install
npm run dev
```

### Frontend local preview

frontend ปัจจุบันเป็น static site จึงเปิดได้หลายแบบ เช่น:

```powershell
cd frontend
python -m http.server 4173
```

จากนั้นเปิด:

```text
http://127.0.0.1:4173/#/hengdragon-ruayruay
```

หมายเหตุ:

- `frontend/js/config.js` ตอนนี้ชี้ไปที่ backend production URL
- ถ้าจะทดสอบกับ worker local ต้องแก้ base URL ให้ตรงก่อน

## วิธี deploy ที่ใช้งานจริง

ส่วนนี้เขียนให้ตรงกับ workflow ปัจจุบัน และให้ AI ใช้อ้างอิงได้

### 1. Deploy backend ไป production

คำสั่งจริง:

```powershell
cd backend
npm run deploy
```

ผลลัพธ์:

- deploy worker ชื่อ `atslip-backend`
- update route production `*.atslip.app/api/*`

ข้อควรระวัง:

- คำสั่งนี้กระทบ production โดยตรง
- ถ้าใน working tree มี code ที่ยังไม่พร้อมปล่อย จะถูก deploy ไปด้วย
- ถ้าจะทำในโปรเจกต์ copy ห้ามใช้ `wrangler.toml` ชุด production เดิมโดยไม่แก้ชื่อ worker และ route ก่อน

### 2. Deploy frontend ไป Cloudflare Pages

wrangler dependency อยู่ใน `backend/` จึงสะดวกสุดที่จะเรียกจากในโฟลเดอร์นั้น

คำสั่งจริงที่ใช้งานได้:

```powershell
cd backend
npx wrangler pages deploy ..\frontend --project-name atslip-frontend --commit-dirty=true
```

ผลลัพธ์:

- upload static files จากโฟลเดอร์ `frontend/`
- publish ไปยัง Pages project `atslip-frontend`
- custom domain ที่ใช้งานจริงคือ `app.atslip.biz`

หมายเหตุ:

- ถ้าไม่ใส่ `--commit-dirty=true` และ working tree ไม่สะอาด wrangler จะเตือน
- warning เรื่อง `wrangler.toml` ใน backend เกิดได้ เพราะไฟล์นี้เป็น worker config ไม่ใช่ Pages config
- warning นี้ไม่ block deployment ของ frontend แบบคำสั่งข้างบน

### 3. ตรวจสิทธิ์ก่อน deploy

```powershell
cd backend
npx wrangler whoami
```

### 4. ดูรายชื่อ Pages projects

```powershell
cd backend
npx wrangler pages project list
```

## AI deploy playbook

ถ้าสั่ง AI ให้ deploy โปรเจกต์นี้ ควรให้ AI ทำตามลำดับนี้

### กรณี deploy frontend อย่างเดียว

1. ตรวจว่า frontend แก้ถูกโฟลเดอร์ `frontend/` ไม่ใช่ `document/OLDVERSION/`
2. เช็ก `frontend/js/config.js` ว่าชี้ backend ถูกตัว
3. รัน

```powershell
cd backend
npx wrangler whoami
npx wrangler pages deploy ..\frontend --project-name atslip-frontend --commit-dirty=true
```

### กรณี deploy backend อย่างเดียว

1. ตรวจว่าการแก้ไขพร้อมปล่อยจริง เพราะจะกระทบ production ทันที
2. รัน

```powershell
cd backend
npx wrangler whoami
npm run deploy
```

### กรณี deploy ทั้ง backend และ frontend

ลำดับที่แนะนำ:

1. deploy backend ก่อน
2. deploy frontend ตาม
3. เปิดหน้า `app.atslip.biz/#/<team-slug>` เพื่อตรวจของจริง

คำสั่ง:

```powershell
cd backend
npx wrangler whoami
npm run deploy
npx wrangler pages deploy ..\frontend --project-name atslip-frontend --commit-dirty=true
```

## คำเตือนสำคัญสำหรับ AI และผู้พัฒนา

- โปรเจกต์นี้มีทั้งโค้ด production ปัจจุบัน, archive, backup, และเอกสาร lab ใน repo เดียวกัน
- source ที่ควรแก้และ deploy ตอนนี้คือ `backend/`, `frontend/`, และ `chrome-extension/`
- ห้าม deploy จาก `document/OLDVERSION/` โดยคิดว่าเป็น frontend หลัก
- ถ้าจะทำ multi-provider ให้ยึด `NEXT_SESSION_MULTI_PROVIDER_LAB_PLAN.md` และทำในโปรเจกต์ copy ก่อน
- backend ปัจจุบันยังเป็น EasySlip-first ไม่ใช่ provider-agnostic เต็มรูปแบบ

## สถานะที่เปลี่ยนจาก README เดิม

README เดิมยังไม่สะท้อนหลายส่วนที่มีอยู่จริง เช่น:

- Chrome extension
- frontend popup alert ที่โหลดจาก markdown
- flex message preview
- Pages project และ custom domain ที่ใช้งานจริง
- คำสั่ง deploy frontend ที่ใช้จริง
- ความเสี่ยงของการ deploy backend ทับ production

README นี้ตั้งใจแก้ gap เหล่านี้โดยตรง

## ไฟล์ที่ควรอ่านต่อถ้าจะทำงานในโปรเจกต์นี้

- `backend/src/index.ts`
- `backend/schema.sql`
- `backend/wrangler.toml`
- `frontend/index.html`
- `frontend/js/config.js`
- `frontend/js/app.js`
- `frontend/js/realtime.js`
- `frontend/js/reply-message.js`
- `frontend/js/popup-alert.js`
- `chrome-extension/README.md`
- `NEXT_SESSION_MULTI_PROVIDER_LAB_PLAN.md`

## สรุปสั้นที่สุด

- backend production ใช้ Cloudflare Worker ชื่อ `atslip-backend`
- frontend production ใช้ Cloudflare Pages project ชื่อ `atslip-frontend`
- frontend ที่ active คือ `frontend/`
- archive เก่าอยู่ใน `document/OLDVERSION/`
- ถ้าจะ deploy frontend ใช้ `wrangler pages deploy ..\frontend --project-name atslip-frontend`
- ถ้าจะ deploy backend ใช้ `cd backend && npm run deploy`
