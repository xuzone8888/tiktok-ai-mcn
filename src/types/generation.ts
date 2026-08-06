/**
 * Generation Types & Utilities
 * 
 * 共享的生成类型定义和计费逻辑
 * 用于 Quick Generator 和 Pro Studio (Batch) 页面
 * 
 * 2026-03-19 重构：统一 API 封装
 * - 新增 VideoModel (5模型) + ImageModel (3模型) + 配置表
 * - 旧类型 (NanoTier, 旧 VideoModel) 标记 @deprecated
 */

// ============================================================================
// 基础类型定义
// ============================================================================

/** 输出模式 */
export type OutputMode = "video" | "image";

/** 图片来源类型 */
export type SourceType = "local_upload" | "nano_banana";

/** @deprecated 使用 ImageModel 替代 */
export type NanoTier = "fast" | "pro";

/** 图片处理类型 */
export type ProcessingType = "upscale" | "9grid";

// ============================================================================
// 新模型类型定义 (2026-03-19 统一封装)
// ============================================================================

/** 视频模型选项 */
export type VideoModel =
  | "sora2-new-10s"     // 速创 Sora2-NEW 10秒
  | "sora2-new-15s"     // 速创 Sora2-NEW 15秒
  | "veo3-components"   // 高瑞 VEO3.1 Components (8s, 3图+首尾帧)
  | "veo3-fast"         // 高瑞 VEO3.1 Fast (8s, 最快)
  | "veo3-fast-4k"      // 高瑞 VEO3.1 Fast 4K (8s, 超清)
  // Seedance 2.0 (火山方舟)
  | "seedance-5s"       // Seedance 2.0 5秒 高清1080P
  | "seedance-10s"      // Seedance 2.0 10秒 高清1080P
  | "seedance-5s-pro"   // Seedance 2.0 5秒 Pro 原生720P
  | "seedance-10s-pro"  // Seedance 2.0 10s Pro
  | "happyhorse-5s"     // DashScope HappyHorse 1.0 T2V 5s 720P
  | "happyhorse-12s"    // DashScope HappyHorse 1.0 T2V 12s 720P
  // @deprecated — 旧模型，迁移期间保留
  | "sora2-10s" | "sora2-15s" | "sora2-pro-15s-hd" | "sora2-pro-25s";

/** 图片模型选项 */
export type ImageModel =
  | "gpt-image-2"      // OpenAI GPT Image 2
  | "gemini-1k"        // 高瑞 flash (1K, 快速~10s)
  | "gemini-2k"        // xas231 portrait (2K, ~90s, 默认)
  | "gemini-4k";       // 高瑞 pro-preview (4K, ~25s)

/** 视频宽高比 */
export type VideoAspectRatio = "9:16" | "16:9";

/** 图片宽高比 */
export type ImageAspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9";

/** 图片分辨率 */
export type ImageResolution = "1k" | "2k" | "4k";

export const DEFAULT_IMAGE_MODEL: ImageModel = "gpt-image-2";
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = "1k";

export const IMAGE_RESOLUTION_CREDITS: Record<ImageResolution, number> = {
  "1k": 5,
  "2k": 10,
  "4k": 15,
};

const LEGACY_IMAGE_MODEL_RESOLUTION: Partial<Record<ImageModel, ImageResolution>> = {
  "gemini-1k": "1k",
  "gemini-2k": "2k",
  "gemini-4k": "4k",
};

export function isImageResolution(value: unknown): value is ImageResolution {
  return value === "1k" || value === "2k" || value === "4k";
}

export function normalizeImageResolution(
  value: unknown,
  fallback: ImageResolution = DEFAULT_IMAGE_RESOLUTION
): ImageResolution {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  return isImageResolution(normalized) ? normalized : fallback;
}

export function getResolutionFromImageModel(model: string | null | undefined): ImageResolution | null {
  if (!model) return null;
  return LEGACY_IMAGE_MODEL_RESOLUTION[model as ImageModel] || null;
}

export function getImageResolutionCost(resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION): number {
  return IMAGE_RESOLUTION_CREDITS[resolution];
}

/** 图片处理动作 */
export type ImageProcessAction = "generate" | "upscale" | "nine_grid";

/** AI 角色选择模式 */
export type AiCastMode = "auto" | "team" | "all" | "character";

