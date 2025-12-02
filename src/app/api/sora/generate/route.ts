/**
 * Sora 视频生成 API
 * 
 * POST /api/sora/generate - 创建视频生成任务
 * GET /api/sora/generate - 获取积分定价
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createSoraTask,
  getCreditsPrice,
  VideoDuration,
  CREDITS_PRICING,
} from "@/lib/sora-api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401 }
      );
    }

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

    // 获取用户积分
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "用户不存在" },
        { status: 404 }
      );
    }

    // 检查用户积分
    if (profile.credits < creditsRequired) {
      return NextResponse.json(
        {
          error: "积分不足",
          required: creditsRequired,
          available: profile.credits,
        },
        { status: 400 }
      );
    }

    // 使用 admin client 扣除积分
    const adminSupabase = createAdminClient();
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: profile.credits - creditsRequired })
      .eq("id", user.id);

    if (deductError) {
      console.error("[Sora Generate API] Failed to deduct credits:", deductError);
      return NextResponse.json(
        { error: "扣除积分失败" },
        { status: 500 }
      );
    }

    // 创建 Sora 生成任务
    const result = await createSoraTask(user.id, {
      prompt,
      duration: videoDuration,
      model_id,
      product_id,
      aspect_ratio: aspect_ratio || "9:16",
    });

    if (!result.success || !result.task) {
      // 退还积分
      await adminSupabase
        .from("profiles")
        .update({ credits: profile.credits })
        .eq("id", user.id);

      return NextResponse.json(
        { error: result.error || "创建任务失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      task_id: result.task.id,
      status: result.task.status,
      credits_used: creditsRequired,
      new_balance: profile.credits - creditsRequired,
      pricing: CREDITS_PRICING,
    });
  } catch (error: unknown) {
    console.error("[Sora Generate API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

// GET: 获取积分定价
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let userCredits = 0;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();
      
      userCredits = profile?.credits || 0;
    }

    return NextResponse.json({
      pricing: CREDITS_PRICING,
      user_credits: userCredits,
    });
  } catch (error) {
    console.error("[Sora Generate API] Error:", error);
    return NextResponse.json({
      pricing: CREDITS_PRICING,
      user_credits: 0,
    });
  }
}
