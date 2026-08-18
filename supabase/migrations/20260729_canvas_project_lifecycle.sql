-- ============================================================================
-- Super Canvas project lifecycle
--
-- Deleting a Canvas must be atomic with the active-generation check. A route
-- level "SELECT then DELETE" can race begin_canvas_generation_v1: the provider
-- job could be charged and inserted between those two statements, after which
-- ON DELETE SET NULL would detach a still-running job from its project.
--
-- This function follows the existing Canvas lock order. It locks the owned
-- Canvas first (the same row lock used by the generation fence), checks active
-- action rows, and deletes only when the check is clean. The immutable
-- canvas_id_snapshot and billing rows remain intact; navigational FKs retain
-- their existing ON DELETE SET NULL behavior.
-- ============================================================================

-- Project creation is an authenticated RPC so the per-user cap is serialized
-- in the database. The first production rollout must still be able to roll
-- back to the legacy route, which inserts directly through PostgREST. The
-- trigger bridge below gives that route the same owner lock and hard cap. It
-- can be removed, together with the authenticated INSERT grant, only after
-- every retained rollback release calls create_canvas_project_v1.
CREATE OR REPLACE FUNCTION public.guard_canvas_project_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_project_limit constant integer := 100;
    v_user_id       uuid := auth.uid();
    v_count         bigint;
BEGIN
    -- postgres/service_role maintenance has no end-user JWT identity and keeps
    -- its existing behavior. PUBLIC and anon retain no INSERT privilege.
    IF v_user_id IS NULL THEN
        IF TG_LEVEL = 'ROW' THEN
            RETURN NEW;
        END IF;
        RETURN NULL;
    END IF;

    IF TG_WHEN = 'BEFORE' AND TG_LEVEL = 'STATEMENT' THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'canvas-project-create:' || v_user_id::text,
                0
            )
        );
        RETURN NULL;
    END IF;

    IF TG_WHEN = 'BEFORE' AND TG_LEVEL = 'ROW' THEN
        IF NEW.user_id IS DISTINCT FROM v_user_id THEN
            RAISE EXCEPTION 'guard_canvas_project_insert_v1: owner mismatch'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_WHEN = 'AFTER' AND TG_LEVEL = 'STATEMENT' THEN
        SELECT pg_catalog.count(*)
          INTO v_count
          FROM public.canvases c
         WHERE c.user_id = v_user_id;
        IF v_count > c_project_limit THEN
            RAISE EXCEPTION 'guard_canvas_project_insert_v1: project limit reached'
                USING ERRCODE = 'program_limit_exceeded';
        END IF;
        RETURN NULL;
    END IF;

    RAISE EXCEPTION 'guard_canvas_project_insert_v1: invalid trigger context'
        USING ERRCODE = 'internal_error';
END;
$$;

COMMENT ON FUNCTION public.guard_canvas_project_insert_v1() IS
    'Temporary rollback-compatibility bridge: serializes authenticated direct Canvas inserts, enforces owner identity, and caps the final per-user count at 100.';

REVOKE ALL ON FUNCTION public.guard_canvas_project_insert_v1()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER canvas_project_insert_lock_v1
BEFORE INSERT ON public.canvases
FOR EACH STATEMENT
EXECUTE FUNCTION public.guard_canvas_project_insert_v1();

CREATE TRIGGER canvas_project_insert_owner_v1
BEFORE INSERT ON public.canvases
FOR EACH ROW
EXECUTE FUNCTION public.guard_canvas_project_insert_v1();

CREATE TRIGGER canvas_project_insert_cap_v1
AFTER INSERT ON public.canvases
FOR EACH STATEMENT
EXECUTE FUNCTION public.guard_canvas_project_insert_v1();

