/**
 * 角色 CRUD API
 *
 * GET  /api/characters?userId=xxx — 获取用户自建角色列表
 * POST /api/characters             — 创建（保存）新角色
 * DELETE /api/characters?id=xxx&userId=xxx — 删除角色
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { classifyCharacterAsset, normalizeCharacterAssetImages } from "@/lib/character-assets";
import type { CreateCharacterRequest } from "@/types/character";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

const OPTIONAL_INSERT_COLUMNS = new Set([
  "forge_type",
  "trigger_word",
  "reference_task_id",
]);

async function getCurrentUser() {
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  return user;
}

async function requireMatchingUser(requestedUserId?: string | null) {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      ),
    };
  }

  if (requestedUserId && requestedUserId !== user.id) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, user };
}

function getMissingSchemaColumn(error: { message?: string } | null): string | null {
  const message = error?.message || "";
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

// ============================================================================
// GET — 获取用户自建角色列表
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    const auth = await requireMatchingUser(userId);
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("ai_models")
      .select("*")
      .eq("source", "user_created")
      .eq("owner_id", auth.user.id)
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
      // V5: Sora2 影视角色
      trigger_word,
      forge_type,
    } = body;

    const referenceImages = normalizeCharacterAssetImages(reference_images);
    const marketCategory = classifyCharacterAsset({
      category: character_type,
      character_type,
      tags: style_tags,
      description,
      dna_config,
    });

    const auth = await requireMatchingUser(userId);
    if (!auth.ok) return auth.response;

    // 参数校验
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "角色名称不能为空" },
        { status: 400 }
      );
    }
    // Sora2 角色不需要参考图（使用视频截帧代替），VEO 角色必须有参考图
    if (forge_type !== "sora2" && referenceImages.length === 0) {
      return NextResponse.json(
        { success: false, error: "至少需要一张参考图" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 写入 ai_models 表
    const insertData: Record<string, unknown> = {
      name: name.trim(),
      description,
      // avatar_url = Hero Shot 4K（展示用）
      avatar_url: avatar_url || referenceImages[0] || null,
      reference_images: referenceImages as unknown as Json,
      preview_video_url: preview_video_url || null,
      character_type: character_type || "realistic",
      dna_config: (dna_config || {}) as unknown as Json,
      style_tags,
      gender: (gender || null) as "male" | "female" | "neutral" | null,
      age_range: age_range || null,
      // 多角度参考图状态
      reference_sheet_url: reference_sheet_url || null,
      reference_status: reference_status || "none",
      reference_task_id: reference_task_id || null,
      // 角色归属
      source: "user_created" as const,
      owner_id: auth.user.id,
      is_active: true,
      is_public: false,
      publish_price: 100,
      // 自建角色不计价（通过广场 publish_price 单独定价）
      price_daily: 0,
      price_weekly: 0,
      price_monthly: 0,
      price_yearly: 0,
      category: marketCategory,
      // V5: Sora2 影视角色
      trigger_word: trigger_word || null,
      forge_type: forge_type || "veo",
    };

    console.log("[Characters API] Creating character:", {
      userId: auth.user.id,
      name: insertData.name,
      character_type: insertData.character_type,
      imagesCount: referenceImages.length,
    });

    let payload = { ...insertData };
    let data: { id: string } | null = null;
    let error: { message: string; code?: string } | null = null;

    for (let attempt = 0; attempt <= OPTIONAL_INSERT_COLUMNS.size; attempt += 1) {
      const result = await supabase
        .from("ai_models")
        .insert(payload as never)
        .select("id")
        .single();

      data = result.data as { id: string } | null;
      error = result.error ? { message: result.error.message, code: result.error.code } : null;

      if (!error) break;

      const missingColumn = getMissingSchemaColumn(error);
      if (!missingColumn || !OPTIONAL_INSERT_COLUMNS.has(missingColumn) || !(missingColumn in payload)) {
        break;
      }

      const nextPayload = { ...payload };
      delete nextPayload[missingColumn];
      payload = nextPayload;
      console.warn("[Characters API] Optional ai_models column missing, retrying without it:", missingColumn);
    }

    if (error || !data) {
      console.error("[Characters API] POST insert error:", error);
      return NextResponse.json(
        { success: false, error: error?.message || "角色创建失败" },
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
      userId?: string;
      preview_video_url?: string;
    };

    if (!characterId) {
      return NextResponse.json(
        { success: false, error: "characterId is required" },
        { status: 400 }
      );
    }

    const auth = await requireMatchingUser(userId);
    if (!auth.ok) return auth.response;

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
      .eq("owner_id", auth.user.id)
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

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      );
    }

    const auth = await requireMatchingUser(userId);
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();

    // 验证 owner_id 匹配后删除（双重安全：WHERE 同时检查 id + owner_id）
    const { error } = await supabase
      .from("ai_models")
      .delete()
      .eq("id", id)
      .eq("owner_id", auth.user.id)
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
