#!/usr/bin/env node
/**
 * Canvas P1 production SQL operation-sheet generator.
 *
 * This script never connects to a database and never reads credentials. It
 * turns the hash-pinned migration/catalog evidence into three reviewable SQL
 * documents:
 *
 *   preflight  - one read-only statement for the frozen pre-apply catalog,
 *                aggregate row/status counts, and scoped activity counts.
 *   migrate    - one PostgreSQL transaction containing an advisory lock,
 *                the same pre-apply guard, the five frozen migrations in
 *                order, and the frozen post-apply guard before COMMIT.
 *   postflight - one read-only statement for the frozen post-apply catalog
 *                and aggregate health counts.
 *
 * The Preview harness remains production-denying. This is the separate,
 * production-specific operation sheet required by the release runbook.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadPostApplyManifest,
  loadPreApplyManifest,
} from "./fixtures/canvas-p1/batch2/manifests.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const INTROSPECTION_PATH = join(
  SCRIPT_DIR,
  "fixtures",
  "canvas-p1",
  "batch2",
  "sql",
  "batch2-introspect.sql"
);

export const FROZEN_FILES = Object.freeze([
  Object.freeze({
    relativePath: "supabase/migrations/20260715_generations_service_role_policy.sql",
    sha256: "2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260716_canvas_p1_lifecycle_foundation.sql",
    sha256: "c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260717_canvas_p1_credit_boundary.sql",
    sha256: "d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260718_canvas_p1_generation_api.sql",
    sha256: "7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638",
  }),
  Object.freeze({
    relativePath: "supabase/migrations/20260719_canvas_p1_reconciliation.sql",
    sha256: "6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524",
  }),
]);

export const FROZEN_EVIDENCE = Object.freeze([
  Object.freeze({
    relativePath: "scripts/fixtures/canvas-p1/batch2/post-apply-catalog.json",
    sha256: "f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f",
  }),
  Object.freeze({
    relativePath: "scripts/fixtures/canvas-p1/batch2/remote-preflight-locks.json",
    sha256: "4aefc421f1a783dcac07c63115b7c7c31d10d1d0677e14b69a6ac9e36c429031",
  }),
]);

/**
 * Production carries one additional, independently scoped auth.users trigger
 * that creates the application's tenant row. It was installed outside the
 * migration history and is intentionally absent from the isolated Preview
 * Branch. The frozen Canvas migration refuses every competing trigger, so the
 * production transaction must:
 *
 *   1. prove this exact trigger is the only production-only delta;
 *   2. drop it inside the still-uncommitted transaction;
 *   3. run the five byte-frozen migrations unchanged;
 *   4. recreate the same trigger; and
 *   5. prove the complete post-apply catalog including this trigger.
 *
 * A failure at any point rolls the trigger drop back with the whole batch.
 */
const STANDARD_SIGNUP_TRIGGER = Object.freeze({
  name: "on_auth_user_created",
  function: "public.handle_new_user()",
  enabled: "O",
  for_each_row: true,
  timing: "AFTER",
  event_insert: true,
  event_delete: false,
  event_update: false,
  event_truncate: false,
});

const TENANT_SIGNUP_TRIGGER = Object.freeze({
  name: "on_auth_user_created_create_tenant",
  function: "public.auto_create_tenant_for_user()",
  enabled: "O",
  for_each_row: true,
  timing: "AFTER",
  event_insert: true,
  event_delete: false,
  event_update: false,
  event_truncate: false,
});

const STANDARD_SIGNUP_TRIGGER_SUMMARY = Object.freeze({
  present: true,
  name: "on_auth_user_created",
  table: "auth.users",
  function: "public.handle_new_user()",
  enabled: "O",
  for_each_row: true,
  timing: "AFTER",
  on_insert: true,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readFrozen(relativePath, expectedSha256) {
  const bytes = readFileSync(join(ROOT, ...relativePath.split("/")));
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `REFUSED: ${relativePath} SHA-256 is ${actualSha256}; expected ${expectedSha256}.`
    );
  }
  return bytes.toString("utf8");
}

