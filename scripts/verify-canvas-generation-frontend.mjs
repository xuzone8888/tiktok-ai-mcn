#!/usr/bin/env node

/**
 * Offline production guard for the Super Canvas generation client.
 *
 * This intentionally checks the safety invariants at their integration
 * callsites. It has no credentials, browser, database, or network dependency.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const context = read("src/components/canvas/canvas-generation-context.tsx");
const controls = read(
  "src/components/canvas/nodes/generation-controls.tsx"
);
const mediaNode = read("src/components/canvas/nodes/media-node.tsx");
const nodeShell = read("src/components/canvas/nodes/node-shell.tsx");
const board = read("src/components/canvas/canvas-board.tsx");
const projectBar = read("src/components/canvas/canvas-project-bar.tsx");
const root = read("src/components/canvas/canvas-root.tsx");
const page = read("src/app/(canvas)/canvas/page.tsx");
const downloadRoute = read(
  "src/app/api/canvas/generations/[generationId]/download/route.ts"
);

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

/**
 * 纯模块的离线载入(仅剥类型,不做类型检查——那是 `tsc --noEmit` 的活)。
 *
 * 模块体以 `data:` URL 动态 import,而 **`data:` 基址不是层级 URL** ——
 * 所以模块体里任何 import(别名、相对路径都一样)都会 `ERR_UNSUPPORTED_RESOLVE_REQUEST`。
 *
 * `deps` 就是为此开的口子:把依赖模块**一起从真实源码转译**、剥掉 `export ` 变成本地声明、
 * 拼成前缀,再把模块体里对应的 import 语句删掉。这样被测的仍是仓库里那份真源码,
 * 不是脚本里手抄的副本 —— 判据只能有一处产地(见
 * `src/lib/canvas/generation-image-input.ts` 抬头),不允许为了让脚本跑起来而复制它。
 * 依赖自身仍必须是零 import 的纯模块。
 */
const requireFromHere = createRequire(import.meta.url);
async function loadPureModule(relPath, deps = []) {
  const ts = requireFromHere("typescript");
  const transpile = (path) =>
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: path,
    }).outputText;

  let body = transpile(relPath);
  let preamble = "";
  for (const dep of deps) {
    preamble += `${transpile(dep.path).replace(/^export /gm, "")}\n`;
    const escaped = dep.specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const importLine = new RegExp(
      `^import\\s+\\{[^}]*\\}\\s+from\\s+["']${escaped}["'];?[ \\t]*$`,
      "m"
    );
    if (!importLine.test(body)) {
      throw new Error(
        `loadPureModule: ${relPath} 里找不到对 ${dep.specifier} 的 import,deps 配置已过期`
      );
    }
    body = body.replace(importLine, "");
  }

  return import(
    `data:text/javascript;base64,${Buffer.from(preamble + body).toString("base64")}`
  );
}

/**
 * `generation-input-order.ts` 的唯一依赖:参考图判据。
 * 判据本身必须只有一处产地(客户端提交 / 服务端权威重算 / 引用区编号 / #43 角标四处共用),
 * 所以这里内联真源码而不是在脚本里手抄一份。
 */
const INPUT_ORDER_DEPS = [
  {
    specifier: "@/lib/canvas/generation-image-input",
    path: "src/lib/canvas/generation-image-input.ts",
  },
];

console.log("1. Polling authority and cross-canvas isolation");
has(context, "GENERATION_LIST_LIMIT = 100", "uses the maximum bounded list size");
has(
  context,
  "selectLatestGenerationByNode",
  "collapses history to one latest row per node"
);
has(
  context,
  "for (const generation of latest.values())",
  "patches only selected latest rows"
);
lacks(
  context,
  "generations.forEach((generation) => {\n        const prior",
  "does not patch raw historical rows"
);
has(
  context,
  "currentCanvasIdentity() !== currentCanvasId",
  "drops a GET response after project identity changes"
);
has(context, "controller.abort()", "aborts obsolete read-only polling");
has(
  context,
  "generation.canvasId !== currentCanvasId",
  "rejects cross-canvas rows in an otherwise successful payload"
);

console.log("2. Paid-action idempotency and transport ambiguity");
has(
  context,
  "submittingNodeIdsRef.current.has(nodeId)",
  "uses a synchronous per-node submission mutex"
);
has(
  context,
  "persistedGenerationIntent(node.data)",
  "reads the durable intent before deciding whether to create an action"
);
has(
  context,
  "persisted.actionId === unresolvedAction",
  "reuses the persisted actionId for recovery"
);
has(
  context,
  "automaticRecoveryAttemptedRef",
  "bounds automatic recovery attempts per action"
);
has(
  context,
  "isDefinitiveClientResponse",
  "separates definite pre-begin rejection from ambiguous transport"
);
has(
  context,
  "status !== 408",
  "treats request timeout as ambiguous"
);
has(
  context,
  "系统已保留原 actionId",
  "explains no-new-action recovery to the user"
);
has(
  context,
  "generation.actionId !== intent.actionId",
  "verifies the action identity before patching a node"
);
has(
  context,
  "currentCanvasIdentity() !== fence.canvasId",
  "does not patch an accepted submission into a newly opened canvas"
);

console.log("3. Input and provider capability contract");
has(context, "当前生成节点不支持", "rejects unsupported connected node kinds");
has(
  context,
  "图片生成最多支持 1 张参考图",
  "does not silently truncate image references"
);
has(
  context,
  "文生视频不会使用图片输入",
  "does not silently ignore image inputs in prompt-to-video mode"
);
has(context, "最多支持 32 个节点", "preflights the persisted input cap");
has(
  context,
  "NEXT_PUBLIC_CANVAS_VIDEO_MODELS",
  "mirrors the server video model allowlist"
);
has(context, ': ["grok"]', "defaults the public model allowlist to Grok only");
has(
  controls,
  "ENABLED_VIDEO_MODEL_OPTIONS",
  "renders only explicitly enabled video models"
);

