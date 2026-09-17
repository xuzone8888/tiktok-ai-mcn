-- Additive: application-only access. Apply before enabling private previews.
BEGIN;
CREATE TABLE public.tiktok_task_previews (
  item_id uuid PRIMARY KEY REFERENCES public.publish_task_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  upload_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  video_size bigint NOT NULL CHECK (video_size BETWEEN 1 AND 4294967296),
  video_type text NOT NULL CHECK (video_type IN ('video/mp4','video/webm','video/quicktime')),
  poster_size integer NOT NULL CHECK (poster_size BETWEEN 1 AND 524288),
  ready boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tiktok_task_previews_owner ON public.tiktok_task_previews(owner_id);
-- No FK: deletion work must survive deletion of the user, task and preview row.
CREATE TABLE public.tiktok_preview_cleanup (
  upload_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL
);
ALTER TABLE public.tiktok_task_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiktok_preview_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tiktok_task_previews, public.tiktok_preview_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_task_previews, public.tiktok_preview_cleanup TO service_role;

CREATE FUNCTION public.queue_tiktok_preview_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.tiktok_preview_cleanup(upload_id, owner_id, retain_until)
  VALUES (OLD.upload_id, OLD.owner_id, greatest(now(), OLD.expires_at) + interval '7 days')
  ON CONFLICT (upload_id) DO NOTHING;
  RETURN OLD;
END;
$$;
CREATE TRIGGER tiktok_preview_deleted AFTER DELETE ON public.tiktok_task_previews
FOR EACH ROW EXECUTE FUNCTION public.queue_tiktok_preview_cleanup();

CREATE FUNCTION public.reserve_tiktok_preview(p_user_id uuid, p_item_id uuid, p_poster_size integer)
RETURNS SETOF public.tiktok_task_previews
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item public.publish_task_items; v_existing public.tiktok_task_previews;
BEGIN
  IF p_poster_size IS NULL OR p_poster_size NOT BETWEEN 1 AND 524288 THEN
    RAISE EXCEPTION 'invalid_poster';
  END IF;
  -- Lock order: owner quota, then item. Item FK fences reserve against deletion.
  PERFORM pg_advisory_xact_lock(hashtextextended('tiktok-preview:' || p_user_id::text, 0));
  SELECT i.* INTO v_item FROM public.publish_task_items i
  JOIN public.publish_tasks t ON t.id = i.task_id
  WHERE i.id = p_item_id AND t.user_id = p_user_id AND i.tiktok_transfer_method = 'FILE_UPLOAD'
  FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'preview_item_not_found'; END IF;
  SELECT * INTO v_existing FROM public.tiktok_task_previews WHERE item_id = p_item_id FOR UPDATE;
  IF FOUND AND (v_existing.ready OR v_existing.expires_at > now()) THEN
    IF NOT v_existing.ready AND v_existing.poster_size <> p_poster_size THEN
      RAISE EXCEPTION 'preview_metadata_conflict';
    END IF;
    RETURN NEXT v_existing; RETURN;
  END IF;
  DELETE FROM public.tiktok_task_previews WHERE item_id = p_item_id;
  IF (SELECT count(*) >= 100 OR coalesce(sum(video_size),0) + v_item.source_video_size_bytes > 21474836480
      FROM public.tiktok_task_previews WHERE owner_id = p_user_id) THEN
    RAISE EXCEPTION 'preview_quota_exceeded';
  END IF;
  RETURN QUERY INSERT INTO public.tiktok_task_previews(item_id, owner_id, video_size, video_type, poster_size)
  VALUES(p_item_id, p_user_id, v_item.source_video_size_bytes, v_item.source_video_mime_type, p_poster_size)
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_tiktok_preview_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_tiktok_preview(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tiktok_preview(uuid,uuid,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
