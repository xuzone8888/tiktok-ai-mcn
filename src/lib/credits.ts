/**
 * 积分配置和工具函数
 * 
 * 2026-03-19 更新：新增新模型积分配置
 * 
 * 新模型积分（从 VIDEO_MODEL_CONFIG / IMAGE_MODEL_CONFIG 读取）：
 * - Sora2 10秒/15秒: 20 积分
 * - VEO3 参考图版: 10 积分
 * - VEO3 快速版: 8 积分
 * - VEO3 4K超清: 10 积分
 * - GPT Image 2: 15 积分（开发占位）
 * - Gemini 1K: 5 积分
 * - Gemini 2K: 10 积分
 * - Gemini 4K: 15 积分
 * 
 * @deprecated 旧模型积分（迁移期间保留）：
 * - sora2-10s/15s: 20 积分
 * - sora2-pro-15s-hd/25s: 320/350 积分
 * - nano-banana: 10 积分
 * - nano-banana-pro: 28 积分
 */

import { VIDEO_MODEL_CONFIG, IMAGE_MODEL_CONFIG, type VideoModel, type ImageModel } from '@/types/generation';

// ============================================================================
// 新模型积分配置（从配置表读取）
// ============================================================================

/** 获取新视频模型积分 */
export function getNewVideoCost(model: VideoModel): number {
  return VIDEO_MODEL_CONFIG[model]?.credits || 20;
}

/** 获取新图片模型积分 */
export function getNewImageCost(model: ImageModel): number {
  return IMAGE_MODEL_CONFIG[model]?.credits || 10;
}

// ============================================================================
// @deprecated 旧积分定价配置（迁移期间保留）
// ============================================================================

/** @deprecated 快速单个视频定价 */
export const QUICK_VIDEO_CREDITS = {
  "sora2-10s": 20,         // 标清 10秒
  "sora2-15s": 20,         // 标清 15秒
  "sora2-pro-15s-hd": 320, // PRO 高清 15秒
  "sora2-pro-25s": 320,    // PRO 标清 25秒
} as const;

/** @deprecated 批量生产视频定价 */
export const BATCH_VIDEO_CREDITS = {
  "sora2-10s": 20,         // 标清 10秒
  "sora2-15s": 20,         // 标清 15秒
  "sora2-pro-15s-hd": 350, // PRO 高清 15秒
  "sora2-pro-25s": 350,    // PRO 标清 25秒
} as const;

/** @deprecated 图片生成定价 */
export const IMAGE_CREDITS = {
  "nano-banana": 10,      // Nano Banana Fast
  "nano-banana-pro": 28,  // Nano Banana Pro
} as const;

/** 电商图片工厂定价 */
export const ECOM_IMAGE_CREDITS = {
  base: {
    "gpt-image-2": 15,      // 开发占位，生产定价待确认
    "gemini-1k": 5,
    "gemini-2k": 10,
    "gemini-4k": 15,
    "nano-banana": 10,      // 快速模式基础价
    "nano-banana-pro": 28,  // Pro模式基础价
  },
  // 五图套装固定5张
  ecom_five_pack: {
    "gpt-image-2": 75,      // 开发占位，生产定价待确认
    "gemini-1k": 25,
    "gemini-2k": 50,
    "gemini-4k": 75,
    "nano-banana": 50,      // 5 * 10
    "nano-banana-pro": 140, // 5 * 28
  },
} as const;

/** 视频模型类型 */
export type VideoModelKey = keyof typeof QUICK_VIDEO_CREDITS;

/** 图片模型类型 */
export type ImageModelKey = keyof typeof IMAGE_CREDITS;

// ============================================================================
// 积分计算函数
// ============================================================================

/**
 * 获取快速单个视频的积分消耗
 */
export function getQuickVideoCost(model: VideoModelKey): number {
  return QUICK_VIDEO_CREDITS[model] || 20;
}

/**
 * 获取批量生产视频的积分消耗
 */
export function getBatchVideoCost(model: VideoModelKey): number {
  return BATCH_VIDEO_CREDITS[model] || 20;
}

/**
 * 获取图片生成的积分消耗
 */
export function getImageCost(model: ImageModelKey): number {
  return IMAGE_CREDITS[model] || 10;
}

/**
 * 获取电商图片工厂的积分消耗
 * @param mode 电商图片模式
 * @param modelType 模型类型
 * @param imageCount 图片数量（五图套装固定5张）
 */
