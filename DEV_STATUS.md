# DEV_STATUS — Project Sync Status

> ไฟล์นี้สร้างโดย AI DevOps Assistant เพื่อบันทึกสถานะโปรเจคสำหรับ AI อ่านภายหลัง

---

## สถานะ ณ วันที่ 2026-07-26

### เปรียบเทียบ 3 แหล่ง

| แหล่ง | Timestamp ล่าสุด | สถานะ |
|---|---|---|
| **Local (เครื่อง Windows นี้)** | 2026-06-27 13:21 +0700 (commit `b779ff2`) | เก่าที่สุด — ตามหลัง 27 commits |
| **Cloudflare Workers** | 2026-07-22 16:31 +0700 (deployment `f193b0d9`) | ใหม่กว่า Local |
| **GitHub (origin/main)** | 2026-07-22 16:50 +0700 (commit `d5d3d5e`) | ใหม่ที่สุด |

### การวินิจฉัย

**สถานการณ์:** GitHub และ Cloudflare ใหม่กว่า Local ~25 วัน (27 commits)

⚠️ **LOCAL มีไฟล์แก้ไขค้างอยู่ 14 ไฟล์ (uncommitted/unstaged)** ได้แก่:

**Backend:**
- `backend/src/api/bank-accounts.ts`
- `backend/src/api/line-webhook.ts`
- `backend/src/api/scan.ts`
- `backend/src/durable-objects/telegram-auth-do.ts`
- `backend/src/services/credit.service.ts`
- `backend/src/services/scan-queue.service.ts`
- `backend/src/services/scan.service.ts`

**Frontend:**
- `frontend/css/global.css`
- `frontend/index.html`
- `frontend/js/app-2.js`
- `frontend/js/manage-users.js`
- `frontend/js/realtime.js`
- `frontend/js/telegram-connect.js`
- `frontend/login.html`

> งานเหล่านี้ทำบนเครื่อง Local บน commit เก่า (June 27) — **ยังไม่ได้ push และยังไม่รู้ว่า conflict กับ remote หรือเปล่า**

---

## 27 Commits ที่ Local ไม่มี (GitHub ข้างหน้า)

### ฟีเจอร์ใหม่สำคัญ (สรุป)

1. **SMS-Hook Integration** (2026-07-22)
   - ระบบแปลง LINE scan → SMS format → ยิง webhook ออกไป
   - มี test-button, browser-relay bypass Cloudflare Worker IP block
   - หน้า `/sms-hook.html?team={slug}`

2. **Google Authenticator / TOTP 2FA** (2026-07-21)
   - รองรับ Google Authenticator สำหรับ v1 tenant login

3. **Cloudflare Queues for Scan** (2026-07-16)
   - ย้าย async scan processing ไปใช้ Cloudflare Queues
   - เพิ่ม queue concurrency เป็น 20

4. **Auto-retention for pending_transactions** (2026-07-16)
   - ลด retention จาก 7 วัน → 3 วัน
   - มี cron สำหรับ `scan_jobs` ด้วย

5. **Masked Slip Account Matching** (2026-07-15)
   - ใช้เลขบัญชีบนสลิปยืนยัน/จับคู่ผู้โอน (disambiguate)

6. **V2 Tenant Support** (2026-07-15)
   - member search, change-password, register รองรับ V2

7. **UX Improvements** (2026-07-13–14)
   - Spring entrance animation สำหรับ scan items
   - Confirm popup สำหรับปุ่ม withdraw-credit
   - Fix touch device withdraw button

8. **Anti-dup on manual credit (v1)** (2026-07-21)
   - บังคับ anti-dup check บน manual credit path ด้วย

### 3 Commits ที่ GitHub มีแต่ Cloudflare ยังไม่ได้ deploy

```
2026-07-22 16:50 | fix(sms-hook): auto-start relay on load + realtime activity log + timestamp in test message
2026-07-22 16:40 | fix(sms-hook): test button uses fetch no-cors (not window.open)
2026-07-22 16:32 | fix(sms-hook): test opens in new tab + show resolved_url in pending logs
```

---

## สิ่งที่ต้องทำก่อนเริ่มพัฒนาต่อ

```powershell
# 1. Stash งานค้างในเครื่องก่อน
git stash push -m "wip: local changes before pulling remote (2026-07-26)"

# 2. Pull จาก GitHub
git pull origin main

# 3. ตรวจสอบ stash แล้วค่อย apply + แก้ conflict
git stash list
git stash pop

# 4. หลัง merge เรียบร้อย — deploy ขึ้น Cloudflare
cd backend
npx wrangler deploy
```

---

*Last checked: 2026-07-26 by AI DevOps Assistant*
