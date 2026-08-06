-- ============================================================================
-- Canvas P1 · Batch 2 · complete redacted catalog surface (read-only, one JSON)
--
-- WHY THIS FILE EXISTS SEPARATELY FROM sql/catalog-introspect.sql
-- ---------------------------------------------------------------------------
-- The Batch 1B introspection is accepted and hash-locked at
-- 662E75B4B436F9BDDFA4FCE132E42394E285407066849114AF35484972141D39; it backs the
-- accepted 115-assertion fixture verifier and must not be disturbed. It also
-- covers only the FOUR baseline tables and only ten sections, which is less than
-- the pre/post/reapply proof the Batch 2 write gate requires. This file is the
-- Batch-2-owned superset and does not modify or replace it.
--
-- IT MUST STAY EXACTLY ONE READ-ONLY STATEMENT
-- ---------------------------------------------------------------------------
-- The gate runs it through the closed read-only probe channel, inside an
-- explicit BEGIN TRANSACTION READ ONLY with default_transaction_read_only=on.
-- PostgreSQL would refuse a write here even if one were introduced, but this
-- file must not rely on that: it is a single WITH ... SELECT, it reads only
-- catalogs, and it reads no application row.
--
-- REDACTION RULES (non-negotiable — this output crosses into evidence)
-- ---------------------------------------------------------------------------
-- * NO routine bodies. `prosrc` and pg_get_functiondef are never selected.
--   Security posture is carried by prosecdef / proconfig / provolatile, which
--   are the fields the contract actually needs, and which are not sensitive.
-- * NO role membership graph.
-- * NO policy expression TEXT for baseline policies -- only the shape flags
--   (has_using / has_check / using_is_literal_true), exactly as the accepted
--   Batch 1B introspection does, so those ten sections stay directly
--   comparable with the independently verified expected-catalog.json rows.
-- * NO application data of any kind.
--
-- EMPTY-ACL FIDELITY (Codex F2 disposition, a hard Stage-2 constraint)
-- ---------------------------------------------------------------------------
-- The Batch 1B introspection uses `CROSS JOIN LATERAL aclexplode(...)`, which
-- silently DROPS the entire row when an ACL is NULL or an explicitly empty
-- aclitem[]. That was accepted only for the measured nonempty Stage-1 ACLs, and
-- explicitly must not be reused to prove ZERO grants -- which is precisely what
-- Batch 2 must prove for generation_quota_buckets and the lifecycle routines.
-- A flat expansion cannot distinguish "no grants" from "row absent", so a
-- zero-grant assertion over it is vacuous.
--
-- Every ACL section below therefore emits ONE object per catalog row with an
-- explicit `acl_is_null` / `acl_is_empty` state and a NESTED grants array, so an
-- empty target survives as evidence instead of disappearing.
-- ============================================================================

WITH
-- The four baseline tables, plus the table Batch 2 creates. Listed explicitly so
-- an absent target is reported rather than inferred from a short array.
targets(name) AS (
    VALUES ('canvases'), ('credit_transactions'), ('generations'), ('profiles')
),
expected_all(name) AS (
    SELECT name FROM targets
    UNION ALL
    SELECT 'generation_quota_buckets'
),
target_rel AS (
    SELECT c.oid, c.relname, c.relkind, c.relacl, c.relowner,
           c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (SELECT name FROM targets)
),
-- The quota table is deliberately NOT in target_rel: including it would change
-- the ten baseline sections' contents after apply and break their direct
-- comparability with the accepted expected-catalog.json rows. It gets its own
-- dedicated section instead.
quota_rel AS (
    SELECT c.oid, c.relname, c.relacl, c.relowner,
           c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'generation_quota_buckets'
),

-- ---------------------------------------------------------------------------
-- target existence / relkind. A missing table must never look like an empty
-- evidence section.
-- ---------------------------------------------------------------------------
target_expect AS (
    SELECT coalesce(json_agg(json_build_object(
               'name', e.name,
               'present', c.oid IS NOT NULL,
               'relkind', coalesce(c.relkind::text, '<absent>')
           ) ORDER BY e.name), '[]'::json) AS j
    FROM expected_all e
    LEFT JOIN pg_class c
      ON c.relname = e.name
     AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
),

