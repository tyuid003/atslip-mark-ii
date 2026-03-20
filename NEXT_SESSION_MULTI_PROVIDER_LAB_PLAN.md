# ATslipMark-II Multi-Provider Lab Plan

อัปเดตล่าสุด: 2026-03-12

เอกสารนี้สรุปความต้องการ, ข้อสรุปทางเทคนิค, และแนวทางทำงานสำหรับ session ถัดไป โดยตั้งใจให้ใช้เป็นจุดอ้างอิงหลังจากคัดลอกโปรเจกต์นี้ไปสร้างโปรเจกต์ทดลองอีกชุด

## เป้าหมายของงาน

ผู้ใช้ต้องการปรับระบบให้รองรับหลาย slip provider เช่น EasySlip และ SlipOK โดยมีเงื่อนไขสำคัญดังนี้

1. ไม่แตะ source code ของโปรเจกต์ production เดิมในตอนนี้
2. จะคัดลอกโปรเจกต์นี้ไปสร้างโปรเจกต์ทดลองอีกชุดก่อน
3. ไม่ใช้ worker เดิมของ production
4. ต้องการเอกสารอ้างอิงให้ครบ เพื่อกลับมาทำต่อใน session ถัดไปได้โดยไม่ต้องเริ่มอธิบายใหม่
5. แนวทางที่ต้องการคือรองรับหลาย provider แบบโครงสร้างดีขึ้น ไม่ใช่แค่สลับ token

## ข้อสรุปที่ได้จากการตรวจโปรเจกต์เดิม

### 1. โปรเจกต์ปัจจุบันผูกกับ EasySlip โดยตรง

จุดผูกหลักอยู่ที่ backend scan flow:

- เรียก EasySlip endpoint ตรงใน `backend/src/services/scan.service.ts`
- ใช้ header แบบ `Authorization: Bearer <token>`
- ใช้ request แบบ `FormData` field `file`
- อ่าน response schema แบบ EasySlip โดยตรงใน `backend/src/api/scan.ts`
- tenant config ปัจจุบันเก็บแค่ `easyslip_token`

สรุปคือระบบเดิมไม่ได้ออกแบบเป็น provider-agnostic

### 2. SlipOK ใช้รูปแบบต่างจาก EasySlip

จากไฟล์ `SlipOK API Guide.md`:

- endpoint ต้องใช้ `branchId` ใน URL
- auth ใช้ header `x-authorization`
- request body และ response schema ต่างจาก EasySlip
- response มี bank code เช่น `004`, `006`
- มี error code เฉพาะ เช่น `1012`, `1013`, `1014`

ดังนั้นการย้ายจาก EasySlip ไป SlipOK เปลี่ยนแค่ token ไม่พอ

### 3. การ deploy โปรเจกต์ copy ทับ worker เดิมจะเสี่ยงมาก

จาก `backend/wrangler.toml` ของโปรเจกต์เดิม:

- worker name ปัจจุบันคือ `atslip-backend`
- route production ใช้ `*.atslip.app/api/*`
- มี D1, KV, Durable Object, และ cron job อยู่แล้ว

ถ้า deploy จากโปรเจกต์ copy โดยใช้ config เดิม จะกลายเป็น overwrite worker production ทันที

## แนวทางที่ตกลงกันสำหรับโปรเจกต์ทดลอง

ใช้แนวทางนี้เป็นหลัก:

1. คัดลอกโปรเจกต์นี้ไปเป็นโปรเจกต์ทดลองอีกชุด
2. โปรเจกต์ทดลองต้องใช้ worker คนละตัวกับ production
3. ต้องใช้ route คนละตัวกับ production
4. ยังไม่แก้ code ตอนนี้ ให้เริ่มจากเอกสารและแผนก่อน
5. ตอนเริ่มลงมือจริงใน session ถัดไป จะทำในโปรเจกต์ copy เท่านั้น

