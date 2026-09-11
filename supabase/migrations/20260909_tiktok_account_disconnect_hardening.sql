-- Durable normal-account disconnect. Publishing history and the account identity
-- are retained; only the service-role credential is removed after revocation.

ALTER TABLE public.tiktok_account_tokens
  ADD COLUMN IF NOT EXISTS revocation_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS revocation_token UUID,
  ADD COLUMN IF NOT EXISTS revocation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_error_code TEXT,
  ADD COLUMN IF NOT EXISTS revocation_error_message TEXT,
  ADD COLUMN IF NOT EXISTS revocation_manual_confirmation BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS publishing_disconnect_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publishing_disconnect_method TEXT;

ALTER TABLE public.tiktok_business_account_tokens
  ADD COLUMN IF NOT EXISTS reply_dispatch_lease_token UUID,
  ADD COLUMN IF NOT EXISTS reply_dispatch_lease_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tiktok_account_tokens_revocation_status_check'
      AND conrelid = 'public.tiktok_account_tokens'::regclass
  ) THEN
    ALTER TABLE public.tiktok_account_tokens
      ADD CONSTRAINT tiktok_account_tokens_revocation_status_check
      CHECK (revocation_status IN ('active', 'revocation_pending'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tiktok_accounts_disconnect_method_check'
      AND conrelid = 'public.tiktok_accounts'::regclass
  ) THEN
    ALTER TABLE public.tiktok_accounts
      ADD CONSTRAINT tiktok_accounts_disconnect_method_check
      CHECK (publishing_disconnect_method IN ('provider', 'manual_confirmation'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_tiktok_disconnect_receipt_on_rebind()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'revoked' AND NEW.status = 'active' THEN
    NEW.publishing_disconnect_completed_at := NULL;
    NEW.publishing_disconnect_method := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_tiktok_disconnect_receipt_on_rebind
  ON public.tiktok_accounts;
CREATE TRIGGER clear_tiktok_disconnect_receipt_on_rebind
BEFORE UPDATE OF status ON public.tiktok_accounts
FOR EACH ROW
EXECUTE FUNCTION public.clear_tiktok_disconnect_receipt_on_rebind();

-- The authenticated-table UPDATE policy predates the durable disconnect flow.
-- Keep profile/group edits compatible, but require server-side fenced paths for
-- lifecycle transitions on ordinary publishing accounts.
CREATE OR REPLACE FUNCTION public.guard_normal_tiktok_account_status_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.account_type = 'normal'
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.publishing_disconnect_completed_at IS DISTINCT FROM NEW.publishing_disconnect_completed_at
      OR OLD.publishing_disconnect_method IS DISTINCT FROM NEW.publishing_disconnect_method
    )
    AND COALESCE(auth.role(), '') = 'authenticated'
  THEN
    RAISE EXCEPTION 'normal_tiktok_account_status_is_server_managed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_normal_tiktok_account_status_write
  ON public.tiktok_accounts;
CREATE TRIGGER guard_normal_tiktok_account_status_write
BEFORE UPDATE OF status, publishing_disconnect_completed_at, publishing_disconnect_method
ON public.tiktok_accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_normal_tiktok_account_status_write();

CREATE OR REPLACE FUNCTION public.has_active_tiktok_group_task(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.publish_tasks task
    JOIN public.publish_task_items item ON item.task_id = task.id
    WHERE task.source_account_group_id = p_group_id
      AND task.user_id = p_user_id
      AND task.workflow = 'multi_task'
      AND task.status IN ('pending', 'scheduled', 'running', 'partial_failed')
      AND item.status IN ('pending', 'scheduled', 'processing', 'uploading')
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_tiktok_account_group_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_user_id UUID;
  v_group_count INTEGER;
  v_bypass BOOLEAN;
  v_active_task_bypass BOOLEAN;
  v_guard_group_id UUID;
BEGIN
  v_bypass := COALESCE(current_setting('app.bypass_tiktok_group_guard', true), 'false') = 'true';
  v_active_task_bypass := COALESCE(
    current_setting('app.bypass_tiktok_active_task_guard', true),
    'false'
  ) = 'true';

  IF TG_OP = 'UPDATE' THEN
    v_guard_group_id := COALESCE(OLD.group_id, NEW.group_id);
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.group_id IS DISTINCT FROM NEW.group_id
    AND v_guard_group_id IS NOT NULL
    AND NOT v_active_task_bypass
    AND public.has_active_tiktok_group_task(v_guard_group_id, OLD.user_id)
  THEN
    RAISE EXCEPTION 'ACTIVE_GROUP_TASK'
      USING ERRCODE = '55000';
  END IF;

  IF v_bypass THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.group_id IS NOT DISTINCT FROM NEW.group_id
    AND OLD.account_type IS NOT DISTINCT FROM NEW.account_type THEN
    RETURN NEW;
  END IF;

  IF NEW.group_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_group_count
      FROM public.tiktok_accounts
      WHERE group_id = OLD.group_id AND id <> OLD.id;
      IF v_group_count = 0 THEN
        RAISE EXCEPTION 'LAST_ACCOUNT_IN_GROUP';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.account_type <> 'normal' THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_AVAILABLE';
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.group_id IS NOT NULL
    AND OLD.group_id IS DISTINCT FROM NEW.group_id THEN
    RAISE EXCEPTION 'CROSS_GROUP_MOVE_NOT_SUPPORTED';
  END IF;

  SELECT user_id INTO v_group_user_id
  FROM public.tiktok_account_groups
  WHERE id = NEW.group_id;
  IF v_group_user_id IS NULL OR v_group_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  SELECT COUNT(*) INTO v_group_count
  FROM public.tiktok_accounts
  WHERE group_id = NEW.group_id AND id <> NEW.id;
  IF v_group_count >= 20 THEN
    RAISE EXCEPTION 'GROUP_FULL';
  END IF;
  RETURN NEW;
END;
$$;

-- Serialize task-item creation/account rebinding with publishing disconnect.
-- The KEY SHARE lock conflicts with the parent-row FOR UPDATE taken by
-- begin_tiktok_account_revocation: whichever transaction wins makes the other
-- re-check the committed account status before it can proceed.
CREATE OR REPLACE FUNCTION public.validate_publish_task_item_account_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_owner UUID;
  account_owner UUID;
  account_kind TEXT;
  account_status TEXT;
BEGIN
  SELECT user_id INTO task_owner
  FROM public.publish_tasks
  WHERE id = NEW.task_id;

  SELECT user_id, account_type, status
  INTO account_owner, account_kind, account_status
  FROM public.tiktok_accounts
  WHERE id = NEW.account_id
  FOR KEY SHARE;

  IF task_owner IS NULL
     OR account_owner IS NULL
     OR task_owner <> account_owner
     OR account_kind IS DISTINCT FROM 'normal'
     OR account_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'publish task item account must be an active normal TikTok account owned by the task owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_publish_task_item_account_owner
  ON public.publish_task_items;
CREATE TRIGGER validate_publish_task_item_account_owner
BEFORE INSERT OR UPDATE OF task_id, account_id, status
ON public.publish_task_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_publish_task_item_account_owner();

CREATE OR REPLACE FUNCTION public.fence_tiktok_account_token_replacement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.revocation_status = 'revocation_pending'
    AND (
      NEW.access_token IS DISTINCT FROM OLD.access_token
      OR NEW.refresh_token IS DISTINCT FROM OLD.refresh_token
    )
  THEN
    RAISE EXCEPTION 'TikTok account revocation must finish before reauthorization'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fence_tiktok_account_token_replacement
  ON public.tiktok_account_tokens;
CREATE TRIGGER fence_tiktok_account_token_replacement
BEFORE UPDATE OF access_token, refresh_token
ON public.tiktok_account_tokens
FOR EACH ROW
EXECUTE FUNCTION public.fence_tiktok_account_token_replacement();

CREATE OR REPLACE FUNCTION public.begin_tiktok_account_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID,
  p_lease_seconds INTEGER DEFAULT 60,
  p_manual_confirmation BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  access_token TEXT,
  previous_error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_type TEXT;
  token_row public.tiktok_account_tokens%ROWTYPE;
BEGIN
  SELECT account.account_type
  INTO parent_type
  FROM public.tiktok_accounts account
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
  FOR UPDATE;

  IF parent_type IS DISTINCT FROM 'normal' THEN
    RETURN;
  END IF;

  -- Business authorization has its own remote credential and durable revoke
  -- flow. Never erase it as a side effect of publishing disconnect.
  IF EXISTS (
    SELECT 1
    FROM public.tiktok_business_account_tokens business_token
    WHERE business_token.account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'business_authorization_present'
      USING ERRCODE = 'P0001';
  END IF;

  -- Do not revoke a credential while a local task can still initiate, upload,
  -- or reconcile a remote post. The parent row lock plus the KEY SHARE lock in
  -- validate_publish_task_item_account_owner also closes the concurrent task
  -- creation window.
  IF EXISTS (
    SELECT 1
    FROM public.publish_task_items item
    JOIN public.publish_tasks task ON task.id = item.task_id
    WHERE item.account_id = p_account_id
      AND task.user_id = p_user_id
      AND (
        item.status IN ('pending', 'scheduled', 'processing', 'uploading')
        OR item.error_code IN (
          'TIKTOK_INIT_OUTCOME_UNKNOWN',
          'WORKER_INTERRUPTED_NEEDS_REVIEW'
        )
      )
  ) THEN
    RAISE EXCEPTION 'active_publish_task'
      USING ERRCODE = '55000';
  END IF;

  SELECT token.*
  INTO token_row
  FROM public.tiktok_account_tokens token
  WHERE token.account_id = p_account_id
  FOR UPDATE;

  IF token_row.account_id IS NULL
    OR (
      token_row.revocation_status = 'revocation_pending'
      AND token_row.revocation_lease_expires_at IS NOT NULL
      AND token_row.revocation_lease_expires_at > clock_timestamp()
    )
  THEN
    RETURN;
  END IF;

  IF p_manual_confirmation
    AND token_row.revocation_error_code NOT IN (
      'provider_revocation_unknown',
      'provider_revocation_rejected'
    )
  THEN
    RETURN;
  END IF;

  UPDATE public.tiktok_account_tokens token
  SET revocation_status = 'revocation_pending',
      revocation_token = p_revocation_token,
      revocation_started_at = COALESCE(token.revocation_started_at, clock_timestamp()),
      revocation_lease_expires_at = clock_timestamp()
        + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 120))),
      revocation_error_code = NULL,
      revocation_error_message = NULL,
      revocation_manual_confirmation = p_manual_confirmation,
      refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL,
      managed_writes_only = TRUE,
      updated_at = clock_timestamp()
  WHERE token.account_id = p_account_id;

  -- This is the local dispatch fence. It happens before the remote write and
  -- prevents publishers, refreshers, and Business callbacks from reviving a
  -- credential whose revoke outcome may become ambiguous.
  PERFORM set_config('app.bypass_tiktok_group_guard', 'true', true);
  PERFORM set_config('app.bypass_tiktok_active_task_guard', 'true', true);

  UPDATE public.tiktok_accounts account
  SET status = 'revoked',
      group_id = NULL,
      business_comment_auth_generation = gen_random_uuid(),
      updated_at = clock_timestamp()
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
    AND account.account_type = 'normal';

  RETURN QUERY SELECT token_row.access_token, token_row.revocation_error_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tiktok_account_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was_manually_confirmed BOOLEAN;
BEGIN
  PERFORM 1
  FROM public.tiktok_accounts account
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
    AND account.account_type = 'normal'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.tiktok_account_tokens token
  WHERE token.account_id = p_account_id
    AND token.revocation_status = 'revocation_pending'
    AND token.revocation_token = p_revocation_token
  RETURNING token.revocation_manual_confirmation INTO was_manually_confirmed;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tiktok_accounts account
  SET status = 'revoked',
      group_id = NULL,
      publishing_disconnect_completed_at = clock_timestamp(),
      publishing_disconnect_method = CASE
        WHEN was_manually_confirmed THEN 'manual_confirmation'
        ELSE 'provider'
      END,
      updated_at = clock_timestamp()
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
    AND account.account_type = 'normal';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_tiktok_account_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_account_tokens token
  SET revocation_lease_expires_at = NULL,
      revocation_error_code = LEFT(COALESCE(p_error_code, 'revocation_unknown'), 80),
      revocation_error_message = LEFT(
        COALESCE(p_error_message, 'Remote revocation outcome is unknown.'),
        240
      ),
      updated_at = clock_timestamp()
  WHERE token.account_id = p_account_id
    AND token.revocation_status = 'revocation_pending'
    AND token.revocation_token = p_revocation_token
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts account
      WHERE account.id = token.account_id
        AND account.user_id = p_user_id
        AND account.account_type = 'normal'
        AND account.status = 'revoked'
    );
  RETURN FOUND;
