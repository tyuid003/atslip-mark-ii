# Auto Deposit System - Deployment Guide

## 📁 โครงสร้างโปรเจกต์

```
frontend-rebuild/
├── index.html                      # หน้าแรก
├── manual-scan.html                # หน้า Manual Scan (หลัก)
├── settings.html                   # หน้า Settings
├── message.html                    # หน้า Message Templates
│
├── css/
│   ├── variables.css               # ตัวแปร CSS (สี, spacing, typography)
│   ├── global.css                  # Global styles และ layout
│   └── components/
│       ├── sidebar.css             # Navigation sidebar
│       ├── forms.css               # Form components และ buttons
│       ├── toast.css               # Toast notifications
│       ├── modal.css               # Modal dialogs (loading, confirm)
│       ├── pending-list.css        # Pending transactions list
│       └── upload-zone.css         # File upload zone
│
├── js/
│   ├── config.js                   # ตั้งค่าทั้งหมด (tenants, API endpoints, constants)
│   ├── utils.js                    # ฟังก์ชันช่วยเหลือ (matching, formatting, UI helpers)
│   ├── api.js                      # API service layer (EasySlip, Backend, LINE)
│   ├── manual-scan.js              # หน้า Manual Scan logic
│   ├── settings.js                 # หน้า Settings logic
│   └── message.js                  # หน้า Message Templates logic
│
└── README.md                       # คำถาม-คำตอบ business logic
```

## 🚀 การติดตั้ง

### 1. ติดตั้งบน Cloudflare Pages

```bash
# 1. สร้าง D1 Database
wrangler d1 create auto-deposit-db

# 2. สร้างตาราง pending_transactions
wrangler d1 execute auto-deposit-db --file=schema.sql

# 3. Deploy to Cloudflare Pages
# เลือก directory: frontend-rebuild
# Build command: (ไม่ต้องการ)
# Build output directory: /
```

### 2. สร้างตาราง D1 Database

สร้างไฟล์ `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS pending_transactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  amount REAL NOT NULL,
  senderName TEXT NOT NULL,
  senderAccount TEXT NOT NULL,
  slipRef TEXT UNIQUE NOT NULL,
  slipData TEXT NOT NULL,
  userId TEXT,
  userCategory TEXT,
  status TEXT DEFAULT 'pending',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_tenantId ON pending_transactions(tenantId);
CREATE INDEX idx_status ON pending_transactions(status);
CREATE INDEX idx_createdAt ON pending_transactions(createdAt);
CREATE INDEX idx_slipRef ON pending_transactions(slipRef);
```

### 3. ตั้งค่า Environment Variables

ใน Cloudflare Pages Settings → Environment Variables:

```bash
# Tenant 1 (BETAX2)
BETAX2_LINE_CHANNEL_ID=xxx
BETAX2_LINE_CHANNEL_SECRET=xxx
BETAX2_LINE_ACCESS_TOKEN=xxx
BETAX2_EASYSLIP_KEY=xxx
BETAX2_API_BASE_URL=https://api.betax2.com

# Tenant 2 (WINSURE24)
WINSURE24_LINE_CHANNEL_ID=xxx
WINSURE24_LINE_CHANNEL_SECRET=xxx
WINSURE24_LINE_ACCESS_TOKEN=xxx
WINSURE24_EASYSLIP_KEY=xxx
WINSURE24_API_BASE_URL=https://api.winsure24.com

# ... และอื่นๆ สำหรับ Tenant 3, 4
```

## ⚙️ การตั้งค่า

### 1. แก้ไขค่าเริ่มต้นใน `config.js`

```javascript
// อัพเดตข้อมูล Tenant แต่ละตัว
const CONFIG = {
  TENANTS: [
    {
      id: 'BETAX2',
      name: 'BETAX2',
      apiBaseUrl: 'https://api.betax2.com',
      lineChannelId: 'YOUR_CHANNEL_ID',
      lineChannelSecret: 'YOUR_CHANNEL_SECRET',
      lineAccessToken: 'YOUR_ACCESS_TOKEN',
      easyslipKey: 'YOUR_EASYSLIP_KEY',
      // ...
    }
  ]
};
```

