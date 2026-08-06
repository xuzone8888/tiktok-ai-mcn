-- Forward-only repair for the upload reservation RPC installed by
-- 20260801_canvas_upload_registry.sql.
--
-- PL/pgSQL exposes RETURNS TABLE names as variables inside the function body.
-- reserve_canvas_uploads_v1 returns `expires_at`, so its original unqualified
-- `WHERE expires_at <= v_now` is ambiguous with the reservations table column
-- and fails at execution with SQLSTATE 42702. The other four RETURNS TABLE
-- functions in that migration use table/row qualification for output-name
-- references; SET target columns are grammar-resolved and are not expressions.

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

    -- Keep cumulative reserved capacity until the purge worker proves that the
    -- OSS key is gone. The alias is the only semantic repair in this function:
    -- it disambiguates the table column from the RETURNS TABLE output variable.
    UPDATE public.canvas_upload_reservations AS reservation
       SET status = 'expired',
           expired_at = v_now,
           updated_at = v_now,
           purge_lease_token = NULL,
           purge_lease_expires_at = NULL
     WHERE reservation.user_id = p_user_id
       AND reservation.status = 'reserved'
       AND reservation.expires_at <= v_now;

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

    -- Different users can race with the same caller-generated UUID while
    -- holding different per-user quota locks. The loser rolls back atomically.
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

NOTIFY pgrst, 'reload schema';
