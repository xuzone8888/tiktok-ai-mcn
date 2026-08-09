#!/usr/bin/env node

/**
 * Pure/offline verifier for the public Canvas generation contract.
 *
 * It executes the transpiled production schemas/pricing/status mapper. No
 * Supabase credentials, OSS access, provider calls, or network are required.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadStandaloneTypeScript(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const output = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

const api = await loadCanvasModule("generation-api-types");
const pricing = await loadCanvasModule("generation-pricing");
const modelPolicy = await loadCanvasModule("generation-model-policy");
const consent = await loadCanvasModule("generation-consent");
// catalog.ts 有相对依赖(./types),必须走能物化依赖闭包的 loadCanvasModule,
// loadStandaloneTypeScript 只转译单文件、解析不了 "./types"。
const catalog = await loadCanvasModule("../video-models/catalog");
const safeMedia = await loadStandaloneTypeScript(
  "../src/lib/safe-media-fetch.ts"
);
const ossMetadata = await loadStandaloneTypeScript(
  "../src/lib/oss-metadata.ts"
);
const atMostOncePlatformPathPolicy =
  /input\.atMostOnce\s*\?\s*\[\s*"\/v1\/videos\?async=true"\s*\]\s*:\s*\[\s*"\/v1\/videos\?async=true"\s*,\s*"\/api\/v1\/generate"\s*\]/;
const grokAdapterSource = readFileSync(
  new URL("../src/lib/video-models/adapters/grok.ts", import.meta.url),
  "utf8"
);
const soraAdapterSource = readFileSync(
  new URL("../src/lib/video-models/adapters/sora.ts", import.meta.url),
  "utf8"
);
const generationServiceSource = readFileSync(
  new URL("../src/lib/canvas/generation-service.ts", import.meta.url),
  "utf8"
);

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function equal(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const ACTION_ID = "123e4567-e89b-42d3-a456-426614174000";
const CANVAS_ID = "123e4567-e89b-42d3-a456-426614174001";
const GENERATION_ID = "123e4567-e89b-42d3-a456-426614174002";

const imageIntent = {
  version: 1,
  kind: "image",
  actionId: ACTION_ID,
  submittedAt: "2026-07-29T08:00:00.000Z",
  prompt: "clean product hero image",
  inputs: [],
  config: {
    model: "gpt-image-2",
    resolution: "2k",
    aspectRatio: "1:1",
    referenceNodeIds: [],
  },
};

const createRequest = {
  canvasId: CANVAS_ID,
  nodeId: "image-node-1",
  actionId: ACTION_ID,
  observedRev: 7,
  writerTag: "writer_12345678",
  intent: imageIntent,
};

ok(
  api.CanvasGenerationCreateRequestSchema.safeParse(createRequest).success,
  "strict create schema accepts canonical identity + intent"
);

for (const forbidden of [
  ["creditCost", 1],
  ["cost", 1],
  ["amount", 1],
  ["imageUrl", "https://attacker.invalid/image.jpg"],
  ["sourceImageUrl", "https://attacker.invalid/ref.jpg"],
]) {
  ok(
    !api.CanvasGenerationCreateRequestSchema.safeParse({
      ...createRequest,
      [forbidden[0]]: forbidden[1],
    }).success,
    `create schema rejects client ${forbidden[0]}`
  );
}

ok(
  !api.CanvasGenerationCreateRequestSchema.safeParse({
    ...createRequest,
    actionId: GENERATION_ID,
  }).success,
  "create schema requires top-level and intent actionId equality"
);

ok(
  !api.CanvasGenerationCreateRequestSchema.safeParse({
    ...createRequest,
    intent: {
      ...imageIntent,
      inputs: [
        {
          kind: "image",
          nodeId: "source",
          ossKey: "https://attacker.invalid/signed.jpg?token=secret",
        },
      ],
      config: {
        ...imageIntent.config,
        referenceNodeIds: ["source"],
      },
    },
  }).success,
  "intent rejects URL/signed URL in place of OSS object key"
);

const imageEstimate1k = {
  kind: "image",
  config: { resolution: "1k", aspectRatio: "1:1" },
};
const imageEstimate4k = {
  kind: "image",
  config: { resolution: "4k", aspectRatio: "16:9" },
};
ok(
  api.CanvasGenerationEstimateRequestSchema.safeParse(imageEstimate1k).success,
  "image estimate accepts only resolution/aspectRatio"
);
for (const extra of [
  { model: "gpt-image-2" },
  { cost: 1 },
  { imageUrl: "https://attacker.invalid/a.jpg" },
  { referenceNodeIds: ["source"] },
]) {
  ok(
    !api.CanvasGenerationEstimateRequestSchema.safeParse({
      ...imageEstimate1k,
      config: { ...imageEstimate1k.config, ...extra },
    }).success,
    `image estimate rejects ${Object.keys(extra)[0]}`
  );
}

const validVideoEstimate = {
  kind: "video",
  config: {
    model: "grok",
    durationSeconds: 15,
    quality: "standard",
    aspectRatio: "9:16",
    mode: "prompt_to_video",
  },
};
ok(
  api.CanvasGenerationEstimateRequestSchema.safeParse(validVideoEstimate).success,
  "video estimate is catalog-valid"
);
ok(
  !api.CanvasGenerationEstimateRequestSchema.safeParse({
    ...validVideoEstimate,
    config: { ...validVideoEstimate.config, durationSeconds: 8 },
  }).success,
  "video estimate rejects unsupported model/duration pair"
);

equal(
  pricing.estimateCanvasGenerationSelection(imageEstimate1k).cost,
  5,
  "server pricing pins 1K image cost"
);
equal(
  pricing.estimateCanvasGenerationSelection(imageEstimate4k).cost,
  15,
  "server pricing pins 4K image cost"
);
equal(
  pricing.estimateCanvasGenerationSelection(validVideoEstimate).cost,
  8,
  "server pricing uses catalog duration-specific video cost"
);
equal(
  pricing.estimateCanvasGeneration(imageIntent).cost,
  10,
  "settlement and estimate share the same 2K price source"
);

// ---- CHECKLIST #185:拦截式确认仅限「余额<预估×1.2 或单次>5000⚡」 ----
// 2026-08-09 用户裁决:按原规格改代码。此前是 needsConfirmation: cost > 0(每次付费都弹)。
// 两个阈值就是资金确认边界,改动须用户裁决,故在此钉死。
equal(
  pricing.CANVAS_CONFIRMATION_LOW_BALANCE_MULTIPLIER,
  1.2,
  "#185 low-balance multiplier pinned to spec value 1.2"
);
equal(
  pricing.CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD,
  1000,
  "#185 high-cost threshold pinned to the 2026-08-09 ruling (5000 -> 1000)"
);
// 5000 曾是画布价目天花板(1080)的 4.6 倍 —— 那条臂在任何输入下都不返回,「双阈值」
// 实际塌缩成单条低余额规则。这道守卫穷举整个视频目录的 supportedDurations x
// supportedQualities(getVideoModelCreditCost 对不支持的组合抛 RangeError,所以只能迭代
// 已声明的数组),证明阈值确实落在价目带内、high_cost 真的可达。
{
  let ceiling = 0;
  for (const id of Object.keys(catalog.VIDEO_MODEL_CATALOG)) {
    const entry = catalog.VIDEO_MODEL_CATALOG[id];
    for (const duration of entry.supportedDurations) {
      for (const quality of entry.supportedQualities) {
        const cost = catalog.getVideoModelCreditCost(id, duration, quality);
        if (cost > ceiling) ceiling = cost;
      }
    }
  }
  for (const resolution of ["1k", "2k", "4k"]) {
    const cost = pricing.estimateCanvasGenerationSelection({
      kind: "image",
      config: { resolution, aspectRatio: "auto" },
    }).cost;
    if (cost > ceiling) ceiling = cost;
  }
  equal(ceiling, 1080, "#185 canvas single-action price ceiling is happyhorse 12s = 1080");
  ok(
    pricing.CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD < ceiling,
    `#185 high-cost threshold (${pricing.CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD}) must sit BELOW the price ceiling (${ceiling}); otherwise the arm is dead code`
  );
}
const trigger = (cost, balance) =>
  pricing.resolveCanvasConfirmationTrigger({ cost, balance });
equal(trigger(0, 0), null, "#185 free action never intercepts");
equal(trigger(-5, 100), null, "#185 non-positive cost never intercepts");
equal(
  trigger(450, 18459),
  null,
  "#185 routine paid action (450 of 18459) no longer intercepts — the point of the change"
);
equal(
  trigger(450, 540),
  null,
  "#185 balance exactly at cost x1.2 is not below it, so no intercept"
);
equal(
  trigger(450, 539),
  "low_balance",
  "#185 balance one credit under cost x1.2 intercepts"
);
equal(trigger(450, 0), "low_balance", "#185 zero balance intercepts");
equal(
  trigger(1000, 1_000_000),
  null,
  "#185 cost exactly at threshold is not above it, so no intercept"
);
equal(
  trigger(1001, 1_000_000),
  "high_cost",
  "#185 cost one credit over threshold intercepts"
);
// 生产实价:happyhorse 5s=450 不拦、12s=1080 拦。这两条是阈值下调后的实际效果。
equal(trigger(450, 18459), null, "#185 happyhorse 5s (450) stays one-click for a healthy balance");
equal(trigger(1080, 18459), "high_cost", "#185 happyhorse 12s (1080) now asks — the point of the 5000->1000 ruling");
equal(
  trigger(1200, 100),
  "low_balance",
  "#185 when both triggers fire, low balance wins the copy (more urgent fact)"
);
equal(
  trigger(Number.NaN, 100),
  "indeterminate",
  "#185 unreadable cost fails closed"
);
equal(
  trigger(100, Number.POSITIVE_INFINITY),
  "indeterminate",
  "#185 unreadable balance fails closed"
);
ok(
  api.CanvasGenerationEstimateSchema.safeParse({
    kind: "video",
    cost: 450,
    pricingVersion: pricing.CANVAS_GENERATION_PRICING_VERSION,
    balance: 18459,
    needsConfirmation: false,
    confirmationReason: null,
  }).success,
  "#185 estimate DTO carries confirmationReason"
);
ok(
  !api.CanvasGenerationEstimateSchema.safeParse({
    kind: "video",
    cost: 450,
    pricingVersion: pricing.CANVAS_GENERATION_PRICING_VERSION,
    balance: 18459,
    needsConfirmation: false,
    confirmationReason: "whatever",
  }).success,
  "#185 estimate DTO rejects unknown confirmation reason"
);
ok(
  !/needsConfirmation:\s*pricing\.cost\s*>\s*0/.test(generationServiceSource),
  "#185 the old always-confirm implementation is gone"
);
ok(
  /resolveCanvasConfirmationTrigger\(/.test(generationServiceSource),
  "#185 estimate endpoint routes confirmation through the shared threshold helper"
);

// ---- 出处闸(2026-08-09 R2-Q4 审计):金额轴之外的第二条轴 ----
// 金额闸答「这笔钱大不大」,出处闸答「这一下是不是用户真要花的」。下面这组穷举同时
// 证明两件事:①出处闸堵住了误扣费路径;②它**永远不会削弱 #185**。
{
  const gate = (source, cost, thresholdTrigger) =>
    consent.resolveCanvasGenerateConsent({ source, cost, thresholdTrigger });
  const TRIGGERS = [null, "low_balance", "high_cost", "indeterminate"];

  // ① #185 优先级:只要金额闸说要拦,任何 source 都必须拦(含 button)。
  for (const source of ["button", "shortcut"]) {
    for (const t of TRIGGERS) {
      if (t === null) continue;
      const g = gate(source, 450, t);
      equal(
        [g.decision, g.reason],
        ["confirm", t],
        `consent: ${source} + ${t} must confirm with the threshold's own reason (#185 never weakened)`
      );
    }
  }
  // ② 这条是「#185 没被回退」的机器证明:鼠标点击 + 金额未越阈 = 一次点击直发。
  equal(
    gate("button", 450, null),
    { decision: "allow" },
    "consent: deliberate button click under threshold stays one-click — the ruling's intended effect"
  );
  // ③ 快捷键是弱证据,必须多问一句。
  equal(
    gate("shortcut", 450, null),
    { decision: "confirm", reason: "keyboard_shortcut" },
    "consent: Ctrl+Enter always confirms — a text box makes it far too easy to misfire"
  );
  // ④ 免费动作不打扰。
  equal(gate("shortcut", 0, null), { decision: "allow" }, "consent: free action never confirms");
  // ⑤ indeterminate 不能被 cost<=0 遮蔽 —— resolveCanvasConfirmationTrigger 在余额读不出时
  //    会先返回 indeterminate 再看 cost,若出处闸先按 cost<=0 放行就把 #185 的兜底臂吃掉了。
  equal(
    gate("button", 0, "indeterminate"),
    { decision: "confirm", reason: "indeterminate" },
    "consent: threshold is evaluated BEFORE the free-action shortcut, so indeterminate is not shadowed"
  );
  // ⑥ 恢复语义:已绑定=幂等重放放行;未绑定=会真的 INSERT 扣费,必须问。
  equal(
    gate("recovery_bound", 450, null),
    { decision: "allow" },
    "consent: bound recovery replays idempotently and must not nag"
  );
  equal(
    gate("recovery_unbound", 450, null),
    { decision: "confirm", reason: "unbound_recovery" },
    "consent: unbound recovery would be a FIRST charge, not a replay — always confirm"
  );
  equal(
    gate("recovery_bound", 999999, "high_cost"),
    { decision: "allow" },
    "consent: bound recovery outranks the amount axis (replay creates no new charge)"
  );
}
const contextSource = readFileSync(
  new URL("../src/components/canvas/canvas-generation-context.tsx", import.meta.url),
  "utf8"
);
ok(
  /generationByNodeIdRef\.current\.get\(nodeId\)\?\.actionId === actionId/.test(
    contextSource
  ),
  "auto-recovery only replays intents the server actually has (no zero-click first charge)"
);
ok(
  /discardUnresolved/.test(contextSource),
  "an unbound intent can be discarded — otherwise the node is neither submittable nor deletable"
);
{
  const controlsSource = readFileSync(
    new URL("../src/components/canvas/nodes/generation-controls.tsx", import.meta.url),
    "utf8"
  );
  // 旧文案对绑定/未绑定一视同仁地说「不会创建新的计费任务」——未绑定时那是假的。
  // 现在这句只许出现一次(绑定分支),并且未绑定分支必须讲明会是一次全新扣费。
  // 断言渲染态的那一处(带 <strong> 标签),不是注释里复述这句话的那一处。
  equal(
    (controlsSource.match(/<strong>不会创建新的计费任务<\/strong>/g) || []).length,
    1,
    "the 'no new billable task' promise is rendered exactly once (the bound branch, where it is true)"
  );
  ok(
    /unresolvedIsBound \? \(/.test(controlsSource),
    "the unresolved notice branches on whether the server actually has the row"
  );
  ok(
    /全新的扣费/.test(controlsSource),
    "the unbound branch says plainly that re-submitting is a fresh charge"
  );
  ok(
    /放弃这次提交/.test(controlsSource),
    "the unbound branch offers a zero-cost way out"
  );
  ok(
    /event\.nativeEvent\.isComposing \|\| event\.keyCode === 229/.test(controlsSource),
    "Ctrl+Enter early-returns during IME composition (picking a candidate must not spend)"
  );
  ok(
    /onClick=\{\(\) => onGenerate\("button"\)\}/.test(controlsSource),
    "the generate button passes an explicit source (it used to pass the MouseEvent)"
  );
  ok(
    /onGenerate\("shortcut"\)/.test(controlsSource),
    "Ctrl+Enter routes through the same funnel with the weaker source"
  );
  equal(
    (controlsSource.match(/const onGenerate = /g) || []).length,
    1,
    "there is exactly one paid-submission funnel"
  );
}

equal(
  modelPolicy.parseCanvasVideoModelAllowlist(undefined),
  ["grok"],
  "unset server model policy defaults to the single production Grok lane"
);
equal(
  modelPolicy.parseCanvasVideoModelAllowlist("grok,veo"),
  ["grok", "veo"],
  "server model policy accepts an explicit known-model allowlist"
);
for (const invalidPolicy of ["", "grok,", "grok,grok", "unknown"]) {
  let rejected = false;
  try {
    modelPolicy.parseCanvasVideoModelAllowlist(invalidPolicy);
  } catch {
    rejected = true;
  }
  ok(rejected, `server model policy fails closed for ${JSON.stringify(invalidPolicy)}`);
}
ok(
  atMostOncePlatformPathPolicy.test(grokAdapterSource),
  "Grok Canvas submission disables fallback endpoint retries in at-most-once mode"
);
ok(
  atMostOncePlatformPathPolicy.test(soraAdapterSource),
  "Sora Canvas submission disables fallback endpoint retries in at-most-once mode"
);
ok(
  generationServiceSource.indexOf("if (input.upstreamCallCount === 0)") >= 0 &&
    generationServiceSource.indexOf("if (input.upstreamCallCount === 0)") <
      generationServiceSource.indexOf("if (input.retryable === true)"),
  "zero provider-call failures are refunded before retryability classification"
);

for (const blockedAddress of [
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "::1",
  "::ffff:127.0.0.1",
  "::7f00:1",
]) {
  ok(
    safeMedia.isBlockedExternalMediaAddress(blockedAddress),
    `generated-media downloader blocks ${blockedAddress}`
  );
}
ok(
  !safeMedia.isBlockedExternalMediaAddress("8.8.8.8"),
  "generated-media downloader permits global IPv4"
);
ok(
  !safeMedia.isBlockedExternalMediaAddress("2606:4700:4700::1111"),
  "generated-media downloader permits global IPv6"
);

equal(
  ossMetadata.normalizeOssUserMetadata({
    "X-OSS-META-Generation-Id": GENERATION_ID,
    "USER-ID": "owner",
  }),
  {
    "generation-id": GENERATION_ID,
    "user-id": "owner",
  },
  "OSS HEAD metadata normalizes prefix and casing to lifecycle identity keys"
);

equal(
  api.mapCanvasGenerationStatus({
    status: "pending",
    providerSubmissionState: "unknown",
  }),
  "unknown",
  "unknown provider outcome is visible and not mapped to failed"
);
equal(
  api.mapCanvasGenerationStatus({
    status: "processing",
    providerSubmissionState: "bound",
  }),
  "processing",
  "bound provider task maps to processing"
);
equal(
  api.mapCanvasGenerationStatus({
    status: "completed",
    providerSubmissionState: "unknown",
  }),
  "completed",
  "terminal completion wins over stale provider state"
);
equal(
  api.mapCanvasGenerationStatus({
    status: "failed",
    providerSubmissionState: "bound",
  }),
  "failed",
  "terminal failure maps to failed"
);

const projection = {
  id: GENERATION_ID,
  action_id: ACTION_ID,
  canvas_id_snapshot: CANVAS_ID,
  canvas_node_id: "image-node-1",
  type: "image",
  status: "processing",
  provider_submission_state: "bound",
  task_id: "provider-task",
  progress: 54,
  credit_cost: 10,
  billing_mode: "debit",
  output_oss_key: "images/user/secret-planned.jpg",
  output_text: null,
  error_message: null,
  last_reconcile_error_code: null,
  credits_refunded: 0,
  created_at: "2026-07-29T08:00:00.000Z",
  updated_at: "2026-07-29T08:01:00.000Z",
  completed_at: null,
};
const publicView = api.toCanvasGenerationView(projection);
equal(
  publicView.outputOssKey,
  null,
  "planned object key is hidden before completion"
);
ok(
  !Object.prototype.hasOwnProperty.call(publicView, "plannedOutputOssKey"),
  "public DTO never exposes plannedOutputOssKey"
);
ok(
  !Object.prototype.hasOwnProperty.call(publicView, "submissionToken"),
  "public DTO never exposes provider submission authority"
);

if (failures.length > 0) {
  console.error(
    `Canvas generation backend verification failed (${passed} passed, ${failures.length} failed):`
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Canvas generation backend verification passed: ${passed}/${passed}`);
}
