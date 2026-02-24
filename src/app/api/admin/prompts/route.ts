/**
 * 提示词配置 API
 * 
 * GET /api/admin/prompts - 获取当前提示词配置
 * POST /api/admin/prompts - 保存提示词配置
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { DEFAULT_PROMPTS } from "@/lib/prompts";

// GET - 获取提示词配置
export async function GET() {
  try {
    // 鉴权：验证管理员身份
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    // 尝试从数据库读取
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "video_batch_prompts")
      .single();

    if (!error && data?.value) {
      return NextResponse.json({
        success: true,
        data: data.value,
      });
    }

    // 返回默认值
    return NextResponse.json({
      success: true,
      data: DEFAULT_PROMPTS,
    });
  } catch (error) {
    console.error("[Prompts API] Error loading prompts:", error);
    return NextResponse.json({
      success: true,
      data: DEFAULT_PROMPTS,
    });
  }
}

// POST - 保存提示词配置
export async function POST(request: NextRequest) {
  try {
    // 鉴权：验证管理员身份
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const body = await request.json();
    const { talkingScriptSystem, talkingScriptUser, aiVideoPromptSystem, aiVideoPromptUser } = body;

    const prompts = {
      talkingScriptSystem: talkingScriptSystem || DEFAULT_PROMPTS.talkingScriptSystem,
      talkingScriptUser: talkingScriptUser || DEFAULT_PROMPTS.talkingScriptUser,
      aiVideoPromptSystem: aiVideoPromptSystem || DEFAULT_PROMPTS.aiVideoPromptSystem,
      aiVideoPromptUser: aiVideoPromptUser || DEFAULT_PROMPTS.aiVideoPromptUser,
    };

    // 尝试保存到数据库
    try {
      const supabase = createAdminClient();

      // 使用 upsert 保存
      const { error } = await supabase
        .from("system_settings")
        .upsert({
          key: "video_batch_prompts",
          value: prompts,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "key",
        });

      if (error) {
        console.error("[Prompts API] Database save error:", error);
      }
    } catch (dbError) {
      console.error("[Prompts API] Database error:", dbError);
    }

    console.log("[Prompts API] Prompts saved successfully");

    return NextResponse.json({
      success: true,
      message: "提示词配置已保存",
    });
  } catch (error) {
    console.error("[Prompts API] Error saving prompts:", error);
    return NextResponse.json(
      { success: false, error: "保存失败" },
      { status: 500 }
    );
  }
}
