-- ============================================================================
-- RELEASE PREREQUISITE · generations RLS policy correction
--
-- WHY THIS FILE WAS REWRITTEN
-- ---------------------------------------------------------------------------
-- The original revision of this file was a proven no-op against the real
-- database. It opened with:
--
--     DROP POLICY IF EXISTS "Service can manage all generations" ON public.generations;
--
-- and its header asserted "The policy created by 006 had no TO clause".
-- Both statements rest on a false premise. Read-only catalog evidence
-- (2026-07-15 production preflight, re-verified 2026-07-16 on the isolated
-- Preview Branch) measures exactly ONE policy on public.generations:
--
--     name       = allow_all
--     permissive = PERMISSIVE
--     command    = ALL
--     roles      = (none)  => PUBLIC
--     USING      = true
--     WITH CHECK = (none)
--
-- The name "Service can manage all generations" does not exist live, so the
-- DROP matched nothing. The file then ADDED a second permissive policy scoped
-- TO service_role. Permissive policies are OR-ed together, so `allow_all`
-- would have survived untouched and anonymous visibility of all 30,839 rows
-- would have remained. Applying the original file would have produced a green
-- migration and left the release blocker fully intact.
--
-- This revision therefore drops the policy by its MEASURED name, and does not
-- trust any name asserted by migration-file archaeology. Production
-- `generations` was demonstrably not created by 006/001/002 (it has neither
-- model_id nor contract_id, its NOT NULLs/CHECKs/indexes/FK actions all
-- disagree with those files), so file-derived names are not evidence.
--
-- SCOPE
-- ---------------------------------------------------------------------------
-- This is the release-blocking prerequisite only. It changes policies, not
-- grants. anon retains table-level privileges from the public-schema default
-- ACL, but with RLS enabled and no PUBLIC/anon policy remaining, anon reads
-- return zero rows. Grant revocation and the owner-safe column projection are
-- the job of the additive lifecycle migration that follows this file.
--
-- OWNER READS ARE DELIBERATELY PRESERVED
-- ---------------------------------------------------------------------------
-- The frozen contract's release gate requires that after this migration
-- "anonymous sees zero generation rows; owners see only their safe status
-- projection; workers retain service-role access". Dropping `allow_all` with
-- no replacement would also revoke every authenticated owner read, which the
-- gate explicitly requires to keep passing. An owner-scoped SELECT policy is
-- therefore created here. It is row-scoped (auth.uid() = user_id), not a
-- catch-all. Column-level narrowing of what an owner may read happens in the
-- lifecycle migration, before any sensitive lifecycle column exists.
--
-- SERVICE ROLE NOTE (honest boundary)
-- ---------------------------------------------------------------------------
-- Measured evidence shows service_role holds BYPASSRLS. RLS policies are not
-- consulted for that role at all, so the service_role policy below is
-- defence-in-depth for a future in which BYPASSRLS is removed; it is NOT the
-- mechanism that grants workers access today, and it must never be cited as
-- proof that worker access is policy-gated. It is also why the append-only
-- ledger guard in the lifecycle migration is a TRIGGER and not an RLS policy.
--
-- IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- Safe to apply repeatedly. Every DROP is IF EXISTS; every CREATE is guarded
-- by a catalog existence check; the dynamic sweep is a no-op once clean. The
-- postcondition block re-proves the invariant on every run, so a second apply
-- either changes nothing or fails closed on drift.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Preconditions — fail closed rather than silently "fixing" an unknown shape.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.generations') IS NULL THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite: public.generations does not exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'generations'
          AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite: RLS is not enabled on public.generations; '
            'dropping the permissive policy would not restrict anonymous access';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Drop the measured live catch-all by its real name, plus the fictional
--    name the original file targeted (kept so this file stays idempotent for
--    any environment where the earlier revision was already applied).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "allow_all" ON public.generations;
DROP POLICY IF EXISTS "Service can manage all generations" ON public.generations;

