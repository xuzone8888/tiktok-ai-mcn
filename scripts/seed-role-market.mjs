#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import OSS from "ali-oss";
import dotenv from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ENV_PATH = "/Volumes/Fuweibuzheng/Tiktokplfb/.env.local";
const DEFAULT_MANIFEST_PATH = path.join(__dirname, "seed", "role-market-experiment-20260614.json");
const BOARD_IMAGE_SIZE = "2048x1360";
const BOARD_SPLIT_RATIO = 949 / 2048;
const BOARD_CROP_GUTTER_RATIO = 48 / 2048;
const BOARD_COVER_ASPECT_RATIO = 2 / 3;
const COVER_SAFE_LEFT_PANEL_RATIO = 0.36;
const COVER_CROP_VERSION = "v4";
const IMAGE_GENERATION_ATTEMPTS = 3;
const UNAVAILABLE_DB_COLUMNS = new Set();

const CHARACTER_BOARD_TEMPLATE = `Create a premium 2K AI character reference board for a video creation product: one consistent character, left side large full-body hero portrait, right side complete multi-angle reference sheet with front view, side view, back view, and close-up head portraits, clear vertical split into two aligned panels for UI cropping, realistic studio lighting, no text, no watermark.
Character concept: {{CHARACTER_CONCEPT}}.`;

const rawArgs = process.argv.slice(2);

function hasFlag(name) {
  return rawArgs.includes(`--${name}`);
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = rawArgs.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function safeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function loadEnvironment() {
  const envPath = getArg("env", DEFAULT_ENV_PATH);
  dotenv.config({ path: envPath, override: false, quiet: true });
  dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false, quiet: true });
}

function pickEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function requireEnv(label, ...names) {
  const value = pickEnv(...names);
  if (!value) throw new Error(`${label} is not configured`);
  return value;
}

function getImagePlatformBaseUrl() {
  return (
    pickEnv("VIDEO_PLATFORM_IMAGE_BASE_URL", "IMAGE_PLATFORM_BASE_URL") ||
    pickEnv("VIDEO_PLATFORM_BASE_URL", "VIDEO_PLATFORM_API_BASE", "VIDEO_PLATFORM_API_ENDPOINT") ||
    "https://api.hellobabygo.com"
  ).replace(/\/+$/, "");
}

function getImagePlatformApiKey() {
  return pickEnv("VIDEO_PLATFORM_IMAGE_API_KEY", "IMAGE_PLATFORM_API_KEY", "VIDEO_PLATFORM_API_KEY", "SORA2_API_KEY", "WUYINKEJI_API_KEY");
}

