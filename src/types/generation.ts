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
export type VideoModel = 
  | "sora2-10s"       // Sora2 标清 10秒
  | "sora2-15s"       // Sora2 标清 15秒
  | "sora2-pro-15s-hd" // Sora2 Pro 15秒高清
  | "sora2-pro-25s";   // Sora2 Pro 25秒标清

/** 视频宽高比 */
export type VideoAspectRatio = "9:16" | "16:9";

/** 图片宽高比 */
export type ImageAspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9";

/** 图片分辨率 */
export type ImageResolution = "1k" | "2k" | "4k";

/** 图片处理动作 */
export type ImageProcessAction = "generate" | "upscale" | "nine_grid";

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
  apiDuration: 10 | 15 | 25;
  quality: "standard" | "hd";
  apiModel: string; // 对应 API 的模型名
}

/**
 * 视频模型定价配置
 * 
 * 快速单个视频功能扣分机制：
 * - 标准款（10秒/15秒 横/竖屏）：20 积分/条
 * - PRO 款（25秒 横/竖屏）：320 积分/条
 * - PRO 高清款（15秒 横/竖屏）：320 积分/条
 */
export const VIDEO_MODEL_PRICING: Record<VideoModel, VideoModelPricing> = {
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

/**
 * 图片生成定价配置
 * 
 * 快速单个图片/批量生产图片扣分机制：
 * - Nano Banana Fast: 10 积分/次
 * - Nano Banana Pro: 28 积分/次
 */
export const NANO_PRICING: Record<NanoTier, NanoPricing> = {
  fast: { label: "Fast", credits: 10 },
  pro: { label: "Pro", credits: 28 },
};

// Pro 版本分辨率定价
export const NANO_PRO_RESOLUTION_PRICING: Record<ImageResolution, number> = {
  "1k": 28,
  "2k": 28,
  "4k": 28,
};

// 图片增强定价
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
  model: "nano-banana" | "nano-banana-pro";
  action: ImageProcessAction;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  prompt: string;
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





