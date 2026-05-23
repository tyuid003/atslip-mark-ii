# Telegram Version Spec (Execution Checklist)

เอกสารนี้เป็นแผนลงมือแบบ Step-by-step สำหรับให้ AI/Developer ทำตามโดยไม่ตกหล่น

เป้าหมายหลัก:
1) ทีมเดียวกันต้องใช้งานได้พร้อมกันทั้ง Telegram และ Browser ตามปกติ
2) ห้ามกระทบ flow เดิมบน Browser (dashboard, scan, pending, manual match, withdraw credit)
3) Telegram เป็นอีกช่องทางรับคำสั่ง/รับสลิป ไม่ใช่การแทนที่ Browser

-----------------------------------
## 0) ข้อกำหนดบังคับ (Do Not Break)

1. หนึ่งทีมผูกได้หนึ่ง Telegram Group
2. ทีมเดียวกันต้องทำงานพร้อมกันได้ทั้ง 2 ช่องทาง:
	- Browser upload/scan
	- Telegram group image scan
3. ข้อมูลธุรกรรมต้องใช้แหล่งเดียวกัน (pending_transactions เดิม)
4. การทำเครดิตต้อง idempotent ป้องกันยิงซ้ำจากหลายช่องทาง
5. ถ้าช่องทางหนึ่งทำรายการเสร็จ อีกช่องทางต้องเห็นผลทันที (realtime/event update)
6. ต้องรองรับคิวงานเมื่อมีหลายคนส่งสลิปพร้อมกัน (ไม่ตกหล่น, ไม่ทำซ้ำ, ไม่ค้างทั้งระบบ)

-----------------------------------
## 1) Data Model และ Migration (เพิ่มแบบไม่ทับของเดิม)

### 1.1 เพิ่มตารางเชื่อมต่อ Telegram ต่อทีม
สร้างตารางใหม่ `team_telegram_connections`:
- id (pk)
- team_id (unique)
- telegram_group_id (unique)
- telegram_group_title
- telegram_bot_id
- telegram_bot_token (เข้ารหัสก่อนเก็บ)
- status ('active' | 'inactive')
- created_at
- updated_at

ข้อบังคับ:
1) one team -> one group
2) one group -> one team

### 1.2 เพิ่มตาราง map ข้อความ Telegram กับธุรกรรม
สร้างตาราง `telegram_message_links`:
- id (pk)
- team_id
- telegram_group_id
- telegram_message_id
- pending_transaction_id
- message_type ('scan_result' | 'status_update' | 'manual_prompt')
- created_at

เหตุผล:
1) รองรับการ reply ข้อความเดิมเพื่อ manual match
2) รองรับ reply ใต้ข้อความสถานะใหม่แต่ชี้ธุรกรรมเดิมได้

### 1.3 เพิ่มตาราง state คำสั่งสนทนา
สร้างตาราง `telegram_chat_state`:
- id (pk)
- team_id
- telegram_group_id
- telegram_user_id
- state_key (เช่น 'awaiting_connect_target', 'awaiting_captcha')
- state_payload_json
- expires_at
- created_at
- updated_at

-----------------------------------
## 2) Backend Architecture (แยก Adapter)

### 2.1 เพิ่ม Telegram API module
เพิ่มโมดูล:
1) Telegram webhook endpoint รับ event จาก bot
2) Telegram sender service สำหรับส่งข้อความ/ปุ่ม
3) Telegram command router

### 2.2 Reuse scan pipeline เดิม
Telegram ห้ามสร้าง scan logic ใหม่
ให้เรียก flow เดิมของ `scan/upload` โดยระบุ source='telegram'

### 2.3 เพิ่ม Source type
ปรับ enum/source ให้มีค่าเพิ่ม:
- 'telegram'

### 2.4 Event dispatch
เมื่อธุรกรรมเปลี่ยนสถานะ ให้ส่ง event ไป:
1) Browser realtime (ของเดิม)
2) Telegram message update (ของใหม่)

### 2.5 Queue Processing (รองรับหลายสลิปพร้อมกัน)
บังคับใช้ queue กลางสำหรับงาน scan/credit:
1) รับ event สลิปเข้าคิวทันที (ingress ไม่ block)
2) worker ดึงงานตามลำดับ (FIFO ต่อทีม หรือ partition ตาม team_id)
3) จำกัด concurrency ต่อทีม (เช่น 1-3 งานพร้อมกัน) กันเครดิตชนกัน
4) มี retry policy แบบ exponential backoff สำหรับ upstream ล่ม (เช่น scan provider)
5) มี dead-letter queue (DLQ) สำหรับงานที่ fail เกิน max attempts
6) ทุกงานต้องมี idempotency key และ trace id
7) สถานะคิวต้องสะท้อนให้ผู้ใช้เห็นได้ (queued -> processing -> success/failed)

