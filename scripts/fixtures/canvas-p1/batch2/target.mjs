#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · target resolution + fail-closed write gate.
 *
 * WHAT CHANGED IN THIS REVISION (Codex correction round 2)
 * ---------------------------------------------------------------------------
 * 1. THE PRE-GATE SQL CHANNEL IS GONE. The previous revision exported
 *    `readOnlyQuery(target, sql)`, which was "read-only" by NAME only: it
 *    handed arbitrary caller SQL straight to unrestricted `runPsql`, so DDL/DML
 *    could travel through it BEFORE assertRemoteWriteAllowed had run. The write
 *    gate was therefore bypassable by anything holding a target object.
 *
 *    There is now no function anywhere in this module that accepts SQL text
 *    from a caller. The pre-gate channel is a CLOSED SET of named probes
 *    (`PROBES`), each a compiled-in constant, executed through
 *    `runReadOnlyProbe(target, probeName)`. An unknown probe name refuses; there
 *    is no escape hatch and no "just this once" parameter.
 *
 * 2. THE PRE-GATE CHANNEL IS PHYSICALLY READ-ONLY AT THE SERVER, not by
 *    convention. Three independent, server-enforced layers, all fail-closed:
 *      (a) the session starts with `default_transaction_read_only=on`, pushed
 *          through PGOPTIONS on the probe child only;
 *      (b) the script opens an explicit `BEGIN TRANSACTION READ ONLY`;
 *      (c) the first statement inside that transaction PROVES read-only mode
 *          from the backend (`current_setting('transaction_read_only')`) and
 *          RAISEs if it is anything but `on`.
 *    PostgreSQL refuses INSERT/UPDATE/DELETE/MERGE/COPY FROM, every CREATE/
 *    ALTER/DROP, plus COMMENT/GRANT/REVOKE/TRUNCATE inside a READ ONLY
 *    transaction. This is enforced by the server, not by inspecting the string.
 *
 * 3. EVIDENCE IS SHA-256, NOT A LENGTH. The previous revision returned
 *    `digest: <canonical string>.length`, so two entirely different catalogs
 *    that happened to canonicalize to the same number of characters produced an
 *    identical "proof". Digests are now SHA-256 over canonical redacted JSON.
 *
 * 4. THE MANIFESTS ARE FROZEN DATA, NOT A CALLER CALLBACK. `assertPostApplyCatalog`
 *    used to take an `expectedPostApply` FUNCTION and let it decide -- the
 *    caller was the authority, which is not evidence. Pre-apply, post-apply and
 *    reapply are now frozen manifest files compared section-by-section by
 *    SHA-256, and the runtime path invokes them.
 *
 * WHAT PROVES THE TARGET
 * ---------------------------------------------------------------------------
 * * The endpoint is a CONSTANT TUPLE. `resolveTarget` ignores PGHOST/PGPORT/
 *   PGDATABASE/PGUSER entirely for remote mode; host/port/database/pooler
 *   tenant user are compiled in and passed as explicit -h/-p/-d/-U arguments.
 * * Every libpq indirection channel is STRIPPED from the child environment, so
 *   PGHOSTADDR cannot redirect the socket -- it is not there when psql runs.
 * * TLS `verify-full` validates the exact Session Pooler hostname. The exact
 *   `postgres.<branch-ref>` login user is the Supavisor tenant selector; the
 *   backend must additionally self-report database=postgres, user=postgres,
 *   PostgreSQL 17.6, an empty test dataset and the frozen exact catalog.
 * * Writes are physically gated: `runWrite` and `PsqlSession` both refuse
 *   unless the exact target object has passed `assertRemoteWriteAllowed`.
 *   The gate is what mints write permission, so a runner cannot forget it.
 *
 * CREDENTIALS
 * ---------------------------------------------------------------------------
 * PGPASSWORD is passed through to the child untouched and is never read, logged,
 * echoed, stored or serialized. This module contains no connection string and no
 * Supabase API client, so deleting the Preview Branch is inexpressible here.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_DB,
  FIXTURE_HOST,
  FIXTURE_PORT,
  FIXTURE_SUPERUSER,
  resolvePsql,
} from "../identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Production. Never a legal target, under any mode, flag or environment. */
export const FORBIDDEN_PRODUCTION_REF = "hfabrifuvujpdzarlbky";

/** The one isolated Preview Branch this harness may ever write to. */
export const ALLOWED_REMOTE_REF = "liibsugstuidwlmliyif";

/**
 * The EXACT reviewed Session Pooler tuple. Positive allowlist.
 *
 * Retained branch evidence fixes the region as East US (Ohio) = us-east-2.
 * The direct db.<ref> endpoint resolves IPv6-only and is unreachable from this
 * machine. Supabase documents the Session Pooler on port 5432 as the IPv4,
 * stateful alternative; transaction mode is deliberately not used because the
 * runtime suite needs persistent sessions and explicit lock barriers.
 */
export const ALLOWED_REMOTE_ENDPOINT = Object.freeze({
  ref: ALLOWED_REMOTE_REF,
  host: "aws-1-us-east-2.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: `postgres.${ALLOWED_REMOTE_REF}`,
  backendUser: "postgres",
  sslmode: "verify-full",
});

export const EXPECTED_REMOTE_SERVER_VERSION = "17.6";
const SCENARIO_RECOVERY_USER_LIMIT = 77;

/** Exact official Supabase production CA downloaded from the reviewed URL. */
export const EXPECTED_REMOTE_CA_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";

