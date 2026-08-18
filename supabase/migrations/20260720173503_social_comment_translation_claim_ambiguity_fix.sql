-- Fix PL/pgSQL ambiguity between the RETURNS TABLE output variable `comment_id`
-- and the social_comment_translations.comment_id conflict target.

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
  ON CONFLICT ON CONSTRAINT social_comment_translations_comment_id_target_language_key
  DO UPDATE SET
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

-- Supabase may grant functions to API roles through default privileges. These
-- SECURITY DEFINER helpers must remain server-only because they accept a user id.
REVOKE ALL ON FUNCTION public.consume_social_comment_translation_quota(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_social_comment_translations(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_social_comment_translations(UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_social_comment_translation_quota(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_social_comment_translations(UUID, TEXT, TEXT, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_social_comment_translations(UUID, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_social_comment_translation_claims(UUID, TEXT, UUID, UUID[]) TO service_role;
