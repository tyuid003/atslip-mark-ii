# Admin Backend API — v1 vs v2 Mapping Draft

> **วิธีใช้**: เติม endpoint จริงของ v2 ในคอลัมน์ `v2 Endpoint` และตัวอย่าง response ในส่วน Response ของแต่ละ API
> ฟิลด์ที่เป็น `???` = ยังต้องกรอกข้อมูล

---

## 1. Authentication

### 1.1 GET Captcha

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `GET {admin_api_url}/api/captcha` |
| **v2 Endpoint** | `???` |
| **Headers** | - |
| **Purpose** | ดึงรูป captcha ก่อน login |

**v1 Response:**
```json
{
  "id": "captcha-id-string",
  "base64": "data:image/png;base64,..."
}
```

**v2 Response:**
```json
v2 ไม่ใช้ captcha login
```

---

### 1.2 POST Login (with captcha)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `POST {admin_api_url}/api/login` |
| **v2 Endpoint** | `POST {admin_api_url}/api/auth/login |
| **Headers** | `Content-Type: application/json` |
| **Purpose** | Login และรับ session token |

**v1 Request Body:**
```json
{
  "username": "...",
  "password": "...",
  "captchaId": "...",
  "captchaValue": "...",
  "agent": "Mozilla/5.0...",
  "ipAddress": "1.2.3.4"
}
```

**v1 Response:**
```json
{
  "token": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**v2 Request Body:**
```json
{
    "username": "...",
    "password": "..."
}
```

**v2 Response:**
```json
{
    "success": true,
    "message": "เข้าสู่ระบบสำเร็จ",
    "data": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbl9pZCI6NDksInVzZXJuYW1lIjoiVGFlQmV0YVgyIiwicm9sZV9pZCI6MjYsInJvbGVfbmFtZSI6IuC4quC4tOC4l-C4mOC4tOC5jOC4l-C4seC5ieC4h-C4q-C4oeC4lCIsInBlcm1pc3Npb25zIjpbIlBFUk1JX1NVTU1BUlkiLCJQRVJNSV9TVU1NQVJZX0RBU0hCT0FSRCIsIlBFUk1JX1NVTU1BUllfREVQT1NJVF9XSVRIRFJBVyIsIlBFUk1JX1NVTU1BUllfTkVXX01FTUJFUiIsIlBFUk1JX01FTUJFUiIsIlBFUk1JX01FTUJFUl9MSVNUIiwiUEVSTUlfTUVNQkVSX0FERCIsIlBFUk1JX01FTUJFUl9FRElUIiwiUEVSTUlfTUVNQkVSX0RFTEVURSIsIlBFUk1JX01FTUJFUl9FWFBPUlQiLCJQRVJNSV9NRU1CRVJfU01TIiwiUEVSTUlfTUVNQkVSX0FERF9GUkFVRCIsIlBFUk1JX01FTUJFUl9FRElUX0hJU1RPUlkiLCJQRVJNSV9NRU1CRVJfRlJBVUQiLCJQRVJNSV9NRU1CRVJfQ0FOQ0VMX0ZSQVVEIiwiUEVSTUlfTUVNQkVSX0lOQUNUSVZFIiwiUEVSTUlfTUVNQkVSX1RVUk5PVkVSX1BFTkRJTkciLCJQRVJNSV9NRU1CRVJfV0lUSERSQVdfUEVORElORyIsIlBFUk1JX0RFUE9TSVRfTElTVCIsIlBFUk1JX1dJVEhEUkFXX0xJU1QiLCJQRVJNSV9XSVRIRFJBV19SRUNPUkQiLCJQRVJNSV9XSVRIRFJBV19DQU5DRUxfQ1JFRElUIiwiUEVSTUlfVFJBTlNBQ1RJT05fQ09NUExFVEVEIiwiUEVSTUlfVFJBTlNBQ1RJT05fQ09NUExFVEVEX0RFTEVURSIsIlBFUk1JX1RSQU5TQUNUSU9OX0NPTVBMRVRFRF9FWFBPUlQiLCJQRVJNSV9CQU5LIiwiUEVSTUlfQkFOS19MSVNUIiwiUEVSTUlfQkFOS19TVU1NQVJZX1JFUE9SVCIsIlBFUk1JX0JBTktfUEFZTUVOVF9ERVBPU0lUIiwiUEVSTUlfQkFOS19TTVNfREVQT1NJVCIsIlBFUk1JX0JBTktfVFJBTlNGRVIiLCJQRVJNSV9QTEFZIiwiUEVSTUlfUExBWV9XSU5fTE9TRV9SRVBPUlQiLCJQRVJNSV9QTEFZX0hJU1RPUlkiLCJQRVJNSV9NQVJLRVRJTkdfUkVQT1JUIiwiUEVSTUlfTUFSS0VUSU5HX1JFUE9SVF9CT05VUyIsIlBFUk1JX01BUktFVElOR19SRVBPUlRfUkVGRVJSQUwiLCJQRVJNSV9NQVJLRVRJTkdfUkVQT1JUX0RBSUxZIiwiUEVSTUlfTUFSS0VUSU5HX1JFUE9SVF9CT05VU19TVU1NQVJZIiwiUEVSTUlfQUZGSUxJQVRFIiwiUEVSTUlfQUZGSUxJQVRFX0VESVQiLCJQRVJNSV9BRkZJTElBVEVfREVMRVRFIiwiUEVSTUlfRVZFTlRfTUFOQUdFIiwiUEVSTUlfUFJPTU9USU9OIiwiUEVSTUlfUFJPTU9USU9OX0xJU1QiLCJQRVJNSV9QUk9NT1RJT05fQUREIiwiUEVSTUlfUFJPTU9USU9OX0VESVQiLCJQRVJNSV9QUk9NT1RJT05fREVMRVRFIiwiUEVSTUlfUFJPTU9USU9OX0FQUFJPVkUiLCJQRVJNSV9QUk9NT1RJT05fQ0FOQ0VMIiwiUEVSTUlfUFJPTU9USU9OX01FTUJFUl9ISVNUT1JZIiwiUEVSTUlfU01TX1NFTkQiLCJQRVJNSV9TRVRUSU5HIiwiUEVSTUlfU0VUVElOR19CQVNJQyIsIlBFUk1JX1NFVFRJTkdfVFVSTk9WRVIiLCJQRVJNSV9TRVRUSU5HX0JBTktfUkVHSVNURVIiLCJQRVJNSV9TRVRUSU5HX05PVElGSUNBVElPTiIsIlBFUk1JX1NFVFRJTkdfRVhDSEFOR0VfUkFURSIsIlBFUk1JX1NFVFRJTkdfV0lUSERSQVdfTElNSVQiLCJQRVJNSV9TRVRUSU5HX0dBTUVfQ0FURUdPUlkiLCJQRVJNSV9TRVRUSU5HX1JFRkVSUkFMIiwiUEVSTUlfU0VUVElOR19SRUZFUlJBTF9FRElUIiwiUEVSTUlfU0VUVElOR19HT09HTEVfQU5BTFlUSUNTIiwiUEVSTUlfU0VUVElOR19XRUIiLCJQRVJNSV9TRVRUSU5HX1dFQl9CQU5ORVIiLCJQRVJNSV9TRVRUSU5HX1dFQl9ORVdTIiwiUEVSTUlfU0VUVElOR19XRUJfREVQT1NJVF9XSVRIRFJBV19NRVNTQUdFIiwiUEVSTUlfU0VUVElOR19HQU1FX0xJU1QiLCJQRVJNSV9BRE1JTiIsIlBFUk1JX0FETUlOX01BTkFHRSIsIlBFUk1JX0FETUlOX0FERCIsIlBFUk1JX0FETUlOX0VESVQiLCJQRVJNSV9BRE1JTl9ERUxFVEUiLCJQRVJNSV9BRE1JTl9SRVNFVF8yRkEiLCJQRVJNSV9BRE1JTl9HUk9VUCIsIlBFUk1JX0FETUlOX0dST1VQX0FERCIsIlBFUk1JX0FETUlOX0dST1VQX0VESVQiLCJQRVJNSV9BRE1JTl9HUk9VUF9ERUxFVEUiLCJQRVJNSV9BRE1JTl9MT0dJTl9ISVNUT1JZIiwiUEVSTUlfQURNSU5fQUNUSU9OX0hJU1RPUlkiLCJQRVJNSV9JTlZPSUNFIiwiUEVSTUlfQURNSU5fREFTSEJPQVJEIiwiUEVSTUlfVVNFUl9HVUlERSIsIlBFUk1JX0RFUE9TSVRfQ1JFQVRFIiwiUEVSTUlfREVQT1NJVF9QUk9DRVNTIiwiUEVSTUlfU0VUVElOR19QR19IQVJEIiwiUEVSTUlfU0VUVElOR19CRVRfTElNSVQiLCJQRVJNSV9TRVRUSU5HX1dFQl9DVVNUT01fTEFZT1VUIl0sInRva2VuX3ZlcnNpb24iOjQsImlzcyI6ImNiZ2FtZS1hZG1pbiIsImV4cCI6MTc4MTE1Nzk1NiwibmJmIjoxNzgxMDcxNTU2LCJpYXQiOjE3ODEwNzE1NTZ9.-JoSAelRg-E5fWEPnk0i7Y1uxWVK6LHDJ5I2GTBxQro",
        "expiresIn": 86400,
        "adminIdleTimeout": 1440,
        "admin": {
            "id": 49,
            "username": "TaeBetaX2",
            "fullName": "TaeBetaX2",
            "role": {
                "id": 26,
                "name": "สิทธิ์ทั้งหมด"
            },
            "permissions": [
                "PERMI_SUMMARY",
                "PERMI_SUMMARY_DASHBOARD",
                "PERMI_SUMMARY_DEPOSIT_WITHDRAW",
                "PERMI_SUMMARY_NEW_MEMBER",
                "PERMI_MEMBER",
                "PERMI_MEMBER_LIST",
                "PERMI_MEMBER_ADD",
                "PERMI_MEMBER_EDIT",
                "PERMI_MEMBER_DELETE",
                "PERMI_MEMBER_EXPORT",
                "PERMI_MEMBER_SMS",
                "PERMI_MEMBER_ADD_FRAUD",
                "PERMI_MEMBER_EDIT_HISTORY",
                "PERMI_MEMBER_FRAUD",
                "PERMI_MEMBER_CANCEL_FRAUD",
                "PERMI_MEMBER_INACTIVE",
                "PERMI_MEMBER_TURNOVER_PENDING",
                "PERMI_MEMBER_WITHDRAW_PENDING",
                "PERMI_DEPOSIT_LIST",
                "PERMI_WITHDRAW_LIST",
                "PERMI_WITHDRAW_RECORD",
                "PERMI_WITHDRAW_CANCEL_CREDIT",
                "PERMI_TRANSACTION_COMPLETED",
                "PERMI_TRANSACTION_COMPLETED_DELETE",
                "PERMI_TRANSACTION_COMPLETED_EXPORT",
                "PERMI_BANK",
                "PERMI_BANK_LIST",
                "PERMI_BANK_SUMMARY_REPORT",
                "PERMI_BANK_PAYMENT_DEPOSIT",
                "PERMI_BANK_SMS_DEPOSIT",
                "PERMI_BANK_TRANSFER",
                "PERMI_PLAY",
                "PERMI_PLAY_WIN_LOSE_REPORT",
                "PERMI_PLAY_HISTORY",
                "PERMI_MARKETING_REPORT",
                "PERMI_MARKETING_REPORT_BONUS",
                "PERMI_MARKETING_REPORT_REFERRAL",
                "PERMI_MARKETING_REPORT_DAILY",
                "PERMI_MARKETING_REPORT_BONUS_SUMMARY",
                "PERMI_AFFILIATE",
                "PERMI_AFFILIATE_EDIT",
                "PERMI_AFFILIATE_DELETE",
                "PERMI_EVENT_MANAGE",
                "PERMI_PROMOTION",
                "PERMI_PROMOTION_LIST",
                "PERMI_PROMOTION_ADD",
                "PERMI_PROMOTION_EDIT",
                "PERMI_PROMOTION_DELETE",
                "PERMI_PROMOTION_APPROVE",
                "PERMI_PROMOTION_CANCEL",
                "PERMI_PROMOTION_MEMBER_HISTORY",
                "PERMI_SMS_SEND",
                "PERMI_SETTING",
                "PERMI_SETTING_BASIC",
                "PERMI_SETTING_TURNOVER",
                "PERMI_SETTING_BANK_REGISTER",
                "PERMI_SETTING_NOTIFICATION",
                "PERMI_SETTING_EXCHANGE_RATE",
                "PERMI_SETTING_WITHDRAW_LIMIT",
                "PERMI_SETTING_GAME_CATEGORY",
                "PERMI_SETTING_REFERRAL",
                "PERMI_SETTING_REFERRAL_EDIT",
                "PERMI_SETTING_GOOGLE_ANALYTICS",
                "PERMI_SETTING_WEB",
                "PERMI_SETTING_WEB_BANNER",
                "PERMI_SETTING_WEB_NEWS",
                "PERMI_SETTING_WEB_DEPOSIT_WITHDRAW_MESSAGE",
                "PERMI_SETTING_GAME_LIST",
                "PERMI_ADMIN",
                "PERMI_ADMIN_MANAGE",
                "PERMI_ADMIN_ADD",
                "PERMI_ADMIN_EDIT",
                "PERMI_ADMIN_DELETE",
                "PERMI_ADMIN_RESET_2FA",
                "PERMI_ADMIN_GROUP",
                "PERMI_ADMIN_GROUP_ADD",
                "PERMI_ADMIN_GROUP_EDIT",
                "PERMI_ADMIN_GROUP_DELETE",
                "PERMI_ADMIN_LOGIN_HISTORY",
                "PERMI_ADMIN_ACTION_HISTORY",
                "PERMI_INVOICE",
                "PERMI_ADMIN_DASHBOARD",
                "PERMI_USER_GUIDE",
                "PERMI_DEPOSIT_CREATE",
                "PERMI_DEPOSIT_PROCESS",
                "PERMI_SETTING_PG_HARD",
                "PERMI_SETTING_BET_LIMIT",
                "PERMI_SETTING_WEB_CUSTOM_LAYOUT"
            ],
            "isSuperAdmin": false,
            "status": "active"
        }
    }
}
```

> ⚠️ หมายเหตุ: ค่าที่ระบบ ATslip ดึงจาก response คือ `token` (เท่านั้น)

---

### 1.3 POST Connect (Auto Login — ไม่มี captcha)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `POST {admin_api_url}/api/login` |
| **v2 Endpoint** | `???` |
| **Purpose** | Login อัตโนมัติจากระบบ (ไม่ต้องกรอก captcha) |

**v1 Request Body:**
```json
{
  "username": "...",
  "password": "..."
}
```

**v1 Response:**
```json
{
  "token": "eyJ..."
}
```

> ⚠️ หมายเหตุ: `connectAdmin` (tenant.service.ts) ใช้ endpoint เดิมโดยไม่ส่ง captcha — v2 อาจต้องใช้ endpoint อื่น

---

## 2. Bank Accounts

### 2.1 GET Bank Accounts List

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `GET {admin_api_url}/api/accounting/bankaccounts/list?limit=100` |
| **v2 Endpoint** | `GET 
{admin_api_url}/api/proxy/v1/admin/bank-accounts?page=1&limit=50 |
| **Headers** | `Authorization: Bearer {sessionToken}` |
| **Purpose** | ดึงรายชื่อบัญชีธนาคารทั้งหมด |

**v1 Response:**
```json
{
  "list": [
    {
      "id": 1,
      "bankName": "กสิกรไทย",
      "accountNumber": "xxx-x-xxxxx-x",
      "accountName": "...",
      "balance": 0
    }
  ],
  "total": 1
}
```

> ⚠️ หมายเหตุ: ระบบ ATslip ใช้ `data.list` (ไม่ใช่ `data.accounts`) สำหรับ v1

**v2 Response:**
```json
{
    "success": true,
    "message": "ดึงรายการบัญชีธนาคารสำเร็จ",
    "data": {
        "list": [
            {
                "id": 160,
                "bank": {
                    "id": 50,
                    "name": "ทรูมันนี่ วอลเล็ท",
                    "code": "tmn",
                    "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_truemoney.webp",
                    "bankType": "ewallet",
                    "currency": ""
                },
                "serviceTypeId": 5,
                "serviceTypeName": "TrueMoney API",
                "accountName": "ตะวัน เที่ยงธรรม",
                "accountNumber": "0937383566",
                "shopName": "",
                "accountBalance": 0,
                "isAllowDeposit": true,
                "isAllowWithdraw": false,
                "isWithdrawAutoTransfer": false,
                "status": "active",
                "createdAt": "2026-06-10T05:13:27+07:00",
                "updatedAt": "2026-06-10T05:38:41+07:00"
            },
            {
                "id": 159,
                "bank": {
                    "id": 1,
                    "name": "ธนาคารไทยพาณิชย์",
                    "code": "scb",
                    "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_scb.webp",
                    "bankType": "bank",
                    "currency": "",
                    "smsRequiresDecimal": false
                },
                "serviceTypeId": 2,
                "serviceTypeName": "SMS Deposit",
                "accountName": "รัตนาวดี พรมปัญญา",
                "accountNumber": "4172196626",
                "shopName": "",
                "accountBalance": 0,
                "isAllowDeposit": true,
                "isAllowWithdraw": false,
                "isWithdrawAutoTransfer": false,
                "status": "active",
                "createdAt": "2026-06-10T04:20:34+07:00",
                "updatedAt": "2026-06-10T04:25:25+07:00"
            },
            {
                "id": 158,
                "bank": {
                    "id": 1,
                    "name": "ธนาคารไทยพาณิชย์",
                    "code": "scb",
                    "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_scb.webp",
                    "bankType": "bank",
                    "currency": "",
                    "smsRequiresDecimal": false
                },
                "serviceTypeId": 2,
                "serviceTypeName": "SMS Deposit",
                "accountName": "อรญา งอยผาลา",
                "accountNumber": "3432361428",
                "shopName": "",
                "accountBalance": 0,
                "isAllowDeposit": true,
                "isAllowWithdraw": false,
                "isWithdrawAutoTransfer": false,
                "status": "active",
                "createdAt": "2026-06-10T04:02:51+07:00",
                "updatedAt": "2026-06-10T04:09:52+07:00"
            },
            {
                "id": 157,
                "bank": {
                    "id": 55,
                    "name": "MyPay",
                    "code": "mypay",
                    "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_promptpay.webp",
                    "bankType": "payment_gateway",
                    "currency": "",
                    "smsRequiresDecimal": false
                },
                "serviceTypeId": 6,
                "serviceTypeName": "Payment Gateway",
                "accountName": "MyPay",
                "accountNumber": "PG-mypay",
                "shopName": "BetaX2",
                "accountBalance": 0,
                "isAllowDeposit": false,
                "isAllowWithdraw": false,
                "isWithdrawAutoTransfer": false,
                "status": "active",
                "createdAt": "2026-06-10T03:29:33+07:00",
                "updatedAt": null
            }
        ],
        "total": 4,
        "page": 1,
        "limit": 50,
        "totalPages": 1
    }
}
```

---

## 3. Users

### 3.1 GET User List (Search)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `GET {admin_api_url}/api/users/list?page=1&limit=50&search={keyword}&userCategory={member\|non-member}` |
| **v2 Endpoint** | `GET 
{admin_api_url}/api/proxy/v1/admin/members?page=1&limit=50&search=0632204%E0%B8%A3%E0%B8%9A%E0%B8%81%E0%B8%A7%E0%B8%99%E0%B8%84%E0%B8%B8%E0%B8%93%E0%B8%9E%E0%B8%B5%E0%B9%88%E0%B8%A3%E0%B8%AD%E0%B9%81%E0%B8%AD%E0%B8%94%E0%B8%A1%E0%B8%B4%E0%B8%99%E0%B8%95%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%AA%E0%B8%AD%E0%B8%9A%E0%B9%83%E0%B8%AB%E0%B9%89%E0%B8%AA%E0%B8%B1%E0%B8%81%E0%B8%84%E0%B8%A3%E0%B8%B9%E0%B9%88%E0%B8%99%E0%B8%B0%E0%B8%84%E0%B8%B0+%E2%8F%B323 |
| **Headers** | `Authorization: Bearer {sessionToken}` |
| **Purpose** | ค้นหาผู้ใช้ด้วย keyword (memberCode / username / id) |

**v1 Response:**
```json
{
  "list": [
    {
      "id": "user-internal-id",
      "memberCode": "MEM001",
      "username": "player123",
      "fullname": "สมชาย ใจดี",
      "bankAccount": "1234567890",
      "bank": "KBANK"
    }
  ],
  "total": 1
}
```

> ⚠️ หมายเหตุ: ระบบ ATslip ใช้ `data.list` และ match ด้วย `memberCode`, `username`, `id`

**v2 Response:**
```json
{
    "success": true,
    "message": "ดึงข้อมูลสมาชิกสำเร็จ",
    "data": {
        "list": [
            {
                "id": 157,
                "memberCode": "zta70fb1002030",
                "username": "0632204239",
                "fullName": "ลาภทวี โพธิ์อ่อง",
                "balance": 300,
                "bank": {
                    "id": 2,
                    "code": "kbank",
                    "nameTh": "ธนาคารกสิกรไทย",
                    "nameEn": "Kasikorn Bank",
                    "swiftCode": "KASITHBK",
                    "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_kbank.webp",
                    "bankType": "bank",
                    "currency": "THB",
                    "countryCode": "TH",
                    "colorCode": "#138F2D",
                    "isShowRegister": true,
                    "isActive": true,
                    "sortOrder": 2,
                    "displayOrder": 2,
                    "smsRequiresDecimal": true,
                    "notiRequiresDecimal": false,
                    "jsonConfig": "{}",
                    "createdAt": "2025-12-18T19:26:05+07:00",
                    "updatedAt": "2026-02-12T18:04:46+07:00"
                },
                "accountNumber": "0371586938",
                "accountName": "ลาภทวี โพธิ์อ่อง",
                "status": "active",
                "remark": "migrated from v1",
                "registerIp": "188.166.182.143",
                "registerAt": "2026-06-10T10:19:51+07:00",
                "lastLoginIp": "188.166.182.143",
                "lastLoginAt": "2026-06-10T12:28:03+07:00",
                "lastActiveAt": "2026-06-10T12:28:03+07:00",
                "updatedAt": "2026-06-10T12:28:03+07:00"
            }
        ],
        "total": 1,
        "page": 1,
        "limit": 50,
        "totalPages": 1
    }
}
```

---

### 3.2 GET Generate MemberCode

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `GET {admin_api_url}/api/admin/gen-membercode/{userId}` |
| **v2 Endpoint** | `v2 ไม่ใช้ gencode เนื่องจากสมาชิกทุกคนเมื่อสมัครแล้วจะมียูสเซอร์ทุกคนแล้ว |
| **Headers** | `Authorization: Bearer {sessionToken}` |
| **Purpose** | สร้าง memberCode ให้ non-member user |

**v1 Response (รูปแบบที่เป็นไปได้หลายแบบ):**
```json
"MEM001"
```
หรือ
```json
{
  "memberCode": "MEM001"
}
```
หรือ
```json
{
  "data": {
    "memberCode": "MEM001"
  }
}
```

> ⚠️ หมายเหตุ: ระบบ ATslip ลอง extract memberCode จากหลาย path (string, `.memberCode`, `.data.memberCode`, `.username` ฯลฯ)

**v2 Response:**
```json
???
```

---

## 4. Transactions / Credit

### 4.1 POST Deposit Record (เติมเครดิต)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `POST {admin_api_url}/api/banking/transactions/deposit-record` |
| **v2 Endpoint** | `POST 
https://admin.betax2.site/api/proxy/v1/admin/deposits |
| **Headers** | `Authorization: Bearer {sessionToken}`, `Content-Type: application/json` |
| **Purpose** | เติมเครดิตให้ผู้ใช้หลังสแกนสลิปสำเร็จ |

**v1 Request Body:**
```json
{
  "memberCode": "MEM001",
  "creditAmount": 1000.00,
  "depositChannel": "Mobile Banking (มือถือ)",
  "toAccountId": 1,
  "transferAt": "2024-01-01T12:00:00.000Z",
  "auto": true,
  "fromAccountNumber": "874595"
}
```

> ⚠️ หมายเหตุ:
> - `fromAccountNumber` ถูกตัดเหลือแค่ **6 หลักท้าย** เพื่อตรงกับ SMS bot
> - `toAccountId` เป็น integer (ID ของบัญชีธนาคารฝั่ง admin)
> - `auto: true` บอก admin ว่าเป็นการเติมอัตโนมัติ

**v1 Response (สำเร็จ):**
```json
{
  "message": "success",
  "data": { ... }
}
```

**v1 Response (ซ้ำ):**
```json
{
  "message": "DUPLICATE_WITH_ADMIN_RECORD",
  "status": "DUPLICATED"
}
```

**v2 Request Body:**
```json
{
    "userId": 157,
    "amount": 1,
    "autoApprove": true,
    "remark": "ทพสอบฝากเครดิต",
    "fromBankCode": "kbank",
    "fromAccountNumber": "0371586938",
    "fromAccountName": "ลาภทวี โพธิ์อ่อง",
    "bankAccountId": 158,
    "isBonus": false
}
```

**v2 Response:**
```json
{
    "success": true,
    "message": "เติมเงินให้ User สำเร็จ",
    "data": {
        "id": 267,
        "transactionRef": "DEP-20260610-132630-0PVV4B",
        "userId": 157,
        "amount": 1,
        "status": "completed",
        "channel": "admin",
        "paymentMethod": "admin_credit",
        "createdBy": 49,
        "approvedBy": 49,
        "remark": "ทพสอบฝากเครดิต",
        "balanceBefore": 300,
        "balanceAfter": 301,
        "bonusAmount": 0,
        "createdAt": "2026-06-10T13:26:31+07:00",
        "updatedAt": "2026-06-10T13:26:31+07:00",
        "userInfo": {
            "id": 157,
            "username": "0632204239",
            "fullName": "ลาภทวี โพธิ์อ่อง"
        },
        "bankInfo": {
            "bankCode": "kbank",
            "accountNumber": "0371586938",
            "accountName": "ลาภทวี โพธิ์อ่อง"
        },
        "bankAccountInfo": {
            "id": 158,
            "bankCode": "scb",
            "bankName": "ธนาคารไทยพาณิชย์",
            "accountName": "อรญา งอยผาลา",
            "accountNumber": "3432361428",
            "iconUrl": "https://cdn.cbgame88.com/cybergame_bank_icon/square/thb_scb.webp"
        }
    }
}
```

---

### 4.2 POST Withdraw Credit Back (คืนเครดิต)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | `POST {admin_api_url}/api/banking/transactions/withdraw-credit-back` |
| **v2 Endpoint** | `POST 
{admin_api_url}/api/proxy/v1/admin/withdraws |
| **Headers** | `Authorization: Bearer {sessionToken}`, `Content-Type: application/json` |
| **Purpose** | คืนเครดิตกลับ (ยกเลิกรายการ) |

**v1 Request Body:**
```json
{
  "memberCode": "MEM001",
  "creditAmount": 1000.00,
  "remark": "คืนเครดิต"
}
```

> ⚠️ หมายเหตุ: ดู `credit.service.ts` ฟังก์ชัน `withdrawCredit` สำหรับ payload จริง

**v1 Response:**
```json
???
```

**v2 Request Body:**
```json
{
    "userId": 157,
    "amount": 1,
    "autoApprove": true,
    "remark": "ทดสอบ",
    "withdrawType": "cancel_credit"
}
```

**v2 Response:**
```json
{
    "success": true,
    "message": "ตัดเงิน User สำเร็จ",
    "data": {
        "id": 104,
        "transactionRef": "WDR-20260610-133702-21U0G9",
        "userId": 157,
        "amount": 1,
        "status": "completed",
        "channel": "admin",
        "bankCode": "kbank",
        "accountNumber": "0371586938",
        "accountName": "ลาภทวี โพธิ์อ่อง",
        "createdBy": 49,
        "approvedBy": 49,
        "remark": "ทดสอบ",
        "balanceBefore": 1,
        "balanceAfter": 0,
        "createdAt": "2026-06-10T13:37:02.245570791+07:00",
        "updatedAt": "2026-06-10T13:37:02.245570791+07:00",
        "approvedAt": "2026-06-10T13:37:02.245216264+07:00",
        "userInfo": {
            "id": 157,
            "username": "0632204239",
            "fullName": "ลาภทวี โพธิ์อ่อง"
        }
    }
}
```

---

### 4.3 GET Recent Transactions (สำหรับตรวจสอบรายการซ้ำ — v2 เท่านั้น)

| | รายละเอียด |
|---|---|
| **v1 Endpoint** | ไม่มี — v1 ใช้ `transferAt` ใน payload ฝาก ให้ admin dedup เอง |
| **v2 Endpoint** | `GET {admin_api_url}/api/proxy/v1/admin/transactions/completed?page=1&limit=50&userId={userId}&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` |
| **Headers** | `Authorization: Bearer {sessionToken}` |
| **Purpose** | ดึงรายการธุรกรรมล่าสุดของ user เพื่อตรวจสอบว่ามีรายการฝากซ้ำก่อน submit |

> ⚠️ **สาเหตุที่ v2 จำเป็นต้องใช้ endpoint นี้**:  
> payload ฝากเครดิต v2 (`POST /api/proxy/v1/admin/deposits`) **ไม่มีฟิลด์ `transferAt`** (เวลาโอน)  
> ทำให้ admin ไม่สามารถ dedup จากเวลาได้เอง → ระบบ ATslip ต้องดึงรายการล่าสุดมาเช็คเองก่อน submit

**v2 Query Parameters:**
| Parameter | ตัวอย่าง | หมายเหตุ |
|---|---|---|
| `page` | `1` | หน้าที่ต้องการ |
| `limit` | `50` | จำนวนรายการต่อหน้า |
| `userId` | `157` | user.id ในระบบ admin (ดึงได้จาก member search) |
| `dateFrom` | `2026-06-10` | วันที่เริ่มต้น (YYYY-MM-DD ตาม timezone +07:00) |
| `dateTo` | `2026-06-10` | วันที่สิ้นสุด (YYYY-MM-DD ตาม timezone +07:00) |

**v2 Response (ตัวอย่างจาก trans2.json):**
```json
{
    "success": true,
    "message": "ดึงรายการธุรกรรมเสร็จสิ้นสำเร็จ",
    "data": {
        "list": [
            {
                "id": 284,
                "transactionType": "deposit",
                "transactionRef": "DEP-20260610-135446-1NCTK0",
                "userId": 273,
                "userMemberCode": "zta70fb1002682",
                "username": "0612192410",
                "amount": 50,
                "channel": "auto",
                "paymentMethod": "fastbank_auto",
                "bankCode": "ktb",
                "accountNumber": "356718",
                "bankAccountId": 154,
                "bankAccountNumber": "3432361428_154",
                "status": "completed",
                "createdAt": "2026-06-10T13:54:46+07:00",
                "confirmedAt": "2026-06-10T13:54:46+07:00"
            }
        ],
        "total": 6,
        "page": 1,
        "limit": 50,
        "totalPages": 1
    }
}
```

> **Logic ตรวจสอบซ้ำ (แผน implement)**:  
> เปรียบเทียบสลิปที่สแกนกับ `data.list` โดยเช็ค:
> - `amount` ตรงกัน AND
> - `accountNumber` ตรงกับ 6 หลักท้ายของเลขบัญชีผู้โอน (slip sender) AND  
> - `createdAt` อยู่ภายใน ±5 นาที จากเวลาในสลิป
>
> ถ้าพบรายการที่ match → ถือว่า duplicate → คืน `{ isDuplicate: true }`

---

## 5. สรุป Endpoints ทั้งหมด

| # | Purpose | v1 Method + Path | v2 Path |
|---|---------|-----------------|---------|
| 1 | Get Captcha | `GET /api/captcha` | `???` |
| 2 | Login (with captcha) | `POST /api/login` | `???` |
| 3 | Login (auto, no captcha) | `POST /api/login` | `???` |
| 4 | Get Bank Accounts | `GET /api/accounting/bankaccounts/list` | `???` |
| 5 | Search Users | `GET /api/users/list` | `???` |
| 6 | Generate MemberCode | `GET /api/admin/gen-membercode/{userId}` | `???` |
| 1 | Get Captcha | `GET /api/captcha` | ไม่ใช้ |
| 2 | Login | `POST /api/login` | `POST /api/auth/login` |
| 3 | Login Auto | `POST /api/login` | `POST /api/auth/login` (เหมือนกัน) |
| 4 | Get Bank Accounts | `GET /api/accounting/bankaccounts/list` | `GET /api/proxy/v1/admin/bank-accounts` |
| 5 | Search Members | `GET /api/users/list` | `GET /api/proxy/v1/admin/members` |
| 6 | Generate MemberCode | `GET /api/admin/gen-membercode/{id}` | ไม่ใช้ (ทุก user มี code) |
| 7 | Deposit Credit | `POST /api/banking/transactions/deposit-record` | `POST /api/proxy/v1/admin/deposits` |
| 8 | Withdraw Credit | `POST /api/banking/transactions/withdraw-credit-back` | `POST /api/proxy/v1/admin/withdraws` |
| 9 | Recent Transactions | ไม่มี | `GET /api/proxy/v1/admin/transactions/completed` |

---

## 6. การจัดการ Session (Session Management)

### สถานะปัจจุบัน (ก่อน implement v2)

| ประเด็น | สถานะ |
|---|---|
| Session TTL ใน DB | **24 ชั่วโมง** (`expiresAt = now + 24*3600`) |
| Session TTL จริงของ admin backend | **ไม่แน่นอน** (ขึ้นอยู่กับ admin config) |
| มี auto re-login เมื่อหลุด? | **ไม่มี** — ระบบ return error แล้วให้ admin login ใหม่ |
| มี session ping / keep-alive? | **ไม่มี** |
| BankRefreshService (cron ทุก 1 นาที) | refresh บัญชีธนาคารเท่านั้น — เมื่อได้ 401 จะ **ลบ session** แล้วหยุด |
| ผลเมื่อ session หลุด | `submitCredit` return `{ success: false, message: 'Session not active. Please login first.' }` → เติมเครดิตไม่ได้ จนกว่าแอดมินจะ login ใหม่ |

### แผน Auto Re-login สำหรับ v2 (v2 ไม่ต้อง captcha)

เนื่องจาก v2 login ไม่ต้องกรอก captcha สามารถ implement auto re-login อัตโนมัติได้:

**ตำแหน่งที่ต้อง implement** (`credit.service.ts` ฟังก์ชัน `submitCredit`):
```typescript
// ถ้าไม่มี session และ tenant เป็น v2 → try auto re-login
if (!session && tenant.api_version === 'v2') {
  const reloginResult = await this.autoReloginV2(env, tenant);
  if (!reloginResult.success) {
    return { success: false, message: 'Session expired and auto re-login failed' };
  }
  // ดึง session ใหม่
  sessionToken = reloginResult.token;
}
```

**ฟังก์ชัน `autoReloginV2`** (ต้องสร้างใหม่):
```typescript
static async autoReloginV2(env, tenant) {
  const response = await fetch(`${tenant.admin_api_url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: tenant.admin_username, password: tenant.admin_password })
  });
  // extract token จาก data.token
  // บันทึกลง admin_sessions
  // return { success: true, token }
}
```

> ⚠️ **ต้องดึง `admin_username` / `admin_password` จาก tenant** ซึ่งปัจจุบัน `submitCredit` ดึงแค่ `admin_api_url` — ต้องแก้ query ด้วย

**ตำแหน่งอื่นที่ต้องแก้:**
- `BankRefreshService.refreshAllTenantBankAccounts` — เมื่อได้ 401 และ tenant เป็น v2 → auto re-login แทนการลบ session

---

## 7. แผนการ Implement v2

เมื่อได้ endpoints v2 ครบแล้ว การ implement จะทำใน:

- `backend/src/services/tenant.service.ts` — `connectAdmin()` (auto login)
- `backend/src/api/admin-login.ts` — `handleGetCaptcha()`, `handleLogin()`, `handleRefreshAccounts()`
- `backend/src/services/credit.service.ts` — `submitCredit()`, `withdrawCredit()`, `searchUserByKeyword()`, `resolveMemberCodeForUser()`
- `backend/src/api/user-search.ts` — `handleUserSearch()`, `handleGenMemberCode()`
- `backend/src/services/credit.service.ts` — เพิ่ม `checkDuplicateV2()` ก่อน submit, เพิ่ม `autoReloginV2()`
- `backend/src/services/bank-refresh.service.ts` — auto re-login แทนลบ session เมื่อ v2 ได้ 401

**Strategy**: ดึง `api_version` จาก tenant record แล้ว branch endpoint:
```typescript
const baseUrl = tenant.admin_api_url;
const ver = tenant.api_version || 'v1';

// Authentication
const loginPath = ver === 'v2' ? '/api/auth/login' : '/api/login';

// Bank Accounts  
const bankPath = ver === 'v2'
  ? '/api/proxy/v1/admin/bank-accounts?page=1&limit=50'
  : '/api/accounting/bankaccounts/list?limit=100';
const bankListKey = ver === 'v2' ? 'list' : 'list'; // ทั้งคู่ใช้ .list

// Search Members
const memberPath = ver === 'v2'
  ? `/api/proxy/v1/admin/members?page=1&limit=50&search=${q}`
  : `/api/users/list?page=1&limit=50&search=${q}&userCategory=member`;
const memberCode = ver === 'v2' ? user.memberCode : user.memberCode; // ทั้งคู่ใช้ .memberCode
const userId = ver === 'v2' ? user.id : user.id; // ทั้งคู่ใช้ .id (number)

// Deposit Credit
const depositPath = ver === 'v2'
  ? '/api/proxy/v1/admin/deposits'
  : '/api/banking/transactions/deposit-record';
const depositPayload = ver === 'v2'
  ? { userId, amount, autoApprove: true, remark, fromBankCode, fromAccountNumber, fromAccountName, bankAccountId, isBonus: false }
  : { memberCode, creditAmount: amount, depositChannel: 'Mobile Banking (มือถือ)', toAccountId, transferAt, auto: true, fromAccountNumber };

// Withdraw Credit
const withdrawPath = ver === 'v2'
  ? '/api/proxy/v1/admin/withdraws'
  : '/api/banking/transactions/withdraw-credit-back';
const withdrawPayload = ver === 'v2'
  ? { userId, amount, autoApprove: true, remark, withdrawType: 'cancel_credit' }
  : { memberCode, creditAmount: amount, remark };

// Duplicate Check (v2 only — ก่อน deposit)
if (ver === 'v2') {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
  const txPath = `/api/proxy/v1/admin/transactions/completed?page=1&limit=50&userId=${userId}&dateFrom=${today}&dateTo=${today}`;
  // เช็ค amount + 6 หลักท้าย sender + createdAt ±5 นาที
}
```

### ข้อแตกต่าง v1 vs v2 สำคัญ

| | v1 | v2 |
|---|---|---|
| Token path | `response.token` | `response.data.token` |
| Bank accounts key | `response.list` | `response.data.list` |
| Bank account id field | `account.id` (integer) | `account.id` (integer) — เหมือนกัน |
| Search member key | `response.list` | `response.data.list` |
| Member field: memberCode | `user.memberCode` | `user.memberCode` — เหมือนกัน |
| Member field: userId | `user.id` (string) | `user.id` (integer) |
| Deposit: ใช้ identifier | memberCode (string) | userId (integer) |
| Deposit: มี transferAt? | ✅ มี | ❌ ไม่มี → ต้องเช็ค tx list เอง |
| genMemberCode | ✅ จำเป็น (non-member) | ❌ ไม่ต้อง (ทุก user มี memberCode) |
| Auto re-login | ❌ ต้อง captcha | ✅ ทำได้ (ไม่ต้อง captcha) |
