/**
 * Generation Types & Utilities
 * 
 * 共享的生成类型定义和计费逻辑
 * 用于 Quick Generator 和 Pro Studio (Batch) 页面
 */

// ============================================================================
// 基础类型定义
// ============================================================================

/** 输出模式 */
export type OutputMode = "video" | "image";

/** 图片来源类型 */
export type SourceType = "local_upload" | "nano_banana";

/** NanoBanana 质量层级 */
export type NanoTier = "fast" | "pro";

/** 图片处理类型 */
export type ProcessingType = "upscale" | "9grid";

/** 视频模型选项 */
export type VideoModel = "sora-2" | "sora-2-pro-15" | "sora-2-pro-25";

/** 视频宽高比 */
export type VideoAspectRatio = "9:16" | "16:9";

/** 图片宽高比 */
export type ImageAspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9";

/** 图片分辨率 */
export type ImageResolution = "1k" | "2k" | "4k";

/** AI 模特选择模式 */
export type AiCastMode = "auto" | "team" | "all";

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
}

// ============================================================================
// 视频生成配置
// ============================================================================

export interface VideoGenerationConfig {
  prompt: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  sourceImageUrl?: string;
  modelId?: string;  // AI 模特 ID
}

export interface VideoModelPricing {
  label: string;
  duration: string;
  credits: number;
  apiDuration: 10 | 15 | 20 | 25;
}

export const VIDEO_MODEL_PRICING: Record<VideoModel, VideoModelPricing> = {
  "sora-2": { label: "Sora 2 Standard", duration: "10s", credits: 30, apiDuration: 10 },
  "sora-2-pro-15": { label: "Sora 2 Pro", duration: "15s", credits: 50, apiDuration: 15 },
  "sora-2-pro-25": { label: "Sora 2 Pro", duration: "25s", credits: 350, apiDuration: 25 },
};

// ============================================================================
// 图片生成配置
// ============================================================================

export interface ImageGenerationConfig {
  prompt: string;
  tier: NanoTier;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  sourceImageUrls?: string[];
}

export interface NanoPricing {
  label: string;
  credits: number;
}

export const NANO_PRICING: Record<NanoTier, NanoPricing> = {
  fast: { label: "Fast", credits: 10 },
  pro: { label: "Pro", credits: 28 },
};

// Pro 版本分辨率定价
export const NANO_PRO_RESOLUTION_PRICING: Record<ImageResolution, number> = {
  "1k": 30,
  "2k": 50,
  "4k": 80,
};

// 图片增强定价
export const IMAGE_ENHANCEMENT_PRICING = {
  upscale_2k: 40,
  upscale_4k: 70,
  nine_grid: 60,
};

// ============================================================================
// 图片处理类型 (批量处理单元)
// ============================================================================

/** 图片处理动作类型 */
export type ImageProcessAction = "generate" | "upscale" | "nine_grid";

/** 图片批量任务配置 */
export interface ImageBatchTaskConfig {
  sourceImageUrl: string;
  sourceImageName: string;
  model: "nano-banana" | "nano-banana-pro";
  action: ImageProcessAction;
  aspectRatio: ImageAspectRatio;
  resolution?: ImageResolution; // 仅 Pro 模式
  prompt?: string;
}

/** 图片批量任务 */
export interface ImageBatchTask {
  id: string;
  index: number;
  status: "pending" | "processing" | "completed" | "failed";
  config: ImageBatchTaskConfig;
  apiTaskId?: string;
  resultUrl?: string;
  error?: string;
  progress?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ============================================================================
// 选项配置
// ============================================================================

export interface AspectRatioOption {
  value: ImageAspectRatio;
  label: string;
  icon?: string;
}

/** Nano Banana (快速) 支持的尺寸比例 */
export const NANO_FAST_ASPECT_OPTIONS: AspectRatioOption[] = [
  { value: "auto", label: "自动", icon: "🔄" },
  { value: "1:1", label: "1:1 正方形", icon: "⬜" },
  { value: "16:9", label: "16:9 横屏", icon: "🖥️" },
  { value: "9:16", label: "9:16 竖屏", icon: "📱" },
  { value: "4:3", label: "4:3 横屏", icon: "📺" },
  { value: "3:4", label: "3:4 竖屏", icon: "📋" },
];

/** Nano Banana Pro (专业) 支持的尺寸比例 - 包含所有快速版比例 */
export const NANO_PRO_ASPECT_OPTIONS: AspectRatioOption[] = [
  ...NANO_FAST_ASPECT_OPTIONS,
];

/** 兼容旧代码的别名 */
export const IMAGE_ASPECT_OPTIONS = NANO_FAST_ASPECT_OPTIONS;

export interface ResolutionOption {
  value: ImageResolution;
  label: string;
  description?: string;
}

export const IMAGE_RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: "1k", label: "1K", description: "默认 · 1024px" },
  { value: "2k", label: "2K", description: "高清 · 2048px" },
  { value: "4k", label: "4K", description: "超清 · 4096px" },
];