console.log("4. Sync, unknown, deletion, and undo safety");
has(context, 'useState<CanvasGenerationSyncState>("idle")', "tracks initial sync");
has(
  controls,
  "unresolvedActionByNodeId.get(nodeId)",
  "surfaces locally ambiguous submission state"
);
has(
  controls,
  'generation.status === "unknown"',
  "blocks server-side unknown tasks"
);
has(
  controls,
  "提交结果正在幂等核对",
  "blocks deletion during local idempotent recovery"
);
has(
  mediaNode,
  "deleteDisabledReason={deleteDisabledReason}",
  "applies protection to the node delete button"
);
has(
  nodeShell,
  "disabled={readOnly || Boolean(deleteDisabledReason)}",
  "rechecks node deletion at confirmation time"
);
has(
  board,
  "generationProtectionReason(nodeIds)",
  "guards keyboard and batch deletion"
);
has(
  board,
  "pendingDelete.nodeIds",
  "rechecks protection after the batch dialog opens"
);
has(
  board,
  "allGenerationProtectedNodeIds",
  "prevents undo/redo from removing an in-flight target"
);

console.log("5. Quote, download, project lifecycle, and accessibility");
has(
  context,
  "!Number.isSafeInteger(estimateValue.cost)",
  "rejects malformed paid quotes"
);
has(
  controls,
  "estimateValue === null",
  "keeps generation disabled until a verified quote exists"
);
has(
  controls,
  "`/api/canvas/generations/${generationId}/download`",
  "routes downloads through the owner-authenticated server boundary"
);
lacks(controls, "response.blob()", "does not buffer large videos into renderer memory");
has(
  downloadRoute,
  '.eq("user_id", user.id)',
  "download route fences the generation to the authenticated owner"
);
has(
  downloadRoute,
  'data.source !== "canvas" ||\n    data.status !== "completed"',
  "download route accepts only completed Canvas outputs"
);
has(
  downloadRoute,
  "getSignedDownloadUrl(data.output_oss_key, filename)",
  "download route signs only the authoritative database object key"
);
has(
  downloadRoute,
  'status: 307',
  "download route returns a short-lived redirect without buffering media"
);
has(controls, 'role="progressbar"', "exposes generation progress semantics");
has(
  projectBar,
  "listAbortController.current?.abort()",
  "cancels obsolete project list requests"
);
has(
  projectBar,
  "typeof body.error.message",
  "parses structured API errors"
);
has(projectBar, 'kind: "rename"', "save-fences metadata rename");
has(projectBar, 'kind: "delete"', "save-fences destructive project deletion");
has(
  root,
  'debug.mode === "failed"',
  "blocks navigation when persistence has failed"
);
has(root, "debug.repairRequired", "blocks navigation during required repair");
has(
  root,
  "mutationDisabled",
  "prevents a read-only tab from renaming or deleting a project"
);
has(
  page,
  '.select("title")',
  "loads the authoritative title even for projects beyond list page one"
);

