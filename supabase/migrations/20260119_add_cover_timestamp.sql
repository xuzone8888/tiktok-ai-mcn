-- Add cover_timestamp_ms column for video cover selection
-- This timestamp is passed to TikTok API as video_cover_timestamp_ms

ALTER TABLE publish_task_items 
ADD COLUMN IF NOT EXISTS cover_timestamp_ms INTEGER;

COMMENT ON COLUMN publish_task_items.cover_timestamp_ms IS 'Video cover frame timestamp in milliseconds';
