#!/usr/bin/env node

/**
 * 超级画布 · P1 批 5 离线守卫(CHECKLIST #67 商品节点 + #169 前半「商品主图作参考图输入」)
 *
 * 无凭证、无浏览器、无数据库、无网络。断言的是**会静默出错**的那些点 ——
 * 每一条都对应一次实证过的返工或一次会花钱才发现的故障。
 *
 * ## 为什么出口检查是「双向实扫」而不是名单
 *
 * 沿用 `scripts/fixtures/canvas-p1/batch2/callsites.mjs` 的哲学:只检查「已知的东西还在不在」
 * 结构上发现不了新增的未审出口。所以这里**两边都实扫**:
 *  - 画布对外的 API 出口(从源码里扫 `/api/...` 字面量与模板串);
 *  - 会动积分的路由(从 `src/app/api/**` 里扫扣费/退款写法)。
 * 然后断言两者**交集为空**,并把「非 `/api/canvas/*` 的出口」与一份冻结基线逐项比对,
 * **新增与消失都判红** —— 消失同样要红,否则清单会烂成一句令人安心的谎话。
 *
 * ⚠️ 这是保守的**词法**扫描,不是 AST 分析:动态拼出来的路径、包一层 helper、
 * 或直连 PostgREST 都看不见。它证明的只是「冻结基线仍然等于这些模式扫出来的东西」,
 * 不能被引用为「出口面完备」的证明。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const productNode = read("src/components/canvas/nodes/product-node.tsx");
const referenceNodes = read("src/components/canvas/nodes/reference-nodes.tsx");
const registry = read("src/components/canvas/node-registry.ts");
const schema = read("src/lib/canvas/schema.ts");
const imageInput = read("src/lib/canvas/generation-image-input.ts");
const service = read("src/lib/canvas/generation-service.ts");
const context = read("src/components/canvas/canvas-generation-context.tsx");
const inputOrder = read("src/components/canvas/generation-input-order.ts");
const canvasStore = read("src/stores/canvas-store.ts");

let passed = 0;
const failed = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failed.push(label);
}
function has(source, fragment, label) {
  ok(source.includes(fragment), label);
}
function lacks(source, fragment, label) {
  ok(!source.includes(fragment), label);
}
function countOf(source, fragment) {
  return source.split(fragment).length - 1;
}

console.log("1. 商品节点承载面(#67)");
has(registry, 'from "./nodes/product-node"', "registry 指向独立的 product-node 模块");
has(registry, "product: ProductNode", "product 类型仍映射到 ProductNode");
lacks(referenceNodes, "export const ProductNode", "商品节点已从 reference-nodes 迁出(该文件只留脚本/合成)");
has(productNode, 'aria-label="商品简报"', "商品简报 textarea 仍在(旧文档兼容面不能丢)");
has(productNode, 'aria-label="上传商品图"', "节点内有文件输入(#67 的核心缺口就是它原本为 0)");
has(productNode, "MAX_PRODUCT_IMAGES = 9", "图片上限 9(与 analyze-product 的 slice(0,9) 对齐;2026-08-10 裁决)");

console.log("\n2. 低 zoom 降级 —— 商品节点此前完全没有这一层");
has(productNode, "LOW_ZOOM_MEDIA_THRESHOLD", "复用共享阈值常量,不自己写 0.4");
has(productNode, "state.transform[2] < LOW_ZOOM_MEDIA_THRESHOLD", "zoom 取自 RF store,与图片/视频节点同一口径");
has(productNode, "wide={Boolean(selected && !lowZoom)}", "宽度用 selected && !lowZoom 双条件门控");
has(productNode, "lowZoom ? (", "低 zoom 走独立降级分支(不渲染缩略图与可点控件)");

console.log("\n3. 持久化纪律 —— 每条都对应一次「静默写不进去」");
has(
  productNode,
  "JSON.parse(JSON.stringify(rest))",
  "写入前做 JSON 归一:normalizeCard 留下的 undefined own 键会让整次写入被静默丢弃"
);
has(
  productNode,
  "images: _urlsNeverPersisted",
  "显式丢掉 card.images(它装 http URL;铁律只准存 object key)"
);
has(productNode, "...oldParams", "写 params 时 spread 旧值(否则整块抹掉 params.generation = 计费/对账落点)");
has(productNode, "const ok = updateNodeData", "检查 updateNodeData 的返回值");
has(productNode, "if (!ok)", "返回 false 时走提示分支,不假装没事发生");
has(productNode, "seen.add(id)", "卖点 id 去重(normalizeCard 不去重,重复 id 会「勾一条翻两条」)");
ok(
  countOf(productNode, "analyzedImageKeys: [...imageKeys].sort()") === 1,
  "防重指纹只在解析成功后写一次(失败也写会把这组图永久钉死在「已解析」)"
);
lacks(
  productNode,
  "analyzedImageKeys: undefined",
  "🔴 作废指纹必须**删键**而不是写 undefined —— 值为 undefined 的 own 键会让整次写入静默失败(2026-08-14 缺陷乙:移除商品图在所有画布上全线不可用)"
);
has(
  productNode,
  "...productWithoutFingerprint",
  "移除图时用解构把 analyzedImageKeys 摘掉(缺陷乙的正解)"
);
has(productNode, 'unset.push("media")', "清空主图走 store 的 unset 删键通道(写 media: undefined 同样会被静默丢弃)");
has(
  canvasStore,
  "for (const key of unsetKeys) delete merged[key];",
  "store 在 schema.parse **之前**删键(parse 会把 present-undefined 的可选键原样保留成 own 键,之后再删就晚了)"
);
lacks(
  productNode,
  "画布当前不可写入(只读、或写者锁不在本标签页),这次改动没有保存。",
  "写入失败文案不再把「校验拒绝」误报成「只读/写者锁」(2026-08-14 就是被这句带着查了半天锁)"
);
has(productNode, "state.sessionCanvasId !== state.hydratedCanvasId", "失败文案按三条真实失败路径分流");

console.log("\n4. 解析必须显式点击触发(该路由对用户零扣费,但对我方有厂商成本)");
has(
  productNode,
  "onClick={() => void handleAnalyze({ force: alreadyAnalyzed })}",
  "解析挂在 onClick 上,且「重新解析」带 force 进去(2026-08-14 缺陷甲:不带 force 会被指纹闸硬 return,按钮是死路)"
);
has(
  productNode,
  "if (alreadyAnalyzed && !options?.force) {",
  "指纹闸只挡不带 force 的调用(挡的是刷新/重挂后的无意重跑,不是用户明确点的重跑)"
);
lacks(
  productNode,
  "想强制重跑就点「重新解析」",
  "拒绝文案不再指路去点「重新解析」—— 那个按钮就是本分支的调用方,会绕成死循环(缺陷甲)"
);
ok(
  !/useEffect\([^)]*handleAnalyze/s.test(productNode),
  "没有任何 useEffect 触发 handleAnalyze(effect 触发正是「切节点回来又跑一次」的成因)"
);
has(productNode, 'setBusy("analyze")', "有 in-flight 锁,管同一挂载周期连点");
has(productNode, "disabled={controlsDisabled", "写操作按钮显式 disabled(不依赖 store 的静默 false)");

console.log("\n5. schema 契约 —— 零迁移、零版本 bump、data 顶层零新增字段");
has(schema, "CanvasProductCardSchema", "卖点卡有具名 zod 形状");
has(schema, "CanvasProductStateSchema", "商品节点状态有具名 zod 形状");
has(schema, "product: CanvasProductStateSchema.optional()", "挂在 params 而不是 data 顶层");
ok(
  !/CanvasProductCardSchema[\s\S]{0,600}?images:/.test(schema),
  "卖点卡形状里**结构上没有 images 字段** —— 这是「只存 key」在这条路上唯一的机器闸"
);
has(schema, "extraImageKeys: z.array(OssObjectKeySchema)", "附图 key 用 OssObjectKeySchema 校验");
has(schema, "CANVAS_SCHEMA_VERSION = 1 as const", "schema 版本未 bump(顶层加字段=回滚炸弹,本批刻意不碰)");
ok(
  /CanvasNodeDataSchema[\s\S]{0,400}?\.strictObject\(\{[\s\S]{0,400}?title[\s\S]{0,400}?params[\s\S]{0,400}?refs[\s\S]{0,400}?media/.test(
    schema
  ),
  "data 仍是 strictObject 且仍只有 title/params/refs/media 四键"
);

console.log("\n6. 参考图判据唯一出口(#169 前半;四处漂移即 409 或错编号扣费)");
has(imageInput, "export function isCanvasImageInputNode", "判据有唯一产地");
has(imageInput, 'node.type !== "image" && node.type !== "product"', "判据含商品节点");
has(service, "isCanvasImageInputNode(source)", "服务端权威重算走共用判据");
has(context, "isCanvasImageInputNode(node)", "客户端提交走共用判据");
has(inputOrder, "isCanvasImageInputNode(node)", "引用区编号走共用判据");
ok(
  !/imageNodes\s*=\s*incoming\.filter\([\s\S]{0,120}?type === "image"/.test(service),
  "服务端不再就地 filter type === \"image\""
);
has(
  context,
  'node.type === "image" && !node.data.media?.ossKey',
  "「空图片节点」判据保持只看 image —— 没有图的商品节点是合法上游,灰掉它就等于把电商轨正常用法说成错误"
);

console.log("\n7. #43 dirty 重算必须与提交路径同序(否则角标永久常亮)");
has(context, "[...textSnapshots, ...imageSnapshots]", "dirty 重算按「先全部文本、再全部图片」分组");
ok(
  countOf(context, "const textSnapshots") === 1 && countOf(context, "const imageSnapshots") === 1,
  "两个分组数组各只有一处定义(避免又出现交错 push 的旧写法)"
);

console.log("\n8. 出口白名单与计费黑名单(两边实扫求交集)");

/** 递归收集 .ts/.tsx 文件。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

const canvasFiles = [
  ...walk("src/components/canvas"),
  ...walk("src/lib/canvas"),
  "src/stores/canvas-store.ts",
];
const EXIT_RE = /['"`](\/api\/[A-Za-z0-9/_${}.\-]*)/g;
const discoveredExits = new Set();
for (const file of canvasFiles) {
  const source = read(file);
  for (const match of source.matchAll(EXIT_RE)) {
    // 归一模板串:把 ${...} 段落换成 :param，并去掉尾部斜杠
    const normalized = match[1].replace(/\$\{[^}]*\}?/g, ":param").replace(/\/+$/, "");
    if (normalized !== "/api") discoveredExits.add(normalized);
  }
}
const nonCanvasExits = [...discoveredExits].filter((p) => !p.startsWith("/api/canvas")).sort();

/**
 * 冻结基线:画布**允许**跨出 `/api/canvas/*` 的出口,逐条都有理由。
 * 新增要红(未审出口),消失也要红(清单烂掉)。
 */
