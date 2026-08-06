#!/usr/bin/env node
/**
 * 超级画布 · S6 聚焦验证(离线,零测试运行器)
 *
 * 真实运行断言(非仅源码含字符串):
 *   ① object key→URL 解析器:缓存/请求去重/TTL 过期/非法 key 拒/响应校验/abort/失败回收(注入假 fetch+假时钟);
 *   ② 同屏活跃视频配额:≤6、稳定 FIFO 排队、释放递补、重复申请稳定、订阅;
 *   ③ 响应式策略:isCompactViewport / 小地图展开阈值 / 生成面板 dock / 胶囊≥5 折叠 / 低 zoom 阈值;
 *   ④ 旧契约(D1 体积闸 / D2 media 校验 / S2 建节点只存 object key / 只读闸 / 坏档降级不白屏 / autosave 阻断);
 *   ⑤ 源码卫生:media-node 选中才挂 video / 不写回节点 data / registry 引 media-node /
 *      解析器不依赖 store / 端点认证+严格校验 / board 响应式 / 侧栏图标态;新增源无控制字符。
 *
 * 运行:node scripts/verify-canvas-s6.mjs   (失败退出码 1)
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

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** 仅允许 \t(9) \n(10) \r(13),其余 <32 或 DEL(127) 视为控制字符。 */
function hasControlChars(source) {
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
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

const componentPath = (name) => join(ROOT, "src", "components", "canvas", name);

async function main() {
  // ---- 载入被测模块(纯 TS,离线剥类型)----
  const schema = await loadCanvasModule("schema");
  const docLimits = await loadCanvasModule("doc-limits");
  await loadCanvasModule("patch");
  await loadCanvasModule("history");
  await loadCanvasModule("group-ops");
  await loadCanvasModule("rf-adapter");
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
  const resolver = await loadExtra(
    componentPath("media-url-cache.ts"),
    "media-url-cache.mjs",
    { "@/lib/canvas/schema": "./schema.mjs" }
  );
  const registry = await loadExtra(
    componentPath("active-video-registry.ts"),
    "active-video-registry.mjs"
  );
  const responsive = await loadExtra(
    componentPath("canvas-responsive.ts"),
    "canvas-responsive.mjs"
  );
  await loadCanvasModule("media-ownership");
  const ownership = await loadExtra(
    join(ROOT, "src", "app", "api", "storage", "media-url", "ownership.ts"),
    "media-url-ownership.mjs",
    { "@/lib/canvas/media-ownership": "./media-ownership.mjs" }
  );

  const { describeMediaKeyRejection, isOssObjectKey, loadCanvasDoc } = schema;
  const { DOC_BYTES_HARD_LIMIT, DOC_JSONB_WARN_LIMIT, checkDocSize } = docLimits;
  const { useCanvasStore, isCanvasAutosaveBlocked } = storeMod;
  const {
    resolveMediaUrl,
    peekMediaUrl,
    forgetMediaUrl,
    configureMediaUrlResolver,
    resetMediaUrlCache,
    isSafeResolvedUrl,
    MEDIA_URL_ERROR_TTL_MS,
  } = resolver;
  const { createVideoSlotManager, MAX_ACTIVE_VIDEOS } = registry;
  const {
    isCompactViewport,
    shouldExpandMinimap,
    resolveGenerationPanelDock,
    planCapsuleCollapse,
    LOW_ZOOM_MEDIA_THRESHOLD,
    COMPACT_MAX_WIDTH,
  } = responsive;
  const { isOwnedObjectKey } = ownership;

  const store = () => useCanvasStore.getState();
  const hydrate = () => {
    store().reset();
    store().initializeEmptyDoc();
  };
  const OK_KEY = "images/u123/1700000000-abcd1234.png";
  const OK_KEY_2 = "videos/u123/1700000000-efgh5678.mp4";

  // ================================================================= ①
  console.log("① object key→URL 解析器(缓存/去重/TTL/拒/校验/abort/失败回收)");
  let clock = 1000;
  let fetchCalls = 0;
  let fetchMode = "ok"; // ok | fail | badurl | foreignhost | wrongkey
  const parseKey = (input) => {
    try {
      return new URL(input, "http://localhost").searchParams.get("key");
    } catch {
      return null;
    }
  };
  const fakeFetch = (input) => {
    fetchCalls += 1;
    const k = parseKey(input);
    let url;
    if (fetchMode === "foreignhost") url = `https://evil.example/${k}`;
    else if (fetchMode === "wrongkey") url = "https://media.toryxai.com/videos/attacker/other.mp4";
    else if (fetchMode === "badurl") url = "data:text/plain,x";
    else url = `https://media.toryxai.com/${k}`; // ok/fail 均按 key 构造正确 URL
    return Promise.resolve({
      ok: fetchMode !== "fail",
      status: fetchMode === "fail" ? 500 : 200,
      json: async () => ({ url, expiresInMs: 1000 }),
    });
  };
  configureMediaUrlResolver({ fetchImpl: fakeFetch, now: () => clock, endpoint: "/api/storage/media-url" });

  // isSafeResolvedUrl 单元:host+精确 key 绑定 + 无 credentials/端口/query/hash
  const H = "https://media.toryxai.com";
  const K = "images/u/a.png";
  ok(isSafeResolvedUrl(`${H}/${K}`, K) === true, "isSafeResolvedUrl: 可信 host+精确 key 通过");
  ok(isSafeResolvedUrl(`https://evil.example/${K}`, K) === false, "isSafeResolvedUrl: 外域 host 拒");
  ok(isSafeResolvedUrl(`${H}/images/u/OTHER.png`, K) === false, "isSafeResolvedUrl: 同 host 错 key 拒");
  ok(isSafeResolvedUrl(`https://user:pass@media.toryxai.com/${K}`, K) === false, "isSafeResolvedUrl: credentials 拒");
  ok(isSafeResolvedUrl(`${H}:8443/${K}`, K) === false, "isSafeResolvedUrl: 异常端口拒");
  ok(isSafeResolvedUrl(`${H}/${K}?sig=1`, K) === false, "isSafeResolvedUrl: query 拒");
  ok(isSafeResolvedUrl(`${H}/${K}#x`, K) === false, "isSafeResolvedUrl: hash 拒");
  ok(isSafeResolvedUrl(`http://media.toryxai.com/${K}`, K) === false, "isSafeResolvedUrl: 非 https 拒");
  ok(isSafeResolvedUrl("data:text/plain,x", K) === false, "isSafeResolvedUrl: dataURL 拒");
  ok(isSafeResolvedUrl(`${H}/${K}`, "") === false, "isSafeResolvedUrl: 空 expectedKey 拒");

  // 缓存
  resetMediaUrlCache();
  fetchCalls = 0;
  fetchMode = "ok";
  const u1 = await resolveMediaUrl(OK_KEY);
  ok(fetchCalls === 1, "首次解析发一次请求");
  ok(typeof u1 === "string" && u1.startsWith("https://"), "解析出 https URL");
  const u2 = await resolveMediaUrl(OK_KEY);
  ok(fetchCalls === 1, "缓存命中不重复请求");
  ok(u2 === u1, "缓存返回同 URL");
  ok(peekMediaUrl(OK_KEY) === u1, "peekMediaUrl 同步命中");

  // 请求去重(并发)
  resetMediaUrlCache();
  fetchCalls = 0;
  const p1 = resolveMediaUrl(OK_KEY);
  const p2 = resolveMediaUrl(OK_KEY);
  const [r1, r2] = await Promise.all([p1, p2]);
  ok(fetchCalls === 1, "并发去重:同 key 只一次请求");
  ok(r1 === r2, "并发返回同一 URL");

  // TTL 过期
  resetMediaUrlCache();
  fetchCalls = 0;
  await resolveMediaUrl(OK_KEY);
  ok(fetchCalls === 1, "TTL:首解析一次请求");
  ok(peekMediaUrl(OK_KEY) !== null, "TTL:未过期 peek 命中");
  clock += 1001; // > ttl(1000)
  ok(peekMediaUrl(OK_KEY) === null, "TTL:过期 peek 失效");
  await resolveMediaUrl(OK_KEY);
  ok(fetchCalls === 2, "TTL:过期后重新请求");

  // 非法 key 同步拒(不打网络)
  resetMediaUrlCache();
  fetchCalls = 0;
  const badKeys = [
    "data:image/png;base64,AAAA",
    "https://evil.example/x?sig=1",
    "//evil.example/x",
    "/abs/path",
    "../escape",
    "a b",
    "has?query",
    "",
  ];
  let allRejected = true;
  for (const bad of badKeys) {
    const settled = await resolveMediaUrl(bad).then(() => "resolved", () => "rejected");
    if (settled !== "rejected") allRejected = false;
  }
  ok(allRejected, "全部非法 key 被拒");
  ok(fetchCalls === 0, "非法 key 同步拒,零网络请求");

  // 响应严格校验(fetchResolved 按 key 绑定):非 https / 外域 host / 错 key 一律拒
  resetMediaUrlCache();
  fetchMode = "badurl";
  ok(
    (await resolveMediaUrl(OK_KEY).then(() => "resolved", () => "rejected")) === "rejected",
    "响应非 https URL → 拒(不泄露任意 URL)"
  );
  resetMediaUrlCache();
  fetchMode = "foreignhost";
  ok(
    (await resolveMediaUrl(OK_KEY).then(() => "resolved", () => "rejected")) === "rejected",
    "响应外域 host → 拒(防端点被劫持)"
  );
  resetMediaUrlCache();
  fetchMode = "wrongkey";
  ok(
    (await resolveMediaUrl(OK_KEY).then(() => "resolved", () => "rejected")) === "rejected",
    "响应同 host 错 key → 拒(不返他人对象)"
  );

  // abort:某调用方取消不牵连共享请求
  resetMediaUrlCache();
  fetchMode = "ok";
  fetchCalls = 0;
  const ac = new AbortController();
  const pB = resolveMediaUrl(OK_KEY); // 无 signal
  const pA = resolveMediaUrl(OK_KEY, { signal: ac.signal });
  ac.abort();
  const aOut = await pA.then(() => "resolved", (e) => e?.name ?? "rejected");
  const bOut = await pB.then((u) => (typeof u === "string" && u.startsWith("https://") ? "https" : "other"), () => "rejected");
  ok(aOut === "AbortError", "abort:被取消方拒 AbortError");
  ok(bOut === "https", "abort:共享请求仍为其他调用方兑现");
  ok(fetchCalls === 1, "abort:不牵连共享请求,仍只一次 fetch");
  // 预先 aborted 的 signal
  const ac2 = new AbortController();
  ac2.abort();
  const preAbort = await resolveMediaUrl(OK_KEY, { signal: ac2.signal }).then(() => "resolved", (e) => e?.name);
  ok(preAbort === "AbortError", "预先 aborted 的 signal → AbortError");

  // 失败回收
  resetMediaUrlCache();
  fetchMode = "fail";
  fetchCalls = 0;
  const fail1 = await resolveMediaUrl(OK_KEY_2).then(() => "resolved", () => "rejected");
  ok(fail1 === "rejected", "失败:请求失败则拒");
  ok(fetchCalls === 1, "失败:一次请求");
  const fail2 = await resolveMediaUrl(OK_KEY_2).then(() => "resolved", () => "rejected");
  ok(fail2 === "rejected", "失败:负缓存内仍拒");
  ok(fetchCalls === 1, "失败:负缓存内不重复请求");
  clock += MEDIA_URL_ERROR_TTL_MS + 1;
  fetchMode = "ok";
  const recovered = await resolveMediaUrl(OK_KEY_2).then((u) => u, () => "rejected");
  ok(fetchCalls === 2, "失败:负缓存过期后重取");
  ok(typeof recovered === "string" && recovered.startsWith("https://"), "失败回收:重取成功");
  // forgetMediaUrl 强制忘记(用户点重试)
  resetMediaUrlCache();
  fetchMode = "fail";
  fetchCalls = 0;
  await resolveMediaUrl(OK_KEY).then(() => {}, () => {});
  forgetMediaUrl(OK_KEY);
  fetchMode = "ok";
  await resolveMediaUrl(OK_KEY).then(() => {}, () => {});
  ok(fetchCalls === 2, "forgetMediaUrl:清缓存后立即重取(不等负缓存过期)");
  // 归还真实 fetch/时钟
  configureMediaUrlResolver({ fetchImpl: null, now: () => Date.now() });

  // =============================================================== ①b
  console.log("①b 对象归属闸(不泄露跨用户对象,fail-closed)");
  const ME = "aaaaaaaa-1111-4111-8111-111111111111";
  const OTHER = "bbbbbbbb-2222-4222-8222-222222222222";
  ok(isOwnedObjectKey(`images/${ME}/1-a.png`, ME) === true, "自有 images 对象放行");
  ok(isOwnedObjectKey(`videos/${ME}/1-a.mp4`, ME) === true, "自有 videos 对象放行");
  ok(isOwnedObjectKey(`videos/slideshow/${ME}/x.mp4`, ME) === true, "自有 slideshow 对象放行");
  ok(isOwnedObjectKey(`veo-videos/${ME}/x.mp4`, ME) === true, "owned VEO layout is accepted");
  ok(isOwnedObjectKey(`videos/assembly/${ME}/x.mp4`, ME) === true, "owned assembly layout is accepted");
  ok(isOwnedObjectKey(`veo-videos/${OTHER}/x.mp4`, ME) === false, "cross-user VEO layout is rejected");
  ok(isOwnedObjectKey(`videos/assembly/${OTHER}/x.mp4`, ME) === false, "cross-user assembly layout is rejected");
  ok(isOwnedObjectKey(`veo-videos/${ME}/extra/x.mp4`, ME) === false, "extra VEO path segments are rejected");
  ok(isOwnedObjectKey(`videos/assembly/${ME}/extra/x.mp4`, ME) === false, "extra assembly path segments are rejected");
  ok(isOwnedObjectKey(`videos/assembly/${ME}/../${OTHER}`, ME) === false, "assembly traversal segments are rejected");
  ok(isOwnedObjectKey(`images/${OTHER}/1-a.png`, ME) === false, "他人 owner UUID 拒");
  ok(isOwnedObjectKey(`images/1-a.png`, ME) === false, "缺 owner 段拒");
  ok(isOwnedObjectKey(`images/${ME}/sub/1-a.png`, ME) === false, "额外段拒");
  ok(isOwnedObjectKey(`images/${ME}/../${OTHER}/x.png`, ME) === false, ".. 混淆段拒(路径穿越)");
  ok(isOwnedObjectKey(`images/${ME}/./x.png`, ME) === false, ". 混淆段拒");
  ok(isOwnedObjectKey(`videos/slideshow/${ME}`, ME) === false, "slideshow 缺 file 段拒");
  ok(isOwnedObjectKey(`videos/slideshow/${OTHER}/x.mp4`, ME) === false, "他人 slideshow 拒");
  ok(isOwnedObjectKey(`secret/${ME}/x.png`, ME) === false, "未知 folder 拒(fail-closed)");
  ok(isOwnedObjectKey(`images/${ME.toUpperCase()}/x.png`, ME) === false, "大小写绕过拒");
  ok(isOwnedObjectKey(`images/${ME}/x.png`, "") === false, "空 userId 拒");
  ok(isOwnedObjectKey(`images/${ME}/x.png`, OTHER) === false, "请求者非 owner 拒");
  ok(isOwnedObjectKey("", ME) === false, "空 key 拒");

  // ================================================================= ②
  console.log("② 同屏活跃视频配额(≤6 稳定 FIFO / 释放递补 / 订阅)");
  ok(MAX_ACTIVE_VIDEOS === 6, "同屏活跃视频硬上限=6");
  const mgr = createVideoSlotManager(6);
  let notifies = 0;
  const unsub = mgr.subscribe(() => (notifies += 1));
  for (let i = 1; i <= 8; i += 1) mgr.request(`v${i}`);
  eq(mgr.activeCount(), 6, "8 申请 → 6 活跃");
  eq(mgr.activeIds(), ["v1", "v2", "v3", "v4", "v5", "v6"], "前 6 个持槽(FIFO)");
  eq(mgr.queuedIds(), ["v7", "v8"], "其余排队");
  ok(mgr.has("v1") === true && mgr.has("v7") === false, "has:活跃 v1 真、排队 v7 假");
  // 重复申请活跃者:稳定不抖
  mgr.request("v1");
  eq(mgr.activeIds(), ["v1", "v2", "v3", "v4", "v5", "v6"], "重复申请活跃者顺序稳定");
  // 释放活跃 → 队首递补
  mgr.release("v3");
  eq(mgr.activeCount(), 6, "释放活跃后仍满 6(递补)");
  ok(mgr.has("v7") === true, "队首 v7 递补为活跃");
  ok(mgr.has("v3") === false, "被释放 v3 不再活跃");
  eq(mgr.queuedIds(), ["v8"], "队列剩 v8");
  // 释放排队者:不影响活跃
  mgr.release("v8");
  eq(mgr.queuedIds(), [], "释放排队者后队列空");
  eq(mgr.activeCount(), 6, "释放排队者不动活跃");
  // 释放不存在者:noop 不通知
  const before = notifies;
  mgr.release("ghost");
  eq(notifies, before, "释放不存在者:无副作用不通知");
  ok(notifies > 0, "订阅在变更时被触发");
  unsub();
  const afterUnsub = notifies;
  mgr.request("v9");
  eq(notifies, afterUnsub, "退订后不再通知");

  // ================================================================= ③
  console.log("③ 响应式策略(1366 适配 / dock / 胶囊折叠 / 低 zoom)");
  ok(COMPACT_MAX_WIDTH === 1366, "紧凑上限=1366");
  ok(isCompactViewport(1366) === true, "1366 → 紧凑");
  ok(isCompactViewport(1367) === false, "1367 → 非紧凑");
  ok(isCompactViewport(1280) === true, "1280 → 紧凑");
  ok(isCompactViewport(1920) === false, "1920 → 非紧凑");
  ok(isCompactViewport(Number.NaN) === true, "非有限宽 → 保守按紧凑");
  ok(shouldExpandMinimap(1440) === false, "1440 → 不自动展开小地图");
  ok(shouldExpandMinimap(1441) === true, "1441 → 自动展开小地图");
  ok(shouldExpandMinimap(1366) === false, "1366 → 收起小地图(条款)");
  eq(
    resolveGenerationPanelDock({ viewportWidth: 1366, viewportHeight: 768, panelHeight: 100 }),
    "bottom",
    "窄屏 → 生成面板 dock 底部"
  );
  eq(
    resolveGenerationPanelDock({ viewportWidth: 1920, viewportHeight: 1080, panelHeight: 100 }),
    "inline",
    "宽屏小面板 → inline"
  );
  eq(
    resolveGenerationPanelDock({ viewportWidth: 1920, viewportHeight: 1080, panelHeight: 900 }),
    "bottom",
    "宽屏超高面板 → dock 底部"
  );
  eq(
    resolveGenerationPanelDock({ viewportWidth: Number.NaN, viewportHeight: 1080, panelHeight: 100 }),
    "bottom",
    "非有限视口 → 保守 dock 底部"
  );
  eq(planCapsuleCollapse(4), { collapsed: false, visibleCount: 4, overflowCount: 0 }, "4 胶囊不折叠");
  eq(planCapsuleCollapse(5), { collapsed: true, visibleCount: 4, overflowCount: 1 }, "5 胶囊折叠(阈值)");
  eq(planCapsuleCollapse(9), { collapsed: true, visibleCount: 4, overflowCount: 5 }, "9 胶囊折叠");
  eq(planCapsuleCollapse(0), { collapsed: false, visibleCount: 0, overflowCount: 0 }, "0 胶囊不折叠");
  eq(planCapsuleCollapse(-3), { collapsed: false, visibleCount: 0, overflowCount: 0 }, "负数归零");
  ok(
    LOW_ZOOM_MEDIA_THRESHOLD > 0 && LOW_ZOOM_MEDIA_THRESHOLD < 1,
    "低 zoom 降级阈值在 (0,1)"
  );

  // ================================================================= ④
  console.log("④ 旧契约(D1 体积闸 / D2 media 校验 / S2 只存 key / 只读 / 坏档降级 / autosave 闸)");
  // D2 schema:禁 dataURL/签名 URL 入库,只存 object key(#28 数据半)
  ok(describeMediaKeyRejection("data:image/png;base64,AA") !== null, "schema 拒 dataURL 入库");
  ok(describeMediaKeyRejection("https://media/x?sig=1") !== null, "schema 拒签名/完整 URL 入库");
  ok(describeMediaKeyRejection(OK_KEY) === null, "schema 收合法 object key");
  ok(isOssObjectKey(OK_KEY) === true, "isOssObjectKey 认合法键");
  // D1 体积双闸(P0-Q1 翻转后)
  ok(DOC_BYTES_HARD_LIMIT === 2 * 1024 * 1024, "硬拒=2MB");
  ok(DOC_JSONB_WARN_LIMIT === 512 * 1024, "软告警=512KB");
  const small = checkDocSize({ nodes: [], edges: [], groups: [] });
  ok(small.ok === true && small.overWarnLimit === false, "空档不拒不告警");
  // S2 建节点:图片节点只存 object key
  hydrate();
  const nid = store().addNode({
    type: "image",
    position: { x: 0, y: 0 },
    data: { media: { ossKey: OK_KEY } },
  });
  ok(nid !== null, "建图片节点(合法 object key)成功");
  eq(store().nodes.find((n) => n.id === nid)?.data?.media, { ossKey: OK_KEY }, "节点只存 object key");
  // 拒非法 media(签名 URL 不写回节点/持久层)
  const badNid = store().addNode({
    type: "image",
    position: { x: 0, y: 0 },
    data: { media: { ossKey: "https://media/x?sig=1" } },
  });
  ok(badNid === null, "拒建带签名 URL 的媒体节点(URL 不入持久层)");
  // 只读闸
  store().setReadOnly(true);
  ok(store().addNode({ type: "text", position: { x: 0, y: 0 } }) === null, "只读拦截建节点");
  store().setReadOnly(false);
  // 坏档降级不白屏 + autosave 阻断
  const broken = loadCanvasDoc({
    nodes: [{ id: "x", type: "not_a_type", position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
  });
  ok(broken.recoveryRequired === true, "坏档 recoveryRequired=true");
  ok(broken.brokenNodes.length === 1, "非法节点降级为 broken(不整画布白屏)");
  store().hydrate(broken);
  ok(isCanvasAutosaveBlocked(store()) === true, "recoveryRequired 阻断 autosave");

  // ================================================================= ⑤
  console.log("⑤ 源码卫生(选中才挂 video / 不写回 data / registry / 不依赖 store / 端点 / board / 侧栏)");
  // 真检测「调用/import」而非注释文字:调用 = 名后跟 `(`;import = from/import() 带说明符。
  //(注释里的散文提及不含这些语法,故保留注释也不会假命中——不靠删注释糊过去。)
  const callsFn = (src, name) => new RegExp(`\\b${name}\\s*\\(`).test(src);
  const importsSpec = (src, spec) =>
    new RegExp(`\\bfrom\\s+['"][^'"]*${spec}`).test(src) ||
    new RegExp(`\\bimport\\s*\\(\\s*['"][^'"]*${spec}`).test(src);

  const mediaSrc = read("src/components/canvas/nodes/media-node.tsx");
  ok(mediaSrc.includes("useActiveVideoSlot"), "media-node:视频经活跃槽配额");
  ok(mediaSrc.includes("selected") && mediaSrc.includes("wantActive"), "media-node:视频依选中挂载");
  ok(mediaSrc.includes("<video"), "media-node:选中态挂真实 <video>");
  ok(!callsFn(mediaSrc, "updateNodeData"), "media-node:无 updateNodeData 调用(不写回节点 data)");
  ok(!importsSpec(mediaSrc, "canvas-store"), "media-node:无 canvas-store import");
  ok(mediaSrc.includes("AbortController"), "media-node:解析等待可 abort");
  ok(mediaSrc.includes("LOW_ZOOM_MEDIA_THRESHOLD") && mediaSrc.includes("color-block"), "media-node:低 zoom 降级色块");

  const regSrc = read("src/components/canvas/node-registry.ts");
  ok(regSrc.includes("./nodes/media-node"), "registry:image/video 引自 media-node");

  const cacheSrc = read("src/components/canvas/media-url-cache.ts");
  ok(!importsSpec(cacheSrc, "canvas-store"), "解析器:无 canvas-store 静态/动态 import(URL 无法回流持久层)");
  ok(!callsFn(cacheSrc, "updateNodeData"), "解析器:无 updateNodeData 调用");

  const routeSrc = read("src/app/api/storage/media-url/route.ts");
  ok(routeSrc.includes("auth.getUser"), "解析端点:认证闸");
  ok(routeSrc.includes("describeMediaKeyRejection"), "解析端点:严格校验 key");
  ok(callsFn(routeSrc, "isOwnedObjectKey"), "解析端点:调用归属闸 isOwnedObjectKey");
  ok(importsSpec(routeSrc, "ownership"), "解析端点:从 ./ownership 引归属闸");
  ok(routeSrc.includes("403"), "解析端点:非归属者 403");
  ok(routeSrc.includes("getPublicUrl"), "解析端点:由合法且归属的 key 构造 URL");
  ok(routeSrc.includes("{ url, expiresInMs"), "解析端点:成功响应只回 url+expiresInMs");
  ok(!routeSrc.includes("{ key,"), "解析端点:成功响应不回显 key");

  const boardSrc = read("src/components/canvas/canvas-board.tsx");
  ok(boardSrc.includes("shouldExpandMinimap"), "board:响应式小地图阈值");
  ok(boardSrc.includes("useViewportSize"), "board:订阅视口尺寸");

  const paletteSrc = read("src/components/canvas/node-palette.tsx");
  ok(paletteSrc.includes('data-sidebar-mode="icon"'), "侧栏:默认图标态");
  ok(paletteSrc.includes("overflow-y-auto"), "侧栏:内部滚动不纵向溢出");

  // 新增源无控制字符(结构键无控制字纪律)
  const newFiles = [
    "src/app/api/storage/media-url/route.ts",
    "src/app/api/storage/media-url/ownership.ts",
    "src/lib/canvas/media-ownership.ts",
    "src/components/canvas/media-url-cache.ts",
    "src/components/canvas/active-video-registry.ts",
    "src/components/canvas/canvas-responsive.ts",
    "src/components/canvas/use-viewport-size.ts",
    "src/components/canvas/nodes/media-node.tsx",
    "scripts/verify-canvas-s6.mjs",
  ];
  for (const rel of newFiles) {
    ok(!hasControlChars(read(rel)), `源无控制字符:${rel}`);
  }

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  if (failed > 0) {
    console.error("❌ S6 聚焦验证有失败项");
    process.exit(1);
  }
  console.log("✅ S6 聚焦验证全绿");
}

main().catch((error) => {
  console.error("验证脚本异常:", error);
  process.exit(1);
});
