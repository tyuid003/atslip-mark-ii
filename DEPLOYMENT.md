# คู่มือการ Deploy

## 🚀 Deploy Backend (Cloudflare Workers)

### 1. เตรียม Cloudflare Account
- ลงทะเบียนที่ https://dash.cloudflare.com
- เข้าสู่ระบบ wrangler CLI:
```bash
npx wrangler login
```

### 2. สร้าง D1 Database
```bash
cd backend
npx wrangler d1 create atslip_db
```

คัดลอก `database_id` ที่ได้ แล้วแก้ไขใน `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "atslip_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ใส่ ID ที่ได้
```

### 3. สร้าง KV Namespace
```bash
npx wrangler kv:namespace create "BANK_KV"
```

คัดลอก `id` ที่ได้ แล้วแก้ไขใน `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "BANK_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # ใส่ ID ที่ได้
```

### 4. สร้างตารางในฐานข้อมูล
```bash
npx wrangler d1 execute atslip_db --file=schema.sql
```

### 5. Deploy Worker
```bash
npm run deploy
```

หรือ
```bash
npx wrangler deploy
```

### 6. บันทึก Worker URL
หลัง deploy สำเร็จ คุณจะได้ URL เช่น:
```
https://atslip-backend.YOUR_SUBDOMAIN.workers.dev
```

---

## 🌐 Deploy Frontend (Cloudflare Pages)

### วิธีที่ 1: Deploy ผ่าน Git (แนะนำ)

#### 1. Push code ไปยัง GitHub
```bash
cd ..  # กลับไปที่ root ของโปรเจค
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/atslip-mark-ii.git
git push -u origin main
```

#### 2. เชื่อมต่อกับ Cloudflare Pages
1. ไปที่ https://dash.cloudflare.com
2. เลือก **Pages** > **Create a project**
3. เลือก **Connect to Git**
4. เลือก repository `atslip-mark-ii`
5. ตั้งค่า Build:
   - **Framework preset:** None
   - **Build command:** (ว่างเปล่า)
   - **Build output directory:** `/`
   - **Root directory:** `frontend`
6. คลิก **Save and Deploy**

#### 3. อัพเดท API URL
หลัง deploy สำเร็จ คุณจะได้ URL เช่น:
```
https://atslip-mark-ii.pages.dev
```

แก้ไขไฟล์ `frontend/js/config.js`:
```javascript
const API_CONFIG = {
  BASE_URL: 'https://atslip-backend.YOUR_SUBDOMAIN.workers.dev',  // ใส่ Worker URL ที่ได้จาก backend
  // ...
};
```

Commit และ push การเปลี่ยนแปลง:
```bash
git add frontend/js/config.js
git commit -m "Update API URL"
git push
```

Cloudflare Pages จะ rebuild อัตโนมัติ

---

### วิธีที่ 2: Deploy ผ่าน Wrangler CLI

```bash
cd frontend
npx wrangler pages deploy . --project-name=atslip-frontend
```

---

## ✅ ตรวจสอบการ Deploy

### Backend
```bash
curl https://atslip-backend.YOUR_SUBDOMAIN.workers.dev/api/tenants
```

คำตอบที่ถูกต้อง:
```json
{
  "success": true,
  "data": []
}
```

### Frontend
เปิด browser ไปที่:
```
https://atslip-frontend.pages.dev
```

ควรเห็นหน้าจัดการเว็บพร้อมปุ่ม "เพิ่มเว็บใหม่"

---

## 🔧 การอัพเดท

### อัพเดท Backend
```bash
cd backend
npm run deploy
```

### อัพเดท Frontend
หากใช้ Git integration:
```bash
cd frontend
git add .
git commit -m "Update frontend"
git push
```

หากใช้ CLI:
```bash
cd frontend
npx wrangler pages deploy .
```

---

## 📝 หมายเหตุ

- ตรวจสอบให้แน่ใจว่า `wrangler.toml` มี `database_id` และ KV `id` ที่ถูกต้อง
- อย่า commit `.env` หรือ `.dev.vars` ไปยัง Git
- ใช้ Cloudflare Dashboard เพื่อจัดการ Environment Variables
- D1 และ KV ใน production แยกจาก development

---

## 🆘 แก้ไขปัญหา

### ปัญหา: Worker ไม่เชื่อมต่อกับ D1
**วิธีแก้:** ตรวจสอบ `database_id` ใน `wrangler.toml` และ deploy ใหม่

### ปัญหา: CORS Error
**วิธีแก้:** ตรวจสอบว่า backend ส่ง CORS headers ถูกต้อง (มีอยู่แล้วใน code)

### ปัญหา: Frontend ไม่เรียก API ได้
**วิธีแก้:** ตรวจสอบ `BASE_URL` ใน `frontend/js/config.js`
