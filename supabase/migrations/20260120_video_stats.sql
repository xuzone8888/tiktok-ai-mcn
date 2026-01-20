-- Video Statistics Sync Feature
-- Adds fields to store video playback statistics from TikTok

-- Add statistics columns to publish_task_items
ALTER TABLE publish_task_items
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS stats_updated_at TIMESTAMPTZ;

-- Add aggregated statistics to publish_tasks for quick display
ALTER TABLE publish_tasks
ADD COLUMN IF NOT EXISTS total_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_likes INTEGER DEFAULT 0;

-- Add index for efficient stats queries
CREATE INDEX IF NOT EXISTS idx_publish_task_items_stats_updated 
ON publish_task_items(stats_updated_at) 
WHERE status = 'published';

-- Add tiktok_video_id column if not exists (for querying TikTok API)
ALTER TABLE publish_task_items
ADD COLUMN IF NOT EXISTS tiktok_video_id TEXT;

COMMENT ON COLUMN publish_task_items.view_count IS 'Total video views from TikTok';
COMMENT ON COLUMN publish_task_items.like_count IS 'Total likes from TikTok';
COMMENT ON COLUMN publish_task_items.comment_count IS 'Total comments from TikTok';
COMMENT ON COLUMN publish_task_items.share_count IS 'Total shares from TikTok';
COMMENT ON COLUMN publish_task_items.stats_updated_at IS 'Last time stats were synced from TikTok';
COMMENT ON COLUMN publish_task_items.tiktok_video_id IS 'TikTok video ID for API queries';
COMMENT ON COLUMN publish_tasks.total_views IS 'Sum of all video views in this task';
COMMENT ON COLUMN publish_tasks.total_likes IS 'Sum of all video likes in this task';
