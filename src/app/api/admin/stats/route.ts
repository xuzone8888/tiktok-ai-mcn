/**
 * 管理员统计数据 API
 * 
 * GET /api/admin/stats - 获取全站运营统计数据
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

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
    // 鉴权：验证管理员身份
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const supabase = createAdminClient();

    // 时间范围计算
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const todayISO = todayStart.toISOString();
    const thisMonthISO = thisMonthStart.toISOString();
    const lastMonthStartISO = lastMonthStart.toISOString();
    const lastMonthEndISO = lastMonthEnd.toISOString();

    // ========================================================
    // 并行执行所有独立查询 (Promise.all)
    // 数据库端过滤，不再全量拉取到内存
    // ========================================================

    const [
      // 1. 用户统计 (4个 count 查询)
      { count: totalUsers },
      { count: activeUsers },
      { count: newUsersThisMonth },
      { count: newUsersLastMonth },

      // 2. 模特统计 (3个 count 查询)
      { count: totalModels },
      { count: activeModels },
      { count: featuredModels },

      // 3. 积分统计 — 总积分通过 profiles.credits 求和
      { data: creditsSumData },

      // 4. 积分使用 — 数据库端按时间过滤 (3个独立查询替代全量拉取)
      { data: creditsUsedTodayData },
      { data: creditsUsedThisMonthData },
      { data: creditsUsedLastMonthData },

      // 5. 生成统计 — 数据库端 count 查询 (8个)
      { count: totalVideos },
      { count: totalImages },
      { count: videosToday },
      { count: imagesToday },
      { count: videosThisMonth },
      { count: imagesThisMonth },
      { count: totalGenerationsCount },
      { count: successfulGenerations },

      // 6. 最近活动 (1个查询，有 limit)
      { data: recentGenerations },

      // 7. 热门模特 (1个查询)
      { data: contracts },
    ] = await Promise.all([
      // — 用户统计 —
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", thisMonthISO),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", lastMonthStartISO).lte("created_at", lastMonthEndISO),

      // — 模特统计 —
      supabase.from("ai_models").select("*", { count: "exact", head: true }),
      supabase.from("ai_models").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("ai_models").select("*", { count: "exact", head: true }).eq("is_featured", true),

      // — 积分总量（仅取 credits 列，不取全部 profile 数据）—
      supabase.from("profiles").select("credits"),

      // — 积分使用（数据库端按时间过滤，仅取 credit_cost）—
      supabase.from("generations").select("credit_cost").gte("created_at", todayISO),
      supabase.from("generations").select("credit_cost").gte("created_at", thisMonthISO),
      supabase.from("generations").select("credit_cost").gte("created_at", lastMonthStartISO).lte("created_at", lastMonthEndISO),

      // — 生成统计（全部用 count 查询，不拉取数据）—
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "video"),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "image"),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "video").gte("created_at", todayISO),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "image").gte("created_at", todayISO),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "video").gte("created_at", thisMonthISO),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("type", "image").gte("created_at", thisMonthISO),
      supabase.from("generations").select("*", { count: "exact", head: true }),
      supabase.from("generations").select("*", { count: "exact", head: true }).eq("status", "completed"),

      // — 最近活动 —
      supabase.from("generations").select("type, user_id, model, created_at, status").order("created_at", { ascending: false }).limit(5),

      // — 热门模特的合约数据 —
      supabase.from("contracts").select("model_id, credits_paid").eq("status", "active"),
    ]);

    // ========================================================
    // 计算聚合值（JS 端仅处理小数据集）
    // ========================================================

    // 积分总量
    const totalCredits = creditsSumData?.reduce((sum, p) => sum + (p.credits || 0), 0) || 0;

    // 积分使用（已在数据库端按时间过滤，这里只做 reduce 求和）
    const creditsUsedToday = creditsUsedTodayData?.reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;
    const creditsUsedThisMonth = creditsUsedThisMonthData?.reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;
    const creditsUsedLastMonth = creditsUsedLastMonthData?.reduce((sum, g) => sum + (g.credit_cost || 0), 0) || 0;

    // 成功率
    const totalGen = totalGenerationsCount || 0;
    const successRate = totalGen > 0 ? Math.round(((successfulGenerations || 0) / totalGen) * 100) : 0;

    // 最近活动
    const recentActivity = (recentGenerations || []).map(g => ({
      action: g.type === "video" ? "视频生成" : "图片生成",
      user: g.user_id?.substring(0, 8) + "..." || "未知用户",
      detail: g.status === "completed" ? "成功" : g.status === "failed" ? "失败" : "处理中",
      time: formatTimeAgo(new Date(g.created_at)),
    }));

    // 热门模特
    const modelStats = new Map<string, { count: number; credits: number }>();
    contracts?.forEach(c => {
      const current = modelStats.get(c.model_id) || { count: 0, credits: 0 };
      current.count++;
      current.credits += c.credits_paid || 0;
      modelStats.set(c.model_id, current);
    });

    let topModels: { name: string; contracts: number; credits: number }[] = [];
    const modelIds = Array.from(modelStats.keys());
    if (modelIds.length > 0) {
      const { data: modelNames } = await supabase
        .from("ai_models")
        .select("id, name")
        .in("id", modelIds);

      topModels = Array.from(modelStats.entries())
        .map(([id, stats]) => ({
          name: modelNames?.find(m => m.id === id)?.name || "未知模特",
          contracts: stats.count,
          credits: stats.credits,
        }))
        .sort((a, b) => b.contracts - a.contracts)
        .slice(0, 5);
    }

    // ========================================================
    // 组装返回数据
    // ========================================================

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
        totalVideos: totalVideos || 0,
        totalImages: totalImages || 0,
        videosToday: videosToday || 0,
        imagestoday: imagesToday || 0,
        videosThisMonth: videosThisMonth || 0,
        imagesThisMonth: imagesThisMonth || 0,
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


