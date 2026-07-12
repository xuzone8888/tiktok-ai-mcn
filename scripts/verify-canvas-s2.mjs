#!/usr/bin/env node
/**
 * 超级画布 · S2 聚焦验证(离线,零测试运行器)
 *
 * 断言 S2「建节点五入口 + 连线」的纯逻辑与 store 契约:
 *   ① 建节点:6 类 + 默认文本、坐标/类型映射、readOnly 闸、media 只收 object key;
 *   ② 文件种类映射 canvasFileKind;
 *   ③ 上传结果只接受 OSS object key(extractUploadedObjectKey 拒 URL/dataURL);
 *   ④ 连线约束(canAddCanvasEdge/addEdge:禁自环/悬空/重复,readOnly 闸,handle 区分);
 *   ⑤ RF 视图字段绝不泄漏进 store。
 *
 * 运行:node scripts/verify-canvas-s2.mjs   (失败退出码 1)
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
function throws(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, msg);
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
  await loadCanvasModule("schema");
  await loadCanvasModule("patch");
  await loadCanvasModule("history");
  await loadCanvasModule("group-ops");
  await loadCanvasModule("rf-adapter");
  const schema = await import(
    `${pathToFileURL(join(OUT_DIR, "schema.mjs")).href}?t=${Date.now()}`
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
  const upload = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-upload.ts"),
    "canvas-upload.mjs",
    { "@/lib/canvas/schema": "./schema.mjs" }
  );
  const tabPolicy = await loadExtra(
    join(ROOT, "src", "components", "canvas", "tab-create-policy.ts"),
    "tab-create-policy.mjs"
  );

  const { NODE_TYPES } = schema;
  const { useCanvasStore, canAddCanvasEdge } = storeMod;
  const { canvasFileKind, extractUploadedObjectKey } = upload;
  const { shouldTabCreateNode } = tabPolicy;
  const store = () => useCanvasStore.getState();
  const hydrate = () => {
    store().reset();
    store().initializeEmptyDoc();
  };

  // ------------------------------------------------------------------ ①
  console.log("① 建节点五入口:类型/坐标映射 + readOnly 闸 + media 只收 object key");
  hydrate();
  NODE_TYPES.forEach((type, index) => {
    const position = { x: index * 10, y: index * 5 };
    const id = store().addNode({ type, position });
    ok(typeof id === "string" && id.length > 0, `addNode(${type}) 返回 id`);
    const node = store().nodes.find((n) => n.id === id);
    eq(node?.type, type, `建 ${type} 节点类型正确`);
    eq(node?.position, position, `建 ${type} 节点坐标准确`);
  });
  eq(store().nodes.length, NODE_TYPES.length, "六类各建一个");

  hydrate();
  const textId = store().addNode({ type: "text", position: { x: 7, y: 9 } });
  eq(store().nodes.find((n) => n.id === textId)?.type, "text", "默认文本节点");

  // readOnly 闸
  store().setReadOnly(true);
  ok(store().addNode({ type: "text", position: { x: 0, y: 0 } }) === null, "readOnly 时 addNode 返回 null");
  eq(store().nodes.length, 1, "readOnly 时不建节点");
  store().setReadOnly(false);

  // media 只收 object key
  const imgId = store().addNode({
    type: "image",
    position: { x: 1, y: 2 },
    data: { media: { ossKey: "studio/u123/a.jpg" } },
  });
  eq(
    store().nodes.find((n) => n.id === imgId)?.data?.media?.ossKey,
    "studio/u123/a.jpg",
    "media object key 落库"
  );
  const badId = store().addNode({
    type: "image",
    position: { x: 3, y: 4 },
    data: { media: { ossKey: "https://cdn.example.com/a.jpg?sig=1" } },
  });
  ok(badId === null, "media 为签名 URL 时 addNode 返回 null(不建半节点)");

  // ------------------------------------------------------------------ ②
  console.log("② 文件种类映射 canvasFileKind");
  eq(canvasFileKind("image/png"), "image", "image/png → image");
  eq(canvasFileKind("image/jpeg"), "image", "image/jpeg → image");
  eq(canvasFileKind("video/mp4"), "video", "video/mp4 → video");
  eq(canvasFileKind("application/pdf"), null, "pdf → null");
  eq(canvasFileKind(""), null, "空类型 → null");

  // ------------------------------------------------------------------ ③
  console.log("③ 上传结果只接受 OSS object key");
  eq(
    extractUploadedObjectKey("image", { success: true, data: { path: "studio/u/a.jpg", url: "https://cdn/a.jpg" } }),
    "studio/u/a.jpg",
    "image 取 data.path"
  );
  eq(
    extractUploadedObjectKey("video", { success: true, objectPath: "studio/u/v.mp4", url: "https://cdn/v.mp4" }),
    "studio/u/v.mp4",
    "video 取 objectPath"
  );
  throws(() => extractUploadedObjectKey("image", { data: { path: "https://cdn/a.jpg" } }), "path 是 URL → 拒");
  throws(() => extractUploadedObjectKey("image", { data: { path: "data:image/png;base64,AAAA" } }), "path 是 dataURL → 拒");
  throws(() => extractUploadedObjectKey("image", { data: {} }), "缺 path → 拒");
  throws(() => extractUploadedObjectKey("video", {}), "缺 objectPath → 拒");

  // ------------------------------------------------------------------ ④
  console.log("④ 连线约束:禁自环/悬空/重复 + readOnly 闸 + handle 区分");
  hydrate();
  const a = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const b = store().addNode({ type: "text", position: { x: 100, y: 0 } });

  ok(canAddCanvasEdge(store().nodes, store().edges, { source: a, target: b }) === true, "a→b 可连");
  const e1 = store().addEdge({ source: a, target: b });
  ok(typeof e1 === "string", "addEdge(a→b) 返回 edge id");
  eq(store().edges.length, 1, "建成 1 条 edge");

  ok(canAddCanvasEdge(store().nodes, store().edges, { source: a, target: a }) === false, "自环不可连");
  ok(store().addEdge({ source: a, target: a }) === null, "addEdge 自环返回 null");

  ok(store().addEdge({ source: a, target: b }) === null, "重复 edge 返回 null");
  eq(store().edges.length, 1, "重复不新增");

  ok(store().addEdge({ source: a, target: "ghost" }) === null, "悬空目标返回 null");
  ok(canAddCanvasEdge(store().nodes, store().edges, { source: null, target: b }) === false, "source 为 null 不可连");

  const e2 = store().addEdge({ source: a, target: b, sourceHandle: "h1" });
  ok(typeof e2 === "string", "handle 不同不算重复,可新增");
  eq(store().edges.length, 2, "handle 区分后 2 条");

  store().setReadOnly(true);
  ok(store().addEdge({ source: b, target: a }) === null, "readOnly 时 addEdge 返回 null");
  store().setReadOnly(false);

  // ------------------------------------------------------------------ ⑤
  console.log("⑤ RF 视图字段不泄漏进 store");
  hydrate();
  const n = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  store().applyNodePositionChanges([
    { type: "position", id: n, position: { x: 48, y: 16 } },
    { type: "select", id: n, selected: true },
    { type: "dimensions", id: n, dimensions: { width: 120, height: 40 } },
  ]);
  const persistedNode = store().nodes.find((x) => x.id === n);
  eq(persistedNode?.position, { x: 48, y: 16 }, "位置回写生效");
  const RF_VIEW = ["selected", "dragging", "measured", "width", "height", "dimensions", "positionAbsolute"];
  eq(RF_VIEW.filter((k) => k in persistedNode), [], "领域节点无 RF 视图字段");
  const c = store().addNode({ type: "text", position: { x: 200, y: 0 } });
  const eid = store().addEdge({ source: n, target: c });
  const persistedEdge = store().edges.find((x) => x.id === eid);
  eq(
    Object.keys(persistedEdge).sort(),
    ["id", "source", "sourceHandle", "target", "targetHandle"],
    "领域 edge 只含契约字段(无 selected/animated 等)"
  );

  // ------------------------------------------------------------------ ⑥
  console.log("⑥ Tab 建节点策略:纯 Tab + 画布上下文 + 非交互控件 + 非只读");
  const tabBase = {
    key: "Tab",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    targetInteractive: false,
    inCanvasContext: true,
    readOnly: false,
  };
  ok(shouldTabCreateNode(tabBase) === true, "纯 Tab 在画布上下文 → 建节点");
  ok(shouldTabCreateNode({ ...tabBase, ctrlKey: true }) === false, "Ctrl+Tab 不建(切标签)");
  ok(shouldTabCreateNode({ ...tabBase, shiftKey: true }) === false, "Shift+Tab 不建(反向聚焦)");
  ok(shouldTabCreateNode({ ...tabBase, altKey: true }) === false, "Alt+Tab 不建");
  ok(shouldTabCreateNode({ ...tabBase, metaKey: true }) === false, "Meta+Tab 不建");
  ok(shouldTabCreateNode({ ...tabBase, targetInteractive: true }) === false, "焦点在交互控件 → 不建");
  ok(shouldTabCreateNode({ ...tabBase, inCanvasContext: false }) === false, "非画布上下文 → 不建");
  ok(shouldTabCreateNode({ ...tabBase, readOnly: true }) === false, "只读 → 不建");
  ok(shouldTabCreateNode({ ...tabBase, key: "Enter" }) === false, "非 Tab 键 → 不建");

  // ------------------------------------------------------------------ ⑦
  console.log("⑦ addNodeAndEdge 原子性:同时成功或都不写,不留孤儿节点");
  hydrate();
  const src = store().addNode({ type: "text", position: { x: 0, y: 0 } });
  const r1 = store().addNodeAndEdge({
    node: { type: "image", position: { x: 50, y: 50 } },
    fromNodeId: src,
    fromHandleId: null,
    fromHandleType: "source",
  });
  ok(r1 && typeof r1.nodeId === "string" && typeof r1.edgeId === "string", "原子建返回 {nodeId,edgeId}");
  eq(store().nodes.length, 2, "节点 +1");
  eq(store().edges.length, 1, "边 +1");
  const atomEdge = store().edges.find((x) => x.id === r1.edgeId);
  eq(atomEdge?.source, src, "source handle:边源=原节点");
  eq(atomEdge?.target, r1.nodeId, "source handle:边目标=新节点");

  const r2 = store().addNodeAndEdge({
    node: { type: "text", position: { x: 9, y: 9 } },
    fromNodeId: src,
    fromHandleId: null,
    fromHandleType: "target",
  });
  const atomEdge2 = store().edges.find((x) => x.id === r2.edgeId);
  eq(atomEdge2?.source, r2.nodeId, "target handle:边源=新节点");
  eq(atomEdge2?.target, src, "target handle:边目标=原节点");

  // 只读:都不写(无孤儿)
  const nBefore = store().nodes.length;
  const eBefore = store().edges.length;
  store().setReadOnly(true);
  ok(
    store().addNodeAndEdge({
      node: { type: "text", position: { x: 1, y: 1 } },
      fromNodeId: src,
      fromHandleId: null,
      fromHandleType: "source",
    }) === null,
    "只读 → null"
  );
  eq(store().nodes.length, nBefore, "只读:节点数不变(无孤儿节点)");
  eq(store().edges.length, eBefore, "只读:边数不变");
  store().setReadOnly(false);

  // 源节点不存在:都不写(无孤儿)
  const nBefore2 = store().nodes.length;
  const eBefore2 = store().edges.length;
  ok(
    store().addNodeAndEdge({
      node: { type: "text", position: { x: 2, y: 2 } },
      fromNodeId: "ghost",
      fromHandleId: null,
      fromHandleType: "source",
    }) === null,
    "源节点不存在 → null"
  );
  eq(store().nodes.length, nBefore2, "源缺失:节点数不变(不留孤儿)");
  eq(store().edges.length, eBefore2, "源缺失:边数不变");

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S2 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S2 聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
