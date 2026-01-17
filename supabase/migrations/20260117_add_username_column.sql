-- Add username column to tiktok_accounts table
-- This stores the actual TikTok @handle (e.g., @fcyyvyvvh)

ALTER TABLE tiktok_accounts
ADD COLUMN IF NOT EXISTS username TEXT;

-- Add comment for clarity
COMMENT ON COLUMN tiktok_accounts.username IS 'TikTok username/@handle (e.g., fcyyvyvvh)';
