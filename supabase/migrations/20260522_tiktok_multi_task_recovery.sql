-- TikTok multi-task publishing recovery fields.
-- Scope: test database first. Production migration is a separate release step.

ALTER TABLE public.publish_task_items
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_init_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_publish_task_items_active_recovery
  ON public.publish_task_items(status, processing_started_at, last_status_check_at)
  WHERE status IN ('processing', 'uploading');

COMMENT ON COLUMN public.publish_task_items.processing_started_at IS 'When a worker claimed the item for publishing.';
COMMENT ON COLUMN public.publish_task_items.publish_init_started_at IS 'When the worker started the TikTok publish init call.';
COMMENT ON COLUMN public.publish_task_items.last_status_check_at IS 'Last TikTok publish status check time.';
COMMENT ON COLUMN public.publish_task_items.publish_attempt_count IS 'Number of times a worker claimed this item.';
