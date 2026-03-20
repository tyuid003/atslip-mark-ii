# ATslip Mark-II Chrome Extension

ส่วนขยาย Chrome สำหรับระบบจัดการสแกนสลิปและเติมเครดิตอัตโนมัติ

## ✨ ฟีเจอร์

- 🏦 **จัดการรายชื่อเว็บ** - แสดงรายการเว็บทั้งหมดในทีม
- 📸 **อัพโหลดสลิป** - drag & drop หรือคลิกเพื่ออัพโหลดสลิป
- 📋 **รายการสแกน** - แสดงรายการ pending transactions พร้อม filter และ search
- ⚙️ **ตั้งค่าการตอบกลับ** - จัดการ LINE OA reply messages
- 🔔 **การแจ้งเตือนแบบ real-time** - รับการแจ้งเตือนทันทีเมื่อมีรายการใหม่
- 🎨 **UI กะทัดรัด** - ออกแบบมาเพื่อ side panel ของ Chrome

## 📦 การติดตั้ง

### วิธีที่ 1: ติดตั้งแบบ Developer Mode

1. เปิด Chrome และไปที่ `chrome://extensions/`
2. เปิดใช้งาน **Developer mode** ที่มุมบนขวา
3. คลิก **Load unpacked**
4. เลือกโฟลเดอร์ `chrome-extension` จากโปรเจคนี้
5. Extension จะถูกติดตั้งและพร้อมใช้งาน

### วิธีที่ 2: สร้างไฟล์ .crx (สำหรับการแจกจ่าย)

1. ไปที่ `chrome://extensions/`
2. เปิดใช้งาน **Developer mode**
3. คลิก **Pack extension**
4. เลือกโฟลเดอร์ `chrome-extension`
5. คลิก **Pack extension** เพื่อสร้างไฟล์ `.crx`

## 🚀 การใช้งาน

### เปิดใช้งาน Side Panel

1. คลิกที่ไอคอน Extension ในแถบเครื่องมือของ Chrome
2. Side panel จะเปิดขึ้นทางด้านขวาของหน้าต่าง
3. หรือคลิกขวาที่ไอคอน Extension และเลือก "Open side panel"

### เลือกทีม

1. ใช้เมนู dropdown ที่ด้านบนเพื่อเลือกทีมที่ต้องการ
2. ระบบจะโหลดข้อมูลของทีมที่เลือกโดยอัตโนมัติ

### อัพโหลดสลิป

1. ลากไฟล์สลิปมาวางในพื้นที่ upload zone
2. หรือคลิกที่พื้นที่เพื่อเลือกไฟล์
3. เลือกเว็บที่ต้องการสแกน (หรือปล่อยให้ระบบตรวจจับอัตโนมัติ)
4. รอสักครู่ระบบจะแสดงผลการสแกน

### ดูรายการสแกน

1. รายการทั้งหมดจะแสดงในส่วน "รายการสแกน"
2. ใช้ search box เพื่อค้นหา
3. ใช้ dropdown เพื่อกรองตามสถานะหรือเว็บ

### ตั้งค่าการตอบกลับ LINE OA

1. เลื่อนลงไปที่ส่วน "ตั้งค่าการตอบกลับ"
2. คลิกปุ่ม "ตั้งค่า" ของ LINE OA ที่ต้องการ
3. กำหนดข้อความตอบกลับและ Flex Message
4. คลิก "บันทึก"

## 🔧 โครงสร้างไฟล์

```
chrome-extension/
├── manifest.json           # Chrome Extension manifest
├── background.js           # Service worker สำหรับ background tasks
├── config.js              # API configuration
├── api.js                 # API client
├── sidepanel.html         # UI หลักของ side panel
├── sidepanel.css          # Styles
├── sidepanel.js           # Logic หลัก
├── icons/                 # ไอคอนของ extension
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # เอกสารนี้
```

## ⚙️ การตั้งค่า

### เปลี่ยน Backend URL

แก้ไขไฟล์ `config.js`:

```javascript
const API_CONFIG = {
  BASE_URL: 'https://your-backend-url.workers.dev',
  // ...
};
```

## 🛠️ การพัฒนา

### ข้อกำหนด

- Google Chrome 88 ขึ้นไป
- Backend API ที่รองรับ CORS
- Internet connection

### Debug

1. เปิด Chrome DevTools ในหน้า side panel (คลิกขวา > Inspect)
2. ดู console logs ใน Background Service Worker ที่ `chrome://extensions/`

## 📝 หมายเหตุ

- Extension นี้ใช้ Manifest V3 ซึ่งเป็น standard ล่าสุดของ Chrome
- รองรับ Side Panel API ที่มาพร้อม Chrome 114+
- ใช้ฟ้อนต์ Kanit จาก Google Fonts
- รองรับภาษาไทยเป็นหลัก

## 🐛 การแก้ไขปัญหา

### Extension ไม่ทำงาน

1. ตรวจสอบว่าเปิด Developer mode แล้ว
2. ลองกด Reload ที่หน้า `chrome://extensions/`
3. ตรวจสอบ console errors

### ไม่สามารถเชื่อมต่อ Backend ได้

1. ตรวจสอบ Backend URL ใน `config.js`
2. ตรวจสอบว่า Backend รองรับ CORS
3. ตรวจสอบ network tab ใน DevTools

### Side Panel ไม่เปิด

1. ตรวจสอบว่า Chrome version รองรับ Side Panel API (114+)
2. อัพเดท Chrome เป็น version ล่าสุด
3. ลองปิดเปิด Extension ใหม่

## 📄 License

MIT License - ดู LICENSE file สำหรับรายละเอียด

## 👨‍💻 ผู้พัฒนา

ATslip Mark-II Team

---

สร้างด้วย ❤️ สำหรับการจัดการระบบเติมเครดิตอัตโนมัติ
