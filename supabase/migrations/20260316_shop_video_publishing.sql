-- TikTok Shop Video Publishing Schema
-- Migration: 20260316_shop_video_publishing
--
-- Creates tables for the Shop 橱窗视频发布 module:
--   1. shop_publish_tasks     — batch publish tasks
--   2. shop_publish_task_items — individual video items within a task
--
-- Also modifies tiktok_auth_states to support Shop OAuth (no PKCE = no code_verifier)

-- ============================================================
-- 1. Modify existing table: Allow NULL code_verifier for Shop OAuth
-- ============================================================
-- Shop OAuth does NOT use PKCE, so code_verifier is not needed.
-- The existing Content API OAuth still uses PKCE with NOT NULL.
-- Changing to nullable to support both flows.

ALTER TABLE tiktok_auth_states
  ALTER COLUMN code_verifier DROP NOT NULL;

-- ⚠️ Add refresh_token_expires_at to tiktok_accounts
-- Shop OAuth refresh tokens have a finite expiry (set by the seller/creator).
-- Content API didn't need this because its refresh tokens are long-lived/infinite.
ALTER TABLE tiktok_accounts
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;

-- ============================================================
-- 2. Create shop_publish_tasks table
-- ============================================================

CREATE TABLE shop_publish_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_name TEXT,
  title_template TEXT,
  total_items INT DEFAULT 0,
  success_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'partial_failed', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 3. Create shop_publish_task_items table
-- ============================================================

CREATE TABLE shop_publish_task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES shop_publish_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,

  -- Video info
  video_url TEXT NOT NULL,
  video_source TEXT CHECK (video_source IN ('assets', 'upload', 'url')),
  title TEXT NOT NULL,

  -- Product info (API supports single product only)
  product_id TEXT NOT NULL,
  product_anchor_title TEXT,

  -- Shop API returned IDs (populated during processing)
  file_id TEXT,
  video_id TEXT,
  precheck_id TEXT,

  -- Precheck status
  precheck_status TEXT DEFAULT 'none'
    CHECK (precheck_status IN ('none', 'pending', 'passed', 'warning', 'rejected')),

  -- Processing status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'prechecking', 'publishing', 'published', 'failed')),
  error_message TEXT,

  -- Timestamps
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. Indexes
-- ============================================================

CREATE INDEX idx_shop_tasks_user_id ON shop_publish_tasks(user_id);
CREATE INDEX idx_shop_tasks_status ON shop_publish_tasks(status);
CREATE INDEX idx_shop_items_task_id ON shop_publish_task_items(task_id);
CREATE INDEX idx_shop_items_status ON shop_publish_task_items(status);

-- ============================================================
-- 5. Row Level Security
-- ============================================================

ALTER TABLE shop_publish_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_publish_task_items ENABLE ROW LEVEL SECURITY;

-- Tasks: users can only access their own tasks
CREATE POLICY "shop_tasks_user_policy" ON shop_publish_tasks
  FOR ALL USING (auth.uid() = user_id);

-- Items: access controlled through parent task's user_id
CREATE POLICY "shop_items_select" ON shop_publish_task_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM shop_publish_tasks
    WHERE shop_publish_tasks.id = shop_publish_task_items.task_id
    AND shop_publish_tasks.user_id = auth.uid()
  ));

CREATE POLICY "shop_items_insert" ON shop_publish_task_items
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM shop_publish_tasks
    WHERE shop_publish_tasks.id = shop_publish_task_items.task_id
    AND shop_publish_tasks.user_id = auth.uid()
  ));

CREATE POLICY "shop_items_update" ON shop_publish_task_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM shop_publish_tasks
    WHERE shop_publish_tasks.id = shop_publish_task_items.task_id
    AND shop_publish_tasks.user_id = auth.uid()
  ));

CREATE POLICY "shop_items_delete" ON shop_publish_task_items
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM shop_publish_tasks
    WHERE shop_publish_tasks.id = shop_publish_task_items.task_id
    AND shop_publish_tasks.user_id = auth.uid()
  ));
