-- Add the image resolution column used by /api/generate/image.
-- Safe to run repeatedly on production.

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS resolution TEXT;

NOTIFY pgrst, 'reload schema';
