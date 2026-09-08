-- Apply TikTok video statistics and recompute task aggregates under one
-- task-scoped row lock. This prevents concurrent partial sync requests from
-- publishing totals derived from stale item snapshots.

ALTER TABLE public.publish_task_items
  ALTER COLUMN view_count TYPE BIGINT USING view_count::BIGINT,
  ALTER COLUMN like_count TYPE BIGINT USING like_count::BIGINT,
  ALTER COLUMN comment_count TYPE BIGINT USING comment_count::BIGINT,
  ALTER COLUMN share_count TYPE BIGINT USING share_count::BIGINT;

ALTER TABLE public.publish_tasks
  ALTER COLUMN total_views TYPE BIGINT USING total_views::BIGINT,
  ALTER COLUMN total_likes TYPE BIGINT USING total_likes::BIGINT;

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
  updated_count INTEGER := 0;
  total_views_value BIGINT := 0;
  total_likes_value BIGINT := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_updates, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'TikTok video stat updates must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  -- Every stats writer for a task takes this lock before touching items.
  -- Concurrent RPC calls therefore apply patches and aggregate in one order.
  SELECT user_id
  INTO task_owner
  FROM public.publish_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF task_owner IS NULL OR task_owner <> p_user_id THEN
    RAISE EXCEPTION 'TikTok publish task not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT item_id)
  INTO requested_count, updated_count
  FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
    item_id UUID,
    view_count BIGINT,
    like_count BIGINT,
    comment_count BIGINT,
    share_count BIGINT
  );

  IF requested_count <> updated_count THEN
    RAISE EXCEPTION 'Duplicate TikTok task item stat update'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
      item_id UUID,
      view_count BIGINT,
      like_count BIGINT,
      comment_count BIGINT,
      share_count BIGINT
    )
    LEFT JOIN public.publish_task_items AS item
      ON item.id = update_row.item_id
      AND item.task_id = p_task_id
      AND item.status = 'published'
    WHERE item.id IS NULL
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
    RAISE EXCEPTION 'Invalid TikTok task item stat update'
      USING ERRCODE = '23514';
  END IF;

  WITH requested AS (
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_updates, '[]'::JSONB)) AS update_row(
      item_id UUID,
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
    RETURNING item.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

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
  'Atomically applies complete TikTok stats and recomputes task totals under a task row lock.';
