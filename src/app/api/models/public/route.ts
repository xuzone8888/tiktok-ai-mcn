/**
 * 前端模特列表 API (公开接口)
 * 
 * GET /api/models/public
 * 
 * ⚠️ 安全注意：
 * - 仅返回 active 状态的模特
 * - 显式选择安全字段，绝对禁止返回 trigger_word
 * - 用于前端 Quick Generator 的模特选择弹窗
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// 类型定义
// ============================================================================

interface PublicModel {
  id: string;
  name: string;
  avatar_url: string | null;
  demo_video_url: string | null;
  tags: string[];
  category: string;
  gender: "male" | "female" | "neutral" | null;
  price_monthly: number;
  rating: number;
  is_featured: boolean;
  is_trending: boolean;
}

// ============================================================================
// 敏感字段黑名单
// ============================================================================

const SENSITIVE_FIELDS = [
  "trigger_word",
  "metadata",
  "price_daily",
  "price_weekly",
  "price_yearly",
  "total_rentals",
  "total_generations",
  "sample_images",
  "capabilities",
  "created_at",
  "updated_at",
] as const;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将原始模特数据转换为安全的公开格式
 */
function toPublicModel(model: Record<string, unknown>): PublicModel {
  return {
    id: model.id as string,
    name: model.name as string,
    avatar_url: model.avatar_url as string | null,
    demo_video_url: (model.sample_videos as string[] | undefined)?.[0] || null,
    tags: (model.style_tags as string[]) || [],
    category: model.category as string,
    gender: model.gender as "male" | "female" | "neutral" | null,
    price_monthly: model.price_monthly as number,
    rating: model.rating as number,
    is_featured: model.is_featured as boolean,
    is_trending: model.is_trending as boolean,
  };
}

// ============================================================================
// GET - 获取公开模特列表
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 查询参数
    const category = searchParams.get("category");
    const featured = searchParams.get("featured") === "true";
    const trending = searchParams.get("trending") === "true";
    const search = searchParams.get("search");
    const limit = parseInt(searchParams.get("limit") || "50");
    const userId = searchParams.get("user_id");

    const supabase = await createClient();

    // 1. 构建查询 - 仅查询 active 状态的模特
    let query = supabase
      .from("ai_models")
      .select("*")
      .eq("is_active", true);

    // 2. 按条件筛选
    if (category && category !== "all") {
      query = query.ilike("category", category);
    }

    if (featured) {
      query = query.eq("is_featured", true);
    }

    if (trending) {
      query = query.eq("is_trending", true);
    }

    // 3. 搜索过滤
    if (search && search.trim().length >= 2) {
      const searchTerm = `%${search.toLowerCase().trim()}%`;
      query = query.or(`name.ilike.${searchTerm},category.ilike.${searchTerm}`);
    }

    // 4. 限制数量
    if (limit > 0) {
      query = query.limit(Math.min(limit, 100));
    }

    const { data: models, error } = await query;

    if (error) {
      console.error("[API] Database error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch models" },
        { status: 500 }
      );
    }

    // 获取用户的合约状态
    let userContracts: Record<string, { end_date: string }> = {};
    if (userId) {
      const { data: contracts } = await supabase
        .from("contracts")
        .select("model_id, end_date")
        .eq("user_id", userId)
        .eq("status", "active");

      if (contracts) {
        userContracts = contracts.reduce((acc, c) => {
          acc[c.model_id] = { end_date: c.end_date };
          return acc;
        }, {} as Record<string, { end_date: string }>);
      }
    }

    // 5. 转换为安全的公开格式
    const publicModels = (models || []).map((model) => {
      const safe = toPublicModel(model);

      // 如果提供了 userId，添加合约状态
      if (userId) {
        const contract = userContracts[model.id];
        const hasActiveContract = contract && new Date(contract.end_date) > new Date();

        return {
          ...safe,
          is_hired: hasActiveContract,
          contract_end_date: hasActiveContract ? contract.end_date : null,
        };
      }

      return safe;
    });

    // 6. 最终安全检查：确保没有敏感字段泄露
    const sanitizedModels = publicModels.map((model) => {
      const safe = { ...model };
      for (const field of SENSITIVE_FIELDS) {
        delete (safe as Record<string, unknown>)[field];
      }
      return safe;
    });

    // 7. 返回结果
    return NextResponse.json({
      success: true,
      data: {
        models: sanitizedModels,
        total: sanitizedModels.length,
      },
    });
  } catch (error) {
    console.error("[API] Error fetching public models:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