function getImagePlatformAuthHeaders() {
  const key = getImagePlatformApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function buildImagePlatformUrl(requestPath) {
  if (requestPath.startsWith("http://") || requestPath.startsWith("https://")) return requestPath;
  return `${getImagePlatformBaseUrl()}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function isImagePayloadString(value) {
  return (
    typeof value === "string"
    && (
      value.startsWith("http://")
      || value.startsWith("https://")
      || value.startsWith("data:image/")
    )
  );
}

function normalizeImageStatus(value, hasImage) {
  const status = String(value || "").toLowerCase();
  if (["completed", "success", "succeeded", "done", "finish", "finished"].includes(status)) return "completed";
  if (["failed", "error", "errored", "cancelled", "canceled", "rejected"].includes(status)) return "failed";
  return hasImage ? "completed" : "processing";
}

function extractFromArray(value, extractor) {
  if (!Array.isArray(value)) return undefined;

  for (const item of value) {
    if (isImagePayloadString(item)) return item;
    const extracted = extractor(asRecord(item));
    if (extracted) return extracted;
  }

  return undefined;
}

function extractImageUrl(root) {
  const data = root.data;
  const dataRecord = asRecord(data);
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
    dataRecord.url,
    dataRecord.image_url,
    dataRecord.result_url
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

  const images = root.images ?? output.images ?? dataRecord.images;
  return extractFromArray(images, (record) =>
    pickString(record.url, record.image_url, record.imageUrl, record.result_url, record.resultUrl)
  );
}

function extractImageBase64(root) {
  const data = root.data;
  const dataRecord = asRecord(data);
  const output = asRecord(root.output);

  const direct = pickString(
    root.b64_json,
    root.image_base64,
    root.base64,
    output.b64_json,
    output.image_base64,
    dataRecord.b64_json,
    dataRecord.image_base64
  );
  if (direct) return direct;

  return extractFromArray(data, (record) =>
    pickString(record.b64_json, record.image_base64, record.base64)
  );
}

function normalizePlatformImageTask(data, fallbackTaskId) {
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
    Boolean(imageUrl || imageBase64)
  );

  let progress = pickNumber(payload.progress, payload.progress_pct, output.progress);
  if (progress !== undefined && progress > 0 && progress <= 1) progress = Math.round(progress * 100);
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

function isTransientNetworkError(error) {
  return /(fetch failed|network|timeout|aborted|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/i.test(error.message);
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/accessKeySecret[=:][^,\s]+/gi, "accessKeySecret=***");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function platformImageRequest(options) {
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
    let data = {};
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

async function submitPlatformImageGeneration({ prompt, size }) {
  const body = {
    model: process.env.VIDEO_PLATFORM_IMAGE_MODEL || "gpt-image-2",
    prompt,
    size,
    response_format: "url",
    quality: "high",
    output_format: "jpeg",
    output_compression: 92,
  };

  const data = await platformImageRequest({
    path: "/v1/images/generations",
    method: "POST",
    body,
    timeoutMs: 300_000,
  });

  const task = normalizePlatformImageTask(data);
  if (task.taskId || task.imageUrl || task.imageBase64) return task;
  throw new Error("平台图片接口未返回任务 ID 或图片结果");
}

async function getPlatformImageTaskStatus(taskId) {
  const paths = [
    `/v1/images/${encodeURIComponent(taskId)}`,
    `/api/v1/images/${encodeURIComponent(taskId)}`,
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    `/v1/images?id=${encodeURIComponent(taskId)}`,
  ];
  let lastError = null;

  for (const requestPath of paths) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const data = await platformImageRequest({ path: requestPath, method: "GET", timeoutMs: 45_000 });
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

async function waitForPlatformImageResult(taskId) {
  const pollIntervalMs = 5_000;
  const maxPollMs = 360_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= maxPollMs) {
    try {
      const task = await getPlatformImageTaskStatus(taskId);
      if (task.status === "completed" && (task.imageUrl || task.imageBase64)) return task;
      if (task.status === "failed") throw new Error(task.errorMessage || "图片生成失败");
    } catch (error) {
      const pollError = error instanceof Error ? error : new Error(String(error));
      if (!isTransientNetworkError(pollError)) throw pollError;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error("图片生成超时");
}

async function fetchImageBufferOnce(url, headers) {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  if (contentType.includes("application/json")) {
    const text = Buffer.from(arrayBuffer).toString("utf8");
    const data = JSON.parse(text);
    const nestedUrl = extractImageUrl(asRecord(data));
    if (nestedUrl) return fetchImageBuffer(nestedUrl);
    throw new Error("图片内容接口未返回可下载图片");
  }

  return {
    buffer: Buffer.from(new Uint8Array(arrayBuffer)),
    contentType: contentType.split(";")[0] || "image/jpeg",
  };
}

async function fetchImageBuffer(url, headers) {
  let lastError = null;

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

async function resolveImageBuffer(task) {
  if (task.imageBase64) {
    const dataUrlMatch = task.imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const cleanBase64 = task.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    return {
      buffer: Buffer.from(cleanBase64, "base64"),
      contentType: dataUrlMatch?.[1] || "image/jpeg",
    };
  }

  if (task.imageUrl) return fetchImageBuffer(task.imageUrl);

  if (task.taskId) {
    return fetchImageBuffer(
      buildImagePlatformUrl(`/v1/images/${encodeURIComponent(task.taskId)}/content`),
      getImagePlatformAuthHeaders()
    );
  }

  throw new Error("图片任务未返回可下载内容");
}

async function generateBoardImage(spec, boardPrompt, size) {
  let lastError = null;

  for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      console.log(`[seed] ${spec.seedKey}: generating image ${attempt}/${IMAGE_GENERATION_ATTEMPTS}`);
      const submitted = await submitPlatformImageGeneration({ prompt: boardPrompt, size });
      const completed = submitted.status === "completed" && (submitted.imageUrl || submitted.imageBase64)
        ? submitted
        : submitted.taskId
          ? await waitForPlatformImageResult(submitted.taskId)
          : submitted;

      const image = await resolveImageBuffer(completed);
      return {
        ...image,
        taskId: completed.taskId || submitted.taskId || null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < IMAGE_GENERATION_ATTEMPTS) {
        console.log(`[seed] ${spec.seedKey}: retrying after error: ${sanitizeError(lastError)}`);
        await sleep(5000);
      }
    }
  }

  throw lastError || new Error("图片生成失败");
}

function parseSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return { width: 2048, height: 1360 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function buildBoardCropMeta(size) {
  const { width, height } = parseSize(size);
  const splitX = Math.round(width * BOARD_SPLIT_RATIO);
  const seam = Math.max(24, Math.round(width * BOARD_CROP_GUTTER_RATIO));
  const maxLeftPanelWidth = Math.max(
    1,
    Math.min(
      Math.round(width * COVER_SAFE_LEFT_PANEL_RATIO),
      splitX - seam * 3
    )
  );
  const targetCoverWidth = Math.round(height * BOARD_COVER_ASPECT_RATIO);

  return {
    sourceWidth: width,
    sourceHeight: height,
    targetWidth: targetCoverWidth,
    left: {
      left: 0,
      top: 0,
      width: Math.max(1, Math.min(maxLeftPanelWidth, targetCoverWidth)),
      height,
    },
  };
}

async function cropAvatar(boardBuffer, cropMeta) {
  const image = sharp(boardBuffer);
  const metadata = await image.metadata();
  const actualWidth = metadata.width || cropMeta.sourceWidth;
  const actualHeight = metadata.height || cropMeta.sourceHeight;
  const scaleX = actualWidth / cropMeta.sourceWidth;
  const scaleY = actualHeight / cropMeta.sourceHeight;
  const crop = cropMeta.left;
  const left = Math.max(0, Math.round(crop.left * scaleX));
  const top = Math.max(0, Math.round(crop.top * scaleY));
  const width = Math.max(1, Math.min(actualWidth - left, Math.round(crop.width * scaleX)));
  const height = Math.max(1, Math.min(actualHeight - top, Math.round(crop.height * scaleY)));
  const targetWidth = Math.max(width, Math.round((cropMeta.targetWidth || width) * scaleX));

  const foreground = await image
    .extract({ left, top, width, height })
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer();

  if (targetWidth <= width) {
    return sharp(foreground)
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  const background = await sharp(foreground)
    .resize({ width: targetWidth, height, fit: "cover", position: "center" })
    .blur(18)
    .modulate({ brightness: 0.88, saturation: 0.92 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  return sharp(background)
    .composite([{
      input: foreground,
      top: 0,
      left: Math.max(0, Math.round((targetWidth - width) / 2)),
    }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

function createOssClient() {
  const OSSCtor = OSS?.default || OSS;
  return new OSSCtor({
    region: process.env.ALIYUN_OSS_REGION || "oss-cn-beijing",
    accessKeyId: requireEnv("ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_ID"),
    accessKeySecret: requireEnv("ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_ACCESS_KEY_SECRET"),
    bucket: process.env.ALIYUN_OSS_BUCKET || "tokfactory-videos",
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
    secure: true,
    timeout: 300000,
  });
}

function getOssPublicUrl(objectPath) {
  const domain = (process.env.ALIYUN_OSS_CUSTOM_DOMAIN || "media.toryxai.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${domain}/${objectPath}`;
}

async function uploadImage(client, objectPath, buffer, contentType = "image/jpeg") {
  const result = await client.put(objectPath, buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "max-age=31536000",
    },
  });

  if (!result.name) throw new Error("OSS 上传失败");
  return getOssPublicUrl(objectPath);
}

