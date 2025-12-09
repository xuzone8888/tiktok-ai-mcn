/**
 * 积分配置和工具函数
 * 
 * 积分扣分规则：
 * 
 * 1. 快速单个视频功能扣分机制
 *    - 标准款（10秒/15秒 横/竖屏）：20 积分/条
 *    - PRO款（25秒 横/竖屏）：320 积分/条
 *    - PRO高清款（15秒 横/竖屏）：320 积分/条
 * 
 * 2. 快速单个图片功能扣分机制
 *    - Nano Banana Fast: 10 积分/次
 *    - Nano Banana Pro: 28 积分/次
 * 
 * 3. 批量生产图片
 *    - Nano Banana: 10 积分/次
 *    - Nano Banana Pro: 28 积分/次
 * 
 * 4. 批量生产视频
 *    - 标准款（10秒/15秒 横/竖屏）：20 积分/条
 *    - PRO款（25秒 横/竖屏）：350 积分/条
 *    - PRO高清款（15秒 横/竖屏）：350 积分/条
 */

// ============================================================================
// 积分定价配置
// ============================================================================

/** 快速单个视频定价 */
export const QUICK_VIDEO_CREDITS = {
  "sora2-10s": 20,         // 标清 10秒
  "sora2-15s": 20,         // 标清 15秒
  "sora2-pro-15s-hd": 320, // PRO 高清 15秒
  "sora2-pro-25s": 320,    // PRO 标清 25秒
} as const;

/** 批量生产视频定价 */
export const BATCH_VIDEO_CREDITS = {
  "sora2-10s": 20,         // 标清 10秒
  "sora2-15s": 20,         // 标清 15秒
  "sora2-pro-15s-hd": 350, // PRO 高清 15秒
  "sora2-pro-25s": 350,    // PRO 标清 25秒
} as const;

/** 图片生成定价（快速单个图片/批量生产图片通用） */
export const IMAGE_CREDITS = {
  "nano-banana": 10,      // Nano Banana Fast
  "nano-banana-pro": 28,  // Nano Banana Pro
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