-- ---------------------------------------------------------------------------
-- The ten baseline sections. Shapes are IDENTICAL to the accepted Batch 1B
-- introspection, so the independently verified expected-catalog.json rows can
-- be reused verbatim in the frozen manifest rather than re-derived.
-- ---------------------------------------------------------------------------
cols AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'ordinal', a.attnum,
               'name', a.attname,
               'type', format_type(a.atttypid, a.atttypmod),
               'not_null', a.attnotnull,
               'default', pg_get_expr(d.adbin, d.adrelid)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
),
cons AS (
    -- pg_get_constraintdef(oid, TRUE): the two-argument pretty form. The
    -- one-argument form is what broke the Batch 1B fixture at 113/115, because
    -- the production preflight used pretty=true and the fixture did not. Both
    -- sides must deparse identically or the comparison fails for a reason that
    -- has nothing to do with the schema.
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', ct.conname,
               'type', ct.contype::text,
               'validated', ct.convalidated,
               'definition', pg_catalog.pg_get_constraintdef(ct.oid, true)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_constraint ct ON ct.conrelid = r.oid
),
idx AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', ic.relname,
               'unique', ix.indisunique,
               'primary', ix.indisprimary,
               'definition', pg_get_indexdef(ix.indexrelid)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_index ix ON ix.indrelid = r.oid
    JOIN pg_class ic ON ic.oid = ix.indexrelid
),
rels AS (
    SELECT coalesce(json_agg(json_build_object(
               'name', relname,
               'kind', relkind::text,
               'owner', owner,
               'rls_enabled', relrowsecurity,
               'rls_forced', relforcerowsecurity
           )), '[]'::json) AS j
    FROM target_rel
),
pol AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', p.polname,
               'command', p.polcmd::text,
               'permissive', p.polpermissive,
               'roles', CASE
                   WHEN p.polroles = '{0}'::oid[] THEN json_build_array('PUBLIC')
                   ELSE (SELECT json_agg(pg_get_userbyid(u) ORDER BY u) FROM unnest(p.polroles) AS u)
               END,
               'has_using', pg_get_expr(p.polqual, p.polrelid) IS NOT NULL,
               'has_check', pg_get_expr(p.polwithcheck, p.polrelid) IS NOT NULL,
               'using_is_literal_true',
                   coalesce(btrim(pg_get_expr(p.polqual, p.polrelid)) = 'true', false)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_policy p ON p.polrelid = r.oid
),
acl AS (
    -- Flat, matching the accepted Batch 1B shape. Safe HERE and only here: the
    -- four baseline tables have measured NONEMPTY ACLs (128 rows), and
    -- target_expectations independently proves each table is present, so a
    -- vanished row cannot masquerade as "no grants".
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
               'privilege', a.privilege_type
           )), '[]'::json) AS j
    FROM target_rel r
    CROSS JOIN LATERAL aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) AS a
),
col_acl AS (
    -- NESTED, with explicit empty state. Column ACLs are measured as ZERO rows
    -- on both production and the Preview Branch, and this migration GRANTs
    -- column-level SELECT/UPDATE -- so this section goes from empty to
    -- populated and is exactly the kind of zero-evidence a flat expansion
    -- would render vacuous.
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'column', a.attname,
               'acl_is_null', a.attacl IS NULL,
               'acl_is_empty', a.attacl IS NOT NULL AND cardinality(a.attacl) = 0,
               'grants', coalesce((
                   SELECT json_agg(json_build_object(
                              'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                              ELSE pg_get_userbyid(x.grantee) END,
                              'privilege', x.privilege_type
                          ) ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                          ELSE pg_get_userbyid(x.grantee) END, x.privilege_type)
                   FROM aclexplode(a.attacl) AS x
               ), '[]'::json)
           ) ORDER BY r.relname, a.attname), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.attacl IS NOT NULL
),
dacl AS (
    -- Flat, matching the accepted Batch 1B shape, for the same reason as `acl`:
    -- the six measured pg_default_acl rows all carry grants.
    SELECT coalesce(json_agg(json_build_object(
               'owner', pg_get_userbyid(d.defaclrole),
               'schema', n.nspname,
               'object_type', d.defaclobjtype::text,
               'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
               'privilege', a.privilege_type
           )), '[]'::json) AS j
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
    WHERE pg_get_userbyid(d.defaclrole) = current_user
      AND (d.defaclnamespace = 0 OR n.nspname = 'public')
),
infk AS (
    SELECT coalesce(json_agg(json_build_object(
               'source_table', sc.relname,
               'target_table', tr.relname,
               'name', ct.conname,
               'definition', pg_catalog.pg_get_constraintdef(ct.oid, true)
           )), '[]'::json) AS j
    FROM target_rel tr
    JOIN pg_constraint ct ON ct.confrelid = tr.oid AND ct.contype = 'f'
    JOIN pg_class sc ON sc.oid = ct.conrelid
),
profile_keys AS (
    SELECT coalesce(json_agg(json_build_object(
               'column', a.attname,
               'primary_or_unique', EXISTS (
                   SELECT 1 FROM pg_index i
                   WHERE i.indrelid = r.oid AND i.indisunique
                     AND a.attnum = ANY (i.indkey::smallint[])
               ),
               'referenced_by_foreign_key', EXISTS (
                   SELECT 1 FROM pg_constraint fk
                   WHERE fk.confrelid = r.oid AND fk.contype = 'f'
                     AND a.attnum = ANY (fk.confkey)
               )
           ) ORDER BY a.attnum), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE r.relname = 'profiles'
),
trg AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', t.tgname,
               'function', p.proname || '()',
               'enabled', t.tgenabled::text
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
    JOIN pg_proc p ON p.oid = t.tgfoid
),

