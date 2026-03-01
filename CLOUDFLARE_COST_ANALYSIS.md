# การวิเคราะห์ค่าใช้จ่าย Cloudflare และการเพิ่มประสิทธิภาพ

## 📊 ภาพรวมการใช้งาน Cloudflare

### Services ที่ใช้:
1. **Workers** - Backend API
2. **D1 Database** - SQLite database
3. **KV Storage** - Key-Value store สำหรับ cache bank accounts
4. **Cron Triggers** - Scheduled jobs

---

## 💰 โครงสร้างค่าใช้จ่าย Cloudflare (Free vs Paid)

### Workers (Free Tier):
- ✅ **100,000 requests/day**
- ✅ **10ms CPU time/request**
- ❌ Cron triggers: **NOT included in free tier** (ต้อง Paid plan $5/month)

### D1 Database (Free Tier):
- ✅ **5 million reads/month**
- ✅ **100,000 writes/month**
- ✅ **5 GB storage**

### KV Storage (Free Tier):
- ✅ **100,000 reads/day**
- ✅ **1,000 writes/day**
- ✅ **1 GB storage**

---

## ⚠️ จุดที่อาจสิ้นเปลืองค่าใช้จ่าย

### 1. **Scheduled Job (Cron) - ทุก 5 นาที** ❗

**ปัญหา:**
```typescript
// wrangler.toml
crons = ["*/5 * * * *"]  // ทุก 5 นาที = 288 ครั้ง/วัน
```

**การคำนวณ:**
- **288 executions/day** = 8,640 executions/month
- **Cron triggers ไม่ฟรี** - ต้องใช้ Workers Paid plan ($5/month)
- แต่ละ cron run ทำ:
  - 1 D1 read (SELECT TTL setting)
  - 1 D1 read (SELECT tenants with sessions)
  - ต่อ tenant: 1 KV read + 1 API call + 1 KV write

**ค่าใช้จ่าย (ถ้ามี 5 tenants):**
- D1 reads: 288 × (1 + 1 + 5) = **2,016 reads/day** = 60,480 reads/month ✅ (ยังในเกณฑ์ฟรี)
- KV reads: 288 × 5 = **1,440 reads/day** ⚠️ (เกิน free tier แล้วถ้ามี tenant เยอะ)
- KV writes: 288 × 5 = **1,440 writes/day** ❌ **เกิน free tier (1,000 writes/day)**

**การแก้ไข:**
```toml
# เปลี่ยนจาก ทุก 5 นาที → ทุก 15 นาที
crons = ["*/15 * * * *"]  # 96 ครั้ง/วัน แทน 288 ครั้ง

# หรือ ทุก 30 นาที (แนะนำ)
crons = ["*/30 * * * *"]  # 48 ครั้ง/วัน
```

**ประโยชน์:**
- KV writes: 48 × 5 = **240 writes/day** ✅ (อยู่ใน free tier)
- D1 reads: 48 × 7 = **336 reads/day** ✅ (ประหยัดมาก)
- ยังคงมี cache อัปเดตเร็วเพียงพอ (bank accounts ไม่ค่อยเปลี่ยน)

---

### 2. **GET /api/tenants - SubQuery บนทุก Tenant** ⚠️

**ปัญหา:**
```typescript
// tenant.service.ts:110-115
const results = await env.DB.prepare(
  `SELECT 
    t.*,
    (SELECT COUNT(*) FROM line_oas WHERE tenant_id = t.id AND status = 'active') as line_oa_count,
    (SELECT COUNT(*) FROM pending_transactions WHERE tenant_id = t.id AND status = 'pending') as pending_count
  FROM tenants t
  WHERE t.team_id = ?`
).bind(teamId).all();
```

**ปัญหาที่เกิดขึ้น:**
- **ทุกครั้ง** ที่โหลดหน้าแรก มี **3 queries ซ้อนกัน**:
  1. SELECT tenants
  2. SubQuery COUNT line_oas (ต่อ tenant)
  3. SubQuery COUNT pending_transactions (ต่อ tenant)

