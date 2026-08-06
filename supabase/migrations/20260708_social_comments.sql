-- Unified social comment storage for published platform content.
-- Keeps platform-specific publish/account tables unchanged.

CREATE TABLE IF NOT EXISTS public.social_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook')),
  account_id UUID NOT NULL,
  task_item_id UUID,

  external_content_id TEXT NOT NULL,
  external_comment_id TEXT NOT NULL,
  parent_external_comment_id TEXT,
  thread_external_id TEXT,

  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  author_id TEXT,
  author_name TEXT,
  author_avatar_url TEXT,
  message TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  can_reply BOOLEAN NOT NULL DEFAULT TRUE,
  is_from_account BOOLEAN NOT NULL DEFAULT FALSE,
  permalink TEXT,

  status TEXT NOT NULL DEFAULT 'synced'
    CHECK (status IN ('synced', 'sending', 'sent', 'failed', 'unsupported', 'deleted', 'hidden')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  remote_created_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reply_to_comment_id UUID REFERENCES public.social_comments(id) ON DELETE SET NULL,
  local_error_code TEXT,
  local_error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, platform, account_id, external_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comments_user_platform_created
  ON public.social_comments(user_id, platform, COALESCE(remote_created_at, created_at) DESC);

CREATE INDEX IF NOT EXISTS idx_social_comments_account_content
  ON public.social_comments(user_id, platform, account_id, external_content_id);

CREATE INDEX IF NOT EXISTS idx_social_comments_parent
  ON public.social_comments(user_id, platform, account_id, parent_external_comment_id)
  WHERE parent_external_comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_comments_reply_to
  ON public.social_comments(reply_to_comment_id)
  WHERE reply_to_comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.social_comment_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook')),
  account_id UUID,
  external_content_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'unsupported')),
  synced_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_comment_sync_runs_user_created
  ON public.social_comment_sync_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_comment_sync_runs_target
  ON public.social_comment_sync_runs(user_id, platform, account_id, external_content_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.social_comment_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook')),
  account_id UUID,
  external_content_id TEXT,
  external_comment_id TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('sync', 'reply', 'permission_error', 'token_error')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'sent', 'completed', 'failed', 'unsupported')),
  idempotency_key TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  UNIQUE(user_id, action_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_social_comment_action_logs_user_created
  ON public.social_comment_action_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_comment_action_logs_target
  ON public.social_comment_action_logs(user_id, platform, account_id, external_comment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_comment_action_logs_sync_target
  ON public.social_comment_action_logs(user_id, platform, account_id, action_type, external_content_id, status, created_at DESC);

ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_comment_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_comment_action_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own social comments"
  ON public.social_comments;
DROP POLICY IF EXISTS "Users can manage their own social comment sync runs"
  ON public.social_comment_sync_runs;
DROP POLICY IF EXISTS "Users can view their own social comments"
  ON public.social_comments;
DROP POLICY IF EXISTS "Users can view their own social comment sync runs"
  ON public.social_comment_sync_runs;
DROP POLICY IF EXISTS "Users can view their own social comment action logs"
  ON public.social_comment_action_logs;

CREATE POLICY "Users can view their own social comments"
  ON public.social_comments
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own social comment sync runs"
  ON public.social_comment_sync_runs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own social comment action logs"
  ON public.social_comment_action_logs
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.social_comments IS 'Unified cache for YouTube, TikTok, Instagram, and Facebook comments and replies.';
COMMENT ON COLUMN public.social_comments.account_id IS 'Platform account UUID; references the matching platform account table by platform.';
COMMENT ON COLUMN public.social_comments.task_item_id IS 'Optional platform publish task item UUID; references the matching platform task item table by platform.';
COMMENT ON COLUMN public.social_comments.direction IS 'inbound for platform comments, outbound for replies sent by this app.';
COMMENT ON TABLE public.social_comment_sync_runs IS 'Audit trail for manual comment sync attempts.';
COMMENT ON TABLE public.social_comment_action_logs IS 'Service-role-written audit and idempotency log for social comment sync/reply actions.';