console.log(
  "\nN. CHECKLIST #51②③ — reconciliation triggers: load / foreground / manual"
);
// 加载与轮询本就有;缺的是「回前台」与「常态手动刷新」,这两条在 2026-08-09 前全仓 0 命中。
has(
  context,
  'document.addEventListener("visibilitychange", run)',
  "#51② returning to foreground reconciles immediately"
);
has(
  context,
  'window.addEventListener("focus", run)',
  "#51② window refocus also reconciles (Chrome skips visibilitychange on app switch)"
);
has(
  context,
  "VISIBILITY_REFRESH_THROTTLE_MS",
  "#51② foreground refetch is throttled so rapid tab switching cannot hammer the API"
);
ok(
  /document\.removeEventListener\("visibilitychange", run\)[\s\S]{0,160}window\.removeEventListener\("focus", run\)/.test(
    context
  ),
  "#51② both foreground listeners are torn down"
);
has(controls, "刷新状态", "#51③ panel exposes an always-available manual refresh");
ok(
  /disabled=\{manualRefreshing \|\| syncState === "loading"\}/.test(controls),
  "#51③ manual refresh cannot stack on an in-flight sync"
);
ok(
  /\{!readOnly && enabled && \(\s*<button/.test(controls),
  "#51③ manual refresh is hidden in read-only mode (it must not issue requests there)"
);

console.log(
  "\nN+1. CHECKLIST #187 — every parameter carries one-line plain-language copy"
);
const paramCopy = read("src/components/canvas/nodes/generation-param-copy.ts");
const selectFieldCount = (controls.match(/<SelectField\b/g) || []).length;
const hintKeyUses = [...controls.matchAll(/hintKey="([^"]+)"/g)].map((m) => m[1]);
ok(
  selectFieldCount > 0 && hintKeyUses.length === selectFieldCount,
  `#187 every rendered <SelectField> declares a hintKey (${hintKeyUses.length}/${selectFieldCount})`
);
const registeredHints = [...paramCopy.matchAll(/"([a-z]+\.[A-Za-z]+)":/g)].map(
  (m) => m[1]
);
for (const key of hintKeyUses) {
  ok(
    registeredHints.includes(key),
    `#187 hint copy exists for parameter "${key}"`
  );
}
ok(
  new Set(hintKeyUses).size === hintKeyUses.length,
  "#187 no two parameters share the same hint key"
);
// 文案纪律:价目由 generation-pricing.ts 决定、能力档位由 VIDEO_MODEL_CATALOG 决定,
// 都会变;写死在静态文案里等于埋一条迟早说谎的话。
ok(
  !/\d+\s*积分/.test(paramCopy),
  "#187 hint copy never hardcodes credit amounts (pricing drifts; the live estimate line is authoritative)"
);
has(
  controls,
  'aria-description={hint}',
  "#187 hint is exposed to assistive tech without overriding the parameter name"
);

console.log(
  "\nN+2. CHECKLIST #186 — disabled controls explain why and how to unlock"
);
const { resolveGenerationLockHint } = await loadPureModule(
  "src/components/canvas/nodes/generation-lock-hints.ts"
);
const baseLock = {
  readOnly: false,
  enabled: true,
  submitting: false,
  active: false,
  uncertain: false,
  reconciling: false,
  syncState: "ready",
  kind: "image",
  incomingImageCount: 0,
};
const lock = (patch) => resolveGenerationLockHint({ ...baseLock, ...patch });
ok(lock({}) === null, "#186 a ready image node reports no lock");
ok(
  lock({ kind: "video", videoMode: "prompt_to_video" }) === null,
  "#186 prompt-to-video needs no upstream image"
);
ok(
  lock({ kind: "video", videoMode: "image_to_video" })?.kind ===
    "missing_upstream_image",
  "#186 image-to-video without an upstream image is explained BEFORE submitting"
);
ok(
  lock({ kind: "video", videoMode: "image_to_video", incomingImageCount: 1 }) ===
    null,
  "#186 connecting one image clears that lock"
);
// 优先级:最硬的原因先讲,免得用户按「去连张图」照做后发现还是不能点。
ok(
  lock({ readOnly: true, kind: "video", videoMode: "image_to_video" })?.kind ===
    "read_only",
  "#186 read-only outranks the missing-image hint"
);
ok(
  lock({ active: true, kind: "video", videoMode: "image_to_video" })?.kind ===
    "running",
  "#186 a running task outranks the missing-image hint"
);
ok(
  lock({ uncertain: true })?.kind === "uncertain",
  "#186 unknown upstream state is explained"
);
ok(
  lock({ reconciling: true })?.kind === "reconciling",
  "#186 pending idempotency check is explained"
);
ok(
  lock({ syncState: "loading" })?.kind === "syncing",
  "#186 in-flight sync is explained"
);
ok(
  lock({ enabled: false })?.kind === "feature_disabled",
  "#186 gray-release gating is explained"
);
for (const patch of [
  {},
  { readOnly: true },
  { enabled: false },
  { submitting: true },
  { active: true },
  { uncertain: true },
  { reconciling: true },
  { syncState: "loading" },
  { kind: "video", videoMode: "image_to_video" },
]) {
  const hint = lock(patch);
  if (!hint) continue;
  ok(
    typeof hint.reason === "string" && hint.reason.length > 0,
    `#186 lock "${hint.kind}" states a reason`
  );
  ok(
    Array.isArray(hint.steps),
    `#186 lock "${hint.kind}" carries a (possibly empty) step list`
  );
}
has(
  controls,
  "为什么现在不能生成？",
  "#186 the panel exposes a clickable unlock guide"
);
has(
  controls,
  "resolveGenerationLockHint",
  "#186 the panel derives the guide from the shared pure resolver, not ad-hoc strings"
);

console.log("\nN+3. CHECKLIST #84 — node-level fullscreen preview of the artifact");
has(controls, "全屏", "#84 completed artifacts expose a fullscreen action");
has(
  controls,
  "setPreviewOpen(true)",
  "#84 the fullscreen action opens the preview dialog"
);
ok(
  /\{previewOpen && mediaUrl \?/.test(controls),
  "#84 preview media mounts only while open (a closed dialog must not hold a <video>)"
);
// ADR5 红线:签名 URL 是瞬态的。预览允许**读** mediaUrl,绝不允许把它写回节点/持久层。
ok(
  !/updateParams\([^)]*mediaUrl/.test(controls) &&
    !/ossKey:\s*mediaUrl/.test(controls),
  "#84 the preview never persists the transient signed URL back into the document"
);

console.log(
  "\nN+4. CHECKLIST #44/#72/#94 — reference strip: numbered upstream thumbnails"
);
const { orderGenerationInputNodes, collectImageReferences } =
  await loadPureModule(
    "src/components/canvas/generation-input-order.ts",
    INPUT_ORDER_DEPS
  );
const img = (id, key) => ({ id, type: "image", data: { media: { ossKey: key } } });
const txt = (id) => ({ id, type: "text", data: {} });
const edge = (source, target) => ({ source, target });
// 顺序以 edges 为准,不是 nodes 数组序 —— 这正是修掉的那个不一致。
{
  const nodes = [img("a", "k-a"), img("b", "k-b"), img("c", "k-c")];
  const edges = [edge("c", "t"), edge("a", "t"), edge("b", "x")];
  const ordered = orderGenerationInputNodes(nodes, edges, "t");
  ok(
    ordered.map((n) => n.id).join(",") === "c,a",
    "#44 upstream order follows edge order, not node-array order"
  );
  const refs = collectImageReferences(ordered);
  ok(
    refs.map((r) => `${r.label}:${r.ossKey}`).join(",") === "图1:k-c,图2:k-a",
    "#44 reference labels are assigned in that same edge order"
  );
}
{
  // 同一上游连多条边只算一次,且按首次出现定位。
  const nodes = [img("a", "k-a"), img("b", "k-b")];
  const edges = [edge("b", "t"), edge("a", "t"), edge("b", "t")];
  const ordered = orderGenerationInputNodes(nodes, edges, "t");
  ok(
    ordered.map((n) => n.id).join(",") === "b,a",
    "#44 duplicate edges from one source collapse to its first position"
  );
}
{
  // 空图片节点不占编号 —— 与提交路径的 imageInputNodes 判据逐字一致
  // (空节点在提交时另有专门报错,若在这里占了号,UI 的「图2」就会是请求里的「图1」)。
  const nodes = [img("a", ""), img("b", "k-b"), txt("c")];
  const edges = [edge("a", "t"), edge("b", "t"), edge("c", "t")];
  const refs = collectImageReferences(
    orderGenerationInputNodes(nodes, edges, "t")
  );
  ok(
    refs.length === 1 && refs[0].label === "图1" && refs[0].ossKey === "k-b",
    "#44 empty image nodes and non-image nodes never consume a reference number"
  );
}
ok(
  orderGenerationInputNodes([], [], "t").length === 0,
  "#44 no upstream yields no references"
);
// 两条消费路径必须共用同一个排序器,否则序号会重新分叉。
has(
  context,
  "orderGenerationInputNodes(state.nodes, state.edges, targetNodeId)",
  "#44 the submit path consumes the shared ordering helper"
);
has(
  controls,
  "orderGenerationInputNodes(nodes, edges, nodeId)",
  "#44 the panel consumes the very same ordering helper"
);
lacks(
  controls,
  "nodes.filter((node) => idSet.has(node.id))",
  "#44 the old node-array-order derivation is gone from the panel"
);
const strip = read("src/components/canvas/nodes/generation-reference-strip.tsx");
has(strip, "resolveMediaUrl", "#72/#94 thumbnails resolve object keys to transient URLs");
ok(
  !/updateParams|ossKey:\s*url|useCanvasStore/.test(strip),
  "#72/#94 the strip never writes the transient signed URL back into the document (ADR5)"
);
has(strip, "reference.label", "#44 each thumbnail renders its ordinal label");

console.log("\nN+5. CHECKLIST #64 — artifact actions: archive to library / push as reference");
const libraryRoute = read("src/app/api/studio/library/route.ts");
has(
  controls,
  '"/api/studio/library"',
  "#64 archiving reuses the existing Studio endpoint instead of a canvas-only fork"
);
ok(
  /generationIds: \[generationId\]/.test(controls),
  "#64 canvas archives by generationId — canvas direct images have task_id = null"
);
has(
  libraryRoute,
  'update.in("id", generationIds)',
  "#64 the endpoint accepts generationId as an alternative match key"
);
has(
  libraryRoute,
  'taskIds 与 generationIds 只能二选一',
  "#64 mixing both match keys is rejected rather than silently double-counted"
);
ok(
  /updated: updatedGenerationIds\.length/.test(libraryRoute),
  "#64 `updated` counts rows, not task_ids (canvas rows would otherwise report 0 on success)"
);
// 四道闸必须仍在,扩参数不等于放松校验。
has(libraryRoute, '.eq("user_id", user.id)', "#64 ownership guard intact");
has(libraryRoute, '.eq("status", "completed")', "#64 completed-only guard intact");
has(
  libraryRoute,
  '.neq("library_status", "published")',
  "#64 published-state guard intact"
);
ok(
  /if \(!body\.data\?\.updated\)/.test(controls),
  "#64 a zero-row update surfaces as a failure, not a fake success"
);
has(
  controls,
  "推为参考",
  "#64 completed image artifacts can be pushed as a downstream reference"
);
has(
  controls,
  "addNodeAndEdge",
  "#64 push-as-reference goes through the store's atomic node+edge op (undoable)"
);
ok(
  /generation\?\.status === "completed" && !readOnly/.test(controls),
  "#64 side-effecting artifact actions are hidden in read-only mode"
);

console.log(
  "\nN+6. 出处闸与资金披露（2026-08-09 审计:此前客户端这一半零断言，删掉那个 if 也全绿）"
);
// 服务端只返回 needsConfirmation 这个布尔;真正把它变成一道闸的是组件里那一行判断。
// 之前 122 条断言里没有任何一条守着它 —— 把它删掉 tsc/build/前后端 verifier 全绿。
ok(
  /resolveCanvasGenerateConsent\(\{/.test(controls),
  "the client routes every paid submit through the shared consent gate"
);
ok(
  /if \(gate\.decision === "confirm"\)/.test(controls),
  "a 'confirm' verdict actually opens the dialog instead of submitting"
);
ok(
  /thresholdTrigger: estimateValue\.confirmationReason/.test(controls),
  "#185's server verdict is fed into the gate verbatim (client never re-derives it)"
);
// 确认弹窗必须用定格快照:开着时后台同步一失败,活对象会退化成「预计 0 积分、余额 0」,
// 而那恰好是最需要金额准确的那一次。
ok(
  /const \[confirmSnapshot, setConfirmSnapshot\]/.test(controls),
  "the confirm dialog freezes cost/balance when it opens"
);
lacks(controls, "const [confirmOpen", "the old live-reading boolean is gone");
ok(
  /confirmSnapshot\?\.cost \?\? 0/.test(controls),
  "the dialog renders the frozen amount, not the live one"
);
ok(
  /estimateValue\.cost !== snapshot\.cost/.test(controls),
  "confirming re-checks the quote; a changed price is refused rather than charged silently"
);
// 「提交后不可取消、不退款」在弹窗不弹的路径上曾完全消失。
ok(
  /GENERATION_IRREVERSIBLE_NOTICE/.test(controls),
  "the irreversibility notice exists as a shared constant"
);
ok(
  /generationCancelUnsupportedReason\(kind, data\)\s*\?\s*GENERATION_IRREVERSIBLE_NOTICE/.test(
    controls
  ),
  "the notice is gated on the model actually being uncancellable, so it retires itself"
);
// ≤1366 多选时两个面板外观完全一致 —— 点错就是在错的节点上花钱。
ok(
  /data-node-id=\{nodeId\}/.test(controls),
  "each docked panel carries a node anchor"
);
ok(
  /dockedNodeLabel/.test(controls),
  "the docked title identifies which node the panel belongs to"
);
// 复制节点不得把待恢复的付费意图一起复制过去。
{
  const groupOps = read("src/lib/canvas/group-ops.ts");
  ok(
    /export function stripGenerationIntent/.test(groupOps),
    "duplicate path exposes a named intent-stripper (greppable/testable)"
  );
  ok(
    /params: stripGenerationIntent\(clonedData\.params\)/.test(groupOps),
    "duplicated nodes do not inherit a pending paid intent"
  );
  ok(
    !/delete next\.refs/.test(groupOps),
    "refs survive duplication (stripping them would hide the copied artifact)"
  );
}

/*
 * 画幅三处同源(CHECKLIST #78 / P1-Q2a)。
 *
 * 面板、客户端草稿类型、intent schema 曾各写各的(面板 6、另两处各 11),而它们的差集
 * 正好是上游 sizeMap 够不着、会静默回落 auto 却按全价扣费的档位。tsc 的 `satisfies`
 * 只能保证面板列的每一项**合法**,保证不了**一项不漏**;这里补上「数量与集合都相等」那一半。
 */
{
  const intentSrc = read("src/lib/canvas/generation-intent.ts");
  const apiTypes = read("src/lib/canvas/generation-api-types.ts");
  const declared = intentSrc.match(
    /export const CANVAS_IMAGE_ASPECT_RATIOS = \[([\s\S]*?)\] as const;/
  );
  ok(Boolean(declared), "image aspect ratios are declared in one named const");
  const declaredValues = declared
    ? [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];
  ok(
    declaredValues.length === 6,
    "canvas image aspect ratios stay at the 6 upstream sizeMap keys"
  );
  ok(
    /aspectRatio: z\.enum\(CANVAS_IMAGE_ASPECT_RATIOS\)/.test(intentSrc),
    "intent schema derives aspectRatio from the shared const (no parallel literal)"
  );
  ok(
    /aspectRatio: z\.enum\(CANVAS_IMAGE_ASPECT_RATIOS\)/.test(apiTypes),
    "estimate schema derives aspectRatio from the shared const (estimate and submit agree)"
  );
  ok(
    /aspectRatio: CanvasImageAspectRatio;/.test(context),
    "client draft type derives aspectRatio from the shared const"
  );
  ok(
    /aspectValues: readonly CanvasImageDraftConfig\["aspectRatio"\]\[\] =\s*\n?\s*CANVAS_IMAGE_ASPECT_RATIOS;/.test(
      context
    ),
    "stored-doc allow-list derives from the shared const"
  );
  const panel = controls.match(
    /\(\s*\[([^\]]*)\] satisfies Array<\s*CanvasImageDraftConfig\["aspectRatio"\]\s*>\s*\)/
  );
  ok(Boolean(panel), "panel renders aspect options from one greppable ordered list");
  const panelValues = panel
    ? [...panel[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];
  ok(
    panelValues.length === declaredValues.length &&
      [...panelValues].sort().join(",") === [...declaredValues].sort().join(","),
    "panel offers exactly the supported aspect ratios (no silent-fallback options, none missing)"
  );
  for (const dead of ["3:2", "2:3", "5:4", "4:5", "21:9"]) {
    ok(
      !declaredValues.includes(dead) && !panelValues.includes(dead),
      `aspect ratio ${dead} stays out of canvas (upstream sizeMap has no pixel size for it)`
    );
  }
}

/*
 * CHECKLIST #82 裁剪 —— 必须是**纯前端零扣费**,且结果走画布已有的上传链路。
 *
 * 这里守的不是样式,是三条会真出事的边界:
 *  ①裁剪弹层不得出现任何生成/估价端点(一旦误接就成了「点裁剪扣一次钱」);
 *  ②`crossOrigin` 不能丢 —— 产物在 OSS 跨域,丢了会污染 canvas 让 toBlob 抛 SecurityError,
 *    而那是运行时才炸、离线闸门看不见的;
 *  ③结果落节点必须**不连线** —— 画布的边语义是「上游是下游的生成参考图」,
 *    把裁剪产物连回原图会让用户一按生成就把原图当参考送进去(要花钱才发现)。
 */
{
  const crop = read("src/components/canvas/nodes/generation-crop-dialog.tsx");
  ok(
    !/\/api\/canvas\/generations/.test(crop) && !/estimate/.test(crop),
    "crop dialog never touches a generation or estimate endpoint (stays free)"
  );
  ok(
    /crossOrigin="anonymous"/.test(crop),
    "crop source image is loaded with CORS so the canvas is not tainted"
  );
  ok(
    /canvas\.toBlob\(/.test(crop) && /"image\/jpeg"/.test(crop),
    "crop exports JPEG (canvas upload contract allows it and it stays under the size cap)"
  );
  ok(
    /naturalWidth/.test(crop) && /naturalHeight/.test(crop),
    "crop maps the selection back to natural pixels, not displayed pixels"
  );
  has(controls, "<GenerationCropDialog", "crop dialog is mounted from the panel");
  has(
    controls,
    "uploadCanvasFile(file)",
    "crop result reuses the canvas upload chain (quota/size/ownership checks apply)"
  );
  ok(
    /CANVAS_UPLOAD_MAX_IMAGE_BYTES/.test(controls),
    "crop result is size-checked before upload is attempted"
  );
  // 下面两条对着**裁剪回调这一段**断言,而不是全文件 —— 全文件里 addNodeAndEdge 本来就有
  // (「推为参考」用它),对全文件做否定断言会永远为真,等于没守。
  const cropHandler = (() => {
    const start = controls.indexOf("onConfirm={(blob) => {");
    ok(start > -1, "crop confirm handler is greppable");
    return start > -1 ? controls.slice(start, start + 2400) : "";
  })();
  ok(
    /data: \{ media: \{ ossKey \} \}/.test(cropHandler),
    "crop result becomes an image node carrying only an OSS object key"
  );
  // 🔴 **反向断言,别改回去。** 本条曾要求 `title: "裁剪结果"`,2026-08-10 实测发现
  // 图片/视频节点**没有「显示标题」这回事** —— `data.title` 就是提示词 textarea 的
  // value,也是逐字送厂商的那段文本。写进去等于给新节点预填一句谁也没写过的提示词,
  // 用户一按生成就照着它花钱。所以这里断言的是**新节点载荷里不许出现 title**。
  // 只盯 addNode 那一段:回调里还有四个 `toast({ title: … })` 是正常的用户提示。
  const cropAddNodePayload = (() => {
    const start = cropHandler.indexOf(".addNode({");
    return start > -1 ? cropHandler.slice(start, start + 420) : "";
  })();
  ok(
    cropAddNodePayload.length > 0 && !/title:/.test(cropAddNodePayload),
    "crop result must NOT prefill data.title — that field IS the vendor prompt, not a label"
  );
  ok(
    /\.addNode\(\{/.test(cropHandler) && !/addNodeAndEdge/.test(cropHandler),
    "crop result is a standalone node (an edge would mean 'use the source as a reference image')"
  );
  ok(
    /kind === "image" && !readOnly && \(\s*<Button/.test(
      controls.slice(controls.indexOf("CHECKLIST #82"))
    ),
    "crop is offered only for writable image artifacts"
  );
}

/*
 * CHECKLIST #83 整图重生成 —— **已由主生成按钮承载**,不要再加第二个入口。
 *
 * 2026-08-09 批 0 曾把本项误判为「确实缺」,原因是按 `整图`/`重生成`/`regenerate` 去 grep,
 * 而实际落在界面上的字是**「生成新版本」**。这里把它钉死,免得下个窗口重复误判、
 * 或是新加一条绕开 #185 同意闸的重生成路径。
 */
{
  has(controls, '"生成新版本"', "completed artifacts expose whole-image regeneration");
  const disabledBlock = controls.slice(
    controls.indexOf("const actionDisabled ="),
    controls.indexOf("const actionDisabled =") + 400
  );
  ok(
    !/completed/.test(disabledBlock),
    "regeneration stays enabled after a run completes (that is what makes #83 reachable)"
  );
  ok(
    /onClick=\{\(\) => onGenerate\("button"\)\}/.test(controls),
    "regeneration goes through the shared onGenerate path (so #185 consent and the price gates apply)"
  );
}

/*
 * CHECKLIST #43 「输入已更新」dirty 角标。
 *
 * 判定是纯函数,所以这里**真跑穷举**而不是读字符串。守两类东西:
 *  ①比对口径 —— CHECKLIST 备注写的「只存/只比 generationId」是不完备的,
 *    上传图/裁剪图/推参考来的图 refs.generationId 恒为 null,只比它会完全看不见换图;
 *  ②架构决定 —— #43 必须**纯派生、零文档写入**。自动写文档要过写者租约、
 *    会往 undo 栈插一条用户没做过的步骤、并在只读态静默失败(角标永不亮)。
 *    第 10 条那个计数断言就是把这件事钉死,防下个窗口改回落盘式。
 */
{
  const order = await loadPureModule(
    "src/components/canvas/generation-input-order.ts",
    INPUT_ORDER_DEPS
  );
  const cmp = order.compareGenerationInputSnapshots;
  ok(typeof cmp === "function", "#43 dirty comparison is a pure exported function");

  const img = (nodeId, ossKey, generationId) => ({
    kind: "image",
    nodeId,
    ossKey,
    ...(generationId ? { generationId } : {}),
  });
  const txt = (nodeId, sha) => ({ kind: "text", nodeId, textSha256: sha });

  ok(cmp(null, [img("a", "k1")]).dirty === false, "#43 missing snapshot is never dirty (existing production docs must not all light up)");
  ok(cmp([img("a", "k1")], null).dirty === false, "#43 unresolvable current inputs are not dirty");
  ok(cmp([], []).dirty === false, "#43 no inputs on either side is not dirty");
  ok(cmp([img("a", "k1")], [img("a", "k1")]).dirty === false, "#43 identical inputs are not dirty (dragging or editing this node must not light it)");

  const regenerated = cmp([img("a", "k1", "u1")], [img("a", "k2", "u2")]);
  ok(regenerated.dirty && regenerated.reasons.includes("regenerated"), "#43 upstream re-generated is dirty");

  // 这一条专门证伪「只比 generationId」:两侧都没有 generationId,只有 ossKey 变了。
  const replaced = cmp([img("a", "k1")], [img("a", "k2")]);
  ok(replaced.dirty && replaced.reasons.includes("replaced"), "#43 upstream image swapped without any generationId is still dirty (uploads/crops have no generationId)");

  const textChanged = cmp([txt("t", "sha1")], [txt("t", "sha2")]);
  ok(textChanged.dirty && textChanged.reasons.includes("text_changed"), "#43 upstream text edit is dirty");

  ok(cmp([img("a", "k1")], [img("a", "k1"), img("b", "k2")]).reasons.includes("added"), "#43 newly connected upstream is dirty");
  ok(cmp([img("a", "k1"), img("b", "k2")], [img("a", "k1")]).reasons.includes("removed"), "#43 disconnected upstream is dirty");

  const reordered = cmp([img("a", "k1"), img("b", "k2")], [img("b", "k2"), img("a", "k1")]);
  ok(reordered.dirty && reordered.reasons.includes("reordered"), "#43 reordered upstream is dirty (order decides what 图1/图2 means in the prompt)");

  // 对账把同一份产物重新登记一次(key 不变、generationId 补上)不该点亮角标。
  ok(cmp([img("a", "k1")], [img("a", "k1", "u1")]).dirty === false, "#43 re-stamping the same artifact is not a content change");

  const many = cmp([img("a", "k1"), img("a2", "k9")], [img("a", "k2"), img("a2", "k9")]);
  ok(many.reasons.length === new Set(many.reasons).size, "#43 reasons are de-duplicated");
  ok(many.changedNodeIds.every((id) => ["a", "a2"].includes(id)), "#43 changedNodeIds only names known upstream nodes");

  // 架构 tripwire:#43 不得引入任何新的文档写入。
  const writes = (context.match(/state\.updateNodeData\(/g) || []).length;
  ok(
    writes === 3,
    `#43 stays purely derived: generation context still performs exactly 3 document writes (found ${writes}); a 4th means someone made the badge persist state`
  );
  has(context, "inputsDirtyNodeIds", "dirty node set is exposed on the generation context");
  ok(
    /data-node-inputs="dirty"/.test(nodeShell),
    "#43 badge exposes a stable walkthrough hook"
  );
  ok(
    /<span className="sr-only">\{inputsDirty\.title\}<\/span>/.test(nodeShell),
    "#43 badge is announced to screen readers, not colour-only"
  );
  // 判据必须是 **import 形式**,不能是裸串 —— 注释里提到这个模块名是正当的
  // (本文件的注释就在解释为什么不能 import 它),用裸串会把说明文字也算成违规。
  // 这与 verify-canvas-s6.mjs 的 importsSpec 判据保持一致。
  ok(
    /inputsDirtyNodeIds/.test(mediaNode) &&
      !/\bfrom\s+['"][^'"]*canvas-store/.test(mediaNode),
    "#43 badge reaches media nodes through the generation context, never the store (ADR5)"
  );
}

/*
 * CHECKLIST #182 @引用素材(@节点 / @历史)。
 *
 * 全批的资金防线只压在**一件事**上:@ 展示与插入的「图N」必须与请求里真正的第 N 张一致。
 * 其余失败模式在现有链路里都是结构性零扣费(超限在 fetch 之前抛、输入/提示词不一致在
 * 扣费边界之前 409、报价与引用数无关),唯独编号错位会让用户**照着错编号写提示词、
 * 按全价扣分、拿回不对的图**,而且要花钱才发现。
 */
{
  const order = await loadPureModule(
    "src/components/canvas/generation-input-order.ts",
    INPUT_ORDER_DEPS
  );
  const mention = await loadPureModule(
    "src/components/canvas/nodes/generation-mention-policy.ts"
  );

  const imgNode = (id, ossKey) => ({
    id,
    type: "image",
    data: { media: { ossKey } },
  });
  const edge = (source, target) => ({ source, target });

  // —— A. 编号一致性:预测 == 事实 ——
  {
    const nodes = [imgNode("a", "k1"), imgNode("b", "k2"), { id: "t", type: "image", data: {} }];
    const edges = [edge("a", "t")];
    const predicted = order.previewImageReferencesAfterConnect(nodes, edges, "t", "b");
    const actual = order.collectImageReferences(
      order.orderGenerationInputNodes(nodes, [...edges, edge("b", "t")], "t")
    );
    ok(
      JSON.stringify(predicted) === JSON.stringify(actual),
      "#182 predicted numbering equals what actually happens after connecting (no parallel numbering)"
    );
    // 新边一律 append ⇒ 后连的必然拿最大的 N。这条证伪「按候选列表下标编号」。
    ok(
      predicted.find((r) => r.nodeId === "b")?.label === "图2",
      "#182 a newly mentioned image takes the LAST index, not the picker's list position"
    );
  }
  {
    // 空图片节点不占号(与提交路径判据同源)。
    const nodes = [imgNode("a", "k1"), { id: "empty", type: "image", data: {} }];
    const predicted = order.previewImageReferencesAfterConnect(
      nodes, [edge("a", "t")], "t", "empty"
    );
    ok(predicted.length === 1, "#182 an empty image node never takes a 图N slot");
  }
  {
    // 文本节点不占图片编号。
    const nodes = [imgNode("a", "k1"), { id: "txt", type: "text", data: { title: "x" } }];
    const predicted = order.previewImageReferencesAfterConnect(
      nodes, [edge("a", "t")], "t", "txt"
    );
    ok(
      predicted.length === 1 && predicted[0].label === "图1",
      "#182 mentioning a text node does not shift image numbering"
    );
  }

  // —— B. 候选可选性必须在选取之前判定(#186 纪律) ——
  const baseCandidateInput = {
    nodes: [imgNode("a", "k1"), imgNode("b", "k2"), { id: "txt", type: "text", data: { title: "hi" } }],
    connectedNodeIds: [],
    targetNodeId: "t",
    targetKind: "image",
    referenceLimit: 1,
    incomingImageCount: 0,
  };
  {
    const list = mention.resolveMentionCandidates(baseCandidateInput);
    ok(list.length === 3, "#182 candidates list text/product/image only");
    ok(list.every((c) => !c.disabled), "#182 nothing is disabled when a slot is free");
  }
  {
    const full = mention.resolveMentionCandidates({
      ...baseCandidateInput,
      connectedNodeIds: ["a"],
      incomingImageCount: 1,
    });
    ok(
      full.find((c) => c.nodeId === "a")?.disabled === true,
      "#182 an already-connected node is disabled"
    );
    ok(
      full.find((c) => c.nodeId === "b")?.disabled === true &&
        Boolean(full.find((c) => c.nodeId === "b")?.reason),
      "#182 over the reference limit is disabled BEFORE picking, with a stated reason (not thrown after the spend dialog)"
    );
    ok(
      full.find((c) => c.nodeId === "txt")?.disabled === false,
      "#182 text nodes stay pickable when the image slot is full (they do not consume it)"
    );
  }
  {
    const emptyImg = mention.resolveMentionCandidates({
      ...baseCandidateInput,
      nodes: [{ id: "e", type: "image", data: {} }],
    });
    ok(emptyImg[0].disabled === true, "#182 an image node with no artifact is disabled");
  }
  {
    const promptVideo = mention.resolveMentionCandidates({
      ...baseCandidateInput,
      targetKind: "video",
      videoMode: "prompt_to_video",
      referenceLimit: 0,
    });
    ok(
      promptVideo.find((c) => c.nodeId === "a")?.disabled === true,
      "#182 prompt-to-video disables image candidates (connecting one throws at submit)"
    );
  }
  {
    const self = mention.resolveMentionCandidates({
      ...baseCandidateInput,
      nodes: [{ id: "t", type: "image", data: { media: { ossKey: "k" } } }],
      targetNodeId: "t",
    });
    ok(self.length === 0, "#182 a node never offers itself (self-loop)");
  }
  {
    const vid = mention.resolveMentionCandidates({
      ...baseCandidateInput,
      nodes: [{ id: "v", type: "video", data: { media: { ossKey: "k" } } }],
    });
    ok(vid.length === 0, "#182 video nodes are not offered as generation inputs");
  }

  // —— C. 弹层开着按 Enter 绝不能变成一次付费提交 ——
  {
    const actions = ["insert", "navigate", "close", "passthrough"];
    for (const key of ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "a", "@"]) {
      const got = mention.decideMentionKey({
        key, ctrlKey: false, metaKey: false, composing: false, popupOpen: true,
      });
      ok(actions.includes(got), `#182 mention key "${key}" resolves to a non-submitting action`);
    }
    ok(
      mention.decideMentionKey({ key: "Enter", ctrlKey: false, metaKey: false, composing: false, popupOpen: true }) === "insert",
      "#182 Enter with the popup open selects a candidate"
    );
    ok(
      mention.decideMentionKey({ key: "Enter", ctrlKey: true, metaKey: false, composing: false, popupOpen: true }) === "passthrough",
      "#182 Ctrl+Enter still reaches the submit path (the popup never swallows it)"
    );
    ok(
      mention.decideMentionKey({ key: "Enter", ctrlKey: false, metaKey: false, composing: true, popupOpen: true }) === "passthrough",
      "#182 IME composition is never intercepted"
    );
    ok(
      mention.isMentionTriggerKey({ key: "＠", ctrlKey: false, metaKey: false, composing: false }) === true,
      "#182 the full-width ＠ also opens the picker (what most Chinese IMEs emit)"
    );
    ok(
      mention.isMentionTriggerKey({ key: "@", ctrlKey: false, metaKey: false, composing: true }) === false,
      "#182 @ during IME composition does not open the picker"
    );
  }

  // —— D. 插入必须吃掉触发用的 @(提示词逐字送厂商,留下孤立 @ 就是让用户为它付钱) ——
  {
    const withAt = mention.applyMentionInsert({
      text: "主体是猫 @", caret: 6, triggerIndex: 5, label: "图1",
    });
    ok(
      !withAt.text.includes("@") && withAt.text.includes("图1"),
      "#182 the trigger @ is consumed by the insert, never shipped to the provider"
    );
    const noTrigger = mention.applyMentionInsert({
      text: "主体是猫", caret: 4, triggerIndex: -1, label: "图1",
    });
    ok(
      noTrigger.text === "主体是猫 图1",
      "#182 inserting from the + tile adds the label without deleting anything"
    );
  }

  // —— E. 结构守卫:编号只能有一处产地 ——
  {
    const mentionMenu = read("src/components/canvas/nodes/generation-mention-menu.tsx");
    const policy = read("src/components/canvas/nodes/generation-mention-policy.ts");
    for (const [name, src] of [
      ["controls", controls], ["mention menu", mentionMenu], ["mention policy", policy],
    ]) {
      ok(!/图\$\{/.test(src), `#182 ${name} never builds a 图N label itself (single source of truth)`);
    }
    ok(
      /previewImageReferencesAfterConnect\(/.test(controls),
      "#182 the inserted label comes from the shared preview helper"
    );
    ok(
      /addEdge\(\{/.test(controls),
      "#182 a mention creates a real edge (text alone would reference nothing yet still bill)"
    );
    ok(
      /item\.type !== "image"/.test(controls),
      "#182 @history refuses video assets up front (a video upstream only errors after the spend dialog)"
    );
    ok(
      /fromHandleType: "target"/.test(controls),
      "#182 @history builds the node UPSTREAM of the generating node"
    );
    ok(
      /createPortal\(/.test(mentionMenu) && /role="listbox"/.test(mentionMenu),
      "#182 the picker portals out of the React Flow transform and is a listbox (canvas shortcuts yield to it)"
    );
    ok(
      (policy.match(/^import /gm) || []).length === 0,
      "#182 mention policy stays import-free so it can be exhaustively verified offline"
    );
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} frontend invariant(s) failed:`);
  for (const label of failed) console.error(`  - ${label}`);
  process.exit(1);
}

console.log(`\nCanvas generation frontend verification passed: ${passed}/${passed}`);