export const TARGET_TABLES = Object.freeze([
  "profiles",
  "generations",
  "credit_transactions",
  "canvases",
]);

/** Closed enum accepted by the table-count probe in either lifecycle state. */
export const PROBE_TABLES = Object.freeze([
  ...TARGET_TABLES,
  "generation_quota_buckets",
]);

/** The Batch-2-owned complete redacted introspection. */
export const BATCH2_INTROSPECT_SQL = join(__dirname, "sql", "batch2-introspect.sql");

/**
 * libpq variables that can redirect or re-parameterize a connection. All are
 * stripped from the child environment for remote mode. PGPASSWORD is absent
 * from this list on purpose: it is a credential, not an indirection, and is
 * passed through unread.
 */
const LIBPQ_INDIRECTION_VARS = Object.freeze([
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGOPTIONS",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGREQUIRESSL",
  "PGCONNECT_TIMEOUT",
  "PGTARGETSESSIONATTRS",
]);

/** Env var naming the TLS root certificate used to verify the exact host. */
export const SSLROOTCERT_ENV = "CANVAS_P1_SSLROOTCERT";

export class TargetRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetRefusal";
  }
}

/** Targets that have passed the write gate. Identity-keyed; not forgeable. */
const GATED = new WeakSet();

/* =========================================================================
 * CANONICALIZATION + CRYPTOGRAPHIC DIGESTS
 * ========================================================================= */

/** Stable-key canonical JSON, so section comparison is order-independent. */
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** SHA-256 over exact bytes (or UTF-8 bytes for a string), lowercase hex. */
export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Order-insensitive multiset digest of a section, as SHA-256.
 *
 * Rows are canonicalized individually, then SORTED, then hashed -- so row order
 * from the server is irrelevant but row CONTENT and MULTIPLICITY are not. A
 * duplicated row changes the digest; a reordered one does not.
 */
export function sectionDigest(rows) {
  if (rows === undefined) return sha256Hex("__ABSENT__");
  if (!Array.isArray(rows)) return sha256Hex(canon(rows));
  return sha256Hex(canon([...rows].map(canon).sort()));
}

/* =========================================================================
 * TARGET RESOLUTION
 * ========================================================================= */

/**
 * Refuse if the production ref appears in ANY consulted value. Retained as
 * defence in depth -- but note it is a denylist, and the real identity proof is
 * the constant endpoint tuple plus TLS verify-full.
 */
export function assertNoProductionReference(env = process.env) {
  for (const name of [...LIBPQ_INDIRECTION_VARS, SSLROOTCERT_ENV, "CANVAS_P1_REMOTE_REF"]) {
    const value = env[name];
    if (typeof value === "string" && value.includes(FORBIDDEN_PRODUCTION_REF)) {
      throw new TargetRefusal(
        `REFUSED: ${name} references the production project ref ${FORBIDDEN_PRODUCTION_REF}.`
      );
    }
  }
}

export function resolveTarget({ mode, remoteRef } = {}, env = process.env) {
  assertNoProductionReference(env);

  if (mode === "fixture") {
    return Object.freeze({
      mode: "fixture",
      host: FIXTURE_HOST,
      port: FIXTURE_PORT,
      database: FIXTURE_DB,
      user: FIXTURE_SUPERUSER,
      ref: null,
      sslmode: null,
      destructiveAllowed: true,
      expectedServerVersion: null,
    });
  }

  if (mode !== "remote") {
    throw new TargetRefusal(
      `REFUSED: unknown mode ${JSON.stringify(mode ?? null)}; expected "fixture" or "remote".`
    );
  }

  if (typeof remoteRef !== "string" || remoteRef.trim().length === 0) {
    throw new TargetRefusal(
      `REFUSED: remote mode requires an explicit ref. Set CANVAS_P1_REMOTE_REF=${ALLOWED_REMOTE_REF}.`
    );
  }

  const ref = remoteRef.trim();

  if (ref === FORBIDDEN_PRODUCTION_REF) {
    throw new TargetRefusal(
      `REFUSED: ${FORBIDDEN_PRODUCTION_REF} is PRODUCTION. This harness may never touch it.`
    );
  }

  // EXACT equality. No substring, no prefix, no "contains".
  if (ref !== ALLOWED_REMOTE_REF) {
    throw new TargetRefusal(
      `REFUSED: remote ref ${ref} is not the allowed isolated Preview Branch ${ALLOWED_REMOTE_REF}.`
    );
  }

  // Any indirection channel being SET at all is refused for remote mode. We do
  // not try to interpret it; an operator who has PGHOSTADDR set has an ambiguous
  // environment and ambiguity is refused, not resolved.
  for (const name of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) {
    if (typeof env[name] === "string" && env[name].length > 0) {
      throw new TargetRefusal(
        `REFUSED: ${name} is set. libpq indirection is not permitted in remote mode; the endpoint ` +
          "must be the compiled-in reviewed tuple."
      );
    }
  }

  // TLS verify-full binds the connection to the exact hostname cryptographically.
  const rootCert = env[SSLROOTCERT_ENV];
  if (typeof rootCert !== "string" || rootCert.trim().length === 0) {
    throw new TargetRefusal(
      `REFUSED: ${SSLROOTCERT_ENV} is required for remote mode so TLS can verify ` +
        `${ALLOWED_REMOTE_ENDPOINT.host} with sslmode=verify-full.`
    );
  }
  if (!existsSync(rootCert)) {
    throw new TargetRefusal(`REFUSED: ${SSLROOTCERT_ENV} points at a missing file.`);
  }

  return Object.freeze({
    mode: "remote",
    host: ALLOWED_REMOTE_ENDPOINT.host,
    port: ALLOWED_REMOTE_ENDPOINT.port,
    database: ALLOWED_REMOTE_ENDPOINT.database,
    user: ALLOWED_REMOTE_ENDPOINT.user,
    backendUser: ALLOWED_REMOTE_ENDPOINT.backendUser,
    ref,
    sslmode: ALLOWED_REMOTE_ENDPOINT.sslmode,
    sslrootcert: rootCert,
    // The Preview Branch is NEVER a destructive target.
    destructiveAllowed: false,
    expectedServerVersion: EXPECTED_REMOTE_SERVER_VERSION,
  });
}

