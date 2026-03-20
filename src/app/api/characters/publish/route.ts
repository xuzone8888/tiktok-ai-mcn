/**
 * 角色发布/下架 API
 *
 * POST /api/characters/publish — 发布角色到广场
 * DELETE /api/characters/publish — 从广场下架
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST: 发布到广场
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { characterId, price, userId } = body;

    if (!characterId || !userId) {
      return NextResponse.json(
        { success: false, error: "characterId and userId are required" },
        { status: 400 }
      );
    }

    const publishPrice = Math.max(0, Math.round(price || 100));

    const supabase = createAdminClient();

    // 1. 校验角色归属
    const { data: character, error: fetchError } = await supabase
      .from("ai_models")
      .select("id, name, source, owner_id, is_public, reference_status, publish_price")
      .eq("id", characterId)
      .single();

    if (fetchError || !character || character.source !== "user_created" || character.owner_id !== userId) {
      console.error("[Publish] Character not found:", fetchError);
      return NextResponse.json(
        { success: false, error: "角色不存在或无权操作" },
        { status: 404 }
      );
    }

    // 2. 检查参考图状态 — 只有 completed 或 none 可以发布
    if (character.reference_status === "pending") {
      return NextResponse.json(
        { success: false, error: "参考图正在生成中，请等待完成后再发布" },
        { status: 400 }
      );
    }

    if (character.is_public) {
      return NextResponse.json(
        { success: false, error: "该角色已发布到广场" },
        { status: 400 }
      );
    }

    // 3. 发布
    const { error: updateError } = await supabase
      .from("ai_models")
      .update({
        is_public: true,
        publish_price: publishPrice,
        is_active: true,
      })
      .eq("id", characterId);

    if (updateError) {
      console.error("[Publish] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "发布失败" },
        { status: 500 }
      );
    }

    console.log("[Publish] Character published:", {
      characterId,
      name: character.name,
      price: publishPrice,
    });

    return NextResponse.json({
      success: true,
      data: { characterId, publish_price: publishPrice, is_public: true },
    });
  } catch (error) {
    console.error("[Publish] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: 从广场下架
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const characterId = searchParams.get("characterId");
    const userId = searchParams.get("userId");

    if (!characterId || !userId) {
      return NextResponse.json(
        { success: false, error: "characterId and userId are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 1. 校验角色归属
    const { data: character, error: fetchError } = await supabase
      .from("ai_models")
      .select("id, name, source, owner_id, is_public")
      .eq("id", characterId)
      .single();

    if (fetchError || !character || character.source !== "user_created" || character.owner_id !== userId) {
      return NextResponse.json(
        { success: false, error: "角色不存在或无权操作" },
        { status: 404 }
      );
    }

    if (!character.is_public) {
      return NextResponse.json(
        { success: false, error: "该角色未发布到广场" },
        { status: 400 }
      );
    }

    // 2. 下架
    const { error: updateError } = await supabase
      .from("ai_models")
      .update({ is_public: false })
      .eq("id", characterId);

    if (updateError) {
      console.error("[Unpublish] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "下架失败" },
        { status: 500 }
      );
    }

    console.log("[Unpublish] Character unpublished:", {
      characterId,
      name: character.name,
    });

    return NextResponse.json({
      success: true,
      data: { characterId, is_public: false },
    });
  } catch (error) {
    console.error("[Unpublish] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
