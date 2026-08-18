/**
 * Sora2 任务状态查询
 * 
 * GET /api/video-batch/sora-status/[taskId]
 * 
 * 查询 Sora2 任务状态，如果完成则更新数据库
 * 如果失败则自动退还积分
 */

import { NextRequest, NextResponse } from "next/server";
import { applyTaskCreditDelta, type TaskCreditScope } from "@/lib/credits/atomic-task-credit";
import { querySora2Result } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// 退还积分的辅助函数
async function refundCredits(
  userId: string,
  amount: number,
  billingTaskId: string,
  scope: TaskCreditScope,
  taskId: string,
  reason: string
) {
  try {
    const supabase = createAdminClient();
    const refund = await applyTaskCreditDelta({
      supabase,
      userId,
      entryKind: "refund",
      amount,
      scope,
      taskId: billingTaskId,
      operation: "refund",
      pricingVersion: `${scope}-refund-v1`,
      description: `${reason} (${taskId})`,
    });

    console.log("[Sora Status] Credits refunded:", {
      userId,
      amount,
      taskId,
      reason,
      newBalance: refund.balanceAfter,
    });

    return refund.applied;
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
    const { data: existingRecord, error: ownershipError } = await ownershipClient
      .from("generations")
      .select("id, status, user_id, credit_cost, metadata")
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownershipError || !existingRecord) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权查看" },
        { status: 404 }
      );
    }

    // 从 URL 参数获取是否为 Pro 模式
    const searchParams = request.nextUrl.searchParams;
    const isPro = searchParams.get("isPro") === "true";

    console.log("[Sora Status] Querying task:", taskId, "isPro:", isPro);

    // 查询 Sora2 任务状态 (固定使用 line3)
    const result = await querySora2Result(taskId, isPro, undefined, "line3");

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

        if (existingRecord.status !== task.status) {
            const { data: updateResult, error: updateError } = await supabase
              .from("generations")
              .update(updateData)
              .eq("id", existingRecord.id)
              .eq("status", existingRecord.status)
              .select("id")
              .maybeSingle();

            if (updateError) {
              console.error("[Sora Status] Failed to update DB:", updateError);
            } else if (updateResult) {
              console.log("[Sora Status] Updated DB for task:", taskId, "status:", task.status);

              // 🔥 如果任务失败，自动退还积分
              if (task.status === "failed" && existingRecord.user_id && existingRecord.credit_cost > 0) {
                const metadata =
                  existingRecord.metadata &&
                  typeof existingRecord.metadata === "object" &&
                  !Array.isArray(existingRecord.metadata)
                    ? existingRecord.metadata as Record<string, unknown>
                    : {};
                const scope: TaskCreditScope =
                  metadata.billing_scope === "character-video"
                    ? "character-video"
                    : "sora-status";
                const billingTaskId =
                  typeof metadata.billing_task_id === "string"
                    ? metadata.billing_task_id
                    : existingRecord.id;
                const refunded = await refundCredits(
                  existingRecord.user_id,
                  existingRecord.credit_cost,
                  billingTaskId,
                  scope,
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

    // 对需要鉴权的视频 URL（如望景API的 /content 端点）包装为代理 URL
    // 这样前端无论是 <video src> 播放还是下载都通过代理自动带 auth
    let finalVideoUrl = task.resultUrl;

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: finalVideoUrl,
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


