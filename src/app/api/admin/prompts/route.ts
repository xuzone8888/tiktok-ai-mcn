/**
 * 提示词配置 API
 * 
 * GET /api/admin/prompts - 获取当前提示词配置
 * POST /api/admin/prompts - 保存提示词配置
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 默认提示词配置
export const DEFAULT_PROMPTS = {
  talkingScriptSystem: `You are a professional short-form video script generator for TikTok e-commerce. You create engaging, viral-style product recommendation scripts that follow TikTok trends and best practices.`,
  
  talkingScriptUser: `Based on all the product images provided (the first image is a 3x3 high-resolution grid showing multiple angles of the product, and the following images provide extra details and usage scenes), extract the core selling points and write a TikTok selfie-style talking-head product recommendation script in English.

Requirements:
- Platform: TikTok short video product promotion, compliant with TikTok e-commerce and ad policies.
- Duration: about 15 seconds in total.
- Split the script into exactly 7 consecutive simple shots.
- For each shot, provide:
  - a shot code: C01, C02, C03, C04, C05, C06, C07
  - a visual description (what we see, framing, camera angle, product position)
  - detailed action of the creator (body movement, facial expression)
  - the spoken line in natural English (first person, influencer tone, very convincing and enthusiastic).
- The opening must be fun, eye-catching, and hook the viewer in the first seconds.
- The content must strongly plant the desire to buy, highlight benefits and key features clearly.
- Use simple, easy-to-understand language suitable for a broad TikTok audience.
- Do NOT include any explanations, comments, or meta text.
- Do NOT output any headings like 'Shot 1' or 'Explanation'.
- Output only the script content itself.
- Each shot should start with the shot code like: 'C01: ...', 'C02: ...', up to 'C07: ...'.`,

  aiVideoPromptSystem: `You are a TikTok e-commerce creator and AI video director. You specialize in turning talking-head product recommendation scripts into detailed shot-by-shot prompts for AI video generation models like Sora.`,

  aiVideoPromptUser: `Below is a 7-shot TikTok talking-head product recommendation script, with shot codes C01 to C07:

{{SCRIPT}}

Please rewrite this into an English, shot-by-shot AI video generation prompt suitable for a model like Sora2 Pro.

Requirements:
- Keep exactly 7 shots with the same shot codes: C01, C02, C03, C04, C05, C06, C07.
- For each shot, describe:
  - the camera framing and angle (e.g. close-up, medium shot, handheld, selfie angle),
  - the environment and background (e.g. bedroom, street, studio, etc.),
  - the lighting style and mood,
  - the creator's appearance, outfit, and key actions,
  - how the product is shown in the frame,
  - timing and pacing so that the total duration is about 15 seconds.
- Also suggest the style of background music for the entire video (mood, tempo, instruments), integrated into the description.
- Follow the logic of viral TikTok short videos:
  - very strong hook in C01,
  - show clear benefits and key features in the next shots,
  - end with a strong call-to-action and emotional push to buy.
- Do NOT output any tables.
- Do NOT include meta explanations or comments.
- Output only the final AI video prompt content.
- Each shot should start with its code like: 'C01: ...', 'C02: ...', etc.`,
};

// 内存缓存（生产环境应使用数据库）
let cachedPrompts = { ...DEFAULT_PROMPTS };

// GET - 获取提示词配置
export async function GET() {
  try {
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

    // 返回缓存或默认值
    return NextResponse.json({
      success: true,
      data: cachedPrompts,
    });
  } catch (error) {
    console.error("[Prompts API] Error loading prompts:", error);
    return NextResponse.json({
      success: true,
      data: cachedPrompts,
    });
  }
}

// POST - 保存提示词配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { talkingScriptSystem, talkingScriptUser, aiVideoPromptSystem, aiVideoPromptUser } = body;

    const prompts = {
      talkingScriptSystem: talkingScriptSystem || DEFAULT_PROMPTS.talkingScriptSystem,
      talkingScriptUser: talkingScriptUser || DEFAULT_PROMPTS.talkingScriptUser,
      aiVideoPromptSystem: aiVideoPromptSystem || DEFAULT_PROMPTS.aiVideoPromptSystem,
      aiVideoPromptUser: aiVideoPromptUser || DEFAULT_PROMPTS.aiVideoPromptUser,
    };

    // 更新缓存
    cachedPrompts = prompts;

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
        // 即使数据库保存失败，缓存已更新，功能仍可用
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

// 导出获取提示词的函数供其他模块使用
export function getPrompts() {
  return cachedPrompts;
}



