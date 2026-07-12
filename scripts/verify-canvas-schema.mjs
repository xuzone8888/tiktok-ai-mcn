/** D2 offline contract verification. Run with: node scripts/verify-canvas-schema.mjs */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasModule } from "./canvas-build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const fails = [];
let pass = 0;

function ok(condition, label) {
  if (condition) {
    pass += 1;
  } else {
    fails.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function noThrow(fn, label) {
  try {
    const result = fn();
    pass += 1;
    return result;
  } catch (error) {
    fails.push(`${label}: ${error.message}`);
    console.log(`  ❌ ${label}: ${error.message}`);
    return null;
  }
}

const m = await loadCanvasModule("schema");
const {
  CANVAS_SCHEMA_VERSION,
  CANVAS_NODE_TYPES,
  NODE_TYPES,
  CanvasIdSchema,
  CanvasPositionSchema,
  CanvasRefsSchema,
  CanvasMediaSchema,
  CanvasNodeDataSchema,
  CanvasNodeSchema,
  CanvasEdgeSchema,
  CanvasGroupSchema,
  CanvasDocSchema,
  CanvasDepsSchema,
  CanvasDocumentEnvelopeSchema,
  CanvasRevisionSchema,
  isOssObjectKey,
  inspectUnsafeCanvasValue,
  validateCanvasDoc,
  validateCanvasDocumentEnvelope,
  createCanvasRefs,
  createEmptyCanvasDeps,
  createEmptyCanvasDoc,
  createCanvasNode,
  createCanvasEdge,
  createCanvasGroup,
  createCanvasDocumentEnvelope,
  migrateDoc,
  loadCanvasDoc,
} = m;

console.log("① 严格领域 schema + envelope");
eq(CANVAS_SCHEMA_VERSION, 1, "schema version = 1");
eq(CANVAS_NODE_TYPES.join(","), "text,image,video,product,script,compose", "6 类节点白名单");
eq(NODE_TYPES, CANVAS_NODE_TYPES, "NODE_TYPES 是同一运行时事实源");
for (const [name, schema] of Object.entries({
  CanvasIdSchema,
  CanvasPositionSchema,
  CanvasRefsSchema,
  CanvasMediaSchema,
  CanvasNodeDataSchema,
  CanvasNodeSchema,
  CanvasEdgeSchema,
  CanvasGroupSchema,
  CanvasDocSchema,
  CanvasDepsSchema,
  CanvasDocumentEnvelopeSchema,
})) {
  ok(schema && typeof schema.safeParse === "function", `${name} 已导出`);
}

const basicNode = { id: "node_1", type: "text", position: { x: 0, y: 0 } };
ok(CanvasNodeSchema.safeParse(basicNode).success, "最小节点可解析并补默认 data/refs/group_id");
ok(!CanvasNodeSchema.safeParse({ ...basicNode, selected: true }).success, "拒 RF selected");
ok(!CanvasNodeSchema.safeParse({ ...basicNode, dragging: false }).success, "拒 RF dragging");
ok(!CanvasNodeSchema.safeParse({ ...basicNode, measured: { width: 1 } }).success, "拒 RF measured");
ok(!CanvasNodeSchema.safeParse({ ...basicNode, width: 100 }).success, "拒 RF width");
ok(
  !CanvasNodeSchema.safeParse({ ...basicNode, position: { x: 0, y: 0, z: 1 } }).success,
  "position strict"
);
ok(
  !CanvasNodeSchema.safeParse({ ...basicNode, data: { refs: createCanvasRefs(), unknown: 1 } }).success,
  "node.data strict"
);
ok(
  !CanvasNodeSchema.safeParse({ ...basicNode, data: { refs: { ...createCanvasRefs(), extra: 1 } } }).success,
  "refs strict"
);
ok(
  !CanvasNodeSchema.safeParse({
    ...basicNode,
    data: { refs: { ...createCanvasRefs(), assetId: "asset_1" } },
  }).success,
  "assetId 必须配 assetTable"
);
ok(
  !CanvasEdgeSchema.safeParse({ id: "e", source: "a", target: "b", selected: true }).success,
  "edge strict"
);
ok(!CanvasGroupSchema.safeParse({ id: "g", node_ids: [], width: 10 }).success, "group strict");
ok(
  !CanvasDocSchema.safeParse({ nodes: [], edges: [], groups: [], schemaVersion: 1 }).success,
  "doc 禁止内嵌 schemaVersion"
);
ok(
  !CanvasDocSchema.safeParse({ nodes: [], edges: [], groups: [], deps: {} }).success,
  "doc 禁止内嵌 deps"
);
ok(
  CanvasDocumentEnvelopeSchema.safeParse({
    schemaVersion: 1,
    doc: { nodes: [], edges: [], groups: [] },
    deps: {},
  }).success,
  "envelope 独立承载 schemaVersion/doc/deps"
);
ok(
  !CanvasDocumentEnvelopeSchema.safeParse({
    schemaVersion: 1,
    doc: { nodes: [], edges: [], groups: [] },
    deps: {},
    selected: true,
  }).success,
  "envelope strict"
);

console.log("② OSS key + params 深层绕过");
ok(isOssObjectKey("studio/u1/a.jpg"), "合法 OSS object key");
for (const bad of [
  "data:image/png;base64,AA",
  "https://media.example/a.jpg",
  "//media.example/a.jpg",
  "/absolute/a.jpg",
  "studio/u/a.jpg?Signature=x",
]) {
  ok(!isOssObjectKey(bad), `拒 media key:${bad.slice(0, 35)}`);
}
ok(
  !CanvasNodeSchema.safeParse({
    ...basicNode,
    type: "image",
    data: { media: { ossKey: "https://media.example/a.jpg" } },
  }).success,
  "media 完整 URL 在结构层拒绝"
);

const docWithParam = (value) => ({
  nodes: [
    {
      ...basicNode,
      data: { params: { nested: { value } } },
    },
  ],
  edges: [],
  groups: [],
});
ok(!validateCanvasDoc(docWithParam("data:image/png;base64,AA")).ok, "params 深层 dataURL 拒绝");
ok(
  !validateCanvasDoc(docWithParam("![preview](data:image/png;base64,AA)")).ok,
  "params 中段/markdown 内嵌 dataURL 拒绝"
);
ok(
  !validateCanvasDoc(
    docWithParam("https://oss.example/a?OSSAccessKeyId=k&Signature=s&Expires=9")
  ).ok,
  "params 深层 OSS 签名 URL 拒绝"
);
ok(
  !validateCanvasDoc(docWithParam("https://oss.example/a?x-oss-signature=s")).ok,
  "params 深层 x-oss 签名 URL 拒绝"
);
ok(
  !validateCanvasDoc(docWithParam("https://oss.example/a?%53ignature=s")).ok,
  "params 深层编码签名键拒绝"
);
ok(
  validateCanvasDoc(docWithParam("https://example.com/a?foo=bar")).ok,
  "普通 URL 允许"
);
ok(
  validateCanvasDoc(docWithParam("Prompt: explain Signature and Expires fields")).ok,
  "普通提示词不因关键字误杀"
);
ok(
  inspectUnsafeCanvasValue({ a: [{ b: "data:text/plain,x" }] }).length === 1,
  "递归扫描数组/对象"
);

console.log("③ fresh factories");
const emptyA = createEmptyCanvasDoc();
const emptyB = createEmptyCanvasDoc();
ok(emptyA !== emptyB, "空文档对象不共享");
ok(emptyA.nodes !== emptyB.nodes && emptyA.edges !== emptyB.edges && emptyA.groups !== emptyB.groups, "空数组不共享");
emptyA.nodes.push(createCanvasNode());
eq(emptyB.nodes.length, 0, "修改一个空文档不污染另一个");
const refsA = createCanvasRefs();
const refsB = createCanvasRefs();
ok(refsA !== refsB, "refs factory 每次返回新对象");
const depsA = createEmptyCanvasDeps();
const depsB = createEmptyCanvasDeps();
ok(depsA !== depsB && depsA.models !== depsB.models, "deps factory 不共享数组");
const nodeA = createCanvasNode({ type: "image", position: { x: 3, y: 4 } });
const nodeB = createCanvasNode();
ok(/^node_[!-~]+$/.test(nodeA.id) && nodeA.id !== nodeB.id, "node 前缀+nanoid 且唯一");
const edgeA = createCanvasEdge({ source: nodeA.id, target: nodeB.id });
ok(/^edge_[!-~]+$/.test(edgeA.id), "edge 前缀+nanoid");
const groupA = createCanvasGroup({ label: "G", nodeIds: [nodeA.id] });
ok(/^group_[!-~]+$/.test(groupA.id), "group 前缀+nanoid");
const envelope = createCanvasDocumentEnvelope();
ok(CanvasDocumentEnvelopeSchema.safeParse(envelope).success, "envelope factory 有效");
ok(!Object.hasOwn(envelope.doc, "schemaVersion") && !Object.hasOwn(envelope.doc, "deps"), "factory 不复制元数据进 doc");
ok(CanvasRevisionSchema.safeParse(0).success && !CanvasRevisionSchema.safeParse(-1).success, "rev CAS 非负整数");

console.log("④ 引用与成组一致性");
const groupedDoc = {
  nodes: [{ ...basicNode, group_id: "g1" }],
  edges: [],
  groups: [{ id: "g1", label: "", node_ids: ["node_1"] }],
};
ok(validateCanvasDoc(groupedDoc).ok, "双向一致成组通过");
ok(
  !validateCanvasDoc({ ...groupedDoc, nodes: [{ ...basicNode, group_id: "missing" }] }).ok,
  "node.group_id 必须指向存在组"
);
ok(
  !validateCanvasDoc({ ...groupedDoc, nodes: [{ ...basicNode, group_id: null }] }).ok,
  "group 列出节点但 node.group_id 为空时拒绝"
);
ok(
  !validateCanvasDoc({ ...groupedDoc, groups: [{ id: "g1", node_ids: [] }] }).ok,
  "node.group_id 有值但 group 未列出时拒绝"
);
ok(
  !validateCanvasDoc({ ...groupedDoc, groups: [{ id: "g1", node_ids: ["node_1", "node_1"] }] }).ok,
  "group.node_ids 重复拒绝"
);
ok(
  !validateCanvasDoc({ ...groupedDoc, groups: [{ id: "g1", node_ids: ["ghost"] }] }).ok,
  "group 悬空成员拒绝"
);
ok(
  !validateCanvasDoc({
    nodes: [basicNode],
    edges: [{ id: "e1", source: "node_1", target: "ghost" }],
    groups: [],
  }).ok,
  "连线悬空端点拒绝"
);

console.log("⑤ 迁移必须保留真实版本语义");
let migrated = migrateDoc({ nodes: [] }, 1, 1);
ok(migrated.complete && migrated.from === 1 && migrated.to === 1, "同版本完成");
const v1to2 = [{ from: 1, to: 2, migrate: (doc) => ({ ...doc, v2: true }) }];
migrated = migrateDoc({ a: 1 }, 1, 2, v1to2);
ok(migrated.complete && migrated.to === 2 && migrated.doc.v2 === true, "连续迁移成功");
migrated = migrateDoc({}, 1, 3, v1to2);
ok(!migrated.complete && migrated.to === 2 && migrated.target === 3, "缺 v2→v3 停在真实 v2");
ok(migrated.notes.some((note) => note.includes("停止在 v2")), "缺步记录明确 issue");
migrated = migrateDoc({}, 1, 3, []);
ok(!migrated.complete && migrated.to === 1, "首步缺失停在 v1,不伪装成功");
migrated = migrateDoc({ future: true }, 5, 1, []);
ok(!migrated.complete && migrated.to === 5 && migrated.from === 5, "高版本保留 v5 语义");
migrated = migrateDoc({}, 1, 2, [{ from: 1, to: 2, migrate: () => { throw new Error("boom"); } }]);
ok(!migrated.complete && migrated.to === 1 && migrated.notes.some((note) => note.includes("boom")), "迁移异常停在真实版本");
const original = { nodes: [{ id: "x" }] };
migrateDoc(original, 1, 2, [{ from: 1, to: 2, migrate: (doc) => { doc.nodes.push({ id: "y" }); return doc; } }]);
eq(original.nodes.length, 1, "迁移不修改调用者原对象");
migrated = migrateDoc({}, Number.NaN, 1);
ok(!migrated.complete && migrated.notes.length > 0, "非法来源版本不宣称完成");

console.log("⑥ 容错加载永不整画布抛错");
const mixed = {
  nodes: [
    { ...basicNode, group_id: "g1" },
    { id: "bad_type", type: "audio", position: { x: 1, y: 1 }, group_id: "g1" },
    { id: "bad id", type: "audio", position: { x: 2, y: 2 } },
    { ...basicNode, position: { x: 3, y: 3 } },
    { id: "rf", type: "text", position: { x: 4, y: 4 }, selected: true },
  ],
  edges: [
    { id: "e1", source: "node_1", target: "bad_type" },
    { id: "e2", source: "node_1", target: "ghost" },
    { id: "bad edge id", source: "node_1", target: "bad_type" },
  ],
  groups: [{ id: "g1", node_ids: ["node_1", "bad_type", "bad_type", "ghost"] }],
};
const loaded = noThrow(() => loadCanvasDoc(mixed), "混合坏档不抛");
ok(loaded && loaded.nodes.length === 1, "合法节点保留");
ok(loaded && loaded.brokenNodes.length === 4, "未知/非法/重复/RF 污染逐节点降级");
ok(loaded && loaded.edges.some((edge) => edge.id === "e1"), "指向安全坏节点占位符的连线保留");
ok(loaded && loaded.brokenEdges.length === 2, "悬空/非法 edge 逐条降级");
ok(loaded && loaded.groups[0].node_ids.length === 2, "成组成员去重并清悬空");
ok(loaded && loaded.recoveryRequired, "存在 broken 实体时明确要求恢复,禁止直接 autosave");
ok(loaded && loaded.brokenNodes.every((node) => CanvasIdSchema.safeParse(node.id).success), "broken node id 全部 RF 安全");
ok(loaded && loaded.brokenEdges.every((edge) => CanvasIdSchema.safeParse(edge.id).success), "broken edge id 全部 RF 安全");
ok(loaded && loaded.issues.some((issue) => issue.includes("去重成员")), "容错修复有 issue");

const repair = loadCanvasDoc({
  nodes: [basicNode],
  edges: [],
  groups: [{ id: "g1", node_ids: ["node_1"] }],
});
eq(repair.nodes[0].group_id, "g1", "读路径修复 group list→node.group_id");
ok(repair.issues.some((issue) => issue.includes("修复 group_id")), "成组修复记录 issue");
ok(!repair.recoveryRequired, "仅可逆成组归一且无 broken 时无需阻断保存");

const unsafeLoaded = loadCanvasDoc(docWithParam("![x](data:image/png;base64,AA)"));
ok(unsafeLoaded.brokenNodes.length === 1, "读路径也把 params 内嵌 dataURL 降级为 broken 节点");
ok(unsafeLoaded.recoveryRequired, "读路径危险 params 触发恢复态");

const getterNode = {
  id: "getter",
  type: "text",
  get position() {
    throw new Error("getter exploded");
  },
};
const getterLoaded = noThrow(() => loadCanvasDoc({ nodes: [getterNode] }), "恶意 getter 不抛");
ok(getterLoaded && getterLoaded.brokenNodes.length === 1, "恶意 getter 降级坏节点");
const rootProxy = new Proxy({}, { get() { throw new Error("root exploded"); } });
ok(noThrow(() => loadCanvasDoc(rootProxy), "恶意根对象不抛") !== null, "恶意根对象返回结构");
for (const garbage of [null, undefined, 0, "x", [], { nodes: "bad" }]) {
  const result = noThrow(() => loadCanvasDoc(garbage), `垃圾输入不抛:${String(garbage)}`);
  ok(result && Array.isArray(result.nodes) && Array.isArray(result.issues), "垃圾输入返回完整结构");
}
const future = loadCanvasDoc({ nodes: [], edges: [], groups: [] }, 5);
ok(
  future.schemaVersion === 5 && !future.migrationComplete && future.recoveryRequired,
  "高版本加载不谎报为 v1 且阻断 autosave"
);

console.log("⑦ envelope 写校验 + 源文件卫生");
ok(
  validateCanvasDocumentEnvelope({
    schemaVersion: 1,
    doc: { nodes: [], edges: [], groups: [] },
    deps: {},
  }).ok,
  "合法 envelope 写校验通过"
);
ok(
  !validateCanvasDocumentEnvelope({
    schemaVersion: 1,
    doc: docWithParam("data:image/png;base64,AA"),
    deps: {},
  }).ok,
  "envelope 不绕过 doc 深层安全校验"
);
const schemaSource = readFileSync(join(ROOT, "src", "lib", "canvas", "schema.ts"), "utf8");
ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(schemaSource), "schema.ts 无 NUL/控制字节");
ok(!schemaSource.includes("EMPTY_CANVAS_DOC"), "移除共享可变 EMPTY_CANVAS_DOC");

console.log(`\n结果:${pass} 通过,${fails.length} 失败`);
if (fails.length) {
  console.log("失败项:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("✅ D2 本地验证全绿");
