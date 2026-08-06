#!/usr/bin/env node
/**
 * 超级画布 · S4 聚焦验证(离线,零测试运行器)
 *
 * 断言 S4「成组 + 快捷键全套 + undo/redo」的纯逻辑与 store 契约:
 *   ① 命令快捷键匹配 + 焦点/IME/修饰键/只读守卫(matchCanvasCommand / isViewCommand / decideCanvasCommand);
 *   ② 成组/解组 strict 双向一致 + 重复/跨组/readOnly;
 *   ③ 复制:Ctrl+D 内部边映射 + Alt/Ctrl+Alt(带线开关/落点)+ 新 id/group_id 置空/无 RF 泄漏;
 *   ④ undo/redo:forward/inverse、redo 清空、容量上限、拖动合并成一项、非法 apply 原子失败、readOnly 拦截;
 *   ⑤ 文本编辑会话:同节点连续输入只一项、失焦 undo/redo 正确、非法不入栈、切 node 先提交;
 *   ⑥ 组框投影 projectGroupFrames(纯视图、非交互、bbox);
 *   ⑦ S1–S3/S5 不回归。
 *
 * 运行:node scripts/verify-canvas-s4.mjs   (失败退出码 1)
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

const CANVAS = join(ROOT, "src", "components", "canvas");
const LIB_REWRITES = {
  "@/lib/canvas/schema": "./schema.mjs",
  "@/lib/canvas/rf-adapter": "./rf-adapter.mjs",
  "@/lib/canvas/history": "./history.mjs",
  "@/lib/canvas/group-ops": "./group-ops.mjs",
  "@/lib/canvas/api-helpers": "./api-helpers-store-stub.mjs",
};

/** 事件工厂:补齐全部修饰键默认值。 */
function keyEvent(over) {
  return { key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over };
}

