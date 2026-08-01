# BUG: V2 สแกนแล้วไม่ฝากอัตโนมัติ

**วันที่พบ:** 1 สิงหาคม 2569  
**Tenant ตัวอย่าง:** BETAX2 - v2  
**สถานะ:** รอแก้ไข

---

## อาการ

- สแกนสลิปแล้วรายการตกไปรอ pending (ไม่ auto-match / ไม่ auto-credit)
- ต้องให้ user ระบุยูสเซอร์เองและกดเติมเครดิตด้วยตนเอง
- เกิดเฉพาะ tenant ที่ใช้ api_version = 'v2'
- ทั้งๆ ที่ชื่อผู้โอนในระบบไม่มีซ้ำ

---

## สาเหตุหลัก — นามสกุลถูกย่อในสลิป

ธนาคาร KBANK (และหลายธนาคาร) ย่อนามสกุลในสลิปเหลือเพียงอักษรตัวแรก เช่น **"น.ส. เรณุกา ธ"**

ใน `scan.service.ts` ฟังก์ชัน `hasTruncatedSurname()` ตรวจจับสิ่งนี้:
```ts
const last = tokens[tokens.length - 1];
return last.length <= 1; // "ธ" → length = 1 → truncated = true
```

เมื่อ `hasTruncatedSurname = true`:
```ts
const slipHasFullSurname = false
const isStrongFullNameMatch = false  // ← เงื่อนไข auto-match ล้มเหลว
```

---

## สาเหตุรอง — V2 /members list ไม่คืน `accountNumber`

V2 endpoint `GET /api/proxy/v1/admin/members?search=...` คืน list ที่ไม่มี field `accountNumber` (ต้องเรียก detail endpoint เพิ่ม) ทำให้:
```ts
const accountConfirmed = acctMatches(only.user); // false เสมอ
```

---

## Flow ที่ล้มเหลว (บรรทัด ~1330-1345 ใน scan.service.ts)

```
สลิป: "น.ส. เรณุกา ธ"
  → hasTruncatedSurname("เรณุกา ธ") = true
  → slipHasFullSurname = false
  → isStrongFullNameMatch = false

V2 member search พบ 1 คน แต่ไม่มี accountNumber ใน response
  → accountConfirmed = false

เงื่อนไข:
  if (isStrongFullNameMatch || accountConfirmed) → ไม่เข้า
  → return null → รายการตกเป็น pending
```

---

## แนวทางแก้ไข (ยังไม่ได้ implement)

### วิธีที่ 1 — ผ่อนเงื่อนไข hasTruncatedSurname สำหรับ V2
เมื่อ api_version = 'v2' และพบ candidate เพียงคนเดียวที่ชื่อตรง (score ≥ minNameChars) → auto-match ได้เลยโดยไม่ต้องรอ full surname

```ts
// ถ้า v2 และมี candidate เดียว → allow match แม้นามสกุลถูกย่อ
const isV2 = String(apiVersion || 'v1') === 'v2';
const allowWeakNameForV2 = isV2 && only.bestNameScore >= minNameChars;
if (isStrongFullNameMatch || accountConfirmed || allowWeakNameForV2) {
  return only.user;
}
```

### วิธีที่ 2 — Fetch account detail จาก V2 API ก่อน match
เมื่อ `candidatesList.length === 1` และ `hasTruncatedSurname = true` → fetch `GET /api/proxy/v1/admin/members/:id` เพื่อดึง `accountNumber` มายืนยันแทน

### วิธีที่ 3 (แนะนำ) — ผสม วิธี 1 + เพิ่ม min score threshold
- ถ้า V2 + candidate เดียว + bestNameScore ≥ 6 chars → auto-match
- ถ้า bestNameScore < 6 → pending ตามเดิม (กัน false positive)

---

## ไฟล์ที่เกี่ยวข้อง

- `backend/src/services/scan.service.ts` — ฟังก์ชัน `matchSender()` บรรทัด ~1300-1380
- `backend/src/services/credit.service.ts` — ฟังก์ชัน `submitCreditV2()`

---

## ข้อควรระวัง

- อย่าลด threshold ต่ำเกินไป (< 4 chars) เพราะอาจ match ผิดคนได้
- ถ้าแก้เฉพาะ V2 ให้ส่ง apiVersion เข้าไปใน `matchSender()` ด้วย (ตอนนี้ส่งอยู่แล้ว)
- ควรทดสอบกับกรณีชื่อซ้ำด้วย (เช่น "สมชาย ก" มีในระบบ 2 คน)
