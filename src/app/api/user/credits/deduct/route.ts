/**
 * 积分扣除 API
 * 
 * POST /api/user/credits/deduct - 扣除积分
 * 
 * 积分扣分规则：
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

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 积分定价配置
// ============================================================================

export const CREDIT_PRICING = {
  // 快速单个视频
  quickVideo: {
    "sora2-10s": 20,
    "sora2-15s": 20,
    "sora2-pro-15s-hd": 320,
    "sora2-pro-25s": 320,
  },
  
  // 批量生产视频
  batchVideo: {
    "sora2-10s": 20,
    "sora2-15s": 20,
    "sora2-pro-15s-hd": 350,
    "sora2-pro-25s": 350,
  },
  
  // 图片生成
  image: {
    "nano-banana-fast": 10,
    "nano-banana-pro": 28,
  },
};

// 操作类型
export type OperationType = 
  | "quick_video"
  | "batch_video"
  | "quick_image"
  | "batch_image";

// 请求体类型
interface DeductRequest {
  userId: string;
  operationType: OperationType;
  model: string;
  quantity?: number;
  description?: string;
}

/**
 * 根据操作类型和模型获取积分消耗
 */
export function getCreditCost(operationType: OperationType, model: string): number {
  switch (operationType) {
    case "quick_video":
      return CREDIT_PRICING.quickVideo[model as keyof typeof CREDIT_PRICING.quickVideo] || 20;
    case "batch_video":
      return CREDIT_PRICING.batchVideo[model as keyof typeof CREDIT_PRICING.batchVideo] || 20;
    case "quick_image":
    case "batch_image":
      return CREDIT_PRICING.image[model as keyof typeof CREDIT_PRICING.image] || 10;
    default:
      return 10;
  }
}

// ============================================================================
// POST - 扣除积分
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: DeductRequest = await request.json();
    const { userId, operationType, model, quantity = 1, description } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "用户ID不能为空" },
        { status: 400 }
      );
    }

    if (!operationType || !model) {
      return NextResponse.json(
        { success: false, error: "操作类型和模型名称不能为空" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 获取用户当前积分
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[Deduct Credits] Error fetching profile:", profileError);
      return NextResponse.json(
        { success: false, error: "用户不存在" },
        { status: 404 }
      );
    }

    const currentCredits = profile.credits;
    const unitCost = getCreditCost(operationType, model);
    const totalCost = unitCost * quantity;

    // 检查积分是否足够
    if (currentCredits < totalCost) {
      return NextResponse.json(
        { 
          success: false, 
          error: `积分不足！需要 ${totalCost} 积分，当前余额 ${currentCredits}`,
          required: totalCost,
          current: currentCredits,
        },
        { status: 400 }
      );
    }

    // 扣除积分
    const newCredits = currentCredits - totalCost;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (updateError) {
      console.error("[Deduct Credits] Error updating credits:", updateError);
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
      );
    }

    console.log("[Deduct Credits] Success:", {
      userId,
      operationType,
      model,
      quantity,
      unitCost,
      totalCost,
      before: currentCredits,
      after: newCredits,
      description,
    });

    return NextResponse.json({
      success: true,
      data: {
        before: currentCredits,
        after: newCredits,
        deducted: totalCost,
        unitCost,
        quantity,
      },
    });
  } catch (error) {
    console.error("[Deduct Credits] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}


