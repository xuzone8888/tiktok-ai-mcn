-- Safe refresh coordination for TikTok Business comment-read credentials.
-- Provider calls happen outside PostgreSQL, so a short lease plus fencing token
-- prevents concurrent workers from committing different refresh results.

ALTER TABLE public.tiktok_business_account_tokens
  ADD COLUMN IF NOT EXISTS credential_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS refresh_lease_token UUID,
  ADD COLUMN IF NOT EXISTS refresh_lease_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.fence_tiktok_business_token_replacement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Any statement that targets authorization material is a new credential
  -- generation even when the provider reuses the same token strings. This
  -- makes OAuth renewal (including expiry/scope-only renewal) revoke every
  -- in-flight refresh fence. The fenced refresh commit also passes here, but
  -- already sets its own lease to NULL and is expected to start a new version.
  NEW.credential_generation := gen_random_uuid();
  NEW.refresh_lease_token := NULL;
  NEW.refresh_lease_expires_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fence_tiktok_business_token_replacement
  ON public.tiktok_business_account_tokens;
CREATE TRIGGER fence_tiktok_business_token_replacement
  BEFORE UPDATE OF
    access_token,
    refresh_token,
    access_token_expires_at,
    refresh_token_expires_at,
    scopes,
    status
  ON public.tiktok_business_account_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.fence_tiktok_business_token_replacement();

-- Remove pre-generation draft signatures if this migration is resumed after a
-- partially applied deployment.
DROP FUNCTION IF EXISTS public.claim_tiktok_business_token_refresh(UUID, UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.commit_tiktok_business_token_refresh(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
);

CREATE OR REPLACE FUNCTION public.claim_tiktok_business_token_refresh(
  p_account_id UUID,
  p_user_id UUID,
  p_expected_credential_generation UUID,
  p_refresh_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_business_account_tokens token
  SET refresh_lease_token = p_refresh_lease_token,
      refresh_lease_expires_at = NOW()
        + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 120)))
  WHERE token.account_id = p_account_id
    AND token.status = 'active'
    AND token.credential_generation = p_expected_credential_generation
    AND token.refresh_token_expires_at > NOW()
    AND (
      token.refresh_lease_token IS NULL
      OR token.refresh_lease_expires_at IS NULL
      OR token.refresh_lease_expires_at <= NOW()
    )
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts account
      WHERE account.id = token.account_id
        AND account.user_id = p_user_id
        AND account.account_type = 'normal'
        AND account.status = 'active'
    );

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_tiktok_business_token_refresh(
  p_account_id UUID,
  p_user_id UUID,
  p_expected_credential_generation UUID,
  p_refresh_lease_token UUID,
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
  parent_type TEXT;
  parent_status TEXT;
  locked_business_open_id TEXT;
  locked_status TEXT;
  locked_credential_generation UUID;
  locked_refresh_lease_token UUID;
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
    RAISE EXCEPTION 'Invalid TikTok Business refresh payload'
      USING ERRCODE = '22023';
  END IF;

  -- Match the global parent -> token row lock order.
  SELECT account.account_type, account.status
  INTO parent_type, parent_status
  FROM public.tiktok_accounts account
  WHERE account.id = p_account_id
    AND account.user_id = p_user_id
  FOR UPDATE;

  IF parent_type IS DISTINCT FROM 'normal'
    OR parent_status IS DISTINCT FROM 'active'
  THEN
    RETURN FALSE;
  END IF;

  SELECT
    token.business_open_id,
    token.status,
    token.credential_generation,
    token.refresh_lease_token
  INTO
    locked_business_open_id,
    locked_status,
    locked_credential_generation,
    locked_refresh_lease_token
  FROM public.tiktok_business_account_tokens token
  WHERE token.account_id = p_account_id
  FOR UPDATE;

  IF locked_business_open_id IS DISTINCT FROM p_business_open_id
    OR locked_status IS DISTINCT FROM 'active'
    OR locked_credential_generation IS DISTINCT FROM p_expected_credential_generation
    OR locked_refresh_lease_token IS DISTINCT FROM p_refresh_lease_token
  THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tiktok_business_account_tokens
  SET access_token = p_access_token,
      refresh_token = p_refresh_token,
      access_token_expires_at = p_access_token_expires_at,
      refresh_token_expires_at = p_refresh_token_expires_at,
      scopes = p_scopes,
      status = 'active',
      refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = NOW()
  WHERE account_id = p_account_id
    AND refresh_lease_token = p_refresh_lease_token;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_tiktok_business_token_refresh(
  p_account_id UUID,
  p_user_id UUID,
  p_refresh_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tiktok_business_account_tokens token
  SET refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL
  WHERE token.account_id = p_account_id
    AND token.refresh_lease_token = p_refresh_lease_token
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts account
      WHERE account.id = token.account_id
        AND account.user_id = p_user_id
        AND account.account_type = 'normal'
    );

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tiktok_business_token_refresh(UUID, UUID, UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_tiktok_business_token_refresh(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_tiktok_business_token_refresh(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fence_tiktok_business_token_replacement()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_tiktok_business_token_refresh(UUID, UUID, UUID, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_tiktok_business_token_refresh(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_tiktok_business_token_refresh(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fence_tiktok_business_token_replacement()
  TO service_role;
