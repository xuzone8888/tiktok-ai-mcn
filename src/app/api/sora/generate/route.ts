import { NextRequest, NextResponse } from "next/server";
import {
  createSoraTask,
  getCreditsPrice,
  VideoDuration,
  CREDITS_PRICING,
} from "@/lib/sora-api";
import { mockUser } from "@/lib/mock-data";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, duration, model_id, product_id, aspect_ratio } = body;

    // 验证必填参数
    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // 验证时长参数
    const validDurations: VideoDuration[] = ["5s", "10s", "15s", "20s"];
    const videoDuration: VideoDuration = validDurations.includes(duration) 
      ? duration 
      : "10s";

    // 计算所需积分
    const creditsRequired = getCreditsPrice(videoDuration);

    // 检查用户积分
    if (mockUser.credits < creditsRequired) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: creditsRequired,
          available: mockUser.credits,
        },
        { status: 400 }
      );
    }

    // 扣除积分
    mockUser.credits -= creditsRequired;

    // 创建 Sora 生成任务
    const result = await createSoraTask(mockUser.id, {
      prompt,
      duration: videoDuration,
      model_id,
      product_id,
      aspect_ratio: aspect_ratio || "9:16",
    });

    if (!result.success || !result.task) {
      // 退还积分
      mockUser.credits += creditsRequired;
      return NextResponse.json(
        { error: result.error || "Failed to create generation task" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      task_id: result.task.id,
      status: result.task.status,
      credits_used: creditsRequired,
      new_balance: mockUser.credits,
      pricing: CREDITS_PRICING,
    });
  } catch (error: any) {
    console.error("[Sora Generate API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// GET: 获取积分定价
export async function GET() {
  return NextResponse.json({
    pricing: CREDITS_PRICING,
    user_credits: mockUser.credits,
  });
}



