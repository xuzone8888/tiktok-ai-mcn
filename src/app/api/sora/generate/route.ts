/**
 * @deprecated 2026-03-19 — 已废弃，由 /api/generate/video 替代
 *
 * Sora 视频生成 API（旧版路由，保留仅供历史兼容）
 *
 * 注意: sora-api.ts 已删除，此路由不再可用。
 * 如需恢复，请参考 suchuang-api.ts (submitSora2) 或 sora-api-real.ts。
 */

import { NextRequest, NextResponse } from "next/server";

/** @deprecated 旧版类型 */
type VideoDuration = "5s" | "10s" | "15s" | "20s";

/** @deprecated 旧版定价 */
const CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

function getCreditsPrice(duration: VideoDuration): number {
  return CREDITS_PRICING[duration];
}

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

    // 此路由已废弃，createSoraTask 已移除
    // 请使用 /api/video-batch/generate-sora-video 或 /api/generate/video
    return NextResponse.json(
      { error: "此接口已废弃，请使用新版批量视频生成接口" },
      { status: 410 }
    );
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