**ถ้ามี 10 tenants:**
- D1 reads = 1 + (10 × 2) = **21 reads/request**
- ถ้า refresh หน้าเว็บ 100 ครั้ง/วัน = **2,100 reads/day**

**การแก้ไข:**

**Option 1: ใช้ JOIN แทน SubQuery** (แนะนำ)
```typescript
const results = await env.DB.prepare(
  `SELECT 
    t.*,
    COUNT(DISTINCT lo.id) as line_oa_count,
    COUNT(DISTINCT pt.id) as pending_count
  FROM tenants t
  LEFT JOIN line_oas lo ON lo.tenant_id = t.id AND lo.status = 'active'
  LEFT JOIN pending_transactions pt ON pt.tenant_id = t.id AND pt.status = 'pending'
  WHERE t.team_id = ?
  GROUP BY t.id`
).bind(teamId).all();
```
- **1 query แทน 21 queries**
- ประหยัด D1 reads **95%**

**Option 2: Cache ผลลัพธ์** (สำหรับข้อมูลที่ไม่เปลี่ยนบ่อย)
```typescript
const cacheKey = `tenants:${teamSlug}:list`;
const cached = await env.BANK_KV.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const results = await env.DB.prepare(...).all();
await env.BANK_KV.put(cacheKey, JSON.stringify(results), {
  expirationTtl: 300 // 5 นาที
});
```

---

### 3. **Scan Receiver Matching - Loop ทุก Tenant** ⚠️

**ปัญหา:**
```typescript
// scan.service.ts:258-265
const tenants = await env.DB.prepare(
  `SELECT DISTINCT t.id, t.team_id, t.name, t.admin_api_url, s.session_token
   FROM tenants t
   INNER JOIN admin_sessions s ON s.tenant_id = t.id
   WHERE s.expires_at > ? AND t.status = 'active'`
).bind(now).all();

// Loop แต่ละ tenant
for (const tenant of tenants.results) {
  const bankData = await env.BANK_KV.get(bankKey); // KV read ต่อ tenant
  // ... matching logic
}
```

**ปัญหาที่เกิดขึ้น:**
- ทุกครั้งที่อัพโหลดสลิป = **ดึง KV ทุก tenant** จนกว่าจะเจอ tenant ที่ตรง
- ถ้ามี 10 tenants, เจอที่ tenant ที่ 8 = **8 KV reads**
- อัพโหลด 100 สลิป/วัน = **800 KV reads/day**

**การแก้ไข:**

**Option 1: Index ธนาคารด้วย KV** (แนะนำ)
```typescript
// บันทึก mapping: bank_id -> tenant_ids
await env.BANK_KV.put(
  `bank_index:${bankId}`,
  JSON.stringify(['tenant-123', 'tenant-456'])
);

// ตอน match:
const bankIndex = await env.BANK_KV.get(`bank_index:${receiverBank.id}`);
const tenantIds = JSON.parse(bankIndex || '[]');

// ดึงแค่ tenant ที่เกี่ยวข้อง (1-3 queries แทน 10)
for (const tenantId of tenantIds) {
  const bankData = await env.BANK_KV.get(`tenant:${tenantId}:banks`);
}
```
- ลด KV reads เหลือ **2-3 reads/request** แทน 8-10 reads

**Option 2: Combine ทุก tenant ไว้ใน KV เดียว**
```typescript
// เก็บ bank accounts ของทุก tenant รวมกัน
await env.BANK_KV.put('all_bank_accounts', JSON.stringify({
  'GSB-020480292133': 'tenant-123',
  'SCB-123456789': 'tenant-456',
  // ...
}));

// ตอน match: 1 KV read เท่านั้น
const allAccounts = await env.BANK_KV.get('all_bank_accounts');
const mapping = JSON.parse(allAccounts);
const tenantId = mapping[`${bank}-${account}`];
```
- **1 KV read/request** แทน 8-10 reads
- ประหยัด **80-90%**

---

### 4. **System Settings Queries - ทุกครั้งที่ Match** ⚠️