/** 批量生成数量 */
export type BatchCount = 1 | 2 | 3 | 4;

/** 生成任务状态 */
export type GenerationStatus = 
  | "pending"      // 等待处理
  | "processing"   // 处理中
  | "completed"    // 完成
  | "failed";      // 失败

/** Canvas 状态 */
export type CanvasState = 
  | "empty"
  | "uploaded"
  | "preview"
  | "processing"
  | "selection"
  | "selected"
  | "generating"
  | "result"
  | "failed";

// ============================================================================
// 上传文件接口
// ============================================================================

export interface UploadedFile {
  url: string;
  name: string;
}

// ============================================================================
// AI 模特接口
// ============================================================================

export interface DisplayModel {
  id: string;
  name: string;
  avatar_url: string | null;
  demo_video_url?: string | null;
  tags: string[];
  category: string;
  gender: "male" | "female" | "neutral" | null;
  price_monthly: number;
  rating: number;
  is_featured: boolean;
  is_trending: boolean;
  is_hired?: boolean;
  days_remaining?: number;
  contract_end_date?: string | null;
  // === Phase 3: 角色系统字段 ===
  source?: "official" | "user_created";
  description?: string | null;
  reference_sheet_url?: string | null;
  reference_status?: string;
}

// ============================================================================
// 视频生成配置
// ============================================================================

export interface VideoGenerationConfig {
  prompt: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  sourceImageUrl?: string;
  sourceImageUrls?: string[];  // VEO3 支持多张参考图
  modelId?: string;  // AI 模特 ID
  characterPid?: string;  // Sora2 角色 pid (如 @eldenzrzl.marmaladec)
}

/** 视频模型配置项 */
export interface VideoModelConfig {
  label: string;           // UI 显示名
  provider: "suchuang" | "gaorui" | "volcengine" | "dashscope";
  apiModel: string;        // 传给 API 的实际模型名
  endpoint: string;        // API 端点路径
  duration: number;        // 固定时长（秒）
  credits: number;         // 积分（后续统一调整）
  supportsRefImage: boolean;
  maxImages: number;
  supportsCharacter: boolean;
  quality: "standard" | "hd" | "4k";
  responseMode: "sync" | "async";
  requestFormat: "messages" | "prompt" | "multipart";
  estimatedTime: string;
}

/**
 * 视频模型配置表 (新版)
 *
 * 5 个模型:
 * - Sora2 10秒 / 15秒 (速创 wuyinkeji)
 * - VEO3 参考图版 / 快速版 / 4K超清 (高瑞 gaorui)
 */
