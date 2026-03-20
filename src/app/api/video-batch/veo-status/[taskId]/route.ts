/**
 * VEO3 批量视频状态查询（使用高瑞 gaorui-veo-api）
 *
 * GET /api/video-batch/veo-status/{taskId}
 *
 * 用于所有 VEO3 模型的异步轮询查询（veo3-fast / veo3-std / veo3-4k 全部是 async 模式）
 */

import { NextRequest, NextResponse } from "next/server";
import { queryVeoResult } from "@/lib/gaorui-veo-api";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "Missing taskId" },
        { status: 400 }
      );
    }

    console.log("[VEO3 Status] Querying task:", taskId);

    const result = await queryVeoResult(taskId);

    if (!result.success || !result.task) {
      console.error("[VEO3 Status] Query failed:", result.error);
      return NextResponse.json({
        success: false,
        error: result.error || "查询失败",
      });
    }

    const task = result.task;
    console.log("[VEO3 Status] Task status:", {
      taskId,
      status: task.status,
      hasUrl: !!task.videoUrl,
      progress: task.progress,
    });

    // 如果任务完成，更新数据库记录
    if (task.status === "completed" && task.videoUrl) {
      try {
        const supabase = createAdminClient();
        const { error: updateError } = await supabase
          .from("generations")
          .update({
            status: "completed",
            result_url: task.videoUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", taskId);

        if (updateError) {
          console.error("[VEO3 Status] Failed to update DB record:", updateError);
        } else {
          console.log("[VEO3 Status] Updated DB record to completed:", taskId);
        }
      } catch (dbError) {
        console.error("[VEO3 Status] DB update error:", dbError);
      }
    } else if (task.status === "failed") {
      try {
        const supabase = createAdminClient();
        const { error: updateError } = await supabase
          .from("generations")
          .update({
            status: "failed",
            error_message: task.errorMessage || "生成失败",
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", taskId);

        if (updateError) {
          console.error("[VEO3 Status] Failed to update failed status:", updateError);
        }
      } catch (dbError) {
        console.error("[VEO3 Status] DB update error:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.videoUrl,
        progress: task.progress,
        errorMessage: task.errorMessage,
      },
    });
  } catch (error) {
    console.error("[VEO3 Status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "查询失败",
      },
      { status: 500 }
    );
  }
}
