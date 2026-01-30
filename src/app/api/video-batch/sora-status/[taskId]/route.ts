/**
 * Sora2 任务状态查询
 * 
 * GET /api/video-batch/sora-status/[taskId]
 * 
 * 查询 Sora2 任务状态，如果完成则更新数据库
 * 如果失败则自动退还积分
 */

import { NextRequest, NextResponse } from "next/server";
import { querySora2Result } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// 退还积分的辅助函数
async function refundCredits(userId: string, amount: number, taskId: string, reason: string) {
  try {
    const supabase = createAdminClient();

    // 获取用户当前积分
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[Sora Status] Refund failed - user not found:", userId);
      return false;
    }

    const newCredits = profile.credits + amount;

    // 退还积分
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (updateError) {
      console.error("[Sora Status] Refund failed - update error:", updateError);
      return false;
    }

    console.log("[Sora Status] Credits refunded:", {
      userId,
      amount,
      taskId,
      reason,
      newBalance: newCredits,
    });

    return true;
  } catch (error) {
    console.error("[Sora Status] Refund exception:", error);
    return false;
  }
}

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

    // 从 URL 参数获取是否为 Pro 模式和 API 线路
    const searchParams = request.nextUrl.searchParams;
    const isPro = searchParams.get("isPro") === "true";
    const apiLine = (searchParams.get("apiLine") as "line1" | "line2" | "line3") || "line1";

    console.log("[Sora Status] Querying task:", taskId, "isPro:", isPro, "apiLine:", apiLine);

    // 查询 Sora2 任务状态
    const result = await querySora2Result(taskId, isPro, undefined, apiLine);

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

        // 注意：generations 表没有 updated_at 字段
        const updateData: Record<string, unknown> = {
          status: task.status,
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
          .select("id, status, user_id, credit_cost")
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

              // 🔥 如果任务失败，自动退还积分
              if (task.status === "failed" && existingRecord.user_id && existingRecord.credit_cost > 0) {
                const refunded = await refundCredits(
                  existingRecord.user_id,
                  existingRecord.credit_cost,
                  taskId,
                  `视频生成失败自动退款: ${task.errorMessage || "第三方服务返回失败"}`
                );
                if (refunded) {
                  console.log("[Sora Status] Auto refund successful for task:", taskId, "amount:", existingRecord.credit_cost);
                }
              }
            }
          } else {
            console.log("[Sora Status] Status already up to date:", taskId, task.status);
          }
        }
      } catch (dbError) {
        console.error("[Sora Status] DB error:", dbError);
      }
    }

    // 为失败的任务添加更友好的错误提示
    let errorMessage = task.errorMessage;
    let refundNote = "";
    let suggestion = "";

    if (task.status === "failed") {
      // 分析错误类型并提供针对性建议
      if (errorMessage?.includes("内容政策") || errorMessage?.includes("E-1103")) {
        // 内容审核失败
        suggestion = "建议：1)更换更正式的产品图 2)修改提示词描述 3)避免过于贴身的服装展示";
        errorMessage = "内容审核未通过：图片或提示词可能包含敏感内容";
      } else if (errorMessage?.includes("timeout") || errorMessage?.includes("超时")) {
        suggestion = "建议：稍后重试，或选择标清模式以加快生成速度";
      } else if (!errorMessage || errorMessage === "failed") {
        errorMessage = "第三方 AI 视频服务暂时繁忙，请稍后重试";
      }
      refundNote = "积分已自动退还到您的账户";
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.resultUrl,
        errorMessage: errorMessage,
        refundNote: task.status === "failed" ? refundNote : undefined,
        suggestion: task.status === "failed" && suggestion ? suggestion : undefined,
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