**ปัญหา:**
```typescript
// scan.service.ts:247-253
const nameMinChars = await env.DB.prepare(
  `SELECT value FROM system_settings WHERE key = 'name_match_min_chars'`
).first();
const accountMinDigits = await env.DB.prepare(
  `SELECT value FROM system_settings WHERE key = 'account_match_min_digits'`
).first();
```

**ทำทุกครั้ง** ที่เรียก `matchReceiver()` = 2 D1 reads

**การแก้ไข:**

**Option 1: Hard-code ค่าเริ่มต้น** (แนะนำ)
```typescript
// ไม่ต้อง query ถ้าค่าไม่เปลี่ยน
const minNameChars = 4; // hard-code
const minAccountDigits = 3; // hard-code
```
- ประหยัด **100%** (0 D1 reads)

**Option 2: Cache ไว้ใน Memory** (ถ้าต้องการความยืดหยุ่น)
```typescript
const SETTINGS_CACHE = new Map();

async function getSetting(env, key, defaultValue) {
  if (!SETTINGS_CACHE.has(key)) {
    const result = await env.DB.prepare(
      `SELECT value FROM system_settings WHERE key = ?`
    ).bind(key).first();
    SETTINGS_CACHE.set(key, result?.value || defaultValue);
  }
  return SETTINGS_CACHE.get(key);
}
```
- Query แค่ครั้งแรก, cache ไว้ใน memory

---

### 5. **GET /api/pending-transactions - ถูกเรียกบ่อย** ✅

**สถานะปัจจุบัน:**
```typescript
// pending.ts:13-19
const results = await env.DB.prepare(
  `SELECT id, tenant_id, slip_ref, amount, sender_name, status, slip_data, 
          matched_user_id, matched_username, created_at
   FROM pending_transactions
   ORDER BY created_at DESC
   LIMIT ?`
).bind(limit).all();
```

**ปัญหา:**
- ถ้าหน้าเว็บ auto-refresh ทุก 10 วินาที = **8,640 requests/day**
- D1 reads: 8,640 reads/day ✅ (ยังในเกณฑ์ฟรี แต่ไม่จำเป็น)

**การแก้ไข:**

**Option 1: เพิ่ม polling interval** (แนะนำ)
```javascript
// เปลี่ยนจาก 10 วินาที → 30 วินาที
setInterval(loadPendingTransactions, 30000);
```
- ลด D1 reads เหลือ **2,880 reads/day** (ประหยัด 67%)

**Option 2: ใช้ WebSocket หรือ Server-Sent Events**
- ส่ง update เมื่อมีการเปลี่ยนแปลงจริงๆ
- แต่ต้องใช้ Durable Objects (ไม่ฟรี)

**Option 3: Cache ระยะสั้น**
```typescript
const cacheKey = 'pending_list';
const cached = await env.BANK_KV.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const results = await env.DB.prepare(...).all();
await env.BANK_KV.put(cacheKey, JSON.stringify(results), {
  expirationTtl: 10 // 10 วินาที
});
```
- D1 reads: 1 read/10s = **8,640 reads/day** → **1 read/10s** (cache hit)

---

## 📈 สรุปและคำแนะนำ

### 🚨 ปัญหาเร่งด่วน (ต้องแก้ทันที):

1. **Cron Job ทุก 5 นาที** → เปลี่ยนเป็น **ทุก 30 นาที**
   - **ลด KV writes 83%** (1,440 → 240 writes/day)
   - ประหยัดค่าใช้จ่าย Workers Paid plan

2. **GET /api/tenants SubQuery** → ใช้ **JOIN แทน**
   - **ลด D1 reads 95%** (21 → 1 read/request)

3. **System Settings Query** → Hard-code ค่า
   - **ลด D1 reads 100%** (2 → 0 reads/request)

### ⚡ การปรับปรุงเพิ่มเติม (แนะนำ):

4. **Bank Matching** → ใช้ KV Index
   - **ลด KV reads 80%** (8-10 → 2 reads/request)