export const VIDEO_MODEL_CONFIG: Record<string, VideoModelConfig> = {
  "sora2-new-10s": {
    label: "Sora2 10秒",
    provider: "suchuang",
    apiModel: "sora2-new",
    endpoint: "/api/sora2-new/submit",
    duration: 10,
    credits: 20,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: true,
    quality: "standard",
    responseMode: "async",
    requestFormat: "prompt",
    estimatedTime: "3~5分钟",
  },
  "sora2-new-15s": {
    label: "Sora2 15秒",
    provider: "suchuang",
    apiModel: "sora2-new",
    endpoint: "/api/sora2-new/submit",
    duration: 15,
    credits: 20,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: true,
    quality: "standard",
    responseMode: "async",
    requestFormat: "prompt",
    estimatedTime: "3~5分钟",
  },
  "veo3-components": {
    label: "VEO3 参考图版 8秒",
    provider: "gaorui",
    apiModel: "veo_3_1-components",
    endpoint: "/v1/videos",
    duration: 8,
    credits: 10,
    supportsRefImage: true,
    maxImages: 3,
    supportsCharacter: true,
    quality: "standard",
    responseMode: "async",
    requestFormat: "multipart",
    estimatedTime: "~90秒",
  },
  "veo3-fast": {
    label: "VEO3 快速版 8秒",
    provider: "gaorui",
    apiModel: "veo3.1-fast",
    endpoint: "/v1/videos",
    duration: 8,
    credits: 8,
    supportsRefImage: false,
    maxImages: 0,
    supportsCharacter: false,
    quality: "standard",
    responseMode: "async",
    requestFormat: "multipart",
    estimatedTime: "~76秒",
  },
  "veo3-fast-4k": {
    label: "VEO3 4K超清 8秒",
    provider: "gaorui",
    apiModel: "veo3.1-fast-4K",
    endpoint: "/v1/videos",
    duration: 8,
    credits: 10,
    supportsRefImage: true,
    maxImages: 2,
    supportsCharacter: true,
    quality: "4k",
    responseMode: "async",
    requestFormat: "multipart",
    estimatedTime: "~6.6分钟",
  },
  // Seedance 2.0 (火山方舟 volcengine)
  "seedance-5s": {
    label: "Seedance 2.0 5秒 · 高清1080P",
    provider: "volcengine",
    apiModel: "ep-m-20260402170020-b466n",
    endpoint: "/api/seedance/submit",
    duration: 5,
    credits: 233,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: false,
    quality: "standard",
    responseMode: "async",
    requestFormat: "messages",
    estimatedTime: "~2分钟",
  },
  "seedance-10s": {
    label: "Seedance 2.0 10秒 · 高清1080P",
    provider: "volcengine",
    apiModel: "ep-m-20260402170020-b466n",
    endpoint: "/api/seedance/submit",
    duration: 10,
    credits: 466,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: false,
    quality: "standard",
    responseMode: "async",
    requestFormat: "messages",
    estimatedTime: "~2分钟",
  },
  "seedance-5s-pro": {
    label: "Seedance 2.0 5秒 Pro · 原生720P",
    provider: "volcengine",
    apiModel: "ep-m-20260402170020-b466n",
    endpoint: "/api/seedance/submit",
    duration: 5,
    credits: 497,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: false,
    quality: "hd",
    responseMode: "async",
    requestFormat: "messages",
    estimatedTime: "~2分钟",
  },
  "seedance-10s-pro": {
    label: "Seedance 2.0 10秒 Pro · 原生720P",
    provider: "volcengine",
    apiModel: "ep-m-20260402170020-b466n",
    endpoint: "/api/seedance/submit",
    duration: 10,
    credits: 994,
    supportsRefImage: true,
    maxImages: 1,
    supportsCharacter: false,
    quality: "hd",
    responseMode: "async",
    requestFormat: "messages",
    estimatedTime: "~3分钟",
  },
  "happyhorse-5s": {
    label: "HappyHorse 1.0 5s 720P",
    provider: "dashscope",
    apiModel: "happyhorse-1.0-t2v",
    endpoint: "/api/video-batch/generate-happyhorse-video",
    duration: 5,
    credits: 450,
    supportsRefImage: false,
    maxImages: 0,
    supportsCharacter: false,
    quality: "standard",
    responseMode: "async",
    requestFormat: "prompt",
    estimatedTime: "~2-4 minutes",
  },
  "happyhorse-12s": {
    label: "HappyHorse 1.0 12s 720P",
    provider: "dashscope",
    apiModel: "happyhorse-1.0-t2v",
    endpoint: "/api/video-batch/generate-happyhorse-video",
    duration: 12,
    credits: 1080,
    supportsRefImage: false,
    maxImages: 0,
    supportsCharacter: false,
    quality: "standard",
    responseMode: "async",
    requestFormat: "prompt",
    estimatedTime: "~4-8 minutes",
  },
};

/** 获取新视频模型列表（仅新模型，用于 UI 渲染） */
export const NEW_VIDEO_MODELS: VideoModel[] = [
  "sora2-new-10s", "sora2-new-15s",
  "veo3-components", "veo3-fast", "veo3-fast-4k",
  "seedance-5s", "seedance-10s", "seedance-5s-pro", "seedance-10s-pro",
  "happyhorse-5s", "happyhorse-12s",
];

export interface VideoModelPricing {
  label: string;
  duration: string;
  credits: number;
  apiDuration: 5 | 8 | 10 | 12 | 15 | 25;
  quality: "standard" | "hd";
  apiModel: string;
}

