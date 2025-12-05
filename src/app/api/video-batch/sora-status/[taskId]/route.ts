/**
 * Sora2 任务状态查询
 * 
 * GET /api/video-batch/sora-status/[taskId]
 * 
 * 查询 Sora2 任务状态，如果完成则更新数据库
 */

import { NextRequest, NextResponse } from "next/server";
import { querySora2Result } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// API Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    // 从 URL 参数获取是否为 Pro 模式
    const searchParams = request.nextUrl.searchParams;
    const isPro = searchParams.get("isPro") === "true";

    console.log("[Sora Status] Querying task:", taskId, "isPro:", isPro);

    // 查询 Sora2 任务状态
    const result = await querySora2Result(taskId, isPro);

    if (!result.success) {
      console.error("[Sora Status] Query failed:", result.error);
      return NextResponse.json(
        { success: false, error: result.error || "查询任务状态失败" },
        { status: 500 }
      );
    }

    const task = result.task;
    if (!task) {
      return NextResponse.json(
        { success: false, error: "未找到任务" },
        { status: 404 }
      );
    }

    console.log("[Sora Status] Task status:", {
      taskId,
      status: task.status,
      hasUrl: !!task.resultUrl,
    });

    // 如果任务完成或失败，更新数据库
    if (task.status === "completed" || task.status === "failed") {
      try {
        const supabase = createAdminClient();
        
        const updateData: Record<string, unknown> = {
          status: task.status,
          updated_at: new Date().toISOString(),
        };

        if (task.status === "completed" && task.resultUrl) {
          updateData.result_url = task.resultUrl;
          updateData.video_url = task.resultUrl;
          updateData.completed_at = new Date().toISOString();
        }

        if (task.status === "failed" && task.errorMessage) {
          updateData.error_message = task.errorMessage;
        }

        // 先检查记录是否存在
        const { data: existingRecord, error: checkError } = await supabase
          .from("generations")
          .select("id, status")
          .eq("task_id", taskId)
          .single();

        if (checkError) {
          console.log("[Sora Status] No existing record found for task:", taskId, checkError.message);
        } else if (existingRecord) {
          // 只有当状态需要更新时才更新
          if (existingRecord.status !== task.status) {
            const { error: updateError, count } = await supabase
              .from("generations")
              .update(updateData)
              .eq("task_id", taskId);

            if (updateError) {
              console.error("[Sora Status] Failed to update DB:", updateError);
            } else {
              console.log("[Sora Status] Updated DB for task:", taskId, "status:", task.status, "count:", count);
            }
          } else {
            console.log("[Sora Status] Status already up to date:", taskId, task.status);
          }
        }
      } catch (dbError) {
        console.error("[Sora Status] DB error:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.resultUrl,
        errorMessage: task.errorMessage,
      },
    });
  } catch (error) {
    console.error("[Sora Status] Error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "查询状态失败" 
      },
      { status: 500 }
    );
  }
}


