/**
 * 用户数据统计 API
 * 
 * GET /api/user/stats - 获取用户的运营数据统计
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface UserStats {
  // 积分相关
  credits: {
    current: number;         // 当前积分
    totalUsed: number;       // 累计使用积分
    thisMonth: number;       // 本月使用积分
    lastMonth: number;       // 上月使用积分
  };
  
  // 签约模特
  models: {
    total: number;           // 签约模特数量
    active: number;          // 活跃合约数
    expiringSoon: number;    // 即将到期（7天内）
  };
  
  // 视频生成
  videos: {
    total: number;           // 总生成视频数
    thisMonth: number;       // 本月生成
    lastMonth: number;       // 上月生成
    completed: number;       // 成功数
    failed: number;          // 失败数
  };
  
  // 图片生成
  images: {
    total: number;           // 总生成图片数
    thisMonth: number;       // 本月生成
    lastMonth: number;       // 上月生成
    completed: number;       // 成功数
    failed: number;          // 失败数
  };
  
  // 最近活动
  recentActivity: {
    type: "video" | "image";
    title: string;
    model: string;
    status: string;
    createdAt: string;
  }[];
}

// ============================================================================
// GET - 获取用户统计数据
// ============================================================================

export async function GET() {
  try {
    const supabase = createClient();
    
    // 获取当前登录用户
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 时间范围计算
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 1. 获取用户积分
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    const currentCredits = profile?.credits || 0;

    // 2. 获取签约模特数量
    const { data: contracts } = await supabase
      .from("contracts")
      .select("id, status, end_date")
      .eq("user_id", user.id);

    const activeContracts = contracts?.filter(c => c.status === "active") || [];
    const expiringSoon = activeContracts.filter(c => {
      if (!c.end_date) return false;
      const endDate = new Date(c.end_date);
      return endDate <= sevenDaysLater;
    });

    // 3. 获取生成记录统计
    const { data: generations } = await supabase
      .from("generations")
      .select("type, status, credit_cost, created_at")
      .eq("user_id", user.id);

    // 视频统计
    const videoTasks = generations?.filter(g => g.type === "video") || [];
    const videoThisMonth = videoTasks.filter(g => new Date(g.created_at) >= thisMonthStart);
    const videoLastMonth = videoTasks.filter(g => {
      const date = new Date(g.created_at);
      return date >= lastMonthStart && date <= lastMonthEnd;
    });

    // 图片统计
    const imageTasks = generations?.filter(g => g.type === "image") || [];
    const imageThisMonth = imageTasks.filter(g => new Date(g.created_at) >= thisMonthStart);
    const imageLastMonth = imageTasks.filter(g => {
      const date = new Date(g.created_at);
      return date >= lastMonthStart && date <= lastMonthEnd;
    });

    // 积分使用统计
    const creditsThisMonth = (generations || [])
      .filter(g => new Date(g.created_at) >= thisMonthStart)
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0);
    
    const creditsLastMonth = (generations || [])
      .filter(g => {
        const date = new Date(g.created_at);
        return date >= lastMonthStart && date <= lastMonthEnd;
      })
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0);

    const totalCreditsUsed = (generations || [])
      .reduce((sum, g) => sum + (g.credit_cost || 0), 0);

    // 4. 获取最近活动
    const { data: recentTasks } = await supabase
      .from("generations")
      .select("type, prompt, model, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const recentActivity = (recentTasks || []).map(task => ({
      type: task.type || "video",
      title: task.prompt?.substring(0, 30) + (task.prompt?.length > 30 ? "..." : "") || "未命名任务",
      model: task.model || "Unknown",
      status: task.status || "completed",
      createdAt: task.created_at,
    }));

    const stats: UserStats = {
      credits: {
        current: currentCredits,
        totalUsed: totalCreditsUsed,
        thisMonth: creditsThisMonth,
        lastMonth: creditsLastMonth,
      },
      models: {
        total: contracts?.length || 0,
        active: activeContracts.length,
        expiringSoon: expiringSoon.length,
      },
      videos: {
        total: videoTasks.length,
        thisMonth: videoThisMonth.length,
        lastMonth: videoLastMonth.length,
        completed: videoTasks.filter(v => v.status === "completed").length,
        failed: videoTasks.filter(v => v.status === "failed").length,
      },
      images: {
        total: imageTasks.length,
        thisMonth: imageThisMonth.length,
        lastMonth: imageLastMonth.length,
        completed: imageTasks.filter(i => i.status === "completed").length,
        failed: imageTasks.filter(i => i.status === "failed").length,
      },
      recentActivity,
    };

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("[Stats API] Error:", error);
    // 返回默认数据
    return NextResponse.json({
      success: true,
      data: {
        credits: { current: 0, totalUsed: 0, thisMonth: 0, lastMonth: 0 },
        models: { total: 0, active: 0, expiringSoon: 0 },
        videos: { total: 0, thisMonth: 0, lastMonth: 0, completed: 0, failed: 0 },
        images: { total: 0, thisMonth: 0, lastMonth: 0, completed: 0, failed: 0 },
        recentActivity: [],
      },
    });
  }
}

