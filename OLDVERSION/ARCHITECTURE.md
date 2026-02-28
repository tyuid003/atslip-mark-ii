# AT SLIP - System Architecture & Logic Explanation
# AT SLIP - สถาปัตยกรรมระบบและคำอธิบายลอจิก

## ENGLISH VERSION

### System Overview

AT SLIP is a serverless auto-depositing system that:
1. Receives bank transfer slips (SLIP images) via LINE Bot
2. Verifies the slip using OCR/AI (EasySlip API)
3. Matches the receiver's account against system accounts
4. Identifies the sender (user) in the system
5. Automatically submits credit to the user's account
6. Sends confirmation notifications back to the user

### Data Flow Architecture

```
┌──────────────────┐
│   LINE Bot       │
│  (User sends     │
│   SLIP image)    │
└────────┬─────────┘
         │ Image Message
         ▼
┌──────────────────────────────────┐
│  LINE Webhook Handler            │
│  /webhook/{tenantId}/{oaId}      │
│  • Receive message               │
│  • Download image                │
│  • Save to pending_transactions  │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Background Processing           │
│  (processSlipInBackground)       │
├──────────────────────────────────┤
│ 1. Verify SLIP with EasySlip     │
│    → Extract slip data           │
│    → Get receiver account        │
│    → Get transfer amount         │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Match Receiver Account          │
│  (matchAccount)                  │
├──────────────────────────────────┤
│ Strategy 1: Exact Match          │
│   123456789 == 123456789         │
│                                  │
│ Strategy 2: Partial Match        │
│   Masked: 1234xx789              │
│   System: 123456789 ✓            │
│                                  │
│ Strategy 3: Name Match           │
│   SLIP: "ABC Company"            │
│   System: "ABC COMPANY"          │
│   Keywords: [ABC] [COMPANY]      │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Search for User/Member          │
│  (searchUser)                    │
├──────────────────────────────────┤
│ 1. Get sender name from SLIP     │
│    Remove title prefix           │
│ 2. Search members first          │
│    /api/users/list?search=name   │
│ 3. Verify bank account           │
│    Pattern match if masked       │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Submit Credit to Backend        │
│  (submitCredit)                  │
├──────────────────────────────────┤
│ IF user.memberCode exists:       │
│   POST /deposit-record           │
│   • Using memberCode             │
│                                  │
│ ELSE (non-member):               │
│   POST /first-time-deposit       │
│   • Using userId                 │
│                                  │
│ Response:                        │
│   • success → update status=credited
│   • duplicate → update status=duplicate
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  Send Notification               │
│  (createFlexMessage)             │
├──────────────────────────────────┤
│ IF status == credited:           │
│   → Create success flex message  │
│   → Show amount, date, user      │
│                                  │
│ ELSE IF status == duplicate:     │
│   → Create duplicate warning     │
│   → Alert user                   │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│   Send to LINE                   │
│   pushFlexMessage()              │
│   → User receives notification   │
└──────────────────────────────────┘
```

### Core Components

#### 1. Authentication Layer (src/api/admin-login.ts)

**Purpose**: Manage admin sessions for tenant access

**Process**:
```
POST /api/tenants/{tenantId}/admin-login
├─ Receive: username, password, captchaId, captchaCode
├─ Validate CAPTCHA
├─ Call Backend: POST /api/login
│   └─ Get access token
├─ Verify Token: GET /api/admins/me
│   └─ Confirm token validity
├─ Store in Database:
│   └─ tenant_sessions table
├─ Store in Cache:
│   └─ KV: tenant:{tenantId}:session
├─ Prefetch Accounts:
│   └─ GET /api/summary-report/account-list
├─ Cache Accounts:
│   └─ KV: tenant:{tenantId}:accounts (TTL: 5 min default)
└─ Return: token, username
```

**Session Management**:
- Tokens stored in D1 for persistence
- Also cached in KV for faster access
- Session refresh on logout
- Automatic cleanup of expired sessions