### 2. ตั้งค่า LINE Webhook

ไปที่ LINE Developers Console:
- Webhook URL: `https://your-domain.pages.dev/api/line-webhook`
- เปิดใช้งาน Webhook

## 📝 การใช้งาน

### หน้า Manual Scan

1. **เลือก Tenant**: เลือก Tenant ที่ต้องการทำงาน
2. **เปิด/ปิด Auto Credit**: Toggle สำหรับเติมเครดิตอัตโนมัติ
3. **อัปโหลดสลิป**: 
   - ลากไฟล์มาวาง หรือ
   - คลิก "เลือกไฟล์"
4. **ดูรายการรอจับคู่**: ระบบจะแสดงรายการที่ยังไม่ได้เติมเครดิต
5. **จัดการรายการ**:
   - **ค้นหาผู้ใช้**: สำหรับรายการที่ไม่พบผู้ใช้
   - **เติมเครดิต**: สำหรับรายการที่จับคู่แล้ว
   - **ถอนเครดิต**: สำหรับรายการที่เติมไปแล้ว
   - **ลบ**: ลบรายการออก

### หน้า Settings

1. เลือก Tenant ที่ต้องการตั้งค่า
2. กรอกข้อมูล:
   - LINE Configuration (Channel ID, Secret, Access Token)
   - EasySlip API Key
   - Backend API Base URL
3. ทดสอบการเชื่อมต่อ
4. บันทึกการตั้งค่า

### หน้า Messages

1. เลือก Tenant
2. แก้ไข Template แต่ละประเภท:
   - **เมื่อได้รับสลิป**: ส่งเมื่อได้รับสลิปจาก LINE
   - **เมื่อเติมเครดิตสำเร็จ**: ส่งเมื่อเติมเครดิตสำเร็จ
   - **เมื่อสลิปซ้ำ**: ส่งเมื่อพบว่าสลิปถูกใช้แล้ว
3. ใช้ตัวแปรใน Template:
   - `{amount}`: จำนวนเงิน
   - `{balance}`: เครดิตคงเหลือ
   - `{name}`: ชื่อผู้ใช้
   - `{date}`: วันที่
4. Preview และ Test Send
5. บันทึกข้อความ

## 🔧 การพัฒนาต่อ

### TODO List

- [ ] **D1 Database Operations**
  - Implement CRUD operations for `pending_transactions`
  - Implement midnight cleanup worker
  - Implement slip_ref duplicate checking

- [ ] **KV Storage**
  - Store tenant bank accounts
  - Implement sync with backend

- [ ] **LINE Webhook Handler**
  - Create `/api/line-webhook` endpoint
  - Verify signature
  - Process image message
  - Send reply message

- [ ] **EasySlip Integration**
  - Handle API errors
  - Support URL-based scan
  - Cache results

- [ ] **Backend API Integration**
  - Session management
  - Bearer token refresh
  - Error handling

- [ ] **UI Enhancements**
  - Image preview modal
  - User search modal
  - Better error messages
  - Loading states

- [ ] **State Management**
  - Implement reactive state
  - Sync across tabs
  - Persist settings

## 🧪 การทดสอบ

### ทดสอบการจับคู่ชื่อและบัญชี

```javascript
// ทดสอบใน Browser Console

// 1. ทดสอบ removeTitlePrefix
Utils.removeTitlePrefix('นายสมชาย ใจดี'); // => 'สมชาย ใจดี'
Utils.removeTitlePrefix('นางสาวมาลี แสงสว่าง'); // => 'มาลี แสงสว่าง'

// 2. ทดสอบ matchName
Utils.matchName('นายสมชาย ใจดี', 'สมชาย ใจดี'); // => true
Utils.matchName('สมชาย ใจดี', 'สมชาย'); // => true (4+ chars)
Utils.matchName('สมชาย ใจดี', 'มาลี'); // => false

// 3. ทดสอบ matchAccount
Utils.matchAccount('123-4-56789-0', '4567'); // => true (3+ digits)
Utils.matchAccount('123456789', '789'); // => true
Utils.matchAccount('123456789', '999'); // => false
```

