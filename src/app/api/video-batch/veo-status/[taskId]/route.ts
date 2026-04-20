/**
 * VEO3 批量视频状态查询（使用高瑞 gaorui-veo-api）
 *
 * GET /api/video-batch/veo-status/{taskId}
 *
 * 用于所有 VEO3 模型的异步轮询查询（veo3-fast / veo3-std / veo3-4k 全部是 async 模式）
 *
 * 2026-04-20 更新：视频完成后自动转存到 OSS（video_url 临时链接仅几分钟有效）
 */

import { NextRequest, NextResponse } from "next/server";
import { queryVeoResult } from "@/lib/gaorui-veo-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { transferVeoVideoToOSS, isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";

export const maxDuration = 120; // 转存可能需要额外时间

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

    // 先检查数据库是否已有 OSS URL（之前已转存过）
    const supabase = createAdminClient();
    const { data: existingGen } = await supabase
      .from("generations")
      .select("status, result_url, video_url, user_id")
      .eq("task_id", taskId)
      .single();

    // 如果数据库已有完成记录且 URL 已是 OSS，直接返回
    if (existingGen?.status === "completed" && existingGen?.result_url && isOSSPermanentUrl(existingGen.result_url)) {
      console.log("[VEO3 Status] Already transferred to OSS, returning cached URL");
      return NextResponse.json({
        success: true,
        data: {
          taskId,
          status: "completed",
          videoUrl: existingGen.result_url,
          progress: 100,
        },
      });
    }

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

    // 如果任务完成，立即转存到 OSS
    if (task.status === "completed" && task.videoUrl) {
      let finalVideoUrl = task.videoUrl;

      // 如果 URL 不是 OSS 永久地址，执行转存
      if (!isOSSPermanentUrl(task.videoUrl)) {
        // 使用数据库乐观锁，防止并发重复转存
        const { data: lockResult, error: lockError } = await supabase
          .from("generations")
          .update({
            status: "transferring",
          })
          .eq("task_id", taskId)
          .eq("status", "processing") // 乐观锁：只有 processing 状态才能转
          .select("user_id")
          .single();

        if (lockResult && !lockError) {
          // 获得锁，执行转存
          const userId = lockResult.user_id || existingGen?.user_id;
          console.log("[VEO3 Status] Starting OSS transfer for task:", taskId);

          const transferResult = await transferVeoVideoToOSS(
            taskId,
            task.videoUrl,
            userId || undefined
          );

          if (transferResult.success && transferResult.ossUrl) {
            finalVideoUrl = transferResult.ossUrl;
            console.log("[VEO3 Status] ✅ OSS transfer success:", finalVideoUrl);
          } else {
            console.warn("[VEO3 Status] ⚠️ OSS transfer failed, using original URL:", transferResult.error);
            // 转存失败，仍然返回原始 URL（让前端走 download-proxy 再试）
          }

          // 更新数据库为完成状态 + 最终 URL
          await supabase
            .from("generations")
            .update({
              status: "completed",
              result_url: finalVideoUrl,
              video_url: finalVideoUrl,
              completed_at: new Date().toISOString(),
            })
            .eq("task_id", taskId);
        } else {
          // 未获得锁（可能其他请求在转存，或状态已是 completed/transferring）
          console.log("[VEO3 Status] Lock not acquired, checking existing result...");

          // 等一小段时间让并发转存完成，然后查数据库
          await new Promise(resolve => setTimeout(resolve, 2000));
          const { data: updatedGen } = await supabase
            .from("generations")
            .select("result_url, status")
            .eq("task_id", taskId)
            .single();

          if (updatedGen?.result_url && isOSSPermanentUrl(updatedGen.result_url)) {
            finalVideoUrl = updatedGen.result_url;
          } else if (updatedGen?.status === "transferring") {
            // 另一个请求正在转存中，返回 processing 让前端继续轮询
            return NextResponse.json({
              success: true,
              data: {
                taskId: task.taskId,
                status: "processing",
                progress: 95,
              },
            });
          }
        }
      } else {
        // 已经是 OSS URL，直接更新数据库
        try {
          await supabase
            .from("generations")
            .update({
              status: "completed",
              result_url: task.videoUrl,
              completed_at: new Date().toISOString(),
            })
            .eq("task_id", taskId);
          console.log("[VEO3 Status] Updated DB record to completed:", taskId);
        } catch (dbError) {
          console.error("[VEO3 Status] DB update error:", dbError);
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          taskId: task.taskId,
          status: "completed",
          videoUrl: finalVideoUrl,
          progress: 100,
          errorMessage: task.errorMessage,
        },
      });
    } else if (task.status === "failed") {
      try {
        const { error: updateError } = await supabase
          .from("generations")
          .update({
            status: "failed",
            error_message: task.errorMessage || "生成失败",
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