const FROZEN_NON_CANVAS_EXITS = [
  "/api/storage/media-url", // object key → 公有 URL,渲染层用;不计费
  "/api/studio/analyze-product", // 批 5 商品卖点卡;登录鉴权、零积分、不写 generations
  "/api/studio/library", // #64 入库,已随 3dee031 上生产;不计费
];
ok(
  JSON.stringify(nonCanvasExits) === JSON.stringify(FROZEN_NON_CANVAS_EXITS),
  `非 /api/canvas/* 出口必须逐项等于冻结基线。实扫=${JSON.stringify(nonCanvasExits)} 基线=${JSON.stringify(FROZEN_NON_CANVAS_EXITS)}`
);

/**
 * 实扫会动积分的路由。
 *
 * 🔴 **主判据是「import 了共享扣费原语 `@/lib/credits`」,不是 SQL 写法。**
 * 初版只按 `credits: newCredits` / `update({ credits` 这类写法扫,结果
 * **漏掉了 `/api/generate/image`** —— 画布图片生成最主要的计费入口 ——
 * 因为它是经 `@/lib/credits/atomic-task-credit` 的 `scope:"quick-image"` 扣的,
 * 源码里根本没有那些字面量。按写法扫等于给自己发一张空的合格证。
 * 第二条(直写 profiles.credits)保留,用来兜住绕开原语的路由(如 admin 调整)。
 */
