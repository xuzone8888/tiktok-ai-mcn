-- YouTube authorization verification, deletion, revocation retry, and retention.
-- This migration is intentionally service-role-only. User-facing API routes
-- authenticate the user and then call these helpers with the authenticated uid.

ALTER TABLE public.youtube_accounts
  ADD COLUMN IF NOT EXISTS last_authorization_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS authorization_invalidated_at TIMESTAMPTZ;

UPDATE public.youtube_accounts
SET last_authorization_verified_at = COALESCE(last_authorization_verified_at, updated_at, created_at)
WHERE last_authorization_verified_at IS NULL;

ALTER TABLE public.youtube_accounts
  ALTER COLUMN last_authorization_verified_at SET DEFAULT NOW(),
  ALTER COLUMN last_authorization_verified_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_authorization_verification
  ON public.youtube_accounts(status, last_authorization_verified_at);

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_authorization_invalidated
  ON public.youtube_accounts(authorization_invalidated_at)
  WHERE authorization_invalidated_at IS NOT NULL;

ALTER TABLE public.youtube_publish_task_items
  ADD COLUMN IF NOT EXISTS youtube_api_data_observed_at TIMESTAMPTZ;

-- Backfill with a conservative existing lifecycle anchor. Generic updated_at
-- is deliberately excluded so later business/UI updates cannot extend it.
UPDATE public.youtube_publish_task_items
SET youtube_api_data_observed_at = COALESCE(
  youtube_api_data_observed_at,
  published_at,
  processing_started_at,
  created_at
)
WHERE youtube_api_data_observed_at IS NULL
  AND (
    youtube_video_id IS NOT NULL
    OR youtube_watch_url IS NOT NULL
    OR status IN ('published', 'failed', 'cancelled')
  );

CREATE INDEX IF NOT EXISTS idx_youtube_publish_items_api_data_observed
  ON public.youtube_publish_task_items(youtube_api_data_observed_at)
  WHERE youtube_api_data_observed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.preserve_youtube_api_data_observed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- This is an immutable first-observation clock, not a client-supplied field.
  -- Ignore every ordinary INSERT value and preserve OLD on every UPDATE,
  -- including service-role business updates. A future refresh semantic must
  -- use a separate, explicitly reviewed compliance function.
  IF TG_OP = 'INSERT' THEN
    NEW.youtube_api_data_observed_at := NULL;
  ELSE
    NEW.youtube_api_data_observed_at := OLD.youtube_api_data_observed_at;
  END IF;

  IF NEW.youtube_api_data_observed_at IS NULL
     AND (
       NEW.youtube_video_id IS NOT NULL
       OR NEW.youtube_watch_url IS NOT NULL
       OR NEW.status IN ('published', 'failed', 'cancelled')
     ) THEN
    NEW.youtube_api_data_observed_at := pg_catalog.now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_youtube_api_data_observed_at
  ON public.youtube_publish_task_items;
CREATE TRIGGER preserve_youtube_api_data_observed_at
BEFORE INSERT OR UPDATE ON public.youtube_publish_task_items
FOR EACH ROW
EXECUTE FUNCTION public.preserve_youtube_api_data_observed_at();

