-- ============================================================================
-- Canvas P1 · Batch 2 Stage A · additive lifecycle foundation
--
-- Runs AFTER the corrected release prerequisite 20260715_generations_service_role_policy.sql.
--
-- DESIGN RULES (all forced by measured catalog evidence, not by migration files)
-- ---------------------------------------------------------------------------
-- 1. Additive only. Every new invariant is conditional on `action_id IS NOT NULL`
--    (generations) or on a non-null `entry_kind` (credit_transactions), so not a
--    single one of the ~30,839 legacy generation rows or any legacy ledger row is
--    reinterpreted, made unreadable, or made unupdatable.
--
-- 2. Evidence beats the contract prose where they disagree. Three such conflicts
--    are handled explicitly and are called out for review:
--
--    (a) The frozen contract says the ledger `type` column carries both 'usage'
--        and 'consume' in live history. That is FALSE. The measured, VALIDATED
--        constraint credit_transactions_type_check admits exactly
--        ('purchase','usage','refund','bonus','admin_adjustment'). 'consume' is
--        rejected by the database. Eight application call sites nonetheless write
--        type:'consume' (see Stage-A findings) and therefore cannot ever have
--        inserted a row. New canonical semantics are carried by `entry_kind`, and
--        `type` is populated with the legal compatibility value. The mapping is
--        pinned by a CHECK so it cannot drift:
--            entry_kind='consume'    -> type='usage'  , amount < 0
--            entry_kind='free_usage' -> type='usage'  , amount = 0
--            entry_kind='refund'     -> type='refund' , amount > 0
--            entry_kind='grant'      -> type='bonus'  , amount > 0
--        This migration does NOT widen credit_transactions_type_check: widening it
--        would silently legalise the eight broken call sites, which is Batch 3's
--        reviewed conversion work, not a foundation concern.
--
--    (b) The contract says the live CHECKs on generations.type / generation_type /
--        status must be "widened safely rather than dropped blindly". No such
--        constraints exist. Measured generations constraints are exactly:
--        generations_pkey, generations_user_id_fkey, valid_library_status, and
--        valid_source (NOT VALID). There is nothing to widen. Only valid_source is
--        rewritten, and only to add 'canvas' while preserving both the exact
--        historical superset and its NOT VALID status.
--
--    (c) service_role holds BYPASSRLS. RLS therefore cannot protect the ledger
--        from a service-role caller. The append-only anchor guard is a TRIGGER,
--        which BYPASSRLS does not bypass.
--
-- 3. Default ACLs are hostile to new objects. Measured pg_default_acl grants
--    anon and authenticated ALL EIGHT table privileges on every new table AND
--    EXECUTE on every new function in schema public, for both the `postgres` and
--    `supabase_admin` owners. Every object created here is therefore explicitly
--    revoked, and the postcondition block proves the revocation rather than
--    assuming it. This is the exact mechanism that gave anon 8 privileges on all
--    four existing target tables.
--
-- IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- Every DDL step is existence-guarded, so a second apply is a no-op that still
-- re-runs the preflight and the postcondition. Drift that would make a re-apply
-- semantically different fails closed instead of being swallowed.
-- ============================================================================

-- ###########################################################################
-- SECTION 0 — FAIL-CLOSED LIVE-SHAPE PREFLIGHT
--
-- Refuses to touch a database whose shape is not the reviewed one. Every
-- assertion below corresponds to a fact independently measured on production
-- (2026-07-15) and re-measured on the isolated Preview Branch (2026-07-16).
-- ###########################################################################
DO $$
DECLARE
    v_txt text;
    v_n   integer;
BEGIN
    ---------------------------------------------------------------------------
    -- 0.1 target relations exist and are ordinary tables
    ---------------------------------------------------------------------------
    FOR v_txt IN
        SELECT unnest(ARRAY['profiles', 'generations', 'credit_transactions', 'canvases'])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = v_txt AND c.relkind = 'r'
        ) THEN
            RAISE EXCEPTION 'canvas-p1 preflight: public.% missing or not an ordinary table', v_txt;
        END IF;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 0.2 generations.duration is INTEGER.
    --     The later `ADD COLUMN IF NOT EXISTS duration TEXT` never changed the
    --     existing type. Lifecycle code depends on the integer reading.
    ---------------------------------------------------------------------------
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_txt
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.generations'::regclass
        AND a.attname = 'duration' AND a.attnum > 0 AND NOT a.attisdropped;

    IF v_txt IS DISTINCT FROM 'integer' THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: generations.duration is % (expected integer)', COALESCE(v_txt, '<absent>');
    END IF;

    ---------------------------------------------------------------------------
    -- 0.3 migration-008-only fields are ABSENT. Their presence would mean this
    --     is not the measured selective history and every other assumption is
    --     suspect.
    ---------------------------------------------------------------------------
    FOR v_txt IN SELECT unnest(ARRAY['model_id', 'final_prompt'])
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = 'public.generations'::regclass
              AND a.attname = v_txt AND a.attnum > 0 AND NOT a.attisdropped
        ) THEN
            RAISE EXCEPTION
                'canvas-p1 preflight: generations.% exists; migration 008 appears applied, '
                'which contradicts the reviewed selective history', v_txt;
        END IF;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 0.4 profile key / non-key classification — the FOR NO KEY UPDATE contract.
    --     credits must not be a primary/unique key column and must not be
    --     referenced by any foreign key; id must be the primary key.
    ---------------------------------------------------------------------------
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.profiles'::regclass
       AND c.contype IN ('p', 'u')
       AND a.attname = 'credits';

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: profiles.credits participates in % primary/unique constraint(s); '
            'FOR NO KEY UPDATE would not be safe', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.confrelid AND a.attnum = ANY (c.confkey)
     WHERE c.confrelid = 'public.profiles'::regclass
       AND c.contype = 'f'
       AND a.attname = 'credits';

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: profiles.credits is referenced by % foreign key(s); '
            'FOR NO KEY UPDATE would not be safe', v_n;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'public.profiles'::regclass
          AND c.contype = 'p'
          AND a.attname = 'id'
    ) THEN
        RAISE EXCEPTION 'canvas-p1 preflight: profiles.id is not the primary key';
    END IF;

    ---------------------------------------------------------------------------
    -- 0.5 POLICY PREREQUISITE. The corrected 20260715 migration must already be
    --     applied. Adding sensitive lifecycle columns while a PUBLIC catch-all
    --     policy is live would publish submission hashes and reconciliation
    --     state to anonymous callers.
    ---------------------------------------------------------------------------
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'generations'
       AND (
             p.polroles = '{0}'::oid[]
             OR EXISTS (
                 SELECT 1 FROM unnest(p.polroles) AS role_oid
                 WHERE role_oid = 0
                    OR pg_catalog.pg_get_userbyid(role_oid) IN ('anon', 'public')
             )
           );

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: % PUBLIC/anon policy(ies) still on public.generations. '
            'Apply the corrected 20260715_generations_service_role_policy.sql first', v_n;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'generations' AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'canvas-p1 preflight: RLS not enabled on public.generations';
    END IF;

    ---------------------------------------------------------------------------
    -- 0.6 LEGACY COMPATIBILITY. valid_source must still be NOT VALID: that is
    --     what tolerates historical rows whose source predates the allowed list.
    --     If it has been validated, rewriting it below would change behaviour
    --     for legacy data.
    ---------------------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.generations'::regclass
          AND conname = 'valid_source' AND convalidated
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: valid_source is VALIDATED live; expected NOT VALID. '
            'Refusing to rewrite it under a different legacy-tolerance assumption';
    END IF;

    ---------------------------------------------------------------------------
    -- 0.7 The ledger type CHECK is the constraint that forces the entry_kind ->
    --     type mapping. Prove it is exactly what was measured before relying on
    --     the mapping; if it has been widened, the mapping decision must be
    --     re-reviewed rather than silently kept.
    ---------------------------------------------------------------------------
    SELECT pg_catalog.pg_get_constraintdef(oid, true) INTO v_txt
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.credit_transactions'::regclass
       AND conname = 'credit_transactions_type_check';

    IF v_txt IS NULL THEN
        RAISE EXCEPTION 'canvas-p1 preflight: credit_transactions_type_check is absent';
    END IF;

    IF v_txt NOT LIKE '%purchase%' OR v_txt NOT LIKE '%usage%'
       OR v_txt NOT LIKE '%refund%' OR v_txt NOT LIKE '%bonus%'
       OR v_txt NOT LIKE '%admin_adjustment%' THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: credit_transactions_type_check has drifted from the '
            'measured allowed set; entry_kind->type mapping must be re-reviewed. def=%', v_txt;
    END IF;

    IF v_txt LIKE '%consume%' THEN
        RAISE EXCEPTION
            'canvas-p1 preflight: credit_transactions_type_check now admits ''consume''. '
            'The measured evidence this migration was designed against says it does not. '
            'Re-review the entry_kind->type mapping before proceeding. def=%', v_txt;
    END IF;

    RAISE NOTICE 'canvas-p1 preflight OK: live shape matches reviewed evidence';
