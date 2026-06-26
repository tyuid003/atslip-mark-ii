-- 013-add-ushop-integration.sql
-- เชื่อมต่อ ATslip กับ univers_shop (ระบบรวมแชท LINE OA หลายไลน์)
-- แต่ละ tenant (เว็บ) มี connection/คีย์ของตัวเอง
--   - api_key       : shared secret ที่ univers_shop ใช้ยืนยันตัวตนตอนเรียก ATslip (inbound, tenants)
--   - ushop_base_url: base URL ของ univers_shop ที่ ATslip ใช้สั่งให้ตอบกลับลูกค้า (reply bridge)

CREATE TABLE IF NOT EXISTS ushop_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  team_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ushop_base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ushop_conn_api_key ON ushop_connections(api_key);
CREATE INDEX IF NOT EXISTS idx_ushop_conn_team ON ushop_connections(team_id);
