#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · verifier.
 *
 * DISTINCT from `scripts/verify-canvas-p1-fixture.mjs`. That verifier's accepted
 * 115 assertions are not touched, weakened, re-implemented or re-run here.
 *
 * MODES
 * ---------------------------------------------------------------------------
 *   (default)    offline. ZERO database contact. Runs the guard and static
 *                gates, proves every declared runtime scenario has a real
 *                callable implementation, and reports runtime as 0/N.
 *   --runtime    explicit opt-in. Executes the real PostgreSQL scenarios.
 *                Requires CANVAS_P1_TARGET=fixture|remote. For remote it also
 *                requires CANVAS_P1_REMOTE_REF plus CANVAS_P1_SSLROOTCERT, and
 *                the read-only write gate must pass before the first write.
 *   --remote-preflight
 *                Runs the closed server-enforced READ ONLY identity/version/
 *                zero-data/exact-catalog gate for the explicitly declared
 *                CANVAS_P1_REMOTE_STATE=preapply|postapply, then exits without
 *                applying a migration or opening a write session.
 *   --inspect-preapply
 *                Phase 3A diagnostic only. Re-runs the same READ ONLY gate and
 *                prints a narrowly redacted diff for the three pre-apply
 *                sections that can drift across Supabase platform revisions.
 *   --list-runtime  print the scenario -> implementation mapping.
 *
 * GATE CLASSES ARE NEVER CONFLATED. Guard/static counts and runtime counts are
 * reported separately, and a scenario NAME is never evidence: the registry check
 * below fails the offline run if any declared test lacks an implementation.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_REMOTE_ENDPOINT,
  ALLOWED_REMOTE_REF,
  EXPECTED_REMOTE_CA_SHA256,
  FORBIDDEN_PRODUCTION_REF,
  PROBES,
  REQUIRED_POST_APPLY_SECTIONS,
  REQUIRED_PRE_APPLY_SECTIONS,
  SSLROOTCERT_ENV,
  TargetRefusal,
  UNPROVEN,
  assertNoProductionReference,
  assertNoRemoteDestructiveCapability,
  assertRemotePostApplyWriteAllowed,
  assertRemoteRuntimeRecoveryWriteAllowed,
  assertRemoteTlsRootCertificate,
  assertRemoteWriteAllowed,
  buildChildEnv,
  buildProbeScript,
  buildReadOnlyChildEnv,
  canon,
  compareCatalogSections,
  inspectRemoteRuntimeRecovery,
  isGated,
  readCatalog,
  resolveTarget,
  runReadOnlyProbe,
  runWrite,
  sectionDigest,
  sha256Hex,
} from "./fixtures/canvas-p1/batch2/target.mjs";
import {
  REGISTRY,
  SCENARIOS,
  assertEveryScenarioImplemented,
} from "./fixtures/canvas-p1/batch2/scenarios.mjs";
import {
  buildCleanupSqlForUserIds,
  callsiteGuard,
  capturePostApplyEvidence,
  cleanupTrackedUserIds,
  loadCallsiteAllowlist,
  MIGRATION_LOCKS,
  proveRemoteTestTablesEmpty,
  proveCallsiteGuardDetectsAddition,
  runRuntime,
  verifyMigrationLocks,
} from "./fixtures/canvas-p1/batch2/runtime.mjs";
import {
  POST_APPLY_CATALOG_SHA256,
  loadPostApplyManifest,
  loadPreApplyManifest,
  loadReapplyManifest,
  unprovenSections,
} from "./fixtures/canvas-p1/batch2/manifests.mjs";
import { scanRepository } from "./fixtures/canvas-p1/batch2/callsites.mjs";
import {
  MAX_CONCURRENT_SESSION_WORKERS,
  PsqlSession,
  buildConcurrentSessionSchedule,
  buildSessionRequest,
} from "./fixtures/canvas-p1/batch2/session.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
const FIXTURE_DIR = join(__dirname, "fixtures", "canvas-p1");
const REMOTE_LOCKS_PATH = join(FIXTURE_DIR, "batch2", "remote-preflight-locks.json");

const REQUIRED_REMOTE_LOCKED_FILES = Object.freeze([
  "scripts/verify-canvas-p1-batch2.mjs",
  "scripts/fixtures/canvas-p1/identity.mjs",
  "scripts/fixtures/canvas-p1/expected-catalog.json",
  "scripts/fixtures/canvas-p1/batch2/callsite-allowlist.json",
  "scripts/fixtures/canvas-p1/batch2/callsites.mjs",
  "scripts/fixtures/canvas-p1/batch2/manifest-additions.json",
  "scripts/fixtures/canvas-p1/batch2/manifests.mjs",
  "scripts/fixtures/canvas-p1/batch2/post-apply-catalog.json",
  "scripts/fixtures/canvas-p1/batch2/runtime.mjs",
  "scripts/fixtures/canvas-p1/batch2/scenarios.mjs",
  "scripts/fixtures/canvas-p1/batch2/session.mjs",
  "scripts/fixtures/canvas-p1/batch2/sql/batch2-introspect.sql",
  "scripts/fixtures/canvas-p1/batch2/target.mjs",
  "supabase/migrations/20260715_generations_service_role_policy.sql",
  "supabase/migrations/20260716_canvas_p1_lifecycle_foundation.sql",
  "supabase/migrations/20260717_canvas_p1_credit_boundary.sql",
  "supabase/migrations/20260718_canvas_p1_generation_api.sql",
  "supabase/migrations/20260719_canvas_p1_reconciliation.sql",
]);

const MIGRATION_FILES = Object.freeze({
  policy: "20260715_generations_service_role_policy.sql",
  foundation: "20260716_canvas_p1_lifecycle_foundation.sql",
  credit: "20260717_canvas_p1_credit_boundary.sql",
  api: "20260718_canvas_p1_generation_api.sql",
  reconcile: "20260719_canvas_p1_reconciliation.sql",
});

let passed = 0;
const failures = [];

function ok(condition, label, cls) {
  if (condition) passed += 1;
  else failures.push(`[${cls}] ${label}`);
}

function refuses(fn, label) {
  try {
    fn();
    failures.push(`[GUARD] ${label} — expected refusal, but the call SUCCEEDED`);
  } catch (err) {
    if (err instanceof TargetRefusal) passed += 1;
    else failures.push(`[GUARD] ${label} — threw ${err.name}, expected TargetRefusal: ${err.message}`);
  }
}

function readMigration(key) {
  const p = join(MIGRATIONS, MIGRATION_FILES[key]);
  if (!existsSync(p)) throw new Error(`missing migration ${MIGRATION_FILES[key]}`);
  return readFileSync(p, "utf8");
}

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * Freeze every file that can select, identify, migrate or exercise the Preview
 * target. This gate runs before any runtime/capture branch, so a changed
 * harness cannot silently ride on the five migration hashes alone.
 */
function gateRemoteFileLocks() {
  if (!existsSync(REMOTE_LOCKS_PATH)) {
    failures.push("[GUARD] remote preflight lock manifest is missing");
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(REMOTE_LOCKS_PATH, "utf8"));
  } catch (err) {
    failures.push(`[GUARD] remote preflight lock manifest is invalid — ${err.message}`);
    return;
  }

  ok(
    manifest.version === "canvas-p1-remote-preflight-v1",
    "remote preflight lock manifest has the reviewed version",
    "GUARD"
  );

  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  const actualPaths = entries.map((entry) => entry.path).sort();
  const requiredPaths = [...REQUIRED_REMOTE_LOCKED_FILES].sort();
  ok(
    JSON.stringify(actualPaths) === JSON.stringify(requiredPaths),
    `remote preflight lock manifest covers the exact ${requiredPaths.length}-file execution surface`,
    "GUARD"
  );

  for (const entry of entries) {
    const safePath =
      typeof entry.path === "string" &&
      !entry.path.includes("\\") &&
      !entry.path.startsWith("/") &&
      !entry.path.split("/").includes("..");
    if (!safePath || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
      failures.push(`[GUARD] invalid remote preflight lock entry for ${JSON.stringify(entry.path)}`);
      continue;
    }
    const path = join(REPO_ROOT, ...entry.path.split("/"));
    if (!existsSync(path)) {
      failures.push(`[GUARD] locked remote preflight file is missing: ${entry.path}`);
      continue;
    }
    const actual = sha256Hex(readFileSync(path));
    ok(actual === entry.sha256, `remote preflight byte lock matches ${entry.path}`, "GUARD");
  }
}

const FAKE_CERT = join(FIXTURE_DIR, "batch2", "target.mjs"); // any existing file

