/**
 * OpenAI GPT Image provider.
 *
 * Text-only requests use /images/generations. Image-reference requests use
 * multipart /images/edits after downloading each reference image to bytes.
 */

import { generateMediaPath, uploadImageBuffer } from "@/lib/oss";
import { DEFAULT_IMAGE_RESOLUTION, type ImageResolution } from "@/types/generation";
import sharp from "sharp";

export interface OpenAIImageParams {
  model?: string;
  prompt: string;
  sourceImageUrls?: string[];
  aspectRatio?: string;
  resolution?: ImageResolution;
  quality?: "low" | "medium" | "high" | "auto";
}

export interface OpenAIImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const NORMALIZED_REFERENCE_SIZE = 1024;
const DEFAULT_OPENAI_IMAGE_OSS_PREFIX = "openai-gen";

function getOpenAIImageOssPrefix(): string {
  const rawPrefix = process.env.OPENAI_IMAGE_OSS_PREFIX || DEFAULT_OPENAI_IMAGE_OSS_PREFIX;
  const safeSegments = rawPrefix
    .split("/")
    .map(segment => segment.trim().replace(/[^a-zA-Z0-9._-]/g, "-"))
    .filter(Boolean);

  return safeSegments.length > 0 ? safeSegments.join("/") : DEFAULT_OPENAI_IMAGE_OSS_PREFIX;
}

function getOpenAIImageSize(
  aspectRatio?: string,
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION
): string {
  const longEdgeByResolution: Record<ImageResolution, number> = {
    "1k": 1024,
    "2k": 2048,
    "4k": 3840,
  };
  const maxPixelsByResolution: Record<ImageResolution, number> = {
    "1k": 1024 * 1024,
    "2k": 2048 * 2048,
    "4k": 3840 * 2160,
  };
  const aspectRatios: Record<string, [number, number]> = {
    "auto": [1, 1],
    "1:1": [1, 1],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "4:3": [4, 3],
    "3:4": [3, 4],
    "3:2": [3, 2],
    "2:3": [2, 3],
    "5:4": [5, 4],
    "4:5": [4, 5],
    "21:9": [21, 9],
  };

  const [ratioWidth, ratioHeight] = aspectRatios[aspectRatio || "auto"] || aspectRatios.auto;
  const longEdge = longEdgeByResolution[resolution];
  const maxPixels = maxPixelsByResolution[resolution];
  const longEdgeScale = longEdge / Math.max(ratioWidth, ratioHeight);
  const pixelScale = Math.sqrt(maxPixels / (ratioWidth * ratioHeight));
  const scale = Math.min(longEdgeScale, pixelScale);
  const alignDownToEight = (value: number) => Math.max(8, Math.floor(value / 8) * 8);
  const width = alignDownToEight(ratioWidth * scale);
  const height = alignDownToEight(ratioHeight * scale);

  return `${width}x${height}`;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

function detectImageType(buffer: Buffer): "png" | "jpeg" | "webp" | "gif" | null {
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
    return "png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "gif";
  }

  return null;
}

async function downloadImageAsBlob(url: string, index: number): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`参考图下载失败 (${response.status}): ${url.substring(0, 80)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`参考图超过 50MB 限制: ${url.substring(0, 80)}`);
  }

  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get("content-type") || "";
  const detectedType = detectImageType(buffer);
  if (!contentType.toLowerCase().startsWith("image/") && !detectedType) {
    throw new Error(`参考图不是有效图片: ${url.substring(0, 80)}`);
  }

  const normalizedBuffer = await sharp(buffer)
    .rotate()
    .resize(NORMALIZED_REFERENCE_SIZE, NORMALIZED_REFERENCE_SIZE, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  return {
    blob: new Blob([new Uint8Array(normalizedBuffer)], { type: "image/png" }),
    filename: `reference-${index + 1}.png`,
  };
}

async function uploadOpenAIBase64Image(base64: string, model: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const objectPath = generateMediaPath(
    "images",
    getOpenAIImageOssPrefix(),
    `${model}-${Date.now()}.png`
  );

  return uploadImageBuffer(buffer, objectPath, "image/png");
}

async function submitOpenAIImageGeneration(params: OpenAIImageParams, model: string): Promise<Response> {
  return fetch(`${OPENAI_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: params.prompt,
      n: 1,
      size: getOpenAIImageSize(params.aspectRatio, params.resolution),
      quality: params.quality || "high",
      output_format: "png",
    }),
  });
}

async function submitOpenAIImageEdit(params: OpenAIImageParams, model: string): Promise<Response> {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", params.prompt);
  form.append("n", "1");
  form.append("size", getOpenAIImageSize(params.aspectRatio, params.resolution));
  form.append("quality", params.quality || "high");
  form.append("output_format", "png");

  const sourceImageUrls = (params.sourceImageUrls || []).slice(0, MAX_REFERENCE_IMAGES);
  const imageFieldName = sourceImageUrls.length === 1 ? "image" : "image[]";

  for (let i = 0; i < sourceImageUrls.length; i++) {
    const { blob, filename } = await downloadImageAsBlob(sourceImageUrls[i], i);
    form.append(imageFieldName, blob, filename);
  }

  return fetch(`${OPENAI_BASE_URL}/images/edits`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });
}

export async function submitOpenAIImage(params: OpenAIImageParams): Promise<OpenAIImageResult> {
  if (!OPENAI_API_KEY) {
    return { success: false, error: "OPENAI_API_KEY 未配置" };
  }

  const model = process.env.OPENAI_IMAGE_MODEL || params.model || DEFAULT_OPENAI_IMAGE_MODEL;

  try {
    const hasReferences = !!params.sourceImageUrls?.length;
    const response = hasReferences
      ? await submitOpenAIImageEdit(params, model)
      : await submitOpenAIImageGeneration(params, model);

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        error: getErrorMessage(data, `OpenAI 图片服务错误 (${response.status})`),
      };
    }

    const image = data?.data?.[0];
    if (image?.b64_json) {
      const imageUrl = await uploadOpenAIBase64Image(image.b64_json, model);
      return { success: true, imageUrl };
    }

    if (image?.url) {
      return { success: true, imageUrl: image.url };
    }

    return { success: false, error: "OpenAI 图片生成成功但未返回图片数据" };
  } catch (error) {
    console.error("[OpenAI Image] Submit error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "OpenAI 图片服务请求失败",
    };
  }
}
