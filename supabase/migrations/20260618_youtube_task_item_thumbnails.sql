ALTER TABLE public.youtube_publish_task_items
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

COMMENT ON COLUMN public.youtube_publish_task_items.thumbnail_url IS 'Stable task item preview thumbnail captured from the selected source video.';