/**
 * Pin the remote trust root before any socket is opened.
 *
 * resolveTarget() checks that a path exists so offline descriptor tests can use
 * a harmless fixture. Actual remote probes and writes call this stronger check:
 * the file must be one PEM certificate and its exact bytes must match the
 * reviewed official Supabase CA.
 */
export function assertRemoteTlsRootCertificate(target) {
  if (target.mode !== "remote") {
    throw new TargetRefusal("remote TLS root proof is only meaningful in remote mode.");
  }
  if (!target.sslrootcert || !existsSync(target.sslrootcert)) {
    throw new TargetRefusal("REFUSED: the remote TLS root certificate file is missing.");
  }

  const bytes = readFileSync(target.sslrootcert);
  const text = bytes.toString("utf8").trim();
  const beginCount = (text.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  const endCount = (text.match(/-----END CERTIFICATE-----/g) ?? []).length;
  if (
    beginCount !== 1 ||
    endCount !== 1 ||
    !text.startsWith("-----BEGIN CERTIFICATE-----") ||
    !text.endsWith("-----END CERTIFICATE-----")
  ) {
    throw new TargetRefusal(
      "REFUSED: the remote TLS root is not the expected single-certificate PEM."
    );
  }

  const actual = sha256Hex(bytes);
  if (actual !== EXPECTED_REMOTE_CA_SHA256) {
    throw new TargetRefusal(
      `REFUSED: the remote TLS root SHA-256 is ${actual}, expected ` +
        `${EXPECTED_REMOTE_CA_SHA256}.`
    );
  }
  return Object.freeze({ sha256: actual, bytes: bytes.length });
}

/** Child environment with every indirection channel stripped. */
export function buildChildEnv(target, env = process.env) {
  const child = { ...env };
  for (const name of LIBPQ_INDIRECTION_VARS) delete child[name];

  if (target.mode === "remote") {
    child.PGSSLMODE = target.sslmode;
    child.PGSSLROOTCERT = target.sslrootcert;
  }
  // PGPASSWORD (if present) is inherited untouched and never read here.
  return child;
}

/**
 * Child environment for the PRE-GATE READ-ONLY probe channel.
 *
 * Layer (a) of the read-only proof: the session default is read-only before a
 * single statement runs. Set AFTER the strip, so an inherited hostile PGOPTIONS
 * cannot turn it back off -- PGOPTIONS is in LIBPQ_INDIRECTION_VARS and is
 * deleted, then replaced with exactly this.
 */
export function buildReadOnlyChildEnv(target, env = process.env) {
  const child = buildChildEnv(target, env);
  child.PGOPTIONS = "-c default_transaction_read_only=on";
  return child;
}

/* =========================================================================
 * THE CLOSED PRE-GATE PROBE SET
 *
 * This is the ENTIRE surface reachable before the write gate passes. Every
 * entry is a compiled-in constant. No caller supplies SQL, so no caller can
 * smuggle DDL/DML through the pre-gate channel.
 *
 * `needsTable` probes take ONE argument, validated against the frozen
 * PROBE_TABLES allowlist -- an enum selection, never free text. The table name
 * is interpolated only after that check, and only from the constant array.
 * ========================================================================= */
export const PROBES = Object.freeze({
  /** Backend-evaluated server version. */
  server_version: Object.freeze({
    sql: "SELECT current_setting('server_version');",
  }),
  /** Backend-evaluated database name. Reflects the real socket, not -d. */
  current_database: Object.freeze({
    sql: "SELECT current_database();",
  }),
  /** Backend-evaluated effective user. */
  current_user: Object.freeze({
    sql: "SELECT current_user;",
  }),
  /**
   * Layer (c) of the read-only proof, exposed as its own probe so the harness
   * can assert the channel's read-only-ness directly rather than trusting it.
   */
  transaction_read_only: Object.freeze({
    sql: "SELECT current_setting('transaction_read_only');",
  }),
  /** Exact row count of ONE allow-listed target table. */
  table_count: Object.freeze({
    needsTable: true,
    sql: (table) => `SELECT count(*) FROM public.${table};`,
  }),
  /** auth.users is part of the test identity surface and must also be empty. */
  auth_user_count: Object.freeze({
    sql: "SELECT count(*) FROM auth.users;",
  }),
  /**
   * Closed recovery inventory for a runtime interrupted before cleanup.
   *
   * The only recoverable identities are auth users whose email is the exact
   * harness marker `u-<their canonical uuid>@test.invalid`. The result exposes
   * only those UUIDs plus aggregate counts proving that every row on the six
   * test data surfaces belongs to that candidate set.
   */
  runtime_recovery_inventory: Object.freeze({
    sql: `
WITH candidates AS MATERIALIZED (
    SELECT u.id
      FROM auth.users u
     WHERE u.email = 'u-' || u.id::text || '@test.invalid'
),
inventory AS (
    SELECT json_build_object(
        'candidate_ids', (
            SELECT coalesce(json_agg(c.id::text ORDER BY c.id), '[]'::json)
              FROM candidates c
        ),
        'auth_users_total', (SELECT count(*) FROM auth.users),
        'auth_users_outside_candidates', (
            SELECT count(*)
              FROM auth.users u
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = u.id)
        ),
        'profiles_total', (SELECT count(*) FROM public.profiles),
        'profiles_outside_candidates', (
            SELECT count(*)
              FROM public.profiles p
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = p.id)
        ),
        'canvases_total', (SELECT count(*) FROM public.canvases),
        'canvases_outside_candidates', (
            SELECT count(*)
              FROM public.canvases x
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = x.user_id)
        ),
        'generations_total', (SELECT count(*) FROM public.generations),
        'generations_outside_candidates', (
            SELECT count(*)
              FROM public.generations x
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = x.user_id)
        ),
        'credit_transactions_total', (SELECT count(*) FROM public.credit_transactions),
        'credit_transactions_outside_candidates', (
            SELECT count(*)
              FROM public.credit_transactions x
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = x.user_id)
        ),
        'generation_quota_buckets_total', (
            SELECT count(*) FROM public.generation_quota_buckets
        ),
        'generation_quota_buckets_outside_candidates', (
            SELECT count(*)
              FROM public.generation_quota_buckets x
             WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = x.user_id)
        )
    ) AS value
)
SELECT value::text FROM inventory;
`,
  }),
  /** Prove the migration role can deterministically repair the auth trigger. */
  auth_trigger_capability: Object.freeze({
    sql: "SELECT has_table_privilege(current_user, 'auth.users', 'TRIGGER');",
  }),
  /**
   * Complete redacted inventory of non-internal auth.users triggers.
   *
   * This closes the "missing expected trigger" diagnostic without exposing
   * function bodies or accepting caller SQL. Event/timing bits are catalog
   * facts; the fixed query cannot write.
   */
  auth_user_triggers: Object.freeze({
    sql: `
SELECT coalesce(
           json_agg(
             json_build_object(
               'name', t.tgname,
               'function', pn.nspname || '.' || p.proname || '()',
               'enabled', t.tgenabled::text,
               'for_each_row', (t.tgtype & 1) = 1,
               'timing', CASE
                 WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
                 WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
                 ELSE 'AFTER'
               END,
               'event_insert', (t.tgtype & 4) = 4,
               'event_delete', (t.tgtype & 8) = 8,
               'event_update', (t.tgtype & 16) = 16,
               'event_truncate', (t.tgtype & 32) = 32
             )
             ORDER BY t.tgname, pn.nspname, p.proname
           ),
           '[]'::json
       )::text
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE t.tgrelid = to_regclass('auth.users')
  AND NOT t.tgisinternal;
`,
  }),
  /** The complete Batch-2 redacted catalog surface, as one JSON object. */
  batch2_catalog: Object.freeze({
    file: BATCH2_INTROSPECT_SQL,
  }),
});

/**
 * The read-only preamble. Layers (b) and (c).
 *
 * `BEGIN TRANSACTION READ ONLY` is the server-enforced mode; the DO block then
 * PROVES it from the backend's own setting and raises otherwise, so the channel
 * fails closed if read-only mode cannot be established (for example because a
 * future edit dropped the BEGIN, or a pooler swallowed it).
 */
const READ_ONLY_PREAMBLE = `
BEGIN TRANSACTION READ ONLY;
DO $canvas_p1_ro_guard$
BEGIN
    IF current_setting('transaction_read_only') <> 'on' THEN
        RAISE EXCEPTION
            'canvas-p1 pre-gate probe: transaction is not READ ONLY (transaction_read_only=%); '
            'refusing to run a probe on a channel that could write',
            current_setting('transaction_read_only');
    END IF;
END
$canvas_p1_ro_guard$;
`;

function probeArgs(target) {
  return [
    "--no-password",
    "--no-psqlrc",
    "--no-align",
    "--tuples-only",
    "--quiet",
    "--set",
    "ON_ERROR_STOP=1",
    "-h",
    String(target.host),
    "-p",
    String(target.port),
    "-d",
    String(target.database),
    "-U",
    String(target.user),
    // Read the script from stdin so BEGIN/COMMIT are honoured as real
    // transaction control. `-c` would send every statement as one simple query
    // in a single implicit transaction, which would make the explicit
    // BEGIN TRANSACTION READ ONLY a no-op with a warning.
    "-f",
    "-",
  ];
}

/** Build the exact script a probe runs. Exported so the offline gate can prove it. */
export function buildProbeScript(probeName, table = null) {
  const probe = Object.prototype.hasOwnProperty.call(PROBES, probeName) ? PROBES[probeName] : null;
  if (!probe) {
    throw new TargetRefusal(
      `REFUSED: unknown pre-gate probe ${JSON.stringify(probeName)}. The pre-gate channel is a ` +
        `closed set: ${Object.keys(PROBES).join(", ")}. There is no arbitrary-SQL path.`
    );
  }

  let body;
  if (probe.file) {
    if (!existsSync(probe.file)) {
      throw new TargetRefusal(`REFUSED: probe ${probeName} references a missing SQL file.`);
    }
    body = `\\i ${probe.file.replace(/\\/g, "/")}\n`;
  } else if (probe.needsTable) {
    // ENUM SELECTION, not interpolation of caller text. The name written into
    // the statement comes from the frozen PROBE_TABLES constant, never from
    // the argument -- the argument only selects which constant to use.
    const idx = PROBE_TABLES.indexOf(table);
    if (idx === -1) {
      throw new TargetRefusal(
        `REFUSED: probe ${probeName} accepts only an allow-listed target table ` +
          `(${PROBE_TABLES.join(", ")}), got ${JSON.stringify(table)}.`
      );
    }
    body = `${probe.sql(PROBE_TABLES[idx])}\n`;
  } else {
    if (table !== null) {
      throw new TargetRefusal(`REFUSED: probe ${probeName} takes no table argument.`);
    }
    body = `${probe.sql}\n`;
  }

  return `${READ_ONLY_PREAMBLE}${body}COMMIT;\n`;
}

/**
 * Run ONE named read-only probe. This is the only pre-gate channel that exists.
 *
 * There is deliberately no `sql` parameter. A caller cannot express a mutation
 * here, and the server would refuse it anyway inside the READ ONLY transaction.
 */
export function runReadOnlyProbe(target, probeName, table = null) {
  if (target.mode === "remote") assertRemoteTlsRootCertificate(target);
  const script = buildProbeScript(probeName, table);
  const res = spawnSync(resolvePsql(), probeArgs(target), {
    encoding: "utf8",
    input: script,
    env: buildReadOnlyChildEnv(target),
  });

  if (res.error) throw new Error(`psql failed to start: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `read-only probe ${probeName} exited ${res.status}: ` +
        `${String(res.stderr ?? "").trim() || "<no stderr>"}`
    );
  }
  return String(res.stdout ?? "").trim();
}

/* =========================================================================
 * THE WRITE CHANNEL
 * ========================================================================= */

function runPsqlWrite(target, { sql, file, files }) {
  if (target.mode === "remote") assertRemoteTlsRootCertificate(target);
  const args = [
    "--no-password",
    "--no-psqlrc",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "-h",
    String(target.host),
    "-p",
    String(target.port),
    "-d",
    String(target.database),
    "-U",
    String(target.user),
  ];

  if (file !== undefined && files !== undefined) {
    throw new TargetRefusal("REFUSED: use either file or files, never both.");
  }
  if (files !== undefined && (!Array.isArray(files) || files.length === 0)) {
    throw new TargetRefusal("REFUSED: files must be a non-empty array.");
  }
  const fileList = files ?? (file ? [file] : []);
  if (fileList.length > 0) {
    if (sql !== undefined) {
      throw new TargetRefusal("REFUSED: a write cannot mix SQL text with migration files.");
    }
    // All supplied migration files are one PostgreSQL transaction. Without
    // this, file 1 can commit before file 2 fails and strand the branch in a
    // catalog state that matches neither the pre-apply nor post-apply gate.
    args.push("--single-transaction");
    for (const migrationFile of fileList) {
      if (typeof migrationFile !== "string" || migrationFile.trim().length === 0) {
        throw new TargetRefusal("REFUSED: every migration file path must be a nonblank string.");
      }
      args.push("-f", migrationFile);
    }
  } else {
    if (typeof sql !== "string" || sql.trim().length === 0) {
      throw new TargetRefusal("REFUSED: a write requires SQL text or at least one migration file.");
    }
    args.push("-c", sql);
  }

  const res = spawnSync(resolvePsql(), args, {
    encoding: "utf8",
    env: buildChildEnv(target),
  });

  if (res.error) throw new Error(`psql failed to start: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `psql exited ${res.status}: ${String(res.stderr ?? "").trim() || "<no stderr>"}`
    );
  }
  return String(res.stdout ?? "").trim();
}

