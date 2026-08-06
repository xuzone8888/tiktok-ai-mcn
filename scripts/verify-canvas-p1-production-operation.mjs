#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FROZEN_EVIDENCE,
  FROZEN_FILES,
  assertFrozenArtifacts,
  buildMigrationOperation,
  buildReadOnlyOperation,
} from "./canvas-p1-production-operation.mjs";

const ROOT = new URL("../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
let passed = 0;

function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

check(assertFrozenArtifacts() === true, "all frozen migration/evidence hashes load");

const preflight = buildReadOnlyOperation("preapply");
const migrate = buildMigrationOperation();
const postflight = buildReadOnlyOperation("postapply");

check(
  digest(preflight) === "50f1e5430a6329c94ca9c67c9042fca83049564c12ccca6043c2956f05d3abf6",
  "preflight operation hash is frozen"
);
check(
  digest(migrate) === "edb602e91e058b1c27f8a6153bdf3e499b3af2636ddf08b4b5b98575c9eea196",
  "migration operation hash is frozen"
);
check(
  digest(postflight) === "e62a7db40fcea603bf98df8f71d2aaca5fe837dfab6af0e94926e408adbd17aa",
  "postflight operation hash is frozen"
);

check(!/^BEGIN;$/m.test(preflight), "preflight has no write transaction");
check(!/^COMMIT;$/m.test(preflight), "preflight has no commit");
check(
  preflight.trimEnd().endsWith("FROM section_results;"),
  "preflight is one catalog/count SELECT"
);
check(
  preflight.includes("'catalog_all_match', bool_and(matches)"),
  "preflight reports the complete catalog verdict"
);
check(
  preflight.includes("'recent_generations_30m'") &&
    preflight.includes("'recent_started_30m'") &&
    preflight.includes("'scoped_nonidle_sessions'"),
  "preflight reports maintenance-window activity gates"
);
check(
  preflight.includes("on_auth_user_created_create_tenant") &&
    preflight.includes("public.auto_create_tenant_for_user()"),
  "preflight freezes the production-only tenant trigger identity"
);
check(
  !preflight.includes("DROP TRIGGER on_auth_user_created_create_tenant"),
  "preflight contains no tenant-trigger DDL"
);

check((migrate.match(/^BEGIN;$/gm) ?? []).length === 1, "migration has one BEGIN");
check((migrate.match(/^COMMIT;$/gm) ?? []).length === 1, "migration has one COMMIT");
check(
  migrate.indexOf("BEGIN;") < migrate.indexOf("COMMIT;"),
  "migration transaction boundaries are ordered"
);
check(
  migrate.includes("pg_advisory_xact_lock") &&
    migrate.includes("SET LOCAL lock_timeout = '5s'") &&
    migrate.includes("SET LOCAL statement_timeout = '15min'"),
  "migration carries the advisory, lock, and statement-timeout gates"
);
check(
  (migrate.match(/^DROP TRIGGER on_auth_user_created_create_tenant/gm) ?? []).length === 1,
  "migration drops the proven tenant trigger exactly once"
);
check(
  (migrate.match(/^CREATE TRIGGER on_auth_user_created_create_tenant/gm) ?? []).length === 1,
  "migration recreates the proven tenant trigger exactly once"
);

let previousMigrationIndex = -1;
for (const frozen of FROZEN_FILES) {
  const absolute = join(ROOT_PATH, ...frozen.relativePath.split("/"));
  const source = readFileSync(absolute, "utf8").trim();
  const beginMarker =
    `-- BEGIN FROZEN ${frozen.relativePath} SHA-256 ${frozen.sha256}`;
  const markerIndex = migrate.indexOf(beginMarker);
  check(markerIndex > previousMigrationIndex, `${frozen.relativePath} is in frozen order`);
  check(
    migrate.includes(`${beginMarker}\n${source}\n-- END FROZEN ${frozen.relativePath}`),
    `${frozen.relativePath} bytes are embedded unchanged`
  );
  previousMigrationIndex = markerIndex;
}

const tenantDropIndex = migrate.indexOf(
  "DROP TRIGGER on_auth_user_created_create_tenant"
);
const firstMigrationIndex = migrate.indexOf("-- BEGIN FROZEN");
const lastMigrationEndIndex = migrate.lastIndexOf("-- END FROZEN");
const tenantCreateIndex = migrate.indexOf(
  "CREATE TRIGGER on_auth_user_created_create_tenant"
);
const postGuardIndex = migrate.indexOf("DO $canvas_p1_postapply_guard$");

check(tenantDropIndex < firstMigrationIndex, "tenant trigger drops before frozen migrations");
check(
  tenantCreateIndex > lastMigrationEndIndex,
  "tenant trigger recreates after frozen migrations"
);
check(tenantCreateIndex < postGuardIndex, "tenant trigger recreates before post-apply guard");
check(
  migrate.indexOf("DO $canvas_p1_preapply_guard$") < tenantDropIndex,
  "complete pre-apply guard runs before tenant-trigger DDL"
);
check(postGuardIndex < migrate.lastIndexOf("COMMIT;"), "post-apply guard runs before COMMIT");
check(
  migrate.includes("SELECT user_id, operation_anchor") &&
    migrate.includes("GROUP BY user_id, operation_anchor"),
  "migration guard detects operation-anchor duplicates within each user"
);

for (const frozen of FROZEN_FILES) {
  check(
    migrate.includes(frozen.sha256),
    `${frozen.relativePath} is hash-verified by the generator`);
}

for (const frozen of FROZEN_EVIDENCE) {
  const absolute = join(ROOT_PATH, ...frozen.relativePath.split("/"));
  check(
    digest(readFileSync(absolute)) === frozen.sha256,
    `${frozen.relativePath} evidence hash is frozen`
  );
}

check(!/^BEGIN;$/m.test(postflight), "postflight has no write transaction");
check(!/^COMMIT;$/m.test(postflight), "postflight has no commit");
check(
  postflight.includes("'negative_credit_profiles'") &&
    postflight.includes("'duplicate_operation_anchors'") &&
    postflight.includes("'unknown_submission_generations'"),
  "postflight reports the ledger/reconciliation safety counts"
);
check(
  postflight.includes("provider_submission_state = 'unknown'") &&
    !postflight.includes("provider_submission_state = 'submission_unknown'"),
  "postflight uses the real provider submission-state enum"
);
check(
  postflight.includes("SELECT user_id, operation_anchor") &&
    postflight.includes("GROUP BY user_id, operation_anchor"),
  "postflight detects operation-anchor duplicates within each user"
);
check(
  postflight.includes("on_auth_user_created_create_tenant") &&
    postflight.includes("public.auto_create_tenant_for_user()"),
  "postflight freezes the restored production tenant trigger"
);

console.log(
  `Canvas P1 production operation verifier: ${passed}/${passed} assertions passed`
);
