# AT SLIP - Database & API Reference
# AT SLIP - อ้างอิง Database & API

---

## DATABASE SCHEMA

### Table: `tenants`
Stores information about multi-tenant organizations.

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL,
  tenant_name TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  admin_username TEXT,
  line_channel_id TEXT,
  line_channel_secret TEXT,
  line_access_token TEXT,
  session_mode TEXT DEFAULT 'kv',
  account_list_ttl_min INTEGER DEFAULT 5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Columns**:
- `tenant_id`: Unique identifier for tenant (e.g., "company_a")
- `tenant_name`: Display name (e.g., "Company A")
- `api_base_url`: Backend API base URL (e.g., "https://api.example.com")
- `admin_username`: Default admin username
- `line_channel_*`: LINE Bot channel credentials
- `session_mode`: Session storage mode ('kv' for KV cache)
- `account_list_ttl_min`: Cache duration for account list (minutes)

**Usage**:
```typescript
// Get tenant
const tenant = await env.DB.prepare(
  `SELECT * FROM tenants WHERE tenant_id = ?`
).bind('company_a').first();

// Update tenant
await env.DB.prepare(`
  UPDATE tenants 
  SET tenant_name = ?, updated_at = ?
  WHERE tenant_id = ?
`).bind('Company A Updated', now, 'company_a').run();
```

---

### Table: `tenant_sessions`
Manages admin authentication tokens and sessions.

```sql
CREATE TABLE tenant_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT,
  token_expired_at TEXT,
  status TEXT DEFAULT 'ACTIVE',
  last_validated_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

**Columns**:
- `tenant_id`: Reference to tenant (FK)
- `token`: JWT or access token from backend
- `refresh_token`: Refresh token (if available)
- `status`: 'ACTIVE', 'INACTIVE', 'EXPIRED'
- `last_validated_at`: Last time token was verified

**Usage**:
```typescript
// Get active session
const session = await env.DB.prepare(`
  SELECT token FROM tenant_sessions 
  WHERE tenant_id = ? AND status = 'ACTIVE'
`).bind('company_a').first();

// Clear session
await env.DB.prepare(
  `DELETE FROM tenant_sessions WHERE tenant_id = ?`
).bind('company_a').run();
```

---

### Table: `pending_transactions`
Core table for tracking SLIP processing status.

```sql
CREATE TABLE pending_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  slip_data TEXT NOT NULL,        -- JSON
  slip_ref TEXT,
  user_data TEXT,                 -- JSON
  status TEXT DEFAULT 'pending',
  amount REAL,
  sender_account TEXT,
  sender_bank TEXT,
  receiver_account TEXT,
  created_at TEXT NOT NULL,
  credited_at TEXT,
  UNIQUE(tenant_id, slip_ref),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

**Columns**:
- `slip_data`: Complete SLIP data from EasySlip API (JSON)
- `slip_ref`: Reference from SLIP (used for duplicate detection)
- `user_data`: User info after matching (JSON: { memberCode, fullname, ... })
- `status`: pending|pending_verification|matched|credited|duplicate|failed
- `amount`: Transferred amount in THB
- `sender_*`: Extracted from SLIP
- `receiver_account`: Matched bank account

**Status Flow**:
```
pending_verification (received image, waiting verification)
    ↓
pending (verified SLIP, extracted data)
    ↓
matched (found matching account & user)
    ↓
credited (successfully transferred) OR duplicate (duplicate detected) OR failed
```

**Usage**:
```typescript
// Insert new SLIP processing
const result = await env.DB.prepare(`
  INSERT INTO pending_transactions 
  (tenant_id, slip_data, user_data, status, amount, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).bind(
  'company_a',
  JSON.stringify(slipData),
  JSON.stringify(userData),
  'pending',
  amount,
  now
).run();

const transactionId = result.meta.last_row_id;

// Update status
await env.DB.prepare(`
  UPDATE pending_transactions
  SET status = ?, credited_at = ?
  WHERE id = ?
`).bind('credited', now, transactionId).run();
```

---

### Table: `line_oas`
Stores LINE Bot channel configurations.

```sql
CREATE TABLE line_oas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_secret TEXT NOT NULL,
  access_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

