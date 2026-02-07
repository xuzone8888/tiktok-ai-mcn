-- ============================================================================
-- get_user_task_stats: 高效统计用户任务数据
-- 
-- 功能: 在数据库层面聚合 generations + ecom_image_tasks 两张表的统计信息
--       一条 SQL 返回全部统计数据，无行数上限，避免拉取大量数据到应用层
-- 
-- 参数:
--   p_user_id     - 用户 ID
--   p_start_date  - 开始时间（可选）
--   p_end_date    - 结束时间（可选）
--   p_type        - 类型过滤: all / video / image
--   p_source      - 来源过滤: all / quick_gen / batch_video / ...
--   p_status      - 状态过滤: all / completed / failed / processing
--   p_group_name  - 分组过滤: all / 具体分组名
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_task_stats(
  p_user_id     uuid,
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL,
  p_type        text DEFAULT 'all',
  p_source      text DEFAULT 'all',
  p_status      text DEFAULT 'all',
  p_group_name  text DEFAULT 'all'
) RETURNS json AS $$
DECLARE
  result json;
BEGIN
  WITH all_tasks AS (
    -- ===== generations 表 =====
    SELECT
      status,
      type,
      COALESCE(credit_cost, 0) AS credits
    FROM generations
    WHERE user_id = p_user_id
      AND (p_start_date IS NULL OR created_at >= p_start_date)
      AND (p_end_date   IS NULL OR created_at <= p_end_date)
      AND (p_type   = 'all' OR type   = p_type)
      AND (p_source = 'all' OR source = p_source)
      AND (p_status = 'all' OR status = p_status)
      AND (p_group_name = 'all' OR group_name = p_group_name)
      -- 排除电商来源专属筛选（当来源=ecom_factory时跳过此表）
      AND p_source != 'ecom_factory'

    UNION ALL

    -- ===== ecom_image_tasks 表 =====
    SELECT
      CASE
        WHEN eit.status IN ('success', 'partial_success') THEN 'completed'
        WHEN eit.status = 'failed' THEN 'failed'
        ELSE 'processing'
      END AS status,
      'image' AS type,
      COALESCE(eit.credits_cost, 0) AS credits
    FROM ecom_image_tasks eit
    WHERE eit.user_id = p_user_id
      AND (p_start_date IS NULL OR eit.created_at >= p_start_date)
      AND (p_end_date   IS NULL OR eit.created_at <= p_end_date)
      -- ecom 固定为 image 类型
      AND p_type IN ('all', 'image')
      -- ecom 来源过滤
      AND (p_source IN ('all', 'ecom_factory'))
      -- ecom 状态映射过滤
      AND (
        p_status = 'all'
        OR (p_status = 'completed'  AND eit.status IN ('success', 'partial_success'))
        OR (p_status = 'failed'     AND eit.status = 'failed')
        OR (p_status = 'processing' AND eit.status IN ('created', 'generating_prompts', 'generating_images'))
      )
      -- ecom 表没有 group_name，当按分组筛选时跳过
      AND p_group_name = 'all'
  )
  SELECT json_build_object(
    'totalTasks',      COUNT(*),
    'completedTasks',  COUNT(*) FILTER (WHERE status = 'completed'),
    'failedTasks',     COUNT(*) FILTER (WHERE status = 'failed'),
    'processingTasks', COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed')),
    'totalVideos',     COUNT(*) FILTER (WHERE type = 'video'),
    'totalImages',     COUNT(*) FILTER (WHERE type = 'image'),
    'totalCreditsUsed', COALESCE(SUM(credits), 0)
  ) INTO result
  FROM all_tasks;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