END
$$;

-- ###########################################################################
-- SECTION 1 — generations: additive lifecycle columns
-- ###########################################################################
ALTER TABLE public.generations
    ADD COLUMN IF NOT EXISTS action_id                  uuid,
    ADD COLUMN IF NOT EXISTS canvas_id                  uuid,
    ADD COLUMN IF NOT EXISTS canvas_id_snapshot         uuid,
    ADD COLUMN IF NOT EXISTS canvas_node_id             text,
    ADD COLUMN IF NOT EXISTS canvas_rev                 bigint,
    ADD COLUMN IF NOT EXISTS writer_tag                 text,
    ADD COLUMN IF NOT EXISTS request_fingerprint        text,
    ADD COLUMN IF NOT EXISTS fingerprint_version        text,
    ADD COLUMN IF NOT EXISTS pricing_version            text,
    ADD COLUMN IF NOT EXISTS billing_mode               text,
    ADD COLUMN IF NOT EXISTS output_text                text,
    ADD COLUMN IF NOT EXISTS planned_output_oss_key     text,
    ADD COLUMN IF NOT EXISTS output_oss_key             text,
    ADD COLUMN IF NOT EXISTS updated_at                 timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS provider_submission_state  text,
    ADD COLUMN IF NOT EXISTS submission_token_hash      bytea,
    ADD COLUMN IF NOT EXISTS submission_started_at      timestamptz,
    ADD COLUMN IF NOT EXISTS reconcile_profile_version  text,
    ADD COLUMN IF NOT EXISTS reconcile_interval_ms      integer,
    ADD COLUMN IF NOT EXISTS reconcile_owner            uuid,
    ADD COLUMN IF NOT EXISTS reconcile_lease_token      uuid,
    ADD COLUMN IF NOT EXISTS reconcile_lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS next_reconcile_at          timestamptz,
    ADD COLUMN IF NOT EXISTS reconcile_attempt_count    integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_reconcile_error_code  text;

COMMENT ON COLUMN public.generations.action_id IS
    'Canvas action identity. NULL => legacy row; every new lifecycle invariant is conditional on this being NOT NULL.';
COMMENT ON COLUMN public.generations.canvas_id IS
    'Navigational only. ON DELETE SET NULL: deleting a Canvas must not erase billing identity.';
COMMENT ON COLUMN public.generations.canvas_id_snapshot IS
    'Immutable billing/audit identity. Survives Canvas deletion.';
COMMENT ON COLUMN public.generations.planned_output_oss_key IS
    'Internal. Assigned once at begin for image/video. Never exposed to owner reads before completion.';
COMMENT ON COLUMN public.generations.submission_token_hash IS
    'SHA-256 of the one-time plaintext bearer. The plaintext is returned once and never stored.';
COMMENT ON COLUMN public.generations.reconcile_interval_ms IS
    'Immutable positive interval populated at begin from trusted TypeScript authority. v1 has no adaptive backoff.';

-- Navigational FKs. canvas_id_snapshot deliberately has NO foreign key: it must
-- outlive the Canvas row it names.
--
-- DETERMINISTIC RECREATE, not a name-only existence guard.
--
-- `IF NOT EXISTS (conname = ...)` matches on NAME only. The referential ACTION
-- is the entire point of this constraint and is invisible to that guard: a
-- same-name FK declared ON DELETE CASCADE would have been accepted and left in
-- place, so deleting a Canvas would delete the generation rows that carry the
-- billing identity -- the exact outcome `ON DELETE SET NULL` exists to prevent.
-- The same guard would equally accept a drifted referenced table or column.
-- Dropping first makes the accepted action true by construction; the
-- postcondition in SECTION 9 then re-proves it from pg_constraint catalog codes
-- (confdeltype/confupdtype/confrelid/conkey/confkey), which are exact values
-- rather than deparsed text and therefore carry no parenthesisation risk.
--
-- Safe on live data: canvas_id is a column this migration just added, so it is
-- NULL on every one of the ~30,839 legacy rows and the validation scan cannot
-- fail. The DDL holds ACCESS EXCLUSIVE, so no concurrent DML can observe the
-- momentary absence of the constraint between DROP and ADD.
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_canvas_id_fkey;
ALTER TABLE public.generations
    ADD CONSTRAINT generations_canvas_id_fkey
    FOREIGN KEY (canvas_id) REFERENCES public.canvases(id) ON DELETE SET NULL;

