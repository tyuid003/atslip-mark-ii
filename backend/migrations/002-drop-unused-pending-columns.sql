-- Drop unused columns from pending_transactions table
-- matched_member_code and matched_user_bank_account are not used in the codebase

ALTER TABLE pending_transactions DROP COLUMN matched_member_code;
ALTER TABLE pending_transactions DROP COLUMN matched_user_bank_account;
