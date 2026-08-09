#!/usr/bin/env node

/** Offline, dependency-free verifier for the Canvas persisted generation-intent contract. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = resolve(process.env.CANVAS_GENERATION_SOURCE_ROOT ?? ROOT);
const OUT = join(ROOT, ".temp", "canvas-generation-intent-verify");
const requireFromSource = createRequire(join(SOURCE_ROOT, "package.json"));
const ts = requireFromSource("typescript");
const zodUrl = pathToFileURL(join(SOURCE_ROOT, "node_modules", "zod", "index.js")).href;
const nanoidUrl = pathToFileURL(join(SOURCE_ROOT, "node_modules", "nanoid", "index.js")).href;

function sourcePath(relativePath) {
  const staged = join(ROOT, relativePath);
  return existsSync(staged) ? staged : join(SOURCE_ROOT, relativePath);
}

function addLocalModuleExtensions(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"]+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

function compileProductionModule(outputName, relativePath, rewrites = {}) {
  const absoluteSourcePath = sourcePath(relativePath);
  const transpiled = ts.transpileModule(readFileSync(absoluteSourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: absoluteSourcePath,
    reportDiagnostics: true,
  });
  const diagnostics = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (diagnostics.length > 0) {
    throw new Error(
      diagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n")
    );
  }
  let code = transpiled.outputText;
  const allRewrites = { '"zod"': `"${zodUrl}"`, '"nanoid"': `"${nanoidUrl}"`, ...rewrites };
  for (const [from, to] of Object.entries(allRewrites)) code = code.split(from).join(to);
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

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

mkdirSync(OUT, { recursive: true });

compileProductionModule("types", "src/lib/video-models/types.ts");
compileProductionModule("catalog", "src/lib/video-models/catalog.ts", {
  '"./types"': '"./types"',
});
compileProductionModule("contract", "src/lib/video-models/contract.ts", {
  '"./catalog"': '"./catalog"',
  '"./types"': '"./types"',
});
const intentPath = compileProductionModule(
  "generation-intent",
  "src/lib/canvas/generation-intent.ts",
  {
    '"../video-models/contract"': '"./contract"',
    '"../video-models/types"': '"./types"',
  }
);
const schemaPath = compileProductionModule("schema", "src/lib/canvas/schema.ts", {
  '"./generation-intent"': '"./generation-intent"',
});

const intent = await importFresh(intentPath);
const canvas = await importFresh(schemaPath);

const ACTION_ID = "123e4567-e89b-42d3-a456-426614174000";
const GENERATION_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBMITTED_AT = "2026-07-15T01:02:03.004Z";
const TEXT_HASH = sha256("upstream\né");

const textRaw = {
  version: 1,
  kind: "text",
  actionId: ACTION_ID,
  submittedAt: SUBMITTED_AT,
  prompt: "\u00a0e\u0301\r\nline 2\u3000",
  inputs: [{ kind: "text", nodeId: "text-a", textSha256: TEXT_HASH }],
  config: { model: "deepseek-chat" },
};

const imageRaw = {
  version: 1,
  kind: "image",
  actionId: ACTION_ID,
  submittedAt: SUBMITTED_AT,
  prompt: "  product\rphoto  ",
  inputs: [
    { kind: "text", nodeId: "text-a", textSha256: TEXT_HASH },
    { kind: "image", nodeId: "image-a", ossKey: "users/u1/source.png" },
  ],
  config: {
    model: "gpt-image-2",
    resolution: "2k",
    // 2026-08-09(P1-Q2a)前这里写的是 "4:5" —— 那是上游 sizeMap 够不着、会静默回落 auto
    // 却按全价扣费的档位之一。枚举收窄后它必须被拒,故夹具改用真实支持的 "3:4"。
    aspectRatio: "3:4",
    referenceNodeIds: ["image-a"],
  },
};

const videoRaw = {
  version: 1,
  kind: "video",
  actionId: ACTION_ID,
  submittedAt: SUBMITTED_AT,
  prompt: "  move it  ",
  inputs: [{ kind: "image", nodeId: "image-a", ossKey: "users/u1/source.png" }],
  config: {
    model: "sora2",
    durationSeconds: 12,
    quality: "standard",
    aspectRatio: "9:16",
    mode: "image_to_video",
    referenceNodeIds: ["image-a"],
  },
};

const parsedText = intent.CanvasGenerationIntentV1Schema.parse(textRaw);
eq(parsedText.prompt, "é\nline 2", "NFC, CRLF and Unicode outer whitespace normalize exactly");
eq(
  intent.normalizeCanvasGenerationText("  alpha\rbeta  "),
  "alpha\nbeta",
  "lone CR normalizes to LF before control validation"
);
eq(
  intent.normalizeCanvasGenerationText("\t alpha  \t beta \n"),
  "alpha  \t beta",
  "internal spaces and tabs remain byte-exact"
);
eq(
  intent.normalizeCanvasGenerationText("\ufeff \u3000line\u2028sep\u2029tail \u00a0"),
  "line\u2028sep\u2029tail",
  "Unicode outer whitespace trims while internal separators are preserved"
);
eq(
  intent.computeCanvasGenerationTextSha256(" \u00a0upstream\r\ne\u0301\u3000"),
  TEXT_HASH,
  "upstream text hash matches independent Node SHA-256 after normalization"
);
eq(intent.sha256Utf8Hex(""), sha256(""), "portable SHA-256 matches independent empty vector");
eq(
  intent.sha256Utf8Hex("ASCII é 😀"),
  sha256("ASCII é 😀"),
  "portable SHA-256 matches independent multibyte UTF-8 vector"
);
eq(
  intent.sha256Utf8Hex("a".repeat(1000)),
  sha256("a".repeat(1000)),
  "portable SHA-256 matches independent multi-block padding vector"
);
for (const boundaryLength of [55, 56, 63, 64, 119, 128]) {
  eq(
    intent.sha256Utf8Hex("a".repeat(boundaryLength)),
    sha256("a".repeat(boundaryLength)),
    `portable SHA-256 matches independent ${boundaryLength}-byte padding boundary vector`
  );
}
throws(() => intent.sha256Utf8Hex("a\ud800b"), "portable SHA-256 rejects lone high surrogates");
throws(
  () => intent.computeCanvasGenerationTextSha256("\udfff"),
  "text hashing rejects lone low surrogates"
);

const expectedTextJcs =
  `{"actionId":"${ACTION_ID}","config":{"model":"deepseek-chat"},` +
  `"inputs":[{"kind":"text","nodeId":"text-a","textSha256":"${TEXT_HASH}"}],` +
  `"kind":"text","prompt":"é\\nline 2","submittedAt":"${SUBMITTED_AT}","version":1}`;
eq(
  intent.canonicalizeCanvasJson(parsedText),
  expectedTextJcs,
  "intent JCS matches an independently fixed expected serialization"
);
eq(
  intent.computeCanvasGenerationFingerprint(textRaw),
  sha256(`canvas-generation-v1\n${expectedTextJcs}`),
  "v1 request fingerprint matches independent Node SHA-256 over fixed JCS"
);
eq(
  intent.computeCanvasGenerationFingerprint(clone(textRaw)),
  intent.computeCanvasGenerationFingerprint(textRaw),
  "fingerprint is deterministic for identical intents"
);
{
  const changedAction = clone(textRaw);
  changedAction.actionId = GENERATION_ID;
  ok(
    intent.computeCanvasGenerationFingerprint(changedAction) !==
      intent.computeCanvasGenerationFingerprint(textRaw),
    "fingerprint changes when actionId changes"
  );
  const changedTime = clone(textRaw);
  changedTime.submittedAt = "2026-07-15T01:02:03.005Z";
  ok(
    intent.computeCanvasGenerationFingerprint(changedTime) !==
      intent.computeCanvasGenerationFingerprint(textRaw),
    "fingerprint changes when submittedAt changes"
  );
}
eq(
  intent.CANVAS_GENERATION_FINGERPRINT_VERSION,
  "canvas-generation-v1",
  "fingerprint version is frozen"
);

eq(
  intent.canonicalizeCanvasJson({ z: 1e30, a: -0, nested: { b: true, a: null } }),
  '{"a":0,"nested":{"a":null,"b":true},"z":1e+30}',
  "JCS sorts nested keys and uses ECMAScript number serialization"
);
eq(
  intent.canonicalizeCanvasJson({
    "\ufb33": "hebrew",
    "😀": "grin",
    "€": "euro",
    "ö": "latin",
    "\u0080": "c1",
    "1": "one",
    "\r": "cr",
  }),
  '{"\\r":"cr","1":"one","\u0080":"c1","ö":"latin","€":"euro","😀":"grin","דּ":"hebrew"}',
  "JCS uses fixed RFC 8785 UTF-16 property ordering"
);
eq(
  intent.canonicalizeCanvasJson({ a: 1e-7, b: 0.000001, c: 1e21, d: 9007199254740992 }),
  '{"a":1e-7,"b":0.000001,"c":1e+21,"d":9007199254740992}',
  "JCS numbers use exact ECMAScript shortest round-trip serialization"
);
throws(() => intent.canonicalizeCanvasJson({ a: undefined }), "JCS rejects undefined object values");
throws(() => intent.canonicalizeCanvasJson([, 1]), "JCS rejects sparse arrays");
throws(() => intent.canonicalizeCanvasJson(Number.NaN), "JCS rejects NaN");
throws(() => intent.canonicalizeCanvasJson(Number.POSITIVE_INFINITY), "JCS rejects Infinity");
throws(() => intent.canonicalizeCanvasJson("\ud800"), "JCS rejects lone surrogates");

ok(intent.CanvasGenerationIntentV1Schema.safeParse(imageRaw).success, "exact GPT Image 2 intent passes");

/*
 * 画幅枚举必须与上游 getVideoPlatformImageSize 的 sizeMap 能力**逐值相等**(CHECKLIST #78 / P1-Q2a)。
 *
 * 这不是风格检查:该函数末行是 `sizeMap[r]?.[ratio] || sizeMap[r]?.auto || null`,
 * 传入 map 里没有的档位不报错而是静默回落 auto —— 用户按全价付了钱、拿回错画幅的图,
 * 且这条路只有 schema 能堵(面板数组只防住老实用面板的人)。
 * 故此处双向断言:6 个支持值必须全过,5 个已下线值必须全拒。任一方向漏了都会红。
 */
