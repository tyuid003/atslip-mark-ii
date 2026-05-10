EasySlip
Developer API
API ตรวจสอบสลิปโอนเงินธนาคารไทย

เริ่มต้นใช้งาน
API Reference
EasySlip
⚡
ตรวจสอบรวดเร็ว
ตรวจสอบสลิปได้ในเวลาไม่กี่มิลลิวินาที Uptime 99.9%

🏦
รองรับ 18+ ธนาคาร
รองรับธนาคารหลักทุกแห่ง - KBANK, SCB, BBL, KTB, BAY, TTB และอื่นๆ

🔒
API ปลอดภัย
ยืนยันตัวตนด้วย Bearer Token พร้อม IP Whitelist

📱
หลายวิธีการ
ตรวจสอบผ่าน QR Payload, อัปโหลดรูป, Base64 หรือ URL

🔄
ตรวจจับสลิปซ้ำ
ระบบตรวจจับสลิปซ้ำในตัวเพื่อป้องกันการฉ้อโกง

✅
จับคู่บัญชี
ตรวจสอบบัญชีผู้รับและจำนวนเงินด้วย API v2

เริ่มต้นใช้งาน

curl -X POST https://api.easyslip.com/v2/verify/bank \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"payload": "00020101021230..."}'
Response:


{
  "success": true,
  "data": {
    "transRef": "68370160657749I376388B35",
    "amount": { "amount": 1000.00 },
    "sender": {
      "bank": { "short": "KBANK" },
      "account": { "name": { "th": "นาย ทดสอบ" } }
    },
    "receiver": {
      "bank": { "short": "SCB" },
      "account": { "name": { "th": "นาย รับเงิน" } }
    }
  }
}
Base URL
เวอร์ชัน	URL	สถานะ
v2	https://api.easyslip.com/v2	ปัจจุบัน
v1	https://developer.easyslip.com/api/v1	Legacy
แนะนำ

ใช้ API v2 สำหรับโปรเจกต์ใหม่ มี Error Handling ที่ดีกว่าและมีฟีเจอร์จับคู่บัญชี

รับ API Key
สมัครที่ developer.easyslip.com เพื่อรับ API Key

ภาพรวม API v2
API v2 เป็นเวอร์ชันล่าสุดของ EasySlip Developer API มีฟีเจอร์ที่ปรับปรุง Error Handling ที่ดีขึ้น และรูปแบบ Response ที่เป็นมาตรฐาน

Base URL

https://api.easyslip.com/v2
ฟีเจอร์หลัก
รูปแบบ Response มาตรฐาน
ทุก Response มีโครงสร้างเดียวกัน:

Response สำเร็จ:


{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
Response Error:


{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "ข้อความอธิบาย Error"
  }
}
จับคู่บัญชี
จับคู่ผู้รับในสลิปกับบัญชีธนาคารที่คุณลงทะเบียน:


{
  "payload": "QR_PAYLOAD",
  "matchAccount": true
}
Response จะมีข้อมูลบัญชีที่จับคู่ได้:


{
  "matchedAccount": {
    "bank": {
      "nameTh": "กสิกรไทย",
      "nameEn": "KASIKORNBANK",
      "code": "004",
      "shortCode": "KBANK"
    },
    "nameTh": "บริษัท ตัวอย่าง จำกัด",
    "nameEn": "EXAMPLE CO., LTD.",
    "type": "JURISTIC",
    "bankNumber": "123-4-56789-0"
  }
}
ตรวจสอบจำนวนเงิน
ตรวจสอบว่าจำนวนเงินในสลิปตรงกับที่คาดหวัง:


{
  "payload": "QR_PAYLOAD",
  "matchAmount": 1500.50
}
Response จะมีผลการตรวจสอบ:


{
  "amountInOrder": 1500.50,
  "amountInSlip": 1500.50,
  "isAmountMatched": true
}
รองรับหลาย Branch
สร้าง API Branch หลายตัวพร้อม:

API Key แยกต่อ Branch
ติดตามโควต้าต่อ Branch
IP Restrictions ที่ต่างกัน
Endpoints
Endpoint	Method	คำอธิบาย
/verify/bank	POST	ตรวจสอบสลิปธนาคาร
/info	GET	ดูข้อมูลแอปพลิเคชัน
/health	GET	ตรวจสอบสถานะ
การยืนยันตัวตน
ทุก Request ต้องมี Bearer Token:


Authorization: Bearer YOUR_API_KEY
ดู คู่มือการยืนยันตัวตน สำหรับรายละเอียด

ตัวอย่างอย่างรวดเร็ว
ตรวจสอบสลิปธนาคาร

curl -X POST https://api.easyslip.com/v2/verify/bank \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"payload": "YOUR_QR_PAYLOAD"}'
ดูข้อมูลแอปพลิเคชัน

curl -X GET https://api.easyslip.com/v2/info \
  -H "Authorization: Bearer YOUR_API_KEY"
รหัส Error
Code	HTTP Status	คำอธิบาย
MISSING_API_KEY	401	ไม่มี Authorization Header
INVALID_API_KEY	401	API Key ไม่ถูกต้อง
BRANCH_INACTIVE	403	Branch ถูกปิดใช้งาน
SERVICE_BANNED	403	บริการถูกระงับ
USER_BANNED	403	ผู้ใช้ถูกระงับ
IP_NOT_ALLOWED	403	IP ไม่อยู่ใน Whitelist
QUOTA_EXCEEDED	403	เกินโควต้า API
VALIDATION_ERROR	400	Request ไม่ถูกต้อง
SLIP_NOT_FOUND	404	ไม่พบสลิปหรือสลิปไม่ถูกต้อง
API_SERVER_ERROR	500	Error จาก API ภายนอก
ดู รหัส Error ทั้งหมด สำหรับรายการเต็ม

ขั้นตอนถัดไป
ตรวจสอบสลิปธนาคาร - เรียนรู้การตรวจสอบสลิป
ข้อมูลแอปพลิเคชัน - ดูข้อมูลแอปพลิเคชัน
รหัส Error - จัดการ Error อย่างถูกต้อง
Pager
ก่อนหน้า
เวอร์ชัน API
ถัดไป
GET /info