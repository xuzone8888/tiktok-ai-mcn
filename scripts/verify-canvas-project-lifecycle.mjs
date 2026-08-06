/**
 * Offline contract verification for the Super Canvas project lifecycle.
 *
 * Executes the production route modules after TypeScript transpilation with
 * deterministic Supabase/Next stubs. No database, credentials, or network are
 * used. Run with:
 *   node scripts/verify-canvas-project-lifecycle.mjs
 */
/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UUID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let passes = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passes += 1;
    return;
  }
  failures.push(label);
  console.error(`FAIL ${label}`);
}

function equal(actual, expected, label) {
  ok(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`
  );
}

const statusByCode = {
  UNAUTHENTICATED: 401,
  CANVAS_NOT_ENABLED: 403,
  INVALID_ID: 400,
  INVALID_BODY: 400,
  INVALID_OPS: 400,
  DOC_TOO_LARGE: 400,
  NOT_FOUND: 404,
  REV_CONFLICT: 409,
  ENTITY_CONFLICT: 409,
  WRITER_LOCKED: 409,
  CANVAS_DOC_INVALID: 422,
  PROJECT_LIMIT_REACHED: 429,
  INTERNAL: 500,
};
const apiTypesStub = {
  canvasApiSuccess(data, warning) {
    return warning
      ? { success: true, data, warning }
      : { success: true, data };
  },
  canvasApiError(code, error, details) {
    return details
      ? { success: false, code, error, details }
      : { success: false, code, error };
  },
  httpStatusForCanvasError(code) {
    return statusByCode[code] ?? 500;
  },
};
const nextServerStub = {
  NextRequest: class NextRequest {},
  NextResponse: {
    json(body, init = {}) {
      return {
        status: init.status ?? 200,
        body,
        async json() {
          return body;
        },
      };
    },
  },
};

function compileRoute(relativePath, getClient, getAccess = () => true) {
  const filename = join(ROOT, relativePath);
  const built = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (built.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  equal(errors.length, 0, `${relativePath} transpiles`);

  const routeModule = { exports: {} };
  const context = vm.createContext({
    module: routeModule,
    exports: routeModule.exports,
    console,
    Date,
    Number,
    RegExp,
    URL,
    Promise,
    require(specifier) {
      if (specifier === "next/server") return nextServerStub;
      if (specifier === "zod") return require("zod");
      if (specifier === "@/lib/supabase/server") {
        return { createClient: async () => getClient() };
      }
      if (specifier === "@/lib/canvas/api-types") return apiTypesStub;
      if (specifier === "@/lib/canvas/api-helpers") {
        return { CANVAS_UUID_RE: UUID_RE };
      }
      if (specifier === "@/lib/canvas/feature-access") {
        return { canAccessSuperCanvas: (identity) => getAccess(identity) };
      }
      if (specifier === "@/lib/canvas/upload-registry") {
        return {
          async assertCanvasDocumentMediaReady() {},
          CanvasMediaReadinessError:
            class CanvasMediaReadinessError extends Error {},
        };
      }
      if (
        specifier === "@/lib/canvas/schema" ||
        specifier === "@/lib/canvas/doc-limits" ||
        specifier === "@/lib/canvas/patch"
      ) {
        return {};
      }
      return require(specifier);
    },
  });
  new vm.Script(built.outputText, { filename }).runInContext(context);
  return routeModule.exports;
}

function makeListClient({
  user = { id: USER_ID },
  authError = null,
  result = { data: [], error: null, count: 0 },
} = {}) {
  const calls = { table: null, select: null, eq: [], order: [], range: null };
  const query = {
    select(columns, options) {
      calls.select = { columns, options };
      return this;
    },
    eq(column, value) {
      calls.eq.push([column, value]);
      return this;
    },
    order(column, options) {
      calls.order.push([column, options]);
      return this;
    },
    range(from, to) {
      calls.range = [from, to];
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    auth: {
      getUser: async () => ({ data: { user }, error: authError }),
    },
    from(table) {
      calls.table = table;
      return query;
    },
  };
}

function makeMetadataClient({
  userId = USER_ID,
  claimsError = null,
  reads = [],
  updates = [],
  rpcResult = { data: [], error: null },
} = {}) {
  const calls = { reads: [], updates: [], rpc: [] };
  return {
    calls,
    auth: {
      getClaims: async () => ({
        data: { claims: userId ? { sub: userId } : null },
        error: claimsError,
      }),
    },
    from(table) {
      let mode = "read";
      const call = { table, select: null, predicates: [], payload: null };
      return {
        select(columns) {
          call.select = columns;
          return this;
        },
        update(payload) {
          mode = "update";
          call.payload = payload;
          return this;
        },
        eq(column, value) {
          call.predicates.push([column, value]);
          return this;
        },
        maybeSingle() {
          if (mode === "update") {
            calls.updates.push(call);
            return Promise.resolve(
              updates.shift() ?? { data: null, error: null }
            );
          }
          calls.reads.push(call);
          return Promise.resolve(reads.shift() ?? { data: null, error: null });
        },
      };
    },
    rpc(name, args) {
      calls.rpc.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  };
}

function listRequest(query = "") {
  return {
    nextUrl: { searchParams: new URL(`https://example.test/api/canvas${query}`).searchParams },
  };
}