const SUPPORTED_ASPECTS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"];
const REJECTED_ASPECTS = ["3:2", "2:3", "5:4", "4:5", "21:9", "1:2", "2:1", "9:21"];
eq(
  JSON.stringify([...intent.CANVAS_IMAGE_ASPECT_RATIOS]),
  JSON.stringify(SUPPORTED_ASPECTS),
  "CANVAS_IMAGE_ASPECT_RATIOS is the exact upstream sizeMap key set"
);
for (const ratio of SUPPORTED_ASPECTS) {
  const candidate = clone(imageRaw);
  candidate.config.aspectRatio = ratio;
  ok(
    intent.CanvasGenerationIntentV1Schema.safeParse(candidate).success,
    `image aspectRatio ${ratio} is accepted (upstream sizeMap has it)`
  );
}
for (const ratio of REJECTED_ASPECTS) {
  const candidate = clone(imageRaw);
  candidate.config.aspectRatio = ratio;
  ok(
    !intent.CanvasGenerationIntentV1Schema.safeParse(candidate).success,
    `image aspectRatio ${ratio} is rejected (would silently fall back to auto yet bill full price)`
  );
}
ok(intent.CanvasGenerationIntentV1Schema.safeParse(videoRaw).success, "exact video intent passes");
const parsedImage = intent.CanvasGenerationIntentV1Schema.parse(imageRaw);
ok(
  !Object.prototype.hasOwnProperty.call(parsedImage.inputs[1], "generationId"),
  "absent optional media generationId stays absent"
);
const generatedImage = clone(imageRaw);
generatedImage.inputs[1].generationId = GENERATION_ID;
ok(
  intent.CanvasGenerationIntentV1Schema.safeParse(generatedImage).success,
  "canonical media generationId is accepted"
);
{
  const zeroInputText = clone(textRaw);
  zeroInputText.inputs = [];
  ok(
    intent.CanvasGenerationIntentV1Schema.safeParse(zeroInputText).success,
    "text intent accepts zero inputs"
  );
}

