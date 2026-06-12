/**
 * Video Platform GPT Image 2 provider.
 *
 * This provider uses the video-platform image task API:
 * - POST /v1/images/generations
 * - POST /v1/images/edits
 * - GET  /v1/images/{taskId}
 *
 * Text-to-image uses JSON generations. Reference-image requests use multipart edits
 * with a single `image` file because Aixoras generations+urls does not reliably
 * preserve the reference subject.
 */

import { generateMediaPath, uploadImageBuffer } from "@/lib/oss";
import {
  fetchImageReferenceUrl,
  ImageReferenceUrlError,
  MAX_REFERENCE_IMAGE_BYTES,
  validateImageReferenceUrl,
} from "@/lib/image-reference-url";
import {
  DEFAULT_IMAGE_RESOLUTION,
  type ImageAspectRatio,
  type ImageResolution,
} from "@/types/generation";

export interface VideoPlatformImageParams {
  prompt: string;
  sourceImageUrls?: string[];
  resolution?: ImageResolution;
  aspectRatio?: ImageAspectRatio | string;
}

export interface VideoPlatformImageResult {
  success: boolean;
  status: "completed" | "processing" | "failed";
  imageUrl?: string;
  upstreamImageUrl?: string;
  platformTaskId?: string;
  error?: string;
  requestedSize?: string;
  upstreamSize?: string;
  upstreamQuality?: string;
  outputFormat?: string;
  outputCompression?: number | null;
  requestTimeoutMs?: number;
  hasUrls?: boolean;
  referenceCount?: number;
  referenceCountReceived?: number;
  referenceCountUsed?: number;
  referenceReductionReason?: string | null;
  endpoint?: "/v1/images/generations" | "/v1/images/edits" | "/v1/images/{taskId}";
  upstreamCallCount?: number;
  upstreamResponseType?: "direct_image_url" | "b64_json" | "task_id" | "processing" | "failed" | "unknown";
  statusCode?: number;
  upstreamStatus?: number;
  retryable?: boolean;
  rawStatus?: string | null;
}

type VideoPlatformTaskStatus = "completed" | "processing" | "failed";

const DEFAULT_VIDEO_PLATFORM_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_VIDEO_PLATFORM_IMAGE_QUALITY = "high";
const DEFAULT_VIDEO_PLATFORM_IMAGE_OUTPUT_FORMAT = "jpeg";
const DEFAULT_VIDEO_PLATFORM_IMAGE_OUTPUT_COMPRESSION = 92;
const DEFAULT_VIDEO_PLATFORM_IMAGE_OSS_PREFIX = "video-platform-image";
const DEFAULT_VIDEO_PLATFORM_IMAGE_REQUEST_TIMEOUT_MS = 300_000;
const MAX_GENERATED_IMAGE_BYTES = 80 * 1024 * 1024;

class VideoPlatformReferenceImageError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "VideoPlatformReferenceImageError";
    this.statusCode = statusCode;
  }
}

function getVideoPlatformBaseUrl(): string {
  return (process.env.VIDEO_PLATFORM_IMAGE_BASE_URL || "").replace(/\/+$/, "");
}

function getVideoPlatformApiUrl(pathname: string): string {
  const baseUrl = getVideoPlatformBaseUrl();
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return baseUrl.endsWith("/v1")
    ? `${baseUrl}${normalizedPathname}`
    : `${baseUrl}/v1${normalizedPathname}`;
}

function getVideoPlatformApiKey(): string {
  return process.env.VIDEO_PLATFORM_IMAGE_API_KEY || "";
}

function getVideoPlatformModel(): string {
  return process.env.VIDEO_PLATFORM_IMAGE_MODEL || DEFAULT_VIDEO_PLATFORM_IMAGE_MODEL;
}

function getVideoPlatformQuality(): string {
  return process.env.VIDEO_PLATFORM_IMAGE_QUALITY || DEFAULT_VIDEO_PLATFORM_IMAGE_QUALITY;
}

function getVideoPlatformOutputFormat(): string {
  return process.env.VIDEO_PLATFORM_IMAGE_OUTPUT_FORMAT || DEFAULT_VIDEO_PLATFORM_IMAGE_OUTPUT_FORMAT;
}

