-- ============================================================================
-- Canvas P1 · Batch 2 Stage B.1 · shared atomic credit boundary,
--                                 server-only account initialization,
--                                 audit-preserving account deactivation.
--
-- Requires 20260716_canvas_p1_lifecycle_foundation.sql.
--
-- WHY EVERY FUNCTION LOOKS LIKE THIS
-- ---------------------------------------------------------------------------
-- * SECURITY DEFINER — the caller (service_role) must not need direct table
--   DML; the boundary is the only writer.
-- * SET search_path = '' — nothing is resolved from a mutable schema. Every
--   application object is fully schema-qualified. pg_catalog is always searched
--   implicitly, so built-ins still resolve. This is stronger than pinning
--   'pg_catalog, public': it removes the public schema from the path entirely.
-- * REVOKE ... FROM PUBLIC, anon, authenticated — mandatory, not cosmetic. The
--   measured pg_default_acl grants EXECUTE on every new public function to anon
--   AND authenticated. Without the revoke, every function below would be
--   callable straight from the browser with service-role force.
--
-- LOCK DISCIPLINE
-- ---------------------------------------------------------------------------
-- All credit movement serializes on the profile row via FOR NO KEY UPDATE.
-- Preflight proved profiles.credits is neither a primary/unique key column nor
-- referenced by any foreign key, so NO KEY UPDATE is sound and stays compatible
-- with the KEY SHARE locks that the 11 incoming foreign keys take on
-- profiles.id. Callers that need Canvas/generation locks must take those FIRST
-- and then call in here; this function never reaches back up the order.
-- ============================================================================

-- ###########################################################################
-- 0. TWO COMPLETE, MUTUALLY EXCLUSIVE CREDIT IDENTITIES
--
-- Canvas actions retain the full generation/action/canvas/node identity frozen
-- by the lifecycle foundation. Legacy product operations cannot invent those
-- identifiers: they instead carry no action identity at all and MUST carry one
-- nonblank task_id. Partial action identity is rejected in both branches.
--
-- The replacement is one ALTER statement so no concurrent statement can
-- observe the table without an identity constraint. NOT VALID still enforces
-- all new writes immediately; VALIDATE then proves retained rows.
-- ###########################################################################
ALTER TABLE public.credit_transactions
    DROP CONSTRAINT IF EXISTS ct_action_identity_required,
    ADD CONSTRAINT ct_action_identity_required CHECK (
        entry_kind IS NULL
        OR entry_kind = 'grant'
        OR (
            generation_id IS NOT NULL
            AND action_id IS NOT NULL
            AND canvas_id_snapshot IS NOT NULL
            AND canvas_node_id IS NOT NULL
        )
        OR (
            generation_id IS NULL
            AND action_id IS NULL
            AND canvas_id_snapshot IS NULL
            AND canvas_node_id IS NULL
            AND task_id IS NOT NULL
            AND length(btrim(task_id)) > 0
        )
    ) NOT VALID;

ALTER TABLE public.credit_transactions
    VALIDATE CONSTRAINT ct_action_identity_required;