-- ---------------------------------------------------------------------------
-- 2. Sweep any remaining policy on public.generations that is reachable by
--    PUBLIC or anon. Evidence says none remain after step 1; this is the
--    fail-closed backstop that makes the postcondition achievable rather than
--    assumed. polroles = '{0}' encodes PUBLIC.
--
--    Deliberately dynamic: policy names are data, not code. Names are quoted
--    with %I (format's identifier escape), so a hostile policy name cannot
--    break out of the statement.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.polname
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'generations'
          AND (
                p.polroles = '{0}'::oid[]
                OR EXISTS (
                    SELECT 1
                    FROM unnest(p.polroles) AS role_oid
                    WHERE role_oid = 0
                       OR pg_catalog.pg_get_userbyid(role_oid) IN ('anon', 'public')
                )
              )
    LOOP
        RAISE NOTICE
            'canvas-p1 policy prerequisite: dropping PUBLIC/anon-reachable policy %',
            r.polname;
        EXECUTE format(
            'DROP POLICY %I ON public.generations',
            r.polname
        );
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Owner-scoped SELECT. Required by the release gate so authenticated owner
--    reads keep passing. Row-scoped, SELECT-only, and never a catch-all.
--    Owners get no INSERT/UPDATE/DELETE policy here: all generation mutation
--    is server-side only.
--
--    DETERMINISTIC RECREATE, not a name-only existence guard.
--
--    The previous revision created this policy only `IF NOT EXISTS` by NAME. A
--    same-name policy is not the same policy: an impostor
--    `generations_select_own` created FOR ALL, TO public, or with USING (true)
--    would have satisfied the name check exactly, been left in place, and
--    reopened the very anonymous-visibility blocker this file exists to close.
--    Dropping first makes the accepted command/roles/USING true by
--    construction on every apply, so same-name drift cannot survive a re-apply.
--    Section 5 then re-proves it from the catalog rather than assuming it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "generations_select_own" ON public.generations;
CREATE POLICY "generations_select_own"
    ON public.generations
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Explicit service_role worker access. Redundant while service_role holds
--    BYPASSRLS (see header); retained as defence-in-depth only.
--    Deterministic recreate for the same reason as section 3.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "generations_service_role_all" ON public.generations;
CREATE POLICY "generations_service_role_all"
    ON public.generations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. Executable postcondition. This is the part the original file lacked: it
--    proves the blocker is actually gone instead of assuming the DROP matched.
--    Runs on every apply, so a re-apply re-proves the invariant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_public_policies integer;
    v_catch_all       integer;
    v_owner_select    integer;
    v_service_all     integer;
    v_total           integer;
    v_actual          text;
BEGIN
    SELECT count(*)
      INTO v_public_policies
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'generations'
       AND (
             p.polroles = '{0}'::oid[]
             OR EXISTS (
                 SELECT 1
                 FROM unnest(p.polroles) AS role_oid
                 WHERE role_oid = 0
                    OR pg_catalog.pg_get_userbyid(role_oid) IN ('anon', 'public')
             )
           );

    IF v_public_policies <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite FAILED: % PUBLIC/anon-reachable policy(ies) '
            'still present on public.generations; anonymous visibility is not closed',
            v_public_policies;
    END IF;

    -- No permissive catch-all may survive for ANY role: a policy whose USING is
    -- literal true and whose command is ALL is exactly the shape that caused
    -- this blocker. service_role's own policy is the one allowed exception.
    SELECT count(*)
      INTO v_catch_all
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'generations'
       AND p.polpermissive
       AND p.polcmd = '*'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
       AND p.polname <> 'generations_service_role_all';

    IF v_catch_all <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite FAILED: % permissive catch-all policy(ies) '
            'remain on public.generations', v_catch_all;
    END IF;

    -- EXACT definition, not name-only presence. Each of command / permissive /
    -- roles / USING / WITH CHECK is compared, because a same-name policy that
    -- differs in ANY of them is a different security decision. `polroles` is
    -- compared against the resolved role OID so a policy retargeted at another
    -- role cannot pass, and USING is compared as deparsed text against the
    -- exact accepted expression.
    SELECT count(*)
      INTO v_owner_select
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'generations'
       AND p.polname = 'generations_select_own'
       AND p.polcmd = 'r'                                        -- SELECT only
       AND p.polpermissive                                       -- PERMISSIVE
       AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')]::oid[]
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(auth.uid() = user_id)'
       AND p.polwithcheck IS NULL;                               -- SELECT has no WITH CHECK

    IF v_owner_select <> 1 THEN
        -- Emit the ACTUAL shape. This block is reached either because a
        -- same-name impostor survived (the real defect being guarded) or
        -- because pg_get_expr deparsed the accepted expression differently
        -- than expected under this server's search_path -- exactly the
        -- parenthesisation/qualification class that broke the Batch 1B fixture
        -- at 113/115. The two are indistinguishable from a count, so report the
        -- observed values and let a reviewer tell them apart instead of
        -- guessing from a bare "FAILED".
        SELECT p.polcmd || '|' || p.polpermissive::text || '|'
               || COALESCE(pg_catalog.array_to_string(ARRAY(
                      SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.oid = ANY (p.polroles)
                      ORDER BY r.rolname), ','), '<public>')
               || '|' || COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '<null>')
               || '|' || COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '<null>')
          INTO v_actual
          FROM pg_catalog.pg_policy p
          JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'generations'
           AND p.polname = 'generations_select_own';

        RAISE EXCEPTION
            'canvas-p1 policy prerequisite FAILED: generations_select_own is missing or is not the '
            'exact accepted policy. Expected cmd|permissive|roles|using|withcheck = '
            'r|true|authenticated|(auth.uid() = user_id)|<null>; observed %. '
            'A same-name policy with a different command/role/expression is a different security '
            'decision and is not accepted', COALESCE(v_actual, '<policy absent>');
    END IF;

    -- The service_role policy is likewise pinned exactly. It is the ONE policy
    -- section 2 above allows to be a permissive catch-all, so its scope must be
    -- proven rather than assumed: if it were retargeted at another role, the
    -- catch-all exemption would silently cover that role too.
    SELECT count(*)
      INTO v_service_all
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'generations'
       AND p.polname = 'generations_service_role_all'
       AND p.polcmd = '*'                                        -- ALL
       AND p.polpermissive
       AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')]::oid[]
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true';

    IF v_service_all <> 1 THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite FAILED: generations_service_role_all is missing or is not '
            'the exact accepted policy (PERMISSIVE ALL TO service_role USING true WITH CHECK true). '
            'The catch-all exemption in the check above is scoped to this exact policy, so a drifted '
            'definition must not be accepted';
    END IF;

    -- Exactly two policies may exist on generations after this file. Any third
    -- policy -- whatever its name or role -- is unreviewed and must be seen.
    SELECT count(*)
      INTO v_total
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'generations';

    IF v_total <> 2 THEN
        RAISE EXCEPTION
            'canvas-p1 policy prerequisite FAILED: public.generations carries % policies; exactly the '
            'two reviewed policies (generations_select_own, generations_service_role_all) are '
            'expected. An unreviewed policy must not survive this prerequisite', v_total;
    END IF;

    RAISE NOTICE
        'canvas-p1 policy prerequisite OK: no PUBLIC/anon policy, no catch-all, '
        'exact owner SELECT and service_role policies present, no unreviewed policy';
END
$$;
