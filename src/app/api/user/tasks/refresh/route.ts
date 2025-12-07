/**
 * 刷新处理中任务状态 API
 * 
 * POST /api/user/tasks/refresh
 * 
 * 检查并更新处于 "processing" 状态的任务
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { querySora2Result, queryNanoBananaResult } from "@/lib/suchuang-api";

export async function POST() {
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

    // 获取用户所有 processing 状态的任务
    const adminClient = createAdminClient();
    const { data: processingTasks, error } = await adminClient
      .from("generations")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "processing")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Refresh Tasks] Error fetching tasks:", error);
      return NextResponse.json(
        { success: false, error: "获取任务失败" },
        { status: 500 }
      );
    }

    if (!processingTasks || processingTasks.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          refreshed: 0,
          completed: 0,
          failed: 0,
          message: "没有处理中的任务",
        },
      });
    }

    console.log("[Refresh Tasks] Found processing tasks:", processingTasks.length);

    let refreshed = 0;
    let completed = 0;
    let failed = 0;

    // 逐个查询任务状态
    for (const task of processingTasks) {
      try {
        const taskId = task.task_id;
        const taskType = task.type;
        const taskModel = task.model || "";

        console.log("[Refresh Tasks] Checking task:", { taskId, taskType, taskModel });

        let newStatus: "completed" | "failed" | "processing" = "processing";
        let resultUrl: string | undefined;
        let errorMessage: string | undefined;

        if (taskType === "video") {
          // 视频任务 - 使用 Sora2 API 查询
          const isPro = taskModel.includes("pro") || taskModel.includes("hd") || taskModel.includes("25s");
          const result = await querySora2Result(taskId, isPro);
          
          if (result.success && result.task) {
            if (result.task.status === "completed") {
              newStatus = "completed";
              resultUrl = result.task.resultUrl;
            } else if (result.task.status === "failed") {
              newStatus = "failed";
              errorMessage = result.task.errorMessage;
            }
          }
        } else if (taskType === "image") {
          // 图片任务 - 使用 NanoBanana API 查询
          const model = taskModel.includes("pro") ? "nano-banana-pro" : "nano-banana";
          const result = await queryNanoBananaResult(taskId, model);
          
          if (result.success && result.task) {
            if (result.task.status === "completed") {
              newStatus = "completed";
              resultUrl = result.task.resultUrl;
            } else if (result.task.status === "failed") {
              newStatus = "failed";
              errorMessage = result.task.errorMessage;
            }
          }
        }

        // 如果状态有变化，更新数据库
        // 如果状态有变化，更新数据库（注意：generations 表没有 updated_at 字段）
        if (newStatus !== "processing") {
          const updateData: Record<string, unknown> = {
            status: newStatus,
          };

          if (newStatus === "completed" && resultUrl) {
            updateData.result_url = resultUrl;
            if (taskType === "video") {
              updateData.video_url = resultUrl;
            } else {
              updateData.image_url = resultUrl;
            }
            updateData.completed_at = new Date().toISOString();
          }

          if (newStatus === "failed" && errorMessage) {
            updateData.error_message = errorMessage;
          }

          await adminClient
            .from("generations")
            .update(updateData)
            .eq("id", task.id);

          refreshed++;
          if (newStatus === "completed") {
            completed++;
          } else {
            failed++;
          }

          console.log("[Refresh Tasks] Updated task:", {
            taskId,
            newStatus,
            hasUrl: !!resultUrl,
          });
        }
      } catch (taskError) {
        console.error("[Refresh Tasks] Error checking task:", task.task_id, taskError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: processingTasks.length,
        refreshed,
        completed,
        failed,
        stillProcessing: processingTasks.length - refreshed,
        message: `已检查 ${processingTasks.length} 个任务，更新了 ${refreshed} 个`,
      },
    });
  } catch (error) {
    console.error("[Refresh Tasks] Error:", error);
    return NextResponse.json(
      { success: false, error: "刷新任务状态失败" },
      { status: 500 }
    );
  }
}

