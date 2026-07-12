#!/usr/bin/env node
/**
 * 超级画布 · S1 壳聚焦验证(离线,零测试运行器)
 *
 * 复用 scripts/canvas-build.mjs 的剥类型载入器,断言三处 S1 核心纯逻辑:
 *   ① rf-adapter:领域↔React Flow 投影 + 位置回写「只取 position、剥离视图字段」;
 *   ② canvas-store:装载/恢复(recoveryRequired 阻断 autosave)、位置回写、视图开关;
 *   ③ canvas-shortcuts:视图快捷键匹配,且变更类按键(S4)刻意不匹配。
 *
 * 运行:node scripts/verify-canvas-s1.mjs   (失败退出码 1)
 * 只剥类型不做类型检查——类型正确性由 `npx tsc --noEmit` 单独把关。
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

/** 给相对 import 补 .mjs 扩展(与 canvas-build.mjs 同规则)。 */
function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, pre, q1, spec, q2) =>
      /\.[a-z]+$/i.test(spec) ? m : `${pre}${q1}${spec}.mjs${q2}`
  );
}

/** 剥类型载入 src/lib/canvas 之外的 TS 文件,并把 `@/...` 说明符改写成同目录 .mjs。 */
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
  // 先落 store 依赖的全部 lib/canvas 模块(schema→patch→history→group-ops→rf-adapter),供 store
  // 改写后的相对 import 解析。S4 起 store 新增依赖 history/group-ops,旧 loader 必须一并编译+改写,
  // 否则 '@/lib/canvas/history' 被当包解析 → ERR_MODULE_NOT_FOUND。
  const schema = await loadCanvasModule("schema");
  await loadCanvasModule("patch");
  await loadCanvasModule("history");
  await loadCanvasModule("group-ops");
  const adapter = await loadCanvasModule("rf-adapter");
  const shortcuts = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-shortcuts.ts"),
    "canvas-shortcuts.mjs"
  );
  const storeMod = await loadExtra(
    join(ROOT, "src", "stores", "canvas-store.ts"),
    "canvas-store.mjs",
    {
      "@/lib/canvas/schema": "./schema.mjs",
      "@/lib/canvas/rf-adapter": "./rf-adapter.mjs",
      "@/lib/canvas/history": "./history.mjs",
      "@/lib/canvas/group-ops": "./group-ops.mjs",
    }
  );

  const { createCanvasNode, createEmptyCanvasDoc } = schema;
  const {
    toReactFlowNode,
    toReactFlowNodes,
    toReactFlowEdges,
    reconcileReactFlowNodes,
    reconcileReactFlowEdges,
    collectNodePositionUpdates,
    applyNodePositionUpdates,
  } = adapter;
  const { matchCanvasShortcut, CANVAS_VIEW_SHORTCUTS } = shortcuts;
  const { useCanvasStore, isCanvasAutosaveBlocked } = storeMod;

  // ------------------------------------------------------------------ ①
  console.log("① rf-adapter:投影 + 位置回写剥离视图字段");
  const node = createCanvasNode({ type: "text", position: { x: 4, y: 8 } });
  const [rfNode] = toReactFlowNodes([node]);
  eq(
    Object.keys(rfNode).sort(),
    ["data", "id", "position", "type"],
    "投影节点只含 id/type/position/data(无 group_id/视图字段)"
  );
  ok(!("group_id" in rfNode), "投影节点不含 group_id(S4 才接 parentId)");
  eq(rfNode.type, "text", "投影保留 type");

  const [rfEdgeHidden] = toReactFlowEdges(
    [{ id: "e1", source: "a", target: "b", sourceHandle: null, targetHandle: null }],
    { hidden: true }
  );
  eq(rfEdgeHidden.hidden, true, "隐藏连线开关注入 hidden=true");
  const [rfEdgeShown] = toReactFlowEdges(
    [{ id: "e1", source: "a", target: "b", sourceHandle: null, targetHandle: null }],
    { hidden: false }
  );
  eq(rfEdgeShown.hidden, false, "显示连线时 hidden=false");

  const updates = collectNodePositionUpdates([
    { type: "position", id: "n1", position: { x: 32, y: 48 }, dragging: false },
    { type: "position", id: "n2", position: { x: Number.NaN, y: 0 } },
    { type: "select", id: "n1", selected: true },
    { type: "dimensions", id: "n1", dimensions: { width: 120, height: 60 } },
    { type: "remove", id: "n3" },
  ]);
  eq(updates.length, 1, "位置回写只保留合法 position(丢弃 NaN/select/dimensions/remove)");
  eq(updates[0], { id: "n1", position: { x: 32, y: 48 } }, "位置回写值正确");

  const moved = applyNodePositionUpdates([node], [{ id: node.id, position: { x: 99, y: 1 } }]);
  eq(moved[0].position, { x: 99, y: 1 }, "applyNodePositionUpdates 改 position");
  eq(moved[0].type, node.type, "applyNodePositionUpdates 不动其它字段");
  const sameRefInput = [node];
  ok(
    applyNodePositionUpdates(sameRefInput, []) === sameRefInput,
    "空更新短路:返回原数组引用"
  );

  // 领域 → 视图 reconcile:领域为真相,保留上一帧视图字段
  const domainNode = createCanvasNode({ type: "text", position: { x: 0, y: 0 } });
  const prevView = [
    {
      ...toReactFlowNode(domainNode),
      position: { x: 0, y: 0 },
      selected: true,
      dragging: true,
      measured: { width: 120, height: 40 },
      width: 120,
      height: 40,
    },
  ];
  const movedDomain = [
    { ...domainNode, position: { x: 96, y: 48 }, data: { ...domainNode.data, title: "moved" } },
  ];
  const reconciled = reconcileReactFlowNodes(prevView, movedDomain);
  eq(reconciled[0].position, { x: 96, y: 48 }, "reconcile:领域 position 为真相(覆盖上一帧)");
  eq(reconciled[0].data.title, "moved", "reconcile:领域 data 为真相");
  eq(reconciled[0].selected, true, "reconcile:保留视图 selected");
  eq(reconciled[0].dragging, true, "reconcile:保留视图 dragging");
  eq(reconciled[0].measured, { width: 120, height: 40 }, "reconcile:保留视图 measured");
  const fresh = reconcileReactFlowNodes([], [domainNode]);
  ok(!("selected" in fresh[0]), "reconcile:领域新增节点为纯投影(无视图字段)");
  ok(!("measured" in fresh[0]), "reconcile:领域新增节点无 measured");

  const domainEdge = { id: "e1", source: "a", target: "b", sourceHandle: null, targetHandle: null };
  const recEdges = reconcileReactFlowEdges(
    [{ ...domainEdge, selected: true }],
    [domainEdge],
    { hidden: true }
  );
  eq(recEdges[0].hidden, true, "reconcile edges:注入 hidden");
  eq(recEdges[0].selected, true, "reconcile edges:保留 selected");

  // ------------------------------------------------------------------ ②
  console.log("② canvas-store:装载/恢复/回写/开关");
  const store = useCanvasStore.getState();
  store.reset();
  eq(useCanvasStore.getState().snapToGrid, true, "默认开启网格吸附");
  eq(useCanvasStore.getState().minimapCollapsed, true, "默认收起小地图(1366×768 条款)");
  ok(isCanvasAutosaveBlocked(useCanvasStore.getState()), "未装载时 autosave 阻断");

  useCanvasStore.getState().hydrateFromDoc(createEmptyCanvasDoc());
  ok(useCanvasStore.getState().hydrated, "空文档 hydrate 后 hydrated=true");
  ok(!useCanvasStore.getState().recoveryRequired, "干净空文档不需恢复");
  ok(!isCanvasAutosaveBlocked(useCanvasStore.getState()), "装载且干净时 autosave 放行");

  const good = createCanvasNode({ type: "image", position: { x: 0, y: 0 } });
  const brokenDoc = {
    nodes: [good, { id: "bad", type: "not-a-type", position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
  };
  useCanvasStore.getState().hydrateFromDoc(brokenDoc);
  eq(useCanvasStore.getState().nodes.length, 1, "坏档:合法节点保留");
  eq(useCanvasStore.getState().brokenNodes.length, 1, "坏档:非法节点入 brokenNodes(交 S3)");
  ok(useCanvasStore.getState().recoveryRequired, "坏档:recoveryRequired=true");
  ok(
    isCanvasAutosaveBlocked(useCanvasStore.getState()),
    "坏档必须阻断 autosave(技术负责人硬约束)"
  );

  // 位置回写 + 视图字段绝不进领域节点
  useCanvasStore.getState().hydrateFromDoc({ nodes: [good], edges: [], groups: [] });
  const id = useCanvasStore.getState().nodes[0].id;
  useCanvasStore.getState().applyNodePositionChanges([
    { type: "position", id, position: { x: 64, y: 16 } },
    { type: "select", id, selected: true },
    { type: "dimensions", id, dimensions: { width: 200, height: 90 } },
  ]);
  const persisted = useCanvasStore.getState().nodes[0];
  eq(persisted.position, { x: 64, y: 16 }, "store 位置回写生效");
  const RF_VIEW_FIELDS = [
    "selected",
    "dragging",
    "measured",
    "width",
    "height",
    "positionAbsolute",
    "dimensions",
    "handles",
    "parentId",
  ];
  const leaked = RF_VIEW_FIELDS.filter((field) => field in persisted);
  eq(leaked, [], "领域节点绝不含 React Flow 视图字段(selected/measured/dimensions 等)");
  ok(
    ["id", "type", "position", "data"].every((field) => field in persisted),
    "领域节点保留 id/type/position/data"
  );

  // 只读时忽略回写
  useCanvasStore.getState().setReadOnly(true);
  useCanvasStore.getState().applyNodePositionChanges([
    { type: "position", id, position: { x: 500, y: 500 } },
  ]);
  eq(useCanvasStore.getState().nodes[0].position, { x: 64, y: 16 }, "只读时忽略位置回写");
  ok(isCanvasAutosaveBlocked(useCanvasStore.getState()), "只读时 autosave 阻断");
  useCanvasStore.getState().setReadOnly(false);

  // 视图开关
  const before = useCanvasStore.getState().edgesHidden;
  useCanvasStore.getState().toggleEdgesHidden();
  eq(useCanvasStore.getState().edgesHidden, !before, "隐藏连线开关翻转");
  useCanvasStore.getState().setMinimapCollapsed(false);
  eq(useCanvasStore.getState().minimapCollapsed, false, "小地图展开");

  // initializeEmptyDoc:已 hydrated 不被空档覆盖 / 未 hydrated 才初始化
  useCanvasStore.getState().reset();
  const seeded = createCanvasNode({ type: "video", position: { x: 5, y: 5 } });
  useCanvasStore.getState().hydrateFromDoc({ nodes: [seeded], edges: [], groups: [] });
  const seededId = useCanvasStore.getState().nodes[0].id;
  useCanvasStore.getState().initializeEmptyDoc();
  eq(useCanvasStore.getState().nodes.length, 1, "initializeEmptyDoc:已 hydrated 不被空档覆盖");
  eq(useCanvasStore.getState().nodes[0].id, seededId, "initializeEmptyDoc:服务端文档原样保留");
  useCanvasStore.getState().reset();
  ok(!useCanvasStore.getState().hydrated, "reset 后未 hydrated");
  useCanvasStore.getState().initializeEmptyDoc();
  ok(useCanvasStore.getState().hydrated, "initializeEmptyDoc:未 hydrated 时初始化为空档");
  eq(useCanvasStore.getState().nodes.length, 0, "initializeEmptyDoc:空档节点为空");

  // ------------------------------------------------------------------ ③
  console.log("③ canvas-shortcuts:视图键匹配 + S4 变更/缩放键不匹配");
  eq(matchCanvasShortcut({ key: "0", ctrlKey: true }), "fit-view", "Ctrl+0 → fit-view(S1)");
  eq(matchCanvasShortcut({ key: "0", metaKey: true }), "fit-view", "⌘+0 → fit-view(S1)");
  eq(matchCanvasShortcut({ key: "=", ctrlKey: true }), null, "Ctrl+=(缩放)不匹配(S4 看板#22)");
  eq(matchCanvasShortcut({ key: "+", ctrlKey: true }), null, "Ctrl++(缩放)不匹配(S4)");
  eq(matchCanvasShortcut({ key: "-", metaKey: true }), null, "⌘+-(缩放)不匹配(S4)");
  eq(matchCanvasShortcut({ key: "_", ctrlKey: true }), null, "Ctrl+_(缩放)不匹配(S4)");
  eq(matchCanvasShortcut({ key: "?" }), "toggle-shortcuts", "? → 面板");
  eq(
    matchCanvasShortcut({ key: "/", shiftKey: true }),
    "toggle-shortcuts",
    "Shift+/ → 面板"
  );
  eq(matchCanvasShortcut({ key: "a" }), null, "普通键不匹配");
  eq(matchCanvasShortcut({ key: "z", ctrlKey: true }), null, "Ctrl+Z(撤销)不匹配(S4 接缝)");
  eq(matchCanvasShortcut({ key: "d", ctrlKey: true }), null, "Ctrl+D(复制)不匹配(S4 接缝)");
  eq(CANVAS_VIEW_SHORTCUTS.length, 4, "面板列 4 条已生效键(Space/Ctrl+0/Alt+Shift+F 整理/?;缩放键归 S4 不列)");

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S1 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S1 壳聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
