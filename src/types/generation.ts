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

export interface ResolutionOption {
  value: ImageResolution;
  label: string;
}

export const IMAGE_RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: "1k", label: "1K (Default)" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

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