-- ---------------------------------------------------------------------------
-- Trigger functions backing every non-internal trigger on a target table.
-- Security/config posture only; NO body.
-- ---------------------------------------------------------------------------
-- De-duplication is on the function OID, NOT on the built json value: `json`
-- has no equality operator, so SELECT DISTINCT over a json_build_object would
-- fail at parse/plan time with "could not identify an equality operator for
-- type json". One trigger function commonly backs several triggers
-- (update_updated_at_column is attached to many tables), so the distinct OID
-- set is gathered first and the object is built once per function.
trg_fn_oids AS (
    SELECT DISTINCT t.tgfoid AS oid
    FROM target_rel r
    JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
),
trg_fn AS (
    SELECT coalesce(json_agg(json_build_object(
               'schema', fn.nspname,
               'name', fp.proname,
               'owner', pg_get_userbyid(fp.proowner),
               'language', fl.lanname,
               'security_definer', fp.prosecdef,
               'config', coalesce(array_to_string(fp.proconfig, ','), '<none>'),
               'acl_is_null', fp.proacl IS NULL,
               'acl_is_empty', fp.proacl IS NOT NULL AND cardinality(fp.proacl) = 0,
               'grants', coalesce((
                   SELECT json_agg(json_build_object(
                              'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                              ELSE pg_get_userbyid(x.grantee) END,
                              'privilege', x.privilege_type
                          ) ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                          ELSE pg_get_userbyid(x.grantee) END, x.privilege_type)
                   FROM aclexplode(fp.proacl) AS x
               ), '[]'::json)
           ) ORDER BY fn.nspname, fp.proname), '[]'::json) AS j
    FROM trg_fn_oids o
    JOIN pg_proc fp ON fp.oid = o.oid
    JOIN pg_namespace fn ON fn.oid = fp.pronamespace
    JOIN pg_language fl ON fl.oid = fp.prolang
),

-- ---------------------------------------------------------------------------
-- The lifecycle routine surface Batch 2 owns.
--
-- Pre-apply this MUST be empty: a pre-existing routine under one of these names
-- would either be silently replaced (keeping its old ACL) or, with a different
-- signature, become an OVERLOAD that CREATE OR REPLACE never touches -- an
-- unreviewed function reachable under a reviewed name.
--
-- Post-apply it is the complete created set with owner / kind / security /
-- config / ACL. NO bodies.
-- ---------------------------------------------------------------------------
lifecycle_fn AS (
    -- `identity` is built by explicit concatenation rather than
    -- oid::regprocedure::text. regprocedure OMITS the schema when the function
    -- is visible in the current search_path, so `public.foo(uuid)` renders as
    -- plain `foo(uuid)` under the default '"$user", public' -- and would render
    -- differently again under another search_path. A frozen manifest cannot
    -- depend on a rendering that changes with session state.
    SELECT coalesce(json_agg(json_build_object(
               'identity', n.nspname || '.' || p.proname
                           || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               'kind', p.prokind::text,
               'owner', pg_get_userbyid(p.proowner),
               'language', l.lanname,
               'security_definer', p.prosecdef,
               'volatility', p.provolatile::text,
               'config', coalesce(array_to_string(p.proconfig, ','), '<none>'),
               'acl_is_null', p.proacl IS NULL,
               'acl_is_empty', p.proacl IS NOT NULL AND cardinality(p.proacl) = 0,
               'grants', coalesce((
                   SELECT json_agg(json_build_object(
                              'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                              ELSE pg_get_userbyid(x.grantee) END,
                              'privilege', x.privilege_type
                          ) ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                          ELSE pg_get_userbyid(x.grantee) END, x.privilege_type)
                   FROM aclexplode(p.proacl) AS x
               ), '[]'::json)
           ) ORDER BY n.nspname, p.proname,
                      pg_get_function_identity_arguments(p.oid)), '[]'::json) AS j
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'canvas_p1_%'
           OR p.proname LIKE '%_canvas_generation_%'
           OR p.proname LIKE '%canvas_gpt_image%'
           OR p.proname LIKE 'begin_canvas_%'
           OR p.proname LIKE 'lookup_canvas_%'
           OR p.proname LIKE 'replay_canvas_%'
           OR p.proname LIKE 'sweep_stale_canvas_%')
),

