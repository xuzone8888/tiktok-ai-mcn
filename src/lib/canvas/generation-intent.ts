import { z } from "zod";

import { parseUntrustedVideoModelContract } from "../video-models/contract";
import { VIDEO_MODEL_IDS } from "../video-models/types";

export const CANVAS_GENERATION_FINGERPRINT_VERSION = "canvas-generation-v1" as const;

const LOWERCASE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RFC3339_UTC_MILLISECONDS_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const LOWERCASE_SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const CanvasIntentNodeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!-~]+$/, "nodeId must be printable ASCII without whitespace or controls");

const LowercaseUuidSchema = z
  .string()
  .regex(LOWERCASE_UUID_RE, "must be a lowercase canonical UUID");

const SubmittedAtSchema = z
  .string()
  .regex(
    RFC3339_UTC_MILLISECONDS_RE,
    "must be an RFC3339 UTC timestamp with exactly millisecond precision"
  )
  .refine((value) => {
    const date = new Date(value);
    return value.slice(0, 4) !== "0000" && Number.isFinite(date.getTime()) && date.toISOString() === value;
  }, "must be a real RFC3339 UTC timestamp");

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertValidUnicodeText(value: string): void {
  if (hasLoneSurrogate(value)) throw new TypeError("text contains a lone surrogate");
  if (FORBIDDEN_CONTROL_RE.test(value)) {
    throw new TypeError("text contains a forbidden control character");
  }
}

/** Canonical text shared by persistence, hashing and provider-bound request paths. */
export function normalizeCanvasGenerationText(value: string): string {
  if (typeof value !== "string") throw new TypeError("text must be a string");
  const lineNormalized = value.replace(/\r\n?/g, "\n");
  assertValidUnicodeText(lineNormalized);
  const normalized = lineNormalized.normalize("NFC").trim();
  assertValidUnicodeText(normalized);
  return normalized;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizedTextSchema(minCodePoints: number, maxCodePoints: number) {
  return z
    .string()
    .transform((value, ctx) => {
      try {
        return normalizeCanvasGenerationText(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : String(error),
        });
        return z.NEVER;
      }
    })
    .refine((value) => codePointLength(value) >= minCodePoints, {
      message: `must contain at least ${minCodePoints} Unicode code points after normalization`,
    })
    .refine((value) => codePointLength(value) <= maxCodePoints, {
      message: `must contain at most ${maxCodePoints} Unicode code points after normalization`,
    });
}

