#!/usr/bin/env node
/**
 * Reviewable production operation sheet for the four post-P1 Canvas
 * migrations. This generator is offline: it reads hash-pinned SQL and emits
 * preflight, migrate, or postflight SQL without connecting to a database.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertFrozenArtifacts as assertBaseFrozenArtifacts,
  buildCatalogTransactionGuard,
} from "./canvas-p1-production-operation.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

export const ADDITIVE_MIGRATIONS = Object.freeze([
  Object.freeze({
    relativePath: "supabase/migrations/20260729_canvas_project_lifecycle.sql",
    sha256: "49945b1ed0f79212d035b0eb26f605359dda0e3a1a622fb9c31db94a4c277d61",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260730_canvas_generation_recovery.sql",
    sha256: "5d62b51e1fb65125e1503d937d55b9536abe8f22372ecb398d2e20ba3f8ebec7",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260731_canvas_runtime_health.sql",
    sha256: "1971ca6f4d2efa9189aa7763e67c186298da2e6a39790ff8defe8d04772efc5b",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260801_canvas_upload_registry.sql",
    sha256: "5a453df313548f3db314660522c298aefa8baa8dc0a0ba3c8bfde397bd2297ba",
  }),
]);

const TRANSACTION_BOUNDARY_RE =
  /^\s*(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|COMMIT(?:\s+(?:WORK|TRANSACTION))?)\s*;/im;

const INCREMENTAL_RELATIONS = Object.freeze([
  "public.canvas_generation_resolution_audit",
  "public.canvas_generation_resolution_audit_once_idx",
  "public.canvas_upload_daily_usage",
  "public.canvas_upload_storage_usage",
  "public.canvas_upload_reservations",
  "public.canvas_upload_reservations_ready_owner_key_idx",
  "public.canvas_upload_reservations_expiry_idx",
  "public.canvas_upload_reservations_purge_idx",
  "public.canvas_upload_reservations_orphan_scan_idx",
]);

const INCREMENTAL_FUNCTION_NAMES = Object.freeze([
  "guard_canvas_project_insert_v1",
  "create_canvas_project_v1",
  "delete_canvas_project_v1",
  "reject_canvas_generation_resolution_audit_mutation_v1",
  "sweep_stale_canvas_not_started_v1",
  "resolve_canvas_video_unknown_v1",
  "canvas_production_healthcheck_v1",
  "canvas_owned_media_key_v1",
  "reserve_canvas_uploads_v1",
  "finalize_canvas_upload_v1",
  "assert_canvas_media_keys_ready_v1",
  "sweep_expired_canvas_uploads_v1",
  "mark_canvas_upload_orphans_v1",
  "claim_canvas_upload_purge_v1",
  "complete_canvas_upload_purge_v1",
]);

const FUNCTION_REQUIREMENTS = Object.freeze([
  ["public.guard_canvas_project_insert_v1()", null, true, "v"],
  ["public.create_canvas_project_v1(uuid,text,integer,jsonb,jsonb,integer)", "authenticated", true, "v"],
  ["public.delete_canvas_project_v1(uuid)", "authenticated", true, "v"],
  ["public.reject_canvas_generation_resolution_audit_mutation_v1()", null, true, "v"],
  ["public.sweep_stale_canvas_not_started_v1(integer)", "service_role", true, "v"],
  ["public.resolve_canvas_video_unknown_v1(uuid,uuid,text,text,text,text)", "service_role", true, "v"],
  ["public.canvas_production_healthcheck_v1()", "service_role", true, "s"],
  ["public.canvas_owned_media_key_v1(text,uuid)", "service_role", false, "i"],
  ["public.reserve_canvas_uploads_v1(uuid,jsonb)", "service_role", true, "v"],
  ["public.finalize_canvas_upload_v1(uuid,uuid,text,bigint,text)", "service_role", true, "v"],
  ["public.assert_canvas_media_keys_ready_v1(uuid,uuid,bigint,text[])", "service_role", true, "v"],
  ["public.sweep_expired_canvas_uploads_v1(integer)", "service_role", true, "v"],
  ["public.mark_canvas_upload_orphans_v1(integer,integer)", "service_role", true, "v"],
  ["public.claim_canvas_upload_purge_v1(integer,integer)", "service_role", true, "v"],
  ["public.complete_canvas_upload_purge_v1(uuid,uuid)", "service_role", true, "v"],
]);

const TABLE_REQUIREMENTS = Object.freeze([
  ["public.canvas_generation_resolution_audit", true, true, false],
  ["public.canvas_upload_daily_usage", true, false, true],
  ["public.canvas_upload_storage_usage", true, false, true],
  ["public.canvas_upload_reservations", true, false, true],
]);

const INDEX_REQUIREMENTS = Object.freeze([
  ["public.canvas_generation_resolution_audit_once_idx", "public.canvas_generation_resolution_audit", true],
  ["public.canvas_upload_reservations_ready_owner_key_idx", "public.canvas_upload_reservations", false],
  ["public.canvas_upload_reservations_expiry_idx", "public.canvas_upload_reservations", false],
  ["public.canvas_upload_reservations_purge_idx", "public.canvas_upload_reservations", false],
  ["public.canvas_upload_reservations_orphan_scan_idx", "public.canvas_upload_reservations", false],
]);

const CONSTRAINT_REQUIREMENTS = Object.freeze([
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_audit_pkey", "p", null],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_audit_generation_id_fkey", "f", "r"],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_kind_check", "c", null],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_operator_check", "c", null],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_evidence_check", "c", null],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_shape_check", "c", null],
  ["public.canvas_generation_resolution_audit", "canvas_generation_resolution_previous_state_check", "c", null],
  ["public.canvas_upload_daily_usage", "canvas_upload_daily_usage_pkey", "p", null],
  ["public.canvas_upload_daily_usage", "canvas_upload_daily_usage_user_fk", "f", "c"],
  ["public.canvas_upload_daily_usage", "canvas_upload_daily_usage_files_range", "c", null],
  ["public.canvas_upload_daily_usage", "canvas_upload_daily_usage_bytes_range", "c", null],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_pkey", "p", null],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_user_fk", "f", "c"],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_files_nonnegative", "c", null],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_bytes_nonnegative", "c", null],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_total_files", "c", null],
  ["public.canvas_upload_storage_usage", "canvas_upload_storage_usage_total_bytes", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_pkey", "p", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_object_key_key", "u", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_user_fk", "f", "c"],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_kind", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_status", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_size", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_extension_mime", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_key_identity", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_expiry", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_state_shape", "c", null],
  ["public.canvas_upload_reservations", "canvas_upload_reservations_purge_attempts", "c", null],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]`;
}

function sqlValues(rows) {
  return rows
    .map((row) => `(${row.map(sqlLiteral).join(", ")})`)
    .join(",\n                ");
}

function readFrozenMigration(file) {
  const bytes = readFileSync(join(ROOT, ...file.relativePath.split("/")));
  const actual = sha256(bytes);
  if (actual !== file.sha256) {
    throw new Error(
      `REFUSED: ${file.relativePath} SHA-256 is ${actual}; expected ${file.sha256}.`
    );
  }
  const sql = bytes.toString("utf8");
  if (!Buffer.from(sql, "utf8").equals(bytes)) {
    throw new Error(`REFUSED: ${file.relativePath} is not canonical UTF-8.`);
  }
  if (TRANSACTION_BOUNDARY_RE.test(sql)) {
    throw new Error(
      `REFUSED: ${file.relativePath} contains its own transaction boundary.`
    );
  }
  return sql;
}

export function assertAdditiveFrozenArtifacts() {
  // The additive operation is valid only on the exact already-deployed P1
  // contract and evidence pinned by the base production operation.
  assertBaseFrozenArtifacts();
  for (const file of ADDITIVE_MIGRATIONS) readFrozenMigration(file);
  return true;
}

function buildAdditiveAbsenceGuard(tag) {
  return `DO $${tag}$
DECLARE
    v_name text;
    v_count bigint;
BEGIN
    FOREACH v_name IN ARRAY ${sqlArray(INCREMENTAL_RELATIONS)}
    LOOP
        IF pg_catalog.to_regclass(v_name) IS NOT NULL THEN
            RAISE EXCEPTION
                'Canvas additive precondition: relation already exists: %',
                v_name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    FOREACH v_name IN ARRAY ${sqlArray(INCREMENTAL_FUNCTION_NAMES)}
    LOOP
        SELECT pg_catalog.count(*)
          INTO v_count
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = v_name;
        IF v_count <> 0 THEN
            RAISE EXCEPTION
                'Canvas additive precondition: function already exists: %',
                v_name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM pg_catalog.pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgname = ANY (
           ARRAY[
               'canvas_project_insert_lock_v1',
               'canvas_project_insert_owner_v1',
               'canvas_project_insert_cap_v1',
               'canvas_generation_resolution_audit_append_only'
           ]
       );
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'Canvas additive precondition: incremental trigger already exists'
            USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_table_privilege(
        'authenticated',
        'public.canvases',
        'INSERT'
    ) IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'Canvas additive precondition: authenticated canvases INSERT is not the expected pre-apply grant'
            USING ERRCODE = '42501';
    END IF;
END
$${tag}$;`;
}

function buildPostconditionGuard() {
  return `DO $canvas_additive_postcondition$
DECLARE
    v_health record;
    v_requirement record;
    v_oid oid;
    v_count bigint;
    v_row_security boolean;
    v_force_row_security boolean;
    v_security_definer boolean;
    v_volatility "char";
    v_search_path text;
    v_index_unique boolean;
    v_index_valid boolean;
    v_index_table oid;
BEGIN
    SELECT h.*
      INTO STRICT v_health
      FROM public.canvas_production_healthcheck_v1() h;
    IF v_health.contract_version IS DISTINCT FROM 'canvas-production-health-v1'
       OR v_health.read_only_probe IS DISTINCT FROM true
       OR v_health.required_rpc_count IS DISTINCT FROM 27
    THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: health contract drift: %, %, %',
            v_health.contract_version,
            v_health.read_only_probe,
            v_health.required_rpc_count
            USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (${sqlArray(INCREMENTAL_FUNCTION_NAMES)});
    IF v_count <> ${FUNCTION_REQUIREMENTS.length} THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: expected ${FUNCTION_REQUIREMENTS.length} exact incremental functions, got %',
            v_count
            USING ERRCODE = '55000';
    END IF;

    FOR v_requirement IN
        SELECT *
          FROM (VALUES
                ${sqlValues(FUNCTION_REQUIREMENTS)}
          ) AS expected(signature, executor_role, security_definer, volatility)
    LOOP
        v_oid := pg_catalog.to_regprocedure(v_requirement.signature);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: missing function %',
                v_requirement.signature
                USING ERRCODE = '55000';
        END IF;

        SELECT p.prosecdef,
               p.provolatile,
               (
                   SELECT pg_catalog.btrim(
                       pg_catalog.replace(
                           pg_catalog.substr(
                               config.value,
                               pg_catalog.strpos(config.value, '=') + 1
                           ),
                           '"',
                           ''
                       )
                   )
                     FROM pg_catalog.unnest(
                         COALESCE(p.proconfig, ARRAY[]::text[])
                     ) AS config(value)
                    WHERE pg_catalog.split_part(config.value, '=', 1) = 'search_path'
               )
          INTO v_security_definer, v_volatility, v_search_path
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
           AND p.prokind = 'f';

        IF v_security_definer IS DISTINCT FROM v_requirement.security_definer
           OR v_volatility IS DISTINCT FROM v_requirement.volatility::"char"
           OR v_search_path IS DISTINCT FROM ''
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: function security drift: %',
                v_requirement.signature
                USING ERRCODE = '55000';
        END IF;
        IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
           OR (
               pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
               AND v_requirement.executor_role IS DISTINCT FROM 'authenticated'
           )
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: browser function ACL drift: %',
                v_requirement.signature
                USING ERRCODE = '42501';
        END IF;
        IF v_requirement.executor_role IS NOT NULL
           AND NOT pg_catalog.has_function_privilege(
               v_requirement.executor_role,
               v_oid,
               'EXECUTE'
           )
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: intended executor lacks function: %',
                v_requirement.signature
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    FOR v_requirement IN
        SELECT *
          FROM (VALUES
                ${sqlValues(TABLE_REQUIREMENTS)}
          ) AS expected(
              table_name,
              row_security,
              force_row_security,
              service_write
          )
    LOOP
        SELECT c.relrowsecurity, c.relforcerowsecurity
          INTO v_row_security, v_force_row_security
          FROM pg_catalog.pg_class c
         WHERE c.oid = pg_catalog.to_regclass(v_requirement.table_name)
           AND c.relkind = 'r';
        IF NOT FOUND
           OR v_row_security IS DISTINCT FROM v_requirement.row_security
           OR v_force_row_security IS DISTINCT FROM v_requirement.force_row_security
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: table RLS drift: %',
                v_requirement.table_name
                USING ERRCODE = '55000';
        END IF;

        SELECT pg_catalog.count(*)
          INTO v_count
          FROM pg_catalog.pg_policy
         WHERE polrelid = pg_catalog.to_regclass(v_requirement.table_name);
        IF v_count <> 0 THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: unexpected browser policy: %',
                v_requirement.table_name
                USING ERRCODE = '42501';
        END IF;

        IF pg_catalog.has_table_privilege('anon', v_requirement.table_name, 'SELECT')
           OR pg_catalog.has_table_privilege('anon', v_requirement.table_name, 'INSERT')
           OR pg_catalog.has_table_privilege('anon', v_requirement.table_name, 'UPDATE')
           OR pg_catalog.has_table_privilege('anon', v_requirement.table_name, 'DELETE')
           OR pg_catalog.has_table_privilege('authenticated', v_requirement.table_name, 'SELECT')
           OR pg_catalog.has_table_privilege('authenticated', v_requirement.table_name, 'INSERT')
           OR pg_catalog.has_table_privilege('authenticated', v_requirement.table_name, 'UPDATE')
           OR pg_catalog.has_table_privilege('authenticated', v_requirement.table_name, 'DELETE')
           OR NOT pg_catalog.has_table_privilege('service_role', v_requirement.table_name, 'SELECT')
           OR (
               pg_catalog.has_table_privilege('service_role', v_requirement.table_name, 'INSERT')
               IS DISTINCT FROM v_requirement.service_write
           )
           OR (
               pg_catalog.has_table_privilege('service_role', v_requirement.table_name, 'UPDATE')
               IS DISTINCT FROM v_requirement.service_write
           )
           OR (
               pg_catalog.has_table_privilege('service_role', v_requirement.table_name, 'DELETE')
               IS DISTINCT FROM v_requirement.service_write
           )
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: table ACL drift: %',
                v_requirement.table_name
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    FOR v_requirement IN
        SELECT *
          FROM (VALUES
                ${sqlValues(INDEX_REQUIREMENTS)}
          ) AS expected(index_name, table_name, is_unique)
    LOOP
        SELECT i.indisunique, i.indisvalid, i.indrelid
          INTO v_index_unique, v_index_valid, v_index_table
          FROM pg_catalog.pg_index i
         WHERE i.indexrelid = pg_catalog.to_regclass(v_requirement.index_name);
        IF NOT FOUND
           OR v_index_unique IS DISTINCT FROM v_requirement.is_unique
           OR v_index_valid IS DISTINCT FROM true
           OR v_index_table IS DISTINCT FROM
              pg_catalog.to_regclass(v_requirement.table_name)
        THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: index drift: %',
                v_requirement.index_name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    FOR v_requirement IN
        SELECT *
          FROM (VALUES
                ${sqlValues(CONSTRAINT_REQUIREMENTS)}
          ) AS expected(
              table_name,
              constraint_name,
              constraint_type,
              delete_action
          )
    LOOP
        SELECT pg_catalog.count(*)
          INTO v_count
          FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = pg_catalog.to_regclass(v_requirement.table_name)
           AND c.conname = v_requirement.constraint_name
           AND c.convalidated
           AND c.contype = v_requirement.constraint_type::"char"
           AND (
               v_requirement.delete_action IS NULL
               OR c.confdeltype = v_requirement.delete_action::"char"
           );
        IF v_count <> 1 THEN
            RAISE EXCEPTION
                'Canvas additive postcondition: constraint missing/unvalidated: %.%',
                v_requirement.table_name,
                v_requirement.constraint_name
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = ANY (
         ARRAY[
             pg_catalog.to_regclass('public.canvas_generation_resolution_audit'),
             pg_catalog.to_regclass('public.canvas_upload_daily_usage'),
             pg_catalog.to_regclass('public.canvas_upload_storage_usage'),
             pg_catalog.to_regclass('public.canvas_upload_reservations')
         ]
     );
    IF v_count <> ${CONSTRAINT_REQUIREMENTS.length} THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: unexpected incremental constraint count %',
            v_count
            USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM pg_catalog.pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgname = 'canvas_generation_resolution_audit_append_only'
       AND t.tgrelid = pg_catalog.to_regclass(
           'public.canvas_generation_resolution_audit'
       )
       AND t.tgfoid = pg_catalog.to_regprocedure(
           'public.reject_canvas_generation_resolution_audit_mutation_v1()'
       )
       AND t.tgenabled = 'O'
       AND (t.tgtype & 1) = 1
       AND (t.tgtype & 2) = 2
       AND (t.tgtype & 4) = 0
       AND (t.tgtype & 8) = 8
       AND (t.tgtype & 16) = 16
       AND (t.tgtype & 32) = 0;
    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: append-only trigger drift'
            USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM (VALUES
            ('canvas_project_insert_lock_v1', 6),
            ('canvas_project_insert_owner_v1', 7),
            ('canvas_project_insert_cap_v1', 4)
      ) AS expected(trigger_name, trigger_type)
      JOIN pg_catalog.pg_trigger t
        ON t.tgname = expected.trigger_name
       AND NOT t.tgisinternal
       AND t.tgrelid = pg_catalog.to_regclass('public.canvases')
       AND t.tgfoid = pg_catalog.to_regprocedure(
           'public.guard_canvas_project_insert_v1()'
       )
       AND t.tgenabled = 'O'
       AND t.tgtype = expected.trigger_type;
    IF v_count <> 3 THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: legacy INSERT bridge trigger drift'
            USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_table_privilege('anon', 'public.canvases', 'INSERT')
       OR NOT pg_catalog.has_table_privilege(
           'authenticated',
           'public.canvases',
           'INSERT'
       ) THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: legacy INSERT bridge ACL drift'
            USING ERRCODE = '42501';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM public.profiles
     WHERE credits < 0;
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: % negative-credit profile(s)',
            v_count;
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_count
      FROM (
          SELECT user_id, operation_anchor
            FROM public.credit_transactions
           WHERE operation_anchor IS NOT NULL
           GROUP BY user_id, operation_anchor
          HAVING pg_catalog.count(*) > 1
      ) duplicate_anchors;
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'Canvas additive postcondition: % duplicate user anchor(s)',
            v_count;
    END IF;
END
$canvas_additive_postcondition$;`;
}

function buildReadOnlySummary(state) {
  const postapply = state === "postapply";
  const healthCte = postapply
    ? `health AS (
    SELECT * FROM public.canvas_production_healthcheck_v1()
),`
    : "";
  const postFields = postapply
    ? `,
    'health_contract_version', (SELECT contract_version FROM health),
    'health_read_only_probe', (SELECT read_only_probe FROM health),
    'health_required_rpc_count', (SELECT required_rpc_count FROM health),
    'audit_rows', (SELECT pg_catalog.count(*) FROM public.canvas_generation_resolution_audit),
    'upload_daily_rows', (SELECT pg_catalog.count(*) FROM public.canvas_upload_daily_usage),
    'upload_storage_rows', (SELECT pg_catalog.count(*) FROM public.canvas_upload_storage_usage),
    'upload_reservation_rows', (SELECT pg_catalog.count(*) FROM public.canvas_upload_reservations),
    'negative_credit_profiles',
        (SELECT pg_catalog.count(*) FROM public.profiles WHERE credits < 0),
    'duplicate_user_anchors',
        (SELECT pg_catalog.count(*) FROM (
            SELECT user_id, operation_anchor
              FROM public.credit_transactions
             WHERE operation_anchor IS NOT NULL
             GROUP BY user_id, operation_anchor
            HAVING pg_catalog.count(*) > 1
        ) duplicate_anchors),
    'authenticated_can_insert_canvases',
        pg_catalog.has_table_privilege('authenticated', 'public.canvases', 'INSERT'),
    'project_insert_bridge_ok',
        (
            NOT pg_catalog.has_table_privilege('anon', 'public.canvases', 'INSERT')
            AND pg_catalog.has_table_privilege(
                'authenticated',
                'public.canvases',
                'INSERT'
            )
            AND
            (SELECT pg_catalog.count(*) = 3
               FROM (VALUES
                     ('canvas_project_insert_lock_v1', 6),
                     ('canvas_project_insert_owner_v1', 7),
                     ('canvas_project_insert_cap_v1', 4)
               ) AS expected(trigger_name, trigger_type)
               JOIN pg_catalog.pg_trigger t
                 ON t.tgname = expected.trigger_name
                AND NOT t.tgisinternal
                AND t.tgrelid = pg_catalog.to_regclass('public.canvases')
                AND t.tgfoid = pg_catalog.to_regprocedure(
                    'public.guard_canvas_project_insert_v1()'
                )
                AND t.tgenabled = 'O'
                AND t.tgtype = expected.trigger_type)
        ),
    'incremental_table_security_ok',
        (SELECT pg_catalog.bool_and(
             c.oid IS NOT NULL
             AND c.relrowsecurity IS NOT DISTINCT FROM expected.row_security
             AND c.relforcerowsecurity IS NOT DISTINCT FROM expected.force_row_security
             AND NOT pg_catalog.has_table_privilege('anon', expected.table_name, 'SELECT')
             AND NOT pg_catalog.has_table_privilege('anon', expected.table_name, 'INSERT')
             AND NOT pg_catalog.has_table_privilege('anon', expected.table_name, 'UPDATE')
             AND NOT pg_catalog.has_table_privilege('anon', expected.table_name, 'DELETE')
             AND NOT pg_catalog.has_table_privilege('authenticated', expected.table_name, 'SELECT')
             AND NOT pg_catalog.has_table_privilege('authenticated', expected.table_name, 'INSERT')
             AND NOT pg_catalog.has_table_privilege('authenticated', expected.table_name, 'UPDATE')
             AND NOT pg_catalog.has_table_privilege('authenticated', expected.table_name, 'DELETE')
             AND pg_catalog.has_table_privilege('service_role', expected.table_name, 'SELECT')
             AND (
                 pg_catalog.has_table_privilege('service_role', expected.table_name, 'INSERT')
                 IS NOT DISTINCT FROM expected.service_write
             )
             AND (
                 pg_catalog.has_table_privilege('service_role', expected.table_name, 'UPDATE')
                 IS NOT DISTINCT FROM expected.service_write
             )
             AND (
                 pg_catalog.has_table_privilege('service_role', expected.table_name, 'DELETE')
                 IS NOT DISTINCT FROM expected.service_write
             )
         )
           FROM (VALUES
                 ${sqlValues(TABLE_REQUIREMENTS)}
           ) AS expected(table_name, row_security, force_row_security, service_write)
           LEFT JOIN pg_catalog.pg_class c
             ON c.oid = pg_catalog.to_regclass(expected.table_name)),
    'incremental_function_security_ok',
        (SELECT pg_catalog.bool_and(
             p.oid IS NOT NULL
             AND p.prosecdef IS NOT DISTINCT FROM expected.security_definer
             AND p.provolatile IS NOT DISTINCT FROM expected.volatility::"char"
             AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
             AND (
                 expected.executor_role IS NOT DISTINCT FROM 'authenticated'
                 OR NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
             )
             AND (
                 expected.executor_role IS NULL
                 OR pg_catalog.has_function_privilege(
                     expected.executor_role,
                     p.oid,
                     'EXECUTE'
                 )
             )
             AND EXISTS (
                 SELECT 1
                   FROM pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[]))
                        config(value)
                  WHERE pg_catalog.split_part(config.value, '=', 1) = 'search_path'
                    AND pg_catalog.btrim(
                        pg_catalog.replace(
                            pg_catalog.substr(
                                config.value,
                                pg_catalog.strpos(config.value, '=') + 1
                            ),
                            '"',
                            ''
                        )
                    ) = ''
             )
         )
           FROM (VALUES
                 ${sqlValues(FUNCTION_REQUIREMENTS)}
           ) AS expected(
               signature,
               executor_role,
               security_definer,
               volatility
           )
           LEFT JOIN pg_catalog.pg_proc p
             ON p.oid = pg_catalog.to_regprocedure(expected.signature)),
    'incremental_indexes_ok',
        (SELECT pg_catalog.bool_and(
             i.indexrelid IS NOT NULL
             AND i.indisunique IS NOT DISTINCT FROM expected.is_unique
             AND i.indisvalid
             AND i.indrelid = pg_catalog.to_regclass(expected.table_name)
         )
           FROM (VALUES
                 ${sqlValues(INDEX_REQUIREMENTS)}
           ) AS expected(index_name, table_name, is_unique)
           LEFT JOIN pg_catalog.pg_index i
             ON i.indexrelid = pg_catalog.to_regclass(expected.index_name)),
    'append_only_trigger_ok',
        (SELECT pg_catalog.count(*) = 1
           FROM pg_catalog.pg_trigger t
          WHERE NOT t.tgisinternal
            AND t.tgname = 'canvas_generation_resolution_audit_append_only'
            AND t.tgrelid = pg_catalog.to_regclass(
                'public.canvas_generation_resolution_audit'
            )
            AND t.tgfoid = pg_catalog.to_regprocedure(
                'public.reject_canvas_generation_resolution_audit_mutation_v1()'
            )
            AND t.tgenabled = 'O'
            AND (t.tgtype & 1) = 1
            AND (t.tgtype & 2) = 2
            AND (t.tgtype & 4) = 0
            AND (t.tgtype & 8) = 8
            AND (t.tgtype & 16) = 16
            AND (t.tgtype & 32) = 0),
    'incremental_constraints_exact',
        (
            (SELECT pg_catalog.bool_and(
                 EXISTS (
                     SELECT 1
                       FROM pg_catalog.pg_constraint c
                      WHERE c.conrelid = pg_catalog.to_regclass(expected.table_name)
                        AND c.conname = expected.constraint_name
                        AND c.convalidated
                        AND c.contype = expected.constraint_type::"char"
                        AND (
                            expected.delete_action IS NULL
                            OR c.confdeltype = expected.delete_action::"char"
                        )
                 )
             )
               FROM (VALUES
                     ${sqlValues(CONSTRAINT_REQUIREMENTS)}
               ) AS expected(
                   table_name,
                   constraint_name,
                   constraint_type,
                   delete_action
               ))
            AND
            (SELECT pg_catalog.count(*) = ${CONSTRAINT_REQUIREMENTS.length}
               FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = ANY (
                  ARRAY[
                      pg_catalog.to_regclass('public.canvas_generation_resolution_audit'),
                      pg_catalog.to_regclass('public.canvas_upload_daily_usage'),
                      pg_catalog.to_regclass('public.canvas_upload_storage_usage'),
                      pg_catalog.to_regclass('public.canvas_upload_reservations')
                  ]
              ))
        )`
    : `,
    'incremental_relation_count',
        (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY (${sqlArray(
              INCREMENTAL_RELATIONS.map((name) => name.slice("public.".length))
            )})),
    'incremental_function_count',
        (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = ANY (${sqlArray(INCREMENTAL_FUNCTION_NAMES)})),
    'incremental_trigger_count',
        (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_trigger t
          WHERE NOT t.tgisinternal
            AND t.tgname = ANY (
                ARRAY[
                    'canvas_project_insert_lock_v1',
                    'canvas_project_insert_owner_v1',
                    'canvas_project_insert_cap_v1',
                    'canvas_generation_resolution_audit_append_only'
                ]
            )),
    'authenticated_can_insert_canvases',
        pg_catalog.has_table_privilege('authenticated', 'public.canvases', 'INSERT')`;

  return `WITH
${healthCte}
environment AS (
    SELECT pg_catalog.current_database() AS database_name,
           current_user AS database_user,
           pg_catalog.current_setting('server_version_num') AS server_version_num
)
SELECT pg_catalog.jsonb_build_object(
    'state', '${state}',
    'database', (SELECT database_name FROM environment),
    'database_user', (SELECT database_user FROM environment),
    'server_version_num', (SELECT server_version_num FROM environment),
    'checked_at', pg_catalog.clock_timestamp()${postFields}
) AS canvas_additive_production_${state};`;
}

export function buildPreflightOperation() {
  assertAdditiveFrozenArtifacts();
  return `BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

${buildCatalogTransactionGuard("postapply")}

${buildAdditiveAbsenceGuard("canvas_additive_preflight_guard")}

${buildReadOnlySummary("preapply")}
COMMIT;
`;
}

export function buildMigrationOperation() {
  assertAdditiveFrozenArtifacts();
  const blocks = ADDITIVE_MIGRATIONS.map((file) => {
    const sql = readFrozenMigration(file);
    const suffix = sql.endsWith("\n") ? "" : "\n";
    return `-- START FROZEN ${file.relativePath} SHA-256 ${file.sha256}
${sql}${suffix}-- END FROZEN ${file.relativePath}`;
  }).join("\n\n");

  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('canvas-additive-production-20260801', 0)
);

${buildCatalogTransactionGuard("postapply")}

${buildAdditiveAbsenceGuard("canvas_additive_migrate_precondition")}

${blocks}

${buildPostconditionGuard()}

COMMIT;
`;
}

export function buildPostflightOperation() {
  assertAdditiveFrozenArtifacts();
  return `BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

${buildReadOnlySummary("postapply")}
COMMIT;
`;
}

function usage() {
  return "Usage: node scripts/canvas-additive-production-operation.mjs <preflight|migrate|postflight>";
}

function main(argv) {
  const command = argv[0];
  if (command === "preflight") return buildPreflightOperation();
  if (command === "migrate") return buildMigrationOperation();
  if (command === "postflight") return buildPostflightOperation();
  throw new Error(usage());
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