function metadataRequest(body) {
  return { json: async () => body };
}

const row = {
  id: UUID,
  title: "产品主画布",
  rev: 7,
  doc_bytes: 2048,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
};

console.log("1. GET /api/canvas pagination + owner scope");
let activeClient = makeListClient();
let accessAllowed = true;
const listRoute = compileRoute(
  "src/app/api/canvas/route.ts",
  () => activeClient,
  () => accessAllowed
);

let response = await listRoute.GET(listRequest("?page=0"));
equal(response.status, 400, "page=0 rejected");
equal(response.body.code, "INVALID_BODY", "invalid page stable code");

response = await listRoute.GET(listRequest("?limit=101"));
equal(response.status, 400, "limit above 100 rejected");

response = await listRoute.GET(listRequest("?page=1&page=2"));
equal(response.status, 400, "duplicate page rejected");

activeClient = makeListClient({ user: null });
response = await listRoute.GET(listRequest());
equal(response.status, 401, "unauthenticated list rejected");

activeClient = makeListClient();
accessAllowed = false;
response = await listRoute.GET(listRequest());
equal(response.status, 403, "release-gated account cannot list canvases");
equal(
  response.body.code,
  "CANVAS_NOT_ENABLED",
  "release gate uses stable error code"
);
accessAllowed = true;

activeClient = makeListClient();
accessAllowed = false;
response = await listRoute.POST({ json: async () => ({}) });
equal(response.status, 403, "release-gated account cannot create a canvas");
equal(
  response.body.code,
  "CANVAS_NOT_ENABLED",
  "create gate uses stable error code"
);
accessAllowed = true;

activeClient = makeListClient({
  result: { data: [row], error: null, count: 5 },
});
response = await listRoute.GET(listRequest("?page=2&limit=2"));
equal(response.status, 200, "valid list succeeds");
equal(response.body.data.canvases.length, 1, "one summary returned");
equal(response.body.data.canvases[0].docBytes, 2048, "docBytes mapped");
equal(response.body.data.pagination.totalPages, 3, "total pages computed");
equal(response.body.data.pagination.hasMore, true, "hasMore computed");
equal(activeClient.calls.table, "canvases", "list reads canvases");
ok(
  activeClient.calls.eq.some(
    ([column, value]) => column === "user_id" && value === USER_ID
  ),
  "list carries explicit owner predicate"
);
ok(
  activeClient.calls.eq.some(
    ([column, value]) => column === "status" && value === "active"
  ),
  "list hides non-active canvases"
);
equal(activeClient.calls.range[0], 2, "page offset applied");
equal(activeClient.calls.range[1], 3, "page range bounded");

console.log("2. PATCH metadata strict validation + metadata CAS");
activeClient = makeMetadataClient();
const metadataRoute = compileRoute(
  "src/app/api/canvas/[id]/metadata/route.ts",
  () => activeClient,
  () => accessAllowed
);

