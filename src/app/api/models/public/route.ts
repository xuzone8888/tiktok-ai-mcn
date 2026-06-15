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

import { ROLE_ASSET_CATEGORIES } from "@/lib/character-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  publish_price: number;
  source: "official" | "user_created";
  reference_sheet_url: string | null;
  reference_images: string[];
  preview_video_url: string | null;
  reference_status: string;
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

const SAFE_MODEL_FIELDS = `
  id,
  name,
  avatar_url,
  sample_videos,
  style_tags,
  category,
  gender,
  price_monthly,
  publish_price,
  source,
  reference_images,
  reference_sheet_url,
  preview_video_url,
  reference_status,
  rating,
  is_featured,
  is_trending
`;

const MARKETPLACE_SHUFFLE_FETCH_LIMIT = 1000;
const MARKETPLACE_CATEGORY_ORDER = ROLE_ASSET_CATEGORIES.filter(
  (category) => category !== "全部" && category !== "我的角色"
);

function hashMarketplaceString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getMarketplaceShuffleScore(seed: string, ...parts: string[]) {
  return hashMarketplaceString([seed, ...parts].join(":"));
}

function getBalancedMarketplaceOrder<T extends { id: string; category?: string | null }>(
  models: T[],
  seed: string
): T[] {
  const groups = new Map<string, T[]>();

  for (const model of models) {
    const category = model.category || "其他";
    const existing = groups.get(category) || [];
    existing.push(model);
    groups.set(category, existing);
  }

  for (const [category, group] of groups) {
    group.sort((left, right) =>
      getMarketplaceShuffleScore(seed, category, left.id) -
      getMarketplaceShuffleScore(seed, category, right.id)
    );
  }

  const categoryOrder = [
    ...MARKETPLACE_CATEGORY_ORDER.filter((category) => groups.has(category)),
    ...Array.from(groups.keys()).filter((category) => !MARKETPLACE_CATEGORY_ORDER.includes(category as typeof MARKETPLACE_CATEGORY_ORDER[number])),
  ].sort((left, right) =>
    getMarketplaceShuffleScore(seed, "category", left) -
    getMarketplaceShuffleScore(seed, "category", right)
  );

  const ordered: T[] = [];
  let hasItems = true;
  while (hasItems) {
    hasItems = false;
    for (const category of categoryOrder) {
      const group = groups.get(category);
      const item = group?.shift();
      if (item) {
        ordered.push(item);
        hasItems = true;
      }
    }
  }

  return ordered;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将原始模特数据转换为安全的公开格式
 */
function toPublicModel(model: Record<string, unknown>): PublicModel {
  const sampleVideos = Array.isArray(model.sample_videos) ? model.sample_videos : [];
  const tags = Array.isArray(model.style_tags) ? model.style_tags : [];
  const referenceImages = Array.isArray(model.reference_images) ? model.reference_images : [];
  return {
    id: model.id as string,
    name: model.name as string,
    avatar_url: model.avatar_url as string | null,
    demo_video_url: (sampleVideos[0] as string | undefined) || (model.preview_video_url as string | null) || null,
    tags: tags as string[],
    category: model.category as string,
    gender: model.gender as "male" | "female" | "neutral" | null,
    price_monthly: model.price_monthly as number,
    publish_price: (model.publish_price as number | null) || 100,
    source: model.source === "user_created" ? "user_created" : "official",
    reference_sheet_url: model.reference_sheet_url as string | null,
    reference_images: referenceImages as string[],
    preview_video_url: model.preview_video_url as string | null,
    reference_status: (model.reference_status as string | null) || "none",
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
    const requestedLimit = parseInt(searchParams.get("limit") || "50");
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50;
    const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
    const shuffleSeed = searchParams.get("shuffle_seed") || "default";
    const requestedUserId = searchParams.get("user_id");

    const authSupabase = await createClient();
    const { data: { user } } = await authSupabase.auth.getUser();
    const supabase = createAdminClient();
    const userId = user?.id || null;

    if (requestedUserId && requestedUserId !== userId) {
      console.warn("[Models Public API] Ignoring mismatched user_id query parameter");
    }

    const visibilityFilters = [
      "source.eq.official",
      "and(source.eq.user_created,is_public.eq.true)",
    ];
    if (user?.id) {
      visibilityFilters.push(`and(source.eq.user_created,owner_id.eq.${user.id})`);
    }

    const normalizedSearch = search?.trim() || "";
    const hasSearch = normalizedSearch.length >= 2;
    const isAllCategory = !category || category === "all" || category === "全部";
    const shouldShuffleAll = isAllCategory && !featured && !trending && !hasSearch;

    // 1. 构建查询 - 仅查询 active 状态的模特
    let query = supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS, { count: "exact" })
      .eq("is_active", true)
      .not("reference_sheet_url", "is", null)
      .eq("reference_status", "completed")
      .or(visibilityFilters.join(","));

    // 2. 按条件筛选
    if (category && category !== "all" && category !== "全部") {
      query = query.ilike("category", category);
    }

    if (featured) {
      query = query.eq("is_featured", true);
    }

    if (trending) {
      query = query.eq("is_trending", true);
    }

    // 3. 搜索过滤
    if (hasSearch) {
      const searchTerm = `%${normalizedSearch.toLowerCase()}%`;
      query = query.or(`name.ilike.${searchTerm},category.ilike.${searchTerm}`);
    }

    // 4. 分页
    const safeLimit = limit > 0 ? Math.min(limit, 100) : 0;
    if (limit > 0) {
      query = shouldShuffleAll
        ? query.range(0, MARKETPLACE_SHUFFLE_FETCH_LIMIT - 1)
        : query
          .order("created_at", { ascending: false })
          .range(offset, offset + safeLimit - 1);
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data: models, error, count } = await query;

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
    const pageModels = shouldShuffleAll && limit > 0
      ? getBalancedMarketplaceOrder((models || []) as Array<{ id: string; category?: string | null }>, shuffleSeed)
        .slice(offset, offset + safeLimit)
      : (models || []);

    const publicModels = pageModels.map((model) => {
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

    const total = count ?? sanitizedModels.length;

    // 7. 返回结果
    return NextResponse.json({
      success: true,
      data: {
        models: sanitizedModels,
        total,
        limit: safeLimit,
        offset,
        hasMore: safeLimit > 0 && offset + sanitizedModels.length < total,
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