-- ---------------------------------------------------------------------------
-- BLOCKER 8: the signup-trigger precondition, provable BEFORE the first write.
--
-- The lifecycle migration converts the live auth path by replacing the BODY of
-- public.handle_new_user(); the existing trigger on auth.users is what carries
-- that replacement into real signups. If the trigger is absent, disabled, or
-- bound to some other function, the conversion silently does nothing and every
-- new account is initialized by an unreviewed path.
--
-- Redaction: identity plus enabled/timing only. No body, no auth data. tgtype
-- bit 0 = FOR EACH ROW, bit 1 = BEFORE, bit 2 = INSERT.
-- ---------------------------------------------------------------------------
auth_trg_all AS (
    SELECT coalesce(json_agg(json_build_object(
               'name', t.tgname,
               'function', pn.nspname || '.' || p.proname || '()',
               'enabled', t.tgenabled::text,
               'for_each_row', (t.tgtype & 1) = 1,
               'timing', CASE WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
                              WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
                              ELSE 'AFTER' END,
               'event_insert', (t.tgtype & 4) = 4,
               'event_delete', (t.tgtype & 8) = 8,
               'event_update', (t.tgtype & 16) = 16,
               'event_truncate', (t.tgtype & 32) = 32
           ) ORDER BY t.tgname, pn.nspname, p.proname), '[]'::json) AS j
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE t.tgrelid = to_regclass('auth.users')
      AND NOT t.tgisinternal
),
auth_trg AS (
    -- `function` is explicitly schema-qualified rather than
    -- p.oid::regprocedure::text: regprocedure drops the schema when the
    -- function is visible in search_path, so the trigger's own function would
    -- render as `handle_new_user()` under the default path and
    -- `public.handle_new_user()` under another. This is the precondition the
    -- write gate compares by exact string, so its rendering must not depend on
    -- session state. The zero-argument '()' is literal: a trigger function
    -- takes no declared arguments.
    SELECT json_build_object(
               'present', t.oid IS NOT NULL,
               'name', coalesce(t.tgname, '<absent>'),
               'table', 'auth.users',
               'function', coalesce(pn.nspname || '.' || p.proname || '()', '<absent>'),
               'enabled', coalesce(t.tgenabled::text, '<absent>'),
               'for_each_row', coalesce((t.tgtype & 1) = 1, false),
               'timing', CASE WHEN t.oid IS NULL THEN '<absent>'
                              WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END,
               'on_insert', coalesce((t.tgtype & 4) = 4, false)
           ) AS j
    FROM (SELECT 1) AS one
    LEFT JOIN pg_trigger t
      ON t.tgrelid = to_regclass('auth.users')
     AND NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('public.handle_new_user()')
    LEFT JOIN pg_proc p ON p.oid = t.tgfoid
    LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
),
handle_new_user_fn AS (
    SELECT json_build_object(
               'present', p.oid IS NOT NULL,
               'kind', coalesce(p.prokind::text, '<absent>'),
               'owner', coalesce(pg_get_userbyid(p.proowner), '<absent>'),
               'language', coalesce(l.lanname, '<absent>'),
               'security_definer', coalesce(p.prosecdef, false),
               'returns_trigger', coalesce(p.prorettype = 'pg_catalog.trigger'::regtype, false),
               'config', coalesce(array_to_string(p.proconfig, ','), '<none>')
           ) AS j
    FROM (SELECT 1) AS one
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.handle_new_user()')
    LEFT JOIN pg_language l ON l.oid = p.prolang
),