## แนวทาง resource ที่แนะนำ

### ทางเลือกที่แนะนำที่สุด

สำหรับโปรเจกต์ทดลองให้ใช้:

- worker ใหม่
- route ใหม่
- D1 ใหม่ ถ้าจะมี schema migration หรือ refactor จริง
- KV ใหม่ ถ้าต้องการแยก cache ออกจาก production
- Durable Object ใหม่
- ปิด cron ใน lab ถ้ายังไม่จำเป็น

เหตุผล:

- ปลอดภัยต่อ production มากที่สุด
- สามารถปรับ schema รองรับหลาย provider ได้โดยไม่เสี่ยงชนข้อมูลจริง
- ลดความเสี่ยง pending transaction ปนกับของจริง
- ลดความเสี่ยง auto-deposit ไปยิงระบบจริง

### ทางเลือกที่พอทำได้ชั่วคราว แต่มีความเสี่ยง

ใช้:

- worker ใหม่
- route ใหม่
- D1 เดิม
- KV เดิมหรือใหม่ก็ได้

เหมาะเฉพาะกรณี:

- ทดสอบอ่าน flow เบา ๆ
- ยังไม่ทำ migration schema
- ยังไม่เปิด auto-deposit จริง
- ยังไม่เปิด cron ใน lab

ความเสี่ยง:

- ข้อมูลทดสอบจะปนกับ production
- migration จะกระทบฐานจริงทันที
- pending transaction และ log อาจปนกับของจริง
- ถ้าทดสอบผิด flow อาจยิงเติมเครดิตจริง

## ข้อกำหนดสำหรับ session ถัดไป

เมื่อเริ่มทำงานในโปรเจกต์ copy ให้ยึดกติกานี้:

1. ห้ามแก้โปรเจกต์ต้นฉบับ production
2. ห้ามใช้ worker name เดิม `atslip-backend`
3. ห้ามใช้ route production เดิม
4. ถ้าจะเพิ่ม field ใหม่เกี่ยวกับ provider ให้ทำใน lab ก่อน
5. ถ้าจะทดสอบ scan จริง ให้ปิด auto-deposit ไว้ก่อนจนกว่าจะยืนยัน mapping ถูกต้อง
6. ถ้าจะใช้ฐานข้อมูลเดิมชั่วคราว ต้องหลีกเลี่ยง migration และหลีกเลี่ยงการทดสอบที่เขียนข้อมูลมั่วลงตารางจริง

## โครงสร้าง multi-provider ที่ควรทำใน session ถัดไป

เป้าหมายคือทำให้โค้ดเดิมเปลี่ยนน้อยที่สุด แต่รองรับ provider abstraction

### หลักการออกแบบ

1. แยก provider adapter ออกจาก business flow หลัก
2. ทำ normalization ให้ทุก provider คืนค่าเป็น internal slip shape กลางแบบเดียวกัน
3. คง logic match receiver, match sender, pending transaction, credit flow ให้ใช้ internal shape กลาง
4. อย่ากระจาย if/else provider ไปทั่วทั้ง codebase

### โครงสร้างที่แนะนำ

ตัวอย่างโครงสร้างฝั่ง backend ที่ควรไปทำต่อ:

- `backend/src/services/slip/providers/easyslip.provider.ts`
- `backend/src/services/slip/providers/slipok.provider.ts`
- `backend/src/services/slip/slip-provider.interface.ts`
- `backend/src/services/slip/slip-provider.factory.ts`
- `backend/src/services/slip/slip-normalizer.ts`

หรือถ้าต้องการแก้น้อยกว่า:

- คง `scan.service.ts` ไว้
- แยกเฉพาะส่วนเรียก provider เป็นไฟล์ย่อย
- ให้ `scan.service.ts` รับ normalized response เสมอ

### Internal shape กลางที่ควรมี