const capabilityMatrix = {
  sora2: { durationSeconds: 12, quality: "standard", maxImages: 1 },
  "sora2-pro": { durationSeconds: 12, quality: "hd", maxImages: 1 },
  grok: { durationSeconds: 15, quality: "standard", maxImages: 4 },
  veo: { durationSeconds: 8, quality: "standard", maxImages: 3 },
  omni: { durationSeconds: 10, quality: "standard", maxImages: 7 },
  seedance: { durationSeconds: 10, quality: "hd", maxImages: 1 },
  happyhorse: { durationSeconds: 12, quality: "standard", maxImages: 9 },
};

for (const [model, capability] of Object.entries(capabilityMatrix)) {
  const promptIntent = clone(videoRaw);
  promptIntent.inputs = [];
  promptIntent.config = {
    model,
    durationSeconds: capability.durationSeconds,
    quality: capability.quality,
    aspectRatio: "16:9",
    mode: "prompt_to_video",
    referenceNodeIds: [],
  };
  ok(
    intent.CanvasGenerationIntentV1Schema.safeParse(promptIntent).success,
    `${model}: accepted catalog tuple passes prompt_to_video with zero references`
  );

  const referenceIntent = clone(promptIntent);
  referenceIntent.inputs = Array.from({ length: capability.maxImages }, (_, index) => ({
    kind: "image",
    nodeId: `image-${index + 1}`,
    ossKey: `users/u1/reference-${index + 1}.png`,
  }));
  referenceIntent.config.mode = "image_to_video";
  referenceIntent.config.referenceNodeIds = referenceIntent.inputs.map((input) => input.nodeId);
  ok(
    intent.CanvasGenerationIntentV1Schema.safeParse(referenceIntent).success,
    `${model}: accepted catalog maximum preserves every ordered reference`
  );

  const overflow = clone(referenceIntent);
  overflow.inputs.push({
    kind: "image",
    nodeId: `image-${capability.maxImages + 1}`,
    ossKey: `users/u1/reference-${capability.maxImages + 1}.png`,
  });
  overflow.config.referenceNodeIds.push(`image-${capability.maxImages + 1}`);
  ok(
    !intent.CanvasGenerationIntentV1Schema.safeParse(overflow).success,
    `${model}: catalog maxImages + 1 rejects without truncation`
  );
}

