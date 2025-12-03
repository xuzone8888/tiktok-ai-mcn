/**
 * 前端模特数据接口 (Server Actions)
 * 
 * ⚠️ 安全注意：
 * - 仅返回 active 状态的模特
 * - 显式选择安全字段，绝对禁止返回 trigger_word
 * - 用于前端模特市场、我的团队、Quick Generator 等页面
 */

"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================================
// 类型定义 - 安全的公开模特数据
// ============================================================================

/**
 * 公开模特信息 (不含敏感字段)
 * 
 * ⚠️ 此类型用于前端展示，绝不包含 trigger_word
 */
export interface PublicModel {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  demo_video_url: string | null;
  tags: string[];
  category: string;
  gender: "male" | "female" | "neutral" | null;
  base_price: number;        // 基础价格 (月租)
  price_monthly: number;     // 月租价格 (兼容旧字段)
  rating: number;
  is_featured: boolean;
  is_trending: boolean;
  total_rentals: number;     // 总签约次数
  total_generations: number; // 总生成次数
  created_at: string;
  is_hired_by_others?: boolean;  // 是否已被其他人聘用
  hired_count?: number;          // 当前被聘用数量
}

/**
 * 用户已签约的模特信息
 */
export interface HiredModel extends PublicModel {
  contract_id: string;
  contract_end_date: string;
  days_remaining: number;
  contract_status: string;
}

/**
 * 模特列表响应
 */
export interface ModelsListResponse {
  success: boolean;
  data?: {
    models: PublicModel[];
    total: number;
  };
  error?: string;
}

/**
 * 已签约模特列表响应
 */
export interface HiredModelsResponse {
  success: boolean;
  data?: {
    models: HiredModel[];
    total: number;
  };
  error?: string;
}

// ============================================================================
// 安全字段配置
// ============================================================================

/**
 * 允许返回给前端的字段 (显式白名单)
 * 
 * ⚠️ trigger_word 绝对不在此列表中
 */
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
  created_at
