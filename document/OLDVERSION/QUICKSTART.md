# Quick Start Guide
# คู่มือเริ่มต้นใช้งาน

## 📁 Project Structure

```
AT slip/
├── src/
│   ├── index.ts                      # Main entry point
│   ├── api/
│   │   ├── admin-login.ts           # Admin authentication
│   │   ├── logout.ts                # Admin logout
│   │   └── scan.ts                  # SLIP verification & processing
│   ├── database/
│   │   └── tenant-repository.ts     # Tenant CRUD operations
│   ├── utils/
│   │   ├── helpers.ts               # Helper functions
│   │   └── flex-messages.ts         # LINE Flex message builders
│   └── webhooks/
│       └── line.ts                  # LINE Bot webhook handler
├── README.md                         # Main documentation
├── ARCHITECTURE.md                   # System architecture & flow
├── API_REFERENCE.md                  # Database & API reference
└── Quick Start Guide.md              # This file
```

---

## 🚀 Getting Started

### 1. Project Setup

```bash
# Install dependencies
cd "AT slip"
npm install

# TypeScript compilation (if needed)
npm run build

# Run development server
npx wrangler dev
```

### 2. Environment Configuration

Create/update `wrangler.toml`:

```toml
name = "at-slip"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
vars = { ENVIRONMENT = "production" }

[[d1_databases]]
binding = "DB"
database_name = "at-slip-db"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "your-kv-namespace-id"
```

### 3. Create Database

```bash
# Create D1 database
npx wrangler d1 create at-slip-db

# Run migrations (create tables)
npx wrangler d1 execute at-slip-db --file=schema.sql
```

### 4. Deploy

```bash
# Build and deploy to Cloudflare
npm run build
npx wrangler deploy
```

---

## 🔑 Key Files Overview

### `src/index.ts` - Main Router
- Entry point for all requests
- Routes to appropriate handlers
- Manages CORS headers
- Handles scheduled cleanup tasks

**Key Functions**:
- `handleFetch()` - Main request handler
- `handleTenantsRequest()` - Tenant CRUD
- `addCorsHeaders()` - CORS middleware

### `src/api/admin-login.ts` - Authentication
- Admin login/verification
- Token generation & storage
- Session management
- Account prefetching

**Usage**:
```typescript
POST /api/tenants/{tenantId}/admin-login
```

### `src/api/logout.ts` - Logout
- Invalidate sessions
- Clear tokens
- Clean up cache

**Usage**:
```typescript
POST /api/tenants/{tenantId}/logout
```

### `src/api/scan.ts` - SLIP Processing
Main file containing:
- `verifySlip()` - EasySlip verification
- `matchAccount()` - Account matching logic
- `searchUser()` - User identification
- `submitCredit()` - Credit submission

**Usage**:
```typescript
POST /api/scan/verify-slip
POST /api/scan/match-account
POST /api/scan/search-user
POST /api/scan/submit-credit
```

### `src/webhooks/line.ts` - LINE Bot
- Webhook handler for LINE messages
- Image download & processing
- Background SLIP verification
- Flex message notifications

**Usage**:
```typescript
POST /webhook/{tenantId}/{oaId}
```

### `src/utils/helpers.ts` - Utilities
Common helper functions:
- `removeTitlePrefix()` - Clean names
- `replyMessage()` - Send line message
- `pushFlexMessage()` - Send flex message
- `getImageContent()` - Download image

### `src/utils/flex-messages.ts` - Message Builder
Create LINE Flex messages:
- `createCreditedFlexMessage()` - Success notification
- `createDuplicateFlexMessage()` - Duplicate warning

### `src/database/tenant-repository.ts` - Database
Tenant management functions:
- `upsertTenant()` - Create/update
- `getTenant()` - Get one
- `listTenants()` - Get all
- `deleteTenant()` - Delete

---

## 📊 Database Tables

### Main Tables (8 tables)

1. **tenants** - Organization info
2. **tenant_sessions** - Auth tokens
3. **pending_transactions** - SLIP processing
4. **line_oas** - LINE Bot configs
5. **message_settings** - Message templates
6. **easyslip_configs** - EasySlip tokens
7. **account_name_mappings** - Manual mappings
8. **Other supporting tables** (if exists)

→ See `API_REFERENCE.md` for full schema

---

## 🔄 Data Flow Example

### User Sends SLIP Image via LINE

```
1. User → LINE Bot (sends image)
   └─ Image appears in LINE chat

2. LINE Webhook → /webhook/{tenantId}/{oaId}
   └─ Receives webhook event

3. Download Image
   └─ GET /v2/bot/message/{messageId}/content
   └─ Save to memory buffer

4. Save to DB
   └─ INSERT into pending_transactions
   └─ status = pending_verification

5. Send Reply (optional)
   └─ "ขอบคุณที่ส่งสลิป กำลังตรวจสอบ..."

6. Background Processing (ctx.waitUntil)
   ├─ Verify SLIP with EasySlip
   ├─ Extract data
   ├─ Match account
   ├─ Search user
   ├─ Submit credit
   └─ Update status

7. Send Notification
   └─ Flex message with result
   └─ Amount, date, confirmation

8. Complete
   └─ Transaction credited/duplicate/failed
```

