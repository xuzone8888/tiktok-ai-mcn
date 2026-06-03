import type { Json } from "@/types/database";
import type { UnifiedVideoStatus, VideoAspectRatio } from "./types";

export interface PlatformVideoTask {
  taskId: string;
  status: UnifiedVideoStatus;
  progress?: number;
  videoUrl?: string;
  errorMessage?: string;
  raw?: Json;
}

interface PlatformRequestOptions {
  path: string;
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
  timeoutMs?: number;
}

export function getPlatformBaseUrl(): string {
  return (
    process.env.VIDEO_PLATFORM_BASE_URL ||
    process.env.VIDEO_PLATFORM_API_BASE ||
    process.env.VIDEO_PLATFORM_API_ENDPOINT ||
    "https://api.hellobabygo.com"
  ).replace(/\/+$/, "");
}

export function getPlatformApiKey(): string {
  return (
    process.env.VIDEO_PLATFORM_API_KEY ||
    process.env.SORA2_API_KEY ||
    process.env.WUYINKEJI_API_KEY ||
    ""
  );
}

export function getPlatformContentUrl(taskId: string): string {
  return `${getPlatformBaseUrl()}/v1/videos/${encodeURIComponent(taskId)}/content`;
}

export function getPlatformAuthHeaders(): Record<string, string> {
  const key = getPlatformApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function buildPlatformUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${getPlatformBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
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

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeStatus(value: unknown): UnifiedVideoStatus {
  const status = String(value || "").toLowerCase();
  if (["completed", "success", "succeeded", "done", "finish", "finished"].includes(status)) {
    return "completed";
  }
  if (["failed", "error", "errored", "cancelled", "canceled", "rejected"].includes(status)) {
    return "failed";
  }
  return "processing";
}

function extractVideoUrl(payload: Record<string, any>): string | undefined {
  const direct = pickString(
    payload.video_url,
    payload.videoUrl,
    payload.result_url,
    payload.resultUrl,
    payload.url,
    payload.content_url,
    payload.output?.video_url,
    payload.output?.url,
    payload.data?.video_url,
    payload.data?.url,
    payload.data?.result_url
  );
  if (direct) return direct;

  const result = payload.result || payload.results || payload.data?.result || payload.data?.results || payload.output?.results;
  if (Array.isArray(result)) {
    for (const item of result) {
      if (typeof item === "string" && item.startsWith("http")) return item;
      const record = asRecord(item);
      const url = pickString(record.url, record.video_url, record.result_url);
      if (url) return url;
    }
  }

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const record = asRecord(item);
      const url = pickString(record.url, record.video_url, record.result_url);
      if (url) return url;
    }
  }

  return undefined;
}

export function normalizePlatformVideoTask(data: unknown, fallbackTaskId?: string): PlatformVideoTask {
  const root = asRecord(data);
  const nested = asRecord(root.data);
  const output = asRecord(root.output);
  const detail = asRecord(root.detail);
  const pendingInfo = asRecord(detail.pending_info);
  const payload = Object.keys(nested).length ? { ...root, ...nested } : root;

  const taskId = pickString(
    payload.id,
    payload.task_id,
    payload.taskId,
    output.task_id,
    root.id,
    fallbackTaskId
  );

  const status = normalizeStatus(
    payload.status ||
    output.task_status ||
    detail.status ||
    payload.state ||
    payload.task_status
  );

  let progress = pickNumber(payload.progress, payload.progress_pct, pendingInfo.progress_pct);
  if (progress !== undefined && progress > 0 && progress <= 1) progress = Math.round(progress * 100);
  if (status === "completed") progress = 100;
  if (status === "failed" && progress === undefined) progress = 0;

  const errorMessage = pickString(
    payload.error?.message,
    payload.error_message,
    payload.fail_reason,
    payload.failure_reason,
    payload.message,
    output.message,
    pendingInfo.failure_reason
  );

  return {
    taskId: taskId || fallbackTaskId || "",
    status,
    progress,
    videoUrl: extractVideoUrl(root),
    errorMessage: status === "failed" ? errorMessage || "视频生成失败" : undefined,
    raw: root as Json,
  };
}

