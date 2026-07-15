# โปรเจคย่อยจาก ATslip เป็นส่วนขยาย Chrome 

ที่ไม่ต้องใช้ Auth หรือ login ใด แต่จะใช้งานได้บางฟังชั่นเช่น แสดงรายการสแกน จับคู่ เดิมเครดิต ดึงเครดิตกลับ และยังมีฟังชั่นเสริมสำหรับทำงานอื่นที่ไม่เกี่ยวกับสแกนสลิปเช่น เปลี่ยนรหัสผ่านลูกค้า(แยกtenant) , สมัครสมาชิก(แยกtenant)

## Ui และรายระเอียด

- เป็นส่วนขยายแบบ side panel
- ด้านบนสุดจะเป็นคล้ายๆ สารบัน เมื่อกดแล้วจะ scroll ไปที่ฟังชั่นที่เลือก
- ถัดมาจะเป็นช่องสำหรับสแกน (ใน ATslip จะมีให้เลือกหลายคีย์ หลายช่อง แต่ในส่วนขยายจะแสดงช่องเดียวอันใหญ่ และจะเอาสลิปไปสแกนใน key ที่ว่างอยู๋เสมอ)
- ถัดมาจะเป็นช่องค้นหาของรายการสแกน และปุ่มกรอง (ทำงานแบบเดียวกับของรายการสแกนของ ATslip)
- ถัดมาจะเป็นรายการสแกน อยากให้แสดงครบเหมือนของ ATslip แต่จะต้องจัดการ UI ให้ดีเนื่องจาก side panel เล็กกว่า สิ่งที่ต้องการให้แสดงคือ badgeสถานะ , {ชื่อผู้โอน} -> ,{ชื่อผู้รับโอน} , วันที่เวลาที่โอน , ชื่อ({ยูสเซอร์ที่จับคู่}) , icon ค้นหา , icon เติมเครดิต / icon ดึงเครดิตกลับ , จำนวนเงินที่โอน , ปุ่มกากบาทลบยอด
- ถัดมาจะเป็นส่วนของฟังชั่นอื่นๆ เช่น เปลี่ยนรหัสผ่าน , สมัครสมาชิก แบบของ U-shop (โดยใช้ Enpoint แบบเดียวกันแต่ต้องแยกเว็บโดเมนหลัก) สามารถดูตัวอย่างได้ที่ C:\Users\ASUS\Documents\univers_shop ส่วน ref ของ affiliate ถ้าหากสมัครผ่านส่วนขยายนี้จะไม่ใช้
- icon กลม ข้างในมี icon สแกน ตรวจจับใน https://chat.line.biz/ หากมีภาพที่ลูกค้าส่งมาจะมี icon นี้ข้างๆภาพ ผู้ใช้สามารถกดที่ปุ่มนี้เพื่อนำภาพนั้นไปสแกนได้ (Quick scan)

---

## สถานะการพัฒนา (v0.1.0 — โครงเริ่มต้น)

ได้สร้างโครงส่วนขยาย Chrome (Manifest V3, side panel) พร้อมฟังก์ชันหลักแล้ว:

- ✅ Side panel + สารบัญด้านบน (คลิกเพื่อ scroll + ไฮไลต์ส่วนที่กำลังดู)
- ✅ ช่องสแกนเดียวอันใหญ่ (คลิก / ลากวาง / วางจาก clipboard) → เรียก `POST /api/scan/upload` โดยไม่ระบุ service เพื่อให้ backend เลือกคีย์ที่ว่างอัตโนมัติ
- ✅ ช่องค้นหา + ปุ่มกรอง (สถานะ / ช่วงวันที่) เหมือนของ ATslip
- ✅ รายการสแกน: badge สถานะ, ชื่อผู้โอน → ผู้รับ, วันที่เวลาจากสลิป, ชื่อ(ยูสเซอร์ที่จับคู่), icon ค้นหา/จับคู่, ปุ่มเติมเครดิต/ดึงเครดิตกลับ, จำนวนเงิน, ปุ่มกากบาทลบยอด (auto-refresh ทุก 8 วินาที)
- ✅ Modal ค้นหา + จับคู่ผู้ใช้ (รองรับ member / non-member + gen-membercode)
- ✅ แสดง badge ผู้สแกน (scanned-by) + รูป/ชื่อ ในรายการ
- ✅ Popup สลิปซ้ำแบบเต็ม (รูปสลิป + สถานะ + ยูสเซอร์ + ปุ่มค้นหา/เติม/ดึงกลับ/ลบ)
- ✅ ฟังก์ชันเสริม: สมัครสมาชิก (captcha → check-phone → register, ไม่ใช้ affiliate ref) และเปลี่ยนรหัสผ่าน (ค้นหาลูกค้า → PUT admin API) ตาม AI_PLAN_APIDOC.md
- ✅ Content script บน chat.line.biz แสดงปุ่มกลมสแกนข้าง**ทุกรูป** (ผู้ใช้เลือกกดเอง)
- ✅ ส่งเฉพาะ `X-Team-Slug` — ไม่ต้อง login / ไม่ต้องกรอก token ใด ๆ (backend ดึง admin bearer จากฐานข้อมูลเอง)
- ✅ หน้าตั้งค่า (⚙️) กรอกแค่ **Team Slug** + เลือกร้าน เก็บใน `chrome.storage.local`