function getVideoPlatformOutputCompression(): number {
  const parsed = Number(process.env.VIDEO_PLATFORM_IMAGE_OUTPUT_COMPRESSION);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? Math.round(parsed)
    : DEFAULT_VIDEO_PLATFORM_IMAGE_OUTPUT_COMPRESSION;
}

function isVideoPlatformFormatOptionsEnabled(): boolean {
  return process.env.VIDEO_PLATFORM_IMAGE_ENABLE_FORMAT_OPTIONS === "true";
}

function getVideoPlatformFormatOptions(): {
  upstreamQuality: string;
  outputFormat: string;
  outputCompression: number | null;
  requestFields: {
    quality?: string;
    output_format?: string;
    output_compression?: number;
  };
} {
  if (!isVideoPlatformFormatOptionsEnabled()) {
    return {
      upstreamQuality: "omitted",
      outputFormat: "omitted",
      outputCompression: null,
      requestFields: {},
    };
  }

  const quality = getVideoPlatformQuality();
  const outputFormat = getVideoPlatformOutputFormat();
  const requestFields: {
    quality?: string;
    output_format?: string;
    output_compression?: number;
  } = {
    quality,
    output_format: outputFormat,
  };

  if (outputFormat) {
    requestFields.output_compression = getVideoPlatformOutputCompression();
  }

  return {
    upstreamQuality: quality,
    outputFormat,
    outputCompression: requestFields.output_compression ?? null,
    requestFields,
  };
}

