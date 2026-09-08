-- Finalize a provider-accepted comment reply in one transaction.
-- The application records the provider receipt first, then this RPC makes the
-- local reply, root-parent count, and action-log completion atomic.

ALTER TABLE public.social_comment_action_logs
  DROP CONSTRAINT IF EXISTS social_comment_action_logs_status_check;

ALTER TABLE public.social_comment_action_logs
  ADD CONSTRAINT social_comment_action_logs_status_check
  CHECK (status IN ('running', 'sent', 'completed', 'failed', 'unsupported', 'unknown'));

ALTER TABLE public.social_comment_action_logs
  DROP CONSTRAINT IF EXISTS tiktok_reply_provider_target_required;

ALTER TABLE public.social_comment_action_logs
  ADD CONSTRAINT tiktok_reply_provider_target_required
  CHECK (
    platform <> 'tiktok'
    OR action_type <> 'reply'
    OR NULLIF(btrim(COALESCE(metadata->>'parent_external_comment_id', '')), '') IS NOT NULL
  );

-- TikTok's reply-create endpoint has no idempotency-key parameter. Keep exactly
-- one unresolved provider write per target regardless of client key or age.
-- A crashed running row therefore fails closed until it is reconciled instead
-- of becoming eligible for another irreversible provider call.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiktok_unresolved_comment_reply
  ON public.social_comment_action_logs(
    user_id,
    platform,
    account_id,
    (COALESCE(metadata->>'parent_external_comment_id', external_comment_id))
  )
  WHERE platform = 'tiktok'
    AND action_type = 'reply'
    AND status IN ('running', 'sent', 'unknown');