async function uploadCharacterImages({ ossClient, batchId, spec, generatedImage, size }) {
  const boardBuffer = await sharp(generatedImage.buffer)
    .rotate()
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
  const boardMeta = await sharp(boardBuffer).metadata();
  if (!boardMeta.width || !boardMeta.height) throw new Error("生成图片无法读取尺寸");

  const cropMeta = buildBoardCropMeta(size);
  const avatarBuffer = await cropAvatar(boardBuffer, cropMeta);
  const hash = crypto.createHash("sha1").update(boardBuffer).digest("hex").slice(0, 12);
  const prefix = `images/market-seed/${batchId}/${spec.seedKey}`;
  const boardPath = `${prefix}/reference-sheet-${hash}.jpg`;
  const avatarPath = `${prefix}/cover-${COVER_CROP_VERSION}-${hash}.jpg`;

  const boardUrl = await uploadImage(ossClient, boardPath, boardBuffer, "image/jpeg");
  const avatarUrl = await uploadImage(ossClient, avatarPath, avatarBuffer, "image/jpeg");

  return {
    boardUrl,
    avatarUrl,
    storagePrefix: prefix,
    imageHash: hash,
    cropMeta,
    width: boardMeta.width,
    height: boardMeta.height,
  };
}

function createSupabaseAdmin() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

