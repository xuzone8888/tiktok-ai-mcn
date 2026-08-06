import { z } from "zod";

export const CANVAS_UPLOAD_MAX_FILES = 10;
export const CANVAS_UPLOAD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CANVAS_UPLOAD_MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const CANVAS_UPLOAD_MAX_BATCH_BYTES = 512 * 1024 * 1024;
export const CANVAS_UPLOAD_SIGNATURE_TTL_SECONDS = 5 * 60;
export const CANVAS_UPLOAD_MAX_CONCURRENCY = 3;
export const CANVAS_UPLOAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const CANVAS_UPLOAD_MIME_BY_EXTENSION = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mov: ["video/quicktime", "video/mp4"],
  avi: ["video/x-msvideo"],
} as const satisfies Record<string, readonly string[]>;

export type CanvasUploadKind = "image" | "video";

export interface CanvasUploadFileMetadata {
  name: string;
  type: string;
  size: number;
}

export interface ValidCanvasUploadFile extends CanvasUploadFileMetadata {
  extension: keyof typeof CANVAS_UPLOAD_MIME_BY_EXTENSION;
  kind: CanvasUploadKind;
}

const CanvasUploadFileRequestSchema = z.strictObject({
  id: z.string().regex(CANVAS_UPLOAD_ID_RE),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  size: z.number().int().positive().max(CANVAS_UPLOAD_MAX_VIDEO_BYTES),
});

export const CanvasUploadRequestSchema = z
  .strictObject({
    files: z
      .array(CanvasUploadFileRequestSchema)
      .min(1)
      .max(CANVAS_UPLOAD_MAX_FILES),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.files.forEach((file, index) => {
      if (seen.has(file.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["files", index, "id"],
          message: "upload reservation ids must be unique",
        });
      }
      seen.add(file.id);
    });
  });

function extensionOf(name: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match?.[1]?.toLowerCase() ?? null;
}

export function describeCanvasUploadFileRejection(
  file: CanvasUploadFileMetadata
): string | null {
  if (
    typeof file.name !== "string" ||
    file.name.length < 1 ||
    file.name.length > 200
  ) {
    return "文件名长度必须为 1–200 个字符";
  }
  if (
    file.name !== file.name.trim() ||
    /[/\\\u0000-\u001f\u007f]/.test(file.name) ||
    file.name === "." ||
    file.name === ".."
  ) {
    return "文件名包含不安全字符";
  }
  if (
    typeof file.type !== "string" ||
    file.type.length < 1 ||
    file.type.length > 100 ||
    file.type !== file.type.trim() ||
    file.type !== file.type.toLowerCase()
  ) {
    return "文件 MIME 类型无效";
  }
  if (
    typeof file.size !== "number" ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0
  ) {
    return "不支持空文件或无法确定大小的文件";
  }

  const extension = extensionOf(file.name);
  if (!extension) return "文件缺少受支持的扩展名";
  const allowedMime =
    CANVAS_UPLOAD_MIME_BY_EXTENSION[
      extension as keyof typeof CANVAS_UPLOAD_MIME_BY_EXTENSION
    ];
  if (!allowedMime) {
    return "仅支持 JPG、PNG、WebP、GIF、MP4、WebM、MOV 或 AVI";
  }
  if (!(allowedMime as readonly string[]).includes(file.type)) {
    return "文件扩展名与 MIME 类型不匹配";
  }

  const kind: CanvasUploadKind = file.type.startsWith("image/")
    ? "image"
    : "video";
  const maximum =
    kind === "image"
      ? CANVAS_UPLOAD_MAX_IMAGE_BYTES
      : CANVAS_UPLOAD_MAX_VIDEO_BYTES;
  if (file.size > maximum) {
    return kind === "image"
      ? "图片不能超过 10MB"
      : "视频不能超过 256MB";
  }
  return null;
}

export function validateCanvasUploadFileMetadata(
  file: CanvasUploadFileMetadata
): ValidCanvasUploadFile {
  const rejection = describeCanvasUploadFileRejection(file);
  if (rejection) throw new Error(rejection);

  const extension = extensionOf(file.name) as keyof typeof CANVAS_UPLOAD_MIME_BY_EXTENSION;
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    extension,
    kind: file.type.startsWith("image/") ? "image" : "video",
  };
}

export function validateCanvasUploadBatchMetadata(
  files: readonly CanvasUploadFileMetadata[]
): ValidCanvasUploadFile[] {
  if (files.length < 1) throw new Error("请选择要上传的图片或视频");
  if (files.length > CANVAS_UPLOAD_MAX_FILES) {
    throw new Error(`一次最多拖入 ${CANVAS_UPLOAD_MAX_FILES} 个文件`);
  }
  const validated = files.map((file) => validateCanvasUploadFileMetadata(file));
  const totalBytes = validated.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > CANVAS_UPLOAD_MAX_BATCH_BYTES) {
    throw new Error("单批文件总大小不能超过 512MB");
  }
  return validated;
}