-----------------------------------
## 3) Telegram Functional Flow

### 3.1 ส่งรูปสลิปเข้ากลุ่ม
1) รับ image event
2) ดาวน์โหลดไฟล์จาก Telegram
3) enqueue งานเข้า queue กลาง (ไม่ประมวลผลหนักใน webhook)
4) worker ส่งเข้า scan pipeline เดิม
5) ได้ผลลัพธ์แล้วตอบกลับกลุ่มทันที
6) ถ้างานรอคิว ให้ส่งข้อความสถานะ "รับคำขอแล้ว กำลังรอคิว"

### 3.2 รูปแบบข้อความผลลัพธ์
กรณีสำเร็จ:
- สถานะสำเร็จ
- ยูสเซอร์ที่เติม
- ยอดเงิน
- วันที่เวลา
- ชื่อบัญชีเว็บ/ชื่อเว็บ

กรณีไม่สำเร็จ:
- ยอดซ้ำ (duplicate)
- ไม่พบยูสเซอร์ (pending)

### 3.3 Manual reply flow
สำหรับสถานะ pending/duplicate:
1) ผู้ใช้ reply ใต้ข้อความผลลัพธ์พร้อมข้อมูลลูกค้า
2) ระบบ parse ข้อความ -> หา transaction จาก telegram_message_links
3) ทำ manual match
4) แจ้งผลเป็นข้อความใหม่
5) บันทึกข้อความใหม่นั้นให้ชี้ transaction เดิมด้วย

เงื่อนไขสำคัญ:
1) reply ได้หลายครั้งจนสำเร็จ
2) reply ใต้ข้อความใหม่ก็ยังต้องชี้รายการเดิมได้

### 3.4 Withdraw credit button
เฉพาะรายการ credited:
1) แนบ inline button "ดึงเครดิตกลับ"
2) callback query -> เรียก API withdraw เดิม
3) อัปเดตสถานะข้อความ

-----------------------------------
## 4) Command Menu (/menu)

### 4.1 เชื่อมต่อ
flow:
1) ผู้ใช้กดเมนูเชื่อมต่อ
2) ระบบแสดงรายการเว็บในทีม
3) เมื่อเลือกเว็บ -> ระบบขอ captcha
4) ผู้ใช้ reply captcha
5) ระบบ login/connect tenant
6) แจ้งผลสำเร็จ/ไม่สำเร็จ

### 4.2 รายชื่อเว็บ
แสดง:
1) ชื่อเว็บ
2) API URL
3) สถานะเชื่อมต่อ

-----------------------------------
## 5) Frontend UI Change (Topbar)

ปรับ topbar โดยไม่ทำลายฟีเจอร์เดิม:
1) เอาปุ่มตั้งค่าการตอบกลับและไอคอนแจ้งเตือนออกจากปุ่มหลัก
2) เปลี่ยนเป็นเมนูสามจุด
3) ภายในเมนูมี:
	- ตั้งค่าการตอบกลับ
	- การแจ้งเตือน
	- การเชื่อมต่อ

หน้า "การเชื่อมต่อ":
1) ช่องกรอก Group ID
2) ช่องกรอก Bot ID
3) ช่องกรอก Bot Token
4) ปุ่มบันทึก
5) แสดงสถานะเชื่อมต่อปัจจุบัน

-----------------------------------
## 6) Concurrency + Idempotency (จุดซับซ้อนที่พลาดบ่อย)

ต้องทำครบทุกข้อ:
1) เครดิตรายการเดียวกันจาก Browser/Telegram พร้อมกัน ต้องได้ผลครั้งเดียว
2) ใช้ transaction lock หรือ compare-and-set ตาม status
3) เมื่อสถานะเป็น credited แล้ว request ซ้ำต้องตอบ duplicate/already credited
4) callback ปุ่ม Telegram ต้องตรวจ replay token/callback id กันยิงซ้ำ
5) งาน scan/credit ต้องผ่าน queue เดียวกันทุกช่องทาง (Browser + Telegram)
6) ต้องมี per-team queue isolation ป้องกันทีมหนึ่งคอขวดแล้วลากทั้งระบบ
7) worker crash/restart แล้วต้อง resume ได้โดยไม่ทำรายการซ้ำ