function getVideoPlatformRequestTimeoutMs(): number {
  const parsed = Number(process.env.VIDEO_PLATFORM_IMAGE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_VIDEO_PLATFORM_IMAGE_REQUEST_TIMEOUT_MS;
}

export function getVideoPlatformImageMaxPollMs(): number {
  const parsed = Number(process.env.VIDEO_PLATFORM_IMAGE_MAX_POLL_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 15 * 60 * 1000;
}

function getVideoPlatformImageOssPrefix(): string {
  const rawPrefix = process.env.VIDEO_PLATFORM_IMAGE_OSS_PREFIX || DEFAULT_VIDEO_PLATFORM_IMAGE_OSS_PREFIX;
  const safeSegments = rawPrefix
    .split("/")
    .map(segment => segment.trim().replace(/[^a-zA-Z0-9._-]/g, "-"))
    .filter(Boolean);

  return safeSegments.length > 0 ? safeSegments.join("/") : DEFAULT_VIDEO_PLATFORM_IMAGE_OSS_PREFIX;
}

export function getVideoPlatformImageSize(
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION,
  aspectRatio: ImageAspectRatio | string = "auto"
): string | null {
  const normalizedAspectRatio = aspectRatio === "auto" ? "auto" : String(aspectRatio);
  const sizeMap: Record<ImageResolution, Record<string, string>> = {
    "1k": {
      auto: "1024x1024",
      "1:1": "1024x1024",
      "16:9": "1344x768",
      "9:16": "768x1344",
      "4:3": "1152x864",
      "3:4": "864x1152",
    },
    "2k": {
      auto: "2048x1360",
      "1:1": "2048x2048",
      "16:9": "2048x1152",
      "9:16": "1152x2048",
      "4:3": "2048x1536",
      "3:4": "1536x2048",
    },
    "4k": {
      auto: "3840x2160",
      "1:1": "2048x2048",
      "16:9": "3840x2160",
      "9:16": "2160x3840",
      "4:3": "3072x2304",
      "3:4": "2304x3072",
    },
  };

  return sizeMap[resolution]?.[normalizedAspectRatio] || sizeMap[resolution]?.auto || null;
}

function getNestedValue(data: unknown, path: Array<string | number>): unknown {
  let current = data;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }

    if (current && typeof current === "object" && typeof segment === "string") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function getStringAt(data: unknown, path: Array<string | number>): string | null {
  const value = getNestedValue(data, path);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractImageUrl(data: unknown): string | null {
  const paths: Array<Array<string | number>> = [
    ["url"],
    ["image_url"],
    ["imageUrl"],
    ["result_url"],
    ["data", "url"],
    ["data", "image_url"],
    ["data", 0, "url"],
    ["data", 0, "image_url"],
    ["output", "url"],
    ["output", "image_url"],
  ];

  for (const path of paths) {
    const value = getStringAt(data, path);
    if (value) return value;
  }

  return null;
}

export function extractTaskId(data: unknown): string | null {
  const paths: Array<Array<string | number>> = [
    ["id"],
    ["task_id"],
    ["taskId"],
    ["data", "id"],
    ["data", "task_id"],
    ["data", "taskId"],
  ];

  for (const path of paths) {
    const value = getStringAt(data, path);
    if (value) return value;
  }

  return null;
}

function extractB64Json(data: unknown): string | null {
  const paths: Array<Array<string | number>> = [
    ["b64_json"],
    ["data", "b64_json"],
    ["data", 0, "b64_json"],
    ["output", "b64_json"],
  ];

  for (const path of paths) {
    const value = getStringAt(data, path);
    if (value) return value;
  }

  return null;
}

function extractStatus(data: unknown): { status: VideoPlatformTaskStatus; rawStatus: string | null } {
  const rawStatus = [
    getStringAt(data, ["status"]),
    getStringAt(data, ["state"]),
    getStringAt(data, ["data", "status"]),
    getStringAt(data, ["data", "state"]),
    getStringAt(data, ["output", "status"]),
    getStringAt(data, ["output", "state"]),
  ].find(Boolean) || null;

  const normalized = rawStatus?.toLowerCase();
  if (!normalized) return { status: "processing", rawStatus };

  if (["completed", "complete", "success", "succeeded", "done", "finished"].includes(normalized)) {
    return { status: "completed", rawStatus };
  }

  if (["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(normalized)) {
    return { status: "failed", rawStatus };
  }

  return { status: "processing", rawStatus };
}

function extractErrorMessage(data: unknown, fallback: string): string {
  const candidates = [
    getStringAt(data, ["error", "message"]),
    getStringAt(data, ["error"]),
    getStringAt(data, ["message"]),
    getStringAt(data, ["data", "error", "message"]),
    getStringAt(data, ["data", "error"]),
    getStringAt(data, ["data", "message"]),
  ];

  return candidates.find(Boolean) || fallback;
}

function isRetryableVideoPlatformError(statusCode: number | undefined, error: string | undefined): boolean {
  if (statusCode && [429, 500, 502, 503, 504, 524].includes(statusCode)) {
    return true;
  }

  const message = (error || "").toLowerCase();
  if (!message) return false;

  if (
    message.includes("tool choice") &&
    message.includes("image_generation") &&
    message.includes("tools")
  ) {
    return true;
  }

  return [
    "timeout",
    "timed out",
    "overloaded",
    "cpu overloaded",
    "rate limit",
    "temporarily unavailable",
    "busy",
    "capacity",
    "fetch failed",
    "network",
    "socket",
    "econnreset",
    "upstream",
    "超时",
  ].some(keyword => message.includes(keyword));
}

function detectImageType(buffer: Buffer): { ext: "png" | "jpg" | "webp" | "gif"; contentType: string } | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return { ext: "gif", contentType: "image/gif" };
  }

  return null;
}

function isSupportedReferenceImageContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  return ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/octet-stream"].includes(normalized);
}

function parseDataUrlImage(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const buffer = Buffer.from(match[2], "base64");
  const detected = detectImageType(buffer);
  if (!detected) return null;

  return {
    buffer,
    contentType: detected.contentType || match[1],
    ext: detected.ext,
  };
}

async function fetchVideoPlatformImage(url: string, init: RequestInit): Promise<Response> {
  const timeoutMs = getVideoPlatformRequestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`视频平台图片服务请求超时 (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadGeneratedImage(url: string): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const dataUrlImage = parseDataUrlImage(url);
  if (dataUrlImage) return dataUrlImage;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`生成图片下载失败 (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("生成图片超过 80MB 限制");
  }

  const buffer = Buffer.from(arrayBuffer);
  const detected = detectImageType(buffer);
  const contentType = response.headers.get("content-type") || detected?.contentType || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/") && !detected) {
    throw new Error("生成图片不是有效图片");
  }

  return {
    buffer,
    contentType: detected?.contentType || contentType,
    ext: detected?.ext || "jpg",
  };
}