export function assertFrozenArtifacts() {
  for (const file of [...FROZEN_FILES, ...FROZEN_EVIDENCE]) {
    readFrozen(file.relativePath, file.sha256);
  }
  // Loading the manifests verifies their independently pinned source evidence.
  loadPreApplyManifest();
  loadPostApplyManifest();
  return true;
}

function productionManifest(state) {
  const base =
    state === "preapply" ? loadPreApplyManifest() : loadPostApplyManifest();
  const sections = structuredClone(base.sections);
  sections.auth_signup_trigger = { ...STANDARD_SIGNUP_TRIGGER_SUMMARY };
  sections.auth_user_triggers = [
    { ...STANDARD_SIGNUP_TRIGGER },
    { ...TENANT_SIGNUP_TRIGGER },
  ];
  return Object.freeze({
    manifestVersion: `canvas-p1-production-${state}-v1`,
    sections: Object.freeze(sections),
  });
}

function introspectionAsCatalogCte() {
  const raw = readFileSync(INTROSPECTION_PATH, "utf8");
  const marker = "\nSELECT json_build_object(";
  const index = raw.lastIndexOf(marker);
  if (index < 0) {
    throw new Error("REFUSED: Batch 2 introspection final SELECT marker is missing.");
  }

  const prefix = raw.slice(0, index);
  const select = raw
    .slice(index + 1)
    .replace(/^SELECT json_build_object\(/, "SELECT jsonb_build_object(")
    .replace(/\)::text;\s*$/, ") AS payload");

  if (!select.endsWith(" AS payload")) {
    throw new Error("REFUSED: Batch 2 introspection final SELECT shape drifted.");
  }

  return { prefix, select };
}

function expectedCatalogCtes(sections) {
  const { prefix, select } = introspectionAsCatalogCte();
  const expectedJson = JSON.stringify(sections);
  const dollarTag = "$canvas_p1_expected$";
  if (expectedJson.includes(dollarTag)) {
    throw new Error("REFUSED: expected catalog collides with the SQL dollar-quote tag.");
  }

  const names = Object.keys(sections);
  const values = names.map((name) => `('${name}')`).join(",\n        ");

  return `${prefix},
actual_catalog AS (
${select}
),
expected_catalog AS (
    SELECT ${dollarTag}${expectedJson}${dollarTag}::jsonb AS payload
),
required_sections(name) AS (
    VALUES ${values}
),
section_results AS (
    SELECT s.name,
           CASE
             WHEN NOT (a.payload ? s.name) OR NOT (e.payload ? s.name) THEN false
             WHEN jsonb_typeof(a.payload -> s.name) = 'array'
              AND jsonb_typeof(e.payload -> s.name) = 'array' THEN
               NOT EXISTS (
                 (SELECT value, count(*) AS n
                    FROM jsonb_array_elements(a.payload -> s.name)
                   GROUP BY value
                  EXCEPT
                  SELECT value, count(*) AS n
                    FROM jsonb_array_elements(e.payload -> s.name)
                   GROUP BY value)
                 UNION ALL
                 (SELECT value, count(*) AS n
                    FROM jsonb_array_elements(e.payload -> s.name)
                   GROUP BY value
                  EXCEPT
                  SELECT value, count(*) AS n
                    FROM jsonb_array_elements(a.payload -> s.name)
                   GROUP BY value)
               )
             ELSE (a.payload -> s.name) = (e.payload -> s.name)
           END AS matches,
           CASE WHEN jsonb_typeof(a.payload -> s.name) = 'array'
                THEN jsonb_array_length(a.payload -> s.name) END AS actual_rows,
           CASE WHEN jsonb_typeof(e.payload -> s.name) = 'array'
                THEN jsonb_array_length(e.payload -> s.name) END AS expected_rows
      FROM required_sections s
      CROSS JOIN actual_catalog a
      CROSS JOIN expected_catalog e
)`;
}

