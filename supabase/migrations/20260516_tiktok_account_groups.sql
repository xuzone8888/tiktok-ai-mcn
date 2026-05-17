-- TikTok account groups for content publishing accounts.
-- Scope: account_type = 'normal' only.

CREATE TABLE IF NOT EXISTS public.tiktok_account_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tiktok_account_groups_name_length CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 20
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiktok_account_groups_user_name_lower
  ON public.tiktok_account_groups(user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_tiktok_account_groups_user_id
  ON public.tiktok_account_groups(user_id);

ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.tiktok_account_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_group_id
  ON public.tiktok_accounts(group_id);

CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_user_type_group
  ON public.tiktok_accounts(user_id, account_type, group_id);

DROP TRIGGER IF EXISTS update_tiktok_account_groups_updated_at ON public.tiktok_account_groups;
CREATE TRIGGER update_tiktok_account_groups_updated_at
  BEFORE UPDATE ON public.tiktok_account_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.tiktok_account_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tiktok_account_groups'
      AND policyname = 'Users can view their own TikTok account groups'
  ) THEN
    CREATE POLICY "Users can view their own TikTok account groups"
      ON public.tiktok_account_groups
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END;
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
BEGIN
  v_bypass := COALESCE(current_setting('app.bypass_tiktok_group_guard', true), 'false') = 'true';

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
      SELECT COUNT(*)
      INTO v_group_count
      FROM public.tiktok_accounts
      WHERE group_id = OLD.group_id
        AND id <> OLD.id;

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

  SELECT user_id
  INTO v_group_user_id
  FROM public.tiktok_account_groups
  WHERE id = NEW.group_id;

  IF v_group_user_id IS NULL OR v_group_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  SELECT COUNT(*)
  INTO v_group_count
  FROM public.tiktok_accounts
  WHERE group_id = NEW.group_id
    AND id <> NEW.id;

  IF v_group_count >= 20 THEN
    RAISE EXCEPTION 'GROUP_FULL';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_tiktok_account_group_change ON public.tiktok_accounts;
CREATE TRIGGER guard_tiktok_account_group_change
  BEFORE INSERT OR UPDATE OF group_id, account_type ON public.tiktok_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_tiktok_account_group_change();

CREATE OR REPLACE FUNCTION public.cleanup_empty_tiktok_account_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.group_id IS NOT NULL THEN
    DELETE FROM public.tiktok_account_groups g
    WHERE g.id = OLD.group_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.tiktok_accounts a
        WHERE a.group_id = g.id
      );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_empty_tiktok_account_group_after_delete ON public.tiktok_accounts;
CREATE TRIGGER cleanup_empty_tiktok_account_group_after_delete
  AFTER DELETE ON public.tiktok_accounts
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_empty_tiktok_account_group();