-----------------------------------
## 7) Security Checklist

1) ตรวจสอบ Telegram webhook secret token
2) จำกัด group id ให้ตรงทีมที่ผูกไว้เท่านั้น
3) bot token ต้องเข้ารหัสก่อนเก็บ (encryption at rest)
4) log ต้อง mask token/credential
5) ใส่ rate limit ต่อ group และต่อ user

-----------------------------------
## 8) Error Mapping และ Retry Strategy

1) scan provider ล่ม (502/timeout):
	- แจ้งสถานะเข้าใจง่าย
	- อนุญาต retry โดยผู้ใช้ส่งซ้ำได้
2) manual parse ไม่ได้:
	- แจ้งรูปแบบตัวอย่าง input ที่ถูกต้อง
3) connection หมดอายุ:
	- แจ้งให้ /menu -> เชื่อมต่อ ใหม่
4) queue backlog สูง:
	- แจ้งผู้ใช้ว่ารายการกำลังรอคิว
	- แสดงเวลารอโดยประมาณ (ถ้าคำนวณได้)
5) งานหลุดเข้า DLQ:
	- บันทึกเหตุผลละเอียด
	- มี endpoint/คำสั่งสำหรับ requeue งาน

-----------------------------------
## 9) Rollout Plan (ไม่กระทบเวอร์ชันปัจจุบัน)

### Phase 1: Dark Launch
1) deploy schema + API + UI แต่ปิด feature flag
2) ยืนยัน Browser flow เดิมผ่านครบ

### Phase 2: Internal Team
1) เปิดให้ทีมทดสอบเดียว
2) ทดสอบสลิปจริง + manual + withdraw + command

### Phase 3: Canary
1) เปิดทีละทีม
2) monitor error rate / latency / duplicate rate

### Phase 4: General Availability
1) เปิดใช้ทุกทีมที่ตั้งค่า Telegram แล้ว
2) ทีมที่ไม่ตั้งค่า Telegram ยังคงใช้ Browser แบบเดิม

-----------------------------------
## 10) Test Cases บังคับก่อนขึ้น Production

1. Browser scan ยังทำงานครบ
2. Telegram scan สำเร็จ -> credited
3. Telegram scan ไม่พบยูสเซอร์ -> pending
4. Reply manual ครั้งที่ 1 ไม่สำเร็จ, ครั้งที่ 2 สำเร็จ
5. Reply ใต้ข้อความ status ใหม่ยังชี้ transaction เดิม
6. Withdraw จาก Telegram ปุ่มเดียวจบ
7. Browser withdraw หลัง Telegram credited (และกลับกัน)
8. Duplicate slip ทั้งสองช่องทางต้องตอบตรงกัน
9. เน็ตแกว่ง/timeout แล้วไม่เกิดเครดิตซ้ำ
10. ปิด feature flag แล้วระบบกลับเป็น Browser-only ได้ทันที
11. ทดสอบยิงสลิปพร้อมกันจำนวนมาก (เช่น 50-100 รายการ) แล้วไม่มีงานตกหล่น
12. ทดสอบ worker restart กลางคิว แล้วไม่เกิดเครดิตซ้ำ
13. ทดสอบ backlog สูง แล้วยังตอบสถานะ queued ได้ถูกต้อง

-----------------------------------
## 11) Definition of Done (DoD)

ถือว่าเสร็จเมื่อ:
1) ทีมเดียวกันใช้ Telegram + Browser พร้อมกันได้จริง
2) ไม่มี regression กับ flow เดิม
3) ผ่าน test cases บังคับครบ
4) มี dashboard/metric ตรวจสุขภาพการใช้งาน Telegram
5) มี runbook rollback กรณีฉุกเฉิน

-----------------------------------
## 12) หมายเหตุสำหรับ AI/Developer

1) ห้ามแก้ flow เดิมแบบ breaking change
2) ให้เพิ่มแบบ additive + guarded by feature flag
3) ทุก endpoint ใหม่ต้องรองรับ idempotency
4) ทุก message จาก Telegram ต้อง map กลับ transaction ได้
5) โค้ดจุดที่เกี่ยวกับ credential ต้อง mask log เสมอ
6) webhook handler ต้องทำงานสั้นและปล่อยงานเข้าคิว ห้ามทำงานหนักคา request
7) logic credit/withdraw ที่เสี่ยงชนกันต้องรันหลัง queue gate เสมอ