export const QUICK_GEN_VIDEO_PRICING: Record<string, VideoModelPricing> = {
  "sora2-12s": {
    label: "Sora2 标准 12秒",
    duration: "12秒",
    credits: 20,
    apiDuration: 12,
    quality: "standard",
    apiModel: "sora2",
  },
  "sora2-pro-12s-hd": {
    label: "Sora2 Pro 高清 12秒",
    duration: "12秒",
    credits: 350,
    apiDuration: 12,
    quality: "hd",
    apiModel: "sora2-pro",
  },
  // Seedance 2.0 (Quick Gen 模型选择器使用)
  "seedance-5s": {
    label: "Seedance 2.0 5秒 · 高清1080P",
    duration: "5秒",
    credits: 233,
    apiDuration: 5,
    quality: "standard",
    apiModel: "seedance-5s",
  },
  "seedance-10s": {
    label: "Seedance 2.0 10秒 · 高清1080P",
    duration: "10秒",
    credits: 466,
    apiDuration: 10,
    quality: "standard",
    apiModel: "seedance-10s",
  },
  "seedance-5s-pro": {
    label: "Seedance 2.0 5秒 Pro · 原生720P",
    duration: "5秒",
    credits: 497,
    apiDuration: 5,
    quality: "hd",
    apiModel: "seedance-5s-pro",
  },
  "seedance-10s-pro": {
    label: "Seedance 2.0 10秒 Pro · 原生720P",
    duration: "10秒",
    credits: 994,
    apiDuration: 10,
    quality: "hd",
    apiModel: "seedance-10s-pro",
  },
  "happyhorse-5s": {
    label: "HappyHorse 1.0 5s 720P",
    duration: "5s",
    credits: 450,
    apiDuration: 5,
    quality: "standard",
    apiModel: "happyhorse-1.0-t2v",
  },
  "happyhorse-12s": {
    label: "HappyHorse 1.0 12s 720P",
    duration: "12s",
    credits: 1080,
    apiDuration: 12,
    quality: "standard",
    apiModel: "happyhorse-1.0-t2v",
  },
};

/** Legacy shared pricing used by generation-client and the legacy batch store. */
export const VIDEO_MODEL_PRICING: Record<string, VideoModelPricing> = {
  "sora2-10s": {
    label: "Sora2 标清 10秒",
    duration: "10秒",
    credits: 20,
    apiDuration: 10,
    quality: "standard",
    apiModel: "sora2-portrait",
  },
  "sora2-15s": {
    label: "Sora2 标清 15秒",
    duration: "15秒",
    credits: 20,
    apiDuration: 15,
    quality: "standard",
    apiModel: "sora2-portrait-15s",
  },
  "sora2-pro-15s-hd": {
    label: "Sora2 Pro 15秒高清",
    duration: "15秒",
    credits: 320,
    apiDuration: 15,
    quality: "hd",
    apiModel: "sora2-pro-portrait-hd-15s",
  },
  "sora2-pro-25s": {
    label: "Sora2 Pro 25秒标清",
    duration: "25秒",
    credits: 320,
    apiDuration: 25,
    quality: "standard",
    apiModel: "sora2-pro-portrait-25s",
  },
  "seedance-5s": QUICK_GEN_VIDEO_PRICING["seedance-5s"],
  "seedance-10s": QUICK_GEN_VIDEO_PRICING["seedance-10s"],
  "seedance-5s-pro": QUICK_GEN_VIDEO_PRICING["seedance-5s-pro"],
  "seedance-10s-pro": QUICK_GEN_VIDEO_PRICING["seedance-10s-pro"],
  "happyhorse-5s": QUICK_GEN_VIDEO_PRICING["happyhorse-5s"],
  "happyhorse-12s": QUICK_GEN_VIDEO_PRICING["happyhorse-12s"],
};

export type VideoModelPricingKey =
  | "sora2-12s"
  | "sora2-pro-12s-hd"
  | "seedance-5s"
  | "seedance-10s"
  | "seedance-5s-pro"
  | "seedance-10s-pro"
  | "happyhorse-5s"
  | "happyhorse-12s";

export const DEFAULT_QUICK_GEN_VIDEO_MODEL: VideoModelPricingKey = "sora2-12s";

export function isVideoModelPricingKey(value: unknown): value is VideoModelPricingKey {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(QUICK_GEN_VIDEO_PRICING, value);
}

export function getVideoModelPricingEntries(): [VideoModelPricingKey, VideoModelPricing][] {
  return Object.entries(QUICK_GEN_VIDEO_PRICING).filter(
    (entry): entry is [VideoModelPricingKey, VideoModelPricing] => isVideoModelPricingKey(entry[0])
  );
}

// ============================================================================
// 图片生成配置 (新版)
// ============================================================================

