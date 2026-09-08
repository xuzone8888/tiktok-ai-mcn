-- Shared TikTok Accounts API read budgets and independently fenced comment
-- authorization revocation. This migration is forward-only and must be visible
-- through PostgREST before the corresponding application version is enabled.

ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS business_comment_auth_generation UUID
  NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.tiktok_business_auth_states
  ADD COLUMN IF NOT EXISTS account_generation UUID;

UPDATE public.tiktok_business_auth_states state
SET account_generation = account.business_comment_auth_generation
FROM public.tiktok_accounts account
WHERE state.account_id = account.id
  AND state.account_generation IS NULL;

ALTER TABLE public.tiktok_business_auth_states
  ALTER COLUMN account_generation SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_tiktok_business_auth_state_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_generation UUID;
  token_status TEXT;
BEGIN
  SELECT account.business_comment_auth_generation, token.status
  INTO parent_generation, token_status
  FROM public.tiktok_accounts account
  LEFT JOIN public.tiktok_business_account_tokens token
    ON token.account_id = account.id
  WHERE account.id = NEW.account_id
    AND account.user_id = NEW.user_id
    AND account.account_type = 'normal';

  IF parent_generation IS NULL THEN
    RAISE EXCEPTION 'TikTok Business authorization requires an owned normal account'
      USING ERRCODE = '23514';
  END IF;

  IF token_status = 'revocation_pending' THEN
    RAISE EXCEPTION 'TikTok Business authorization is being revoked'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.account_generation IS NULL THEN
    -- Compatibility only: legacy application instances omit this column.
    NEW.account_generation := parent_generation;
  ELSIF NEW.account_generation IS DISTINCT FROM parent_generation THEN
    -- Preserve the new application's read-time fence. Never upgrade a stale
    -- explicit generation to the current parent generation.
    RAISE EXCEPTION 'TikTok Business authorization generation changed before state creation'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tiktok_business_auth_state_generation
  ON public.tiktok_business_auth_states;
CREATE TRIGGER set_tiktok_business_auth_state_generation
  BEFORE INSERT ON public.tiktok_business_auth_states
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tiktok_business_auth_state_generation();

ALTER TABLE public.tiktok_business_account_tokens
  DROP CONSTRAINT IF EXISTS tiktok_business_account_tokens_status_check;

ALTER TABLE public.tiktok_business_account_tokens
  ADD CONSTRAINT tiktok_business_account_tokens_status_check
  CHECK (status IN ('active', 'expired', 'revoked', 'revocation_pending'));

ALTER TABLE public.tiktok_business_account_tokens
  ADD COLUMN IF NOT EXISTS revocation_token UUID,
  ADD COLUMN IF NOT EXISTS revocation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_error_code TEXT,
  ADD COLUMN IF NOT EXISTS revocation_error_message TEXT;

ALTER TABLE public.social_comment_action_logs
  DROP CONSTRAINT IF EXISTS social_comment_action_logs_action_type_check;
ALTER TABLE public.social_comment_action_logs
  ADD CONSTRAINT social_comment_action_logs_action_type_check
  CHECK (action_type IN (
    'sync',
    'reply',
    'permission_error',
    'token_error',
    'comment_auth_disconnect'
  ));

CREATE TABLE IF NOT EXISTS public.tiktok_business_api_rate_windows (
  account_id UUID NOT NULL REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL
    CHECK (endpoint IN ('comment.list', 'comment.reply.list')),
  window_started_at TIMESTAMPTZ NOT NULL,
  reserved_requests INTEGER NOT NULL CHECK (reserved_requests >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, endpoint, window_started_at)
);

ALTER TABLE public.tiktok_business_api_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tiktok_business_api_rate_windows
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tiktok_business_api_rate_windows TO service_role;