### ทดสอบ API Calls

```javascript
// ทดสอบใน Browser Console

// 1. Login
await APIService.adminLogin('admin', 'password');

// 2. Search User
const result = await APIService.searchUsers('สมชาย', 'member');
console.log(result);

// 3. Add Credit
await APIService.addCredit({
  userId: 'user123',
  amount: 1000,
  slipRef: 'SLIP123456',
  category: 'member'
});

// 4. Verify SLIP
const slipResult = await APIService.verifySlip(file, 'EASYSLIP_KEY');
console.log(slipResult);
```

## 📦 Dependencies

- **ไม่มี Dependencies**: ทุกอย่างเป็น Vanilla JavaScript
- **APIs ที่ใช้**:
  - EasySlip API (OCR)
  - Backend Admin API (User search, Credit)
  - LINE Messaging API (Send messages)

## 🔑 API Endpoints ที่ต้องมีใน Backend

### User Search
```
GET /api/users/list?search={query}&userCategory={member|non-member}&page=1&limit=100

Response:
{
  "message": "Success",
  "list": [
    {
      "id": "user123",
      "phone": "0812345678",
      "memberCode": "MB001",
      "fullname": "สมชาย ใจดี",
      "bankAccount": "123-4-56789-0",
      "credit": 5000
    }
  ],
  "total": 1
}
```

### Add Credit
```
POST /api/credits/add
Body: {
  "userId": "user123",
  "amount": 1000,
  "slipRef": "SLIP123456"
}

Response:
{
  "status": "SUCCESS",
  "message": "เติมเครดิตสำเร็จ",
  "credit": 6000
}
```

### Withdraw Credit
```
POST /api/credits/withdraw
Body: {
  "userId": "user123",
  "amount": 1000,
  "slipRef": "SLIP123456"
}

Response:
{
  "status": "SUCCESS",
  "message": "ถอนเครดิตสำเร็จ",
  "credit": 5000
}
```

### Admin Login
```
POST /api/admin/login
Body: {
  "username": "admin",
  "password": "password"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

## 📚 เอกสารเพิ่มเติม

- [EasySlip API Documentation](EASYSLIP.MD)
- [Business Logic Q&A](README.md)
- [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/)

## 🐛 Debugging

### เปิด Debug Mode

```javascript
// ใน Browser Console
localStorage.setItem('debug', 'true');

// ดู Logs
// Utils.js จะ log ทุก function call
// API.js จะ log ทุก API request/response
```

### Clear Cache

```javascript
// Clear LocalStorage
localStorage.clear();

// Clear Pending List (ใน D1)
// ต้อง implement ใน Workers
```

## 🎯 Production Checklist

- [ ] ตั้งค่า Environment Variables ครบทุก Tenant
- [ ] สร้าง D1 Database และตาราง
- [ ] ตั้งค่า LINE Webhook URL
- [ ] ทดสอบการเชื่อมต่อ API ทั้งหมด
- [ ] ทดสอบการส่งข้อความ LINE
- [ ] ตั้งค่า Midnight Cleanup Worker
- [ ] ทดสอบการจับคู่ชื่อและบัญชี
- [ ] ทดสอบการเติมเครดิต
- [ ] ทดสอบการตรวจสอบสลิปซ้ำ
- [ ] Setup monitoring และ logging

## 📞 Support

หากพบปัญหาหรือต้องการความช่วยเหลือ:
- ตรวจสอบ Browser Console สำหรับ errors
- ตรวจสอบ Network Tab สำหรับ failed API calls
- ตรวจสอบ D1 Database สำหรับ data consistency
