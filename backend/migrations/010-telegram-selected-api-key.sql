-- Migration 010: เพิ่ม selected_api_key_id ใน team_telegram_connections
-- เพื่อรองรับคำสั่ง /changeapikey ใน Telegram bot
-- ทีมสามารถเลือก API Key ที่ต้องการใช้สแกนสลิปผ่าน Telegram

ALTER TABLE team_telegram_connections
  ADD COLUMN selected_api_key_id TEXT REFERENCES team_api_keys(id) ON DELETE SET NULL;
