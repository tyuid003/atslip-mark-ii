# 📝 คู่มือการ Login และเชื่อมต่อ

## ✅ ส่วนที่เสร็จแล้ว

### 1. ติดตั้ง Tools
- ✅ Node.js v25.7.0
- ✅ npm 11.10.1
- ✅ Git 2.53.0
- ✅ GitHub CLI 2.87.3
- ✅ Wrangler 4.69.0

### 2. Backend Setup
- ✅ npm dependencies ติดตั้งเสร็จ
- ✅ Git repository สร้างเสร็จ
- ✅ Initial commit สำเร็จ

---

## 🔄 ขั้นตอนต่อไป

### ขั้นตอนที่ 1: Login GitHub

**วิธี A: ใช้ Terminal (แนะนำ)**

1. เปิด PowerShell
2. วิ่งคำสั่ง:
```powershell


```

3. ตอบคำถาม:
   - `Where do you use GitHub?` → เลือก `GitHub.com`
   - `Authenticate Git with your GitHub credentials?` → พิมพ์ `Y` และกด Enter
   - `How would you like to authenticate GitHub CLI?` → เลือก `Login with a web browser`

4. จะปรากฏ one-time code เช่น `8322-B3D7` → **Copy code นี้**

5. กด Enter → Browser จะเปิดไปที่ https://github.com/login/device

6. **Paste code ที่คัดลอก** และ Login ด้วย GitHub account ของคุณ

7. อนุมัติการเข้าถึง GitHub CLI

8. กลับมาที่ Terminal → ควรเห็นข้อความ "Authentication complete!"

---

**วิธี B: ใช้ Token (ถ้า Terminal ไม่ได้)**

1. ไปที่ https://github.com/settings/tokens
2. คลิก "Generate new token" → "Generate new token (classic)"
3. ตั้งชื่อ: `ATslip-CLI`
4. เลือก scopes: `repo`, `gist`, `write:packages`, `admin:public_key`
5. Click "Generate token" และ **Copy token**
6. ใช้คำสั่ง:
```powershell
gh auth login --with-token
# แล้ว paste token
```

---

### ขั้นตอนที่ 2: สร้าง Repository ใน GitHub

**วิธี A: ใช้ GitHub CLI (อัตโนมัติ)**

```powershell
gh repo create atslip-mark-ii --public --source=. --remote=origin --push
```

**วิธี B: สร้าง Manual ใน GitHub Web**

1. ไปที่ https://github.com/new
2. Repository name: `atslip-mark-ii`
3. Description: `Automated Deposit System v3.0`
4. Public repository
5. Click "Create repository"
6. คัดลอก URL เช่น `https://github.com/YOUR_USERNAME/atslip-mark-ii.git`
7. รัน:
```powershell
git remote remove origin
git remote add origin https://github.com/YOUR_USERNAME/atslip-mark-ii.git
git push -u origin main
# หรือ
git push -u origin master
```

---

### ขั้นตอนที่ 3: Login Cloudflare

```powershell
wrangler login
```

1. Browser จะเปิด Cloudflare Login
2. Login ด้วย Cloudflare account ของคุณ
3. อนุมัติการเข้าถึง Wrangler
4. กลับมาที่ Terminal → ควรเห็น "✅ Successfully logged in"

---

### ขั้นตอนที่ 4: สร้าง D1 Database

```powershell
cd backend
wrangler d1 create atslip_db
```

**Output:**
```
 binding = "DB"
 database_name = "atslip_db"
 database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**คัดลอก `database_id` และแก้ไข `wrangler.toml`:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "atslip_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← ใส่ ID ที่ได้
```

---

### ขั้นตอนที่ 5: สร้าง KV Namespace

```powershell
wrangler kv:namespace create "BANK_KV"
```

**Output:**
```
 binding = "BANK_KV"
 id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**คัดลอก `id` และแก้ไข `wrangler.toml`:**

```toml
[[kv_namespaces]]
binding = "BANK_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # ← ใส่ ID ที่ได้
```

---

### ขั้นตอนที่ 6: สร้างตารางใน D1

```powershell
wrangler d1 execute atslip_db --file=schema.sql
```

---

### ขั้นตอนที่ 7: Deploy Backend

```powershell
npm run deploy
# หรือ
wrangler deploy
```

**บันทึก URL ที่ได้** เช่น:
```
https://atslip-backend.YOUR_SUBDOMAIN.workers.dev
```

---

### ขั้นตอนที่ 8: เชื่อมต่อ Frontend กับ Backend

แก้ไข `frontend/js/config.js`:

```javascript
const API_CONFIG = {
  BASE_URL: 'https://atslip-backend.YOUR_SUBDOMAIN.workers.dev',  // ← ใส่ URL
  ENDPOINTS: {
    TENANTS: '/api/tenants',
    LINE_OAS: '/api/line-oas',
  }
};
```

**Commit และ Push:**
```powershell
git add frontend/js/config.js
git commit -m "Update API URL for backend"
git push
```

---

### ขั้นตอนที่ 9: Deploy Frontend ไป Cloudflare Pages

1. ไปที่ https://dash.cloudflare.com/
2. ไปที่ **Pages**
3. Click **+ Create a project**
4. Click **Connect to Git**
5. เลือก repository `atslip-mark-ii`
6. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave blank)
   - **Build output directory:** `/`
   - **Root directory:** `frontend`
7. Click **Save and Deploy**

---

## ✨ เสร็จเรียบร้อย!

หลัง deploy สำเร็จ คุณจะได้:
- **Backend URL:** `https://atslip-backend.YOUR_SUBDOMAIN.workers.dev`
- **Frontend URL:** `https://atslip-mark-ii.pages.dev`

### ทดสอบ:
```powershell
# ทดสอบ Backend
curl https://atslip-backend.YOUR_SUBDOMAIN.workers.dev/api/tenants

# ต้องได้:
# {"success":true,"data":[]}
```

---

## 🎯 สำเร็จแล้ว!

ตอนนี้คุณสามารถ:
- ✅ ใช้งาน Frontend เพื่อจัดการ Tenant
- ✅ Commit code กลับไป GitHub
- ✅ Cloudflare Pages จะ auto-rebuild จากการ push

---

## 💡 Tips

- **Git Commits:** ใช้ commit message เป็นภาษาไทยได้ เช่น `git commit -m "เพิ่มฟีเจอร์สแกนสลิป"`
- **Auto Push:** สามารถตั้งค่า GitHub Actions เพื่อ auto-deploy เมื่อ push
- **Environment:** ใช้ `wrangler secret put EASYSLIP_KEY` เพื่อจัดการ sensitive data

---

**สร้างเมื่อ:** February 28, 2026  
**เวอร์ชั่น:** v3.0
