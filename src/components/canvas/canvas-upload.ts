"use client";

import { isOssObjectKey } from "@/lib/canvas/schema";
import {
  CANVAS_UPLOAD_MAX_CONCURRENCY,
  type CanvasUploadKind,
  type ValidCanvasUploadFile,
  validateCanvasUploadBatchMetadata,
} from "@/lib/canvas/upload-contract";

export type CanvasMediaKind = CanvasUploadKind;

export interface CanvasUploadResult {
  kind: CanvasMediaKind;
  ossKey: string;
}

export interface CanvasUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface CanvasPreparedUpload {
  reservationId: string;
  reservationExpiresAt: string;
  kind: CanvasMediaKind;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
  fields: Record<string, string>;
}

export interface CanvasUploadBatchItem {
  file: File;
  metadata: ValidCanvasUploadFile;
  prepared: CanvasPreparedUpload;
  index: number;
}

interface CanvasUploadCredentialsPayload {
  success?: boolean;
  data?: {
    uploads?: unknown[];
    reservationId?: unknown;
    objectKey?: unknown;
    status?: unknown;
  };
  error?: string | { message?: string };
}

export class CanvasUploadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CanvasUploadError";
    this.code = code;
  }
}

function abortError(): DOMException {
  return new DOMException("上传已取消", "AbortError");
}