-- ###########################################################################
-- SECTION 2 — generations: conditional invariants
--
-- Added via a name/definition table so each is idempotent. All are conditional
-- on action_id IS NOT NULL, so legacy rows satisfy them vacuously and full
-- validation cannot fail on historical data.
-- ###########################################################################
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT *
        FROM (VALUES
            -- identity / immutability of the action snapshot
            ('gen_action_identity_required',
             'action_id IS NULL OR (
                  canvas_id_snapshot IS NOT NULL
              AND canvas_node_id IS NOT NULL
              AND canvas_rev IS NOT NULL
              AND writer_tag IS NOT NULL
              AND request_fingerprint IS NOT NULL
              AND pricing_version IS NOT NULL
              AND user_id IS NOT NULL
              )'),

            -- fingerprint version is pinned for action rows
            ('gen_action_fingerprint_version',
             'action_id IS NULL OR fingerprint_version = ''canvas-generation-v1'''),

            -- canonical kind, and generation_type is the compatibility mirror
            ('gen_action_kind_canonical',
             'action_id IS NULL OR (
                  type IN (''video'', ''image'', ''text'')
              AND generation_type = type
              )'),

            -- every action row is a canvas row
            ('gen_action_source_canvas',
             'action_id IS NULL OR source = ''canvas'''),

            -- cancelled is legacy-only: Canvas never writes it
            ('gen_action_status_canonical',
             'action_id IS NULL OR status IN (''pending'', ''processing'', ''completed'', ''failed'')'),

            ('gen_action_submission_state',
             'action_id IS NULL OR provider_submission_state IN
                  (''not_started'', ''submitting'', ''bound'', ''unknown'')'),

            ('gen_action_billing_mode',
             'action_id IS NULL OR billing_mode IN (''debit'', ''free_quota'')'),

            -- money: no negative cost, no refund larger than the charge
            ('gen_action_credit_nonnegative',
             'action_id IS NULL OR (credit_cost IS NOT NULL AND credit_cost >= 0)'),

            ('gen_action_refund_bounded',
             'action_id IS NULL OR (
                  credits_refunded IS NOT NULL
              AND credits_refunded >= 0
              AND credits_refunded <= credit_cost
              )'),

            -- free quota actions are never charged
            ('gen_action_free_quota_zero_cost',
             'action_id IS NULL OR billing_mode <> ''free_quota'' OR credit_cost = 0'),

            -- reconciliation lease is all-or-none
            ('gen_reconcile_lease_all_or_none',
             '(reconcile_owner IS NULL AND reconcile_lease_token IS NULL AND reconcile_lease_expires_at IS NULL)
              OR (reconcile_owner IS NOT NULL AND reconcile_lease_token IS NOT NULL AND reconcile_lease_expires_at IS NOT NULL)'),

            -- reconciliation profile is all-or-none and the interval is positive
            ('gen_reconcile_profile_all_or_none',
             '(reconcile_profile_version IS NULL AND reconcile_interval_ms IS NULL)
              OR (reconcile_profile_version IS NOT NULL AND reconcile_interval_ms IS NOT NULL
                  AND reconcile_interval_ms > 0)'),

            -- async action rows require a reviewed profile; direct text rows must
            -- carry no profile, no interval, no schedule and no lease at all.
            ('gen_action_kind_profile_shape',
             'action_id IS NULL OR (
                CASE
                  WHEN type = ''text'' THEN
                       reconcile_profile_version IS NULL
                   AND reconcile_interval_ms IS NULL
                   AND next_reconcile_at IS NULL
                   AND reconcile_owner IS NULL
                   AND reconcile_lease_token IS NULL
                   AND reconcile_lease_expires_at IS NULL
                  ELSE
                       reconcile_profile_version IS NOT NULL
                   AND reconcile_interval_ms IS NOT NULL
                   AND reconcile_interval_ms > 0
                END
              )'),

            -- attempts never go negative
            ('gen_reconcile_attempts_nonnegative',
             'reconcile_attempt_count >= 0'),

            -- image/video action rows must own a planned key; text must not
            ('gen_action_planned_key_shape',
             'action_id IS NULL OR (
                CASE
                  WHEN type = ''text'' THEN planned_output_oss_key IS NULL
                  ELSE planned_output_oss_key IS NOT NULL
                END
              )'),

            -- output shape: text writes only output_text; media writes only the
            -- planned key. This is the database half of "no caller may choose
            -- another key".
            ('gen_action_output_shape',
             'action_id IS NULL OR (
                CASE
                  WHEN type = ''text'' THEN output_oss_key IS NULL
                  ELSE output_text IS NULL
                   AND (output_oss_key IS NULL OR output_oss_key = planned_output_oss_key)
                END
              )'),

            -- a completed action row must actually carry its output
            ('gen_action_completed_has_output',
             'action_id IS NULL OR status <> ''completed'' OR (
                CASE
                  WHEN type = ''text'' THEN output_text IS NOT NULL
                  ELSE output_oss_key IS NOT NULL
                END
              )'),

            -- A bound row that is still PROCESSING must have a task.
            --
            -- The status='completed' escape is load-bearing, not a loophole:
            -- complete_canvas_generation_v1 settles every successful row to
            -- 'bound', including the three direct paths that legitimately have
            -- NO task id (direct DeepSeek text, immediate GPT accepted media,
            -- and leased GPT exact-key recovery). Requiring task_id on every
            -- bound row would make those contractual completions violate this
            -- constraint. The invariant that actually matters -- an in-flight
            -- bound row is always addressable upstream -- is preserved.
            ('gen_action_bound_has_task',
             'action_id IS NULL OR provider_submission_state <> ''bound''
              OR status = ''completed'' OR task_id IS NOT NULL'),

            ('gen_action_not_started_is_clean',
             'action_id IS NULL OR provider_submission_state <> ''not_started'' OR (
                  task_id IS NULL
              AND submission_token_hash IS NULL
              AND submission_started_at IS NULL
              )')
        ) AS t(name, def)
    LOOP
        -- DETERMINISTIC RECREATE, not a name-only existence guard.
        --
        -- A name-only `IF NOT EXISTS` guard silently accepts a same-name object
        -- whose DEFINITION differs -- a stale constraint from an earlier
        -- revision, or a hostile one. Dropping and re-adding makes the second
        -- apply converge on the exact accepted definition by construction, so
        -- same-name drift cannot survive. Comparing deparsed text instead would
        -- be fragile: pg_get_constraintdef's parenthesisation is precisely what
        -- broke the Batch 1B fixture at 113/115.
        --
        -- Every definition here is conditional on action_id IS NULL, so the
        -- revalidation scan cannot fail on the ~30,839 legacy rows.
        EXECUTE format('ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS %I', r.name);
        EXECUTE format(
            'ALTER TABLE public.generations ADD CONSTRAINT %I CHECK (%s)',
            r.name, r.def
        );
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- valid_source: widen to the exact measured superset + 'canvas'.
-- Rewritten (not dropped) and re-added NOT VALID so historical rows that
-- already violate it stay tolerated exactly as they are today.
-- ---------------------------------------------------------------------------
-- Unconditional deterministic recreate. The previous revision only rewrote when
-- the deparsed definition did not already contain 'canvas', which would accept
-- ANY same-name constraint that merely mentioned canvas -- including one that
-- had dropped historical sources or been validated. Recreating every time makes
-- the accepted superset and the NOT VALID state true by construction.
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS valid_source;
ALTER TABLE public.generations
    ADD CONSTRAINT valid_source CHECK (
        source = ANY (ARRAY[
            'quick_gen', 'batch_image', 'image_factory', 'pro_studio',
            'link_video', 'viral_clone', 'ecom_factory', 'studio',
            'slideshow', 'photo_post',
            'canvas'
        ])
        OR source ~~ 'batch_video%'
    ) NOT VALID;

-- ###########################################################################
-- SECTION 3 — generations: indexes
-- ###########################################################################

-- DETERMINISTIC RECREATE. `CREATE INDEX IF NOT EXISTS` matches on NAME only: a
-- same-name index with a different column list, predicate, or -- critically for
-- generations_user_action_uniq -- without UNIQUE, would be silently accepted and
-- the duplicate-action guarantee would evaporate. Dropping first makes the
-- accepted definition true by construction on every apply.
DROP INDEX IF EXISTS public.generations_user_action_uniq;
CREATE UNIQUE INDEX generations_user_action_uniq
    ON public.generations (user_id, action_id)
    WHERE action_id IS NOT NULL;

-- Owner-safe lookup by saved Canvas node identity (contract item 2 GET route).
DROP INDEX IF EXISTS public.generations_canvas_node_action_idx;
CREATE INDEX generations_canvas_node_action_idx
    ON public.generations (canvas_id, canvas_node_id, action_id)
    WHERE action_id IS NOT NULL;

-- Generic reconciliation claim scan: due, non-terminal action rows only.
DROP INDEX IF EXISTS public.generations_reconcile_due_idx;
CREATE INDEX generations_reconcile_due_idx
    ON public.generations (next_reconcile_at)
    WHERE action_id IS NOT NULL
      AND status IN ('pending', 'processing');

-- Stale-submission sweeps (both the video lane and the DeepSeek text sweeper).
DROP INDEX IF EXISTS public.generations_submitting_started_idx;
CREATE INDEX generations_submitting_started_idx
    ON public.generations (submission_started_at)
    WHERE action_id IS NOT NULL
      AND provider_submission_state = 'submitting';

-- NOTE: deliberately NO unique index on task_id. Provider IDs are opaque and may
-- collide across providers/integrations; the contract addresses rows by owned
-- generation_id instead.

-- ###########################################################################
-- SECTION 4 — generations: updated_at transition trigger
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_touch_updated_at() IS
    'Maintains generations.updated_at on every transition. SECURITY INVOKER: it needs no elevated rights.';

-- Hostile default ACL: pg_default_acl grants EXECUTE on every new public
-- function to anon AND authenticated. A trigger function is not an RPC endpoint
-- and no client has any business calling it directly, so revoke it.
--
-- Safe to revoke: PostgreSQL checks EXECUTE on a trigger function when the
-- TRIGGER is created, not when it fires. Removing client EXECUTE therefore does
-- not affect trigger execution at all.
REVOKE ALL ON FUNCTION public.canvas_p1_touch_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canvas_p1_touch_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.canvas_p1_touch_updated_at() FROM authenticated;

DROP TRIGGER IF EXISTS canvas_p1_generations_touch_updated_at ON public.generations;
CREATE TRIGGER canvas_p1_generations_touch_updated_at
    BEFORE UPDATE ON public.generations
    FOR EACH ROW
    EXECUTE FUNCTION public.canvas_p1_touch_updated_at();

-- ###########################################################################
-- SECTION 5 — credit_transactions: structured anchored ledger fields
-- ###########################################################################
ALTER TABLE public.credit_transactions
    ADD COLUMN IF NOT EXISTS entry_kind         text,
    ADD COLUMN IF NOT EXISTS generation_id      uuid,
    ADD COLUMN IF NOT EXISTS action_id          uuid,
    ADD COLUMN IF NOT EXISTS canvas_id          uuid,
    ADD COLUMN IF NOT EXISTS canvas_id_snapshot uuid,
    ADD COLUMN IF NOT EXISTS canvas_node_id     text,
    ADD COLUMN IF NOT EXISTS task_id            text,
    ADD COLUMN IF NOT EXISTS batch_id           uuid,
    ADD COLUMN IF NOT EXISTS pricing_version    text,
    ADD COLUMN IF NOT EXISTS operation_anchor   text,
    ADD COLUMN IF NOT EXISTS quota_key          text,
    ADD COLUMN IF NOT EXISTS quota_window_start timestamptz;

COMMENT ON COLUMN public.credit_transactions.entry_kind IS
    'Canonical semantics for new rows: consume|refund|free_usage|grant. NULL => legacy row, never rewritten.';
COMMENT ON COLUMN public.credit_transactions.operation_anchor IS
    'Stable server-derived idempotency anchor. Once non-null the row is append-only and can never be updated, deleted, cleared or replayed.';
COMMENT ON COLUMN public.credit_transactions.generation_id IS
    'ON DELETE RESTRICT: a generation with a ledger row can never be deleted by the application.';

-- Audit FKs. generation_id RESTRICTs deletion; canvas_id is navigational only.
--
-- DETERMINISTIC RECREATE for the same reason as generations_canvas_id_fkey
-- above, and here the stakes are higher: credit_transactions_generation_id_fkey
-- is the constraint that makes "a generation with a ledger row can never be
-- deleted" true. A name-only guard would have accepted a same-name FK declared
-- ON DELETE CASCADE, which does the exact OPPOSITE -- deleting the generation
-- would silently delete its anchored ledger row and free the operation anchor
-- for replay. Both columns are new here, so both are NULL on all legacy ledger
-- history and validation cannot fail.
ALTER TABLE public.credit_transactions
    DROP CONSTRAINT IF EXISTS credit_transactions_generation_id_fkey;
ALTER TABLE public.credit_transactions
    ADD CONSTRAINT credit_transactions_generation_id_fkey
    FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE RESTRICT;

ALTER TABLE public.credit_transactions
    DROP CONSTRAINT IF EXISTS credit_transactions_canvas_id_fkey;
ALTER TABLE public.credit_transactions
    ADD CONSTRAINT credit_transactions_canvas_id_fkey
    FOREIGN KEY (canvas_id) REFERENCES public.canvases(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Ledger invariants. Every one is conditional on entry_kind IS NOT NULL so no
-- historical row is reinterpreted or made unupdatable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT *
        FROM (VALUES
            ('ct_entry_kind_canonical',
             'entry_kind IS NULL OR entry_kind IN (''consume'', ''refund'', ''free_usage'', ''grant'')'),

            -- The forced mapping. See header note (a): the live VALIDATED
            -- type CHECK has no 'consume' value, so canonical meaning lives in
            -- entry_kind and `type` carries the only legal compatibility value.
            ('ct_entry_kind_type_amount_map',
             'entry_kind IS NULL OR (
                  (entry_kind = ''consume''    AND type = ''usage''  AND amount <  0)
               OR (entry_kind = ''free_usage'' AND type = ''usage''  AND amount =  0)
               OR (entry_kind = ''refund''     AND type = ''refund'' AND amount >  0)
               OR (entry_kind = ''grant''      AND type = ''bonus''  AND amount >  0)
              )'),

            -- signed delta continuity, new rows only
            ('ct_balance_delta_consistent',
             'entry_kind IS NULL OR balance_after = balance_before + amount'),

            ('ct_balance_nonnegative',
             'entry_kind IS NULL OR (balance_before >= 0 AND balance_after >= 0)'),

            -- every new mutation carries a nonblank anchor
            ('ct_entry_requires_anchor',
             'entry_kind IS NULL OR (operation_anchor IS NOT NULL AND length(btrim(operation_anchor)) > 0)'),

            -- action ledger rows require full generation/action/canvas identity.
            -- grant rows are user-scoped and carry no generation.
            ('ct_action_identity_required',
             'entry_kind IS NULL OR entry_kind = ''grant'' OR (
                  generation_id IS NOT NULL
              AND action_id IS NOT NULL
              AND canvas_id_snapshot IS NOT NULL
              AND canvas_node_id IS NOT NULL
              )'),

            ('ct_grant_has_no_generation',
             'entry_kind IS NULL OR entry_kind <> ''grant'' OR (
                  generation_id IS NULL AND action_id IS NULL
              )'),

            -- free usage identifies its quota window; nothing else may
            ('ct_free_usage_quota_identity',
             'entry_kind IS NULL OR (
                CASE
                  WHEN entry_kind = ''free_usage''
                    THEN quota_key IS NOT NULL AND quota_window_start IS NOT NULL
                  ELSE quota_key IS NULL AND quota_window_start IS NULL
                END
              )')
        ) AS t(name, def)
    LOOP
        -- Deterministic recreate; see the rationale on the generations loop.
        -- All definitions are conditional on entry_kind IS NULL, so revalidation
        -- cannot fail on legacy ledger history.
        EXECUTE format('ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS %I', r.name);
        EXECUTE format(
            'ALTER TABLE public.credit_transactions ADD CONSTRAINT %I CHECK (%s)',
            r.name, r.def
        );
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Ledger uniqueness anchors — all partial, so legacy rows are unaffected.
-- ---------------------------------------------------------------------------

-- Deterministic recreate; see the rationale on the generations indexes. These
-- four uniqueness anchors ARE the idempotency backbone, so a same-name
-- non-unique impostor must be impossible rather than merely unlikely.
DROP INDEX IF EXISTS public.credit_transactions_user_anchor_uniq;
CREATE UNIQUE INDEX credit_transactions_user_anchor_uniq
    ON public.credit_transactions (user_id, operation_anchor)
    WHERE operation_anchor IS NOT NULL;

-- At most one consume OR free_usage per generation.
DROP INDEX IF EXISTS public.credit_transactions_consume_anchor_uniq;
CREATE UNIQUE INDEX credit_transactions_consume_anchor_uniq
    ON public.credit_transactions (generation_id)
    WHERE generation_id IS NOT NULL AND entry_kind IN ('consume', 'free_usage');

-- At most one refund per generation.
DROP INDEX IF EXISTS public.credit_transactions_refund_anchor_uniq;
CREATE UNIQUE INDEX credit_transactions_refund_anchor_uniq
    ON public.credit_transactions (generation_id)
    WHERE generation_id IS NOT NULL AND entry_kind = 'refund';

-- Duplicate free-usage accounting guard. NOT a substitute for the bucket limit.
DROP INDEX IF EXISTS public.credit_transactions_quota_usage_uniq;
CREATE UNIQUE INDEX credit_transactions_quota_usage_uniq
    ON public.credit_transactions (user_id, quota_key, quota_window_start, generation_id)
    WHERE entry_kind = 'free_usage';

DROP INDEX IF EXISTS public.credit_transactions_generation_idx;
CREATE INDEX credit_transactions_generation_idx
    ON public.credit_transactions (generation_id)
    WHERE generation_id IS NOT NULL;

-- ###########################################################################
-- SECTION 6 — append-only anchored ledger enforcement
--
-- MUST be a trigger. service_role holds BYPASSRLS, so an RLS policy would be
-- decorative against exactly the caller we are defending against. Triggers are
-- not bypassed by BYPASSRLS, and production `postgres` is not a superuser, so
-- it cannot set session_replication_role='replica' to skip them either.
--
-- Residual risk (documented, not silently accepted): the table OWNER can still
-- ALTER TABLE ... DISABLE TRIGGER. That is an owner-level action outside the
-- application's reachable surface and is called out in the Stage-A findings.
--
-- Note this trigger is also what blocks the cascade path: the measured FK
-- credit_transactions_user_id_fkey is ON DELETE CASCADE from profiles, so
-- deleting a profile tries to delete its ledger rows. With this trigger, any
-- profile holding an anchored row can no longer be hard-deleted -- which is the
-- intended contract behaviour, and is why account removal must become the
-- audit-preserving deactivation implemented in the credit-boundary migration.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.operation_anchor IS NOT NULL THEN
            RAISE EXCEPTION
                'canvas-p1 ledger is append-only: refusing DELETE of anchored credit_transactions row % (anchor=%)',
                OLD.id, OLD.operation_anchor
                USING ERRCODE = 'raise_exception';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- An anchored row is frozen in every respect: no field may change, the
        -- anchor may not be cleared, and it may not be re-pointed.
        IF OLD.operation_anchor IS NOT NULL THEN
            RAISE EXCEPTION
                'canvas-p1 ledger is append-only: refusing UPDATE of anchored credit_transactions row % (anchor=%)',
                OLD.id, OLD.operation_anchor
                USING ERRCODE = 'raise_exception';
        END IF;

        -- A legacy null-anchor row may not acquire an anchor by UPDATE: that
        -- would let a caller mint anchor identity outside the shared boundary
        -- and then replay the logical mutation.
        IF NEW.operation_anchor IS NOT NULL THEN
            RAISE EXCEPTION
                'canvas-p1 ledger is append-only: refusing to introduce operation_anchor on existing row % via UPDATE',
                OLD.id
                USING ERRCODE = 'raise_exception';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_ledger_append_only() IS
    'Non-bypassable append-only guard for anchored ledger rows. Trigger (not RLS) because service_role has BYPASSRLS.';

-- Same hostile-default-ACL revocation as the touch trigger. This one is
-- SECURITY DEFINER, so leaving the default anon/authenticated EXECUTE in place
-- would expose an owner-rights entry point to the browser.
REVOKE ALL ON FUNCTION public.canvas_p1_ledger_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canvas_p1_ledger_append_only() FROM anon;
REVOKE ALL ON FUNCTION public.canvas_p1_ledger_append_only() FROM authenticated;

DROP TRIGGER IF EXISTS canvas_p1_credit_transactions_append_only ON public.credit_transactions;
CREATE TRIGGER canvas_p1_credit_transactions_append_only
    BEFORE UPDATE OR DELETE ON public.credit_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.canvas_p1_ledger_append_only();

-- ###########################################################################
-- SECTION 7 — generation_quota_buckets
--
-- Created LAST among tables so the explicit revoke below is the final word on
-- its ACL. Remember: CREATE TABLE here silently receives anon/authenticated
-- ALL-8 from pg_default_acl. Without the REVOKE the "no client privileges"
-- assertion would be a vacuous pass.
-- ###########################################################################
-- The table is created with its columns and PRIMARY KEY only. Every CHECK and
-- the FK are attached below by DETERMINISTIC RECREATE, for the same reason the
-- generations/credit_transactions constraints are: `CREATE TABLE IF NOT EXISTS`
-- matches on NAME only, so a stale or hostile same-name table would be accepted
-- wholesale -- including one whose generation_quota_buckets_v1_limit_pinned
-- CHECK does not actually pin the limit, which would restore the exact free
-- quota bypass this pin exists to close.
CREATE TABLE IF NOT EXISTS public.generation_quota_buckets (
    user_id      uuid        NOT NULL,
    quota_key    text        NOT NULL,
    window_start timestamptz NOT NULL,
    quota_limit  integer     NOT NULL,
    used         integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT generation_quota_buckets_pkey
        PRIMARY KEY (user_id, quota_key, window_start)
);

-- ---------------------------------------------------------------------------
-- 7.1 EXACT COLUMN SHAPE of whatever table now bears the name.
--
-- Proves name / type / NOT NULL / DEFAULT for every accepted column, AND that
-- no UNEXPECTED column exists. The previous revision checked only name+type, so
-- a same-name table whose `used` was nullable, or defaulted to something other
-- than 0, or which carried extra columns, passed as "the accepted shape".
-- Defaults are compared as deparsed text, but only for the trivial expressions
-- this table uses (`0`, `now()`), which carry no parenthesisation risk.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_type    text;
    v_notnull boolean;
    v_default text;
    v_extra   text;
    v_count   integer;
    r         record;
BEGIN
    FOR r IN
        SELECT *
        FROM (VALUES
            ('user_id',      'uuid',                     true,  NULL),
            ('quota_key',    'text',                     true,  NULL),
            ('window_start', 'timestamp with time zone', true,  NULL),
            ('quota_limit',  'integer',                  true,  NULL),
            ('used',         'integer',                  true,  '0'),
            ('created_at',   'timestamp with time zone', true,  'now()'),
            ('updated_at',   'timestamp with time zone', true,  'now()')
        ) AS t(col, typ, expected_not_null, def)
    LOOP
        SELECT format_type(a.atttypid, a.atttypmod),
               a.attnotnull,
               pg_catalog.pg_get_expr(d.adbin, d.adrelid)
          INTO v_type, v_notnull, v_default
          FROM pg_catalog.pg_attribute a
          LEFT JOIN pg_catalog.pg_attrdef d
            ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = 'public.generation_quota_buckets'::regclass
           AND a.attname = r.col AND a.attnum > 0 AND NOT a.attisdropped;

        IF v_type IS NULL THEN
            RAISE EXCEPTION
                'canvas-p1: generation_quota_buckets.% is missing; the existing same-name table is not '
                'the accepted shape', r.col;
        END IF;
        IF v_type <> r.typ THEN
            RAISE EXCEPTION
                'canvas-p1: generation_quota_buckets.% is % (expected %); same-name table drift',
                r.col, v_type, r.typ;
        END IF;
        IF v_notnull IS DISTINCT FROM r.expected_not_null THEN
            RAISE EXCEPTION
                'canvas-p1: generation_quota_buckets.% has NOT NULL = % (expected %); same-name table drift',
                r.col, v_notnull, r.expected_not_null;
        END IF;
        IF v_default IS DISTINCT FROM r.def THEN
            RAISE EXCEPTION
                'canvas-p1: generation_quota_buckets.% default is % (expected %); same-name table drift',
                r.col, COALESCE(v_default, '<none>'), COALESCE(r.def, '<none>');
        END IF;
    END LOOP;

    -- No extra columns. An unexpected column on a same-name table means it is
    -- not this table, whatever its other columns look like.
    SELECT pg_catalog.string_agg(a.attname, ', ' ORDER BY a.attnum)
      INTO v_extra
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.generation_quota_buckets'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname <> ALL (ARRAY[
           'user_id', 'quota_key', 'window_start', 'quota_limit', 'used', 'created_at', 'updated_at'
       ]);

    IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION
            'canvas-p1: generation_quota_buckets carries unexpected column(s) %; the existing '
            'same-name table is not the accepted shape', v_extra;
    END IF;

    -- The PRIMARY KEY is the uniqueness that makes one bucket per
    -- (user, key, window). Its exact ordered column list is compared from the
    -- catalog (conkey), not from deparsed text.
    SELECT count(*) INTO v_count
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.generation_quota_buckets'::regclass
       AND c.contype = 'p'
       AND c.conname = 'generation_quota_buckets_pkey'
       AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = c.conrelid AND attname = 'user_id'),
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = c.conrelid AND attname = 'quota_key'),
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = c.conrelid AND attname = 'window_start')
           ]::int2[];

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'canvas-p1: generation_quota_buckets_pkey is not the accepted PRIMARY KEY '
            '(user_id, quota_key, window_start); same-name table drift';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7.2 DETERMINISTIC RECREATE of the FK and every CHECK.
