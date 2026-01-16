-- TikTok Publishing Feature Database Schema
-- Run this in Supabase SQL Editor

-- Table 1: TikTok Auth States (Temporary OAuth state storage)
CREATE TABLE IF NOT EXISTS tiktok_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for state lookup
CREATE INDEX IF NOT EXISTS idx_tiktok_auth_states_state ON tiktok_auth_states(state);

-- Auto-cleanup expired states (optional trigger)
CREATE OR REPLACE FUNCTION cleanup_expired_auth_states()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM tiktok_auth_states WHERE expires_at < NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Table 2: TikTok Accounts
CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- TikTok identity
  open_id TEXT NOT NULL,
  union_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  
  -- Stats (updated periodically)
  follower_count INT DEFAULT 0,
  following_count INT DEFAULT 0,
  likes_count INT DEFAULT 0,
  video_count INT DEFAULT 0,
  
  -- OAuth tokens (should be encrypted in production)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes JSONB DEFAULT '[]',
  
  -- Account type and status
  account_type TEXT DEFAULT 'normal' CHECK (account_type IN ('normal', 'shop_creator', 'business')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, open_id)
);

-- Indexes for tiktok_accounts
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_user_id ON tiktok_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_status ON tiktok_accounts(status);

-- Table 3: Publish Tasks
CREATE TABLE IF NOT EXISTS publish_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Task info
  task_name TEXT,
  publish_type TEXT DEFAULT 'normal' CHECK (publish_type IN ('normal', 'shop_product')),
  
  -- Publish settings
  title_template TEXT,
  privacy_level TEXT DEFAULT 'PUBLIC_TO_EVERYONE',
  allow_comment BOOLEAN DEFAULT true,
  allow_duet BOOLEAN DEFAULT true,
  allow_stitch BOOLEAN DEFAULT true,
  brand_content_toggle BOOLEAN DEFAULT false,
  brand_organic_toggle BOOLEAN DEFAULT false,
  is_aigc BOOLEAN DEFAULT false,
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ,
  batch_interval_seconds INT DEFAULT 300,
  
  -- Status and stats
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'running', 'completed', 'partial_failed', 'failed', 'cancelled')),
  total_items INT DEFAULT 0,
  success_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  
  -- Shop product info (for future use)
  product_info JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for publish_tasks
CREATE INDEX IF NOT EXISTS idx_publish_tasks_user_id ON publish_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_status ON publish_tasks(status);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_scheduled_at ON publish_tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Table 4: Publish Task Items
CREATE TABLE IF NOT EXISTS publish_task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES publish_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  
  -- Video info
  video_url TEXT NOT NULL,
  video_source TEXT CHECK (video_source IN ('assets', 'upload', 'url')),
  source_asset_id UUID,
  
  -- Publish content
  title TEXT NOT NULL,
  
  -- TikTok API response
  tiktok_publish_id TEXT,
  tiktok_share_id TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'failed')),
  error_code TEXT,
  error_message TEXT,
  
  -- Timestamps
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for publish_task_items
CREATE INDEX IF NOT EXISTS idx_publish_task_items_task_id ON publish_task_items(task_id);
CREATE INDEX IF NOT EXISTS idx_publish_task_items_account_id ON publish_task_items(account_id);
CREATE INDEX IF NOT EXISTS idx_publish_task_items_status ON publish_task_items(status);

-- Enable Row Level Security (RLS)
ALTER TABLE tiktok_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_task_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tiktok_auth_states
CREATE POLICY "Users can manage their own auth states"
  ON tiktok_auth_states
  FOR ALL
  USING (auth.uid() = user_id);

-- RLS Policies for tiktok_accounts
CREATE POLICY "Users can view their own TikTok accounts"
  ON tiktok_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own TikTok accounts"
  ON tiktok_accounts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own TikTok accounts"
  ON tiktok_accounts
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own TikTok accounts"
  ON tiktok_accounts
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for publish_tasks
CREATE POLICY "Users can manage their own publish tasks"
  ON publish_tasks
  FOR ALL
  USING (auth.uid() = user_id);

-- RLS Policies for publish_task_items (based on parent task)
CREATE POLICY "Users can view their own publish task items"
  ON publish_task_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
      AND publish_tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own publish task items"
  ON publish_task_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
      AND publish_tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own publish task items"
  ON publish_task_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
      AND publish_tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own publish task items"
  ON publish_task_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM publish_tasks
      WHERE publish_tasks.id = publish_task_items.task_id
      AND publish_tasks.user_id = auth.uid()
    )
  );

-- Grant service role access for API routes
-- Note: Service role bypasses RLS, so API routes can manage data

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'TikTok publishing database schema created successfully!';
END $$;
