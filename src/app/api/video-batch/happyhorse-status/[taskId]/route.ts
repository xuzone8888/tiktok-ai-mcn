/**
 * HappyHorse video status polling.
 *
 * GET /api/video-batch/happyhorse-status/{taskId}
 */

import { NextRequest, NextResponse } from "next/server";
import { queryHappyHorseVideo } from "@/lib/dashscope-video-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { transferVeoVideoToOSS, isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";

export const maxDuration = 120;

async function refundCredits(userId: string, amount: number, taskId: string, reason: string) {
  try {
    const supabase = createAdminClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (!profile) return;

    await supabase
      .from("profiles")
      .update({ credits: profile.credits + amount })
      .eq("id", userId);

    await supabase.from("credit_transactions").insert({
      user_id: userId,
      amount,
      type: "refund",
      description: reason,
      balance_before: profile.credits,
      balance_after: profile.credits + amount,
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
    const { data: existingGen } = await supabase
      .from("generations")
      .select("status, result_url, video_url, user_id, credit_cost")
      .eq("task_id", taskId)
      .maybeSingle();

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
        .select("user_id, credit_cost")
        .single();

      if (failedRecord?.user_id && failedRecord.credit_cost > 0) {
        await refundCredits(
          failedRecord.user_id,
          failedRecord.credit_cost,
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
