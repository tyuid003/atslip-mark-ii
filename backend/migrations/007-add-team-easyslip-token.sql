-- Migration 007: เพิ่ม easyslip_token ระดับ team
-- ใช้เป็น key กลางสำหรับ Upload / Telegram flow (ที่ยังไม่รู้ว่าเป็นเว็บไหน)
-- ถ้าไม่ได้ตั้ง (NULL) จะ fallback ไปใช้ key ของเว็บแรกในทีมตามเดิม

ALTER TABLE teams ADD COLUMN easyslip_token TEXT;
