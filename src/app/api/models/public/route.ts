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
import { mockModels, mockContracts } from "@/lib/mock-data";

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
 * 
 * ⚠️ 此函数确保敏感字段被剔除
 */
function toPublicModel(model: typeof mockModels[number]): PublicModel {
  // 显式构造安全对象，不使用展开运算符，确保不会意外包含敏感字段
  return {
    id: model.id,
    name: model.name,
    avatar_url: model.avatar_url,
    demo_video_url: model.sample_videos?.[0] || null,
    tags: model.style_tags || [],
    category: model.category,
    gender: model.gender,
    price_monthly: model.price_monthly,
    rating: model.rating,
    is_featured: model.is_featured,
    is_trending: model.is_trending,
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
    const userId = searchParams.get("user_id"); // 用于获取合约状态

    // 1. 仅查询 active 状态的模特 (核心安全逻辑)
    let models = mockModels.filter((m) => m.is_active === true);

    // 2. 按条件筛选
    if (category && category !== "all") {
      models = models.filter(
        (m) => m.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (featured) {
      models = models.filter((m) => m.is_featured);
    }

    if (trending) {
      models = models.filter((m) => m.is_trending);
    }

    // 3. 搜索过滤
    if (search && search.trim().length >= 2) {
      const searchTerm = search.toLowerCase().trim();
      models = models.filter((m) => {
        if (m.name.toLowerCase().includes(searchTerm)) return true;
        if (m.style_tags.some((tag) => tag.toLowerCase().includes(searchTerm)))
          return true;
        if (m.category.toLowerCase().includes(searchTerm)) return true;
        return false;
      });
    }

    // 4. 限制数量
    if (limit > 0) {
      models = models.slice(0, Math.min(limit, 100)); // 最多返回 100 条
    }

    // 5. 转换为安全的公开格式 (⚠️ 核心安全逻辑)
    const publicModels = models.map((model) => {
      const safe = toPublicModel(model);

      // 如果提供了 userId，添加合约状态
      if (userId) {
        const contract = mockContracts.get(model.id);
        const hasActiveContract =
          contract &&
          contract.user_id === userId &&
          contract.status === "active" &&
          new Date(contract.end_date) > new Date();

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

