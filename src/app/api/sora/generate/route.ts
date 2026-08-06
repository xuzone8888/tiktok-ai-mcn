/**
 * @deprecated 2026-03-19 — 已废弃，由 /api/generate/video 替代
 *
 * Sora 视频生成 API（旧版路由，保留仅供历史兼容）
 *
 * 注意: sora-api.ts 已删除，此路由不再可用。
 * 如需恢复，请参考 suchuang-api.ts (submitSora2) 或 sora-api-real.ts。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** @deprecated 旧版类型 */
type VideoDuration = "5s" | "10s" | "15s" | "20s";

/** @deprecated 旧版定价 */
const CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

export async function POST() {
  return NextResponse.json(
    { error: "此接口已废弃，请使用新版批量视频生成接口" },
    { status: 410 }
  );
}

// GET: 获取积分定价
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