**Columns**:
- `id`: Unique OA ID (e.g., "lineoa-123456")
- `name`: Display name (e.g., "Support Bot")
- `channel_id`: LINE Channel ID
- `access_token`: LINE Channel Access Token

**Usage**:
```typescript
// Get LINE OA
const oa = await env.DB.prepare(`
  SELECT * FROM line_oas 
  WHERE tenant_id = ? AND id = ?
`).bind('company_a', oaId).first();

// Create LINE OA
const id = `lineoa-${Date.now()}`;
await env.DB.prepare(`
  INSERT INTO line_oas
  (id, tenant_id, name, channel_id, channel_secret, access_token, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).bind(id, 'company_a', 'Bot Name', chId, chSecret, token, now).run();
```

---

### Table: `message_settings`
Customizable message templates and styling.

```sql
CREATE TABLE message_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  image_reply_enabled INTEGER DEFAULT 1,
  image_reply_message TEXT DEFAULT '...',
  duplicate_reply_enabled INTEGER DEFAULT 1,
  flex_message_enabled INTEGER DEFAULT 1,
  flex_logo_url TEXT DEFAULT '',
  game_url TEXT DEFAULT '',
  color_header_footer_bg TEXT DEFAULT '#000000',
  color_body_bg TEXT DEFAULT '#1A1A1A',
  color_primary TEXT DEFAULT '#D4AF37',
  color_success_text TEXT DEFAULT '#33FF33',
  color_value_text TEXT DEFAULT '#FFFFFF',
  color_separator TEXT DEFAULT '#333333',
  color_muted_text TEXT DEFAULT '#888888',
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

**Columns**:
- `image_reply_enabled`: Send immediate reply when image received
- `image_reply_message`: Message to reply (e.g., "กรุณารอ...")
- `flex_message_enabled`: Send Flex message after processing
- `flex_logo_url`: Logo URL in Flex message
- `game_url`: Game link in Flex message
- `color_*`: Customizable colors for Flex message

**Usage**:
```typescript
// Get settings
const settings = await env.DB.prepare(`
  SELECT * FROM message_settings WHERE tenant_id = ?
`).bind('company_a').first();

// Update settings
await env.DB.prepare(`
  UPDATE message_settings
  SET image_reply_message = ?, flex_logo_url = ?, updated_at = ?
  WHERE tenant_id = ?
`).bind(newMessage, logoUrl, now, 'company_a').run();
```

---

### Table: `easyslip_configs`
Stores EasySlip API tokens for SLIP verification.

```sql
CREATE TABLE easyslip_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  token TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

**Columns**:
- `tenant_id`: NULL = global token, otherwise tenant-specific
- `token`: EasySlip API bearer token
- `is_active`: Enable/disable this token

**Usage**:
```typescript
// Get token (tenant-specific or global)
let token = await env.DB.prepare(`
  SELECT token FROM easyslip_configs
  WHERE tenant_id = ? AND is_active = 1
`).bind('company_a').first();

if (!token) {
  token = await env.DB.prepare(`
    SELECT token FROM easyslip_configs
    WHERE tenant_id IS NULL AND is_active = 1
  `).first();
}
```

---

### Table: `account_name_mappings`
Manual account name mappings for flexible matching.

```sql
CREATE TABLE account_name_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_th TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, account_number),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
CREATE INDEX idx_account_mappings_tenant 
  ON account_name_mappings(tenant_id);
```

**Purpose**: Override automatic account matching with manual mappings.

**Example**:
| account_number | name_en | name_th |
|---|---|---|
| 1234567890 | ABC Company Limited | บริษัทเอบีซี จำกัด |

**Usage**:
```typescript
// Find mapping
const mapping = await env.DB.prepare(`
  SELECT * FROM account_name_mappings
  WHERE tenant_id = ? AND name_en ILIKE ?
`).bind('company_a', '%ABC%').first();