// ============================================================================
// 图片处理动作定价
// ============================================================================

export interface ImageActionPricing {
  label: string;
  description: string;
  credits: number;
  estimatedTime: string;
  promptHint?: string;
}

/** Nano Banana (快速) 处理动作定价 */
export const NANO_FAST_ACTION_PRICING: Record<ImageProcessAction, ImageActionPricing> = {
  generate: {
    label: "图片生成",
    description: "根据提示词生成新图片",
    credits: 10,
    estimatedTime: "15-30秒",
    promptHint: "描述你想要的图片效果...",
  },
  upscale: {
    label: "高清放大",
    description: "将产品图片放大至高清画质，保持细节清晰",
    credits: 40,
    estimatedTime: "30-60秒",
    promptHint: "High resolution upscale, enhance details, sharp edges, professional product photography",
  },
  nine_grid: {
    label: "九宫格多角度",
    description: "生成产品的9个不同角度展示图，便于 Sora2 读取生成视频",
    credits: 60,
    estimatedTime: "45-90秒",
    promptHint: "Product displayed from 9 different angles in a 3x3 grid layout: front view, back view, left side, right side, top view, bottom view, 45-degree front-left, 45-degree front-right, detail close-up. Professional studio lighting, white background, consistent product positioning",
  },
};

/** Nano Banana Pro (专业) 处理动作定价 */
export const NANO_PRO_ACTION_PRICING: Record<"generate" | "nine_grid", ImageActionPricing & { resolutionPricing?: Record<ImageResolution, number> }> = {
  generate: {
    label: "专业图片生成",
    description: "高质量图片生成，支持多种分辨率输出",
    credits: 28,
    estimatedTime: "30-60秒",
    promptHint: "描述你想要的图片效果...",
    resolutionPricing: { "1k": 30, "2k": 50, "4k": 80 },
  },
  nine_grid: {
    label: "专业九宫格",
    description: "高质量多角度产品展示，支持高分辨率输出",
    credits: 80,
    estimatedTime: "60-120秒",
    promptHint: "Product displayed from 9 different angles in a 3x3 grid layout: front view, back view, left side, right side, top view, bottom view, 45-degree front-left, 45-degree front-right, detail close-up. Professional studio lighting, white background, consistent product positioning, high detail, 8K quality",
    resolutionPricing: { "1k": 80, "2k": 120, "4k": 180 },
  },
};

// ============================================================================
// 计费函数
// ============================================================================

/**
 * 计算视频生成费用
 */
export function calculateVideoCost(model: VideoModel): number {
  return VIDEO_MODEL_PRICING[model].credits;
}

/**
 * 计算图片生成费用
 */
export function calculateImageCost(
  tier: NanoTier, 
  resolution: ImageResolution = "1k",
  isPro: boolean = false
): number {
  if (isPro) {
    return NANO_PRO_RESOLUTION_PRICING[resolution];
  }
  return NANO_PRICING[tier].credits;
}

/**
 * 计算图片增强费用
 */
export function calculateEnhancementCost(
  type: ProcessingType, 
  resolution: ImageResolution = "2k",
  batchCount: number = 1
): number {
  let baseCost: number;
  
  if (type === "upscale") {
    baseCost = resolution === "4k" 
      ? IMAGE_ENHANCEMENT_PRICING.upscale_4k 
      : IMAGE_ENHANCEMENT_PRICING.upscale_2k;
  } else {
    baseCost = IMAGE_ENHANCEMENT_PRICING.nine_grid;
  }
  
  return baseCost * batchCount;
}

/**
 * 计算总费用
 */
export function calculateTotalCost(params: {
  outputMode: OutputMode;
  videoModel?: VideoModel;
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
export function getVideoEstimatedTime(model: VideoModel): string {
  const duration = VIDEO_MODEL_PRICING[model].apiDuration;
  return VIDEO_ESTIMATED_TIME[duration] || "5-6 minutes";
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





