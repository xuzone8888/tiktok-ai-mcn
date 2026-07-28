-- ============================================================================
-- Canvas P1 · Batch 2 Stage B.3 · bind / mark-unknown / fail / complete
--                                 + generic reconciliation lane
--                                 + GPT Image 2 direct-media recovery lane
--                                 + DeepSeek stale-text sweeper
--
-- Requires 20260718_canvas_p1_generation_api.sql.
--
-- No function in this file calls a provider. Several of them accept a caller's
-- assertion that a provider outcome or a media object was already validated;
-- those assertions are only ever accepted through service-role-only functions
-- and must still satisfy every structural, state, identity and authority check
-- below. "Trusted" never means "unchecked".
-- ============================================================================

-- ###########################################################################
-- 1. bind_canvas_generation_task_v1
--
-- Two mutually exclusive authority branches, no overlap:
--   submission_bearer    -- the original token holder binds a task returned by
--                           that same already-dispatched call. From submitting
--                           OR unknown (a late task after an ambiguous outcome
--                           still binds safely). No provider call, no resubmit.
--   reconciliation_lease -- a provider-specific discovery lane binds a task it
--                           discovered, only in its allowed state, only with the
--                           exact trusted profile, and only under the exact
--                           current unexpired owner/token/expiry tuple.
--
-- Text rejects outright. A differing task id rejects. Any terminal row rejects.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.bind_canvas_generation_task_v1(
    p_user_id       uuid,
    p_generation_id uuid,
    p_authority     jsonb,
    p_task_id       text
)
RETURNS TABLE (
    generation_id             uuid,
    status                    text,
    provider_submission_state text,
    next_reconcile_at         timestamptz,
    bound                     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth record;
    v_gen  public.generations%ROWTYPE;
    v_next timestamptz;
BEGIN
    -- Authority is parsed BEFORE any row lookup, per contract.
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    IF p_task_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_task_id)) = 0 THEN
        RAISE EXCEPTION 'bind_canvas_generation_task_v1: task_id must be nonblank';
    END IF;

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.user_id = p_user_id
       AND g.action_id IS NOT NULL
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bind_canvas_generation_task_v1: no owned action row %', p_generation_id;
    END IF;

    -- NO pre-authority idempotency branch.
    --
    -- The previous revision returned same-task success HERE, before validating
    -- the bearer/lease authority or the allowed state. That let anyone holding a
    -- generation id confirm-by-probing whether a task was bound and what its id
    -- was, using a syntactically valid but unauthorized DTO -- idempotency
    -- degenerating into an authorization bypass. Contract item 6 admits a bind
    -- only when task_id IS NULL, so a second bind is simply not a positive path.
    -- A lost bind RESPONSE is recovered through the separate exact-identity
    -- replay_canvas_generation_bind_v1 below, which mirrors the completion
    -- contract's replay boundary and accepts no authority DTO at all.
    --
    -- Authority and state are therefore validated first, and a non-null task_id
    -- always rejects -- same value or not.

    -- Direct text never binds a task: DeepSeek completes the same row directly
    -- and must never invent a task id.
    IF v_gen.type = 'text' THEN
        RAISE EXCEPTION
            'bind_canvas_generation_task_v1: direct text row % may never bind a task', p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_gen.status <> 'pending' THEN
        RAISE EXCEPTION
            'bind_canvas_generation_task_v1: generation % is % (only pending may bind)',
            p_generation_id, v_gen.status
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_gen.provider_submission_state NOT IN ('submitting', 'unknown') THEN
        RAISE EXCEPTION
            'bind_canvas_generation_task_v1: generation % is in submission state % (need submitting|unknown)',
            p_generation_id, v_gen.provider_submission_state
            USING ERRCODE = 'check_violation';
    END IF;

    -- Contract item 6: bind requires a task-less row. Any already-bound row
    -- rejects here -- including a rebind of the identical task id. Use
    -- replay_canvas_generation_bind_v1 to recover a lost bind response.
    IF v_gen.task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'bind_canvas_generation_task_v1: generation % already carries a task; bind requires a '
            'task-less row. Use replay_canvas_generation_bind_v1 for a lost bind response.',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- Every async bind requires a reviewed profile and a positive interval:
    -- binding without a schedule would strand the row forever.
    IF v_gen.reconcile_profile_version IS NULL
       OR v_gen.reconcile_interval_ms IS NULL
       OR v_gen.reconcile_interval_ms <= 0 THEN
        RAISE EXCEPTION
            'bind_canvas_generation_task_v1: generation % has no reviewed profile/positive interval',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_auth.kind = 'submission_bearer' THEN
        IF v_gen.submission_token_hash IS NULL
           OR v_gen.submission_token_hash <> public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
            RAISE EXCEPTION
                'bind_canvas_generation_task_v1: bearer token does not match generation %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF v_auth.kind = 'reconciliation_lease' THEN
        -- Exact CURRENT tuple, and database time must still be before expiry.
        -- Owner identity alone is never authority: the token must match too, so
        -- a reclaim by the same worker id with a fresh token invalidates the old.
        IF v_gen.reconcile_owner IS NULL
           OR v_gen.reconcile_owner <> v_auth.lease_owner
           OR v_gen.reconcile_lease_token IS NULL
           OR v_gen.reconcile_lease_token <> v_auth.lease_token
           OR v_gen.reconcile_lease_expires_at IS NULL
           OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
           OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION
                'bind_canvas_generation_task_v1: stale or mismatched reconciliation lease for %',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    v_next := pg_catalog.now() + (v_gen.reconcile_interval_ms || ' milliseconds')::interval;

    UPDATE public.generations
       SET task_id                    = p_task_id,
           provider_submission_state  = 'bound',
           status                     = 'processing',
           next_reconcile_at          = v_next,
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL
     WHERE id = v_gen.id;

    generation_id             := v_gen.id;
    status                    := 'processing';
    provider_submission_state := 'bound';
    next_reconcile_at         := v_next;
    bound                     := true;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_canvas_generation_task_v1(uuid, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_canvas_generation_task_v1(uuid, uuid, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 1b. replay_canvas_generation_bind_v1
--
-- The explicit exact-identity recovery contract for a LOST BIND RESPONSE, added
-- so that bind itself can stay strict (task-less rows only) without stranding a
-- caller whose response vanished after the bind committed.
--
-- Mirrors replay_canvas_generation_completion_v1 exactly: it accepts NO bearer
-- and NO lease DTO, verifies the full owner + generation + action + canvas +
-- node + fingerprint identity, requires the exact task id the caller believes it
-- bound, and mutates nothing. Identity IS the authority here, which is why it
-- can be safe without a token: a caller that can already prove every immutable
-- field of the row learns nothing new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replay_canvas_generation_bind_v1(
    p_user_id             uuid,
    p_generation_id       uuid,
    p_action_id           uuid,
    p_canvas_id           uuid,
    p_canvas_node_id      text,
    p_request_fingerprint text,
    p_task_id             text
)
RETURNS TABLE (
    generation_id             uuid,
    status                    text,
    provider_submission_state text,
    task_id                   text,
    next_reconcile_at         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen public.generations%ROWTYPE;
BEGIN
    IF p_task_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_task_id)) = 0 THEN
        RAISE EXCEPTION 'replay_canvas_generation_bind_v1: task_id must be nonblank';
    END IF;

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.user_id = p_user_id
       AND g.action_id = p_action_id
       AND g.canvas_id_snapshot = p_canvas_id
       AND g.canvas_node_id = p_canvas_node_id
       AND g.request_fingerprint = p_request_fingerprint;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'replay_canvas_generation_bind_v1: no generation matching the exact '
            'owner/generation/action/canvas/node/fingerprint identity';
    END IF;

    -- The claimed task must be exactly what is stored. A mismatch is never a
    -- lost response; it is a different task and must not be confirmed.
    IF v_gen.task_id IS DISTINCT FROM p_task_id THEN
        RAISE EXCEPTION
            'replay_canvas_generation_bind_v1: generation % does not carry the claimed task',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_gen.provider_submission_state <> 'bound' THEN
        RAISE EXCEPTION
            'replay_canvas_generation_bind_v1: generation % is in submission state %, not bound',
            p_generation_id, v_gen.provider_submission_state
            USING ERRCODE = 'check_violation';
    END IF;

    generation_id             := v_gen.id;
    status                    := v_gen.status;
    provider_submission_state := v_gen.provider_submission_state;
    task_id                   := v_gen.task_id;
    next_reconcile_at         := v_gen.next_reconcile_at;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.replay_canvas_generation_bind_v1 IS
    'Zero-mutation lost-bind-response replay. Accepts no bearer/lease DTO; verifies exact owner+generation+action+canvas+node+fingerprint identity and the exact stored task id.';

REVOKE ALL ON FUNCTION public.replay_canvas_generation_bind_v1(uuid, uuid, uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_canvas_generation_bind_v1(uuid, uuid, uuid, uuid, text, text, text)
    TO service_role;

-- ###########################################################################
-- 2. mark_canvas_generation_unknown_v1
--
-- Conservative uncertainty. Never refunds, never resubmits, always retains the
-- original submission_token_hash so the original in-flight call can still bind
-- a late task (or, for text, complete via exception 9(a)).
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.mark_canvas_generation_unknown_v1(
    p_user_id       uuid,
    p_generation_id uuid,
    p_authority     jsonb,
    p_error_code    text DEFAULT NULL
)
RETURNS TABLE (
    generation_id             uuid,
    provider_submission_state text,
    next_reconcile_at         timestamptz,
    transitioned              boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_stale_after constant interval := interval '2 minutes';
    v_auth record;
    v_gen  public.generations%ROWTYPE;
    v_next timestamptz;
BEGIN
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.user_id = p_user_id
       AND g.action_id IS NOT NULL
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'mark_canvas_generation_unknown_v1: no owned action row %', p_generation_id;
    END IF;

    -- AUTHORITY BEFORE IDEMPOTENCY.
    --
    -- The previous revision returned the already-unknown no-op here, ahead of
    -- any authority check, so an unauthorized caller could read back the row's
    -- submission state and schedule. Authority is now proven first; only then
    -- may idempotency short-circuit. The bearer branch still works on an
    -- already-unknown row because mark-unknown deliberately RETAINS the
    -- submission hash; a lease cannot, because the transition clears it -- which
    -- is correct, since a lease holder re-claims rather than replays.
    IF v_auth.kind = 'submission_bearer' THEN
        IF v_gen.submission_token_hash IS NULL
           OR v_gen.submission_token_hash <> public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: bearer token does not match %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF v_gen.reconcile_owner IS NULL
           OR v_gen.reconcile_owner <> v_auth.lease_owner
           OR v_gen.reconcile_lease_token IS NULL
           OR v_gen.reconcile_lease_token <> v_auth.lease_token
           OR v_gen.reconcile_lease_expires_at IS NULL
           OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
           OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: stale or mismatched lease for %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Idempotent: already unknown is a no-op, not a reschedule.
    IF v_gen.provider_submission_state = 'unknown' THEN
        generation_id             := v_gen.id;
        provider_submission_state := 'unknown';
        next_reconcile_at         := v_gen.next_reconcile_at;
        transitioned              := false;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Only an UNBOUND submitting row may become unknown.
    IF v_gen.status <> 'pending'
       OR v_gen.provider_submission_state <> 'submitting'
       OR v_gen.task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'mark_canvas_generation_unknown_v1: generation % is not an unbound submitting row '
            '(status=%, state=%, has_task=%)',
            p_generation_id, v_gen.status, v_gen.provider_submission_state,
            (v_gen.task_id IS NOT NULL)
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_auth.kind = 'submission_bearer' THEN
        IF v_gen.submission_token_hash IS NULL
           OR v_gen.submission_token_hash <> public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: bearer token does not match %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF v_auth.kind = 'reconciliation_lease' THEN
        -- The generic stale lane. A disappeared VIDEO submitter may make this
        -- transition after two minutes with its exact current lease.
        --
        -- GPT Image 2 is excluded on purpose: its stale-unbound rows must first
        -- be inspected by the dedicated direct-media recovery lane, which can
        -- prove an exact-key object and complete instead of losing it to
        -- unknown. Text has no profile and therefore no lease at all.
        IF v_gen.type = 'image' THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: image row % may not be marked unknown by the '
                'generic lane; use the GPT direct-media recovery lane', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.type = 'text' THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: text row % has no lease authority', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.submission_started_at IS NULL
           OR v_gen.submission_started_at > pg_catalog.now() - c_stale_after THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: generation % is not yet stale (2 minute floor)',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.reconcile_owner IS NULL
           OR v_gen.reconcile_owner <> v_auth.lease_owner
           OR v_gen.reconcile_lease_token IS NULL
           OR v_gen.reconcile_lease_token <> v_auth.lease_token
           OR v_gen.reconcile_lease_expires_at IS NULL
           OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
           OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: stale or mismatched lease for %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Profile-less direct text becomes UNSCHEDULED unknown; async kinds get
    -- exactly one stored interval of schedule.
    IF v_gen.type = 'text' THEN
        IF v_gen.reconcile_profile_version IS NOT NULL
           OR v_gen.reconcile_interval_ms IS NOT NULL
           OR v_gen.next_reconcile_at IS NOT NULL THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: text row % unexpectedly carries reconciliation state',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
        v_next := NULL;
    ELSE
        IF v_gen.reconcile_interval_ms IS NULL OR v_gen.reconcile_interval_ms <= 0 THEN
            RAISE EXCEPTION
                'mark_canvas_generation_unknown_v1: generation % has no positive reconciliation interval',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
        v_next := pg_catalog.now() + (v_gen.reconcile_interval_ms || ' milliseconds')::interval;
    END IF;

    UPDATE public.generations
       SET provider_submission_state  = 'unknown',
           -- submission_token_hash is deliberately NOT cleared.
           last_reconcile_error_code  = COALESCE(p_error_code, 'submission_outcome_unknown'),
           next_reconcile_at          = v_next,
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL
     WHERE id = v_gen.id;

    generation_id             := v_gen.id;
    provider_submission_state := 'unknown';
    next_reconcile_at         := v_next;
    transitioned              := true;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_canvas_generation_unknown_v1(uuid, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_canvas_generation_unknown_v1(uuid, uuid, jsonb, text) TO service_role;

-- ###########################################################################
-- 3. fail_canvas_generation_v1
--
-- generation -> profile (FOR NO KEY UPDATE). Only a classified definite
-- rejection or a bound provider terminal failure may fail a row. `unknown` is
-- NEVER automatically failed or refunded.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.fail_canvas_generation_v1(
    p_user_id       uuid,
    p_generation_id uuid,
    p_authority     jsonb,
    p_error_code    text
)
RETURNS TABLE (
    generation_id   uuid,
    status          text,
    transitioned    boolean,
    refunded_amount integer,
    balance_after   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth    record;
    v_gen     public.generations%ROWTYPE;
    v_refund  integer := 0;
    v_balance integer;
BEGIN
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    IF p_error_code IS NULL OR pg_catalog.length(pg_catalog.btrim(p_error_code)) = 0 THEN
        RAISE EXCEPTION 'fail_canvas_generation_v1: a nonblank error_code is required';
    END IF;

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.user_id = p_user_id
       AND g.action_id IS NOT NULL
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fail_canvas_generation_v1: no owned action row %', p_generation_id;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 1 — AUTHORITY FIRST, before any state disclosure or short-circuit.
    --------------------------------------------------------------------------
    IF v_auth.kind = 'submission_bearer' THEN
        IF v_gen.submission_token_hash IS NULL
           OR v_gen.submission_token_hash <> public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
            RAISE EXCEPTION 'fail_canvas_generation_v1: bearer token does not match %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF v_gen.reconcile_owner IS NULL
           OR v_gen.reconcile_owner <> v_auth.lease_owner
           OR v_gen.reconcile_lease_token IS NULL
           OR v_gen.reconcile_lease_token <> v_auth.lease_token
           OR v_gen.reconcile_lease_expires_at IS NULL
           OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
           OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION 'fail_canvas_generation_v1: stale or mismatched lease for %', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 2 — idempotent repetition, now only reachable WITH valid authority.
    --------------------------------------------------------------------------
    IF v_gen.status IN ('failed', 'completed') THEN
        SELECT pr.credits INTO v_balance FROM public.profiles pr WHERE pr.id = p_user_id;

        generation_id   := v_gen.id;
        status          := v_gen.status;
        transitioned    := false;
        refunded_amount := v_gen.credits_refunded;
        balance_after   := v_balance;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_gen.status NOT IN ('pending', 'processing') THEN
        RAISE EXCEPTION 'fail_canvas_generation_v1: generation % is % and cannot fail',
            p_generation_id, v_gen.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Uncertainty is never resolved by failing/refunding.
    IF v_gen.provider_submission_state = 'unknown' THEN
        RAISE EXCEPTION
            'fail_canvas_generation_v1: generation % is unknown; automatic fail/refund is forbidden',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    --------------------------------------------------------------------------
    -- STEP 3 — LANE-SPECIFIC SHAPE. Contract item 8 admits exactly two causes:
    -- a classified definite rejection (pre-bind, seen by the original caller)
    -- or a bound provider terminal failure (seen by a reconciliation lease).
    -- Authority alone was NOT enough in the previous revision: a retained
    -- original bearer could fail+refund an already-bound PROCESSING task whose
    -- provider work was still running -- refunding live paid work and stranding
    -- the upstream job. Each authority is now pinned to its own row shape.
    --------------------------------------------------------------------------
    IF v_auth.kind = 'submission_bearer' THEN
        IF v_gen.status <> 'pending'
           OR v_gen.provider_submission_state <> 'submitting'
           OR v_gen.task_id IS NOT NULL THEN
            RAISE EXCEPTION
                'fail_canvas_generation_v1: bearer-authorized fail requires the pre-bind '
                'definite-rejection shape (pending/submitting/task-less); generation % is '
                '(status=%, state=%, has_task=%). A bound task may only be failed through its '
                'reconciliation lease.',
                p_generation_id, v_gen.status, v_gen.provider_submission_state,
                (v_gen.task_id IS NOT NULL)
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF v_gen.status <> 'processing'
           OR v_gen.provider_submission_state <> 'bound'
           OR v_gen.task_id IS NULL THEN
            RAISE EXCEPTION
                'fail_canvas_generation_v1: lease-authorized fail requires the bound '
                'provider-terminal shape (processing/bound/task); generation % is '
                '(status=%, state=%, has_task=%)',
                p_generation_id, v_gen.status, v_gen.provider_submission_state,
                (v_gen.task_id IS NOT NULL)
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE public.generations
       SET status                     = 'failed',
           error_message              = p_error_code,
           completed_at               = pg_catalog.now(),
           next_reconcile_at          = NULL,
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL
     WHERE id = v_gen.id;

    -- Refund AT MOST the recorded charge, exactly once, via the shared boundary.
    IF v_gen.billing_mode = 'debit' AND v_gen.credit_cost > 0 THEN
        v_refund := v_gen.credit_cost - v_gen.credits_refunded;

        IF v_refund > 0 THEN
            SELECT d.balance_after INTO v_balance
              FROM public.canvas_p1_apply_credit_delta_v1(
                  p_user_id            => p_user_id,
                  p_entry_kind         => 'refund',
                  p_amount             => v_refund,
                  p_operation_anchor   => 'canvas-refund:' || v_gen.id::text,
                  p_generation_id      => v_gen.id,
                  p_action_id          => v_gen.action_id,
                  p_canvas_id          => v_gen.canvas_id,
                  p_canvas_id_snapshot => v_gen.canvas_id_snapshot,
                  p_canvas_node_id     => v_gen.canvas_node_id,
                  p_task_id            => v_gen.task_id,
                  p_pricing_version    => v_gen.pricing_version,
                  p_description        => 'Canvas failure refund'
              ) AS d;

            UPDATE public.generations
               SET credits_refunded = v_gen.credit_cost
             WHERE id = v_gen.id;
        END IF;
    END IF;

    IF v_balance IS NULL THEN
        SELECT pr.credits INTO v_balance FROM public.profiles pr WHERE pr.id = p_user_id;
    END IF;

    generation_id   := v_gen.id;
    status          := 'failed';
    transitioned    := true;
    refunded_amount := v_refund;
    balance_after   := v_balance;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_canvas_generation_v1(uuid, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_canvas_generation_v1(uuid, uuid, jsonb, text) TO service_role;

-- ###########################################################################
-- 4. complete_canvas_generation_v1
--
-- THE EXHAUSTIVE MATRIX. Six mutually exclusive positive branches; every other
-- combination of kind/status/submission-state/task/profile/authority/token/
-- lease/expiry/key/metadata rejects.
--
--   B1 text   + bearer + pending + submitting  -> output_text
--   B2 text   + bearer + pending + unknown     -> output_text        (exc. 9a)
--   B3 img/vid+ lease  + processing + bound + task -> planned key
--   B4 image  + bearer + pending + submitting + GPT profile -> planned key
--   B5 image  + lease  + pending + submitting + GPT profile -> planned key
--   B6 image  + lease  + pending + unknown    + GPT profile -> planned key (exc. 9b)
--
-- Explicitly forbidden and called out below: ANY submitting-video completion,
-- and ANY video unknown completion, even with a valid lease and apparent media.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.complete_canvas_generation_v1(
    p_user_id        uuid,
    p_generation_id  uuid,
    p_authority      jsonb,
    p_output_text    text  DEFAULT NULL,
    p_output_oss_key text  DEFAULT NULL,
    p_media_metadata jsonb DEFAULT NULL
)
RETURNS TABLE (
    generation_id  uuid,
    status         text,
    output_text    text,
    output_oss_key text,
    transitioned   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_gpt_profile  constant text    := 'gpt-image-2-poll-v1';
    c_gpt_interval constant integer := 30000;

    v_auth   record;
    v_gen    public.generations%ROWTYPE;
    v_branch text := NULL;
BEGIN
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.user_id = p_user_id
       AND g.action_id IS NOT NULL
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'complete_canvas_generation_v1: no owned action row %', p_generation_id;
    END IF;

    --------------------------------------------------------------------------
    -- Already completed: ALWAYS reject. There is no success path here.
    --
    -- The previous revision returned success when the presented output happened
    -- to match the stored output. That is an authority bypass: it answered
    -- before the DTO had been matched against the row's current bearer/lease, so
    -- a caller holding only a generation id plus a guessed/observed output could
    -- have a completion confirmed. It also duplicated -- loosely -- a boundary
    -- the frozen contract deliberately puts elsewhere.
    --
    -- Contract item 9: "Completed-response replay is not a bind/complete
    -- authority branch." A lost completion response is recovered ONLY through
    -- replay_canvas_generation_completion_v1, which proves the exact
    -- owner/generation/action/canvas/node/fingerprint identity AND the exact
    -- existing output, accepts no bearer or lease, and mutates nothing.
    --
    -- A bearer-versus-lease race loser therefore "observes terminal state and
    -- performs no mutation" -- which is precisely this rejection.
    --------------------------------------------------------------------------
    IF v_gen.status = 'completed' THEN
        RAISE EXCEPTION
            'complete_canvas_generation_v1: generation % is already completed; completion is not '
            'idempotent by design. Use replay_canvas_generation_completion_v1 with the exact '
            'owner/action/canvas/node/fingerprint identity to recover a lost response.',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- A late result after failed/refunded may never revive the task.
    IF v_gen.status = 'failed' THEN
        RAISE EXCEPTION
            'complete_canvas_generation_v1: generation % is terminal (failed); a late result is '
            'audit-only and may not revive it', p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    --------------------------------------------------------------------------
    -- Output shape gate. Text writes only text; media writes only the exact
    -- persisted planned key. No caller may choose or substitute another key.
    --------------------------------------------------------------------------
    IF v_gen.type = 'text' THEN
        IF p_output_text IS NULL OR pg_catalog.length(p_output_text) = 0 THEN
            RAISE EXCEPTION 'complete_canvas_generation_v1: text completion requires validated output_text';
        END IF;
        IF p_output_oss_key IS NOT NULL OR p_media_metadata IS NOT NULL THEN
            RAISE EXCEPTION 'complete_canvas_generation_v1: text completion may not carry media output';
        END IF;
    ELSE
        IF p_output_text IS NOT NULL THEN
            RAISE EXCEPTION 'complete_canvas_generation_v1: media completion may not carry output_text';
        END IF;
        IF p_output_oss_key IS NULL THEN
            RAISE EXCEPTION 'complete_canvas_generation_v1: media completion requires output_oss_key';
        END IF;
        IF v_gen.planned_output_oss_key IS NULL THEN
            RAISE EXCEPTION
                'complete_canvas_generation_v1: generation % has no persisted planned key', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
        IF p_output_oss_key <> v_gen.planned_output_oss_key THEN
            RAISE EXCEPTION
                'complete_canvas_generation_v1: output key does not equal the persisted planned key for %',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        -- Server-stamped object metadata must name THIS generation/user/action.
        -- This is what makes a pre-existing, partial, mismatched or unrelated
        -- object at the key rejectable.
        IF p_media_metadata IS NULL
           OR pg_catalog.jsonb_typeof(p_media_metadata) <> 'object'
           OR (p_media_metadata ->> 'generationId') IS DISTINCT FROM v_gen.id::text
           OR (p_media_metadata ->> 'userId')       IS DISTINCT FROM v_gen.user_id::text
           OR (p_media_metadata ->> 'actionId')     IS DISTINCT FROM v_gen.action_id::text THEN
            RAISE EXCEPTION
                'complete_canvas_generation_v1: media metadata does not match generation % identity',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    --------------------------------------------------------------------------
    -- Branch selection. Exactly one may match.
    --------------------------------------------------------------------------

    -- B1 / B2 — direct DeepSeek text, bearer only, profile-less shape.
    IF v_gen.type = 'text' AND v_auth.kind = 'submission_bearer' THEN
        IF v_gen.status = 'pending'
           AND v_gen.provider_submission_state IN ('submitting', 'unknown')
           AND v_gen.task_id IS NULL
           AND v_gen.reconcile_profile_version IS NULL
           AND v_gen.reconcile_interval_ms IS NULL
           AND v_gen.next_reconcile_at IS NULL
           AND v_gen.submission_token_hash IS NOT NULL
           AND v_gen.submission_token_hash = public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
            v_branch := CASE v_gen.provider_submission_state
                            WHEN 'submitting' THEN 'B1_text_direct'
                            ELSE 'B2_text_unknown_9a'
                        END;
        END IF;

    -- B3 — normal asynchronous image/video, lease only, bound + processing.
    ELSIF v_gen.type IN ('image', 'video') AND v_auth.kind = 'reconciliation_lease'
          AND v_gen.status = 'processing'
          AND v_gen.provider_submission_state = 'bound'
          AND v_gen.task_id IS NOT NULL
          AND pg_catalog.length(pg_catalog.btrim(v_gen.task_id)) > 0
          AND v_gen.reconcile_owner IS NOT NULL
          AND v_gen.reconcile_owner = v_auth.lease_owner
          AND v_gen.reconcile_lease_token IS NOT NULL
          AND v_gen.reconcile_lease_token = v_auth.lease_token
          AND v_gen.reconcile_lease_expires_at IS NOT NULL
          AND v_gen.reconcile_lease_expires_at = v_auth.lease_expires_at
          AND v_gen.reconcile_lease_expires_at > pg_catalog.now() THEN
        v_branch := 'B3_async_bound';

    -- B4 — immediate GPT Image 2 accepted media, bearer, still submitting.
    ELSIF v_gen.type = 'image' AND v_auth.kind = 'submission_bearer'
          AND v_gen.status = 'pending'
          AND v_gen.provider_submission_state = 'submitting'
          AND v_gen.task_id IS NULL
          AND v_gen.reconcile_profile_version = c_gpt_profile
          AND v_gen.reconcile_interval_ms = c_gpt_interval
          AND v_gen.submission_token_hash IS NOT NULL
          AND v_gen.submission_token_hash = public.canvas_p1_hash_bearer_v1(v_auth.bearer_token) THEN
        v_branch := 'B4_gpt_immediate';

    -- B5 / B6 — leased GPT recovery: stale submitting (normal completion) or
    -- unknown (exception 9b). Same exact proof, different source state.
    ELSIF v_gen.type = 'image' AND v_auth.kind = 'reconciliation_lease'
          AND v_gen.status = 'pending'
          AND v_gen.provider_submission_state IN ('submitting', 'unknown')
          AND v_gen.task_id IS NULL
          AND v_gen.reconcile_profile_version = c_gpt_profile
          AND v_gen.reconcile_interval_ms = c_gpt_interval
          AND v_gen.reconcile_owner IS NOT NULL
          AND v_gen.reconcile_owner = v_auth.lease_owner
          AND v_gen.reconcile_lease_token IS NOT NULL
          AND v_gen.reconcile_lease_token = v_auth.lease_token
          AND v_gen.reconcile_lease_expires_at IS NOT NULL
          AND v_gen.reconcile_lease_expires_at = v_auth.lease_expires_at
          AND v_gen.reconcile_lease_expires_at > pg_catalog.now() THEN
        v_branch := CASE v_gen.provider_submission_state
                        WHEN 'submitting' THEN 'B5_gpt_stale_submitting'
                        ELSE 'B6_gpt_unknown_9b'
                    END;
    END IF;

    IF v_branch IS NULL THEN
        -- Single fail-closed exit for the entire negative cross-product. The
        -- message names the observed dimensions so a reviewer can see WHY, but
        -- no partial mutation has occurred on any path reaching here.
        RAISE EXCEPTION
            'complete_canvas_generation_v1: no completion branch matches generation % '
            '(kind=%, status=%, submission_state=%, has_task=%, profile=%, authority=%). '
            'Note: submitting-video completion and video-unknown completion are '
            'unconditionally forbidden.',
            p_generation_id, v_gen.type, v_gen.status, v_gen.provider_submission_state,
            (v_gen.task_id IS NOT NULL), COALESCE(v_gen.reconcile_profile_version, '<none>'),
            v_auth.kind
            USING ERRCODE = 'check_violation';
    END IF;

    --------------------------------------------------------------------------
    -- Apply. Direct rows settle to 'bound'; every path clears lease + schedule.
    --------------------------------------------------------------------------
    UPDATE public.generations
       SET status                     = 'completed',
           output_text                = CASE WHEN v_gen.type = 'text' THEN p_output_text ELSE NULL END,
           output_oss_key             = CASE WHEN v_gen.type = 'text' THEN NULL ELSE p_output_oss_key END,
           provider_submission_state  = 'bound',
           completed_at               = pg_catalog.now(),
           progress                   = 100,
           next_reconcile_at          = NULL,
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL
     WHERE id = v_gen.id;

    generation_id  := v_gen.id;
    status         := 'completed';
    output_text    := CASE WHEN v_gen.type = 'text' THEN p_output_text ELSE NULL END;
    output_oss_key := CASE WHEN v_gen.type = 'text' THEN NULL ELSE p_output_oss_key END;
    transitioned   := true;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.complete_canvas_generation_v1 IS
    'Exhaustive six-branch completion matrix. Every image/video output must equal the persisted planned key with matching server-stamped metadata. Submitting-video and video-unknown completion are unconditionally forbidden.';

REVOKE ALL ON FUNCTION public.complete_canvas_generation_v1(uuid, uuid, jsonb, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_canvas_generation_v1(uuid, uuid, jsonb, text, text, jsonb)
    TO service_role;

-- ###########################################################################
-- 5. GENERIC RECONCILIATION LANE
--
-- Claims bound tasks plus the explicitly eligible stale VIDEO submission
-- uncertainty. Excludes every unknown row and every GPT stale-unbound row.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.claim_canvas_generation_reconciliation_v1(
    p_worker_id     uuid,
    p_limit         integer DEFAULT 10,
    p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
    generation_id             uuid,
    user_id                   uuid,
    kind                      text,
    status                    text,
    provider_submission_state text,
    task_id                   text,
    model                     text,
    reconcile_profile_version text,
    reconcile_interval_ms     integer,
    lease_owner               uuid,
    lease_token               uuid,
    lease_expires_at          timestamptz,
    attempt_count             integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_stale_after constant interval := interval '2 minutes';
    v_expires timestamptz;
BEGIN
    IF p_worker_id IS NULL THEN
        RAISE EXCEPTION 'claim_canvas_generation_reconciliation_v1: worker_id is required';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'claim_canvas_generation_reconciliation_v1: limit must be 1..100, got %',
            COALESCE(p_limit::text, '<null>');
    END IF;
    IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
        RAISE EXCEPTION 'claim_canvas_generation_reconciliation_v1: lease_seconds must be 5..300, got %',
            COALESCE(p_lease_seconds::text, '<null>');
    END IF;

    v_expires := pg_catalog.now() + (p_lease_seconds || ' seconds')::interval;

    RETURN QUERY
    WITH claimable AS (
        SELECT g.id
          FROM public.generations g
         WHERE g.action_id IS NOT NULL
           AND g.status IN ('pending', 'processing')
           AND g.reconcile_profile_version IS NOT NULL
           AND pg_catalog.length(pg_catalog.btrim(g.reconcile_profile_version)) > 0
           AND g.reconcile_interval_ms IS NOT NULL
           AND g.reconcile_interval_ms > 0
           -- no unexpired current lease
           AND (g.reconcile_lease_expires_at IS NULL OR g.reconcile_lease_expires_at <= pg_catalog.now())
           AND (
                 -- EXACT bound-task tuple: processing + bound + task, due.
                 --
                 -- `status` is pinned to 'processing' rather than left to the
                 -- outer status IN ('pending','processing'). The two states are
                 -- set together -- bind moves a row to processing+bound in one
                 -- UPDATE -- so a pending+bound+task row is not reachable
                 -- through any contractual transition. It is therefore a
                 -- corrupt or hand-edited row, and the lane must not claim it
                 -- and hand out a lease whose downstream operations
                 -- (fail/complete) all require processing+bound+task anyway.
                 -- Claiming it would burn attempts against a row no operation
                 -- can act on. Every claim/release/fail/complete path in this
                 -- lane now names the same exact tuple.
                 (    g.status = 'processing'
                  AND g.provider_submission_state = 'bound'
                  AND g.task_id IS NOT NULL
                  AND pg_catalog.length(pg_catalog.btrim(g.task_id)) > 0
                  AND g.next_reconcile_at IS NOT NULL
                  AND g.next_reconcile_at <= pg_catalog.now())
                 OR
                 -- EXACT stale unbound-submission tuple: pending + submitting +
                 -- task-less, NON-IMAGE, past the two-minute floor. GPT Image 2
                 -- belongs to its own recovery lane; text carries no profile so
                 -- never matches the profile predicate above.
                 (    g.status = 'pending'
                  AND g.provider_submission_state = 'submitting'
                  AND g.type <> 'image'
                  AND g.task_id IS NULL
                  AND g.submission_started_at IS NOT NULL
                  AND g.submission_started_at <= pg_catalog.now() - c_stale_after
                  AND (g.next_reconcile_at IS NULL OR g.next_reconcile_at <= pg_catalog.now()))
               )
           -- every unknown row is excluded from this lane, unconditionally
           AND g.provider_submission_state <> 'unknown'
         ORDER BY g.next_reconcile_at NULLS FIRST, g.id
         LIMIT p_limit
         FOR NO KEY UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.generations g
           SET reconcile_owner            = p_worker_id,
               -- FRESH token every claim. This is the ABA guard: an expired or
               -- reclaimed lease is invalid even when the SAME worker id
               -- reclaims the row, because the token necessarily differs.
               reconcile_lease_token      = pg_catalog.gen_random_uuid(),
               reconcile_lease_expires_at = v_expires,
               reconcile_attempt_count    = g.reconcile_attempt_count + 1
          FROM claimable c
         WHERE g.id = c.id
        RETURNING g.*
    )
    SELECT c.id, c.user_id, c.type, c.status, c.provider_submission_state,
           c.task_id, c.model, c.reconcile_profile_version, c.reconcile_interval_ms,
           c.reconcile_owner, c.reconcile_lease_token, c.reconcile_lease_expires_at,
           c.reconcile_attempt_count
      FROM claimed c;
END;
$$;

COMMENT ON FUNCTION public.claim_canvas_generation_reconciliation_v1 IS
    'Generic bound-task/stale-video lane. SKIP LOCKED. Issues a fresh cryptographically random lease token per claim (ABA guard). Excludes every unknown row and every GPT stale-unbound row.';

REVOKE ALL ON FUNCTION public.claim_canvas_generation_reconciliation_v1(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canvas_generation_reconciliation_v1(uuid, integer, integer)
    TO service_role;

CREATE OR REPLACE FUNCTION public.release_canvas_generation_reconciliation_v1(
    p_generation_id uuid,
    p_authority     jsonb
)
RETURNS TABLE (
    generation_id     uuid,
    next_reconcile_at timestamptz,
    released          boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth record;
    v_gen  public.generations%ROWTYPE;
    v_next timestamptz;
BEGIN
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    IF v_auth.kind <> 'reconciliation_lease' THEN
        RAISE EXCEPTION 'release_canvas_generation_reconciliation_v1: requires a reconciliation_lease authority';
    END IF;

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.action_id IS NOT NULL
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'release_canvas_generation_reconciliation_v1: no action row %', p_generation_id;
    END IF;

    IF v_gen.reconcile_owner IS NULL
       OR v_gen.reconcile_owner <> v_auth.lease_owner
       OR v_gen.reconcile_lease_token IS NULL
       OR v_gen.reconcile_lease_token <> v_auth.lease_token
       OR v_gen.reconcile_lease_expires_at IS NULL
       OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
       OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION
            'release_canvas_generation_reconciliation_v1: stale or mismatched lease for %', p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- LANE PREDICATE. A valid lease tuple is necessary but NOT sufficient: the
    -- row must also be one this lane could legitimately have claimed. Without
    -- this, a GPT direct-media lease could be released through the generic lane
    -- (silently rescheduling a row the generic lane must never touch), and every
    -- unknown row -- which this lane excludes by contract -- would become
    -- reachable. Terminal rows are exempt: they are handled below by clearing
    -- authority, never by rescheduling.
    IF v_gen.status IN ('pending', 'processing') THEN
        IF v_gen.provider_submission_state = 'unknown' THEN
            RAISE EXCEPTION
                'release_canvas_generation_reconciliation_v1: generation % is unknown; the generic '
                'lane excludes every unknown row', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        -- EXACT lane tuples, mirroring claim_canvas_generation_reconciliation_v1
        -- one-for-one. The previous revision required only
        -- (state='bound' AND task IS NOT NULL) and so accepted a
        -- pending/bound/task row here, which the claim lane does not issue and
        -- which fail/complete both refuse -- an asymmetry that let release
        -- reschedule a row no other operation in the lane could act on.
        -- Release now names the same two tuples the lane may claim, and
        -- nothing else.
        IF NOT (
              (    v_gen.status = 'processing'
               AND v_gen.provider_submission_state = 'bound'
               AND v_gen.task_id IS NOT NULL
               AND pg_catalog.length(pg_catalog.btrim(v_gen.task_id)) > 0)
           OR (    v_gen.status = 'pending'
               AND v_gen.provider_submission_state = 'submitting'
               AND v_gen.type <> 'image'
               AND v_gen.task_id IS NULL)
        ) THEN
            RAISE EXCEPTION
                'release_canvas_generation_reconciliation_v1: generation % (kind=%, status=%, state=%, '
                'has_task=%) is not a generic-lane row. This lane owns exactly '
                'processing/bound/task and pending/submitting/task-less non-image rows; GPT Image 2 '
                'stale-unbound rows belong to the dedicated direct-media recovery lane',
                p_generation_id, v_gen.type, v_gen.status, v_gen.provider_submission_state,
                (v_gen.task_id IS NOT NULL)
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Re-check non-terminal eligibility UNDER the lock: a row that became
    -- terminal while leased must not be rescheduled back to life.
    IF v_gen.status NOT IN ('pending', 'processing') THEN
        UPDATE public.generations
           SET reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               next_reconcile_at          = NULL
         WHERE id = v_gen.id;

        generation_id     := v_gen.id;
        next_reconcile_at := NULL;
        released          := true;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Future due time: prevents immediate reclaim. v1 uses the stored immutable
    -- interval with no adaptive backoff.
    v_next := pg_catalog.now() + (v_gen.reconcile_interval_ms || ' milliseconds')::interval;

    UPDATE public.generations
       SET reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL,
           next_reconcile_at          = v_next
     WHERE id = v_gen.id;

    generation_id     := v_gen.id;
    next_reconcile_at := v_next;
    released          := true;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.release_canvas_generation_reconciliation_v1(uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_canvas_generation_reconciliation_v1(uuid, jsonb) TO service_role;

-- ###########################################################################
-- 6. GPT IMAGE 2 DIRECT-MEDIA RECOVERY LANE
--
-- The ONLY lane allowed to inspect provider-specific state or the planned key
-- for stale-submitting / unknown Canvas image rows. It can never submit,
-- resubmit, refund, choose another key, or accept an unverified object.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.claim_canvas_gpt_image_direct_media_recovery_v1(
    p_worker_id     uuid,
    p_limit         integer DEFAULT 10,
    p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
    generation_id             uuid,
    user_id                   uuid,
    action_id                 uuid,
    status                    text,
    provider_submission_state text,
    planned_output_oss_key    text,
    reconcile_interval_ms     integer,
    lease_owner               uuid,
    lease_token               uuid,
    lease_expires_at          timestamptz,
    attempt_count             integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_gpt_profile  constant text     := 'gpt-image-2-poll-v1';
    c_gpt_interval constant integer  := 30000;
    c_stale_after  constant interval := interval '2 minutes';
    v_expires timestamptz;
BEGIN
    IF p_worker_id IS NULL THEN
        RAISE EXCEPTION 'claim_canvas_gpt_image_direct_media_recovery_v1: worker_id is required';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'claim_canvas_gpt_image_direct_media_recovery_v1: limit must be 1..100';
    END IF;
    IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
        RAISE EXCEPTION 'claim_canvas_gpt_image_direct_media_recovery_v1: lease_seconds must be 5..300';
    END IF;

    v_expires := pg_catalog.now() + (p_lease_seconds || ' seconds')::interval;

    RETURN QUERY
    WITH claimable AS (
        SELECT g.id
          FROM public.generations g
         WHERE g.action_id IS NOT NULL
           AND g.type = 'image'
           AND g.reconcile_profile_version = c_gpt_profile
           AND g.reconcile_interval_ms = c_gpt_interval
           AND g.status = 'pending'
           AND g.task_id IS NULL
           AND g.planned_output_oss_key IS NOT NULL
           AND (g.reconcile_lease_expires_at IS NULL OR g.reconcile_lease_expires_at <= pg_catalog.now())
           AND (
                 (    g.provider_submission_state = 'unknown'
                  AND g.next_reconcile_at IS NOT NULL
                  AND g.next_reconcile_at <= pg_catalog.now())
                 OR
                 (    g.provider_submission_state = 'submitting'
                  AND g.submission_started_at IS NOT NULL
                  AND g.submission_started_at <= pg_catalog.now() - c_stale_after
                  AND (g.next_reconcile_at IS NULL OR g.next_reconcile_at <= pg_catalog.now()))
               )
         ORDER BY g.next_reconcile_at NULLS FIRST, g.id
         LIMIT p_limit
         FOR NO KEY UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.generations g
           SET reconcile_owner            = p_worker_id,
               reconcile_lease_token      = pg_catalog.gen_random_uuid(),
               reconcile_lease_expires_at = v_expires,
               reconcile_attempt_count    = g.reconcile_attempt_count + 1
          FROM claimable c
         WHERE g.id = c.id
        RETURNING g.*
    )
    SELECT c.id, c.user_id, c.action_id, c.status, c.provider_submission_state,
           c.planned_output_oss_key, c.reconcile_interval_ms,
           c.reconcile_owner, c.reconcile_lease_token, c.reconcile_lease_expires_at,
           c.reconcile_attempt_count
      FROM claimed c;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_canvas_gpt_image_direct_media_recovery_v1(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canvas_gpt_image_direct_media_recovery_v1(uuid, integer, integer)
    TO service_role;

-- No-proof disposition for the GPT lane:
--   stale submitting -> unknown (retains hash, clears lease, one interval later)
--   unknown          -> reschedule one interval later, or flag manual audit
CREATE OR REPLACE FUNCTION public.release_canvas_gpt_image_direct_media_recovery_v1(
    p_generation_id  uuid,
    p_authority      jsonb,
    p_manual_audit   boolean DEFAULT false,
    p_error_code     text    DEFAULT NULL
)
RETURNS TABLE (
    generation_id             uuid,
    provider_submission_state text,
    next_reconcile_at         timestamptz,
    released                  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_gpt_profile  constant text    := 'gpt-image-2-poll-v1';
    c_gpt_interval constant integer := 30000;
    v_auth record;
    v_gen  public.generations%ROWTYPE;
    v_next timestamptz;
    v_state text;
BEGIN
    SELECT * INTO v_auth FROM public.canvas_p1_parse_authority_v1(p_authority);

    IF v_auth.kind <> 'reconciliation_lease' THEN
        RAISE EXCEPTION 'release_canvas_gpt_image_direct_media_recovery_v1: requires a reconciliation_lease';
    END IF;

    -- EXACT GPT profile AND interval, matching
    -- claim_canvas_gpt_image_direct_media_recovery_v1 one-for-one.
    --
    -- The previous revision pinned only the profile STRING here while the claim
    -- lane pinned profile AND interval. The contract pins GPT Image 2 to
    -- `gpt-image-2-poll-v1` at exactly 30000 ms as a pair, so a row carrying the
    -- profile string with a different interval is not a GPT lane row -- and
    -- accepting it here would have let this lane reschedule a row it could
    -- never have claimed, using an interval the contract never reviewed.
    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.action_id IS NOT NULL
       AND g.type = 'image'
       AND g.reconcile_profile_version = c_gpt_profile
       AND g.reconcile_interval_ms = c_gpt_interval
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'release_canvas_gpt_image_direct_media_recovery_v1: no image action row % with the exact '
            'GPT Image 2 reconciliation profile (%/% ms)',
            p_generation_id, c_gpt_profile, c_gpt_interval;
    END IF;

    IF v_gen.reconcile_owner IS NULL
       OR v_gen.reconcile_owner <> v_auth.lease_owner
       OR v_gen.reconcile_lease_token IS NULL
       OR v_gen.reconcile_lease_token <> v_auth.lease_token
       OR v_gen.reconcile_lease_expires_at IS NULL
       OR v_gen.reconcile_lease_expires_at <> v_auth.lease_expires_at
       OR v_gen.reconcile_lease_expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION
            'release_canvas_gpt_image_direct_media_recovery_v1: stale or mismatched lease for %',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- LANE PREDICATE. Matching the GPT profile string and a valid lease tuple is
    -- NOT sufficient. A GPT Image 2 row that has been BOUND to a task belongs to
    -- the generic bound-task lane; releasing it here would let a generic lease
    -- be laundered through the GPT path. This lane owns exactly the
    -- stale-submitting and unknown UNBOUND shapes it is allowed to claim.
    IF v_gen.status = 'pending' THEN
        IF v_gen.task_id IS NOT NULL THEN
            RAISE EXCEPTION
                'release_canvas_gpt_image_direct_media_recovery_v1: generation % carries a task and '
                'belongs to the generic bound-task lane, not the direct-media recovery lane',
                p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.provider_submission_state NOT IN ('submitting', 'unknown') THEN
            RAISE EXCEPTION
                'release_canvas_gpt_image_direct_media_recovery_v1: generation % is in submission '
                'state %; this lane owns only unbound submitting/unknown rows',
                p_generation_id, v_gen.provider_submission_state
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.planned_output_oss_key IS NULL THEN
            RAISE EXCEPTION
                'release_canvas_gpt_image_direct_media_recovery_v1: generation % has no persisted '
                'planned key; it is not a claimable direct-media recovery row', p_generation_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF v_gen.status <> 'pending' THEN
        -- Became terminal while leased: clear authority, never reschedule.
        UPDATE public.generations
           SET reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               next_reconcile_at          = NULL
         WHERE id = v_gen.id;

        generation_id             := v_gen.id;
        provider_submission_state := v_gen.provider_submission_state;
        next_reconcile_at         := NULL;
        released                  := true;
        RETURN NEXT;
        RETURN;
    END IF;

    v_next := CASE
                WHEN p_manual_audit THEN NULL
                ELSE pg_catalog.now() + (v_gen.reconcile_interval_ms || ' milliseconds')::interval
              END;

    -- A no-proof stale submitting row converges to unknown; an unknown row stays
    -- unknown. Either way the submission hash is retained.
    v_state := CASE v_gen.provider_submission_state
                   WHEN 'submitting' THEN 'unknown'
                   ELSE v_gen.provider_submission_state
               END;

    UPDATE public.generations
       SET provider_submission_state  = v_state,
           last_reconcile_error_code  = COALESCE(p_error_code, v_gen.last_reconcile_error_code),
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL,
           next_reconcile_at          = v_next
     WHERE id = v_gen.id;

    generation_id             := v_gen.id;
    provider_submission_state := v_state;
    next_reconcile_at         := v_next;
    released                  := true;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.release_canvas_gpt_image_direct_media_recovery_v1(uuid, jsonb, boolean, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_canvas_gpt_image_direct_media_recovery_v1(uuid, jsonb, boolean, text)
    TO service_role;

-- ###########################################################################
-- 7. DEEPSEEK STALE-TEXT SWEEPER
--
-- No provider operation. No lease. No profile. Moves stale profile-less
-- pending/submitting text rows to UNSCHEDULED unknown, retaining the original
-- submission hash so the exact original token can still complete via 9(a).
-- Concurrent sweepers transition a row at most once (SKIP LOCKED + predicate).
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.sweep_stale_canvas_text_submission_unknown_v1(
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    generation_id uuid,
    user_id       uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_stale_after constant interval := interval '2 minutes';
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'sweep_stale_canvas_text_submission_unknown_v1: limit must be 1..500';
    END IF;

    RETURN QUERY
    WITH sweepable AS (
        SELECT g.id
          FROM public.generations g
         WHERE g.action_id IS NOT NULL
           AND g.type = 'text'
           AND g.status = 'pending'
           AND g.provider_submission_state = 'submitting'
           AND g.task_id IS NULL
           AND g.reconcile_profile_version IS NULL
           AND g.reconcile_interval_ms IS NULL
           AND g.next_reconcile_at IS NULL
           AND g.submission_started_at IS NOT NULL
           AND g.submission_started_at <= pg_catalog.now() - c_stale_after
         ORDER BY g.submission_started_at, g.id
         LIMIT p_limit
         FOR NO KEY UPDATE SKIP LOCKED
    ),
    swept AS (
        UPDATE public.generations g
           SET provider_submission_state  = 'unknown',
               -- submission_token_hash retained: 9(a) depends on it.
               last_reconcile_error_code  = 'stale_direct_text_submission',
               next_reconcile_at          = NULL,
               reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL
          FROM sweepable s
         WHERE g.id = s.id
        RETURNING g.id, g.user_id
    )
    SELECT s.id, s.user_id FROM swept s;
END;
$$;

COMMENT ON FUNCTION public.sweep_stale_canvas_text_submission_unknown_v1 IS
    'Service-role-only stale DeepSeek text sweeper. Zero provider operations, zero refunds, retains the submission hash, creates no schedule or lease.';

REVOKE ALL ON FUNCTION public.sweep_stale_canvas_text_submission_unknown_v1(integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_canvas_text_submission_unknown_v1(integer) TO service_role;

-- ###########################################################################
-- 8. POSTCONDITION — every lifecycle function is service-role-only and pinned
-- ###########################################################################
DO $$
DECLARE
    v_fn   text;
    v_role text;
BEGIN
    FOR v_fn IN
        SELECT p.oid::regprocedure::text
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND (p.proname LIKE 'canvas_p1_%'
                OR p.proname LIKE '%_canvas_generation_%'
                OR p.proname LIKE '%canvas_gpt_image%'
                OR p.proname LIKE 'begin_canvas_%'
                OR p.proname LIKE 'lookup_canvas_%'
                OR p.proname LIKE 'replay_canvas_%'
                OR p.proname LIKE 'sweep_stale_canvas_%')
           -- the two trigger functions take no arguments and are not RPCs
           AND p.proname NOT IN ('canvas_p1_touch_updated_at', 'canvas_p1_ledger_append_only')
    LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public']
        LOOP
            IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % may EXECUTE %', v_role, v_fn;
            END IF;
        END LOOP;

        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid = v_fn::regprocedure
              AND p.proconfig IS NOT NULL
              AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%')
        ) THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: % has no pinned search_path', v_fn;
        END IF;
    END LOOP;

    RAISE NOTICE 'canvas-p1 reconciliation postconditions OK';
END
$$;