CREATE OR REPLACE FUNCTION public.claim_tiktok_business_api_budget(
  p_account_id UUID,
  p_user_id UUID,
  p_endpoint TEXT,
  p_requested_requests INTEGER,
  p_window_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket TIMESTAMPTZ := date_trunc('minute', clock_timestamp());
BEGIN
  IF p_endpoint NOT IN ('comment.list', 'comment.reply.list')
    OR p_requested_requests < 1
    OR p_requested_requests > 100
    OR p_window_limit < 1
    OR p_window_limit > 10000
    OR p_requested_requests > p_window_limit
  THEN
    RAISE EXCEPTION 'Invalid TikTok Business API budget request'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tiktok_accounts account
    JOIN public.tiktok_business_account_tokens token
      ON token.account_id = account.id
    WHERE account.id = p_account_id
      AND account.user_id = p_user_id
      AND account.account_type = 'normal'
      AND account.status = 'active'
      AND token.status = 'active'
  ) THEN
    RETURN FALSE;
  END IF;

  -- Keep one day of per-account evidence while bounding steady-state table
  -- growth. Dormant accounts retain only the finite rows created before their
  -- last request; the next request prunes those rows before reserving again.
  DELETE FROM public.tiktok_business_api_rate_windows rate_window
  WHERE rate_window.account_id = p_account_id
    AND rate_window.endpoint = p_endpoint
    AND rate_window.window_started_at < bucket - INTERVAL '1 day';

  INSERT INTO public.tiktok_business_api_rate_windows (
    account_id,
    endpoint,
    window_started_at,
    reserved_requests,
    updated_at
  )
  VALUES (
    p_account_id,
    p_endpoint,
    bucket,
    p_requested_requests,
    clock_timestamp()
  )
  ON CONFLICT (account_id, endpoint, window_started_at) DO UPDATE
  SET reserved_requests = public.tiktok_business_api_rate_windows.reserved_requests
        + EXCLUDED.reserved_requests,
      updated_at = clock_timestamp()
  WHERE public.tiktok_business_api_rate_windows.reserved_requests
        + EXCLUDED.reserved_requests <= p_window_limit;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_tiktok_business_token_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID,
  p_action_log_id UUID,
  p_lease_seconds INTEGER DEFAULT 60,
  p_manual_confirmation BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  access_token TEXT,
  business_open_id TEXT,
  previous_error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_type TEXT;
  token_row public.tiktok_business_account_tokens%ROWTYPE;
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

  SELECT token.*
  INTO token_row
  FROM public.tiktok_business_account_tokens token
  WHERE token.account_id = p_account_id
  FOR UPDATE;

  IF token_row.account_id IS NULL
    OR token_row.status NOT IN ('active', 'expired', 'revocation_pending')
    OR (
      token_row.status = 'revocation_pending'
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

  UPDATE public.tiktok_business_account_tokens token
  SET status = 'revocation_pending',
      revocation_token = p_revocation_token,
      revocation_started_at = COALESCE(token.revocation_started_at, clock_timestamp()),
      revocation_lease_expires_at = clock_timestamp()
        + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 120))),
      revocation_error_code = NULL,
      revocation_error_message = NULL,
      refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE token.account_id = p_account_id;

  UPDATE public.tiktok_accounts account
  SET business_comment_auth_generation = gen_random_uuid(),
      updated_at = clock_timestamp()
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
    AND account.account_type = 'normal';

  INSERT INTO public.social_comment_action_logs (
    id,
    user_id,
    platform,
    account_id,
    action_type,
    status,
    idempotency_key,
    metadata
  ) VALUES (
    p_action_log_id,
    p_user_id,
    'tiktok',
    p_account_id,
    'comment_auth_disconnect',
    'running',
    'comment-auth-disconnect:' || p_action_log_id::TEXT,
    jsonb_build_object(
      'phase', CASE
        WHEN p_manual_confirmation THEN 'manual_revocation_confirmation'
        ELSE 'remote_revocation'
      END,
      'manual_confirmation', p_manual_confirmation
    )
  );

  RETURN QUERY SELECT
    token_row.access_token,
    token_row.business_open_id,
    token_row.revocation_error_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tiktok_business_token_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID,
  p_action_log_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_type TEXT;
