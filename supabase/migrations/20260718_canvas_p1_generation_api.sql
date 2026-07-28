-- ============================================================================
-- Canvas P1 · Batch 2 Stage B.2 · begin / lookup / replay / claim / abandon
--
-- Requires 20260717_canvas_p1_credit_boundary.sql.
--
-- RANDOMNESS NOTE (deliberate dependency choice, flagged for review)
-- ---------------------------------------------------------------------------
-- The contract calls for SHA-256(random_256_bit_token) bearers and 128-bit
-- planned-key suffixes. The obvious source, pgcrypto's gen_random_bytes(), is
-- NOT provable from the accepted catalog evidence: the redacted expected
-- catalog carries no extension inventory, and on Supabase pgcrypto normally
-- lives in the `extensions` schema, which would also defeat search_path=''.
-- Rather than take an unverifiable dependency, entropy comes from core
-- gen_random_uuid() -- which since PostgreSQL 13 is built in and backed by the
-- same strong RNG (pg_strong_random) as pgcrypto -- folded through core
-- sha256(). Three concatenated v4 UUIDs carry ~366 bits of entropy, well above
-- the 256 required. sha256() and convert_to() are core pg_catalog since PG11.
-- If review prefers gen_random_bytes, the only change is inside
-- canvas_p1_new_bearer_token_v1 and the extension must first be proven present.
-- ============================================================================

-- ###########################################################################
-- 0. STRICT AUTHORITY DTO PARSER
--
-- Closed-set validation BEFORE any row lookup or mutation, exactly as the
-- contract requires. Unknown keys, missing keys, mixed bearer/lease fields,
-- explicit nulls, blanks and noncanonical identifiers all reject here -- before
-- the caller learns whether the row even exists.
--
-- IMMUTABLE + no table access, so it is safe to call in any lock context.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_parse_authority_v1(p_authority jsonb)
RETURNS TABLE (
    kind             text,
    bearer_token     text,
    lease_owner      uuid,
    lease_token      uuid,
    lease_expires_at timestamptz
)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_uuid_re  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    -- RFC3339, UTC only: a trailing Z is mandatory. Offsets like +00:00 are
    -- rejected on purpose -- the contract says "RFC3339 UTC timestamp", and
    -- accepting equivalent-but-different spellings would weaken exact tuple
    -- comparison.
    c_ts_re    constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';

    v_keys     text[];
    v_kind     text;
    v_bearer   text;
    v_owner    text;
    v_token    text;
    v_expires  text;
BEGIN
    IF p_authority IS NULL OR pg_catalog.jsonb_typeof(p_authority) <> 'object' THEN
        RAISE EXCEPTION 'canvas-p1 authority: expected a JSON object, got %',
            COALESCE(pg_catalog.jsonb_typeof(p_authority), '<null>');
    END IF;

    SELECT pg_catalog.array_agg(k ORDER BY k)
      INTO v_keys
      FROM pg_catalog.jsonb_object_keys(p_authority) AS k;

    IF NOT (p_authority ? 'kind') OR pg_catalog.jsonb_typeof(p_authority -> 'kind') <> 'string' THEN
        RAISE EXCEPTION 'canvas-p1 authority: missing or non-string "kind"';
    END IF;

    v_kind := p_authority ->> 'kind';

    IF v_kind = 'submission_bearer' THEN
        -- EXACT key set. An extra field, or any lease field, rejects.
        IF v_keys <> ARRAY['bearerToken', 'kind'] THEN
            RAISE EXCEPTION
                'canvas-p1 authority: submission_bearer requires exactly {kind, bearerToken}, got {%}',
                pg_catalog.array_to_string(v_keys, ', ');
        END IF;

        IF pg_catalog.jsonb_typeof(p_authority -> 'bearerToken') <> 'string' THEN
            RAISE EXCEPTION 'canvas-p1 authority: bearerToken must be a string';
        END IF;

        v_bearer := p_authority ->> 'bearerToken';
        IF v_bearer IS NULL OR pg_catalog.length(pg_catalog.btrim(v_bearer)) = 0 THEN
            RAISE EXCEPTION 'canvas-p1 authority: bearerToken must be nonblank';
        END IF;

        kind             := 'submission_bearer';
        bearer_token     := v_bearer;
        lease_owner      := NULL;
        lease_token      := NULL;
        lease_expires_at := NULL;
        RETURN NEXT;
        RETURN;

    ELSIF v_kind = 'reconciliation_lease' THEN
        IF v_keys <> ARRAY['kind', 'leaseExpiresAt', 'leaseToken', 'owner'] THEN
            RAISE EXCEPTION
                'canvas-p1 authority: reconciliation_lease requires exactly '
                '{kind, owner, leaseToken, leaseExpiresAt}, got {%}',
                pg_catalog.array_to_string(v_keys, ', ');
        END IF;

        IF pg_catalog.jsonb_typeof(p_authority -> 'owner') <> 'string'
           OR pg_catalog.jsonb_typeof(p_authority -> 'leaseToken') <> 'string'
           OR pg_catalog.jsonb_typeof(p_authority -> 'leaseExpiresAt') <> 'string' THEN
            RAISE EXCEPTION 'canvas-p1 authority: owner/leaseToken/leaseExpiresAt must all be strings';
        END IF;

        v_owner   := p_authority ->> 'owner';
        v_token   := p_authority ->> 'leaseToken';
        v_expires := p_authority ->> 'leaseExpiresAt';

        -- Canonical lowercase UUID only. Uppercase, braces and urn: forms are
        -- all accepted by ::uuid, which is exactly why they are screened out
        -- here instead: the DTO must be exact, not merely castable.
        IF v_owner !~ c_uuid_re THEN
            RAISE EXCEPTION 'canvas-p1 authority: owner is not a canonical lowercase UUID';
        END IF;
        IF v_token !~ c_uuid_re THEN
            RAISE EXCEPTION 'canvas-p1 authority: leaseToken is not a canonical lowercase UUID';
        END IF;
        IF v_expires !~ c_ts_re THEN
            RAISE EXCEPTION 'canvas-p1 authority: leaseExpiresAt is not an RFC3339 UTC timestamp';
        END IF;

        kind             := 'reconciliation_lease';
        bearer_token     := NULL;
        lease_owner      := v_owner::uuid;
        lease_token      := v_token::uuid;
        lease_expires_at := v_expires::timestamptz;
        RETURN NEXT;
        RETURN;
    END IF;

    RAISE EXCEPTION 'canvas-p1 authority: unknown kind %', v_kind;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_p1_parse_authority_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_parse_authority_v1(jsonb) TO service_role;