function isOssObjectKey(value: string): boolean {
  if (!value || value !== value.trim() || value.length > 1024) return false;
  if (/^data:/i.test(value) || /^\/\//.test(value) || /:\/\//.test(value)) return false;
  if (/[?#]/.test(value) || value.startsWith("/")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(value);
}

const OssObjectKeySchema = z
  .string()
  .refine(isOssObjectKey, "must be a valid owner-resolvable OSS object key");

const TextInputSnapshotSchema = z.strictObject({
  kind: z.literal("text"),
  nodeId: CanvasIntentNodeIdSchema,
  textSha256: z.string().regex(LOWERCASE_SHA256_RE, "must be 64 lowercase hex characters"),
});

const ImageInputSnapshotSchema = z.strictObject({
  kind: z.literal("image"),
  nodeId: CanvasIntentNodeIdSchema,
  ossKey: OssObjectKeySchema,
  generationId: LowercaseUuidSchema.optional(),
});

const VideoInputSnapshotSchema = z.strictObject({
  kind: z.literal("video"),
  nodeId: CanvasIntentNodeIdSchema,
  ossKey: OssObjectKeySchema,
  generationId: LowercaseUuidSchema.optional(),
});

export const CanvasGenerationInputSnapshotSchema = z.discriminatedUnion("kind", [
  TextInputSnapshotSchema,
  ImageInputSnapshotSchema,
  VideoInputSnapshotSchema,
]);
export type CanvasGenerationInputSnapshot = z.infer<
  typeof CanvasGenerationInputSnapshotSchema
>;

const InputSnapshotsSchema = z.array(CanvasGenerationInputSnapshotSchema).max(32);

const TextGenerationConfigSchema = z.strictObject({
  model: z.literal("deepseek-chat"),
});

/**
 * 画布图片画幅枚举(CHECKLIST #78)· **唯一真相源,三处共用**
 * (本 schema / `generation-api-types` 的估价 schema / 面板 `IMAGE_ASPECTS` 与客户端草稿类型)。
 *
 * **这 6 项是上游的真实能力边界,不要往上加。** 上游
 * `getVideoPlatformImageSize`(`src/lib/video-platform-image-api.ts:211-242`)的 `sizeMap`
 * 每个分辨率档**只有这 6 个 key**,而其末行是
 * `sizeMap[resolution]?.[ratio] || sizeMap[resolution]?.auto || null` ——
 * 传入 map 里没有的档位**不报错,而是静默回落成 auto 尺寸**。
 *
 * 2026-08-09 之前本枚举收 11 项(多出 3:2/2:3/5:4/4:5/21:9),面板只给 6 项,
 * 于是「用户选了 21:9、按全价扣分、拿回自动画幅的图」这条路**在契约层是敞开的**,
 * 唯一防线只是面板那个数组。画布已对所有登录用户开放,故按用户裁决(P1-Q2a)收窄到 6 项,
 * 让契约与真实能力一致。收窄前已扫生产全部 8 个画布文档:越界档位**零命中**,不会打坏存量。
 *
 * 要真正补齐 #78 的 13 种,必须先给上游 `sizeMap` 补像素尺寸并确认 gpt-image-2 接受 ——
 * 那是 quick-gen / image-factory 共用链路,不属画布单方改动;#78 已按 P1-Q2b 改判延 P2。
 */
export const CANVAS_IMAGE_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
] as const;
export type CanvasImageAspectRatio = (typeof CANVAS_IMAGE_ASPECT_RATIOS)[number];

const ImageGenerationConfigSchema = z.strictObject({
  model: z.literal("gpt-image-2"),
  resolution: z.enum(["1k", "2k", "4k"]),
  aspectRatio: z.enum(CANVAS_IMAGE_ASPECT_RATIOS),
  referenceNodeIds: z.array(CanvasIntentNodeIdSchema).max(1),
});

const VideoGenerationConfigSchema = z.strictObject({
  model: z.enum(VIDEO_MODEL_IDS),
  durationSeconds: z.union([
    z.literal(5),
    z.literal(8),
    z.literal(10),
    z.literal(12),
    z.literal(15),
  ]),
  quality: z.enum(["standard", "hd"]),
  aspectRatio: z.enum(["9:16", "16:9"]),
  mode: z.enum(["prompt_to_video", "image_to_video"]),
  referenceNodeIds: z.array(CanvasIntentNodeIdSchema),
});

const TextGenerationIntentSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("text"),
  actionId: LowercaseUuidSchema,
  submittedAt: SubmittedAtSchema,
  prompt: normalizedTextSchema(1, 12_000),
  inputs: InputSnapshotsSchema,
  config: TextGenerationConfigSchema,
});

const ImageGenerationIntentSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("image"),
  actionId: LowercaseUuidSchema,
  submittedAt: SubmittedAtSchema,
  prompt: normalizedTextSchema(2, 8_000),
  inputs: InputSnapshotsSchema,
  config: ImageGenerationConfigSchema,
});

const VideoGenerationIntentSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("video"),
  actionId: LowercaseUuidSchema,
  submittedAt: SubmittedAtSchema,
  prompt: normalizedTextSchema(2, 8_000),
  inputs: InputSnapshotsSchema,
  config: VideoGenerationConfigSchema,
});

function addCustomIssue(
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  ctx.addIssue({ code: "custom", path, message });
}

function findExplicitUndefined(
  value: unknown,
  path: PropertyKey[] = []
): PropertyKey[] | null {
  if (value === undefined) return path;
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return [...path, index];
      const found = findExplicitUndefined(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const found = findExplicitUndefined((value as Record<string, unknown>)[key], [...path, key]);
    if (found) return found;
  }
  return null;
}

function uniqueNodeIds(
  nodeIds: readonly string[],
  ctx: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const seen = new Set<string>();
  nodeIds.forEach((nodeId, index) => {
    if (seen.has(nodeId)) {
      addCustomIssue(ctx, [...path, index], `duplicate node ID: ${nodeId}`);
    }
    seen.add(nodeId);
  });
}

const CanvasGenerationIntentV1BaseSchema = z.discriminatedUnion("kind", [
  TextGenerationIntentSchema,
  ImageGenerationIntentSchema,
  VideoGenerationIntentSchema,
]);