export interface ImageGenerationConfig {
  prompt: string;
  model: ImageModel;           // 新：使用 ImageModel
  tier?: NanoTier;             // @deprecated 旧字段，兼容用
  aspectRatio: ImageAspectRatio;
  resolution?: ImageResolution;
  sourceImageUrls?: string[];
}

/** 图片模型配置项 */
/** 供应商 fallback 配置 */
export interface ImageModelFallback {
  provider: string;
  apiModel: string;
  hostname: string;
  path: string;
  nativePath?: string;
  imageSize?: string;
}

export interface ImageModelConfig {
  label: string;
  provider: string;
  apiModel: string;        // 调 API 用的 model 名
  hostname: string;        // 供应商域名
  path: string;            // API 路径
  nativePath?: string;     // 高瑞原生格式路径（支持 imageConfig）
  imageSize?: string;      // 原生格式的 imageSize 参数（如 "2K"、"4K"）
  resolution: string;      // 输出分辨率描述（UI 显示用）
  credits: number;         // 积分
  estimatedTime: string;
  stream: boolean;         // 是否需要 stream: true
  authFormat: "bearer";    // 认证格式
  fallback?: ImageModelFallback;  // 主供应商失败时的备用供应商
}

/**
 * 图片模型配置表 (新版)
 *
 * 4 个模型:
 * - GPT Image 2 (OpenAI, 默认)
 * - 1K 快速 (高瑞 flash)
 * - 2K 高清 (xas231 portrait, 默认)
 * - 4K 超清 (高瑞 pro-preview)
 */
export const IMAGE_MODEL_CONFIG: Record<ImageModel, ImageModelConfig> = {
  "gpt-image-2": {
    label: "GPT Image 2",
    provider: "openai",
    apiModel: "gpt-image-2",
    hostname: "api.openai.com",
    path: "/v1/images/generations",
    resolution: "1K/2K/4K",
    credits: IMAGE_RESOLUTION_CREDITS[DEFAULT_IMAGE_RESOLUTION],
    estimatedTime: "~30秒",
    stream: false,
    authFormat: "bearer",
  },
  "gemini-1k": {
    label: "1K 快速",
    provider: "gaorui",
    apiModel: "gemini-2.5-flash-image",
    hostname: "gaorui.cc",
    path: "/v1/chat/completions",
    nativePath: "/v1beta/models/gemini-2.5-flash-image:generateContent",
    resolution: "~1024px",
    credits: 5,
    estimatedTime: "~10秒",
    stream: true,
    authFormat: "bearer",
  },
  "gemini-2k": {
    label: "2K 高清",
    provider: "xas231",
    apiModel: "gemini-3.0-pro-image-portrait-2k",
    hostname: "api.xas231.online",
    path: "/v1/chat/completions",
    resolution: "~2048px",
    credits: 10,
    estimatedTime: "~90秒",
    stream: true,
    authFormat: "bearer",
    // 2K fallback: xas231 失败自动切高瑞
    fallback: {
      provider: "gaorui",
      apiModel: "gemini-2.5-flash-image",
      hostname: "gaorui.cc",
      path: "/v1/chat/completions",
      nativePath: "/v1beta/models/gemini-2.5-flash-image:generateContent",
    },
  },
  "gemini-4k": {
    label: "4K 超清",
    provider: "gaorui",
    apiModel: "gemini-3-pro-image-preview",
    hostname: "gaorui.cc",
    path: "/v1/chat/completions",
    nativePath: "/v1beta/models/gemini-3-pro-image-preview:generateContent",
    imageSize: "4K",
    resolution: "~4096px",
    credits: 15,
    estimatedTime: "~25秒",
    stream: true,
    authFormat: "bearer",
  },
};

/** 图片模型列表（用于 UI 渲染） */
export const IMAGE_MODELS: ImageModel[] = ["gpt-image-2", "gemini-1k", "gemini-2k", "gemini-4k"];

/** Phase2 新建图片任务只允许 OpenAI provider，Gemini 配置仅保留历史兼容 */
export const OPENAI_IMAGE_MODELS: ImageModel[] = IMAGE_MODELS.filter(
  (model) => IMAGE_MODEL_CONFIG[model].provider === "openai"
);

