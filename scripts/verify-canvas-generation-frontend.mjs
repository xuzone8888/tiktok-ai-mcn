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
 * 无依赖纯模块的离线载入(仅剥类型,不做类型检查——那是 `tsc --noEmit` 的活)。
 * 只用于本文件里**零 import** 的策略模块;有依赖的走 scripts/canvas-build.mjs。
 */
const requireFromHere = createRequire(import.meta.url);
async function loadPureModule(relPath) {
  const ts = requireFromHere("typescript");
  const { outputText } = ts.transpileModule(read(relPath), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: relPath,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
}

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

if (failed.length > 0) {
  console.error(`\n${failed.length} frontend invariant(s) failed:`);
  for (const label of failed) console.error(`  - ${label}`);
  process.exit(1);
}

console.log(`\nCanvas generation frontend verification passed: ${passed}/${passed}`);