// ###########################################################################
// GATE 1 [GUARD] — production is unreachable; the endpoint is exact
// ###########################################################################
function gateGuards() {
  const goodEnv = { [SSLROOTCERT_ENV]: FAKE_CERT };

  refuses(
    () => resolveTarget({ mode: "remote", remoteRef: FORBIDDEN_PRODUCTION_REF }, goodEnv),
    "explicit production ref is refused"
  );
  refuses(
    () => resolveTarget({ mode: "remote", remoteRef: "someotherprojectref01" }, goodEnv),
    "a non-allow-listed ref is refused"
  );
  refuses(() => resolveTarget({ mode: "remote" }, goodEnv), "missing remote ref is refused");
  refuses(() => resolveTarget({ mode: "remote", remoteRef: "   " }, goodEnv), "blank remote ref is refused");
  refuses(() => resolveTarget({ mode: "production" }, goodEnv), "unknown mode is refused");
  refuses(() => resolveTarget({}, goodEnv), "absent mode is refused");

  // substring/prefix attacks on the ref itself
  refuses(
    () => resolveTarget({ mode: "remote", remoteRef: `${ALLOWED_REMOTE_REF}x` }, goodEnv),
    "a ref with the allowed ref as a PREFIX is refused (no substring matching)"
  );
  refuses(
    () => resolveTarget({ mode: "remote", remoteRef: `x${ALLOWED_REMOTE_REF}` }, goodEnv),
    "a ref CONTAINING the allowed ref is refused"
  );

  // libpq indirection is refused outright for remote
  for (const v of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) {
    refuses(
      () => resolveTarget({ mode: "remote", remoteRef: ALLOWED_REMOTE_REF }, { ...goodEnv, [v]: "x" }),
      `${v} indirection is refused in remote mode`
    );
  }
  refuses(
    () => assertNoProductionReference({ PGHOSTADDR: FORBIDDEN_PRODUCTION_REF }),
    "production ref in PGHOSTADDR is refused"
  );

  // TLS root cert is mandatory and must exist
  refuses(
    () => resolveTarget({ mode: "remote", remoteRef: ALLOWED_REMOTE_REF }, {}),
    "remote without a TLS root cert is refused"
  );
  refuses(
    () =>
      resolveTarget(
        { mode: "remote", remoteRef: ALLOWED_REMOTE_REF },
        { [SSLROOTCERT_ENV]: join(FIXTURE_DIR, "does-not-exist.crt") }
      ),
    "remote with a missing TLS root cert file is refused"
  );

  // the ONE legal remote target
  let remote = null;
  try {
    remote = resolveTarget({ mode: "remote", remoteRef: ALLOWED_REMOTE_REF }, goodEnv);
    ok(remote.ref === ALLOWED_REMOTE_REF, "allowed Preview Branch ref resolves", "GUARD");
    ok(
      remote.host === ALLOWED_REMOTE_ENDPOINT.host &&
        remote.port === ALLOWED_REMOTE_ENDPOINT.port &&
        remote.database === ALLOWED_REMOTE_ENDPOINT.database &&
        remote.user === ALLOWED_REMOTE_ENDPOINT.user &&
        remote.backendUser === ALLOWED_REMOTE_ENDPOINT.backendUser,
      "remote endpoint is the compiled-in reviewed tuple",
      "GUARD"
    );
    ok(remote.sslmode === "verify-full", "remote requires TLS verify-full against the exact host", "GUARD");
    ok(
      EXPECTED_REMOTE_CA_SHA256 ===
        "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
      "the official Supabase TLS root has an exact reviewed SHA-256 lock",
      "GUARD"
    );
    refuses(
      () => assertRemoteTlsRootCertificate(remote),
      "an existing but substituted TLS root is refused before remote contact"
    );
    ok(remote.destructiveAllowed === false, "remote is NEVER destructiveAllowed", "GUARD");
    ok(assertNoRemoteDestructiveCapability(remote) === true, "no remote destructive capability", "GUARD");
  } catch (err) {
    failures.push(`[GUARD] allowed remote target should resolve — ${err.message}`);
  }

  // the endpoint ignores a hostile PGHOST entirely
  try {
    const hijack = resolveTarget(
      { mode: "remote", remoteRef: ALLOWED_REMOTE_REF },
      { ...goodEnv, PGHOST: "evil.example.com", PGPORT: "9999", PGDATABASE: "evil", PGUSER: "evil" }
    );
    ok(
      hijack.host === ALLOWED_REMOTE_ENDPOINT.host &&
        hijack.port === ALLOWED_REMOTE_ENDPOINT.port &&
        hijack.database === ALLOWED_REMOTE_ENDPOINT.database &&
        hijack.user === ALLOWED_REMOTE_ENDPOINT.user &&
        hijack.backendUser === ALLOWED_REMOTE_ENDPOINT.backendUser,
      "a hostile PGHOST/PGPORT/PGDATABASE/PGUSER cannot redirect the resolved endpoint",
      "GUARD"
    );
    const childEnv = buildChildEnv(hijack, {
      ...goodEnv,
      PGHOST: "evil.example.com",
      PGHOSTADDR: "10.0.0.1",
      PGSERVICE: "evil",
    });
    ok(
      !("PGHOST" in childEnv) && !("PGHOSTADDR" in childEnv) && !("PGSERVICE" in childEnv),
      "every libpq indirection variable is stripped from the psql child environment",
      "GUARD"
    );
    ok(childEnv.PGSSLMODE === "verify-full", "child env pins sslmode=verify-full", "GUARD");
  } catch (err) {
    failures.push(`[GUARD] endpoint hijack test — ${err.message}`);
  }

  // WRITE GATE is not optional and not bypassable
  if (remote) {
    ok(!isGated(remote), "a fresh remote target is not gated", "GUARD");
    try {
      runWrite(remote, { sql: "SELECT 1" });
      failures.push("[GUARD] runWrite must refuse an ungated remote target");
    } catch (err) {
      ok(err instanceof TargetRefusal, "runWrite refuses an ungated remote target", "GUARD");
    }
    refuses(
      () => assertRemoteWriteAllowed(remote, {}),
      "the write gate refuses when the accepted catalog manifest is absent (no longer optional)"
    );
    // A session is a write-capable channel, so opening one must ALSO be gated --
    // otherwise runWrite is not the only write path.
    refuses(
      () => new PsqlSession(remote, { name: "ungated" }),
      "opening a psql session against an ungated remote target is refused"
    );
  }

  // Persistent psql framing must submit SQL before the \echo sentinel even
  // when a scenario omits its trailing semicolon.
  const unterminatedFrame = buildSessionRequest("SELECT 1", 1);
  const terminatedFrame = buildSessionRequest("SELECT 1;", 2);
  const multiFrame = buildSessionRequest("BEGIN;\nSELECT 1", 3);
  ok(
    unterminatedFrame === "SELECT 1\n;\n\\echo __CANVAS_P1_EOS__1\n" &&
      terminatedFrame === "SELECT 1;\n;\n\\echo __CANVAS_P1_EOS__2\n" &&
      multiFrame === "BEGIN;\nSELECT 1\n;\n\\echo __CANVAS_P1_EOS__3\n",
    "persistent psql frames force every SQL buffer to execute before the response sentinel",
    "GUARD"
  );
  try {
    buildSessionRequest("   ", 1);
    failures.push("[GUARD] persistent psql framing must refuse an empty SQL request");
  } catch (error) {
    ok(
      error instanceof TypeError,
      "persistent psql framing refuses an empty SQL request",
      "GUARD"
    );
  }
  try {
    buildSessionRequest("SELECT 1", 0);
    failures.push("[GUARD] persistent psql framing must refuse a non-positive request id");
  } catch (error) {
    ok(
      error instanceof TypeError,
      "persistent psql framing refuses a non-positive request id",
      "GUARD"
    );
  }
  const schedule20 = buildConcurrentSessionSchedule(20);
  const schedule6 = buildConcurrentSessionSchedule(6);
  ok(
    MAX_CONCURRENT_SESSION_WORKERS === 12 &&
      schedule20.workerCount === 12 &&
      schedule20.assignments.length === 20 &&
      new Set(schedule20.assignments).size === 12 &&
      Math.max(...schedule20.assignments) === 11 &&
      schedule6.workerCount === 6 &&
      schedule6.assignments.join(",") === "0,1,2,3,4,5",
    "logical concurrency is bounded to 12 database workers while preserving every request",
    "GUARD"
  );
  for (const [requestCount, workerLimit] of [[0, 12], [20, 0]]) {
    try {
      buildConcurrentSessionSchedule(requestCount, workerLimit);
      failures.push("[GUARD] concurrent session schedule must refuse a non-positive integer");
    } catch (error) {
      ok(
        error instanceof TypeError,
        "concurrent session schedule refuses a non-positive integer",
        "GUARD"
      );
    }
  }

  // credentials never surface in the descriptor
  if (remote) {
    const serialized = JSON.stringify(remote);
    for (const secretish of ["password", "PGPASSWORD", "token", "jwt", "apikey", "postgresql://"]) {
      ok(
        !serialized.toLowerCase().includes(secretish.toLowerCase()),
        `target descriptor stores no ${secretish}`,
        "GUARD"
      );
    }
  }

  // fixture stays local and is the only destructive-capable target
  const fixture = resolveTarget({ mode: "fixture" }, {});
  ok(fixture.host === "127.0.0.1", "fixture target is loopback-only", "GUARD");
  ok(fixture.database === "stargaze_canvas_p1_fixture", "fixture target is the hard-coded db", "GUARD");
  ok(fixture.destructiveAllowed === true, "only the fixture db may be rebuilt", "GUARD");

  // branch deletion must be inexpressible
  const targetSrc = readFileSync(join(FIXTURE_DIR, "batch2", "target.mjs"), "utf8");
  for (const forbidden of ["api.supabase.com", "supabase-js", "DELETE /v1/branches", "fetch("]) {
    ok(!targetSrc.includes(forbidden), `target module contains no ${forbidden}`, "GUARD");
  }
  ok(
    targetSrc.includes('"--single-transaction"'),
    "multi-file migration writes are wrapped in one PostgreSQL transaction",
    "GUARD"
  );
}

// ###########################################################################
// GATE 1b [GUARD] — the PRE-GATE channel is physically read-only, and is a
//                   closed probe set with no arbitrary-SQL path.
//
// This is the adversarial half of Codex correction #1. It executes against the
// real module -- no database needed, because the proof is that the channel
// cannot EXPRESS a mutation and pins read-only at the server before it runs.
// ###########################################################################
function gateReadOnlyChannel() {
  // The module must expose NO function that takes caller SQL. The previous
  // revision's readOnlyQuery(target, sql) was "read-only" by name only.
  const targetSrc = readFileSync(join(FIXTURE_DIR, "batch2", "target.mjs"), "utf8");
  ok(
    !/export\s+function\s+readOnlyQuery\b/.test(targetSrc),
    "the arbitrary-SQL pre-gate channel readOnlyQuery() no longer exists",
    "GUARD"
  );

  // Every probe is a compiled-in constant, and the whole closed set is scanned.
  // Scanning is exhaustive HERE (unlike a source-string proxy) because PROBES
  // *is* the complete pre-gate surface: nothing else can reach the database
  // before the gate.
  const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\b/i;
  for (const [name, probe] of Object.entries(PROBES)) {
    if (probe.file) {
      ok(existsSync(probe.file), `probe ${name} references an existing SQL file`, "GUARD");
      const sql = readFileSync(probe.file, "utf8");
      const stripped = stripSqlComments(sql);
      ok(!FORBIDDEN_SQL.test(stripped), `probe ${name}'s SQL file contains no write command`, "GUARD");
      continue;
    }
    const text = typeof probe.sql === "function" ? probe.sql("generations") : probe.sql;
    ok(!FORBIDDEN_SQL.test(text), `probe ${name} is a read-only constant`, "GUARD");
  }

  // An unknown probe name refuses. There is no escape hatch.
  refuses(() => buildProbeScript("definitely_not_a_probe"), "an unknown probe name is refused");
  refuses(
    () => buildProbeScript("DROP TABLE public.generations"),
    "SQL text passed where a probe NAME belongs is refused (it is not a probe name)"
  );

  // The table-count probe takes an ENUM SELECTION, not free text.
  refuses(
    () => buildProbeScript("table_count", "generations; DROP TABLE public.profiles"),
    "an injected table argument is refused (not in the frozen TARGET_TABLES allowlist)"
  );
  refuses(
    () => buildProbeScript("table_count", "pg_authid"),
    "a non-allow-listed table argument is refused"
  );
  refuses(
    () => buildProbeScript("server_version", "generations"),
    "a table argument to a probe that takes none is refused"
  );

  // Every generated script pins READ ONLY at the server and PROVES it.
  for (const name of ["server_version", "current_database", "transaction_read_only"]) {
    const script = buildProbeScript(name);
    ok(
      /BEGIN TRANSACTION READ ONLY;/.test(script),
      `probe ${name} runs inside an explicit READ ONLY transaction`,
      "GUARD"
    );
    ok(
      /current_setting\('transaction_read_only'\) <> 'on'/.test(script) &&
        /RAISE EXCEPTION/.test(script),
      `probe ${name} fails closed if read-only mode cannot be proven from the backend`,
      "GUARD"
    );
  }
  const countScript = buildProbeScript("table_count", "generations");
  ok(
    /BEGIN TRANSACTION READ ONLY;/.test(countScript) &&
      countScript.includes("SELECT count(*) FROM public.generations;"),
    "the table_count probe is the frozen constant statement inside a READ ONLY transaction",
    "GUARD"
  );

  // The probe child pins default_transaction_read_only=on, and does so AFTER
  // stripping a hostile inherited PGOPTIONS.
  const fixture = resolveTarget({ mode: "fixture" }, {});
  const roEnv = buildReadOnlyChildEnv(fixture, {
    PGOPTIONS: "-c default_transaction_read_only=off",
  });
  ok(
    roEnv.PGOPTIONS === "-c default_transaction_read_only=on",
    "a hostile inherited PGOPTIONS cannot turn the pre-gate channel writable",
    "GUARD"
  );

  // The WRITE channel is separate and does NOT get the read-only pin -- proving
  // the two channels are genuinely distinct rather than the same helper renamed.
  const wEnv = buildChildEnv(fixture, {});
  ok(!("PGOPTIONS" in wEnv), "the write channel does not inherit the read-only pin", "GUARD");
}

// ###########################################################################
// GATE 1c [GUARD] — evidence is SHA-256, and one-field drift changes it
// ###########################################################################
function gateDigests() {
  // A length is not a digest. Codex demonstrated two distinct catalogs with the
  // same returned value under the old `digest: canon(...).length`.
  const a = { columns: [{ name: "x", type: "integer" }] };
  const b = { columns: [{ name: "y", type: "integer" }] };
  const da = sectionDigest(a.columns);
  const db = sectionDigest(b.columns);
  ok(/^[0-9a-f]{64}$/.test(da), "sectionDigest returns lowercase SHA-256 hex", "GUARD");
  ok(da !== db, "a one-field difference changes the section digest", "GUARD");

  // Same canonical LENGTH, different content -- the exact collision class the
  // previous `.length` evidence admitted.
  const lenA = sectionDigest([{ k: "aa" }]);
  const lenB = sectionDigest([{ k: "bb" }]);
  ok(
    lenA !== lenB,
    "two catalogs with identical canonical LENGTH produce different digests (no length collision)",
    "GUARD"
  );

  // Order-insensitive, multiplicity-sensitive.
  ok(
    sectionDigest([{ a: 1 }, { b: 2 }]) === sectionDigest([{ b: 2 }, { a: 1 }]),
    "section digests are order-insensitive",
    "GUARD"
  );
  ok(
    sectionDigest([{ a: 1 }]) !== sectionDigest([{ a: 1 }, { a: 1 }]),
    "section digests are multiplicity-sensitive (a duplicated row changes the digest)",
    "GUARD"
  );
  ok(
    sectionDigest(undefined) !== sectionDigest([]),
    "an ABSENT section is distinguishable from an EMPTY one (empty evidence cannot vanish)",
    "GUARD"
  );

  // compareCatalogSections must FAIL on a one-field drift, and the fingerprint
  // must change with it.
  const manifest = { sections: {} };
  const actual = {};
  for (const s of REQUIRED_PRE_APPLY_SECTIONS) {
    manifest.sections[s] = [{ probe: s }];
    actual[s] = [{ probe: s }];
  }
  const clean = compareCatalogSections(actual, manifest, REQUIRED_PRE_APPLY_SECTIONS);
  ok(clean.mismatches.length === 0, "an exactly matching catalog compares clean", "GUARD");
  ok(/^[0-9a-f]{64}$/.test(clean.digest), "the gate digest is SHA-256 hex, not a length", "GUARD");

  actual.columns = [{ probe: "columns", drifted: true }];
  const drifted = compareCatalogSections(actual, manifest, REQUIRED_PRE_APPLY_SECTIONS);
  ok(
    drifted.mismatches.length === 1 && drifted.mismatches[0].startsWith("columns"),
    "a one-field drift is reported as a section mismatch",
    "GUARD"
  );
  ok(drifted.digest !== clean.digest, "a one-field drift changes the SHA-256 gate digest", "GUARD");

  // A mismatch must never leak content: only names and counts.
  ok(
    !drifted.mismatches[0].includes("drifted"),
    "a mismatch report names the section and counts, never the sensitive content",
    "GUARD"
  );
}