---

## 🧪 Testing

### Local Testing with Wrangler

```bash
# Start dev server
npx wrangler dev

# In another terminal, test endpoints:

# Test health
curl http://localhost:8787/health

# Test login
curl -X POST http://localhost:8787/api/tenants/test/admin-login \
  -H "Content-Type: application/json" \
  -d '{...payload...}'

# Test webhook (simulated LINE event)
curl -X POST http://localhost:8787/webhook/test/oa1 \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "type": "message",
      "message": {"type": "image", "id": "100001"},
      "replyToken": "token...",
      "source": {"type": "user", "userId": "U123..."}
    }]
  }'
```

### Testing with Database

```bash
# Execute SQL
npx wrangler d1 execute at-slip-db --command="SELECT * FROM tenants"

# Check transactions
npx wrangler d1 execute at-slip-db --command="SELECT * FROM pending_transactions"
```

---

## 🐛 Common Issues & Solutions

### Issue: Token Expired
**Symptom**: `401 Unauthorized`
**Solution**: 
- Implement token refresh in `admin-login.ts`
- Check `last_validated_at` in `tenant_sessions`
- Call logout & login again

### Issue: Account Not Matched
**Symptom**: Transaction stays in 'pending' state
**Solution**:
- Check if account exists in system
- Add manual mapping in `account_name_mappings`
- Verify account number format

### Issue: SLIP Verification Timeout
**Symptom**: `EasySlip API timeout` error
**Solution**:
- Check EasySlip API status
- Verify token not expired
- Increase timeout (currently 5s max)
- Check image file size

### Issue: Duplicate Transaction
**Symptom**: `Transaction already exists`
**Solution**:
- Check `slip_ref` in database
- Verify transfer reference from SLIP
- Manual review in admin panel

### Issue: User Not Found
**Symptom**: Transaction in 'matched' state (not credited)
**Solution**:
- Check if user exists in backend
- Verify name matching logic
- Add new user first
- Check `searchUser` response

---

## 📝 Adding New Features

### Add New API Endpoint

1. **Create handler file** in `src/api/new-feature.ts`:

```typescript
export async function handleNewFeature(request: Request, env: any): Promise<Response> {
  try {
    const body = await request.json();
    // Your logic here
    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
```

2. **Import in `src/index.ts`**:

```typescript
import { handleNewFeature } from './api/new-feature';
```

3. **Add route**:

```typescript
else if (pathname === '/api/new-feature') {
  response = await handleNewFeature(request, env);
}
```

### Add New Database Table

1. **Create migration** in `schema.sql`:

```sql
CREATE TABLE new_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  -- ... columns
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
```

2. **Run migration**:

```bash
npx wrangler d1 execute at-slip-db --file=schema.sql
```

### Add New Helper Function

Create in `src/utils/helpers.ts`:

```typescript
export async function newHelper(param: string): Promise<string> {
  // Your helper logic
  return result;
}
```

---

## 🔐 Security Checklist

- [ ] Validate all user inputs
- [ ] Use parameterized SQL queries
- [ ] Implement rate limiting
- [ ] Validate API tokens
- [ ] Use HTTPS only
- [ ] Sanitize error messages
- [ ] Log security events
- [ ] Regular security audit

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Overview & setup guide |
| `ARCHITECTURE.md` | System design & data flow |
| `API_REFERENCE.md` | Database schema & API endpoints |
| `Quick Start Guide.md` | This file |

---

## 🤝 Support

**Bug Report**:
Check Cloudflare Workers dashboard logs:
- Dashboard → Workers → at-slip → Logs

**Development**:
```bash
# Watch TypeScript changes
npm run dev

# Check for errors
npm run lint

# Format code
npm run format
```

---

## ✅ Validation Checklist

Before going to production:

- [ ] All tables created & migrated
- [ ] Environment variables configured
- [ ] EasySlip token valid & configured
- [ ] LINE Bot token valid & configured
- [ ] Backend API URL correct
- [ ] Database backups configured
- [ ] Error monitoring (Sentry/similar) set up
- [ ] Logging enabled
- [ ] Rate limiting configured
- [ ] CORS headers appropriate
- [ ] Database indexes created
- [ ] Cron jobs scheduled

---

## 📞 Quick Reference

**Development Command**:
```bash
npx wrangler dev
```

**Deploy Command**:
```bash
npx wrangler deploy
```

**Database Query**:
```bash
npx wrangler d1 execute at-slip-db --command="SELECT COUNT(*) FROM pending_transactions"
```

**View Logs**:
Cloudflare Dashboard → Workers → at-slip → Logs

---

**Created**: February 2026
**Status**: Ready for Development
**Test Coverage**: Basic endpoints testable locally
