-- =========================================================
-- 1. 获取用户所有不重复的分组名称（DISTINCT，无行数限制）
-- =========================================================
CREATE OR REPLACE FUNCTION get_user_group_names(p_user_id uuid)
RETURNS TABLE(group_name text) AS $$
  SELECT DISTINCT g.group_name
  FROM generations g
  WHERE g.user_id = p_user_id
    AND g.group_name IS NOT NULL
    AND g.group_name != '默认'
  ORDER BY g.group_name;
$$ LANGUAGE sql STABLE;

-- NOTE: get_user_task_stats 定义已移至 20260207_task_stats_rpc.sql
-- 新版本覆盖 generations + ecom_image_tasks 两张表，返回 JSON 格式