/** Strict persisted generation intent. Parsing returns the normalized canonical value. */
export const CanvasGenerationIntentV1Schema = CanvasGenerationIntentV1BaseSchema.superRefine(
  (intent, ctx) => {
    const explicitUndefinedPath = findExplicitUndefined(intent);
    if (explicitUndefinedPath) {
      addCustomIssue(ctx, explicitUndefinedPath, "explicit undefined is not valid JSON");
    }

    uniqueNodeIds(
      intent.inputs.map((input) => input.nodeId),
      ctx,
      ["inputs"]
    );

    if (intent.kind === "text") {
      intent.inputs.forEach((input, index) => {
        if (input.kind !== "text") {
          addCustomIssue(ctx, ["inputs", index, "kind"], "text intent accepts only text inputs");
        }
      });
      return;
    }

    const imageInputNodeIds = intent.inputs
      .filter((input): input is z.infer<typeof ImageInputSnapshotSchema> => input.kind === "image")
      .map((input) => input.nodeId);
    uniqueNodeIds(intent.config.referenceNodeIds, ctx, ["config", "referenceNodeIds"]);
    if (
      imageInputNodeIds.length !== intent.config.referenceNodeIds.length ||
      imageInputNodeIds.some((nodeId, index) => intent.config.referenceNodeIds[index] !== nodeId)
    ) {
      addCustomIssue(
        ctx,
        ["config", "referenceNodeIds"],
        "must exactly match the ordered image input node IDs"
      );
    }

    if (intent.kind === "image") return;

    const referenceCount = intent.config.referenceNodeIds.length;
    if (intent.config.mode === "prompt_to_video" && referenceCount !== 0) {
      addCustomIssue(
        ctx,
        ["config", "referenceNodeIds"],
        "prompt_to_video requires zero references"
      );
    }
    if (intent.config.mode === "image_to_video" && referenceCount === 0) {
      addCustomIssue(
        ctx,
        ["config", "referenceNodeIds"],
        "image_to_video requires at least one reference"
      );
    }

    const capability = parseUntrustedVideoModelContract({
      modelType: intent.config.model,
      durationSeconds: intent.config.durationSeconds,
      quality: intent.config.quality,
      aspectRatio: intent.config.aspectRatio,
      mode: intent.config.mode,
      referenceImageCount: referenceCount,
    });
    if (!capability.ok) {
      addCustomIssue(
        ctx,
        ["config", capability.error.field === "modelType" ? "model" : capability.error.field],
        capability.error.message
      );
    }
  }
);
export type CanvasGenerationIntentV1 = z.infer<typeof CanvasGenerationIntentV1Schema>;

function assertCanonicalJsonString(value: string): void {
  if (hasLoneSurrogate(value)) throw new TypeError("JCS strings must not contain lone surrogates");
}

/** Dependency-free RFC 8785 JSON canonicalization for the persisted JSON value domain. */
export function canonicalizeCanvasJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertCanonicalJsonString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index) || value[index] === undefined) {
        throw new TypeError("JCS arrays must not contain holes or undefined");
      }
      items.push(canonicalizeCanvasJson(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JCS objects must be plain JSON objects");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => {
        assertCanonicalJsonString(key);
        if (object[key] === undefined) throw new TypeError("JCS objects must not contain undefined");
        return `${JSON.stringify(key)}:${canonicalizeCanvasJson(object[key])}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`value is outside the JCS JSON domain: ${typeof value}`);
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function utf8Bytes(value: string): Uint8Array {
  assertCanonicalJsonString(value);
  return new TextEncoder().encode(value);
}

/** Portable SHA-256 over UTF-8 with no Node-only or browser-only dependency. */
export function sha256Utf8Hex(value: string): string {
  if (typeof value !== "string") throw new TypeError("SHA-256 input must be a string");
  const input = utf8Bytes(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = BigInt(input.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        (padded[wordOffset] << 24) |
        (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) |
        padded[wordOffset + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15];
      const prior2 = words[index - 2];
      const sigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

/** Hash a text snapshot after applying the exact persisted-text normalization. */
export function computeCanvasGenerationTextSha256(value: string): string {
  return sha256Utf8Hex(normalizeCanvasGenerationText(value));
}

/** Parse, normalize, canonicalize and fingerprint one v1 generation intent. */
export function computeCanvasGenerationFingerprint(rawIntent: unknown): string {
  const canonicalIntent = CanvasGenerationIntentV1Schema.parse(rawIntent);
  return sha256Utf8Hex(
    `${CANVAS_GENERATION_FINGERPRINT_VERSION}\n${canonicalizeCanvasJson(canonicalIntent)}`
  );
}