BEGIN
  SELECT account.account_type
  INTO parent_type
  FROM public.tiktok_accounts account
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
  FOR UPDATE;

  IF parent_type IS DISTINCT FROM 'normal' THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.tiktok_business_account_tokens token
  WHERE token.account_id = p_account_id
    AND token.status = 'revocation_pending'
    AND token.revocation_token = p_revocation_token;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.social_comment_action_logs action
  SET status = 'completed',
      error_code = NULL,
      error_message = NULL,
      completed_at = clock_timestamp(),
      metadata = COALESCE(action.metadata, '{}'::JSONB)
        || jsonb_build_object('phase', 'revoked')
  WHERE action.id = p_action_log_id
    AND action.user_id = p_user_id
    AND action.account_id = p_account_id
    AND action.platform = 'tiktok'
    AND action.action_type = 'comment_auth_disconnect'
    AND action.status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok Business disconnect action log changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_tiktok_business_token_revocation(
  p_account_id UUID,
  p_user_id UUID,
  p_revocation_token UUID,
  p_action_log_id UUID,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_business_account_tokens token
  SET revocation_lease_expires_at = NULL,
      revocation_error_code = LEFT(COALESCE(p_error_code, 'revocation_unknown'), 80),
      revocation_error_message = LEFT(
        COALESCE(p_error_message, 'Remote revocation outcome is unknown.'),
        240
      ),
      updated_at = clock_timestamp()
  WHERE token.account_id = p_account_id
    AND token.status = 'revocation_pending'
    AND token.revocation_token = p_revocation_token
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts account
      WHERE account.id = token.account_id
        AND account.user_id = p_user_id
        AND account.account_type = 'normal'
    );

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.social_comment_action_logs action
  SET status = 'failed',
      error_code = LEFT(COALESCE(p_error_code, 'revocation_unknown'), 80),
      error_message = LEFT(
        COALESCE(p_error_message, 'Remote revocation outcome is unknown.'),
        240
      ),
      completed_at = clock_timestamp(),
      metadata = COALESCE(action.metadata, '{}'::JSONB)
        || jsonb_build_object('phase', 'revocation_pending')
  WHERE action.id = p_action_log_id
    AND action.user_id = p_user_id
    AND action.account_id = p_account_id
    AND action.platform = 'tiktok'
    AND action.action_type = 'comment_auth_disconnect'
    AND action.status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok Business disconnect action log changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fence_tiktok_business_token_replacement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'revocation_pending' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'TikTok Business revocation must finish before reauthorization'
      USING ERRCODE = '40001';
  END IF;

  NEW.credential_generation := gen_random_uuid();
  NEW.refresh_lease_token := NULL;
  NEW.refresh_lease_expires_at := NULL;

  IF NEW.status = 'active' THEN
    NEW.revocation_token := NULL;
    NEW.revocation_started_at := NULL;
    NEW.revocation_lease_expires_at := NULL;
    NEW.revocation_error_code := NULL;
    NEW.revocation_error_message := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tiktok_business_auth_state(
  p_state TEXT,
  p_processing_token UUID,
  p_business_open_id TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_token_expires_at TIMESTAMPTZ,
  p_refresh_token_expires_at TIMESTAMPTZ,
  p_scopes JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_state_id UUID;
  target_user_id UUID;
  target_account_id UUID;
  target_account_generation UUID;
  locked_status TEXT;
  locked_processing_token UUID;
  locked_processing_expires_at TIMESTAMPTZ;
  locked_account_generation UUID;
  parent_type TEXT;
  parent_account_generation UUID;
  existing_business_open_id TEXT;
  existing_token_status TEXT;
BEGIN
  IF NULLIF(BTRIM(p_business_open_id), '') IS NULL
    OR NULLIF(BTRIM(p_access_token), '') IS NULL
    OR NULLIF(BTRIM(p_refresh_token), '') IS NULL
    OR p_access_token_expires_at <= NOW()
    OR p_refresh_token_expires_at <= NOW()
    OR jsonb_typeof(p_scopes) IS DISTINCT FROM 'array'
    OR NOT p_scopes ? 'comment.list'
    OR NOT p_scopes ? 'comment.list.manage'
  THEN
    RAISE EXCEPTION 'Invalid TikTok Business token payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT state.id, state.user_id, state.account_id, state.account_generation
  INTO target_state_id, target_user_id, target_account_id, target_account_generation
  FROM public.tiktok_business_auth_states state
  WHERE state.state = p_state;

  IF target_state_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT account.account_type, account.business_comment_auth_generation
  INTO parent_type, parent_account_generation
  FROM public.tiktok_accounts account
  WHERE account.id = target_account_id
    AND account.user_id = target_user_id
  FOR UPDATE;

  IF parent_type IS DISTINCT FROM 'normal'
    OR parent_account_generation IS DISTINCT FROM target_account_generation
  THEN
    RETURN FALSE;
  END IF;

  SELECT state.status,
         state.processing_token,
         state.processing_expires_at,
         state.account_generation
  INTO locked_status,
       locked_processing_token,
       locked_processing_expires_at,
       locked_account_generation
  FROM public.tiktok_business_auth_states state
  WHERE state.id = target_state_id
    AND state.account_id = target_account_id
  FOR UPDATE;

  IF locked_status IS DISTINCT FROM 'processing'
    OR locked_processing_token IS DISTINCT FROM p_processing_token
    OR locked_processing_expires_at IS NULL
    OR locked_processing_expires_at <= clock_timestamp()
    OR locked_account_generation IS DISTINCT FROM parent_account_generation
  THEN
    RETURN FALSE;
  END IF;

  SELECT token.business_open_id, token.status
  INTO existing_business_open_id, existing_token_status
  FROM public.tiktok_business_account_tokens token
  WHERE token.account_id = target_account_id
  FOR UPDATE;

  IF existing_token_status = 'revocation_pending' THEN
    RETURN FALSE;
  END IF;

  IF existing_business_open_id IS NOT NULL
    AND existing_business_open_id IS DISTINCT FROM p_business_open_id
  THEN
    RAISE EXCEPTION 'TikTok Business identity does not match the existing link'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.tiktok_business_account_tokens (
    account_id,
    business_open_id,
    access_token,
    refresh_token,
    access_token_expires_at,
    refresh_token_expires_at,
    scopes,
    status,
    updated_at
  ) VALUES (
    target_account_id,
    p_business_open_id,
    p_access_token,
    p_refresh_token,
    p_access_token_expires_at,
    p_refresh_token_expires_at,
    p_scopes,
    'active',
    NOW()
  )
  ON CONFLICT (account_id) DO UPDATE
  SET access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
      scopes = EXCLUDED.scopes,
      status = 'active',
      updated_at = NOW();

  UPDATE public.tiktok_business_auth_states state
  SET status = 'completed',
      processing_token = NULL,
      processing_expires_at = NULL,
      completed_at = NOW(),
      error_code = NULL,
      error_message = NULL
  WHERE state.id = target_state_id
    AND state.status = 'processing'
    AND state.processing_token = p_processing_token
    AND state.account_generation = parent_account_generation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok Business authorization fence was lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tiktok_business_api_budget(UUID, UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_tiktok_business_token_revocation(UUID, UUID, UUID, UUID, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tiktok_business_token_revocation(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_tiktok_business_token_revocation(UUID, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tiktok_business_auth_state_generation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_tiktok_business_api_budget(UUID, UUID, TEXT, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_tiktok_business_token_revocation(UUID, UUID, UUID, UUID, INTEGER, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tiktok_business_token_revocation(UUID, UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_tiktok_business_token_revocation(UUID, UUID, UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_tiktok_business_auth_state_generation()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  TO service_role;

COMMENT ON TABLE public.tiktok_business_api_rate_windows IS
  'Service-role-only shared reservations for TikTok Accounts API read calls.';
COMMENT ON COLUMN public.tiktok_business_account_tokens.status IS
  'Comment authorization lifecycle. revocation_pending blocks all token use while remote revoke is retried.';