--
-- Same rationale and same pattern as the generations / credit_transactions
-- constraint loops above: dropping first makes each accepted definition true by
-- construction, so a same-name constraint that merely EXISTS can never be
-- mistaken for the constraint that was reviewed. If a pre-existing table holds
-- rows that violate an accepted CHECK, ADD CONSTRAINT fails and the migration
-- stops -- which is the intended fail-closed outcome, not something to swallow.
-- ---------------------------------------------------------------------------
ALTER TABLE public.generation_quota_buckets
    DROP CONSTRAINT IF EXISTS generation_quota_buckets_user_id_fkey;
ALTER TABLE public.generation_quota_buckets
    ADD CONSTRAINT generation_quota_buckets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT *
        FROM (VALUES
            ('generation_quota_buckets_used_range',
             'used >= 0 AND used <= quota_limit'),

            ('generation_quota_buckets_limit_positive',
             'quota_limit > 0'),

            ('generation_quota_buckets_key_nonblank',
             'length(btrim(quota_key)) > 0'),

            -- v1 PIN. The product rule ("canvas-deepseek-v1 => 20 per UTC day")
            -- is enforced by the database itself, not merely by the begin RPC.
            -- Even a service-role caller cannot mint a canvas-deepseek-v1 bucket
            -- with an inflated limit. A future product change requires a NEW
            -- quota_key, never a mutated limit.
            ('generation_quota_buckets_v1_limit_pinned',
             'quota_key <> ''canvas-deepseek-v1'' OR quota_limit = 20'),

            -- Every bucket window is an exact UTC calendar-day boundary.
            ('generation_quota_buckets_window_utc_day',
             'window_start = date_trunc(''day'', window_start AT TIME ZONE ''UTC'') AT TIME ZONE ''UTC''')
        ) AS t(name, def)
    LOOP
        EXECUTE format(
            'ALTER TABLE public.generation_quota_buckets DROP CONSTRAINT IF EXISTS %I', r.name
        );
        EXECUTE format(
            'ALTER TABLE public.generation_quota_buckets ADD CONSTRAINT %I CHECK (%s)',
            r.name, r.def
        );
    END LOOP;
