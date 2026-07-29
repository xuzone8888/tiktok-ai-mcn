#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDITIVE_MIGRATIONS,
  assertAdditiveFrozenArtifacts,
  buildMigrationOperation,
  buildPostflightOperation,
  buildPreflightOperation,
} from "./canvas-additive-production-operation.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const OPERATION_PATH = join(
  SCRIPT_DIR,
  "canvas-additive-production-operation.mjs"
);

const EXPECTED_MIGRATIONS = Object.freeze([
  ["supabase/migrations/20260729_canvas_project_lifecycle.sql", "49945b1ed0f79212d035b0eb26f605359dda0e3a1a622fb9c31db94a4c277d61"],
  ["supabase/migrations/20260730_canvas_generation_recovery.sql", "12186f6c6701e39dc19e24f7f4b65cf03e57c06e776777ae534dd054ae6f4d13"],
  ["supabase/migrations/20260731_canvas_runtime_health.sql", "1971ca6f4d2efa9189aa7763e67c186298da2e6a39790ff8defe8d04772efc5b"],
  ["supabase/migrations/20260801_canvas_upload_registry.sql", "5a453df313548f3db314660522c298aefa8baa8dc0a0ba3c8bfde397bd2297ba"],
]);

const EXPECTED_OUTPUT_HASHES = Object.freeze({
  preflight: "25aedc53c9ccb2cfddf8c6cf2395e5c1b0ee03b8e08502a422ed13f480957ace",
  migrate: "e04318dca3393d3810931e3150b92c48d9fea8636433b4f556d17347cf82e0d4",
  postflight: "c9143cf923894509a33fc9a570bc79527ea7b4a505364d0dcaa3eb7f8af6ae78",
});

const TRANSACTION_BOUNDARY_RE =
  /^\s*(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|COMMIT(?:\s+(?:WORK|TRANSACTION))?)\s*;/gim;

