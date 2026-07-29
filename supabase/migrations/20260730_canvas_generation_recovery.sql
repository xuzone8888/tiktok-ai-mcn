-- ============================================================================
-- Super Canvas production recovery controls
--
-- 1. A process can exit after begin_canvas_generation_v1 has atomically
--    created/debited a row but before claim_canvas_generation_submission_v1.
--    Such a row is provably pre-provider (pending/not_started with no token,
--    start time, or task id), so a stale sweep may safely abandon/refund it.
--
-- 2. A video POST can be accepted upstream while its task-id response is lost.
--    That state must never be automatically retried or refunded. Operators get
--    one service-role-only, append-only audited resolution boundary:
--      * bind_task after finding the unique provider task; or
--      * verified_no_task_refund after provider evidence proves no task exists.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.canvas_generation_resolution_audit (
    resolution_id                    uuid PRIMARY KEY,
    generation_id                    uuid NOT NULL
        REFERENCES public.generations(id) ON DELETE RESTRICT,
    user_id                          uuid NOT NULL,
    action_id                        uuid NOT NULL,
    resolution                       text NOT NULL,
    operator_label                   text NOT NULL,
    provider_evidence                text NOT NULL,
    previous_provider_submission_state text NOT NULL,
    status_after                     text NOT NULL,
    provider_submission_state_after  text NOT NULL,
    task_id                          text,
    refunded_amount                  integer NOT NULL DEFAULT 0,
    balance_after                    integer NOT NULL,
    created_at                       timestamptz NOT NULL
        DEFAULT pg_catalog.clock_timestamp(),

    CONSTRAINT canvas_generation_resolution_kind_check
        CHECK (resolution IN ('bind_task', 'verified_no_task_refund')),
    CONSTRAINT canvas_generation_resolution_operator_check
        CHECK (
            pg_catalog.length(operator_label) BETWEEN 3 AND 120
            AND operator_label ~ '^[A-Za-z0-9._@:-]+$'
        ),
    CONSTRAINT canvas_generation_resolution_evidence_check
        CHECK (
            pg_catalog.length(provider_evidence) BETWEEN 8 AND 2000
            AND provider_evidence !~ '[[:cntrl:]]'
        ),
    CONSTRAINT canvas_generation_resolution_shape_check
        CHECK (
            (
                resolution = 'bind_task'
                AND task_id IS NOT NULL
                AND refunded_amount = 0
                AND status_after = 'processing'
                AND provider_submission_state_after = 'bound'
            )
            OR
            (
                resolution = 'verified_no_task_refund'
                AND task_id IS NULL
                AND refunded_amount >= 0
                AND status_after = 'failed'
                AND provider_submission_state_after = 'unknown'
            )
        ),
    CONSTRAINT canvas_generation_resolution_previous_state_check
        CHECK (previous_provider_submission_state = 'unknown')
);

CREATE UNIQUE INDEX IF NOT EXISTS canvas_generation_resolution_audit_once_idx
    ON public.canvas_generation_resolution_audit (generation_id);

ALTER TABLE public.canvas_generation_resolution_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_generation_resolution_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canvas_generation_resolution_audit
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.canvas_generation_resolution_audit TO service_role;

CREATE OR REPLACE FUNCTION public.reject_canvas_generation_resolution_audit_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'canvas_generation_resolution_audit is append-only'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_canvas_generation_resolution_audit_mutation_v1()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS canvas_generation_resolution_audit_append_only
    ON public.canvas_generation_resolution_audit;
CREATE TRIGGER canvas_generation_resolution_audit_append_only
    BEFORE UPDATE OR DELETE ON public.canvas_generation_resolution_audit
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_canvas_generation_resolution_audit_mutation_v1();