async function findExistingRole(supabase, batchId, seedKey) {
  const { data, error } = await supabase
    .from("ai_models")
    .select("id,name,avatar_url,reference_sheet_url,metadata")
    .contains("metadata", { seed_batch: batchId, seed_key: seedKey })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

function getMissingColumn(message) {
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function writeAiModel(supabase, existingId, record) {
  let payload = { ...record };
  for (const column of UNAVAILABLE_DB_COLUMNS) {
    delete payload[column];
  }

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const query = existingId
      ? supabase.from("ai_models").update(payload).eq("id", existingId).select("id").single()
      : supabase.from("ai_models").insert(payload).select("id").single();
    const { data, error } = await query;

    if (!error) return data;

    const missingColumn = getMissingColumn(error.message || "");
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      console.log(`[seed] database column ${missingColumn} is unavailable; retrying without it`);
      UNAVAILABLE_DB_COLUMNS.add(missingColumn);
      const nextPayload = { ...payload };
      delete nextPayload[missingColumn];
      payload = nextPayload;
      continue;
    }

    throw error;
  }

  throw new Error("数据库写入重试次数过多");
}

function buildBoardPrompt(spec) {
  return CHARACTER_BOARD_TEMPLATE.replace("{{CHARACTER_CONCEPT}}", spec.prompt);
}

