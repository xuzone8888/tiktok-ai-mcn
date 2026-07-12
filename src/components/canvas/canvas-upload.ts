"use client";

/**
 * 超级画布 · 文件上传(P0 · S2)
 *
 * 复用仓库现有 OSS 上传链路(服务端 multipart):
 *   - 图片 → POST /api/upload/image,回 { success, data: { url, path } };取 data.path;
 *   - 视频 → POST /api/upload/video,回 { success, url, objectPath };取 objectPath。
 * **只**取 OSS object key 写入 CanvasMedia,丢弃 url;强校验拒 dataURL/签名 URL。
 * 上传或校验失败一律抛错,调用方据此不建半节点。
 */
import { isOssObjectKey } from "@/lib/canvas/schema";

export type CanvasMediaKind = "image" | "video";

const UPLOAD_ENDPOINT: Record<CanvasMediaKind, string> = {
  image: "/api/upload/image",
  video: "/api/upload/video",
};

/** 由 MIME 类型判定画布可接收的媒体种类;不支持返回 null。 */
export function canvasFileKind(mimeType: string): CanvasMediaKind | null {
  if (typeof mimeType !== "string") return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

/**
 * 从上传响应里只取 OSS object key 并强校验。image=data.path,video=objectPath。
 * 任一缺失/非法(如返回的是 URL)即抛错——绝不把 URL/dataURL 当 key。
 */
export function extractUploadedObjectKey(kind: CanvasMediaKind, payload: unknown): string {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  let key: unknown;
  if (kind === "image") {
    const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<
      string,
      unknown
    >;
    key = data.path;
  } else {
    key = record.objectPath;
  }
  if (!isOssObjectKey(key)) {
    throw new Error("上传结果不是合法 OSS object key(拒 dataURL/签名 URL)");
  }
  return key;
}

export interface CanvasUploadResult {
  kind: CanvasMediaKind;
  ossKey: string;
}

/** 上传单个文件,只返回 object key;任何失败抛错(调用方不建半节点)。 */
export async function uploadCanvasFile(file: File): Promise<CanvasUploadResult> {
  const kind = canvasFileKind(file.type);
  if (!kind) throw new Error(`不支持的文件类型:${file.type || "未知"}`);

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(UPLOAD_ENDPOINT[kind], {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!response.ok) throw new Error(`上传失败(HTTP ${response.status})`);

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string }
    | null;
  if (!payload || payload.success === false) {
    throw new Error(payload?.error ?? "上传失败");
  }

  return { kind, ossKey: extractUploadedObjectKey(kind, payload) };
}