// Create mapping
await env.DB.prepare(`
  INSERT INTO account_name_mappings
  (tenant_id, account_number, name_en, name_th, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).bind('company_a', '1234567890', 'ABC Company', 'บริษัท...', now, now).run();
```

---

## FILE UPLOAD / STORAGE

**SLIP Images**: Temporarily stored in request memory, not persisted.
- Downloaded from LINE via `/v2/bot/message/{messageId}/content`
- Sent to EasySlip as FormData or URL
- Not saved to disk/KV (uses memory buffer)

**Extracted SLIP Data**: Stored in `pending_transactions.slip_data` as JSON

---

## KV CACHE KEY FORMATS

```
tenant:{tenantId}:session
└─ Content: { token, username, status, lastValidatedAt }
└─ TTL: Indefinite (manual delete on logout)
└─ Usage: Fast session lookup

tenant:{tenantId}:accounts
└─ Content: { accounts: [...], cachedAt: timestamp }
└─ TTL: account_list_ttl * 60 seconds (default 5 min)
└─ Usage: Fast account matching without API call
```

---

## API ENDPOINTS REFERENCE

### Tenant Management

#### Create/Update Tenant
```http
POST /api/tenants
Content-Type: application/json

{
  "tenantId": "company_a",
  "tenantName": "Company A",
  "apiBaseUrl": "https://api.company-a.com",
  "adminUsername": "admin",
  "lineChannelId": "123456789",
  "lineChannelSecret": "secret123",
  "lineAccessToken": "token123",
  "sessionMode": "kv",
  "accountListTtl": 5
}

Response (200):
{
  "success": true,
  "tenant": { ...tenant_data... }
}
```

#### Get All Tenants
```http
GET /api/tenants

Response (200):
{
  "tenants": [
    { ...tenant1... },
    { ...tenant2... }
  ],
  "total": 2
}
```

#### Get Single Tenant
```http
GET /api/tenants/{tenantId}

Response (200):
{
  "tenantId": "company_a",
  "tenantName": "Company A",
  ...
}

Response (404):
{
  "error": "Not Found",
  "message": "Tenant company_a does not exist"
}
```

#### Delete Tenant
```http
DELETE /api/tenants/{tenantId}

Response (200):
{
  "success": true,
  "message": "Tenant deleted successfully"
}
```

---

### Authentication

#### Admin Login
```http
POST /api/tenants/{tenantId}/admin-login
Content-Type: application/json

{
  "username": "admin",
  "password": "password123",
  "captchaId": "captcha_id_123",
  "captchaCode": "12345",
  "apiBaseUrl": "https://api.company-a.com"
}

Response (200):
{
  "success": true,
  "token": "eyJhbGc...",
  "username": "admin",
  "message": "Login successful"
}

Response (400/500):
{
  "success": false,
  "message": "Error description"
}
```

#### Admin Logout
```http
POST /api/tenants/{tenantId}/logout

Response (200):
{
  "success": true,
  "message": "Logout สำเร็จ"
}
```

#### Get Session
```http
GET /api/tenants/{tenantId}/session

Response (200):
{
  "success": true,
  "token": "eyJhbGc...",
  "refreshToken": null,
  "status": "ACTIVE",
  "lastValidated": "2026-02-25T10:30:00Z"
}

Response (404):
{
  "success": false,
  "message": "No active session found"
}
```

---

### SLIP Scanning

#### Verify SLIP
```http
POST /api/scan/verify-slip
Content-Type: multipart/form-data

Form Data:
- tenantId: company_a
- file: [binary image data]
(Or use 'url' instead of 'file' for URL-based verification)

Response (200):
{
  "success": true,
  "data": {
    "data": {
      "sender": {
        "name": { "th": "...", "en": "..." },
        "account": { "value": "123456789", "bank": { "short": "SCB" } }
      },
      "receiver": {
        "name": { "th": "...", "en": "..." },
        "account": { "value": "987654321", "bank": { "short": "KTB" } }
      },
      "amount": { "amount": 500 },
      "date": "2026-02-25T10:30:00Z",
      "transRef": "XXXXX..."
    }
  }
}

Response (400/500):
{
  "success": false,
  "message": "Verification failed"
}
```

#### Match Account
```http
POST /api/scan/match-account
Content-Type: application/json

{
  "tenantId": "company_a",
  "receiverAccount": "987654321",
  "receiverName": "ABC Company Limited",
  "receiverRef3": "ABC CO"
}

Response (200):
{
  "matched": true,
  "accountId": "ACC123",
  "matchMethod": "exact-account" | "partial-digits" | "name-match"
}

Response (200 - no match):
{
  "matched": false
}
```

#### Search User
```http
POST /api/scan/search-user
Content-Type: application/json

{
  "tenantId": "company_a",
  "searchName": "John Doe",
  "maskedAccount": "1234xx890",
  "bankName": "SCB"
}

Response (200):
{
  "user": {
    "id": "USER123",
    "memberCode": "MEM001",
    "fullname": "John Doe",
    "bankAccount": "1234567890",
    "phone": "+6681234567"
  },
  "matchMethod": "name-and-account-verified" | "name-only"
}

Response (200 - no match):
{
  "user": null
}
```

#### Submit Credit
```http
POST /api/scan/submit-credit
Content-Type: application/json

{
  "tenantId": "company_a",
  "slipData": { ...slip_data... },
  "user": { ...user_data... },
  "toAccountId": "ACC123"
}

Response (200):
{
  "success": true
}

Response (409 - duplicate):
{
  "success": false,
  "isDuplicate": true,
  "message": "⚠️ Duplicate detected"
}

Response (400/500):
{
  "success": false,
  "message": "Credit submission failed"
}
```

#### Check Duplicate
```http
GET /api/scan/check-duplicate?ref=XXXXX

Response (200):
{
  "isDuplicate": false,
  "transRef": "XXXXX",
  "message": "Transaction reference is new"
}
```

---

### LINE Webhook

#### Receive Webhook
```http
POST /webhook/{tenantId}/{oaId}
Content-Type: application/json

{
  "events": [
    {
      "type": "message",
      "message": {
        "type": "image",
        "id": "100001",
        "contentProvider": {"type": "line"}
      },
      "replyToken": "nHuyWiB...",
      "source": {
        "type": "user",
        "userId": "U1234567890abcdef"
      },
      "timestamp": 1462629479859
    }
  ]
}

Response (200):
OK

Processing:
1. Download image from LINE
2. Save to pending_transactions
3. Return 200 immediately to LINE
4. Background: Verify → Match → Search → Credit → Notify
```

---

### Message Settings

#### Get Settings
```http
GET /api/message-settings/{tenantId}

Response (200):
{
  "id": "msg-company_a-...",
  "tenantId": "company_a",
  "imageReplyEnabled": true,
  "imageReplyMessage": "ขอบคุณที่ส่งสลิป กำลังตรวจสอบ...",
  "flexMessageEnabled": true,
  "flexLogoUrl": "https://example.com/logo.png",
  "gameUrl": "https://game.example.com",
  "colorHeaderFooterBg": "#000000",
  "colorBodyBg": "#1A1A1A",
  ...
}
```

#### Update Settings
```http
POST /api/message-settings/{tenantId}
Content-Type: application/json

{
  "imageReplyEnabled": true,
  "imageReplyMessage": "Custom message",
  "flexMessageEnabled": true,
  "flexLogoUrl": "https://...",
  "colorPrimary": "#D4AF37",
  ...
}

Response (200):
{ "success": true }
```

---

### Health Check

```http
GET /health

Response (200):
{
  "status": "ok",
  "time": "2026-02-25T10:30:00.000Z"
}
```

---

## ERROR CODES & RESPONSES

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created |
| 204 | No Content | Success with no body |
| 400 | Bad Request | Invalid input, missing fields |
| 401 | Unauthorized | Invalid token, expired session |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate transaction |
| 500 | Server Error | Backend error, network timeout |
| 503 | Service Unavailable | Database/API unavailable |

---

**Last Updated**: February 2026
**Schema Version**: 1.0
**API Version**: 1.0