/**
 * Write path. Throws unless this exact target passed the gate, so a runner
 * cannot reach a Preview Branch write without the proof.
 */
export function runWrite(target, { sql, file, files }) {
  if (target.mode === "remote" && !GATED.has(target)) {
    throw new TargetRefusal(
      "REFUSED: remote write attempted before assertRemoteWriteAllowed() passed for this target."
    );
  }
  return runPsqlWrite(target, { sql, file, files });
}

export function isGated(target) {
  return GATED.has(target);
}

/* =========================================================================
 * THE WRITE GATE
 * ========================================================================= */

/** Sections the pre-apply manifest MUST cover. Absence refuses; it is not a pass. */
export const REQUIRED_PRE_APPLY_SECTIONS = Object.freeze([
  "target_expectations",
  "relations",
  "columns",
  "constraints",
  "indexes",
  "policies",
  "relation_acl",
  "column_acl",
  "default_acl",
  "incoming_foreign_keys",
  "profile_key_columns",
  "triggers",
  "trigger_functions",
  "lifecycle_routines",
  "auth_signup_trigger",
  "auth_user_triggers",
  "handle_new_user",
]);

/** Sections the post-apply / reapply manifests MUST cover. */
export const REQUIRED_POST_APPLY_SECTIONS = Object.freeze([
  ...REQUIRED_PRE_APPLY_SECTIONS,
  "quota_bucket_shape",
]);

