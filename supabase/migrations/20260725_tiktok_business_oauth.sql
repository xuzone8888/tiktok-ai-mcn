-- TikTok API for Business / Organic API authorization.
-- Publishing credentials remain in tiktok_account_tokens. These credentials are
-- a second, comment-only authorization linked to the same normal account.

CREATE TABLE IF NOT EXISTS public.tiktok_business_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  processing_token UUID,
  processing_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_auth_states_user_created
  ON public.tiktok_business_auth_states(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_business_auth_states_pending_expiry
  ON public.tiktok_business_auth_states(status, expires_at)
  WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiktok_business_auth_states_one_active
  ON public.tiktok_business_auth_states(user_id, account_id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.tiktok_business_account_tokens (
  account_id UUID PRIMARY KEY REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  business_open_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(scopes) = 'array'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.guard_tiktok_business_token_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_type TEXT;
BEGIN
  SELECT account_type
  INTO parent_type
  FROM public.tiktok_accounts
  WHERE id = NEW.account_id
  FOR KEY SHARE;

  IF parent_type IS DISTINCT FROM 'normal' THEN
    RAISE EXCEPTION 'TikTok Business authorization requires a normal TikTok account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_tiktok_business_token_account
  ON public.tiktok_business_account_tokens;
CREATE TRIGGER guard_tiktok_business_token_account
  BEFORE INSERT OR UPDATE OF account_id
  ON public.tiktok_business_account_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tiktok_business_token_account();

CREATE OR REPLACE FUNCTION public.claim_tiktok_business_auth_state(
  p_state TEXT,
  p_processing_token UUID,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS TABLE (
  user_id UUID,
  account_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.tiktok_business_auth_states s
  SET status = 'processing',
      processing_token = p_processing_token,
      processing_expires_at = NOW()
        + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 120)))
  WHERE s.state = p_state
    AND s.status = 'pending'
    AND s.expires_at > NOW()
  RETURNING s.user_id, s.account_id;
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
  locked_status TEXT;
  locked_processing_token UUID;
  locked_processing_expires_at TIMESTAMPTZ;
  parent_type TEXT;
  existing_business_open_id TEXT;
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

  -- Resolve the parent without a row lock, then use the system-wide
  -- parent -> state -> token lock order.
  SELECT s.id, s.user_id, s.account_id
  INTO target_state_id, target_user_id, target_account_id
  FROM public.tiktok_business_auth_states s
  WHERE s.state = p_state;

  IF target_state_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT a.account_type
  INTO parent_type
  FROM public.tiktok_accounts a
  WHERE a.id = target_account_id
    AND a.user_id = target_user_id
  FOR UPDATE;

  IF parent_type IS DISTINCT FROM 'normal' THEN
    RETURN FALSE;
  END IF;

  SELECT s.status, s.processing_token, s.processing_expires_at
  INTO locked_status, locked_processing_token, locked_processing_expires_at
  FROM public.tiktok_business_auth_states s
  WHERE s.id = target_state_id
    AND s.account_id = target_account_id
  FOR UPDATE;

  IF locked_status IS DISTINCT FROM 'processing'
    OR locked_processing_token IS DISTINCT FROM p_processing_token
    OR locked_processing_expires_at IS NULL
    OR locked_processing_expires_at <= clock_timestamp()
  THEN
    RETURN FALSE;
  END IF;

  SELECT t.business_open_id
  INTO existing_business_open_id
  FROM public.tiktok_business_account_tokens t
  WHERE t.account_id = target_account_id
  FOR UPDATE;

  -- "Reauthorize" renews the same Business identity. Replacing it requires a
  -- future explicit disconnect/relink flow so it cannot happen silently.
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
  )
  VALUES (
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

  UPDATE public.tiktok_business_auth_states
  SET status = 'completed',
      processing_token = NULL,
      processing_expires_at = NULL,
      completed_at = NOW(),
      error_code = NULL,
      error_message = NULL
  WHERE id = target_state_id
    AND status = 'processing'
    AND processing_token = p_processing_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok Business authorization fence was lost'
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tiktok_business_auth_state(
  p_state TEXT,
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
  UPDATE public.tiktok_business_auth_states
  SET status = 'failed',
      processing_token = NULL,
      processing_expires_at = NULL,
      completed_at = NOW(),
      error_code = LEFT(COALESCE(p_error_code, 'callback_failed'), 80),
      error_message = LEFT(COALESCE(p_error_message, 'Authorization failed'), 240)
  WHERE state = p_state
    AND status = 'processing'
    AND processing_token = p_processing_token;

  RETURN FOUND;
END;
$$;

ALTER TABLE public.tiktok_business_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiktok_business_account_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tiktok_business_auth_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tiktok_business_account_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tiktok_business_auth_states TO service_role;
GRANT ALL ON TABLE public.tiktok_business_account_tokens TO service_role;

REVOKE ALL ON FUNCTION public.guard_tiktok_business_token_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_tiktok_business_auth_state(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_tiktok_business_token_account() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_tiktok_business_auth_state(TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tiktok_business_auth_state(TEXT, UUID, TEXT, TEXT) TO service_role;

COMMENT ON TABLE public.tiktok_business_account_tokens IS
  'Service-role-only TikTok API for Business credentials used for comment access.';
COMMENT ON COLUMN public.tiktok_business_account_tokens.business_open_id IS
  'App-specific TikTok account holder open_id; used as Business API business_id.';
