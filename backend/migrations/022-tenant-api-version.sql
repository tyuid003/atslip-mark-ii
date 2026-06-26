-- Migration 022: Add api_version column to tenants table
-- รองรับ Admin Backend v1 (เก่า) และ v2 (ใหม่) ที่มี endpoint path ต่างกัน

ALTER TABLE tenants ADD COLUMN api_version TEXT NOT NULL DEFAULT 'v1' CHECK(api_version IN ('v1', 'v2'));