/**
 * A manifest section whose value has not been established by reviewed evidence
 * carries this sentinel. It is a REFUSAL, never a wildcard: the gate treats it
 * as "this surface is unproven" and stops. Fabricating a value would be worse
 * than refusing, and silently skipping the section would be worse still.
 */
export const UNPROVEN = "__UNPROVEN__";

function assertManifestComplete(manifest, requiredSections, label) {
  if (!manifest || typeof manifest !== "object" || !manifest.sections) {
    throw new TargetRefusal(
      `REFUSED: the ${label} manifest is missing or has no "sections" object. Frozen manifest data ` +
        "is mandatory; a caller-supplied callback is not evidence."
    );
  }

  const missing = requiredSections.filter(
    (s) => !Object.prototype.hasOwnProperty.call(manifest.sections, s)
  );
  if (missing.length > 0) {
    throw new TargetRefusal(
      `REFUSED: the ${label} manifest does not cover required section(s): ${missing.join(", ")}. ` +
        "Every baseline surface the migration reads or writes must be frozen before a remote write."
    );
  }

  const unproven = requiredSections.filter((s) => manifest.sections[s] === UNPROVEN);
  if (unproven.length > 0) {
    throw new TargetRefusal(
      `REFUSED: the ${label} manifest marks section(s) ${unproven.join(", ")} as ${UNPROVEN}. ` +
        "The gate fails closed on an unproven surface rather than accepting it as a wildcard."
    );
  }
}