provider ทุกตัวควรถูก normalize ให้ได้ข้อมูลอย่างน้อยดังนี้:

- `provider`
- `raw`
- `transRef`
- `date`
- `amount`
- `sender.bankCode`
- `sender.bankName`
- `sender.nameTh`
- `sender.nameEn`
- `sender.accountValue`
- `receiver.bankCode`
- `receiver.bankName`
- `receiver.nameTh`
- `receiver.nameEn`
- `receiver.accountValue`
- `receiver.proxyValue`
- `ref1`
- `ref2`
- `ref3`

เหตุผล:

- flow match tenant ใช้ข้อมูลฝั่ง receiver
- flow match user ใช้ข้อมูลฝั่ง sender
- flow duplicate และ credit ใช้ `transRef`, `amount`, `date`
- provider แต่ละตัวจะต่างกันแค่ชั้น adapter และ normalizer

## แนวทาง schema สำหรับรองรับหลาย provider

ตอนเริ่มทำ lab มี 2 แนวทาง

### แนวทาง A: แก้น้อยที่สุด

เก็บ field เดิม `easyslip_token` ไว้ก่อนชั่วคราว และเพิ่ม field ใหม่สำหรับ provider อื่น

ตัวอย่าง field ที่อาจเพิ่ม:

- `slip_provider`
- `slip_api_key`
- `slip_branch_id`
- `slip_provider_config`

ข้อดี:

- transition จากระบบเดิมง่าย
- ยังรองรับ tenant ที่ใช้ EasySlip เดิมได้ทันที

ข้อเสีย:

- schema จะมี field legacy ปนอยู่

### แนวทาง B: สะอาดกว่า

แยก configuration ออกเป็นตารางใหม่ เช่น `tenant_slip_providers`

ตัวอย่างข้อมูลในตาราง:

- `id`
- `tenant_id`
- `provider`
- `is_active`
- `api_key`
- `branch_id`
- `config_json`
- `created_at`
- `updated_at`

ข้อดี:

- รองรับหลาย provider ต่อ tenant ได้จริง
- schema สะอาดกว่า
- ขยาย provider ในอนาคตง่ายกว่า

ข้อเสีย:

- เปลี่ยนโค้ดมากกว่าแบบ A

### ข้อเสนอสำหรับ session ถัดไป

เริ่มจากแนวทาง A ใน lab ก่อน เพื่อให้ระบบใช้งานได้เร็ว แล้วค่อยพิจารณาย้ายไปแนวทาง B ถ้าต้องการรองรับหลาย provider แบบเต็มรูปแบบ

## สิ่งที่ต้องทำในโปรเจกต์ copy ก่อนเริ่มเขียน feature

1. เปลี่ยน worker name ใน `backend/wrangler.toml`
2. เปลี่ยน route ให้เป็น subdomain หรือ path ของ lab
3. ตัด cron ออกหรือปิดไว้ก่อน
4. ตรวจว่าจะใช้ D1 ใหม่หรือเดิม
5. ถ้าใช้ D1 เดิม ต้องไม่ทำ migration ทันที
6. ตั้งชื่อแยกให้ชัด เช่น `atslip-backend-lab`

## ข้อควรระวังสำคัญ

### ถ้าใช้ D1 เดิม

- ห้ามรัน migration schema ใหม่ทันที
- ห้ามทดสอบ auto-deposit ด้วยข้อมูลจริงโดยไม่ล็อก tenant ให้แน่นอน
- transaction ทดสอบจะเข้าไปอยู่ในตารางจริง
- pending transaction อาจเด้งเข้า UI production ได้ถ้าใช้ฐานเดียวกัน

### ถ้าใช้ KV เดิม

- cache บัญชีธนาคารอาจปนกับ production
- การ refresh bank account จาก lab อาจเปลี่ยนค่า cache ที่ production ใช้อยู่

### ถ้าใช้ Durable Object แยก