response = await metadataRoute.PATCH(metadataRequest({ title: "x" }), {
  params: Promise.resolve({ id: "not-a-uuid" }),
});
equal(response.status, 400, "invalid UUID rejected");
equal(response.body.code, "INVALID_ID", "invalid UUID stable code");

response = await metadataRoute.PATCH(metadataRequest({ title: " \n " }), {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 400, "blank/control title rejected");

response = await metadataRoute.PATCH(
  metadataRequest({ title: "ok", extra: true }),
  { params: Promise.resolve({ id: UUID }) }
);
equal(response.status, 400, "unknown PATCH fields rejected");

activeClient = makeMetadataClient({ userId: null });
response = await metadataRoute.PATCH(metadataRequest({ title: "ok" }), {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 401, "unauthenticated rename rejected");

activeClient = makeMetadataClient();
accessAllowed = false;
response = await metadataRoute.PATCH(metadataRequest({ title: "ok" }), {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 403, "release-gated account cannot rename");
equal(
  response.body.code,
  "CANVAS_NOT_ENABLED",
  "metadata gate uses stable error code"
);
accessAllowed = true;

activeClient = makeMetadataClient({
  reads: [{ data: row, error: null }],
  updates: [
    {
      data: {
        ...row,
        title: "新标题",
        rev: 7,
        updated_at: "2026-07-29T01:00:00.000Z",
      },
      error: null,
    },
  ],
});
response = await metadataRoute.PATCH(metadataRequest({ title: "  新标题  " }), {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 200, "valid rename succeeds");
equal(response.body.data.title, "新标题", "rename trims title");
equal(response.body.data.rev, 7, "rename preserves document revision");
ok(
  !Object.prototype.hasOwnProperty.call(
    activeClient.calls.updates[0].payload,
    "rev"
  ),
  "metadata update never writes rev"
);
ok(
  activeClient.calls.updates[0].predicates.some(
    ([column, value]) => column === "user_id" && value === USER_ID
  ),
  "rename update carries explicit owner predicate"
);
ok(
  activeClient.calls.updates[0].predicates.some(
    ([column, value]) => column === "title" && value === "产品主画布"
  ),
  "rename CAS carries previous title"
);
ok(
  activeClient.calls.updates[0].predicates.some(
    ([column, value]) =>
      column === "updated_at" && value === row.updated_at
  ),
  "rename CAS carries previous updated_at"
);
ok(
  !activeClient.calls.updates[0].predicates.some(
    ([column]) => column === "rev"
  ),
  "rename does not use document rev as metadata CAS"
);

const postAutosaveRow = {
  ...row,
  rev: 8,
  updated_at: "2026-07-29T01:30:00.000Z",
};
activeClient = makeMetadataClient({
  reads: [
    { data: row, error: null },
    { data: postAutosaveRow, error: null },
  ],
  updates: [
    { data: null, error: null },
    {
      data: {
        ...postAutosaveRow,
        title: "并发后的标题",
        updated_at: "2026-07-29T02:00:00.000Z",
      },
      error: null,
    },
  ],
});
response = await metadataRoute.PATCH(
  metadataRequest({ title: "并发后的标题" }),
  { params: Promise.resolve({ id: UUID }) }
);
equal(response.status, 200, "rename retries after concurrent autosave");
equal(
  response.body.data.rev,
  8,
  "rename adopts the autosave revision without advancing it"
);
equal(activeClient.calls.updates.length, 2, "metadata CAS retried once");
ok(
  activeClient.calls.updates.every(
    (call) => !Object.prototype.hasOwnProperty.call(call.payload, "rev")
  ),
  "no metadata CAS attempt writes rev"
);

console.log("3. DELETE metadata atomic RPC outcomes");
activeClient = makeMetadataClient();
accessAllowed = false;
response = await metadataRoute.DELETE({}, {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 403, "release-gated account cannot delete");
equal(activeClient.calls.rpc.length, 0, "release gate runs before delete RPC");
accessAllowed = true;

activeClient = makeMetadataClient({
  rpcResult: {
    data: [
      {
        outcome: "active_generations",
        deleted_canvas_id: null,
        active_generation_count: 2,
      },
    ],
    error: null,
  },
});
response = await metadataRoute.DELETE({}, {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 409, "active generations block delete");
equal(response.body.code, "ENTITY_CONFLICT", "delete conflict stable code");
equal(
  response.body.details.activeGenerations,
  2,
  "active generation count surfaced"
);
equal(
  activeClient.calls.rpc[0][0],
  "delete_canvas_project_v1",
  "delete uses atomic RPC"
);

activeClient = makeMetadataClient({
  rpcResult: {
    data: [
      {
        outcome: "not_found",
        deleted_canvas_id: null,
        active_generation_count: 0,
      },
    ],
    error: null,
  },
});
response = await metadataRoute.DELETE({}, {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 404, "missing/cross-owner delete is hidden as not found");

activeClient = makeMetadataClient({
  rpcResult: {
    data: [
      {
        outcome: "deleted",
        deleted_canvas_id: UUID,
        active_generation_count: 0,
      },
    ],
    error: null,
  },
});
response = await metadataRoute.DELETE({}, {
  params: Promise.resolve({ id: UUID }),
});
equal(response.status, 200, "safe delete succeeds");
equal(response.body.data.deleted, true, "delete result is explicit");

console.log("4. SQL race/authorization invariants");
const sql = readFileSync(
  join(ROOT, "supabase/migrations/20260729_canvas_project_lifecycle.sql"),
  "utf8"
);
for (const [label, pattern] of [
  ["SECURITY DEFINER", /SECURITY DEFINER/],
  ["empty pinned search_path", /SET search_path = ''/],
  ["auth.uid owner identity", /auth\.uid\(\)/],
  ["strong Canvas row lock", /FOR UPDATE/],
  ["pending/processing blocker", /status IN \('pending', 'processing'\)/],
  ["immutable snapshot backstop", /canvas_id_snapshot = p_canvas_id/],
  [
    "own-row delete predicate",
    /DELETE FROM public\.canvases[\s\S]*c\.user_id = v_user_id/,
  ],
  ["authenticated-only grant", /GRANT EXECUTE[\s\S]*TO authenticated/],
  [
    "atomic capped create RPC",
    /CREATE OR REPLACE FUNCTION public\.create_canvas_project_v1\(/,
  ],
  [
    "per-user create serialization",
    /pg_advisory_xact_lock\([\s\S]*canvas-project-create:/,
  ],
  ["hard project cap", /c_project_limit constant integer := 100/],
  [
    "legacy direct insert bridge function",
    /CREATE OR REPLACE FUNCTION public\.guard_canvas_project_insert_v1\(\)/,
  ],
  [
    "legacy bridge uses the RPC advisory lock",
    /guard_canvas_project_insert_v1[\s\S]*canvas-project-create:/,
  ],
  [
    "legacy bridge enforces owner identity",
    /NEW\.user_id IS DISTINCT FROM v_user_id/,
  ],
  [
    "legacy bridge checks the final statement count",
    /TG_WHEN = 'AFTER' AND TG_LEVEL = 'STATEMENT'[\s\S]*v_count > c_project_limit/,
  ],
  [
    "legacy bridge has statement lock, row owner, and statement cap triggers",
    /CREATE TRIGGER canvas_project_insert_lock_v1[\s\S]*CREATE TRIGGER canvas_project_insert_owner_v1[\s\S]*CREATE TRIGGER canvas_project_insert_cap_v1/,
  ],
  [
    "legacy bridge keeps anon revoked and authenticated compatible",
    /REVOKE INSERT ON TABLE public\.canvases FROM PUBLIC, anon;[\s\S]*GRANT INSERT ON TABLE public\.canvases TO authenticated/,
  ],
]) {
  ok(pattern.test(sql), `migration has ${label}`);
}

const createRoute = readFileSync(
  join(ROOT, "src/app/api/canvas/route.ts"),
  "utf8"
);
ok(
  createRoute.includes('"create_canvas_project_v1"') &&
    !createRoute.includes('.from("canvases")\n      .insert('),
  "create route uses only the capped RPC write boundary"
);
ok(
  createRoute.includes('"PROJECT_LIMIT_REACHED"') &&
    createRoute.includes('error.code === "54000"'),
  "project cap maps to the stable 429 API error"
);

console.log(`\nResult: ${passes} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
