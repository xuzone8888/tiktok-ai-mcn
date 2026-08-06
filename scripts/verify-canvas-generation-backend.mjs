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
