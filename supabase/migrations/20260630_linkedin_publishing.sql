-- LinkedIn Publishing Feature Database Schema
-- Independent from TikTok, YouTube, Facebook, and Instagram publishing tables.

CREATE TABLE IF NOT EXISTS public.linkedin_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  error_code TEXT,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_auth_states_state
  ON public.linkedin_auth_states(state);

CREATE INDEX IF NOT EXISTS idx_linkedin_auth_states_user_created
  ON public.linkedin_auth_states(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_auth_states_pending_expiry
  ON public.linkedin_auth_states(status, expires_at);

CREATE TABLE IF NOT EXISTS public.linkedin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  owner_urn TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'member' CHECK (owner_type = 'member'),
  localized_name TEXT NOT NULL,
  vanity_name TEXT,
  avatar_url TEXT,

  follower_count BIGINT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  scopes JSONB NOT NULL DEFAULT '[]',
  access_token_expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, owner_urn)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_user_id
  ON public.linkedin_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_status
  ON public.linkedin_accounts(status);

CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_owner_type
  ON public.linkedin_accounts(owner_type);

CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_access_token_expires_at
  ON public.linkedin_accounts(access_token_expires_at);

CREATE TABLE IF NOT EXISTS public.linkedin_account_tokens (
  account_id UUID PRIMARY KEY REFERENCES public.linkedin_accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_account_tokens_expires_at
  ON public.linkedin_account_tokens(access_token_expires_at);

CREATE TABLE IF NOT EXISTS public.linkedin_publish_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  task_name TEXT,
  title_template TEXT,
  description_template TEXT,
  privacy_status TEXT NOT NULL DEFAULT 'public' CHECK (privacy_status IN ('public')),
  category_id TEXT NOT NULL DEFAULT 'linkedin',
  tags JSONB NOT NULL DEFAULT '[]',
  made_for_kids BOOLEAN NOT NULL DEFAULT FALSE,
  contains_synthetic_media BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_tasks_user_created
  ON public.linkedin_publish_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_tasks_status
  ON public.linkedin_publish_tasks(status);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_tasks_scheduled
  ON public.linkedin_publish_tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.linkedin_publish_task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.linkedin_publish_tasks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.linkedin_accounts(id) ON DELETE CASCADE,

  video_url TEXT NOT NULL,
  video_source TEXT NOT NULL DEFAULT 'upload' CHECK (video_source IN ('assets', 'upload', 'url')),
  source_asset_id UUID,
  source_video_id TEXT,
  source_video_name TEXT,

  title TEXT NOT NULL,
  description TEXT,

  linkedin_post_urn TEXT,
  linkedin_share_url TEXT,
  upload_asset_urn TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'failed', 'cancelled')),
  error_code TEXT,
  error_message TEXT,

  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  video_processing_started_at TIMESTAMPTZ,
  processing_poll_count INT NOT NULL DEFAULT 0,
  last_video_status TEXT,
  publish_attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_task_items_task_id
  ON public.linkedin_publish_task_items(task_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_task_items_account_id
  ON public.linkedin_publish_task_items(account_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_task_items_status
  ON public.linkedin_publish_task_items(status);

CREATE INDEX IF NOT EXISTS idx_linkedin_publish_task_items_due
  ON public.linkedin_publish_task_items(scheduled_at, status);

ALTER TABLE public.linkedin_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_account_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_publish_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_publish_task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own LinkedIn accounts"
  ON public.linkedin_accounts;
DROP POLICY IF EXISTS "Users can manage their own LinkedIn publish tasks"
  ON public.linkedin_publish_tasks;
DROP POLICY IF EXISTS "Users can view their own LinkedIn publish items"
  ON public.linkedin_publish_task_items;
DROP POLICY IF EXISTS "Users can insert their own LinkedIn publish items"
  ON public.linkedin_publish_task_items;
DROP POLICY IF EXISTS "Users can update their own LinkedIn publish items"
  ON public.linkedin_publish_task_items;
DROP POLICY IF EXISTS "Users can delete their own LinkedIn publish items"
  ON public.linkedin_publish_task_items;

CREATE POLICY "Users can view their own LinkedIn accounts"
  ON public.linkedin_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own LinkedIn publish tasks"
  ON public.linkedin_publish_tasks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own LinkedIn publish items"
  ON public.linkedin_publish_task_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.linkedin_publish_tasks
      WHERE linkedin_publish_tasks.id = linkedin_publish_task_items.task_id
        AND linkedin_publish_tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own LinkedIn publish items"
  ON public.linkedin_publish_task_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.linkedin_publish_tasks
      WHERE linkedin_publish_tasks.id = linkedin_publish_task_items.task_id
        AND linkedin_publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.linkedin_accounts
      WHERE linkedin_accounts.id = linkedin_publish_task_items.account_id
        AND linkedin_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own LinkedIn publish items"
  ON public.linkedin_publish_task_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.linkedin_publish_tasks
      WHERE linkedin_publish_tasks.id = linkedin_publish_task_items.task_id
        AND linkedin_publish_tasks.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.linkedin_publish_tasks
      WHERE linkedin_publish_tasks.id = linkedin_publish_task_items.task_id
        AND linkedin_publish_tasks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.linkedin_accounts
      WHERE linkedin_accounts.id = linkedin_publish_task_items.account_id
        AND linkedin_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own LinkedIn publish items"
  ON public.linkedin_publish_task_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.linkedin_publish_tasks
      WHERE linkedin_publish_tasks.id = linkedin_publish_task_items.task_id
        AND linkedin_publish_tasks.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.linkedin_auth_states IS 'Service-role-only OAuth state storage for LinkedIn account binding.';
COMMENT ON TABLE public.linkedin_accounts IS 'LinkedIn member identities available for publishing.';
COMMENT ON TABLE public.linkedin_account_tokens IS 'Service-role-only LinkedIn OAuth token storage. No user RLS policies are granted.';
COMMENT ON TABLE public.linkedin_publish_tasks IS 'LinkedIn video publish task groups.';
COMMENT ON TABLE public.linkedin_publish_task_items IS 'Individual LinkedIn upload and post task items.';