export async function platformRequest(options: PlatformRequestOptions): Promise<unknown> {
  const key = getPlatformApiKey();
  if (!key) throw new Error("VIDEO_PLATFORM_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120_000);

  try {
    const response = await fetch(buildPlatformUrl(options.path), {
      method: options.method || (options.body ? "POST" : "GET"),
      cache: "no-store",
      headers: {
        ...getPlatformAuthHeaders(),
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
        if (!response.ok) throw new Error(`平台响应非 JSON (HTTP ${response.status})`);
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const record = asRecord(data);
      const message = pickString(record.error?.message, record.message, record.msg, record.detail);
      throw new Error(message || `平台请求失败 (HTTP ${response.status})`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitPlatformVideo(
  body: Record<string, unknown>,
  paths: string[] = ["/v1/videos?async=true"]
): Promise<PlatformVideoTask> {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      const data = await platformRequest({ path, body, method: "POST" });
      const task = normalizePlatformVideoTask(data);
      if (task.taskId) return task;
      throw new Error("平台未返回任务 ID");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("平台提交失败");
}

async function fetchReferenceBlob(url: string, index: number): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`参考图下载失败 (HTTP ${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";

  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    filename: `reference-${index + 1}.${extension}`,
  };
}

export async function submitPlatformVideoMultipart(params: {
  fields: Record<string, string | number | boolean>;
  imageUrls: string[];
  imageFieldName?: string;
  paths?: string[];
}): Promise<PlatformVideoTask> {
  const key = getPlatformApiKey();
  if (!key) throw new Error("VIDEO_PLATFORM_API_KEY is not configured");

  const paths = params.paths || ["/v1/videos?async=true"];
  const imageFieldName = params.imageFieldName || "input_reference[]";
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries(params.fields)) {
        form.append(key, String(value));
      }

      for (let index = 0; index < params.imageUrls.length; index += 1) {
        const file = await fetchReferenceBlob(params.imageUrls[index], index);
        form.append(imageFieldName, file.blob, file.filename);
      }

      const response = await fetch(buildPlatformUrl(path), {
        method: "POST",
        cache: "no-store",
        headers: {
          ...getPlatformAuthHeaders(),
          Accept: "application/json",
        },
        body: form,
      });

      const text = await response.text();
      let data: unknown = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text);
        } catch {
          if (!response.ok) throw new Error(`平台响应非 JSON (HTTP ${response.status})`);
          data = { raw: text };
        }
      }

      if (!response.ok) {
        const record = asRecord(data);
        const message = pickString(record.error?.message, record.message, record.msg, record.detail);
        throw new Error(message || `平台请求失败 (HTTP ${response.status})`);
      }

      const task = normalizePlatformVideoTask(data);
      if (task.taskId) return task;
      throw new Error("平台未返回任务 ID");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("平台提交失败");
}

export async function queryPlatformVideoTask(taskId: string): Promise<PlatformVideoTask> {
  const paths = [
    `/v1/videos/${encodeURIComponent(taskId)}`,
    `/api/v1/videos/${encodeURIComponent(taskId)}`,
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    `/v1/videos?id=${encodeURIComponent(taskId)}`,
  ];
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      const data = await platformRequest({ path, method: "GET", timeoutMs: 45_000 });
      const task = normalizePlatformVideoTask(data, taskId);
      if (task.taskId) return task;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("平台任务查询失败");
}

export function toPlatformSize(aspectRatio: VideoAspectRatio, resolution: "720p" | "1080p" = "720p"): string {
  if (resolution === "1080p") {
    return aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
  }
  return aspectRatio === "16:9" ? "1280x720" : "720x1280";
}

export function toModelAspectToken(aspectRatio: VideoAspectRatio): "16x9" | "9x16" {
  return aspectRatio === "16:9" ? "16x9" : "9x16";
}
