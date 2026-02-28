# 🏦 Auto Deposit System
## ระบบเติมเครดิตอัตโนมัติผ่านการสแกนสลิปโอนเงิน

> **Platform**: Cloudflare Workers + Pages + D1 Database  
> **Version**: 3.0 (Rebuilt from production recovery)  
> **Last Updated**: February 2026

---

## 📋 Table of Contents

### English
- [System Overview](#system-overview)
- [Architecture](#architecture)
- [Core Features](#core-features)
- [Matching Logic](#matching-logic)
- [API Documentation](#api-documentation)
- [Frontend Application](#frontend-application)
- [Database Schema](#database-schema)
- [LINE Integration](#line-integration)
- [Deployment Guide](#deployment-guide)
- [Configuration](#configuration)

### ไทย
- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [สถาปัตยกรรม](#สถาปัตยกรรม)
- [คุณสมบัติหลัก](#คุณสมบัติหลัก)
- [ตรรกะการจับคู่](#ตรรกะการจับคู่)
- [เอกสาร API](#เอกสาร-api)
- [แอปพลิเคชันหน้าบ้าน](#แอปพลิเคชันหน้าบ้าน)
- [โครงสร้างฐานข้อมูล](#โครงสร้างฐานข้อมูล)
- [การเชื่อมต่อ LINE](#การเชื่อมต่อ-line)
- [คู่มือการติดตั้ง](#คู่มือการติดตั้ง)
- [การตั้งค่า](#การตั้งค่า)

---

## System Overview

**Auto Deposit System** is a fully automated banking solution that processes bank transfer slips (SLIP) in real-time. The system uses OCR technology to extract transaction data, intelligent matching algorithms to identify users, and automatically credits customer accounts—all integrated with LINE messaging for instant notifications.

### 🎯 Main Use Cases

1. **LINE Webhook Flow** (Automatic)
   - User sends SLIP image via LINE chat
   - System scans → matches → credits → replies automatically
   - Zero manual intervention required

2. **Manual Scan Flow** (Admin Panel)
   - Admin uploads SLIP through web interface
   - System assists with matching and credit operations
   - Supports manual override when needed

### 🌟 Key Highlights

- **Multi-Tenant**: Supports 4 independent brands/tenants
- **Smart Matching**: Advanced name and account matching (4+ chars, 3+ digits)
- **Duplicate Detection**: Prevents double-spending via slip reference tracking
- **Real-time Notifications**: Instant LINE messages on every transaction
- **Fully Responsive**: Works on desktop, tablet, and mobile devices
- **Session Management**: Secure bearer token authentication
- **Pending System**: Queues unmatched transactions for manual review

---

## ภาพรวมระบบ

**ระบบเติมเครดิตอัตโนมัติ** เป็นโซลูชันการธนาคารอัตโนมัติที่ประมวลผลสลิปโอนเงินแบบเรียลไทม์ ระบบใช้เทคโนโลยี OCR ในการดึงข้อมูลธุรกรรม อัลกอริทึมการจับคู่อัจฉริยะในการระบุผู้ใช้ และเติมเครดิตให้ลูกค้าโดยอัตโนมัติ พร้อมทั้งรวมกับการส่งข้อความ LINE เพื่อการแจ้งเตือนทันที

### 🎯 กรณีการใช้งานหลัก

1. **LINE Webhook Flow** (อัตโนมัติ)
   - ผู้ใช้ส่งภาพสลิปผ่าน LINE chat
   - ระบบสแกน → จับคู่ → เติมเครดิต → ตอบกลับอัตโนมัติ
   - ไม่ต้องทำงานด้วยตนเองเลย

2. **Manual Scan Flow** (แผงควบคุมผู้ดูแล)
   - ผู้ดูแลอัปโหลดสลิปผ่านเว็บ
   - ระบบช่วยจับคู่และดำเนินการเติมเครดิต
   - รองรับการแทนที่ด้วยตนเองเมื่อจำเป็น

### 🌟 จุดเด่น

- **Multi-Tenant**: รองรับ 4 แบรนด์/เช่าช่วงอิสระ
- **Smart Matching**: การจับคู่ชื่อและบัญชีขั้นสูง (4+ ตัวอักษร, 3+ หลัก)
- **Duplicate Detection**: ป้องกันการใช้ซ้ำผ่านการติดตามอ้างอิงสลิป
- **Real-time Notifications**: ข้อความ LINE ทันทีในทุกธุรกรรม
- **Fully Responsive**: ทำงานบนเดสก์ท็อป แท็บเล็ต และมือถือ
- **Session Management**: การยืนยันตัวตน bearer token ที่ปลอดภัย
- **Pending System**: จัดคิวธุรกรรมที่ไม่ตรงกันเพื่อตรวจสอบด้วยตนเอง

---

## Architecture

### Motherboard Pattern

The system uses a **"Motherboard"** architecture that connects multiple external services:

```
┌─────────────────────────────────────────────────────────────┐
│                    Auto Deposit System                       │
│                   (Cloudflare Workers)                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Frontend   │  │  LINE Bot    │  │   Backend    │      │
│  │    (Pages)   │  │  (Webhook)   │  │   API Proxy  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│                    ┌───────▼───────┐                         │
│                    │  SLIP Processor│                        │
│                    │   & Matcher    │                        │
│                    └───────┬────────┘                        │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐              │
│         │                  │                  │              │
│    ┌────▼────┐      ┌──────▼──────┐    ┌──────▼──────┐      │
│    │ D1 DB   │      │  EasySlip   │    │   Admin     │      │
│    │(Pending)│      │  OCR API    │    │  Backend    │      │
│    └─────────┘      └─────────────┘    └─────────────┘      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Component Breakdown

1. **Frontend (Cloudflare Pages)**
   - SPA built with Vanilla JavaScript
   - Manual SLIP upload and management
   - Tenant configuration interface
   - LINE message template editor

2. **LINE Webhook (Cloudflare Workers)**
   - Receives image messages from LINE
   - Processes SLIP and auto-credits
   - Sends reply messages

3. **SLIP Processor**
   - Calls EasySlip API for OCR
   - Matches receiver (tenant account)
   - Matches sender (user account)
   - Checks for duplicates

4. **D1 Database**
   - Stores pending transactions
   - Stores tenant settings
   - Stores message templates

5. **External APIs**
   - **EasySlip**: OCR for SLIP recognition
   - **Admin Backend**: User search and credit operations
   - **LINE Messaging**: Send messages to users

### Multi-Tenant Architecture

Each tenant has:
- Separate LINE Bot credentials
- Separate EasySlip API key
- Separate backend API endpoint
- Separate bank accounts (in KV/D1)
- Separate message templates

**Tenants**:
1. BETAX2
2. WINSURE24
3. HENGDRAGON66
4. TKWIN24

**Isolation**: Frontend filters by `tenantId`, all data stored in same D1 tables.

---

## สถาปัตยกรรม

### Motherboard Pattern (รูปแบบเมนบอร์ด)

ระบบใช้สถาปัตยกรรม **"Motherboard"** ที่เชื่อมต่อบริการภายนอกหลายตัว:

[ดู diagram ด้านบน]

### ส่วนประกอบระบบ

1. **Frontend (Cloudflare Pages)**
   - SPA สร้างด้วย Vanilla JavaScript
   - อัปโหลดและจัดการ SLIP แบบ Manual
   - ส่วนตั้งค่า Tenant
   - ตัวแก้ไข template ข้อความ LINE

2. **LINE Webhook (Cloudflare Workers)**
   - รับข้อความรูปภาพจาก LINE
   - ประมวลผล SLIP และเติมเครดิตอัตโนมัติ
   - ส่งข้อความตอบกลับ

3. **ตัวประมวลผล SLIP**
   - เรียก EasySlip API สำหรับ OCR
   - จับคู่ผู้รับ (บัญชี tenant)
   - จับคู่ผู้ส่ง (บัญชีผู้ใช้)
   - ตรวจสอบการซ้ำซ้อน

4. **D1 Database**
   - จัดเก็บธุรกรรมรอจับคู่
   - จัดเก็บการตั้งค่า tenant
   - จัดเก็บ template ข้อความ

5. **External APIs**
   - **EasySlip**: OCR สำหรับการรู้จำสลิป
   - **Admin Backend**: ค้นหาผู้ใช้และดำเนินการเครดิต
   - **LINE Messaging**: ส่งข้อความถึงผู้ใช้

---

## Core Features

### 1. SLIP Scanning Flow

```
┌─────────────┐
│ SLIP Image  │
│  (Upload)   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  EasySlip API   │
│  (OCR Extract)  │
└──────┬──────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Extract Data:                      │
│  - Amount: 1,000 THB                │
│  - Sender: นายสมชาย ใจดี             │
│  - Account: 123-4-56789-0           │
│  - Receiver: บริษัท XYZ              │
│  - Receiver Account: 987-6-54321-0  │
│  - Ref: SLIP20260225001             │
│  - Date/Time: 2026-02-25 14:30      │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────┐
│ Match Receiver  │◄───── Compare with Tenant Bank Accounts
│   (Tenant)      │       (from D1/KV)
└──────┬──────────┘
       │
       ├─── ❌ Not Matched → Save to Pending
       │
       ▼
┌─────────────────┐
│  Match Sender   │◄───── Search in Backend:
│    (User)       │       1. Try username (memberCode)
└──────┬──────────┘       2. Try phone number
       │                  3. Try name matching
       │
       ├─── ❌ Not Matched → Save to Pending (status: pending)
       ├─── ✅ Matched → Save to Pending (status: matched)
       │
       ▼
┌─────────────────┐
│ Check Duplicate │◄───── Check slip_ref in D1
│                 │
└──────┬──────────┘
       │
       ├─── ✅ Duplicate → Send LINE: "สลิปนี้ถูกใช้แล้ว"
       │
       ▼
┌─────────────────┐
│ Auto Credit?    │◄───── Check toggle setting
│                 │
└──────┬──────────┘
       │
       ├─── ❌ OFF → Keep in Pending
       │
       ▼
┌─────────────────┐
│  Add Credit     │◄───── POST to Backend API
│  to User        │       /api/credits/add
└──────┬──────────┘
       │
       ├─── Backend Response: DUPLICATED → Send LINE: "สลิปซ้ำ"
       │
       ▼
┌─────────────────┐
│  Send LINE      │◄───── Send success message
│  Message        │       "เติมเครดิตสำเร็จ 1,000 บาท"
└─────────────────┘
```

### 2. Smart Name Matching

**Algorithm**: Sliding Window + Consecutive Match

```javascript
// Remove Thai title prefixes
removeTitlePrefix('นายสมชาย ใจดี') → 'สมชาย ใจดี'

// Find longest consecutive matching substring
matchName('สมชาย ใจดี', 'สมชาย')
  → Remove spaces and normalize
  → 'สมชายใจดี' vs 'สมชาย'
  → Find consecutive match: 'สมชาย' (6 chars)
  → 6 >= 4 (MIN_NAME_CHARS) → ✅ MATCH

matchName('นางสาวมาลี แสงสว่าง', 'มาลี')
  → 'มาลีแสงสว่าง' vs 'มาลี'
  → Find consecutive: 'มาลี' (4 chars)
  → 4 >= 4 → ✅ MATCH

matchName('ทดสอบ ระบบ', 'อื่นๆ')
  → Best match: 0 chars
  → 0 < 4 → ❌ NO MATCH
```

**Thai Prefixes Removed**:
- นาย, นาง, นางสาว, น.ส., เด็กชาย, เด็กหญิง

### 3. Smart Account Matching

**Algorithm**: Extract Digits + Consecutive Match

```javascript
matchAccount('123-4-56789-0', '4567')
  → Extract digits: '1234567890'
  → Search for: '4567'
  → Found in position 3
  → Length: 4 >= 3 (MIN_ACCOUNT_DIGITS) → ✅ MATCH

matchAccount('098-7-65432-1', '654')
  → '0987654321' contains '654'
  → Length: 3 >= 3 → ✅ MATCH

matchAccount('123456789', '999')
  → '123456789' doesn't contain '999'
  → ❌ NO MATCH
```

**Minimum Required**: 3 consecutive matching digits

### 4. User Search Priority

When searching for a user by SLIP data:

```
1. Search by Username (memberCode)
   ├─ GET /api/users/list?search={senderAccount}&userCategory=member
   └─ If found + name matches → ✅ RETURN

2. Search by Phone Number
   ├─ GET /api/users/list?search={senderAccount}&userCategory=member
   └─ If found + name matches → ✅ RETURN

3. Search by Name (with prefix removal)
   ├─ cleanName = removeTitlePrefix(senderName)
   ├─ GET /api/users/list?search={cleanName}&userCategory=member
   └─ If found + account matches → ✅ RETURN

4. Try Non-Member Category
   ├─ Repeat steps 1-3 with userCategory=non-member
   └─ If found → ✅ RETURN

5. Not Found
   └─ Save to Pending with status: 'pending'
```

### 5. Duplicate Detection

**Two-Level Check**:

1. **Frontend/D1 Check**
   ```javascript
   const exists = await checkDuplicateSlip(slip_ref);
   if (exists) {
     sendLineMessage('duplicate');
     return;
   }
   ```

2. **Backend Check**
   ```javascript
   const result = await addCredit({
     userId, amount, slipRef
   });
   
   if (result.status === 'DUPLICATED') {
     sendLineMessage('duplicate');
     return;
   }
   ```

**Storage**: `slip_ref` stored in D1 `pending_transactions` table (UNIQUE constraint)

### 6. Pending System

**Status Flow**:

```
pending → matched → credited
   │         │          │
   │         │          └─ Can withdraw (undo)
   │         │
   │         └─ Can manually credit
   │
   └─ Can search for user

duplicate ─ Terminal status (cannot change)
```

**Cleanup**: Daily at midnight, delete old records (configurable)

---

## คุณสมบัติหลัก

### 1. กระแสการสแกนสลิป

[ดู flow chart ด้านบน]

### 2. การจับคู่ชื่ออัจฉริยะ

**อัลกอริทึม**: Sliding Window + การจับคู่ต่อเนื่อง

- ลบคำนำหน้าชื่อภาษาไทย (นาย, นาง, นางสาว, ฯลฯ)
- หาสตริงย่อยที่ตรงกันต่อเนื่องที่ยาวที่สุด
- ต้องมีอักขระตรงกันอย่างน้อย **4 ตัว** ติดต่อกัน

### 3. การจับคู่เลขบัญชีอัจฉริยะ

**อัลกอริทึม**: ดึงตัวเลข + การจับคู่ต่อเนื่อง

- ดึงตัวเลขทั้งหมดออกจากเลขบัญชี
- ค้นหาตัวเลขที่ต้องการ
- ต้องมีตัวเลขตรงกันอย่างน้อย **3 หลัก** ติดต่อกัน

### 4. ลำดับความสำคัญการค้นหาผู้ใช้

1. ค้นหาด้วย Username (memberCode)
2. ค้นหาด้วยเบอร์โทรศัพท์
3. ค้นหาด้วยชื่อ (หลังจากลบคำนำหน้า)
4. ลองหาใน Non-Member
5. ไม่พบ → บันทึกเป็น Pending

### 5. การตรวจจับการซ้ำซ้อน

ตรวจสอบ 2 ระดับ:
1. ใน D1 Database (pending_transactions)
2. ใน Backend API (เมื่อเติมเครดิต)

### 6. ระบบรอจับคู่

**สถานะ**:
- `pending`: รอค้นหาผู้ใช้
- `matched`: จับคู่แล้ว รอเติมเครดิต
- `credited`: เติมเครดิตแล้ว
- `duplicate`: สลิปซ้ำ

---

## Matching Logic

### ตรรกะการจับคู่

### Complete Flow Example

```
Input: SLIP Data
  ├─ senderName: "นายสมชาย ใจดี"
  ├─ senderAccount: "123-4-56789-0"
  ├─ receiverAccount: "987-6-54321-0"
  ├─ amount: 1000
  └─ transRef: "SLIP20260225001"

Step 1: Match Receiver (Tenant)
  ├─ Compare receiverAccount with Tenant bank accounts
  ├─ BETAX2: "987-6-54321-0" ✅ MATCH
  └─ tenantId = "BETAX2"

Step 2: Match Sender (User)
  ├─ Try 1: Search by Account as memberCode
  │   └─ GET /api/users/list?search=1234567890&userCategory=member
  │       └─ Found: { memberCode: "MB1234567890", fullname: "สมชาย ใจดี" }
  │       └─ matchName("นายสมชาย ใจดี", "สมชาย ใจดี") → ✅ MATCH
  │       └─ RETURN user
  │
  ├─ Try 2: Search by Account as phone
  │   └─ isValidPhone("1234567890") → false
  │   └─ SKIP
  │
  ├─ Try 3: Search by Name
  │   └─ cleanName = removeTitlePrefix("นายสมชาย ใจดี") → "สมชาย ใจดี"
  │   └─ GET /api/users/list?search=สมชาย ใจดี&userCategory=member
  │       └─ Found: { fullname: "สมชาย ใจดี", bankAccount: "123-4-56789-0" }
  │       └─ matchAccount("123-4-56789-0", "123-4-56789-0") → ✅ MATCH
  │       └─ RETURN user
  │
  └─ Try 4: Search in non-member
      └─ Repeat steps 1-3 with userCategory=non-member

Step 3: Check Duplicate
  ├─ SELECT FROM pending_transactions WHERE slipRef = "SLIP20260225001"
  └─ Not found → ✅ OK

Step 4: Auto Credit Check
  ├─ isAutoCredit = TRUE
  └─ Proceed to credit

Step 5: Add Credit
  ├─ POST /api/credits/add
  │   Body: { userId: "user123", amount: 1000, slipRef: "SLIP20260225001" }
  └─ Response: { status: "SUCCESS", credit: 6000 }

Step 6: Send LINE Message
  ├─ messageType = "on_credited_success"
  ├─ template = "เติมเครดิตสำเร็จ ✅\nจำนวนเงิน: {amount} บาท\nเครดิตคงเหลือ: {balance} บาท"
  ├─ Replace: {amount} → 1,000, {balance} → 6,000
  └─ POST https://api.line.me/v2/bot/message/reply
      Body: { replyToken, messages: [...] }
```

---

## API Documentation

### Backend Admin API

Base URL: Configured per tenant (e.g., `https://api.betax2.com`)

#### 1. User Search (Member)

```http
GET /api/users/list?search={query}&userCategory=member&page=1&limit=100
Authorization: Bearer {token}

Response 200 OK:
{
  "message": "Success",
  "list": [
    {
      "id": "user123",
      "phone": "0812345678",
      "memberCode": "MB001",
      "fullname": "สมชาย ใจดี",
      "bankAccount": "123-4-56789-0",
      "credit": 5000,
      "bankName": "ธนาคารกรุงเทพ",
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 100
}
```

#### 2. User Search (Non-Member)

```http
GET /api/users/list?search={query}&userCategory=non-member&page=1&limit=100
Authorization: Bearer {token}

Response 200 OK:
{
  "message": "Success",
  "list": [
    {
      "id": "nonmember456",
      "phone": "0987654321",
      "fullname": "มาลี แสงสว่าง",
      "bankAccount": "098-7-65432-1",
      "credit": 3000,
      "bankName": "ธนาคารกสิกรไทย",
      "createdAt": "2026-02-10T14:20:00Z"
    }
  ],
  "total": 1
}
```

#### 3. Add Credit

```http
POST /api/credits/add
Authorization: Bearer {token}
Content-Type: application/json

Request Body:
{
  "userId": "user123",
  "amount": 1000,
  "slipRef": "SLIP20260225001"
}

Response 200 OK (Success):
{
  "status": "SUCCESS",
  "message": "เติมเครดิตสำเร็จ",
  "credit": 6000,
  "transactionId": "TXN20260225001"
}

Response 200 OK (Duplicate):
{
  "status": "DUPLICATED",
  "message": "สลิปนี้ถูกใช้งานแล้ว",
  "credit": 5000
}

Response 400 Bad Request:
{
  "status": "ERROR",
  "message": "Invalid user or amount"
}
```

#### 4. Withdraw Credit

```http
POST /api/credits/withdraw
Authorization: Bearer {token}
Content-Type: application/json

Request Body:
{
  "userId": "user123",
  "amount": 1000,
  "slipRef": "SLIP20260225001"
}

Response 200 OK:
{
  "status": "SUCCESS",
  "message": "ถอนเครดิตสำเร็จ",
  "credit": 5000,
  "transactionId": "TXN20260225002"
}
```

#### 5. Admin Login

```http
POST /api/admin/login
Content-Type: application/json

Request Body:
{
  "username": "admin",
  "password": "your-secure-password"
}

Response 200 OK:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "username": "admin",
    "role": "admin"
  }
}

Response 401 Unauthorized:
{
  "message": "Invalid credentials"
}
```

### EasySlip API

Base URL: `https://developer.easyslip.com/api/v1`

#### Verify SLIP

```http
POST /verify
Authorization: Bearer {easyslipKey}
Content-Type: multipart/form-data

Request Body:
{
  "file": <binary-image-data>
}

Response 200 OK:
{
  "success": true,
  "data": {
    "amount": 1000,
    "sender": {
      "displayName": "นายสมชาย ใจดี",
      "name": "สมชาย ใจดี",
      "account": "123-4-56789-0",
      "bank": {
        "name": "ธนาคารกรุงเทพ",
        "code": "002"
      }
    },
    "receiver": {
      "displayName": "บริษัท XYZ จำกัด",
      "name": "บริษัท XYZ",
      "account": "987-6-54321-0",
      "bank": {
        "name": "ธนาคารกสิกรไทย",
        "code": "004"
      }
    },
    "transRef": "SLIP20260225001",
    "transDate": "2026-02-25",
    "transTime": "14:30:00"
  }
}

Response 400 Bad Request:
{
  "success": false,
  "message": "Invalid image format"
}
```

**Reference**: See `frontend-rebuild/EASYSLIP.MD` for complete documentation

### LINE Messaging API

Base URL: `https://api.line.me/v2/bot`

#### Reply Message

```http
POST /message/reply
Authorization: Bearer {channelAccessToken}
Content-Type: application/json

Request Body:
{
  "replyToken": "xxxxxxxxxxxx",
  "messages": [
    {
      "type": "text",
      "text": "เติมเครดิตสำเร็จ ✅\nจำนวนเงิน: 1,000 บาท\nเครดิตคงเหลือ: 6,000 บาท"
    }
  ]
}

Response 200 OK:
{}
```

#### Push Message

```http
POST /message/push
Authorization: Bearer {channelAccessToken}
Content-Type: application/json

Request Body:
{
  "to": "{userId}",
  "messages": [
    {
      "type": "text",
      "text": "ได้รับสลิปเรียบร้อยแล้ว\nกำลังตรวจสอบ..."
    }
  ]
}

Response 200 OK:
{}
```

---

## เอกสาร API

### Backend Admin API

URL หลัก: ตั้งค่าตาม tenant แต่ละตัว (เช่น `https://api.betax2.com`)

#### 1. ค้นหาผู้ใช้ (สมาชิก)

[รูปแบบเดียวกับด้านบน แต่อธิบายเป็นภาษาไทย]

#### 2. ค้นหาผู้ใช้ (ไม่ใช่สมาชิก)

[รูปแบบเดียวกับด้านบน]

#### 3. เติมเครดิต

[รูปแบบเดียวกับด้านบน]

#### 4. ถอนเครดิต

[รูปแบบเดียวกับด้านบน]

#### 5. เข้าสู่ระบบผู้ดูแล

[รูปแบบเดียวกับด้านบน]

---

## Frontend Application

### Structure

```
frontend-rebuild/
├── index.html              # Landing page
├── manual-scan.html        # Main SLIP scanning interface
├── settings.html           # Tenant configuration
├── message.html            # LINE message templates
│
├── css/
│   ├── variables.css       # Design tokens
│   ├── global.css          # Global styles
│   └── components/
│       ├── sidebar.css
│       ├── forms.css
│       ├── toast.css
│       ├── modal.css
│       ├── pending-list.css
│       └── upload-zone.css
│
└── js/
    ├── config.js           # Configuration & constants
    ├── utils.js            # Utility functions (matching, formatting)
    ├── api.js              # API service layer
    ├── manual-scan.js      # Manual scan page logic
    ├── settings.js         # Settings page logic
    └── message.js          # Message templates page logic
```

### Features

#### Manual Scan Page

1. **File Upload**
   - Drag & drop support
   - Click to browse
   - Image preview
   - File validation (type, size)

2. **Auto Credit Toggle**
   - Enable/disable automatic credit
   - Persists to localStorage
   - Applies to both LINE and Manual flows

3. **Tenant Selector**
   - Switch between 4 tenants
   - Filters pending list by tenant
   - Updates all configurations

4. **Pending List**
   - Display all pending transactions
   - Filter by status (pending, matched, credited, duplicate)
   - Actions per status:
     - `pending`: Search user, Delete
     - `matched`: Credit, Delete
     - `credited`: Withdraw, Delete

5. **Actions**
   - **Search User**: Manual username/phone/name search
   - **Credit**: Add credit to matched user
   - **Withdraw**: Undo credit operation
   - **Delete**: Remove from pending list

#### Settings Page

1. **LINE Configuration**
   - Channel ID
   - Channel Secret
   - Access Token
   - Test connection button

2. **EasySlip Configuration**
   - API Key input
   - (Optional) Test verification

3. **Backend API Configuration**
   - Base URL
   - Session mode (per-tenant / global)
   - Test connection button

4. **Save/Load**
   - Persist to D1 database
   - Load on page init
   - Tenant-specific settings

#### Message Templates Page

1. **Template Editor**
   - 3 message types:
     - `on_slip_received`: When SLIP is received
     - `on_credited_success`: When credit is successful
     - `on_credited_duplicate`: When SLIP is duplicate
   
2. **Variables**
   - `{amount}`: Transaction amount
   - `{balance}`: User's credit balance
   - `{name}`: User's name
   - `{date}`: Transaction date

3. **Preview**
   - Shows rendered message with sample data

4. **Test Send**
   - Send test message via LINE API

5. **Enable/Disable**
   - Toggle each message type
   - Persists to D1

### Tech Stack

- **Pure Vanilla JavaScript** (No frameworks)
- **CSS3** with CSS Variables for theming
- **Responsive Design** (Mobile-first)
- **LocalStorage** for client-side state
- **Fetch API** for all HTTP requests

### Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

---

## แอปพลิเคชันหน้าบ้าน

### โครงสร้าง

[เหมือนด้านบน]

### คุณสมบัติ

#### หน้า Manual Scan

1. **อัปโหลดไฟล์**
   - รองรับ Drag & drop
   - คลิกเพื่อเลือก
   - แสดงตัวอย่างรูป
   - ตรวจสอบไฟล์ (ประเภท, ขนาด)

2. **สวิตช์เติมเครดิตอัตโนมัติ**
   - เปิด/ปิดการเติมอัตโนมัติ
   - บันทึกใน localStorage
   - ใช้กับทั้ง LINE และ Manual

3. **ตัวเลือก Tenant**
   - สลับระหว่าง 4 tenants
   - กรองรายการรอจับคู่ตาม tenant
   - อัปเดตการตั้งค่าทั้งหมด

4. **รายการรอจับคู่**
   - แสดงรายการรอจับคู่ทั้งหมด
   - กรองตามสถานะ
   - การกระทำตามสถานะ

5. **การกระทำ**
   - **ค้นหาผู้ใช้**: ค้นหา username/phone/name ด้วยตนเอง
   - **เติมเครดิต**: เพิ่มเครดิตให้ผู้ใช้ที่จับคู่แล้ว
   - **ถอนเครดิต**: ยกเลิกการเติมเครดิต
   - **ลบ**: ลบออกจากรายการรอจับคู่

#### หน้า Settings

1. **การตั้งค่า LINE**
   - Channel ID
   - Channel Secret
   - Access Token
   - ปุ่มทดสอบการเชื่อมต่อ

2. **การตั้งค่า EasySlip**
   - ใส่ API Key
   - (ตัวเลือก) ทดสอบการตรวจสอบ

3. **การตั้งค่า Backend API**
   - Base URL
   - โหมด Session (per-tenant / global)
   - ปุ่มทดสอบการเชื่อมต่อ

4. **บันทึก/โหลด**
   - บันทึกลง D1 database
   - โหลดเมื่อเปิดหน้า
   - การตั้งค่าเฉพาะ tenant

#### หน้า Message Templates

1. **ตัวแก้ไข Template**
   - 3 ประเภทข้อความ:
     - `on_slip_received`: เมื่อได้รับสลิป
     - `on_credited_success`: เมื่อเติมเครดิตสำเร็จ
     - `on_credited_duplicate`: เมื่อสลิปซ้ำ
   
2. **ตัวแปร**
   - `{amount}`: จำนวนเงินธุรกรรม
   - `{balance}`: ยอดเครดิตคงเหลือของผู้ใช้
   - `{name}`: ชื่อผู้ใช้
   - `{date}`: วันที่ธุรกรรม

3. **ตัวอย่าง**
   - แสดงข้อความที่ render ด้วยข้อมูลตัวอย่าง

4. **ทดสอบส่ง**
   - ส่งข้อความทดสอบผ่าน LINE API

5. **เปิด/ปิด**
   - สลับแต่ละประเภทข้อความ
   - บันทึกลง D1

---

## Database Schema

### D1 Tables

#### 1. pending_transactions

Stores all transactions waiting for processing or manual review.

```sql
CREATE TABLE pending_transactions (
  id TEXT PRIMARY KEY,                  -- UUID
  tenantId TEXT NOT NULL,               -- BETAX2, WINSURE24, etc.
  amount REAL NOT NULL,                 -- Transaction amount
  senderName TEXT NOT NULL,             -- From SLIP
  senderAccount TEXT NOT NULL,          -- From SLIP
  slipRef TEXT UNIQUE NOT NULL,         -- Transaction reference (duplicate check)
  slipData TEXT NOT NULL,               -- JSON: Full SLIP data from EasySlip
  userId TEXT,                          -- Matched user ID (nullable)
  userCategory TEXT,                    -- 'member' or 'non-member' (nullable)
  status TEXT DEFAULT 'pending',        -- pending | matched | credited | duplicate
  createdAt INTEGER NOT NULL,           -- Unix timestamp
  updatedAt INTEGER NOT NULL            -- Unix timestamp
);

CREATE INDEX idx_tenantId ON pending_transactions(tenantId);
CREATE INDEX idx_status ON pending_transactions(status);
CREATE INDEX idx_createdAt ON pending_transactions(createdAt);
CREATE INDEX idx_slipRef ON pending_transactions(slipRef);
CREATE INDEX idx_userId ON pending_transactions(userId);
```

#### 2. tenant_settings

Stores configuration for each tenant.

```sql
CREATE TABLE tenant_settings (
  id TEXT PRIMARY KEY,
  tenantId TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  lineChannelId TEXT,
  lineChannelSecret TEXT,
  lineAccessToken TEXT,
  easyslipKey TEXT,
  apiBaseUrl TEXT,
  sessionMode TEXT DEFAULT 'per-tenant',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_tenant_settings ON tenant_settings(tenantId);
```

#### 3. message_templates

Stores LINE message templates for each tenant.

```sql
CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  messageType TEXT NOT NULL,            -- on_slip_received | on_credited_success | on_credited_duplicate
  enabled INTEGER DEFAULT 1,            -- 1 = enabled, 0 = disabled
  template TEXT NOT NULL,               -- Message template with variables
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(tenantId, messageType)
);

CREATE INDEX idx_message_tenant ON message_templates(tenantId);
CREATE INDEX idx_message_type ON message_templates(messageType);
```

#### 4. bank_accounts

Stores tenant bank accounts (alternative to KV storage).

```sql
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  accountName TEXT NOT NULL,
  bankCode TEXT,                        -- Bank code (002, 004, etc.)
  isActive INTEGER DEFAULT 1,           -- 1 = active, 0 = inactive
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(tenantId, accountNumber)
);

CREATE INDEX idx_bank_tenant ON bank_accounts(tenantId);
CREATE INDEX idx_bank_active ON bank_accounts(isActive);
```

### Sample Data

#### pending_transactions

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "BETAX2",
  "amount": 1000,
  "senderName": "นายสมชาย ใจดี",
  "senderAccount": "123-4-56789-0",
  "slipRef": "SLIP20260225001",
  "slipData": "{\"amount\":1000,\"sender\":{...},\"receiver\":{...}}",
  "userId": "user123",
  "userCategory": "member",
  "status": "credited",
  "createdAt": 1709035200000,
  "updatedAt": 1709035260000
}
```

#### message_templates

```json
{
  "id": "template-001",
  "tenantId": "BETAX2",
  "messageType": "on_credited_success",
  "enabled": 1,
  "template": "เติมเครดิตสำเร็จ ✅\nจำนวนเงิน: {amount} บาท\nเครดิตคงเหลือ: {balance} บาท",
  "createdAt": 1709035200000,
  "updatedAt": 1709035200000
}
```

---

## โครงสร้างฐานข้อมูล

[ดูรายละเอียดด้านบน - โครงสร้างเหมือนกัน]

---

## LINE Integration

### การเชื่อมต่อ LINE

### Webhook Flow

```
┌──────────────┐
│  LINE User   │
│ sends image  │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│  LINE Platform       │
│  POSTs to webhook    │
└──────┬───────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Cloudflare Worker          │
│  /api/line-webhook          │
│                             │
│  1. Verify signature        │
│  2. Check event type        │
│  3. Download image          │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  EasySlip API               │
│  Extract SLIP data          │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Process SLIP & Credit      │
│  (Full flow from above)     │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  LINE Messaging API         │
│  Send reply message         │
└─────────────────────────────┘
```

### Webhook Implementation

```javascript
// Cloudflare Worker: /api/line-webhook

export default {
  async fetch(request, env) {
    // 1. Verify LINE signature
    const signature = request.headers.get('x-line-signature');
    const body = await request.text();
    
    if (!verifySignature(body, signature, env.LINE_CHANNEL_SECRET)) {
      return new Response('Invalid signature', { status: 401 });
    }
    
    // 2. Parse webhook event
    const data = JSON.parse(body);
    const events = data.events;
    
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'image') {
        // 3. Download image from LINE
        const imageContent = await downloadLineImage(
          event.message.id,
          env.LINE_ACCESS_TOKEN
        );
        
        // 4. Scan SLIP with EasySlip
        const slipResult = await verifySlip(imageContent, env.EASYSLIP_KEY);
        
        // 5. Process and credit
        await processSlipAndCredit(
          event.replyToken,
          slipResult.data,
          true // isFromLine
        );
      }
    }
    
    return new Response('OK');
  }
};
```

### Message Types

#### 1. On SLIP Received

Sent immediately when SLIP is received (before processing).

```
ได้รับสลิปเรียบร้อยแล้ว
จำนวนเงิน: 1,000 บาท
กำลังตรวจสอบ...
```

#### 2. On Credited Success

Sent after successfully crediting the user.

```
เติมเครดิตสำเร็จ ✅
จำนวนเงิน: 1,000 บาท
เครดิตคงเหลือ: 6,000 บาท
```

#### 3. On Credited Duplicate

Sent when SLIP is detected as duplicate.

```
สลิปนี้ถูกใช้งานแล้ว ⚠️
กรุณาตรวจสอบ
```

### Customization

All messages can be customized per tenant via the Message Templates page.

**Variables**:
- `{amount}`: Transaction amount (formatted)
- `{balance}`: User's credit balance (formatted)
- `{name}`: User's name
- `{date}`: Transaction date (formatted)

---

## Deployment Guide

### คู่มือการติดตั้ง

### Prerequisites / ข้อกำหนดเบื้องต้น

1. **Cloudflare Account** (Free tier works)
2. **LINE Developer Account**
   - Create Messaging API channel for each tenant
3. **EasySlip Account**
   - Get API key from https://easyslip.com
4. **Backend Admin API**
   - Must have endpoints ready (see API Documentation)

### Step 1: Setup D1 Database

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create auto-deposit-db

# Note the database_id from output
```

Create `wrangler.toml`:

```toml
name = "auto-deposit-system"
compatibility_date = "2026-02-25"

[[d1_databases]]
binding = "DB"
database_name = "auto-deposit-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

Run migrations:

```bash
# Navigate to frontend-rebuild folder
cd frontend-rebuild

# Create tables
wrangler d1 execute auto-deposit-db --file=schema.sql
```

### Step 2: Deploy Frontend

```bash
# Navigate to frontend-rebuild folder
cd frontend-rebuild

# Deploy to Cloudflare Pages
wrangler pages deploy . --project-name=auto-deposit-frontend

# Note the deployed URL
# Example: https://auto-deposit-frontend.pages.dev
```

### Step 3: Create LINE Webhook Worker

Create `workers/line-webhook/index.js`:

```javascript
// See implementation in DEPLOYMENT.md
import { processSlipAndCredit } from './processor';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Verify signature and process events
    // ... (see full implementation in docs)
  }
};
```

Deploy worker:

```bash
cd workers/line-webhook
wrangler deploy
```

### Step 4: Configure LINE Webhook

For each tenant:

1. Go to LINE Developers Console
2. Select your Messaging API channel
3. Set Webhook URL: `https://your-worker.workers.dev/webhook/{tenantId}`
4. Enable webhook
5. Disable auto-reply messages

### Step 5: Configure Environment Variables

In Cloudflare Pages Settings → Environment Variables:

```bash
# Tenant 1 (BETAX2)
BETAX2_LINE_CHANNEL_ID=1234567890
BETAX2_LINE_CHANNEL_SECRET=abcdef123456
BETAX2_LINE_ACCESS_TOKEN=xxx
BETAX2_EASYSLIP_KEY=yyy
BETAX2_API_BASE_URL=https://api.betax2.com

# Tenant 2-4: Repeat pattern
# Database
D1_DATABASE_ID=your_database_id
```

### Step 6: Setup Scheduled Cleanup

Create `workers/cleanup/index.js`:

```javascript
export default {
  async scheduled(event, env) {
    // Delete pending older than 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    await env.DB.prepare(`
      DELETE FROM pending_transactions 
      WHERE createdAt < ? AND status IN ('credited', 'duplicate')
    `).bind(sevenDaysAgo).run();
  }
};
```

Configure in `wrangler.toml`:

```toml
[triggers]
crons = ["0 0 * * *"]  # Daily at midnight UTC
```

---

## Configuration

### การตั้งค่า

### config.js

```javascript
const CONFIG = {
  // Tenants
  TENANTS: [
    {
      id: 'BETAX2',
      name: 'BETAX2',
      apiBaseUrl: 'https://api.betax2.com',
      lineChannelId: '1234567890',
      lineChannelSecret: 'xxx',
      lineAccessToken: 'yyy',
      easyslipKey: 'zzz',
      sessionMode: 'per-tenant'
    },
    // ... 3 more tenants
  ],
  
  // API Endpoints
  API: {
    USER_LIST: '/api/users/list',
    CREDIT_ADD: '/api/credits/add',
    CREDIT_WITHDRAW: '/api/credits/withdraw',
    ADMIN_LOGIN: '/api/admin/login',
    EASYSLIP_BASE: 'https://developer.easyslip.com/api/v1',
    EASYSLIP_VERIFY: '/verify',
    LINE_REPLY: 'https://api.line.me/v2/bot/message/reply',
    LINE_PUSH: 'https://api.line.me/v2/bot/message/push'
  },
  
  // Matching Rules
  MATCHING: {
    MIN_NAME_CHARS: 4,      // Minimum consecutive matching characters
    MIN_ACCOUNT_DIGITS: 3   // Minimum consecutive matching digits
  },
  
  // Thai Prefixes to Remove
  THAI_PREFIXES: ['นาย', 'นาง', 'นางสาว', 'น.ส.', 'เด็กชาย', 'เด็กหญิง'],
  
  // User Categories
  USER_CATEGORIES: {
    MEMBER: 'member',
    NON_MEMBER: 'non-member'
  },
  
  // Status
  STATUS: {
    PENDING: 'pending',
    MATCHED: 'matched',
    CREDITED: 'credited',
    DUPLICATE: 'duplicate'
  },
  
  // Message Types
  MESSAGE_TYPES: [
    'on_slip_received',
    'on_credited_success',
    'on_credited_duplicate'
  ]
};
```

---

## Troubleshooting

### การแก้ไขปัญหา

### Common Issues / ปัญหาที่พบบ่อย

#### 1. SLIP Not Recognized / สลิปไม่ถูกรู้จำ

**Problem**: EasySlip returns error or invalid data

**Solutions**:
- Check image quality (clear, not blurry) / ตรวจสอบคุณภาพรูป (ชัดเจน ไม่เบลอ)
- Check image size (under 5MB) / ตรวจสอบขนาดรูป (ต่ำกว่า 5MB)
- Verify EasySlip API key is correct / ตรวจสอบ EasySlip API key
- Check if SLIP format is supported / ตรวจสอบว่ารูปแบบสลิปรองรับหรือไม่

#### 2. User Not Found / ไม่พบผู้ใช้

**Problem**: System cannot match sender to user

**Solutions**:
- Check if user exists in backend / ตรวจสอบว่าผู้ใช้มีอยู่ใน backend
- Verify name matching rules (4+ chars) / ตรวจสอบกฎการจับคู่ชื่อ (4+ ตัวอักษร)
- Verify account matching rules (3+ digits) / ตรวจสอบกฎการจับคู่บัญชี (3+ หลัก)
- Try manual search with exact username/phone / ลองค้นหาด้วยตนเองด้วย username/โทรศัพท์

#### 3. LINE Not Replying / LINE ไม่ตอบกลับ

**Problem**: No reply message after sending SLIP

**Solutions**:
- Check LINE webhook is enabled / ตรวจสอบว่าเปิด LINE webhook แล้ว
- Verify webhook URL is correct / ตรวจสอบ webhook URL
- Check LINE Access Token / ตรวจสอบ LINE Access Token
- Check worker logs for errors / ตรวจสอบ worker logs
- Verify signature validation / ตรวจสอบการตรวจสอบ signature

#### 4. Duplicate Error (False Positive) / ข้อผิดพลาดสลิปซ้ำ (แต่จริงๆ ไม่ซ้ำ)

**Problem**: New SLIP detected as duplicate

**Solutions**:
- Check if slip_ref is truly unique / ตรวจสอบว่า slip_ref ไม่ซ้ำจริงๆ
- Verify D1 database constraints / ตรวจสอบ constraints ใน D1
- Check backend duplicate detection logic / ตรวจสอบตรรกะการตรวจจับซ้ำใน backend
- Clear old pending transactions / ล้างรายการรอจับคู่เก่า

#### 5. Credit Not Added / เครดิตไม่ถูกเพิ่ม

**Problem**: SLIP processed but credit not added

**Solutions**:
- Check backend API response / ตรวจสอบ response จาก backend API
- Verify bearer token is valid / ตรวจสอบว่า bearer token ยังใช้ได้
- Check backend logs / ตรวจสอบ backend logs
- Verify user ID is correct / ตรวจสอบว่า user ID ถูกต้อง

### Debugging / การ Debug

Enable debug mode in browser console:

```javascript
localStorage.setItem('debug', 'true');
```

Check Cloudflare Worker logs:

```bash
wrangler tail your-worker-name
```

Check D1 database:

```bash
wrangler d1 execute auto-deposit-db --command="SELECT * FROM pending_transactions ORDER BY createdAt DESC LIMIT 10"
```

---

## Performance & Scalability

### ประสิทธิภาพและความสามารถในการขยาย

### Current Limits / ข้อจำกัดปัจจุบัน

- **Cloudflare Workers**: 100,000 requests/day (Free), Unlimited (Paid)
- **D1 Database**: 5M rows (Free), 25M rows (Paid)
- **LINE Messaging API**: 500 messages/month (Free), depends on plan (Paid)
- **EasySlip API**: Depends on your plan

### Optimization Tips / เคล็ดลับการเพิ่มประสิทธิภาพ

1. **Implement Pagination** / ใช้ Pagination
   - Currently loads all pending (limit 100)
   - Should implement scroll or page-based loading

2. **Cache Tenant Settings** / ใช้ Cache สำหรับการตั้งค่า Tenant
   - Store in KV instead of D1 for faster access
   - Cache in Workers global scope

3. **Rate Limiting** / จำกัดอัตรา
   - Implement rate limiting on webhook
   - Prevent spam/abuse

4. **Image Optimization** / เพิ่มประสิทธิภาพรูปภาพ
   - Resize images before sending to EasySlip
   - Compress to reduce API costs

5. **Database Cleanup** / ทำความสะอาดฐานข้อมูล
   - Scheduled cleanup of old records
   - Archive instead of delete for compliance

---

## Security

### ความปลอดภัย

### Authentication / การยืนยันตัวตน

- **Admin Panel**: Bearer token from backend
- **LINE Webhook**: Signature verification
- **API Calls**: Authorization header with bearer token

### Data Protection / การปกป้องข้อมูล

- **Sensitive Data**: Never log credit card, passwords, full bank accounts
- **PII**: Hash or encrypt personal information
- **HTTPS Only**: All traffic encrypted
- **CORS**: Configured properly in Workers

### Best Practices / แนวทางปฏิบัติที่ดีที่สุด

1. Rotate API keys regularly / เปลี่ยน API keys เป็นประจำ
2. Use environment variables (never hardcode) / ใช้ environment variables (ไม่ hardcode)
3. Implement IP whitelisting for admin panel / ใช้ IP whitelist สำหรับ admin panel
4. Monitor for suspicious activity / ตรวจสอบกิจกรรมที่น่าสงสัย
5. Backup D1 database regularly / สำรองข้อมูล D1 database เป็นประจำ

---

## License

MIT License - Feel free to modify and use for your projects.

---

## Support & Contact

### การสนับสนุนและติดต่อ

For questions or issues:
- Check [frontend-rebuild/DEPLOYMENT.md](frontend-rebuild/DEPLOYMENT.md) for detailed setup
- Check [frontend-rebuild/PROJECT_STATUS.md](frontend-rebuild/PROJECT_STATUS.md) for current status
- Review code comments in JavaScript files

สำหรับคำถามหรือปัญหา:
- ดู [frontend-rebuild/DEPLOYMENT.md](frontend-rebuild/DEPLOYMENT.md) สำหรับคู่มือติดตั้งละเอียด
- ดู [frontend-rebuild/PROJECT_STATUS.md](frontend-rebuild/PROJECT_STATUS.md) สำหรับสถานะปัจจุบัน
- ตรวจสอบ comments ในไฟล์ JavaScript

---

## Changelog

### Version 2.0 (February 2026)

**Major Rebuild** / การสร้างใหม่ทั้งหมด

- ✅ Complete rebuild from recovered HTML files
- ✅ Reorganized file structure (CSS, JS, HTML separation)
- ✅ Separated CSS into modular components
- ✅ Separated JavaScript into service layers
- ✅ Implemented complete matching logic (4+ chars name, 3+ digits account)
- ✅ Created comprehensive documentation
- ✅ Added D1 database schema
- ✅ Multi-tenant support (4 tenants)
- ✅ LINE integration
- ✅ Auto-credit system
- ✅ Pending transaction management

### Known Issues / ปัญหาที่ทราบ

- [ ] D1 operations need implementation in Workers
- [ ] LINE Webhook handler needs creation
- [ ] Image preview modal not implemented
- [ ] User search modal needs better UI
- [ ] Pagination not fully implemented
- [ ] No TypeScript types
- [ ] No unit tests

### Roadmap / แผนงาน

- **Q1 2026**: Complete Workers implementation
- **Q2 2026**: Add analytics dashboard
- **Q3 2026**: Mobile app (React Native)
- **Q4 2026**: AI-powered fraud detection

---

## Quick Start / เริ่มต้นอย่างรวดเร็ว

### For Developers / สำหรับนักพัฒนา

```bash
# 1. Clone/Download the project
git clone https://github.com/your-repo/auto-deposit-system.git
cd auto-deposit-system

# 2. Install Wrangler
npm install -g wrangler

# 3. Login to Cloudflare
wrangler login

# 4. Create D1 Database
cd frontend-rebuild
wrangler d1 create auto-deposit-db
wrangler d1 execute auto-deposit-db --file=schema.sql

# 5. Deploy Frontend
wrangler pages deploy . --project-name=auto-deposit-frontend

# 6. Configure environment variables in Cloudflare Dashboard

# 7. Test!
# Visit: https://auto-deposit-frontend.pages.dev/manual-scan.html
```

### For Users / สำหรับผู้ใช้

1. **LINE Flow**:
   - Add LINE Bot as friend
   - Send SLIP image
   - Wait for confirmation message
   - Check your credit balance

2. **Manual Flow**:
   - Visit admin panel
   - Login with credentials
   - Upload SLIP image
   - Review pending list
   - Approve/Reject transactions

---

**Built with ❤️ on Cloudflare**

**สร้างด้วย ❤️ บน Cloudflare**