#### 2. SLIP Verification (src/api/scan.ts → verifySlip)

**Purpose**: Verify SLIP authenticity and extract data

**Process**:
```
Receives: tenantId, imageBuffer or imageUrl

Step 1: Get EasySlip Token
└─ Check if tenant has token
└─ If not, get global token
└─ Token stored in easyslip_configs table

Step 2: Call EasySlip API
├─ Endpoint: https://developer.easyslip.com/api/v1/verify
├─ Timeout: 5 seconds (max)
├─ Send: POST with image file or URL
└─ Receive: Slip data JSON

Step 3: Parse Response
├─ data.data.sender:
│   ├─ name.th/name.en
│   ├─ account.value
│   └─ bank.short
├─ data.data.receiver:
│   ├─ name.th/name.en
│   ├─ account.value
│   └─ bank.short
├─ data.data.amount.amount
├─ data.data.date
└─ data.data.transRef (unique identifier)

Return: { success: true, data: {...slip_data...} }
```

**Error Handling**:
- Network timeout → fail
- Invalid image → fail
- Missing token → fail
- API error → fail with message

#### 3. Account Matching (src/api/scan.ts → matchAccount)

**Purpose**: Find which bank account in system matches receiver account

**Matching Strategies** (in order):

```
1. EXACT MATCH
   receiver_account = "1234567890"
   system_account = "1234567890"
   Result: ✅ Match

2. MASKED DIGITS MATCH
   receiver_account = "1234xx890"  (masked in SLIP)
   system_account = "1234567890"
   Extract: 1234, 890
   Check: system contains both → ✅ Match

3. NAME MATCHING
   receiver_name = "ABC COMPANY LIMITED"
   system_account = "ABC COMPANY LIMITED"
   
   Algorithm:
   a) Split into keywords: [ABC, COMPANY, LIMITED]
   b) For each keyword match against system account names
   c) Use:
      • Exact keyword match
      • Prefix match (≥4 chars)
      • Contains match (≥3 chars)
   d) ✅ Match if any keyword matches

4. MANUAL MAPPING
   Check account_name_mappings table
   account_number → name_en, name_th
   Match against SLIP receiver name
```

**Account Source**:
- First load from KV cache: `tenant:{tenantId}:accounts`
- If cache miss, fetch from API: `/api/summary-report/account-list`
- Cache for 5 minutes (configurable)

#### 4. User Search (src/api/scan.ts → searchUser)

**Purpose**: Find user in system who matches sender

**Process**:
```
Input: sender name, (optional: masked account, bank)

Step 1: Clean Name
├─ Remove title prefixes:
│   Thai: "นาง", "ดร.", "น.ส.", "นาย"
│   English: "Mr.", "Mrs.", "Miss", "Master"
└─ Trim whitespace

Step 2: Call Backend User Search API
├─ Query: /api/users/list?search={name}&userCategory=member
├─ First try members
├─ If no results, try non-members
├─ Limit: 50 results
└─ Timeout: 3 seconds

Step 3: Verify Account Match (if provided)
├─ Pattern matching for masked account
├─ If exact match found:
│   └─ Return with matchMethod="name-and-account-verified"
└─ Otherwise: Return first match

Return: { user: {...}, matchMethod: "name-only" | "name-and-account-verified" }
```

**Match Methods**:
- `name-and-account-verified`: Highest confidence
- `name-only`: Good confidence
- `null`: No match found

#### 5. Auto Credit (src/api/scan.ts → submitCredit)

**Purpose**: Submit credit to user's account

