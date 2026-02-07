-- ============================================================================
-- 20260206_add_generations_group_name.sql
-- 为 generations 表添加 group_name 字段以支持任务分组
-- ============================================================================

-- 添加分组名称字段
ALTER TABLE generations 
ADD COLUMN IF NOT EXISTS group_name VARCHAR(255) DEFAULT '默认';

-- 创建复合索引优化按用户+分组查询
CREATE INDEX IF NOT EXISTS idx_generations_group_name 
ON generations(user_id, group_name);

-- 添加注释
COMMENT ON COLUMN generations.group_name IS '任务分组名称，用于批量任务的归类管理';