function readOnlySummaryTail({ state }) {
  const postApply = state === "postapply";
  const postApplyFields = postApply
    ? `,
    'unknown_submission_generations',
        (SELECT count(*) FROM public.generations
          WHERE provider_submission_state = 'unknown'),
    'negative_credit_profiles',
        (SELECT count(*) FROM public.profiles WHERE credits < 0),
    'duplicate_operation_anchors',
        (SELECT count(*) FROM (
            SELECT user_id, operation_anchor
              FROM public.credit_transactions
             WHERE operation_anchor IS NOT NULL
             GROUP BY user_id, operation_anchor
            HAVING count(*) > 1
        ) duplicate_anchors)`
    : "";

  return `,
generation_status_counts AS (
    SELECT coalesce(jsonb_object_agg(coalesce(status, '<null>'), n), '{}'::jsonb) AS payload
      FROM (
        SELECT status, count(*) AS n
          FROM public.generations
         GROUP BY status
      ) grouped_statuses
),
activity_counts AS (
    SELECT count(*) FILTER (WHERE state <> 'idle') AS nonidle_other_sessions,
           count(*) FILTER (
             WHERE state <> 'idle'
               AND query ~* '(generation|refund|reconcil|credit_transactions)'
           ) AS scoped_nonidle_sessions
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
)
SELECT jsonb_build_object(
    'state', '${state}',
    'database', current_database(),
    'database_user', current_user,
    'server_version_num', current_setting('server_version_num'),
    'catalog_section_count', count(*),
    'catalog_all_match', bool_and(matches),
    'catalog_mismatches',
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'section', name,
              'actual_rows', actual_rows,
              'expected_rows', expected_rows
            )
            ORDER BY name
          ) FILTER (WHERE NOT matches),
          '[]'::jsonb
        ),
    'profiles_count', (SELECT count(*) FROM public.profiles),
    'canvases_count', (SELECT count(*) FROM public.canvases),
    'generations_count', (SELECT count(*) FROM public.generations),
    'credit_transactions_count', (SELECT count(*) FROM public.credit_transactions),
    'generation_status_counts', (SELECT payload FROM generation_status_counts),
    'nonterminal_generations',
        (SELECT count(*) FROM public.generations
          WHERE coalesce(status, '') NOT IN ('completed', 'failed')),
    'recent_generations_30m',
        (SELECT count(*) FROM public.generations
          WHERE created_at >= now() - interval '30 minutes'),
    'recent_started_30m',
        (SELECT count(*) FROM public.generations
          WHERE started_at >= now() - interval '30 minutes'),
    'newest_nonterminal_created_at',
        (SELECT max(created_at) FROM public.generations
          WHERE coalesce(status, '') NOT IN ('completed', 'failed')),
    'nonidle_other_sessions', (SELECT nonidle_other_sessions FROM activity_counts),
    'scoped_nonidle_sessions', (SELECT scoped_nonidle_sessions FROM activity_counts),
    'checked_at', clock_timestamp()${postApplyFields}
) AS canvas_p1_production_${state}
FROM section_results;`;
}

export function buildReadOnlyOperation(state = "preapply") {
  assertFrozenArtifacts();
  if (state !== "preapply" && state !== "postapply") {
    throw new Error("state must be preapply or postapply");
  }
  const manifest = productionManifest(state);
  return `${expectedCatalogCtes(manifest.sections)}${readOnlySummaryTail({ state })}`;
}

