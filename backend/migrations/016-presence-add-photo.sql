-- Migration 016: Add photo column to user_presence
ALTER TABLE user_presence ADD COLUMN photo TEXT DEFAULT NULL;