END
$$;

COMMENT ON TABLE public.generation_quota_buckets IS
    'Free-allowance buckets. v1: quota_key=canvas-deepseek-v1, UTC calendar-day window, limit 20 new actions/user/day. Service-role lifecycle functions only; no client role holds any privilege.';
COMMENT ON COLUMN public.generation_quota_buckets.window_start IS
    'UTC calendar-day boundary (date_trunc(''day'', now() AT TIME ZONE ''UTC'')). Product changes require a NEW quota_key, never bucket mutation.';

ALTER TABLE public.generation_quota_buckets ENABLE ROW LEVEL SECURITY;

-- No policies are created: with RLS enabled and zero policies, no non-BYPASSRLS
-- role can read or write a single row. service_role reaches it via BYPASSRLS.

-- ###########################################################################
-- SECTION 8 — ACL / default-ACL handling
--
-- Explicitly undo what pg_default_acl handed out, and regrant only what is
-- proven necessary. Ordering matters: revoke first, then narrow grants.
-- ###########################################################################

-- --- 8.1 generation_quota_buckets: no client access whatsoever -------------
REVOKE ALL ON TABLE public.generation_quota_buckets FROM PUBLIC;
REVOKE ALL ON TABLE public.generation_quota_buckets FROM anon;
REVOKE ALL ON TABLE public.generation_quota_buckets FROM authenticated;