export function isOpenAIImageModel(model: string | null | undefined): model is ImageModel {
  return Boolean(
    model &&
    model in IMAGE_MODEL_CONFIG &&
    IMAGE_MODEL_CONFIG[model as ImageModel].provider === "openai"
  );
}

// ============================================================================
// Sora2 角色创建 (辅助接口)
// ============================================================================

/** Sora2 角色创建参数 */
export interface CharacterCreateParams {
  url: string;           // 角色视频 URL
  timestamps?: string;   // 截取范围，如 "0,3"（最多3秒）
}

/** 角色创建结果 */
export interface CharacterCreateResult {
  success: boolean;
  pid?: string;          // 角色 pid，如 "eldenzrzl.marmaladec"
  taskId?: string;
  error?: string;
}

// --- @deprecated 旧图片配置，迁移期间保留 ---

export interface NanoPricing {
  label: string;
  credits: number;
}

/** @deprecated 使用 IMAGE_MODEL_CONFIG 替代 */
export const NANO_PRICING: Record<NanoTier, NanoPricing> = {
  fast: { label: "Fast", credits: 10 },
  pro: { label: "Pro", credits: 28 },
};

/** @deprecated */
export const NANO_PRO_RESOLUTION_PRICING: Record<ImageResolution, number> = {
  "1k": 28,
  "2k": 28,
  "4k": 28,
};

/** @deprecated */
export const IMAGE_ENHANCEMENT_PRICING = {
  upscale_2k: 10,
  upscale_4k: 10,
  nine_grid: 10,
};

// ============================================================================
// 图片批量处理配置
// ============================================================================

/** 图片批量任务配置 */
export interface ImageBatchTaskConfig {
  sourceImageUrl: string; // 纯提示词模式下为空字符串
  sourceImageName: string;
  model: ImageModel | "nano-banana" | "nano-banana-pro";  // 兼容旧任务 + 新 Gemini 模型
  action: ImageProcessAction;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  prompt: string;
  characterRefUrl?: string; // 引用角色的多角度参考图 URL
  characterId?: string;
  characterName?: string;
  characterDescription?: string;
  characterReferenceImages?: string[];
  characterAsset?: import("@/lib/character-assets").CharacterAssetSnapshot;
}

/** 图片批量任务状态 */
export type ImageBatchTaskStatus = "pending" | "processing" | "completed" | "failed";

