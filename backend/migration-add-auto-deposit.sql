-- Migration: เพิ่มคอลัมน์ auto_deposit_enabled ในตาราง tenants
-- รันคำสั่งนี้: npx wrangler d1 execute atslip-db --remote --file=migration-add-auto-deposit.sql

-- เพิ่มคอลัมน์ auto_deposit_enabled (default = 0 หมายถึงปิด)
ALTER TABLE tenants ADD COLUMN auto_deposit_enabled INTEGER DEFAULT 0;
