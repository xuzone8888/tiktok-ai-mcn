-- Facebook App Review compliance primitives:
-- 1. retain the Facebook user id that granted each Page authorization so Meta
--    deauthorization/data-deletion callbacks can resolve the correct local data;
-- 2. keep an opaque confirmation-code audit record for public deletion status;
-- 3. expose service-role-only transactional deletion functions.

ALTER TABLE public.facebook_accounts
  ADD COLUMN IF NOT EXISTS authorized_by_facebook_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_facebook_accounts_authorizing_user
  ON public.facebook_accounts(authorized_by_facebook_user_id)
  WHERE authorized_by_facebook_user_id IS NOT NULL;

COMMENT ON COLUMN public.facebook_accounts.authorized_by_facebook_user_id IS
  'Facebook user id that granted the Page authorization; used only for Meta deauthorization and deletion callbacks.';

CREATE TABLE IF NOT EXISTS public.facebook_data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_facebook_data_deletion_requests_requested
  ON public.facebook_data_deletion_requests(requested_at DESC);

ALTER TABLE public.facebook_data_deletion_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.facebook_data_deletion_requests IS
  'Opaque status records for Meta user-data deletion callbacks. Facebook user ids and hashes are not stored here.';

CREATE OR REPLACE FUNCTION public.delete_facebook_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accounts INTEGER := 0;
  v_tasks INTEGER := 0;
  v_comments INTEGER := 0;
  v_sync_runs INTEGER := 0;
  v_action_logs INTEGER := 0;
  v_auth_states INTEGER := 0;
BEGIN
  DELETE FROM public.social_comments
  WHERE user_id = p_user_id AND platform = 'facebook';
  GET DIAGNOSTICS v_comments = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE user_id = p_user_id AND platform = 'facebook';
  GET DIAGNOSTICS v_sync_runs = ROW_COUNT;

  DELETE FROM public.social_comment_action_logs
  WHERE user_id = p_user_id AND platform = 'facebook';
  GET DIAGNOSTICS v_action_logs = ROW_COUNT;

  DELETE FROM public.facebook_publish_tasks
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  DELETE FROM public.facebook_accounts
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_accounts = ROW_COUNT;

  DELETE FROM public.facebook_auth_states
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_auth_states = ROW_COUNT;

  RETURN jsonb_build_object(
    'accounts_deleted', v_accounts,
    'tasks_deleted', v_tasks,
    'comments_deleted', v_comments,
    'sync_runs_deleted', v_sync_runs,
    'action_logs_deleted', v_action_logs,
    'auth_states_deleted', v_auth_states
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_facebook_authorization_data(
  p_facebook_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_ids UUID[];
  v_task_ids UUID[];
  v_accounts INTEGER := 0;
  v_tasks INTEGER := 0;
  v_comments INTEGER := 0;
  v_sync_runs INTEGER := 0;
  v_action_logs INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_account_ids
  FROM public.facebook_accounts
  WHERE authorized_by_facebook_user_id = p_facebook_user_id;

  SELECT COALESCE(array_agg(DISTINCT task_id), ARRAY[]::UUID[])
  INTO v_task_ids
  FROM public.facebook_publish_task_items
  WHERE account_id = ANY(v_account_ids);

  DELETE FROM public.social_comments
  WHERE platform = 'facebook' AND account_id = ANY(v_account_ids);
  GET DIAGNOSTICS v_comments = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE platform = 'facebook' AND account_id = ANY(v_account_ids);
  GET DIAGNOSTICS v_sync_runs = ROW_COUNT;

  DELETE FROM public.social_comment_action_logs
  WHERE platform = 'facebook' AND account_id = ANY(v_account_ids);
  GET DIAGNOSTICS v_action_logs = ROW_COUNT;

  DELETE FROM public.facebook_accounts
  WHERE id = ANY(v_account_ids);
  GET DIAGNOSTICS v_accounts = ROW_COUNT;

  DELETE FROM public.facebook_publish_tasks task
  WHERE task.id = ANY(v_task_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.facebook_publish_task_items item
      WHERE item.task_id = task.id
    );
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  RETURN jsonb_build_object(
    'accounts_deleted', v_accounts,
    'tasks_deleted', v_tasks,
    'comments_deleted', v_comments,
    'sync_runs_deleted', v_sync_runs,
    'action_logs_deleted', v_action_logs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_facebook_user_data(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_facebook_authorization_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_facebook_user_data(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_facebook_authorization_data(TEXT) TO service_role;