async function downloadReferenceImage(url: string): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const response = await fetchImageReferenceUrl(url, {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
  });
  if (!response.ok) {
    throw new VideoPlatformReferenceImageError(`参考图下载失败 (${response.status})`, response.status);
  }

  const headerContentType = response.headers.get("content-type");
  if (!isSupportedReferenceImageContentType(headerContentType)) {
    throw new VideoPlatformReferenceImageError(`参考图 content-type 不支持: ${headerContentType || "unknown"}`, response.status);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new VideoPlatformReferenceImageError("参考图超过 80MB 限制", response.status);
  }

  const buffer = Buffer.from(arrayBuffer);
  const detected = detectImageType(buffer);
  if (!detected) {
    throw new VideoPlatformReferenceImageError("参考图不是有效 PNG/JPEG/WebP/GIF 图片", response.status);
  }

  return detected.ext === "jpg"
    ? { buffer, contentType: "image/jpeg", ext: "jpg" }
    : { buffer, contentType: detected.contentType, ext: detected.ext };
}

async function uploadVideoPlatformImageFromUrl(url: string, model: string): Promise<string> {
  const image = await downloadGeneratedImage(url);
  const objectPath = generateMediaPath(
    "images",
    getVideoPlatformImageOssPrefix(),
    `${model}-${Date.now()}.${image.ext}`
  );

  return uploadImageBuffer(image.buffer, objectPath, image.contentType);
}

async function uploadVideoPlatformImageFromBase64(b64Json: string, model: string): Promise<string> {
  const buffer = Buffer.from(b64Json, "base64");
  if (buffer.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("生成图片超过 80MB 限制");
  }

  const detected = detectImageType(buffer);
  if (!detected) {
    throw new Error("生成图片不是有效图片");
  }

  const objectPath = generateMediaPath(
    "images",
    getVideoPlatformImageOssPrefix(),
    `${model}-${Date.now()}.${detected.ext}`
  );

  return uploadImageBuffer(buffer, objectPath, detected.contentType);
}

function getBaseResultMetadata(
  resolution: ImageResolution,
  aspectRatio: ImageAspectRatio | string,
  hasUrls: boolean,
  referenceCount: number,
  endpoint: VideoPlatformImageResult["endpoint"],
  referenceCountUsed = referenceCount,
  referenceReductionReason: string | null = null
): Pick<
  VideoPlatformImageResult,
  | "requestedSize"
  | "upstreamSize"
  | "upstreamQuality"
  | "outputFormat"
  | "outputCompression"
  | "requestTimeoutMs"
  | "hasUrls"
  | "referenceCount"
  | "referenceCountReceived"
  | "referenceCountUsed"
  | "referenceReductionReason"
  | "endpoint"
> {
  const size = getVideoPlatformImageSize(resolution, aspectRatio);
  const formatOptions = getVideoPlatformFormatOptions();
  return {
    requestedSize: size || "unsupported",
    upstreamSize: size || "unsupported",
    upstreamQuality: formatOptions.upstreamQuality,
    outputFormat: formatOptions.outputFormat,
    outputCompression: formatOptions.outputCompression,
    requestTimeoutMs: getVideoPlatformRequestTimeoutMs(),
    hasUrls,
    referenceCount,
    referenceCountReceived: referenceCount,
    referenceCountUsed,
    referenceReductionReason,
    endpoint,
  };
}

function getRequestConfig() {
  const baseUrl = getVideoPlatformBaseUrl();
  const apiKey = getVideoPlatformApiKey();
  const model = getVideoPlatformModel();

  if (!baseUrl) {
    throw new Error("VIDEO_PLATFORM_IMAGE_BASE_URL 未配置");
  }

  if (!apiKey) {
    throw new Error("VIDEO_PLATFORM_IMAGE_API_KEY 未配置");
  }

  return { baseUrl, apiKey, model };
}

