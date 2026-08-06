#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read(
  "supabase/migrations/20260801_canvas_upload_registry.sql"
);
const ambiguityFix = read(
  "supabase/migrations/20260802_canvas_upload_registry_ambiguity_fix.sql"
);
const credentials = read(
  "src/app/api/canvas/uploads/credentials/route.ts"
);
const finalize = read("src/app/api/canvas/uploads/finalize/route.ts");
const client = read("src/components/canvas/canvas-upload.ts");
const createRoute = read("src/app/api/canvas/route.ts");
const writeRoute = read("src/app/api/canvas/[id]/route.ts");
const registry = read("src/lib/canvas/upload-registry.ts");
const generation = read("src/lib/canvas/generation-service.ts");
const sweeper = read("scripts/sweep-canvas-upload-reservations.mjs");

let passed = 0;
const failures = [];
function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function returnsTableFunctions(sql) {
  const starts = [
    ...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g),
  ];
  const functions = new Map();
  starts.forEach((match, index) => {
    const source = sql.slice(
      match.index,
      starts[index + 1]?.index ?? sql.length
    );
    const returns = source.match(
      /RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE plpgsql/
    );
    const body = source.match(/AS \$\$([\s\S]*?)\$\$;/);
    if (!returns || !body) return;
    functions.set(match[1], {
      definition: source.slice(0, source.indexOf("$$;", source.indexOf("AS $$")) + 3),
      outputs: [
        ...returns[1].matchAll(/^\s*(\w+)\s+/gm),
      ].map((output) => output[1]),
      body: body[1],
    });
  });
  return functions;
}

