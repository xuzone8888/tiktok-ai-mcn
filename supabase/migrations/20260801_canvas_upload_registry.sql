-- Super Canvas upload registry, quotas and readiness boundary.
--
-- Security model:
--   * browser roles have zero table privileges and zero RPC execution;
--   * service_role reserves quota before a short OSS policy is issued;
--   * readiness is reached only after the server HEADs the exact object and
--     finalize_canvas_upload_v1 atomically verifies the observed identity;
--   * expired reservations continue consuming cumulative reserved capacity
--     until a purge worker deletes the OSS key and completes the purge RPC.

CREATE TABLE public.canvas_upload_daily_usage (
    user_id         uuid        NOT NULL,
    window_start    date        NOT NULL,
    files_reserved  integer     NOT NULL DEFAULT 0,
    bytes_reserved  bigint      NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, window_start),
    CONSTRAINT canvas_upload_daily_usage_user_fk
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT canvas_upload_daily_usage_files_range
        CHECK (files_reserved >= 0 AND files_reserved <= 100),
    CONSTRAINT canvas_upload_daily_usage_bytes_range
        CHECK (bytes_reserved >= 0 AND bytes_reserved <= 2147483648)
);

CREATE TABLE public.canvas_upload_storage_usage (
    user_id          uuid        PRIMARY KEY,
    files_reserved   integer     NOT NULL DEFAULT 0,
    bytes_reserved   bigint      NOT NULL DEFAULT 0,
    files_ready      integer     NOT NULL DEFAULT 0,
    bytes_ready      bigint      NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT canvas_upload_storage_usage_user_fk
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT canvas_upload_storage_usage_files_nonnegative
        CHECK (files_reserved >= 0 AND files_ready >= 0),
    CONSTRAINT canvas_upload_storage_usage_bytes_nonnegative
        CHECK (bytes_reserved >= 0 AND bytes_ready >= 0),
    CONSTRAINT canvas_upload_storage_usage_total_files
        CHECK (files_reserved + files_ready <= 1000),
    CONSTRAINT canvas_upload_storage_usage_total_bytes
        CHECK (bytes_reserved + bytes_ready <= 10737418240)
);

CREATE TABLE public.canvas_upload_reservations (
    id                     uuid        PRIMARY KEY,
    user_id                uuid        NOT NULL,
    object_key             text        NOT NULL UNIQUE,
    kind                   text        NOT NULL,
    file_extension         text        NOT NULL,
    content_type           text        NOT NULL,
    expected_size          bigint      NOT NULL,
    status                 text        NOT NULL DEFAULT 'reserved',
    reserved_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at             timestamptz NOT NULL,
    ready_at               timestamptz,
    expired_at             timestamptz,
    last_referenced_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    orphaned_at            timestamptz,
    purged_at              timestamptz,
    purge_lease_token      uuid,
    purge_lease_expires_at timestamptz,
    purge_attempt_count    integer     NOT NULL DEFAULT 0,
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT canvas_upload_reservations_user_fk
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT canvas_upload_reservations_kind
        CHECK (kind IN ('image', 'video')),
    CONSTRAINT canvas_upload_reservations_status
        CHECK (
            status IN (
                'reserved', 'ready', 'expired', 'orphaned', 'purging', 'purged'
            )
        ),
    CONSTRAINT canvas_upload_reservations_size
        CHECK (
            expected_size > 0
            AND (
                (kind = 'image' AND expected_size <= 10485760)
                OR
                (kind = 'video' AND expected_size <= 268435456)
            )
        ),
    CONSTRAINT canvas_upload_reservations_extension_mime
        CHECK (
            (file_extension IN ('jpg', 'jpeg') AND content_type = 'image/jpeg')
            OR (file_extension = 'png'  AND content_type = 'image/png')
            OR (file_extension = 'webp' AND content_type = 'image/webp')
            OR (file_extension = 'gif'  AND content_type = 'image/gif')
            OR (file_extension = 'mp4'  AND content_type = 'video/mp4')
            OR (file_extension = 'webm' AND content_type = 'video/webm')
            OR (
                file_extension = 'mov'
                AND content_type IN ('video/quicktime', 'video/mp4')
            )
            OR (file_extension = 'avi' AND content_type = 'video/x-msvideo')
        ),
    CONSTRAINT canvas_upload_reservations_key_identity
        CHECK (
            object_key =
                CASE kind
                    WHEN 'image' THEN 'images/'
                    ELSE 'videos/'
                END
                || user_id::text || '/' || id::text || '.' || file_extension
        ),
    CONSTRAINT canvas_upload_reservations_expiry
        CHECK (expires_at > reserved_at),
    CONSTRAINT canvas_upload_reservations_state_shape
        CHECK (
            (
                status = 'reserved'
                AND ready_at IS NULL
                AND expired_at IS NULL
                AND orphaned_at IS NULL
                AND purged_at IS NULL
                AND purge_lease_token IS NULL
                AND purge_lease_expires_at IS NULL
            )
            OR
            (
                status = 'ready'
                AND ready_at IS NOT NULL
                AND expired_at IS NULL
                AND orphaned_at IS NULL
                AND purged_at IS NULL
                AND purge_lease_token IS NULL
                AND purge_lease_expires_at IS NULL
            )
            OR
            (
                status = 'expired'
                AND ready_at IS NULL
                AND expired_at IS NOT NULL
                AND orphaned_at IS NULL
                AND purged_at IS NULL
                AND purge_lease_token IS NULL
                AND purge_lease_expires_at IS NULL
            )
            OR
            (
                status = 'orphaned'
                AND ready_at IS NOT NULL
                AND expired_at IS NULL
                AND orphaned_at IS NOT NULL
                AND purged_at IS NULL
                AND purge_lease_token IS NULL
                AND purge_lease_expires_at IS NULL
            )
            OR
            (
                status = 'purging'
                AND purged_at IS NULL
                AND purge_lease_token IS NOT NULL
                AND purge_lease_expires_at IS NOT NULL
                AND (
                    (
                        ready_at IS NULL
                        AND expired_at IS NOT NULL
                        AND orphaned_at IS NULL
                    )
                    OR
                    (
                        ready_at IS NOT NULL
                        AND expired_at IS NULL
                        AND orphaned_at IS NOT NULL
                    )
                )
            )
            OR
            (
                status = 'purged'
                AND purged_at IS NOT NULL
                AND purge_lease_token IS NULL
                AND purge_lease_expires_at IS NULL
                AND (
                    (
                        ready_at IS NULL
                        AND expired_at IS NOT NULL
                        AND orphaned_at IS NULL
                    )
                    OR
                    (
                        ready_at IS NOT NULL
                        AND expired_at IS NULL
                        AND orphaned_at IS NOT NULL
                    )
                )
            )
        ),
    CONSTRAINT canvas_upload_reservations_purge_attempts
        CHECK (purge_attempt_count >= 0)
);

