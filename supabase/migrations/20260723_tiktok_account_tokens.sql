-- Separate TikTok Login Kit / Content Posting credentials from account profile data.
-- Legacy token columns remain on tiktok_accounts during the compatibility window.
--
-- The legacy row is the compatibility write surface for this phase. A trigger
-- mirrors normal-account credentials into the service-role-only table in the
-- same transaction, including writes made by older application instances.

CREATE TABLE IF NOT EXISTS public.tiktok_account_tokens (
  account_id UUID PRIMARY KEY REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  refresh_lease_token UUID,
  refresh_lease_expires_at TIMESTAMPTZ,
  managed_writes_only BOOLEAN NOT NULL DEFAULT FALSE,
  compatibility_write_key UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tiktok_account_tokens
  ADD COLUMN IF NOT EXISTS refresh_lease_token UUID,
  ADD COLUMN IF NOT EXISTS refresh_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS managed_writes_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compatibility_write_key UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS token_write_fence UUID;

CREATE INDEX IF NOT EXISTS idx_tiktok_account_tokens_access_expires_at
  ON public.tiktok_account_tokens(access_token_expires_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_account_tokens_refresh_expires_at
  ON public.tiktok_account_tokens(refresh_token_expires_at);

ALTER TABLE public.tiktok_account_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tiktok_account_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.tiktok_account_tokens FROM anon;
REVOKE ALL ON TABLE public.tiktok_account_tokens FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tiktok_account_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.guard_tiktok_legacy_token_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  managed_only BOOLEAN;
  current_lease UUID;
  compatibility_key UUID;
BEGIN
  -- Account kind is an immutable security boundary. Allowing an existing row
  -- to leave or enter the normal path would delete/recreate its secure token
  -- row and reset managed-write fencing.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.account_type IS DISTINCT FROM NEW.account_type THEN
      RAISE EXCEPTION 'TikTok account type cannot be changed after binding'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.account_type IS DISTINCT FROM 'normal' THEN
    NEW.token_write_fence := NULL;
    RETURN NEW;
  END IF;

  -- The parent row is already locked by the UPDATE. Lock token second to keep
  -- the same parent -> token order as commit and the mirror trigger.
  SELECT
    managed_writes_only,
    refresh_lease_token,
    compatibility_write_key
  INTO
    managed_only,
    current_lease,
    compatibility_key
  FROM public.tiktok_account_tokens
  WHERE account_id = NEW.id
  FOR UPDATE;

  IF COALESCE(managed_only, FALSE)
     AND (
       NEW.token_write_fence IS NULL
       OR (
         NEW.token_write_fence IS DISTINCT FROM current_lease
         AND NEW.token_write_fence IS DISTINCT FROM compatibility_key
       )
     ) THEN
    RAISE EXCEPTION 'unfenced legacy TikTok token write rejected'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.token_write_fence IS NOT NULL
     AND NEW.token_write_fence IS NOT DISTINCT FROM compatibility_key THEN
    UPDATE public.tiktok_account_tokens
    SET managed_writes_only = TRUE
    WHERE account_id = NEW.id;
  END IF;

  -- A write fence is a one-request capability and is never retained on the
  -- user-visible parent row.
  NEW.token_write_fence := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_tiktok_legacy_token_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_tiktok_legacy_token_write() FROM anon;
REVOKE ALL ON FUNCTION public.guard_tiktok_legacy_token_write() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guard_tiktok_legacy_token_write() TO service_role;

DROP TRIGGER IF EXISTS guard_tiktok_legacy_token_write
  ON public.tiktok_accounts;
CREATE TRIGGER guard_tiktok_legacy_token_write
BEFORE INSERT OR UPDATE OF
  access_token,
  refresh_token,
  access_token_expires_at,
  token_expires_at,
  refresh_token_expires_at,
  account_type,
  token_write_fence
ON public.tiktok_accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_tiktok_legacy_token_write();

CREATE OR REPLACE FUNCTION public.sync_tiktok_account_token_from_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_type = 'normal'
     AND NEW.access_token IS NOT NULL
     AND NEW.refresh_token IS NOT NULL THEN
    INSERT INTO public.tiktok_account_tokens (
      account_id,
      access_token,
      refresh_token,
      access_token_expires_at,
      refresh_token_expires_at,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      NEW.access_token,
      NEW.refresh_token,
      NEW.access_token_expires_at,
      COALESCE(NEW.token_expires_at, NEW.refresh_token_expires_at),
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (account_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
      refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = EXCLUDED.updated_at;
  ELSE
    -- Shop credentials must remain on their dedicated legacy path.
    DELETE FROM public.tiktok_account_tokens
    WHERE account_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_tiktok_account_token_from_legacy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_tiktok_account_token_from_legacy() FROM anon;
REVOKE ALL ON FUNCTION public.sync_tiktok_account_token_from_legacy() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tiktok_account_token_from_legacy() TO service_role;

DROP TRIGGER IF EXISTS sync_tiktok_account_token_from_legacy
  ON public.tiktok_accounts;
CREATE TRIGGER sync_tiktok_account_token_from_legacy
AFTER INSERT OR UPDATE OF
  access_token,
  refresh_token,
  access_token_expires_at,
  token_expires_at,
  refresh_token_expires_at,
  account_type
ON public.tiktok_accounts
FOR EACH ROW
EXECUTE FUNCTION public.sync_tiktok_account_token_from_legacy();

INSERT INTO public.tiktok_account_tokens (
  account_id,
  access_token,
  refresh_token,
  access_token_expires_at,
  refresh_token_expires_at,
  created_at,
  updated_at
)
SELECT
  id,
  access_token,
  refresh_token,
  access_token_expires_at,
  COALESCE(token_expires_at, refresh_token_expires_at),
  COALESCE(created_at, NOW()),
  COALESCE(updated_at, NOW())
FROM public.tiktok_accounts
WHERE account_type = 'normal'
  AND access_token IS NOT NULL
  AND refresh_token IS NOT NULL
ON CONFLICT (account_id) DO NOTHING;

-- Claim a short account-scoped lease before calling TikTok's refresh endpoint.
-- The expected refresh token is a CAS guard against stale workers.
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
  SET
    refresh_lease_token = p_lease_token,
    refresh_lease_expires_at = NOW() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 120)),
    managed_writes_only = TRUE
  FROM public.tiktok_accounts AS account_row
  WHERE token_row.account_id = p_account_id
    AND account_row.id = token_row.account_id
    AND account_row.account_type = 'normal'
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

CREATE OR REPLACE FUNCTION public.release_tiktok_token_refresh(
  p_account_id UUID,
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE public.tiktok_account_tokens
  SET
    refresh_lease_token = NULL,
    refresh_lease_expires_at = NULL
  WHERE account_id = p_account_id
    AND refresh_lease_token = p_lease_token;

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
BEGIN
  -- Keep the same parent -> token lock order used by direct legacy writes and
  -- the AFTER trigger. This prevents a rolling old writer from deadlocking
  -- with the fenced commit path.
  SELECT refresh_token
  INTO current_parent_refresh_token
  FROM public.tiktok_accounts
  WHERE id = p_account_id
    AND account_type = 'normal'
  FOR UPDATE;

  IF current_parent_refresh_token IS DISTINCT FROM p_expected_refresh_token THEN
    RETURN FALSE;
  END IF;

  -- Claim only touches the token row. Whichever transaction locks that row
  -- first determines whether this fence is still current.
  SELECT refresh_token, refresh_lease_token
  INTO current_refresh_token, current_lease_token
  FROM public.tiktok_account_tokens
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF current_refresh_token IS DISTINCT FROM p_expected_refresh_token
     OR current_lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tiktok_accounts AS account_row
  SET
    access_token = p_access_token,
    refresh_token = p_refresh_token,
    access_token_expires_at = p_access_token_expires_at,
    token_expires_at = p_refresh_token_expires_at,
    refresh_token_expires_at = p_refresh_token_expires_at,
    token_write_fence = p_lease_token,
    updated_at = p_updated_at
  WHERE account_row.id = p_account_id
    AND account_row.account_type = 'normal'
    AND account_row.refresh_token = p_expected_refresh_token;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tiktok_token_refresh(UUID, TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_tiktok_token_refresh(UUID, TEXT, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_tiktok_token_refresh(UUID, TEXT, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tiktok_token_refresh(UUID, TEXT, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.release_tiktok_token_refresh(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_tiktok_token_refresh(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.release_tiktok_token_refresh(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_tiktok_token_refresh(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.commit_tiktok_token_refresh(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_tiktok_token_refresh(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.commit_tiktok_token_refresh(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tiktok_token_refresh(
  UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

-- Enforce the task/account tenant boundary even for service-role writers.
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
BEGIN
  SELECT user_id INTO task_owner
  FROM public.publish_tasks
  WHERE id = NEW.task_id;

  SELECT user_id, account_type INTO account_owner, account_kind
  FROM public.tiktok_accounts
  WHERE id = NEW.account_id;

  IF task_owner IS NULL
     OR account_owner IS NULL
     OR task_owner <> account_owner
     OR account_kind IS DISTINCT FROM 'normal' THEN
    RAISE EXCEPTION 'publish task item account must be a normal TikTok account owned by the task owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_publish_task_item_account_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_publish_task_item_account_owner() FROM anon;
REVOKE ALL ON FUNCTION public.validate_publish_task_item_account_owner() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validate_publish_task_item_account_owner() TO service_role;

DROP TRIGGER IF EXISTS validate_publish_task_item_account_owner
  ON public.publish_task_items;
CREATE TRIGGER validate_publish_task_item_account_owner
BEFORE INSERT OR UPDATE OF task_id, account_id
ON public.publish_task_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_publish_task_item_account_owner();

DROP POLICY IF EXISTS "Users can insert their own publish task items"
  ON public.publish_task_items;
CREATE POLICY "Users can insert their own publish task items"
  ON public.publish_task_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
        AND publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts
      WHERE tiktok_accounts.id = publish_task_items.account_id
        AND tiktok_accounts.user_id = auth.uid()
        AND tiktok_accounts.account_type = 'normal'
    )
  );

DROP POLICY IF EXISTS "Users can update their own publish task items"
  ON public.publish_task_items;
CREATE POLICY "Users can update their own publish task items"
  ON public.publish_task_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
        AND publish_tasks.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
        AND publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.tiktok_accounts
      WHERE tiktok_accounts.id = publish_task_items.account_id
        AND tiktok_accounts.user_id = auth.uid()
        AND tiktok_accounts.account_type = 'normal'
    )
  );

COMMENT ON TABLE public.tiktok_account_tokens IS
  'Service-role-only TikTok Login Kit and Content Posting OAuth credentials. Normal-account legacy writes are transactionally mirrored during compatibility.';
COMMENT ON COLUMN public.tiktok_account_tokens.refresh_token_expires_at IS
  'TikTok refresh authorization expiry, mirrored from the legacy tiktok_accounts.token_expires_at field during compatibility.';
COMMENT ON COLUMN public.tiktok_account_tokens.refresh_lease_token IS
  'Short-lived cross-instance refresh lease. Cleared by a successful token mirror.';
COMMENT ON COLUMN public.tiktok_account_tokens.managed_writes_only IS
  'Once true, direct legacy token updates must carry the current lease or compatibility write fence.';
COMMENT ON COLUMN public.tiktok_account_tokens.compatibility_write_key IS
  'Service-role-only write fence used for body-based compatibility updates and OAuth binding.';
COMMENT ON COLUMN public.tiktok_accounts.token_write_fence IS
  'Transient server-side token write fence. A BEFORE trigger always clears it before storage.';