-- ###########################################################################
-- 0b. INTERNAL HELPERS
-- ###########################################################################

-- 256+ bit bearer. See the randomness note in the file header.
CREATE OR REPLACE FUNCTION public.canvas_p1_new_bearer_token_v1()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
        || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
        || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
$$;

REVOKE ALL ON FUNCTION public.canvas_p1_new_bearer_token_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_new_bearer_token_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.canvas_p1_hash_bearer_v1(p_token text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
$$;

REVOKE ALL ON FUNCTION public.canvas_p1_hash_bearer_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_hash_bearer_v1(text) TO service_role;

-- Canvas fence proof. Locks the owned Canvas FOR NO KEY UPDATE and requires
-- exact equality with the observed rev/tag plus a live 30s heartbeat for THAT
-- tag. The Canvas PATCH path performs `UPDATE canvases SET rev = rev + 1 WHERE
-- rev = :expected`, which touches no key column and therefore also takes
-- FOR NO KEY UPDATE -- the two conflict, so a concurrent PATCH/takeover cannot
-- interleave between this proof and the caller's subsequent writes.
CREATE OR REPLACE FUNCTION public.canvas_p1_assert_canvas_fence_v1(
    p_user_id            uuid,
    p_canvas_id          uuid,
    p_observed_rev       bigint,
    p_observed_writer_tag text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_heartbeat_window constant interval := interval '30 seconds';
    v_canvas public.canvases%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_canvas_id IS NULL
       OR p_observed_rev IS NULL
       OR p_observed_writer_tag IS NULL
       OR pg_catalog.length(pg_catalog.btrim(p_observed_writer_tag)) = 0 THEN
        RAISE EXCEPTION 'canvas-p1 fence: user/canvas/rev/writer_tag are all required';
    END IF;

    SELECT c.* INTO v_canvas
      FROM public.canvases c
     WHERE c.id = p_canvas_id
       AND c.user_id = p_user_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas-p1 fence: canvas % is not owned by % (or does not exist)',
            p_canvas_id, p_user_id;
    END IF;

    IF v_canvas.rev IS DISTINCT FROM p_observed_rev THEN
        RAISE EXCEPTION
            'canvas-p1 fence: canvas % revision moved (observed %, current %); '
            'a concurrent PATCH invalidated this request',
            p_canvas_id, p_observed_rev, v_canvas.rev
            USING ERRCODE = 'serialization_failure';
    END IF;

    IF v_canvas.writer_tag IS DISTINCT FROM p_observed_writer_tag THEN
        RAISE EXCEPTION
            'canvas-p1 fence: canvas % writer tag changed (observed %, current %); takeover occurred',
            p_canvas_id, p_observed_writer_tag, COALESCE(v_canvas.writer_tag, '<null>')
            USING ERRCODE = 'serialization_failure';
    END IF;

    IF v_canvas.writer_heartbeat_at IS NULL
       OR v_canvas.writer_heartbeat_at <= pg_catalog.now() - c_heartbeat_window THEN
        RAISE EXCEPTION
            'canvas-p1 fence: writer lease for tag % on canvas % is expired',
            p_observed_writer_tag, p_canvas_id
            USING ERRCODE = 'serialization_failure';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_p1_assert_canvas_fence_v1(uuid, uuid, bigint, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_assert_canvas_fence_v1(uuid, uuid, bigint, text)
    TO service_role;

-- ###########################################################################
-- 1. begin_canvas_generation_v1
--
-- LOCK ORDER (contractual, load-bearing):
--   paid new action : Canvas -> generation -> profile (FOR NO KEY UPDATE)
--   free new action : Canvas -> generation -> profile (FOR NO KEY UPDATE) -> quota bucket
--   duplicate       : Canvas fence proof -> generation only. No profile. No bucket.
--
-- Never returns a provider token. Never calls a provider.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.begin_canvas_generation_v1(
    p_user_id                  uuid,
    p_canvas_id                uuid,
    p_canvas_node_id           text,
    p_action_id                uuid,
    p_observed_rev             bigint,
    p_observed_writer_tag      text,
    p_kind                     text,
    p_request_fingerprint      text,
    p_fingerprint_version      text,
    p_pricing_version          text,
    p_billing_mode             text,
    p_credit_cost              integer,
    p_prompt                   text        DEFAULT NULL,
    p_model                    text        DEFAULT NULL,
    p_duration                 integer     DEFAULT NULL,
    p_aspect_ratio             text        DEFAULT NULL,
    p_quality                  text        DEFAULT NULL,
    p_resolution               text        DEFAULT NULL,
    p_reconcile_profile_version text       DEFAULT NULL,
    p_reconcile_interval_ms    integer     DEFAULT NULL,
    p_spec                     jsonb       DEFAULT NULL
    -- NOTE: quota_key / quota_window_start / quota_limit are deliberately NOT
    -- parameters. See the v1 quota pin below.
)
RETURNS TABLE (
    generation_id           uuid,
    created                 boolean,
    status                  text,
    provider_submission_state text,
    billing_mode            text,
    credit_cost             integer,
    balance_after           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    ------------------------------------------------------------------------
    -- V1 FREE-QUOTA PIN — database-enforced, not caller-supplied.
    --
    -- The previous revision took quota_key, quota_limit and quota_window_start
    -- as parameters and only checked that the supplied timestamp happened to be
    -- a UTC midnight. That is bypassable three ways: a caller could pass a fresh
    -- key, an inflated limit, or simply tomorrow's/yesterday's boundary -- each
    -- of which mints a brand-new bucket with a brand-new allowance. Since these
    -- are service-role-only functions, "the caller is trusted" is exactly the
    -- assumption the contract forbids: trusted inputs must still be checked.
    --
    -- All three are now constants derived here. The bucket table additionally
    -- carries generation_quota_buckets_v1_limit_pinned, so even a direct
    -- service-role INSERT cannot create a canvas-deepseek-v1 bucket with a
    -- different limit.
    ------------------------------------------------------------------------
    c_quota_key   constant text    := 'canvas-deepseek-v1';
    c_quota_limit constant integer := 20;

    v_gen          public.generations%ROWTYPE;
    v_generation_id uuid;
    v_planned_key  text;
    v_random128    text;
    v_used         integer;
    v_bucket_limit integer;
    v_balance      integer;
    v_anchor       text;
    -- Authoritative real-time clock, read ONCE and used consistently for the
    -- whole operation's quota identity. clock_timestamp() rather than now(), so
    -- a long-lived or reused transaction cannot pin an already-elapsed day.
    v_now          timestamptz;
    v_window       timestamptz;
BEGIN
    v_now    := pg_catalog.clock_timestamp();
    v_window := pg_catalog.date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    --------------------------------------------------------------------------
    -- Structural validation, before any lock.
    --------------------------------------------------------------------------
    IF p_user_id IS NULL OR p_canvas_id IS NULL OR p_action_id IS NULL THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: user/canvas/action are required';
    END IF;

    IF p_canvas_node_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_canvas_node_id)) = 0 THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: canvas_node_id must be nonblank';
    END IF;

    IF p_kind IS NULL OR p_kind NOT IN ('video', 'image', 'text') THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: invalid kind %', COALESCE(p_kind, '<null>');
    END IF;

    IF p_fingerprint_version IS DISTINCT FROM 'canvas-generation-v1' THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: fingerprint_version must be canvas-generation-v1, got %',
            COALESCE(p_fingerprint_version, '<null>');
    END IF;

    IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: request_fingerprint must be 64 lowercase hex chars';
    END IF;

    IF p_pricing_version IS NULL OR pg_catalog.length(pg_catalog.btrim(p_pricing_version)) = 0 THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: pricing_version must be nonblank';
    END IF;

    IF p_billing_mode IS NULL OR p_billing_mode NOT IN ('debit', 'free_quota') THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: invalid billing_mode %',
            COALESCE(p_billing_mode, '<null>');
    END IF;

    IF p_credit_cost IS NULL OR p_credit_cost < 0 THEN
        RAISE EXCEPTION 'begin_canvas_generation_v1: credit_cost must be >= 0';
    END IF;

    IF p_billing_mode = 'free_quota' THEN
        IF p_credit_cost <> 0 THEN
            RAISE EXCEPTION 'begin_canvas_generation_v1: free_quota actions must cost 0, got %', p_credit_cost;
        END IF;
        -- v1 free quota is the DeepSeek text allowance only. There is no other
        -- free-quota product in v1, so any other kind reaching this branch is a
        -- caller error rather than something to accommodate.
        IF p_kind <> 'text' THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: free_quota is only defined for text (canvas-deepseek-v1), got %',
                p_kind;
        END IF;
    END IF;

    -- Reconciliation profile shape by kind. Direct text carries none; async
    -- kinds require a reviewed nonblank profile and a strictly positive
    -- interval. Zero / negative / missing all reject.
    IF p_kind = 'text' THEN
        IF p_reconcile_profile_version IS NOT NULL OR p_reconcile_interval_ms IS NOT NULL THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: direct text must not carry a reconciliation profile';
        END IF;
    ELSE
        IF p_reconcile_profile_version IS NULL
           OR pg_catalog.length(pg_catalog.btrim(p_reconcile_profile_version)) = 0 THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: % actions require a reviewed reconcile_profile_version', p_kind;
        END IF;
        IF p_reconcile_interval_ms IS NULL OR p_reconcile_interval_ms <= 0 THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: % actions require a positive reconcile_interval_ms, got %',
                p_kind, COALESCE(p_reconcile_interval_ms::text, '<null>');
        END IF;
        -- GPT Image 2 is pinned by the contract to exactly this profile/interval.
        IF p_reconcile_profile_version = 'gpt-image-2-poll-v1' AND p_reconcile_interval_ms <> 30000 THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: gpt-image-2-poll-v1 requires interval 30000, got %',
                p_reconcile_interval_ms;
        END IF;
    END IF;

    --------------------------------------------------------------------------
    -- LOCK 1 — Canvas fence. Everything below happens under it.
    --------------------------------------------------------------------------
    PERFORM public.canvas_p1_assert_canvas_fence_v1(
        p_user_id, p_canvas_id, p_observed_rev, p_observed_writer_tag
    );

    --------------------------------------------------------------------------
    -- LOCK 2 — generation. Duplicate detection first: on an existing action we
    -- must touch neither profile nor bucket.
    --------------------------------------------------------------------------
    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.user_id = p_user_id
       AND g.action_id = p_action_id
       FOR NO KEY UPDATE;

    IF FOUND THEN
        -- Duplicate. Return the existing row ONLY if identity matches exactly.
        IF v_gen.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: action % already exists with a different fingerprint; '
                'refusing to reuse a paid row for different work', p_action_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_gen.canvas_id_snapshot IS DISTINCT FROM p_canvas_id
           OR v_gen.canvas_node_id IS DISTINCT FROM p_canvas_node_id
           OR v_gen.type IS DISTINCT FROM p_kind THEN
            RAISE EXCEPTION
                'begin_canvas_generation_v1: action % already exists with different immutable identity',
                p_action_id
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT pr.credits INTO v_balance FROM public.profiles pr WHERE pr.id = p_user_id;

        generation_id             := v_gen.id;
        created                   := false;
        status                    := v_gen.status;
        provider_submission_state := v_gen.provider_submission_state;
        billing_mode              := v_gen.billing_mode;
        credit_cost               := v_gen.credit_cost;
        balance_after             := v_balance;
        RETURN NEXT;
        RETURN;
    END IF;

    --------------------------------------------------------------------------
    -- New action. Server derives the id and the planned key; neither is ever
    -- caller-supplied.
    --------------------------------------------------------------------------
    v_generation_id := pg_catalog.gen_random_uuid();

    IF p_kind = 'text' THEN
        v_planned_key := NULL;
    ELSE
        -- 128 bits, folded through sha256 so the full 32 hex chars are uniform
        -- (a raw v4 UUID would only carry ~122 bits across those positions).
        v_random128 := pg_catalog.substring(
            pg_catalog.encode(
                pg_catalog.sha256(
                    pg_catalog.convert_to(
                        pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
                        'UTF8'
                    )
                ), 'hex'
            ),
            1,
            32
        );

        v_planned_key := CASE p_kind
            WHEN 'image' THEN 'images/' || p_user_id::text || '/canvas-' || v_generation_id::text
                               || '-' || v_random128 || '.jpg'
            WHEN 'video' THEN 'videos/' || p_user_id::text || '/canvas-' || v_generation_id::text
                               || '-' || v_random128 || '.mp4'
        END;
    END IF;

    INSERT INTO public.generations (
        id, user_id, action_id,
        canvas_id, canvas_id_snapshot, canvas_node_id, canvas_rev, writer_tag,
        type, generation_type, source, status, provider_submission_state,
        request_fingerprint, fingerprint_version, pricing_version,
        billing_mode, credit_cost, credits_used, credits_refunded,
        prompt, model, duration, aspect_ratio, quality, resolution, spec,
        planned_output_oss_key,
        reconcile_profile_version, reconcile_interval_ms,
        reconcile_attempt_count
    ) VALUES (
        v_generation_id, p_user_id, p_action_id,
        p_canvas_id, p_canvas_id, p_canvas_node_id, p_observed_rev, p_observed_writer_tag,
        p_kind, p_kind, 'canvas', 'pending', 'not_started',
        p_request_fingerprint, p_fingerprint_version, p_pricing_version,
        p_billing_mode, p_credit_cost, 0, 0,
        p_prompt, p_model, p_duration, p_aspect_ratio, p_quality, p_resolution, p_spec,
        v_planned_key,
        p_reconcile_profile_version, p_reconcile_interval_ms,
        0
    );

    --------------------------------------------------------------------------
    -- LOCK 3 — profile, via the shared boundary (which takes FOR NO KEY UPDATE).
    --------------------------------------------------------------------------
    IF p_billing_mode = 'debit' THEN
        v_anchor := 'canvas-consume:' || v_generation_id::text;

        IF p_credit_cost > 0 THEN
            SELECT d.balance_after INTO v_balance
              FROM public.canvas_p1_apply_credit_delta_v1(
                  p_user_id            => p_user_id,
                  p_entry_kind         => 'consume',
                  p_amount             => -p_credit_cost,
                  p_operation_anchor   => v_anchor,
                  p_generation_id      => v_generation_id,
                  p_action_id          => p_action_id,
                  p_canvas_id          => p_canvas_id,
                  p_canvas_id_snapshot => p_canvas_id,
                  p_canvas_node_id     => p_canvas_node_id,
                  p_pricing_version    => p_pricing_version,
                  p_description        => 'Canvas generation'
              ) AS d;

            UPDATE public.generations
               SET credits_used = p_credit_cost
             WHERE id = v_generation_id;
        ELSE
            -- A zero-cost debit still serializes on the profile so the balance
            -- sequence stays continuous, but writes no ledger row: a 0-amount
            -- 'consume' is forbidden by the sign contract.
            SELECT pr.credits INTO v_balance
              FROM public.profiles pr WHERE pr.id = p_user_id FOR NO KEY UPDATE;
        END IF;
    ELSE
        -- free_quota: profile first (locked, zero-value ledger row from the
        -- locked balance), THEN the bucket. Never the other way round.
        v_anchor := 'canvas-free-usage:' || v_generation_id::text;

        SELECT d.balance_after INTO v_balance
          FROM public.canvas_p1_apply_credit_delta_v1(
              p_user_id            => p_user_id,
              p_entry_kind         => 'free_usage',
              p_amount             => 0,
              p_operation_anchor   => v_anchor,
              p_generation_id      => v_generation_id,
              p_action_id          => p_action_id,
              p_canvas_id          => p_canvas_id,
              p_canvas_id_snapshot => p_canvas_id,
              p_canvas_node_id     => p_canvas_node_id,
              p_pricing_version    => p_pricing_version,
              p_quota_key          => c_quota_key,
              p_quota_window_start => v_window,
              p_description        => 'Canvas free-quota generation'
          ) AS d;

        ----------------------------------------------------------------------
        -- LOCK 4 — quota bucket. Atomic upsert-and-increment: the DO UPDATE ...
        -- WHERE clause makes an exhausted bucket return zero rows rather than
        -- incrementing, so the limit is enforced by the same statement that
        -- takes the row lock. No read-then-write window exists.
        --
        -- The WHERE also pins b.quota_limit to the v1 constant, so a bucket that
        -- somehow carries a drifted limit is never silently honoured -- it falls
        -- through to the explicit drift branch below rather than being used.
        ----------------------------------------------------------------------
        INSERT INTO public.generation_quota_buckets AS b
            (user_id, quota_key, window_start, quota_limit, used)
        VALUES (p_user_id, c_quota_key, v_window, c_quota_limit, 1)
        ON CONFLICT (user_id, quota_key, window_start) DO UPDATE
           SET used       = b.used + 1,
               updated_at = pg_catalog.now()
         WHERE b.used < b.quota_limit
           AND b.quota_limit = c_quota_limit
        RETURNING b.used INTO v_used;

        IF NOT FOUND THEN
            -- Distinguish real exhaustion from bucket drift. ON CONFLICT must
            -- never silently accept a row whose limit differs from the pinned
            -- v1 value, and the operator must be able to tell the two apart.
            SELECT b.quota_limit, b.used
              INTO v_bucket_limit, v_used
              FROM public.generation_quota_buckets b
             WHERE b.user_id = p_user_id
               AND b.quota_key = c_quota_key
               AND b.window_start = v_window
               FOR UPDATE;

            IF FOUND AND v_bucket_limit IS DISTINCT FROM c_quota_limit THEN
                RAISE EXCEPTION
                    'begin_canvas_generation_v1: quota bucket drift for user % key % window % '
                    '(stored limit %, pinned v1 limit %); refusing to consume a drifted bucket',
                    p_user_id, c_quota_key, v_window, v_bucket_limit, c_quota_limit
                    USING ERRCODE = 'check_violation';
            END IF;

            RAISE EXCEPTION
                'begin_canvas_generation_v1: free quota exhausted for user % key % window % (%/%)',
                p_user_id, c_quota_key, v_window, COALESCE(v_used, c_quota_limit), c_quota_limit
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    generation_id             := v_generation_id;
    created                   := true;
    status                    := 'pending';
    provider_submission_state := 'not_started';
    billing_mode              := p_billing_mode;
    credit_cost               := p_credit_cost;
    balance_after             := v_balance;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.begin_canvas_generation_v1 IS
    'Atomically creates or returns the one generations row for (user_id, action_id) under a Canvas rev/tag/heartbeat fence. Paid: Canvas->generation->profile. Free: Canvas->generation->profile->bucket. Duplicate: Canvas fence then generation only, with no debit/quota/ledger effect.';

REVOKE ALL ON FUNCTION public.begin_canvas_generation_v1(
    uuid, uuid, text, uuid, bigint, text, text, text, text, text, text, integer,
    text, text, integer, text, text, text, text, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_canvas_generation_v1(
    uuid, uuid, text, uuid, bigint, text, text, text, text, text, text, integer,
    text, text, integer, text, text, text, text, integer, jsonb
) TO service_role;

-- ###########################################################################
-- 2. lookup_canvas_generation_v1 — owner-safe, read-only, zero side effects.
--
-- This is what makes a lost begin response recoverable: refresh finds the
-- already-charged row without replaying begin, claiming, charging, consuming
-- quota, or calling a provider.
--
-- Deliberately returns NO token hash, NO planned key, NO reconciler internals,
-- NO provider body and NO audit snapshot.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.lookup_canvas_generation_v1(
    p_user_id        uuid,
    p_canvas_id      uuid,
    p_canvas_node_id text,
    p_action_id      uuid
)
RETURNS TABLE (
    generation_id             uuid,
    action_id                 uuid,
    kind                      text,
    status                    text,
    provider_submission_state text,
    task_id                   text,
    output_text               text,
    output_oss_key            text,
    billing_mode              text,
    credit_cost               integer,
    credits_used              integer,
    credits_refunded          integer,
    error_message             text,
    created_at                timestamptz,
    updated_at                timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        g.id, g.action_id, g.type, g.status, g.provider_submission_state,
        g.task_id, g.output_text, g.output_oss_key,
        g.billing_mode, g.credit_cost, g.credits_used, g.credits_refunded,
        g.error_message, g.created_at, g.updated_at
      FROM public.generations g
     WHERE g.user_id = p_user_id
       AND g.action_id = p_action_id
       AND g.canvas_id_snapshot = p_canvas_id
       AND g.canvas_node_id = p_canvas_node_id;
$$;

COMMENT ON FUNCTION public.lookup_canvas_generation_v1 IS
    'Owner-safe read-only projection by saved action identity. Exposes no token hash, planned key, reconciler field, provider body or audit snapshot.';

REVOKE ALL ON FUNCTION public.lookup_canvas_generation_v1(uuid, uuid, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_canvas_generation_v1(uuid, uuid, text, uuid)
    TO service_role;

-- ###########################################################################
-- 3. replay_canvas_generation_completion_v1
--
-- NOT an authority branch. Accepts no bearer and no lease, so a lost completion
-- response never requires retaining lease authority. Zero mutation, zero ledger
-- write, zero provider call.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.replay_canvas_generation_completion_v1(
    p_user_id             uuid,
    p_generation_id       uuid,
    p_action_id           uuid,
    p_canvas_id           uuid,
    p_canvas_node_id      text,
    p_request_fingerprint text
)
RETURNS TABLE (
    generation_id  uuid,
    kind           text,
    status         text,
    output_text    text,
    output_oss_key text,
    completed_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen public.generations%ROWTYPE;
BEGIN
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
            'replay_canvas_generation_completion_v1: no generation matching the exact '
            'owner/generation/action/canvas/node/fingerprint identity';
    END IF;

    IF v_gen.status <> 'completed' THEN
        RAISE EXCEPTION
            'replay_canvas_generation_completion_v1: generation % is %, not completed',
            p_generation_id, v_gen.status;
    END IF;

    -- Exact type-appropriate existing output is part of the identity proof.
    IF v_gen.type = 'text' THEN
        IF v_gen.output_text IS NULL THEN
            RAISE EXCEPTION
                'replay_canvas_generation_completion_v1: completed text row % has no output_text',
                p_generation_id;
        END IF;
    ELSE
        IF v_gen.output_oss_key IS NULL
           OR v_gen.output_oss_key IS DISTINCT FROM v_gen.planned_output_oss_key THEN
            RAISE EXCEPTION
                'replay_canvas_generation_completion_v1: completed media row % does not carry '
                'its persisted planned key', p_generation_id;
        END IF;
    END IF;

    generation_id  := v_gen.id;
    kind           := v_gen.type;
    status         := v_gen.status;
    output_text    := v_gen.output_text;
    output_oss_key := v_gen.output_oss_key;
    completed_at   := v_gen.completed_at;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.replay_canvas_generation_completion_v1 IS
    'Zero-mutation completed-response replay. Accepts no bearer/lease DTO; verifies exact owner+generation+action+canvas+node+fingerprint identity and exact type-appropriate output.';

REVOKE ALL ON FUNCTION public.replay_canvas_generation_completion_v1(uuid, uuid, uuid, uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_canvas_generation_completion_v1(uuid, uuid, uuid, uuid, text, text)
    TO service_role;

-- ###########################################################################
-- 4. claim_canvas_generation_submission_v1
--
-- The one-winner gate. Canvas -> generation lock order preserved. Requires the
-- CURRENT fence (not the immutable submitted snapshot), so a legitimate new
-- writer may Resume a still-current action after takeover, while a concurrent
-- PATCH/takeover/expiry/rerun/terminal/abandon rejects with no token and no
-- provider call.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.claim_canvas_generation_submission_v1(
    p_user_id             uuid,
    p_canvas_id           uuid,
    p_canvas_node_id      text,
    p_action_id           uuid,
    p_observed_rev        bigint,
    p_observed_writer_tag text,
    p_request_fingerprint text
)
RETURNS TABLE (
    generation_id uuid,
    bearer_token  text,
    kind          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen    public.generations%ROWTYPE;
    v_token  text;
BEGIN
    -- LOCK 1 — Canvas, then LOCK 2 — generation. Never the reverse.
    PERFORM public.canvas_p1_assert_canvas_fence_v1(
        p_user_id, p_canvas_id, p_observed_rev, p_observed_writer_tag
    );

    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.user_id = p_user_id
       AND g.action_id = p_action_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_canvas_generation_submission_v1: no action % for user %',
            p_action_id, p_user_id;
    END IF;

    -- Exact identity, recomputed by the authenticated service.
    IF v_gen.canvas_id_snapshot IS DISTINCT FROM p_canvas_id
       OR v_gen.canvas_node_id IS DISTINCT FROM p_canvas_node_id
       OR v_gen.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
        RAISE EXCEPTION
            'claim_canvas_generation_submission_v1: identity/fingerprint mismatch for action %',
            p_action_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- Exactly pending + not_started, with no submission residue whatsoever.
    -- This single predicate is what makes Resume-after-abandon impossible and
    -- what makes concurrent Resume yield exactly one winner.
    IF v_gen.status <> 'pending'
       OR v_gen.provider_submission_state <> 'not_started'
       OR v_gen.submission_token_hash IS NOT NULL
       OR v_gen.submission_started_at IS NOT NULL
       OR v_gen.task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'claim_canvas_generation_submission_v1: action % is not claimable '
            '(status=%, submission_state=%, has_token=%, has_task=%)',
            p_action_id, v_gen.status, v_gen.provider_submission_state,
            (v_gen.submission_token_hash IS NOT NULL), (v_gen.task_id IS NOT NULL)
            USING ERRCODE = 'check_violation';
    END IF;

    v_token := public.canvas_p1_new_bearer_token_v1();

    UPDATE public.generations
       SET provider_submission_state = 'submitting',
           submission_token_hash     = public.canvas_p1_hash_bearer_v1(v_token),
           submission_started_at     = pg_catalog.now()
     WHERE id = v_gen.id;

    generation_id := v_gen.id;
    bearer_token  := v_token;   -- returned exactly once; only the hash is stored
    kind          := v_gen.type;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.claim_canvas_generation_submission_v1 IS
    'One-winner provider-submission claim. Returns the plaintext bearer exactly once and stores only its SHA-256. Requires the CURRENT Canvas fence, not the submitted audit snapshot.';

REVOKE ALL ON FUNCTION public.claim_canvas_generation_submission_v1(uuid, uuid, text, uuid, bigint, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canvas_generation_submission_v1(uuid, uuid, text, uuid, bigint, text, text)
    TO service_role;

-- ###########################################################################
-- 5. abandon_canvas_generation_v1
--
-- Local pre-provider abandon. NOT an upstream cancellation claim. Serialized
-- against claim by the generation row lock: exactly one wins, and neither loser
-- may call a provider.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.abandon_canvas_generation_v1(
    p_user_id   uuid,
    p_action_id uuid
)
RETURNS TABLE (
    generation_id    uuid,
    status           text,
    transitioned     boolean,
    refunded_amount  integer,
    balance_after    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen     public.generations%ROWTYPE;
    v_balance integer;
    v_refund  integer := 0;
BEGIN
    -- generation -> profile. No Canvas lock: abandon is owner-authorized and
    -- must remain possible after a takeover or lease expiry.
    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.user_id = p_user_id
       AND g.action_id = p_action_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'abandon_canvas_generation_v1: no action % for user %', p_action_id, p_user_id;
    END IF;

    -- Idempotent repetition: an already-abandoned row returns the same terminal
    -- state with no second transition and no second refund.
    IF v_gen.status = 'failed' AND v_gen.error_message = 'abandoned_before_submission' THEN
        SELECT pr.credits INTO v_balance FROM public.profiles pr WHERE pr.id = p_user_id;

        generation_id   := v_gen.id;
        status          := v_gen.status;
        transitioned    := false;
        refunded_amount := v_gen.credits_refunded;
        balance_after   := v_balance;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Only a proven never-claimed action is eligible. Any token hash, submission
    -- start, task id or non-pending status means a provider attempt may exist.
    IF v_gen.status <> 'pending'
       OR v_gen.provider_submission_state <> 'not_started'
       OR v_gen.submission_token_hash IS NOT NULL
       OR v_gen.submission_started_at IS NOT NULL
       OR v_gen.task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'abandon_canvas_generation_v1: action % is not abandonable '
            '(status=%, submission_state=%); a provider attempt may exist',
            p_action_id, v_gen.status, v_gen.provider_submission_state
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.generations
       SET status                     = 'failed',
           error_message              = 'abandoned_before_submission',
           completed_at               = pg_catalog.now(),
           next_reconcile_at          = NULL,
           reconcile_owner            = NULL,
           reconcile_lease_token      = NULL,
           reconcile_lease_expires_at = NULL
     WHERE id = v_gen.id;

    -- A paid debit refunds exactly once, through the shared boundary.
    -- A free-quota allowance stays consumed: anti-abuse, per contract.
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
                  p_action_id          => p_action_id,
                  p_canvas_id          => v_gen.canvas_id,
                  p_canvas_id_snapshot => v_gen.canvas_id_snapshot,
                  p_canvas_node_id     => v_gen.canvas_node_id,
                  p_pricing_version    => v_gen.pricing_version,
                  p_description        => 'Canvas abandon refund'
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

COMMENT ON FUNCTION public.abandon_canvas_generation_v1 IS
    'Exactly-once pre-provider abandon of a proven never-claimed pending/not_started action. Refunds a paid debit once via the shared boundary; free quota stays consumed. Repetition is a no-op.';

REVOKE ALL ON FUNCTION public.abandon_canvas_generation_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_canvas_generation_v1(uuid, uuid) TO service_role;