-- ---------------------------------------------------------------------------
-- Provably pre-provider stale-row sweep.
--
-- The ten-minute threshold is pinned in the database, not caller-controlled.
-- The candidate row is locked before abandon_canvas_generation_v1 rechecks the
-- exact clean shape and applies the existing idempotent refund anchor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_stale_canvas_not_started_v1(
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    generation_id   uuid,
    action_id       uuid,
    refunded_amount integer,
    balance_after   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_stale_after constant interval := interval '10 minutes';
    v_candidate record;
    v_abandon record;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION
            'sweep_stale_canvas_not_started_v1: limit must be 1..500'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOR v_candidate IN
        SELECT g.id, g.user_id, g.action_id
          FROM public.generations g
         WHERE g.source = 'canvas'
           AND g.action_id IS NOT NULL
           AND g.status = 'pending'
           AND g.provider_submission_state = 'not_started'
           AND g.submission_token_hash IS NULL
           AND g.submission_started_at IS NULL
         AND g.task_id IS NULL
           AND g.created_at <= pg_catalog.clock_timestamp() - c_stale_after
         ORDER BY g.created_at, g.id
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    LOOP
        SELECT a.*
          INTO STRICT v_abandon
          FROM public.abandon_canvas_generation_v1(
              v_candidate.user_id,
              v_candidate.action_id
          ) AS a;

        generation_id   := v_candidate.id;
        action_id       := v_candidate.action_id;
        refunded_amount := v_abandon.refunded_amount;
        balance_after   := v_abandon.balance_after;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sweep_stale_canvas_not_started_v1(integer) IS
    'Service-only SKIP LOCKED sweep of Canvas rows that are at least ten minutes old and still provably never claimed/submitted. Reuses abandon_canvas_generation_v1 for an exactly-once paid refund; free quota remains consumed.';

REVOKE ALL ON FUNCTION public.sweep_stale_canvas_not_started_v1(integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_canvas_not_started_v1(integer)
    TO service_role;

-- ---------------------------------------------------------------------------
-- Audited manual resolution for task-less Canvas video uncertainty.
--
-- No automatic caller may use this function. `provider_evidence` is a required
-- operator reference (provider ticket/query result), not a boolean assertion.
-- The resolution UUID makes a lost response safely replayable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_canvas_video_unknown_v1(
    p_resolution_id     uuid,
    p_generation_id     uuid,
    p_resolution        text,
    p_task_id           text,
    p_operator_label    text,
    p_provider_evidence text
)
RETURNS TABLE (
    resolution_id                    uuid,
    generation_id                    uuid,
    status                           text,
    provider_submission_state        text,
    task_id                          text,
    refunded_amount                  integer,
    balance_after                    integer,
    transitioned                     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen       public.generations%ROWTYPE;
    v_audit     public.canvas_generation_resolution_audit%ROWTYPE;
    v_refund    integer := 0;
    v_balance   integer;
    v_task_id   text;
    v_row_count bigint;
BEGIN
    IF p_resolution_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: resolution and generation ids are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_resolution NOT IN ('bind_task', 'verified_no_task_refund') THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: unsupported resolution %',
            COALESCE(p_resolution, '<null>')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_operator_label IS NULL
       OR pg_catalog.length(p_operator_label) NOT BETWEEN 3 AND 120
       OR p_operator_label !~ '^[A-Za-z0-9._@:-]+$' THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: operator_label is invalid'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_provider_evidence IS NULL
       OR pg_catalog.length(p_provider_evidence) NOT BETWEEN 8 AND 2000
       OR p_provider_evidence ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: provider_evidence is invalid'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_task_id := NULLIF(pg_catalog.btrim(p_task_id), '');
    IF p_resolution = 'bind_task' THEN
        IF v_task_id IS NULL
           OR pg_catalog.length(v_task_id) > 256
           OR v_task_id !~ '^[A-Za-z0-9._:-]+$' THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: bind_task requires a canonical task id'
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
    ELSIF p_task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: refund resolution must not carry a task id'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The generation row serializes first execution, idempotent replay, and a
    -- conflicting second operator decision for the same uncertainty.
    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.source = 'canvas'
       AND g.action_id IS NOT NULL
     FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: no Canvas action row %',
            p_generation_id;
    END IF;

    SELECT a.* INTO v_audit
      FROM public.canvas_generation_resolution_audit a
     WHERE a.resolution_id = p_resolution_id;

    IF FOUND THEN
        IF v_audit.generation_id IS DISTINCT FROM p_generation_id
           OR v_audit.resolution IS DISTINCT FROM p_resolution
           OR v_audit.task_id IS DISTINCT FROM v_task_id
           OR v_audit.operator_label IS DISTINCT FROM p_operator_label
           OR v_audit.provider_evidence IS DISTINCT FROM p_provider_evidence THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: resolution id was reused with different input'
                USING ERRCODE = 'check_violation';
        END IF;

        resolution_id             := v_audit.resolution_id;
        generation_id             := v_audit.generation_id;
        status                    := v_audit.status_after;
        provider_submission_state := v_audit.provider_submission_state_after;
        task_id                   := v_audit.task_id;
        refunded_amount           := v_audit.refunded_amount;
        balance_after             := v_audit.balance_after;
        transitioned              := false;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_gen.type <> 'video'
       OR v_gen.status <> 'pending'
       OR v_gen.provider_submission_state <> 'unknown'
       OR v_gen.task_id IS NOT NULL
       OR v_gen.submission_token_hash IS NULL
       OR v_gen.submission_started_at IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: generation % is not task-less pending video uncertainty',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF p_resolution = 'bind_task' THEN
        -- Serialize the "is this provider task already bound?" proof even when
        -- two different unknown rows are resolved concurrently.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('canvas-provider-task:' || v_task_id, 0)
        );
        PERFORM 1
          FROM public.generations other
         WHERE other.id <> v_gen.id
           AND other.task_id = v_task_id;
        IF FOUND THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: provider task is already bound'
                USING ERRCODE = 'unique_violation';
        END IF;

        UPDATE public.generations g
           SET status                     = 'processing',
               provider_submission_state  = 'bound',
               task_id                    = v_task_id,
               next_reconcile_at          = pg_catalog.now(),
               reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               last_reconcile_error_code  = 'operator_recovered_provider_task'
         WHERE g.id = v_gen.id
           AND g.status = 'pending'
           AND g.provider_submission_state = 'unknown'
           AND g.task_id IS NULL;
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count <> 1 THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: bind lost its state fence'
                USING ERRCODE = 'serialization_failure';
        END IF;
    ELSE
        UPDATE public.generations g
           SET status                     = 'failed',
               error_message              = 'operator_verified_no_provider_task',
               completed_at               = pg_catalog.now(),
               next_reconcile_at          = NULL,
               reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               last_reconcile_error_code  = 'operator_verified_no_provider_task'
         WHERE g.id = v_gen.id
           AND g.status = 'pending'
           AND g.provider_submission_state = 'unknown'
           AND g.task_id IS NULL;
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count <> 1 THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: refund lost its state fence'
                USING ERRCODE = 'serialization_failure';
        END IF;

        IF v_gen.billing_mode = 'debit' AND v_gen.credit_cost > 0 THEN
            v_refund := v_gen.credit_cost - v_gen.credits_refunded;
            IF v_refund > 0 THEN
                SELECT d.balance_after INTO v_balance
                  FROM public.canvas_p1_apply_credit_delta_v1(
                      p_user_id            => v_gen.user_id,
                      p_entry_kind         => 'refund',
                      p_amount             => v_refund,
                      p_operation_anchor   => 'canvas-refund:' || v_gen.id::text,
                      p_generation_id      => v_gen.id,
                      p_action_id          => v_gen.action_id,
                      p_canvas_id          => v_gen.canvas_id,
                      p_canvas_id_snapshot => v_gen.canvas_id_snapshot,
                      p_canvas_node_id     => v_gen.canvas_node_id,
                      p_pricing_version    => v_gen.pricing_version,
                      p_description        => 'Canvas operator-verified absent-task refund'
                  ) AS d;

                UPDATE public.generations
                   SET credits_refunded = v_gen.credit_cost
                 WHERE id = v_gen.id;
            END IF;
        END IF;
    END IF;

    IF v_balance IS NULL THEN
        SELECT pr.credits INTO v_balance
          FROM public.profiles pr
         WHERE pr.id = v_gen.user_id;
    END IF;
    IF v_balance IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: profile balance is unavailable';
    END IF;

    INSERT INTO public.canvas_generation_resolution_audit (
        resolution_id,
        generation_id,
        user_id,
        action_id,
        resolution,
        operator_label,
        provider_evidence,
        previous_provider_submission_state,
        status_after,
        provider_submission_state_after,
        task_id,
        refunded_amount,
        balance_after
    ) VALUES (
        p_resolution_id,
        v_gen.id,
        v_gen.user_id,
        v_gen.action_id,
        p_resolution,
        p_operator_label,
        p_provider_evidence,
        'unknown',
        CASE p_resolution WHEN 'bind_task' THEN 'processing' ELSE 'failed' END,
        CASE p_resolution WHEN 'bind_task' THEN 'bound' ELSE 'unknown' END,
        v_task_id,
        v_refund,
        v_balance
    );

    resolution_id             := p_resolution_id;
    generation_id             := v_gen.id;
    status                    := CASE p_resolution WHEN 'bind_task' THEN 'processing' ELSE 'failed' END;
    provider_submission_state := CASE p_resolution WHEN 'bind_task' THEN 'bound' ELSE 'unknown' END;
    task_id                   := v_task_id;
    refunded_amount           := v_refund;
    balance_after             := v_balance;
    transitioned              := true;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text) IS
    'Service-only, idempotent and append-only-audited resolution for task-less pending/unknown Canvas videos. Bind a provider-proven task or refund only with provider evidence that no task exists. Never resubmits upstream work.';

REVOKE ALL ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text)
    TO service_role;

NOTIFY pgrst, 'reload schema';