const CREDIT_WRITE_RE =
  /(from\s+['"]@\/lib\/credits(?:\/[a-z-]+)?['"]|credits:\s*newCredits|credits:\s*\w*[Bb]alance|update\(\{\s*credits|deductCredits|refundCredits|credits_refunded)/;
const billingRoutes = new Set();
for (const file of walk("src/app/api")) {
  if (!/route\.ts$/.test(file)) continue;
  const source = read(file);
  if (!CREDIT_WRITE_RE.test(source)) continue;
  billingRoutes.add(
    `/${relative("src/app", file).replace(/\\/g, "/").replace(/\/route\.ts$/, "")}`
  );
}
/**
 * 扫描器自证:光断言「扫到 >0 个」挡不住正则腐烂 —— 初版扫到 7 个、看着挺像样,
 * 却恰恰漏了画布最主要的那个计费入口。所以这里钉住三个**必须**被扫到的路由。
 * 它们是画布生成链路真正花钱的地方,任何一个掉出扫描面,这条黑名单就是空的。
 */
const MUST_DETECT_BILLING = [
  "/api/generate/image", // 画布图片生成
  "/api/generate/video", // 视频(非批量)
  "/api/video-batch/models/submit", // 统一视频网关
];
const undetected = MUST_DETECT_BILLING.filter((route) => !billingRoutes.has(route));
ok(
  undetected.length === 0,
  `🔴 计费路由扫描器自证失败:这些必须被扫到却没扫到 ${JSON.stringify(undetected)} —— 黑名单形同虚设,先修正则再谈其它`
);
ok(billingRoutes.size > 0, `计费路由扫描本身有效(扫到 ${billingRoutes.size} 个;为 0 说明正则烂了)`);

const leaked = [...discoveredExits].filter((exit) => billingRoutes.has(exit));
ok(
  leaked.length === 0,
  `🔴 画布对**计费类**路由的引用必须为 0(P1-Q5 ⚠️②)。命中=${JSON.stringify(leaked)}`
);
console.log(
  `   实扫:画布出口 ${discoveredExits.size} 个(其中非 canvas ${nonCanvasExits.length} 个)、计费路由 ${billingRoutes.size} 个、交集 ${leaked.length} 个`
);
console.log(
  "   ⚠️ 断言的是「对计费类路由为 0」,**不是**「非 /api/canvas/* 为 0」—— 后者一跑就红(#64 已在生产调 /api/studio/library)。"
);

if (failed.length > 0) {
  console.error(`\n${failed.length} 条批 5 判据未通过:`);
  for (const label of failed) console.error(`  - ${label}`);
  process.exit(1);
}
console.log(`\nCanvas P1 batch 5 verification passed: ${passed}/${passed}`);