const ossKeyEquivalenceVectors = [
  ["users/u1/a.png", true],
  ["a", true],
  ["0/9/Z.z-._x", true],
  ["a/../b", true],
  [".hidden", false],
  ["-lead", false],
  ["a\\b", false],
  ["路径/中文.png", false],
  ["a b.png", false],
  ["", false],
  ["a".repeat(1025), false],
  ["a?b", false],
  ["a#b", false],
  ["https://example.test/a.png", false],
  ["//cdn.example.test/a.png", false],
  ["/rooted.png", false],
  [" lead.png", false],
  ["trail.png ", false],
];
for (const [ossKey, expected] of ossKeyEquivalenceVectors) {
  const candidate = clone(imageRaw);
  candidate.inputs[1].ossKey = ossKey;
  const intentAccepts = intent.CanvasGenerationIntentV1Schema.safeParse(candidate).success;
  ok(
    intentAccepts === expected && canvas.isOssObjectKey(ossKey) === expected,
    `intent OSS-key rule stays equivalent to the Canvas media rule for ${JSON.stringify(ossKey)}`
  );
}

const invalidCases = [];
function invalid(label, value) {
  invalidCases.push([label, value]);
}

let value = clone(textRaw);
value.extra = true;
invalid("unknown intent key", value);
value = clone(textRaw);
value.config.extra = true;
invalid("unknown config key", value);
value = clone(textRaw);
value.inputs[0].extra = true;
invalid("unknown input key", value);
value = clone(textRaw);
value.actionId = ACTION_ID.toUpperCase();
invalid("uppercase UUID", value);
for (const submittedAt of [
  "2026-07-15T01:02:03Z",
  "2026-07-15T01:02:03.004+00:00",
  "2026-02-30T01:02:03.004Z",
  "0000-01-01T00:00:00.000Z",
]) {
  value = clone(textRaw);
  value.submittedAt = submittedAt;
  invalid(`noncanonical submittedAt ${submittedAt}`, value);
}
for (const prompt of ["bad\u0000text", "bad\u000btext", "bad\u007ftext", "bad\u0085text", "\ud800"] ) {
  value = clone(textRaw);
  value.prompt = prompt;
  invalid(`forbidden prompt ${JSON.stringify(prompt)}`, value);
}
value = clone(textRaw);
value.prompt = "   ";
invalid("empty normalized text prompt", value);
value = clone(imageRaw);
value.prompt = "x";
invalid("one-code-point image prompt", value);
value = clone(textRaw);
value.prompt = "😀".repeat(12_001);
invalid("text prompt over 12000 code points", value);
value = clone(imageRaw);
value.prompt = "😀".repeat(8_001);
invalid("media prompt over 8000 code points", value);
value = clone(generatedImage);
value.inputs[1].generationId = undefined;
invalid("explicit undefined optional generationId", value);
for (const ossKey of [" users/u1/a.png", "https://example.test/a.png", "data:image/png;base64,a", "/root/a.png", "a.png?x=1"]) {
  value = clone(imageRaw);
  value.inputs[1].ossKey = ossKey;
  invalid(`invalid OSS key ${ossKey}`, value);
}
value = clone(textRaw);
value.inputs[0].textSha256 = TEXT_HASH.toUpperCase();
invalid("uppercase text hash", value);
value = clone(textRaw);
value.inputs.push(clone(value.inputs[0]));
invalid("duplicate input node ID", value);
value = clone(textRaw);
value.inputs = Array.from({ length: 33 }, (_, index) => ({
  kind: "text",
  nodeId: `text-${index}`,
  textSha256: TEXT_HASH,
}));
invalid("more than 32 inputs", value);
value = clone(textRaw);
value.inputs = [{ kind: "image", nodeId: "image-a", ossKey: "users/u1/a.png" }];
invalid("text intent media input", value);
value = clone(imageRaw);
value.inputs.push({ kind: "image", nodeId: "image-b", ossKey: "users/u1/b.png" });
value.config.referenceNodeIds.push("image-b");
invalid("GPT Image 2 two references", value);
value = clone(imageRaw);
value.config.referenceNodeIds = [];
invalid("image reference list omits image input", value);
value = clone(imageRaw);
value.config.referenceNodeIds = ["image-b"];
invalid("image reference ID mismatch", value);
value = clone(videoRaw);
value.config.mode = "prompt_to_video";
invalid("prompt_to_video with reference", value);
value = clone(videoRaw);
value.inputs = [];
value.config.referenceNodeIds = [];
invalid("image_to_video without reference", value);
value = clone(videoRaw);
value.config.durationSeconds = 5;
invalid("unsupported Sora duration", value);
value = clone(videoRaw);
value.config.quality = "hd";
invalid("unsupported Sora quality", value);
value = clone(videoRaw);
value.config.durationSeconds = Number.NaN;
invalid("non-finite duration", value);
value = clone(videoRaw);
value.config.referenceNodeIds = ["image-a", "image-a"];
invalid("duplicate video reference IDs", value);
value = clone(textRaw);
value.prompt = undefined;
invalid("explicit undefined required prompt", value);
value = clone(textRaw);
value.config = undefined;
invalid("explicit undefined required config", value);
value = clone(videoRaw);
value.config.referenceNodeIds = [undefined];
invalid("undefined video reference element", value);