/**
 * Compare an introspected catalog against a frozen manifest, section by
 * section, by SHA-256 of canonical redacted JSON.
 *
 * Returns { digest, sectionDigests, mismatches }. Never returns the CONTENT of
 * a mismatched section: relation ACLs and policy metadata are sensitive and
 * routine bodies must never be logged. Only the section name and row counts.
 */
export function compareCatalogSections(actual, manifest, requiredSections) {
  const mismatches = [];
  const sectionDigests = {};

  for (const section of requiredSections) {
    const want = sectionDigest(manifest.sections[section]);
    const got = sectionDigest(actual?.[section]);
    sectionDigests[section] = got;
    if (want !== got) {
      const wantRows = Array.isArray(manifest.sections[section])
        ? manifest.sections[section].length
        : "n/a";
      const gotRows = Array.isArray(actual?.[section]) ? actual[section].length : "n/a";
      mismatches.push(`${section} (expected ${wantRows} rows, got ${gotRows})`);
    }
  }

  // ONE cryptographic fingerprint over every section digest, in a fixed order.
  // This replaces the previous revision's canonical-string LENGTH, which
  // collided trivially: two distinct catalogs of equal canonical length
  // produced the same "proof".
  const digest = sha256Hex(
    canon(requiredSections.map((s) => `${s}:${sectionDigests[s]}`))
  );

  return { digest, sectionDigests, mismatches };
}

/** Read the complete Batch-2 catalog surface through the read-only probe channel. */
export function readCatalog(target) {
  const raw = runReadOnlyProbe(target, "batch2_catalog");
  try {
    return JSON.parse(raw);
  } catch {
    throw new TargetRefusal("REFUSED: catalog introspection did not return parseable JSON.");
  }
}

/**
 * Prove the remote backend identity and that the named test tables are empty.
 * Every probe is in the closed, server-enforced READ ONLY channel.
 */
function assertRemoteIdentity(target) {
  if (target.mode !== "remote") {
    throw new TargetRefusal("remote identity proof is only meaningful in remote mode.");
  }

  assertNoProductionReference();
  const proof = [];

  const ro = runReadOnlyProbe(target, "transaction_read_only");
  if (ro !== "on") {
    throw new TargetRefusal(
      `REFUSED: the pre-gate probe channel reports transaction_read_only=${ro}, expected "on". ` +
        "Refusing to probe a target over a channel that is not server-enforced read-only."
    );
  }
  proof.push("pre_gate_channel=read_only");

  const version = runReadOnlyProbe(target, "server_version");
  if (version !== EXPECTED_REMOTE_SERVER_VERSION) {
    throw new TargetRefusal(
      `REFUSED: server_version is ${version}, expected ${EXPECTED_REMOTE_SERVER_VERSION}.`
    );
  }
  proof.push(`server_version=${version}`);

  const dbName = runReadOnlyProbe(target, "current_database");
  if (dbName !== target.database || dbName.includes(FORBIDDEN_PRODUCTION_REF)) {
    throw new TargetRefusal(`REFUSED: backend database is ${dbName}, expected ${target.database}.`);
  }
  proof.push(`database=${dbName}`);

  const dbUser = runReadOnlyProbe(target, "current_user");
  if (dbUser !== target.backendUser) {
    throw new TargetRefusal(
      `REFUSED: backend user is ${dbUser}, expected ${target.backendUser}.`
    );
  }
  proof.push(`user=${dbUser}`);

  const canRepairAuthTrigger = runReadOnlyProbe(target, "auth_trigger_capability");
  if (canRepairAuthTrigger !== "t") {
    throw new TargetRefusal(
      "REFUSED: the Preview migration role lacks TRIGGER privilege on auth.users; the missing " +
        "signup trigger cannot be repaired atomically."
    );
  }
  proof.push("auth.users_trigger_privilege=true");

  return proof;
}