function buildAiModelRecord({ manifest, spec, boardPrompt, urls, taskId }) {
  const publishPrice = Number(manifest.publishPrice ?? 100);
  const referenceImages = [urls.boardUrl, urls.avatarUrl].filter(Boolean);

  return {
    name: spec.name,
    description: spec.description,
    avatar_url: urls.avatarUrl,
    sample_images: referenceImages,
    sample_videos: [],
    preview_url: urls.avatarUrl,
    category: spec.category,
    style_tags: spec.tags,
    gender: spec.gender,
    age_range: spec.ageRange,
    price_daily: 0,
    price_weekly: 0,
    price_monthly: publishPrice,
    price_yearly: 0,
    rating: 4.9,
    is_active: true,
    is_featured: false,
    is_trending: false,
    trigger_word: spec.seedKey,
    capabilities: {
      character_asset: true,
      reference_sheet: true,
      image_reference: true,
      video_reference: true,
      seed_batch: manifest.batchId,
    },
    metadata: {
      seed_batch: manifest.batchId,
      seed_key: spec.seedKey,
      seed_version: 1,
      generated_by: "scripts/seed-role-market.mjs",
      generated_at: new Date().toISOString(),
      image_model: process.env.VIDEO_PLATFORM_IMAGE_MODEL || "gpt-image-2",
      image_size: manifest.boardSize || BOARD_IMAGE_SIZE,
      image_hash: urls.imageHash || null,
      cover_crop_version: COVER_CROP_VERSION,
      task_id: taskId || null,
      storage_prefix: urls.storagePrefix || null,
      category: spec.category,
      prompt: spec.prompt,
      board_prompt: boardPrompt,
    },
    source: "official",
    owner_id: null,
    reference_images: referenceImages,
    character_type: spec.characterType,
    dna_config: {
      seed_key: spec.seedKey,
      category: spec.category,
      style_tags: spec.tags,
      prompt: spec.prompt,
      source: "market_seed",
    },
    reference_sheet_url: urls.boardUrl,
    reference_status: "completed",
    reference_task_id: taskId || null,
    preview_video_url: null,
    is_public: true,
    publish_price: publishPrice,
    forge_type: "veo",
  };
}

