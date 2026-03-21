/**
 * 角色 CRUD API
 *
 * GET  /api/characters?userId=xxx — 获取用户自建角色列表
 * POST /api/characters             — 创建（保存）新角色
 * DELETE /api/characters?id=xxx&userId=xxx — 删除角色
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CreateCharacterRequest } from "@/types/character";

export const dynamic = "force-dynamic";

// ============================================================================
// GET — 获取用户自建角色列表
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("ai_models")
      .select("*")
      .eq("source", "user_created")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Characters API] GET error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("[Characters API] GET unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST — 创建（保存）新角色
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: CreateCharacterRequest = await request.json();

    const {
      userId,
      name,
      description = "",
      avatar_url,
      reference_images,
      preview_video_url,
      character_type,
      dna_config,
      style_tags = [],
      gender,
      age_range,
      // 多角度参考图状态
      reference_sheet_url,
      reference_status,
      reference_task_id,
    } = body;

    // 参数校验
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "角色名称不能为空" },
        { status: 400 }
      );
    }
    if (!reference_images || reference_images.length === 0) {
      return NextResponse.json(
        { success: false, error: "至少需要一张参考图" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 写入 ai_models 表
    const insertData = {
      name: name.trim(),
      description,
      // avatar_url = Hero Shot 4K（展示用）
      avatar_url: avatar_url || reference_images[0],
      reference_images: reference_images as unknown as import("@/types/database").Json,
      preview_video_url: preview_video_url || null,
      character_type: character_type || "realistic",
      dna_config: (dna_config || {}) as unknown as import("@/types/database").Json,
      style_tags,
      gender: (gender || null) as "male" | "female" | "neutral" | null,
      age_range: age_range || null,
      // 多角度参考图状态
      reference_sheet_url: reference_sheet_url || null,
      reference_status: reference_status || "none",
      reference_task_id: reference_task_id || null,
      // 角色归属
      source: "user_created" as const,
      owner_id: userId,
      is_active: true,
      is_public: false,
      publish_price: 100,
      // 自建角色不计价（通过广场 publish_price 单独定价）
      price_daily: 0,
      price_weekly: 0,
      price_monthly: 0,
      price_yearly: 0,
      // 默认分类
      category: character_type === "animal" ? "动物角色" : "自建角色",
    };

    console.log("[Characters API] Creating character:", {
      userId,
      name: insertData.name,
      character_type: insertData.character_type,
      imagesCount: reference_images.length,
    });

    const { data, error } = await supabase
      .from("ai_models")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      console.error("[Characters API] POST insert error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log("[Characters API] Character created:", data.id);

    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (error) {
    console.error("[Characters API] POST unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH — 更新角色字段（如 preview_video_url）
// ============================================================================

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { characterId, userId, preview_video_url } = body as {
      characterId: string;
      userId: string;
      preview_video_url?: string;
    };

    if (!characterId || !userId) {
      return NextResponse.json(
        { success: false, error: "characterId and userId are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 构建更新对象（只更新传入的字段）
    const updateData: Record<string, unknown> = {};
    if (preview_video_url !== undefined) {
      updateData.preview_video_url = preview_video_url;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    // 验证 owner_id 匹配后更新（双重安全）
    const { error } = await supabase
      .from("ai_models")
      .update(updateData)
      .eq("id", characterId)
      .eq("owner_id", userId)
      .eq("source", "user_created");

    if (error) {
      console.error("[Characters API] PATCH error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log("[Characters API] Character updated:", { characterId, fields: Object.keys(updateData) });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Characters API] PATCH unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE — 删除角色（验证 owner_id 匹配）
// ============================================================================

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const userId = searchParams.get("userId");

    if (!id || !userId) {
      return NextResponse.json(
        { success: false, error: "id and userId are required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 验证 owner_id 匹配后删除（双重安全：WHERE 同时检查 id + owner_id）
    const { error } = await supabase
      .from("ai_models")
      .delete()
      .eq("id", id)
      .eq("owner_id", userId)
      .eq("source", "user_created");

    if (error) {
      console.error("[Characters API] DELETE error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log("[Characters API] Character deleted:", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Characters API] DELETE unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
