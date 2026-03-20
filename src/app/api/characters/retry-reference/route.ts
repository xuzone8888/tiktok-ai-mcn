/**
 * 角色参考图重试 API
 *
 * POST /api/characters/retry-reference
 *
 * 重新提交多角度参考图生成任务（nanoBanana），
 * 并将 reference_status 更新为 pending。
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { characterId } = body;

    if (!characterId) {
      return NextResponse.json(
        { success: false, error: "characterId is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 1. 获取角色信息
    const { data: character, error: fetchError } = await supabase
      .from("ai_models")
      .select("id, name, description, avatar_url, reference_images, dna_config, source, owner_id")
      .eq("id", characterId)
      .eq("source", "user_created")
      .single();

    if (fetchError || !character) {
      console.error("[Retry Reference] Character not found:", fetchError);
      return NextResponse.json(
        { success: false, error: "角色不存在或无权操作" },
        { status: 404 }
      );
    }

    // 2. 获取原始参考图（用于重新生成多角度参考图）
    const sourceImage = character.avatar_url
      || (Array.isArray(character.reference_images) && character.reference_images[0])
      || null;

    if (!sourceImage) {
      return NextResponse.json(
        { success: false, error: "角色缺少原始参考图，无法生成多角度参考图" },
        { status: 400 }
      );
    }

    // 3. 调用 NanoBanana API 生成多角度参考图
    const nanoApiKey = process.env.NANO_BANANA_API_KEY || "";
    const nanoApiBase = process.env.NANO_BANANA_API_ENDPOINT || "https://api.apimart.ai";

    if (!nanoApiKey) {
      return NextResponse.json(
        { success: false, error: "图片生成服务未配置" },
        { status: 500 }
      );
    }

    // 构建多角度参考图 prompt
    const characterDesc = character.description || character.name;
    const referencePrompt = `Create a multi-angle character reference sheet for: ${characterDesc}. Show front view, 3/4 view, side profile, and back view. Clean white background, consistent character design, high quality.`;

    const nanoResponse = await fetch(`${nanoApiBase}/api/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${nanoApiKey}`,
      },
      body: JSON.stringify({
        model: "nano-banana",
        prompt: referencePrompt,
        image_url: sourceImage,
        aspect_ratio: "16:9", // 横版适合多角度参考图
      }),
    });

    const nanoResult = await nanoResponse.json();
    const taskId = nanoResult?.data?.task_id || nanoResult?.task_id || null;

    if (!taskId) {
      console.error("[Retry Reference] NanoBanana failed:", nanoResult);

      // 标记为失败
      await supabase
        .from("ai_models")
        .update({ reference_status: "failed", reference_task_id: null })
        .eq("id", characterId);

      return NextResponse.json(
        { success: false, error: "参考图生成任务提交失败，请稍后重试" },
        { status: 500 }
      );
    }

    // 4. 更新角色状态为 pending
    const { error: updateError } = await supabase
      .from("ai_models")
      .update({
        reference_status: "pending",
        reference_task_id: taskId,
      })
      .eq("id", characterId);

    if (updateError) {
      console.error("[Retry Reference] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "状态更新失败" },
        { status: 500 }
      );
    }

    console.log("[Retry Reference] Task submitted:", { characterId, taskId });

    return NextResponse.json({
      success: true,
      data: { taskId, status: "pending" },
    });
  } catch (error) {
    console.error("[Retry Reference] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
