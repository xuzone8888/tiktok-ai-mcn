-- Migration: Task Group Redesign
-- Add task name field, statistics cache, and performance indexes

-- 1. Add task group name (required field)
ALTER TABLE publish_tasks 
ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT '未命名任务组';

-- 2. Add statistics cache fields
ALTER TABLE publish_tasks 
ADD COLUMN IF NOT EXISTS published_count INT DEFAULT 0;

ALTER TABLE publish_tasks 
ADD COLUMN IF NOT EXISTS pending_count INT DEFAULT 0;

ALTER TABLE publish_tasks 
ADD COLUMN IF NOT EXISTS failed_count INT DEFAULT 0;

-- 3. Add status column for cancelled tasks if not exists  
-- (publish_tasks likely already has status, but ensure cancelled is valid)

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_publish_tasks_user_status 
ON publish_tasks(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_publish_task_items_task_status 
ON publish_task_items(task_id, status);

CREATE INDEX IF NOT EXISTS idx_publish_task_items_scheduled 
ON publish_task_items(scheduled_at) 
WHERE status = 'scheduled';

-- 5. Initialize statistics for existing data
UPDATE publish_tasks pt SET
  published_count = COALESCE((
    SELECT COUNT(*) FROM publish_task_items 
    WHERE task_id = pt.id AND status = 'published'
  ), 0),
  pending_count = COALESCE((
    SELECT COUNT(*) FROM publish_task_items 
    WHERE task_id = pt.id AND status IN ('pending', 'scheduled')
  ), 0),
  failed_count = COALESCE((
    SELECT COUNT(*) FROM publish_task_items 
    WHERE task_id = pt.id AND status = 'failed'
  ), 0)
WHERE published_count = 0 AND pending_count = 0 AND failed_count = 0;