-- ---------------------------------------------------------------------------
-- generation_quota_buckets: complete shape, nested ACL with explicit empty
-- state. This is the section that must prove ZERO client privileges, so it is
-- exactly where a flat aclexplode would be vacuous.
-- ---------------------------------------------------------------------------
quota_shape AS (
    SELECT json_build_object(
               'present', (SELECT count(*) FROM quota_rel) = 1,
               'owner', (SELECT owner FROM quota_rel),
               'rls_enabled', (SELECT relrowsecurity FROM quota_rel),
               'rls_forced', (SELECT relforcerowsecurity FROM quota_rel),
               'acl_is_null', (SELECT relacl IS NULL FROM quota_rel),
               'acl_is_empty',
                   (SELECT relacl IS NOT NULL AND cardinality(relacl) = 0 FROM quota_rel),
               'grants', coalesce((
                   SELECT json_agg(json_build_object(
                              'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                              ELSE pg_get_userbyid(x.grantee) END,
                              'privilege', x.privilege_type
                          ) ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                                          ELSE pg_get_userbyid(x.grantee) END, x.privilege_type)
                   FROM quota_rel q, aclexplode(q.relacl) AS x
               ), '[]'::json),
               'policy_count', coalesce((
                   SELECT count(*) FROM pg_policy p, quota_rel q WHERE p.polrelid = q.oid
               ), 0),
               'columns', coalesce((
                   SELECT json_agg(json_build_object(
                              'ordinal', a.attnum,
                              'name', a.attname,
                              'type', format_type(a.atttypid, a.atttypmod),
                              'not_null', a.attnotnull,
                              'default', pg_get_expr(d.adbin, d.adrelid)
                          ) ORDER BY a.attnum)
                   FROM quota_rel q
                   JOIN pg_attribute a
                     ON a.attrelid = q.oid AND a.attnum > 0 AND NOT a.attisdropped
                   LEFT JOIN pg_attrdef d ON d.adrelid = q.oid AND d.adnum = a.attnum
               ), '[]'::json),
               'constraints', coalesce((
                   SELECT json_agg(json_build_object(
                              'name', ct.conname,
                              'type', ct.contype::text,
                              'validated', ct.convalidated,
                              'definition', pg_catalog.pg_get_constraintdef(ct.oid, true)
                          ) ORDER BY ct.conname)
                   FROM quota_rel q
                   JOIN pg_constraint ct ON ct.conrelid = q.oid
               ), '[]'::json),
               'indexes', coalesce((
                   SELECT json_agg(json_build_object(
                              'name', ic.relname,
                              'unique', ix.indisunique,
                              'primary', ix.indisprimary,
                              'definition', pg_get_indexdef(ix.indexrelid)
                          ) ORDER BY ic.relname)
                   FROM quota_rel q
                   JOIN pg_index ix ON ix.indrelid = q.oid
                   JOIN pg_class ic ON ic.oid = ix.indexrelid
               ), '[]'::json)
           ) AS j
)

SELECT json_build_object(
    'target_expectations', (SELECT j FROM target_expect),
    'columns', (SELECT j FROM cols),
    'constraints', (SELECT j FROM cons),
    'indexes', (SELECT j FROM idx),
    'relations', (SELECT j FROM rels),
    'policies', (SELECT j FROM pol),
    'relation_acl', (SELECT j FROM acl),
    'column_acl', (SELECT j FROM col_acl),
    'default_acl', (SELECT j FROM dacl),
    'incoming_foreign_keys', (SELECT j FROM infk),
    'profile_key_columns', (SELECT j FROM profile_keys),
    'triggers', (SELECT j FROM trg),
    'trigger_functions', (SELECT j FROM trg_fn),
    'lifecycle_routines', (SELECT j FROM lifecycle_fn),
    'auth_signup_trigger', (SELECT j FROM auth_trg),
    'auth_user_triggers', (SELECT j FROM auth_trg_all),
    'handle_new_user', (SELECT j FROM handle_new_user_fn),
    'quota_bucket_shape', (SELECT j FROM quota_shape)
)::text;
