-- Compatibility repair for projects where youtube_revocation_jobs existed
-- before claim fencing was added to the table definition. CREATE TABLE IF NOT
-- EXISTS does not add new columns to an existing table.

ALTER TABLE public.youtube_revocation_jobs
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