for (const [label, invalidIntent] of invalidCases) {
  ok(!intent.CanvasGenerationIntentV1Schema.safeParse(invalidIntent).success, `rejects ${label}`);
}

const integrated = canvas.CanvasNodeDataSchema.parse({
  params: {
    unrelated: { preserved: true },
    generation: textRaw,
  },
});
eq(integrated.params.unrelated, { preserved: true }, "Canvas params retain unrelated P0 keys");
eq(integrated.params.generation.prompt, "é\nline 2", "Canvas params parse normalized generation intent");
ok(
  canvas.CanvasNodeDataSchema.safeParse({ params: { unrelated: 42 } }).success,
  "Canvas params remain valid without generation"
);
ok(
  !canvas.CanvasNodeDataSchema.safeParse({ params: { generation: undefined } }).success,
  "Canvas params reject explicit undefined generation"
);
value = clone(textRaw);
value.extra = "forbidden";
ok(
  !canvas.CanvasNodeDataSchema.safeParse({ params: { keep: true, generation: value } }).success,
  "Canvas params reject invalid nested generation while retaining catchall behavior"
);
ok(
  !canvas.CanvasNodeDataSchema.safeParse({ params: { generation: "not-an-intent" } }).success,
  "Canvas params reject a non-object generation value"
);

const generationSource = readFileSync(sourcePath("src/lib/canvas/generation-intent.ts"), "utf8");
const schemaSource = readFileSync(sourcePath("src/lib/canvas/schema.ts"), "utf8");
ok(!generationSource.includes('from "./schema"'), "generation intent module does not import Canvas schema");
ok(
  schemaSource.includes('import { CanvasGenerationIntentV1Schema } from "./generation-intent";'),
  "Canvas schema imports the focused generation module"
);
ok(
  schemaSource.includes("params: CanvasNodeParamsSchema.optional()"),
  "Canvas node data integrates the strict params schema"
);

if (failures.length > 0) {
  console.error(`\nCanvas generation intent verifier: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Canvas generation intent verifier: ${passed} passed, 0 failed`);
