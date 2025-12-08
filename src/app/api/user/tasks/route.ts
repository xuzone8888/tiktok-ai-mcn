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
  source: "quick_gen" | "batch_video" | "batch_image" | "link_video" | "ecom_image";
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

    // ============================================================================
    // 1. 从 generations 表获取任务记录
    // ============================================================================
    let generationsQuery = supabase
      .from("generations")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO)
      .order("created_at", { ascending: false });

    // 类型过滤
    if (type === "video") {
      generationsQuery = generationsQuery.eq("type", "video");
    } else if (type === "image") {
      generationsQuery = generationsQuery.eq("type", "image");
    }

    // 状态过滤
    if (status !== "all") {
      generationsQuery = generationsQuery.eq("status", status);
    }

    const { data: generationsTasks, error: generationsError } = await generationsQuery;

    if (generationsError) {
      console.error("[Tasks API] Error fetching generations:", generationsError);
    }

    // ============================================================================
    // 2. 从 ecom_image_tasks 表获取电商图片任务
    // ============================================================================
    let ecomTasks: TaskLogItem[] = [];
    
    // 只有在查询所有类型或图片类型时才查询 ecom_image_tasks
    if (type === "all" || type === "image") {
      let ecomQuery = supabase
        .from("ecom_image_tasks")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", sevenDaysAgoISO)
        .order("created_at", { ascending: false });

      // 状态过滤 - 映射状态
      if (status === "completed") {
        ecomQuery = ecomQuery.in("status", ["success", "partial_success"]);
      } else if (status === "failed") {
        ecomQuery = ecomQuery.eq("status", "failed");
      } else if (status === "processing") {
        ecomQuery = ecomQuery.in("status", ["created", "generating_prompts", "generating_images"]);
      }

      const { data: ecomData, error: ecomError } = await ecomQuery;

      if (ecomError) {
        console.error("[Tasks API] Error fetching ecom tasks:", ecomError);
      } else if (ecomData) {
        // 转换电商图片任务数据
        ecomTasks = ecomData.map((task) => {
          const createdAt = new Date(task.created_at);
          const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          
          // 获取第一个成功的输出图片作为结果 URL
          const outputItems = task.output_items as Array<{ url?: string; status?: string }> || [];
          const firstCompletedItem = outputItems.find(item => item.status === "completed" && item.url);
          
          // 映射状态
          let mappedStatus: "completed" | "failed" | "processing" | "pending" = "processing";
          if (task.status === "success" || task.status === "partial_success") {
            mappedStatus = "completed";
          } else if (task.status === "failed") {
            mappedStatus = "failed";
          } else {
            mappedStatus = "processing";
          }

          // 获取模式标签
          const modeLabels: Record<string, string> = {
            ecom_five_pack: "电商五图套装",
            white_background: "一键白底图",
            scene_image: "一键场景图",
            try_on: "一键试穿",
            buyer_show: "一键买家秀",
          };

          return {
            id: task.id,
            type: "image" as const,
            source: "ecom_image" as const,
            status: mappedStatus,
            resultUrl: firstCompletedItem?.url || null,
            thumbnailUrl: firstCompletedItem?.url || null,
            prompt: modeLabels[task.mode] || task.mode,
            model: task.model_type || "nano-banana",
            credits: task.credits_cost || 0,
            createdAt: task.created_at,
            completedAt: task.completed_at || null,
            expiresAt: expiresAt.toISOString(),
          };
        });
      }
    }

    // ============================================================================
    // 3. 合并和排序任务
    // ============================================================================
    
    // 转换 generations 任务数据
    const generationsLogs: TaskLogItem[] = (generationsTasks || []).map((task) => {
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

    // 合并两个来源的任务
    const allTasks = [...generationsLogs, ...ecomTasks];
    
    // 按创建时间降序排序
    allTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // 应用分页
    const taskLogs = allTasks.slice(offset, offset + limit);

    console.log("[Tasks API] Query result:", {
      userId: user.id,
      generationsCount: generationsTasks?.length || 0,
      ecomCount: ecomTasks.length,
      totalCount: allTasks.length,
    });

    // ============================================================================
    // 4. 计算统计数据
    // ============================================================================
    
    // generations 统计
    const { data: generationsStats } = await supabase
      .from("generations")
      .select("type, status, credit_cost")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO);

    // ecom_image_tasks 统计
    const { data: ecomStats } = await supabase
      .from("ecom_image_tasks")
      .select("status, credits_cost")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgoISO);

    // 合并统计
    const genStats = generationsStats || [];
    const ecomStatsData = ecomStats || [];

    const stats: TaskStats = {
      totalTasks: genStats.length + ecomStatsData.length,
      completedTasks: 
        genStats.filter(t => t.status === "completed").length + 
        ecomStatsData.filter(t => t.status === "success" || t.status === "partial_success").length,
      failedTasks: 
        genStats.filter(t => t.status === "failed").length + 
        ecomStatsData.filter(t => t.status === "failed").length,
      processingTasks: 
        genStats.filter(t => t.status === "processing" || t.status === "pending").length +
        ecomStatsData.filter(t => ["created", "generating_prompts", "generating_images"].includes(t.status)).length,
      totalVideos: genStats.filter(t => t.type === "video").length,
      totalImages: genStats.filter(t => t.type === "image").length + ecomStatsData.length,
      totalCreditsUsed: 
        genStats.reduce((sum, t) => sum + (t.credit_cost || 0), 0) +
        ecomStatsData.reduce((sum, t) => sum + (t.credits_cost || 0), 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        tasks: taskLogs,
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