let passed = 0;
const failures = [];
function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function cli(mode) {
  return execFileSync(process.execPath, [OPERATION_PATH, mode], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

ok(assertAdditiveFrozenArtifacts() === true, "base and additive artifacts freeze cleanly");
ok(
  JSON.stringify(
    ADDITIVE_MIGRATIONS.map((item) => [item.relativePath, item.sha256])
  ) === JSON.stringify(EXPECTED_MIGRATIONS),
  "operation exports the exact ordered migration manifest"
);

const sources = [];
for (const [relativePath, expectedHash] of EXPECTED_MIGRATIONS) {
  const bytes = readFileSync(join(ROOT, ...relativePath.split("/")));
  const source = bytes.toString("utf8");
  sources.push({ relativePath, expectedHash, source });
  ok(sha256(bytes) === expectedHash, `${relativePath} SHA-256 is frozen`);
  ok(
    !TRANSACTION_BOUNDARY_RE.test(source),
    `${relativePath} has no nested transaction boundary`
  );
  TRANSACTION_BOUNDARY_RE.lastIndex = 0;
}

const operationSource = readFileSync(OPERATION_PATH, "utf8");
ok(
  operationSource.includes("assertBaseFrozenArtifacts();"),
  "additive freeze explicitly invokes the base P1 freeze"
);
ok(
  operationSource.includes("TRANSACTION_BOUNDARY_RE.test(sql)"),
  "operation refuses migration-local transaction boundaries"
);

const outputs = {
  preflight: buildPreflightOperation(),
  migrate: buildMigrationOperation(),
  postflight: buildPostflightOperation(),
};

for (const [mode, sql] of Object.entries(outputs)) {
  ok(
    sha256(sql) === EXPECTED_OUTPUT_HASHES[mode],
    `${mode} output SHA-256 is frozen`
  );
  ok(cli(mode) === sql, `${mode} CLI output equals the reviewed builder output`);
  ok(
    (sql.match(/^BEGIN;$/gm) ?? []).length === 1 &&
      (sql.match(/^COMMIT;$/gm) ?? []).length === 1,
    `${mode} has one outer BEGIN/COMMIT`
  );
}

const preflight = outputs.preflight;
const migrate = outputs.migrate;
const postflight = outputs.postflight;

const baseGuard = "DO $canvas_p1_postapply_guard$";
const preflightAbsence = "DO $canvas_additive_preflight_guard$";
ok(
  preflight.indexOf(baseGuard) >= 0 &&
    preflight.indexOf(baseGuard) < preflight.indexOf(preflightAbsence),
  "preflight runs the exact base postapply catalog guard first"
);
ok(
  preflight.includes("SET TRANSACTION READ ONLY;") &&
    preflight.includes("SET LOCAL lock_timeout = '5s';") &&
    preflight.includes("SET LOCAL statement_timeout = '5min';"),
  "preflight is bounded and read-only"
);
ok(
  preflight.includes("relation already exists") &&
    preflight.includes("function already exists") &&
    preflight.includes("incremental trigger already exists") &&
    preflight.includes("authenticated canvases INSERT is not the expected pre-apply grant"),
  "preflight proves all additive objects absent and the old INSERT grant present"
);
ok(
  preflight.includes("'incremental_relation_count'") &&
    preflight.includes("'incremental_function_count'") &&
    preflight.includes("'incremental_trigger_count'") &&
    preflight.includes("'authenticated_can_insert_canvases'"),
  "preflight emits additive absence and grant evidence"
);

ok(
  !migrate.includes("SET TRANSACTION READ ONLY;") &&
    migrate.includes("SET LOCAL lock_timeout = '5s';") &&
    migrate.includes("SET LOCAL statement_timeout = '15min';"),
  "migration has bounded write-transaction timeouts"
);
ok(
  migrate.includes("canvas-additive-production-20260801") &&
    !migrate.includes("canvas-p1-production-20260728"),
  "migration uses an independent additive advisory-lock identity"
);
ok(
  count(migrate, baseGuard) === 1,
  "migration runs the base postapply guard only before additive DDL"
);

const migratePrecondition = "DO $canvas_additive_migrate_precondition$";
const firstMarker = `-- START FROZEN ${sources[0].relativePath}`;
ok(
  migrate.indexOf(baseGuard) < migrate.indexOf(migratePrecondition) &&
    migrate.indexOf(migratePrecondition) < migrate.indexOf(firstMarker),
  "base guard and additive precondition both precede the first migration"
);
const beforeFirstMigration = migrate.slice(0, migrate.indexOf(firstMarker));
ok(
  !/^(?:CREATE|ALTER|DROP|REVOKE|GRANT|COMMENT|NOTIFY)\b/im.test(
    beforeFirstMigration
  ),
  "no durable DDL appears before the additive precondition"
);

let previousMarker = -1;
for (const { relativePath, expectedHash, source } of sources) {
  const marker = `-- START FROZEN ${relativePath} SHA-256 ${expectedHash}\n`;
  const markerIndex = migrate.indexOf(marker);
  ok(markerIndex > previousMarker, `${relativePath} is embedded in required order`);
  const sourceStart = markerIndex + marker.length;
  ok(
    migrate.slice(sourceStart, sourceStart + source.length) === source,
    `${relativePath} source bytes are embedded unchanged`
  );
  ok(
    count(migrate, `-- START FROZEN ${relativePath}`) === 1 &&
      count(migrate, `-- END FROZEN ${relativePath}`) === 1,
    `${relativePath} is embedded exactly once`
  );
  previousMarker = markerIndex;
}

const postcondition = "DO $canvas_additive_postcondition$";
ok(
  migrate.indexOf(postcondition) > previousMarker &&
    migrate.indexOf(postcondition) < migrate.lastIndexOf("\nCOMMIT;"),
  "custom postcondition runs after all four sources and before COMMIT"
);
ok(
  migrate.includes("v_health.contract_version IS DISTINCT FROM 'canvas-production-health-v1'") &&
    migrate.includes("v_health.read_only_probe IS DISTINCT FROM true") &&
    migrate.includes("v_health.required_rpc_count IS DISTINCT FROM 27"),
  "postcondition enforces exact health v1/read-only/27"
);
ok(
  migrate.includes("function security drift") &&
    migrate.includes("table RLS drift") &&
    migrate.includes("table ACL drift") &&
    migrate.includes("constraint missing/unvalidated") &&
    migrate.includes("append-only trigger drift"),
  "postcondition enforces function ACL/search_path, table RLS/ACL, constraints and trigger"
);
ok(
  migrate.includes("legacy INSERT bridge trigger drift") &&
    migrate.includes("legacy INSERT bridge ACL drift") &&
    migrate.includes("negative-credit profile(s)") &&
    migrate.includes("duplicate user anchor(s)"),
  "postcondition enforces the capped rollback bridge and zero financial anomalies"
);
ok(
  migrate.includes("v_search_path IS DISTINCT FROM ''") &&
    !migrate.includes("${FUNCTION_REQUIREMENTS"),
  "postcondition requires empty function search paths without template leakage"
);
ok(
  migrate.lastIndexOf(baseGuard) < migrate.indexOf(firstMarker),
  "base catalog guard is never reused after the intentional canvases ACL change"
);

ok(
  postflight.includes("SET TRANSACTION READ ONLY;") &&
    !postflight.includes("DO $canvas_additive_postcondition$"),
  "postflight is a read-only evidence query"
);
ok(
  postflight.includes("'health_contract_version'") &&
    postflight.includes("'health_read_only_probe'") &&
    postflight.includes("'health_required_rpc_count'") &&
    postflight.includes("'negative_credit_profiles'") &&
    postflight.includes("'duplicate_user_anchors'"),
  "postflight emits exact health and financial counts"
);
ok(
  postflight.includes("'incremental_table_security_ok'") &&
    postflight.includes("'incremental_function_security_ok'") &&
    postflight.includes("'incremental_indexes_ok'") &&
    postflight.includes("'append_only_trigger_ok'") &&
    postflight.includes("'project_insert_bridge_ok'") &&
    postflight.includes("'incremental_constraints_exact'"),
  "postflight emits read-only security booleans"
);

if (failures.length > 0) {
  console.error(
    `Canvas additive production operation verification failed (${passed} passed, ${failures.length} failed):`
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Canvas additive production operation verification passed: ${passed}/${passed}`
  );
}
