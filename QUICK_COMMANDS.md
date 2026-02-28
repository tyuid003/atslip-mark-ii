# 🎯 Quick Commands Reference

## 📖 GitHub Login & Repository

```powershell
# Login GitHub (ใหม่ครั้งแรก)
gh auth login

# ตรวจสอบสถานะ
gh auth status

# สร้าง repository (วิธีที่เร็วที่สุด)
gh repo create atslip-mark-ii --public --source=. --remote=origin --push

# ถ้า login แล้ว:
git push
```

---

## ☁️ Cloudflare Wrangler

```powershell
# Login Cloudflare
wrangler login

# ตรวจสอบ login
wrangler whoami

# สร้าง D1 Database
cd backend
wrangler d1 create atslip_db

# สร้าง KV Namespace
wrangler kv:namespace create "BANK_KV"

# สร้างตารางในฐานข้อมูล
wrangler d1 execute atslip_db --file=schema.sql

# Deploy Backend
npm run deploy
# หรือ
wrangler deploy

# ดูสถานะ deployment
wrangler deployments list
```

---

## 📝 Git Commands

```powershell
# ดูสถานะ
git status

# ดูรายการ commit
git log --oneline

# ดูรายละเอียด commit
git log -1 --stat

# Commit ใหม่
git add .
git commit -m "เพิ่มฟีเจอร์..."
git push

# อัพเดท code ล่าสุดจาก GitHub
git pull
```

---

## 🧪 Testing

```powershell
# ทดสอบ backend (local)
cd backend
npm run dev
# จะเปิด http://localhost:8787

# ทดสอบ API
curl http://localhost:8787/api/tenants
```

---

## 🔧 Troubleshooting

```powershell
# ตรวจสอบ Node.js version
node --version

# ตรวจสอบ npm version
npm --version

# Refresh PATH environment
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Clear npm cache
npm cache clean --force

# ดูรายละเอียด error
npm install --verbose
```

---

## ✏️ แก้ไข API URL

เมื่อ backend deploy สำเร็จ ให้แก้ไข `frontend/js/config.js`:

```javascript
const API_CONFIG = {
  BASE_URL: 'https://atslip-backend.YOUR_SUBDOMAIN.workers.dev',  // ← ใส่ URL
  ENDPOINTS: {
    TENANTS: '/api/tenants',
    LINE_OAS: '/api/line-oas',
  }
};
```

จากนั้น commit และ push:
```powershell
git add frontend/js/config.js
git commit -m "Update API URL"
git push
```

---

## 📱 Frontend Deployment

1. ไป Cloudflare Dashboard: https://dash.cloudflare.com/
2. ไปที่ **Pages** → **Create a project**
3. **Connect to Git** → เลือก `atslip-mark-ii`
4. Build settings:
   - Root directory: `frontend`
   - Build command: (ว่างเปล่า)
   - Build output directory: `/`
5. Deploy!

---

## 🚀 Full Deploy Checklist

- [ ] Login GitHub (`gh auth login`)
- [ ] Create GitHub repository (`gh repo create ...` หรือ web)
- [ ] Login Cloudflare (`wrangler login`)
- [ ] Create D1 Database (`wrangler d1 create atslip_db`)
- [ ] Update wrangler.toml with Database ID
- [ ] Create KV Namespace (`wrangler kv:namespace create "BANK_KV"`)
- [ ] Update wrangler.toml with KV ID
- [ ] Create tables (`wrangler d1 execute atslip_db --file=schema.sql`)
- [ ] Deploy Backend (`cd backend && npm run deploy`)
- [ ] Copy Backend URL
- [ ] Update frontend/js/config.js with Backend URL
- [ ] Commit and push changes (`git push`)
- [ ] Deploy Frontend to Cloudflare Pages
- [ ] Test Frontend URL
- [ ] Test API calls from Frontend

---

## 🎉 Success Indicators

✓ Backend URL works: `https://atslip-backend.xxx.workers.dev/api/tenants`
✓ Frontend loads: `https://atslip-mark-ii.pages.dev`
✓ Frontend can fetch tenants (empty list on first time)
✓ Can add new tenant via UI
✓ Can manage LINE OAs
✓ Can connect to Admin Backend

---

## 📞 Support

อ่านไฟล์อื่นๆ เพิ่มเติม:
- `README.md` - ภาพรวมระบบ
- `SETUP_GUIDE.md` - คู่มายละเอียด
- `DEPLOYMENT.md` - deployment guide
