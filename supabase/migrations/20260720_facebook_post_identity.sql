-- Facebook video uploads return a Video node ID, while Page feed webhooks
-- identify comments by the containing Page Post ID. Persist both identities.

ALTER TABLE public.facebook_publish_task_items
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_facebook_publish_task_items_account_post
  ON public.facebook_publish_task_items(account_id, facebook_post_id)
  WHERE facebook_post_id IS NOT NULL;

COMMENT ON COLUMN public.facebook_publish_task_items.facebook_post_id IS
  'Composite Page Post ID returned by the published Facebook Video node; used to map Page feed comment webhooks.';
