-- Add the ordinary TikTok Content Posting FILE_UPLOAD transfer mode.
-- This migration is additive and keeps all existing rows on PULL_FROM_URL.

ALTER TABLE public.publish_task_items
  ADD COLUMN IF NOT EXISTS tiktok_transfer_method TEXT NOT NULL DEFAULT 'PULL_FROM_URL',
  ADD COLUMN IF NOT EXISTS source_video_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS source_video_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_upload_outcome TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_upload_reported_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.publish_task_items'::regclass
      AND conname = 'publish_task_items_tiktok_transfer_method_check'
  ) THEN
    ALTER TABLE public.publish_task_items
      ADD CONSTRAINT publish_task_items_tiktok_transfer_method_check
      CHECK (tiktok_transfer_method IN ('PULL_FROM_URL', 'FILE_UPLOAD'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.publish_task_items'::regclass
      AND conname = 'publish_task_items_tiktok_upload_outcome_check'
  ) THEN
    ALTER TABLE public.publish_task_items
      ADD CONSTRAINT publish_task_items_tiktok_upload_outcome_check
      CHECK (
        (tiktok_upload_outcome IS NULL AND tiktok_upload_reported_at IS NULL)
        OR (
          tiktok_transfer_method = 'FILE_UPLOAD'
          AND tiktok_upload_outcome IN ('accepted', 'unknown', 'rejected')
          AND tiktok_upload_reported_at IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.publish_task_items'::regclass
      AND conname = 'publish_task_items_file_upload_metadata_check'
  ) THEN
    ALTER TABLE public.publish_task_items
      ADD CONSTRAINT publish_task_items_file_upload_metadata_check
      CHECK (
        tiktok_transfer_method <> 'FILE_UPLOAD'
        OR (
          source_video_size_bytes BETWEEN 1 AND 4294967296
          AND source_video_mime_type IN ('video/mp4', 'video/quicktime', 'video/webm')
          AND video_url LIKE 'file-upload://%'
        )
      );
  END IF;
END;
$$;

-- The legacy RLS policies allow authenticated users to update or delete their
-- own publishing rows directly through PostgREST. FILE_UPLOAD state must only
-- be advanced by server-side code after the row exists, otherwise a client can
-- clear a dispatch fence or delete an ambiguous attempt and create another
-- remote post. Service-role workers bypass RLS and remain able to reconcile it.
DROP POLICY IF EXISTS "FILE_UPLOAD items are server-managed"
  ON public.publish_task_items;

CREATE POLICY "FILE_UPLOAD items are server-managed"
  ON public.publish_task_items
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (tiktok_transfer_method <> 'FILE_UPLOAD')
  WITH CHECK (tiktok_transfer_method <> 'FILE_UPLOAD');

DROP POLICY IF EXISTS "Ambiguous FILE_UPLOAD items cannot be deleted"
  ON public.publish_task_items;

CREATE POLICY "Ambiguous FILE_UPLOAD items cannot be deleted"
  ON public.publish_task_items
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    status NOT IN ('processing', 'uploading')
    AND (
      error_code IS NULL
      OR error_code NOT IN (
        'TIKTOK_INIT_OUTCOME_UNKNOWN',
        'WORKER_INTERRUPTED_NEEDS_REVIEW'
      )
    )
    AND NOT (
      tiktok_transfer_method = 'FILE_UPLOAD'
      AND (tiktok_publish_id IS NOT NULL OR publish_init_started_at IS NOT NULL)
      AND NOT COALESCE(
        status = 'published'
        OR error_code = 'TIKTOK_STATUS_FAILED'
        OR (
            error_code = 'TIKTOK_FILE_UPLOAD_INCOMPLETE'
            AND tiktok_upload_outcome = 'rejected'
        ),
        FALSE
      )
    )
  );

DROP POLICY IF EXISTS "Tasks with ambiguous FILE_UPLOAD items cannot be deleted"
  ON public.publish_tasks;

CREATE POLICY "Tasks with ambiguous FILE_UPLOAD items cannot be deleted"
  ON public.publish_tasks
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    status <> 'running'
    AND NOT EXISTS (
      SELECT 1
      FROM public.publish_task_items AS item
      WHERE item.task_id = publish_tasks.id
        AND (
          item.status IN ('processing', 'uploading')
          OR item.error_code IN (
            'TIKTOK_INIT_OUTCOME_UNKNOWN',
            'WORKER_INTERRUPTED_NEEDS_REVIEW'
          )
          OR (
            item.tiktok_transfer_method = 'FILE_UPLOAD'
            AND (
              item.tiktok_publish_id IS NOT NULL
              OR item.publish_init_started_at IS NOT NULL
            )
            AND NOT COALESCE(
              item.status = 'published'
              OR item.error_code = 'TIKTOK_STATUS_FAILED'
              OR (
                  item.error_code = 'TIKTOK_FILE_UPLOAD_INCOMPLETE'
                  AND item.tiktok_upload_outcome = 'rejected'
              ),
              FALSE
            )
          )
        )
    )
  );

COMMENT ON COLUMN public.publish_task_items.tiktok_transfer_method IS
  'TikTok media transfer method. Existing URL-backed items use PULL_FROM_URL; local browser files use FILE_UPLOAD.';
COMMENT ON COLUMN public.publish_task_items.source_video_size_bytes IS
  'Original local file size used to bind a FILE_UPLOAD initialization request.';
COMMENT ON COLUMN public.publish_task_items.source_video_mime_type IS
  'Validated TikTok FILE_UPLOAD MIME type; never inferred from an upload URL.';
COMMENT ON COLUMN public.publish_task_items.tiktok_upload_outcome IS
  'Browser report for the TikTok FILE_UPLOAD transfer: accepted, unknown, or rejected.';
COMMENT ON COLUMN public.publish_task_items.tiktok_upload_reported_at IS
  'Time the browser reported its FILE_UPLOAD transfer outcome; provider status remains authoritative.';
