/**
 * 角色参考图重试 API
 *
 * POST /api/characters/retry-reference
 *
 * 使用 GPTImage2 重新生成多角度参考图，并写回 reference_sheet_url。
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateGptImage2 } from "@/lib/video-models/platform-image-client";

export const dynamic = "force-dynamic";
export const maxDuration = 420;

const MULTI_ANGLE_REFERENCE_PROMPT = `
Create a multi-angle character reference sheet for the exact same character shown in the reference image.
Show front view, left and right 3/4 views, side profile, back view, plus close-up face angles.
Use a clean white background, clear panel separation, consistent lighting, and preserve the exact face, body proportions, outfit, colors, accessories, and rendering style from the source image.
The result must be suitable as a character reference sheet for video generation.`;

function getFirstReferenceImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first : null;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return getFirstReferenceImage(parsed);
    } catch {
      return value;
    }
  }
  return null;
}

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

    const authSupabase = await createClient();
    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
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

    if (character.owner_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "角色不存在或无权操作" },
        { status: 404 }
      );
    }

    // 2. 获取原始参考图（用于重新生成多角度参考图）
    const sourceImage = character.avatar_url
      || getFirstReferenceImage(character.reference_images)
      || null;

    if (!sourceImage) {
      return NextResponse.json(
        { success: false, error: "角色缺少原始参考图，无法生成多角度参考图" },
        { status: 400 }
      );
    }

    await supabase
      .from("ai_models")
      .update({ reference_status: "pending", reference_task_id: null })
      .eq("id", characterId);

    // 3. 调用 GPTImage2 生成多角度参考图
    const characterDesc = character.description || character.name;
    const referencePrompt = `${MULTI_ANGLE_REFERENCE_PROMPT}\n\nCharacter description: ${characterDesc}`;

    const referenceResult = await generateGptImage2({
      prompt: referencePrompt,
      sourceImageUrls: [sourceImage],
      aspectRatio: "16:9",
      purpose: "character-reference",
      userId: user.id,
      maxPollMs: 360_000,
    });

    if (!referenceResult.success || !referenceResult.imageUrl) {
      await supabase
        .from("ai_models")
        .update({ reference_status: "failed", reference_task_id: null })
        .eq("id", characterId);

      return NextResponse.json(
        { success: false, error: referenceResult.error || "参考图生成失败，请稍后重试" },
        { status: 500 }
      );
    }

    // 4. 写回完成状态
    const { error: updateError } = await supabase
      .from("ai_models")
      .update({
        reference_sheet_url: referenceResult.imageUrl,
        reference_status: "completed",
        reference_task_id: referenceResult.taskId || null,
      })
      .eq("id", characterId);

    if (updateError) {
      console.error("[Retry Reference] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "状态更新失败" },
        { status: 500 }
      );
    }

    console.log("[Retry Reference] Reference regenerated:", { characterId });

    return NextResponse.json({
      success: true,
      data: {
        taskId: referenceResult.taskId || null,
        status: "completed",
        referenceImageUrl: referenceResult.imageUrl,
      },
    });
  } catch (error) {
    console.error("[Retry Reference] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