function assertRemoteIdentityAndEmpty(target, tables) {
  const proof = assertRemoteIdentity(target);

  for (const table of tables) {
    const raw = runReadOnlyProbe(target, "table_count", table);
    if (!/^(0|[1-9]\d*)$/.test(raw)) {
      throw new TargetRefusal(`REFUSED: could not prove public.${table} is empty.`);
    }
    const count = Number(raw);
    if (count !== 0) {
      throw new TargetRefusal(
        `REFUSED: public.${table} holds ${count} row(s). This harness only runs against a provably ` +
          "data-empty isolated branch."
      );
    }
    proof.push(`${table}=0`);
  }

  const authRaw = runReadOnlyProbe(target, "auth_user_count");
  if (!/^(0|[1-9]\d*)$/.test(authRaw)) {
    throw new TargetRefusal("REFUSED: could not prove auth.users is empty.");
  }
  const authCount = Number(authRaw);
  if (authCount !== 0) {
    throw new TargetRefusal(
      `REFUSED: auth.users holds ${authCount} row(s). This harness only runs against a provably ` +
        "data-empty isolated branch."
    );
  }
  proof.push("auth.users=0");

  return proof;
}

/**
 * THE WRITE GATE. Read-only. Must pass before the first remote write.
 *
 * Everything it runs goes through the closed read-only probe set, so the gate
 * itself cannot write and cannot be used to smuggle a write.
 *
 * @param {object} target
 * @param {object} opts
 * @param {object} opts.preApplyManifest  MANDATORY frozen pre-apply manifest.
 */
export function assertRemoteWriteAllowed(target, { preApplyManifest } = {}) {
  if (target.mode !== "remote") {
    throw new TargetRefusal("assertRemoteWriteAllowed is only meaningful in remote mode.");
  }

  assertManifestComplete(preApplyManifest, REQUIRED_PRE_APPLY_SECTIONS, "pre-apply");
  const proof = assertRemoteIdentityAndEmpty(target, TARGET_TABLES);

  // --- EXACT canonical catalog comparison, SHA-256 -------------------------
  const actual = readCatalog(target);
  const { digest, mismatches } = compareCatalogSections(
    actual,
    preApplyManifest,
    REQUIRED_PRE_APPLY_SECTIONS
  );

  if (mismatches.length > 0) {
    throw new TargetRefusal(
      "REFUSED: the target catalog does not exactly match the accepted pre-apply manifest. " +
        `Mismatched sections: ${mismatches.join("; ")}. Refusing to apply a migration designed ` +
        "against a different shape."
    );
  }

  // --- Signup-trigger repair precondition, BEFORE the first write -----------
  // The current Preview Branch is missing the historical trigger because its
  // schema was reconstructed from migration history. Repair is safe only when
  // there is no differently named competing auth.users trigger that could
  // initialize the same account a second time. The complete inventory is a
  // required frozen section and must be exactly empty.
  const trig = actual.auth_signup_trigger;
  if (
    !trig ||
    trig.present !== false ||
    trig.name !== "<absent>" ||
    trig.function !== "<absent>"
  ) {
    throw new TargetRefusal(
      "REFUSED: the Preview signup-trigger state no longer matches the reviewed missing-trigger " +
        "repair precondition."
    );
  }
  if (!Array.isArray(actual.auth_user_triggers) || actual.auth_user_triggers.length !== 0) {
    throw new TargetRefusal(
      "REFUSED: auth.users has an unexpected non-internal trigger. Creating the reviewed signup " +
        "trigger could produce a second account-initialization path."
    );
  }
  proof.push("auth_signup_trigger=absent;auth_user_triggers=0;repair_required");

  GATED.add(target);

  return Object.freeze({
    allowed: true,
    // Redacted cryptographic proof. SHA-256 over the section digests -- not a
    // length. Contains no ACL content, no routine body, no role graph.
    digest,
    sectionCount: REQUIRED_PRE_APPLY_SECTIONS.length,
    proof: Object.freeze(proof),
  });
}

/**
 * Recovery gate for the deliberate Phase 3B -> 3C handoff.
 *
 * After the first atomic apply and evidence capture, the branch no longer
 * matches the pre-apply manifest. A later process may mint write capability
 * only when the branch is still data-empty and its COMPLETE catalog exactly
 * matches the reviewed, frozen post-apply manifest. This is not a fallback:
 * callers must explicitly select the post-apply state.
 */
export function assertRemotePostApplyWriteAllowed(target, { postApplyManifest } = {}) {
  if (target.mode !== "remote") {
    throw new TargetRefusal(
      "assertRemotePostApplyWriteAllowed is only meaningful in remote mode."
    );
  }

  assertManifestComplete(postApplyManifest, REQUIRED_POST_APPLY_SECTIONS, "post-apply recovery");
  const proof = assertRemoteIdentityAndEmpty(target, [
    ...TARGET_TABLES,
    "generation_quota_buckets",
  ]);

  const actual = readCatalog(target);
  const { digest, mismatches } = compareCatalogSections(
    actual,
    postApplyManifest,
    REQUIRED_POST_APPLY_SECTIONS
  );

  if (mismatches.length > 0) {
    throw new TargetRefusal(
      "REFUSED: the target catalog does not exactly match the frozen post-apply recovery " +
        `manifest. Mismatched sections: ${mismatches.join("; ")}.`
    );
  }

  GATED.add(target);
  return Object.freeze({
    allowed: true,
    state: "post-apply",
    digest,
    sectionCount: REQUIRED_POST_APPLY_SECTIONS.length,
    proof: Object.freeze(proof),
  });
}

const RECOVERY_COUNT_FIELDS = Object.freeze([
  "auth_users_total",
  "auth_users_outside_candidates",
  "profiles_total",
  "profiles_outside_candidates",
  "canvases_total",
  "canvases_outside_candidates",
  "generations_total",
  "generations_outside_candidates",
  "credit_transactions_total",
  "credit_transactions_outside_candidates",
  "generation_quota_buckets_total",
  "generation_quota_buckets_outside_candidates",
]);

