#!/usr/bin/env node
/**
 * 超级画布 · S5 聚焦验证(离线,零测试运行器)
 *
 * 断言:① 空态门控 + 4 引导;② 底部工具栏 gating(7 入口、P0 点亮 add-node/shortcuts);
 * ③ 布局确定性/健壮性(0/1/孤立/环、无 NaN、不重叠、幂等);④ store.applyNodePositions
 * (只读拦截、只写 position、RF 字段不泄漏);⑤ Alt+Shift+F 快捷键焦点/修饰键守卫。
 *
 * 运行:node scripts/verify-canvas-s5.mjs   (失败退出码 1)
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

/** 真正的不重叠:固定 208×96 盒,任意两节点 |dx|>=W 或 |dy|>=H(非仅坐标不同)。 */
function assertNoOverlap(updates, label) {
  const W = 208;
  const H = 96;
  for (let i = 0; i < updates.length; i += 1) {
    for (let j = i + 1; j < updates.length; j += 1) {
      const a = updates[i].position;
      const b = updates[j].position;
      if (Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H) {
        ok(false, `${label}:节点 ${updates[i].id}/${updates[j].id} 盒重叠`);
        return;
      }
    }
  }
  ok(true, `${label}:无重叠(208×96 盒分离)`);
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
  await loadCanvasModule("rf-adapter");
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
  const layout = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-layout.ts"),
    "canvas-layout.mjs"
  );
  const chrome = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-chrome-policy.ts"),
    "canvas-chrome-policy.mjs"
  );
  const keyPolicy = await loadExtra(
    join(ROOT, "src", "components", "canvas", "tab-create-policy.ts"),
    "tab-create-policy.mjs"
  );

  const { createCanvasNode, createCanvasEdge } = schema;
  const { useCanvasStore } = storeMod;
  const { layoutCanvasNodes } = layout;
  const { shouldShowEmptyState, EMPTY_STATE_GUIDE_TYPES, BOTTOM_TOOLBAR_ENTRIES } = chrome;
  const { shouldTidyCanvas } = keyPolicy;
  const store = () => useCanvasStore.getState();
  const hydrate = () => {
    store().reset();
    store().initializeEmptyDoc();
  };

  // ------------------------------------------------------------------ ①
  console.log("① 空态门控 + 4 起点引导");
  ok(shouldShowEmptyState(0, 0) === true, "无节点无 broken → 显示空态");
  ok(shouldShowEmptyState(1, 0) === false, "有节点 → 不显示");
  ok(shouldShowEmptyState(0, 1) === false, "有 broken → 不显示");
  ok(shouldShowEmptyState(3, 2) === false, "都有 → 不显示");
  eq([...EMPTY_STATE_GUIDE_TYPES], ["text", "image", "product", "script"], "4 起点引导类型");

  // ------------------------------------------------------------------ ②
  console.log("② 底部工具栏 gating");
  eq(BOTTOM_TOOLBAR_ENTRIES.map((e) => e.id), [
    "add-node",
    "workflow",
    "assets",
    "characters",
    "history",
    "shortcuts",
    "tutorial",
  ], "7 入口顺序=看板");
  eq(
    BOTTOM_TOOLBAR_ENTRIES.filter((e) => e.enabled).map((e) => e.id),
    ["add-node", "shortcuts"],
    "P0 只点亮 add-node/shortcuts"
  );
  eq(
    BOTTOM_TOOLBAR_ENTRIES.filter((e) => !e.enabled).map((e) => e.id),
    ["workflow", "assets", "characters", "history", "tutorial"],
    "其余 5 入口 disabled"
  );
  // 静态断言:disabled 按钮由可聚焦 span 包裹(disabled Button 不接 pointer/focus,否则 tooltip 不可达)。
  const toolbarSrc = readFileSync(
    join(ROOT, "src", "components", "canvas", "canvas-bottom-toolbar.tsx"),
    "utf8"
  );
  ok(toolbarSrc.includes('aria-disabled="true"'), "disabled 外层 span 标 aria-disabled(tooltip 可达)");
  ok(toolbarSrc.includes("tabIndex={0}"), "disabled 外层 span 可键盘聚焦");
  ok(!toolbarSrc.includes('role="button"'), "外层 span 去 role=button(避免嵌套交互语义)");
  ok(toolbarSrc.includes("aria-hidden={disabled"), "内层禁用按钮 aria-hidden(名称交外层 span)");
  ok(toolbarSrc.includes("tabIndex={disabled ? -1"), "内层禁用按钮移出 tab 序(tabIndex=-1)");

  // ------------------------------------------------------------------ ③
  console.log("③ 布局确定性 / 健壮性");
  const layoutSrc = readFileSync(
    join(ROOT, "src", "components", "canvas", "canvas-layout.ts"),
    "utf8"
  );
  ok(!layoutSrc.includes(String.fromCharCode(0)), "canvas-layout.ts 源码不含 NUL 字符");
  eq(layoutCanvasNodes([], []), [], "0 节点 → 空");
  const single = layoutCanvasNodes([createCanvasNode({ id: "n1", type: "text", position: { x: 0, y: 0 } })], []);
  eq(single.length, 1, "1 节点 → 1 更新");
  ok(Number.isFinite(single[0].position.x) && Number.isFinite(single[0].position.y), "1 节点坐标有限");

  const chain = [
    createCanvasNode({ id: "a", type: "text", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "b", type: "image", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "c", type: "product", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "iso", type: "script", position: { x: 0, y: 0 } }),
  ];
  const chainEdges = [
    createCanvasEdge({ id: "e_ab", source: "a", target: "b" }),
    createCanvasEdge({ id: "e_bc", source: "b", target: "c" }),
  ];
  const laid1 = layoutCanvasNodes(chain, chainEdges);
  const laid2 = layoutCanvasNodes(chain, chainEdges);
  eq(laid1.length, 4, "4 节点(含孤立)全部有更新");
  ok(laid1.every((u) => Number.isFinite(u.position.x) && Number.isFinite(u.position.y)), "全部坐标有限(无 NaN)");
  assertNoOverlap(laid1, "chain+isolated");
  eq(laid1, laid2, "同输入两次布局结果一致(确定性)");
  // 同构图不同输入排列 → 完全相同位置(canonical 排序保证同构不变)
  const chainShuffled = [chain[3], chain[1], chain[0], chain[2]];
  const edgesShuffled = [chainEdges[1], chainEdges[0]];
  eq(layoutCanvasNodes(chainShuffled, edgesShuffled), laid1, "同构图不同排列 → 位置完全相同");

  // 环:不抛错、不 NaN
  const cyc = [
    createCanvasNode({ id: "x", type: "text", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "y", type: "text", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "z", type: "text", position: { x: 0, y: 0 } }),
  ];
  const cycEdges = [
    createCanvasEdge({ id: "e_xy", source: "x", target: "y" }),
    createCanvasEdge({ id: "e_yz", source: "y", target: "z" }),
    createCanvasEdge({ id: "e_zx", source: "z", target: "x" }),
  ];
  const laidCyc = layoutCanvasNodes(cyc, cycEdges);
  eq(laidCyc.length, 3, "环:3 节点全布局");
  ok(laidCyc.every((u) => Number.isFinite(u.position.x) && Number.isFinite(u.position.y)), "环:坐标有限");

  // 多分量 + 多孤立:全布局、不重叠、排列无关
  const multi = ["p", "q", "r", "s", "i1", "i2", "i3"].map((id) =>
    createCanvasNode({ id, type: "text", position: { x: 0, y: 0 } })
  );
  const multiEdges = [
    createCanvasEdge({ id: "e_pq", source: "p", target: "q" }),
    createCanvasEdge({ id: "e_rs", source: "r", target: "s" }),
  ];
  const laidMulti = layoutCanvasNodes(multi, multiEdges);
  eq(laidMulti.length, 7, "多分量:7 节点全布局");
  assertNoOverlap(laidMulti, "multi-component");
  eq(
    layoutCanvasNodes([...multi].reverse(), [...multiEdges].reverse()),
    laidMulti,
    "多分量:输入反序 → 位置完全相同(排列无关)"
  );

  // 自环 / 悬空端 / 重复边:被 layout 守卫忽略,结果仍稳定确定
  const rn = [
    createCanvasNode({ id: "ra", type: "text", position: { x: 0, y: 0 } }),
    createCanvasNode({ id: "rb", type: "text", position: { x: 0, y: 0 } }),
  ];
  const re = [
    createCanvasEdge({ id: "e_dangling", source: "ghost", target: "ra" }),
    createCanvasEdge({ id: "e_self", source: "ra", target: "ra" }),
    createCanvasEdge({ id: "e_dup1", source: "ra", target: "rb" }),
    createCanvasEdge({ id: "e_dup2", source: "ra", target: "rb" }),
  ];
  const rlaid = layoutCanvasNodes(rn, re);
  eq(rlaid.length, 2, "自环/悬空/重复被忽略,仍布局 2 节点");
  ok(rlaid.every((u) => Number.isFinite(u.position.x) && Number.isFinite(u.position.y)), "坏边:坐标有限");
  assertNoOverlap(rlaid, "broken-edges");
  eq(layoutCanvasNodes([...rn].reverse(), [...re].reverse()), rlaid, "坏边:排列无关一致");

  // ------------------------------------------------------------------ ④
  console.log("④ store.applyNodePositions:只读拦截 / 只写 position / RF 字段不泄漏");
  hydrate();
  const nid = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const before = store().nodes.find((n) => n.id === nid);
  const beforeType = before.type;
  const beforeData = JSON.stringify(before.data);
  store().applyNodePositions([{ id: nid, position: { x: 128, y: 64 } }]);
  eq(store().nodes.find((n) => n.id === nid)?.position, { x: 128, y: 64 }, "写入 position");
  eq(store().nodes.find((n) => n.id === nid)?.type, beforeType, "不改 type");
  eq(JSON.stringify(store().nodes.find((n) => n.id === nid)?.data), beforeData, "不改 data");
  const node = store().nodes.find((n) => n.id === nid);
  const RF_VIEW = ["selected", "dragging", "measured", "width", "height", "positionAbsolute"];
  eq(RF_VIEW.filter((k) => k in node), [], "领域节点无 RF 视图字段");

  store().setReadOnly(true);
  store().applyNodePositions([{ id: nid, position: { x: 999, y: 999 } }]);
  eq(store().nodes.find((n) => n.id === nid)?.position, { x: 128, y: 64 }, "只读时不写 position");
  store().setReadOnly(false);

  // 非法坐标 / id 不污染领域(公共写入口不盲信布局)
  store().applyNodePositions([{ id: nid, position: { x: Number.NaN, y: 10 } }]);
  eq(store().nodes.find((n) => n.id === nid)?.position, { x: 128, y: 64 }, "NaN 坐标被丢弃");
  store().applyNodePositions([{ id: nid, position: { x: Number.POSITIVE_INFINITY, y: 10 } }]);
  eq(store().nodes.find((n) => n.id === nid)?.position, { x: 128, y: 64 }, "Infinity 坐标被丢弃");
  store().applyNodePositions([{ id: "", position: { x: 1, y: 1 } }]);
  store().applyNodePositions([{ id: "ghost", position: { x: 1, y: 1 } }]);
  store().applyNodePositions([{ id: nid, position: null }]);
  eq(store().nodes.find((n) => n.id === nid)?.position, { x: 128, y: 64 }, "空/不存在 id/缺 position 无副作用");

  // ------------------------------------------------------------------ ⑤
  console.log("⑤ Alt+Shift+F 焦点/修饰键守卫(shouldTidyCanvas)");
  const tidyBase = {
    code: "KeyF",
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    targetInteractive: false,
    inCanvasContext: true,
    readOnly: false,
  };
  ok(shouldTidyCanvas(tidyBase) === true, "Alt+Shift+F 画布上下文 → 整理");
  ok(shouldTidyCanvas({ ...tidyBase, ctrlKey: true }) === false, "加 Ctrl → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, metaKey: true }) === false, "加 Meta → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, shiftKey: false }) === false, "缺 Shift → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, altKey: false }) === false, "缺 Alt → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, code: "KeyG" }) === false, "非 F 键 → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, targetInteractive: true }) === false, "焦点在交互控件 → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, inCanvasContext: false }) === false, "非画布上下文 → 不触发");
  ok(shouldTidyCanvas({ ...tidyBase, readOnly: true }) === false, "只读 → 不触发");

  // 源码断言:tidy 直接调度 fitView(不经 pendingFit/effect,重复整理也框选)+ 双 rAF + cancel id
  const boardSrc = readFileSync(
    join(ROOT, "src", "components", "canvas", "canvas-board.tsx"),
    "utf8"
  );
  ok(!boardSrc.includes("pendingFitRef"), "tidy 不再用 pendingFitRef/effect(重复整理也框选)");
  ok(boardSrc.includes("scheduleFit();"), "tidy 直接调用 scheduleFit()");
  ok(
    (boardSrc.match(/requestAnimationFrame/g) || []).length >= 2,
    "fitView 用双 requestAnimationFrame 等提交"
  );
  ok(
    (boardSrc.match(/cancelAnimationFrame/g) || []).length >= 2,
    "持有 raf id,下次整理与 unmount 时 cancel"
  );

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S5 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S5 聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