CREATE OR REPLACE FUNCTION public.abandon_stale_tiktok_reply_dispatch(
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
  abandoned BOOLEAN := FALSE;
BEGIN
  UPDATE public.social_comment_action_logs
  SET status = 'failed',
      error_code = 'reply_dispatch_abandoned',
      error_message = 'TikTok reply dispatch did not start.',
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'provider_dispatch_started', FALSE,
          'stale_predispatch_detected_at', clock_timestamp()
        ),
      completed_at = clock_timestamp()
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND platform = 'tiktok'
    AND action_type = 'reply'
    AND status = 'running'
    AND metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
    AND NULLIF(btrim(COALESCE(metadata->>'provider_dispatch_started_at', '')), '') IS NULL
    AND created_at <= clock_timestamp() - INTERVAL '2 minutes'
  RETURNING TRUE INTO abandoned;

  RETURN COALESCE(abandoned, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_stale_tiktok_reply_dispatch(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_stale_tiktok_reply_dispatch(UUID, UUID, UUID)
  TO service_role;

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
  UPDATE public.social_comment_action_logs
  SET metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'provider_dispatch_started_at',
          clock_timestamp()
        )
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND platform = 'tiktok'
    AND action_type = 'reply'
    AND status = 'running'
    AND metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
    AND NULLIF(btrim(COALESCE(metadata->>'provider_dispatch_started_at', '')), '') IS NULL
  RETURNING TRUE INTO marked;

  RETURN COALESCE(marked, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_tiktok_reply_dispatch_started(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_tiktok_reply_dispatch_started(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.transition_tiktok_reply_action(
  p_user_id UUID,
  p_action_log_id UUID,
  p_reply_attempt_token UUID,
  p_from_statuses TEXT[],
  p_to_status TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transitioned BOOLEAN := FALSE;
BEGIN
  IF p_to_status NOT IN ('sent', 'failed', 'unsupported', 'unknown')
     OR p_from_statuses IS NULL
     OR cardinality(p_from_statuses) = 0
     OR EXISTS (
       SELECT 1
       FROM unnest(p_from_statuses) AS source_status
       WHERE source_status NOT IN ('running', 'sent', 'failed', 'unsupported', 'unknown')
     )
     OR p_metadata IS NULL
     OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid TikTok reply action transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.social_comment_action_logs
  SET status = p_to_status,
      error_code = p_error_code,
      error_message = p_error_message,
      metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata,
      completed_at = clock_timestamp()
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND platform = 'tiktok'
    AND action_type = 'reply'
    AND status = ANY(p_from_statuses)
    AND metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
  RETURNING TRUE INTO transitioned;

  RETURN COALESCE(transitioned, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_tiktok_reply_action(
  UUID, UUID, UUID, TEXT[], TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_tiktok_reply_action(
  UUID, UUID, UUID, TEXT[], TEXT, TEXT, TEXT, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_stale_tiktok_reply_dispatch_unknown(
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
  transitioned BOOLEAN := FALSE;
BEGIN
  UPDATE public.social_comment_action_logs
  SET status = 'unknown',
      error_code = 'reply_outcome_unknown',
      error_message = 'TikTok reply dispatch did not record a provider receipt.',
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'provider_outcome_unknown', TRUE,
          'stale_dispatch_detected_at', clock_timestamp()
        ),
      completed_at = clock_timestamp()
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND platform = 'tiktok'
    AND action_type = 'reply'
    AND status = 'running'
    AND metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT
    AND NULLIF(btrim(COALESCE(metadata->>'provider_dispatch_started_at', '')), '') IS NOT NULL
    AND (metadata->>'provider_dispatch_started_at')::TIMESTAMPTZ
      <= clock_timestamp() - INTERVAL '60 seconds'
  RETURNING TRUE INTO transitioned;

  RETURN COALESCE(transitioned, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_tiktok_reply_dispatch_unknown(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_tiktok_reply_dispatch_unknown(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_social_comment_reply(
  p_user_id UUID,
  p_action_log_id UUID,
  p_reply_attempt_token UUID,
  p_parent_external_comment_id TEXT,
  p_task_item_id UUID,
  p_reply JSONB
)
RETURNS public.social_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_row public.social_comment_action_logs%ROWTYPE;
  parent_row public.social_comments%ROWTYPE;
  reply_row public.social_comments%ROWTYPE;
  inserted_reply BOOLEAN := FALSE;
  reply_external_id TEXT;
  reply_external_content_id TEXT;
  reply_message TEXT;
  reply_metadata JSONB;
BEGIN
  IF p_reply IS NULL OR jsonb_typeof(p_reply) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid reply payload' USING ERRCODE = '22023';
  END IF;

  reply_external_id := btrim(COALESCE(p_reply->>'external_comment_id', ''));
  reply_external_content_id := btrim(COALESCE(p_reply->>'external_content_id', ''));
  reply_message := COALESCE(p_reply->>'message', '');
  reply_metadata := COALESCE(p_reply->'metadata', '{}'::jsonb);

  IF reply_external_id = ''
     OR reply_external_content_id = ''
     OR btrim(reply_message) = ''
     OR jsonb_typeof(reply_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid reply payload' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO action_row
  FROM public.social_comment_action_logs
  WHERE id = p_action_log_id
    AND user_id = p_user_id
    AND action_type = 'reply'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reply action is not finalizable' USING ERRCODE = '40001';
  END IF;

  IF action_row.metadata->>'reply_attempt_token'
     IS DISTINCT FROM p_reply_attempt_token::TEXT THEN
    RAISE EXCEPTION 'reply action attempt mismatch' USING ERRCODE = '40001';
  END IF;

  IF action_row.status = 'completed' THEN
    IF action_row.metadata->>'external_reply_id' IS DISTINCT FROM reply_external_id
       OR action_row.metadata->>'parent_external_comment_id'
          IS DISTINCT FROM p_parent_external_comment_id THEN
      RAISE EXCEPTION 'completed reply action mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT *
    INTO reply_row
    FROM public.social_comments
    WHERE id = NULLIF(action_row.metadata->>'reply_comment_id', '')::UUID
      AND user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'completed reply row is missing' USING ERRCODE = '23503';
    END IF;
    RETURN reply_row;
  END IF;

  IF action_row.status NOT IN ('running', 'sent', 'unknown') THEN
    RAISE EXCEPTION 'reply action is not finalizable' USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO parent_row
  FROM public.social_comments
  WHERE user_id = p_user_id
    AND platform = action_row.platform
    AND account_id = action_row.account_id
    AND external_content_id = reply_external_content_id
    AND external_comment_id = p_parent_external_comment_id
    AND direction = 'inbound'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reply parent not found' USING ERRCODE = '23503';
  END IF;

  IF action_row.external_content_id IS DISTINCT FROM reply_external_content_id
     OR action_row.external_comment_id IS NULL
     OR action_row.metadata->>'parent_external_comment_id'
        IS DISTINCT FROM p_parent_external_comment_id THEN
    RAISE EXCEPTION 'reply action target mismatch' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.social_comments (
    user_id,
    platform,
    account_id,
    task_item_id,
    external_content_id,
    external_comment_id,
    parent_external_comment_id,
    thread_external_id,
    direction,
    author_id,
    author_name,
    author_avatar_url,
    message,
    like_count,
    reply_count,
    can_reply,
    is_from_account,
    permalink,
    status,
    metadata,
    remote_created_at,
    last_synced_at,
    reply_to_comment_id,
    local_error_code,
    local_error_message,
    updated_at
  )
  VALUES (
    p_user_id,
    action_row.platform,
    action_row.account_id,
    p_task_item_id,
    reply_external_content_id,
    reply_external_id,
    p_parent_external_comment_id,
    COALESCE(NULLIF(p_reply->>'thread_external_id', ''), p_parent_external_comment_id),
    'outbound',
    NULLIF(p_reply->>'author_id', ''),
    NULLIF(p_reply->>'author_name', ''),
    NULLIF(p_reply->>'author_avatar_url', ''),
    reply_message,
    GREATEST(COALESCE((p_reply->>'like_count')::INTEGER, 0), 0),
    GREATEST(COALESCE((p_reply->>'reply_count')::INTEGER, 0), 0),
    FALSE,
    TRUE,
    NULLIF(p_reply->>'permalink', ''),
    'sent',
    reply_metadata,
    NULLIF(p_reply->>'remote_created_at', '')::TIMESTAMPTZ,
    NOW(),
    parent_row.id,
    NULL,
    NULL,
    NOW()
  )
  ON CONFLICT (user_id, platform, account_id, external_comment_id)
  DO NOTHING
  RETURNING * INTO reply_row;

  inserted_reply := FOUND;

  IF NOT inserted_reply THEN
    UPDATE public.social_comments
    SET
    task_item_id = p_task_item_id,
    external_content_id = reply_external_content_id,
    parent_external_comment_id = p_parent_external_comment_id,
    thread_external_id = COALESCE(NULLIF(p_reply->>'thread_external_id', ''), p_parent_external_comment_id),
    direction = 'outbound',
    author_id = NULLIF(p_reply->>'author_id', ''),
    author_name = NULLIF(p_reply->>'author_name', ''),
    author_avatar_url = NULLIF(p_reply->>'author_avatar_url', ''),
    message = reply_message,
    like_count = GREATEST(COALESCE((p_reply->>'like_count')::INTEGER, 0), 0),
    reply_count = GREATEST(COALESCE((p_reply->>'reply_count')::INTEGER, 0), 0),
    can_reply = FALSE,
    is_from_account = TRUE,
    permalink = NULLIF(p_reply->>'permalink', ''),
    status = 'sent',
    metadata = reply_metadata,
    remote_created_at = NULLIF(p_reply->>'remote_created_at', '')::TIMESTAMPTZ,
    last_synced_at = NOW(),
    reply_to_comment_id = parent_row.id,
    local_error_code = NULL,
    local_error_message = NULL,
    updated_at = NOW()
    WHERE user_id = p_user_id
      AND platform = action_row.platform
      AND account_id = action_row.account_id
      AND external_comment_id = reply_external_id
    RETURNING * INTO reply_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'reply conflict row is missing' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF inserted_reply THEN
    UPDATE public.social_comments
    SET reply_count = reply_count + 1,
        updated_at = NOW()
    WHERE id = parent_row.id;
  END IF;

  UPDATE public.social_comment_action_logs
  SET status = 'completed',
      error_code = NULL,
      error_message = NULL,
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_comment_id', parent_row.id,
          'reply_comment_id', reply_row.id,
          'parent_external_comment_id', p_parent_external_comment_id,
          'external_reply_id', reply_external_id
        ),
      completed_at = NOW()
  WHERE id = action_row.id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reply action completion failed' USING ERRCODE = '40001';
  END IF;

  RETURN reply_row;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_social_comment_reply(UUID, UUID, UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_social_comment_reply(UUID, UUID, UUID, TEXT, UUID, JSONB)
  TO service_role;