async function main() {
  // 依赖链:schema → patch → history → group-ops → rf-adapter,再 store 与组件纯模块。
  const schema = await loadCanvasModule("schema");
  await loadCanvasModule("patch");
  const history = await loadCanvasModule("history");
  const groupOps = await loadCanvasModule("group-ops");
  const rfAdapter = await loadCanvasModule("rf-adapter");
  writeFileSync(
    join(OUT_DIR, "api-helpers-store-stub.mjs"),
    "export const CANVAS_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;\n",
    "utf8"
  );
  const storeMod = await loadExtra(
    join(ROOT, "src", "stores", "canvas-store.ts"),
    "canvas-store.mjs",
    LIB_REWRITES
  );
  const command = await loadExtra(join(CANVAS, "canvas-command-shortcuts.ts"), "canvas-command-shortcuts.mjs");
  const groupFrame = await loadExtra(join(CANVAS, "group-frame.ts"), "group-frame.mjs", LIB_REWRITES);
  const viewShortcuts = await loadExtra(join(CANVAS, "canvas-shortcuts.ts"), "canvas-shortcuts.mjs");

  const { createCanvasNode, createCanvasEdge, validateCanvasDoc, NODE_TYPES } = schema;
  const {
    CANVAS_HISTORY_LIMIT,
    cloneCanvasEntity,
    diffDocs,
    makeHistoryEntry,
    makeNodeUpdateEntry,
    applyOpsToDoc,
    pushHistory,
    createEmptyHistory,
  } = history;
  const { planGroupNodes, planUngroupNodes, planDuplicate } = groupOps;
  const {
    matchCanvasCommand,
    isViewCommand,
    decideCanvasCommand,
    CANVAS_COMMAND_SHORTCUTS,
    shouldSuppressCanvasNodeChanges,
    clearCanvasDraggingFlags,
    hasTerminalCanvasDragFrame,
    isCanvasViewOnlyNodeChange,
  } = command;
  const { toReactFlowNodes, reconcileReactFlowNodes } = rfAdapter;
  const { projectGroupFrames, GROUP_FRAME_TYPE, GROUP_FRAME_ID_PREFIX, groupFrameNodeId } = groupFrame;
  const { matchCanvasShortcut, CANVAS_VIEW_SHORTCUTS } = viewShortcuts;
  const { useCanvasStore, canAddCanvasEdge, computeRecoveryRequired, isCanvasAutosaveBlocked } = storeMod;

  const store = () => useCanvasStore.getState();
  const hydrate = () => {
    store().reset();
    store().initializeEmptyDoc();
  };
  const docOf = () => ({ nodes: store().nodes, edges: store().edges, groups: store().groups });
  const node = (id) => store().nodes.find((n) => n.id === id);

  // ------------------------------------------------------------------ ①
  console.log("① 命令快捷键匹配 + 守卫");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true })), "group", "Ctrl+G → 成组");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG", altKey: true })), "group", "Alt+G → 成组");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG", metaKey: true })), "group", "⌘+G → 成组");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true, shiftKey: true })), "ungroup", "Ctrl+Shift+G → 解组");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG", altKey: true, shiftKey: true })), "ungroup", "Alt+Shift+G → 解组");
  eq(matchCanvasCommand(keyEvent({ code: "KeyL", ctrlKey: true })), "connect", "Ctrl+L → 连接");
  eq(matchCanvasCommand(keyEvent({ code: "KeyL", ctrlKey: true, altKey: true })), null, "Ctrl+Alt+L 不匹配连接");
  eq(matchCanvasCommand(keyEvent({ code: "KeyD", ctrlKey: true })), "duplicate", "Ctrl+D → 复制");
  eq(matchCanvasCommand(keyEvent({ code: "KeyD", ctrlKey: true, altKey: true })), null, "Ctrl+Alt+D 不匹配复制(手势另走)");
  eq(matchCanvasCommand(keyEvent({ code: "KeyZ", ctrlKey: true })), "undo", "Ctrl+Z → 撤销");
  eq(matchCanvasCommand(keyEvent({ code: "KeyZ", ctrlKey: true, shiftKey: true })), "redo", "Ctrl+Shift+Z → 重做");
  eq(matchCanvasCommand(keyEvent({ code: "KeyZ", metaKey: true })), "undo", "⌘+Z → 撤销");
  eq(matchCanvasCommand(keyEvent({ key: "Delete" })), "delete", "Delete → 删除");
  eq(matchCanvasCommand(keyEvent({ key: "Backspace" })), null, "Backspace 不匹配删除(只登记 Delete,避免误拦退格)");
  eq(matchCanvasCommand(keyEvent({ key: "Delete", ctrlKey: true })), null, "Ctrl+Delete 不匹配删除");
  eq(matchCanvasCommand(keyEvent({ key: "=", ctrlKey: true })), "zoom-in", "Ctrl+= → 放大");
  eq(matchCanvasCommand(keyEvent({ key: "+", ctrlKey: true })), "zoom-in", "Ctrl++ → 放大");
  eq(matchCanvasCommand(keyEvent({ key: "-", ctrlKey: true })), "zoom-out", "Ctrl+- → 缩小");
  eq(matchCanvasCommand(keyEvent({ key: "_", metaKey: true })), "zoom-out", "⌘+_ → 缩小");
  eq(matchCanvasCommand(keyEvent({ key: "a" })), null, "普通键不匹配");
  eq(matchCanvasCommand(keyEvent({ code: "KeyG" })), null, "无修饰 G 不匹配(不误建组)");
  eq(matchCanvasCommand(keyEvent({ code: "KeyD" })), null, "无修饰 D 不匹配");
  ok(isViewCommand("zoom-in") && isViewCommand("zoom-out"), "缩放=视图命令");
  ok(!isViewCommand("group") && !isViewCommand("undo") && !isViewCommand("delete"), "成组/撤销/删除=文档命令");

  const ctx = { inCanvasContext: true, targetInteractive: false, composing: false, readOnly: false };
  eq(decideCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true }), ctx).kind, "document", "画布上下文文档命令→document");
  eq(decideCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true }), { ...ctx, composing: true }).kind, "ignore", "IME 合成中→ignore");
  eq(decideCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true }), { ...ctx, targetInteractive: true }).kind, "ignore", "交互控件聚焦→ignore");
  eq(decideCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true }), { ...ctx, inCanvasContext: false }).kind, "ignore", "非画布上下文→ignore");
  eq(decideCanvasCommand(keyEvent({ code: "KeyG", ctrlKey: true }), { ...ctx, readOnly: true }).kind, "ignore", "只读文档键→ignore(不动)");
  eq(decideCanvasCommand(keyEvent({ key: "=", ctrlKey: true }), { ...ctx, readOnly: true }).kind, "view", "只读视图键(缩放)仍 view");
  eq(decideCanvasCommand(keyEvent({ code: "KeyZ", ctrlKey: true }), { ...ctx, targetInteractive: true }).kind, "ignore", "聚焦 textarea 时不劫持原生 Ctrl+Z");

  // ①b onNodesChange 抑制门 shouldSuppressCanvasNodeChanges 全分支(纯逻辑)。
  const gate = (over) => ({
    readOnly: false,
    gestureActive: false,
    copyGestureActive: false,
    domainDragActive: false,
    documentAffectingChanges: true,
    ...over,
  });
  ok(shouldSuppressCanvasNodeChanges(gate({ readOnly: true })) === true, "只读 + 文档型变化 → 抑制");
  ok(
    shouldSuppressCanvasNodeChanges(
      gate({ readOnly: true, gestureActive: true, copyGestureActive: true, domainDragActive: true })
    ) === true,
    "只读文档型变化抑制(不论手势/copy/领域锚)"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ readOnly: true, documentAffectingChanges: false })) === false,
    "只读 + 纯 select/dimensions → 不抑制视图态"
  );
  ok(isCanvasViewOnlyNodeChange({ type: "select" }), "select 属纯视图 NodeChange");
  ok(isCanvasViewOnlyNodeChange({ type: "dimensions" }), "dimensions 属纯视图 NodeChange");
  ok(!isCanvasViewOnlyNodeChange({ type: "position" }), "position 属文档型 NodeChange");
  ok(
    hasTerminalCanvasDragFrame([{ type: "position", dragging: false }]),
    "dragging:false position 被识别为终止帧(无 stop callback 也可收口)"
  );
  ok(
    !hasTerminalCanvasDragFrame([{ type: "position", dragging: true }, { type: "select" }]),
    "进行中 position/select 不误判终止帧"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: true, copyGestureActive: false, domainDragActive: false })) === true,
    "普通手势 active + 非 copy + 领域锚已被屏障结束 → 抑制剩余帧"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: true, copyGestureActive: false, domainDragActive: true })) === false,
    "正常拖动帧(领域锚仍活)→ 不抑制"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: true, copyGestureActive: true, domainDragActive: false })) === false,
    "copy 手势(领域锚已结束)→ 不误抑制(Alt/Ctrl+Alt 复制照常)"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: true, copyGestureActive: true, domainDragActive: true })) === false,
    "copy 手势(领域锚活)→ 不抑制"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: false, domainDragActive: false })) === false,
    "无手势 + 无领域锚(选择/测量帧)→ 不抑制"
  );
  ok(
    shouldSuppressCanvasNodeChanges(gate({ gestureActive: false, domainDragActive: true })) === false,
    "无手势(即便领域锚活)→ 不抑制"
  );
  const dragLifecycleNode = createCanvasNode({ id: "drag-life", type: "text" });
  const dragLifecycleProjected = toReactFlowNodes([dragLifecycleNode]);
  const dragLifecyclePreserved = reconcileReactFlowNodes(
    [{ ...dragLifecycleProjected[0], dragging: true }],
    [dragLifecycleNode]
  );
  ok(dragLifecyclePreserved[0].dragging === true, "RF reconcile 会保留上一帧 dragging:true(复现前提)");
  const dragLifecycleCleared = clearCanvasDraggingFlags(dragLifecyclePreserved);
  ok(dragLifecycleCleared[0].dragging === false, "领域重同步显式清 dragging:false(截断手势不黏住)");
  ok(dragLifecyclePreserved[0].dragging === true, "清理返回新视图且不突变输入帧");

  // ------------------------------------------------------------------ ②
  console.log("② 成组/解组 strict 双向一致 + 重复/跨组/readOnly");
  hydrate();
  const a = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const b = store().addNode({ type: "image", position: { x: 200, y: 0 } });
  const c = store().addNode({ type: "product", position: { x: 400, y: 0 } });
  const d = store().addNode({ type: "script", position: { x: 600, y: 0 } });

  const gid = store().groupNodes([a, b]);
  ok(typeof gid === "string" && gid.length > 0, "成组返回 group id");
  const g = store().groups.find((x) => x.id === gid);
  eq(g?.node_ids, [a, b], "group.node_ids=[a,b](doc 原序)");
  eq(node(a)?.group_id, gid, "a.group_id=gid");
  eq(node(b)?.group_id, gid, "b.group_id=gid");
  eq(node(c)?.group_id, null, "c 未入组 group_id=null");
  ok(validateCanvasDoc(docOf()).ok, "成组后严格校验通过(双向一致)");

  ok(store().groupNodes([a]) === null, "<2 合法未成组节点 → null");
  ok(store().groupNodes([a, c]) === null, "跨组:a 已成组被排除,仅 c 合法 → <2 → null");
  ok(store().groupNodes([a, b]) === null, "全已成组 → null(不重复成组)");
  const gid2 = store().groupNodes([c, d, c]); // 含重复 id
  ok(typeof gid2 === "string" && gid2 !== gid, "去重后 c,d 成新组");
  eq(store().groups.find((x) => x.id === gid2)?.node_ids, [c, d], "新组成员去重=[c,d]");

  store().setReadOnly(true);
  ok(store().groupNodes([a, b]) === null, "只读时成组返回 null");
  ok(store().ungroupNodes([a]) === false, "只读时解组返回 false");
  store().setReadOnly(false);

  ok(store().ungroupNodes([a]) === true, "解组 a 所属组 → true");
  ok(!store().groups.some((x) => x.id === gid), "组已删除");
  eq(node(a)?.group_id, null, "a.group_id 清空");
  eq(node(b)?.group_id, null, "b.group_id 清空");
  ok(validateCanvasDoc(docOf()).ok, "解组后严格校验通过");
  ok(store().ungroupNodes([a]) === false, "无组可解 → false");
  ok(store().ungroupNodes([c]) === true, "解组 c,d 组 → true");

  // ------------------------------------------------------------------ ③
  console.log("③ 复制:Ctrl+D 内部边映射 + Alt/Ctrl+Alt + 新 id/group_id/无 RF 泄漏");
  hydrate();
  const na = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const nb = store().addNode({ type: "image", position: { x: 100, y: 0 } });
  const nc = store().addNode({ type: "video", position: { x: 200, y: 0 } });
  store().addEdge({ source: na, target: nb }); // 内部边(na,nb 都在选集)
  store().addEdge({ source: nb, target: nc }); // 跨出选集(nc 不在)
  const edgeBefore = store().edges.length;

  const dup = store().duplicateNodes([na, nb], { withEdges: true, offset: { x: 24, y: 24 } });
  eq(dup?.length, 2, "复制 2 个节点");
  eq(store().nodes.length, 5, "节点 +2");
  eq(store().edges.length, edgeBefore + 1, "带线只复制内部 na→nb(不复制跨出的 nb→nc)");
  const copies = dup.map((id) => node(id));
  ok(copies.every((n) => n && !dup.includes(na) && !dup.includes(nb)), "副本 id 全新");
  ok(copies.every((n) => n.group_id === null), "副本 group_id=null(不入组)");
  eq(copies[0].position, { x: 0 + 24, y: 0 + 24 }, "副本落点=原位+offset");
  const RF_VIEW = ["selected", "dragging", "measured", "width", "height", "positionAbsolute", "parentId"];
  ok(copies.every((n) => RF_VIEW.every((k) => !(k in n))), "副本无 RF 视图字段");
  // 复制出的新边端点必须都是新副本 id、非自环、非悬空
  const newEdge = store().edges[store().edges.length - 1];
  ok(dup.includes(newEdge.source) && dup.includes(newEdge.target), "新边两端都是副本 id");
  ok(newEdge.source !== newEdge.target, "新边非自环");
  ok(validateCanvasDoc(docOf()).ok, "复制后严格校验通过");

  // Alt(仅节点,不带线)
  hydrate();
  const ma = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const mb = store().addNode({ type: "text", position: { x: 50, y: 0 } });
  store().addEdge({ source: ma, target: mb });
  const dupNoEdge = store().duplicateNodes([ma, mb], { withEdges: false, offset: { x: 10, y: 10 } });
  eq(dupNoEdge?.length, 2, "Alt 复制 2 节点");
  eq(store().edges.length, 1, "Alt 不复制连线(边数不变)");

  // Ctrl+Alt 落点(positionsById 绝对落点)
  hydrate();
  const pa = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const dupAt = store().duplicateNodes([pa], { withEdges: true, positionsById: { [pa]: { x: 512, y: 640 } } });
  eq(node(dupAt[0])?.position, { x: 512, y: 640 }, "拖拽复制落点=positionsById");

  // readOnly / 空 / ghost
  hydrate();
  const only = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().setReadOnly(true);
  ok(store().duplicateNodes([only], { withEdges: true }) === null, "只读复制返回 null");
  store().setReadOnly(false);
  ok(store().duplicateNodes([], { withEdges: true }) === null, "空选择复制返回 null");
  ok(store().duplicateNodes(["ghost"], { withEdges: true }) === null, "全非法 id 复制返回 null");

  // planDuplicate 纯函数:禁自环/悬空(源图自环不复制;端点缺映射不复制)
  const selfDoc = {
    nodes: [
      createCanvasNode({ id: "s1", type: "text", position: { x: 0, y: 0 } }),
      createCanvasNode({ id: "s2", type: "text", position: { x: 9, y: 9 } }),
    ],
    edges: [
      createCanvasEdge({ id: "self", source: "s1", target: "s1" }),
      createCanvasEdge({ id: "cross", source: "s1", target: "s2" }),
    ],
    groups: [],
  };
  const plan = planDuplicate(selfDoc, ["s1"], { withEdges: true, offset: { x: 5, y: 5 } });
  eq(plan?.newEdgeIds.length, 0, "planDuplicate 单点带线:自环不复制、跨出边不复制");

  // 深拷解耦:改副本任意嵌套 params 绝不污染原节点
  const aliasDoc = {
    nodes: [
      createCanvasNode({ id: "al", type: "text", position: { x: 0, y: 0 }, data: { params: { nested: { v: 1 } } } }),
    ],
    edges: [],
    groups: [],
  };
  const aliasPlan = planDuplicate(aliasDoc, ["al"], { withEdges: false, offset: { x: 1, y: 1 } });
  const aliasCopy = aliasPlan.doc.nodes.find((n) => aliasPlan.newNodeIds.includes(n.id));
  aliasCopy.data.params.nested.v = 999; // 突变副本嵌套
  eq(aliasDoc.nodes[0].data.params.nested.v, 1, "改副本嵌套 params 不污染原节点(structuredClone 深拷解耦)");
  ok(aliasCopy.data.params.nested !== aliasDoc.nodes[0].data.params.nested, "副本与原节点 params 引用不共享");

  // ------------------------------------------------------------------ ④
  console.log("④ undo/redo:forward/inverse + redo 清空 + 容量 + 拖动合并 + 原子失败 + readOnly");
  hydrate();
  ok(store().past.length === 0 && store().future.length === 0, "初始空历史");
  const u1 = store().addNode({ type: "text", position: { x: 1, y: 2 } });
  eq(store().past.length, 1, "建节点入 1 项");
  ok(store().undo() === true, "撤销成功");
  eq(store().nodes.length, 0, "撤销后节点为空");
  eq(store().future.length, 1, "撤销后 future=1");
  ok(store().redo() === true, "重做成功");
  eq(store().nodes.length, 1, "重做后节点恢复");
  eq(store().future.length, 0, "重做后 future=0");

  // 新变更清空 redo
  store().undo(); // future=1
  store().addNode({ type: "image", position: { x: 0, y: 0 } }); // 新变更
  eq(store().future.length, 0, "新变更清空 redo");

  // 容量上限
  hydrate();
  for (let i = 0; i < CANVAS_HISTORY_LIMIT + 15; i += 1) {
    store().addNode({ type: "text", position: { x: i, y: 0 } });
  }
  eq(store().past.length, CANVAS_HISTORY_LIMIT, "past 容量截顶到上限");

  // 成组→撤销:组消失、成员归零、consistency
  hydrate();
  const ga = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const gb = store().addNode({ type: "text", position: { x: 50, y: 0 } });
  store().groupNodes([ga, gb]);
  ok(store().groups.length === 1, "成组后 1 组");
  store().undo();
  ok(store().groups.length === 0, "撤销成组后 0 组");
  eq(node(ga)?.group_id, null, "撤销后 ga.group_id=null");
  ok(validateCanvasDoc(docOf()).ok, "撤销成组后校验通过");
  store().redo();
  ok(store().groups.length === 1 && node(ga)?.group_id !== null, "重做恢复成组");

  // 批量删除→撤销恢复(节点+边+组)
  hydrate();
  const ra = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const rb = store().addNode({ type: "text", position: { x: 50, y: 0 } });
  store().addEdge({ source: ra, target: rb });
  store().groupNodes([ra, rb]);
  const beforeDelete = JSON.stringify(docOf());
  store().removeEntities([ra, rb], []);
  eq(store().nodes.length, 0, "批量删除后节点空");
  eq(store().edges.length, 0, "批量删除级联删边");
  eq(store().groups.length, 0, "批量删除后空组被删");
  store().undo();
  eq(JSON.stringify(docOf()), beforeDelete, "撤销批量删除完整恢复(节点+边+组)");

  // 拖动合并成一项 + 逐帧不入栈 + 最小实体锚(非 doc 快照)
  hydrate();
  for (let i = 0; i < 20; i += 1) store().addNode({ type: "text", position: { x: i * 40, y: 0 } }); // 大 doc
  const dn = store().nodes[0].id;
  const pastAfterSeed = store().past.length;
  store().beginPositionDrag([dn]);
  const dragAnchor = store().dragAnchor;
  ok(
    dragAnchor &&
      Array.isArray(dragAnchor.bases) &&
      !("baseById" in dragAnchor) &&
      !("nodes" in dragAnchor) &&
      !("edges" in dragAnchor) &&
      !("groups" in dragAnchor),
    "dragAnchor 不含 doc 快照(只 bases entry array,无 baseById/Record)"
  );
  eq(dragAnchor.bases.map((e) => e.id), [dn], "大 doc 下 dragAnchor 只锚被拖的 1 个节点(非全量,doc 顺序)");
  const anchoredNode = dragAnchor.bases[0].base;
  ok(
    anchoredNode && anchoredNode.type && anchoredNode.position && !("nodes" in anchoredNode) && !("edges" in anchoredNode),
    "锚是单个 node 实体(非 doc)"
  );
  store().applyNodePositionChanges([{ type: "position", id: dn, position: { x: 10, y: 0 }, dragging: true }]);
  store().applyNodePositionChanges([{ type: "position", id: dn, position: { x: 20, y: 0 }, dragging: true }]);
  store().applyNodePositionChanges([{ type: "position", id: dn, position: { x: 30, y: 0 }, dragging: false }]);
  eq(store().past.length, pastAfterSeed, "拖动逐帧不入栈(past 不增)");
  ok(store().undo() === false, "拖动中 undo 被拦(dragAnchor 非空)");
  store().endPositionDrag();
  eq(store().past.length, pastAfterSeed + 1, "拖动结束合并成 1 项");
  store().undo();
  eq(node(dn)?.position, { x: 0, y: 0 }, "撤销拖动回到起点");
  store().redo();
  eq(node(dn)?.position, { x: 30, y: 0 }, "重做拖动到落点");
  // 无移动的拖动不入栈
  const p0 = store().past.length;
  store().beginPositionDrag([dn]);
  store().endPositionDrag();
  eq(store().past.length, p0, "无移动拖动不入栈");

  // 非法 apply 原子失败(applyOpsToDoc 冲突/坏 doc → ok:false,不产出 doc)
  const goodDoc = { nodes: [createCanvasNode({ id: "x1", type: "text", position: { x: 0, y: 0 } })], edges: [], groups: [] };
  const conflictOps = [{ entity: "node", op: "remove", base: createCanvasNode({ id: "ghost", type: "text", position: { x: 0, y: 0 } }) }];
  // remove 一个当前不存在的 id → applyPatch no-op(幂等),不是冲突;构造真正冲突:update 基线不符
  const realConflict = [{
    entity: "node",
    op: "update",
    base: createCanvasNode({ id: "x1", type: "image", position: { x: 9, y: 9 } }),
    next: createCanvasNode({ id: "x1", type: "video", position: { x: 1, y: 1 } }),
  }];
  ok(applyOpsToDoc(goodDoc, realConflict).ok === false, "update 基线不符 → applyOpsToDoc 原子失败");
  ok(applyOpsToDoc(goodDoc, conflictOps).ok === true, "remove 不存在实体 → 幂等成功(不误判冲突)");
  ok(applyOpsToDoc(goodDoc, []).ok === true, "空 op → 成功(无变更)");

  // readOnly 拦截 undo/redo
  hydrate();
  store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().setReadOnly(true);
  ok(store().undo() === false, "只读时 undo 拦截");
  ok(store().redo() === false, "只读时 redo 拦截");
  store().setReadOnly(false);

  // diffDocs/makeHistoryEntry 空变更 → null
  const sameDoc = { nodes: [], edges: [], groups: [] };
  eq(diffDocs(sameDoc, sameDoc), [], "无变更 diff 为空");
  ok(makeHistoryEntry(sameDoc, sameDoc) === null, "无净变更 makeHistoryEntry=null");

  // 历史载荷稳定:建 entry 后突变 after 实体,历史项不受影响
  const stBefore = { nodes: [createCanvasNode({ id: "st", type: "text", position: { x: 0, y: 0 } })], edges: [], groups: [] };
  const stAfterNode = createCanvasNode({ id: "st", type: "text", position: { x: 50, y: 50 } });
  const stEntry = makeHistoryEntry(stBefore, { nodes: [stAfterNode], edges: [], groups: [] });
  stAfterNode.position.x = 999; // 建 entry 之后突变源实体
  const stApplied = applyOpsToDoc(stBefore, stEntry.forward);
  ok(stApplied.ok, "history 载荷:forward 应用成功");
  eq(stApplied.doc.nodes.find((n) => n.id === "st").position.x, 50, "history 载荷深拷稳定:后续突变源实体不改历史项(得 50 非 999)");

  // makeNodeUpdateEntry:最小实体锚 add/update/remove/无变化
  const m1 = createCanvasNode({ id: "m1", type: "text", position: { x: 0, y: 0 } });
  const m2 = { ...m1, position: { x: 5, y: 5 } };
  const mEntry = makeNodeUpdateEntry([{ before: m1, after: m2 }]);
  ok(mEntry && mEntry.forward.length === 1 && mEntry.forward[0].op === "update", "makeNodeUpdateEntry 单节点 update");
  ok(makeNodeUpdateEntry([{ before: m1, after: m1 }]) === null, "无变化 → null");
  eq(makeNodeUpdateEntry([{ before: undefined, after: m1 }]).forward[0].op, "add", "缺 before → add");
  eq(makeNodeUpdateEntry([{ before: m1, after: undefined }]).forward[0].op, "remove", "缺 after → remove");

  // pushHistory 负/零 limit 不死循环(clamp)
  const dummyEntry = { forward: [], inverse: [] };
  const clampNeg = pushHistory(createEmptyHistory(), dummyEntry, -5);
  eq(clampNeg.past.length, 1, "pushHistory 负 limit 不死循环(clamp 回默认)");
  const clampZero = pushHistory({ past: [dummyEntry, dummyEntry], future: [dummyEntry] }, dummyEntry, 0);
  eq(clampZero.past.length, 0, "pushHistory limit=0 → 清空(不死循环)");
  eq(clampZero.future.length, 0, "pushHistory 清空 redo");

  // 多节点拖动合并成一个 entry
  hydrate();
  const mgA = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const mgB = store().addNode({ type: "text", position: { x: 100, y: 0 } });
  const pMulti = store().past.length;
  store().beginPositionDrag([mgA, mgB]);
  store().applyNodePositionChanges([
    { type: "position", id: mgA, position: { x: 5, y: 5 }, dragging: false },
    { type: "position", id: mgB, position: { x: 105, y: 5 }, dragging: false },
  ]);
  store().endPositionDrag();
  eq(store().past.length, pMulti + 1, "多节点拖动合并为一个历史项");
  store().undo();
  eq(node(mgA)?.position, { x: 0, y: 0 }, "撤销多节点拖动:A 归位");
  eq(node(mgB)?.position, { x: 100, y: 0 }, "撤销多节点拖动:B 归位");

  // 键盘方向键移动(只发 position、无 begin/end drag)→ 原子历史项、可撤销、清 redo
  hydrate();
  const kn = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().addNode({ type: "text", position: { x: 100, y: 0 } });
  store().undo(); // future 里放一项(验证键盘移动清 redo)
  eq(store().future.length, 1, "撤销后 future=1(准备验证键盘移动清 redo)");
  const pk = store().past.length;
  ok(store().dragAnchor === null, "无 active drag(dragAnchor=null)");
  store().applyNodePositionChanges([{ type: "position", id: kn, position: { x: 16, y: 0 }, dragging: false }]);
  eq(store().past.length, pk + 1, "键盘移动(无拖动)作为原子历史项入栈");
  eq(store().future.length, 0, "键盘移动清空 redo");
  eq(node(kn)?.position, { x: 16, y: 0 }, "键盘移动写入 position");
  store().undo();
  eq(node(kn)?.position, { x: 0, y: 0 }, "键盘移动可撤销");

  // 拖动中途转只读:已写位置不能既不回滚也不入历史 → setReadOnly(true) 前原子 finalize
  hydrate();
  const rn = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const pr = store().past.length;
  store().beginPositionDrag([rn]);
  store().applyNodePositionChanges([{ type: "position", id: rn, position: { x: 40, y: 0 }, dragging: true }]);
  ok(store().dragAnchor !== null, "拖动中 dragAnchor 非空");
  eq(store().past.length, pr, "拖动逐帧未入栈");
  store().setReadOnly(true); // 转只读:finalize 拖动
  eq(store().past.length, pr + 1, "转只读前 finalize 拖动为一个历史项(位置不丢)");
  ok(store().dragAnchor === null, "转只读后 dragAnchor 清空");
  eq(node(rn)?.position, { x: 40, y: 0 }, "已写位置保留(未回滚)");
  store().setReadOnly(false);
  store().undo();
  eq(node(rn)?.position, { x: 0, y: 0 }, "解只读后可撤销该拖动");

  // 复制新 id 有界碰撞重试:副本 node/edge id 不与现存碰撞,严格校验无重复
  hydrate();
  const da = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const db = store().addNode({ type: "text", position: { x: 50, y: 0 } });
  store().addEdge({ source: da, target: db });
  const existingNodeIds = new Set(store().nodes.map((n) => n.id));
  const existingEdgeIds = new Set(store().edges.map((e) => e.id));
  const dupIds = store().duplicateNodes([da, db], { withEdges: true, offset: { x: 20, y: 20 } });
  ok(dupIds.every((id) => !existingNodeIds.has(id)), "复制节点新 id 不与现存 node id 碰撞");
  const newEdgeIds = store().edges.filter((e) => !existingEdgeIds.has(e.id)).map((e) => e.id);
  ok(newEdgeIds.length === 1, "复制 1 条内部边");
  ok(!existingEdgeIds.has(newEdgeIds[0]), "复制边新 id 不与现存 edge id 碰撞");
  ok(validateCanvasDoc(docOf()).ok, "复制后无 id 重复(严格校验通过)");

  // ------------------------------------------------------------------ ⑤
  console.log("⑤ 文本编辑会话:同节点连续只一项 + 失焦 undo/redo + 非法不入栈 + 切 node 先提交");
  hydrate();
  const t = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  eq(store().past.length, 1, "建文本节点 1 项");
  ok(store().updateNodeData(t, { title: "h" }) === true, "输入 h");
  const editAnchor = store().editAnchor;
  ok(
    editAnchor &&
      editAnchor.base &&
      editAnchor.base.type &&
      editAnchor.base.position &&
      !("nodes" in editAnchor) &&
      !("edges" in editAnchor) &&
      !("groups" in editAnchor) &&
      !("doc" in editAnchor),
    "editAnchor.base 是单 node 实体(非 doc 快照)"
  );
  eq(editAnchor.base.data?.title, undefined, "editAnchor.base 是会话起点(编辑前无 title)");
  ok(store().updateNodeData(t, { title: "he" }) === true, "输入 he");
  ok(store().updateNodeData(t, { title: "hel" }) === true, "输入 hel");
  eq(store().past.length, 1, "同节点连续输入不逐键入栈(仍 1 项,会话未提交)");
  ok(store().updateNodeData(t, { title: "x".repeat(2001) }) === false, "超长非法输入原子拒绝");
  eq(node(t)?.data?.title, "hel", "非法拒绝后 title 不变");
  store().commitTextEdit();
  eq(store().past.length, 2, "失焦提交:整段会话合并成 1 项");
  store().undo();
  eq(node(t)?.data?.title, undefined, "撤销文本会话回到会话起点(无 title)");
  ok(validateCanvasDoc(docOf()).ok, "撤销文本后校验通过");
  store().redo();
  eq(node(t)?.data?.title, "hel", "重做文本恢复 hel");

  // 空提交不入栈
  const pc = store().past.length;
  store().commitTextEdit();
  eq(store().past.length, pc, "无待提交会话 commit 不入栈");
  // 会话中途反悔到原值 → 提交无净变化不入栈
  store().updateNodeData(t, { title: "hel!" });
  store().updateNodeData(t, { title: "hel" }); // 回到原值
  store().commitTextEdit();
  eq(store().past.length, pc, "会话净变化为零 → 不入栈");

  // 切 node 编辑:先提交上一个会话
  hydrate();
  const e1 = store().addNode({ type: "text", position: { x: 0, y: 0 } }); // past 1
  const e2 = store().addNode({ type: "text", position: { x: 90, y: 0 } }); // past 2
  store().updateNodeData(e1, { title: "aa" }); // 开 e1 会话(不入栈)
  eq(store().past.length, 2, "开 e1 会话未入栈");
  store().updateNodeData(e2, { title: "bb" }); // 切到 e2 → 先提交 e1 会话
  eq(store().past.length, 3, "切 node 时提交上一个会话(+1)");
  store().commitTextEdit(); // 提交 e2
  eq(store().past.length, 4, "提交 e2 会话(+1)");
  // 结构动作前 flush:再开会话,removeNode 前应先提交
  store().updateNodeData(e1, { title: "cc" });
  const before = store().past.length;
  store().removeNode(e2); // 结构动作:flush e1 会话(+1)后再删(+1)
  eq(store().past.length, before + 2, "结构动作前 flush 文本会话,顺序正确");
  // readOnly 时 updateNodeData 拒绝(不开会话、不入栈)
  store().setReadOnly(true);
  ok(store().updateNodeData(e1, { title: "zz" }) === false, "只读时 updateNodeData 拒绝");
  store().setReadOnly(false);

  // ------------------------------------------------------------------ ⑥
  console.log("⑥ 组框投影 projectGroupFrames(纯视图/非交互/前缀 id/zIndex/可变尺寸)");
  const frNodes = [
    createCanvasNode({ id: "f1", type: "text", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "f2", type: "text", position: { x: 300, y: 200 } }),
  ];
  const frames = projectGroupFrames([{ id: "grp", label: "分镜", node_ids: ["f1", "f2"] }], frNodes);
  eq(frames.length, 1, "1 组 → 1 组框");
  eq(frames[0].type, GROUP_FRAME_TYPE, "组框 type=__group");
  eq(frames[0].id, groupFrameNodeId("grp"), "组框 RF id 用前缀 __group:<groupId>");
  ok(
    frames[0].draggable === false &&
      frames[0].selectable === false &&
      frames[0].connectable === false &&
      frames[0].deletable === false,
    "组框不可拖/选/连/删"
  );
  ok(frames[0].style?.pointerEvents === "none", "组框指针穿透");
  ok(typeof frames[0].zIndex === "number" && frames[0].zIndex < 0, "组框 zIndex<0(画在成员背面,不遮节点)");
  ok(frames[0].position.x < 0 && frames[0].position.y < 0, "组框左上角含内边距(在成员外)");
  ok(frames[0].style.width > 300 && frames[0].style.height > 200, "组框尺寸包住成员 bbox");
  eq(projectGroupFrames([{ id: "empty", label: "", node_ids: [] }], frNodes).length, 0, "空成员组不产框");
  eq(projectGroupFrames([{ id: "gone", label: "", node_ids: ["ghost"] }], frNodes).length, 0, "成员全缺失不产框");

  // 跨 entity id 碰撞:领域 node.id 与 group.id 相同,RF id 仍唯一(前缀隔离)
  const collide = projectGroupFrames(
    [{ id: "same", label: "", node_ids: ["same", "f2"] }],
    [createCanvasNode({ id: "same", type: "text", position: { x: 0, y: 0 } }), frNodes[1]]
  );
  eq(collide[0].id, GROUP_FRAME_ID_PREFIX + "same", "组 id=领域 node id 时组框仍前缀");
  ok(collide[0].id !== "same", "组框 RF id 与同名领域 node id 不碰撞");

  // 可变高度:dimensionsById 真实测量优先,高节点不被截断
  const tall = projectGroupFrames(
    [{ id: "gt", label: "", node_ids: ["ta", "tb"] }],
    [
      { id: "ta", position: { x: 0, y: 0 } },
      { id: "tb", position: { x: 0, y: 400 } },
    ],
    { ta: { height: 300, width: 208 }, tb: { height: 300, width: 208 } }
  );
  ok(tall[0].style.height >= 700, "组框高度含真实测量高度(高节点不截断)");
  // 缺测量尺寸回退兜底(仍产有限正尺寸)
  const fb = projectGroupFrames([{ id: "gf", label: "", node_ids: ["fa"] }], [{ id: "fa", position: { x: 0, y: 0 } }]);
  ok(fb[0].style.width > 0 && fb[0].style.height > 0, "缺测量尺寸回退兜底(仍产有限正尺寸)");

  // ------------------------------------------------------------------ ⑦
  console.log("⑦ S1–S3/S5 不回归");
  eq(matchCanvasShortcut({ key: "0", ctrlKey: true }), "fit-view", "S1:Ctrl+0 仍 fit-view");
  eq(matchCanvasShortcut({ key: "z", ctrlKey: true }), null, "S1:matchCanvasShortcut 对 Ctrl+Z 仍返 null(S4 走独立表)");
  eq(matchCanvasShortcut({ key: "d", ctrlKey: true }), null, "S1:matchCanvasShortcut 对 Ctrl+D 仍返 null");
  eq(matchCanvasShortcut({ key: "=", ctrlKey: true }), null, "S1:matchCanvasShortcut 对 Ctrl+= 仍返 null");
  eq(CANVAS_VIEW_SHORTCUTS.length, 4, "S1:视图快捷键表仍 4 条");
  eq(NODE_TYPES.length, 6, "S3:白名单仍 6 类");

  hydrate();
  const s2a = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const s2b = store().addNode({ type: "image", position: { x: 100, y: 0 } });
  ok(typeof store().addEdge({ source: s2a, target: s2b }) === "string", "S2:addEdge 不回归");
  ok(store().addEdge({ source: s2a, target: s2a }) === null, "S2:自环仍拒");
  ok(store().addEdge({ source: s2a, target: s2b }) === null, "S2:重复边仍拒");
  ok(canAddCanvasEdge(store().nodes, store().edges, { source: s2b, target: s2a }) === true, "S2:canAddCanvasEdge 不回归");
  ok(store().updateNodeData(s2a, { title: "ok" }) === true, "S3:updateNodeData 不回归");
  eq(node(s2a)?.data?.title, "ok", "S3:title 落库");
  store().removeNode(s2b);
  eq(store().nodes.length, 1, "S3:removeNode 级联不回归");
  ok(!store().edges.some((e) => e.source === s2b || e.target === s2b), "S3:removeNode 级联删边");

  // S3 broken 分离 + recovery + removeBrokenNode 清历史
  hydrate();
  store().hydrateFromDoc({
    nodes: [
      createCanvasNode({ id: "okn", type: "text", position: { x: 0, y: 0 } }),
      { id: "bad", type: "nope", position: { x: 5, y: 5 } },
    ],
    edges: [],
    groups: [],
  });
  eq(store().brokenNodes.length, 1, "S3:坏节点入 brokenNodes");
  ok(store().recoveryRequired === true, "S3:recoveryRequired=true");
  ok(isCanvasAutosaveBlocked(store()) === true, "S1:坏档阻断 autosave");
  ok(store().past.length === 0, "装载不进历史");
  store().addNode({ type: "text", position: { x: 1, y: 1 } });
  ok(store().past.length === 1, "装载后新建入历史");
  store().removeBrokenNode(store().brokenNodes[0].id);
  eq(store().past.length, 0, "removeBrokenNode(恢复)清空历史");
  ok(computeRecoveryRequired(true, [], []) === false, "computeRecoveryRequired 不回归");

  // S5 applyNodePositions 不回归(只读/NaN 守卫 + 现在入历史)
  hydrate();
  const s5 = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().applyNodePositions([{ id: s5, position: { x: 128, y: 64 } }]);
  eq(node(s5)?.position, { x: 128, y: 64 }, "S5:applyNodePositions 写入 position");
  store().applyNodePositions([{ id: s5, position: { x: Number.NaN, y: 10 } }]);
  eq(node(s5)?.position, { x: 128, y: 64 }, "S5:NaN 坐标被丢弃");
  store().setReadOnly(true);
  store().applyNodePositions([{ id: s5, position: { x: 9, y: 9 } }]);
  eq(node(s5)?.position, { x: 128, y: 64 }, "S5:只读时不写");
  store().setReadOnly(false);

  // 命令面板表:含 S4 全部键 + 拖拽手势
  ok(CANVAS_COMMAND_SHORTCUTS.length >= 9, "命令面板列出 S4 命令(含缩放)");
  const cmdIds = CANVAS_COMMAND_SHORTCUTS.map((s) => s.id);
  ok(
    ["group", "ungroup", "connect", "duplicate", "delete", "undo", "redo", "zoom-in", "zoom-out"].every((id) =>
      cmdIds.includes(id)
    ),
    "命令面板覆盖 9 个 S4 命令"
  );
  ok(cmdIds.includes("drag-copy") && cmdIds.includes("drag-copy-edges"), "命令面板含两条拖拽复制手势");

  // ------------------------------------------------------------------ ⑨
  console.log("⑨ 二轮复审:fail-closed 深拷(function/symbol/toJSON)+ updateNodeData 预检 + 防御 rollback");

  // (1) cloneCanvasEntity 仅 structuredClone 成功才返回;不可克隆物一律 null(绝不退化 JSON / 返回原引用)。
  ok(cloneCanvasEntity(() => 1) === null, "cloneCanvasEntity(function) → null");
  ok(cloneCanvasEntity(Symbol("x")) === null, "cloneCanvasEntity(symbol) → null");
  ok(cloneCanvasEntity({ fn: () => 1 }) === null, "cloneCanvasEntity(含 function 值的对象) → null");
  ok(cloneCanvasEntity({ s: Symbol("y") }) === null, "cloneCanvasEntity(含 symbol 值的对象) → null");
  const throwingToJSON = {
    x: 1,
    toJSON() {
      throw new Error("boom");
    },
  };
  ok(
    cloneCanvasEntity(throwingToJSON) === null,
    "cloneCanvasEntity(含 enumerable 抛错型 toJSON 的对象) → null(旧 JSON fallback 会抛,现直接 fail-closed)"
  );
  const cloneControl = cloneCanvasEntity({ a: 1, nested: { b: [1, 2] } });
  ok(
    cloneControl !== null && cloneControl.nested.b[0] === 1,
    "cloneCanvasEntity(纯数据对象) 正常返回深拷(非 null;证明 null 非无条件)"
  );
  ok(cloneCanvasEntity(new Date()) === null, "cloneCanvasEntity(Date) → null(JSON 不保留类型语义)");
  ok(cloneCanvasEntity(new Map([["x", 1]])) === null, "cloneCanvasEntity(Map) → null");
  ok(cloneCanvasEntity(new Set([1])) === null, "cloneCanvasEntity(Set) → null");
  ok(cloneCanvasEntity(/x/) === null, "cloneCanvasEntity(RegExp) → null");
  ok(cloneCanvasEntity({ n: Number.NaN }) === null, "cloneCanvasEntity(NaN) → null");
  ok(cloneCanvasEntity({ n: Number.POSITIVE_INFINITY }) === null, "cloneCanvasEntity(Infinity) → null");
  ok(cloneCanvasEntity({ value: undefined }) === null, "cloneCanvasEntity(undefined 属性) → null");
  const jsonCycle = {};
  jsonCycle.self = jsonCycle;
  ok(cloneCanvasEntity(jsonCycle) === null, "cloneCanvasEntity(循环引用) → null");
  const jsonSparse = [];
  jsonSparse[1] = "x";
  ok(cloneCanvasEntity(jsonSparse) === null, "cloneCanvasEntity(稀疏数组) → null");
  class JsonArraySubclass extends Array {}
  ok(cloneCanvasEntity(new JsonArraySubclass(1, 2)) === null, "cloneCanvasEntity(Array 子类) → null");
  const jsonAccessor = {};
  Object.defineProperty(jsonAccessor, "x", { enumerable: true, get: () => 1 });
  ok(cloneCanvasEntity(jsonAccessor) === null, "cloneCanvasEntity(accessor) → null(不执行 getter)");
  const jsonHidden = { visible: true };
  Object.defineProperty(jsonHidden, "hidden", { enumerable: false, value: 1 });
  ok(cloneCanvasEntity(jsonHidden) === null, "cloneCanvasEntity(non-enumerable) → null");
  const jsonSymbolKey = { visible: true };
  jsonSymbolKey[Symbol("hidden")] = 1;
  ok(cloneCanvasEntity(jsonSymbolKey) === null, "cloneCanvasEntity(symbol key) → null");
  class JsonClassInstance {
    constructor() {
      this.x = 1;
    }
  }
  ok(cloneCanvasEntity(new JsonClassInstance()) === null, "cloneCanvasEntity(类实例) → null");
  const nestedFakeNode = {
    payload: { id: "fake", type: "text", variant: undefined, position: {}, data: {} },
  };
  ok(
    cloneCanvasEntity(nestedFakeNode) === null,
    "cloneCanvasEntity(嵌套伪 node 的 variant:undefined) → null(窄例外仅限根实体)"
  );
  const throwingProxy = new Proxy({}, { ownKeys: () => { throw new Error("proxy trap"); } });
  ok(cloneCanvasEntity(throwingProxy) === null, "cloneCanvasEntity(抛错 Proxy) → null(不向外抛)");
  const nullProto = Object.create(null);
  nullProto.x = { y: [1, 2] };
  const nullProtoClone = cloneCanvasEntity(nullProto);
  ok(nullProtoClone !== null && nullProtoClone.x.y[1] === 2, "cloneCanvasEntity(null prototype plain object) 可用");

  // (2) diffDocs / makeHistoryEntry / makeNodeUpdateEntry:任一 payload 不可克隆 → 整体 null,不产部分 ops。
  const cleanNode = createCanvasNode({ id: "cln", type: "text", position: { x: 0, y: 0 } });
  const fnNode = {
    ...cleanNode,
    position: { x: 5, y: 5 },
    data: { ...cleanNode.data, params: { fn: () => 1 } },
  };
  const symNode = {
    ...cleanNode,
    position: { x: 7, y: 7 },
    data: { ...cleanNode.data, params: { s: Symbol("z") } },
  };
  const cleanDoc = { nodes: [cleanNode], edges: [], groups: [] };
  const fnDoc = { nodes: [fnNode], edges: [], groups: [] };
  const symDoc = { nodes: [symNode], edges: [], groups: [] };
  const cycleBeforeParams = {};
  cycleBeforeParams.self = cycleBeforeParams;
  const cycleAfterParams = {};
  cycleAfterParams.self = cycleAfterParams;
  const cycleBeforeNode = { ...cleanNode, data: { ...cleanNode.data, params: cycleBeforeParams } };
  const cycleAfterNode = { ...cleanNode, data: { ...cleanNode.data, params: cycleAfterParams } };
  let cycleHistoryThrew = false;
  let cycleHistoryResult = "unset";
  try {
    cycleHistoryResult = makeHistoryEntry(
      { nodes: [cycleBeforeNode], edges: [], groups: [] },
      { nodes: [cycleAfterNode], edges: [], groups: [] }
    );
  } catch {
    cycleHistoryThrew = true;
  }
  ok(!cycleHistoryThrew, "makeHistoryEntry(不同循环 params) 不在 deepEqual 中炸栈");
  ok(cycleHistoryResult === null, "makeHistoryEntry(不同循环 params) → null fail-closed");
  let accessorReads = 0;
  const accessorParams = {};
  Object.defineProperty(accessorParams, "x", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 1;
    },
  });
  const accessorNode = { ...cleanNode, data: { ...cleanNode.data, params: accessorParams } };
  ok(
    makeHistoryEntry(cleanDoc, { nodes: [accessorNode], edges: [], groups: [] }) === null,
    "makeHistoryEntry(accessor params) → null fail-closed"
  );
  eq(accessorReads, 0, "历史比较/克隆不执行 params getter");
  ok(diffDocs(cleanDoc, fnDoc) === null, "diffDocs:after 含 function payload → 整体 null(不产部分 ops)");
  ok(diffDocs(fnDoc, cleanDoc) === null, "diffDocs:before 含 function payload → 整体 null");
  ok(diffDocs(cleanDoc, symDoc) === null, "diffDocs:after 含 symbol payload → 整体 null");
  ok(makeHistoryEntry(cleanDoc, fnDoc) === null, "makeHistoryEntry:forward 含不可克隆 payload → 整体 null");
  ok(makeHistoryEntry(fnDoc, cleanDoc) === null, "makeHistoryEntry:反向 diff 含不可克隆 payload → 整体 null");
  ok(
    makeNodeUpdateEntry([{ before: cleanNode, after: fnNode }]) === null,
    "makeNodeUpdateEntry:after 含 function → 整份 entry null(非当作无变化吞掉)"
  );
  ok(
    makeNodeUpdateEntry([{ before: fnNode, after: cleanNode }]) === null,
    "makeNodeUpdateEntry:before 含 function → 整份 entry null"
  );
  const okBefore = createCanvasNode({ id: "okm", type: "text", position: { x: 0, y: 0 } });
  const okAfter = { ...okBefore, position: { x: 9, y: 9 } };
  ok(
    makeNodeUpdateEntry([
      { before: okBefore, after: okAfter },
      { before: cleanNode, after: fnNode },
    ]) === null,
    "makeNodeUpdateEntry:任一 pair 不可克隆 → 整份 entry null(合法 pair 也不单独产出,无部分 ops)"
  );

  const replayBase = createCanvasNode({ id: "replay-detach", type: "text" });
  const replayNext = {
    ...replayBase,
    data: { ...replayBase.data, params: { nested: { v: 1 } } },
  };
  const replayEntry = makeHistoryEntry(
    { nodes: [replayBase], edges: [], groups: [] },
    { nodes: [replayNext], edges: [], groups: [] }
  );
  ok(replayEntry !== null, "重放解耦控制项可建 history entry");
  const replayResult = replayEntry
    ? applyOpsToDoc({ nodes: [replayBase], edges: [], groups: [] }, replayEntry.forward)
    : { ok: false };
  ok(replayResult.ok, "重放解耦控制项 apply 成功");
  if (replayResult.ok) replayResult.doc.nodes[0].data.params.nested.v = 9;
  const replayForward = replayEntry?.forward.find((op) => op.entity === "node" && op.op === "update");
  eq(replayForward?.next?.data?.params?.nested?.v, 1, "修改重放结果不污染 history forward 载荷");
  eq(replayNext.data.params.nested.v, 1, "修改重放结果不污染原 candidate");

  // (3) store.updateNodeData 写不可克隆 params → false;nodes/editAnchor/past/future 四者深等不变(原子性预检)。
  hydrate();
  const ufId = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const snapNodes = JSON.stringify(store().nodes);
  const snapPast = store().past.length;
  const snapFuture = store().future.length;
  const snapAnchor = store().editAnchor;
  ok(
    store().updateNodeData(ufId, { params: { fn: () => 1 } }) === false,
    "updateNodeData({params:{fn}}) → false(预检拒绝不可克隆)"
  );
  ok(
    store().updateNodeData(ufId, { params: { when: new Date("2020-01-01T00:00:00.000Z") } }) === false,
    "updateNodeData({params:{Date}}) → false(拒绝非 JSON 载荷)"
  );
  ok(
    store().updateNodeData(ufId, { params: { lookup: new Map([["x", 1]]) } }) === false,
    "updateNodeData({params:{Map}}) → false(拒绝非 JSON 载荷)"
  );
  eq(JSON.stringify(store().nodes), snapNodes, "拒绝后 nodes 深等不变");
  eq(store().past.length, snapPast, "拒绝后 past 不变");
  eq(store().future.length, snapFuture, "拒绝后 future 不变");
  ok(store().editAnchor === snapAnchor, "拒绝后 editAnchor 不变(未开会话)");

  // (4) 防御 rollback:先建立正常 editAnchor → 注入不可克隆 current node → commitTextEdit 回滚到 anchor.base。
  hydrate();
  const rbId = store().addNode({ id: "rb", type: "text", position: { x: 0, y: 0 } });
  ok(store().updateNodeData(rbId, { title: "clean" }) === true, "开合法文本会话(base=会话起点,预检通过)");
  ok(store().editAnchor && store().editAnchor.nodeId === rbId, "editAnchor 已建立");
  const rbPast = store().past.length;
  const rbFuture = store().future.length;
  // 绕过预检直接注入不可克隆 fn(setState 对象形式不过 immer produce,fn 不被冻结/丢弃):模拟极端防御场景。
  useCanvasStore.setState({
    nodes: store().nodes.map((n) =>
      n.id === rbId ? { ...n, data: { ...n.data, params: { fn: () => 1 } } } : n
    ),
  });
  ok(
    typeof store().nodes.find((n) => n.id === rbId).data.params.fn === "function",
    "已注入不可克隆 fn(current 脏)"
  );
  store().commitTextEdit(); // flushTextSession:净变化但 entry===null → 回滚该 node 到 anchor.base
  const rbNode = store().nodes.find((n) => n.id === rbId);
  ok(
    rbNode && (rbNode.data.params === undefined || !("fn" in rbNode.data.params)),
    "防御 rollback:current 回滚到 anchor.base(不可克隆 fn 消失)"
  );
  eq(rbNode?.data?.title, undefined, "防御 rollback 恢复到会话起点 anchor.base(title 回 undefined)");
  ok(store().editAnchor === null, "防御 rollback 后清空 editAnchor");
  eq(store().past.length, rbPast, "防御 rollback 不入 past(entry===null 不 push)");
  eq(store().future.length, rbFuture, "防御 rollback 不污染 future");

  // (5) planDuplicate:不可克隆 params / 坐标溢出 → 不抛、返回 null、输入 doc 不变(纯 planner 原子失败)。
  const pdFn = createCanvasNode({ id: "pdfn", type: "text", position: { x: 0, y: 0 } });
  const pdFnDoc = { nodes: [{ ...pdFn, data: { ...pdFn.data, params: { fn: () => 1 } } }], edges: [], groups: [] };
  const pdFnNodeRef = pdFnDoc.nodes[0];
  let pdFnThrew = false;
  let pdFnResult;
  try {
    pdFnResult = planDuplicate(pdFnDoc, ["pdfn"], { withEdges: false, offset: { x: 24, y: 24 } });
  } catch {
    pdFnThrew = true;
  }
  ok(!pdFnThrew, "planDuplicate(function params) 不抛");
  ok(pdFnResult === null, "planDuplicate:function params 不可克隆 → null");
  ok(
    pdFnDoc.nodes.length === 1 && pdFnDoc.nodes[0] === pdFnNodeRef && typeof pdFnNodeRef.data.params.fn === "function",
    "planDuplicate 失败不改输入 doc(引用/长度/fn 均不变)"
  );

  const pdSym = createCanvasNode({ id: "pdsym", type: "text", position: { x: 0, y: 0 } });
  const pdSymDoc = { nodes: [{ ...pdSym, data: { ...pdSym.data, params: { s: Symbol("k") } } }], edges: [], groups: [] };
  const pdSymNodeRef = pdSymDoc.nodes[0];
  let pdSymThrew = false;
  let pdSymResult;
  try {
    pdSymResult = planDuplicate(pdSymDoc, ["pdsym"], { withEdges: false, offset: { x: 24, y: 24 } });
  } catch {
    pdSymThrew = true;
  }
  ok(!pdSymThrew, "planDuplicate(symbol params) 不抛");
  ok(pdSymResult === null, "planDuplicate:symbol params 不可克隆 → null");
  ok(
    pdSymDoc.nodes.length === 1 && pdSymDoc.nodes[0] === pdSymNodeRef && typeof pdSymNodeRef.data.params.s === "symbol",
    "planDuplicate 失败不改输入 doc(symbol 场景:引用/长度/symbol 均不变)"
  );

  const pdBig = createCanvasNode({ id: "pdbig", type: "text", position: { x: Number.MAX_VALUE, y: Number.MAX_VALUE } });
  const pdBigDoc = { nodes: [pdBig], edges: [], groups: [] };
  const pdBigSnap = JSON.stringify(pdBigDoc);
  let pdBigThrew = false;
  let pdBigResult;
  try {
    pdBigResult = planDuplicate(pdBigDoc, ["pdbig"], {
      withEdges: false,
      offset: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
    });
  } catch {
    pdBigThrew = true;
  }
  ok(!pdBigThrew, "planDuplicate(MAX_VALUE 坐标 + MAX_VALUE offset) 不抛");
  ok(pdBigResult === null, "planDuplicate:MAX_VALUE + MAX_VALUE offset → 最终 Infinity → null");
  eq(JSON.stringify(pdBigDoc), pdBigSnap, "planDuplicate 溢出失败不改输入 doc(深等不变)");

  // (6) projectGroupFrames:真实 node 占用 base/:1 → 让位到 :2;第二组基础候选撞前一 frame → 同批互避;稳定 + 唯一。
  const gBase = GROUP_FRAME_ID_PREFIX + "g"; // "__group:g"
  const occNodes = [
    { id: gBase, position: { x: 0, y: 0 } }, // 真实 node 占 base
    { id: gBase + ":1", position: { x: 10, y: 10 } }, // 真实 node 占 :1
    { id: "gm1", position: { x: 100, y: 100 } }, // group g 成员
    { id: "gm2", position: { x: 200, y: 200 } },
  ];
  const occFrames = projectGroupFrames([{ id: "g", label: "", node_ids: ["gm1", "gm2"] }], occNodes);
  eq(occFrames.length, 1, "占位场景:1 组 → 1 组框");
  eq(occFrames[0].id, gBase + ":2", "真实 node 占 base 与 :1 → group g 组框让位到 __group:g:2");

  const batchNodes = [
    { id: gBase, position: { x: 0, y: 0 } }, // 占 base
    { id: gBase + ":1", position: { x: 10, y: 10 } }, // 占 :1
    { id: "bm1", position: { x: 100, y: 0 } }, // group g 成员
    { id: "bm2", position: { x: 200, y: 0 } },
    { id: "bn1", position: { x: 300, y: 0 } }, // group g:2 成员
    { id: "bn2", position: { x: 400, y: 0 } },
  ];
  const batchGroups = [
    { id: "g", label: "", node_ids: ["bm1", "bm2"] }, // → __group:g:2(base,:1 被真实 node 占)
    { id: "g:2", label: "", node_ids: ["bn1", "bn2"] }, // 基础候选 __group:g:2 与前一 frame 撞 → 同批互避
  ];
  const batchFrames = projectGroupFrames(batchGroups, batchNodes);
  eq(batchFrames.length, 2, "两组 → 两组框");
  eq(batchFrames[0].id, gBase + ":2", "组 g:base 与 :1 被真实 node 占 → __group:g:2");
  eq(batchFrames[1].id, gBase + ":2:1", "组 g:2:基础候选 __group:g:2 与前一 frame 撞 → 同批互避到 __group:g:2:1");
  ok(batchFrames[0].id !== batchFrames[1].id, "同批两 frame id 互不相同");
  const allBatchIds = [...batchNodes.map((n) => n.id), ...batchFrames.map((f) => f.id)];
  eq(new Set(allBatchIds).size, allBatchIds.length, "真实 node id + 组框 id 全体唯一(无碰撞)");
  const batchFrames2 = projectGroupFrames(batchGroups, batchNodes);
  eq(
    batchFrames2.map((f) => f.id),
    batchFrames.map((f) => f.id),
    "相同输入重复调用组框 id 完全稳定(确定性,无随机/持久化)"
  );

  // (6b) frame id 分配按 canonical group-id 字典序,与传入 group 数组顺序无关 ——
  // remove→undo 把组 append 到末尾改变数组序,不得让同一 group 的 synthetic frame id 漂移。
  const orderNodes = [
    { id: GROUP_FRAME_ID_PREFIX + "g", position: { x: 0, y: 0 } }, // 占 __group:g
    { id: GROUP_FRAME_ID_PREFIX + "g:1", position: { x: 10, y: 10 } }, // 占 __group:g:1
    { id: "og1", position: { x: 100, y: 0 } }, // group g 成员
    { id: "og2", position: { x: 200, y: 0 } },
    { id: "oh1", position: { x: 300, y: 0 } }, // group g:2 成员
    { id: "oh2", position: { x: 400, y: 0 } },
  ];
  const groupG = { id: "g", label: "分镜G", node_ids: ["og1", "og2"] };
  const groupG2 = { id: "g:2", label: "分镜G2", node_ids: ["oh1", "oh2"] };
  const labelToFrameId = (fs) => Object.fromEntries(fs.map((f) => [f.data.label, f.id]));
  const forwardFrames = projectGroupFrames([groupG, groupG2], orderNodes);
  const reverseFrames = projectGroupFrames([groupG2, groupG], orderNodes);
  eq(
    labelToFrameId(forwardFrames),
    labelToFrameId(reverseFrames),
    "frame id 分配与传入 group 数组顺序无关([g,g:2] 与 [g:2,g] 得同一 label→frameId 映射)"
  );
  // 模拟 remove(g) 后以**末尾 append** 恢复 → 数组变 [g:2, g];映射仍与原始一致(无 synthetic id 漂移)。
  const afterRemoveUndoFrames = projectGroupFrames([groupG2, groupG], orderNodes);
  eq(
    labelToFrameId(afterRemoveUndoFrames),
    labelToFrameId(forwardFrames),
    "remove→undo 末尾 append 后 label→frameId 映射不变(canonical 序不受数组顺序影响)"
  );
  eq(
    labelToFrameId(forwardFrames),
    { "分镜G": GROUP_FRAME_ID_PREFIX + "g:2", "分镜G2": GROUP_FRAME_ID_PREFIX + "g:2:1" },
    "canonical 分配:g→__group:g:2、g:2→__group:g:2:1(与真实 __group:g、__group:g:1 占位避碰)"
  );

  // (6c) positionsById 特殊键安全(lookupDuplicatePosition):Map 得精确落点;普通对象仅取自有属性,继承 __proto__ 不当落点。
  const ppNode = createCanvasNode({ id: "__proto__", type: "text", position: { x: 0, y: 0 } });
  const ppMap = new Map([["__proto__", { x: 512, y: 640 }]]);
  const ppPlan = planDuplicate({ nodes: [ppNode], edges: [], groups: [] }, ["__proto__"], {
    withEdges: false,
    positionsById: ppMap,
  });
  ok(ppPlan !== null, "positionsById:id=__proto__ 经 Map 复制成功");
  const ppCopy = ppPlan && ppPlan.doc.nodes.find((n) => ppPlan.newNodeIds.includes(n.id));
  eq(
    ppCopy?.position,
    { x: 512, y: 640 },
    "positionsById:Map.get(__proto__) 得精确绝对落点(不被原型链吞、不丢落点)"
  );
  // 空普通 Record:hasOwnProperty("__proto__") 为 false(继承访问器) → 不当 position,安全 fallback 到 原位+offset。
  const inhNode = createCanvasNode({ id: "__proto__", type: "text", position: { x: 10, y: 20 } });
  const inhPlan = planDuplicate({ nodes: [inhNode], edges: [], groups: [] }, ["__proto__"], {
    withEdges: false,
    positionsById: {},
    offset: { x: 7, y: 7 },
  });
  ok(inhPlan !== null, "positionsById:空 Record + id=__proto__ 复制成功");
  const inhCopy = inhPlan && inhPlan.doc.nodes.find((n) => inhPlan.newNodeIds.includes(n.id));
  eq(
    inhCopy?.position,
    { x: 17, y: 27 },
    "空 Record:继承 __proto__ 不当 own position → 安全 fallback 原位+offset"
  );

  // (6d) 工厂 try/catch 运行覆盖:畸形但可直传纯 planner 的 JS doc,触发 create* 抛错 → 不外抛、返回 null、输入不变。
  // ① planGroupNodes → createCanvasGroup 抛错(成员 id 含空格,非法 CanvasId;planner 只读 node.id/group_id 故可直传)。
  const badGroupDoc = {
    nodes: [
      { id: "bad id a", group_id: null },
      { id: "bad id b", group_id: null },
    ],
    edges: [],
    groups: [],
  };
  const badGroupSnap = JSON.stringify(badGroupDoc);
  let groupThrew = false;
  let groupResult;
  try {
    groupResult = planGroupNodes(badGroupDoc, ["bad id a", "bad id b"]);
  } catch {
    groupThrew = true;
  }
  ok(!groupThrew, "planGroupNodes:createCanvasGroup 抛错不外抛");
  ok(groupResult === null, "planGroupNodes:成员 id 非法致 createCanvasGroup 抛 → 返回 null");
  eq(JSON.stringify(badGroupDoc), badGroupSnap, "planGroupNodes 工厂失败输入 doc 深等不变");

  // ② planDuplicate → createCanvasNode 抛错(源 type 非白名单;data 可克隆、position 有限,过 clone/落点后在工厂抛)。
  const badNodeDoc = {
    nodes: [{ id: "bn1", type: "not-a-type", position: { x: 0, y: 0 }, group_id: null, data: { params: {} } }],
    edges: [],
    groups: [],
  };
  const badNodeSnap = JSON.stringify(badNodeDoc);
  let nodeThrew = false;
  let nodeResult;
  try {
    nodeResult = planDuplicate(badNodeDoc, ["bn1"], { withEdges: false, offset: { x: 5, y: 5 } });
  } catch {
    nodeThrew = true;
  }
  ok(!nodeThrew, "planDuplicate:createCanvasNode 抛错不外抛");
  ok(nodeResult === null, "planDuplicate:源 type 非法致 createCanvasNode 抛 → 返回 null");
  eq(JSON.stringify(badNodeDoc), badNodeSnap, "planDuplicate 节点工厂失败输入 doc 深等不变");

  // ③ planDuplicate withEdges → createCanvasEdge 抛错(两端合法节点可复制,内部边 sourceHandle 超长非法)。
  const bnA = createCanvasNode({ id: "bnA", type: "text", position: { x: 0, y: 0 } });
  const bnB = createCanvasNode({ id: "bnB", type: "text", position: { x: 50, y: 0 } });
  const badEdgeDoc = {
    nodes: [bnA, bnB],
    edges: [{ id: "be1", source: "bnA", target: "bnB", sourceHandle: "x".repeat(200), targetHandle: null }],
    groups: [],
  };
  const badEdgeSnap = JSON.stringify(badEdgeDoc);
  let edgeThrew = false;
  let edgeResult;
  try {
    edgeResult = planDuplicate(badEdgeDoc, ["bnA", "bnB"], { withEdges: true, offset: { x: 5, y: 5 } });
  } catch {
    edgeThrew = true;
  }
  ok(!edgeThrew, "planDuplicate(withEdges):createCanvasEdge 抛错不外抛");
  ok(
    edgeResult === null,
    "planDuplicate(withEdges):内部边 handle 超长致 createCanvasEdge 抛 → 整体返回 null(不产半份副本)"
  );
  eq(JSON.stringify(badEdgeDoc), badEdgeSnap, "planDuplicate 边工厂失败输入 doc 深等不变");

  // ------------------------------------------------------------------ ⑩
  console.log("⑩ 二轮复审:特殊键 id 拖动(__proto__/constructor/prototype)+ 不可克隆选中节点 begin 原子放弃");

  // 1) 逐个特殊 id 单选拖动:begin bases 精确、apply+end 落点/past 仅 +1/future 清空、undo 回原位。
  for (const sid of ["__proto__", "constructor", "prototype"]) {
    hydrate();
    const spId = store().addNode({ id: sid, type: "text", position: { x: 0, y: 0 } });
    eq(spId, sid, `建 id=${sid} 节点成功(schema 合法 id,Set/Map 校验不被原型链吞)`);
    // 造一个 future 项以验证拖动结束清空 redo。
    store().addNode({ id: `${sid}__x`, type: "text", position: { x: 500, y: 0 } });
    store().undo();
    eq(store().future.length, 1, `${sid}:拖动前 future=1(待验证清空)`);
    const pBefore = store().past.length;
    store().beginPositionDrag([sid]);
    const anchor = store().dragAnchor;
    ok(
      anchor &&
        Array.isArray(anchor.bases) &&
        anchor.bases.length === 1 &&
        anchor.bases[0].id === sid &&
        anchor.bases[0].base &&
        anchor.bases[0].base.id === sid &&
        anchor.bases[0].base.position.x === 0,
      `${sid}:begin 后 bases 恰含该特殊 id 的原始深拷 base(entry array 不被原型链吞)`
    );
    store().applyNodePositionChanges([{ type: "position", id: sid, position: { x: 40, y: 40 }, dragging: false }]);
    store().endPositionDrag();
    eq(node(sid)?.position, { x: 40, y: 40 }, `${sid}:apply+end 后位置改到落点`);
    eq(store().past.length, pBefore + 1, `${sid}:拖动结束 past 只增 1`);
    eq(store().future.length, 0, `${sid}:拖动结束清空 future(redo 失效)`);
    ok(store().undo() === true, `${sid}:undo 成功`);
    eq(node(sid)?.position, { x: 0, y: 0 }, `${sid}:undo 回原位`);
  }

  // 2) 同一 doc 多选三个特殊 id:一次 begin/各自 position/一次 end → bases 按 doc 顺序完整 3 项、past 仅 +1、一次 undo 全回原位。
  hydrate();
  store().addNode({ id: "__proto__", type: "text", position: { x: 0, y: 0 } });
  store().addNode({ id: "constructor", type: "text", position: { x: 100, y: 0 } });
  store().addNode({ id: "prototype", type: "text", position: { x: 200, y: 0 } });
  eq(store().nodes.length, 3, "多选:三个特殊 id 节点均建成");
  const pMultiSpecial = store().past.length;
  store().beginPositionDrag(["__proto__", "constructor", "prototype"]);
  eq(
    store().dragAnchor.bases.map((e) => e.id),
    ["__proto__", "constructor", "prototype"],
    "多选:bases 按 doc 顺序完整 3 项"
  );
  store().applyNodePositionChanges([
    { type: "position", id: "__proto__", position: { x: 5, y: 5 }, dragging: false },
    { type: "position", id: "constructor", position: { x: 105, y: 5 }, dragging: false },
    { type: "position", id: "prototype", position: { x: 205, y: 5 }, dragging: false },
  ]);
  store().endPositionDrag();
  eq(store().past.length, pMultiSpecial + 1, "多选:整段拖动合并成 1 个历史项(past 仅 +1)");
  store().undo();
  eq(node("__proto__")?.position, { x: 0, y: 0 }, "多选 undo:__proto__ 回原位");
  eq(node("constructor")?.position, { x: 100, y: 0 }, "多选 undo:constructor 回原位");
  eq(node("prototype")?.position, { x: 200, y: 0 }, "多选 undo:prototype 回原位");

  // 3) 选中含不可克隆 params.fn 的节点:begin 原子放弃(dragAnchor null);随后 position change 因历史构造 fail-closed 不改状态。
  hydrate();
  store().addNode({ id: "okdrag", type: "text", position: { x: 0, y: 0 } });
  store().addNode({ id: "baddrag", type: "text", position: { x: 100, y: 0 } });
  useCanvasStore.setState({
    nodes: store().nodes.map((n) =>
      n.id === "baddrag" ? { ...n, data: { ...n.data, params: { fn: () => 1 } } } : n
    ),
  });
  ok(typeof node("baddrag").data.params.fn === "function", "已注入不可克隆 fn 到选中节点 baddrag");
  const pBad = store().past.length;
  const fBad = store().future.length;
  const posBadBefore = { x: node("baddrag").position.x, y: node("baddrag").position.y };
  store().beginPositionDrag(["okdrag", "baddrag"]); // baddrag 不可克隆 → 整段 begin 原子放弃
  ok(store().dragAnchor === null, "选中含不可克隆节点 → begin 原子放弃(dragAnchor null,不部分锚定)");
  eq(store().past.length, pBad, "begin 放弃:past 不变");
  eq(store().future.length, fBad, "begin 放弃:future 不变");
  // begin 放弃 → 无拖动态,position change 走键盘分支:历史构造对含 fn 节点 fail-closed → 不写位置/past/future。
  store().applyNodePositionChanges([{ type: "position", id: "baddrag", position: { x: 140, y: 0 }, dragging: false }]);
  eq(node("baddrag")?.position, posBadBefore, "position change 因历史构造 fail-closed → baddrag 位置不变");
  eq(store().past.length, pBad, "fail-closed:past 不变");
  eq(store().future.length, fBad, "fail-closed:future 不变");

  // ------------------------------------------------------------------ ⑪
  console.log("⑪ 三轮复审:事务屏障(拖动中结构动作 / end clone 回滚 / flush 回滚后结构动作)");

  // A) 拖动中结构动作:begin→position→removeNode(同节点)。remove 自动先 finalize drag,past 恰 +2,两级 undo。
  hydrate();
  const dnA = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().beginPositionDrag([dnA]);
  store().applyNodePositionChanges([{ type: "position", id: dnA, position: { x: 40, y: 40 }, dragging: true }]);
  const pastBeforeRemoveA = store().past.length;
  store().removeNode(dnA); // 屏障:先 endPositionDrag 合并拖动为 1 项,再基于 fresh doc 删除
  ok(store().dragAnchor === null, "A: 结构动作前自动 finalize drag → dragAnchor null");
  eq(store().past.length, pastBeforeRemoveA + 2, "A: past 恰 +2(拖动 finalize 1 + 删除 1)");
  eq(store().nodes.length, 0, "A: 节点已删除");
  ok(store().undo() === true, "A: 第一次 undo 成功");
  eq(node(dnA)?.position, { x: 40, y: 40 }, "A: 第一次 undo 恢复到移动后节点(40,40)");
  ok(store().undo() === true, "A: 第二次 undo 成功");
  eq(node(dnA)?.position, { x: 0, y: 0 }, "A: 第二次 undo 回原位(0,0,栈未卡死)");

  // B) end clone 失败:正常 begin → 注入 params.fn 并改位置 → end。节点完整回滚 anchor.base、anchor 清、past/future 不变。
  hydrate();
  const dnB = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().beginPositionDrag([dnB]);
  const pastB = store().past.length;
  const futureB = store().future.length;
  // 对象形式 setState 不过 immer produce → fn 保留;模拟拖动后 current 变得不可克隆且位置已改。
  useCanvasStore.setState({
    nodes: store().nodes.map((n) =>
      n.id === dnB ? { ...n, position: { x: 50, y: 50 }, data: { ...n.data, params: { fn: () => 1 } } } : n
    ),
  });
  ok(
    typeof node(dnB).data.params.fn === "function" && node(dnB).position.x === 50,
    "B: 已注入不可克隆 fn 且改位置(current 脏)"
  );
  store().endPositionDrag();
  const bNode = node(dnB);
  eq(bNode?.position, { x: 0, y: 0 }, "B: end clone 失败 → 位置完整回滚到 anchor.base(0,0)");
  ok(bNode && (bNode.data.params === undefined || !("fn" in bNode.data.params)), "B: end 回滚:注入的 params.fn 消失");
  ok(store().dragAnchor === null, "B: end 后 dragAnchor 清空");
  eq(store().past.length, pastB, "B: 回滚路径 past 不变");
  eq(store().future.length, futureB, "B: 回滚路径 future 不变");

  // C) flush 回滚后结构动作:A 建 editAnchor → 注入不可克隆 current → removeNode(B)。屏障先回滚 A,再基于 fresh doc 删 B。
  hydrate();
  const cnA = store().addNode({ id: "cnA", type: "text", position: { x: 0, y: 0 } });
  const cnB = store().addNode({ id: "cnB", type: "text", position: { x: 100, y: 0 } });
  ok(store().updateNodeData(cnA, { title: "clean" }) === true, "C: A updateNodeData 建 editAnchor");
  ok(store().editAnchor && store().editAnchor.nodeId === cnA, "C: editAnchor 指向 A");
  const pastC = store().past.length;
  useCanvasStore.setState({
    nodes: store().nodes.map((n) =>
      n.id === cnA ? { ...n, data: { ...n.data, params: { fn: () => 1 } } } : n
    ),
  });
  store().removeNode(cnB);
  const cnAAfter = node(cnA);
  eq(cnAAfter?.data?.title, undefined, "C: 屏障先把 A 回滚到 anchor.base(title 消失)");
  ok(cnAAfter && (cnAAfter.data.params === undefined || !("fn" in cnAAfter.data.params)), "C: A 回滚:注入的 fn 消失");
  ok(store().editAnchor === null, "C: flush 后 editAnchor 清空");
  ok(node(cnB) === undefined, "C: B 基于屏障后 fresh doc 真正删除");
  eq(store().nodes.length, 1, "C: 仅剩 A");
  eq(store().past.length, pastC + 1, "C: 历史只记录删除(past 仅 +1,flush 回滚不入栈)");
  ok(store().undo() === true, "C: undo 成功");
  ok(node(cnB) !== undefined, "C: undo 恢复被删的 B");
  eq(store().nodes.length, 2, "C: undo 后 A、B 都在");

  // C2) removeEntities 同样走屏障(flush 回滚 → fresh doc 删除)。
  hydrate();
  const ceA = store().addNode({ id: "ceA", type: "text", position: { x: 0, y: 0 } });
  const ceB = store().addNode({ id: "ceB", type: "text", position: { x: 100, y: 0 } });
  store().updateNodeData(ceA, { title: "clean" });
  const pastCE = store().past.length;
  useCanvasStore.setState({
    nodes: store().nodes.map((n) =>
      n.id === ceA ? { ...n, data: { ...n.data, params: { fn: () => 1 } } } : n
    ),
  });
  store().removeEntities([ceB], []);
  eq(node(ceA)?.data?.title, undefined, "C2: removeEntities 前屏障回滚 A(title 消失)");
  ok(store().editAnchor === null, "C2: editAnchor 清空");
  ok(node(ceB) === undefined, "C2: B 基于 fresh doc 删除");
  eq(store().past.length, pastCE + 1, "C2: 历史只记录删除(+1)");
  ok(store().undo() === true, "C2: undo 成功");
  ok(node(ceB) !== undefined, "C2: undo 恢复 B");

  // D) 拖动与文本编辑不能重叠:合法文本写入先 finalize drag,再单独建立文本会话。
  hydrate();
  const overlapId = store().addNode({ id: "drag-text-overlap", type: "text", position: { x: 0, y: 0 } });
  const overlapPast = store().past.length;
  store().beginPositionDrag([overlapId]);
  store().applyNodePositionChanges([
    { type: "position", id: overlapId, position: { x: 10, y: 0 }, dragging: true },
  ]);
  ok(store().updateNodeData(overlapId, { title: "during drag" }) === true, "D: 拖动中 updateNodeData 成功");
  ok(store().dragAnchor === null, "D: updateNodeData 前先 finalize drag");
  ok(store().editAnchor?.nodeId === overlapId, "D: 文本会话在拖动结束后独立建立");
  store().commitTextEdit();
  eq(store().past.length, overlapPast + 2, "D: 历史恰两项(拖动 1 + 文本 1)");
  ok(store().undo() === true, "D: 第一次 undo 撤文本成功");
  eq(node(overlapId)?.data?.title, undefined, "D: 第一次 undo 只撤 title");
  eq(node(overlapId)?.position, { x: 10, y: 0 }, "D: 第一次 undo 保留移动后位置");
  ok(store().undo() === true, "D: 第二次 undo 撤拖动成功(栈不卡死)");
  eq(node(overlapId)?.position, { x: 0, y: 0 }, "D: 第二次 undo 回原位");

  // E) 无效文本补丁不能仅因尝试失败就 finalize 当前拖动。
  hydrate();
  const invalidDuringDragId = store().addNode({ id: "invalid-during-drag", type: "text" });
  store().beginPositionDrag([invalidDuringDragId]);
  store().applyNodePositionChanges([
    { type: "position", id: invalidDuringDragId, position: { x: 7, y: 3 }, dragging: true },
  ]);
  const invalidDragPast = store().past.length;
  const invalidDragAnchor = store().dragAnchor;
  ok(
    store().updateNodeData(invalidDuringDragId, { params: { when: new Date() } }) === false,
    "E: 拖动中无效 Date 补丁仍原子拒绝"
  );
  ok(store().dragAnchor === invalidDragAnchor, "E: 拒绝补丁不结束/替换 dragAnchor");
  eq(store().past.length, invalidDragPast, "E: 拒绝补丁不写历史");
  eq(node(invalidDuringDragId)?.position, { x: 7, y: 3 }, "E: 拒绝补丁不回滚当前拖动帧");
  ok(store().editAnchor === null, "E: 拒绝补丁不开文本会话");
  store().endPositionDrag();

  // ------------------------------------------------------------------ ⑧
  console.log("⑧ 源码卫生:S4 新增/改动源无 NUL/控制字");
  const hygieneFiles = [
    join(ROOT, "src", "lib", "canvas", "history.ts"),
    join(ROOT, "src", "lib", "canvas", "group-ops.ts"),
    join(ROOT, "src", "stores", "canvas-store.ts"),
    join(CANVAS, "group-frame.ts"),
    join(CANVAS, "canvas-command-shortcuts.ts"),
    join(CANVAS, "use-canvas-command-shortcuts.ts"),
    join(CANVAS, "canvas-board.tsx"),
    join(CANVAS, "canvas-batch-delete-dialog.tsx"),
    join(CANVAS, "nodes", "group-frame-node.tsx"),
  ];
  for (const filePath of hygieneFiles) {
    const src = readFileSync(filePath, "utf8");
    let badAt = -1;
    for (let i = 0; i < src.length; i += 1) {
      const code = src.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        badAt = i;
        break;
      }
    }
    ok(badAt === -1, `${filePath.split(/[\\/]/).pop()} 无 NUL/控制字(位置 ${badAt})`);
  }

  // 二轮复审源码卫生:拖动锚结构 + 深拷纪律(禁 Record<string,实体> 锚、禁 JSON 克隆 fallback)。
  const storeSrc = readFileSync(join(ROOT, "src", "stores", "canvas-store.ts"), "utf8");
  ok(!storeSrc.includes("baseById"), "store 源码无 baseById 残留(dragAnchor 改用 bases entry array)");
  ok(
    !storeSrc.includes("Record<string, CanvasNode>"),
    "store 无 Record<string, CanvasNode> 锚(禁普通对象按 id 存实体,免 __proto__ 等键被原型链吞)"
  );
  const historySrc = readFileSync(join(ROOT, "src", "lib", "canvas", "history.ts"), "utf8");
  const groupOpsSrc = readFileSync(join(ROOT, "src", "lib", "canvas", "group-ops.ts"), "utf8");
  ok(
    !historySrc.includes("JSON.parse(JSON.stringify"),
    "history.ts 无 JSON.parse(JSON.stringify 克隆 fallback(cloneCanvasEntity 仅 structuredClone)"
  );
  ok(
    !groupOpsSrc.includes("JSON.parse(JSON.stringify"),
    "group-ops.ts 无 JSON.parse(JSON.stringify 克隆 fallback(cloneNodeData 仅 structuredClone)"
  );
  const boardSrc = readFileSync(join(CANVAS, "canvas-board.tsx"), "utf8");
  ok(
    !boardSrc.includes("positionsById[id]"),
    "canvas-board 拖拽复制不再用 positionsById[id](改 Map.set,免 __proto__ 键写污染原型/丢精确落点)"
  );
  ok(
    /positionsById\s*=\s*new Map<string, CanvasPosition>\(\)/.test(boardSrc),
    "canvas-board 拖拽复制 positionsById 用 Map<string, CanvasPosition>"
  );
  // onNodesChange:抑制门在任何 setViewNodes/applyNodePositionChanges 之前调用,抑制分支 sync+return 也在其前。
  ok(
    boardSrc.includes("shouldSuppressCanvasNodeChanges("),
    "canvas-board onNodesChange 调用 shouldSuppressCanvasNodeChanges"
  );
  const onNodesChangeIdx = boardSrc.indexOf("const onNodesChange");
  const suppressCallIdx = boardSrc.indexOf("shouldSuppressCanvasNodeChanges(", onNodesChangeIdx);
  const setViewApplyIdx = boardSrc.indexOf("const nextViewNodes = applyNodeChanges(changes", onNodesChangeIdx);
  ok(
    onNodesChangeIdx !== -1 && suppressCallIdx !== -1 && setViewApplyIdx !== -1 && suppressCallIdx < setViewApplyIdx,
    "canvas-board onNodesChange:抑制检查在 applyNodeChanges 之前"
  );
  const syncCallIdx = boardSrc.indexOf("syncViewNodesFromDomain(viewOnlyChanges)", suppressCallIdx);
  const suppressReturnIdx = boardSrc.indexOf("return;", suppressCallIdx);
  ok(
    syncCallIdx !== -1 && suppressReturnIdx !== -1 && syncCallIdx < setViewApplyIdx && suppressReturnIdx < setViewApplyIdx,
    "canvas-board 抑制分支:保留 viewOnlyChanges 的领域重同步+return 在普通 apply 前"
  );
  const syncDefinitionIdx = boardSrc.indexOf("const syncViewNodesFromDomain");
  const clearDraggingIdx = boardSrc.indexOf("clearCanvasDraggingFlags(", syncDefinitionIdx);
  ok(
    syncDefinitionIdx !== -1 && clearDraggingIdx !== -1 && clearDraggingIdx < onNodesChangeIdx,
    "canvas-board 领域重同步统一 clearCanvasDraggingFlags(终止残余 dragging:true)"
  );
  ok(
    boardSrc.includes("changes.filter(isCanvasViewOnlyNodeChange)"),
    "canvas-board 只读/抑制分支拆出 select+dimensions 视图态"
  );
  const terminalGuardCount = (boardSrc.match(/if \(terminalDragFrame\) endDrag\(\);/g) ?? []).length;
  eq(terminalGuardCount, 2, "canvas-board 正常/抑制两条路径都由 dragging:false 终止帧收口 endDrag");
  ok(
    boardSrc.includes("autoPanOnNodeDrag={false}"),
    "canvas-board P0 关闭不可取消的 node auto-pan，消除触摸取消后的 RAF 尾帧生产者"
  );

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S4 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S4 聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
