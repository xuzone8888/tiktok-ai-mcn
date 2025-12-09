/**
 * Admin API - 模特管理 (真实 Supabase 数据库)
 * 
 * GET /api/admin/models - 获取模特列表 (包含 trigger_word)
 * POST /api/admin/models - 创建新模特
 * PATCH /api/admin/models - 更新模特信息
 * DELETE /api/admin/models - 删除模特
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET - 获取模特列表 (Admin 专用，包含 trigger_word)
// ============================================================================

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get("id");
    const includeTriggerWord = searchParams.get("include_trigger_word") === "true";

    // 选择字段 - Admin 可以看到 trigger_word
    const selectFields = includeTriggerWord
      ? "*"
      : "id, name, description, avatar_url, sample_images, sample_videos, category, style_tags, gender, age_range, price_daily, price_weekly, price_monthly, price_yearly, rating, total_rentals, total_generations, is_active, is_featured, is_trending, created_at, updated_at";

    if (modelId) {
      // 获取单个模特
      const { data: model, error } = await supabase
        .from("ai_models")
        .select(selectFields)
        .eq("id", modelId)
        .single();

      if (error || !model) {
        return NextResponse.json(
          { success: false, error: "Model not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: formatModelForAdmin(model),
      });
    }

    // 获取所有模特
    const { data: models, error, count } = await supabase
      .from("ai_models")
      .select(selectFields, { count: "exact" })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Admin API] Database error:", error);
      throw error;
    }

    const formattedModels = (models || []).map(formatModelForAdmin);

    return NextResponse.json({
      success: true,
      data: {
        models: formattedModels,
        total: count || formattedModels.length,
      },
    });
  } catch (error) {
    console.error("[Admin API] Get models error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get models" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 创建新模特
// ============================================================================

export async function POST(request: Request) {
  console.log("[Admin API] POST /api/admin/models - Creating new model");
  
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    
    console.log("[Admin API] Request body:", JSON.stringify(body, null, 2));

    const {
      name,
      description,
      category,
      gender,
      age_range,
      style_tags,
      price_daily,
      price_weekly,
      price_monthly,
      price_yearly,
      is_active,
      is_featured,
      is_trending,
      trigger_word,
      avatar_url,
      sample_video_url,
    } = body;

    if (!name || !category) {
      console.log("[Admin API] Validation failed: name or category missing", { name, category });
      return NextResponse.json(
        { success: false, error: "Name and category are required" },
        { status: 400 }
      );
    }

    // 构建插入数据
    const insertData: Record<string, unknown> = {
      name,
      description: description || null,
      category,
      gender: gender || null,
      age_range: age_range || null,
      style_tags: style_tags || [],
      price_daily: price_daily || 100,
      price_weekly: price_weekly || 500,
      price_monthly: price_monthly || 1500,
      price_yearly: price_yearly || 12000,
      is_active: is_active ?? true,
      is_featured: is_featured ?? false,
      is_trending: is_trending ?? false,
      trigger_word: trigger_word || null,
      avatar_url: avatar_url || null,
      sample_videos: sample_video_url ? [sample_video_url] : [],
      sample_images: avatar_url ? [avatar_url] : [],
      rating: 5.0,
      total_rentals: 0,
      total_generations: 0,
    };

    console.log("[Admin API] Inserting model data:", JSON.stringify(insertData, null, 2));

    const { data: newModel, error } = await supabase
      .from("ai_models")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[Admin API] Insert error:", error);
      console.error("[Admin API] Error details:", JSON.stringify(error, null, 2));
      return NextResponse.json(
        { success: false, error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    console.log("[Admin API] Model created successfully:", newModel.id, newModel.name);

    return NextResponse.json({
      success: true,
      data: {
        model: formatModelForAdmin(newModel),
      },
    });
  } catch (error) {
    console.error("[Admin API] Create model error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Failed to create model: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - 更新模特信息
// ============================================================================

export async function PATCH(request: Request) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();

    const { id, sample_video_url, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Model ID is required" },
        { status: 400 }
      );
    }

    // 构建更新数据
    const updateData: Record<string, unknown> = { ...updates };

    // 处理 sample_video_url -> sample_videos
    if (sample_video_url !== undefined) {
      updateData.sample_videos = sample_video_url ? [sample_video_url] : [];
    }

    // 处理 avatar_url -> sample_images
    if (updates.avatar_url !== undefined) {
      updateData.sample_images = updates.avatar_url ? [updates.avatar_url] : [];
    }

    // 添加更新时间
    updateData.updated_at = new Date().toISOString();

    const { data: updatedModel, error } = await supabase
      .from("ai_models")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[Admin API] Update error:", error);
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { success: false, error: "Model not found" },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log("[Admin API] Model updated:", id);

    return NextResponse.json({
      success: true,
      data: {
        model: formatModelForAdmin(updatedModel),
        updated_fields: Object.keys(updates),
      },
    });
  } catch (error) {
    console.error("[Admin API] Update model error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update model" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - 删除模特
// ============================================================================

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get("id");

    if (!modelId) {
      return NextResponse.json(
        { success: false, error: "Model ID is required" },
        { status: 400 }
      );
    }

    // 先获取模特信息（用于日志）
    const { data: model } = await supabase
      .from("ai_models")
      .select("name")
      .eq("id", modelId)
      .single();

    // 执行删除
    const { error } = await supabase
      .from("ai_models")
      .delete()
      .eq("id", modelId);

    if (error) {
      console.error("[Admin API] Delete error:", error);
      throw error;
    }

    console.log("[Admin API] Model deleted:", modelId, model?.name);

    return NextResponse.json({
      success: true,
      data: {
        model_id: modelId,
        deleted: true,
      },
    });
  } catch (error) {
    console.error("[Admin API] Delete model error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete model" },
      { status: 500 }
    );
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化模特数据为 Admin 格式
 */
