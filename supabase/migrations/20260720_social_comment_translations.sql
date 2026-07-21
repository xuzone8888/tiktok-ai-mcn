-- Cached translations for the shared YouTube / Instagram / Facebook comment UI.
-- Original comment text remains authoritative in social_comments.message.

CREATE TABLE IF NOT EXISTS public.social_comment_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.social_comments(id) ON DELETE CASCADE,
  target_language TEXT NOT NULL CHECK (target_language IN ('zh', 'en')),
  source_message_hash TEXT NOT NULL,
  detected_source_language TEXT,
  translated_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'translated', 'same_language', 'failed')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(comment_id, target_language)
);

CREATE INDEX IF NOT EXISTS idx_social_comment_translations_user_target
  ON public.social_comment_translations(user_id, target_language, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.social_comment_translation_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.social_comment_translation_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_social_comment_translation_quota(
  p_user_id UUID,
  p_window_seconds INTEGER DEFAULT 60,
  p_max_requests INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.social_comment_translation_rate_limits AS limits (
    user_id, window_started_at, request_count, updated_at
  ) VALUES (
    p_user_id, NOW(), 1, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    window_started_at = CASE
      WHEN limits.window_started_at <= NOW() - make_interval(secs => p_window_seconds) THEN NOW()
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at <= NOW() - make_interval(secs => p_window_seconds) THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = NOW()
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_social_comment_translations(
  p_user_id UUID,
  p_target_language TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_lease_token UUID,
  p_claims JSONB
)
RETURNS TABLE(comment_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_target_language NOT IN ('zh', 'en') THEN
    RAISE EXCEPTION 'invalid target language';
  END IF;

  RETURN QUERY
  INSERT INTO public.social_comment_translations AS translations (
    user_id,
    comment_id,
    target_language,
    source_message_hash,
    translated_text,
    status,
    provider,
    model,
    lease_token,
    lease_expires_at,
    error_code,
    updated_at
  )
  SELECT
    p_user_id,
    claims.comment_id,
    p_target_language,
    claims.source_message_hash,
    NULL,
    'processing',
    p_provider,
    p_model,
    p_lease_token,
    NOW() + INTERVAL '45 seconds',
    NULL,
    NOW()
  FROM jsonb_to_recordset(p_claims) AS claims(comment_id UUID, source_message_hash TEXT)
  INNER JOIN public.social_comments comments
    ON comments.id = claims.comment_id AND comments.user_id = p_user_id
  ON CONFLICT (comment_id, target_language) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    source_message_hash = EXCLUDED.source_message_hash,
    detected_source_language = NULL,
    translated_text = NULL,
    status = 'processing',
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    lease_token = EXCLUDED.lease_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    error_code = NULL,
    updated_at = NOW()
  WHERE translations.source_message_hash IS DISTINCT FROM EXCLUDED.source_message_hash
    OR translations.status = 'failed'
    OR (translations.status = 'processing' AND translations.lease_expires_at < NOW())
  RETURNING translations.comment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_social_comment_translation_claims(
  p_user_id UUID,
  p_target_language TEXT,
  p_lease_token UUID,
  p_comment_ids UUID[]
)
RETURNS TABLE(comment_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.social_comment_translations AS translations
  SET lease_expires_at = NOW() + INTERVAL '45 seconds', updated_at = NOW()
  WHERE translations.user_id = p_user_id
    AND translations.target_language = p_target_language
    AND translations.lease_token = p_lease_token
    AND translations.status = 'processing'
    AND translations.comment_id = ANY(p_comment_ids)
  RETURNING translations.comment_id;
$$;

CREATE OR REPLACE FUNCTION public.complete_social_comment_translations(
  p_user_id UUID,
  p_target_language TEXT,
  p_lease_token UUID,
  p_results JSONB
)
RETURNS TABLE(comment_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.social_comment_translations AS translations
  SET
    detected_source_language = results.detected_source_language,
    translated_text = results.translated_text,
    status = results.status,
    lease_token = NULL,
    lease_expires_at = NULL,
    error_code = NULL,
    updated_at = NOW()
  FROM jsonb_to_recordset(p_results) AS results(
    comment_id UUID,
    source_message_hash TEXT,
    detected_source_language TEXT,
    translated_text TEXT,
    status TEXT
  )
  WHERE translations.user_id = p_user_id
    AND translations.target_language = p_target_language
    AND translations.comment_id = results.comment_id
    AND translations.source_message_hash = results.source_message_hash
    AND translations.lease_token = p_lease_token
    AND translations.status = 'processing'
    AND results.status IN ('translated', 'same_language')
  RETURNING translations.comment_id;
$$;

CREATE OR REPLACE FUNCTION public.fail_social_comment_translation_claims(
  p_user_id UUID,
  p_target_language TEXT,
  p_lease_token UUID,
  p_comment_ids UUID[]
)
RETURNS TABLE(comment_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.social_comment_translations AS translations
  SET
    status = 'failed',
    lease_token = NULL,
    lease_expires_at = NULL,
    error_code = 'provider_failed',
    updated_at = NOW()
  WHERE translations.user_id = p_user_id
    AND translations.target_language = p_target_language
    AND translations.lease_token = p_lease_token
    AND translations.status = 'processing'
    AND translations.comment_id = ANY(p_comment_ids)
  RETURNING translations.comment_id;
$$;

REVOKE ALL ON FUNCTION public.consume_social_comment_translation_quota(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_social_comment_translations(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_social_comment_translations(UUID, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_social_comment_translation_quota(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_social_comment_translations(UUID, TEXT, TEXT, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_social_comment_translations(UUID, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) TO service_role;

ALTER TABLE public.social_comment_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own social comment translations"
  ON public.social_comment_translations;

CREATE POLICY "Users can view their own social comment translations"
  ON public.social_comment_translations
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.social_comment_translations IS 'Per-user cached translations for the unified social_comments table.';
COMMENT ON COLUMN public.social_comment_translations.source_message_hash IS 'SHA-256 of the complete source message; a mismatch invalidates the cached translation.';
