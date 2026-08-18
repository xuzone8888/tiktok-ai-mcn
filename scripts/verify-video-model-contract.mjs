#!/usr/bin/env node

/** Offline executable verifier for the production unified-video capability contract. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".temp", "video-model-contract-verify");

function addLocalModuleExtensions(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

function compileProductionModule(outputName, sourcePath, rewrites = {}) {
  const absoluteSourcePath = join(ROOT, sourcePath);
  const source = readFileSync(absoluteSourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: absoluteSourcePath,
    reportDiagnostics: true,
  });
  const errorDiagnostics = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errorDiagnostics.length > 0) {
    const messages = errorDiagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return `${sourcePath}: ${message}`;
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${sourcePath}:${position.line + 1}:${position.character + 1}: ${message}`;
    });
    throw new Error(`Production transpile failed:\n${messages.join("\n")}`);
  }

  let code = transpiled.outputText;
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(from).join(to);
  }
  code = addLocalModuleExtensions(code);

  const outputPath = join(OUT, `${outputName}.mjs`);
  writeFileSync(outputPath, code, "utf8");
  return outputPath;
}

function importFresh(path) {
  return import(`${pathToFileURL(path).href}?verify=${Date.now()}-${Math.random()}`);
}

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

function throws(fn, label) {
  try {
    fn();
    failures.push(`${label} (did not throw)`);
  } catch {
    passed += 1;
  }
}

async function rejects(fn, label) {
  try {
    await fn();
    failures.push(`${label} (did not reject)`);
  } catch {
    passed += 1;
  }
}

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, "platform-client-stub.mjs"),
  String.raw`
export const submitCalls = [];
export const submitPaths = [];
export const multipartCalls = [];
export function reset() {
  submitCalls.length = 0;
  submitPaths.length = 0;
  multipartCalls.length = 0;
}
export function getPlatformAuthHeaders() { return {}; }
export function getPlatformContentUrl(taskId) { return "stub://content/" + taskId; }
export async function queryPlatformVideoTask(taskId) {
  return { taskId, status: "processing", progress: 10 };
}
export async function submitPlatformVideo(payload, paths) {
  submitCalls.push(payload);
  submitPaths.push(paths);
  return { taskId: "stub-platform-task", status: "processing" };
}
export async function submitPlatformVideoMultipart(payload) {
  multipartCalls.push(payload);
  return { taskId: "stub-platform-multipart-task", status: "processing" };
}
export function toPlatformSize(aspectRatio, resolution = "720p") {
  if (resolution === "1080p") return aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
  return aspectRatio === "16:9" ? "1280x720" : "720x1280";
}
export function toModelAspectToken(aspectRatio) {
  return aspectRatio === "16:9" ? "16x9" : "9x16";
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "seedance-api-stub.mjs"),
  String.raw`
export const submitCalls = [];
export function reset() { submitCalls.length = 0; }
export function getSeedanceParams(model) {
  return {
    duration: model.includes("10s") ? 10 : 5,
    resolution: model.includes("pro") ? "720p" : "480p",
  };
}
export function needsUpscaling(model) { return !model.includes("pro"); }
export async function submitSeedanceTask(payload) {
  submitCalls.push(payload);
  return { taskId: "stub-seedance-task", status: "queued" };
}
export async function querySeedanceTask(taskId) {
  return { taskId, status: "running" };
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "dashscope-stub.mjs"),
  String.raw`
export const submitCalls = [];
export function reset() { submitCalls.length = 0; }
export async function submitHappyHorseVideo(payload) {
  submitCalls.push(payload);
  const hasReferences = Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0;
  return {
    success: true,
    taskId: "stub-happyhorse-task",
    requestId: "stub-request",
    model: hasReferences ? "happyhorse-1.0-r2v" : "happyhorse-1.0-t2v",
  };
}
export async function queryHappyHorseVideo(taskId) {
  return { success: true, task: { taskId, status: "processing" } };
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "video-upscale-stub.mjs"),
  "export function getUpscaleTarget() { return { width: 1080, height: 1920 }; }\nexport async function upscaleVideo() { throw new Error('not used'); }\n",
  "utf8"
);
writeFileSync(
  join(OUT, "oss-stub.mjs"),
  "export function generateMediaPath() { return 'stub/path'; }\nexport async function uploadVideoBuffer() { return 'stub://video'; }\n",
  "utf8"
);

writeFileSync(
  join(OUT, "character-assets-stub.mjs"),
  "export function getCharacterAssetReferenceUrls() { return []; }\n",
  "utf8"
);

writeFileSync(
  join(OUT, "route-state-stub.mjs"),
  String.raw`
export const state = {
  authUser: { id: "offline-user" },
  events: [],
  creditCalls: [],
  adapterCalls: [],
  registryCalls: [],
  inserts: [],
};
export function resetRouteState() {
  state.authUser = { id: "offline-user" };
  state.events.length = 0;
  state.creditCalls.length = 0;
  state.adapterCalls.length = 0;
  state.registryCalls.length = 0;
  state.inserts.length = 0;
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "next-server-stub.mjs"),
  String.raw`
export class NextRequest {}
export const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, body, async json() { return body; } };
  },
};
`,
  "utf8"
);

writeFileSync(
  join(OUT, "route-auth-stub.mjs"),
  String.raw`
import { state } from "./route-state-stub.mjs";
export async function createClient() {
  return { auth: { async getUser() { return { data: { user: state.authUser } }; } } };
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "route-admin-stub.mjs"),
  String.raw`
import { state } from "./route-state-stub.mjs";
export function createAdminClient() {
  return {
    from() {
      return {
        async insert(payload) {
          state.events.push("insert");
          state.inserts.push(payload);
          return { error: null };
        },
      };
    },
  };
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "route-credits-stub.mjs"),
  String.raw`
import { state } from "./route-state-stub.mjs";
export async function checkVideoCredits(_supabase, userId, amount) {
  state.events.push("credit");
  state.creditCalls.push({ kind: "check", userId, amount });
  return { ok: true };
}
export async function deductVideoCredits(payload) {
  state.events.push("deduct");
  state.creditCalls.push({ kind: "deduct", payload });
}
export async function refundVideoCreditsDirect(payload) {
  state.events.push("refund");
  state.creditCalls.push({ kind: "refund", payload });
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "route-registry-stub.mjs"),
  String.raw`
import { state } from "./route-state-stub.mjs";
export function getRegisteredVideoModel(modelType) {
  state.events.push("registry");
  state.registryCalls.push(modelType);
  return {
    adapter: {
      async submit(input) {
        state.events.push("adapter");
        state.adapterCalls.push(input);
        return {
          taskId: "stub-route-task",
          status: "processing",
          upstreamModel: "stub-" + modelType,
          metadata: { offline: true },
        };
      },
    },
  };
}
`,
  "utf8"
);

writeFileSync(
  join(OUT, "route-contract-stub.mjs"),
  String.raw`
import { state } from "./route-state-stub.mjs";
import {
  parseVideoModelContract as productionParse,
  resolveLegacyVideoModelSelection as productionResolve,
} from "./contract.mjs";
export function resolveLegacyVideoModelSelection(modelType, quality) {
  state.events.push("selection");
  return productionResolve(modelType, quality);
}
export function parseVideoModelContract(modelType, input) {
  state.events.push("validation");
  return productionParse(modelType, input);
}
`,
  "utf8"
);

const typesPath = compileProductionModule("types", "src/lib/video-models/types.ts");
const catalogPath = compileProductionModule("catalog", "src/lib/video-models/catalog.ts");
const contractPath = compileProductionModule("contract", "src/lib/video-models/contract.ts");
const generationPath = compileProductionModule("generation", "src/types/generation.ts");
const clientPreflightPath = compileProductionModule(
  "client-preflight",
  "src/lib/video-models/client-preflight.ts",
  { '"@/types/generation"': '"./generation"' }
);
const characterReferencePath = compileProductionModule(
  "character-reference",
  "src/lib/video-models/character-reference.ts"
);
const videoBatchPath = compileProductionModule(
  "video-batch",
  "src/types/video-batch.ts",
  { '"@/lib/video-models/catalog"': '"./catalog"' }
);
const videoBatchStorePath = compileProductionModule(
  "video-batch-store",
  "src/stores/video-batch-store.ts",
  {
    '"@/types/video-batch"': '"./video-batch"',
    '"@/lib/video-models/character-reference"': '"./character-reference"',
    '"@/lib/character-assets"': '"./character-assets-stub"',
    '"@/lib/video-models/contract"': '"./contract"',
    '"@/lib/video-models/client-preflight"': '"./client-preflight"',
  }
);
const grokAdapterPath = compileProductionModule(
  "grok-adapter",
  "src/lib/video-models/adapters/grok.ts",
  { '"../platform-client"': '"./platform-client-stub"' }
);
const soraAdapterPath = compileProductionModule(
  "sora-adapter",
  "src/lib/video-models/adapters/sora.ts",
  { '"../platform-client"': '"./platform-client-stub"' }
);
const veoAdapterPath = compileProductionModule(
  "veo-adapter",
  "src/lib/video-models/adapters/veo.ts",
  { '"../platform-client"': '"./platform-client-stub"' }
);
const omniAdapterPath = compileProductionModule(
  "omni-adapter",
  "src/lib/video-models/adapters/omni.ts",
  { '"../platform-client"': '"./platform-client-stub"' }
);
const seedanceAdapterPath = compileProductionModule(
  "seedance-adapter",
  "src/lib/video-models/adapters/seedance.ts",
  {
    '"@/lib/seedance-api"': '"./seedance-api-stub"',
    '"@/lib/video-upscale"': '"./video-upscale-stub"',
    '"@/lib/oss"': '"./oss-stub"',
  }
);
const happyHorseAdapterPath = compileProductionModule(
  "happyhorse-adapter",
  "src/lib/video-models/adapters/happyhorse.ts",
  { '"@/lib/dashscope-video-api"': '"./dashscope-stub"' }
);
const routePath = compileProductionModule(
  "submit-route",
  "src/app/api/video-batch/models/submit/route.ts",
  {
    '"next/server"': '"./next-server-stub"',
    '"@/lib/supabase/admin"': '"./route-admin-stub"',
    '"@/lib/supabase/server"': '"./route-auth-stub"',
    '"@/lib/video-models/catalog"': '"./catalog"',
    '"@/lib/video-models/character-reference"': '"./character-reference"',
    '"@/lib/video-models/contract"': '"./route-contract-stub"',
    '"@/lib/video-models/credits"': '"./route-credits-stub"',
    '"@/lib/video-models/registry"': '"./route-registry-stub"',
  }
);

const types = await importFresh(typesPath);
const catalog = await importFresh(catalogPath);
const contract = await importFresh(contractPath);
const generation = await importFresh(generationPath);
const clientPreflight = await importFresh(clientPreflightPath);
const characterReference = await importFresh(characterReferencePath);
const videoBatch = await importFresh(videoBatchPath);
const platformStub = await import(pathToFileURL(join(OUT, "platform-client-stub.mjs")).href);
const seedanceStub = await import(pathToFileURL(join(OUT, "seedance-api-stub.mjs")).href);
const dashscopeStub = await import(pathToFileURL(join(OUT, "dashscope-stub.mjs")).href);
const routeState = await import(pathToFileURL(join(OUT, "route-state-stub.mjs")).href);
const { grokAdapter } = await importFresh(grokAdapterPath);
const { soraAdapter } = await importFresh(soraAdapterPath);
const { veoAdapter } = await importFresh(veoAdapterPath);
const { omniAdapter } = await importFresh(omniAdapterPath);
const { seedanceAdapter } = await importFresh(seedanceAdapterPath);
const { happyHorseAdapter } = await importFresh(happyHorseAdapterPath);
const submitRoute = await importFresh(routePath);

const expectedMatrix = {
  sora2: {
    durations: [12], qualities: ["standard"], maxImages: 1, nativeAudio: "always",
  },
  "sora2-pro": {
    durations: [12], qualities: ["hd"], maxImages: 1, nativeAudio: "always",
  },
  grok: {
    durations: [10, 15], qualities: ["standard"], maxImages: 4, nativeAudio: "unknown",
  },
  veo: {
    durations: [8], qualities: ["standard"], maxImages: 3, nativeAudio: "unknown",
  },
  omni: {
    durations: [10], qualities: ["standard"], maxImages: 7, nativeAudio: "unknown",
  },
  seedance: {
    durations: [5, 10], qualities: ["standard", "hd"], maxImages: 1, nativeAudio: "always",
  },
  happyhorse: {
    durations: [5, 12], qualities: ["standard"], maxImages: 9, nativeAudio: "unknown",
  },
};

eq(types.VIDEO_MODEL_IDS, Object.keys(expectedMatrix), "catalog exposes exactly the seven production models");

for (const modelType of types.VIDEO_MODEL_IDS) {
  const expected = expectedMatrix[modelType];
  const actual = catalog.VIDEO_MODEL_CATALOG[modelType];
  eq(actual.supportedDurations, expected.durations, `${modelType}: supported durations`);
  eq(actual.supportedQualities, expected.qualities, `${modelType}: supported qualities`);
  eq(actual.supportedAspectRatios, ["9:16", "16:9"], `${modelType}: supported aspects`);
  eq(actual.supportedModes, ["prompt_to_video", "image_to_video"], `${modelType}: supported modes`);
  eq(actual.referenceRoles, ["generic"], `${modelType}: current generic reference role`);
  eq(actual.maxImages, expected.maxImages, `${modelType}: reference limit`);
  eq(actual.nativeAudio, expected.nativeAudio, `${modelType}: native audio capability`);
  eq(actual.supportsCancel, false, `${modelType}: cancellation is not advertised`);

  const defaults = contract.parseVideoModelContract(modelType, {});
  ok(defaults.ok, `${modelType}: omitted fields use catalog defaults`);
  if (defaults.ok) {
    eq(defaults.value.durationSeconds, expected.durations[0], `${modelType}: default duration`);
    eq(defaults.value.quality, expected.qualities[0], `${modelType}: default quality`);
    eq(defaults.value.aspectRatio, "9:16", `${modelType}: default aspect`);
    eq(defaults.value.mode, "prompt_to_video", `${modelType}: zero-reference default mode`);
  }

  const promptWithReference = contract.parseVideoModelContract(modelType, {
    mode: "prompt_to_video",
    referenceImageCount: 1,
  });
  ok(promptWithReference.ok, `${modelType}: prompt_to_video permits an optional reference`);

  const imageWithoutReference = contract.parseVideoModelContract(modelType, {
    mode: "image_to_video",
    referenceImageCount: 0,
  });
  eq(
    imageWithoutReference.ok ? null : imageWithoutReference.error.code,
    "REFERENCE_REQUIRED",
    `${modelType}: image_to_video requires a reference`
  );

  ok(
    contract.parseVideoModelContract(modelType, {
      mode: "image_to_video",
      referenceImageCount: 1,
    }).ok,
    `${modelType}: image_to_video accepts one reference`
  );

  const overflow = contract.parseVideoModelContract(modelType, {
    referenceImageCount: expected.maxImages + 1,
  });
  eq(
    overflow.ok ? null : overflow.error.code,
    "TOO_MANY_REFERENCES",
    `${modelType}: reference overflow fails closed`
  );

  for (const invalidDuration of [null, "10", Number.NaN, Number.POSITIVE_INFINITY, 10.5, 999]) {
    ok(
      !contract.parseVideoModelContract(modelType, { durationSeconds: invalidDuration }).ok,
      `${modelType}: rejects explicit duration ${String(invalidDuration)}`
    );
  }
  for (const invalidQuality of [null, "ultra", 1]) {
    ok(
      !contract.parseVideoModelContract(modelType, { quality: invalidQuality }).ok,
      `${modelType}: rejects explicit quality ${String(invalidQuality)}`
    );
  }
  for (const invalidAspect of [null, "1:1", 916]) {
    ok(
      !contract.parseVideoModelContract(modelType, { aspectRatio: invalidAspect }).ok,
      `${modelType}: rejects explicit aspect ${String(invalidAspect)}`
    );
  }
  for (const invalidMode of [null, "auto", 1]) {
    ok(
      !contract.parseVideoModelContract(modelType, { mode: invalidMode }).ok,
      `${modelType}: rejects explicit mode ${String(invalidMode)}`
    );
  }
  for (const invalidCount of [null, "1", Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    ok(
      !contract.parseVideoModelContract(modelType, { referenceImageCount: invalidCount }).ok,
      `${modelType}: rejects explicit reference count ${String(invalidCount)}`
    );
  }

  eq(
    videoBatch.getAvailableDurations(modelType, expected.qualities[0]),
    expected.durations,
    `${modelType}: client duration helper delegates to catalog`
  );
  eq(
    videoBatch.getAvailableQualities(modelType),
    expected.qualities,
    `${modelType}: client quality helper delegates to catalog`
  );
}

for (const durationSeconds of [5, 10]) {
  for (const quality of ["standard", "hd"]) {
    ok(
      contract.parseVideoModelContract("seedance", { durationSeconds, quality }).ok,
      `seedance: supports ${durationSeconds}s/${quality}`
    );
  }
}

eq(catalog.getVideoModelCreditCost("grok", 10, "standard"), 5, "Grok 10s costs 5 credits");
eq(catalog.getVideoModelCreditCost("grok", 15, "standard"), 8, "Grok 15s costs 8 credits");
eq(videoBatch.getVideoBatchTotalPrice("grok", 15, "standard"), 8, "client Grok 15s price is 8");
throws(() => catalog.getVideoModelCreditCost("grok", 12, "standard"), "Grok pricing rejects unsupported duration");
throws(() => catalog.getVideoModelCreditCost("seedance", 6, "standard"), "Seedance pricing does not fall back to 5s");
throws(() => catalog.getVideoModelCreditCost("seedance", 10, "ultra"), "Seedance pricing does not fall back to standard");
throws(() => catalog.getVideoModelCreditCost("happyhorse", 10, "standard"), "HappyHorse pricing does not fall back to 5s");

const expectedQuickGenVideoPricing = {
  "sora2-12s": {
    label: "Sora2 标准 12秒",
    duration: "12秒",
    credits: 20,
    apiDuration: 12,
    quality: "standard",
    apiModel: "sora2",
  },
  "sora2-pro-12s-hd": {
    label: "Sora2 Pro 高清 12秒",
    duration: "12秒",
    credits: 350,
    apiDuration: 12,
    quality: "hd",
    apiModel: "sora2-pro",
  },
  "seedance-5s": {
    label: "Seedance 2.0 5秒 · 高清1080P",
    duration: "5秒",
    credits: 233,
    apiDuration: 5,
    quality: "standard",
    apiModel: "seedance-5s",
  },
  "seedance-10s": {
    label: "Seedance 2.0 10秒 · 高清1080P",
    duration: "10秒",
    credits: 466,
    apiDuration: 10,
    quality: "standard",
    apiModel: "seedance-10s",
  },
  "seedance-5s-pro": {
    label: "Seedance 2.0 5秒 Pro · 原生720P",
    duration: "5秒",
    credits: 497,
    apiDuration: 5,
    quality: "hd",
    apiModel: "seedance-5s-pro",
  },
  "seedance-10s-pro": {
    label: "Seedance 2.0 10秒 Pro · 原生720P",
    duration: "10秒",
    credits: 994,
    apiDuration: 10,
    quality: "hd",
    apiModel: "seedance-10s-pro",
  },
  "happyhorse-5s": {
    label: "HappyHorse 1.0 5s 720P",
    duration: "5s",
    credits: 450,
    apiDuration: 5,
    quality: "standard",
    apiModel: "happyhorse-1.0-t2v",
  },
  "happyhorse-12s": {
    label: "HappyHorse 1.0 12s 720P",
    duration: "12s",
    credits: 1080,
    apiDuration: 12,
    quality: "standard",
    apiModel: "happyhorse-1.0-t2v",
  },
};
eq(
  generation.QUICK_GEN_VIDEO_PRICING,
  expectedQuickGenVideoPricing,
  "QuickGen pricing preserves the exact complete eight-key table"
);
eq(
  generation.VIDEO_MODEL_PRICING,
  {
    "sora2-10s": {
      label: "Sora2 标清 10秒",
      duration: "10秒",
      credits: 20,
      apiDuration: 10,
      quality: "standard",
      apiModel: "sora2-portrait",
    },
    "sora2-15s": {
      label: "Sora2 标清 15秒",
      duration: "15秒",
      credits: 20,
      apiDuration: 15,
      quality: "standard",
      apiModel: "sora2-portrait-15s",
    },
    "sora2-pro-15s-hd": {
      label: "Sora2 Pro 15秒高清",
      duration: "15秒",
      credits: 320,
      apiDuration: 15,
      quality: "hd",
      apiModel: "sora2-pro-portrait-hd-15s",
    },
    "sora2-pro-25s": {
      label: "Sora2 Pro 25秒标清",
      duration: "25秒",
      credits: 320,
      apiDuration: 25,
      quality: "standard",
      apiModel: "sora2-pro-portrait-25s",
    },
    "seedance-5s": expectedQuickGenVideoPricing["seedance-5s"],
    "seedance-10s": expectedQuickGenVideoPricing["seedance-10s"],
    "seedance-5s-pro": expectedQuickGenVideoPricing["seedance-5s-pro"],
    "seedance-10s-pro": expectedQuickGenVideoPricing["seedance-10s-pro"],
    "happyhorse-5s": expectedQuickGenVideoPricing["happyhorse-5s"],
    "happyhorse-12s": expectedQuickGenVideoPricing["happyhorse-12s"],
  },
  "legacy pricing preserves the exact complete restored table"
);
eq(generation.calculateVideoCost("sora2-12s"), 20, "QuickGen cost reads the dedicated 12s table");
eq(generation.calculateVideoCost("sora2-pro-12s-hd"), 350, "QuickGen Pro cost reads the dedicated 12s table");
eq(generation.calculateVideoCost("sora2-pro-25s"), 320, "legacy cost still reads shared 25s pricing");
eq(generation.getVideoEstimatedTime("sora2-12s"), "5-6 minutes", "QuickGen ETA accepts the dedicated 12s key");
eq(generation.getVideoEstimatedTime("sora2-10s"), "4-5 minutes", "legacy ETA keeps the shared 10s key");

eq(
  contract.resolveLegacyVideoModelSelection("veo3-fast", undefined),
  { ok: true, value: { modelType: "veo", qualityInput: undefined } },
  "legacy veo3-fast alias resolves positively"
);
eq(
  contract.resolveLegacyVideoModelSelection("veo3-std", undefined),
  { ok: true, value: { modelType: "veo", qualityInput: undefined } },
  "legacy veo3-std alias resolves positively"
);
eq(
  contract.resolveLegacyVideoModelSelection("seedance-pro", undefined),
  { ok: true, value: { modelType: "seedance", qualityInput: "hd" } },
  "seedance-pro omitted quality resolves to HD"
);
eq(
  contract.resolveLegacyVideoModelSelection("seedance-pro", "hd"),
  { ok: true, value: { modelType: "seedance", qualityInput: "hd" } },
  "seedance-pro explicit HD resolves positively"
);

eq(
  clientPreflight.resolveQuickGenVideoTaskSelection({
    model: "sora2-12s",
    apiModel: "sora2",
    duration: 12,
    quality: "standard",
    aspectRatio: "9:16",
  }),
  {
    modelType: "sora2",
    durationSeconds: 12,
    quality: "standard",
    creditCost: 20,
    apiModel: "sora2",
  },
  "QuickGen canonical Sora2 resolves exact contract and price"
);
eq(
  clientPreflight.resolveQuickGenVideoTaskSelection({
    model: "sora2-pro-12s-hd",
    apiModel: "sora2-pro",
    duration: 12,
    quality: "hd",
    aspectRatio: "16:9",
  }),
  {
    modelType: "sora2-pro",
    durationSeconds: 12,
    quality: "hd",
    creditCost: 350,
    apiModel: "sora2-pro",
  },
  "QuickGen canonical Sora2 Pro resolves exact contract and price"
);
for (const legacyModel of ["sora2-10s", "sora2-15s", "sora2-pro-15s-hd", "sora2-pro-25s"]) {
  throws(
    () => clientPreflight.resolveQuickGenVideoTaskSelection({
      model: legacyModel,
      apiModel: "legacy",
      duration: legacyModel.includes("25") ? 25 : legacyModel.includes("15") ? 15 : 10,
      quality: legacyModel.includes("hd") ? "hd" : "standard",
      aspectRatio: "9:16",
    }),
    `QuickGen rejects legacy saved model ${legacyModel} for new submit`
  );
}
for (const [model, duration, quality, expected] of [
  ["sora2-10s", 10, "standard", { modelType: "sora2", durationSeconds: 10, quality: "standard" }],
  ["sora2-15s", 15, "standard", { modelType: "sora2", durationSeconds: 15, quality: "standard" }],
  ["sora2-pro-15s-hd", 15, "hd", { modelType: "sora2-pro", durationSeconds: 15, quality: "hd" }],
  ["sora2-pro-25s", 25, "standard", { modelType: "sora2-pro", durationSeconds: 25, quality: "standard" }],
  ["sora2-12s", 12, "standard", { modelType: "sora2", durationSeconds: 12, quality: "standard" }],
  ["seedance-10s-pro", 10, "hd", { modelType: "seedance", durationSeconds: 10, quality: "hd" }],
  ["happyhorse-12s", 12, "standard", { modelType: "happyhorse", durationSeconds: 12, quality: "standard" }],
  ["veo3-fast", 8, "standard", { modelType: "veo", durationSeconds: 8, quality: "standard" }],
  ["grok-15s", 15, "standard", { modelType: "grok", durationSeconds: 15, quality: "standard" }],
  ["omni-10s", 10, "standard", { modelType: "omni", durationSeconds: 10, quality: "standard" }],
]) {
  eq(
    clientPreflight.resolveQuickGenVideoStatusSelection({ model, duration, quality }),
    expected,
    `status-only resolver maps known paid task ${model}`
  );
}
throws(
  () => clientPreflight.resolveQuickGenVideoStatusSelection({
    model: "unknown-sora-ish-model",
    duration: 12,
    quality: "standard",
  }),
  "status-only resolver rejects unknown names without a Sora fallback"
);
throws(
  () => clientPreflight.resolveQuickGenVideoStatusSelection({
    model: "sora2-10s",
    duration: 12,
    quality: "standard",
  }),
  "status-only resolver rejects corrupted historical metadata"
);
for (const mismatch of [
  { apiModel: "wrong", duration: 12, quality: "standard" },
  { apiModel: "sora2", duration: 10, quality: "standard" },
  { apiModel: "sora2", duration: 12, quality: "hd" },
]) {
  throws(
    () => clientPreflight.resolveQuickGenVideoTaskSelection({
      model: "sora2-12s",
      ...mismatch,
      aspectRatio: "9:16",
    }),
    `QuickGen rejects mismatched saved configuration ${JSON.stringify(mismatch)}`
  );
}

eq(
  contract.normalizePersistedVideoGlobalSelection({
    modelType: "sora2",
    duration: 25,
    quality: "standard",
    aspectRatio: "9:16",
  }),
  {
    value: { modelType: "sora2", duration: 12, quality: "standard", aspectRatio: "9:16" },
    changed: true,
  },
  "persisted global stale 25 normalizes to Sora2 catalog default"
);
eq(
  contract.normalizePersistedVideoGlobalSelection({
    modelType: "seedance",
    duration: 10,
    quality: "ultra",
    aspectRatio: "16:9",
  }),
  {
    value: { modelType: "seedance", duration: 10, quality: "standard", aspectRatio: "16:9" },
    changed: true,
  },
  "persisted global invalid quality normalizes within selected model"
);
eq(
  contract.normalizePersistedVideoGlobalSelection({
    modelType: "legacy-model",
    duration: 25,
    quality: "hd",
    aspectRatio: "1:1",
  }),
  {
    value: { modelType: "sora2", duration: 12, quality: "standard", aspectRatio: "9:16" },
    changed: true,
  },
  "persisted global invalid model normalizes to truthful Sora2 defaults"
);
eq(
  contract.validatePersistedVideoSelection({
    modelType: "sora2",
    duration: 25,
    quality: "standard",
    aspectRatio: "9:16",
  }).ok,
  false,
  "strict persisted task validation rejects stale 25 without normalization"
);
eq(
  clientPreflight.resolvePersistedVideoTaskRecovery({
    upstreamTaskId: "paid-sora-task",
    modelType: "sora2-pro",
    duration: 25,
    quality: "standard",
    aspectRatio: "9:16",
  }),
  {
    ok: true,
    mode: "status",
    value: { modelType: "sora2-pro", durationSeconds: 25, quality: "standard" },
  },
  "rehydrate preserves a paid historical Sora task for status-only recovery"
);
eq(
  clientPreflight.resolvePersistedVideoTaskRecovery({
    upstreamTaskId: "paid-legacy-sora-task",
    modelType: "sora2-10s",
    duration: 10,
    quality: "standard",
    aspectRatio: "9:16",
  }),
  {
    ok: true,
    mode: "status",
    value: { modelType: "sora2", durationSeconds: 10, quality: "standard" },
  },
  "paid legacy alias recovery returns canonical status polling metadata"
);
for (const inheritedName of ["__proto__", "constructor", "toString"]) {
  eq(
    clientPreflight.resolvePersistedVideoTaskRecovery({
      upstreamTaskId: `paid-${inheritedName}-task`,
      modelType: inheritedName,
      duration: undefined,
      quality: undefined,
      aspectRatio: "9:16",
    }).ok,
    false,
    `paid status recovery rejects inherited historical name ${inheritedName}`
  );
}
for (const [label, malformedUpstreamTaskId] of [
  ["number", 42],
  ["boolean", true],
  ["object", {}],
  ["array", []],
]) {
  eq(
    clientPreflight.resolvePersistedVideoTaskRecovery({
      upstreamTaskId: malformedUpstreamTaskId,
      modelType: "sora2",
      duration: 12,
      quality: "standard",
      aspectRatio: "9:16",
    }),
    {
      ok: false,
      error: {
        field: "upstreamTaskId",
        message: "Saved upstream video task ID must be a string",
      },
    },
    `persisted recovery fails closed for present ${label} upstream task ID`
  );
}
eq(
  clientPreflight.resolvePersistedVideoTaskRecovery({
    upstreamTaskId: "paid-unknown-task",
    modelType: "unknown-model",
    duration: 12,
    quality: "standard",
    aspectRatio: "9:16",
  }).ok,
  false,
  "paid task with unknown status metadata fails closed instead of reaching submit"
);
eq(
  clientPreflight.resolvePersistedVideoTaskRecovery({
    upstreamTaskId: null,
    modelType: "sora2-pro",
    duration: 25,
    quality: "standard",
    aspectRatio: "9:16",
  }).ok,
  false,
  "rehydrate fails a never-submitted stale Sora task instead of resubmitting it"
);
eq(
  clientPreflight.resolvePersistedVideoTaskRecovery({
    upstreamTaskId: null,
    modelType: "sora2",
    duration: 12,
    quality: "standard",
    aspectRatio: "9:16",
  }),
  { ok: true, mode: "submit" },
  "rehydrate permits a never-submitted current task through strict validation"
);

const paidRecoveryBatchId = "11111111-1111-4111-8111-111111111111";
const paidPersistSourceTask = {
  id: "paid-blob-stripped-task",
  images: [{
    id: "paid-blob-image",
    url: "blob:paid-image-that-cannot-survive-reload",
    name: "paid-source.png",
    isMainGrid: true,
    order: 0,
    file: { name: "paid-source.png", offlineFileMarker: true },
  }],
  aspectRatio: "9:16",
  groupName: "offline-hydration-regression",
  batchId: paidRecoveryBatchId,
  mode: "image_to_video",
  modelType: "sora2-10s",
  duration: 10,
  quality: "standard",
  doubaoTalkingScript: null,
  doubaoAiVideoPrompt: null,
  soraTaskId: "paid-upstream-task",
  soraVideoUrl: null,
  status: "generating_video",
  currentStep: 4,
  progress: 80,
  errorMessage: "图片已失效，请重新上传",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};
const malformedPersistSourceTasks = [
  ["number", 42],
  ["boolean", true],
  ["object", {}],
  ["array", []],
].map(([kind, soraTaskId]) => ({
  ...paidPersistSourceTask,
  id: `malformed-${kind}-upstream-task`,
  modelType: "sora2",
  duration: 12,
  soraTaskId,
  errorMessage: null,
}));
const neverSubmittedNoImageTask = {
  ...paidPersistSourceTask,
  id: "never-submitted-no-image-task",
  images: [{
    id: "never-submitted-blob-image",
    url: "blob:never-submitted-image-that-cannot-survive-reload",
    name: "never-submitted-source.png",
    isMainGrid: true,
    order: 0,
    file: { name: "never-submitted-source.png", offlineFileMarker: true },
  }],
  soraTaskId: null,
  modelType: "sora2",
  duration: 12,
  status: "pending",
  currentStep: 0,
  progress: 0,
};
const hydrationStorage = new Map();
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalFetchForHydration = globalThis.fetch;
const providerSubmitsBeforeHydration = providerSubmitCount();
let hydrationFetchCalls = 0;
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem(key) { return hydrationStorage.get(key) ?? null; },
  setItem(key, value) { hydrationStorage.set(key, value); },
  removeItem(key) { hydrationStorage.delete(key); },
  clear() { hydrationStorage.clear(); },
  key(index) { return Array.from(hydrationStorage.keys())[index] ?? null; },
  get length() { return hydrationStorage.size; },
};
globalThis.fetch = async () => {
  hydrationFetchCalls += 1;
  throw new Error("Store hydration verifier forbids network access");
};
try {
  const { useVideoBatchStore: persistSourceStore } = await importFresh(videoBatchStorePath);
  persistSourceStore.setState({
    tasks: [paidPersistSourceTask, ...malformedPersistSourceTasks, neverSubmittedNoImageTask],
    jobStatus: "running",
  });

  const persistedStorageValue = hydrationStorage.get("video-batch-storage");
  ok(typeof persistedStorageValue === "string", "production store partialize writes persisted video state");
  const persistedState = JSON.parse(persistedStorageValue).state;
  const persistedPaidTask = persistedState.tasks.find(task => task.id === paidPersistSourceTask.id);
  eq(persistedPaidTask?.images, [], "production partialize strips the paid task blob image");
  ok(
    !persistedStorageValue.includes("offlineFileMarker"),
    "production partialize does not serialize File payloads"
  );
  eq(persistedPaidTask?.modelType, "sora2-10s", "production partialize preserves the paid legacy alias");
  eq(persistedPaidTask?.batchId, paidRecoveryBatchId, "production partialize preserves the paid batch UUID");
  eq(
    persistedPaidTask?.errorMessage,
    "图片已失效，请重新上传",
    "production partialize preserves the stale error for fresh hydration to clear"
  );
  eq(persistedState.jobStatus, "paused", "production partialize marks a running batch paused for recovery");

  const { useVideoBatchStore } = await importFresh(videoBatchStorePath);
  const hydratedTasks = useVideoBatchStore.getState().tasks;
  const recoveredPaidTask = hydratedTasks.find(task => task.id === paidPersistSourceTask.id);
  ok(
    recoveredPaidTask?.status === "pending" &&
      recoveredPaidTask?.soraTaskId === "paid-upstream-task" &&
      recoveredPaidTask?.modelType === "sora2-10s" &&
      recoveredPaidTask?.duration === 10 &&
      recoveredPaidTask?.batchId === paidRecoveryBatchId &&
      recoveredPaidTask?.images.length === 0 &&
      recoveredPaidTask?.errorMessage === null,
    "fresh production hydration retains raw paid legacy state and clears its stale image error"
  );
  eq(
    clientPreflight.resolvePersistedVideoTaskRecovery({
      upstreamTaskId: recoveredPaidTask?.soraTaskId,
      modelType: recoveredPaidTask?.modelType,
      duration: recoveredPaidTask?.duration,
      quality: recoveredPaidTask?.quality,
      aspectRatio: recoveredPaidTask?.aspectRatio,
    }),
    {
      ok: true,
      mode: "status",
      value: { modelType: "sora2", durationSeconds: 10, quality: "standard" },
    },
    "fresh paid legacy task resolves to canonical Sora2 polling metadata"
  );
  for (const malformedSourceTask of malformedPersistSourceTasks) {
    const malformedHydratedTask = hydratedTasks.find(task => task.id === malformedSourceTask.id);
    ok(
      malformedHydratedTask?.status === "failed" &&
        typeof malformedHydratedTask?.errorMessage === "string" &&
        malformedHydratedTask.errorMessage.includes("upstreamTaskId") &&
        malformedHydratedTask.errorMessage.includes("must be a string"),
      `fresh production hydration retains ${malformedSourceTask.id} as failed with a useful error`
    );
  }
  ok(
    !hydratedTasks.some(task => task.id === neverSubmittedNoImageTask.id),
    "production store hydration filters never-submitted image task without valid images"
  );
  eq(useVideoBatchStore.getState().jobStatus, "paused", "paid hydration leaves the batch paused and resumable");
  useVideoBatchStore.getState().resumeBatch();
  eq(useVideoBatchStore.getState().jobStatus, "running", "paid hydration batch resumes without resubmission");
  eq(hydrationFetchCalls, 0, "production store hydration invokes no network path");
  eq(
    providerSubmitCount(),
    providerSubmitsBeforeHydration,
    "production store hydration invokes no provider submit path"
  );
} finally {
  globalThis.fetch = originalFetchForHydration;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
}

const soraMergedReferences = characterReference.mergeCharacterReferenceImages(
  "sora2",
  "https://example.test/sora-1.png",
  ["https://example.test/sora-2.png"]
);
eq(soraMergedReferences.length, 1, "legacy Sora reference merge still truncates two inputs to one");
const soraStrictReferences = characterReference.collectCharacterReferenceImagesStrict(
  "sora2",
  "https://example.test/sora-1.png",
  ["https://example.test/sora-2.png"]
);
eq(soraStrictReferences.length, 2, "strict server reference collector preserves both Sora inputs");
ok(
  clientPreflight.preflightBatchVideoSubmission({
    modelType: "sora2",
    durationSeconds: 12,
    quality: "standard",
    aspectRatio: "9:16",
    mode: "image_to_video",
    referenceImageCount: 1,
  }).ok,
  "Batch preflight accepts Sora at max reference count"
);
eq(
  clientPreflight.preflightBatchVideoSubmission({
    modelType: "sora2",
    durationSeconds: 12,
    quality: "standard",
    aspectRatio: "9:16",
    mode: "image_to_video",
    referenceImageCount: soraStrictReferences.length,
  }).ok,
  false,
  "strict Sora two-reference collection reaches and fails the contract"
);
for (const [modelType, durationSeconds, maxImages] of [
  ["grok", 15, 4],
  ["happyhorse", 12, 9],
]) {
  ok(
    clientPreflight.preflightBatchVideoSubmission({
      modelType,
      durationSeconds,
      quality: "standard",
      aspectRatio: "16:9",
      mode: "image_to_video",
      referenceImageCount: maxImages,
    }).ok,
    `${modelType}: Batch preflight accepts allowed maximum references`
  );
  eq(
    clientPreflight.preflightBatchVideoSubmission({
      modelType,
      durationSeconds,
      quality: "standard",
      aspectRatio: "16:9",
      mode: "image_to_video",
      referenceImageCount: maxImages + 1,
    }).ok,
    false,
    `${modelType}: Batch preflight rejects reference overflow`
  );
}

const overflowReferences = characterReference.mergeCharacterReferenceImages(
  "grok",
  "https://example.test/ref-1.png",
  [
    " https://example.test/ref-2.png ",
    "https://example.test/ref-1.png",
    "https://example.test/ref-3.png",
    "https://example.test/ref-4.png",
    "https://example.test/ref-5.png",
  ]
);
eq(
  overflowReferences,
  [
    "https://example.test/ref-1.png",
    "https://example.test/ref-2.png",
    "https://example.test/ref-3.png",
    "https://example.test/ref-4.png",
  ],
  "legacy reference merge preserves stable dedupe order and truncates at model max"
);
ok(
  contract.parseVideoModelContract("grok", {
    mode: "image_to_video",
    referenceImageCount: overflowReferences.length,
  }).ok,
  "legacy truncated Grok references remain contract-valid"
);
const strictOverflowReferences = characterReference.collectCharacterReferenceImagesStrict(
  "grok",
  "https://example.test/ref-1.png",
  [
    " https://example.test/ref-2.png ",
    "https://example.test/ref-1.png",
    "https://example.test/ref-3.png",
    "https://example.test/ref-4.png",
    "https://example.test/ref-5.png",
  ]
);
eq(strictOverflowReferences.length, 5, "strict server collector keeps Grok overflow visible");
eq(
  contract.parseVideoModelContract("grok", {
    mode: "image_to_video",
    referenceImageCount: strictOverflowReferences.length,
  }).ok,
  false,
  "strict Grok overflow reaches and fails the production contract"
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Verifier forbids real network access");
};

function makeAdapterInput(modelType, overrides = {}) {
  const defaults = expectedMatrix[modelType];
  return {
    modelType,
    prompt: `offline ${modelType} prompt`,
    aspectRatio: "9:16",
    imageUrls: [],
    clientTaskId: `offline-${modelType}`,
    groupName: "offline",
    userId: "offline-user",
    durationSeconds: defaults.durations[0],
    quality: defaults.qualities[0],
    mode: "prompt_to_video",
    ...overrides,
  };
}

async function submitWithProductionPreflight(adapter, input) {
  const preflight = clientPreflight.preflightBatchVideoSubmission({
    modelType: input.modelType,
    durationSeconds: input.durationSeconds,
    quality: input.quality,
    aspectRatio: input.aspectRatio,
    mode: input.mode,
    referenceImageCount: input.imageUrls.length,
  });
  if (!preflight.ok) {
    throw new RangeError(`${preflight.error.field}: ${preflight.error.message}`);
  }
  return adapter.submit({
    ...input,
    modelType: preflight.value.modelType,
    durationSeconds: preflight.value.durationSeconds,
    quality: preflight.value.quality,
    aspectRatio: preflight.value.aspectRatio,
    mode: preflight.value.mode,
  });
}

function providerSubmitCount() {
  return platformStub.submitCalls.length
    + platformStub.multipartCalls.length
    + seedanceStub.submitCalls.length
    + dashscopeStub.submitCalls.length;
}

try {
  platformStub.reset();
  seedanceStub.reset();
  dashscopeStub.reset();

  const priorGrokResult = await submitWithProductionPreflight(grokAdapter, makeAdapterInput("grok", {
    durationSeconds: 15,
    imageUrls: ["https://example.test/ref.png"],
    mode: "image_to_video",
  }));
  eq(platformStub.submitCalls.length, 1, "Grok adapter calls only the injected platform stub");
  eq(platformStub.submitCalls[0]?.seconds, "15", "Grok adapter sends exact seconds='15'");
  eq(
    platformStub.submitCalls[0]?.image_reference,
    ["https://example.test/ref.png"],
    "Grok adapter preserves validated references"
  );
  eq(priorGrokResult.metadata?.duration_seconds, 15, "Grok adapter metadata records the true duration");
  platformStub.reset();

  const soraResult = await submitWithProductionPreflight(soraAdapter, makeAdapterInput("sora2", {
    imageUrls: ["https://example.test/sora.png"],
    mode: "image_to_video",
  }));
  eq(platformStub.submitCalls[0], {
    model: "sora-2-12s-9x16",
    prompt: "offline sora2 prompt",
    generate_audio: true,
    reference_images: ["https://example.test/sora.png"],
  }, "Sora2 adapter sends exact model/audio/reference payload");
  eq(soraResult.metadata?.reference_image_count, 1, "Sora2 adapter records exact reference count");

  const soraProResult = await submitWithProductionPreflight(soraAdapter, makeAdapterInput("sora2-pro", {
    aspectRatio: "16:9",
    quality: "hd",
  }));
  eq(platformStub.submitCalls[1], {
    model: "sora2-pro-12s-16x9",
    prompt: "offline sora2-pro prompt",
    generate_audio: true,
  }, "Sora2 Pro adapter sends exact 12s landscape HD model and audio flag");
  eq(soraProResult.upstreamModel, "sora2-pro-12s-16x9", "Sora2 Pro reports exact upstream model");

  await submitWithProductionPreflight(grokAdapter, makeAdapterInput("grok", {
    durationSeconds: 10,
    aspectRatio: "16:9",
  }));
  eq(platformStub.submitCalls[2], {
    model: "grok-imagine-1.0-video",
    prompt: "offline grok prompt",
    size: "1280x720",
    seconds: "10",
    async: true,
  }, "Grok 10s adapter sends exact seconds/size payload without invented audio flag");

  const grokReferences = Array.from({ length: 4 }, (_, index) => `https://example.test/grok-${index + 1}.png`);
  const grokResult = await submitWithProductionPreflight(grokAdapter, makeAdapterInput("grok", {
    durationSeconds: 15,
    imageUrls: grokReferences,
    mode: "image_to_video",
  }));
  eq(platformStub.submitCalls[3]?.seconds, "15", "Grok 15s adapter sends exact seconds='15'");
  eq(platformStub.submitCalls[3]?.image_reference, grokReferences, "Grok adapter preserves all four references in order");
  eq(grokResult.metadata?.duration_seconds, 15, "Grok adapter metadata records the true 15s duration");
  eq(grokResult.metadata?.reference_image_count, 4, "Grok adapter records all four allowed references");

  await submitWithProductionPreflight(veoAdapter, makeAdapterInput("veo", {
    durationSeconds: 8,
    aspectRatio: "16:9",
  }));
  eq(platformStub.submitCalls[4], {
    model: "veo_3_1-fast-landscape-hd",
    prompt: "offline veo prompt",
    size: "1920x1080",
  }, "VEO JSON adapter payload has exact model/size and no audio flag");
  eq(platformStub.submitPaths[4], ["/v1/videos?async=true", "/v1/videos"], "VEO JSON uses exact fallback path order");

  const veoReferences = Array.from({ length: 3 }, (_, index) => `https://example.test/veo-${index + 1}.png`);
  const veoResult = await submitWithProductionPreflight(veoAdapter, makeAdapterInput("veo", {
    durationSeconds: 8,
    imageUrls: veoReferences,
    mode: "image_to_video",
  }));
  eq(platformStub.multipartCalls[0], {
    fields: {
      model: "veo_3_1-fast-portrait-hd",
      prompt: "offline veo prompt",
      size: "1080x1920",
    },
    imageUrls: veoReferences,
    imageFieldName: "input_reference[]",
    paths: ["/v1/videos", "/v1/videos?async=true"],
  }, "VEO multipart adapter preserves exact reference order and fields");
  eq(veoResult.metadata?.reference_image_count, 3, "VEO multipart records all three allowed references");

  const omniReferences = Array.from({ length: 7 }, (_, index) => `https://example.test/omni-${index + 1}.png`);
  const omniResult = await submitWithProductionPreflight(omniAdapter, makeAdapterInput("omni", {
    durationSeconds: 10,
    aspectRatio: "16:9",
    imageUrls: omniReferences,
    mode: "image_to_video",
  }));
  eq(platformStub.submitCalls[5], {
    model: "omni_flash",
    prompt: "offline omni prompt",
    size: "1920x1080",
    seconds: "10",
    input_reference: JSON.stringify(omniReferences),
  }, "Omni adapter sends exact duration/size and all seven references in order");
  eq(omniResult.metadata?.reference_image_count, 7, "Omni metadata records all allowed references");

  const seedanceCases = [
    { durationSeconds: 5, quality: "standard", model: "seedance-5s", resolution: "480p" },
    { durationSeconds: 10, quality: "standard", model: "seedance-10s", resolution: "480p" },
    { durationSeconds: 5, quality: "hd", model: "seedance-5s-pro", resolution: "720p" },
    { durationSeconds: 10, quality: "hd", model: "seedance-10s-pro", resolution: "720p" },
  ];
  for (const [index, seedanceCase] of seedanceCases.entries()) {
    const seedanceResult = await submitWithProductionPreflight(seedanceAdapter, makeAdapterInput("seedance", {
      durationSeconds: seedanceCase.durationSeconds,
      quality: seedanceCase.quality,
      aspectRatio: index % 2 === 0 ? "9:16" : "16:9",
      imageUrls: index === 0 ? ["https://example.test/seedance.png"] : [],
      mode: index === 0 ? "image_to_video" : "prompt_to_video",
    }));
    eq(seedanceResult.upstreamModel, seedanceCase.model, `Seedance ${seedanceCase.durationSeconds}s/${seedanceCase.quality} exact model`);
    eq(seedanceStub.submitCalls[index], {
      prompt: "offline seedance prompt",
      imageUrl: index === 0 ? "https://example.test/seedance.png" : undefined,
      duration: seedanceCase.durationSeconds,
      resolution: seedanceCase.resolution,
      ratio: index % 2 === 0 ? "9:16" : "16:9",
    }, `Seedance ${seedanceCase.durationSeconds}s/${seedanceCase.quality} exact provider payload`);
    eq(seedanceResult.metadata?.generate_audio, true, `Seedance ${seedanceCase.durationSeconds}s/${seedanceCase.quality} advertises native audio`);
    eq(seedanceResult.metadata?.reference_image_count, index === 0 ? 1 : 0, `Seedance ${seedanceCase.durationSeconds}s/${seedanceCase.quality} exact reference count`);
  }

  const happy5Result = await submitWithProductionPreflight(happyHorseAdapter, makeAdapterInput("happyhorse", {
    durationSeconds: 5,
  }));
  eq(dashscopeStub.submitCalls[0], {
    prompt: "offline happyhorse prompt",
    ratio: "9:16",
    duration: 5,
    resolution: "720P",
    imageUrls: [],
  }, "HappyHorse 5s adapter sends exact T2V payload");
  eq(happy5Result.upstreamModel, "happyhorse-1.0-t2v", "HappyHorse 5s selects T2V model");

  const happyReferences = Array.from({ length: 9 }, (_, index) => `https://example.test/happy-${index + 1}.png`);
  const happy12Result = await submitWithProductionPreflight(happyHorseAdapter, makeAdapterInput("happyhorse", {
    durationSeconds: 12,
    aspectRatio: "16:9",
    imageUrls: happyReferences,
    mode: "image_to_video",
  }));
  eq(dashscopeStub.submitCalls[1], {
    prompt: "offline happyhorse prompt",
    ratio: "16:9",
    duration: 12,
    resolution: "720P",
    imageUrls: happyReferences,
  }, "HappyHorse 12s adapter preserves all nine references and exact duration/aspect");
  eq(happy12Result.upstreamModel, "happyhorse-1.0-r2v", "HappyHorse references select R2V model");
  eq(happy12Result.metadata?.reference_image_count, 9, "HappyHorse metadata records all nine allowed references");
  eq(happy12Result.metadata?.reference_image_urls, happyReferences, "HappyHorse metadata preserves reference order");

  const adaptersByModel = {
    sora2: soraAdapter,
    "sora2-pro": soraAdapter,
    grok: grokAdapter,
    veo: veoAdapter,
    omni: omniAdapter,
    seedance: seedanceAdapter,
    happyhorse: happyHorseAdapter,
  };
  for (const modelType of types.VIDEO_MODEL_IDS) {
    const before = providerSubmitCount();
    const invalidReferences = Array.from(
      { length: expectedMatrix[modelType].maxImages + 1 },
      (_, index) => `https://example.test/overflow-${modelType}-${index}.png`
    );
    await rejects(
      () => submitWithProductionPreflight(adaptersByModel[modelType], makeAdapterInput(modelType, {
        imageUrls: invalidReferences,
        mode: "image_to_video",
      })),
      `${modelType}: invalid adapter input rejects before provider stub`
    );
    eq(providerSubmitCount(), before, `${modelType}: invalid adapter input never calls provider stub or truncates`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

async function invokeSubmitRoute(body, authUser = { id: "offline-user" }) {
  routeState.resetRouteState();
  routeState.state.authUser = authUser;
  const response = await submitRoute.POST({ async json() { return body; } });
  return response;
}

function assertNoInvalidRouteSideEffects(label) {
  eq(routeState.state.creditCalls.length, 0, `${label}: no credit check or mutation`);
  eq(routeState.state.adapterCalls.length, 0, `${label}: no adapter/network call`);
  eq(routeState.state.registryCalls.length, 0, `${label}: no provider registry lookup`);
  eq(routeState.state.inserts.length, 0, `${label}: no persistence write`);
}

function assertSuccessfulRouteSideEffects(label) {
  eq(
    routeState.state.events,
    ["selection", "validation", "registry", "credit", "adapter", "deduct", "insert"],
    `${label}: validation precedes registry, credit, adapter, deduction, and insert`
  );
  eq(routeState.state.registryCalls.length, 1, `${label}: one canonical registry lookup`);
  eq(routeState.state.creditCalls.length, 2, `${label}: one credit check and one deduction`);
  eq(routeState.state.adapterCalls.length, 1, `${label}: one adapter submission`);
  eq(routeState.state.inserts.length, 1, `${label}: one persistence insert`);
}

const baseRouteBody = {
  modelType: "sora2",
  prompt: "offline route verifier prompt",
  durationSeconds: 12,
  quality: "standard",
  aspectRatio: "9:16",
  mode: "prompt_to_video",
};

globalThis.fetch = async () => {
  throw new Error("Submit route harness forbids real network access");
};
try {
  let routeResponse = await invokeSubmitRoute(baseRouteBody, null);
  eq(routeResponse.status, 401, "submit route harness rejects unauthenticated request");
  assertNoInvalidRouteSideEffects("auth failure");

  routeResponse = await invokeSubmitRoute([baseRouteBody]);
  eq(routeResponse.status, 400, "submit route harness rejects non-object JSON body");
  assertNoInvalidRouteSideEffects("non-object body");

  const acceptedOptionalUserIdCases = [
    ["omitted userId", { ...baseRouteBody }],
    ["null userId", { ...baseRouteBody, userId: null }],
    ["empty userId", { ...baseRouteBody, userId: "" }],
    ["matching userId", { ...baseRouteBody, userId: "offline-user" }],
  ];
  for (const [label, body] of acceptedOptionalUserIdCases) {
    routeResponse = await invokeSubmitRoute(body);
    eq(routeResponse.status, 200, `submit route harness accepts ${label}`);
    assertSuccessfulRouteSideEffects(label);
    eq(routeState.state.adapterCalls[0]?.userId, "offline-user", `${label}: authenticated server user remains authoritative`);
    eq(routeState.state.inserts[0]?.user_id, "offline-user", `${label}: insert uses authenticated server user`);
  }

  routeResponse = await invokeSubmitRoute({ ...baseRouteBody, userId: "different-user" });
  eq(routeResponse.status, 403, "submit route harness rejects nonblank mismatching userId");
  eq(routeState.state.events, [], "mismatching userId rejects before validation or side effects");
  assertNoInvalidRouteSideEffects("mismatching userId");

  const invalidRouteCases = [
    ["explicit duration", { ...baseRouteBody, durationSeconds: 25 }],
    ["explicit quality", { ...baseRouteBody, quality: "hd" }],
    ["explicit aspect", { ...baseRouteBody, aspectRatio: "1:1" }],
    ["explicit mode", { ...baseRouteBody, mode: "auto" }],
    ["reference count overflow", {
      ...baseRouteBody,
      mode: "image_to_video",
      imageUrls: ["https://example.test/one.png", "https://example.test/two.png"],
    }],
    ["veo3-4k absent quality", {
      modelType: "veo3-4k",
      prompt: baseRouteBody.prompt,
      durationSeconds: 8,
      aspectRatio: "9:16",
      mode: "prompt_to_video",
    }],
    ["veo3-4k explicit standard", {
      modelType: "veo3-4k",
      prompt: baseRouteBody.prompt,
      durationSeconds: 8,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "prompt_to_video",
    }],
    ["seedance-pro standard conflict", {
      modelType: "seedance-pro",
      prompt: baseRouteBody.prompt,
      durationSeconds: 5,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "prompt_to_video",
    }],
  ];
  for (const [label, body] of invalidRouteCases) {
    routeResponse = await invokeSubmitRoute(body);
    eq(routeResponse.status, 400, `submit route harness rejects ${label}`);
    assertNoInvalidRouteSideEffects(label);
  }

  routeResponse = await invokeSubmitRoute({
    modelType: "seedance-pro",
    prompt: baseRouteBody.prompt,
    durationSeconds: 5,
    quality: "hd",
    aspectRatio: "16:9",
    mode: "prompt_to_video",
  });
  eq(routeResponse.status, 200, "submit route harness accepts seedance-pro explicit HD");
  eq(
    routeState.state.events,
    ["selection", "validation", "registry", "credit", "adapter", "deduct", "insert"],
    "seedance-pro route executes validation before credit, adapter, and insert"
  );
  eq(routeState.state.adapterCalls[0]?.modelType, "seedance", "seedance-pro route submits canonical Seedance model");
  eq(routeState.state.adapterCalls[0]?.quality, "hd", "seedance-pro route preserves explicit HD quality");
  eq(routeState.state.inserts.length, 1, "seedance-pro valid route records one stub insert");

  const canonicalRouteCases = [
    {
      modelType: "sora2",
      durationSeconds: 12,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "prompt_to_video",
      referenceCount: 0,
      creditCost: 20,
    },
    {
      modelType: "sora2-pro",
      durationSeconds: 12,
      quality: "hd",
      aspectRatio: "16:9",
      mode: "image_to_video",
      referenceCount: 1,
      creditCost: 350,
    },
    {
      modelType: "grok",
      durationSeconds: 15,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "image_to_video",
      referenceCount: 4,
      creditCost: 8,
    },
    {
      modelType: "veo",
      durationSeconds: 8,
      quality: "standard",
      aspectRatio: "16:9",
      mode: "image_to_video",
      referenceCount: 3,
      creditCost: 50,
    },
    {
      modelType: "omni",
      durationSeconds: 10,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "image_to_video",
      referenceCount: 7,
      creditCost: 50,
    },
    {
      modelType: "seedance",
      durationSeconds: 10,
      quality: "hd",
      aspectRatio: "16:9",
      mode: "image_to_video",
      referenceCount: 1,
      creditCost: 994,
    },
    {
      modelType: "happyhorse",
      durationSeconds: 12,
      quality: "standard",
      aspectRatio: "9:16",
      mode: "image_to_video",
      referenceCount: 9,
      creditCost: 1080,
    },
  ];

  for (const [caseIndex, testCase] of canonicalRouteCases.entries()) {
    const label = `canonical ${testCase.modelType} route`;
    const imageUrls = Array.from(
      { length: testCase.referenceCount },
      (_, index) => `https://example.test/route-${testCase.modelType}-${index + 1}.png`
    );
    const clientTaskId = `offline-${testCase.modelType}-task`;
    const groupName = `offline-${testCase.modelType}-group`;
    const batchId = `00000000-0000-4000-8000-${String(caseIndex + 1).padStart(12, "0")}`;
    routeResponse = await invokeSubmitRoute({
      modelType: testCase.modelType,
      prompt: baseRouteBody.prompt,
      durationSeconds: testCase.durationSeconds,
      quality: testCase.quality,
      aspectRatio: testCase.aspectRatio,
      mode: testCase.mode,
      imageUrls,
      clientTaskId,
      groupName,
      batchId,
    });

    eq(routeResponse.status, 200, `${label}: accepts exact valid contract`);
    assertSuccessfulRouteSideEffects(label);
    eq(routeState.state.registryCalls, [testCase.modelType], `${label}: looks up canonical model exactly once`);
    eq(
      routeState.state.adapterCalls[0],
      {
        modelType: testCase.modelType,
        prompt: baseRouteBody.prompt,
        aspectRatio: testCase.aspectRatio,
        imageUrls,
        clientTaskId,
        groupName,
        userId: "offline-user",
        durationSeconds: testCase.durationSeconds,
        quality: testCase.quality,
        mode: testCase.mode,
      },
      `${label}: submits exact canonical adapter input`
    );
    eq(
      routeState.state.creditCalls[0],
      { kind: "check", userId: "offline-user", amount: testCase.creditCost },
      `${label}: checks exact canonical credit cost`
    );
    eq(
      {
        user_id: routeState.state.inserts[0]?.user_id,
        batch_id: routeState.state.inserts[0]?.batch_id,
        model: routeState.state.inserts[0]?.model,
        duration: routeState.state.inserts[0]?.duration,
        aspect_ratio: routeState.state.inserts[0]?.aspect_ratio,
        quality: routeState.state.inserts[0]?.quality,
        credit_cost: routeState.state.inserts[0]?.credit_cost,
        reference_image_count: routeState.state.inserts[0]?.metadata?.reference_image_count,
      },
      {
        user_id: "offline-user",
        batch_id: batchId,
        model: `stub-${testCase.modelType}`,
        duration: testCase.durationSeconds,
        aspect_ratio: testCase.aspectRatio,
        quality: testCase.quality,
        credit_cost: testCase.creditCost,
        reference_image_count: testCase.referenceCount,
      },
      `${label}: inserts one exact canonical generation record`
    );
  }
} finally {
  globalThis.fetch = originalFetch;
}

const routeSource = readFileSync(
  join(ROOT, "src/app/api/video-batch/models/submit/route.ts"),
  "utf8"
);
const contractPosition = routeSource.indexOf("parseVideoModelContract(modelType");
const creditPosition = routeSource.indexOf("checkVideoCredits(");
const adapterPosition = routeSource.indexOf("model.adapter.submit(");
ok(contractPosition >= 0, "submit route invokes the production capability contract");
ok(contractPosition < creditPosition, "submit route validates before credit checks");
ok(contractPosition < adapterPosition, "submit route validates before adapter submission");
ok(!routeSource.includes("body.durationSeconds ||"), "submit route has no truthy duration fallback");
ok(!routeSource.includes("as SubmitRequestBody"), "submit route does not cast the external DTO as valid");

const backgroundTaskManagerSource = readFileSync(
  join(ROOT, "src/components/background-task-manager.tsx"),
  "utf8"
).replace(/\r\n?/g, "\n");
const recoveryDecisionPosition = backgroundTaskManagerSource.indexOf(
  "const videoTaskRecovery = resolvePersistedVideoTaskRecovery("
);
const statusRecoveryPosition = backgroundTaskManagerSource.indexOf(
  'videoTaskRecovery.ok && videoTaskRecovery.mode === "status"',
  recoveryDecisionPosition
);
const canonicalRecoveryPollPosition = backgroundTaskManagerSource.indexOf(
  "pollVideoUntilDone(upstreamTaskId, videoTaskRecovery.value)",
  statusRecoveryPosition
);
const rejectedRecoveryGuardPosition = backgroundTaskManagerSource.indexOf(
  "const hasRejectedUpstreamTaskId = persistedUpstreamTaskId !== undefined",
  statusRecoveryPosition
);
const batchSubmitPosition = backgroundTaskManagerSource.indexOf(
  'fetch("/api/video-batch/models/submit"',
  rejectedRecoveryGuardPosition
);
ok(recoveryDecisionPosition >= 0, "BTM batch recovery consumes the executable persisted-task decision");
ok(
  recoveryDecisionPosition < statusRecoveryPosition &&
    statusRecoveryPosition < canonicalRecoveryPollPosition &&
    canonicalRecoveryPollPosition < rejectedRecoveryGuardPosition,
  "BTM passes canonical paid recovery metadata to polling before the rejected-value fail-closed guard"
);
ok(
  rejectedRecoveryGuardPosition < batchSubmitPosition,
  "BTM handles every rejected persisted upstream value before the new-submit branch"
);
ok(
  backgroundTaskManagerSource
    .slice(statusRecoveryPosition, rejectedRecoveryGuardPosition)
    .includes("return;"),
  "BTM validated status-recovery branch returns before submission"
);
ok(
  backgroundTaskManagerSource
    .slice(rejectedRecoveryGuardPosition, batchSubmitPosition)
    .includes('typeof persistedUpstreamTaskId !== "string"'),
  "BTM pre-submit guard covers present non-string upstream values"
);
ok(
  backgroundTaskManagerSource.includes(
    "modelType: validatedSubmission.modelType,\n        durationSeconds: validatedSubmission.durationSeconds,\n        quality: validatedSubmission.quality,"
  ),
  "BTM new-submit polling uses the validated current submission selection"
);

if (failures.length > 0) {
  console.error(`\nVideo model contract verifier: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Video model contract verifier: ${passed} passed, 0 failed`);
