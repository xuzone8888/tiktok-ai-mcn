#!/usr/bin/env node
/**
 * 超级画布 · S3 聚焦验证(离线,零测试运行器)
 *
 * 断言:① 六类白名单 + broken 分离;② 文本编辑 updateNodeData(校验/危险值/只读);
 * ③ removeNode 级联 edges + group 完整性 + 只读;④ broken 投影 + 显式删除 + recoveryRequired
 * 重算;⑤ RF 视图字段不泄漏;⑥ S2 五入口/原子连线不回归。
 *
 * 运行:node scripts/verify-canvas-s3.mjs   (失败退出码 1)
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, ".temp", "canvas-verify-build");
const ts = require("typescript");

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — 期望 ${JSON.stringify(expected)},实得 ${JSON.stringify(actual)}`
  );
}

function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, pre, q1, spec, q2) =>
      /\.[a-z]+$/i.test(spec) ? m : `${pre}${q1}${spec}.mjs${q2}`
  );
}

async function loadExtra(absPath, outName, rewrites = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  const source = readFileSync(absPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: absPath,
  });
  let code = addExt(outputText);
  for (const [from, to] of Object.entries(rewrites)) code = code.split(from).join(to);
  const outPath = join(OUT_DIR, outName);
  writeFileSync(outPath, code, "utf8");
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
}

async function main() {
  // store(S4 起)依赖 history/group-ops:必须一并编译并改写,否则 '@/lib/canvas/history' 当包解析报错。
  const schema = await loadCanvasModule("schema");
  await loadCanvasModule("patch");
  await loadCanvasModule("history");
  await loadCanvasModule("group-ops");
  const adapter = await loadCanvasModule("rf-adapter");
  writeFileSync(
    join(OUT_DIR, "api-helpers-store-stub.mjs"),
    "export const CANVAS_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;\n",
    "utf8"
  );
  const storeMod = await loadExtra(
    join(ROOT, "src", "stores", "canvas-store.ts"),
    "canvas-store.mjs",
    {
      "@/lib/canvas/schema": "./schema.mjs",
      "@/lib/canvas/rf-adapter": "./rf-adapter.mjs",
      "@/lib/canvas/history": "./history.mjs",
      "@/lib/canvas/group-ops": "./group-ops.mjs",
      "@/lib/canvas/api-helpers": "./api-helpers-store-stub.mjs",
    }
  );

  const { NODE_TYPES, createCanvasNode, createCanvasEdge, createCanvasGroup, validateCanvasDoc } =
    schema;
  const { toBrokenReactFlowNodes, BROKEN_NODE_TYPE } = adapter;
  const { useCanvasStore, computeRecoveryRequired } = storeMod;
  const store = () => useCanvasStore.getState();
  const hydrate = () => {
    store().reset();
    store().initializeEmptyDoc();
  };

  // ------------------------------------------------------------------ ①
  console.log("① 六类白名单 + broken 分离");
  eq(NODE_TYPES.length, 6, "白名单 6 类");
  eq(
    [...NODE_TYPES].sort(),
    ["compose", "image", "product", "script", "text", "video"],
    "白名单内容"
  );
  eq(BROKEN_NODE_TYPE, "__broken", "broken RF 视图类型");
  ok(!NODE_TYPES.includes(BROKEN_NODE_TYPE), "broken 不在领域白名单");

  // ------------------------------------------------------------------ ②
  console.log("② 文本编辑 updateNodeData:校验 / 危险值 / 只读");
  hydrate();
  const t = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  ok(store().updateNodeData(t, { title: "hello world" }) === true, "写入 title");
  eq(store().nodes.find((n) => n.id === t)?.data?.title, "hello world", "title 落库");
  ok(store().updateNodeData(t, { title: "x".repeat(2001) }) === false, "title>2000 拒");
  eq(store().nodes.find((n) => n.id === t)?.data?.title, "hello world", "拒后 title 不变");
  ok(
    store().updateNodeData(t, { title: "data:image/png;base64,AAAA" }) === false,
    "title 含 dataURL 拒"
  );
  eq(store().nodes.find((n) => n.id === t)?.data?.title, "hello world", "拒 dataURL 后不变");
  store().setReadOnly(true);
  ok(store().updateNodeData(t, { title: "nope" }) === false, "只读时拒");
  store().setReadOnly(false);
  ok(store().updateNodeData("ghost", { title: "x" }) === false, "节点不存在拒");

  // ------------------------------------------------------------------ ③
  console.log("③ removeNode 级联 edges + group 完整性 + 只读");
  hydrate();
  const a = createCanvasNode({ id: "na", type: "text", position: { x: 0, y: 0 }, groupId: "gg" });
  const b = createCanvasNode({ id: "nb", type: "text", position: { x: 10, y: 0 }, groupId: "gg" });
  const c = createCanvasNode({ id: "nc", type: "text", position: { x: 20, y: 0 } });
  const grp = createCanvasGroup({ id: "gg", label: "grp", nodeIds: ["na", "nb"] });
  const eab = createCanvasEdge({ id: "eab", source: "na", target: "nb" });
  const ebc = createCanvasEdge({ id: "ebc", source: "nb", target: "nc" });
  store().hydrateFromDoc({ nodes: [a, b, c], edges: [eab, ebc], groups: [grp] });
  eq(store().nodes.length, 3, "装载 3 节点");
  eq(store().edges.length, 2, "装载 2 边");
  eq(store().groups[0].node_ids, ["na", "nb"], "装载 group 成员");

  store().removeNode("na");
  eq(store().nodes.map((n) => n.id).sort(), ["nb", "nc"], "删 na 后剩 nb,nc");
  eq(store().edges.map((e) => e.id), ["ebc"], "级联删 eab,留 ebc");
  eq(store().groups[0].node_ids, ["nb"], "group.node_ids 移除 na");
  eq(store().nodes.find((n) => n.id === "nb")?.group_id, "gg", "nb.group_id 保持一致");
  const integrity = validateCanvasDoc({
    nodes: store().nodes,
    edges: store().edges,
    groups: store().groups,
  });
  ok(integrity.ok === true, `删后文档仍通过 schema 完整性校验(${integrity.errors.join("; ")})`);

  store().setReadOnly(true);
  store().removeNode("nb");
  eq(store().nodes.length, 2, "只读时不删");
  store().setReadOnly(false);

  // ------------------------------------------------------------------ ④
  console.log("④ broken 投影 + 显式删除 + recoveryRequired 重算");
  hydrate();
  const valid = createCanvasNode({ id: "ok1", type: "text", position: { x: 0, y: 0 } });
  const rawDoc = {
    nodes: [valid, { id: "bad1", type: "nope", position: { x: 5, y: 7 } }],
    edges: [],
    groups: [],
  };
  store().hydrateFromDoc(rawDoc);
  eq(store().nodes.length, 1, "合法节点入领域");
  eq(store().nodes[0].id, "ok1", "领域不含 bad");
  eq(store().brokenNodes.length, 1, "非法入 brokenNodes");
  ok(store().recoveryRequired === true, "recoveryRequired=true");
  const bid = store().brokenNodes[0].id;
  ok(!store().nodes.some((n) => n.id === bid), "领域 nodes 不含 broken");

  const rf = toBrokenReactFlowNodes(store().brokenNodes);
  eq(rf[0].type, BROKEN_NODE_TYPE, "投影 type=__broken");
  eq(rf[0].data.rawType, "nope", "投影 rawType");
  ok(Array.isArray(rf[0].data.issues), "投影 issues 数组");
  eq(rf[0].position, { x: 5, y: 7 }, "投影 position 用原始坐标");
  ok(rf[0].draggable === false && rf[0].connectable === false, "broken 不可拖/连");

  store().removeBrokenNode(bid);
  eq(store().brokenNodes.length, 0, "显式删除后清空");
  ok(store().recoveryRequired === false, "删除后 recoveryRequired 重算为 false");

  store().hydrateFromDoc(rawDoc);
  store().setReadOnly(true);
  store().removeBrokenNode(store().brokenNodes[0].id);
  eq(store().brokenNodes.length, 1, "只读时不删 broken");
  store().setReadOnly(false);

  ok(computeRecoveryRequired(true, [], []) === false, "recovery:全净→false");
  ok(computeRecoveryRequired(true, [{}], []) === true, "recovery:有 broken 节点→true");
  ok(computeRecoveryRequired(true, [], [{}]) === true, "recovery:有 broken 边→true");
  ok(computeRecoveryRequired(false, [], []) === true, "recovery:迁移未完→true");

  // broken + 关联 edge + group member:D2 容错保留这些引用;删除必须级联清理,删后严格校验通过。
  hydrate();
  const goodNode = createCanvasNode({ id: "good", type: "text", position: { x: 0, y: 0 } });
  store().hydrateFromDoc({
    nodes: [goodNode, { id: "bad", type: "nope", position: { x: 5, y: 5 } }],
    edges: [{ id: "e_gb", source: "good", target: "bad", sourceHandle: null, targetHandle: null }],
    groups: [{ id: "grp", label: "", node_ids: ["good", "bad"] }],
  });
  const brokenRefId = store().brokenNodes[0].id;
  eq(store().brokenNodes.length, 1, "broken:1 个损坏节点");
  ok(store().edges.some((e) => e.target === brokenRefId), "容错保留指向 broken 的 edge");
  ok(store().groups[0].node_ids.includes(brokenRefId), "容错保留 broken 的 group 成员");

  // 只读:brokenNodes / edge / group member 三者都不变
  store().setReadOnly(true);
  store().removeBrokenNode(brokenRefId);
  eq(store().brokenNodes.length, 1, "只读:brokenNodes 不变");
  ok(store().edges.some((e) => e.target === brokenRefId), "只读:关联 edge 不变");
  ok(store().groups[0].node_ids.includes(brokenRefId), "只读:group 成员不变");
  store().setReadOnly(false);

  // 删除:级联清悬空 edge + group member,domain nodes 不动,删后文档严格通过校验。
  store().removeBrokenNode(brokenRefId);
  eq(store().brokenNodes.length, 0, "删后 brokenNodes 清空");
  ok(
    !store().edges.some((e) => e.source === brokenRefId || e.target === brokenRefId),
    "级联删除指向 broken 的悬空 edge"
  );
  ok(
    !store().groups.some((g) => g.node_ids.includes(brokenRefId)),
    "从 group.node_ids 移除 broken 成员"
  );
  eq(store().nodes.map((n) => n.id), ["good"], "domain nodes 不动");
  ok(store().recoveryRequired === false, "删后 recoveryRequired 重算 false");
  const strict = validateCanvasDoc({
    nodes: store().nodes,
    edges: store().edges,
    groups: store().groups,
  });
  ok(strict.ok === true, `删 broken 后 domain 文档严格通过校验(${strict.errors.join("; ")})`);

  // ------------------------------------------------------------------ ⑤
  console.log("⑤ RF 视图字段不泄漏进 store");
  hydrate();
  const n = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().updateNodeData(n, { title: "x" });
  store().applyNodePositionChanges([
    { type: "position", id: n, position: { x: 9, y: 9 } },
    { type: "select", id: n, selected: true },
    { type: "dimensions", id: n, dimensions: { width: 1, height: 1 } },
  ]);
  const node = store().nodes.find((x) => x.id === n);
  const RF_VIEW = ["selected", "dragging", "measured", "width", "height", "dimensions", "positionAbsolute"];
  eq(RF_VIEW.filter((k) => k in node), [], "领域节点无 RF 视图字段");
  ok(!("selected" in node.data), "node.data 无 RF 视图字段");

  // ------------------------------------------------------------------ ⑥
  console.log("⑥ S2 五入口/原子连线不回归");
  hydrate();
  const s1 = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const s2 = store().addNode({ type: "image", position: { x: 100, y: 0 } });
  ok(typeof store().addEdge({ source: s1, target: s2 }) === "string", "addEdge 不回归");
  const rr = store().addNodeAndEdge({
    node: { type: "text", position: { x: 9, y: 9 } },
    fromNodeId: s1,
    fromHandleId: null,
    fromHandleType: "source",
  });
  ok(rr && typeof rr.nodeId === "string" && typeof rr.edgeId === "string", "addNodeAndEdge 不回归");

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S3 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S3 聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