- realtime ของ lab จะแยกจาก production ซึ่งเป็นสิ่งที่ดี

### ถ้าใช้ route ใหม่

- frontend ของ lab ควรชี้ API base ไปที่ worker lab เท่านั้น

## ขอบเขตงานของ session ถัดไป

เมื่อกลับมาใน session ถัดไป เป้าหมายรอบแรกควรเป็น:

1. ตั้งค่าโปรเจกต์ copy ให้ deploy เป็น lab ได้โดยไม่ชน production
2. วาง abstraction สำหรับ slip provider
3. ทำ SlipOK provider ตัวแรกให้ยิงได้จริง
4. normalize response SlipOK ให้เข้า flow เดิม
5. ปิด auto-deposit หรือ guard ไว้ระหว่างทดสอบ

ยังไม่ควรทำในรอบแรก:

- migration ใหญ่ที่กระทบ production ถ้ายังใช้ D1 เดิม
- refactor UI ใหญ่เกินจำเป็น
- เปลี่ยนทุกชื่อ `easyslip` ทั่วทั้งระบบในครั้งเดียว

## รายการไฟล์ที่คาดว่าจะเกี่ยวข้องใน session ถัดไป

ไฟล์ที่น่าจะต้องอ่าน/แก้ในโปรเจกต์ copy:

- `backend/wrangler.toml`
- `backend/src/services/scan.service.ts`
- `backend/src/api/scan.ts`
- `backend/src/types.ts`
- `backend/src/api/tenants.ts`
- `backend/src/services/tenant.service.ts`
- `backend/schema.sql`
- `frontend/index.html`
- `frontend/js/app.js`
- `frontend/js/api.js`

ไฟล์ใหม่ที่น่าจะต้องสร้าง:

- provider interface
- provider factory
- EasySlip provider adapter
- SlipOK provider adapter
- response normalizer
- optional migration script สำหรับ lab

## Prompt แนะนำสำหรับเปิด session ถัดไป

คัดลอกข้อความนี้ไปใช้ได้เลย:

```text
โปรเจกต์นี้เป็น copy ของ ATslipMark-II สำหรับทำ lab เท่านั้น ห้ามแตะ production logic เดิมโดยไม่จำเป็น

เป้าหมาย:
1. ทำให้ worker ตัวนี้เป็น worker ใหม่ ไม่ใช้ของ production
2. วางโครงสร้างรองรับหลาย slip provider
3. เริ่มจากให้ EasySlip เดิมยังทำงานได้ และเพิ่ม SlipOK เป็น provider ใหม่
4. แก้ให้น้อยที่สุด แต่ต้องมี provider abstraction ที่ชัดเจน
5. ระหว่างทดสอบให้ปิดหรือ guard auto-deposit ไว้ก่อน

ให้อ่านไฟล์ NEXT_SESSION_MULTI_PROVIDER_LAB_PLAN.md ก่อนเริ่มลงมือ แล้วค่อยเสนอ plan และ implement ในโปรเจกต์ copy นี้
```

## สรุปการตัดสินใจสุดท้ายของผู้ใช้ในรอบนี้

1. จะไม่ใช้ worker เดิม
2. จะคัดลอกโปรเจกต์นี้ไปสร้างโปรเจกต์ทดลองอีกชุด
3. ตอนนี้ยังไม่ต้องแก้ source code ระบบ
4. ต้องการเอกสารให้ครบสำหรับกลับมาทำต่อใน session ถัดไป

## หมายเหตุปิดท้าย

ถ้าจะเอาแนวทางที่ปลอดภัยที่สุดจริง ๆ ให้แยก worker และแยก D1 ไปพร้อมกันตั้งแต่เริ่ม lab

ถ้าจะเอาแนวทางที่เร็วที่สุด ให้แยก worker ก่อน แล้วค่อยตัดสินใจเรื่อง D1 อีกครั้งก่อนทำ migration แรก