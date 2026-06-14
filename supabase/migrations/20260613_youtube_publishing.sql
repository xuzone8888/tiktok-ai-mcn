-- YouTube Publishing Feature Database Schema
-- Independent from TikTok publishing tables.

CREATE TABLE IF NOT EXISTS public.youtube_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  error_code TEXT,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_auth_states_state ON public.youtube_auth_states(state);

CREATE INDEX IF NOT EXISTS idx_youtube_auth_states_user_created ON public.youtube_auth_states(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_auth_states_pending_expiry ON public.youtube_auth_states(status, expires_at);

CREATE TABLE IF NOT EXISTS public.youtube_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  channel_handle TEXT,
  thumbnail_url TEXT,

  subscriber_count BIGINT DEFAULT 0,
  video_count BIGINT DEFAULT 0,
  view_count BIGINT DEFAULT 0,

  access_token_expires_at TIMESTAMPTZ,
  scopes JSONB NOT NULL DEFAULT '[]',

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_user_id ON public.youtube_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_status ON public.youtube_accounts(status);

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_access_token_expires_at ON public.youtube_accounts(access_token_expires_at);

CREATE TABLE IF NOT EXISTS public.youtube_account_tokens (
  account_id UUID PRIMARY KEY REFERENCES public.youtube_accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_account_tokens_expires_at ON public.youtube_account_tokens(access_token_expires_at);

CREATE TABLE IF NOT EXISTS public.youtube_publish_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  task_name TEXT,
  title_template TEXT,
  description_template TEXT,
  privacy_status TEXT NOT NULL DEFAULT 'private' CHECK (privacy_status IN ('private', 'unlisted', 'public')),
  category_id TEXT NOT NULL DEFAULT '22',
  tags JSONB NOT NULL DEFAULT '[]',
  made_for_kids BOOLEAN NOT NULL DEFAULT FALSE,
  contains_synthetic_media BOOLEAN NOT NULL DEFAULT TRUE,
  notify_subscribers BOOLEAN NOT NULL DEFAULT FALSE,

  scheduled_at TIMESTAMPTZ,
  batch_interval_seconds INT NOT NULL DEFAULT 300,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'processing', 'completed', 'partial_failed', 'failed', 'cancelled')),
  total_items INT NOT NULL DEFAULT 0,
  pending_count INT NOT NULL DEFAULT 0,
  published_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_tasks_user_created ON public.youtube_publish_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_tasks_status ON public.youtube_publish_tasks(status);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_tasks_scheduled ON public.youtube_publish_tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.youtube_publish_task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.youtube_publish_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.youtube_accounts(id) ON DELETE CASCADE,

  video_url TEXT NOT NULL,
  video_source TEXT NOT NULL DEFAULT 'upload' CHECK (video_source IN ('assets', 'upload', 'url')),
  source_asset_id UUID,
  source_video_id TEXT,
  source_video_name TEXT,

  title TEXT NOT NULL,
  description TEXT,

  youtube_video_id TEXT,
  youtube_watch_url TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'failed', 'cancelled')),
  error_code TEXT,
  error_message TEXT,

  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  publish_attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_task_items_task_id ON public.youtube_publish_task_items(task_id);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_task_items_account_id ON public.youtube_publish_task_items(account_id);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_task_items_status ON public.youtube_publish_task_items(status);

CREATE INDEX IF NOT EXISTS idx_youtube_publish_task_items_due ON public.youtube_publish_task_items(scheduled_at, status);

ALTER TABLE public.youtube_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_account_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_publish_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_publish_task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own YouTube accounts"
  ON public.youtube_accounts;
DROP POLICY IF EXISTS "Users can manage their own YouTube publish tasks"
  ON public.youtube_publish_tasks;
DROP POLICY IF EXISTS "Users can view their own YouTube publish items"
  ON public.youtube_publish_task_items;
DROP POLICY IF EXISTS "Users can insert their own YouTube publish items"
  ON public.youtube_publish_task_items;
DROP POLICY IF EXISTS "Users can update their own YouTube publish items"
  ON public.youtube_publish_task_items;
DROP POLICY IF EXISTS "Users can delete their own YouTube publish items"
  ON public.youtube_publish_task_items;

CREATE POLICY "Users can view their own YouTube accounts"
  ON public.youtube_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own YouTube publish tasks"
  ON public.youtube_publish_tasks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own YouTube publish items"
  ON public.youtube_publish_task_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_publish_tasks
      WHERE youtube_publish_tasks.id = youtube_publish_task_items.task_id
        AND youtube_publish_tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own YouTube publish items"
  ON public.youtube_publish_task_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.youtube_publish_tasks
      WHERE youtube_publish_tasks.id = youtube_publish_task_items.task_id
        AND youtube_publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.youtube_accounts
      WHERE youtube_accounts.id = youtube_publish_task_items.account_id
        AND youtube_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own YouTube publish items"
  ON public.youtube_publish_task_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_publish_tasks
      WHERE youtube_publish_tasks.id = youtube_publish_task_items.task_id
        AND youtube_publish_tasks.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.youtube_publish_tasks
      WHERE youtube_publish_tasks.id = youtube_publish_task_items.task_id
        AND youtube_publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.youtube_accounts
      WHERE youtube_accounts.id = youtube_publish_task_items.account_id
        AND youtube_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own YouTube publish items"
  ON public.youtube_publish_task_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.youtube_publish_tasks
      WHERE youtube_publish_tasks.id = youtube_publish_task_items.task_id
        AND youtube_publish_tasks.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.youtube_auth_states IS 'Service-role-only OAuth PKCE state storage for YouTube account binding.';
COMMENT ON TABLE public.youtube_accounts IS 'YouTube channel bindings for video publishing. Separate from TikTok accounts.';
COMMENT ON TABLE public.youtube_account_tokens IS 'Service-role-only YouTube OAuth token storage. No user RLS policies are granted.';
COMMENT ON TABLE public.youtube_publish_tasks IS 'YouTube video publish task groups. Separate from TikTok publish_tasks.';
COMMENT ON TABLE public.youtube_publish_task_items IS 'Individual YouTube upload/publish task items.';