-- ###########################################################################
-- 0. THE ONE ANCHOR IDENTITY COMPARATOR
--
-- WHY THIS IS A SEPARATE FUNCTION
-- ---------------------------------------------------------------------------
-- An operation anchor is a claim of the form "this exact logical mutation has
-- already been applied". Returning an existing row for a matching anchor is
-- therefore an ASSERTION about identity, and it is only safe if every frozen
-- immutable field of the stored row equals what the caller asked about.
--
-- The previous revision compared the full identity on the normal
-- already-exists path but NOT in the `unique_violation` convergence branch,
-- which simply returned whatever row carried the anchor. That branch could
-- therefore report success for a mutation whose generation/action/canvas/node/
-- task/batch/pricing/quota identity differed from the request -- the exact
-- failure the full comparison exists to prevent, reachable through the one
-- path that skipped it.
--
-- Both paths now call THIS function and nothing else. There is no second
-- comparison to drift out of sync with the first, because there is only one.
--
-- Every comparison is null-safe (IS DISTINCT FROM): a NULL on either side is a
-- difference, never a free pass.
--
-- canvas_id is deliberately NOT compared: it is the navigational FK and is
-- nulled by ON DELETE SET NULL when a Canvas is deleted, so a legitimate replay
-- after Canvas deletion would otherwise raise. canvas_id_snapshot is the
-- immutable identity and IS compared.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_assert_anchor_identity_v1(
    p_existing           public.credit_transactions,
    p_user_id            uuid,
    p_entry_kind         text,
    p_amount             integer,
    p_operation_anchor   text,
    p_generation_id      uuid,
    p_action_id          uuid,
    p_canvas_id_snapshot uuid,
    p_canvas_node_id     text,
    p_task_id            text,
    p_batch_id           uuid,
    p_pricing_version    text,
    p_quota_key          text,
    p_quota_window_start timestamptz
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_existing.user_id            IS DISTINCT FROM p_user_id
       OR p_existing.operation_anchor   IS DISTINCT FROM p_operation_anchor
       OR p_existing.entry_kind         IS DISTINCT FROM p_entry_kind
       OR p_existing.amount             IS DISTINCT FROM p_amount
       OR p_existing.generation_id      IS DISTINCT FROM p_generation_id
       OR p_existing.action_id          IS DISTINCT FROM p_action_id
       OR p_existing.canvas_id_snapshot IS DISTINCT FROM p_canvas_id_snapshot
       OR p_existing.canvas_node_id     IS DISTINCT FROM p_canvas_node_id
       OR p_existing.task_id            IS DISTINCT FROM p_task_id
       OR p_existing.batch_id           IS DISTINCT FROM p_batch_id
       OR p_existing.pricing_version    IS DISTINCT FROM p_pricing_version
       OR p_existing.quota_key          IS DISTINCT FROM p_quota_key
       OR p_existing.quota_window_start IS DISTINCT FROM p_quota_window_start
    THEN
        RAISE EXCEPTION
            'canvas-p1 anchor identity: operation anchor % for user % is bound to a different '
            'logical mutation identity; refusing conflicting replay '
            '(stored kind=%/amount=%/generation=%/action=%, requested kind=%/amount=%/generation=%/action=%)',
            p_operation_anchor, p_user_id,
            p_existing.entry_kind, p_existing.amount, p_existing.generation_id, p_existing.action_id,
            p_entry_kind, p_amount, p_generation_id, p_action_id
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_assert_anchor_identity_v1 IS
    'The single exact immutable-identity comparator for operation-anchor replay. Called by BOTH the locked already-exists path and the unique_violation convergence branch, so neither can converge on a conflicting anchor.';

REVOKE ALL ON FUNCTION public.canvas_p1_assert_anchor_identity_v1(
    public.credit_transactions, uuid, text, integer, text, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_assert_anchor_identity_v1(
    public.credit_transactions, uuid, text, integer, text, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz
) TO service_role;

-- ###########################################################################
-- 1. SHARED ATOMIC PROFILE CREDIT DELTA + LEDGER BOUNDARY
--
-- The single writer of profiles.credits and of anchored credit_transactions
-- rows. Every debit, refund, zero-value usage and grant -- legacy or Canvas --
-- must enter here.
--
-- Idempotency is anchor-based and lock-ordered: the profile is locked BEFORE
-- the anchor is probed. Two concurrent callers with the same anchor therefore
-- serialize on the profile lock, and the loser observes the winner's committed
-- row and returns it unchanged instead of double-applying. Probing the anchor
-- before locking would be a real race; the order here is load-bearing.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_apply_credit_delta_v1(
    p_user_id            uuid,
    p_entry_kind         text,
    p_amount             integer,
    p_operation_anchor   text,
    p_generation_id      uuid        DEFAULT NULL,
    p_action_id          uuid        DEFAULT NULL,
    p_canvas_id          uuid        DEFAULT NULL,
    p_canvas_id_snapshot uuid        DEFAULT NULL,
    p_canvas_node_id     text        DEFAULT NULL,
    p_task_id            text        DEFAULT NULL,
    p_batch_id           uuid        DEFAULT NULL,
    p_pricing_version    text        DEFAULT NULL,
    p_quota_key          text        DEFAULT NULL,
    p_quota_window_start timestamptz DEFAULT NULL,
    p_description        text        DEFAULT NULL
)
RETURNS TABLE (
    ledger_id      uuid,
    balance_before integer,
    balance_after  integer,
    applied        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type      text;
    v_before    integer;
    v_after     integer;
    v_existing  public.credit_transactions%ROWTYPE;
    v_ledger_id uuid;
BEGIN
    --------------------------------------------------------------------------
    -- Structural validation. Nothing is trusted, including inputs the contract
    -- calls "trusted": those are only trusted to have come from a service-role
    -- path, never to be well-formed.
    --------------------------------------------------------------------------
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'canvas_p1_apply_credit_delta_v1: p_user_id is required';
    END IF;

    IF p_entry_kind IS NULL OR p_entry_kind NOT IN ('consume', 'refund', 'free_usage', 'grant') THEN
        RAISE EXCEPTION 'canvas_p1_apply_credit_delta_v1: invalid entry_kind %',
            COALESCE(p_entry_kind, '<null>');
    END IF;

    IF p_amount IS NULL THEN
        RAISE EXCEPTION 'canvas_p1_apply_credit_delta_v1: p_amount is required';
    END IF;

    IF p_operation_anchor IS NULL OR length(btrim(p_operation_anchor)) = 0 THEN
        RAISE EXCEPTION 'canvas_p1_apply_credit_delta_v1: a nonblank operation_anchor is required';
    END IF;

    -- Every non-grant entry is either a complete Canvas action identity or a
    -- complete task-scoped identity. Never accept a partial action snapshot.
    IF p_entry_kind <> 'grant' THEN
        IF p_generation_id IS NOT NULL
           AND p_action_id IS NOT NULL
           AND p_canvas_id_snapshot IS NOT NULL
           AND p_canvas_node_id IS NOT NULL
        THEN
            NULL;
        ELSIF p_generation_id IS NULL
              AND p_action_id IS NULL
              AND p_canvas_id_snapshot IS NULL
              AND p_canvas_node_id IS NULL
              AND p_task_id IS NOT NULL
              AND length(btrim(p_task_id)) > 0
        THEN
            NULL;
        ELSE
            RAISE EXCEPTION
                'canvas_p1_apply_credit_delta_v1: non-grant identity must be either '
                'a complete generation/action/canvas/node tuple or a nonblank task_id'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    --------------------------------------------------------------------------
    -- entry_kind -> (type, sign) mapping.
    --
    -- `type` is NOT free choice: the live VALIDATED constraint
    -- credit_transactions_type_check admits only
    -- purchase|usage|refund|bonus|admin_adjustment. In particular it does NOT
    -- admit 'consume', despite the frozen contract's claim that live history
    -- uses it. Canonical meaning therefore lives in entry_kind and `type`
    -- carries the only legal compatibility value. The same mapping is pinned
    -- by CHECK ct_entry_kind_type_amount_map, so a drift here fails closed at
    -- the constraint rather than writing a mislabelled row.
    --------------------------------------------------------------------------
    CASE p_entry_kind
        WHEN 'consume' THEN
            v_type := 'usage';
            IF p_amount >= 0 THEN
                RAISE EXCEPTION
                    'canvas_p1_apply_credit_delta_v1: consume requires a negative amount, got %', p_amount;
            END IF;
        WHEN 'free_usage' THEN
            v_type := 'usage';
            IF p_amount <> 0 THEN
                RAISE EXCEPTION
                    'canvas_p1_apply_credit_delta_v1: free_usage requires amount = 0, got %', p_amount;
            END IF;
        WHEN 'refund' THEN
            v_type := 'refund';
            IF p_amount <= 0 THEN
                RAISE EXCEPTION
                    'canvas_p1_apply_credit_delta_v1: refund requires a positive amount, got %', p_amount;
            END IF;
        WHEN 'grant' THEN
            v_type := 'bonus';
            IF p_amount <= 0 THEN
                RAISE EXCEPTION
                    'canvas_p1_apply_credit_delta_v1: grant requires a positive amount, got %', p_amount;
            END IF;
    END CASE;

    -- free_usage identifies its quota window; nothing else may claim one.
    IF p_entry_kind = 'free_usage' THEN
        IF p_quota_key IS NULL OR p_quota_window_start IS NULL THEN
            RAISE EXCEPTION
                'canvas_p1_apply_credit_delta_v1: free_usage requires quota_key and quota_window_start';
        END IF;
    ELSIF p_quota_key IS NOT NULL OR p_quota_window_start IS NOT NULL THEN
        RAISE EXCEPTION
            'canvas_p1_apply_credit_delta_v1: quota identity is only valid for free_usage (kind=%)', p_entry_kind;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 1 — lock the profile. Always first, always FOR NO KEY UPDATE.
    --------------------------------------------------------------------------
    SELECT p.credits
      INTO v_before
      FROM public.profiles p
     WHERE p.id = p_user_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_p1_apply_credit_delta_v1: profile % does not exist', p_user_id;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 2 — anchor idempotency, under the lock.
    --------------------------------------------------------------------------
    SELECT ct.* INTO v_existing
      FROM public.credit_transactions ct
     WHERE ct.user_id = p_user_id
       AND ct.operation_anchor = p_operation_anchor;

    IF FOUND THEN
        -- Same anchor, already applied: return the recorded values verbatim and
        -- mutate nothing -- but ONLY after the one comparator proves the stored
        -- row names the exact logical mutation the caller asked about. See
        -- canvas_p1_assert_anchor_identity_v1; it raises on any mismatch.
        PERFORM public.canvas_p1_assert_anchor_identity_v1(
            v_existing, p_user_id, p_entry_kind, p_amount, p_operation_anchor,
            p_generation_id, p_action_id, p_canvas_id_snapshot, p_canvas_node_id,
            p_task_id, p_batch_id, p_pricing_version, p_quota_key, p_quota_window_start
        );

        ledger_id      := v_existing.id;
        balance_before := v_existing.balance_before;
        balance_after  := v_existing.balance_after;
        applied        := false;
        RETURN NEXT;
        RETURN;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 3 — derive before/after from the LOCKED row, never from a parameter.
    --------------------------------------------------------------------------
    v_after := v_before + p_amount;

    IF v_after < 0 THEN
        RAISE EXCEPTION
            'canvas_p1_apply_credit_delta_v1: insufficient credits for user % (balance %, delta %)',
            p_user_id, v_before, p_amount
            USING ERRCODE = 'check_violation';
    END IF;

    --------------------------------------------------------------------------
    -- STEP 4 — mutate only the non-key credits column. Skipped when the delta
    -- is zero: free_usage must still take the lock and record the balance, but
    -- writing an identical value would only create a dead tuple.
    --------------------------------------------------------------------------
    IF p_amount <> 0 THEN
        UPDATE public.profiles
           SET credits = v_after
         WHERE id = p_user_id;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 5 — one ledger row, same transaction.
    --------------------------------------------------------------------------
    INSERT INTO public.credit_transactions (
        user_id, amount, type, description,
        balance_before, balance_after, created_at,
        entry_kind, generation_id, action_id, canvas_id, canvas_id_snapshot,
        canvas_node_id, task_id, batch_id, pricing_version, operation_anchor,
        quota_key, quota_window_start
    ) VALUES (
        p_user_id, p_amount, v_type, p_description,
        v_before, v_after, pg_catalog.clock_timestamp(),
        p_entry_kind, p_generation_id, p_action_id, p_canvas_id, p_canvas_id_snapshot,
        p_canvas_node_id, p_task_id, p_batch_id, p_pricing_version, p_operation_anchor,
        p_quota_key, p_quota_window_start
    )
    RETURNING id INTO v_ledger_id;

    ledger_id      := v_ledger_id;
    balance_before := v_before;
    balance_after  := v_after;
    applied        := true;
    RETURN NEXT;
    RETURN;

EXCEPTION
    -- Defence in depth. The profile lock should make this unreachable for a
    -- same-user anchor race; if it ever fires, converge on the winner rather
    -- than surfacing a spurious error to a paid path.
    --
    -- FAIL-CLOSED CONVERGENCE. The previous revision returned the anchored row
    -- from here WITHOUT repeating the identity comparison, so this branch --
    -- and only this branch -- could report success for a conflicting anchor.
    -- It now runs the SAME single comparator as the normal path, so a
    -- conflicting pre-existing anchor raises instead of being laundered into a
    -- success. Convergence is only ever granted to a proven-identical mutation.
    --
    -- A unique_violation raised by any OTHER index (the per-generation consume/
    -- free_usage anchor, the per-generation refund anchor, or the quota-usage
    -- anchor) has no matching (user, anchor) row, so it rethrows unchanged --
    -- those are genuine conflicts, not lost responses.
    WHEN unique_violation THEN
        SELECT ct.* INTO v_existing
          FROM public.credit_transactions ct
         WHERE ct.user_id = p_user_id
           AND ct.operation_anchor = p_operation_anchor;

        IF NOT FOUND THEN
            RAISE;
        END IF;

        PERFORM public.canvas_p1_assert_anchor_identity_v1(
            v_existing, p_user_id, p_entry_kind, p_amount, p_operation_anchor,
            p_generation_id, p_action_id, p_canvas_id_snapshot, p_canvas_node_id,
            p_task_id, p_batch_id, p_pricing_version, p_quota_key, p_quota_window_start
        );

        ledger_id      := v_existing.id;
        balance_before := v_existing.balance_before;
        balance_after  := v_existing.balance_after;
        applied        := false;
        RETURN NEXT;
        RETURN;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_apply_credit_delta_v1 IS
    'The single atomic profile-credit + ledger boundary. Locks the profile FOR NO KEY UPDATE, derives before/after from the locked row, enforces a nonnegative result, and deduplicates on a stable server-derived operation anchor.';

REVOKE ALL ON FUNCTION public.canvas_p1_apply_credit_delta_v1(
    uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_apply_credit_delta_v1(
    uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz, text
) TO service_role;

-- ###########################################################################
-- 2. VERIFIED-AUTH-EVENT-ONLY ACCOUNT INITIALIZATION + FIXED SIGNUP GRANT
--
-- SIGNUP ENTITLEMENT CONSTANT — PROVEN, NOT INVENTED
-- ---------------------------------------------------------------------------
-- 100 credits. Source of truth, in order of authority:
--   * supabase/migrations/002_complete_setup.sql:478-497 -- the live
--     handle_new_user() trigger body inserts credits = 100 with role 'user'
--     ("新用户赠送 100 积分") on AFTER INSERT ON auth.users.
--   * supabase/migrations/002_complete_setup.sql:27 -- profiles.credits
--     DEFAULT 100, which the measured live catalog confirms verbatim.
--   * src/app/api/sms/verify/route.ts:101 -- credits: 100 ("新用户赠送积分").
--   * src/app/auth/register/page.tsx:84 -- credits: 100.
--   * Published entitlement copy (help page, pricing data): "注册送 100 积分" /
--     "Get 100 free credits when you sign up".
-- All five agree. The constant is therefore product-proven and is NOT a value
-- chosen by this migration.
--
-- WHAT CHANGES, HONESTLY
-- ---------------------------------------------------------------------------
-- Today the 100 credits arrive as a column DEFAULT / literal INSERT and leave
-- NO ledger row. After this function, a new account is created at credits = 0
-- and the same 100 arrives as one anchored 'grant' ledger row. The end balance
-- is identical; the difference is that the entitlement becomes auditable and
-- idempotent. Historical accounts are untouched and keep their null-anchor
-- (in fact, absent) grant history.
--
-- BINDING TO A VERIFIED AUTH EVENT
-- ---------------------------------------------------------------------------
-- The only accepted proof is the existence of the auth.users row itself. A
-- caller cannot initialize a profile for an identity that Auth has not created.
-- Combined with service_role-only EXECUTE, a browser cannot reach this at all.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_initialize_account_v1(
    p_user_id uuid,
    p_email   text DEFAULT NULL,
    p_name    text DEFAULT NULL
)
RETURNS TABLE (
    user_id     uuid,
    credits     integer,
    role        text,
    initialized boolean,
    granted     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- Proven existing product entitlement. See the header block above.
    c_signup_grant_amount constant integer := 100;
    c_grant_pricing_ver   constant text    := 'signup-grant-v1';

    v_auth_email  text;
    v_email       text;
    v_name        text;
    v_profile     public.profiles%ROWTYPE;
    v_initialized boolean := false;
    v_anchor      text;
    v_applied     boolean;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'canvas_p1_initialize_account_v1: p_user_id is required';
    END IF;

    --------------------------------------------------------------------------
    -- STEP 0 — verified auth event. No auth.users row => no initialization.
    --------------------------------------------------------------------------
    SELECT u.email INTO v_auth_email
      FROM auth.users u
     WHERE u.id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'canvas_p1_initialize_account_v1: no auth.users row for %; refusing to initialize '
            'a profile that does not correspond to a verified auth-user creation event', p_user_id;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 1 — create at ZERO credits and the fixed nonprivileged role.
    -- The explicit credits = 0 deliberately overrides the live DEFAULT 100:
    -- the entitlement must arrive as an auditable anchored grant, not as a
    -- silent column default.
    --------------------------------------------------------------------------
    v_email := COALESCE(p_email, v_auth_email);
    IF v_email IS NULL OR length(btrim(v_email)) = 0 THEN
        RAISE EXCEPTION 'canvas_p1_initialize_account_v1: no email available for %', p_user_id;
    END IF;

    v_name := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), split_part(v_email, '@', 1));

    INSERT INTO public.profiles (id, email, name, role, credits)
    VALUES (p_user_id, v_email, v_name, 'user'::public.user_role, 0)
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN
        v_initialized := true;
    END IF;

    --------------------------------------------------------------------------
    -- STEP 2 — exactly one fixed anchored signup grant, through the shared
    -- boundary. The anchor is server-derived and stable, so duplicate
    -- trigger / register / SMS delivery converges on the same single row.
    -- The shared function locks the profile, so concurrent duplicate
    -- initialization serializes there.
    --------------------------------------------------------------------------
    v_anchor := 'signup-grant:' || p_user_id::text;

    SELECT d.applied
      INTO v_applied
      FROM public.canvas_p1_apply_credit_delta_v1(
          p_user_id          => p_user_id,
          p_entry_kind       => 'grant',
          p_amount           => c_signup_grant_amount,
          p_operation_anchor => v_anchor,
          p_pricing_version  => c_grant_pricing_ver,
          p_description      => 'Signup entitlement'
      ) AS d;

    SELECT pr.* INTO v_profile FROM public.profiles pr WHERE pr.id = p_user_id;

    user_id     := v_profile.id;
    credits     := v_profile.credits;
    role        := v_profile.role::text;
    initialized := v_initialized;
    granted     := COALESCE(v_applied, false);
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_initialize_account_v1 IS
    'Server-only, auth-event-bound, idempotent profile initialization at credits=0/role=user plus exactly one anchored signup grant of the proven 100-credit entitlement (see 002_complete_setup.sql handle_new_user).';

REVOKE ALL ON FUNCTION public.canvas_p1_initialize_account_v1(uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_initialize_account_v1(uuid, text, text)
    TO service_role;

-- ###########################################################################
-- 2b. CONVERT THE LIVE AUTH TRIGGER PATH  (release-critical)
--
-- THE BUG THIS FIXES
-- ---------------------------------------------------------------------------
-- 002_complete_setup.sql:478-497 defines handle_new_user() and normally attaches
-- it to auth.users by trigger on_auth_user_created. Its body inserts the profile
-- with a LITERAL 100 credits. Left alone, a real signup would:
--     1. fire the legacy trigger        -> profile created at 100
--     2. reach canvas_p1_initialize_account_v1 -> INSERT no-ops (row exists),
--        then the anchored grant adds another 100
--     => 200 credits. A double grant on every new account.
-- The initializer would also no longer be the sole initialization path.
--
-- THE CONVERSION
-- ---------------------------------------------------------------------------
-- Preview Branch evidence on 2026-07-27 proved that Branching reconstructed the
-- function but omitted every non-internal auth.users trigger. Therefore this
-- migration both replaces the FUNCTION BODY and deterministically repairs the
-- one expected trigger. It first refuses any differently named competing trigger
-- and proves the migration role has TRIGGER privilege; the enclosing atomic
-- migration transaction rolls everything back if either precondition fails.
-- One auth.users insert therefore reaches exactly one zero-credit init plus
-- exactly one anchored 100 grant, with no legacy literal/default grant first.
--
-- The entitlement (100) and the nonprivileged role ('user') are unchanged: they
-- are carried by canvas_p1_initialize_account_v1, sourced from this very file.
--
-- It also closes a real security defect in the legacy function: it was
-- SECURITY DEFINER with NO pinned search_path and unqualified object references
-- -- exactly the class the catalog evidence flagged in 5 of 14 public routines.
--
-- OWNER EXECUTE NOTE: the initializer is revoked from PUBLIC/anon/authenticated
-- but NOT from its owner. handle_new_user() is SECURITY DEFINER owned by the
-- same role, so it retains the implicit owner EXECUTE and the call succeeds.
-- ###########################################################################
DO $$
DECLARE
    v_competing_triggers text;
BEGIN
    IF to_regclass('auth.users') IS NULL THEN
        RAISE EXCEPTION
            'canvas-p1: auth.users does not exist; cannot repair the signup trigger';
    END IF;

    IF NOT has_table_privilege(current_user, 'auth.users', 'TRIGGER') THEN
        RAISE EXCEPTION
            'canvas-p1: migration role lacks TRIGGER privilege on auth.users; refusing a '
            'partial signup conversion';
    END IF;

    SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
      INTO v_competing_triggers
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'auth.users'::regclass
       AND NOT t.tgisinternal
       AND t.tgname <> 'on_auth_user_created';

    IF v_competing_triggers IS NOT NULL THEN
        RAISE EXCEPTION
            'canvas-p1: unexpected competing auth.users trigger(s): %. Refusing to create '
            'a second account-initialization path',
            v_competing_triggers;
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Single path. No literal credit value lives here any more.
    PERFORM public.canvas_p1_initialize_account_v1(
        p_user_id => NEW.id,
        p_email   => NEW.email,
        p_name    => NEW.raw_user_meta_data ->> 'name'
    );
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
    'Converted auth-event path: delegates entirely to canvas_p1_initialize_account_v1 (zero-credit profile + exactly one anchored signup grant). Replaces the legacy body that inserted a literal 100 credits with no ledger row.';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Fail closed on the conversion: prove the live trigger really is attached to
-- the function we just replaced, and that no legacy literal grant survives.
DO $$
DECLARE
    v_src text;
BEGIN
    IF to_regclass('auth.users') IS NULL THEN
        RAISE EXCEPTION
            'canvas-p1: auth.users does not exist; cannot verify the signup conversion';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass
          AND NOT t.tgisinternal
          AND t.tgname = 'on_auth_user_created'
          AND t.tgfoid = 'public.handle_new_user()'::regprocedure
          AND t.tgenabled = 'O'
          AND (t.tgtype & 1) = 1
          AND (t.tgtype & 2) = 0
          AND (t.tgtype & 4) = 4
          AND (t.tgtype & 8) = 0
          AND (t.tgtype & 16) = 0
          AND (t.tgtype & 32) = 0
    ) THEN
        RAISE EXCEPTION
            'canvas-p1: the exact AFTER INSERT FOR EACH ROW on_auth_user_created trigger '
            'bound to public.handle_new_user() was not created';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass
          AND NOT t.tgisinternal
    ) <> 1 THEN
        RAISE EXCEPTION
            'canvas-p1: auth.users has more than the one reviewed signup trigger after repair';
    END IF;

    -- The converted body must delegate, and must not carry its own credit literal.
    SELECT p.prosrc INTO v_src
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.handle_new_user()'::regprocedure;

    IF v_src NOT LIKE '%canvas_p1_initialize_account_v1%' THEN
        RAISE EXCEPTION
            'canvas-p1: handle_new_user() does not delegate to canvas_p1_initialize_account_v1';
    END IF;

    IF v_src ~ 'INSERT\s+INTO\s+public\.profiles' THEN
        RAISE EXCEPTION
            'canvas-p1: handle_new_user() still inserts a profile directly; the legacy literal '
            'grant path would double-grant on top of the anchored signup grant';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = 'public.handle_new_user()'::regprocedure
          AND p.prosecdef
          AND p.proconfig IS NOT NULL
          AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%')
    ) THEN
        RAISE EXCEPTION
            'canvas-p1: handle_new_user() is not SECURITY DEFINER with a pinned search_path';
    END IF;

    -- No client may call the auth initializer surface directly.
    IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
       OR has_function_privilege('public', 'public.handle_new_user()', 'EXECUTE') THEN
        RAISE EXCEPTION
            'canvas-p1: a client role may EXECUTE handle_new_user(); the hostile pg_default_acl '
            'grant was not revoked';
    END IF;

    RAISE NOTICE 'canvas-p1: live auth trigger converted to the anchored signup grant path';
END
$$;

-- ###########################################################################
-- 3. AUDIT-PRESERVING ACCOUNT DEACTIVATION / ANONYMIZATION
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- The measured FK credit_transactions_user_id_fkey is ON DELETE CASCADE from
-- profiles. Any hard delete of a profile therefore tries to delete that user's
-- ledger. The append-only trigger now refuses that for anchored rows, so hard
-- deletion of an account with Canvas billing history simply FAILS. That is the
-- contractually correct outcome, but it leaves the product with no way to
-- honour a removal request -- hence this reviewed replacement.
--
-- It anonymizes PII in place and retains: every ledger row, every operation
-- anchor, every immutable canvas/generation snapshot, and every required FK.
-- It never frees an anchor, so no logical mutation can be replayed afterwards.
-- ###########################################################################
CREATE OR REPLACE FUNCTION public.canvas_p1_deactivate_account_v1(
    p_user_id uuid,
    p_reason  text DEFAULT NULL
)
RETURNS TABLE (
    user_id            uuid,
    status             text,
    anonymized         boolean,
    retained_ledger_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile    public.profiles%ROWTYPE;
    v_anon_email text;
    v_rows       bigint;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'canvas_p1_deactivate_account_v1: p_user_id is required';
    END IF;

    -- Same profile lock as every other credit-adjacent mutation, so a
    -- deactivation cannot interleave with an in-flight debit/refund.
    SELECT p.* INTO v_profile
      FROM public.profiles p
     WHERE p.id = p_user_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'canvas_p1_deactivate_account_v1: profile % does not exist', p_user_id;
    END IF;

    -- Deterministic, unique, non-routable. profiles.email is UNIQUE NOT NULL,
    -- so it cannot simply be nulled.
    v_anon_email := 'deactivated+' || p_user_id::text || '@deactivated.invalid';

    IF v_profile.status = 'banned' AND v_profile.email = v_anon_email THEN
        -- Already deactivated: idempotent no-op.
        SELECT count(*) INTO v_rows
          FROM public.credit_transactions ct WHERE ct.user_id = p_user_id;

        user_id              := p_user_id;
        status               := v_profile.status;
        anonymized           := false;
        retained_ledger_rows := v_rows;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Anonymize PII only. credits is deliberately NOT zeroed: doing so outside
    -- the shared boundary would break ledger/balance continuity. If forfeiture
    -- is ever a product requirement it must be a reviewed anchored 'consume'
    -- through canvas_p1_apply_credit_delta_v1, not a silent balance write.
    UPDATE public.profiles
       SET email         = v_anon_email,
           name          = NULL,
           phone         = NULL,
           avatar_url    = NULL,
           role          = 'user'::public.user_role,
           status        = 'banned',
           banned_at     = pg_catalog.now(),
           banned_reason = COALESCE(p_reason, 'account deactivated')
     WHERE id = p_user_id;

    SELECT count(*) INTO v_rows
      FROM public.credit_transactions ct WHERE ct.user_id = p_user_id;

    user_id              := p_user_id;
    status               := 'banned';
    anonymized           := true;
    retained_ledger_rows := v_rows;
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.canvas_p1_deactivate_account_v1 IS
    'Audit-preserving replacement for hard account deletion. Anonymizes PII in place; retains every anchored ledger row, snapshot and FK so no operation anchor is ever freed for replay.';

REVOKE ALL ON FUNCTION public.canvas_p1_deactivate_account_v1(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_p1_deactivate_account_v1(uuid, text)
    TO service_role;

-- ###########################################################################
-- 4. POSTCONDITION — prove the function ACLs, because pg_default_acl fights us
-- ###########################################################################
DO $$
DECLARE
    v_fn   text;
    v_role text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.canvas_p1_assert_anchor_identity_v1(public.credit_transactions, uuid, text, integer, text, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz)',
        'public.canvas_p1_apply_credit_delta_v1(uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz, text)',
        'public.canvas_p1_initialize_account_v1(uuid, text, text)',
        'public.canvas_p1_deactivate_account_v1(uuid, text)'
    ]
    LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public']
        LOOP
            IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
                RAISE EXCEPTION
                    'canvas-p1 postcondition FAILED: % may EXECUTE % (pg_default_acl grant not revoked)',
                    v_role, v_fn;
            END IF;
        END LOOP;

        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: service_role cannot EXECUTE %', v_fn;
        END IF;

        -- SECURITY DEFINER without a pinned search_path is the exact defect the
        -- catalog evidence found in 5 of 14 existing public routines.
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid = v_fn::regprocedure
              AND p.prosecdef
              AND p.proconfig IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM unnest(p.proconfig) AS cfg
                  WHERE cfg LIKE 'search_path=%'
              )
        ) THEN
            RAISE EXCEPTION
                'canvas-p1 postcondition FAILED: % is not SECURITY DEFINER with a pinned search_path', v_fn;
        END IF;
    END LOOP;

    RAISE NOTICE 'canvas-p1 credit boundary postconditions OK';
END
$$;
