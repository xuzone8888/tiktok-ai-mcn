-- Fence TikTok video-stat writes to the exact account/video binding that was
-- queried. Provider requests happen outside the database transaction, so an
-- item may otherwise be rebound while a response is in flight (ABA/stale write).

CREATE OR REPLACE FUNCTION public.apply_tiktok_task_video_stats(
  p_task_id UUID,
  p_user_id UUID,
  p_updates JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_owner UUID;
  requested_count INTEGER := 0;
  distinct_count INTEGER := 0;
  updated_count INTEGER := 0;
  total_views_value BIGINT := 0;
  total_likes_value BIGINT := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_updates, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'TikTok video stat updates must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO task_owner
  FROM public.publish_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF task_owner IS NULL OR task_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'TikTok publish task not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT item_id)
  INTO requested_count, distinct_count
  FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
    item_id UUID,
    account_id UUID,
    tiktok_video_id TEXT,
    view_count BIGINT,
    like_count BIGINT,
    comment_count BIGINT,
    share_count BIGINT
  );

  IF requested_count <> distinct_count THEN
    RAISE EXCEPTION 'Duplicate TikTok task item stat update'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
      item_id UUID,
      account_id UUID,
      tiktok_video_id TEXT,
      view_count BIGINT,
      like_count BIGINT,
      comment_count BIGINT,
      share_count BIGINT
    )
    LEFT JOIN public.publish_task_items AS item
      ON item.id = update_row.item_id
      AND item.task_id = p_task_id
      AND item.status = 'published'
      AND item.account_id = update_row.account_id
      AND item.tiktok_video_id = update_row.tiktok_video_id
    WHERE item.id IS NULL
      OR update_row.account_id IS NULL
      OR update_row.tiktok_video_id IS NULL
      OR BTRIM(update_row.tiktok_video_id) = ''
      OR LENGTH(update_row.tiktok_video_id) > 256
      OR update_row.view_count IS NULL
      OR update_row.like_count IS NULL
      OR update_row.comment_count IS NULL
      OR update_row.share_count IS NULL
      OR update_row.view_count < 0
      OR update_row.like_count < 0
      OR update_row.comment_count < 0
      OR update_row.share_count < 0
      OR update_row.view_count > 9007199254740991
      OR update_row.like_count > 9007199254740991
      OR update_row.comment_count > 9007199254740991
      OR update_row.share_count > 9007199254740991
  ) THEN
    RAISE EXCEPTION 'Invalid or stale TikTok task item stat update'
      USING ERRCODE = '23514';
  END IF;

  WITH requested AS (
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
      item_id UUID,
      account_id UUID,
      tiktok_video_id TEXT,
      view_count BIGINT,
      like_count BIGINT,
      comment_count BIGINT,
      share_count BIGINT
    )
  ),
  updated AS (
    UPDATE public.publish_task_items AS item
    SET
      view_count = requested.view_count,
      like_count = requested.like_count,
      comment_count = requested.comment_count,
      share_count = requested.share_count,
      stats_updated_at = NOW()
    FROM requested
    WHERE item.id = requested.item_id
      AND item.task_id = p_task_id
      AND item.status = 'published'
      AND item.account_id = requested.account_id
      AND item.tiktok_video_id = requested.tiktok_video_id
    RETURNING item.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  -- Defensive parity check: validation and update run in one transaction under
  -- the task lock, so any mismatch must fail without publishing new totals.
  IF updated_count <> requested_count THEN
    RAISE EXCEPTION 'TikTok task item binding changed during stat update'
      USING ERRCODE = '40001';
  END IF;

  SELECT
    COALESCE(SUM(item.view_count), 0),
    COALESCE(SUM(item.like_count), 0)
  INTO total_views_value, total_likes_value
  FROM public.publish_task_items AS item
  WHERE item.task_id = p_task_id
    AND item.status = 'published';

  UPDATE public.publish_tasks
  SET
    total_views = total_views_value,
    total_likes = total_likes_value
  WHERE id = p_task_id
    AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'updated_count', updated_count,
    'total_views', total_views_value,
    'total_likes', total_likes_value
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_tiktok_task_video_stats(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_tiktok_task_video_stats(UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.apply_tiktok_task_video_stats(UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_tiktok_task_video_stats(UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.apply_tiktok_task_video_stats(UUID, UUID, JSONB) IS
  'Atomically applies complete TikTok stats only when each account/video binding still matches the provider request snapshot.';
