/** D3 offline contract verification. Run with: node scripts/verify-canvas-d3.mjs
 *
 * 脱离数据库直测补丁协议纯核心:幂等重放 / 重叠 409 / 非重叠 rebase / 引用完整性 /
 * RF+URL 攻击 / 体积边界,以及离线队列状态机(opId 去重 / coalesce / buildPatch /
 * ack / fail / snapshot / restore)。PATCH IO 由专门 route verifier 承接；POST 稳定 ID 的
 * 201/23505/readback 路径在本脚本中直接转译并执行生产 route.ts。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".temp", "canvas-verify-build");

function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

async function loadExtra(sourcePath, outputName, rewrites = {}) {
  mkdirSync(OUT, { recursive: true });
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  let code = addExt(outputText);
  for (const [from, to] of Object.entries(rewrites)) code = code.split(from).join(to);
  const outputPath = join(OUT, outputName);
  writeFileSync(outputPath, code, "utf8");
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
}

const fails = [];
let pass = 0;

function ok(condition, label) {
  if (condition) pass += 1;
  else {
    fails.push(label);
    console.log(`  ❌ ${label}`);
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}
function noThrow(fn, label) {
  try {
    const r = fn();
    pass += 1;
    return r;
  } catch (error) {
    fails.push(`${label}: ${error.message}`);
    console.log(`  ❌ ${label}: ${error.message}`);
    return null;
  }
}

// 依赖顺序构建:leaf 先落盘,dependent 的相对 import 才能解析。
const schema = await loadCanvasModule("schema");
const docLimits = await loadCanvasModule("doc-limits");
const patch = await loadCanvasModule("patch");
const queue = await loadCanvasModule("offline-queue");
const apiTypes = await loadCanvasModule("api-types");
const writerLock = await loadCanvasModule("writer-lock");
const helpers = await loadCanvasModule("api-helpers");
await loadCanvasModule("history");
await loadCanvasModule("group-ops");
await loadCanvasModule("rf-adapter");
const saveAdapterModule = await loadCanvasModule("canvas-save-adapter");
const storeModule = await loadExtra(
  join(ROOT, "src", "stores", "canvas-store.ts"),
  "canvas-store-d3.mjs",
  {
    '"@/lib/canvas/schema"': '"./schema.mjs"',
    '"@/lib/canvas/rf-adapter"': '"./rf-adapter.mjs"',
    '"@/lib/canvas/history"': '"./history.mjs"',
    '"@/lib/canvas/group-ops"': '"./group-ops.mjs"',
    '"@/lib/canvas/api-helpers"': '"./api-helpers.mjs"',
  }
);

const {
  createCanvasNode,
  createCanvasEdge,
  createCanvasGroup,
  createCanvasRefs,
  createEmptyCanvasDoc,
  createEmptyCanvasDeps,
  CanvasDocSchema,
  CanvasDocumentEnvelopeSchema,
  CANVAS_SCHEMA_VERSION,
  loadCanvasDoc,
} = schema;
const { DOC_BYTES_HARD_LIMIT, DOC_JSONB_WARN_LIMIT } = docLimits;
const { WRITER_LEASE_MS } = writerLock;
const {
  CanvasOpSchema,
  CanvasOpsArraySchema,
  CANVAS_PATCH_MAX_OPS,
  coalesce,
  applyPatch,
  deepEqual,
  opTargetId,
} = patch;
const {
  createOfflineQueue,
  enqueue,
  buildPatch,
  ack,
  fail: queueFail,
  reset,
  snapshot,
  restore,
  isDirty,
  previewOps,
  OFFLINE_QUEUE_SNAPSHOT_VERSION,
  OfflineQueueSnapshotSchema,
} = queue;
const { CANVAS_API_ERROR_CODES, httpStatusForCanvasError, canvasApiError, canvasApiSuccess } =
  apiTypes;
const {
  computePatch,
  decidePatch,
  decideRepair,
  buildSizeWarning,
  sanitizeCanvasTitle,
  recoveryReport,
  tolerantEnvelope,
  parseStoredDeps,
  parseDepsForTransport,
  parseCanvasRepairRequest,
  CanvasCreateRequestSchema,
  CanvasPatchBodySchema,
  CanvasPatchWriteBodySchema,
  CanvasRepairRequestSchema,
} = helpers;
const { CanvasSaveAdapter } = saveAdapterModule;
const { useCanvasStore } = storeModule;

// Production POST route harness. This is intentionally a transpile+VM execution of route.ts,
// not a copied helper, so the 23505/readback control flow and its exact Supabase predicates run.
const postRoutePath = join(ROOT, "src", "app", "api", "canvas", "route.ts");
const postRouteBuilt = ts.transpileModule(readFileSync(postRoutePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
  },
  fileName: postRoutePath,
  reportDiagnostics: true,
});
const postTranspileErrors = (postRouteBuilt.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
);
const POST_NOW_MS = Date.parse("2026-07-14T09:00:00.000Z");
const POST_NOW_ISO = new Date(POST_NOW_MS).toISOString();
class PostFixedDate extends Date {
  constructor(value) {
    super(value === undefined ? POST_NOW_MS : value);
  }
  static now() {
    return POST_NOW_MS;
  }
}
let activePostClient = null;
const postRouteModule = { exports: {} };
const postRouteContext = vm.createContext({
  module: postRouteModule,
  exports: postRouteModule.exports,
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
          if (!activePostClient) throw new Error("No active POST Supabase client");
          return activePostClient;
        },
      };
    }
    if (specifier === "@/lib/canvas/schema") return schema;
    if (specifier === "@/lib/canvas/doc-limits") return docLimits;
    if (specifier === "@/lib/canvas/api-types") return apiTypes;
    if (specifier === "@/lib/canvas/api-helpers") return helpers;
    if (specifier === "@/lib/canvas/patch") return patch;
    throw new Error(`Unexpected POST route dependency: ${specifier}`);
  },
  console: { error() {}, log() {}, warn() {} },
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
  Date: PostFixedDate,
  TextEncoder,
  URL,
});
new vm.Script(postRouteBuilt.outputText, { filename: postRoutePath }).runInContext(
  postRouteContext
);
const productionPost = postRouteModule.exports.POST;

const POST_USER = "11111111-1111-4111-8111-111111111111";
const POST_OTHER_USER = "22222222-2222-4222-8222-222222222222";
const POST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POST_TITLE = "Idempotent create";
const POST_DOC = createEmptyCanvasDoc();
const POST_DEPS = createEmptyCanvasDeps();
const POST_DOC_BYTES = docLimits.computeDocBytes(POST_DOC);

function makePostRow(overrides = {}) {
  return {
    id: POST_ID,
    user_id: POST_USER,
    title: POST_TITLE,
    rev: 0,
    schema_version: CANVAS_SCHEMA_VERSION,
    doc: POST_DOC,
    deps: POST_DEPS,
    doc_bytes: POST_DOC_BYTES,
    created_at: POST_NOW_ISO,
    updated_at: POST_NOW_ISO,
    ...overrides,
  };
}

function makePostClient(options = {}) {
  const calls = [];
  class Query {
    constructor(source) {
      this.source = source;
      this.operation = "read";
      this.columns = "";
      this.values = null;
      this.filters = [];
    }
    insert(values) {
      this.operation = "insert";
      this.values = values;
      return this;
    }
    select(columns) {
      this.columns = columns;
      return this;
    }
    eq(field, value) {
      this.filters.push({ field, value });
      return this;
    }
    async single() {
      calls.push({
        operation: this.operation,
        source: this.source,
        columns: this.columns,
        values: this.values,
        filters: this.filters.map((filter) => ({ ...filter })),
      });
      return {
        data: Object.prototype.hasOwnProperty.call(options, "insertRow")
          ? options.insertRow
          : makePostRow(),
        error: options.insertError ?? null,
      };
    }
    async maybeSingle() {
      calls.push({
        operation: "readback",
        source: this.source,
        columns: this.columns,
        values: this.values,
        filters: this.filters.map((filter) => ({ ...filter })),
      });
      return {
        data: Object.prototype.hasOwnProperty.call(options, "readbackRow")
          ? options.readbackRow
          : null,
        error: options.readbackError ?? null,
      };
    }
  }
  return {
    calls,
    auth: {
      async getUser() {
        return { data: { user: { id: options.userId ?? POST_USER } }, error: null };
      },
      async getClaims() {
        return {
          data: { claims: { sub: options.userId ?? POST_USER } },
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

async function invokeProductionPost(client, body = {}) {
  activePostClient = client;
  return productionPost({
    async json() {
      return {
        id: POST_ID,
        title: POST_TITLE,
        doc: POST_DOC,
        deps: POST_DEPS,
        ...body,
      };
    },
  });
}

const parseOp = (raw) => CanvasOpSchema.parse(raw);
const addOp = (entity, value) => parseOp({ entity, op: "add", value });
const updateOp = (entity, base, next) => parseOp({ entity, op: "update", base, next });
const removeOp = (entity, base) => parseOp({ entity, op: "remove", base });

// ─────────────────────────────────────────────────────────────────────────────
console.log("① op schema 严格性 + id 规则");
const nodeA = createCanvasNode({ id: "node_a", type: "text", position: { x: 0, y: 0 } });
const nodeB = createCanvasNode({ id: "node_b", type: "image", position: { x: 5, y: 5 } });
ok(CanvasOpSchema.safeParse({ entity: "node", op: "add", value: nodeA }).success, "合法 add node op");
ok(
  CanvasOpSchema.safeParse({ entity: "node", op: "update", base: nodeA, next: { ...nodeA, position: { x: 9, y: 9 } } }).success,
  "合法 update node op"
);
ok(CanvasOpSchema.safeParse({ entity: "node", op: "remove", base: nodeA }).success, "合法 remove node op");
ok(
  !CanvasOpSchema.safeParse({ entity: "node", op: "update", base: nodeA, next: { ...nodeB } }).success,
  "update 拒绝改 id(base.id != next.id)"
);
ok(
  !CanvasOpSchema.safeParse({ entity: "node", op: "add", value: { ...nodeA, selected: true } }).success,
  "op 值拒绝 RF 字段(strictObject)"
);
ok(
  !CanvasOpSchema.safeParse({ entity: "node", op: "add", value: nodeA, extra: 1 }).success,
  "op 顶层拒绝多余字段"
);
ok(
  !CanvasOpSchema.safeParse({
    entity: "node",
    op: "add",
    value: { id: "n", type: "image", position: { x: 0, y: 0 }, group_id: null, data: { refs: createCanvasRefs(), media: { ossKey: "data:image/png;base64,AA" } } },
  }).success,
  "op 值 media dataURL 在 zod 层被拒(INVALID_OPS 路径)"
);
ok(CanvasOpsArraySchema.safeParse([]).success, "空 ops 数组合法(纯元数据保存)");
ok(
  !CanvasOpsArraySchema.safeParse(new Array(CANVAS_PATCH_MAX_OPS + 1).fill({ entity: "node", op: "add", value: nodeA })).success,
  "ops 超上限被拒"
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("② coalesce 确定性 + 抵消");
const nodeAv2 = { ...nodeA, position: { x: 1, y: 1 } };
const nodeAv3 = { ...nodeA, position: { x: 2, y: 2 } };
{
  const out = coalesce([addOp("node", nodeA), updateOp("node", nodeA, nodeAv2)]);
  ok(out.length === 1 && out[0].op === "add" && deepEqual(out[0].value, nodeAv2), "add+update → 单 add(取最终值)");
}
{
  const out = coalesce([addOp("node", nodeA), removeOp("node", nodeA)]);
  ok(out.length === 0, "add+remove → 抵消为空");
}
{
  const out = coalesce([updateOp("node", nodeA, nodeAv2), updateOp("node", nodeAv2, nodeAv3)]);
  ok(
    out.length === 1 && out[0].op === "update" && deepEqual(out[0].base, nodeA) && deepEqual(out[0].next, nodeAv3),
    "update+update → base=首,next=末"
  );
}
{
  const out = coalesce([updateOp("node", nodeA, nodeAv2), removeOp("node", nodeAv2)]);
  ok(out.length === 1 && out[0].op === "remove" && deepEqual(out[0].base, nodeA), "update+remove → remove(base=原始)");
}
{
  const out = coalesce([removeOp("node", nodeA), addOp("node", nodeAv2)]);
  ok(out.length === 1 && out[0].op === "update" && deepEqual(out[0].base, nodeA) && deepEqual(out[0].next, nodeAv2), "remove+add → update(替换)");
}
{
  const out = coalesce([updateOp("node", nodeA, nodeAv2), updateOp("node", nodeAv2, nodeA)]);
  ok(out.length === 0, "update 回原值 → 净空丢弃");
}
{
  const ops = [addOp("node", nodeB), addOp("node", nodeA)];
  const out = coalesce(ops);
  ok(out.length === 2 && opTargetId(out[0]) === "node_b" && opTargetId(out[1]) === "node_a", "多实体保持首次出现顺序");
  ok(deepEqual(coalesce(out), out), "coalesce 幂等(再跑结构不变)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("③ applyPatch 幂等 / rebase / 重叠 / 纯度");
const baseDoc = { nodes: [nodeA, nodeB], edges: [], groups: [] };
{
  const nodeC = createCanvasNode({ id: "node_c", type: "video", position: { x: 7, y: 7 } });
  const r = applyPatch(baseDoc, [addOp("node", nodeC)]);
  ok(r.ok && r.applied === 1 && r.noop === 0 && r.doc.nodes.length === 3, "add 新节点 applied=1");
  ok(baseDoc.nodes.length === 2, "applyPatch 不改入参 doc(纯度)");
}
{
  const r = applyPatch(baseDoc, [addOp("node", nodeA)]);
  ok(r.ok && r.applied === 0 && r.noop === 1, "重放相同 add → 幂等 no-op");
}
{
  const r = applyPatch(baseDoc, [addOp("node", { ...nodeA, position: { x: 99, y: 99 } })]);
  ok(!r.ok && r.conflicts[0].reason === "add-exists-different", "add 已存在异值 → 冲突");
}
{
  const r = applyPatch(baseDoc, [updateOp("node", nodeA, nodeAv2)]);
  ok(r.ok && r.applied === 1 && deepEqual(r.doc.nodes.find((n) => n.id === "node_a"), nodeAv2), "update base==current → 应用");
}
{
  const changed = { nodes: [nodeAv2, nodeB], edges: [], groups: [] };
  const r = applyPatch(changed, [updateOp("node", nodeAv2, nodeA)]);
  ok(r.ok, "update 应用回不同值成功");
  const replay = applyPatch(changed, [updateOp("node", nodeA, nodeAv2)]);
  ok(replay.ok && replay.noop === 1, "update current==next → 幂等 no-op");
}
{
  // 重叠:当前是 v3,补丁 base=v1(nodeA),next=v2 → 既非 next 也非 base → 冲突(409)
  const changed = { nodes: [nodeAv3, nodeB], edges: [], groups: [] };
  const r = applyPatch(changed, [updateOp("node", nodeA, nodeAv2)]);
  ok(!r.ok && r.conflicts[0].reason === "update-base-mismatch", "update 基线不符(重叠)→ 冲突");
}
{
  const r = applyPatch(baseDoc, [updateOp("node", { ...nodeA, id: "ghost" }, { ...nodeAv2, id: "ghost" })]);
  ok(!r.ok && r.conflicts[0].reason === "update-target-missing", "update 目标缺失 → 冲突");
}
{
  const r = applyPatch(baseDoc, [removeOp("node", nodeA)]);
  ok(r.ok && r.applied === 1 && !r.doc.nodes.some((n) => n.id === "node_a"), "remove base==current → 删除");
}
{
  const r = applyPatch(baseDoc, [removeOp("node", { ...nodeA, id: "ghost" })]);
  ok(r.ok && r.noop === 1, "remove 目标已缺失 → 幂等 no-op");
}
{
  const changed = { nodes: [nodeAv3, nodeB], edges: [], groups: [] };
  const r = applyPatch(changed, [removeOp("node", nodeA)]);
  ok(!r.ok && r.conflicts[0].reason === "remove-base-mismatch", "remove 基线不符(重叠)→ 冲突");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("④ computePatch 全链路(rebase / 引用完整性 / RF+URL / 字节)");
{
  // 非重叠 rebase:库内 B 已被他人改成 Bv2,我方只动 A → 成功,B 保留他人版本
  const nodeBv2 = { ...nodeB, position: { x: 88, y: 88 } };
  const current = { nodes: [nodeA, nodeBv2], edges: [], groups: [] };
  const c = computePatch(current, [updateOp("node", nodeA, nodeAv2)]);
  ok(
    c.status === "ok" && c.applied === 1 && deepEqual(c.doc.nodes.find((n) => n.id === "node_b"), nodeBv2),
    "非重叠 rebase:改 A 保留他人对 B 的修改"
  );
}
{
  const current = { nodes: [nodeAv3, nodeB], edges: [], groups: [] };
  const c = computePatch(current, [updateOp("node", nodeA, nodeAv2)]);
  ok(c.status === "conflict" && c.conflicts.length === 1, "重叠 → computePatch conflict(→409)");
}
{
  // 引用完整性:删掉被 edge 引用的节点 → 应用后严格 schema 悬空 → invalid(422)
  const edge = createCanvasEdge({ id: "edge_1", source: "node_a", target: "node_b" });
  const current = { nodes: [nodeA, nodeB], edges: [edge], groups: [] };
  const c = computePatch(current, [removeOp("node", nodeB)]);
  ok(c.status === "invalid", "删被引用节点致悬空连线 → invalid(422)");
}
{
  // 引用完整性:新增悬空 edge(端点不存在)→ invalid
  const edge = createCanvasEdge({ id: "edge_x", source: "node_a", target: "ghost_node" });
  const current = { nodes: [nodeA], edges: [], groups: [] };
  const c = computePatch(current, [addOp("edge", edge)]);
  ok(c.status === "invalid", "新增悬空端点连线 → invalid(422)");
}
{
  // params 深层 dataURL:op 结构合法(zod 过),但 computePatch 危险值扫描拒(422)
  const badNode = createCanvasNode({
    id: "node_bad",
    type: "text",
    position: { x: 0, y: 0 },
    data: { params: { nested: "data:image/png;base64,AA" } },
  });
  ok(CanvasOpSchema.safeParse({ entity: "node", op: "add", value: badNode }).success, "params 内 dataURL 节点 op 结构层可过");
  const c = computePatch(createEmptyCanvasDoc(), [addOp("node", badNode)]);
  ok(c.status === "invalid", "params 深层 dataURL → computePatch invalid(422)");
}
{
  // 字节:>2MB 硬拒
  const big = "x".repeat(2_200_000);
  const bigNode = createCanvasNode({ id: "node_big", type: "text", position: { x: 0, y: 0 }, data: { params: { blob: big } } });
  const c = computePatch(createEmptyCanvasDoc(), [addOp("node", bigNode)]);
  ok(c.status === "too_large" && c.bytes > DOC_BYTES_HARD_LIMIT, "doc >2MB → too_large(→400)");
}
{
  // 字节:>512KB 且 <2MB → ok + 软告警
  const mid = "y".repeat(600_000);
  const midNode = createCanvasNode({ id: "node_mid", type: "text", position: { x: 0, y: 0 }, data: { params: { blob: mid } } });
  const c = computePatch(createEmptyCanvasDoc(), [addOp("node", midNode)]);
  ok(
    c.status === "ok" && c.warning && c.warning.code === "DOC_SIZE_WARNING" && c.docBytes > DOC_JSONB_WARN_LIMIT && c.docBytes < DOC_BYTES_HARD_LIMIT,
    "512KB<doc<2MB → ok + DOC_SIZE_WARNING"
  );
}
{
  // 小 doc → ok,无告警
  const c = computePatch(createEmptyCanvasDoc(), [addOp("node", nodeA)]);
  ok(c.status === "ok" && c.warning === null && c.applied === 1, "小 doc → ok 无告警");
}
{
  // 纯 no-op 补丁:对空 doc remove 不存在实体 → applied 0,noop 1,ok
  const c = computePatch(createEmptyCanvasDoc(), [removeOp("node", nodeA)]);
  ok(c.status === "ok" && c.applied === 0 && c.noop === 1, "对缺失目标 remove → 幂等 ok(applied=0)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑤ api-helpers 辅助 + api-types 错误映射");
ok(buildSizeWarning({ overHardLimit: true, overWarnLimit: true }) === null, "超硬闸不出软告警(走 too_large)");
ok(buildSizeWarning({ overHardLimit: false, overWarnLimit: false }) === null, "未超告警闸无告警");
ok(
  buildSizeWarning({ overHardLimit: false, overWarnLimit: true, bytes: 600000, warnLimit: DOC_JSONB_WARN_LIMIT, hardLimit: DOC_BYTES_HARD_LIMIT, message: "m" })?.code === "DOC_SIZE_WARNING",
  "超告警未超硬 → DOC_SIZE_WARNING"
);
eq(sanitizeCanvasTitle(123), "未命名画布", "非字符串标题 → 默认");
eq(sanitizeCanvasTitle("   "), "未命名画布", "空白标题 → 默认");
eq(sanitizeCanvasTitle("  我的画布 "), "我的画布", "标题去首尾空白");
eq(sanitizeCanvasTitle("z".repeat(500)).length, 200, "超长标题截断到 200");
{
  const mixed = {
    nodes: [
      nodeA,
      { id: "bad", type: "audio", position: { x: 1, y: 1 } },
    ],
    edges: [{ id: "e_dangle", source: "node_a", target: "ghost" }],
    groups: [],
  };
  const load = loadCanvasDoc(mixed);
  const report = recoveryReport(load);
  ok(
    report.recoveryRequired &&
      Array.isArray(report.brokenNodes) &&
      report.brokenNodes.length === 1 &&
      report.brokenEdges.length === 1,
    "recoveryReport 原样带 broken 实体(非仅计数)"
  );
  ok(
    report.brokenNodes[0] && "raw" in report.brokenNodes[0] && Array.isArray(report.brokenNodes[0].issues),
    "broken 节点保留 raw+issues 供 S3 占位可删"
  );
  const env = tolerantEnvelope(load, createEmptyCanvasDeps());
  ok(CanvasDocumentEnvelopeSchema.safeParse(env).success, "无残留引用档:tolerantEnvelope 拓扑恰可严格解析");
}
{
  // 混合恢复档:broken node + 指向它的 edge + group 成员 → tolerant 传输三者均保留;
  // 该拓扑非严格 CanvasDoc(不可直接写),仅显式级联删除/修复后才严格通过;只读三者不变。
  const recoveryDoc = {
    nodes: [nodeA, { id: "bad_node", type: "audio", position: { x: 1, y: 1 } }],
    edges: [{ id: "e_to_broken", source: "node_a", target: "bad_node" }],
    groups: [{ id: "g1", label: "", node_ids: ["node_a", "bad_node"] }],
  };
  const load = loadCanvasDoc(recoveryDoc);
  ok(load.recoveryRequired && load.brokenNodes.length === 1, "混合档 recoveryRequired + brokenNodes=1");
  const env = tolerantEnvelope(load, createEmptyCanvasDeps());
  ok(env.doc.edges.some((e) => e.id === "e_to_broken"), "tolerant 保留指向 broken 的 edge(不静默丢)");
  ok(env.doc.groups[0].node_ids.includes("bad_node"), "tolerant 保留 group 中的 broken 成员");
  ok(!env.doc.nodes.some((n) => n.id === "bad_node"), "broken 节点不在 doc.nodes(在 recovery.brokenNodes)");
  ok(recoveryReport(load).brokenNodes.some((n) => n.id === "bad_node"), "recovery 原样带 broken 节点 raw");
  ok(!CanvasDocSchema.safeParse(env.doc).success, "tolerant 拓扑非严格 CanvasDoc(悬空 edge/group 引用,不可直接写回)");

  // 显式级联删除 broken node(S3 removeBrokenNode 契约:删 source/target==id 的边 + 从 group.node_ids 移除 id;domain 节点不动)
  const brokenId = "bad_node";
  const repaired = {
    nodes: env.doc.nodes,
    edges: env.doc.edges.filter((e) => e.source !== brokenId && e.target !== brokenId),
    groups: env.doc.groups.map((g) => ({ ...g, node_ids: g.node_ids.filter((id) => id !== brokenId) })),
  };
  ok(CanvasDocSchema.safeParse(repaired).success, "显式级联删除 broken 引用后 → 严格 CanvasDoc 通过");

  const reload = loadCanvasDoc(recoveryDoc);
  ok(
    reload.edges.some((e) => e.id === "e_to_broken") &&
      reload.groups[0].node_ids.includes("bad_node") &&
      reload.brokenNodes.length === 1,
    "只读:edge / group 成员 / broken 节点三者均不变"
  );
}
ok(deepEqual(parseStoredDeps("garbage"), createEmptyCanvasDeps()), "parseStoredDeps 损坏 → 空 deps");
ok(deepEqual(parseStoredDeps({ models: ["m1"] }).models, ["m1"]), "parseStoredDeps 合法 deps 保留");
{
  // GET 恢复一致性:健康 doc + 损坏 deps → 空 deps 展示,但 recovery.recoveryRequired=true(从加载阻断 autosave)
  const healthyLoad = loadCanvasDoc({ nodes: [nodeA], edges: [], groups: [] });
  const bad = parseDepsForTransport({ models: [123] });
  ok(!bad.ok && bad.deps.models.length === 0 && bad.issues.length > 0, "parseDepsForTransport 损坏 deps → 空 deps + issues");
  const recBad = recoveryReport(healthyLoad, { forceRecovery: !bad.ok, extraIssues: bad.issues });
  ok(recBad.recoveryRequired === true, "GET 健康 doc + 损坏 deps → recovery.recoveryRequired=true(从加载阻断 autosave)");
  ok(recBad.issues.some((i) => i.includes("deps")), "recovery.issues 含 deps 校验错误");
  const good = parseDepsForTransport({ models: ["m1"] });
  ok(good.ok && recoveryReport(healthyLoad, { forceRecovery: !good.ok }).recoveryRequired === false, "健康 doc + 合法 deps → recoveryRequired=false");
}
{
  const statusByCode = {
    UNAUTHENTICATED: 401,
    INVALID_ID: 400,
    INVALID_BODY: 400,
    INVALID_OPS: 400,
    DOC_TOO_LARGE: 400,
    NOT_FOUND: 404,
    REV_CONFLICT: 409,
    ENTITY_CONFLICT: 409,
    WRITER_LOCKED: 409, // D5 新增共享错误码:保持 D3 错误码↔状态表一一对应断言为绿
    CANVAS_DOC_INVALID: 422,
    INTERNAL: 500,
  };
  ok(CANVAS_API_ERROR_CODES.every((c) => httpStatusForCanvasError(c) === statusByCode[c]), "每个错误码映射到正确 HTTP 状态");
  ok(CANVAS_API_ERROR_CODES.length === Object.keys(statusByCode).length, "错误码集合与状态表一一对应");
  const err = canvasApiError("ENTITY_CONFLICT", "x", { conflicts: [] });
  ok(err.success === false && err.code === "ENTITY_CONFLICT" && err.details, "canvasApiError 组装带 details");
  const good = canvasApiSuccess({ a: 1 }, { code: "DOC_SIZE_WARNING", bytes: 1, warnLimit: 1, hardLimit: 1, message: "m" });
  ok(good.success === true && good.warning?.code === "DOC_SIZE_WARNING", "canvasApiSuccess 带 warning");
  ok(canvasApiSuccess({ a: 1 }).warning === undefined, "canvasApiSuccess 无 warning 时不含字段");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑥ decidePatch 决策(恢复阻断 / 并发元数据 / rebase / 冲突)");
const healthyStored = { nodes: [nodeA, nodeB], edges: [], groups: [] };
const decide = (over) =>
  decidePatch({
    storedDoc: healthyStored,
    storedDeps: {},
    storedTitle: "t",
    storedRev: 5,
    storedSchemaVersion: 1,
    storedDocBytes: null,
    baseRev: 5,
    ops: [],
    ...over,
  });
{
  // 存量坏档 → 422 阻断一切写,带完整 recovery(即便空 ops)
  const brokenStored = { nodes: [{ id: "bad", type: "audio", position: { x: 0, y: 0 } }], edges: [], groups: [] };
  const d = decide({ storedDoc: brokenStored, storedRev: 1, baseRev: 1 });
  ok(d.kind === "reload" && d.code === "CANVAS_DOC_INVALID", "存量坏档 → CANVAS_DOC_INVALID 阻断一切写");
  ok(d.details.recovery && d.details.recovery.brokenNodes.length === 1, "阻断响应带完整 recovery 负载");
  ok(d.details.latest && d.details.latest.doc.nodes.length === 0, "latest 为 tolerant(broken 节点不在 nodes)");
}
{
  // 阻断响应的 latest 为 tolerant:保留指向 broken 的 edge/group 引用(不静默丢,供客户端占位恢复)
  const recoveryDoc = {
    nodes: [nodeA, { id: "bad_node", type: "audio", position: { x: 1, y: 1 } }],
    edges: [{ id: "e_to_broken", source: "node_a", target: "bad_node" }],
    groups: [{ id: "g1", label: "", node_ids: ["node_a", "bad_node"] }],
  };
  const d = decide({ storedDoc: recoveryDoc, storedRev: 2, baseRev: 2 });
  ok(d.kind === "reload" && d.code === "CANVAS_DOC_INVALID", "混合坏档 → 422 阻断一切写");
  ok(
    d.details.latest.doc.edges.some((e) => e.id === "e_to_broken") &&
      d.details.latest.doc.groups[0].node_ids.includes("bad_node"),
    "阻断 latest 为 tolerant:保留指向 broken 的 edge/group 引用"
  );
  ok(d.details.recovery.brokenNodes.some((n) => n.id === "bad_node"), "阻断 recovery 带 broken 节点 raw");
}
{
  // group 双向不一致:容错 load 会静默修复(recoveryRequired=false),仅 validateCanvasDoc 发现。
  // title-only 补丁绝不能用 clean 修复结果写回、覆盖原始坏档。
  const inconsistentGroupDoc = {
    nodes: [{ ...nodeA, group_id: "g1" }],
    edges: [],
    groups: [{ id: "g1", label: "", node_ids: [] }],
  };
  ok(!loadCanvasDoc(inconsistentGroupDoc).recoveryRequired, "前提:group 不一致文档容错 load 判 recoveryRequired=false(会被修复)");
  const d = decide({ storedDoc: inconsistentGroupDoc, ops: [], title: "改名" });
  ok(d.kind === "reload" && d.code === "CANVAS_DOC_INVALID", "group 双向不一致 + title-only → 422 阻断(不静默覆盖)");
}
{
  // 危险 params 存量文档 + title-only → 阻断
  const dangerNode = createCanvasNode({ id: "node_a", type: "text", position: { x: 0, y: 0 }, data: { params: { nested: "data:image/png;base64,AA" } } });
  const d = decide({ storedDoc: { nodes: [dangerNode], edges: [], groups: [] }, ops: [], title: "改名" });
  ok(d.kind === "reload" && d.code === "CANVAS_DOC_INVALID", "危险 params 存量文档 + title-only → 422 阻断");
}
{
  // 损坏 deps + title-only / empty ops → 阻断(PATCH 原始 CanvasDepsSchema 不容错)
  const dTitle = decide({ storedDeps: { models: [123] }, ops: [], title: "改名" });
  ok(dTitle.kind === "reload" && dTitle.code === "CANVAS_DOC_INVALID", "损坏 deps + title-only → 422 阻断");
  ok(dTitle.details.recovery.recoveryRequired === true, "损坏 deps 阻断:recovery.recoveryRequired=true(forceRecovery)");
  ok(dTitle.details.recovery.issues.some((i) => i.includes("deps")), "损坏 deps 阻断:recovery.issues 含 deps 错误");
  const dEmpty = decide({ storedDeps: { voices: "notarray" }, ops: [] });
  ok(dEmpty.kind === "reload" && dEmpty.code === "CANVAS_DOC_INVALID", "损坏 deps + empty ops → 422 阻断");
  ok(dEmpty.details.recovery.recoveryRequired === true, "损坏 deps + empty ops 阻断:recovery.recoveryRequired=true");
}
ok(decide({ baseRev: 9 }).code === "REV_CONFLICT", "baseRev 超前服务端 → REV_CONFLICT");
ok(
  decide({ storedTitle: "old", baseRev: 3, title: "new" }).code === "REV_CONFLICT",
  "stale rev 下改 title(无 base 证明)→ REV_CONFLICT"
);
ok(
  decide({ storedDeps: { models: ["m1"] }, baseRev: 3, deps: { models: ["m2"] } }).code === "REV_CONFLICT",
  "stale rev 下改 deps → REV_CONFLICT"
);
{
  // stale rev + 仅实体 ops(非重叠)→ write rebased,保留他人对 B 的改动
  const nodeBv2 = { ...nodeB, position: { x: 88, y: 88 } };
  const d = decide({ storedDoc: { nodes: [nodeA, nodeBv2], edges: [], groups: [] }, baseRev: 3, ops: [updateOp("node", nodeA, nodeAv2)] });
  ok(d.kind === "write" && d.rebased === true && d.applied === 1, "stale rev 下实体 ops 非重叠 → write rebased");
  ok(d.title === null && deepEqual(d.doc.nodes.find((n) => n.id === "node_b"), nodeBv2), "rebase 不动 title、保留他人 B 改动");
}
{
  const d = decide({ storedTitle: "old", baseRev: 5, title: "新标题" });
  ok(d.kind === "write" && d.title === "新标题" && d.rebased === false, "fresh rev 改 title → write 带 title");
}
{
  const d = decide({ storedDoc: { nodes: [nodeAv3, nodeB], edges: [], groups: [] }, ops: [updateOp("node", nodeA, nodeAv2)] });
  ok(d.kind === "conflict" && d.details.conflicts.length === 1, "重叠补丁 → conflict(带诊断+latest)");
  ok(d.details.latest && d.details.serverRev === 5, "冲突响应带 latest + serverRev 供 rebase");
}
{
  const edge = createCanvasEdge({ id: "edge_1", source: "node_a", target: "node_b" });
  const d = decide({ storedDoc: { nodes: [nodeA, nodeB], edges: [edge], groups: [] }, ops: [removeOp("node", nodeB)] });
  ok(d.kind === "invalid", "删被引用节点致悬空 → invalid(422)");
}
{
  const d = decide({ storedDocBytes: 100, ops: [addOp("node", nodeA)] });
  ok(d.kind === "noop" && d.applied === 0 && d.noop === 1 && d.rev === 5, "重放已存在 add → noop 不 bump rev");
}
{
  const nodeC = createCanvasNode({ id: "node_c", type: "video", position: { x: 7, y: 7 } });
  const d = decide({ ops: [addOp("node", nodeC)] });
  ok(d.kind === "write" && d.applied === 1 && d.rebased === false && d.docBytes > 0, "fresh add 新节点 → write(带 docBytes)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑦ PUT repair 严格请求 + 纯决策");
const repairNowMs = Date.parse("2026-07-14T08:00:00.000Z");
const repairNowIso = new Date(repairNowMs).toISOString();
const repairTag = "writer_repair_1234";
const repairDoc = createEmptyCanvasDoc();
const repairDeps = createEmptyCanvasDeps();
const brokenStoredDoc = {
  nodes: [{ id: "broken", type: "audio", position: { x: 0, y: 0 } }],
  edges: [],
  groups: [],
};
const repair = (overrides = {}) =>
  decideRepair({
    storedDoc: brokenStoredDoc,
    storedDeps: repairDeps,
    storedDocBytes: docLimits.computeDocBytes(brokenStoredDoc),
    storedRev: 7,
    storedSchemaVersion: CANVAS_SCHEMA_VERSION,
    storedWriter: {
      writerTag: repairTag,
      writerHeartbeatAt: new Date(repairNowMs - 1_000).toISOString(),
    },
    baseRev: 7,
    writerTag: repairTag,
    doc: repairDoc,
    deps: repairDeps,
    nowMs: repairNowMs,
    nowIso: repairNowIso,
    ...overrides,
  });

{
  const d = repair();
  ok(
    d.kind === "write" &&
      d.schemaVersion === CANVAS_SCHEMA_VERSION &&
      d.docBytes > 0 &&
      deepEqual(d.doc, repairDoc) &&
      deepEqual(d.deps, repairDeps),
    "损坏存量 + 当前严格 replacement → repair write"
  );
}
ok(repair({ baseRev: 6 }).kind === "stale", "repair stale baseRev → stale(禁止 rebase/覆盖)");
ok(repair({ writerTag: "writer_other_1234" }).kind === "locked", "repair 错 writerTag → locked");
ok(
  repair({
    storedWriter: {
      writerTag: repairTag,
      writerHeartbeatAt: new Date(repairNowMs - WRITER_LEASE_MS - 1).toISOString(),
    },
  }).kind === "locked",
  "repair 过期同 tag → locked(不得经 PUT 复活)"
);
ok(
  repair({ storedDoc: repairDoc, storedDeps: repairDeps }).kind === "not_required",
  "健康存量拒绝 repair,PUT 不能成为整包覆盖旁路"
);
ok(
  repair({ storedSchemaVersion: CANVAS_SCHEMA_VERSION + 1 }).kind === "invalid",
  "future-schema 存量拒绝 repair,禁止伪降级 write"
);
{
  const appliedBytes = docLimits.computeDocBytes(repairDoc);
  const d = repair({
    storedDoc: repairDoc,
    storedDeps: repairDeps,
    storedDocBytes: appliedBytes,
    storedRev: 8,
  });
  ok(
    d.kind === "already_applied" &&
      d.docBytes === appliedBytes &&
      deepEqual(d.doc, repairDoc) &&
      deepEqual(d.deps, repairDeps),
    "同 body/baseRev 的 rev+1 repair 重试 → already_applied success envelope"
  );
  ok(
    repair({
      storedDoc: { nodes: [nodeA], edges: [], groups: [] },
      storedDeps: repairDeps,
      storedDocBytes: docLimits.computeDocBytes({ nodes: [nodeA], edges: [], groups: [] }),
      storedRev: 8,
    }).kind === "stale",
    "rev+1 但 doc 不同仍为 stale"
  );
}
ok(
  repair({ storedDoc: repairDoc, storedDeps: { models: [123] } }).kind === "write",
  "raw deps 损坏即构成真实 recovery gate"
);
ok(
  repair({
    doc: {
      nodes: [nodeA],
      edges: [{ id: "dangling", source: nodeA.id, target: "missing" }],
      groups: [],
    },
  }).kind === "invalid",
  "repair replacement 悬空引用 → invalid"
);
ok(
  repair({
    doc: {
      nodes: [{ ...nodeA, data: { ...nodeA.data, params: { payload: "data:text/plain,x" } } }],
      edges: [],
      groups: [],
    },
  }).kind === "invalid",
  "repair replacement 危险 dataURL → invalid"
);
{
  let getterReads = 0;
  const hostileDoc = {};
  Object.defineProperty(hostileDoc, "nodes", {
    enumerable: true,
    get() {
      getterReads += 1;
      return [];
    },
  });
  Object.defineProperty(hostileDoc, "edges", { enumerable: true, value: [] });
  Object.defineProperty(hostileDoc, "groups", { enumerable: true, value: [] });
  ok(repair({ doc: hostileDoc }).kind === "invalid", "repair hostile doc accessor → invalid");
  eq(getterReads, 0, "repair doc descriptor gate 不触发 getter");
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
  ok(repair({ deps: hostileDeps }).kind === "invalid", "repair hostile deps accessor → invalid");
  eq(getterReads, 0, "repair deps descriptor gate 不触发 getter");
}
{
  const hugeNode = {
    ...nodeA,
    id: "repair_huge",
    data: { ...nodeA.data, params: { payload: "x".repeat(DOC_BYTES_HARD_LIMIT + 1024) } },
  };
  ok(
    repair({ doc: { nodes: [hugeNode], edges: [], groups: [] } }).kind === "too_large",
    "repair replacement >2MB → too_large"
  );
}

const validRepairBody = {
  baseRev: 7,
  writerTag: repairTag,
  confirmRecovery: true,
  doc: repairDoc,
  deps: repairDeps,
};
ok(CanvasRepairRequestSchema.safeParse(validRepairBody).success, "PUT repair 精确五字段合法");
for (const missing of ["baseRev", "writerTag", "confirmRecovery", "doc", "deps"]) {
  const candidate = { ...validRepairBody };
  delete candidate[missing];
  ok(!CanvasRepairRequestSchema.safeParse(candidate).success, `PUT repair 缺 ${missing} 被拒`);
}
ok(
  !CanvasRepairRequestSchema.safeParse({ ...validRepairBody, extra: true }).success,
  "PUT repair 未知字段被拒(strict)"
);
ok(
  !CanvasRepairRequestSchema.safeParse({ ...validRepairBody, confirmRecovery: false }).success,
  "PUT repair confirmRecovery 必须 literal true"
);
ok(
  !CanvasRepairRequestSchema.safeParse({ ...validRepairBody, baseRev: Number.MAX_SAFE_INTEGER }).success,
  "PUT repair baseRev 留出精确 +1 空间"
);
for (const missing of ["nodes", "edges", "groups"]) {
  const doc = { ...repairDoc };
  delete doc[missing];
  ok(
    !parseCanvasRepairRequest({ ...validRepairBody, doc }).ok,
    `PUT parser 拒 repair doc 缺显式 ${missing}`
  );
}
for (const missing of ["models", "voices", "characters", "assets", "recipes"]) {
  const deps = { ...repairDeps };
  delete deps[missing];
  ok(
    !parseCanvasRepairRequest({ ...validRepairBody, deps }).ok,
    `PUT parser 拒 repair deps 缺显式 ${missing}`
  );
}
{
  let getterReads = 0;
  const hostileBody = { ...validRepairBody };
  Object.defineProperty(hostileBody, "doc", {
    enumerable: true,
    get() {
      getterReads += 1;
      return repairDoc;
    },
  });
  ok(!parseCanvasRepairRequest(hostileBody).ok, "PUT parser 拒 hostile 顶层 accessor");
  eq(getterReads, 0, "PUT parser 在 Zod 前不触发 accessor");
}
{
  const sparseDeps = { ...repairDeps, models: Array(1) };
  ok(!parseCanvasRepairRequest({ ...validRepairBody, deps: sparseDeps }).ok, "PUT parser 拒稀疏 deps 数组");
}
{
  const adapter = new CanvasSaveAdapter();
  const owner = {};
  const canvasId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  adapter.beginWriterSession(owner);
  ok(
    adapter.activateWriter(owner, { canvasId, writerTag: repairTag }),
    "repair adapter activates exact writer fixture"
  );
  const state = {
    nodes: [],
    edges: [],
    groups: [],
    brokenNodes: [],
    brokenEdges: [],
    hydrated: true,
    sessionCanvasId: canvasId,
    hydratedCanvasId: canvasId,
    migrationComplete: true,
    recoveryRequired: false,
    readOnly: false,
  };
  ok(
    adapter.prepareRepair(state, { baseRev: 7, deps: repairDeps }).ok,
    "repair adapter prepares a complete explicit request"
  );
  const proof = "P".repeat(43);
  const proofPatch = adapter.preparePatch(
    { ...state, nodes: [nodeA] },
    {
      baseRev: 7,
      ops: [{ entity: "node", op: "add", value: nodeA }],
      saveProof: proof,
    }
  );
  ok(proofPatch.ok, "proof-backed adapter prepares compressed fast PATCH");
  if (proofPatch.ok) {
    const proofBody = JSON.parse(proofPatch.request.init.body);
    ok(
      Array.isArray(proofBody.ops) && proofBody.ops.length === 0,
      "proof-backed PATCH does not duplicate entity ops on the wire"
    );
    eq(proofBody.opCount, 1, "proof-backed PATCH carries the exact durable queue op count");
    ok(
      Array.isArray(proofBody.snapshot.nodes) &&
        proofBody.snapshot.nodes.length === 1 &&
        proofBody.snapshot.nodes[0].id === nodeA.id,
      "proof-backed PATCH carries the strict current snapshot"
    );
    eq(proofBody.saveProof, proof, "proof-backed PATCH forwards the exact opaque proof");
  }
  ok(
    !adapter.preparePatch(
      { ...state, nodes: [nodeA] },
      {
        baseRev: 7,
        ops: [{ entity: "node", op: "add", value: nodeA }],
        saveProof: "invalid",
      }
    ).ok,
    "adapter rejects malformed save proof before transport"
  );
  for (const missing of ["nodes", "edges", "groups"]) {
    const partialState = { ...state };
    delete partialState[missing];
    ok(
      !adapter.prepareRepair(partialState, { baseRev: 7, deps: repairDeps }).ok,
      `repair adapter refuses state missing explicit ${missing}`
    );
  }
  for (const missing of ["models", "voices", "characters", "assets", "recipes"]) {
    const deps = { ...repairDeps };
    delete deps[missing];
    ok(
      !adapter.prepareRepair(state, { baseRev: 7, deps }).ok,
      `repair adapter refuses deps missing explicit ${missing}`
    );
  }
}
{
  const state = () => useCanvasStore.getState();
  const canvasId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  state().reset();
  ok(state().beginCanvasSession(canvasId), "future-schema store fixture begins session");
  ok(
    state().hydrate(
      loadCanvasDoc(createEmptyCanvasDoc(), CANVAS_SCHEMA_VERSION + 1),
      canvasId
    ),
    "future-schema recovery payload hydrates for read/recovery display"
  );
  state().setReadOnly(false);
  const before = {
    schemaVersion: state().schemaVersion,
    migratedFrom: state().migratedFrom,
    migrationComplete: state().migrationComplete,
    recoveryRequired: state().recoveryRequired,
    loadIssues: [...state().loadIssues],
  };
  ok(!state().confirmSafeRecovery(), "confirmSafeRecovery refuses future-schema pseudo-downgrade");
  eq(state().schemaVersion, before.schemaVersion, "future schema version remains unchanged");
  eq(state().migratedFrom, before.migratedFrom, "future migration source remains unchanged");
  eq(state().migrationComplete, before.migrationComplete, "future migration completeness remains unchanged");
  eq(state().recoveryRequired, before.recoveryRequired, "future recovery gate remains active");
  ok(deepEqual(state().loadIssues, before.loadIssues), "future recovery diagnostics remain unchanged");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧ POST / PATCH 请求体严格契约");
ok(CanvasCreateRequestSchema.safeParse({}).success, "POST 空对象合法(建空画布)");
ok(CanvasCreateRequestSchema.safeParse({ title: "x" }).success, "POST title 合法");
ok(
  CanvasCreateRequestSchema.safeParse({ title: "x", doc: { nodes: [], edges: [], groups: [] }, deps: {} }).success,
  "POST title+doc+deps 合法"
);
ok(!CanvasCreateRequestSchema.safeParse([]).success, "POST 数组体被拒(→INVALID_BODY)");
ok(!CanvasCreateRequestSchema.safeParse("x").success, "POST 基元体被拒");
ok(!CanvasCreateRequestSchema.safeParse(null).success, "POST null 体被拒");
ok(!CanvasCreateRequestSchema.safeParse({ foo: 1 }).success, "POST 未知顶层字段被拒");
ok(!CanvasCreateRequestSchema.safeParse({ title: "z".repeat(201) }).success, "POST title 超长被拒");

console.log("⑧a production POST 23505/readback idempotency");
ok(postTranspileErrors.length === 0, "production POST route transpiles without diagnostics");
ok(typeof productionPost === "function", "production POST route exports executable handler");
{
  const client = makePostClient({ insertRow: makePostRow() });
  const response = await invokeProductionPost(client);
  eq(response.status, 201, "production POST first stable-id create returns 201");
  ok(response.body.success === true && response.body.data.id === POST_ID, "first create returns exact created id");
  eq(client.calls.length, 1, "first create performs one insert and no readback");
  ok(client.calls[0].values.id === POST_ID, "first create inserts the caller stable UUID");
}
{
  const client = makePostClient({
    insertRow: null,
    insertError: { code: "23505", message: "duplicate key" },
    readbackRow: makePostRow(),
  });
  const response = await invokeProductionPost(client);
  eq(response.status, 200, "exact 23505 duplicate is adopted with 200");
  ok(response.body.success === true && response.body.data.rev === 0, "exact duplicate returns authoritative rev=0 summary");
  eq(client.calls.length, 2, "exact duplicate performs one insert attempt and one readback");
  const readback = client.calls[1];
  ok(
    readback.filters.some(({ field, value }) => field === "id" && value === POST_ID) &&
      readback.filters.some(({ field, value }) => field === "user_id" && value === POST_USER),
    "duplicate readback explicitly predicates both stable id and authenticated owner"
  );
  ok(readback.columns.includes("user_id"), "duplicate readback selects owner for defense-in-depth verification");
}
{
  const client = makePostClient({
    insertRow: null,
    insertError: { code: "23505" },
    readbackError: { code: "XX000", message: "readback failed" },
  });
  const response = await invokeProductionPost(client);
  eq([response.status, response.body.code].join(":"), "500:INTERNAL", "23505 readback error fails INTERNAL");
}
{
  const client = makePostClient({
    insertRow: null,
    insertError: { code: "23505" },
    readbackRow: null,
  });
  const response = await invokeProductionPost(client);
  eq([response.status, response.body.code].join(":"), "409:REV_CONFLICT", "23505 null/not-owned readback conflicts");
}
{
  const client = makePostClient({
    insertRow: null,
    insertError: { code: "23505" },
    // Deliberately return an other-user row even though the query has an owner predicate: the
    // production row check itself must still fail closed if a backend/stub violates that filter.
    readbackRow: makePostRow({ user_id: POST_OTHER_USER }),
  });
  const response = await invokeProductionPost(client);
  eq([response.status, response.body.code].join(":"), "409:REV_CONFLICT", "23505 other-owner readback conflicts");
}
for (const [label, overrides] of [
  ["rev>0", { rev: 1 }],
  ["title mismatch", { title: `${POST_TITLE} changed` }],
  ["schema mismatch", { schema_version: CANVAS_SCHEMA_VERSION + 1 }],
  ["doc mismatch", { doc: { nodes: [nodeA], edges: [], groups: [] } }],
  ["deps mismatch", { deps: { ...POST_DEPS, models: ["model_other"] } }],
  ["doc_bytes mismatch", { doc_bytes: POST_DOC_BYTES + 1 }],
]) {
  const client = makePostClient({
    insertRow: null,
    insertError: { code: "23505" },
    readbackRow: makePostRow(overrides),
  });
  const response = await invokeProductionPost(client);
  eq(
    [response.status, response.body.code].join(":"),
    "409:REV_CONFLICT",
    `23505 ${label} readback conflicts`
  );
}

// PATCH 顶层第一阶段:严格 known-key + title≤200;ops 结构留第二阶段(INVALID_OPS)。
// CanvasPatchBodySchema = **决策层宽松 body**(writerTag 可选,镜像 decidePatch 纯 helper 旧行为);
// 生产 PATCH 路由用的是强制 writerTag 的 CanvasPatchWriteBodySchema(见本节末)。
ok(CanvasPatchBodySchema.safeParse({ baseRev: 0 }).success, "决策层 body:baseRev 即合法(ops/writerTag 可选)");
ok(CanvasPatchBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {} }).success, "决策层 body:全字段(不含 writerTag)合法");
ok(CanvasPatchBodySchema.safeParse({ baseRev: 0, ops: "notarray" }).success, "决策层 body:顶层不校验 ops 结构(留第二阶段 INVALID_OPS)");
ok(!CanvasPatchBodySchema.safeParse({}).success, "决策层 body:缺 baseRev 被拒(→INVALID_BODY)");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: -1 }).success, "决策层 body:baseRev 负数被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 1.5 }).success, "决策层 body:baseRev 非整被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, title: "z".repeat(201) }).success, "决策层 body:title 超长 → INVALID_BODY(不截断)");
ok(!CanvasPatchBodySchema.safeParse([]).success, "决策层 body:数组体被拒");
ok(!CanvasPatchBodySchema.safeParse("x").success, "决策层 body:基元体被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, foo: 1 }).success, "决策层 body:未知顶层字段被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, deps: { models: [123] } }).success, "决策层 body:deps 非法被拒");

// **生产** PATCH write body(CanvasPatchWriteBodySchema,真实路由用此):**强制 writerTag**——
// P0 单写者安全边界:无 tag 写在解析层即被拦下(真实 route/schema 不得无 tag 写,杜绝绕过 D5)。
{
  const validTag = "writer_abcd1234"; // 合法 [A-Za-z0-9_-]{8,128}
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0 }).success, "生产 body:缺 writerTag → 被拒(不得无 tag 写)");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {} }).success, "生产 body:全字段但缺 writerTag → 被拒");
  ok(CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: validTag }).success, "生产 body:带合法 writerTag → 合法");
  ok(CanvasPatchWriteBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {}, writerTag: validTag }).success, "生产 body:全字段(含 writerTag)→ 合法");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: "bad tag" }).success, "生产 body:非法 writerTag(含空格)→ 被拒");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: "short" }).success, "生产 body:过短 writerTag → 被拒");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: validTag, foo: 1 }).success, "生产 body:未知顶层字段 → 被拒(strict)");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: -1, writerTag: validTag }).success, "生产 body:baseRev 负数 → 被拒");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑨ 离线队列状态机");
{
  let q = createOfflineQueue(3);
  eq(q.baseRev, 3, "createOfflineQueue 锚定 rev");
  q = enqueue(q, "op1", addOp("node", nodeA));
  q = enqueue(q, "op2", addOp("node", nodeB));
  eq(q.pending.length, 2, "两条不同 opId 入队");
  q = enqueue(q, "op1", addOp("node", nodeA));
  eq(q.pending.length, 2, "同 opId 重复入队 → 去重");
  ok(isDirty(q), "有 pending → dirty");
  ok(previewOps(q).length === 2, "previewOps 预览净 op 不改状态");

  const built = buildPatch(q);
  ok(built.flush && built.flush.patch.ops.length === 2 && built.flush.patch.baseRev === 3, "buildPatch 产出净补丁");
  ok(built.state.inflight && built.state.pending.length === 0, "冲刷后 pending 空、inflight 置位");
  const token = built.flush.token;
  eq(token, "flush_3_1_2", "token 由 baseRev+首末 seq 确定性派生");

  const busy = buildPatch(built.state);
  ok(busy.flush === null, "单在途纪律:in-flight 时 buildPatch idle");

  const acked = ack(built.state, token, 4);
  ok(acked.inflight === null && acked.baseRev === 4, "ack 清在途、推进 baseRev");
  ok(ack(built.state, "wrong", 9).inflight !== null, "错 token 的 ack 被忽略");
}
{
  // 抵消:add 后 remove 同实体 → 净空,buildPatch 不上行但清 pending
  let q = createOfflineQueue(0);
  q = enqueue(q, "a1", addOp("node", nodeA));
  q = enqueue(q, "a2", removeOp("node", nodeA));
  const built = buildPatch(q);
  ok(built.flush === null && built.state.pending.length === 0 && built.state.inflight === null, "净空补丁:不上行且消费 pending");
}
{
  // fail 回队重发
  let q = createOfflineQueue(2);
  q = enqueue(q, "f1", addOp("node", nodeA));
  const built = buildPatch(q);
  const failed = queueFail(built.state, built.flush.token);
  ok(failed.inflight === null && failed.pending.length === 1, "fail 把在途放回 pending");
  const rebuilt = buildPatch(failed);
  ok(rebuilt.flush && rebuilt.flush.patch.ops.length === 1, "回队后可再次冲刷重发");
}
{
  // snapshot / restore 往返 + 在途折叠回 pending
  let q = createOfflineQueue(5);
  q = enqueue(q, "s1", addOp("node", nodeA));
  q = enqueue(q, "s2", addOp("node", nodeB));
  const snap = snapshot(q);
  eq(snap.version, OFFLINE_QUEUE_SNAPSHOT_VERSION, "快照带版本");
  const restored = restore(snap);
  ok(restored && restored.pending.length === 2 && restored.baseRev === 5, "restore 往返 pending 一致");

  const built = buildPatch(q);
  const snapInflight = snapshot(built.state);
  ok(snapInflight.inflight && snapInflight.inflight.ops.length === 2, "在途状态可快照");
  const restoredInflight = restore(snapInflight);
  ok(restoredInflight.inflight === null && restoredInflight.pending.length === 2, "restore 把在途折叠回 pending(重发,幂等兜底)");

  ok(restore({ junk: true }) === null, "restore 拒绝损坏快照 → null");
}
{
  // reset 丢弃本地
  let q = createOfflineQueue(1);
  q = enqueue(q, "r1", addOp("node", nodeA));
  const done = reset(q, 7);
  ok(done.pending.length === 0 && done.inflight === null && done.baseRev === 7 && done.seen.length === 0, "reset 丢弃 pending、采纳新 rev、清去重表");
}
{
  // cloneOp 所有权:enqueue / snapshot / restore 三处都深拷贝,双向不串染
  const original = addOp("node", nodeA);
  let q = createOfflineQueue(0);
  q = enqueue(q, "own1", original);
  original.value.position.x = 999; // 改调用方持有的原 op
  ok(q.pending[0].op.value.position.x === 0, "enqueue 克隆:改调用方原 op 不污染队列");

  const snap = snapshot(q);
  q.pending[0].op.value.position.x = 111; // 改 state 内 op 对象
  ok(snap.pending[0].op.value.position.x === 0, "snapshot 深拷贝:改 state op 不污染 snapshot");
  snap.pending[0].op.value.position.y = 777; // 改 snapshot
  ok(q.pending[0].op.value.position.y === 0, "改 snapshot 不反向污染 state");

  const snap2 = snapshot(q);
  const restored = restore(snap2);
  restored.pending[0].op.value.position.x = 555; // 改恢复态
  ok(snap2.pending[0].op.value.position.x === 111, "restore 独立:改恢复态不污染源 snapshot");
  ok(nodeA.position.x === 0, "全程未污染模块级 nodeA(zod parse 已解耦)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑩ D3 快照不变量(OfflineQueueSnapshotSchema superRefine)");
{
  let q = createOfflineQueue(0);
  q = enqueue(q, "sa", addOp("node", nodeA));
  q = enqueue(q, "sb", addOp("node", nodeB));
  const base = snapshot(q); // pending seq 1,2;seq(高水位)=2
  ok(OfflineQueueSnapshotSchema.safeParse(base).success, "正常快照满足不变量");
  ok(
    !OfflineQueueSnapshotSchema.safeParse({ ...base, pending: [base.pending[1], base.pending[0]] }).success,
    "乱序 seq(2,1)→ 拒绝(防 restore 保留错序、coalesce 丢编辑)"
  );
  ok(
    !OfflineQueueSnapshotSchema.safeParse({ ...base, pending: [base.pending[0], { ...base.pending[1], seq: base.pending[0].seq }] }).success,
    "重复 seq → 拒绝"
  );
  ok(
    !OfflineQueueSnapshotSchema.safeParse({ ...base, pending: [base.pending[0], { ...base.pending[1], opId: base.pending[0].opId }] }).success,
    "重复 opId → 拒绝"
  );
  ok(!OfflineQueueSnapshotSchema.safeParse({ ...base, seq: 0 }).success, "snapshot.seq 低于最大 queued seq → 拒绝(高水位回退)");
  ok(restore({ ...base, pending: [base.pending[1], base.pending[0]] }) === null, "restore 乱序快照 → null(不保留错序编辑)");

  let q2 = enqueue(createOfflineQueue(0), "ia", addOp("node", nodeA));
  q2 = enqueue(buildPatch(q2).state, "ib", addOp("node", nodeB)); // inflight seq1 + pending seq2
  const withInflight = snapshot(q2);
  ok(OfflineQueueSnapshotSchema.safeParse(withInflight).success, "inflight(seq1)+pending(seq2)合并递增 → 通过");
  ok(
    !OfflineQueueSnapshotSchema.safeParse({
      ...withInflight,
      inflight: { ...withInflight.inflight, ops: [{ ...withInflight.inflight.ops[0], seq: 9 }] },
    }).success,
    "inflight seq(9) > pending seq(2)→ 合并序非递增拒绝"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n结果:${pass} 通过,${fails.length} 失败`);
if (fails.length) {
  console.log("失败项:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("✅ D3 本地验证全绿");
