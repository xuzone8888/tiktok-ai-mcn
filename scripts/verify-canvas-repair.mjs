#!/usr/bin/env node
/**
 * Full-document repair verifier.
 *
 * Transpiles and executes the production PUT handler with deterministic Next/Supabase stubs.
 * The database stub deliberately does not emulate RLS ownership filtering: the route's explicit
 * user_id predicates must be present for cross-user tests to pass.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const routePath = join(ROOT, "src", "app", "api", "canvas", "[id]", "route.ts");

let passed = 0;
const failures = [];
function ok(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const schema = await loadCanvasModule("schema");
const docLimits = await loadCanvasModule("doc-limits");
const patchModule = await loadCanvasModule("patch");
const apiTypes = await loadCanvasModule("api-types");
const writerLock = await loadCanvasModule("writer-lock");
const helpers = await loadCanvasModule("api-helpers");
const saveProofModule = await loadCanvasModule("save-proof");

const routeSource = readFileSync(routePath, "utf8");
const routeBuilt = ts.transpileModule(routeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
  },
  fileName: routePath,
  reportDiagnostics: true,
});

const NOW_MS = Date.parse("2026-07-14T08:00:00.000Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
class FixedDate extends Date {
  constructor(value) {
    super(value === undefined ? NOW_MS : value);
  }
  static now() {
    return NOW_MS;
  }
}

let activeClient = null;
let proofVerificationResult = false;
let issuedSaveProof = null;
const routeModule = { exports: {} };
const quietConsole = { error() {}, log() {}, warn() {} };
const routeContext = vm.createContext({
  module: routeModule,
  exports: routeModule.exports,
  require(specifier) {
    if (specifier === "next/server") {
      return {
        NextRequest: class NextRequest {},
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status ?? 200, headers: init.headers ?? {} };
          },
        },
      };
    }
    if (specifier === "@supabase/supabase-js") return {};
    if (specifier === "@/lib/supabase/server") {
      return {
        async createClient() {
          if (!activeClient) throw new Error("No active Supabase client");
          activeClient.createClientCalls += 1;
          return activeClient;
        },
      };
    }
    if (specifier === "@/lib/canvas/schema") return schema;
    if (specifier === "@/lib/canvas/doc-limits") return docLimits;
    if (specifier === "@/lib/canvas/patch") return patchModule;
    if (specifier === "@/lib/canvas/api-types") return apiTypes;
    if (specifier === "@/lib/canvas/api-helpers") return helpers;
    if (specifier === "@/lib/canvas/writer-lock") return writerLock;
    if (specifier === "@/lib/canvas/save-proof") {
      return {
        issueCanvasSaveProof() {
          return issuedSaveProof;
        },
        verifyCanvasSaveProof() {
          return proofVerificationResult;
        },
      };
    }
    throw new Error(`Unexpected route dependency: ${specifier}`);
  },
  console: quietConsole,
  process,
  Promise,
  Object,
  Array,
  Error,
  RegExp,
  String,
  Number,
  Boolean,
  JSON,
  Map,
  Set,
  WeakSet,
  Date: FixedDate,
  TextEncoder,
  URL,
});
new vm.Script(routeBuilt.outputText, { filename: routePath }).runInContext(routeContext);
const route = routeModule.exports;
ok(typeof route.PUT === "function", "production route exports PUT");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITER = "writer_repair_1234";
const OTHER_WRITER = "writer_other_1234";
const EMPTY_DOC = schema.createEmptyCanvasDoc();
const EMPTY_DEPS = schema.createEmptyCanvasDeps();
const BROKEN_DOC = {
  nodes: [{ id: "broken", type: "audio", position: { x: 0, y: 0 } }],
  edges: [],
  groups: [],
};

function project(row, columns) {
  if (!columns || columns === "*") return { ...row };
  const output = {};
  for (const column of columns.split(",").map((entry) => entry.trim())) {
    if (Object.prototype.hasOwnProperty.call(row, column)) output[column] = row[column];
  }
  return output;
}

function makeSupabase(seedRows, options = {}) {
  const rows = seedRows.map((row) => ({ ...row }));
  const calls = [];
  let readCount = 0;
  let updateCount = 0;
  let zeroMutationApplied = false;

  function shouldReadError(count) {
    const configured = options.readErrorAt;
    return Array.isArray(configured) ? configured.includes(count) : configured === count;
  }

  class Query {
    constructor(source) {
      this.source = source;
      this.operation = "read";
      this.columns = "";
      this.filters = [];
      this.values = null;
    }
    select(columns) {
      this.columns = columns;
      return this;
    }
    update(values) {
      this.operation = "update";
      this.values = values;
      return this;
    }
    eq(field, value) {
      this.filters.push({ operator: "eq", field, value });
      return this;
    }
    gte(field, value) {
      this.filters.push({ operator: "gte", field, value });
      return this;
    }
    matches(row) {
      return this.filters.every((filter) => {
        if (filter.operator === "eq") return row[filter.field] === filter.value;
        return typeof row[filter.field] === "string" && row[filter.field] >= filter.value;
      });
    }
    async maybeSingle() {
      const call = {
        operation: this.operation,
        source: this.source,
        columns: this.columns,
        filters: this.filters.map((filter) => ({ ...filter })),
        values: this.values,
      };
      calls.push(call);

      if (this.operation === "read") {
        readCount += 1;
        if (shouldReadError(readCount)) {
          return { data: null, error: { code: "XX000", message: "synthetic read error" } };
        }
        const matched = rows.filter((row) => this.matches(row));
        if (options.multipleReadAt === readCount || matched.length > 1) {
          return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        }
        return { data: matched.length === 1 ? project(matched[0], this.columns) : null, error: null };
      }

      updateCount += 1;
      if (options.updateError) {
        return { data: null, error: { code: "XX000", message: "synthetic update error" } };
      }
      if (options.updateAmbiguous) {
        return { data: null, error: { code: "PGRST116", message: "ambiguous update result" } };
      }
      if (options.forceZeroUpdate) {
        if (!zeroMutationApplied && typeof options.onZeroUpdate === "function") {
          zeroMutationApplied = true;
          options.onZeroUpdate(rows);
        }
        return { data: null, error: null };
      }

      const matched = rows.filter((row) => this.matches(row));
      if (matched.length > 1) {
        return { data: null, error: { code: "PGRST116", message: "multiple update rows" } };
      }
      if (matched.length === 0) return { data: null, error: null };
      Object.assign(matched[0], this.values);
      return { data: project(matched[0], this.columns), error: null };
    }
  }

  return {
    rows,
    calls,
    createClientCalls: 0,
    get readCount() {
      return readCount;
    },
    get updateCount() {
      return updateCount;
    },
    auth: {
      async getUser() {
        if (options.unauthenticated) {
          return { data: { user: null }, error: { code: "AUTH" } };
        }
        return { data: { user: { id: options.userId ?? USER } }, error: null };
      },
      async getClaims() {
        if (options.unauthenticated) {
          return { data: null, error: { code: "AUTH" } };
        }
        return {
          data: { claims: { sub: options.userId ?? USER } },
          error: null,
        };
      },
      async getSession() {
        if (options.unauthenticated) {
          return { data: { session: null }, error: { code: "AUTH" } };
        }
        return {
          data: { session: { access_token: "verified-by-postgrest" } },
          error: null,
        };
      },
    },
    from(source) {
      return new Query(source);
    },
  };
}

function makeRow(overrides = {}) {
  return {
    id: ID,
    user_id: USER,
    title: "Recovery target",
    rev: 7,
    schema_version: schema.CANVAS_SCHEMA_VERSION,
    doc: BROKEN_DOC,
    deps: EMPTY_DEPS,
    doc_bytes: docLimits.computeDocBytes(BROKEN_DOC),
    status: "active",
    writer_tag: WRITER,
    writer_heartbeat_at: new Date(NOW_MS - 1_000).toISOString(),
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T07:00:00.000Z",
    ...overrides,
  };
}

function makeBody(overrides = {}) {
  return {
    baseRev: 7,
    writerTag: WRITER,
    confirmRecovery: true,
    doc: EMPTY_DOC,
    deps: EMPTY_DEPS,
    ...overrides,
  };
}

async function invoke(client, body, options = {}) {
  activeClient = client;
  const request = {
    async json() {
      if (options.jsonError) throw new Error("bad json");
      return body;
    },
  };
  return route.PUT(request, {
    params: Promise.resolve({ id: options.id ?? ID }),
  });
}

async function invokePatch(client, body, options = {}) {
  activeClient = client;
  const request = {
    async json() {
      if (options.jsonError) throw new Error("bad json");
      return body;
    },
  };
  return route.PATCH(request, {
    params: Promise.resolve({ id: options.id ?? ID }),
  });
}

function callsOf(client, operation) {
  return client.calls.filter((call) => call.operation === operation);
}

console.log("save proof cryptography and one-round-trip PATCH");
{
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-that-is-long-enough";
  try {
    const proof = saveProofModule.issueCanvasSaveProof(ID, 7);
    ok(typeof proof === "string" && /^[A-Za-z0-9_-]{43}$/.test(proof), "issued proof is opaque base64url SHA-256");
    ok(saveProofModule.verifyCanvasSaveProof(proof, ID, 7), "proof verifies for exact canvas and revision");
    ok(!saveProofModule.verifyCanvasSaveProof(proof, OTHER_USER, 7), "proof is canvas-bound");
    ok(!saveProofModule.verifyCanvasSaveProof(proof, ID, 8), "proof is revision-bound");
    ok(!saveProofModule.verifyCanvasSaveProof("A".repeat(43), ID, 7), "forged proof is rejected");
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
  }
}
{
  const added = schema.createCanvasNode({
    id: "compressed_fast_save_node",
    type: "text",
    position: { x: 15, y: 25 },
  });
  const snapshot = { nodes: [added], edges: [], groups: [] };
  const body = {
    baseRev: 7,
    writerTag: WRITER,
    ops: [],
    opCount: 1,
    snapshot,
    saveProof: "C".repeat(43),
  };
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC, doc_bytes: docLimits.computeDocBytes(EMPTY_DOC) })]);
  proofVerificationResult = true;
  issuedSaveProof = "S".repeat(43);
  const response = await invokePatch(client, body);
  proofVerificationResult = false;
  issuedSaveProof = null;

  eq(response.status, 200, "compressed proof PATCH succeeds without sending entity ops");
  eq([client.readCount, client.updateCount], [0, 1], "compressed proof PATCH remains one CAS and zero reads");
  eq(response.body.data.appliedOps, 1, "compressed proof PATCH acknowledges the durable queue op count");
  eq(client.rows[0].doc, snapshot, "compressed proof PATCH persists the strict snapshot");
}
{
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC })]);
  const response = await invokePatch(client, {
    baseRev: 7,
    writerTag: WRITER,
    ops: [],
    opCount: 1,
    snapshot: EMPTY_DOC,
    saveProof: "I".repeat(43),
  });
  eq([response.status, response.body.code], [409, "REV_CONFLICT"], "unverified compressed proof fails closed");
  eq(client.calls.length, 0, "unverified compressed proof never reaches the database");
}
{
  const added = schema.createCanvasNode({
    id: "fast_save_node",
    type: "text",
    position: { x: 10, y: 20 },
  });
  const snapshot = { nodes: [added], edges: [], groups: [] };
  const body = {
    baseRev: 7,
    writerTag: WRITER,
    ops: [{ entity: "node", op: "add", value: added }],
    snapshot,
    saveProof: "P".repeat(43),
  };
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC, doc_bytes: docLimits.computeDocBytes(EMPTY_DOC) })]);
  proofVerificationResult = true;
  issuedSaveProof = "N".repeat(43);
  const response = await invokePatch(client, body);
  proofVerificationResult = false;
  issuedSaveProof = null;

  eq(response.status, 200, "valid proof fast PATCH succeeds");
  eq([client.readCount, client.updateCount], [0, 1], "fast PATCH performs zero reads and one CAS update");
  eq(client.rows[0].doc, snapshot, "fast PATCH persists the strict submitted snapshot");
  eq(client.rows[0].rev, 8, "fast PATCH bumps exactly one revision");
  eq(response.body?.data?.saveProof, "N".repeat(43), "fast PATCH rotates proof to the committed revision");
  const updateCall = callsOf(client, "update")[0];
  eq(
    updateCall?.filters.map((filter) => [filter.operator, filter.field, filter.value]),
    [
      ["eq", "id", ID],
      ["eq", "rev", 7],
      ["eq", "writer_tag", WRITER],
      ["gte", "writer_heartbeat_at", new Date(NOW_MS - writerLock.WRITER_LEASE_MS).toISOString()],
    ],
    "fast PATCH CAS is scoped by id+rev+writer+active lease; signed JWT RLS supplies ownership"
  );
}
{
  const added = schema.createCanvasNode({
    id: "fallback_save_node",
    type: "text",
    position: { x: 30, y: 40 },
  });
  const body = {
    baseRev: 7,
    writerTag: WRITER,
    ops: [{ entity: "node", op: "add", value: added }],
    snapshot: { nodes: [added], edges: [], groups: [] },
    saveProof: "F".repeat(43),
  };
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC, doc_bytes: docLimits.computeDocBytes(EMPTY_DOC) })]);
  const response = await invokePatch(client, body);
  eq(response.status, 200, "unverified proof safely falls back to full PATCH path");
  eq([client.readCount, client.updateCount], [1, 1], "unverified proof cannot bypass the authoritative read/decision path");
}
{
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC })]);
  const response = await invokePatch(client, {
    baseRev: 7,
    writerTag: WRITER,
    ops: [],
    snapshot: EMPTY_DOC,
  });
  eq([response.status, response.body.code], [400, "INVALID_BODY"], "unpaired snapshot/proof is rejected before database access");
  eq(client.calls.length, 0, "unpaired snapshot/proof performs zero database operations");
}

console.log("repair auth, identity, and exact request contract");
{
  const client = makeSupabase([makeRow()], { unauthenticated: true });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [401, "UNAUTHENTICATED"], "unauthenticated repair rejected");
  eq(client.calls.length, 0, "unauthenticated request never queries canvases");
}
{
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody(), { id: "not-a-uuid" });
  eq([response.status, response.body.code], [400, "INVALID_ID"], "invalid id rejected before query");
  eq(client.createClientCalls, 0, "invalid id does not create a cookie client");
}
{
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody(), { jsonError: true });
  eq([response.status, response.body.code], [400, "INVALID_BODY"], "invalid JSON rejected");
  eq(client.calls.length, 0, "invalid JSON does not query canvases");
}
for (const missing of ["baseRev", "writerTag", "confirmRecovery", "doc", "deps"]) {
  const body = makeBody();
  delete body[missing];
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, body);
  eq(response.body.code, "INVALID_BODY", `missing ${missing} rejected by production PUT`);
  eq(client.calls.length, 0, `missing ${missing} rejected before database read`);
}
for (const missing of ["nodes", "edges", "groups"]) {
  const doc = { ...EMPTY_DOC };
  delete doc[missing];
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ doc }));
  eq(response.body.code, "INVALID_BODY", `repair doc missing explicit ${missing} rejected`);
  eq(client.calls.length, 0, `repair doc missing ${missing} performs zero database operations`);
}
for (const missing of ["models", "voices", "characters", "assets", "recipes"]) {
  const deps = { ...EMPTY_DEPS };
  delete deps[missing];
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ deps }));
  eq(response.body.code, "INVALID_BODY", `repair deps missing explicit ${missing} rejected`);
  eq(client.calls.length, 0, `repair deps missing ${missing} performs zero database operations`);
}
{
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, { ...makeBody(), unknown: true });
  eq(response.body.code, "INVALID_BODY", "unknown repair field rejected");
}
{
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ confirmRecovery: false }));
  eq(response.body.code, "INVALID_BODY", "confirmRecovery must be literal true");
}
{
  let getterReads = 0;
  const body = makeBody();
  Object.defineProperty(body, "doc", {
    enumerable: true,
    get() {
      getterReads += 1;
      return EMPTY_DOC;
    },
  });
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, body);
  eq(response.body.code, "INVALID_BODY", "hostile top-level doc accessor rejected");
  eq(getterReads, 0, "production parser never invokes hostile doc getter");
}
{
  let getterReads = 0;
  const hostileDeps = {};
  Object.defineProperty(hostileDeps, "models", {
    enumerable: true,
    get() {
      getterReads += 1;
      return [];
    },
  });
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ deps: hostileDeps }));
  eq(response.body.code, "INVALID_BODY", "hostile nested deps accessor rejected");
  eq(getterReads, 0, "production parser never invokes hostile deps getter");
}

console.log("repair authorization, recovery gate, replacement validation, and size");
{
  const client = makeSupabase([makeRow()], { userId: OTHER_USER });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [404, "NOT_FOUND"], "wrong user is indistinguishable from not found");
  const read = callsOf(client, "read")[0];
  ok(
    read.filters.some((filter) => filter.operator === "eq" && filter.field === "user_id" && filter.value === OTHER_USER),
    "initial repair read has explicit authenticated user_id predicate"
  );
}
{
  const client = makeSupabase([]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [404, "NOT_FOUND"], "missing row rejected");
}
{
  const client = makeSupabase([makeRow({ rev: 8 })]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "REV_CONFLICT"], "stale repair revision rejected");
  eq(client.updateCount, 0, "stale revision performs no update");
}
{
  const client = makeSupabase([makeRow({ writer_tag: OTHER_WRITER })]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "WRITER_LOCKED"], "wrong writer rejected");
  eq(client.updateCount, 0, "wrong writer performs no update");
}
{
  const client = makeSupabase([
    makeRow({ writer_heartbeat_at: new Date(NOW_MS - writerLock.WRITER_LEASE_MS - 1).toISOString() }),
  ]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "WRITER_LOCKED"], "expired matching writer rejected");
  eq(client.updateCount, 0, "expired writer cannot be renewed through PUT");
}
{
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC, deps: EMPTY_DEPS })]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [422, "CANVAS_DOC_INVALID"], "healthy stored row rejects overwrite attempt");
  eq(client.updateCount, 0, "healthy row overwrite attempt performs no update");
}
{
  const client = makeSupabase([
    makeRow({ schema_version: schema.CANVAS_SCHEMA_VERSION + 1 }),
  ]);
  const response = await invoke(client, makeBody());
  eq(
    [response.status, response.body.code],
    [422, "CANVAS_DOC_INVALID"],
    "future-schema stored row rejects repair without pseudo-downgrade"
  );
  eq(client.updateCount, 0, "future-schema stored row performs zero updates");
  eq(client.rows[0].schema_version, schema.CANVAS_SCHEMA_VERSION + 1, "future schema remains intact");
}
{
  const client = makeSupabase([makeRow({ doc: EMPTY_DOC, deps: { models: [123] } })]);
  const response = await invoke(client, makeBody());
  eq(response.status, 200, "invalid raw stored deps enables explicit repair");
}
{
  const malformedDoc = { nodes: [], edges: [], groups: [], selected: true };
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ doc: malformedDoc }));
  eq([response.status, response.body.code], [400, "INVALID_BODY"], "malformed replacement doc rejected by request schema");
}
{
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ deps: { models: [123] } }));
  eq([response.status, response.body.code], [400, "INVALID_BODY"], "malformed replacement deps rejected by request schema");
}
{
  const unsafeNode = schema.createCanvasNode({ id: "unsafe", type: "text", position: { x: 0, y: 0 } });
  unsafeNode.data.params = { payload: "data:text/plain,hostile" };
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ doc: { nodes: [unsafeNode], edges: [], groups: [] } }));
  eq([response.status, response.body.code], [422, "CANVAS_DOC_INVALID"], "hostile dataURL replacement rejected semantically");
  eq(client.updateCount, 0, "hostile replacement performs no update");
}
{
  const hugeNode = schema.createCanvasNode({ id: "huge", type: "text", position: { x: 0, y: 0 } });
  hugeNode.data.params = { payload: "x".repeat(docLimits.DOC_BYTES_HARD_LIMIT + 1024) };
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ doc: { nodes: [hugeNode], edges: [], groups: [] } }));
  eq([response.status, response.body.code], [400, "DOC_TOO_LARGE"], ">2MB replacement rejected");
  eq(client.updateCount, 0, "oversize replacement performs no update");
}

console.log("zero-row CAS reread classification and database ambiguity");
{
  const client = makeSupabase([makeRow()], {
    forceZeroUpdate: true,
    onZeroUpdate(rows) {
      rows[0].rev = 8;
    },
  });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "REV_CONFLICT"], "zero-row CAS reread classifies revision race");
  eq([client.updateCount, client.readCount], [1, 2], "revision race uses one update and one classification reread");
}
{
  const client = makeSupabase([makeRow()], {
    forceZeroUpdate: true,
    onZeroUpdate(rows) {
      rows[0].writer_tag = OTHER_WRITER;
    },
  });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "WRITER_LOCKED"], "zero-row CAS reread classifies writer takeover");
  eq(client.updateCount, 1, "writer takeover is not retried with a second update");
}
{
  const client = makeSupabase([makeRow()], {
    forceZeroUpdate: true,
    onZeroUpdate(rows) {
      rows.splice(0, rows.length);
    },
  });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [404, "NOT_FOUND"], "zero-row CAS reread classifies deletion/not-owned");
}
{
  const client = makeSupabase([makeRow()], { forceZeroUpdate: true });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "unchanged write-eligible zero row fails closed");
  eq(client.updateCount, 1, "unexplained zero row never retries the update");
}
{
  const client = makeSupabase([makeRow()], {
    forceZeroUpdate: true,
    onZeroUpdate(rows) {
      rows[0].doc = EMPTY_DOC;
      rows[0].deps = EMPTY_DEPS;
      rows[0].rev = 8;
      rows[0].schema_version = schema.CANVAS_SCHEMA_VERSION;
      rows[0].doc_bytes = docLimits.computeDocBytes(EMPTY_DOC);
      rows[0].updated_at = NOW_ISO;
      rows[0].writer_heartbeat_at = NOW_ISO;
    },
  });
  const response = await invoke(client, makeBody());
  eq(response.status, 200, "zero-row CAS exact concurrent duplicate is adopted as already applied");
  eq([client.updateCount, client.readCount], [1, 2], "concurrent duplicate is classified without second update");
  eq(response.body.data.envelope.doc, EMPTY_DOC, "concurrent duplicate returns Runtime-ready envelope");
}
{
  const client = makeSupabase([makeRow()], { readErrorAt: 1 });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "initial database read error is internal");
}
{
  const client = makeSupabase([makeRow()], { multipleReadAt: 1 });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "multiple-row initial read ambiguity is internal");
}
{
  const client = makeSupabase([makeRow()], { updateError: true });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "database update error is internal");
}
{
  const client = makeSupabase([makeRow()], { updateAmbiguous: true });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "multiple-row update ambiguity is internal");
}
{
  const client = makeSupabase([makeRow()], { forceZeroUpdate: true, readErrorAt: 2 });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "zero-row classification query error is internal");
}
{
  const client = makeSupabase([makeRow()], { forceZeroUpdate: true, multipleReadAt: 2 });
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [500, "INTERNAL"], "zero-row multiple-row reread ambiguity is internal");
}

console.log("successful repair exact owner/revision/writer CAS and response envelope");
{
  const replacementNode = schema.createCanvasNode({
    id: "lost_response_node",
    type: "text",
    position: { x: 5, y: 6 },
  });
  const replacementDoc = { nodes: [replacementNode], edges: [], groups: [] };
  const replacementDeps = { ...EMPTY_DEPS, voices: ["voice_lost_response"] };
  const body = makeBody({ doc: replacementDoc, deps: replacementDeps });
  const client = makeSupabase([makeRow()]);

  const committedButLost = await invoke(client, body);
  const retried = await invoke(client, body);
  eq([committedButLost.status, retried.status], [200, 200], "lost repair response exact retry succeeds idempotently");
  eq(client.updateCount, 1, "lost-response retry performs zero second updates");
  eq(client.rows[0].rev, 8, "lost-response retry leaves revision bumped exactly once");
  eq(retried.body.data.envelope.doc, replacementDoc, "idempotent retry returns exact Runtime-ready doc envelope");
  eq(retried.body.data.envelope.deps, replacementDeps, "idempotent retry returns exact Runtime-ready deps envelope");

  client.rows[0].writer_tag = OTHER_WRITER;
  const afterTakeover = await invoke(client, body);
  eq([afterTakeover.status, afterTakeover.body.code], [409, "WRITER_LOCKED"], "already-applied retry still requires current writer ownership");
  eq(client.updateCount, 1, "writer takeover retry performs no update");
}
{
  const changed = schema.createCanvasNode({
    id: "different_stale_node",
    type: "text",
    position: { x: 1, y: 1 },
  });
  const client = makeSupabase([
    makeRow({
      rev: 8,
      doc: { nodes: [changed], edges: [], groups: [] },
      doc_bytes: docLimits.computeDocBytes({ nodes: [changed], edges: [], groups: [] }),
    }),
  ]);
  const response = await invoke(client, makeBody());
  eq([response.status, response.body.code], [409, "REV_CONFLICT"], "different rev+1 stale payload remains a conflict");
  eq(client.updateCount, 0, "different stale payload performs no update");
}
{
  const replacementNode = schema.createCanvasNode({
    id: "repaired_node",
    type: "text",
    position: { x: 12, y: 34 },
  });
  const replacementDoc = { nodes: [replacementNode], edges: [], groups: [] };
  const replacementDeps = { ...EMPTY_DEPS, models: ["model_repaired"] };
  const client = makeSupabase([makeRow()]);
  const response = await invoke(client, makeBody({ doc: replacementDoc, deps: replacementDeps }));

  eq(response.status, 200, "valid explicit recovery succeeds");
  eq(Object.keys(response.body).sort(), ["data", "success"], "success response has no extra top-level fields");
  ok(response.body.success === true, "success discriminant is true");
  const data = response.body.data;
  eq(
    Object.keys(data).sort(),
    ["docBytes", "envelope", "id", "persisted", "recovered", "rev", "schemaVersion", "updatedAt"].sort(),
    "repair data matches the exact Runtime contract"
  );
  eq(
    Object.keys(data.envelope).sort(),
    ["deps", "doc", "docBytes", "rev", "schemaVersion"].sort(),
    "repair envelope has the exact strict metadata shape"
  );
  eq(data.id, ID, "repair result id matches exact route id");
  eq(data.rev, 8, "repair bumps revision exactly once to baseRev+1");
  ok(data.persisted === true && data.recovered === true, "repair result carries literal persisted/recovered true");
  eq(data.updatedAt, NOW_ISO, "repair result uses deterministic server updatedAt");
  eq(
    [data.envelope.rev, data.envelope.schemaVersion, data.envelope.docBytes],
    [data.rev, data.schemaVersion, data.docBytes],
    "envelope metadata exactly matches top-level repair metadata"
  );
  eq(data.envelope.doc, replacementDoc, "response envelope contains strict replacement doc");
  eq(data.envelope.deps, replacementDeps, "response envelope contains strict replacement deps");

  eq([client.readCount, client.updateCount], [1, 1], "success performs one read and exactly one update");
  const updateCall = callsOf(client, "update")[0];
  eq(
    updateCall.filters.map((filter) => [filter.operator, filter.field, filter.value]),
    [
      ["eq", "id", ID],
      ["eq", "user_id", USER],
      ["eq", "rev", 7],
      ["eq", "writer_tag", WRITER],
      ["gte", "writer_heartbeat_at", new Date(NOW_MS - writerLock.WRITER_LEASE_MS).toISOString()],
    ],
    "atomic update has exact id+owner+rev+writer+active-lease predicates"
  );
  eq(
    Object.keys(updateCall.values).sort(),
    ["deps", "doc", "doc_bytes", "rev", "schema_version", "updated_at", "writer_heartbeat_at"].sort(),
    "atomic update writes only repair columns"
  );
  const stored = client.rows[0];
  eq(stored.rev, 8, "stored row revision bumped once");
  eq(stored.schema_version, schema.CANVAS_SCHEMA_VERSION, "stored schema_version set to current");
  eq(stored.doc, replacementDoc, "stored doc is the strict replacement");
  eq(stored.deps, replacementDeps, "stored deps is the strict replacement");
  eq(stored.doc_bytes, data.docBytes, "stored doc_bytes matches response metadata");
  eq(stored.writer_heartbeat_at, NOW_ISO, "successful repair renews writer heartbeat");
  eq(stored.updated_at, NOW_ISO, "successful repair maintains updated_at explicitly");
}

console.log(`\nrepair verifier: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("repair route verification passed");