function formatModelForAdmin(model: Record<string, unknown>) {
  // 处理 style_tags
  let styleTags: string[] = [];
  if (model.style_tags) {
    if (typeof model.style_tags === "string") {
      try {
        styleTags = JSON.parse(model.style_tags as string);
      } catch {
        styleTags = [model.style_tags as string];
      }
    } else if (Array.isArray(model.style_tags)) {
      styleTags = model.style_tags as string[];
    }
  }

  // 处理 sample_videos
  let sampleVideos: string[] = [];
  if (model.sample_videos) {
    if (typeof model.sample_videos === "string") {
      try {
        sampleVideos = JSON.parse(model.sample_videos as string);
      } catch {
        sampleVideos = [model.sample_videos as string];
      }
    } else if (Array.isArray(model.sample_videos)) {
      sampleVideos = model.sample_videos as string[];
    }
  }

  // 处理 sample_images
  let sampleImages: string[] = [];
  if (model.sample_images) {
    if (typeof model.sample_images === "string") {
      try {
        sampleImages = JSON.parse(model.sample_images as string);
      } catch {
        sampleImages = [model.sample_images as string];
      }
    } else if (Array.isArray(model.sample_images)) {
      sampleImages = model.sample_images as string[];
    }
  }

  return {
    id: model.id,
    name: model.name,
    description: model.description || "",
    avatar_url: model.avatar_url || null,
    sample_images: sampleImages,
    sample_videos: sampleVideos,
    category: model.category || "Fashion",
    style_tags: styleTags,
    gender: model.gender || null,
    age_range: model.age_range || null,
    price_daily: model.price_daily || 100,
    price_weekly: model.price_weekly || 500,
    price_monthly: model.price_monthly || 1500,
    price_yearly: model.price_yearly || 12000,
    rating: parseFloat(String(model.rating)) || 0,
    total_rentals: model.total_rentals || 0,
    total_generations: model.total_generations || 0,
    is_active: model.is_active ?? true,
    is_featured: model.is_featured ?? false,
    is_trending: model.is_trending ?? false,
    trigger_word: model.trigger_word || undefined,
    created_at: model.created_at,
    updated_at: model.updated_at,
  };
}