/** 图片批量任务 */
export interface ImageBatchTask {
  id: string;
  index: number;
  status: ImageBatchTaskStatus;
  config: ImageBatchTaskConfig;
  // API 任务 ID
  apiTaskId?: string;
  // 结果
  resultUrl?: string;
  error?: string;
  progress?: number;
  // 时间戳
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** NanoBanana Fast 模式动作定价 */
export interface NanoFastActionPricing {
  credits: number;
  label: string;
  description: string;
  promptHint: string;
}

/**
 * NanoBanana Fast 模式动作定价
 * Nano Banana Fast: 10 积分/次
 */
export const NANO_FAST_ACTION_PRICING: Record<ImageProcessAction, NanoFastActionPricing> = {
  generate: {
    credits: 10,
    label: "AI生成",
    description: "根据提示词和参考图生成新图片（需要提示词）",
    promptHint: "描述你想要生成的图片内容...",
  },
  upscale: {
    credits: 10,
    label: "高清放大",
    description: "将图片放大并增强清晰度（无需提示词）",
    promptHint: "",
  },
  nine_grid: {
    credits: 10,
    label: "九宫格",
    description: "适配Sora2视频的9宫格高清图，突出产品角度+细节",
    promptHint: "",
  },
};

/** NanoBanana Pro 模式动作定价 */
export interface NanoProActionPricing {
  credits: number;
  label: string;
  description: string;
  promptHint: string;
  resolutionPricing?: Record<ImageResolution, number>;
}

/**
 * NanoBanana Pro 模式动作定价
 * Nano Banana Pro: 28 积分/次
 */
export const NANO_PRO_ACTION_PRICING: Record<"generate" | "nine_grid", NanoProActionPricing> = {
  generate: {
    credits: 28,
    label: "AI生成 (Pro)",
    description: "高质量 AI 图片生成，支持更高分辨率",
    promptHint: "详细描述你想要生成的图片内容...",
    resolutionPricing: {
      "1k": 28,
      "2k": 28,
      "4k": 28,
    },
  },
  nine_grid: {
    credits: 28,
    label: "九宫格 (Pro)",
    description: "适配Sora2/Pro视频的高清9宫格图，纯白背景，便于AI精准渲染",
    promptHint: "可选：添加产品描述以提升生成效果",
    resolutionPricing: {
      "1k": 28,
      "2k": 28,
      "4k": 28,
    },
  },
};

// ============================================================================
// 选项配置
// ============================================================================

export interface AspectRatioOption {
  value: ImageAspectRatio;
  label: string;
}

export const IMAGE_ASPECT_OPTIONS: AspectRatioOption[] = [
  { value: "auto", label: "Auto" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

/** NanoBanana Fast 模式支持的比例 */
export const NANO_FAST_ASPECT_OPTIONS: AspectRatioOption[] = [
  { value: "auto", label: "自动" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

/** NanoBanana Pro 模式支持的比例 */
export const NANO_PRO_ASPECT_OPTIONS: AspectRatioOption[] = [
  { value: "auto", label: "自动" },
  { value: "1:1", label: "1:1 方形" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
];

// ============================================================================
// Gemini 图片批量 — 统一配置（替代 NANO 分离的两套配置）
// ============================================================================

/** Gemini 图片模型积分表 */
export const GEMINI_IMAGE_PRICING: Record<ImageModel, number> = {
  "gpt-image-2": IMAGE_RESOLUTION_CREDITS[DEFAULT_IMAGE_RESOLUTION],
  "gemini-1k": 5,
  "gemini-2k": 10,
  "gemini-4k": 15,
};

/** Gemini 图片批量 Action 配置（统一，不再分快速/Pro） */
export interface GeminiActionConfig {
  credits: number;  // 基础积分标记（实际按 model 的 GEMINI_IMAGE_PRICING 计算）
  label: string;
  description: string;
  promptHint: string;
}

export const GEMINI_ACTION_PRICING: Record<ImageProcessAction, GeminiActionConfig> = {
  generate: {
    credits: 0,
    label: "AI 生成",
    description: "根据提示词和参考图生成新图片",
    promptHint: "描述你想要生成的图片内容...",
  },
  upscale: {
    credits: 0,
    label: "高清放大",
    description: "将图片放大并增强清晰度（无需提示词）",
    promptHint: "",
  },
  nine_grid: {
    credits: 0,
    label: "九宫格",
    description: "适配视频的 9 宫格高清图，突出产品角度 + 细节",
    promptHint: "",
  },
};

/** Gemini 统一宽高比选项（合并 NANO_FAST + NANO_PRO） */
export const GEMINI_ASPECT_OPTIONS: AspectRatioOption[] = [
  { value: "auto", label: "自动" },
  { value: "1:1", label: "1:1 方形" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
];

export interface ResolutionOption {
  value: ImageResolution;
  label: string;
}

export const IMAGE_RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

// ============================================================================
// 计费函数
// ============================================================================

/**
 * 计算视频生成费用
 */
export function calculateVideoCost(model: VideoModelPricingKey | VideoModel): number {
  if (isVideoModelPricingKey(model)) {
    return QUICK_GEN_VIDEO_PRICING[model].credits;
  }

  const legacyPricing = VIDEO_MODEL_PRICING[model];
  if (legacyPricing) return legacyPricing.credits;

  const configuredModel = VIDEO_MODEL_CONFIG[model];
  if (configuredModel) return configuredModel.credits;

  throw new RangeError(`Unsupported video model pricing: ${model}`);
}

/**
 * 计算图片生成费用
 * 
 * 支持两种调用方式：
 * - 新版：calculateImageCost("gpt-image-2", "2k") → 按分辨率档位读取
 * - 旧版：calculateImageCost("fast", "1k", false) → 从 NANO_PRICING 读取（@deprecated）
 */
export function calculateImageCost(
  modelOrTier: ImageModel | NanoTier, 
  resolution: ImageResolution = "1k",
  isPro: boolean = false
): number {
  // 新版：模型固定 GPT Image 2，按画质档位计费。兼容旧 gemini-* 作为档位别名。
  if (modelOrTier in IMAGE_MODEL_CONFIG) {
    return getImageResolutionCost(
      getResolutionFromImageModel(modelOrTier as ImageModel) || resolution
    );
  }
  // 旧版：NanoTier 兼容（批量页面仍在用）
  const tier = modelOrTier as NanoTier;
  if (isPro) {
    return NANO_PRO_RESOLUTION_PRICING[resolution];
  }
  return NANO_PRICING[tier].credits;
}

/**
 * 计算图片增强费用
 */
export function calculateEnhancementCost(
  _type: ProcessingType,
  resolution: ImageResolution = "2k",
  batchCount: number = 1
): number {
  return getImageResolutionCost(resolution) * batchCount;
}

/**
 * 计算总费用
 */
export function calculateTotalCost(params: {
  outputMode: OutputMode;
  videoModel?: VideoModelPricingKey | VideoModel;
  imageTier?: NanoTier;
  imageResolution?: ImageResolution;
  isProImage?: boolean;
}): number {
  const { outputMode, videoModel, imageTier, imageResolution, isProImage } = params;
  
  if (outputMode === "video" && videoModel) {
    return calculateVideoCost(videoModel);
  } else if (outputMode === "image" && imageTier) {
    return calculateImageCost(imageTier, imageResolution, isProImage);
  }
  
  return 0;
}

// ============================================================================
// 时间估算
// ============================================================================

export const VIDEO_ESTIMATED_TIME: Record<number, string> = {
  10: "4-5 minutes",
  15: "5-6 minutes",
  20: "7-8 minutes",
  25: "8-10 minutes",
};

export const IMAGE_ESTIMATED_TIME = {
  fast: "15-30 seconds",
  pro: "30-60 seconds",
  enhancement: "30-60 seconds",
};

/**
 * 获取视频生成预估时间
 */
export function getVideoEstimatedTime(model: VideoModelPricingKey | VideoModel): string {
  if (isVideoModelPricingKey(model)) {
    return VIDEO_ESTIMATED_TIME[QUICK_GEN_VIDEO_PRICING[model].apiDuration] || "5-6 minutes";
  }
  const legacyPricing: VideoModelPricing | undefined = VIDEO_MODEL_PRICING[model];
  if (legacyPricing) {
    return VIDEO_ESTIMATED_TIME[legacyPricing.apiDuration] || "5-6 minutes";
  }
  const configuredModel = VIDEO_MODEL_CONFIG[model];
  if (configuredModel) {
    return VIDEO_ESTIMATED_TIME[configuredModel.duration] || "5-6 minutes";
  }
  throw new RangeError(`Unsupported video model estimate: ${model}`);
}

/**
 * 获取图片生成预估时间
 */
export function getImageEstimatedTime(tier: NanoTier): string {
  return IMAGE_ESTIMATED_TIME[tier];
}

// ============================================================================
// 批量任务接口
// ============================================================================

export interface BatchTask {
  id: string;
  index: number;
  status: GenerationStatus;
  prompt: string;
  config: VideoGenerationConfig | ImageGenerationConfig;
  taskId?: string;
  resultUrl?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BatchJob {
  id: string;
  name: string;
  outputMode: OutputMode;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  status: "pending" | "processing" | "completed" | "paused" | "cancelled";
  tasks: BatchTask[];
  createdAt: string;
  estimatedTime: string;
  totalCredits: number;
}

// ============================================================================
// API 请求/响应接口
// ============================================================================

export interface VideoGenerateRequest {
  prompt: string;
  duration: 10 | 15 | 20 | 25;
  aspectRatio: VideoAspectRatio;
  size?: "small" | "large";
  modelId?: string;
  sourceImageUrl?: string;
  userId?: string;
}

export interface ImageGenerateRequest {
  mode: "generate" | "upscale" | "nine_grid";
  prompt?: string;
  sourceImageUrl?: string | string[];
  model?: "nano-banana" | "nano-banana-pro";
  tier?: NanoTier;
  aspectRatio?: ImageAspectRatio;
  resolution?: ImageResolution;
  userId?: string;
}

export interface GenerateResponse {
  success: boolean;
  data?: {
    taskId: string;
    status: GenerationStatus;
    estimatedTime?: string;
    usePro?: boolean;
    model?: string;
  };
  error?: string;
}

export interface TaskStatusResponse {
  success: boolean;
  data?: {
    taskId: string;
    status: GenerationStatus;
    videoUrl?: string;
    imageUrl?: string;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  error?: string;
}