/**
 * Read-only proof for a runtime interrupted after test rows were written but
 * before its normal finally cleanup could connect.
 */
export function inspectRemoteRuntimeRecovery(target, { postApplyManifest } = {}) {
  if (target.mode !== "remote") {
    throw new TargetRefusal(
      "inspectRemoteRuntimeRecovery is only meaningful in remote mode."
    );
  }

  assertManifestComplete(postApplyManifest, REQUIRED_POST_APPLY_SECTIONS, "runtime recovery");
  const proof = assertRemoteIdentity(target);

  const actual = readCatalog(target);
  const { digest, mismatches } = compareCatalogSections(
    actual,
    postApplyManifest,
    REQUIRED_POST_APPLY_SECTIONS
  );
  if (mismatches.length > 0) {
    throw new TargetRefusal(
      "REFUSED: interrupted-runtime recovery catalog does not exactly match the frozen " +
        `post-apply manifest. Mismatched sections: ${mismatches.join("; ")}.`
    );
  }

  let inventory;
  try {
    inventory = JSON.parse(runReadOnlyProbe(target, "runtime_recovery_inventory"));
  } catch {
    throw new TargetRefusal(
      "REFUSED: interrupted-runtime recovery inventory was not parseable JSON."
    );
  }

  const keys = Object.keys(inventory).sort();
  const expectedKeys = ["candidate_ids", ...RECOVERY_COUNT_FIELDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new TargetRefusal(
      "REFUSED: interrupted-runtime recovery inventory has an unexpected shape."
    );
  }

  if (!Array.isArray(inventory.candidate_ids)) {
    throw new TargetRefusal("REFUSED: recovery candidate_ids is not an array.");
  }
  const candidateIds = inventory.candidate_ids.map((id) => String(id));
  if (
    candidateIds.length > SCENARIO_RECOVERY_USER_LIMIT ||
    new Set(candidateIds).size !== candidateIds.length ||
    candidateIds.some(
      (id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
  ) {
    throw new TargetRefusal(
      "REFUSED: recovery candidates must be 0..77 unique canonical UUIDs."
    );
  }

  for (const field of RECOVERY_COUNT_FIELDS) {
    if (!Number.isInteger(inventory[field]) || inventory[field] < 0) {
      throw new TargetRefusal(`REFUSED: recovery inventory field ${field} is not a row count.`);
    }
  }
  if (inventory.auth_users_total !== candidateIds.length) {
    throw new TargetRefusal(
      "REFUSED: not every auth.users row is an exact harness-marked recovery candidate."
    );
  }
  for (const field of RECOVERY_COUNT_FIELDS.filter((name) =>
    name.endsWith("_outside_candidates")
  )) {
    if (inventory[field] !== 0) {
      throw new TargetRefusal(
        `REFUSED: recovery inventory found ${inventory[field]} row(s) outside the exact ` +
          `harness candidate set on ${field.replace("_outside_candidates", "")}.`
      );
    }
  }

  proof.push(`runtime_recovery_candidates=${candidateIds.length}`);
  proof.push("runtime_recovery_outside_candidates=0");
  return Object.freeze({
    allowed: true,
    state: "post-apply-interrupted-runtime",
    digest,
    sectionCount: REQUIRED_POST_APPLY_SECTIONS.length,
    proof: Object.freeze(proof),
    candidateIds: Object.freeze(candidateIds),
    inventory: Object.freeze({ ...inventory, candidate_ids: Object.freeze(candidateIds) }),
  });
}

/** Mint write capability only after the read-only interrupted-runtime proof. */
export function assertRemoteRuntimeRecoveryWriteAllowed(target, opts = {}) {
  const inspected = inspectRemoteRuntimeRecovery(target, opts);
  if (inspected.candidateIds.length === 0) {
    throw new TargetRefusal(
      "REFUSED: interrupted-runtime recovery has no candidate rows; recovery write is unnecessary."
    );
  }
  GATED.add(target);
  return inspected;
}

/**
 * Post-apply / post-reapply comparison against a FROZEN manifest.
 *
 * The previous revision took an `expectedPostApply` CALLBACK and returned
 * whatever it decided -- the caller was the authority, which is not evidence.
 * It was also never invoked from the runtime path. This takes frozen data,
 * compares by SHA-256, and raises on any mismatch.
 */
export function assertPostApplyCatalog(target, { manifest, label = "post-apply" } = {}) {
  assertManifestComplete(manifest, REQUIRED_POST_APPLY_SECTIONS, label);

  const actual = readCatalog(target);
  const { digest, mismatches } = compareCatalogSections(
    actual,
    manifest,
    REQUIRED_POST_APPLY_SECTIONS
  );

  if (mismatches.length > 0) {
    throw new TargetRefusal(
      `REFUSED: the ${label} catalog does not match the frozen ${label} manifest. ` +
        `Mismatched sections: ${mismatches.join("; ")}.`
    );
  }

  return Object.freeze({ digest, sectionCount: REQUIRED_POST_APPLY_SECTIONS.length });
}

export function assertNoRemoteDestructiveCapability(target) {
  if (target.mode === "remote" && target.destructiveAllowed) {
    throw new TargetRefusal("REFUSED: a remote target must never be marked destructiveAllowed.");
  }
  return true;
}
