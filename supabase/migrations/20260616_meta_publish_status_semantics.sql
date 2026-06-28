-- Meta publishing status semantics.
-- Facebook unpublished uploads create manageable drafts, not published videos.
-- Instagram unpublished containers are not public posts and should not be counted as published.

ALTER TABLE public.facebook_publish_task_items
  DROP CONSTRAINT IF EXISTS facebook_publish_task_items_status_check;

ALTER TABLE public.facebook_publish_task_items
  ADD CONSTRAINT facebook_publish_task_items_status_check
  CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'draft_created', 'failed', 'cancelled'));

ALTER TABLE public.instagram_publish_task_items
  DROP CONSTRAINT IF EXISTS instagram_publish_task_items_status_check;

ALTER TABLE public.instagram_publish_task_items
  ADD CONSTRAINT instagram_publish_task_items_status_check
  CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'container_created', 'failed', 'cancelled'));