**Process**:
```
Step 1: Determine Endpoint
├─ IF user.memberCode exists:
│   └─ Endpoint: /api/banking/transactions/deposit-record
│   └─ Use: memberCode for existing members
└─ ELSE (new/non-member):
    └─ Endpoint: /api/banking/transactions/first-time-deposit-record
    └─ Use: userId for new accounts

Step 2: Build Payload
{
  memberCode: "USER123",  // or userId for first-time
  creditAmount: 500,
  depositChannel: "Mobile Banking (มือถือ)",
  toAccountId: "ACC456",
  transferAt: "2026-02-25T10:30:00Z",
  auto: true,
  fromAccountNumber: "123456789"
}

Step 3: Submit to Backend
├─ Method: POST
├─ Header: Authorization Bearer {token}
├─ Timeout: 3 seconds
└─ Receive: { message: "...", data: {...} }

Step 4: Check Response
├─ message == "DUPLICATE_WITH_ADMIN_RECORD"
│   └─ Set isDuplicate = true
├─ response.ok == true
│   └─ Set success = true
└─ Otherwise: error with message

Return: { success: bool, isDuplicate?: bool, message: string }
```

**Transaction Status Flow**:
```
pending_verification
    ↓ (after slip verified)
pending
    ↓ (after account matched)
matched
    ↓ (after user found & verified)
credited OR duplicate
    ↓
(final state - stored in credited_at timestamp)
```

#### 6. LINE Webhook Handler (src/webhooks/line.ts)

**Purpose**: Handle incoming LINE bot messages

**Incoming Webhook Format**:
```json
{
  "events": [
    {
      "type": "message",
      "message": {
        "type": "image",
        "id": "100001",
        "contentProvider": {"type": "line"}
      },
      "replyToken": "nHuyWiB7yP5Zw52FIkcQT...",
      "source": {
        "type": "user",
        "userId": "U1234567890abcdef1234"
      },
      "timestamp": 1462629479859
    }
  ]
}
```

**Processing**:
```
POST /webhook/{tenantId}/{oaId}

1. Parse Events Loop
   For each event in body.events:
   
2. Check Message Type
   If type != "message" or message.type != "image"
   → Skip to next event

3. Send Immediate Reply
   If imageReplyEnabled:
   │ └─ Send text: imageReplyMessage
   │    (e.g., "ขอบคุณที่ส่งสลิป กำลังตรวจสอบ...")

4. Download Image from LINE
   └─ GET /v2/bot/message/{messageId}/content
   └─ Headers: Authorization Bearer {channelAccessToken}
   └─ Result: ArrayBuffer

5. Save to Database
   └─ Insert to pending_transactions
   └─ status: "pending_verification"
   └─ store userId, messageId, timestamp

6. Schedule Background Processing
   └─ ctx.waitUntil(processSlipInBackground(...))
   └─ Returns immediately to LINE (200 OK)
   └─ Processing happens in background

Background Task:
├─ Verify SLIP
├─ Match account
├─ Search user
├─ Submit credit
├─ Update status
└─ Send Flex message
```

**LINE Channel Access Token**:
- Retrieved from `line_oas` table
- Stored when LINE OA configured
- Used for all LINE API calls (reply, push, get content)

#### 7. Flex Message Builder (src/utils/flex-messages.ts)

**Purpose**: Create rich message notifications for LINE

**Success Message Structure**:
```json
{
  "type": "flex",
  "altText": "✅ ฝากเงินสำเร็จ 500.00 THB",
  "contents": {
    "type": "bubble",
    "header": {
      "type": "box",
      "backgroundColor": "#000000",  // colorHeaderFooterBg
      "contents": [
        {"type": "image", "url": logoUrl},
        {"type": "text", "text": "AUTO DEPOSIT SUCCESS", "color": "#D4AF37"}
      ]
    },
    "body": {
      "type": "box",
      "backgroundColor": "#1A1A1A",
      "contents": [
        // Success title
        {"text": "ฝากเงินสำเร็จ", "color": "#33FF33"},
        // Details box with:
        //   - ยูสเซอร์: USER123
        //   - จำนวนเงิน: 500.00 THB
        //   - วันที่/เวลา: 25/02/2569 10:30
      ]
    },
    "footer": {...}
  }
}
```