CREATE INDEX canvas_upload_reservations_ready_owner_key_idx
    ON public.canvas_upload_reservations(user_id, object_key)
    WHERE status = 'ready';

CREATE INDEX canvas_upload_reservations_expiry_idx
    ON public.canvas_upload_reservations(expires_at, id)
    WHERE status = 'reserved';

CREATE INDEX canvas_upload_reservations_purge_idx
    ON public.canvas_upload_reservations(
        purge_lease_expires_at, expired_at, orphaned_at, id
    )
    WHERE status IN ('expired', 'orphaned', 'purging');

CREATE INDEX canvas_upload_reservations_orphan_scan_idx
    ON public.canvas_upload_reservations(last_referenced_at, id)
    WHERE status = 'ready';

ALTER TABLE public.canvas_upload_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_upload_storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_upload_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.canvas_upload_daily_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.canvas_upload_storage_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.canvas_upload_reservations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.canvas_upload_daily_usage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.canvas_upload_storage_usage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.canvas_upload_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.canvas_owned_media_key_v1(
    p_object_key text,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    WITH parts AS (
        SELECT string_to_array(p_object_key, '/') AS value
    )
    SELECT
        p_object_key IS NOT NULL
        AND p_user_id IS NOT NULL
        AND p_object_key ~ '^[A-Za-z0-9][A-Za-z0-9/._-]*$'
        AND position('//' IN p_object_key) = 0
        AND (
            (
                array_length(value, 1) = 3
                AND value[1] IN (
                    'videos', 'quick-gen', 'images', 'products', 'avatars',
                    'model-avatars', 'model-demos', 'user-uploads',
                    'veo-videos', 'misc'
                )
                AND value[2] = p_user_id::text
                AND value[3] NOT IN ('', '.', '..')
            )
            OR
            (
                array_length(value, 1) = 4
                AND value[1] = 'videos'
                AND value[2] IN ('slideshow', 'assembly')
                AND value[3] = p_user_id::text
                AND value[4] NOT IN ('', '.', '..')
            )
        )
    FROM parts;
$$;

REVOKE ALL ON FUNCTION public.canvas_owned_media_key_v1(text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_owned_media_key_v1(text, uuid)
    TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_canvas_uploads_v1(
    p_user_id uuid,
    p_items jsonb
)
RETURNS TABLE (
    reservation_id uuid,
    object_key text,
    kind text,
    file_extension text,
    content_type text,
    expected_size bigint,
    reservation_status text,
    expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now             timestamptz := clock_timestamp();
    v_window          date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_count           integer;
    v_batch_bytes     bigint := 0;
    v_new_files       integer := 0;
    v_new_bytes       bigint := 0;
    v_inserted_count  bigint := 0;
    v_item            jsonb;
    v_id              uuid;
    v_key             text;
    v_kind            text;
    v_extension       text;
    v_content_type    text;
    v_size            bigint;
    v_expected_key    text;
    v_existing        public.canvas_upload_reservations%ROWTYPE;
    v_daily           public.canvas_upload_daily_usage%ROWTYPE;
    v_storage         public.canvas_upload_storage_usage%ROWTYPE;
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'canvas_upload_invalid_items';
    END IF;

    v_count := jsonb_array_length(p_items);
    IF v_count < 1 OR v_count > 10 THEN
        RAISE EXCEPTION 'canvas_upload_batch_count_limit';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_items) AS item(value)
         WHERE jsonb_typeof(item.value) <> 'object'
    ) THEN
        RAISE EXCEPTION 'canvas_upload_invalid_item';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_items) AS item(value)
          CROSS JOIN LATERAL jsonb_object_keys(item.value) AS field(name)
         WHERE field.name NOT IN (
             'id', 'objectKey', 'kind', 'extension', 'contentType', 'size'
         )
    ) THEN
        RAISE EXCEPTION 'canvas_upload_unknown_item_field';
    END IF;
    IF (
        SELECT count(*)
          FROM jsonb_array_elements(p_items) AS item(value)
    ) <> (
        SELECT count(DISTINCT item.value->>'id')
          FROM jsonb_array_elements(p_items) AS item(value)
    ) THEN
        RAISE EXCEPTION 'canvas_upload_duplicate_id';
    END IF;

    -- A single storage row is the first lock for every reserve/finalize/purge
    -- path. Keeping this order stable prevents cross-RPC deadlocks.
    INSERT INTO public.canvas_upload_storage_usage(user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT *
      INTO v_storage
      FROM public.canvas_upload_storage_usage
     WHERE user_id = p_user_id
     FOR UPDATE;

    INSERT INTO public.canvas_upload_daily_usage(user_id, window_start)
    VALUES (p_user_id, v_window)
    ON CONFLICT (user_id, window_start) DO NOTHING;

    SELECT *
      INTO v_daily
      FROM public.canvas_upload_daily_usage
     WHERE user_id = p_user_id
       AND window_start = v_window
     FOR UPDATE;

    -- Mark the DB lifecycle boundary, but intentionally retain cumulative
    -- reserved capacity until the purge worker proves the OSS key is gone.
    UPDATE public.canvas_upload_reservations
       SET status = 'expired',
           expired_at = v_now,
           updated_at = v_now,
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL
     WHERE user_id = p_user_id
       AND status = 'reserved'
       AND expires_at <= v_now;

    -- Lock repeated client ids in canonical order before inspecting them.
    PERFORM 1
      FROM public.canvas_upload_reservations
     WHERE id = ANY (
         ARRAY(
             SELECT (item.value->>'id')::uuid
               FROM jsonb_array_elements(p_items) AS item(value)
              ORDER BY item.value->>'id'
         )
     )
     ORDER BY id
     FOR UPDATE;

    FOR v_item IN
        SELECT item.value
          FROM jsonb_array_elements(p_items) AS item(value)
    LOOP
        BEGIN
            v_id := (v_item->>'id')::uuid;
            v_size := (v_item->>'size')::bigint;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION 'canvas_upload_invalid_scalar';
        END;
        v_key := v_item->>'objectKey';
        v_kind := v_item->>'kind';
        v_extension := lower(v_item->>'extension');
        v_content_type := lower(v_item->>'contentType');

        IF v_id IS NULL
           OR v_key IS NULL
           OR v_kind NOT IN ('image', 'video')
           OR v_extension IS NULL
           OR v_content_type IS NULL
           OR v_size IS NULL
           OR v_size <= 0
        THEN
            RAISE EXCEPTION 'canvas_upload_missing_or_invalid_field';
        END IF;

        IF NOT (
            (v_extension IN ('jpg', 'jpeg') AND v_content_type = 'image/jpeg')
            OR (v_extension = 'png'  AND v_content_type = 'image/png')
            OR (v_extension = 'webp' AND v_content_type = 'image/webp')
            OR (v_extension = 'gif'  AND v_content_type = 'image/gif')
            OR (v_extension = 'mp4'  AND v_content_type = 'video/mp4')
            OR (v_extension = 'webm' AND v_content_type = 'video/webm')
            OR (
                v_extension = 'mov'
                AND v_content_type IN ('video/quicktime', 'video/mp4')
            )
            OR (v_extension = 'avi' AND v_content_type = 'video/x-msvideo')
        ) THEN
            RAISE EXCEPTION 'canvas_upload_extension_mime_mismatch';
        END IF;
        IF (v_kind = 'image' AND v_content_type NOT LIKE 'image/%')
           OR (v_kind = 'video' AND v_content_type NOT LIKE 'video/%')
           OR (v_kind = 'image' AND v_size > 10485760)
           OR (v_kind = 'video' AND v_size > 268435456)
        THEN
            RAISE EXCEPTION 'canvas_upload_file_limit';
        END IF;

        v_expected_key :=
            CASE v_kind WHEN 'image' THEN 'images/' ELSE 'videos/' END
            || p_user_id::text || '/' || v_id::text || '.' || v_extension;
        IF v_key <> v_expected_key THEN
            RAISE EXCEPTION 'canvas_upload_key_identity_mismatch';
        END IF;

        v_batch_bytes := v_batch_bytes + v_size;
        IF v_batch_bytes > 536870912 THEN
            RAISE EXCEPTION 'canvas_upload_batch_bytes_limit';
        END IF;

        SELECT *
          INTO v_existing
          FROM public.canvas_upload_reservations
         WHERE id = v_id;

        IF FOUND THEN
            IF v_existing.user_id <> p_user_id
               OR v_existing.object_key <> v_key
               OR v_existing.kind <> v_kind
               OR v_existing.file_extension <> v_extension
               OR v_existing.content_type <> v_content_type
               OR v_existing.expected_size <> v_size
            THEN
                RAISE EXCEPTION 'canvas_upload_idempotency_conflict';
            END IF;
            IF v_existing.status IN ('expired', 'purged')
               OR (
                   v_existing.status = 'reserved'
                   AND v_existing.expires_at <= v_now
               )
            THEN
                RAISE EXCEPTION 'canvas_upload_reservation_expired';
            END IF;
        ELSE
            v_new_files := v_new_files + 1;
            v_new_bytes := v_new_bytes + v_size;
        END IF;
    END LOOP;

    IF v_daily.files_reserved + v_new_files > 100 THEN
        RAISE EXCEPTION 'canvas_upload_daily_file_quota';
    END IF;
    IF v_daily.bytes_reserved + v_new_bytes > 2147483648 THEN
        RAISE EXCEPTION 'canvas_upload_daily_byte_quota';
    END IF;
    IF v_storage.files_reserved + v_storage.files_ready + v_new_files > 1000 THEN
        RAISE EXCEPTION 'canvas_upload_storage_file_quota';
    END IF;
    IF v_storage.bytes_reserved + v_storage.bytes_ready + v_new_bytes > 10737418240 THEN
        RAISE EXCEPTION 'canvas_upload_storage_byte_quota';
    END IF;

    UPDATE public.canvas_upload_daily_usage
       SET files_reserved = files_reserved + v_new_files,
           bytes_reserved = bytes_reserved + v_new_bytes,
           updated_at = v_now
     WHERE user_id = p_user_id
       AND window_start = v_window;

    UPDATE public.canvas_upload_storage_usage
       SET files_reserved = files_reserved + v_new_files,
           bytes_reserved = bytes_reserved + v_new_bytes,
           updated_at = v_now
     WHERE user_id = p_user_id;

    INSERT INTO public.canvas_upload_reservations (
        id, user_id, object_key, kind, file_extension, content_type,
        expected_size, status, reserved_at, expires_at, updated_at
    )
    SELECT
        (item.value->>'id')::uuid,
        p_user_id,
        item.value->>'objectKey',
        item.value->>'kind',
        lower(item.value->>'extension'),
        lower(item.value->>'contentType'),
        (item.value->>'size')::bigint,
        'reserved',
        v_now,
        v_now + interval '30 minutes',
        v_now
      FROM jsonb_array_elements(p_items) AS item(value)
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    -- Two different users can race with the same caller-generated UUID while
    -- holding different per-user quota locks. The loser must roll the whole
    -- transaction back instead of retaining leaked quota or observing the
    -- winner's reservation through the final join.
    IF v_inserted_count <> v_new_files THEN
        RAISE EXCEPTION 'canvas_upload_idempotency_conflict'
            USING ERRCODE = 'unique_violation';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.object_key,
        r.kind,
        r.file_extension,
        r.content_type,
        r.expected_size,
        r.status,
        r.expires_at
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ord)
      JOIN public.canvas_upload_reservations r
        ON r.id = (item.value->>'id')::uuid
       AND r.user_id = p_user_id
     ORDER BY item.ord;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_canvas_uploads_v1(uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_canvas_uploads_v1(uuid, jsonb)
    TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_canvas_upload_v1(
    p_user_id uuid,
    p_reservation_id uuid,
    p_object_key text,
    p_observed_size bigint,
    p_observed_content_type text
)
RETURNS TABLE (
    reservation_id uuid,
    object_key text,
    result_status text,
    ready_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now      timestamptz := clock_timestamp();
    v_row      public.canvas_upload_reservations%ROWTYPE;
    v_storage  public.canvas_upload_storage_usage%ROWTYPE;
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL
       OR p_reservation_id IS NULL
       OR p_object_key IS NULL
       OR p_object_key = ''
       OR p_observed_size IS NULL
       OR p_observed_size <= 0
       OR p_observed_content_type IS NULL
       OR p_observed_content_type = ''
    THEN
        RAISE EXCEPTION 'canvas_upload_finalize_invalid_input';
    END IF;

    SELECT *
      INTO v_storage
      FROM public.canvas_upload_storage_usage
     WHERE user_id = p_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_upload_storage_usage_missing';
    END IF;

    SELECT *
      INTO v_row
      FROM public.canvas_upload_reservations
     WHERE id = p_reservation_id
       AND user_id = p_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_upload_reservation_not_found';
    END IF;

    IF v_row.object_key <> p_object_key
       OR v_row.expected_size <> p_observed_size
       OR v_row.content_type <> lower(p_observed_content_type)
    THEN
        RETURN QUERY SELECT v_row.id, v_row.object_key, 'mismatch'::text, v_row.ready_at;
        RETURN;
    END IF;

    IF v_row.status = 'ready' THEN
        RETURN QUERY SELECT v_row.id, v_row.object_key, 'ready'::text, v_row.ready_at;
        RETURN;
    END IF;

    IF v_row.status <> 'reserved' OR v_row.expires_at <= v_now THEN
        IF v_row.status = 'reserved' THEN
            UPDATE public.canvas_upload_reservations
               SET status = 'expired',
                   expired_at = v_now,
                   updated_at = v_now
             WHERE id = v_row.id;
        END IF;
        RETURN QUERY SELECT v_row.id, v_row.object_key, 'expired'::text, NULL::timestamptz;
        RETURN;
    END IF;

    UPDATE public.canvas_upload_storage_usage
       SET files_reserved = files_reserved - 1,
           bytes_reserved = bytes_reserved - v_row.expected_size,
           files_ready = files_ready + 1,
           bytes_ready = bytes_ready + v_row.expected_size,
           updated_at = v_now
     WHERE user_id = p_user_id
       AND files_reserved >= 1
       AND bytes_reserved >= v_row.expected_size;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_upload_storage_usage_underflow';
    END IF;

    UPDATE public.canvas_upload_reservations
       SET status = 'ready',
           ready_at = v_now,
           last_referenced_at = v_now,
           orphaned_at = NULL,
           updated_at = v_now,
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL
     WHERE id = v_row.id;

    RETURN QUERY SELECT v_row.id, v_row.object_key, 'ready'::text, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_canvas_upload_v1(uuid, uuid, text, bigint, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_canvas_upload_v1(uuid, uuid, text, bigint, text)
    TO service_role;

CREATE OR REPLACE FUNCTION public.assert_canvas_media_keys_ready_v1(
    p_user_id uuid,
    p_canvas_id uuid,
    p_base_rev bigint,
    p_object_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now            timestamptz := clock_timestamp();
    v_doc            jsonb;
    v_existing_keys  text[] := ARRAY[]::text[];
    v_rejected       jsonb;
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR COALESCE(array_length(p_object_keys, 1), 0) > 2000 THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_input';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM unnest(COALESCE(p_object_keys, ARRAY[]::text[]))
               AS item(object_key)
         WHERE item.object_key IS NULL
            OR item.object_key = ''
    ) THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_key';
    END IF;
    IF p_canvas_id IS NULL AND p_base_rev IS NOT NULL THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_canvas_identity';
    END IF;
    IF p_canvas_id IS NOT NULL THEN
        IF p_base_rev IS NULL OR p_base_rev < 0 THEN
            RAISE EXCEPTION 'canvas_upload_readiness_invalid_canvas_identity';
        END IF;
        SELECT c.doc
          INTO v_doc
          FROM public.canvases c
         WHERE c.id = p_canvas_id
           AND c.user_id = p_user_id
           AND c.rev = p_base_rev;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'ok', false,
                'reason', 'canvas_revision_mismatch',
                'rejected', '[]'::jsonb
            );
        END IF;
        SELECT COALESCE(array_agg(DISTINCT media_key), ARRAY[]::text[])
          INTO v_existing_keys
          FROM (
              SELECT node.value #>> '{data,media,ossKey}' AS media_key
                FROM jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(v_doc->'nodes') = 'array'
                            THEN v_doc->'nodes'
                        ELSE '[]'::jsonb
                    END
                ) AS node(value)
          ) existing
         WHERE media_key IS NOT NULL
           AND media_key <> '';

        -- A ready upload can only become orphaned after a separate grace
        -- period and an authoritative no-reference scan. If a still-current
        -- canvas reaches this RPC during that window, rescue it before any
        -- purge claim is allowed to transition it to purging.
        UPDATE public.canvas_upload_reservations r
           SET status = 'ready',
               orphaned_at = NULL,
               purge_lease_token = NULL,
               purge_lease_expires_at = NULL,
               last_referenced_at = v_now,
               updated_at = v_now
         WHERE r.user_id = p_user_id
           AND r.status = 'orphaned'
           AND r.object_key = ANY(v_existing_keys);
    END IF;

    WITH candidate AS (
        SELECT DISTINCT item.object_key
          FROM unnest(COALESCE(p_object_keys, ARRAY[]::text[]))
               AS item(object_key)
         WHERE item.object_key IS NOT NULL
           AND item.object_key <> ''
    ),
    verdict AS (
        SELECT
            candidate.object_key,
            CASE
                WHEN NOT public.canvas_owned_media_key_v1(
                    candidate.object_key,
                    p_user_id
                )
                    THEN 'not_owned'
                WHEN EXISTS (
                    SELECT 1
                      FROM public.canvas_upload_reservations r
                     WHERE r.user_id = p_user_id
                       AND r.object_key = candidate.object_key
                )
                    THEN CASE
                        WHEN EXISTS (
                            SELECT 1
                              FROM public.canvas_upload_reservations r
                             WHERE r.user_id = p_user_id
                               AND r.object_key = candidate.object_key
                               AND r.status = 'ready'
                        )
                            THEN NULL
                        ELSE 'not_ready'
                    END
                -- Existing unregistered media predates the upload registry.
                -- It remains writable for compatibility, but cannot be used
                -- as a new generation input because generation calls pass no
                -- canvas revision and therefore have no existing-key set.
                WHEN candidate.object_key = ANY(v_existing_keys)
                    THEN NULL
                WHEN EXISTS (
                    SELECT 1
                      FROM public.generations g
                     WHERE g.user_id = p_user_id
                       AND g.output_oss_key = candidate.object_key
                       AND g.status = 'completed'
                )
                    THEN NULL
                ELSE 'not_ready'
            END AS rejection
          FROM candidate
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object('objectKey', object_key, 'reason', rejection)
            ORDER BY object_key
        ) FILTER (WHERE rejection IS NOT NULL),
        '[]'::jsonb
    )
      INTO v_rejected
      FROM verdict;

    UPDATE public.canvas_upload_reservations r
       SET last_referenced_at = v_now,
           updated_at = v_now
     WHERE r.user_id = p_user_id
       AND r.status = 'ready'
       AND r.object_key = ANY(COALESCE(p_object_keys, ARRAY[]::text[]));

    RETURN jsonb_build_object(
        'ok', jsonb_array_length(v_rejected) = 0,
        'reason',
            CASE
                WHEN jsonb_array_length(v_rejected) = 0 THEN NULL
                ELSE 'media_not_ready'
            END,
        'rejected', v_rejected
    );