CREATE OR REPLACE FUNCTION public.create_canvas_project_v1(
    p_canvas_id      uuid,
    p_title          text,
    p_schema_version integer,
    p_doc            jsonb,
    p_deps           jsonb,
    p_doc_bytes      integer
)
RETURNS TABLE (
    created boolean,
    canvas  jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_project_limit constant integer := 100;
    v_user_id       uuid := auth.uid();
    v_canvas_id     uuid := COALESCE(p_canvas_id, pg_catalog.gen_random_uuid());
    v_existing      public.canvases%ROWTYPE;
    v_created       public.canvases%ROWTYPE;
    v_count         bigint;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'create_canvas_project_v1: authenticated user required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_title IS NULL
       OR pg_catalog.length(p_title) NOT BETWEEN 1 AND 120
       OR p_title <> pg_catalog.btrim(p_title)
       OR p_schema_version IS NULL
       OR p_schema_version < 1
       OR p_doc IS NULL
       OR pg_catalog.jsonb_typeof(p_doc) <> 'object'
       OR p_deps IS NULL
       OR pg_catalog.jsonb_typeof(p_deps) <> 'object'
       OR p_doc_bytes IS NULL
       OR p_doc_bytes < 0
       OR p_doc_bytes > 2097152 THEN
        RAISE EXCEPTION 'create_canvas_project_v1: invalid project payload'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'canvas-project-create:' || v_user_id::text,
            0
        )
    );

    SELECT c.*
      INTO v_existing
      FROM public.canvases c
     WHERE c.id = v_canvas_id
       AND c.user_id = v_user_id
     FOR UPDATE;

    IF FOUND THEN
        created := false;
        canvas := pg_catalog.to_jsonb(v_existing);
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM public.canvases c
     WHERE c.user_id = v_user_id;

    IF v_count >= c_project_limit THEN
        RAISE EXCEPTION 'create_canvas_project_v1: project limit reached'
            USING ERRCODE = 'program_limit_exceeded';
    END IF;

    INSERT INTO public.canvases (
        id,
        user_id,
        title,
        schema_version,
        doc,
        deps,
        rev,
        doc_bytes,
        updated_at
    ) VALUES (
        v_canvas_id,
        v_user_id,
        p_title,
        p_schema_version,
        p_doc,
        p_deps,
        0,
        p_doc_bytes,
        pg_catalog.clock_timestamp()
    )
    RETURNING * INTO v_created;

    created := true;
    canvas := pg_catalog.to_jsonb(v_created);
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.create_canvas_project_v1(uuid, text, integer, jsonb, jsonb, integer) IS
    'Creates at most 100 projects per auth.uid under a per-user advisory lock, or returns the owned same-id row for idempotent request verification.';

REVOKE ALL ON FUNCTION public.create_canvas_project_v1(uuid, text, integer, jsonb, jsonb, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_canvas_project_v1(uuid, text, integer, jsonb, jsonb, integer)
    TO authenticated;
REVOKE INSERT ON TABLE public.canvases FROM PUBLIC, anon;
GRANT INSERT ON TABLE public.canvases TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_canvas_project_v1(p_canvas_id uuid)
RETURNS TABLE (
    outcome text,
    deleted_canvas_id uuid,
    active_generation_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_canvas_id uuid;
    v_active_count bigint := 0;
    v_deleted_count bigint := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'delete_canvas_project_v1: authenticated user required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_canvas_id IS NULL THEN
        RAISE EXCEPTION 'delete_canvas_project_v1: canvas id required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Explicit owner predicate is the authorization boundary inside this
    -- SECURITY DEFINER function. FOR UPDATE is intentionally stronger than the
    -- generation fence's FOR NO KEY UPDATE: it serializes with that fence and
    -- also blocks the FK KEY SHARE lock of any direct generation insert.
    SELECT c.id
      INTO v_canvas_id
      FROM public.canvases c
     WHERE c.id = p_canvas_id
       AND c.user_id = v_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        outcome := 'not_found';
        deleted_canvas_id := NULL;
        active_generation_count := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Include the immutable snapshot as a conservative backstop for rows whose
    -- navigational FK was already cleared. A recreated same-UUID project must
    -- never make a still-running predecessor invisible to this safety gate.
    SELECT pg_catalog.count(*)
      INTO v_active_count
      FROM public.generations g
     WHERE g.user_id = v_user_id
       AND g.status IN ('pending', 'processing')
       AND (
            g.canvas_id = p_canvas_id
            OR g.canvas_id_snapshot = p_canvas_id
       );

    IF v_active_count > 0 THEN
        outcome := 'active_generations';
        deleted_canvas_id := NULL;
        active_generation_count := v_active_count;
        RETURN NEXT;
        RETURN;
    END IF;

    DELETE FROM public.canvases c
     WHERE c.id = v_canvas_id
       AND c.user_id = v_user_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count <> 1 THEN
        RAISE EXCEPTION
            'delete_canvas_project_v1: expected one owned canvas deletion, got %',
            v_deleted_count
            USING ERRCODE = 'serialization_failure';
    END IF;

    outcome := 'deleted';
    deleted_canvas_id := v_canvas_id;
    active_generation_count := 0;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.delete_canvas_project_v1(uuid) IS
    'Atomically locks an auth.uid-owned Canvas, rejects pending/processing Canvas generations, then deletes exactly that Canvas. Audit snapshots and billing rows are retained.';

REVOKE ALL ON FUNCTION public.delete_canvas_project_v1(uuid)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_canvas_project_v1(uuid)
    TO authenticated;

NOTIFY pgrst, 'reload schema';