// ###########################################################################
// GATE 1d [GUARD] — the frozen manifests, and UNPROVEN as a refusal
// ###########################################################################
function gateManifests() {
  let pre = null;
  try {
    pre = loadPreApplyManifest();
    ok(true, "the pre-apply manifest loads against the hash-pinned accepted catalog", "GUARD");
  } catch (err) {
    failures.push(`[GUARD] pre-apply manifest should load — ${err.message}`);
  }

  if (pre) {
    for (const s of REQUIRED_PRE_APPLY_SECTIONS) {
      ok(
        Object.prototype.hasOwnProperty.call(pre.sections, s),
        `the pre-apply manifest covers required section ${s}`,
        "GUARD"
      );
    }
    // The current Preview repair precondition is frozen, not inferred at runtime.
    const t = pre.sections.auth_signup_trigger;
    ok(
      t &&
        t.present === false &&
        t.name === "<absent>" &&
        t.function === "<absent>" &&
        Array.isArray(pre.sections.auth_user_triggers) &&
        pre.sections.auth_user_triggers.length === 0,
      "the pre-apply manifest freezes the missing signup trigger and zero competing auth.users triggers",
      "GUARD"
    );
    ok(
      pre.sections.default_acl.length === 48 &&
        pre.sections.default_acl.every(
          (row) => row.owner === "postgres" && (row.schema === "public" || row.schema === null)
        ),
      "the default-ACL gate covers only defaults that affect postgres-created public objects",
      "GUARD"
    );
    ok(
      pre.sections.lifecycle_routines.length === 0,
      "the pre-apply manifest requires ZERO pre-existing lifecycle routines",
      "GUARD"
    );
    ok(
      Array.isArray(pre.sections.column_acl) && pre.sections.column_acl.length === 0,
      "the pre-apply manifest asserts the measured zero column ACLs explicitly",
      "GUARD"
    );
    const signupFn = pre.sections.handle_new_user;
    ok(
      signupFn &&
        signupFn.present === true &&
        signupFn.kind === "f" &&
        signupFn.owner === "postgres" &&
        signupFn.language === "plpgsql" &&
        signupFn.security_definer === true &&
        signupFn.returns_trigger === true &&
        signupFn.config === "search_path=public",
      "the pre-apply manifest freezes the directly measured handle_new_user identity and config",
      "GUARD"
    );
    const triggerFns = pre.sections.trigger_functions;
    const expectedTriggerFns = [
      {
        schema: "public",
        name: "update_updated_at_column",
        owner: "postgres",
        language: "plpgsql",
        security_definer: false,
        config: "<none>",
        acl_is_null: false,
        acl_is_empty: false,
        grants: [
          { grantee: "PUBLIC", privilege: "EXECUTE" },
          { grantee: "anon", privilege: "EXECUTE" },
          { grantee: "authenticated", privilege: "EXECUTE" },
          { grantee: "postgres", privilege: "EXECUTE" },
          { grantee: "service_role", privilege: "EXECUTE" }
        ]
      }
    ];
    ok(
      JSON.stringify(triggerFns) === JSON.stringify(expectedTriggerFns),
      "the pre-apply manifest freezes the measured redacted trigger-function catalog and ACL",
      "GUARD"
    );
  }

  // A manifest with an UNPROVEN required section must REFUSE, not pass.
  const fixture = resolveTarget({ mode: "fixture" }, {});
  void fixture;
  const holed = { sections: {} };
  for (const s of REQUIRED_PRE_APPLY_SECTIONS) holed.sections[s] = [];
  holed.sections.columns = UNPROVEN;
  const remote = (() => {
    try {
      return resolveTarget(
        { mode: "remote", remoteRef: ALLOWED_REMOTE_REF },
        { [SSLROOTCERT_ENV]: FAKE_CERT }
      );
    } catch {
      return null;
    }
  })();
  if (remote) {
    refuses(
      () => assertRemoteWriteAllowed(remote, { preApplyManifest: holed }),
      "the write gate REFUSES a manifest whose required section is UNPROVEN (not a wildcard)"
    );
    const missing = { sections: {} };
    refuses(
      () => assertRemoteWriteAllowed(remote, { preApplyManifest: missing }),
      "the write gate REFUSES a manifest that omits required sections"
    );
    refuses(
      () => assertRemoteWriteAllowed(remote, {}),
      "the write gate REFUSES when no frozen manifest is supplied at all"
    );

    const postHoled = { sections: {} };
    for (const s of REQUIRED_POST_APPLY_SECTIONS) postHoled.sections[s] = [];
    postHoled.sections.columns = UNPROVEN;
    refuses(
      () =>
        assertRemotePostApplyWriteAllowed(remote, {
          postApplyManifest: postHoled,
        }),
      "the post-apply recovery gate REFUSES an UNPROVEN required section"
    );
    refuses(
      () => assertRemotePostApplyWriteAllowed(remote, {}),
      "the post-apply recovery gate REFUSES when its frozen manifest is absent"
    );
  }

  // Before the first Preview capture, EVERY post-apply surface had to remain an
  // explicit refusal. After capture/review, NONE may remain.
  const post = loadPostApplyManifest();
  const reapply = loadReapplyManifest();
  const outstanding = unprovenSections(post);
  ok(
    outstanding.length === 0,
    "the reviewed post-apply manifest has no remaining UNPROVEN section",
    "GUARD"
  );
  ok(
    post.sections === reapply.sections &&
      post.provenance.postApplyCatalogSha256 === POST_APPLY_CATALOG_SHA256,
    "post-apply and reapply reuse the same hash-pinned reviewed catalog object",
    "GUARD"
  );
  const postRaw = readFileSync(
    join(FIXTURE_DIR, "batch2", "post-apply-catalog.json"),
    "utf8"
  );
  ok(
    !/hfabrifuvujpdzarlbky|postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{16,}|__UNPROVEN__|prosrc|function_definition/i.test(
      postRaw
    ),
    "frozen post-apply evidence contains no production ref, credential shape, body or UNPROVEN value",
    "GUARD"
  );
  const postTrigger = post.sections.auth_signup_trigger;
  ok(
    postTrigger.present === true &&
      postTrigger.name === "on_auth_user_created" &&
      postTrigger.function === "public.handle_new_user()" &&
      postTrigger.enabled === "O" &&
      postTrigger.for_each_row === true &&
      postTrigger.timing === "AFTER" &&
      postTrigger.on_insert === true &&
      post.sections.auth_user_triggers.length === 1,
    "frozen post-apply evidence contains exactly the repaired signup trigger",
    "GUARD"
  );
  const clientRoles = new Set(["PUBLIC", "anon", "authenticated"]);
  const lifecycleClientGrants = post.sections.lifecycle_routines.flatMap((routine) =>
    routine.grants.filter((grant) => clientRoles.has(grant.grantee))
  );
  const quotaClientGrants = post.sections.quota_bucket_shape.grants.filter((grant) =>
    clientRoles.has(grant.grantee)
  );
  ok(
    lifecycleClientGrants.length === 0 &&
      quotaClientGrants.length === 0 &&
      post.sections.quota_bucket_shape.rls_enabled === true &&
      post.sections.quota_bucket_shape.policy_count === 0,
    "frozen post-apply evidence preserves zero client access to lifecycle routines and quota buckets",
    "GUARD"
  );
  ok(
    post.sections.handle_new_user.present === true &&
      post.sections.handle_new_user.security_definer === true &&
      post.sections.handle_new_user.config === 'search_path=""',
    "frozen post-apply handle_new_user remains SECURITY DEFINER with an empty pinned search_path",
    "GUARD"
  );
}

// ###########################################################################
// GATE 2 [REGISTRY] — a scenario name is never evidence
// ###########################################################################
function gateRegistry() {
  try {
    const n = assertEveryScenarioImplemented();
    ok(n >= 70, `every declared runtime scenario has an implementation (${n})`, "REGISTRY");
  } catch (err) {
    failures.push(`[REGISTRY] ${err.message}`);
  }

  for (const s of SCENARIOS) {
    const impl = REGISTRY.get(s.test);
    ok(
      impl && typeof impl.run === "function" && impl.run.constructor.name === "AsyncFunction",
      `${s.id} ${s.test} resolves to a real async implementation`,
      "REGISTRY"
    );
    // an implementation that never touches ctx cannot be executing SQL
    ok(
      impl && impl.run.length >= 1,
      `${s.id} ${s.test} takes a database context`,
      "REGISTRY"
    );
  }

  const ids = SCENARIOS.map((s) => s.id);
  ok(new Set(ids).size === ids.length, "runtime scenario ids are unique", "REGISTRY");
  const tests = SCENARIOS.map((s) => s.test);
  ok(new Set(tests).size === tests.length, "runtime scenario test names are unique", "REGISTRY");
}

