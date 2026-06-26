-- Migration 014: Add scanned_by columns to pending_transactions
-- Tracks who submitted the slip: a Telegram user (manual), auto-system, or telegram-bot

ALTER TABLE pending_transactions ADD COLUMN scanned_by_id   TEXT    DEFAULT NULL;
ALTER TABLE pending_transactions ADD COLUMN scanned_by_name TEXT    DEFAULT NULL;
ALTER TABLE pending_transactions ADD COLUMN scanned_by_photo TEXT   DEFAULT NULL;
-- source values: 'manual' (Telegram login user), 'auto' (queue/bot), 'telegram' (telegram webhook), 'webhook'/'line'/'upload'
-- We reuse the existing `source` column for the type — scanned_by_* holds display data only