-- --- 8.2 generations: no client DML, no table-level client SELECT ---------
-- Sensitive lifecycle columns now exist, so table-level SELECT must go before
-- any owner-safe projection is restored.
REVOKE ALL ON TABLE public.generations FROM PUBLIC;
REVOKE ALL ON TABLE public.generations FROM anon;
REVOKE ALL ON TABLE public.generations FROM authenticated;

-- Restore ONLY the owner-safe projection for authenticated. Column-level SELECT
-- plus the row-scoped generations_select_own policy from the 20260715
-- prerequisite together produce "owners see only their safe status projection".
--
-- Excluded on purpose: submission_token_hash (bearer material),
-- planned_output_oss_key (internal, must not leak before completion),
-- every reconcile_* / next_reconcile_at / last_reconcile_error_code field
-- (reconciler internals), and canvas_rev / writer_tag / canvas_id_snapshot /
-- request_fingerprint / fingerprint_version (internal audit snapshots).
GRANT SELECT (
    -- verified legacy owner-readable fields
    id, user_id, task_id, type, source, prompt, model, duration, aspect_ratio,
    quality, source_image_url, status, result_url, video_url, image_url,
    thumbnail_url, error_message, credit_cost, use_pro, metadata, created_at,
    completed_at, group_name, generation_type, output_url, progress,
    credits_used, credits_refunded, started_at, resolution, library_status,
    batch_id, spec,
    -- safe new status/output/action identifiers
    action_id, canvas_id, canvas_node_id, billing_mode, pricing_version,
    output_text, output_oss_key, updated_at, provider_submission_state
) ON public.generations TO authenticated;

-- anon receives nothing. Left explicit so a reviewer sees the intent.

-- --- 8.3 credit_transactions: read-only for clients, no DML ---------------
REVOKE ALL ON TABLE public.credit_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.credit_transactions FROM anon;
REVOKE ALL ON TABLE public.credit_transactions FROM authenticated;

-- Owners (and admins, via the existing SELECT policies) keep read access.
-- All ledger writes go exclusively through the shared service-role boundary.
GRANT SELECT ON public.credit_transactions TO authenticated;

-- Remove the permissive browser/admin INSERT policy: it let any profile with
-- role admin/super_admin mint ledger rows directly from the browser.
DROP POLICY IF EXISTS "Admins can create transactions" ON public.credit_transactions;

-- --- 8.4 profiles: server-only creation, narrow self-service updates ------
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.profiles FROM authenticated;

GRANT SELECT ON public.profiles TO authenticated;

-- Only the verified self-service columns are owner-writable. credits, role,
-- status, banned_at, banned_reason, id, email and the audit timestamps are not.
GRANT UPDATE (name, phone, avatar_url) ON public.profiles TO authenticated;