END;
$$;

REVOKE ALL ON FUNCTION public.assert_canvas_media_keys_ready_v1(uuid, uuid, bigint, text[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_canvas_media_keys_ready_v1(uuid, uuid, bigint, text[])
    TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_expired_canvas_uploads_v1(
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    reservation_id uuid,
    user_id uuid,
    object_key text,
    expected_size bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'canvas_upload_sweep_limit_invalid';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT r.id
          FROM public.canvas_upload_reservations r
         WHERE r.status = 'reserved'
           AND r.expires_at <= clock_timestamp()
         ORDER BY r.expires_at, r.id
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.canvas_upload_reservations r
       SET status = 'expired',
           expired_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL
      FROM candidates
     WHERE r.id = candidates.id
    RETURNING r.id, r.user_id, r.object_key, r.expected_size;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_canvas_uploads_v1(integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_canvas_uploads_v1(integer)
    TO service_role;

CREATE OR REPLACE FUNCTION public.mark_canvas_upload_orphans_v1(
    p_limit integer DEFAULT 100,
    p_unreferenced_grace_seconds integer DEFAULT 604800
)
RETURNS TABLE (
    reservation_id uuid,
    user_id uuid,
    object_key text,
    expected_size bigint,
    orphaned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL
       OR p_unreferenced_grace_seconds IS NULL
       OR p_limit < 1 OR p_limit > 1000
       OR p_unreferenced_grace_seconds < 86400
       OR p_unreferenced_grace_seconds > 7776000
    THEN
        RAISE EXCEPTION 'canvas_upload_orphan_mark_invalid';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT r.id
          FROM public.canvas_upload_reservations r
         WHERE r.status = 'ready'
           AND r.last_referenced_at <=
               clock_timestamp()
               - make_interval(secs => p_unreferenced_grace_seconds)
           AND NOT EXISTS (
               SELECT 1
                 FROM public.canvases c
                WHERE c.user_id = r.user_id
                  AND (
                      jsonb_path_exists(
                          c.doc,
                          '$.** ? (@ == $objectKey)',
                          jsonb_build_object(
                              'objectKey',
                              to_jsonb(r.object_key)
                          )
                      )
                      OR EXISTS (
                          SELECT 1
                            FROM jsonb_array_elements(
                                CASE
                                    WHEN jsonb_typeof(c.doc->'nodes') = 'array'
                                        THEN c.doc->'nodes'
                                    ELSE '[]'::jsonb
                                END
                            ) AS node(value)
                           WHERE
                               node.value #>> '{data,media,ossKey}' = r.object_key
                               OR node.value #>> '{data,media,posterKey}' = r.object_key
                      )
                  )
           )
         ORDER BY r.last_referenced_at, r.id
         LIMIT p_limit
         FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE public.canvas_upload_reservations r
       SET status = 'orphaned',
           orphaned_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL
      FROM candidates
     WHERE r.id = candidates.id
    RETURNING r.id, r.user_id, r.object_key, r.expected_size, r.orphaned_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_canvas_upload_orphans_v1(integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_canvas_upload_orphans_v1(integer, integer)
    TO service_role;

CREATE OR REPLACE FUNCTION public.claim_canvas_upload_purge_v1(
    p_limit integer DEFAULT 100,
    p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
    reservation_id uuid,
    user_id uuid,
    object_key text,
    expected_size bigint,
    lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL
       OR p_lease_seconds IS NULL
       OR p_limit < 1 OR p_limit > 1000
       OR p_lease_seconds < 60 OR p_lease_seconds > 900
    THEN
        RAISE EXCEPTION 'canvas_upload_purge_claim_invalid';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT r.id
          FROM public.canvas_upload_reservations r
         WHERE (
               r.status = 'expired'
               OR (
                   r.status = 'orphaned'
                   AND r.orphaned_at <= clock_timestamp() - interval '24 hours'
               )
               OR (
                   r.status = 'purging'
                   AND r.purge_lease_expires_at <= clock_timestamp()
               )
           )
         ORDER BY
               COALESCE(r.expired_at, r.orphaned_at),
               r.id
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ),
    leased AS (
        UPDATE public.canvas_upload_reservations r
           SET status = 'purging',
               purge_lease_token = gen_random_uuid(),
               purge_lease_expires_at =
                   clock_timestamp() + make_interval(secs => p_lease_seconds),
               purge_attempt_count = purge_attempt_count + 1,
               updated_at = clock_timestamp()
          FROM candidates
         WHERE r.id = candidates.id
        RETURNING r.id, r.user_id, r.object_key, r.expected_size,
                  r.purge_lease_token
    )
    SELECT leased.id, leased.user_id, leased.object_key,
           leased.expected_size, leased.purge_lease_token
      FROM leased;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_canvas_upload_purge_v1(integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canvas_upload_purge_v1(integer, integer)
    TO service_role;

CREATE OR REPLACE FUNCTION public.complete_canvas_upload_purge_v1(
    p_reservation_id uuid,
    p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now      timestamptz := clock_timestamp();
    v_user_id  uuid;
    v_row      public.canvas_upload_reservations%ROWTYPE;
    v_storage  public.canvas_upload_storage_usage%ROWTYPE;
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_reservation_id IS NULL OR p_lease_token IS NULL THEN
        RAISE EXCEPTION 'canvas_upload_purge_complete_invalid';
    END IF;

    SELECT r.user_id
      INTO v_user_id
      FROM public.canvas_upload_reservations r
     WHERE r.id = p_reservation_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT *
      INTO v_storage
      FROM public.canvas_upload_storage_usage s
     WHERE s.user_id = v_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_upload_storage_usage_missing';
    END IF;

    SELECT *
      INTO v_row
      FROM public.canvas_upload_reservations r
     WHERE r.id = p_reservation_id
     FOR UPDATE;
    IF v_row.status <> 'purging'
       OR v_row.purge_lease_token IS DISTINCT FROM p_lease_token
    THEN
        RETURN false;
    END IF;

    IF v_row.ready_at IS NULL THEN
        UPDATE public.canvas_upload_storage_usage
           SET files_reserved = files_reserved - 1,
               bytes_reserved = bytes_reserved - v_row.expected_size,
               updated_at = v_now
         WHERE user_id = v_row.user_id
           AND files_reserved >= 1
           AND bytes_reserved >= v_row.expected_size;
    ELSE
        UPDATE public.canvas_upload_storage_usage
           SET files_ready = files_ready - 1,
               bytes_ready = bytes_ready - v_row.expected_size,
               updated_at = v_now
         WHERE user_id = v_row.user_id
           AND files_ready >= 1
           AND bytes_ready >= v_row.expected_size;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_upload_storage_usage_underflow';
    END IF;

    UPDATE public.canvas_upload_reservations
       SET status = 'purged',
           purged_at = v_now,
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL,
           updated_at = v_now
     WHERE id = v_row.id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_canvas_upload_purge_v1(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_canvas_upload_purge_v1(uuid, uuid)
    TO service_role;

COMMENT ON TABLE public.canvas_upload_reservations IS
    'Service-only Super Canvas direct-upload lifecycle. reserved objects are not writable Canvas inputs; only server-verified ready rows are accepted. Unreferenced ready objects pass a 7-day scan grace and a second 24-hour orphan grace before leased deletion.';
COMMENT ON TABLE public.canvas_upload_daily_usage IS
    'UTC-day reservation-attempt quota: maximum 100 files and 2GiB per user/day. Expiry does not refund the daily attempt quota.';
COMMENT ON TABLE public.canvas_upload_storage_usage IS
    'Fail-closed cumulative quota: maximum 1000 objects and 10GiB ready+reserved. Expired capacity is released only after confirmed OSS purge.';

DO $postconditions$
DECLARE
    v_table text;
    v_function regprocedure;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'public.canvas_upload_daily_usage',
        'public.canvas_upload_storage_usage',
        'public.canvas_upload_reservations'
    ] LOOP
        IF has_table_privilege('anon', v_table, 'SELECT')
           OR has_table_privilege('authenticated', v_table, 'SELECT')
           OR has_table_privilege('anon', v_table, 'INSERT')
           OR has_table_privilege('authenticated', v_table, 'INSERT')
           OR has_table_privilege('anon', v_table, 'UPDATE')
           OR has_table_privilege('authenticated', v_table, 'UPDATE')
           OR has_table_privilege('anon', v_table, 'DELETE')
           OR has_table_privilege('authenticated', v_table, 'DELETE')
        THEN
            RAISE EXCEPTION 'canvas upload table privilege postcondition failed: %', v_table;
        END IF;
    END LOOP;

    FOREACH v_function IN ARRAY ARRAY[
        'public.canvas_owned_media_key_v1(text,uuid)'::regprocedure,
        'public.reserve_canvas_uploads_v1(uuid,jsonb)'::regprocedure,
        'public.finalize_canvas_upload_v1(uuid,uuid,text,bigint,text)'::regprocedure,
        'public.assert_canvas_media_keys_ready_v1(uuid,uuid,bigint,text[])'::regprocedure,
        'public.sweep_expired_canvas_uploads_v1(integer)'::regprocedure,
        'public.mark_canvas_upload_orphans_v1(integer,integer)'::regprocedure,
        'public.claim_canvas_upload_purge_v1(integer,integer)'::regprocedure,
        'public.complete_canvas_upload_purge_v1(uuid,uuid)'::regprocedure
    ] LOOP
        IF has_function_privilege('anon', v_function, 'EXECUTE')
           OR has_function_privilege('authenticated', v_function, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
        THEN
            RAISE EXCEPTION 'canvas upload function privilege postcondition failed: %', v_function;
        END IF;
    END LOOP;
END;
$postconditions$;

NOTIFY pgrst, 'reload schema';
