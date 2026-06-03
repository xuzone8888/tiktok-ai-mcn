-- Add compatibility columns required by the unified video model pipeline.
-- This migration is additive and keeps older generation history columns intact.

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS task_id TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS generation_type TEXT DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'quick_gen',
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS duration TEXT,
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT,
  ADD COLUMN IF NOT EXISTS quality TEXT,
  ADD COLUMN IF NOT EXISTS source_image_url TEXT,
  ADD COLUMN IF NOT EXISTS result_url TEXT,
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS output_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_cost INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_refunded INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS use_pro BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_generations_task_id
  ON public.generations(task_id);

CREATE INDEX IF NOT EXISTS idx_generations_group_name
  ON public.generations(user_id, group_name);

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