-- Profile creation is server-only from here on: the permissive INSERT policy
-- and the INSERT grant both go. A forged direct insert must fail.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- The measured UPDATE policy has USING but no WITH CHECK, so PostgreSQL reuses
-- USING as the check and an owner could previously rewrite any non-identity
-- column of their own row -- including credits and role. The column grant above
-- is the real fix (policies cannot restrict columns); the policy is replaced
-- with an explicit symmetric one so the intent is unambiguous.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Deterministic recreate rather than a name-only existence guard: a same-name
-- policy with a different command/roles/USING/WITH CHECK would otherwise be
-- silently accepted on a second apply.
DROP POLICY IF EXISTS "profiles_update_own_selfservice" ON public.profiles;
CREATE POLICY "profiles_update_own_selfservice"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ###########################################################################
-- SECTION 9 — EXECUTABLE POSTCONDITIONS
--
-- Proves the migration achieved its security goals instead of assuming the DDL
-- landed. Runs on every apply, so a second application re-proves the same
-- invariants and cannot silently swallow drift.
-- ###########################################################################
DO $$
DECLARE
    v_n    integer;
    v_priv text;
    v_role text;
    v_def  text;
    r      record;
BEGIN
    ---------------------------------------------------------------------------
    -- 9.1 quota buckets: zero privileges for every client role, RLS on,
    --     zero policies. Checked per-privilege so an empty ACL cannot pass
    --     vacuously.
    ---------------------------------------------------------------------------
    -- All EIGHT PostgreSQL 17 table privileges, MAINTAIN included. The measured
    -- pg_default_acl hands out exactly these eight to anon/authenticated on
    -- every new public table, so omitting MAINTAIN would leave a real grant
    -- unproven and the "zero client privileges" claim incomplete.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        LOOP
            IF has_table_privilege(v_role, 'public.generation_quota_buckets', v_priv) THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % still holds % on generation_quota_buckets '
                    '(pg_default_acl grant was not revoked)', v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    -- zero policies: with RLS on and no policy, no non-BYPASSRLS role sees a row
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'generation_quota_buckets';

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: generation_quota_buckets has % policy(ies); expected zero', v_n;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'generation_quota_buckets' AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'canvas-p1 postcondition FAILED: RLS not enabled on generation_quota_buckets';
    END IF;

    ---------------------------------------------------------------------------
    -- 9.2 generations: no client DML at all; anon has nothing.
    ---------------------------------------------------------------------------
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        LOOP
            IF has_table_privilege(v_role, 'public.generations', v_priv) THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % still holds % on generations', v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    IF has_table_privilege('anon', 'public.generations', 'SELECT') THEN
        RAISE EXCEPTION 'canvas-p1 postcondition FAILED: anon still holds SELECT on generations';
    END IF;

    ---------------------------------------------------------------------------
    -- 9.3 No sensitive lifecycle column may be client-readable.
    ---------------------------------------------------------------------------
    FOREACH v_priv IN ARRAY ARRAY[
        'submission_token_hash', 'planned_output_oss_key', 'reconcile_profile_version',
        'reconcile_interval_ms', 'reconcile_owner', 'reconcile_lease_token',
        'reconcile_lease_expires_at', 'next_reconcile_at', 'reconcile_attempt_count',
        'last_reconcile_error_code', 'canvas_rev', 'writer_tag', 'canvas_id_snapshot',
        'request_fingerprint', 'fingerprint_version', 'submission_started_at'
    ]
    LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
            IF has_column_privilege(v_role, 'public.generations', v_priv, 'SELECT') THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % can SELECT sensitive column generations.%',
                    v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 9.4 ledger: no client write path of any kind.
    ---------------------------------------------------------------------------
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        LOOP
            IF has_table_privilege(v_role, 'public.credit_transactions', v_priv) THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % still holds % on credit_transactions', v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    IF has_table_privilege('anon', 'public.credit_transactions', 'SELECT') THEN
        RAISE EXCEPTION 'canvas-p1 postcondition FAILED: anon still holds SELECT on credit_transactions';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'credit_transactions' AND p.polcmd IN ('a', '*');

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: % INSERT/ALL policy(ies) remain on credit_transactions', v_n;
    END IF;

    ---------------------------------------------------------------------------
    -- 9.5 profiles: no client INSERT; credits/role/status never owner-writable.
    ---------------------------------------------------------------------------
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF has_table_privilege(v_role, 'public.profiles', 'INSERT') THEN
            RAISE EXCEPTION 'canvas-p1 postcondition FAILED: % still holds INSERT on profiles', v_role;
        END IF;
        IF has_table_privilege(v_role, 'public.profiles', 'DELETE') THEN
            RAISE EXCEPTION 'canvas-p1 postcondition FAILED: % still holds DELETE on profiles', v_role;
        END IF;

        FOREACH v_priv IN ARRAY ARRAY['credits','role','status','banned_at','banned_reason','id','email','created_at','updated_at']
        LOOP
            IF has_column_privilege(v_role, 'public.profiles', v_priv, 'UPDATE') THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % can UPDATE privileged profiles.%', v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    -- and the self-service columns must actually still work for the UI
    FOREACH v_priv IN ARRAY ARRAY['name','phone','avatar_url']
    LOOP
        IF NOT has_column_privilege('authenticated', 'public.profiles', v_priv, 'UPDATE') THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: authenticated lost self-service UPDATE on profiles.%', v_priv;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'profiles' AND p.polcmd = 'a';

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: % INSERT policy(ies) remain on profiles', v_n;
    END IF;

    ---------------------------------------------------------------------------
    -- 9.6 the append-only guard is actually attached and enabled.
    ---------------------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.credit_transactions'::regclass
          AND tgname = 'canvas_p1_credit_transactions_append_only'
          AND NOT tgisinternal
          AND tgenabled <> 'D'
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: append-only ledger trigger missing or disabled';
    END IF;

    -- ...and that it fires for BOTH UPDATE and DELETE, and is a row trigger.
    -- tgtype bit 0 = ROW, bit 2 = UPDATE(16)/DELETE(8) per pg_trigger layout.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.credit_transactions'::regclass
          AND tgname = 'canvas_p1_credit_transactions_append_only'
          AND (tgtype & 1) = 1        -- FOR EACH ROW
          AND (tgtype & 8) = 8        -- DELETE
          AND (tgtype & 16) = 16      -- UPDATE
          AND tgfoid = 'public.canvas_p1_ledger_append_only()'::regprocedure
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: append-only trigger is not a row-level UPDATE+DELETE '
            'trigger bound to canvas_p1_ledger_append_only()';
    END IF;

    ---------------------------------------------------------------------------
    -- 9.7 trigger functions carry no client EXECUTE (hostile pg_default_acl)
    ---------------------------------------------------------------------------
    FOREACH v_priv IN ARRAY ARRAY[
        'public.canvas_p1_touch_updated_at()',
        'public.canvas_p1_ledger_append_only()'
    ]
    LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public']
        LOOP
            IF has_function_privilege(v_role, v_priv, 'EXECUTE') THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % may EXECUTE trigger function %', v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 9.8 EXACT object definitions. Deterministic recreate makes these true by
    --     construction; asserting them anyway means a same-name drift that
    --     somehow survived cannot pass a second apply silently.
    ---------------------------------------------------------------------------

    -- the action-uniqueness index must be UNIQUE and partial
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND indexname = 'generations_user_action_uniq'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
          AND indexdef LIKE '%(user_id, action_id)%'
          AND indexdef LIKE '%WHERE (action_id IS NOT NULL)%'
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: generations_user_action_uniq is not the accepted '
            'partial UNIQUE (user_id, action_id) WHERE action_id IS NOT NULL index';
    END IF;

    -- The four ledger anchor indexes ARE the idempotency backbone. Proving only
    -- "is UNIQUE" was not enough: a same-name UNIQUE index over the WRONG
    -- columns, or without its partial predicate, is unique over something other
    -- than the anchor it is supposed to protect and would silently permit
    -- duplicate consume/refund/free-usage accounting. Each index's exact column
    -- list AND predicate are therefore proven.
    FOR r IN
        SELECT *
        FROM (VALUES
            ('credit_transactions_user_anchor_uniq',
             '%(user_id, operation_anchor)%',
             '%WHERE (operation_anchor IS NOT NULL)%'),
            ('credit_transactions_consume_anchor_uniq',
             '%(generation_id)%',
             '%WHERE ((generation_id IS NOT NULL) AND (entry_kind = ANY (ARRAY[''consume''::text, ''free_usage''::text])))%'),
            ('credit_transactions_refund_anchor_uniq',
             '%(generation_id)%',
             '%WHERE ((generation_id IS NOT NULL) AND (entry_kind = ''refund''::text))%'),
            ('credit_transactions_quota_usage_uniq',
             '%(user_id, quota_key, quota_window_start, generation_id)%',
             '%WHERE (entry_kind = ''free_usage''::text)%')
        ) AS t(name, cols, pred)
    LOOP
        SELECT indexdef INTO v_def
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'public' AND indexname = r.name;

        IF v_def IS NULL THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: ledger anchor index % is missing', r.name;
        END IF;
        IF v_def NOT LIKE 'CREATE UNIQUE INDEX%' THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: ledger anchor index % is not UNIQUE (def=%)',
                r.name, v_def;
        END IF;
        IF v_def NOT LIKE r.cols THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: ledger anchor index % does not cover the accepted '
                'column list (expected like %, def=%)', r.name, r.cols, v_def;
        END IF;
        IF v_def NOT LIKE r.pred THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: ledger anchor index % does not carry the accepted '
                'partial predicate (expected like %, def=%). Without it the index is unique over a '
                'different set than the anchor it protects', r.name, r.pred, v_def;
        END IF;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 9.8b EXACT FOREIGN-KEY REFERENTIAL ACTIONS.
    --
    -- Compared from pg_constraint catalog CODES (confdeltype/confupdtype) and
    -- OIDs, never from deparsed text: these are exact values and carry none of
    -- the parenthesisation/qualification risk that broke the Batch 1B fixture.
    --
    -- The actions are the whole point of these constraints:
    --   generations.canvas_id            -> SET NULL ('n'): deleting a Canvas
    --       must not delete the row carrying billing identity.
    --   credit_transactions.generation_id-> RESTRICT ('r'): a generation with a
    --       ledger row can never be deleted. CASCADE here would free the
    --       operation anchor for replay.
    --   credit_transactions.canvas_id    -> SET NULL ('n'): navigational only.
    --   generation_quota_buckets.user_id -> CASCADE ('c'): buckets are not audit
    --       records and carry no anchor.
    ---------------------------------------------------------------------------
    FOR r IN
        SELECT *
        FROM (VALUES
            ('public.generations',              'generations_canvas_id_fkey',
             'canvas_id',     'public.canvases',    'n'),
            ('public.credit_transactions',      'credit_transactions_generation_id_fkey',
             'generation_id', 'public.generations', 'r'),
            ('public.credit_transactions',      'credit_transactions_canvas_id_fkey',
             'canvas_id',     'public.canvases',    'n'),
            ('public.generation_quota_buckets', 'generation_quota_buckets_user_id_fkey',
             'user_id',       'public.profiles',    'c')
        ) AS t(rel, name, col, target, delact)
    LOOP
        SELECT count(*) INTO v_n
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = r.rel::regclass
           AND c.conname = r.name
           AND c.contype = 'f'
           AND c.confrelid = r.target::regclass
           AND c.confdeltype = r.delact
           AND c.confupdtype = 'a'                       -- NO ACTION on update
           AND c.convalidated
           AND c.conkey = ARRAY[(
                 SELECT a.attnum FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attname = r.col
               )]::int2[]
           AND c.confkey = ARRAY[(
                 SELECT a.attnum FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = c.confrelid AND a.attname = 'id'
               )]::int2[];

        IF v_n <> 1 THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: %.% is not the accepted VALIDATED foreign key '
                '(%) REFERENCES %(id) ON DELETE % ON UPDATE NO ACTION. A same-name FK with a '
                'different referential action is a different contract',
                r.rel, r.name, r.col, r.target, r.delact;
        END IF;
    END LOOP;

    -- No unreviewed CHECK may ride along on the quota table, and none of the
    -- accepted ones may be missing. Compared as an exact name set.
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.generation_quota_buckets'::regclass
       AND contype = 'c'
       AND conname <> ALL (ARRAY[
           'generation_quota_buckets_used_range',
           'generation_quota_buckets_limit_positive',
           'generation_quota_buckets_key_nonblank',
           'generation_quota_buckets_v1_limit_pinned',
           'generation_quota_buckets_window_utc_day'
       ]);

    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: generation_quota_buckets carries % unreviewed CHECK '
            'constraint(s)', v_n;
    END IF;

    FOREACH v_priv IN ARRAY ARRAY[
        'generation_quota_buckets_used_range',
        'generation_quota_buckets_limit_positive',
        'generation_quota_buckets_key_nonblank',
        'generation_quota_buckets_v1_limit_pinned',
        'generation_quota_buckets_window_utc_day'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint
             WHERE conrelid = 'public.generation_quota_buckets'::regclass
               AND conname = v_priv AND contype = 'c' AND convalidated
        ) THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: generation_quota_buckets is missing VALIDATED '
                'CHECK %', v_priv;
        END IF;
    END LOOP;

    -- valid_source must remain NOT VALID and admit canvas + the full history
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.generations'::regclass
          AND conname = 'valid_source'
          AND NOT convalidated
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: valid_source is missing or has been VALIDATED; '
            'legacy rows would no longer be tolerated';
    END IF;

    FOREACH v_priv IN ARRAY ARRAY[
        'canvas', 'quick_gen', 'batch_image', 'image_factory', 'pro_studio',
        'link_video', 'viral_clone', 'ecom_factory', 'studio', 'slideshow', 'photo_post'
    ]
    LOOP
        IF pg_catalog.pg_get_constraintdef(
               (SELECT oid FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.generations'::regclass AND conname = 'valid_source'), true
           ) NOT LIKE '%''' || v_priv || '''%' THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: valid_source no longer admits source %; '
                'the compatibility superset was narrowed', v_priv;
        END IF;
    END LOOP;

    -- The owner SELECT policy from the 20260715 prerequisite must still be the
    -- exact row-scoped shape, not a widened impostor. The role set is pinned
    -- too: a policy retargeted at another role is a different grant of
    -- visibility, and this file has just narrowed generations to an owner-safe
    -- column projection on the assumption that `authenticated` is the only role
    -- the policy admits.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'generations'
          AND p.polname = 'generations_select_own'
          AND p.polcmd = 'r'                       -- SELECT only
          AND p.polpermissive
          AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]::oid[]
          AND p.polwithcheck IS NULL
          AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) <> 'true'
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: generations_select_own is not the exact row-scoped '
            'PERMISSIVE SELECT policy TO authenticated (or has become a catch-all)';
    END IF;

    -- The self-service profile policy is likewise pinned: it is created by this
    -- file, so a drifted same-name policy means something else recreated it.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'profiles'
          AND p.polname = 'profiles_update_own_selfservice'
          AND p.polcmd = 'w'                       -- UPDATE only
          AND p.polpermissive
          AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]::oid[]
          AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) <> 'true'
          AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) <> 'true'
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 postcondition FAILED: profiles_update_own_selfservice is not the exact '
            'row-scoped PERMISSIVE UPDATE policy TO authenticated with a symmetric non-catch-all '
            'USING and WITH CHECK';
    END IF;

    RAISE NOTICE 'canvas-p1 lifecycle foundation postconditions OK';
END
$$;