### โครงสร้างไฟล์

```
chrome-extension/
  manifest.json          — MV3 + side panel + content script
  background.js          — service worker (เปิด panel, bridge quick scan)
  src/
    sidepanel.html
    css/sidepanel.css
    js/
      config.js          — ค่าเริ่มต้น
      storage.js         — อ่าน/เขียนการตั้งค่า
      api.js             — API client (X-Team-Slug, ไม่มี token)
      scanlist.js        — render รายการสแกน + credit/withdraw/delete + scanned-by badge
      match-modal.js     — ค้นหา + จับคู่ผู้ใช้
      duplicate-popup.js — popup สลิปซ้ำ
      functions.js       — สมัคร / เปลี่ยนรหัสผ่าน (lalaplay/hengdragon API)
      sidepanel.js       — main app (settings, scan box, TOC, quick-scan bridge)
    content/
      line-biz.js        — Quick scan บน chat.line.biz
      line-biz.css
```

### วิธีติดตั้ง (โหมดนักพัฒนา)

1. เปิด Chrome → `chrome://extensions`
2. เปิด **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** → เลือกโฟลเดอร์ `chrome-extension`
4. คลิกไอคอน extension บน toolbar เพื่อเปิด side panel
5. กด ⚙️ **ตั้งค่า** → กรอกแค่ **Team Slug** (เช่น `hengdragon-ruayruay`) → กด "โหลดรายชื่อร้านใหม่" → เลือกร้าน → บันทึก (ไม่ต้องกรอก Backend URL / token ใด ๆ)

---

## หมายเหตุการทำงาน / ข้อควรทราบ

1. **การยืนยันตัวตน (ทำงานเบื้องหลัง)** — ส่วนขยายส่งเฉพาะ `X-Team-Slug` ไม่มี token ใน UI เลย endpoint หลักของ backend ATslip (`/api/tenants`, `/api/pending-transactions/*`, `/api/scan/upload`, `/api/users/*`) ใช้ team slug อย่างเดียว ส่วน admin bearer ของแต่ละ tenant ถูกดึงจากตาราง `admin_sessions` ในฐานข้อมูลโดย backend เอง
2. **การเลือก tenant** — กรอก Team Slug → เลือกร้านเดียว ส่วนขยายแนบ `tenant_id` ไปทุกคำสั่ง
3. **สมัคร / เปลี่ยนรหัสผ่าน** — อ้างอิง `univers_shop/AI_PLAN_APIDOC.md`:
   - สมัคร (public, ไม่ใช้ bearer): ส่วนขยายเรียกตรงไปเว็บของร้าน (`{site}/api/proxy/users/*`) — site มาจาก `admin_api_url` ตัด `api.` ออก, refBy ว่าง (ไม่ใช้ affiliate)
   - เปลี่ยนรหัสผ่าน: ค้นหาลูกค้าผ่าน `/api/users/search` → เรียก backend `PUT /api/users/update/:id` (โค้ด proxy เพิ่มใหม่ใน `backend/src/api/user-search.ts`) ซึ่งใช้ admin bearer จากฐานข้อมูล แล้ว forward ไป `{admin_api_url}/api/users/update/{id}` — ส่วนขยายไม่ต้องรู้ token เลย
4. **Quick scan (chat.line.biz)** — จับเฉพาะ**รูป media ที่ส่งในแชทจริง** (โดเมน `chat-content.line.biz`) ไม่จับ emoji/avatar/sticker/flex card, ปุ่มวางบน `a.chat-media-link` — การดึงรูปทำใน background service worker (bypass CORS) แล้วส่ง dataURL ให้ side panel
5. **ไอคอน extension** — ยังไม่ใส่ (เพิ่มได้ภายหลังใน manifest)
6. **host permission** — manifest ใช้ `https://*/*` เฉพาะเพื่อเรียกสมัคร (public site) ของแต่ละ tenant + ipify (การสแกน/เปลี่ยนรหัสผ่านตอนหลังวิ่งผ่าน backend ATslip)
7. **ต้อง deploy backend ใหม่** — เพิ่ม route `PUT /api/users/update/:id` ใน backend ATslip (additive ไม่กระทบของเดิม) — ต้อง deploy ก่อนฟังก์ชันเปลี่ยนรหัสผ่านจะทำงาน

### ยังต้องยืนยันเล็กน้อย
- โค้ด update proxy ใช้ path `{admin_api_url}/api/users/update/{id}` (ตาม doc v1) — ถ้า tenant เป็น v2 หรือ path ต่างออกไป แก้ที่ `handleUpdateUser` ใน `backend/src/api/user-search.ts`
- รูปแบบ response ของ list/search โค้ดรองรับหลายทรงแล้ว (`data.transactions`/`data.items`/`data.users`)