END;
$$;

-- Refresh and disconnect use the same parent -> token lock order. Requiring an
-- active parent and active revocation state closes stale refresh commits.
CREATE OR REPLACE FUNCTION public.claim_tiktok_token_refresh(
  p_account_id UUID,
  p_expected_refresh_token TEXT,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE public.tiktok_account_tokens AS token_row
  SET refresh_lease_token = p_lease_token,
      refresh_lease_expires_at = NOW()
        + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 120)),
      managed_writes_only = TRUE
  FROM public.tiktok_accounts AS account_row
  WHERE token_row.account_id = p_account_id
    AND account_row.id = token_row.account_id
    AND account_row.account_type = 'normal'
    AND account_row.status = 'active'
    AND token_row.revocation_status = 'active'
    AND token_row.refresh_token = p_expected_refresh_token
    AND (
      token_row.refresh_lease_token IS NULL
      OR token_row.refresh_lease_expires_at IS NULL
      OR token_row.refresh_lease_expires_at <= NOW()
    );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_tiktok_token_refresh(
  p_account_id UUID,
  p_expected_refresh_token TEXT,
  p_lease_token UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_token_expires_at TIMESTAMPTZ,
  p_refresh_token_expires_at TIMESTAMPTZ,
  p_updated_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER;
  current_parent_refresh_token TEXT;
  current_refresh_token TEXT;
  current_lease_token UUID;
  current_revocation_status TEXT;
BEGIN
  SELECT refresh_token
  INTO current_parent_refresh_token
  FROM public.tiktok_accounts
  WHERE id = p_account_id
    AND account_type = 'normal'
    AND status = 'active'
  FOR UPDATE;
  IF current_parent_refresh_token IS DISTINCT FROM p_expected_refresh_token THEN
    RETURN FALSE;
  END IF;

  SELECT refresh_token, refresh_lease_token, revocation_status
  INTO current_refresh_token, current_lease_token, current_revocation_status
  FROM public.tiktok_account_tokens
  WHERE account_id = p_account_id
  FOR UPDATE;
  IF current_refresh_token IS DISTINCT FROM p_expected_refresh_token
    OR current_lease_token IS DISTINCT FROM p_lease_token
    OR current_revocation_status IS DISTINCT FROM 'active'
  THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tiktok_accounts AS account_row
  SET access_token = p_access_token,
      refresh_token = p_refresh_token,
      access_token_expires_at = p_access_token_expires_at,
      token_expires_at = p_refresh_token_expires_at,
      refresh_token_expires_at = p_refresh_token_expires_at,
      token_write_fence = p_lease_token,
      updated_at = p_updated_at
  WHERE account_row.id = p_account_id
    AND account_row.account_type = 'normal'
    AND account_row.status = 'active'
    AND account_row.refresh_token = p_expected_refresh_token;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

-- Protect rolling old application instances from invoking the former hard
-- delete path. Auth-user cascade deletion remains allowed for data erasure.
CREATE OR REPLACE FUNCTION public.guard_normal_tiktok_account_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.account_type = 'normal'
    AND EXISTS (SELECT 1 FROM auth.users user_row WHERE user_row.id = OLD.user_id)
    AND (
      EXISTS (SELECT 1 FROM public.tiktok_account_tokens token WHERE token.account_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.tiktok_business_account_tokens token WHERE token.account_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.publish_task_items item WHERE item.account_id = OLD.id)
    )
  THEN
    RAISE EXCEPTION 'normal_tiktok_account_requires_durable_revocation'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_normal_tiktok_account_hard_delete
  ON public.tiktok_accounts;
CREATE TRIGGER guard_normal_tiktok_account_hard_delete
BEFORE DELETE ON public.tiktok_accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_normal_tiktok_account_hard_delete();

REVOKE ALL ON FUNCTION public.fence_tiktok_account_token_replacement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_tiktok_disconnect_receipt_on_rebind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_normal_tiktok_account_status_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_active_tiktok_group_task(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_tiktok_account_revocation(UUID, UUID, UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tiktok_account_revocation(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_tiktok_account_revocation(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_normal_tiktok_account_hard_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_publish_task_item_account_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fence_tiktok_account_token_replacement() TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_tiktok_disconnect_receipt_on_rebind() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_normal_tiktok_account_status_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_active_tiktok_group_task(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_tiktok_account_revocation(UUID, UUID, UUID, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tiktok_account_revocation(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_tiktok_account_revocation(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_normal_tiktok_account_hard_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_publish_task_item_account_owner() TO service_role;

COMMENT ON COLUMN public.tiktok_account_tokens.revocation_status IS
  'Durable normal-account disconnect state. revocation_pending forbids token replacement and blind provider retry.';

-- A TikTok reply-create request cannot carry an idempotency key to the
-- provider. Do not revoke its Business token while a locally durable reply is
-- unresolved: the old request may already be between token read and provider
-- dispatch. The reply must first be completed or reconciled by a comment sync.
CREATE OR REPLACE FUNCTION public.guard_tiktok_business_revocation_during_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'revocation_pending'
    AND NEW.status = 'revocation_pending'
    AND (
      OLD.reply_dispatch_lease_expires_at > clock_timestamp()
      OR EXISTS (
        SELECT 1
        FROM public.social_comment_action_logs action
        WHERE action.user_id = (
          SELECT account.user_id
          FROM public.tiktok_accounts account
          WHERE account.id = NEW.account_id
            AND account.account_type = 'normal'
        )
          AND action.platform = 'tiktok'
          AND action.account_id = NEW.account_id
          AND action.action_type = 'reply'
          AND action.status IN ('running', 'sent', 'unknown')
      )
    )
  THEN
    RAISE EXCEPTION 'comment_reply_in_progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_tiktok_business_revocation_during_reply
  ON public.tiktok_business_account_tokens;
CREATE TRIGGER guard_tiktok_business_revocation_during_reply
BEFORE UPDATE OF status ON public.tiktok_business_account_tokens
FOR EACH ROW
EXECUTE FUNCTION public.guard_tiktok_business_revocation_during_reply();

REVOKE ALL ON FUNCTION public.guard_tiktok_business_revocation_during_reply()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_tiktok_business_revocation_during_reply()
  TO service_role;

-- Serialize the irreversible provider dispatch against Business-token
-- revocation on the token row. If revocation wins, this returns FALSE and the
-- application must not call TikTok. If dispatch wins, revocation observes the
-- lease above and fails closed until the action reaches a terminal state.
CREATE OR REPLACE FUNCTION public.mark_tiktok_reply_dispatch_started(
  p_user_id UUID,
  p_action_log_id UUID,
  p_reply_attempt_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  marked BOOLEAN := FALSE;
BEGIN
  UPDATE public.tiktok_business_account_tokens token
  SET reply_dispatch_lease_token = p_reply_attempt_token,
      reply_dispatch_lease_expires_at = clock_timestamp() + INTERVAL '60 seconds',
      updated_at = clock_timestamp()
  WHERE token.account_id = (
      SELECT action.account_id
      FROM public.social_comment_action_logs action
      WHERE action.id = p_action_log_id
        AND action.user_id = p_user_id
        AND action.platform = 'tiktok'
        AND action.action_type = 'reply'
        AND action.status = 'running'
        AND action.metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
    )
    AND token.status = 'active'
    AND (
      token.reply_dispatch_lease_expires_at IS NULL
      OR token.reply_dispatch_lease_expires_at <= clock_timestamp()
      OR token.reply_dispatch_lease_token = p_reply_attempt_token
    )
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts account
      WHERE account.id = token.account_id
        AND account.user_id = p_user_id
        AND account.account_type = 'normal'
        AND account.status = 'active'
    );

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.social_comment_action_logs
  SET metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('provider_dispatch_started_at', clock_timestamp())
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND platform = 'tiktok'
    AND action_type = 'reply'
    AND status = 'running'
    AND metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
    AND NULLIF(btrim(COALESCE(metadata->>'provider_dispatch_started_at', '')), '') IS NULL
  RETURNING TRUE INTO marked;

  IF NOT COALESCE(marked, FALSE) THEN
    UPDATE public.tiktok_business_account_tokens token
    SET reply_dispatch_lease_token = NULL,
        reply_dispatch_lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE token.reply_dispatch_lease_token = p_reply_attempt_token;
  END IF;

  RETURN COALESCE(marked, FALSE);
END;
$$;

-- Release only the matching attempt's lease. Unresolved sent/unknown actions
-- continue to block revocation via the durable action-log predicate above.
CREATE OR REPLACE FUNCTION public.clear_tiktok_business_reply_dispatch_lease()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.platform = 'tiktok'
    AND OLD.action_type = 'reply'
    AND OLD.status = 'running'
    AND NEW.status <> 'running'
    AND NULLIF(btrim(COALESCE(OLD.metadata->>'reply_attempt_token', '')), '') IS NOT NULL
  THEN
    UPDATE public.tiktok_business_account_tokens token
    SET reply_dispatch_lease_token = NULL,
        reply_dispatch_lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE token.account_id = OLD.account_id
      AND token.reply_dispatch_lease_token::TEXT = OLD.metadata->>'reply_attempt_token';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_tiktok_business_reply_dispatch_lease
  ON public.social_comment_action_logs;
CREATE TRIGGER clear_tiktok_business_reply_dispatch_lease
AFTER UPDATE OF status ON public.social_comment_action_logs
FOR EACH ROW
EXECUTE FUNCTION public.clear_tiktok_business_reply_dispatch_lease();

REVOKE ALL ON FUNCTION public.mark_tiktok_reply_dispatch_started(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_tiktok_business_reply_dispatch_lease()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_tiktok_reply_dispatch_started(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_tiktok_business_reply_dispatch_lease()
  TO service_role;
