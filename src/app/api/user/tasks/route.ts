/**
 * 用户任务日志 API
 * 
 * GET /api/user/tasks - 获取用户的生成任务记录
 * 
 * 查询参数:
 * - type: "all" | "video" | "image" - 任务类型
 * - status: "all" | "completed" | "failed" | "processing" - 任务状态
 * - limit: number - 返回数量限制
 * - offset: number - 分页偏移
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface TaskLogItem {
  id: string;
  type: "video" | "image";
  source: "quick_gen" | "batch_video" | "batch_image" | "link_video";
  status: "completed" | "failed" | "processing" | "pending";
  resultUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string;
  credits: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string; // 7天后过期
}

export interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  processingTasks: number;
  totalVideos: number;
  totalImages: number;
  totalCreditsUsed: number;
}

// ============================================================================
// GET - 获取用户任务日志
// ============================================================================

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all";
    const status = searchParams.get("status") || "all";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // 计算 7 天前的时间戳（只保留 7 天内的记录）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // 从 generations 表获取任务记录（只返回 7 天内的）
    let query = supabase
      .from("generations")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO) // 只返回 7 天内的记录
      .order("created_at", { ascending: false });

    // 类型过滤
    if (type !== "all") {
      query = query.eq("type", type);
    }

    // 状态过滤
    if (status !== "all") {
      query = query.eq("status", status);
    }

    // 分页
    query = query.range(offset, offset + limit - 1);

    const { data: tasks, error } = await query;

    console.log("[Tasks API] Query result:", {
      userId: user.id,
      tasksCount: tasks?.length || 0,
      error: error?.message || null,
    });

    if (error) {
      console.error("[Tasks API] Error fetching tasks:", error);
      // 如果表不存在，返回空数据
      return NextResponse.json({
        success: true,
        data: {
          tasks: [],
          stats: {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            processingTasks: 0,
            totalVideos: 0,
            totalImages: 0,
            totalCreditsUsed: 0,
          },
          pagination: { total: 0, limit, offset },
        },
      });
    }
    
    // 打印第一个任务的详细信息用于调试
    if (tasks && tasks.length > 0) {
      console.log("[Tasks API] First task sample:", {
        id: tasks[0].id,
        type: tasks[0].type,
        source: tasks[0].source,
        status: tasks[0].status,
        result_url: tasks[0].result_url,
        video_url: tasks[0].video_url,
        image_url: tasks[0].image_url,
      });
    }

    // 转换任务数据
    const taskLogs: TaskLogItem[] = (tasks || []).map((task) => {
      const createdAt = new Date(task.created_at);
      const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      return {
        id: task.id,
        type: task.type || "video",
        source: task.source || "quick_gen",
        status: task.status || "completed",
        resultUrl: task.result_url || task.video_url || task.image_url || null,
        thumbnailUrl: task.thumbnail_url || null,
        prompt: task.prompt || null,
        model: task.model || "unknown",
        credits: task.credit_cost || 0,
        createdAt: task.created_at,
        completedAt: task.completed_at || null,
        expiresAt: expiresAt.toISOString(),
      };
    });

    // 计算统计数据（只统计 7 天内的记录）
    const { data: statsData } = await supabase
      .from("generations")
      .select("type, status, credit_cost")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO);

    const stats: TaskStats = {
      totalTasks: statsData?.length || 0,
      completedTasks: statsData?.filter(t => t.status === "completed").length || 0,
      failedTasks: statsData?.filter(t => t.status === "failed").length || 0,
      processingTasks: statsData?.filter(t => t.status === "processing" || t.status === "pending").length || 0,
      totalVideos: statsData?.filter(t => t.type === "video").length || 0,
      totalImages: statsData?.filter(t => t.type === "image").length || 0,
      totalCreditsUsed: statsData?.reduce((sum, t) => sum + (t.credit_cost || 0), 0) || 0,
    };

    // 获取总数用于分页（只计算 7 天内的记录）
    const { count } = await supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO);

    return NextResponse.json({
      success: true,
      data: {
        tasks: taskLogs,
        stats,
        pagination: {
          total: count || 0,
          limit,
          offset,
        },
      },
    });
  } catch (error) {
    console.error("[Tasks API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}


