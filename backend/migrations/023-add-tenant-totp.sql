-- 023: Google Authenticator (TOTP) support for v1 tenants
-- totp_enabled: เปิด/ปิดการยืนยัน TOTP ตอน login (0/1)
-- totp_secret: base32 secret ที่ ATslip เก็บไว้เพื่อสร้างรหัสอัตโนมัติ (เก็บครั้งแรกที่ตั้งค่า)
ALTER TABLE tenants ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN totp_secret TEXT;
