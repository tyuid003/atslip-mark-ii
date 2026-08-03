-- Migration: Add scan_enabled column to tenants
-- scan_enabled = 1 (default): รับสแกนจาก LINE webhook
-- scan_enabled = 0: ปิดรับสแกนจาก LINE webhook ทั้งหมด (override ทุก switch)
ALTER TABLE tenants ADD COLUMN scan_enabled INTEGER DEFAULT 1;
