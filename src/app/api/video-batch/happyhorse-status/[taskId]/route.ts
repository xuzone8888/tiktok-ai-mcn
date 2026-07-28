/**
 * HappyHorse video status polling.
 *
 * GET /api/video-batch/happyhorse-status/{taskId}
 */

import { NextRequest, NextResponse } from "next/server";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { queryHappyHorseVideo } from "@/lib/dashscope-video-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { transferVeoVideoToOSS, isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";

export const maxDuration = 120;

async function refundCredits(userId: string, amount: number, billingTaskId: string, taskId: string, reason: string) {
  try {
    const supabase = createAdminClient();
    await applyTaskCreditDelta({
      supabase,
      userId,
      entryKind: "refund",
      amount,
      scope: "happyhorse",
      taskId: billingTaskId,
      operation: "refund",
      pricingVersion: "happyhorse-refund-v1",
      description: reason,
    });
  } catch (error) {
    console.error("[HappyHorse Status] Refund failed:", error);
  }
}

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

    const supabase = createAdminClient();
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
    const { data: existingGen } = await supabase
      .from("generations")
      .select("id, status, result_url, video_url, user_id, credit_cost")
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existingGen) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权查看" },
        { status: 404 }
      );
    }

    if (existingGen?.status === "completed" && existingGen?.result_url && isOSSPermanentUrl(existingGen.result_url)) {
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

    const result = await queryHappyHorseVideo(taskId);
    if (!result.success || !result.task) {
      return NextResponse.json({
        success: false,
        error: result.error || "HappyHorse 状态查询失败",
      });
    }

    const task = result.task;

    if (task.status === "completed" && task.videoUrl) {
      let finalVideoUrl = task.videoUrl;

      if (!isOSSPermanentUrl(task.videoUrl)) {
        const { data: lockResult, error: lockError } = await supabase
          .from("generations")
          .update({ status: "transferring" })
          .eq("task_id", taskId)
          .eq("status", "processing")
          .select("user_id")
          .single();

        if (lockResult && !lockError) {
          const transferResult = await transferVeoVideoToOSS(
            taskId,
            task.videoUrl,
            lockResult.user_id || existingGen?.user_id || undefined
          );

          if (transferResult.success && transferResult.ossUrl) {
            finalVideoUrl = transferResult.ossUrl;
          } else {
            console.warn("[HappyHorse Status] OSS transfer failed:", transferResult.error);
          }

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
          await new Promise(resolve => setTimeout(resolve, 2000));
          const { data: updatedGen } = await supabase
            .from("generations")
            .select("status, result_url")
            .eq("task_id", taskId)
            .maybeSingle();

          if (updatedGen?.result_url && isOSSPermanentUrl(updatedGen.result_url)) {
            finalVideoUrl = updatedGen.result_url;
          } else if (updatedGen?.status === "transferring") {
            return NextResponse.json({
              success: true,
              data: {
                taskId,
                status: "processing",
                progress: 95,
              },
            });
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          taskId: task.taskId,
          status: "completed",
          videoUrl: finalVideoUrl,
          progress: 100,
        },
      });
    }

    if (task.status === "failed") {
      const { data: failedRecord } = await supabase
        .from("generations")
        .update({
          status: "failed",
          error_message: task.errorMessage || "HappyHorse 视频生成失败",
        })
        .eq("task_id", taskId)
        .eq("status", "processing")
        .select("id, user_id, credit_cost")
        .single();

      if (failedRecord?.user_id && failedRecord.credit_cost > 0) {
        await refundCredits(
          failedRecord.user_id,
          failedRecord.credit_cost,
          failedRecord.id,
          taskId,
          `HappyHorse 视频生成失败自动退款 (${taskId})`
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.videoUrl,
        progress: task.status === "pending" ? 10 : 50,
        errorMessage: task.errorMessage,
      },
    });
  } catch (error) {
    console.error("[HappyHorse Status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "HappyHorse 状态查询失败",
      },
      { status: 500 }
    );
  }
}