export async function submitVideoPlatformImage(
  params: VideoPlatformImageParams
): Promise<VideoPlatformImageResult> {
  const resolution = params.resolution || DEFAULT_IMAGE_RESOLUTION;
  const aspectRatio = params.aspectRatio || "auto";
  const urls = (params.sourceImageUrls || []).filter(Boolean);
  const hasReferenceImage = urls.length > 0;
  const endpoint: VideoPlatformImageResult["endpoint"] = hasReferenceImage
    ? "/v1/images/edits"
    : "/v1/images/generations";
  const referenceCountUsed = hasReferenceImage ? 1 : 0;
  const referenceReductionReason = urls.length > 1 ? "aixoras_edits_single_image_field" : null;
  const baseMetadata = getBaseResultMetadata(
    resolution,
    aspectRatio,
    hasReferenceImage,
    urls.length,
    endpoint,
    referenceCountUsed,
    referenceReductionReason
  );
  const size = getVideoPlatformImageSize(resolution, aspectRatio);

  if (!size) {
    return {
      success: false,
      status: "failed",
      error: "无效的图片画质档位，请使用 1K / 2K / 4K",
      ...baseMetadata,
      upstreamCallCount: 0,
      upstreamResponseType: "failed",
    };
  }

  try {
    const { baseUrl, apiKey, model } = getRequestConfig();
    const prompt = params.prompt.trim();
    const validatedUrls = urls.map(url => validateImageReferenceUrl(url).toString());
    const formatOptions = getVideoPlatformFormatOptions();
    const requestBodyKeys = ["model", "prompt", "size", ...Object.keys(formatOptions.requestFields)];

    console.log("[Video Platform Image] Submit:", {
      endpoint,
      baseUrlHost: new URL(baseUrl).hostname,
      model,
      size,
      upstreamQuality: formatOptions.upstreamQuality,
      outputFormat: formatOptions.outputFormat,
      outputCompression: formatOptions.outputCompression,
      hasUrls: hasReferenceImage,
      referenceCount: urls.length,
      referenceCountReceived: urls.length,
      referenceCountUsed,
      referenceReductionReason,
      promptLength: prompt.length,
      requestBodyKeys: hasReferenceImage ? [...requestBodyKeys, "image"] : requestBodyKeys,
    });

    let response: Response;
    if (hasReferenceImage) {
      const referenceImage = await downloadReferenceImage(validatedUrls[0]);
      const formData = new FormData();
      formData.append("model", model);
      formData.append("prompt", prompt);
      formData.append("size", size);
      for (const [key, value] of Object.entries(formatOptions.requestFields)) {
        formData.append(key, String(value));
      }
      formData.append(
        "image",
        new Blob([new Uint8Array(referenceImage.buffer)], { type: referenceImage.contentType }),
        `reference.${referenceImage.ext}`
      );

      response = await fetchVideoPlatformImage(getVideoPlatformApiUrl("/images/edits"), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
      });
    } else {
      const requestBody: {
        model: string;
        prompt: string;
        size: string;
        quality?: string;
        output_format?: string;
        output_compression?: number;
      } = {
        model,
        prompt,
        size,
      };
      Object.assign(requestBody, formatOptions.requestFields);

      response = await fetchVideoPlatformImage(getVideoPlatformApiUrl("/images/generations"), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage = extractErrorMessage(data, `视频平台图片服务错误 (${response.status})`);
      return {
        success: false,
        status: "failed",
        error: errorMessage,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "failed",
        statusCode: response.status,
        upstreamStatus: response.status,
        retryable: isRetryableVideoPlatformError(response.status, errorMessage),
      };
    }

    const upstreamImageUrl = extractImageUrl(data);
    if (upstreamImageUrl) {
      const imageUrl = await uploadVideoPlatformImageFromUrl(upstreamImageUrl, model);
      return {
        success: true,
        status: "completed",
        imageUrl,
        upstreamImageUrl,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "direct_image_url",
      };
    }

    const b64Json = extractB64Json(data);
    if (b64Json) {
      const imageUrl = await uploadVideoPlatformImageFromBase64(b64Json, model);
      return {
        success: true,
        status: "completed",
        imageUrl,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "b64_json",
      };
    }

    const platformTaskId = extractTaskId(data);
    if (platformTaskId) {
      return {
        success: false,
        status: "processing",
        platformTaskId,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "task_id",
      };
    }

    return {
      success: false,
      status: "failed",
      error: "视频平台图片任务创建成功但未返回 imageUrl 或 taskId",
      ...baseMetadata,
      upstreamCallCount: 1,
      upstreamResponseType: "unknown",
    };
  } catch (error) {
    console.error("[Video Platform Image] Submit error:", error);
    const errorMessage = error instanceof Error ? error.message : "视频平台图片服务请求失败";
    const statusCode = error instanceof VideoPlatformReferenceImageError || error instanceof ImageReferenceUrlError
      ? error.statusCode
      : undefined;
    return {
      success: false,
      status: "failed",
      error: errorMessage,
      ...baseMetadata,
      upstreamCallCount: error instanceof VideoPlatformReferenceImageError ? 0 : 1,
      upstreamResponseType: "failed",
      statusCode,
      upstreamStatus: statusCode,
      retryable: isRetryableVideoPlatformError(statusCode, errorMessage),
    };
  }
}

