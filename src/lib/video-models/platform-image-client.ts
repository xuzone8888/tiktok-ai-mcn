import { generateMediaPath, uploadImageBuffer, type StorageFolder } from "@/lib/oss";
import { isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";

import { getPlatformApiKey, getPlatformBaseUrl } from "./platform-client";

type PlatformImageStatus = "processing" | "completed" | "failed";
type PlatformImagePurpose = "character-hero" | "character-reference" | "generic";
type PlatformImageQuality = "low" | "medium" | "high" | "auto" | "standard" | "hd";
type PlatformImageOutputFormat = "png" | "jpeg" | "webp";

interface PlatformImageTask {
  taskId?: string;
  status: PlatformImageStatus;
  progress?: number;
  imageUrl?: string;
  imageBase64?: string;
  errorMessage?: string;
  raw?: unknown;
}

interface SubmitPlatformImageGenerationInput {
  model: string;
  prompt: string;
  size: string;
  urls?: string[];
  responseFormat?: "url" | "b64_json";
  quality?: PlatformImageQuality;
  outputFormat?: PlatformImageOutputFormat;
  outputCompression?: number;
  async?: boolean;
  timeoutMs?: number;
}

interface GenerateGptImage2Input {
  prompt: string;
  sourceImageUrls?: string[];
  size?: string;
  aspectRatio?: "3:4" | "4:3" | "16:9" | "9:16" | "1:1";
  quality?: PlatformImageQuality;
  outputFormat?: PlatformImageOutputFormat;
  outputCompression?: number;
  purpose?: PlatformImagePurpose;
  userId?: string;
  async?: boolean;
  maxPollMs?: number;
  pollIntervalMs?: number;
}

interface GenerateGptImage2Result {
  success: boolean;
  imageUrl?: string;
  taskId?: string;
  usedSize?: string;
  error?: string;
  raw?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getImagePlatformBaseUrl(): string {
  return (
    process.env.VIDEO_PLATFORM_IMAGE_BASE_URL ||
    process.env.IMAGE_PLATFORM_BASE_URL ||
    getPlatformBaseUrl()
  ).replace(/\/+$/, "");
}

function getImagePlatformApiKey(): string {
  return (
    process.env.VIDEO_PLATFORM_IMAGE_API_KEY ||
    process.env.IMAGE_PLATFORM_API_KEY ||
    getPlatformApiKey()
  );
}

function getImagePlatformAuthHeaders(): Record<string, string> {
  const key = getImagePlatformApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function buildImagePlatformUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${getImagePlatformBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function normalizeImageStatus(value: unknown, hasImage: boolean): PlatformImageStatus {
  const status = String(value || "").toLowerCase();
  if (["completed", "success", "succeeded", "done", "finish", "finished"].includes(status)) {
    return "completed";
  }
  if (["failed", "error", "errored", "cancelled", "canceled", "rejected"].includes(status)) {
    return "failed";
  }
  return hasImage ? "completed" : "processing";
}

function extractFromArray(
  value: unknown,
  extractor: (record: Record<string, unknown>) => string | undefined
): string | undefined {
  if (!Array.isArray(value)) return undefined;

  for (const item of value) {
    if (typeof item === "string" && item.startsWith("http")) return item;
    const record = asRecord(item);
    const extracted = extractor(record);
    if (extracted) return extracted;
  }

  return undefined;
}

function extractImageUrl(root: Record<string, unknown>): string | undefined {
  const data = root.data;
  const output = asRecord(root.output);
  const result = root.result ?? root.results ?? output.result ?? output.results;

  const direct = pickString(
    root.url,
    root.image_url,
    root.imageUrl,
    root.result_url,
    root.resultUrl,
    output.url,
    output.image_url,
    output.result_url,
    asRecord(data).url,
    asRecord(data).image_url,
    asRecord(data).result_url
  );
  if (direct) return direct;

  const fromDataArray = extractFromArray(data, (record) =>
    pickString(record.url, record.image_url, record.imageUrl, record.result_url, record.resultUrl)
  );
  if (fromDataArray) return fromDataArray;

  const fromResultArray = extractFromArray(result, (record) =>
    pickString(record.url, record.image_url, record.imageUrl, record.result_url, record.resultUrl)
  );
  if (fromResultArray) return fromResultArray;

  const images = root.images ?? output.images ?? asRecord(data).images;
  return extractFromArray(images, (record) =>
    pickString(record.url, record.image_url, record.imageUrl, record.result_url, record.resultUrl)
  );
}

function extractImageBase64(root: Record<string, unknown>): string | undefined {
  const data = root.data;
  const output = asRecord(root.output);

  const direct = pickString(
    root.b64_json,
    root.image_base64,
    root.base64,
    output.b64_json,
    output.image_base64,
    asRecord(data).b64_json,
    asRecord(data).image_base64
  );
  if (direct) return direct;

  return extractFromArray(data, (record) =>
    pickString(record.b64_json, record.image_base64, record.base64)
  );
}

function normalizePlatformImageTask(data: unknown, fallbackTaskId?: string): PlatformImageTask {
  const root = asRecord(data);
  const dataRecord = asRecord(root.data);
  const output = asRecord(root.output);
  const payload = Object.keys(dataRecord).length && !Array.isArray(root.data)
    ? { ...root, ...dataRecord }
    : root;

  const imageUrl = extractImageUrl(root);
  const imageBase64 = extractImageBase64(root);
  const status = normalizeImageStatus(
    payload.status ?? payload.state ?? payload.task_status ?? output.task_status,
    !!(imageUrl || imageBase64)
  );

  let progress = pickNumber(payload.progress, payload.progress_pct, output.progress);
  if (progress !== undefined && progress > 0 && progress <= 1) {
    progress = Math.round(progress * 100);
  }
  if (status === "completed") progress = 100;
  if (status === "failed" && progress === undefined) progress = 0;

  return {
    taskId: pickString(payload.id, payload.task_id, payload.taskId, output.task_id, fallbackTaskId),
    status,
    progress,
    imageUrl,
    imageBase64,
    errorMessage: status === "failed"
      ? pickString(
        asRecord(payload.error).message,
        payload.error_message,
        payload.fail_reason,
        payload.failure_reason,
        payload.message,
        output.message
      ) || "图片生成失败"
      : undefined,
    raw: data,
  };
}

function shouldTryFallbackSize(error: Error): boolean {
  return /(size|resolution|width|height|尺寸|分辨率|unsupported|invalid)/i.test(error.message);
}

function isTransientNetworkError(error: Error): boolean {
  return /(fetch failed|network|timeout|aborted|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCandidateSizes(aspectRatio: GenerateGptImage2Input["aspectRatio"]): string[] {
  switch (aspectRatio) {
    case "3:4":
    case "9:16":
      return ["1024x1536", "1024x1024"];
    case "4:3":
    case "16:9":
      return ["1536x1024", "1024x1024"];
    case "1:1":
    default:
      return ["1024x1024"];
  }
}

function getImageExtension(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function getOutputContentType(outputFormat?: PlatformImageOutputFormat): string {
  if (outputFormat === "png") return "image/png";
  if (outputFormat === "webp") return "image/webp";
  return "image/jpeg";
}

function getPurposeFolder(purpose: PlatformImagePurpose): { folder: StorageFolder; prefix: string } {
  if (purpose === "character-reference") {
    return { folder: "images", prefix: "character-reference" };
  }
  if (purpose === "character-hero") {
    return { folder: "images", prefix: "character-hero" };
  }
  return { folder: "images", prefix: "platform-image" };
}

async function fetchImageBufferOnce(
  url: string,
  headers?: Record<string, string>
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    throw new Error(`图片下载失败: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  if (contentType.includes("application/json")) {
    const text = Buffer.from(arrayBuffer).toString("utf8");
    const data = JSON.parse(text) as Record<string, unknown>;
    const nestedUrl = extractImageUrl(data);
    if (nestedUrl) return fetchImageBuffer(nestedUrl);
    throw new Error("图片内容接口未返回可下载图片");
  }

  return {
    buffer: Buffer.from(new Uint8Array(arrayBuffer)),
    contentType: contentType.split(";")[0] || "image/jpeg",
  };
}

async function fetchImageBuffer(
  url: string,
  headers?: Record<string, string>
): Promise<{ buffer: Buffer; contentType: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchImageBufferOnce(url, headers);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 3 || !isTransientNetworkError(lastError)) break;
      await sleep(1000 * attempt);
    }
  }

  throw lastError || new Error("图片下载失败");
}

async function persistImageResult(params: {
  taskId?: string;
  imageUrl?: string;
  imageBase64?: string;
  purpose: PlatformImagePurpose;
  userId?: string;
  outputFormat?: PlatformImageOutputFormat;
}): Promise<string> {
  if (params.imageUrl && isOSSPermanentUrl(params.imageUrl)) {
    return params.imageUrl;
  }

  const { folder, prefix } = getPurposeFolder(params.purpose);
  const userFolder = params.userId || prefix;

  if (params.imageBase64) {
    const dataUrlMatch = params.imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const contentType = dataUrlMatch?.[1] || getOutputContentType(params.outputFormat);
    const cleanBase64 = params.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const objectPath = generateMediaPath(
      folder,
      userFolder,
      `${prefix}-${Date.now()}.${getImageExtension(contentType)}`
    );
    return uploadImageBuffer(buffer, objectPath, contentType);
  }

  if (params.imageUrl) {
    const { buffer, contentType } = await fetchImageBuffer(params.imageUrl);
    const objectPath = generateMediaPath(
      folder,
      userFolder,
      `${prefix}-${Date.now()}.${getImageExtension(contentType)}`
    );
    return uploadImageBuffer(buffer, objectPath, contentType);
  }

  if (params.taskId) {
    const contentUrl = buildImagePlatformUrl(`/v1/images/${encodeURIComponent(params.taskId)}/content`);
    const { buffer, contentType } = await fetchImageBuffer(contentUrl, getImagePlatformAuthHeaders());
    const objectPath = generateMediaPath(
      folder,
      userFolder,
      `${prefix}-${params.taskId}.${getImageExtension(contentType)}`
    );
    return uploadImageBuffer(buffer, objectPath, contentType);
  }

  throw new Error("图片任务未返回可持久化结果");
}

async function platformImageRequest(options: {
  path: string;
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
  timeoutMs?: number;
}): Promise<unknown> {
  const key = getImagePlatformApiKey();
  if (!key) throw new Error("VIDEO_PLATFORM_IMAGE_API_KEY or VIDEO_PLATFORM_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 180_000);

  try {
    const response = await fetch(buildImagePlatformUrl(options.path), {
      method: options.method || (options.body ? "POST" : "GET"),
      cache: "no-store",
      headers: {
        ...getImagePlatformAuthHeaders(),
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!response.ok) throw new Error(`图片平台响应非 JSON (HTTP ${response.status})`);
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const record = asRecord(data);
      const error = asRecord(record.error);
      const message = pickString(error.message, record.message, record.msg, record.detail);
      throw new Error(message || `图片平台请求失败 (HTTP ${response.status})`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitPlatformImageGeneration(
  input: SubmitPlatformImageGenerationInput
): Promise<PlatformImageTask> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
  };

  if (input.responseFormat) body.response_format = input.responseFormat;
  if (input.quality) body.quality = input.quality;
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.outputCompression !== undefined) body.output_compression = input.outputCompression;

  const urls = (input.urls || [])
    .map((url) => url.trim())
    .filter((url) => url.startsWith("http://") || url.startsWith("https://"));

  if (urls.length > 0) body.urls = urls;

  const data = await platformImageRequest({
    path: input.async ? "/v1/images/generations?async=true" : "/v1/images/generations",
    method: "POST",
    body,
    timeoutMs: input.timeoutMs || 180_000,
  });

  const task = normalizePlatformImageTask(data);
  if (task.taskId || task.imageUrl || task.imageBase64) return task;
  throw new Error("平台图片接口未返回任务 ID 或图片结果");
}

export async function getPlatformImageTaskStatus(taskId: string): Promise<PlatformImageTask> {
  const paths = [
    `/v1/images/${encodeURIComponent(taskId)}`,
    `/api/v1/images/${encodeURIComponent(taskId)}`,
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    `/v1/images?id=${encodeURIComponent(taskId)}`,
  ];
  let lastError: Error | null = null;

  for (const path of paths) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const data = await platformImageRequest({ path, method: "GET", timeoutMs: 45_000 });
        const task = normalizePlatformImageTask(data, taskId);
        if (task.taskId || task.imageUrl || task.imageBase64) return task;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= 3 || !isTransientNetworkError(lastError)) break;
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError || new Error("平台图片任务查询失败");
}

export async function waitForPlatformImageResult(params: {
  taskId: string;
  pollIntervalMs?: number;
  maxPollMs?: number;
}): Promise<PlatformImageTask> {
  const pollIntervalMs = params.pollIntervalMs || 5_000;
  const maxPollMs = params.maxPollMs || 240_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= maxPollMs) {
    try {
      const task = await getPlatformImageTaskStatus(params.taskId);
      if (task.status === "completed" && (task.imageUrl || task.imageBase64)) return task;
      if (task.status === "failed") {
        throw new Error(task.errorMessage || "图片生成失败");
      }
    } catch (error) {
      const pollError = error instanceof Error ? error : new Error(String(error));
      if (!isTransientNetworkError(pollError)) throw pollError;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error("图片生成超时，请稍后重试");
}

export async function generateGptImage2(
  input: GenerateGptImage2Input
): Promise<GenerateGptImage2Result> {
  const model = process.env.VIDEO_PLATFORM_IMAGE_MODEL || "gpt-image-2";
  const fallbackSizes = getCandidateSizes(input.aspectRatio || "1:1");
  const sizes = input.size
    ? [input.size, ...fallbackSizes.filter((size) => size !== input.size)]
    : fallbackSizes;
  let lastError: Error | null = null;

  for (const size of sizes) {
    try {
      const submitted = await submitPlatformImageGeneration({
        model,
        prompt: input.prompt,
        urls: input.sourceImageUrls,
        size,
        quality: input.quality,
        outputFormat: input.outputFormat,
        outputCompression: input.outputCompression,
        async: input.async,
        timeoutMs: input.async ? 120_000 : Math.min(input.maxPollMs || 240_000, 300_000),
      });

      const completed = submitted.status === "completed" && (submitted.imageUrl || submitted.imageBase64)
        ? submitted
        : submitted.taskId
          ? await waitForPlatformImageResult({
            taskId: submitted.taskId,
            pollIntervalMs: input.pollIntervalMs,
            maxPollMs: input.maxPollMs,
          })
          : submitted;

      const imageUrl = await persistImageResult({
        taskId: completed.taskId || submitted.taskId,
        imageUrl: completed.imageUrl,
        imageBase64: completed.imageBase64,
        purpose: input.purpose || "generic",
        userId: input.userId,
        outputFormat: input.outputFormat,
      });

      return {
        success: true,
        imageUrl,
        taskId: completed.taskId || submitted.taskId,
        usedSize: size,
        raw: completed.raw || submitted.raw,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!shouldTryFallbackSize(lastError)) break;
    }
  }

  return {
    success: false,
    error: lastError?.message || "GPTImage2 图片生成失败",
  };
}