function apiErrorMessage(
  payload: CanvasUploadCredentialsPayload | null,
  status: number
): string {
  const error = payload?.error;
  if (typeof error === "string" && error.trim()) return error;
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "当前账号暂未开放超级画布";
  if (status === 409) return "上传预留已冲突或过期，请重新选择文件";
  if (status === 422) return "文件内容未通过安全校验";
  if (status === 429) return "上传配额已用完，请稍后重试或清理素材";
  if (status === 413) return "上传请求过大";
  if (status >= 500) return "上传服务暂时不可用，请稍后重试";
  return `无法获取上传凭证（HTTP ${status}）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePreparedUpload(
  value: unknown,
  expected: ValidCanvasUploadFile,
  expectedId: string
): CanvasPreparedUpload {
  if (!isRecord(value) || !isRecord(value.fields)) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回了无效凭证");
  }
  const kind = value.kind;
  const reservationId = value.reservationId;
  const reservationExpiresAt = value.reservationExpiresAt;
  const objectKey = value.objectKey;
  const uploadUrl = value.uploadUrl;
  const expiresIn = value.expiresIn;
  if (
    kind !== expected.kind ||
    reservationId !== expectedId ||
    typeof reservationExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(reservationExpiresAt)) ||
    Date.parse(reservationExpiresAt) <= Date.now() ||
    !isOssObjectKey(objectKey) ||
    typeof uploadUrl !== "string" ||
    !/^https:\/\//i.test(uploadUrl) ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回了无效凭证");
  }
  const keySegments = objectKey.split("/");
  if (
    keySegments.length !== 3 ||
    keySegments[0] !== (expected.kind === "image" ? "images" : "videos") ||
    keySegments[2] !== `${expectedId}.${expected.extension}`
  ) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回了无效凭证");
  }

  const requiredFields = [
    "key",
    "x-oss-content-type",
    "x-oss-forbid-overwrite",
    "success_action_status",
    "OSSAccessKeyId",
    "policy",
    "Signature",
  ];
  const fields: Record<string, string> = {};
  for (const [name, fieldValue] of Object.entries(value.fields)) {
    if (typeof fieldValue !== "string") {
      throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回了无效凭证");
    }
    fields[name] = fieldValue;
  }
  if (
    requiredFields.some((name) => !fields[name]) ||
    fields.key !== objectKey ||
    fields["x-oss-content-type"] !== expected.type ||
    fields["x-oss-forbid-overwrite"] !== "true" ||
    fields.success_action_status !== "204"
  ) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回了无效凭证");
  }

  return {
    reservationId: expectedId,
    reservationExpiresAt,
    kind: expected.kind,
    objectKey,
    uploadUrl,
    expiresIn,
    fields,
  };
}

export function validateCanvasUploadFiles(
  files: readonly File[]
): ValidCanvasUploadFile[] {
  return validateCanvasUploadBatchMetadata(
    files.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
    }))
  );
}

/** Fetches one short-lived, exact OSS POST policy per file in a single request. */
export async function prepareCanvasUploads(
  files: readonly File[],
  signal?: AbortSignal
): Promise<CanvasUploadBatchItem[]> {
  if (signal?.aborted) throw abortError();
  const metadata = validateCanvasUploadFiles(files);
  const requestedFiles = metadata.map(({ name, type, size }) => ({
    id: crypto.randomUUID(),
    name,
    type,
    size,
  }));

  let response: Response | null = null;
  let payload: CanvasUploadCredentialsPayload | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch("/api/canvas/uploads/credentials", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: requestedFiles }),
        signal,
      });
      payload = (await response.json().catch(() => null)) as
        | CanvasUploadCredentialsPayload
        | null;
      if (response.ok && payload?.success) break;
      if (response.status < 500 || attempt > 0) break;
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw abortError();
      }
      if (attempt === 0) continue;
      throw new CanvasUploadError(
        "CREDENTIAL_NETWORK_ERROR",
        "无法连接上传服务，请检查网络后重试"
      );
    }
  }
  if (!response || !response.ok || !payload?.success) {
    throw new CanvasUploadError(
      "CREDENTIAL_REQUEST_FAILED",
      apiErrorMessage(payload, response?.status ?? 0)
    );
  }
  const uploads = payload.data?.uploads;
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传服务返回的凭证数量不正确");
  }

  return files.map((file, index) => ({
    file,
    metadata: metadata[index],
    prepared: parsePreparedUpload(
      uploads[index],
      metadata[index],
      requestedFiles[index].id
    ),
    index,
  }));
}

function ossUploadError(status: number): CanvasUploadError {
  if (status === 400) {
    return new CanvasUploadError(
      "OSS_INVALID_REQUEST",
      "文件信息与上传凭证不一致，请重新拖入文件"
    );
  }
  if (status === 403) {
    return new CanvasUploadError(
      "OSS_SIGNATURE_REJECTED",
      "上传凭证已失效，请重新拖入文件"
    );
  }
  if (status === 413) {
    return new CanvasUploadError("OSS_FILE_TOO_LARGE", "文件超过允许大小");
  }
  if (status >= 500) {
    return new CanvasUploadError(
      "OSS_UNAVAILABLE",
      "存储服务暂时不可用，请稍后重试"
    );
  }
  return new CanvasUploadError(
    "OSS_UPLOAD_FAILED",
    status > 0 ? `文件上传失败（HTTP ${status}）` : "文件上传失败，请检查网络"
  );
}

function uploadPreparedCanvasFileToOss(
  item: CanvasUploadBatchItem,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: CanvasUploadProgress) => void;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => xhr.abort();

    xhr.open("POST", item.prepared.uploadUrl);
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : item.file.size;
      const loaded = Math.min(event.loaded, total);
      onProgress?.({
        loaded,
        total,
        percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => {
          onProgress?.({
            loaded: item.file.size,
            total: item.file.size,
            percent: 100,
          });
          resolve();
        });
        return;
      }
      settle(() => reject(ossUploadError(xhr.status)));
    };
    xhr.onerror = () => settle(() => reject(ossUploadError(xhr.status)));
    xhr.ontimeout = () =>
      settle(() =>
        reject(
          new CanvasUploadError(
            "OSS_UPLOAD_TIMEOUT",
            "文件上传超时，请检查网络后重试"
          )
        )
      );
    xhr.onabort = () => settle(() => reject(abortError()));

    const form = new FormData();
    for (const [name, value] of Object.entries(item.prepared.fields)) {
      form.append(name, value);
    }
    // OSS requires the file field to be the final multipart field.
    form.append("file", item.file, item.file.name);
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(form);
  });
}

async function finalizePreparedCanvasUpload(
  item: CanvasUploadBatchItem,
  signal?: AbortSignal
): Promise<void> {
  let response: Response | null = null;
  let payload: CanvasUploadCredentialsPayload | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch("/api/canvas/uploads/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: item.prepared.reservationId,
          objectKey: item.prepared.objectKey,
        }),
        signal,
      });
      payload = (await response.json().catch(() => null)) as
        | CanvasUploadCredentialsPayload
        | null;
      if (response.ok && payload?.success) break;
      if (response.status < 500 || attempt > 0) break;
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw abortError();
      }
      if (attempt === 0) continue;
      throw new CanvasUploadError(
        "FINALIZE_NETWORK_ERROR",
        "文件已上传，但暂时无法完成安全确认，请重试"
      );
    }
  }
  if (!response || !response.ok || !payload?.success) {
    throw new CanvasUploadError(
      "FINALIZE_REQUEST_FAILED",
      apiErrorMessage(payload, response?.status ?? 0)
    );
  }
  if (
    payload.data?.reservationId !== item.prepared.reservationId ||
    payload.data.objectKey !== item.prepared.objectKey ||
    payload.data.status !== "ready"
  ) {
    throw new CanvasUploadError("INVALID_RESPONSE", "上传确认结果无法验证");
  }
}

/**
 * Uploads one exact file to OSS, then waits for the server-side HEAD, MIME,
 * byte-length and magic-number verification before exposing its object key.
 */
export async function uploadPreparedCanvasFile(
  item: CanvasUploadBatchItem,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: CanvasUploadProgress) => void;
  } = {}
): Promise<CanvasUploadResult> {
  await uploadPreparedCanvasFileToOss(item, options);
  await finalizePreparedCanvasUpload(item, options.signal);
  return {
    kind: item.prepared.kind,
    ossKey: item.prepared.objectKey,
  };
}

/**
 * Convenience path for isolated callers. CanvasBoard prepares a whole batch
 * once and schedules no more than CANVAS_UPLOAD_MAX_CONCURRENCY uploads.
 */
export async function uploadCanvasFile(
  file: File,
  signal?: AbortSignal,
  onProgress?: (progress: CanvasUploadProgress) => void
): Promise<CanvasUploadResult> {
  const [item] = await prepareCanvasUploads([file], signal);
  return uploadPreparedCanvasFile(item, { signal, onProgress });
}

export { CANVAS_UPLOAD_MAX_CONCURRENCY };