CREATE TABLE IF NOT EXISTS public.youtube_revocation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID NOT NULL,
  refresh_token TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The worker runs hourly. A two-hour safety margin keeps actual deletion
  -- inside the public seven-calendar-day maximum even at a schedule boundary.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 days 22 hours'),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (attempts >= 0),
  CHECK (expires_at <= created_at + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_youtube_revocation_jobs_due
  ON public.youtube_revocation_jobs(next_attempt_at, expires_at);

ALTER TABLE public.youtube_revocation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_revocation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.youtube_revocation_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.mark_youtube_authorization_invalid(
  p_user_id UUID,
  p_account_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.youtube_accounts
  SET status = 'expired',
      authorization_invalidated_at = COALESCE(authorization_invalidated_at, pg_catalog.now())
  WHERE id = p_account_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'YouTube account not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_youtube_account_deletion(
  p_user_id UUID,
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_comment_count INTEGER := 0;
  v_sync_run_count INTEGER := 0;
  v_action_log_count INTEGER := 0;
  v_account_count INTEGER := 0;
  v_task_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.youtube_accounts
    WHERE id = p_account_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'YouTube account not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.youtube_revocation_jobs(user_id, account_id, refresh_token)
  SELECT p_user_id, p_account_id, token.refresh_token
  FROM public.youtube_account_tokens AS token
  WHERE token.account_id = p_account_id
  RETURNING id INTO v_job_id;

  DELETE FROM public.social_comment_action_logs
  WHERE user_id = p_user_id AND platform = 'youtube' AND account_id = p_account_id;
  GET DIAGNOSTICS v_action_log_count = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE user_id = p_user_id AND platform = 'youtube' AND account_id = p_account_id;
  GET DIAGNOSTICS v_sync_run_count = ROW_COUNT;

  DELETE FROM public.social_comments
  WHERE user_id = p_user_id AND platform = 'youtube' AND account_id = p_account_id;
  GET DIAGNOSTICS v_comment_count = ROW_COUNT;

  -- Account deletion cascades to its token and publish task items.
  DELETE FROM public.youtube_accounts
  WHERE id = p_account_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_account_count = ROW_COUNT;

  -- Account deletion cascades its task items. Remove any now-empty parent
  -- tasks so the disconnected account leaves no orphaned publishing history.
  DELETE FROM public.youtube_publish_tasks AS task
  WHERE task.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.youtube_publish_task_items AS item
      WHERE item.task_id = task.id
    );
  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'revocation_job_id', v_job_id,
    'accounts_deleted', v_account_count,
    'tasks_deleted', v_task_count,
    'comments_deleted', v_comment_count,
    'sync_runs_deleted', v_sync_run_count,
    'action_logs_deleted', v_action_log_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_youtube_user_data(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_count INTEGER := 0;
  v_account_count INTEGER := 0;
  v_task_count INTEGER := 0;
  v_comment_count INTEGER := 0;
  v_sync_run_count INTEGER := 0;
  v_action_log_count INTEGER := 0;
  v_auth_state_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.youtube_revocation_jobs(user_id, account_id, refresh_token)
  SELECT p_user_id, account.id, token.refresh_token
  FROM public.youtube_accounts AS account
  JOIN public.youtube_account_tokens AS token ON token.account_id = account.id
  WHERE account.user_id = p_user_id;
  GET DIAGNOSTICS v_job_count = ROW_COUNT;

  DELETE FROM public.social_comment_action_logs
  WHERE user_id = p_user_id AND platform = 'youtube';
  GET DIAGNOSTICS v_action_log_count = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE user_id = p_user_id AND platform = 'youtube';
  GET DIAGNOSTICS v_sync_run_count = ROW_COUNT;

  DELETE FROM public.social_comments
  WHERE user_id = p_user_id AND platform = 'youtube';
  GET DIAGNOSTICS v_comment_count = ROW_COUNT;

  DELETE FROM public.youtube_publish_tasks WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  DELETE FROM public.youtube_accounts WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_account_count = ROW_COUNT;

  DELETE FROM public.youtube_auth_states WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_auth_state_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'revocation_jobs_created', v_job_count,
    'accounts_deleted', v_account_count,
    'tasks_deleted', v_task_count,
    'comments_deleted', v_comment_count,
    'sync_runs_deleted', v_sync_run_count,
    'action_logs_deleted', v_action_log_count,
    'auth_states_deleted', v_auth_state_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_youtube_api_data(
  p_retention_days INTEGER DEFAULT 29
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_stale_account_ids UUID[] := ARRAY[]::UUID[];
  v_job_count INTEGER := 0;
  v_comment_count INTEGER := 0;
  v_sync_run_count INTEGER := 0;
  v_action_log_count INTEGER := 0;
  v_account_count INTEGER := 0;
  v_item_count INTEGER := 0;
  v_task_count INTEGER := 0;
  v_expired_job_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 29 THEN
    RAISE EXCEPTION 'retention days must be between 1 and 29'
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(days => p_retention_days);

  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[])
  INTO v_stale_account_ids
  FROM public.youtube_accounts
  WHERE last_authorization_verified_at <= v_cutoff
     OR (
       authorization_invalidated_at IS NOT NULL
       AND authorization_invalidated_at <= v_cutoff
     );

  INSERT INTO public.youtube_revocation_jobs(user_id, account_id, refresh_token)
  SELECT account.user_id, account.id, token.refresh_token
  FROM public.youtube_accounts AS account
  JOIN public.youtube_account_tokens AS token ON token.account_id = account.id
  WHERE account.id = ANY(v_stale_account_ids);
  GET DIAGNOSTICS v_job_count = ROW_COUNT;

  DELETE FROM public.social_comment_action_logs
  WHERE platform = 'youtube'
    AND (created_at <= v_cutoff OR account_id = ANY(v_stale_account_ids));
  GET DIAGNOSTICS v_action_log_count = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE platform = 'youtube'
    AND (created_at <= v_cutoff OR account_id = ANY(v_stale_account_ids));
  GET DIAGNOSTICS v_sync_run_count = ROW_COUNT;

  -- Translations cascade from deleted cached comments.
  DELETE FROM public.social_comments
  WHERE platform = 'youtube'
    AND (last_synced_at <= v_cutoff OR account_id = ANY(v_stale_account_ids));
  GET DIAGNOSTICS v_comment_count = ROW_COUNT;

  DELETE FROM public.youtube_accounts WHERE id = ANY(v_stale_account_ids);
  GET DIAGNOSTICS v_account_count = ROW_COUNT;

  -- API-returned video ids, watch URLs, statuses and errors are not retained
  -- beyond the retention window. Pending user-created work is unaffected.
  DELETE FROM public.youtube_publish_task_items
  WHERE youtube_api_data_observed_at <= v_cutoff;
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  DELETE FROM public.youtube_publish_tasks AS task
  WHERE task.updated_at <= v_cutoff
    AND task.status IN ('completed', 'partial_failed', 'failed', 'cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM public.youtube_publish_task_items AS item
      WHERE item.task_id = task.id
    );
  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  -- A revocation credential exists solely to retry Google revocation and is
  -- destroyed no later than seven days after it was queued.
  DELETE FROM public.youtube_revocation_jobs
  WHERE expires_at <= pg_catalog.now();
  GET DIAGNOSTICS v_expired_job_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'retention_days', p_retention_days,
    'cutoff', v_cutoff,
    'revocation_jobs_created', v_job_count,
    'expired_revocation_jobs_deleted', v_expired_job_count,
    'accounts_deleted', v_account_count,
    'publish_items_deleted', v_item_count,
    'tasks_deleted', v_task_count,
    'comments_deleted', v_comment_count,
    'sync_runs_deleted', v_sync_run_count,
    'action_logs_deleted', v_action_log_count
  );
END;
$$;

COMMENT ON TABLE public.youtube_revocation_jobs
  IS 'Service-role-only, seven-day maximum retry queue for Google token revocation after local deletion.';
COMMENT ON FUNCTION public.queue_youtube_account_deletion(UUID, UUID)
  IS 'Atomically queues remote revocation and deletes one user-owned YouTube binding and related local data.';
COMMENT ON FUNCTION public.delete_youtube_user_data(UUID)
  IS 'Atomically queues token revocations and deletes all locally held YouTube data for one user.';
COMMENT ON FUNCTION public.cleanup_stale_youtube_api_data(INTEGER)
  IS 'Deletes YouTube API data before 30 days and expires revocation credentials within seven days.';
COMMENT ON COLUMN public.youtube_publish_task_items.youtube_api_data_observed_at
  IS 'Stable first-observed compliance clock for YouTube API-derived publish data; ordinary user updates cannot reset it.';

REVOKE ALL ON FUNCTION public.preserve_youtube_api_data_observed_at() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_youtube_authorization_invalid(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_youtube_account_deletion(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_youtube_user_data(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_stale_youtube_api_data(INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_youtube_authorization_invalid(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_youtube_account_deletion(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_youtube_user_data(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_youtube_api_data(INTEGER) TO service_role;