`;

/**
 * 敏感字段黑名单 (双重保护)
 * 
 * ⚠️ trigger_word 是最敏感的字段，绝对不能暴露给前端
 */
const SENSITIVE_FIELDS = [
  "trigger_word",
  "metadata",
  "price_daily",
  "price_weekly",
  "price_yearly",
] as const;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 Supabase Storage 的公开 URL
 */
function getStoragePublicUrl(path: string | null, bucket: string): string | null {
  if (!path) return null;
  
  // 如果已经是完整 URL，直接返回
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  
  // 构建 Supabase Storage 公开 URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return path;
  
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * 将数据库模特数据转换为安全的公开格式
 * 
 * ⚠️ 此函数确保敏感字段被剔除
 */
function toPublicModel(model: any): PublicModel {
  // 处理 style_tags - 可能是 JSON 字符串或数组
  let tags: string[] = [];
  if (model.style_tags) {
    if (typeof model.style_tags === "string") {
      try {
        tags = JSON.parse(model.style_tags);
      } catch {
        tags = [model.style_tags];
      }
    } else if (Array.isArray(model.style_tags)) {
      tags = model.style_tags;
    }
  }

  // 处理 sample_videos - 可能是 JSON 字符串或数组
  let sampleVideos: string[] = [];
  if (model.sample_videos) {
    if (typeof model.sample_videos === "string") {
      try {
        sampleVideos = JSON.parse(model.sample_videos);
      } catch {
        sampleVideos = [model.sample_videos];
      }
    } else if (Array.isArray(model.sample_videos)) {
      sampleVideos = model.sample_videos;
    }
  }

  // 显式构造安全对象，不使用展开运算符
  const publicModel: PublicModel = {
    id: model.id,
    name: model.name,
    description: model.description || null,
    avatar_url: getStoragePublicUrl(model.avatar_url, "model-avatars"),
    demo_video_url: sampleVideos[0] 
      ? getStoragePublicUrl(sampleVideos[0], "model-demos")
      : null,
    tags: tags,
    category: model.category || "general",
    gender: model.gender || null,
    base_price: model.price_monthly || 0,      // base_price 映射自 price_monthly
    price_monthly: model.price_monthly || 0,
    rating: parseFloat(model.rating) || 0,
    total_rentals: model.total_rentals || 0,
    total_generations: model.total_generations || 0,
    is_featured: model.is_featured || false,
    is_trending: model.is_trending || false,
    created_at: model.created_at,
  };

  // 双重保护：确保敏感字段不存在
  for (const field of SENSITIVE_FIELDS) {
    delete (publicModel as any)[field];
  }

  return publicModel;
}

/**
 * 计算合约剩余天数
 */
function getDaysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ============================================================================
// Server Actions - 核心数据接口
// ============================================================================

/**
 * 获取模特市场所有可用模特
 * 
 * 用于：模特市场页面 (/models)
 * 
 * @param options.category - 按分类筛选
 * @param options.featured - 只返回推荐模特
 * @param options.trending - 只返回热门模特
 * @param options.limit - 返回数量限制
 * @param options.offset - 分页偏移量
 */
export async function getMarketplaceModels(options?: {
  category?: string;
  featured?: boolean;
  trending?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<ModelsListResponse> {
  try {
    const supabase = createClient();
    const { category, featured, trending, limit = 50, offset = 0, search } = options || {};

    // 0. 获取当前用户
    const { data: { user } } = await supabase.auth.getUser();
    const currentUserId = user?.id;

    // 1. 构建查询 - 只选择安全字段
    let query = supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS, { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    // 2. 应用筛选条件
    if (category && category !== "all") {
      query = query.ilike("category", category);
    }

    if (featured) {
      query = query.eq("is_featured", true);
    }

    if (trending) {
      query = query.eq("is_trending", true);
    }

    if (search && search.trim().length >= 2) {
      const searchTerm = `%${search.trim()}%`;
      query = query.or(`name.ilike.${searchTerm},category.ilike.${searchTerm}`);
    }

    // 3. 分页
    query = query.range(offset, offset + limit - 1);

    // 4. 执行查询
    const { data: models, error, count } = await query;

    if (error) {
      console.error("[Models Action] Database error:", error);
      throw error;
    }

    // 5. 查询每个模特的有效签约数量 (所有用户)
    const modelIds = (models || []).map((m: any) => m.id);
    const { data: allContracts } = await supabase
      .from("contracts")
      .select("ai_model_id, user_id")
      .in("ai_model_id", modelIds)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString());
    
    // 统计每个模特的签约数量和当前用户是否已签约
    const hiredCountMap: Record<string, number> = {};
    const userContractsSet = new Set<string>(); // 当前用户签约的模特ID
    
    (allContracts || []).forEach((c: any) => {
      hiredCountMap[c.ai_model_id] = (hiredCountMap[c.ai_model_id] || 0) + 1;
      if (currentUserId && c.user_id === currentUserId) {
        userContractsSet.add(c.ai_model_id);
      }
    });

    // 6. 转换为安全的公开格式，并添加签约状态
    const publicModels = (models || []).map((model: any) => {
      const publicModel = toPublicModel(model);
      const hiredCount = hiredCountMap[model.id] || 0;
      const hasActiveContract = userContractsSet.has(model.id);
      
      return {
        ...publicModel,
        has_active_contract: hasActiveContract,
        is_hired_by_others: !hasActiveContract && hiredCount > 0,
        hired_count: hiredCount,
      };
    });

    console.log(`[Models Action] Fetched ${publicModels.length} marketplace models (user: ${currentUserId || 'anonymous'})`);

    return {
      success: true,
      data: {
        models: publicModels,
        total: count || publicModels.length,
      },
    };
  } catch (error) {
    console.error("[Models Action] Error fetching marketplace models:", error);
    return {
      success: false,
      error: "Failed to fetch models",
    };
  }
}

/**
 * 获取用户已签约的模特列表 (我的团队)
 * 
 * 用于：我的团队页面 (/team), Quick Generator "My Team" 选项
 * 
 * @param userId - 用户 ID
 */
export async function getUserHiredModels(
  userId: string
): Promise<HiredModelsResponse> {
  try {
    if (!userId) {
      return {
        success: false,
        error: "User ID is required",
      };
    }

    const supabase = createClient();

    // 1. 查询用户的有效合约
    const { data: contracts, error: contractsError } = await supabase
      .from("contracts")
      .select("id, ai_model_id, end_date, status, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .order("end_date", { ascending: true });

    if (contractsError) {
      console.error("[Models Action] Contracts query error:", contractsError);
      throw contractsError;
    }

    if (!contracts || contracts.length === 0) {
      console.log("[Models Action] No active contracts found for user");
      return {
        success: true,
        data: { models: [], total: 0 },
      };
    }

    // 2. 获取关联的模特信息
    const modelIds = contracts.map((c: any) => c.ai_model_id).filter(Boolean);
    
    const { data: models, error: modelsError } = await supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS)
      .in("id", modelIds);

    if (modelsError) {
      console.error("[Models Action] Models query error:", modelsError);
      throw modelsError;
    }

    // 3. 合并数据并转换格式
    const modelsMap = new Map(models?.map((m: any) => [m.id, m]) || []);

    const hiredModels: HiredModel[] = contracts
      .filter((contract: any) => modelsMap.has(contract.ai_model_id))
      .map((contract: any) => {
        const model = modelsMap.get(contract.ai_model_id);
        const publicModel = toPublicModel(model);

        return {
          ...publicModel,
          contract_id: contract.id,
          contract_end_date: contract.end_date,
          contract_status: contract.status,
          days_remaining: getDaysRemaining(contract.end_date),
        };
      });

    console.log(`[Models Action] Fetched ${hiredModels.length} hired models for user ${userId}`);

    return {
      success: true,
      data: {
        models: hiredModels,
        total: hiredModels.length,
      },
    };
  } catch (error) {
    console.error("[Models Action] Error fetching hired models:", error);
    return {
      success: false,
      error: "Failed to fetch hired models",
    };
  }
}

/**
 * 获取单个模特的公开信息
 * 
 * @param modelId - 模特 ID
 */
export async function getPublicModelById(
  modelId: string
): Promise<{ success: boolean; data?: PublicModel; error?: string }> {
  try {
    if (!modelId) {
      return {
        success: false,
        error: "Model ID is required",
      };
    }

    const supabase = createClient();

    // 只选择安全字段
    const { data: model, error } = await supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS)
      .eq("id", modelId)
      .eq("is_active", true)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return {
          success: false,
          error: "Model not found",
        };
      }
      throw error;
    }

    // 转换为安全的公开格式
    const publicModel = toPublicModel(model);

    return {
      success: true,
      data: publicModel,
    };
  } catch (error) {
    console.error("[Models Action] Error fetching model:", error);
    return {
      success: false,
      error: "Failed to fetch model",
    };
  }
}

/**
 * 搜索模特 (按名称或标签)
 * 
 * @param query - 搜索关键词
 * @param limit - 返回数量限制
 */
export async function searchModels(
  query: string,
  limit: number = 10
): Promise<ModelsListResponse> {
  try {
    if (!query || query.trim().length < 2) {
      return {
        success: true,
        data: {
          models: [],
          total: 0,
        },
      };
    }

    const supabase = createClient();
    const searchTerm = `%${query.trim()}%`;

    // 只选择安全字段
    const { data: models, error } = await supabase
      .from("ai_models")
      .select(SAFE_MODEL_FIELDS)
      .eq("is_active", true)
      .or(`name.ilike.${searchTerm},category.ilike.${searchTerm}`)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    // 转换为安全的公开格式
    const publicModels = (models || []).map(toPublicModel);

    return {
      success: true,
      data: {
        models: publicModels,
        total: publicModels.length,
      },
    };
  } catch (error) {
    console.error("[Models Action] Error searching models:", error);
    return {
      success: false,
      error: "Failed to search models",
    };
  }
}

// ============================================================================
// 兼容旧接口 (别名)
// ============================================================================

/**
 * @deprecated 请使用 getMarketplaceModels
 */
export async function getPublicModels(options?: {
  featured?: boolean;
  category?: string;
  limit?: number;
}): Promise<ModelsListResponse> {
  return getMarketplaceModels(options);
}

/**
 * @deprecated 请使用 getUserHiredModels
 */
export async function getHiredModels(userId: string): Promise<HiredModelsResponse> {
  return getUserHiredModels(userId);
}