export async function queryVideoPlatformImageTask(
  taskId: string,
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION,
  aspectRatio: ImageAspectRatio | string = "auto"
): Promise<VideoPlatformImageResult> {
  const baseMetadata = getBaseResultMetadata(resolution, aspectRatio, false, 0, "/v1/images/{taskId}");

  try {
    const { baseUrl, apiKey, model } = getRequestConfig();
    console.log("[Video Platform Image] Query:", {
      endpoint: "/v1/images/{taskId}",
      baseUrlHost: new URL(baseUrl).hostname,
      model,
      taskId,
    });

    const response = await fetchVideoPlatformImage(getVideoPlatformApiUrl(`/images/${encodeURIComponent(taskId)}`), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage = extractErrorMessage(data, `视频平台图片任务查询错误 (${response.status})`);
      return {
        success: false,
        status: "failed",
        platformTaskId: taskId,
        error: errorMessage,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "failed",
        statusCode: response.status,
        upstreamStatus: response.status,
        retryable: isRetryableVideoPlatformError(response.status, errorMessage),
      };
    }

    const upstreamImageUrl = extractImageUrl(data);
    if (upstreamImageUrl) {
      const imageUrl = await uploadVideoPlatformImageFromUrl(upstreamImageUrl, model);
      return {
        success: true,
        status: "completed",
        imageUrl,
        upstreamImageUrl,
        platformTaskId: taskId,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "direct_image_url",
      };
    }

    const b64Json = extractB64Json(data);
    if (b64Json) {
      const imageUrl = await uploadVideoPlatformImageFromBase64(b64Json, model);
      return {
        success: true,
        status: "completed",
        imageUrl,
        platformTaskId: taskId,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "b64_json",
      };
    }

    const statusInfo = extractStatus(data);
    if (statusInfo.status === "failed") {
      return {
        success: false,
        status: "failed",
        platformTaskId: taskId,
        error: extractErrorMessage(data, "视频平台图片任务失败"),
        rawStatus: statusInfo.rawStatus,
        ...baseMetadata,
        upstreamCallCount: 1,
        upstreamResponseType: "failed",
      };
    }

    return {
      success: false,
      status: "processing",
      platformTaskId: taskId,
      rawStatus: statusInfo.rawStatus,
      ...baseMetadata,
      upstreamCallCount: 1,
      upstreamResponseType: "processing",
    };
  } catch (error) {
    console.error("[Video Platform Image] Query error:", error);
    const errorMessage = error instanceof Error ? error.message : "视频平台图片任务查询失败";
    return {
      success: false,
      status: "failed",
      platformTaskId: taskId,
      error: errorMessage,
      ...baseMetadata,
      upstreamCallCount: 1,
      upstreamResponseType: "failed",
      retryable: isRetryableVideoPlatformError(undefined, errorMessage),
    };
  }
}