function stripSqlNoise(body) {
  return body
    .replace(/--[^\r\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(
      /INSERT\s+INTO\s+[A-Za-z0-9_."]+\s*\([^)]*\)(?=\s*(?:VALUES|SELECT))/gi,
      "INSERT_TARGET_COLUMNS"
    );
}

function outputReferenceConflicts(functions) {
  const conflicts = [];
  for (const [functionName, fn] of functions) {
    const body = stripSqlNoise(fn.body);
    for (const output of fn.outputs) {
      const reference = new RegExp(`(?<![\\w.])${output}(?![\\w])`, "g");
      for (const match of body.matchAll(reference)) {
        const after = body.slice(match.index + output.length);
        const statement = body.slice(
          Math.max(
            body.lastIndexOf(";", match.index) + 1,
            body.lastIndexOf("BEGIN", match.index) + "BEGIN".length
          ),
          match.index
        );
        // UPDATE SET targets are grammar-resolved column positions, not
        // expression references. A bare output name anywhere else is unsafe.
        const setTarget =
          /^\s*=/.test(after) &&
          /\bUPDATE\b[\s\S]*\bSET\b/i.test(statement) &&
          !/\bWHERE\b/i.test(statement.slice(statement.search(/\bSET\b/i)));
        if (!setTarget) conflicts.push(`${functionName}.${output}`);
      }
    }
  }
  return conflicts;
}

function normalizedDefinition(definition) {
  return definition
    .replace(/--[^\r\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const registryFunctions = returnsTableFunctions(migration);
const repairFunctions = returnsTableFunctions(ambiguityFix);

ok(
  !/^\s*(BEGIN|COMMIT)\s*;/im.test(migration),
  "migration has no transaction boundary and can be embedded atomically"
);
ok(
  !migration.includes("SET search_path = pg_catalog, public") &&
    (migration.match(/SET search_path = ''/g)?.length ?? 0) === 8,
  "all registry functions use an empty search path"
);
ok(
  JSON.stringify([...registryFunctions.keys()]) ===
    JSON.stringify([
      "reserve_canvas_uploads_v1",
      "finalize_canvas_upload_v1",
      "sweep_expired_canvas_uploads_v1",
      "mark_canvas_upload_orphans_v1",
      "claim_canvas_upload_purge_v1",
    ]),
  "audit covers every PL/pgSQL RETURNS TABLE function in the registry migration"
);
ok(
  JSON.stringify(outputReferenceConflicts(registryFunctions)) ===
    JSON.stringify(["reserve_canvas_uploads_v1.expires_at"]),
  "audit identifies expires_at as the only unsafe output-name column reference"
);
ok(
  [...repairFunctions.keys()].join(",") === "reserve_canvas_uploads_v1",
  "forward migration replaces only the affected reservation RPC"
);
const effectiveFunctions = new Map(registryFunctions);
for (const [name, fn] of repairFunctions) effectiveFunctions.set(name, fn);
ok(
  outputReferenceConflicts(effectiveFunctions).length === 0,
  "effective RETURNS TABLE definitions contain no output-name ambiguity"
);
const originalReserve = registryFunctions.get("reserve_canvas_uploads_v1");
const repairedReserve = repairFunctions.get("reserve_canvas_uploads_v1");
const repairedWithoutQualification = repairedReserve?.definition
  .replace(
    "public.canvas_upload_reservations AS reservation",
    "public.canvas_upload_reservations"
  )
  .replaceAll("reservation.user_id", "user_id")
  .replaceAll("reservation.status", "status")
  .replaceAll("reservation.expires_at", "expires_at");
ok(
  Boolean(originalReserve && repairedWithoutQualification) &&
    normalizedDefinition(originalReserve.definition) ===
      normalizedDefinition(repairedWithoutQualification),
  "forward replacement is byte-semantically identical after removing the exact qualification repair"
);
ok(
  !/^\s*(BEGIN|COMMIT)\s*;/im.test(ambiguityFix) &&
    ambiguityFix.includes("UPDATE public.canvas_upload_reservations AS reservation") &&
    ambiguityFix.includes("AND reservation.expires_at <= v_now") &&
    ambiguityFix.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"),
  "forward migration is embeddable, qualified, and refreshes the RPC schema cache"
);

for (const table of [
  "canvas_upload_daily_usage",
  "canvas_upload_storage_usage",
  "canvas_upload_reservations",
]) {
  ok(
    migration.includes(`CREATE TABLE public.${table}`),
    `${table} is created`
  );
  ok(
    migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`) &&
      migration.includes(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`
      ),
    `${table} enables RLS and revokes browser roles`
  );
}

ok(
  migration.includes("files_reserved <= 100") &&
    migration.includes("bytes_reserved <= 2147483648"),
  "daily quota is 100 files and 2GiB"
);
ok(
  migration.includes("files_reserved + files_ready <= 1000") &&
    migration.includes("bytes_reserved + bytes_ready <= 10737418240"),
  "cumulative quota is 1000 objects and 10GiB"
);
ok(
  migration.includes("v_batch_bytes > 536870912"),
  "database independently enforces the 512MiB batch cap"
);
ok(
  migration.includes("canvas_upload_reservations_key_identity") &&
    migration.includes("|| user_id::text || '/' || id::text"),
  "reservation key identity is constrained by owner and reservation id"
);
ok(
  migration.includes("FOR UPDATE") &&
    migration.includes("canvas_upload_idempotency_conflict") &&
    migration.includes("ON CONFLICT (id) DO NOTHING"),
  "reservation is lock-serialized and retry-idempotent"
);
ok(
  migration.includes("GET DIAGNOSTICS v_inserted_count = ROW_COUNT") &&
    migration.includes("v_inserted_count <> v_new_files") &&
    migration.includes("AND r.user_id = p_user_id"),
  "cross-user UUID races fail atomically without quota leakage or identity disclosure"
);
ok(
  credentials.includes('admin.rpc("reserve_canvas_uploads_v1"') &&
    credentials.indexOf('admin.rpc("reserve_canvas_uploads_v1"') <
      credentials.indexOf("calculatePostSignature"),
  "credentials reserve atomically before signing"
);
ok(
  credentials.includes('["eq", "$key", objectKey]') &&
    credentials.includes('["eq", "$x-oss-content-type", file.type]') &&
    credentials.includes('["content-length-range", file.size, file.size]') &&
    credentials.includes('["eq", "$x-oss-forbid-overwrite", "true"]'),
  "OSS policy binds exact key, MIME, size and no-overwrite"
);
ok(
  client.includes("crypto.randomUUID()") &&
    client.includes('fetch("/api/canvas/uploads/finalize"') &&
    client.includes('payload.data.status !== "ready"'),
  "client uses retry-stable ids and exposes a key only after ready finalize"
);

ok(
  finalize.includes("getFileMetadataStrict(objectKey") &&
    finalize.includes("metadata.size !== reservation.expected_size") &&
    finalize.includes("observedContentType !== reservation.content_type"),
  "finalize checks authoritative OSS size and content type"
);
ok(
  finalize.includes("Range: `bytes=0-${PREFIX_BYTES - 1}`") &&
    finalize.includes("result?.res?.status !== 206") &&
    finalize.includes("Number(match[2]) !== expectedSize") &&
    finalize.includes("hasExpectedMagic(prefix, reservation.file_extension)"),
  "finalize performs a bounded, honored range read and magic validation"
);
for (const signature of [
  "[0xff, 0xd8, 0xff]",
  "GIF87a",
  "RIFF",
  "ftyp",
  "[0x1a, 0x45, 0xdf, 0xa3]",
]) {
  ok(finalize.includes(signature), `magic verifier covers ${signature}`);
}
ok(
  finalize.includes('"finalize_canvas_upload_v1"') &&
    migration.includes("p_observed_size") &&
    migration.includes("p_observed_content_type"),
  "ready transition rechecks observed identity atomically"
);

ok(
  registry.includes("assertCanvasDocumentMediaReady") &&
    createRoute.includes("await assertCanvasDocumentMediaReady") &&
    writeRoute.match(/await assertCanvasDocumentMediaReady/g)?.length >= 3,
  "create, repair, fast-save and normal-save enforce media readiness"
);
ok(
  generation.includes("await assertCanvasInputKeysReady") &&
    generation.indexOf("await assertCanvasInputKeysReady") <
      generation.indexOf("await beginGeneration"),
  "generation input readiness is enforced before debit"
);
ok(
  migration.includes("status = 'completed'") &&
    migration.includes("output_oss_key = candidate.object_key"),
  "completed owner generation outputs remain trusted inputs"
);
ok(
  migration.includes("canvas_revision_mismatch") &&
    migration.includes("candidate.object_key = ANY(v_existing_keys)"),
  "legacy persistence exception is revision-bound"
);

ok(
  migration.includes("last_referenced_at") &&
    migration.includes("mark_canvas_upload_orphans_v1") &&
    migration.includes("p_unreferenced_grace_seconds integer DEFAULT 604800"),
  "ready objects record reference time and require a seven-day orphan scan grace"
);
ok(
  migration.includes("#>> '{data,media,ossKey}' = r.object_key") &&
    migration.includes("#>> '{data,media,posterKey}' = r.object_key"),
  "orphan scan checks current primary and poster references"
);
ok(
  migration.includes("r.orphaned_at <= clock_timestamp() - interval '24 hours'") &&
    (migration.match(/SKIP LOCKED/g)?.length ?? 0) >= 3,
  "orphan purge has a second 24-hour grace and leased skip-locked claims"
);
ok(
  migration.includes("status = 'purging'") &&
    migration.includes("p_lease_token") &&
    migration.includes("files_ready = files_ready - 1"),
  "purge completion is lease-bound and releases the correct ready quota"
);
ok(
  sweeper.indexOf("await oss.delete(claim.object_key") <
    sweeper.indexOf('"complete_canvas_upload_purge_v1"') &&
    sweeper.includes("isDefinitelyAbsent") &&
    sweeper.includes("PURGE_CONCURRENCY = 3"),
  "worker deletes or proves absence before finalizing, with bounded concurrency"
);
ok(
  sweeper.includes("--env-file") &&
    sweeper.includes("env_file_symlink_rejected") &&
    !sweeper.includes("console.log(claim"),
  "worker requires a protected env file and does not log claims"
);
ok(
  migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"),
  "migration explicitly refreshes the PostgREST RPC schema cache"
);

if (failures.length > 0) {
  console.error(
    `Canvas upload registry verification failed (${passed} passed, ${failures.length} failed):`
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Canvas upload registry verification passed: ${passed}/${passed}`);
}
