# AT SLIP - Auto Deposit System
# ระบบฝากเงินอัตโนมัติ

---

## 📋 Table of Contents | สารบัญ

### English
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Features](#core-features)
4. [API Endpoints](#api-endpoints)
5. [Database Schema](#database-schema)
6. [Setup Guide](#setup-guide)
7. [Development](#development)

### ไทย
1. [ภาพรวม](#ภาพรวม)
2. [สถาปัตยกรรมระบบ](#สถาปัตยกรรมระบบ)
3. [คุณสมบัติหลัก](#คุณสมบัติหลัก)
4. [API Endpoints](#api-endpoints-ไทย)
5. [ฐานข้อมูล](#ฐานข้อมูล)
6. [วิธีการติดตั้ง](#วิธีการติดตั้ง)
7. [การพัฒนา](#การพัฒนา)

---

## Overview

**AT SLIP** (Auto Transfer SLIP) is an automated banking system built on Cloudflare Workers that processes bank transfer slips (SLIP documents) automatically. The system verifies slips using AI recognition, matches bank accounts, identifies users, and automatically credits their accounts.

### Key Features:
- ✅ Automated SLIP verification using EasySlip API
- ✅ Bank account matching (exact, partial, and name-based)
- ✅ User identification (members and non-members)
- ✅ LINE Bot integration for real-time notifications
- ✅ Multi-tenant support
- ✅ Duplicate detection
- ✅ Flex message notifications
- ✅ Admin authentication & session management

---

## ภาพรวม

**AT SLIP** (Auto Transfer SLIP) เป็นระบบการธนาคารอัตโนมัติที่สร้างขึ้นบน Cloudflare Workers เพื่อประมวลผลเอกสาร SLIP (สลิปการโอนเงิน) โดยอัตโนมัติ ระบบจะตรวจสอบสลิปโดยใช้การรู้จำเอกสารด้วย AI จับคู่บัญชีธนาคาร ระบุตัวตนผู้ใช้ และโอนเงินไปยังบัญชีของพวกเขา

### คุณสมบัติหลัก:
- ✅ ตรวจสอบ SLIP อัตโนมัติโดยใช้ EasySlip API
- ✅ จับคู่บัญชีธนาคาร (แบบตรงตัว ตัวอักษร และชื่อ)
- ✅ ระบุตัวตนผู้ใช้ (สมาชิกและสินค้าอื่น ๆ)
- ✅ การรวมตัวกับ LINE Bot สำหรับการแจ้งเตือนแบบเรียลไทม์
- ✅ รองรับผู้เช่าหลายราย
- ✅ การตรวจจับสลิปซ้ำ
- ✅ การแจ้งเตือน Flex message
- ✅ การรับรองความถูกต้องของ Admin และการจัดการเซสชัน

---

## System Architecture

### Directory Structure
```
src/
├── index.ts                 # Main entry point
├── api/
│   ├── admin-login.ts      # Admin authentication
│   ├── logout.ts           # Admin logout
│   └── scan.ts             # SLIP verification & processing
├── database/
│   └── tenant-repository.ts # Tenant CRUD operations
├── utils/
│   ├── helpers.ts          # Helper functions
│   └── flex-messages.ts    # LINE Flex message builders
└── webhooks/
    └── line.ts             # LINE webhook handler
```

### Technology Stack
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **External APIs**:
  - EasySlip: SLIP OCR verification
  - LINE Messaging API: Bot notifications
  - Custom Backend: Account & user management

---

## สถาปัตยกรรมระบบ

### โครงสร้างไดเรกทอรี่
```
src/
├── index.ts                 # จุดเริ่มต้นหลัก
├── api/
│   ├── admin-login.ts      # การรับรองความถูกต้องของ Admin
│   ├── logout.ts           # ออกจากระบบ Admin
│   └── scan.ts             # ตรวจสอบและประมวลผล SLIP
├── database/
│   └── tenant-repository.ts # ระบบบริหารจัดการเช่า
├── utils/
│   ├── helpers.ts          # ฟังก์ชันตัวช่วย
│   └── flex-messages.ts    # ตัวสร้าง LINE Flex message
└── webhooks/
    └── line.ts             # ตัวจัดการ LINE webhook
```

### Stack เทคโนโลยี
- **Runtime**: Cloudflare Workers
- **ฐานข้อมูล**: Cloudflare D1 (SQLite)
- **แคช**: Cloudflare KV
- **External APIs**:
  - EasySlip: การตรวจสอบ SLIP ด้วย OCR
  - LINE Messaging API: การแจ้งเตือน Bot
  - Custom Backend: การจัดการบัญชีและผู้ใช้

---

## Core Features

### 1. Admin Authentication
**File**: `src/api/admin-login.ts`

Admin users can login using their credentials. The system:
1. Validates username/password/CAPTCHA
2. Calls backend login API
3. Retrieves authorization token
4. Stores token in database & KV cache
5. Prefetches account list for fast matching

```typescript
POST /api/tenants/{tenantId}/admin-login
Body: {
  username: string
  password: string
  captchaId: string
  captchaCode: string
  apiBaseUrl: string
}
```

### 2. SLIP Verification
**File**: `src/api/scan.ts`

Uses EasySlip API to verify bank transfer slips:
- Extracts sender/receiver info
- Validates transfer amount
- Gets transaction reference

```typescript
POST /api/scan/verify-slip
Body: {
  tenantId: string
  file?: File    // Or provide URL
  url?: string
}
```

### 3. Account Matching
**File**: `src/api/scan.ts`

Intelligent matching algorithm:
1. **Exact Match**: Account number matches exactly
2. **Partial Match**: Masked account digits match
3. **Name Match**: Account holder name matches
4. **Manual Mapping**: Predefined account mappings

### 4. User Search
**File**: `src/api/scan.ts`

Searches for users in system:
- Supports member & non-member search
- Matches by name
- Verifies against bank account (if provided)

### 5. Auto Credit
**File**: `src/api/scan.ts`

Submits credit to backend:
- Uses `/deposit-record` for members
- Uses `/first-time-deposit-record` for non-members
- Detects duplicate transactions

### 6. LINE Bot Integration
**File**: `src/webhooks/line.ts`

Processes LINE image messages:
1. Receives image from user
2. Verifies SLIP
3. Processes credit in background
4. Sends Flex message notification

### 7. Message Settings
**File**: `src/utils/flex-messages.ts`

Customizable notifications:
- Success notification with amount
- Duplicate warning
- Custom branding (logo, colors)
- Game link button

---

## คุณสมบัติหลัก

### 1. การรับรองความถูกต้องของ Admin
**File**: `src/api/admin-login.ts`

Admin สามารถเข้าสู่ระบบได้ ระบบจะ:
1. ตรวจสอบ username/password/CAPTCHA
2. เรียกใช้ backend login API
3. ดึงข้อมูล authorization token
4. บันทึก token ในฐานข้อมูล & KV cache
5. Prefetch รายชื่อบัญชีเพื่อการจับคู่ที่รวดเร็ว

```typescript
POST /api/tenants/{tenantId}/admin-login
Body: {
  username: string
  password: string
  captchaId: string
  captchaCode: string
  apiBaseUrl: string
}
```

### 2. การตรวจสอบ SLIP
**File**: `src/api/scan.ts`

ใช้ EasySlip API เพื่อตรวจสอบเอกสาร SLIP:
- แยกข้อมูลผู้ส่ง/ผู้รับ
- ตรวจสอบจำนวนเงิน
- ได้รับการอ้างอิงธุรกรรม

```typescript
POST /api/scan/verify-slip
Body: {
  tenantId: string
  file?: File    // หรือระบุ URL
  url?: string
}
```

### 3. การจับคู่บัญชี
**File**: `src/api/scan.ts`

อัลกอริทึมการจับคู่ที่ชาญฉลาด:
1. **จับคู่ตรงตัว**: หมายเลขบัญชีตรงกันเป๊ะ
2. **จับคู่ตัวอักษร**: ตัวอักษรบัญชีที่ปิดบังตรงกัน
3. **จับคู่ชื่อ**: ชื่อเจ้าของบัญชีตรงกัน
4. **การจับคู่ด้วยตนเอง**: ระบบจับคู่บัญชีที่กำหนดไว้ล่วงหน้า

### 4. การค้นหาผู้ใช้
**File**: `src/api/scan.ts`

ค้นหาผู้ใช้ในระบบ:
- รองรับการค้นหาสมาชิก & ไม่ใช่สมาชิก
- จับคู่ตามชื่อ
- ตรวจสอบกับบัญชีธนาคาร (หากระบุ)

### 5. การโอนเงินอัตโนมัติ
**File**: `src/api/scan.ts`

ส่งการชำระเงินไปยังแบ็กเอนด์:
- ใช้ `/deposit-record` สำหรับสมาชิก
- ใช้ `/first-time-deposit-record` สำหรับผู้ไม่ใช่สมาชิก
- ตรวจจับธุรกรรมซ้ำ

### 6. การรวมตัวกับ LINE Bot
**File**: `src/webhooks/line.ts`

ประมวลผลข้อความรูปภาพ LINE:
1. รับรูปภาพจากผู้ใช้
2. ตรวจสอบ SLIP
3. ประมวลผลการชำระเงินในพื้นหลัง
4. ส่ง Flex message notification

### 7. การตั้งค่าข้อความ
**File**: `src/utils/flex-messages.ts`

การแจ้งเตือนที่ปรับแต่งได้:
- การแจ้งเตือนความสำเร็จพร้อมจำนวนเงิน
- คำเตือนการซ้ำ
- การสร้างแบรนด์เอง (โลโก้ สี)
- ปุ่มลิงค์เกม

---

## API Endpoints

### Tenant Management
```
POST   /api/tenants                    # Create/update tenant
GET    /api/tenants                    # List all tenants
GET    /api/tenants/{tenantId}         # Get tenant details
DELETE /api/tenants/{tenantId}         # Delete tenant
```

### Authentication
```
POST   /api/tenants/{tenantId}/admin-login    # Login
POST   /api/tenants/{tenantId}/logout         # Logout
GET    /api/tenants/{tenantId}/session        # Get session
```

### SLIP Scanning
```
POST   /api/scan/verify-slip           # Verify SLIP
POST   /api/scan/match-account         # Match account
POST   /api/scan/search-user           # Search user
POST   /api/scan/submit-credit         # Submit credit
GET    /api/scan/check-duplicate       # Check duplicate
```

### Webhooks
```
POST   /webhook/{tenantId}/{oaId}      # LINE webhook
```

### Health Check
```
GET    /health                         # System health
```

---

## API Endpoints (ไทย)

### การจัดการเช่า
```
POST   /api/tenants                    # สร้าง/อัปเดตผู้เช่า
GET    /api/tenants                    # แสดงผู้เช่าทั้งหมด
GET    /api/tenants/{tenantId}         # รายละเอียดผู้เช่า
DELETE /api/tenants/{tenantId}         # ลบผู้เช่า
```

### การรับรองความถูกต้อง
```
POST   /api/tenants/{tenantId}/admin-login    # เข้าสู่ระบบ
POST   /api/tenants/{tenantId}/logout         # ออกจากระบบ
GET    /api/tenants/{tenantId}/session        # ดึงเซสชัน
```

### การสแกน SLIP
```
POST   /api/scan/verify-slip           # ตรวจสอบ SLIP
POST   /api/scan/match-account         # จับคู่บัญชี
POST   /api/scan/search-user           # ค้นหาผู้ใช้
POST   /api/scan/submit-credit         # ส่งการชำระเงิน
GET    /api/scan/check-duplicate       # ตรวจสอบการซ้ำ
```

### Webhooks
```
POST   /webhook/{tenantId}/{oaId}      # LINE webhook
```

### ตรวจสอบสุขภาพระบบ
```
GET    /health                         # สถานะของระบบ
```

---

## Database Schema

### Main Tables

**tenants**
```sql
id                    TEXT PRIMARY KEY
tenant_id             TEXT UNIQUE NOT NULL
tenant_name           TEXT NOT NULL
api_base_url          TEXT NOT NULL
admin_username        TEXT
line_channel_id       TEXT
line_channel_secret   TEXT
line_access_token     TEXT
session_mode          TEXT
account_list_ttl_min  INTEGER
created_at            TEXT
updated_at            TEXT
```

**tenant_sessions**
```sql
id                    INTEGER PRIMARY KEY
tenant_id             TEXT NOT NULL (FK)
token                 TEXT NOT NULL
refresh_token         TEXT
token_expired_at      TEXT
status                TEXT (ACTIVE/INACTIVE)
last_validated_at     TEXT
updated_at            TEXT
UNIQUE(tenant_id)
```

**pending_transactions**
```sql
id                    INTEGER PRIMARY KEY
tenant_id             TEXT NOT NULL (FK)
slip_data             TEXT (JSON)
slip_ref              TEXT
user_data             TEXT (JSON)
status                TEXT (pending/matched/credited/duplicate/failed)
amount                REAL
sender_account        TEXT
sender_bank           TEXT
receiver_account      TEXT
created_at            TEXT
credited_at           TEXT
```

**line_oas**
```sql
id                    TEXT PRIMARY KEY
tenant_id             TEXT NOT NULL (FK)
name                  TEXT NOT NULL
channel_id            TEXT NOT NULL
channel_secret        TEXT NOT NULL
access_token          TEXT NOT NULL
created_at            TEXT
```

**message_settings**
```sql
id                    TEXT PRIMARY KEY
tenant_id             TEXT NOT NULL (FK)
image_reply_enabled   INTEGER
image_reply_message   TEXT
flex_message_enabled  INTEGER
flex_logo_url         TEXT
game_url              TEXT
color_header_footer_bg TEXT
color_body_bg         TEXT
color_primary         TEXT
color_success_text    TEXT
color_value_text      TEXT
color_separator       TEXT
color_muted_text      TEXT
updated_at            TEXT
UNIQUE(tenant_id)
```

---

## ฐานข้อมูล

### ตารางหลัก

**tenants** - บัญชีผู้เช่า
```sql
- tenant_id: รหัสเฉพาะ
- tenant_name: ชื่อผู้เช่า
- api_base_url: URL API หลัก
- session_mode: โหมดจัดเก็บเซสชัน
- account_list_ttl_min: ระยะเวลา TTL สำหรับบัญชี
```

**tenant_sessions** - เซสชัน Admin
```sql
- tenant_id: รหัสผู้เช่า
- token: Token การเข้าถึง
- status: สถานะเซสชัน
- last_validated_at: วันที่ตรวจสอบล่าสุด
```

**pending_transactions** - ธุรกรรมที่รอดำเนินการ
```sql
- tenant_id: รหัสผู้เช่า
- slip_data: เอกสาร SLIP (JSON)
- status: pending/matched/credited/duplicate
- amount: จำนวนเงิน
- created_at: เวลาสร้าง
- credited_at: เวลาโอนเงิน
```

---

## Setup Guide

### Prerequisites
- Node.js 16+
- Cloudflare Account
- Wrangler CLI
- EasySlip API Token
- LINE Bot Channel Token

### Installation

1. **Clone & Install**
```bash
cd "AT slip"
npm install
```

2. **Configure wrangler.toml**
```toml
name = "at-slip"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
vars = { ENVIRONMENT = "production" }
d1_databases = [
  { binding = "DB", database_name = "at-slip-db" }
]
kv_namespaces = [
  { binding = "SESSION_KV", id = "your-kv-id" }
]
```

3. **Create Database**
```bash
npx wrangler d1 create at-slip-db
```

4. **Deploy**
```bash
npm run build
npx wrangler deploy
```

### Environment Variables
```
EASYSLIP_TOKEN=your_easyslip_token
LINE_CHANNEL_SECRET=your_line_secret
LINE_ACCESS_TOKEN=your_line_token
BACKEND_API_URL=https://your-api.com
```

---

## วิธีการติดตั้ง

### ข้อกำหนดเบื้องต้น
- Node.js 16+
- บัญชี Cloudflare
- Wrangler CLI
- EasySlip API Token
- LINE Bot Channel Token

### ขั้นตอนการติดตั้ง

1. **โคลนและติดตั้ง**
```bash
cd "AT slip"
npm install
```

2. **กำหนดค่า wrangler.toml**
```toml
name = "at-slip"
main = "src/index.ts"
```

3. **สร้างฐานข้อมูล**
```bash
npx wrangler d1 create at-slip-db
```

4. **ปรับใช้**
```bash
npm run build
npx wrangler deploy
```

---

## Development

### Project Structure
- `src/`: TypeScript source files
- `dist/`: Compiled JavaScript
- `tests/`: Test files

### Building
```bash
npm run build
```

### Testing Locally
```bash
npx wrangler dev
```

### Common Workflows

#### Adding New API Endpoint
1. Create file in `src/api/`
2. Export handler function
3. Import and route in `src/index.ts`

#### Modifying Database Schema
1. Update in migration file
2. Run migrations: `npx wrangler d1 execute`

#### Testing LINE Webhook
```bash
curl -X POST http://localhost:8787/webhook/tenant1/oa1 \
  -H "Content-Type: application/json" \
  -d '{...LINE webhook payload...}'
```

---

## การพัฒนา

### โครงสร้างโครงการ
- `src/`: ไฟล์ TypeScript
- `dist/`: JavaScript ที่รวบรวม
- `tests/`: ไฟล์ทดสอบ

### การสร้างอย่างง่าย
```bash
npm run build
```

### ทดสอบในเครื่อง
```bash
npx wrangler dev
```

### ขั้นตอนทั่วไป

#### เพิ่ม API Endpoint ใหม่
1. สร้างไฟล์ในโฟลเดอร์ `src/api/`
2. ส่งออกฟังก์ชันตัวจัดการ
3. นำเข้าและเส้นทางใน `src/index.ts`

#### แก้ไขสคีมาฐานข้อมูล
1. อัปเดตในไฟล์การปรับปรุง
2. รัน migrations: `npx wrangler d1 execute`

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    USER FLOW                             │
└─────────────────────────────────────────────────────────┘

1. Admin Login
   Admin -> /admin-login -> Backend API -> Get Token -> Store in DB/KV

2. LINE User Sends SLIP
   User -> LINE Bot -> /webhook/{tenantId} -> Receive Image

3. SLIP Processing
   Download Image -> Verify with EasySlip -> Extract Data
   
4. Account Matching
   Receiver Account -> Match Algorithm -> Find Bank Account
   
5. User Search
   Sender Name -> Search API -> Find User ID
   
6. Auto Credit
   Verify Account Match -> Submit Credit -> Update Status

7. Notification
   Create Flex Message -> Send to LINE User
```

---

## Support & Troubleshooting

### Common Issues

**Issue**: Token expired
- **Solution**: Implement token refresh mechanism

**Issue**: Account match fails
- **Solution**: Check account name mappings, try manual mapping

**Issue**: SLIP verification timeout
- **Solution**: Increase timeout in EasySlip call (max 5s)

**Issue**: Duplicate transaction detected
- **Solution**: Check `slip_ref` uniqueness constraint

### Getting Help
- Check logs in Cloudflare Dashboard
- Review request/response in wrangler dev
- Validate API credentials

---

## License & Credits

Created as part of AT SLIP System
Built on Cloudflare Workers Platform

---

**Last Updated**: February 2026
**Status**: Refactored & Extracted from Bundle
**Coverage**: ~90% of original logic recovered
