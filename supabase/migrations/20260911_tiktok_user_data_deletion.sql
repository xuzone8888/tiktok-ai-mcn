-- User-controlled deletion for ordinary TikTok publishing and Business comment data.
-- Remote publishing and comment credentials must be durably revoked before this
-- function can erase the local account rows that carry the revocation receipts.

CREATE OR REPLACE FUNCTION public.guard_tiktok_social_comment_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.platform = 'tiktok'
    AND (
      NEW.account_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.tiktok_accounts account
        WHERE account.id = NEW.account_id
          AND account.user_id = NEW.user_id
          AND account.account_type = 'normal'
          AND account.status = 'active'
      )
    )
  THEN
    RAISE EXCEPTION 'active owned TikTok account required'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_tiktok_social_comment_owner
  ON public.social_comments;
CREATE TRIGGER guard_tiktok_social_comment_owner
BEFORE INSERT OR UPDATE OF user_id, platform, account_id
ON public.social_comments
FOR EACH ROW
EXECUTE FUNCTION public.guard_tiktok_social_comment_owner();

DROP TRIGGER IF EXISTS guard_tiktok_social_comment_sync_owner
  ON public.social_comment_sync_runs;
CREATE TRIGGER guard_tiktok_social_comment_sync_owner
BEFORE INSERT OR UPDATE OF user_id, platform, account_id
ON public.social_comment_sync_runs
FOR EACH ROW
EXECUTE FUNCTION public.guard_tiktok_social_comment_owner();

DROP TRIGGER IF EXISTS guard_tiktok_social_comment_action_owner
  ON public.social_comment_action_logs;
CREATE TRIGGER guard_tiktok_social_comment_action_owner
BEFORE INSERT OR UPDATE OF user_id, platform, account_id
ON public.social_comment_action_logs
FOR EACH ROW
EXECUTE FUNCTION public.guard_tiktok_social_comment_owner();

-- Serialize every ordinary TikTok task creation with user-data deletion. The
-- deletion RPC takes FOR UPDATE on the same auth.users row. If task creation
-- wins, deletion waits and removes the committed task; if deletion wins, this
-- trigger waits, then re-checks the now-deleted account set and rejects the
-- parent insert. This prevents an in-flight request from recreating an empty
-- publish_tasks row after delete_tiktok_user_data() returns.
CREATE OR REPLACE FUNCTION public.fence_tiktok_publish_task_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM auth.users user_row
  WHERE user_row.id = NEW.user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok publish task owner not found'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tiktok_accounts account
    WHERE account.user_id = NEW.user_id
      AND account.account_type = 'normal'
      AND account.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active normal TikTok account required for task creation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fence_tiktok_publish_task_creation
  ON public.publish_tasks;
CREATE TRIGGER fence_tiktok_publish_task_creation
BEFORE INSERT
ON public.publish_tasks
FOR EACH ROW
EXECUTE FUNCTION public.fence_tiktok_publish_task_creation();

CREATE OR REPLACE FUNCTION public.delete_tiktok_user_data(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_count INTEGER := 0;
  v_group_count INTEGER := 0;
  v_task_item_count INTEGER := 0;
  v_task_count INTEGER := 0;
  v_comment_count INTEGER := 0;
  v_sync_run_count INTEGER := 0;
  v_action_log_count INTEGER := 0;
  v_auth_state_count INTEGER := 0;
  v_business_auth_state_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  -- Serialize against new account/auth-state inserts through their auth.users
  -- foreign keys, then fence task creation and credential replacement through
  -- the normal account rows for the duration of this transaction.
  PERFORM 1
  FROM auth.users user_row
  WHERE user_row.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.tiktok_accounts account
  WHERE account.user_id = p_user_id
    AND account.account_type = 'normal'
  FOR UPDATE;

  -- Never turn local deletion into an implicit credential discard. The user
  -- must first complete both independent TikTok revoke flows. Their durable
  -- fences also guarantee there is no unresolved publish or reply dispatch.
  IF EXISTS (
    SELECT 1
    FROM public.tiktok_accounts account
    WHERE account.user_id = p_user_id
      AND account.account_type = 'normal'
      AND (
        account.status IS DISTINCT FROM 'revoked'
        OR account.publishing_disconnect_completed_at IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.tiktok_account_tokens token
          WHERE token.account_id = account.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.tiktok_business_account_tokens token
          WHERE token.account_id = account.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'tiktok_authorization_must_disconnect_first'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.social_comment_action_logs
  WHERE user_id = p_user_id
    AND platform = 'tiktok';
  GET DIAGNOSTICS v_action_log_count = ROW_COUNT;

  DELETE FROM public.social_comment_sync_runs
  WHERE user_id = p_user_id
    AND platform = 'tiktok';
  GET DIAGNOSTICS v_sync_run_count = ROW_COUNT;

  DELETE FROM public.social_comments
  WHERE user_id = p_user_id
    AND platform = 'tiktok';
  GET DIAGNOSTICS v_comment_count = ROW_COUNT;

  -- Remove only items belonging to the users ordinary accounts. This preserves
  -- any independently managed TikTok Shop records even if an old deployment
  -- happened to store them in the legacy task family.
  DELETE FROM public.publish_task_items item
  USING public.tiktok_accounts account
  WHERE item.account_id = account.id
    AND account.user_id = p_user_id
    AND account.account_type = 'normal';
  GET DIAGNOSTICS v_task_item_count = ROW_COUNT;

  DELETE FROM public.publish_tasks task
  WHERE task.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.publish_task_items item
      WHERE item.task_id = task.id
    );
  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  DELETE FROM public.tiktok_business_auth_states
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_business_auth_state_count = ROW_COUNT;

  DELETE FROM public.tiktok_auth_states
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_auth_state_count = ROW_COUNT;

  PERFORM pg_catalog.set_config('app.bypass_tiktok_group_guard', 'true', true);
  PERFORM pg_catalog.set_config('app.bypass_tiktok_active_task_guard', 'true', true);

  DELETE FROM public.tiktok_accounts
  WHERE user_id = p_user_id
    AND account_type = 'normal';
  GET DIAGNOSTICS v_account_count = ROW_COUNT;

  DELETE FROM public.tiktok_account_groups
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_group_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'accounts_deleted', v_account_count,
    'groups_deleted', v_group_count,
    'task_items_deleted', v_task_item_count,
    'tasks_deleted', v_task_count,
    'comments_deleted', v_comment_count,
    'sync_runs_deleted', v_sync_run_count,
    'action_logs_deleted', v_action_log_count,
    'auth_states_deleted', v_auth_state_count,
    'business_auth_states_deleted', v_business_auth_state_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_tiktok_user_data(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_tiktok_social_comment_owner()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fence_tiktok_publish_task_creation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tiktok_user_data(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_tiktok_social_comment_owner()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fence_tiktok_publish_task_creation()
  TO service_role;

COMMENT ON FUNCTION public.delete_tiktok_user_data(UUID) IS
  'Deletes one users ordinary TikTok local data after both TikTok authorizations have been durably revoked.';

COMMENT ON FUNCTION public.guard_tiktok_social_comment_owner() IS
  'Prevents stale TikTok comment work from writing after account revocation or tenant deletion.';

COMMENT ON FUNCTION public.fence_tiktok_publish_task_creation() IS
  'Serializes ordinary TikTok task creation with user-data deletion and rejects post-deletion parent rows.';

NOTIFY pgrst, 'reload schema';