5. **Pending List Polling** → เพิ่ม interval
   - **ลด D1 reads 67%** (8,640 → 2,880 reads/day)

---

## 📊 การประมาณการประหยัดค่าใช้จ่าย

### ก่อนแก้ไข (ต้องใช้ Paid Plan):
- **Cron Job:** ต้องใช้ Workers Paid ($5/month)
- **KV Writes:** 1,440/day (เกิน free tier)
- **D1 Reads:** ~50,000/day (ยังในเกณฑ์ฟรี แต่ไม่จำเป็น)

### หลังแก้ไข (อยู่ใน Free Tier ได้):
- **Cron Job:** 30 นาที → **ยังต้องใช้ Paid plan** (แต่ประหยัดกว่า)
- **KV Writes:** 240/day ✅ (อยู่ใน free tier)
- **D1 Reads:** ~5,000/day ✅ (ลด 90%)

**ประหยัด:**
- KV operations: **83%**
- D1 operations: **90%**
- **ยาวนานขึ้น** ก่อนที่จะเกิน free tier ถ้ามี traffic เพิ่ม

---

## 🎯 Action Items

### ลำดับความสำคัญ:

**✅ แก้ทันที (High Priority):**
1. เปลี่ยน cron จาก `*/5` → `*/30` นาที
2. แก้ getAllTenants() ใช้ JOIN แทน SubQuery
3. Hard-code system settings (name_match_min_chars, account_match_min_digits)

**⚡ แก้เร็วๆ นี้ (Medium Priority):**
4. เพิ่ม KV Index สำหรับ bank matching
5. เพิ่ม polling interval ของ pending list

**💡 พิจารณาในอนาคต (Low Priority):**
6. Cache tenant list ใน KV (5 นาที)
7. Combine bank accounts ของทุก tenant ไว้ใน KV เดียว
8. ใช้ WebSocket แทน polling (ถ้ายอมจ่าย Paid plan)

---

## 📝 Code Examples

**1. แก้ cron interval:**
```toml
# backend/wrangler.toml
[triggers]
crons = ["*/30 * * * *"]  # เปลี่ยนจาก */5 → */30
```

**2. แก้ getAllTenants() ใช้ JOIN:**
```typescript
// backend/src/services/tenant.service.ts
const results = await env.DB.prepare(
  `SELECT 
    t.*,
    COUNT(DISTINCT CASE WHEN lo.status = 'active' THEN lo.id END) as line_oa_count,
    COUNT(DISTINCT CASE WHEN pt.status = 'pending' THEN pt.id END) as pending_count
  FROM tenants t
  LEFT JOIN line_oas lo ON lo.tenant_id = t.id
  LEFT JOIN pending_transactions pt ON pt.tenant_id = t.id
  WHERE t.team_id = ?
  GROUP BY t.id
  ORDER BY t.created_at DESC`
).bind(teamId).all();
```

**3. Hard-code system settings:**
```typescript
// backend/src/services/scan.service.ts
// ลบ query ทิ้ง:
// const nameMinChars = await env.DB.prepare(...).first();
// const accountMinDigits = await env.DB.prepare(...).first();

// ใช้ค่าคงที่แทน:
const minNameChars = 4;
const minAccountDigits = 3;
```

---

## 🔍 Monitoring

**ตรวจสอบการใช้งานที่ Cloudflare Dashboard:**
1. Workers & Pages → atslip-backend → Metrics
2. ดู:
   - **Requests/day** - ไม่ควรเกิน 100,000/day (free tier)
   - **D1 reads/month** - ไม่ควรเกิน 5M/month
   - **KV reads/day** - ไม่ควรเกิน 100,000/day
   - **KV writes/day** - ไม่ควรเกิน 1,000/day ⚠️ (สำคัญที่สุด)

**คำเตือน:**
- ถ้า KV writes เกิน 1,000/day → ต้องเปลี่ยน cron interval ทันที
- ถ้า D1 reads ใกล้ 5M/month → แก้ getAllTenants() และ system settings query

