/**
 * Grok Imagine 批量视频状态查询
 *
 * GET /api/video-batch/grok-status/{taskId}
 *
 * 速创 wuyinkeji API:
 *   查询: GET /api/async/detail?key=...&id=...
 *   状态: 0=处理中, 2=完成, 3=失败
 */

import { NextRequest, NextResponse } from "next/server";
import { queryGrokImagineResult } from "@/lib/grok-imagine-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

    // 归属校验：只有任务所属用户能查询与推进状态（沿用 sora-status/happyhorse-status 范式）
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }
    const ownershipClient = createAdminClient();
    const { data: existingGen } = await ownershipClient
      .from("generations")
      .select("id")
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existingGen) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权查看" },
        { status: 404 }
      );
    }

    console.log("[Grok Status] Querying task:", taskId);

    const result = await queryGrokImagineResult(taskId);

    if (!result.success || !result.task) {
      console.error("[Grok Status] Query failed:", result.error);
      return NextResponse.json({
        success: false,
        error: result.error || "查询失败",
      });
    }

    const task = result.task;
    console.log("[Grok Status] Task status:", {
      taskId,
      status: task.status,
      hasUrl: !!task.videoUrl,
      duration: task.duration,
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
            completed_at: new Date().toISOString(),
          })
          .eq("task_id", taskId)
          .eq("user_id", user.id);

        if (updateError) {
          console.error("[Grok Status] Failed to update DB record:", updateError);
        } else {
          console.log("[Grok Status] Updated DB record to completed:", taskId);
        }
      } catch (dbError) {
        console.error("[Grok Status] DB update error:", dbError);
      }
    } else if (task.status === "failed") {
      try {
        const supabase = createAdminClient();
        const { error: updateError } = await supabase
          .from("generations")
          .update({
            status: "failed",
            error_message: task.errorMessage || "生成失败",
          })
          .eq("task_id", taskId)
          .eq("user_id", user.id);

        if (updateError) {
          console.error("[Grok Status] Failed to update failed status:", updateError);
        }
      } catch (dbError) {
        console.error("[Grok Status] DB update error:", dbError);
      }
    }

    // 统一返回格式（与 VEO/Sora 兼容）
    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.videoUrl,
        progress: task.status === "completed" ? 100 : task.status === "failed" ? 0 : 50,
        errorMessage: task.errorMessage,
      },
    });
  } catch (error) {
    console.error("[Grok Status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "查询失败",
      },
      { status: 500 }
    );
  }
}