CREATE OR REPLACE FUNCTION public.create_tiktok_account_group(
  p_name TEXT,
  p_account_ids UUID[]
)
RETURNS public.tiktok_account_groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_name TEXT;
  v_account_ids UUID[];
  v_account_count INTEGER;
  v_available_count INTEGER;
  v_authorized_count INTEGER;
  v_group public.tiktok_account_groups;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  v_name := btrim(COALESCE(p_name, ''));

  IF char_length(v_name) < 1 THEN
    RAISE EXCEPTION 'INVALID_GROUP_NAME';
  END IF;

  IF char_length(v_name) > 20 THEN
    RAISE EXCEPTION 'GROUP_NAME_TOO_LONG';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT account_id), ARRAY[]::UUID[])
  INTO v_account_ids
  FROM unnest(COALESCE(p_account_ids, ARRAY[]::UUID[])) AS account_id
  WHERE account_id IS NOT NULL;

  v_account_count := cardinality(v_account_ids);

  IF v_account_count < 1 THEN
    RAISE EXCEPTION 'ACCOUNT_IDS_REQUIRED';
  END IF;

  IF v_account_count > 20 THEN
    RAISE EXCEPTION 'TOO_MANY_ACCOUNTS';
  END IF;

  PERFORM 1
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_available_count
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL;

  IF v_available_count <> v_account_count THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_AVAILABLE';
  END IF;

  SELECT COUNT(*)
  INTO v_authorized_count
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL
    AND status = 'active'
    AND token_expires_at > NOW();

  IF v_authorized_count <> v_account_count THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_AUTHORIZED';
  END IF;

  INSERT INTO public.tiktok_account_groups (user_id, name, sort_order)
  VALUES (
    v_user_id,
    v_name,
    COALESCE((
      SELECT MAX(sort_order) + 1
      FROM public.tiktok_account_groups
      WHERE user_id = v_user_id
    ), 0)
  )
  RETURNING * INTO v_group;

  PERFORM set_config('app.bypass_tiktok_group_guard', 'true', true);

  UPDATE public.tiktok_accounts
  SET group_id = v_group.id,
      updated_at = NOW()
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL;

  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_tiktok_account_group(
  p_group_id UUID,
  p_name TEXT
)
RETURNS public.tiktok_account_groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_name TEXT;
  v_group public.tiktok_account_groups;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  v_name := btrim(COALESCE(p_name, ''));

  IF char_length(v_name) < 1 THEN
    RAISE EXCEPTION 'INVALID_GROUP_NAME';
  END IF;

  IF char_length(v_name) > 20 THEN
    RAISE EXCEPTION 'GROUP_NAME_TOO_LONG';
  END IF;

  UPDATE public.tiktok_account_groups
  SET name = v_name,
      updated_at = NOW()
  WHERE id = p_group_id
    AND user_id = v_user_id
  RETURNING * INTO v_group;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_tiktok_accounts_to_group(
  p_group_id UUID,
  p_account_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_account_ids UUID[];
  v_new_count INTEGER;
  v_current_count INTEGER;
  v_available_count INTEGER;
  v_authorized_count INTEGER;
  v_group_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT id
  INTO v_group_id
  FROM public.tiktok_account_groups
  WHERE id = p_group_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT account_id), ARRAY[]::UUID[])
  INTO v_account_ids
  FROM unnest(COALESCE(p_account_ids, ARRAY[]::UUID[])) AS account_id
  WHERE account_id IS NOT NULL;

  v_new_count := cardinality(v_account_ids);

  IF v_new_count < 1 THEN
    RAISE EXCEPTION 'ACCOUNT_IDS_REQUIRED';
  END IF;

  PERFORM 1
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.tiktok_accounts
  WHERE group_id = p_group_id
    AND user_id = v_user_id
    AND account_type = 'normal';

  IF v_current_count + v_new_count > 20 THEN
    RAISE EXCEPTION 'GROUP_FULL';
  END IF;

  SELECT COUNT(*)
  INTO v_available_count
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL;

  IF v_available_count <> v_new_count THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_AVAILABLE';
  END IF;

  SELECT COUNT(*)
  INTO v_authorized_count
  FROM public.tiktok_accounts
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL
    AND status = 'active'
    AND token_expires_at > NOW();

  IF v_authorized_count <> v_new_count THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_AUTHORIZED';
  END IF;

  PERFORM set_config('app.bypass_tiktok_group_guard', 'true', true);

  UPDATE public.tiktok_accounts
  SET group_id = p_group_id,
      updated_at = NOW()
  WHERE id = ANY(v_account_ids)
    AND user_id = v_user_id
    AND account_type = 'normal'
    AND group_id IS NULL;

  UPDATE public.tiktok_account_groups
  SET updated_at = NOW()
  WHERE id = p_group_id;

  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_tiktok_account_from_group(
  p_group_id UUID,
  p_account_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
  v_current_count INTEGER;
  v_updated_count INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT id
  INTO v_group_id
  FROM public.tiktok_account_groups
  WHERE id = p_group_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.tiktok_accounts
  WHERE group_id = p_group_id
    AND user_id = v_user_id
    AND account_type = 'normal';

  IF v_current_count <= 1 THEN
    RAISE EXCEPTION 'LAST_ACCOUNT_IN_GROUP';
  END IF;

  PERFORM set_config('app.bypass_tiktok_group_guard', 'true', true);

  UPDATE public.tiktok_accounts
  SET group_id = NULL,
      updated_at = NOW()
  WHERE id = p_account_id
    AND group_id = p_group_id
    AND user_id = v_user_id
    AND account_type = 'normal';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  UPDATE public.tiktok_account_groups
  SET updated_at = NOW()
  WHERE id = p_group_id;

  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_tiktok_account_group(
  p_group_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_group_id UUID;
  v_released_count INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT id
  INTO v_group_id
  FROM public.tiktok_account_groups
  WHERE id = p_group_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND';
  END IF;

  PERFORM set_config('app.bypass_tiktok_group_guard', 'true', true);

  UPDATE public.tiktok_accounts
  SET group_id = NULL,
      updated_at = NOW()
  WHERE group_id = p_group_id
    AND user_id = v_user_id
    AND account_type = 'normal';

  GET DIAGNOSTICS v_released_count = ROW_COUNT;

  DELETE FROM public.tiktok_account_groups
  WHERE id = p_group_id
    AND user_id = v_user_id;

  RETURN v_released_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tiktok_account_group(TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_tiktok_account_group(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_tiktok_accounts_to_group(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_tiktok_account_from_group(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_tiktok_account_group(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_tiktok_account_group(TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_tiktok_account_group(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_tiktok_accounts_to_group(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_tiktok_account_from_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tiktok_account_group(UUID) TO authenticated;

COMMENT ON TABLE public.tiktok_account_groups IS 'User-defined groups for normal TikTok content publishing accounts.';
COMMENT ON COLUMN public.tiktok_accounts.group_id IS 'Optional TikTok content account group. Null means ungrouped.';
