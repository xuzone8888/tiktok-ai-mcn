/**
 * 前台模特 API - 公开接口
 * 
 * ⚠️ 安全注意：此 API 返回的数据会暴露给前端用户
 * 必须剔除敏感字段如 trigger_word
 */

import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 需要从响应中剔除的敏感字段
const SENSITIVE_FIELDS = ["trigger_word", "metadata"] as const;
const SAFE_MODEL_FIELDS = `
  id,
  name,
  description,
  avatar_url,
  sample_videos,
  style_tags,
  category,
  gender,
  price_monthly,
  rating,
  total_rentals,
  total_generations,
  is_featured,
  is_trending,
  created_at,
  source,
  owner_id,
  is_public,
  publish_price,
  character_type,
  reference_images,
  reference_sheet_url,
  preview_video_url,
  reference_status
`;

/**
 * 剔除敏感字段，返回安全的模特数据
 */
function sanitizeModelData<T extends Record<string, unknown>>(model: T): Omit<T, typeof SENSITIVE_FIELDS[number]> {
  const sanitized = { ...model };
  for (const field of SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const featured = searchParams.get("featured");
  const trending = searchParams.get("trending");

  try {
    const authSupabase = await createClient();
    const { data: { user } } = await authSupabase.auth.getUser();
    const supabase = createAdminClient();

    // 构建查询
    const visibilityFilters = [
      "source.eq.official",
      "and(source.eq.user_created,is_public.eq.true)",
    ];
    if (user?.id) {
      visibilityFilters.push(`and(source.eq.user_created,owner_id.eq.${user.id})`);
    }

    let query = supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS)
      .eq("is_active", true)
      .not("reference_sheet_url", "is", null)
      .eq("reference_status", "completed")
      .or(visibilityFilters.join(","));

    // 筛选条件
    if (category && category !== "all") {
      query = query.ilike("category", category);
    }

    if (featured === "true") {
      query = query.eq("is_featured", true);
    }

    if (trending === "true") {
      query = query.eq("is_trending", true);
    }

    const { data: models, error } = await query;

    if (error) {
      console.error("[Models API] Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch models" },
        { status: 500 }
      );
    }

    // 获取用户的合约状态
    let userContracts: Record<string, { status: string; end_date: string }> = {};
    if (user) {
      const { data: contracts } = await supabase
        .from("contracts")
        .select("model_id, status, end_date")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (contracts) {
        userContracts = contracts.reduce((acc, c) => {
          acc[c.model_id] = { status: c.status, end_date: c.end_date };
          return acc;
        }, {} as Record<string, { status: string; end_date: string }>);
      }
    }

    // 添加合约状态，并剔除敏感字段
    const modelsWithContractStatus = (models || []).map((model) => {
      const contract = userContracts[model.id];
      const hasActiveContract = contract && 
        contract.status === "active" && 
        new Date(contract.end_date) > new Date();
      
      // ⚠️ 关键：剔除敏感字段 (trigger_word 等)
      const safeModel = sanitizeModelData(model);
      
      return {
        ...safeModel,
        has_active_contract: hasActiveContract,
        contract: hasActiveContract ? contract : null,
      };
    });

    return NextResponse.json(modelsWithContractStatus);
  } catch (error) {
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