export function buildCatalogTransactionGuard(state) {
  const manifest = productionManifest(state);
  const extraDeclarations =
    state === "preapply"
      ? `
    recent_generation_count bigint;
    scoped_activity_count bigint;`
      : `
    negative_credit_count bigint;
    duplicate_anchor_count bigint;`;
  const extraChecks =
    state === "preapply"
      ? `
    SELECT count(*)
      INTO recent_generation_count
      FROM public.generations
     WHERE created_at >= pg_catalog.now() - interval '30 minutes'
        OR started_at >= pg_catalog.now() - interval '30 minutes';
    IF recent_generation_count <> 0 THEN
      RAISE EXCEPTION
        'Canvas P1 production guard: % generation(s) created/started in the last 30 minutes; migration deferred',
        recent_generation_count;
    END IF;

    SELECT count(*)
      INTO scoped_activity_count
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND state <> 'idle'
       AND query ~* '(generation|refund|reconcil|credit_transactions)';
    IF scoped_activity_count <> 0 THEN
      RAISE EXCEPTION
        'Canvas P1 production guard: % scoped active session(s); migration deferred',
        scoped_activity_count;
    END IF;`
      : `
    SELECT count(*)
      INTO negative_credit_count
      FROM public.profiles
     WHERE credits < 0;
    IF negative_credit_count <> 0 THEN
      RAISE EXCEPTION
        'Canvas P1 production guard: % negative-credit profile(s)',
        negative_credit_count;
    END IF;

    SELECT count(*)
      INTO duplicate_anchor_count
      FROM (
        SELECT user_id, operation_anchor
          FROM public.credit_transactions
         WHERE operation_anchor IS NOT NULL
         GROUP BY user_id, operation_anchor
        HAVING count(*) > 1
      ) duplicate_anchors;
    IF duplicate_anchor_count <> 0 THEN
      RAISE EXCEPTION
        'Canvas P1 production guard: % duplicate operation anchor(s)',
        duplicate_anchor_count;
    END IF;`;

  return `DO $canvas_p1_${state}_guard$
DECLARE
    mismatch_count integer;${extraDeclarations}
BEGIN
${expectedCatalogCtes(manifest.sections)}
    SELECT count(*) FILTER (WHERE NOT matches)
      INTO mismatch_count
      FROM section_results;

    IF mismatch_count <> 0 THEN
      RAISE EXCEPTION
        'Canvas P1 production ${state} catalog guard: % mismatched section(s)',
        mismatch_count;
    END IF;
${extraChecks}
END
$canvas_p1_${state}_guard$;`;
}

export function buildMigrationOperation() {
  assertFrozenArtifacts();
  const migrationBlocks = FROZEN_FILES.map((file) => {
    const sql = readFrozen(file.relativePath, file.sha256);
    return `-- BEGIN FROZEN ${file.relativePath} SHA-256 ${file.sha256}
${sql.trim()}
-- END FROZEN ${file.relativePath}`;
  }).join("\n\n");

  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SELECT pg_advisory_xact_lock(hashtextextended('canvas-p1-production-20260728', 0));

${buildCatalogTransactionGuard("preapply")}

-- The production-only tenant trigger has been proven byte-for-byte by the
-- pre-apply catalog guard. Drop it only inside this still-uncommitted batch so
-- the frozen Canvas migration can enforce its single-signup-trigger invariant.
DROP TRIGGER on_auth_user_created_create_tenant ON auth.users;

${migrationBlocks}

-- Restore the independently scoped tenant initializer before the post-apply
-- catalog guard and before COMMIT. No intermediate state is externally visible.
CREATE TRIGGER on_auth_user_created_create_tenant
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_create_tenant_for_user();

${buildCatalogTransactionGuard("postapply")}

COMMIT;
`;
}

function usage() {
  return "Usage: node scripts/canvas-p1-production-operation.mjs <preflight|migrate|postflight>";
}

function main(argv) {
  const command = argv[0];
  if (command === "preflight") return buildReadOnlyOperation("preapply");
  if (command === "migrate") return buildMigrationOperation();
  if (command === "postflight") return buildReadOnlyOperation("postapply");
  throw new Error(usage());
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
