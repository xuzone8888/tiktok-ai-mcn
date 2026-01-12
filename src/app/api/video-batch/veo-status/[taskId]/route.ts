/**
 * VEO3 任务状态查询
 * 
 * GET /api/video-batch/veo-status/[taskId]
 */

import { NextRequest, NextResponse } from "next/server";
import { queryVeo3Result } from "@/lib/veo3-api";
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

    const result = await queryVeo3Result(taskId);

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
      hasUrl: !!task.resultUrl,
      progress: task.progress,
    });

    // 如果任务完成，更新数据库记录
    if (task.status === "completed" && task.resultUrl) {
      try {
        const supabase = createAdminClient();
        const { error: updateError } = await supabase
          .from("generations")
          .update({
            status: "completed",
            result_url: task.resultUrl,
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
        videoUrl: task.resultUrl,
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