async function seedOneRole({ manifest, spec, supabase, ossClient, index, total, regenerate, recropCovers }) {
  const boardPrompt = buildBoardPrompt(spec);
  const existing = await findExistingRole(supabase, manifest.batchId, spec.seedKey);
  let urls = null;
  let taskId = null;
  let generated = false;

  console.log(`[seed] ${index + 1}/${total} ${spec.category} - ${spec.name}`);

  if (existing?.reference_sheet_url && recropCovers && !regenerate) {
    const boardImage = await fetchImageBuffer(existing.reference_sheet_url);
    urls = await uploadCharacterImages({
      ossClient,
      batchId: manifest.batchId,
      spec,
      generatedImage: boardImage,
      size: manifest.boardSize || BOARD_IMAGE_SIZE,
    });
    taskId = asRecord(existing.metadata).task_id || null;
    console.log(`[seed] ${spec.seedKey}: recropped cover from existing sheet`);
  } else if (existing?.avatar_url && existing?.reference_sheet_url && !regenerate) {
    urls = {
      avatarUrl: existing.avatar_url,
      boardUrl: existing.reference_sheet_url,
      imageHash: asRecord(existing.metadata).image_hash || null,
      storagePrefix: asRecord(existing.metadata).storage_prefix || null,
    };
    taskId = asRecord(existing.metadata).task_id || null;
    console.log(`[seed] ${spec.seedKey}: existing images found, updating metadata only`);
  } else {
    const generatedImage = await generateBoardImage(
      spec,
      boardPrompt,
      manifest.boardSize || BOARD_IMAGE_SIZE
    );
    urls = await uploadCharacterImages({
      ossClient,
      batchId: manifest.batchId,
      spec,
      generatedImage,
      size: manifest.boardSize || BOARD_IMAGE_SIZE,
    });
    taskId = generatedImage.taskId;
    generated = true;
    console.log(`[seed] ${spec.seedKey}: uploaded board and cover`);
  }

  const record = buildAiModelRecord({ manifest, spec, boardPrompt, urls, taskId });
  const saved = await writeAiModel(supabase, existing?.id || null, record);
  console.log(`[seed] ${spec.seedKey}: ${existing ? "updated" : "inserted"} model ${saved.id}`);

  return {
    seedKey: spec.seedKey,
    name: spec.name,
    category: spec.category,
    id: saved.id,
    generated,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = {
          success: false,
          error: sanitizeError(error),
          seedKey: items[index]?.seedKey,
          name: items[index]?.name,
          category: items[index]?.category,
        };
        console.log(`[seed] ${items[index]?.seedKey}: failed: ${sanitizeError(error)}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker())
  );
  return results;
}

async function readManifest() {
  const manifestPath = path.resolve(process.cwd(), getArg("manifest", DEFAULT_MANIFEST_PATH));
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!manifest.batchId || !Array.isArray(manifest.roles)) {
    throw new Error("Seed manifest is invalid");
  }
  manifest.__manifestPath = manifestPath;
  return manifest;
}

function selectRoles(manifest) {
  const only = getArg("only");
  const limit = getArg("limit");
  let roles = manifest.roles;

  if (only) {
    const tokens = only.split(",").map((item) => item.trim()).filter(Boolean);
    roles = roles.filter((role) =>
      tokens.includes(role.seedKey) || tokens.includes(role.category) || tokens.includes(role.name)
    );
  }

  if (limit) roles = roles.slice(0, safeInteger(limit, roles.length));
  return roles;
}

async function deactivateBatch(supabase, batchId) {
  const { error, count } = await supabase
    .from("ai_models")
    .update({ is_active: false })
    .contains("metadata", { seed_batch: batchId })
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  console.log(`[seed] deactivated ${count || 0} models for batch ${batchId}`);
}

async function main() {
  loadEnvironment();
  const manifest = await readManifest();
  const roles = selectRoles(manifest);
  const dryRun = hasFlag("dry-run");
  const regenerate = hasFlag("regenerate");
  const recropCovers = hasFlag("recrop-covers");
  const concurrency = safeInteger(getArg("concurrency", "1"), 1);

  if (roles.length === 0) throw new Error("No roles selected");

  console.log(`[seed] batch: ${manifest.batchId}`);
  console.log(`[seed] manifest: ${manifest.__manifestPath}`);
  console.log(`[seed] selected roles: ${roles.length}`);

  if (dryRun) {
    for (const role of roles) {
      console.log(`[seed] dry-run: ${role.category} / ${role.name} / ${role.seedKey}`);
    }
    return;
  }

  requireEnv("image platform API key", "VIDEO_PLATFORM_IMAGE_API_KEY", "IMAGE_PLATFORM_API_KEY", "VIDEO_PLATFORM_API_KEY", "SORA2_API_KEY", "WUYINKEJI_API_KEY");
  requireEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  requireEnv("ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_ID");
  requireEnv("ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_ACCESS_KEY_SECRET");

  const supabase = createSupabaseAdmin();
  if (hasFlag("deactivate-batch")) {
    await deactivateBatch(supabase, manifest.batchId);
    return;
  }

  const ossClient = createOssClient();
  console.log(`[seed] generation model: ${process.env.VIDEO_PLATFORM_IMAGE_MODEL || "gpt-image-2"}`);
  console.log(`[seed] concurrency: ${concurrency}`);

  const results = await runWithConcurrency(roles, concurrency, (spec, index) =>
    seedOneRole({
      manifest,
      spec,
      supabase,
      ossClient,
      index,
      total: roles.length,
      regenerate,
      recropCovers,
    })
  );

  const failures = results.filter((result) => result?.success === false);
  const successes = results.filter((result) => result?.success !== false);
  const generatedCount = successes.filter((result) => result.generated).length;

  console.log(`[seed] complete: ${successes.length}/${roles.length} saved, ${generatedCount} newly generated`);
  if (failures.length > 0) {
    console.log("[seed] failures:");
    for (const failure of failures) {
      console.log(`[seed] - ${failure.category} / ${failure.name} / ${failure.seedKey}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[seed] fatal: ${sanitizeError(error)}`);
  process.exitCode = 1;
});
