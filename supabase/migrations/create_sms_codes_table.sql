-- SMS Verification Codes Table
-- Run this SQL in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Create the sms_codes table for storing verification codes
CREATE TABLE IF NOT EXISTS sms_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone);
CREATE INDEX IF NOT EXISTS idx_sms_codes_expires ON sms_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_code ON sms_codes(phone, code);

-- Enable Row Level Security
ALTER TABLE sms_codes ENABLE ROW LEVEL SECURITY;

-- Create policy: Only service role can access this table
CREATE POLICY "Service role only" ON sms_codes
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add phone column to profiles table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'phone') THEN
    ALTER TABLE profiles ADD COLUMN phone VARCHAR(20);
  END IF;
END $$;

-- Create index on phone in profiles
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

-- Cleanup job: Delete expired codes (optional, can be run periodically)
-- DELETE FROM sms_codes WHERE expires_at < NOW() - INTERVAL '1 day';