**Customizable Colors**:
```
colorHeaderFooterBg    ← Header/Footer background
colorBodyBg            ← Body background
colorPrimary           ← Primary text color
colorSuccessText       ← Success message color
colorValueText         ← Amount/values color
colorSeparator         ← Line separator color
colorMutedText         ← Secondary/muted text color
```

**Duplicate Message**:
- Same structure but with:
  - Title: "DUPLICATE TRANSACTION"
  - Color: Orange (#FFA500)
  - Message: Transaction already exists in system

### Caching Strategy

**KV Cache Layers**:
```
tenant:{tenantId}:session
├─ Content: { token, username, status, lastValidatedAt }
├─ TTL: None (manual delete on logout)
└─ Used for: Session verification

tenant:{tenantId}:accounts
├─ Content: { accounts: [...], cachedAt: timestamp }
├─ TTL: accountListTtl (default 5 minutes)
└─ Used for: Fast account matching
```

**D1 (SQLite) Cache**:
- Session tokens stored persistently
- Pending transactions stored for history
- Message settings stored per tenant
- Account name mappings for manual overrides

### Duplicate Detection

**Method 1: Database UNIQUE Constraint**
```sql
UNIQUE(tenant_id, slip_ref)
```
- `slip_ref` = transaction reference from SLIP
- Prevents duplicate rows in database
- Caught during INSERT

**Method 2: Backend Response**
```
submitCredit() response:
  message == "DUPLICATE_WITH_ADMIN_RECORD"
  → isDuplicate = true
  → Update status = "duplicate"
```

**Method 3: Manual Check**
```
GET /api/scan/check-duplicate?ref={transRef}
→ Returns: { isDuplicate: bool }
```

### Error Handling & Recovery

```
SLIP Verification Failed
├─ Reason: Invalid image, timeout, API error
├─ Action: Update status = "failed"
└─ Notification: None (or error reply via LINE)

Account Not Matched
├─ Reason: Receiver not found in system
├─ Action: Leave status = "pending" (manual review)
└─ Notification: None (admin must handle)

User Not Found
├─ Reason: Sender name not in system
├─ Action: Leave status = "matched" (manual review)
└─ Notification: None (admin must handle)

Credit Submission Failed
├─ Reason: Backend error, timeout, validation
├─ Action: Log error, leave status = "matched"
└─ Notification: Error (if enabled)

Network Timeout
├─ Reason: EasySlip/Backend API slow
├─ Action: Retry with exponential backoff
└─ Max retries: 3 (configurable)
```

### Security Considerations

1. **Token Management**
   - Admin tokens stored securely in D1
   - Also cached in KV for performance
   - Clear on logout
   - Validate on each request

2. **Database Access**
   - All queries parameterized (SQL injection prevention)
   - FOREIGN KEY constraints enforce data integrity
   - Row-level access control (via tenant_id)

3. **External API Calls**
   - Timeout limits prevent hanging
   - Bearer token authentication
   - Request validation before sending

4. **User Input Validation**
   - SLIP data extracted by external service (EasySlip)
   - Name matching uses safe string operations
   - Account matching uses exact/pattern matching

---

## VERSION THAI (ไทย)

### ภาพรวมระบบ

AT SLIP เป็นระบบฝากเงินอัตโนมัติแบบ serverless ที่:
1. รับสลิปการโอนเงิน (รูปภาพ SLIP) ผ่าน LINE Bot
2. ตรวจสอบสลิปโดยใช้ OCR/AI (EasySlip API)
3. จับคู่บัญชีผู้รับไปยังบัญชีในระบบ
4. ระบุตัวตนผู้ส่ง (ผู้ใช้) ในระบบ
5. ส่งเงินให้กับบัญชีของผู้ใช้โดยอัตโนมัติ
6. ส่งการแจ้งเตือนกลับไปยังผู้ใช้

### โครงสร้างการไหลของข้อมูล

**องค์ประกอบหลัก** (อธิบายโดยคร่าวเดียวกับภาษาอังกฤษ แต่ในบริบทไทย):

1. **Admin Authentication** - การรับรองความถูกต้องของ Admin
   - เก็บ token ใน D1 และ KV cache
   - เซสชันมี TTL และลบเมื่อออกจากระบบ
   - Prefetch บัญชี สำหรับการจับคู่ที่รวดเร็ว

2. **ตรวจสอบ SLIP**
   - ส่งไปยัง EasySlip API
   - ดึงข้อมูลผู้ส่ง/ผู้รับ
   - ดึงจำนวนเงินและข้อมูลธุรกรรม

3. **จับคู่บัญชี**
   - จับคู่ตรงตัว (เลขที่บัญชีตรงกัน)
   - จับคู่ตัวอักษร (เลขที่ปิดบังตรงกัน)
   - จับคู่ชื่อ (ชื่อผู้ถือบัญชีตรงกัน)
   - จับคู่ด้วยตนเอง (ระบบจับคู่ที่กำหนดไว้)

4. **ค้นหาผู้ใช้**
   - ลบคำนำหน้าชื่อ (นาง, ดร., Mr., Mrs. ฯลฯ)
   - ค้นหาสมาชิกก่อน จากนั้นไม่ใช่สมาชิก
   - ตรวจสอบบัญชีธนาคาร (หากระบุ)

5. **ส่งเงิน**
   - เลือก endpoint ตามประเภทผู้ใช้
   - Member: `/deposit-record`
   - Non-member: `/first-time-deposit-record`
   - ตรวจจับการซ้ำจากการตอบสนอง

6. **ส่ง Notification**
   - สร้าง Flex message ที่กำหนดเอง
   - แสดงจำนวนเงิน วันที่ และข้อมูลผู้ใช้
   - ส่งไปยัง LINE ผ่านแชท

### บริหารจัดการเซสชัน

```
Login: เก็บ token ใน D1 (persistent)
       เก็บ token ใน KV (cache)
       Prefetch บัญชี (TTL: 5 นาที)

Usage: ตรวจสอบ token จาก KV ก่อน
       ถ้าเกินอายุ ดึงจาก D1
       ทำการใหม่ถ้างาน

Logout: ลบจาก D1
        ลบจาก KV
        ลบบัญชีแคช
```

### ประเภทของสถานะธุรกรรม

```
pending_verification  → เมื่อได้รับรูปภาพ เรียงรอการตรวจสอบ
         ↓
    pending         → ตรวจสอบเสร็จแล้ว รอการจับคู่บัญชี
         ↓
    matched         → จับคู่บัญชีและผู้ใช้สำเร็จ รอการส่งเงิน
         ↓
    credited        → ส่งเงินสำเร็จ
      หรือ
    duplicate       → พบว่าเป็นการซ้ำ
      หรือ
    failed          → มีข้อผิดพลาด
```

### การจักคู่บัญชี (สรุป)

```
1. จับคู่ตรงตัว
   123456789 == 123456789 ✅

2. จับคู่ตัวอักษร
   Masked: 1234xx789
   System: 123456789 ✅

3. จับคู่ชื่อ
   "ABC CO. LIMITED" ≈ "ABC COMPANY LIMITED"
   [ABC] [COMPANY] [LIMITED] → Match ✅

4. จับคู่ด้วยตนเอง
   Table: account_name_mappings
   account_number → name_th, name_en ✅
```

### ส่วนประกอบแคช

```
KV Cache:
├─ tenant:{tenantId}:session
│  └─ Token, Username, Status
└─ tenant:{tenantId}:accounts
   └─ Account List (TTL: 5 min)

D1 SQLite:
├─ tenant_sessions
├─ pending_transactions
├─ message_settings
└─ account_name_mappings
```

---

**เขียนวันที่**: กุมภาพันธ์ 2026
**สถานะ**: ดึงออกจาก Bundle แล้ว
**ความครอบคลุม**: ประมาณ 90% ของลอจิกดั้งเดิม
