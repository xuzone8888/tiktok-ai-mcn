#!/usr/bin/env node

/**
 * Offline production guard for the Super Canvas generation client.
 *
 * This intentionally checks the safety invariants at their integration
 * callsites. It has no credentials, browser, database, or network dependency.
 */
import { readFileSync } from "node:fs";
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
  "!data ||",
  "download route rejects missing generation rows"
);
has(
  downloadRoute,
  'data.source !== "canvas"',
  "download route accepts only Canvas outputs"
);
has(
  downloadRoute,
  'data.status !== "completed"',
  "download route accepts only completed outputs"
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

if (failed.length > 0) {
  console.error(`\n${failed.length} frontend invariant(s) failed:`);
  for (const label of failed) console.error(`  - ${label}`);
  process.exit(1);
}

console.log(`\nCanvas generation frontend verification passed: ${passed}/${passed}`);
