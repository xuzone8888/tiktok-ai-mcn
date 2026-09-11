-- Resolve the remaining production security-advisor warning without changing
-- the public model projection, and remove DDL-style privileges that browser
-- roles do not need for normal row-level CRUD.

ALTER VIEW public.ai_models_public
  SET (security_invoker = true);

REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE
    public.tiktok_accounts,
    public.publish_tasks,
    public.publish_task_items,
    public.social_comments,
    public.social_comment_sync_runs,
    public.social_comment_action_logs
  FROM anon, authenticated;

