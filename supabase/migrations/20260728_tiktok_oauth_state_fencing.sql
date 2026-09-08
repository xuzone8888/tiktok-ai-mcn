-- Fence ordinary TikTok Login Kit Web and QR callbacks before any provider
-- token exchange. Deploy after 20260727 and wait for PostgREST schema-cache
-- visibility before deploying the application that calls these RPCs.

ALTER TABLE public.tiktok_auth_states
  ADD COLUMN IF NOT EXISTS processing_token UUID,
  ADD COLUMN IF NOT EXISTS processing_expires_at TIMESTAMPTZ;

ALTER TABLE public.tiktok_auth_states
  DROP CONSTRAINT IF EXISTS tiktok_auth_states_status_check,
  ADD CONSTRAINT tiktok_auth_states_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'));

DROP INDEX IF EXISTS public.idx_tiktok_auth_states_pending_expiry;
CREATE INDEX idx_tiktok_auth_states_pending_expiry
  ON public.tiktok_auth_states(status, expires_at)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.claim_tiktok_auth_state(
  p_state TEXT,
  p_flow_type TEXT,
  p_user_id UUID,
  p_processing_token UUID,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  user_id UUID,
  code_verifier TEXT,
  client_ticket TEXT,
  qr_token TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_flow_type NOT IN ('web', 'qr')
    OR p_processing_token IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 120
  THEN
    RAISE EXCEPTION 'Invalid TikTok authorization claim'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.tiktok_auth_states s
  SET status = 'processing',
      processing_token = p_processing_token,
      processing_expires_at = clock_timestamp()
        + make_interval(secs => p_lease_seconds),
      error_code = NULL,
      error_message = NULL
  WHERE s.state = p_state
    AND s.flow_type = p_flow_type
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND s.status = 'pending'
    AND s.expires_at > clock_timestamp()
  RETURNING s.user_id, s.code_verifier, s.client_ticket, s.qr_token, s.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tiktok_auth_state(
  p_state TEXT,
  p_flow_type TEXT,
  p_user_id UUID,
  p_processing_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_auth_states s
  SET status = 'completed',
      processing_token = NULL,
      processing_expires_at = NULL,
      code_verifier = NULL,
      client_ticket = NULL,
      qr_token = NULL,
      completed_at = clock_timestamp(),
      error_code = NULL,
      error_message = NULL
  WHERE s.state = p_state
    AND s.flow_type = p_flow_type
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND s.status = 'processing'
    AND s.processing_token = p_processing_token
    AND s.processing_expires_at > clock_timestamp();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tiktok_auth_state(
  p_state TEXT,
  p_flow_type TEXT,
  p_user_id UUID,
  p_processing_token UUID,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_auth_states s
  SET status = 'failed',
      processing_token = NULL,
      processing_expires_at = NULL,
      code_verifier = NULL,
      client_ticket = NULL,
      qr_token = NULL,
      completed_at = clock_timestamp(),
      error_code = LEFT(COALESCE(NULLIF(BTRIM(p_error_code), ''), 'callback_failed'), 80),
      error_message = LEFT(COALESCE(NULLIF(BTRIM(p_error_message), ''), 'Authorization failed'), 240)
  WHERE s.state = p_state
    AND s.flow_type = p_flow_type
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND s.status = 'processing'
    AND s.processing_token = p_processing_token
    AND s.processing_expires_at > clock_timestamp();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_tiktok_auth_state(
  p_state TEXT,
  p_flow_type TEXT,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_auth_states s
  SET status = 'expired',
      processing_token = NULL,
      processing_expires_at = NULL,
      code_verifier = NULL,
      client_ticket = NULL,
      qr_token = NULL,
      error_code = 'expired',
      error_message = 'Authorization session expired.'
  WHERE s.state = p_state
    AND s.flow_type = p_flow_type
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (
      (s.status = 'pending' AND s.expires_at <= clock_timestamp())
      OR (
        s.status = 'processing'
        AND s.processing_expires_at IS NOT NULL
        AND s.processing_expires_at <= clock_timestamp()
      )
    );

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_tiktok_auth_account(
  p_state TEXT,
  p_flow_type TEXT,
  p_user_id UUID,
  p_processing_token UUID,
  p_open_id TEXT,
  p_union_id TEXT,
  p_display_name TEXT,
  p_username TEXT,
  p_avatar_url TEXT,
  p_follower_count BIGINT,
  p_following_count BIGINT,
  p_likes_count BIGINT,
  p_video_count BIGINT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_token_expires_at TIMESTAMPTZ,
  p_refresh_token_expires_at TIMESTAMPTZ,
  p_scopes JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_state_id UUID;
  target_account_id UUID;
  locked_status TEXT;
  locked_processing_token UUID;
  locked_processing_expires_at TIMESTAMPTZ;
  compatibility_key UUID;
BEGIN
  IF p_flow_type NOT IN ('web', 'qr')
    OR NULLIF(BTRIM(p_open_id), '') IS NULL
    OR NULLIF(BTRIM(p_access_token), '') IS NULL
    OR NULLIF(BTRIM(p_refresh_token), '') IS NULL
    OR p_access_token_expires_at <= clock_timestamp()
    OR p_refresh_token_expires_at <= clock_timestamp()
    OR jsonb_typeof(p_scopes) IS DISTINCT FROM 'array'
    OR p_follower_count < 0
    OR p_following_count < 0
    OR p_likes_count < 0
    OR p_video_count < 0
  THEN
    RAISE EXCEPTION 'Invalid TikTok account authorization payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.id
  INTO target_state_id
  FROM public.tiktok_auth_states s
  WHERE s.state = p_state
    AND s.flow_type = p_flow_type
    AND s.user_id = p_user_id;

  IF target_state_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Existing-account writes use the system-wide parent -> state -> token order.
  -- A new account has no parent row yet, so the state is locked before INSERT.
  SELECT a.id
  INTO target_account_id
  FROM public.tiktok_accounts a
  WHERE a.user_id = p_user_id
    AND a.open_id = p_open_id
    AND a.account_type = 'normal';

  IF target_account_id IS NOT NULL THEN
    PERFORM 1
    FROM public.tiktok_accounts a
    WHERE a.id = target_account_id
      AND a.user_id = p_user_id
      AND a.account_type = 'normal'
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT s.status, s.processing_token, s.processing_expires_at
  INTO locked_status, locked_processing_token, locked_processing_expires_at
  FROM public.tiktok_auth_states s
  WHERE s.id = target_state_id
  FOR UPDATE;

  IF locked_status IS DISTINCT FROM 'processing'
    OR locked_processing_token IS DISTINCT FROM p_processing_token
    OR locked_processing_expires_at IS NULL
    OR locked_processing_expires_at <= clock_timestamp()
  THEN
    RETURN NULL;
  END IF;

  IF target_account_id IS NOT NULL THEN
    SELECT t.compatibility_write_key
    INTO compatibility_key
    FROM public.tiktok_account_tokens t
    WHERE t.account_id = target_account_id
    FOR UPDATE;

    UPDATE public.tiktok_accounts
    SET union_id = NULLIF(BTRIM(p_union_id), ''),
        display_name = NULLIF(BTRIM(p_display_name), ''),
        username = NULLIF(BTRIM(p_username), ''),
        avatar_url = NULLIF(BTRIM(p_avatar_url), ''),
        follower_count = p_follower_count,
        following_count = p_following_count,
        likes_count = p_likes_count,
        video_count = p_video_count,
        access_token = p_access_token,
        refresh_token = p_refresh_token,
        access_token_expires_at = p_access_token_expires_at,
        token_expires_at = p_refresh_token_expires_at,
        refresh_token_expires_at = p_refresh_token_expires_at,
        token_write_fence = compatibility_key,
        scopes = p_scopes,
        status = 'active',
        creator_info_cache = NULL,
        creator_info_cached_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = target_account_id
      AND user_id = p_user_id
      AND account_type = 'normal';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TikTok account authorization parent was lost'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    INSERT INTO public.tiktok_accounts (
      user_id,
      open_id,
      union_id,
      display_name,
      username,
      avatar_url,
      follower_count,
      following_count,
      likes_count,
      video_count,
      access_token,
      refresh_token,
      access_token_expires_at,
      token_expires_at,
      refresh_token_expires_at,
      scopes,
      account_type,
      status,
      updated_at
    )
    VALUES (
      p_user_id,
      BTRIM(p_open_id),
      NULLIF(BTRIM(p_union_id), ''),
      NULLIF(BTRIM(p_display_name), ''),
      NULLIF(BTRIM(p_username), ''),
      NULLIF(BTRIM(p_avatar_url), ''),
      p_follower_count,
      p_following_count,
      p_likes_count,
      p_video_count,
      p_access_token,
      p_refresh_token,
      p_access_token_expires_at,
      p_refresh_token_expires_at,
      p_refresh_token_expires_at,
      p_scopes,
      'normal',
      'active',
      clock_timestamp()
    )
    RETURNING id INTO target_account_id;
  END IF;

  UPDATE public.tiktok_auth_states
  SET status = 'completed',
      processing_token = NULL,
      processing_expires_at = NULL,
      code_verifier = NULL,
      client_ticket = NULL,
      qr_token = NULL,
      completed_at = clock_timestamp(),
      error_code = NULL,
      error_message = NULL
  WHERE id = target_state_id
    AND status = 'processing'
    AND processing_token = p_processing_token
    AND processing_expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok account authorization fence was lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN target_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tiktok_auth_state(TEXT, TEXT, UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tiktok_auth_state(TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tiktok_auth_state(TEXT, TEXT, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_tiktok_auth_state(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_tiktok_auth_account(
  TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_tiktok_auth_state(TEXT, TEXT, UUID, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tiktok_auth_state(TEXT, TEXT, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tiktok_auth_state(TEXT, TEXT, UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_tiktok_auth_state(TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_tiktok_auth_account(
  TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO service_role;

COMMENT ON COLUMN public.tiktok_auth_states.processing_token IS
  'Single-attempt fence for ordinary TikTok Login Kit provider exchange.';
COMMENT ON COLUMN public.tiktok_auth_states.processing_expires_at IS
  'Short processing lease; expiry fences late completion and does not authorize replay.';