export function getEcomImageCost(
  mode: string,
  modelType: ImageModel | "nano-banana" | "nano-banana-pro",
  imageCount: number = 1
): number {
  // 五图套装固定价格
  if (mode === "ecom_five_pack") {
    return ECOM_IMAGE_CREDITS.ecom_five_pack[modelType] || 75;
  }
  
  // 其他模式按图片数量计算
  const basePrice = ECOM_IMAGE_CREDITS.base[modelType] || 15;
  return basePrice * imageCount;
}

/**
 * 根据操作类型和模型获取积分消耗
 */
export function getCreditCost(
  operationType: "quick_video" | "batch_video" | "quick_image" | "batch_image",
  model: string
): number {
  switch (operationType) {
    case "quick_video":
      return QUICK_VIDEO_CREDITS[model as VideoModelKey] || 20;
    case "batch_video":
      return BATCH_VIDEO_CREDITS[model as VideoModelKey] || 20;
    case "quick_image":
    case "batch_image":
      return IMAGE_CREDITS[model as ImageModelKey] || 10;
    default:
      return 10;
  }
}

// ============================================================================
// 积分格式化函数
// ============================================================================

/**
 * 格式化积分显示
 */
export function formatCredits(credits: number): string {
  if (credits >= 10000) {
    return `${(credits / 1000).toFixed(1)}K`;
  }
  return credits.toLocaleString();
}

/**
 * 获取视频模型显示名称
 */
export function getVideoModelLabel(model: VideoModelKey): string {
  const labels: Record<VideoModelKey, string> = {
    "sora2-10s": "Sora2 标清 10秒",
    "sora2-15s": "Sora2 标清 15秒",
    "sora2-pro-15s-hd": "Sora2 Pro 15秒高清",
    "sora2-pro-25s": "Sora2 Pro 25秒标清",
  };
  return labels[model] || model;
}

/**
 * 获取图片模型显示名称
 */
export function getImageModelLabel(model: ImageModelKey): string {
  const labels: Record<ImageModelKey, string> = {
    "nano-banana": "Nano Banana Fast",
    "nano-banana-pro": "Nano Banana Pro",
  };
  return labels[model] || model;
}

// ============================================================================
// 积分检查函数
// ============================================================================

/**
 * 检查用户积分是否足够
 */
export function hasEnoughCredits(
  userCredits: number,
  operationType: "quick_video" | "batch_video" | "quick_image" | "batch_image",
  model: string,
  quantity: number = 1
): { enough: boolean; required: number; shortage: number } {
  const unitCost = getCreditCost(operationType, model);
  const totalRequired = unitCost * quantity;
  const shortage = Math.max(0, totalRequired - userCredits);
  
  return {
    enough: userCredits >= totalRequired,
    required: totalRequired,
    shortage,
  };
}

// ============================================================================
// 前端积分API调用
// ============================================================================

/**
 * 扣除积分
 */
export async function deductCredits(params: {
  userId: string;
  operationType: "quick_video" | "batch_video" | "quick_image" | "batch_image";
  model: string;
  quantity?: number;
  description?: string;
}): Promise<{ success: boolean; data?: { before: number; after: number; deducted: number }; error?: string }> {
  try {
    const response = await fetch("/api/user/credits/deduct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("[deductCredits] Failed to parse response:", text, e);
      return { success: false, error: "服务响应格式错误" };
    }
  } catch (error) {
    console.error("[deductCredits] Error:", error);
    return { success: false, error: "网络错误" };
  }
}

/**
 * 退还积分
 */
export async function refundCredits(params: {
  userId: string;
  amount: number;
  reason?: string;
  taskId?: string;
}): Promise<{ success: boolean; data?: { before: number; after: number; refunded: number }; error?: string }> {
  try {
    const response = await fetch("/api/user/credits/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("[refundCredits] Failed to parse response:", text, e);
      return { success: false, error: "服务响应格式错误" };
    }
  } catch (error) {
    console.error("[refundCredits] Error:", error);
    return { success: false, error: "网络错误" };
  }
}

/**
 * 获取用户积分
 */
export async function getUserCredits(): Promise<{ credits: number; userId: string | null }> {
  try {
    const response = await fetch("/api/user/credits");
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("[getUserCredits] Failed to parse response:", text, e);
      return { credits: 0, userId: null };
    }
    return {
      credits: data.credits || 0,
      userId: data.userId || data.user_id || null,
    };
  } catch (error) {
    console.error("[getUserCredits] Error:", error);
    return { credits: 0, userId: null };
  }
}

