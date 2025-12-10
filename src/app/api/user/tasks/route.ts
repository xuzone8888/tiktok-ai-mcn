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
 * 
 * 数据来源:
 * - generations 表: 快速生成、批量生成的视频/图片
 * - ecom_image_tasks 表: 电商图片工厂任务
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface TaskLogItem {
  id: string;
  type: "video" | "image";
  source: "quick_gen" | "batch_video" | "batch_image" | "link_video" | "ecom_factory";
  status: "completed" | "failed" | "processing" | "pending";
  resultUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string;
  credits: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string; // 7天后过期
  // 电商图片工厂额外字段
  mode?: string;
  outputCount?: number;
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
    const supabase = await createClient();
    
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

    // ========== 并行查询两个表（提高性能）==========
    // 1. 查询 generations 表
    const generationsPromise = (async () => {
      // 如果只查询电商图片，跳过 generations 表
      if (type === "ecom") return [];
      
      let query = supabase
        .from("generations")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", sevenDaysAgoISO)
        .order("created_at", { ascending: false });

      if (type === "video") query = query.eq("type", "video");
      if (type === "image") query = query.eq("type", "image");
      if (status !== "all") query = query.eq("status", status);

      const { data } = await query;
      return data || [];
    })();
    
    // 2. 查询 ecom_image_tasks 表（电商图片工厂）
    const ecomPromise = (async () => {
      // 如果只查询视频，跳过电商图片任务
      if (type === "video") return [];
      
      let query = supabase
        .from("ecom_image_tasks")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", sevenDaysAgoISO)
        .order("created_at", { ascending: false });

      // 电商任务状态映射
      if (status === "completed") {
        query = query.in("status", ["success", "partial_success"]);
      } else if (status === "failed") {
        query = query.eq("status", "failed");
      } else if (status === "processing") {
        query = query.in("status", ["created", "generating_prompts", "generating_images"]);
      }

      const { data } = await query;
      return data || [];
    })();

    const [generationsTasks, ecomTasks] = await Promise.all([generationsPromise, ecomPromise]);

    console.log("[Tasks API] Query results:", {
      userId: user.id,
      generationsCount: generationsTasks.length,
      ecomTasksCount: ecomTasks.length,
    });

    // ========== 转换 generations 数据 ==========
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generationsLogs: TaskLogItem[] = generationsTasks.map((task: any) => {
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

    // ========== 转换 ecom_image_tasks 数据 ==========
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ecomLogs: TaskLogItem[] = ecomTasks.map((task: any) => {
      const createdAt = new Date(task.created_at);
      const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // 状态映射
      let mappedStatus: TaskLogItem["status"] = "processing";
      if (task.status === "success" || task.status === "partial_success") {
        mappedStatus = "completed";
      } else if (task.status === "failed") {
        mappedStatus = "failed";
      } else if (["created", "generating_prompts", "generating_images"].includes(task.status)) {
        mappedStatus = "processing";
      }

      // 获取第一张结果图片作为缩略图
      const outputItems = task.output_items || [];
      const firstSuccessItem = outputItems.find((item: { status: string; image_url?: string }) => 
        item.status === "success" && item.image_url
      );

      // 模式名称映射
      const modeNames: Record<string, string> = {
        ecom_five_pack: "五图套装",
        white_background: "白底图",
        scene_image: "场景图",
        try_on: "AI试穿",
        buyer_show: "买家秀",
      };
      
      return {
        id: task.id,
        type: "image" as const,
        source: "ecom_factory" as const,
        status: mappedStatus,
        resultUrl: firstSuccessItem?.image_url || null,
        thumbnailUrl: firstSuccessItem?.image_url || null,
        prompt: `电商图片工厂 - ${modeNames[task.mode] || task.mode}`,
        model: task.model_type || "nano-banana",
        credits: task.credits_cost || 0,
        createdAt: task.created_at,
        completedAt: task.updated_at || null,
        expiresAt: expiresAt.toISOString(),
        mode: task.mode,
        outputCount: outputItems.filter((item: { status: string }) => item.status === "success").length,
      };
    });

    // ========== 合并并排序（按创建时间倒序）==========
    const allTasks = [...generationsLogs, ...ecomLogs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 应用分页
    const paginatedTasks = allTasks.slice(offset, offset + limit);

    // ========== 计算统计数据 ==========
    const stats: TaskStats = {
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter(t => t.status === "completed").length,
      failedTasks: allTasks.filter(t => t.status === "failed").length,
      processingTasks: allTasks.filter(t => t.status === "processing" || t.status === "pending").length,
      totalVideos: allTasks.filter(t => t.type === "video").length,
      totalImages: allTasks.filter(t => t.type === "image").length,
      totalCreditsUsed: allTasks.reduce((sum, t) => sum + (t.credits || 0), 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        tasks: paginatedTasks,
        stats,
        pagination: {
          total: allTasks.length,
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