// ###########################################################################
// GATE 3 [STATIC] — structural scans. Supplement, never substitute.
// ###########################################################################
function gateStatic() {
  const policy = stripSqlComments(readMigration("policy"));
  const foundation = stripSqlComments(readMigration("foundation"));
  const credit = stripSqlComments(readMigration("credit"));
  const api = stripSqlComments(readMigration("api"));
  const reconcile = stripSqlComments(readMigration("reconcile"));
  const allFns = [credit, api, reconcile].join("\n");
  const runtimeSrc = readFileSync(join(FIXTURE_DIR, "batch2", "runtime.mjs"), "utf8");
  const sessionSrc = readFileSync(join(FIXTURE_DIR, "batch2", "session.mjs"), "utf8");
  const scenariosSrc = readFileSync(join(FIXTURE_DIR, "batch2", "scenarios.mjs"), "utf8");
  const targetSrc = readFileSync(join(FIXTURE_DIR, "batch2", "target.mjs"), "utf8");
  const verifierSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const atomicTaskCreditSrc = readFileSync(
    join(REPO_ROOT, "src", "lib", "credits", "atomic-task-credit.ts"),
    "utf8"
  );

  try {
    const locked = verifyMigrationLocks();
    ok(locked.length === 5, "exactly five migration files are byte-locked", "STATIC");
    ok(
      locked.every(
        (entry, i) =>
          entry.file === MIGRATION_LOCKS[i].file &&
          entry.actual === MIGRATION_LOCKS[i].sha256 &&
          /^[0-9a-f]{64}$/.test(entry.actual)
      ),
      "all five locked migration SHA-256 values match the reviewed bytes",
      "STATIC"
    );
  } catch (err) {
    failures.push(`[STATIC] locked migration batch should verify — ${err.message}`);
  }

  ok(
    /capturePostApplyEvidence[\s\S]*?remoteState[\s\S]*?assertRemoteWriteAllowed\([\s\S]*?assertRemotePostApplyWriteAllowed\([\s\S]*?applyLockedMigrations\(target\)[\s\S]*?readCatalog\(target\)[\s\S]*?applyLockedMigrations\(target\)[\s\S]*?readCatalog\(target\)/.test(
      runtimeSrc
    ),
    "the capture path requires an explicit start state, gates it exactly, then performs locked apply -> read-only capture -> locked reapply -> capture",
    "STATIC"
  );
  ok(
    /BEGIN;[\s\S]*?DISABLE TRIGGER canvas_p1_credit_transactions_append_only[\s\S]*?DELETE FROM public\.credit_transactions WHERE user_id IN[\s\S]*?ENABLE TRIGGER canvas_p1_credit_transactions_append_only[\s\S]*?COMMIT;/.test(
      runtimeSrc
    ),
    "test cleanup is scoped and restores the append-only trigger in one transaction",
    "STATIC"
  );
  ok(
    /pg_catalog\.pg_stat_activity/.test(sessionSrc) &&
      /wait_event_type/.test(sessionSrc) &&
      !/isStillBlocked/.test(sessionSrc),
    "concurrency barriers prove PostgreSQL Lock waits instead of timing network latency",
    "STATIC"
  );
  ok(
    (scenariosSrc.match(/isWaitingOnDatabaseLock\(/g) ?? []).length === 3,
    "all three lock barriers use backend wait-event proof",
    "STATIC"
  );
  ok(
    (scenariosSrc.match(/ctx\.concurrentRequests\(/g) ?? []).length === 6 &&
      !/ctx\.sessions\(/.test(scenariosSrc) &&
      /buildConcurrentSessionSchedule/.test(runtimeSrc) &&
      /await ctx\.closeScenarioSessions\(\)/.test(runtimeSrc),
    "all fan-out scenarios use the bounded worker schedule and sessions close after each scenario",
    "STATIC"
  );
  ok(
    /if \(name !== "m"\) scenarioOpened\.add\(sess\)/.test(runtimeSrc) &&
      /return closeSessionSet\(scenarioOpened\)/.test(runtimeSrc) &&
      /await closeSessionSet\(opened\)/.test(runtimeSrc),
    "the main session is suite-scoped while every barrier/fan-out session closes per scenario",
    "STATIC"
  );
  ok(
    /await ctx\.closeScenarioSessions\(\)[\s\S]*?await ctx\.cleanupScenarioRows\(\)[\s\S]*?if \(scenarioError\)/.test(
      runtimeSrc
    ) &&
      /async cleanupScenarioRows\(\)[\s\S]*?await s\("m"\)\.ok\(cleanup\.sql\)[\s\S]*?createdUsers\.clear\(\)/.test(
        runtimeSrc
      ),
    "each scenario cleans its explicit UUIDs through the reused main session before the next scenario",
    "STATIC"
  );
  const r30Start = scenariosSrc.indexOf('id: "R30"');
  const r30End = scenariosSrc.indexOf('id: "R31"', r30Start + 1);
  const r30Block =
    r30Start >= 0 && r30End > r30Start ? scenariosSrc.slice(r30Start, r30End) : "";
  ok(
    (r30Block.match(/canvas_p1_apply_credit_delta_v1/g) ?? []).length === 5 &&
      /'consume', -95/.test(r30Block) &&
      /gen_random_uuid\(\), NULL, NULL, NULL, NULL/.test(r30Block) &&
      /NULL, NULL, NULL, NULL, NULL, '   '/.test(r30Block) &&
      /'consume', -999/.test(r30Block) &&
      /Number\(rows\) !== 1/.test(r30Block),
    "R30 proves complete task scope, exact replay, partial/blank identity rejection and overdraft refusal",
    "STATIC"
  );
  ok(
    /DROP CONSTRAINT IF EXISTS ct_action_identity_required,[\s\S]*?ADD CONSTRAINT ct_action_identity_required CHECK/i.test(
      credit
    ) &&
      /generation_id IS NOT NULL[\s\S]*?action_id IS NOT NULL[\s\S]*?canvas_id_snapshot IS NOT NULL[\s\S]*?canvas_node_id IS NOT NULL[\s\S]*?OR \(\s*generation_id IS NULL[\s\S]*?action_id IS NULL[\s\S]*?canvas_id_snapshot IS NULL[\s\S]*?canvas_node_id IS NULL[\s\S]*?task_id IS NOT NULL[\s\S]*?length\(btrim\(task_id\)\) > 0/i.test(
        credit
      ) &&
      /VALIDATE CONSTRAINT ct_action_identity_required/i.test(credit),
    "credit identity is exactly full Canvas action OR full nonblank task scope, never partial",
    "STATIC"
  );
  ok(
    /createHash\("sha256"\)[\s\S]*?update\(`\$\{params\.scope\}\\0\$\{taskId\}`/.test(
      atomicTaskCreditSrc
    ) &&
      /operationAnchor: `canvas-p1-task:\$\{params\.scope\}:\$\{operation\}:\$\{taskDigest\}`/.test(
        atomicTaskCreditSrc
      ) &&
      /"canvas_p1_apply_credit_delta_v1"/.test(atomicTaskCreditSrc) &&
      /p_generation_id: null[\s\S]*?p_action_id: null[\s\S]*?p_canvas_id_snapshot: null[\s\S]*?p_canvas_node_id: null[\s\S]*?p_task_id: identity\.taskId/.test(
        atomicTaskCreditSrc
      ) &&
      !/operationAnchor:\s*input\./.test(atomicTaskCreditSrc),
    "task credit helper derives a hashed server anchor and can only submit a complete task identity",
    "STATIC"
  );
  const r32Start = scenariosSrc.indexOf('id: "R32"');
  const r32End = scenariosSrc.indexOf('id: "R33"', r32Start + 1);
  const r32Block =
    r32Start >= 0 && r32End > r32Start ? scenariosSrc.slice(r32Start, r32End) : "";
  ok(
    /ctx\.concurrentRequests\(\s*6,\s*"mix"/.test(r32Block) &&
      /begin_canvas_generation_v1\(/.test(r32Block) &&
      /'debit', 1/.test(r32Block) &&
      !/'consume', -1/.test(r32Block),
    "R32 uses six fully identified concurrent paid begins instead of bare consume fixtures",
    "STATIC"
  );
  const r44Start = scenariosSrc.indexOf('id: "R44"');
  const r44End = scenariosSrc.indexOf('id: "R45"', r44Start + 1);
  const r44Block =
    r44Start >= 0 && r44End > r44Start ? scenariosSrc.slice(r44Start, r44End) : "";
  ok(
    /const \[r1, r2\] = await Promise\.all/.test(r44Block) &&
      /SELECT status FROM public\.generations/.test(r44Block) &&
      /entry_kind='refund'/.test(r44Block) &&
      /SELECT credits FROM public\.profiles/.test(r44Block) &&
      /fail=\$\{r1\.error/.test(r44Block) &&
      /complete=\$\{r2\.error/.test(r44Block),
    "R44 checks both participants and independently reconciles terminal state, refund ledger and balance",
    "STATIC"
  );
  ok(
    !/to_char\(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'\)/.test(
      `${runtimeSrc}\n${scenariosSrc}`
    ) &&
      (
        `${runtimeSrc}\n${scenariosSrc}`.match(
          /to_char\(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\)/g
        ) ?? []
      ).length === 7,
    "every claimed lease preserves PostgreSQL microseconds in the authority DTO",
    "STATIC"
  );
  ok(
    /INSERT INTO public\.credit_transactions\s*\([\s\S]*?balance_before,\s*balance_after,\s*created_at,[\s\S]*?\)\s*VALUES\s*\([\s\S]*?v_before,\s*v_after,\s*pg_catalog\.clock_timestamp\(\),/.test(
      credit
    ),
    "the locked credit boundary stamps ledger time after profile-lock serialization",
    "STATIC"
  );
  const r48Start = scenariosSrc.indexOf('id: "R48"');
  const r48End = scenariosSrc.indexOf('id: "R49"', r48Start + 1);
  const r48Block =
    r48Start >= 0 && r48End > r48Start ? scenariosSrc.slice(r48Start, r48End) : "";
  ok(
    /const U = "[a-f0-9-]*[a-f][a-f0-9-]*";/.test(r48Block) &&
      /owner":"\$\{U\.toUpperCase\(\)\}"/.test(r48Block),
    "R48's uppercase UUID negative contains letters, so uppercasing is not a no-op",
    "STATIC"
  );
  const r59Start = scenariosSrc.indexOf('id: "R59"');
  const r59End = scenariosSrc.indexOf('id: "R60"', r59Start + 1);
  const r59Block =
    r59Start >= 0 && r59End > r59Start ? scenariosSrc.slice(r59Start, r59End) : "";
  ok(
    /complete_canvas_generation_v1\(/.test(r59Block) &&
      /fail_canvas_generation_v1\(/.test(r59Block) &&
      (r59Block.match(/SET next_reconcile_at=now\(\)-interval '1 minute'/g) ?? []).length === 2 &&
      !/SET status='(?:completed|failed)'/.test(r59Block),
    "R59 creates valid terminal rows through reviewed APIs before making both rows due-looking",
    "STATIC"
  );
  const r76Start = scenariosSrc.indexOf('id: "R76"');
  const r76End = scenariosSrc.indexOf('id: "R77"', r76Start + 1);
  const r76Block =
    r76Start >= 0 && r76End > r76Start ? scenariosSrc.slice(r76Start, r76End) : "";
  ok(
    /p\.polcmd::text\|\|'\|'/.test(r76Block) && !/p\.polcmd\|\|'\|'/.test(r76Block),
    'R76 casts pg_policy.polcmd from PostgreSQL internal "char" before text concatenation',
    "STATIC"
  );
  ok(
    /auth_user_count/.test(runtimeSrc) &&
      /post-cleanup auth\.users count/.test(runtimeSrc),
    "remote zero-data cleanup proof includes auth.users",
    "STATIC"
  );
  ok(
    /auth_trigger_capability/.test(
      readFileSync(join(FIXTURE_DIR, "batch2", "target.mjs"), "utf8")
    ) &&
      /has_table_privilege\(current_user,\s*'auth\.users',\s*'TRIGGER'\)/i.test(credit) &&
      /tgname\s*<>\s*'on_auth_user_created'/.test(credit) &&
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+on_auth_user_created\s+ON\s+auth\.users/i.test(credit) &&
      /CREATE\s+TRIGGER\s+on_auth_user_created\s+AFTER\s+INSERT\s+ON\s+auth\.users\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.handle_new_user\(\)/i.test(
        credit
      ) &&
      /SELECT\s+count\(\*\)[\s\S]*?FROM\s+pg_catalog\.pg_trigger[\s\S]*?<> 1/i.test(credit),
    "signup-trigger repair proves privilege, refuses competitors and creates exactly one reviewed path",
    "STATIC"
  );
  ok(
    /AS\s+t\(col,\s*typ,\s*expected_not_null,\s*def\)/i.test(foundation) &&
      /r\.expected_not_null/.test(foundation) &&
      !/AS\s+t\([^)]*\bnotnull\b/i.test(foundation),
    "PG17 column-shape VALUES aliases avoid the reserved notnull token",
    "STATIC"
  );
  ok(
    /CREATE\s+UNIQUE\s+INDEX\s+credit_transactions_quota_usage_uniq\s+ON\s+public\.credit_transactions\s*\(\s*user_id,\s*quota_key,\s*quota_window_start,\s*generation_id\s*\)/i.test(
      foundation
    ) &&
      /credit_transactions_quota_usage_uniq[\s\S]*?%\(user_id,\s*quota_key,\s*quota_window_start,\s*generation_id\)%/.test(
        foundation
      ) &&
      !/credit_transactions_quota_usage_uniq[\s\S]*?%\(user_id,\s*quota_key,\s*window_start,\s*generation_id\)%/.test(
        foundation
      ),
    "quota-usage index DDL and postcondition assert the same quota_window_start column",
    "STATIC"
  );
  ok(
    /pg_catalog\.substring\([\s\S]*?pg_catalog\.encode\([\s\S]*?\),\s*1,\s*32\s*\)/.test(api) &&
      !/pg_catalog\.substring\([\s\S]*?\)\s+FROM\s+1\s+FOR\s+32/.test(api),
    "PG17 planned-key entropy truncation uses the schema-qualified three-argument substring form",
    "STATIC"
  );
  ok(
    (readFileSync(join(FIXTURE_DIR, "batch2", "target.mjs"), "utf8").match(
      /assertRemoteTlsRootCertificate\(target\)/g
    ) ?? []).length >= 2 &&
      /assertRemoteTlsRootCertificate\(target\)/.test(sessionSrc),
    "every remote probe, one-shot write and persistent session pins the reviewed CA",
    "STATIC"
  );
  ok(
    /id: "R08"[\s\S]*?newTrackedTestUuid\(\)/.test(scenariosSrc) &&
      /id: "R24"[\s\S]*?newTrackedTestUuid\(\)/.test(scenariosSrc),
    "negative profile/signup UUIDs are registered for scoped cleanup before use",
    "STATIC"
  );
  ok(
    /result\.failures\.push\(`\$\{scenario\.id\}[\s\S]*?result\.skipped \+= SCENARIOS\.length - index - 1;[\s\S]*?break;/.test(
      runtimeSrc
    ),
    "runtime stops after the first failed scenario and marks the remainder skipped",
    "STATIC"
  );
  const runtimeExecutionBlock =
    runtimeSrc.match(/export async function runRuntime[\s\S]*$/)?.[0] ?? "";
  ok(
    !/remoteState\s*===\s*["']preapply["']/.test(runtimeExecutionBlock) &&
      /pre-apply[\s\S]*?only use --capture-post-apply/.test(runtimeExecutionBlock),
    "remote pre-apply state cannot enter ordinary runtime scenarios",
    "STATIC"
  );
  const preflightBlock =
    verifierSrc.match(/if \(wantPreflight\) \{([\s\S]*?)\n  \}\n\n  if \(wantInspectPreapply\)/)?.[1] ??
    "";
  ok(
    /assertRemoteWriteAllowed\(/.test(preflightBlock) &&
      /assertRemotePostApplyWriteAllowed\(/.test(preflightBlock) &&
      /CANVAS_P1_REMOTE_STATE/.test(preflightBlock) &&
      /preapply/.test(preflightBlock) &&
      /postapply/.test(preflightBlock) &&
      /return 0;/.test(preflightBlock) &&
      !/\b(runWrite|capturePostApplyEvidence|applyLockedMigrations|PsqlSession)\b/.test(
        preflightBlock
      ),
    "preflight CLI requires an explicit state, performs only its matching read-only gate, and exits before every write-capable path",
    "STATIC"
  );
  const inspectPreapplyBlock =
    verifierSrc.match(
      /if \(wantInspectPreapply\) \{([\s\S]*?)\n  \}\n\n  if \(wantInspectRecovery\)/
    )?.[1] ?? "";
  ok(
    /assertRemoteWriteAllowed\(/.test(inspectPreapplyBlock) &&
      /readCatalog\(/.test(inspectPreapplyBlock) &&
      /runReadOnlyProbe\(target,\s*"auth_user_triggers"\)/.test(inspectPreapplyBlock) &&
      /buildPreApplyDiagnostic\(/.test(inspectPreapplyBlock) &&
      /return 0;/.test(inspectPreapplyBlock) &&
      !/\b(runWrite|capturePostApplyEvidence|applyLockedMigrations|runRuntime|PsqlSession)\b/.test(
        inspectPreapplyBlock
      ),
    "pre-apply diagnostic CLI reuses the read-only identity gate and has no write-capable path",
    "STATIC"
  );
  const inspectRecoveryBlock =
    verifierSrc.match(
      /if \(wantInspectRecovery\) \{([\s\S]*?)\n  \}\n\n  if \(wantRecoverRuntime\)/
    )?.[1] ?? "";
  ok(
    /inspectRemoteRuntimeRecovery\(/.test(inspectRecoveryBlock) &&
      /return 0;/.test(inspectRecoveryBlock) &&
      !/\b(assertRemoteRuntimeRecoveryWriteAllowed|cleanupTrackedUserIds|runWrite)\b/.test(
        inspectRecoveryBlock
      ),
    "interrupted-runtime inventory CLI is read-only and cannot reach cleanup",
    "STATIC"
  );
  ok(
    !/candidateIds\.length === 0\s*\|\|[\s\S]*?SCENARIO_RECOVERY_USER_LIMIT/.test(
      targetSrc
    ) &&
      /recovery candidates must be 0\.\.77 unique canonical UUIDs/.test(targetSrc) &&
      /assertRemoteRuntimeRecoveryWriteAllowed[\s\S]*?candidateIds\.length === 0[\s\S]*?recovery write is unnecessary[\s\S]*?GATED\.add\(target\)/.test(
        targetSrc
      ),
    "a zero-candidate inventory can prove read-only emptiness but can never mint recovery write capability",
    "STATIC"
  );
  const recoverRuntimeBlock =
    verifierSrc.match(
      /if \(wantRecoverRuntime\) \{([\s\S]*?)\n  \}\n\n  if \(wantCapture\)/
    )?.[1] ?? "";
  ok(
    /assertRemoteRuntimeRecoveryWriteAllowed\([\s\S]*?cleanupTrackedUserIds\([\s\S]*?proveRemoteTestTablesEmpty\([\s\S]*?assertRemotePostApplyWriteAllowed\(/.test(
      recoverRuntimeBlock
    ),
    "interrupted-runtime cleanup runs only after its recovery gate and proves zero data plus catalog",
    "STATIC"
  );
  const recoveryProbe = buildProbeScript("runtime_recovery_inventory");
  ok(
    /BEGIN TRANSACTION READ ONLY;/.test(recoveryProbe) &&
      /u-' \|\| u\.id::text \|\| '@test\.invalid'/.test(recoveryProbe) &&
      /_outside_candidates/.test(recoveryProbe) &&
      !/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\b/i.test(
        stripSqlComments(recoveryProbe)
      ),
    "recovery inventory is a closed read-only exact-marker and ownership-closure probe",
    "STATIC"
  );
  refuses(
    () => cleanupTrackedUserIds({}, []),
    "interrupted-runtime cleanup refuses an empty UUID scope"
  );
  refuses(
    () => cleanupTrackedUserIds({}, ["not-a-uuid"]),
    "interrupted-runtime cleanup refuses a noncanonical UUID"
  );
  refuses(
    () =>
      buildCleanupSqlForUserIds([
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ]),
    "scoped cleanup refuses duplicate UUIDs"
  );
  const cleanupSqlProof = buildCleanupSqlForUserIds([
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ]);
  ok(
    cleanupSqlProof.ids.length === 1 &&
      (
        cleanupSqlProof.sql.match(/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/g) ?? []
      ).length === 12 &&
      /DELETE FROM public\.profiles WHERE id IN/.test(cleanupSqlProof.sql) &&
      /DELETE FROM auth\.users WHERE id IN/.test(cleanupSqlProof.sql),
    "cleanup SQL is generated only from the validated explicit UUID set",
    "GUARD"
  );
  ok(
    /actual_out_of_scope_rows:\s*actualDefaultAcl\.length\s*-\s*actualRelevant\.length/.test(
      verifierSrc
    ),
    "pre-apply diagnostic reports only a count for default ACL rows outside migration scope",
    "STATIC"
  );

  ok(
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"allow_all"\s+ON\s+public\.generations/i.test(policy),
    "policy migration drops the measured live policy name allow_all",
    "STATIC"
  );
  ok(/generations_select_own/.test(policy), "policy migration preserves owner SELECT", "STATIC");

  for (const [name, sql] of Object.entries({ policy, foundation, credit, api, reconcile })) {
    ok(!sql.includes(FORBIDDEN_PRODUCTION_REF), `${name} has no production project ref`, "STATIC");
    ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(sql), `${name} has no JWT-shaped literal`, "STATIC");
    ok(!/postgres(ql)?:\/\/[^\s]+:[^\s]+@/.test(sql), `${name} has no connection string`, "STATIC");
    ok(!/sk-[A-Za-z0-9]{16,}/.test(sql), `${name} has no API-key-shaped literal`, "STATIC");
  }

  // per-function search_path pin (parsed per function, not counted)
  const fnHeaders = [];
  for (const sql of [foundation, credit, api, reconcile]) {
    const chunks = sql.split(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i).slice(1);
    for (const chunk of chunks) {
      const bodyStart = chunk.search(/AS\s+\$\$/i);
      fnHeaders.push({
        name: (chunk.match(/^\s*([a-z0-9_.]+)\s*\(/i) ?? [, "<unnamed>"])[1],
        header: bodyStart === -1 ? chunk : chunk.slice(0, bodyStart),
      });
    }
  }
  ok(fnHeaders.length >= 22, `migrations define the expected function set (${fnHeaders.length})`, "STATIC");
  for (const { name, header } of fnHeaders) {
    if (/\bSECURITY\s+DEFINER\b/i.test(header)) {
      ok(/\bSET\s+search_path\s*=/i.test(header), `SECURITY DEFINER ${name} pins search_path`, "STATIC");
    } else {
      ok(/\bSECURITY\s+INVOKER\b/i.test(header), `${name} declares its security mode`, "STATIC");
    }
  }

  const revokeCount = (allFns.match(/REVOKE\s+ALL\s+ON\s+FUNCTION/gi) ?? []).length;
  const grantCount = (allFns.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) ?? []).length;
  ok(revokeCount >= grantCount && revokeCount > 0, "every granted function is revoked first", "STATIC");
  ok(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]{0,200}?TO\s+(anon|authenticated|PUBLIC)/i.test(allFns),
    "no function grants EXECUTE to a client role",
    "STATIC"
  );

  // trigger functions are revoked too (Codex P1)
  for (const fn of ["canvas_p1_touch_updated_at", "canvas_p1_ledger_append_only"]) {
    ok(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\(\\)\\s+FROM\\s+anon`, "i").test(
        foundation
      ),
      `trigger function ${fn} revokes anon EXECUTE`,
      "STATIC"
    );
  }

  ok(
    /CREATE\s+TRIGGER\s+canvas_p1_credit_transactions_append_only/i.test(foundation),
    "anchored-ledger guard is a trigger, not an RLS policy",
    "STATIC"
  );

  // deterministic recreate, not name-only guards (Codex P1)
  ok(
    !/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(foundation),
    "no name-only CREATE INDEX IF NOT EXISTS guard survives",
    "STATIC"
  );
  ok(
    /DROP\s+INDEX\s+IF\s+EXISTS\s+public\.generations_user_action_uniq/i.test(foundation),
    "the action-uniqueness index is deterministically recreated",
    "STATIC"
  );
  ok(
    /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+%I/i.test(foundation),
    "check constraints are deterministically recreated",
    "STATIC"
  );
  ok(
    /MAINTAIN/.test(foundation),
    "PG17 MAINTAIN is included in the zero-client-privilege assertions",
    "STATIC"
  );

  // quota is DB-pinned (Codex P0)
  ok(
    /c_quota_key\s+constant\s+text\s*:=\s*'canvas-deepseek-v1'/i.test(api),
    "quota key is a database constant, not a parameter",
    "STATIC"
  );
  ok(
    /c_quota_limit\s+constant\s+integer\s*:=\s*20/i.test(api),
    "quota limit 20 is a database constant",
    "STATIC"
  );
  // Scoped to begin's OWN signature. A blanket file scan is wrong: the shared
  // credit boundary legitimately takes p_quota_key/p_quota_window_start, and
  // begin passes them BY NAME using the database-derived constants. What must
  // be true is that begin itself accepts no quota input from its caller.
  const beginHeader = (() => {
    const i = api.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.begin_canvas_generation_v1/i);
    if (i === -1) return null;
    const rest = api.slice(i);
    const end = rest.search(/\bRETURNS\b/i);
    return end === -1 ? null : rest.slice(0, end);
  })();
  ok(beginHeader !== null, "begin_canvas_generation_v1 signature is parseable", "STATIC");
  ok(
    beginHeader !== null && !/p_quota_key|p_quota_limit|p_quota_window_start/.test(beginHeader),
    "begin's own signature exposes no quota parameter (caller cannot choose key/limit/window)",
    "STATIC"
  );
  ok(
    /p_quota_key\s*=>\s*c_quota_key/.test(api) && /p_quota_window_start\s*=>\s*v_window/.test(api),
    "begin passes the database-derived quota constants to the shared boundary",
    "STATIC"
  );
  ok(
    /clock_timestamp\(\)/.test(api) && /date_trunc\('day'/.test(api),
    "the quota window is derived from a database real-time clock, not the caller",
    "STATIC"
  );
  ok(
    /generation_quota_buckets_v1_limit_pinned/.test(foundation),
    "the v1 quota limit is pinned by a table constraint",
    "STATIC"
  );

  // signup conversion (Codex P0)
  ok(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.handle_new_user/i.test(credit),
    "the live auth trigger function is converted",
    "STATIC"
  );
  ok(
    /c_signup_grant_amount\s+constant\s+integer\s*:=\s*100/i.test(credit),
    "signup grant amount is the proven 100",
    "STATIC"
  );
  ok(/002_complete_setup\.sql/.test(credit), "signup grant cites its proving source", "STATIC");

  // authority ordering (Codex P0)
  ok(
    !/complete_canvas_generation_v1[\s\S]*?status\s*=\s*'completed'\s+THEN[\s\S]{0,400}RETURN NEXT/i.test(
      reconcile
    ),
    "complete has no already-completed success branch",
    "STATIC"
  );
  ok(
    /replay_canvas_generation_bind_v1/.test(reconcile),
    "an explicit exact-identity bind replay exists",
    "STATIC"
  );

  ok(
    !/EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+(NULL|RETURN)/i.test(allFns),
    "no function swallows arbitrary exceptions",
    "STATIC"
  );

  // --- Codex correction 7: ONE anchor identity comparator ------------------
  // Structural only. The behavioural proof is the runtime replay negatives; this
  // just makes a regression to two divergent comparisons visible immediately.
  ok(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.canvas_p1_assert_anchor_identity_v1/i.test(credit),
    "a single exact anchor-identity comparator exists",
    "STATIC"
  );
  const comparatorCalls = (credit.match(/canvas_p1_assert_anchor_identity_v1\s*\(/g) ?? []).length;
  ok(
    comparatorCalls >= 3,
    `both replay paths route through the one comparator (${comparatorCalls} references incl. definition)`,
    "STATIC"
  );
  // The unique_violation branch must not return without comparing identity.
  const uvBranch = credit.slice(credit.search(/WHEN\s+unique_violation\s+THEN/i));
  ok(
    /canvas_p1_assert_anchor_identity_v1/.test(uvBranch.slice(0, 1200)),
    "the unique_violation convergence branch calls the identity comparator before returning",
    "STATIC"
  );

  // --- Codex correction 3: deterministic recreate, not name-only guards ----
  ok(
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"generations_select_own"\s+ON\s+public\.generations;\s*\nCREATE\s+POLICY/i.test(
      policy
    ),
    "the owner SELECT policy is deterministically recreated, not name-guarded",
    "STATIC"
  );
  ok(
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"generations_service_role_all"\s+ON\s+public\.generations;\s*\nCREATE\s+POLICY/i.test(
      policy
    ),
    "the service_role policy is deterministically recreated, not name-guarded",
    "STATIC"
  );
  ok(
    !/IF\s+NOT\s+EXISTS\s*\([\s\S]{0,400}?polname\s*=\s*'generations_select_own'/i.test(policy),
    "no name-only policy existence guard survives in the release prerequisite",
    "STATIC"
  );
  for (const fk of [
    "generations_canvas_id_fkey",
    "credit_transactions_generation_id_fkey",
    "credit_transactions_canvas_id_fkey",
    "generation_quota_buckets_user_id_fkey",
  ]) {
    ok(
      new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${fk}`, "i").test(foundation),
      `FK ${fk} is deterministically recreated, not name-guarded`,
      "STATIC"
    );
  }
  ok(
    /confdeltype\s*=\s*r\.delact/.test(foundation),
    "FK referential actions are proven from pg_constraint catalog codes, not deparsed text",
    "STATIC"
  );

  // --- Codex correction 6: exact lane tuples ------------------------------
  ok(
    /g\.status\s*=\s*'processing'\s*\n\s*AND\s+g\.provider_submission_state\s*=\s*'bound'/i.test(
      reconcile
    ),
    "the generic claim lane pins the exact processing/bound tuple",
    "STATIC"
  );
  ok(
    /c_gpt_interval\s+constant\s+integer\s*:=\s*30000/i.test(reconcile) &&
      /g\.reconcile_interval_ms\s*=\s*c_gpt_interval/.test(reconcile),
    "the GPT release lane pins the exact 30000 ms interval alongside the profile",
    "STATIC"
  );

  const executes = allFns.match(/EXECUTE\s+format\([^)]*\)/gi) ?? [];
  for (const ex of executes) {
    ok(!/\bp_[a-z_]+/.test(ex), `dynamic EXECUTE interpolates no caller parameter`, "STATIC");
  }
}

// ###########################################################################
// GATE 4 [STATIC] — callsite guard: DISCOVERY, not an existence check
// ###########################################################################
function gateCallsites() {
  // 1. The real tree matches the frozen reviewed allowlist.
  const findings = callsiteGuard();
  ok(findings.length === 0, `callsite inventory is accurate (${findings.join("; ")})`, "STATIC");
  const reviewedAllowlist = loadCallsiteAllowlist();
  ok(
    reviewedAllowlist.baseline?.originalReviewedCallsites === 39 &&
      reviewedAllowlist.baseline?.discoveredCallsites === 29 &&
      reviewedAllowlist.baseline?.retiredMutationRoutes === 4 &&
      reviewedAllowlist.baseline?.convertedProfileInitializers === 2 &&
      reviewedAllowlist.baseline?.convertedSharedCreditPaths === 20 &&
      reviewedAllowlist.baseline?.remainingLegacyLifecycleOnly === 13 &&
      reviewedAllowlist.baseline?.reclassifiedLegacyCreditConsumers === 3 &&
      reviewedAllowlist.baseline?.canvasAtomicGenerationBoundaryPaths === 2 &&
      reviewedAllowlist.callsites?.length === 29,
    "the reviewed baseline is preserved as 29 discovered mutations, including 2 Canvas atomic generation-boundary paths",
    "STATIC"
  );

  // 2. The guard actually DETECTS an unreviewed addition. This is the check the
  //    old guard could never pass, because an existence check over fourteen
  //    hard-coded paths stays green whether or not it can detect anything.
  //    Proven by planting a synthetic callsite in a disposable temp fixture.
  try {
    const { rotCount } = proveCallsiteGuardDetectsAddition();
    ok(true, "the guard detects a planted unreviewed credit-mutation callsite", "STATIC");
    ok(rotCount > 0, `the guard detects silent removal/rename (${rotCount} rot findings)`, "STATIC");
  } catch (err) {
    failures.push(`[STATIC] callsite guard must detect a planted addition — ${err.message}`);
  }

  // 3. The discovery is real: the nine paths Codex found INDEPENDENTLY, outside
  //    the previous fourteen-path inventory, must all be discovered by the
  //    scanner rather than merely listed in the allowlist by hand.
  const discovered = new Set(scanRepository(REPO_ROOT).map((c) => c.path));
  for (const p of [
    "src/app/api/characters/generate-sora-character-video/route.ts",
    "src/app/api/generations/route.ts",
    "src/app/api/video-batch/sora-status/[taskId]/route.ts",
  ]) {
    ok(discovered.has(p), `the scanner independently discovers ${p}`, "STATIC");
  }

  const retiredRoutes = reviewedAllowlist.retiredMutationRoutes ?? [];
  const expectedRetiredPaths = [
    "src/app/api/user/credits/deduct/route.ts",
    "src/app/api/user/credits/refund/route.ts",
    "src/app/api/admin/set-credits/route.ts",
    "src/app/api/sora/generate/route.ts",
  ];
  ok(
    retiredRoutes.length === 4 &&
      JSON.stringify(retiredRoutes.map((entry) => entry.path).sort()) ===
        JSON.stringify([...expectedRetiredPaths].sort()),
    "the exact four unsafe credit mutation methods are registered as retired",
    "STATIC"
  );
  for (const entry of retiredRoutes) {
    const routePath = join(REPO_ROOT, ...entry.path.split("/"));
    const routeSource = readFileSync(routePath, "utf8");
    const handlerNames = [
      ...routeSource.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g),
    ].map((match) => match[1]);
    const postBody = routeSource.match(
      /export\s+async\s+function\s+POST\s*\(\s*\)\s*\{([\s\S]*?)\n\}/
    )?.[1] ?? "";
    const readOnlyHandlers = entry.readOnlyHandlers ?? [];
    const expectedHandlers = ["POST", ...readOnlyHandlers];
    const strictTombstone =
      readOnlyHandlers.length === 0
        ? !/\b(createAdminClient|createClient|request\.json|fetch)\b|\.from\s*\(|\.rpc\s*\(/.test(
            routeSource
          )
        : !/\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/.test(routeSource);
    ok(
      entry.disposition === "retired_unreachable" &&
        entry.status === 410 &&
        JSON.stringify(entry.methods) === JSON.stringify(["POST"]) &&
        sha256Hex(readFileSync(routePath)) === entry.sha256 &&
        JSON.stringify(handlerNames) === JSON.stringify(expectedHandlers) &&
        /\{\s*status:\s*410\s*\}/.test(postBody) &&
        !/\b(createAdminClient|createClient|request\.json|fetch)\b|\.from\s*\(|\.rpc\s*\(/.test(postBody) &&
        strictTombstone &&
        !discovered.has(entry.path),
      `${entry.path} has an exact-hash unconditional POST 410 tombstone with no mutation capability`,
      "STATIC"
    );
  }

  const convertedInitializers = reviewedAllowlist.convertedProfileInitializers ?? [];
  const expectedInitializerPaths = [
    "src/app/api/sms/verify/route.ts",
    "src/app/auth/register/page.tsx",
  ];
  ok(
    convertedInitializers.length === 2 &&
      JSON.stringify(convertedInitializers.map((entry) => entry.path).sort()) ===
        JSON.stringify([...expectedInitializerPaths].sort()),
    "the exact two former direct profile initializers are registered as trigger-converted",
    "STATIC"
  );
  for (const entry of convertedInitializers) {
    const initializerSource = readFileSync(
      join(REPO_ROOT, ...entry.path.split("/")),
      "utf8"
    );
    const carriesSignupName =
      entry.path === "src/app/api/sms/verify/route.ts"
        ? /user_metadata:\s*\{[\s\S]*?name:\s*`用户\$\{formattedPhone\.slice\(-4\)\}`/.test(
            initializerSource
          )
        : /options:\s*\{[\s\S]*?data:\s*\{\s*name\s*\}/.test(initializerSource);
    ok(
      entry.disposition === "converted_profile_init_to_auth_trigger" &&
        initializerSource.includes(entry.authCreation) &&
        carriesSignupName &&
        !/\.from\(\s*['"]profiles['"]\s*\)/.test(initializerSource) &&
        !/\bcredits\s*:/.test(initializerSource) &&
        !/canvas_p1_initialize_account_v1/.test(initializerSource) &&
        !discovered.has(entry.path),
      `${entry.path} creates only the auth identity and delegates profile/grant initialization to the reviewed trigger`,
      "STATIC"
    );
  }

  const convertedSharedPaths =
    reviewedAllowlist.convertedSharedCreditPaths ?? [];
  const expectedSharedPaths = [
    "src/lib/video-models/credits.ts",
    "src/app/api/video-batch/models/submit/route.ts",
    "src/app/api/video-batch/models/status/route.ts",
    "src/app/api/video-batch/generate-slideshow/route.ts",
    "src/app/api/studio/assembly/scene/route.ts",
    "src/app/api/characters/generate/route.ts",
    "src/app/api/characters/generate-sora-character-video/route.ts",
    "src/app/api/generate/route.ts",
    "src/app/api/generate/video/route.ts",
    "src/app/api/generations/route.ts",
    "src/app/api/seedance/submit/route.ts",
    "src/app/api/seedance/status/route.ts",
    "src/app/api/video-batch/happyhorse-status/[taskId]/route.ts",
    "src/app/api/video-batch/sora-status/[taskId]/route.ts",
    "src/app/api/generate/image/route.ts",
    "src/app/api/image-factory/generate-images/route.ts",
    "src/app/api/image-factory/task/[id]/route.ts",
    "src/lib/image-generation-worker.ts",
    "src/app/api/contracts/route.ts",
    "src/lib/actions/contracts.ts",
  ];
  ok(
    convertedSharedPaths.length === 20 &&
      JSON.stringify(convertedSharedPaths.map((entry) => entry.path).sort()) ===
        JSON.stringify([...expectedSharedPaths].sort()),
    "the shared task boundary tracks the video wrapper, hidden consumers, ordinary tasks, four image-task paths and both contract entry points",
    "STATIC"
  );

  const discoveredByPath = new Map(
    scanRepository(REPO_ROOT).map((entry) => [entry.path, entry])
  );
  for (const entry of convertedSharedPaths) {
    const source = readFileSync(
      join(REPO_ROOT, ...entry.path.split("/")),
      "utf8"
    );
    const discoveredEntry = discoveredByPath.get(entry.path);
    const hasDirectCreditClass =
      discoveredEntry?.classes.includes("profile_credit_mutation") ||
      discoveredEntry?.classes.includes("ledger_mutation");
    const hasExpectedBoundary =
      entry.role === "direct_atomic_consumer"
        ? /import\s+\{[^}]*\bapplyTaskCreditDelta\b[^}]*\}[\s\S]*?applyTaskCreditDelta\(\{/.test(
            source
          )
        : entry.role === "shared_video_credit_wrapper"
          ? (source.match(/applyTaskCreditDelta\(\{/g) ?? []).length === 3
          : entry.role === "video_submit_wrapper_consumer"
            ? /deductVideoCredits\(\{[\s\S]*?refundVideoCreditsDirect\(\{/.test(
                source
              )
            : /refundVideoCreditsOnce\(\{/.test(source);

    ok(
      entry.disposition === "converted_to_shared_boundary" &&
        hasExpectedBoundary &&
        !hasDirectCreditClass &&
        !/\badjustProfileCredits\b|\binsertCreditTransaction\b/.test(source) &&
        !/\.from\(\s*["']credit_transactions["']\s*\)[\s\S]{0,240}\.insert\s*\(/.test(
          source
        ),
      `${entry.path} has no direct credit mutation and reaches the reviewed atomic task boundary`,
      "STATIC"
    );
  }

  const adminUsersPath = "src/app/api/admin/users/route.ts";
  const adminUsersSource = readFileSync(
    join(REPO_ROOT, ...adminUsersPath.split("/")),
    "utf8"
  );
  const deactivationCase =
    adminUsersSource.match(
      /case\s+"delete":\s*\{([\s\S]*?)\n\s*break;\s*\n\s*\}/
    )?.[1] ?? "";
  const deactivationEntry = reviewedAllowlist.callsites.find(
    (entry) => entry.path === adminUsersPath
  );
  ok(
    deactivationEntry?.disposition === "converted_to_deactivation" &&
      JSON.stringify(deactivationEntry.classes) ===
        JSON.stringify(["ledger_mutation", "profile_credit_mutation"]) &&
      /rpc\("canvas_p1_deactivate_account_v1",\s*\{[\s\S]*?p_user_id:\s*targetUserId[\s\S]*?p_reason:\s*deactivationReason/.test(
        deactivationCase
      ) &&
      /retained_ledger_rows/.test(deactivationCase) &&
      !/\.delete\s*\(|auth\.admin\.deleteUser/.test(deactivationCase),
    "the legacy admin delete action delegates to audit-preserving account deactivation and cannot hard-delete profile, ledger, generation or auth rows",
    "STATIC"
  );

  const legacyOnlyEntries = reviewedAllowlist.callsites.filter(
    (entry) => entry.disposition === "legacy_generation_lifecycle_only"
  );
  const expectedLegacyOnlyPaths = [
    "src/app/api/admin/cleanup-tasks/route.ts",
    "src/app/api/studio/ai-gen/stitch/route.ts",
    "src/app/api/studio/library/route.ts",
    "src/app/api/studio/photo-post/publish/route.ts",
    "src/app/api/studio/photo-post/route.ts",
    "src/app/api/user/tasks/[id]/route.ts",
    "src/app/api/user/tasks/refresh/route.ts",
    "src/app/api/video-batch/generate-grok-video/route.ts",
    "src/app/api/video-batch/generate-happyhorse-video/route.ts",
    "src/app/api/video-batch/generate-sora-video/route.ts",
    "src/app/api/video-batch/generate-veo-video/route.ts",
    "src/app/api/video-batch/grok-status/[taskId]/route.ts",
    "src/app/api/video-batch/veo-status/[taskId]/route.ts",
  ];
  ok(
    legacyOnlyEntries.length === 13 &&
      JSON.stringify(legacyOnlyEntries.map((entry) => entry.path).sort()) ===
        JSON.stringify([...expectedLegacyOnlyPaths].sort()),
    "the exact 13 remaining legacy-only lifecycle paths stay frozen after three former entries were reclassified as hidden shared-credit consumers",
    "STATIC"
  );
  for (const entry of legacyOnlyEntries) {
    const source = readFileSync(
      join(REPO_ROOT, ...entry.path.split("/")),
      "utf8"
    );
    ok(
      !entry.classes.includes("profile_credit_mutation") &&
        !entry.classes.includes("ledger_mutation") &&
        !/applyTaskCreditDelta|canvas_p1_apply_credit_delta_v1|deductVideoCredits|refundVideoCredits|adjustProfileCredits|insertCreditTransaction/.test(
          source
        ) &&
        !/\.from\(\s*["']profiles["']\s*\)(?:(?!\.from\().)*\.(?:insert|update|upsert|delete)\s*\(/s.test(
          source
        ) &&
        !/\.from\(\s*["']credit_transactions["']\s*\)/.test(source),
      `${entry.path} remains lifecycle-only with no direct or shared credit mutation`,
      "STATIC"
    );
  }

  for (const entry of [
    {
      path: "src/app/api/generate/video/route.ts",
      provider: "querySora2Result",
    },
    {
      path: "src/app/api/seedance/status/route.ts",
      provider: "querySeedanceTask",
    },
    {
      path: "src/app/api/video-batch/happyhorse-status/[taskId]/route.ts",
      provider: "queryHappyHorseVideo",
    },
    {
      path: "src/app/api/video-batch/sora-status/[taskId]/route.ts",
      provider: "querySora2Result",
    },
    {
      path: "src/app/api/image-factory/task/[id]/route.ts",
      provider: "queryNanoBananaResult",
    },
  ]) {
    const source = readFileSync(
      join(REPO_ROOT, ...entry.path.split("/")),
      "utf8"
    );
    const ownerIndex = source.indexOf('.eq("user_id", user.id)');
    const providerIndex = source.indexOf(`${entry.provider}(`);
    ok(
      /auth\.getUser\(\)/.test(source) &&
        ownerIndex >= 0 &&
        providerIndex > ownerIndex,
      `${entry.path} proves authenticated ownership before querying the provider`,
      "STATIC"
    );
  }

  for (const path of [
    "src/app/api/generate/video/route.ts",
    "src/app/api/seedance/submit/route.ts",
  ]) {
    const source = readFileSync(join(REPO_ROOT, ...path.split("/")), "utf8");
    ok(
      /userId:\s*requestedUserId/.test(source) &&
        /requestedUserId\s*&&\s*requestedUserId\s*!==\s*user\.id/.test(source) &&
        /const userId = user\.id/.test(source),
      `${path} derives billing identity from auth and rejects a mismatched request userId`,
      "STATIC"
    );
  }

  const quickImageSource = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "generate", "image", "route.ts"),
    "utf8"
  );
  ok(
    (quickImageSource.match(/scope:\s*"quick-image"/g) ?? []).length === 2 &&
      (quickImageSource.match(/taskId:\s*generationId/g) ?? []).length === 2 &&
      /operation:\s*"consume"/.test(quickImageSource) &&
      /operation:\s*"refund"/.test(quickImageSource),
    "Quick Image binds consume and refund to the server-generated generation UUID",
    "STATIC"
  );

  const ecomSubmitSource = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "image-factory", "generate-images", "route.ts"),
    "utf8"
  );
  ok(
    /billing_attempt:\s*billingAttempt/.test(ecomSubmitSource) &&
      /operation:\s*`consume-a\$\{billingAttempt\}`/.test(ecomSubmitSource) &&
      /refund-a\$\{billingAttempt\}-f\$\{stage\.failedCount\}-of-\$\{stage\.totalCount\}/.test(
        ecomSubmitSource
      ) &&
      /getRecordedEcomRefundAmount\(/.test(ecomSubmitSource),
    "Image Factory submit scopes billing to a persisted attempt and binds partial refunds to deterministic failure counts",
    "STATIC"
  );

  const ecomStatusSource = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "image-factory", "task", "[id]", "route.ts"),
    "utf8"
  );
  ok(
    /refund-a\$\{refundPlan\.billingAttempt\}-f\$\{failedCount\}-of-\$\{totalCount\}/.test(
      ecomStatusSource
    ) &&
      /\.eq\("task_id",\s*taskId\)[\s\S]*?\.eq\("entry_kind",\s*"refund"\)/.test(
        ecomStatusSource
      ),
    "Image Factory polling deduplicates cumulative partial refunds by task, attempt and terminal failure count",
    "STATIC"
  );

  const imageWorkerSource = readFileSync(
    join(REPO_ROOT, "src", "lib", "image-generation-worker.ts"),
    "utf8"
  );
  ok(
    /scope:\s*"quick-image"[\s\S]*?taskId:\s*generationId[\s\S]*?operation:\s*"refund"/.test(
      imageWorkerSource
    ) &&
      /scope:\s*"ecom-image"[\s\S]*?taskId[\s\S]*?operation[\s\S]*?pricingVersion/.test(
        imageWorkerSource
      ) &&
      !/\.from\(\s*["']profiles["']\s*\)[\s\S]{0,600}\.update\s*\(/.test(imageWorkerSource) &&
      !/\.from\(\s*["']credit_transactions["']\s*\)[\s\S]{0,600}\.insert\s*\(/.test(
        imageWorkerSource
      ),
    "the image worker preserves legacy refund reads while all new Quick/e-commerce deltas use the atomic boundary",
    "STATIC"
  );

  const contractApiSource = readFileSync(
    join(REPO_ROOT, "src", "app", "api", "contracts", "route.ts"),
    "utf8"
  );
  ok(
    /operation:\s*"buyer-consume"/.test(contractApiSource) &&
      /operation:\s*"buyer-refund"/.test(contractApiSource) &&
      /operation:\s*"creator-grant"/.test(contractApiSource) &&
      /const newContractId = crypto\.randomUUID\(\)/.test(contractApiSource) &&
      /contract:\$\{params\.contract\.id\}:renew:\$\{crypto\.randomUUID\(\)\}/.test(
        contractApiSource
      ) &&
      /canvas_p1_contract_billing/.test(contractApiSource) &&
      /\.eq\("end_date",\s*claim\.contract\.end_date\)[\s\S]*?\.eq\("credits_paid",\s*claim\.contract\.credits_paid\)[\s\S]*?\.eq\("updated_at",\s*claim\.contract\.updated_at\)/.test(
        contractApiSource
      ),
    "the contract API binds create/renew buyer deltas and creator grants to server-generated contract tasks with a renewal CAS",
    "STATIC"
  );
  ok(
    /publish_price \|\| 100/.test(contractApiSource) &&
      /daily:\s*model\.price_daily \|\| 10/.test(contractApiSource) &&
      /weekly:\s*model\.price_weekly \|\| 50/.test(contractApiSource) &&
      /monthly:\s*model\.price_monthly \|\| 150/.test(contractApiSource) &&
      /yearly:\s*model\.price_yearly \|\| 1200/.test(contractApiSource),
    "the contract API preserves community and official rental prices",
    "STATIC"
  );

  const contractActionSource = readFileSync(
    join(REPO_ROOT, "src", "lib", "actions", "contracts.ts"),
    "utf8"
  );
  ok(
    /userId:\s*requestedUserId/.test(contractActionSource) &&
      /!user\s*\|\|\s*user\.id !== requestedUserId/.test(contractActionSource) &&
      /const userId = user\.id/.test(contractActionSource) &&
      /const contractId = crypto\.randomUUID\(\)/.test(contractActionSource),
    "the contract server action derives billing identity from auth, rejects mismatches and generates the contract task identity server-side",
    "STATIC"
  );
  ok(
    /daily:\s*\{\s*multiplier:\s*1\s*\/\s*30,\s*days:\s*1\s*\}/.test(
      contractActionSource
    ) &&
      /weekly:\s*\{\s*multiplier:\s*0\.25,\s*days:\s*7\s*\}/.test(
        contractActionSource
      ) &&
      /monthly:\s*\{\s*multiplier:\s*1,\s*days:\s*30\s*\}/.test(
        contractActionSource
      ) &&
      /yearly:\s*\{\s*multiplier:\s*10,\s*days:\s*365\s*\}/.test(
        contractActionSource
      ) &&
      /operation:\s*"buyer-consume"/.test(contractActionSource) &&
      /operation:\s*"buyer-refund"/.test(contractActionSource) &&
      /operation:\s*"creator-grant"/.test(contractActionSource),
    "the contract server action preserves rental multipliers while using atomic buyer and creator entries",
    "STATIC"
  );
}

// ###########################################################################
// main
// ###########################################################################
function multisetDiffRows(expectedRows, actualRows) {
  const expected = new Map();
  const actual = new Map();
  for (const row of expectedRows) {
    const key = canon(row);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  for (const row of actualRows) {
    const key = canon(row);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  const expand = (left, right) => {
    const rows = [];
    for (const [key, count] of left) {
      const remainder = count - (right.get(key) ?? 0);
      for (let i = 0; i < remainder; i += 1) rows.push(JSON.parse(key));
    }
    return rows;
  };

  return {
    added: expand(actual, expected),
    removed: expand(expected, actual),
  };
}

function buildPreApplyDiagnostic(actual, manifest, authUserTriggers) {
  const expectedDefaultAcl = manifest.sections.default_acl;
  const actualDefaultAcl = actual.default_acl;
  const affectsObjectsCreatedByPostgresInPublic = (row) =>
    row?.owner === "postgres" && (row?.schema === "public" || row?.schema === null);
  const expectedRelevant = expectedDefaultAcl.filter(affectsObjectsCreatedByPostgresInPublic);
  const actualRelevant = actualDefaultAcl.filter(affectsObjectsCreatedByPostgresInPublic);
  const relevantDiff = multisetDiffRows(expectedRelevant, actualRelevant);
  const comparison = compareCatalogSections(actual, manifest, REQUIRED_PRE_APPLY_SECTIONS);

  return Object.freeze({
    purpose:
      "READ ONLY diagnostic; no routine bodies, policy expressions, credentials or out-of-scope ACL rows are emitted.",
    mismatches: comparison.mismatches,
    default_acl: {
      expected_all_rows: expectedDefaultAcl.length,
      actual_all_rows: actualDefaultAcl.length,
      actual_out_of_scope_rows: actualDefaultAcl.length - actualRelevant.length,
      migration_relevant_scope: "owner=postgres AND schema IN (public, GLOBAL)",
      expected_relevant_rows: expectedRelevant.length,
      actual_relevant_rows: actualRelevant.length,
      expected_relevant_sha256: sectionDigest(expectedRelevant),
      actual_relevant_sha256: sectionDigest(actualRelevant),
      added_relevant_rows: relevantDiff.added,
      removed_relevant_rows: relevantDiff.removed,
    },
    trigger_functions: {
      expected: manifest.sections.trigger_functions,
      actual: actual.trigger_functions,
    },
    auth_signup_trigger: {
      expected: manifest.sections.auth_signup_trigger,
      actual: actual.auth_signup_trigger,
    },
    auth_user_triggers: authUserTriggers,
  });
}

async function main() {
  if (process.argv.includes("--list-runtime")) {
    for (const s of SCENARIOS) {
      const impl = REGISTRY.get(s.test);
      console.log(
        `${s.id}\t${s.area}\t${s.test}\t${impl && typeof impl.run === "function" ? "IMPLEMENTED" : "MISSING"}\t${s.invariant}`
      );
    }
    return 0;
  }

  gateRemoteFileLocks();
  gateGuards();
  gateReadOnlyChannel();
  gateDigests();
  gateManifests();
  gateRegistry();
  gateStatic();
  gateCallsites();

  const wantPreflight = process.argv.includes("--remote-preflight");
  const wantInspectPreapply = process.argv.includes("--inspect-preapply");
  const wantInspectRecovery = process.argv.includes("--inspect-runtime-recovery");
  const wantRecoverRuntime = process.argv.includes("--recover-interrupted-runtime");
  const wantCapture = process.argv.includes("--capture-post-apply");
  const wantRuntime = process.argv.includes("--runtime");
  let runtime = { executed: 0, passed: 0, failed: 0, skipped: SCENARIOS.length, failures: [] };

  if (
    [
      wantPreflight,
      wantInspectPreapply,
      wantInspectRecovery,
      wantRecoverRuntime,
      wantCapture,
      wantRuntime,
    ].filter(Boolean).length > 1
  ) {
    console.error(
      "--remote-preflight, --inspect-preapply, --inspect-runtime-recovery, " +
        "--recover-interrupted-runtime, --capture-post-apply and --runtime are mutually exclusive"
    );
    return 2;
  }

  if (wantPreflight) {
    if (process.env.CANVAS_P1_TARGET !== "remote") {
      console.error("--remote-preflight requires CANVAS_P1_TARGET=remote");
      return 2;
    }
    const remoteState = process.env.CANVAS_P1_REMOTE_STATE;
    if (remoteState !== "preapply" && remoteState !== "postapply") {
      console.error(
        "--remote-preflight requires CANVAS_P1_REMOTE_STATE=preapply|postapply"
      );
      return 2;
    }
    const target = resolveTarget({
      mode: "remote",
      remoteRef: process.env.CANVAS_P1_REMOTE_REF,
    });
    const gate =
      remoteState === "preapply"
        ? assertRemoteWriteAllowed(target, {
            preApplyManifest: loadPreApplyManifest(),
          })
        : assertRemotePostApplyWriteAllowed(target, {
            postApplyManifest: loadPostApplyManifest(),
          });
    console.log("");
    console.log(`Canvas P1 ${remoteState} remote preflight`);
    console.log("========================================");
    console.log(`remote state: ${remoteState}`);
    console.log(`catalog sections: ${gate.sectionCount}`);
    console.log(`catalog digest: ${gate.digest}`);
    for (const item of gate.proof) console.log(`proof: ${item}`);
    console.log("READ ONLY preflight passed. No migration or test write was executed.");
    return 0;
  }

  if (wantInspectPreapply) {
    if (process.env.CANVAS_P1_TARGET !== "remote") {
      console.error("--inspect-preapply requires CANVAS_P1_TARGET=remote");
      return 2;
    }
    const target = resolveTarget({
      mode: "remote",
      remoteRef: process.env.CANVAS_P1_REMOTE_REF,
    });
    const preApplyManifest = loadPreApplyManifest();
    try {
      assertRemoteWriteAllowed(target, { preApplyManifest });
    } catch (error) {
      if (
        !(error instanceof TargetRefusal) ||
        !error.message.includes("target catalog does not exactly match")
      ) {
        throw error;
      }
    }
    const actual = readCatalog(target);
    const authUserTriggers = JSON.parse(runReadOnlyProbe(target, "auth_user_triggers"));
    console.log(
      JSON.stringify(buildPreApplyDiagnostic(actual, preApplyManifest, authUserTriggers), null, 2)
    );
    console.log("READ ONLY diagnostic complete. No migration or test write was executed.");
    return 0;
  }

  if (wantInspectRecovery) {
    if (
      process.env.CANVAS_P1_TARGET !== "remote" ||
      process.env.CANVAS_P1_REMOTE_STATE !== "postapply"
    ) {
      console.error(
        "--inspect-runtime-recovery requires CANVAS_P1_TARGET=remote and " +
          "CANVAS_P1_REMOTE_STATE=postapply"
      );
      return 2;
    }
    const target = resolveTarget({
      mode: "remote",
      remoteRef: process.env.CANVAS_P1_REMOTE_REF,
    });
    const inspected = inspectRemoteRuntimeRecovery(target, {
      postApplyManifest: loadPostApplyManifest(),
    });
    console.log("");
    console.log("Canvas P1 interrupted-runtime recovery inventory");
    console.log("================================================");
    console.log(JSON.stringify(inspected.inventory, null, 2));
    console.log(`catalog sections: ${inspected.sectionCount}`);
    console.log(`catalog digest: ${inspected.digest}`);
    console.log("READ ONLY recovery inventory passed. No test row was deleted.");
    return 0;
  }

  if (wantRecoverRuntime) {
    if (
      process.env.CANVAS_P1_TARGET !== "remote" ||
      process.env.CANVAS_P1_REMOTE_STATE !== "postapply"
    ) {
      console.error(
        "--recover-interrupted-runtime requires CANVAS_P1_TARGET=remote and " +
          "CANVAS_P1_REMOTE_STATE=postapply"
      );
      return 2;
    }
    const target = resolveTarget({
      mode: "remote",
      remoteRef: process.env.CANVAS_P1_REMOTE_REF,
    });
    const gate = assertRemoteRuntimeRecoveryWriteAllowed(target, {
      postApplyManifest: loadPostApplyManifest(),
    });
    const cleanup = cleanupTrackedUserIds(target, [...gate.candidateIds]);
    const cleanupCounts = proveRemoteTestTablesEmpty(target);
    const finalCatalog = assertRemotePostApplyWriteAllowed(target, {
      postApplyManifest: loadPostApplyManifest(),
    });
    console.log("");
    console.log("Canvas P1 interrupted-runtime recovery");
    console.log("======================================");
    console.log(`catalog sections before cleanup: ${gate.sectionCount}`);
    console.log(`scoped test users removed: ${cleanup.users}`);
    console.log(`zero data surfaces proven: ${Object.keys(cleanupCounts).length}`);
    console.log(`post-cleanup catalog sections: ${finalCatalog.sectionCount}`);
    console.log("Interrupted-runtime recovery passed.");
    return 0;
  }

  if (wantCapture) {
    if (process.env.CANVAS_P1_TARGET !== "remote") {
      console.error("--capture-post-apply requires CANVAS_P1_TARGET=remote");
      return 2;
    }
    const remoteState = process.env.CANVAS_P1_REMOTE_STATE;
    if (remoteState !== "preapply" && remoteState !== "postapply") {
      console.error(
        "--capture-post-apply requires CANVAS_P1_REMOTE_STATE=preapply|postapply"
      );
      return 2;
    }
    const target = resolveTarget({
      mode: "remote",
      remoteRef: process.env.CANVAS_P1_REMOTE_REF,
    });
    const captured = await capturePostApplyEvidence(target, { remoteState });
    console.log("");
    console.log("Canvas P1 post-apply evidence capture");
    console.log("=====================================");
    console.log(`start state: ${remoteState}`);
    console.log(`directory: ${captured.directory}`);
    console.log(`post SHA-256: ${captured.post.sha256}`);
    console.log(`reapply SHA-256: ${captured.reapply.sha256}`);
    console.log(`post catalog digest: ${captured.post.catalogDigest}`);
    console.log(`reapply catalog digest: ${captured.reapply.catalogDigest}`);
    console.log(`catalog equality: ${captured.equal ? "PASS" : "FAIL"}`);
    console.log(`catalog sections: ${captured.sectionCount}`);
    console.log("");
    console.log("Stopped before ordinary runtime scenarios, as required.");
    return 0;
  }

  if (wantRuntime) {
    const mode = process.env.CANVAS_P1_TARGET;
    if (mode !== "fixture" && mode !== "remote") {
      console.error("--runtime requires CANVAS_P1_TARGET=fixture|remote");
      return 2;
    }
    const target = resolveTarget({ mode, remoteRef: process.env.CANVAS_P1_REMOTE_REF });
    // No expectedCatalog argument: the gate loads its own frozen manifest, so
    // the caller cannot be the authority over its own gate.
    const remoteState =
      mode === "remote" ? process.env.CANVAS_P1_REMOTE_STATE : null;
    if (mode === "remote" && remoteState !== "postapply") {
      console.error(
        "--runtime remote requires CANVAS_P1_REMOTE_STATE=postapply; a pre-apply Preview " +
          "Branch may only use --capture-post-apply"
      );
      return 2;
    }
    runtime = await runRuntime(target, { remoteState });
  }

  console.log("");
  console.log("Canvas P1 Batch 2 harness");
  console.log("=========================");
  console.log(
    `[GUARD+REGISTRY+STATIC] ${passed} passed, ${failures.length} failed, ${passed + failures.length} total`
  );
  if (wantRuntime) {
    console.log(
      `[RUNTIME]               executed ${runtime.executed}, passed ${runtime.passed}, ` +
        `failed ${runtime.failed}, skipped ${runtime.skipped} (of ${SCENARIOS.length})`
    );
    if (runtime.gate) {
      console.log(`[RUNTIME GATE]          ${runtime.gate.sectionCount} catalog sections proven`);
    }
    if (runtime.cleanup) {
      console.log(
        `[RUNTIME CLEANUP]       ${runtime.cleanup.users} scoped test user(s) removed`
      );
    }
    if (runtime.cleanupCounts) {
      console.log(
        `[CLEANUP PROOF]         ${Object.keys(runtime.cleanupCounts).length} test tables are exactly empty`
      );
    }
    if (runtime.finalCatalog) {
      console.log(
        `[FINAL CATALOG]         ${runtime.finalCatalog.sectionCount} frozen sections proven`
      );
    }
  } else {
    console.log(
      `[RUNTIME]               0 executed / ${SCENARIOS.length} declared — OFFLINE MODE, zero database contact.`
    );
    console.log("                        Every scenario has a real implementation (registry-proven),");
    console.log("                        but NONE has been executed. No runtime gate may be reported as passed.");
  }
  console.log("");

  const allFailures = [...failures, ...runtime.failures.map((f) => `[RUNTIME] ${f}`)];
  if (allFailures.length > 0) {
    console.error("FAILURES:");
    for (const f of allFailures) console.error(`  - ${f}`);
    return 1;
  }

  console.log(
    wantRuntime
      ? "All gates OK."
      : "Guard, registry and static gates OK. Runtime evidence remains outstanding."
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
