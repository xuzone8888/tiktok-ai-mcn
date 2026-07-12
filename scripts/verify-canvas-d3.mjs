/** D3 offline contract verification. Run with: node scripts/verify-canvas-d3.mjs
 *
 * 脱离数据库直测补丁协议纯核心:幂等重放 / 重叠 409 / 非重叠 rebase / 引用完整性 /
 * RF+URL 攻击 / 体积边界,以及离线队列状态机(opId 去重 / coalesce / buildPatch /
 * ack / fail / snapshot / restore)。IO(鉴权/RLS/CAS 写)由 route 承接,不在此测。
 */
import { loadCanvasModule } from "./canvas-build.mjs";

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
const helpers = await loadCanvasModule("api-helpers");

const {
  createCanvasNode,
  createCanvasEdge,
  createCanvasGroup,
  createCanvasRefs,
  createEmptyCanvasDoc,
  createEmptyCanvasDeps,
  CanvasDocSchema,
  CanvasDocumentEnvelopeSchema,
  loadCanvasDoc,
} = schema;
const { DOC_BYTES_HARD_LIMIT, DOC_JSONB_WARN_LIMIT } = docLimits;
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
  buildSizeWarning,
  sanitizeCanvasTitle,
  recoveryReport,
  tolerantEnvelope,
  parseStoredDeps,
  parseDepsForTransport,
  CanvasCreateRequestSchema,
  CanvasPatchBodySchema,
} = helpers;

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
console.log("⑦ POST / PATCH 请求体严格契约");
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

// PATCH 顶层第一阶段:严格 known-key + title≤200;ops 结构留第二阶段(INVALID_OPS)。
ok(CanvasPatchBodySchema.safeParse({ baseRev: 0 }).success, "PATCH baseRev 即合法(ops 可选)");
ok(CanvasPatchBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {} }).success, "PATCH 全字段合法");
ok(CanvasPatchBodySchema.safeParse({ baseRev: 0, ops: "notarray" }).success, "PATCH 顶层不校验 ops 结构(留第二阶段 INVALID_OPS)");
ok(!CanvasPatchBodySchema.safeParse({}).success, "PATCH 缺 baseRev 被拒(→INVALID_BODY)");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: -1 }).success, "PATCH baseRev 负数被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 1.5 }).success, "PATCH baseRev 非整被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, title: "z".repeat(201) }).success, "PATCH title 超长 → INVALID_BODY(不截断)");
ok(!CanvasPatchBodySchema.safeParse([]).success, "PATCH 数组体被拒");
ok(!CanvasPatchBodySchema.safeParse("x").success, "PATCH 基元体被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, foo: 1 }).success, "PATCH 未知顶层字段被拒");
ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, deps: { models: [123] } }).success, "PATCH deps 非法被拒");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧ 离线队列状态机");
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
console.log("⑨ D3 快照不变量(OfflineQueueSnapshotSchema superRefine)");
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
