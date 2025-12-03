/**
 * 管理员统计数据 API
 * 
 * GET /api/admin/stats - 获取全站运营统计数据
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminStats {
  // 用户统计
  users: {
    total: number;
    active: number;
    newThisMonth: number;
    newLastMonth: number;
  };
  
  // 模特统计
  models: {
    total: number;
    active: number;
    featured: number;
  };
  
  // 积分统计
  credits: {
    totalIssued: number;
    usedThisMonth: number;
    usedLastMonth: number;
    usedToday: number;
  };
  
  // 生成统计
  generations: {
    totalVideos: number;
    totalImages: number;
    videosToday: number;
    imagestoday: number;
    videosThisMonth: number;
    imagesThisMonth: number;
    successRate: number;
  };
  
  // 最近活动
  recentActivity: {
    action: string;
    user: string;
    detail: string;
    time: string;
  }[];
  
  // 热门模特
  topModels: {
    name: string;
    contracts: number;
    credits: number;
  }[];
}

// ============================================================================
// GET - 获取管理员统计数据
// ============================================================================

export async function GET() {
  try {
    const supabase = createAdminClient();

    // 时间范围计算
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // 1. 用户统计
    const { count: totalUsers } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });

    const { count: activeUsers } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    const { count: newUsersThisMonth } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thisMonthStart.toISOString());

    const { count: newUsersLastMonth } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", lastMonthStart.toISOString())
      .lte("created_at", lastMonthEnd.toISOString());

    // 2. 模特统计
    const { count: totalModels } = await supabase
      .from("ai_models")
      .select("*", { count: "exact", head: true });

    const { count: activeModels } = await supabase
      .from("ai_models")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    const { count: featuredModels } = await supabase
      .from("ai_models")
      .select("*", { count: "exact", head: true })
      .eq("is_featured", true);

    // 3. 积分统计
    const { data: allProfiles } = await supabase
      .from("profiles")
      .select("credits");
    
    const totalCredits = allProfiles?.reduce((sum, p) => sum + (p.credits || 0), 0) || 0;

    // 从生成记录计算积分使用
    const { data: allGenerations } = await supabase
      .from("generations")
      .select("credit_cost, created_at");

    const creditsUsedToday = allGenerations
      ?.filter(g => new Date(g.created_at) >= todayStart)
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;

    const creditsUsedThisMonth = allGenerations
      ?.filter(g => new Date(g.created_at) >= thisMonthStart)
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;

    const creditsUsedLastMonth = allGenerations
      ?.filter(g => {
        const date = new Date(g.created_at);
        return date >= lastMonthStart && date <= lastMonthEnd;
      })
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;

    // 4. 生成统计
    const { data: generations } = await supabase
      .from("generations")
      .select("type, status, created_at");

    const videoGenerations = generations?.filter(g => g.type === "video") || [];
    const imageGenerations = generations?.filter(g => g.type === "image") || [];

    const videosToday = videoGenerations.filter(g => new Date(g.created_at) >= todayStart).length;
    const imagesToday = imageGenerations.filter(g => new Date(g.created_at) >= todayStart).length;
    const videosThisMonth = videoGenerations.filter(g => new Date(g.created_at) >= thisMonthStart).length;
    const imagesThisMonth = imageGenerations.filter(g => new Date(g.created_at) >= thisMonthStart).length;

    const totalGenerations = generations?.length || 0;
    const successfulGenerations = generations?.filter(g => g.status === "completed").length || 0;
    const successRate = totalGenerations > 0 ? Math.round((successfulGenerations / totalGenerations) * 100) : 0;

    // 5. 最近活动（从generations获取）
    const { data: recentGenerations } = await supabase
      .from("generations")
      .select("type, user_id, model, created_at, status")
      .order("created_at", { ascending: false })
      .limit(5);

    const recentActivity = (recentGenerations || []).map(g => ({
      action: g.type === "video" ? "视频生成" : "图片生成",
      user: g.user_id?.substring(0, 8) + "..." || "未知用户",
      detail: g.status === "completed" ? "成功" : g.status === "failed" ? "失败" : "处理中",
      time: formatTimeAgo(new Date(g.created_at)),
    }));

    // 6. 热门模特（从contracts统计）
    const { data: contracts } = await supabase
      .from("contracts")
      .select("ai_model_id, credit_cost")
      .eq("status", "active");

    const modelStats = new Map<string, { count: number; credits: number }>();
    contracts?.forEach(c => {
      const current = modelStats.get(c.ai_model_id) || { count: 0, credits: 0 };
      current.count++;
      current.credits += c.credit_cost || 0;
      modelStats.set(c.ai_model_id, current);
    });

    // 获取模特名称
    const modelIds = Array.from(modelStats.keys());
    const { data: modelNames } = await supabase
      .from("ai_models")
      .select("id, name")
      .in("id", modelIds);

    const topModels = Array.from(modelStats.entries())
      .map(([id, stats]) => ({
        name: modelNames?.find(m => m.id === id)?.name || "未知模特",
        contracts: stats.count,
        credits: stats.credits,
      }))
      .sort((a, b) => b.contracts - a.contracts)
      .slice(0, 5);

    const stats: AdminStats = {
      users: {
        total: totalUsers || 0,
        active: activeUsers || totalUsers || 0,
        newThisMonth: newUsersThisMonth || 0,
        newLastMonth: newUsersLastMonth || 0,
      },
      models: {
        total: totalModels || 0,
        active: activeModels || 0,
        featured: featuredModels || 0,
      },
      credits: {
        totalIssued: totalCredits,
        usedThisMonth: creditsUsedThisMonth,
        usedLastMonth: creditsUsedLastMonth,
        usedToday: creditsUsedToday,
      },
      generations: {
        totalVideos: videoGenerations.length,
        totalImages: imageGenerations.length,
        videosToday,
        imagestoday: imagesToday,
        videosThisMonth,
        imagesThisMonth,
        successRate,
      },
      recentActivity,
      topModels,
    };

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("[Admin Stats API] Error:", error);
    // 返回默认数据
    return NextResponse.json({
      success: true,
      data: {
        users: { total: 0, active: 0, newThisMonth: 0, newLastMonth: 0 },
        models: { total: 0, active: 0, featured: 0 },
        credits: { totalIssued: 0, usedThisMonth: 0, usedLastMonth: 0, usedToday: 0 },
        generations: { totalVideos: 0, totalImages: 0, videosToday: 0, imagestoday: 0, videosThisMonth: 0, imagesThisMonth: 0, successRate: 0 },
        recentActivity: [],
        topModels: [],
      },
    });
  }
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

