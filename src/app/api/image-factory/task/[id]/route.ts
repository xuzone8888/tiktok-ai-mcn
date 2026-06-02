/**
 * GET /api/image-factory/task/[id]
 * 
 * 查询电商图片任务状态（带轮询更新）
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { queryNanoBananaResult } from "@/lib/suchuang-api";
import type { OutputItem, EcomTaskStatus } from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "任务ID不能为空" },
        { status: 400 }
      );
    }

    // 2. 获取任务信息
    const adminClient = createAdminClient();
    const { data: task, error: taskError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    // 3. 如果任务正在生成图片，检查 Nano Banana 任务状态
    if (task.status === "generating_images") {
      const outputItems = (task.output_items as unknown as OutputItem[]) || [];
      let hasUpdates = false;
      let completedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < outputItems.length; i++) {
        const item = outputItems[i];

        // 只检查正在处理中的项
        if (item.status === "processing" && item.task_id) {
          const result = await queryNanoBananaResult(item.task_id);

          // 修复：正确读取返回格式 { success, task: { status, resultUrl } }
          if (result.success && result.task?.status === "completed" && result.task?.resultUrl) {
            outputItems[i] = {
              ...item,
              status: "completed",
              url: result.task.resultUrl,
            };
            hasUpdates = true;
            completedCount++;
          } else if (result.task?.status === "failed" || !result.success) {
            outputItems[i] = {
              ...item,
              status: "failed",
              error: result.task?.errorMessage || result.error || "图片生成失败",
            };
            hasUpdates = true;
            failedCount++;
          } else {
            // 仍在处理中
          }
        } else if (item.status === "completed") {
          completedCount++;
        } else if (item.status === "failed") {
          failedCount++;
        }
      }

      const processingCount = outputItems.filter(item => item.status === "processing").length;

      // 4. 如果有状态更新，保存到数据库
      if (hasUpdates) {
        const totalCount = outputItems.length;
        let newStatus: EcomTaskStatus = "generating_images";

        if (processingCount === 0) {
          // 所有任务都已完成
          if (failedCount === totalCount) {
            newStatus = "failed";
          } else if (failedCount > 0) {
            newStatus = "partial_success";
          } else {
            newStatus = "success";
          }
        }

        const updateData: Record<string, unknown> = {
          output_items: outputItems,
          status: newStatus,
        };

        if (newStatus === "success" || newStatus === "partial_success" || newStatus === "failed") {
          updateData.completed_at = new Date().toISOString();
        }

        if (failedCount > 0 && failedCount < totalCount) {
          updateData.error_message = `${failedCount}/${totalCount} 张图片生成失败`;
        } else if (failedCount === totalCount && totalCount > 0) {
          updateData.error_message = "所有图片生成失败";
        } else {
          updateData.error_message = null;
        }

        const { data: updatedTask, error: updateError } = await adminClient
          .from("ecom_image_tasks")
          .update(updateData)
          .eq("id", taskId)
          .eq("user_id", user.id)
          .eq("updated_at", task.updated_at)
          .select("*")
          .single();

        if (updateError || !updatedTask) {
          console.warn("[Task Status] Skipping stale task update/refund:", {
            taskId,
            updateError,
          });
        } else {
          // 更新返回的任务对象
          Object.assign(task, updatedTask);
          task.output_items = outputItems as unknown as typeof task.output_items;
        }
      }
    }

    const refundUpdatedTask = await reconcileNanoFailureRefund(adminClient, user.id, task);
    if (refundUpdatedTask) {
      Object.assign(task, refundUpdatedTask);
    }

    // 5. 返回任务信息
    return NextResponse.json({
      success: true,
      task,
    });

  } catch (error) {
    console.error("[Task Status] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

function getTaskMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }

  return {};
}

function getMetadataNumber(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function reconcileNanoFailureRefund(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  task: {
    id: string;
    user_id: string;
    status: string;
    output_items: unknown;
    metadata: unknown;
    credits_charged?: boolean | null;
    credits_cost?: number | null;
    updated_at: string;
  }
): Promise<Record<string, unknown> | null> {
  const outputItems = (task.output_items as unknown as OutputItem[]) || [];
  const processingCount = outputItems.filter(item => item.status === "processing").length;
  const failedCount = outputItems.filter(item => item.status === "failed" && item.task_id).length;
  const totalCount = outputItems.length;

  if (processingCount > 0 || failedCount <= 0 || totalCount <= 0) {
    return null;
  }

  const refundPlan = await getNanoFailureRefundPlan(adminClient, task.id, task, failedCount, totalCount);
  if (refundPlan.amount <= 0) {
    return null;
  }

  const refunded = await refundEcomTaskCredits(
    adminClient,
    userId,
    task.id,
    refundPlan.amount,
    `电商图片旧 NanoBanana 失败按比例退款 (${failedCount}/${totalCount}, ${task.id})`
  );

  if (!refunded) {
    return null;
  }

  const { data: updatedTask, error: metadataError } = await adminClient
    .from("ecom_image_tasks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ metadata: refundPlan.metadata as any })
    .eq("id", task.id)
    .eq("user_id", userId)
    .eq("updated_at", task.updated_at)
    .select("*")
    .single();

  if (metadataError || !updatedTask) {
    console.warn("[Task Status] Refund succeeded but metadata update was stale:", {
      taskId: task.id,
      metadataError,
    });
    return null;
  }

  return updatedTask as Record<string, unknown>;
}

async function getNanoFailureRefundPlan(
  adminClient: ReturnType<typeof createAdminClient>,
  taskId: string,
  task: { metadata: unknown; credits_charged?: boolean | null; credits_cost?: number | null },
  failedCount: number,
  totalCount: number
): Promise<{ amount: number; metadata: Record<string, unknown> }> {
  const metadata = getTaskMetadata(task.metadata);

  if (!task.credits_charged || failedCount <= 0 || totalCount <= 0) {
    return { amount: 0, metadata };
  }

  const creditsCost = Number(task.credits_cost || 0);
  if (creditsCost <= 0) {
    return { amount: 0, metadata };
  }

  const alreadyRefundedFailedCount = getMetadataNumber(metadata, "nano_failed_refund_count");
  const alreadyRefundedAmount = Math.max(
    getMetadataNumber(metadata, "nano_failed_refund_amount"),
    await getRecordedNanoFailureRefundAmount(adminClient, taskId)
  );

  if (failedCount <= alreadyRefundedFailedCount) {
    return { amount: 0, metadata };
  }

  const targetRefundAmount = failedCount === totalCount
    ? creditsCost
    : Math.round(creditsCost * failedCount / totalCount);
  const amount = Math.max(0, targetRefundAmount - alreadyRefundedAmount);

  if (amount <= 0) {
    return { amount: 0, metadata };
  }

  return {
    amount,
    metadata: {
      ...metadata,
      nano_failed_refund_count: failedCount,
      nano_failed_refund_amount: alreadyRefundedAmount + amount,
      nano_failure_refunded_at: new Date().toISOString(),
    },
  };
}

async function getRecordedNanoFailureRefundAmount(
  adminClient: ReturnType<typeof createAdminClient>,
  taskId: string
): Promise<number> {
  const { data, error } = await adminClient
    .from("credit_transactions")
    .select("amount, description")
    .eq("reference_type", "ecom_image_task")
    .eq("reference_id", taskId)
    .eq("type", "refund");

  if (error || !data) {
    console.error("[Task Status] Failed to read refund transactions:", error);
    return 0;
  }

  return data.reduce((sum, row) => {
    const transaction = row as { amount?: number; description?: string | null };
    if (!transaction.description?.includes("旧 NanoBanana 失败按比例退款")) {
      return sum;
    }

    return sum + Math.max(0, transaction.amount || 0);
  }, 0);
}

async function refundEcomTaskCredits(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  taskId: string,
  amount: number,
  description: string
): Promise<boolean> {
  if (amount <= 0) return true;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (!profile) return false;

  const currentCredits = (profile as { credits: number }).credits;
  const newBalance = currentCredits + amount;
  const { data: updatedProfile, error: refundError } = await adminClient
    .from("profiles")
    .update({ credits: newBalance })
    .eq("id", userId)
    .eq("credits", currentCredits)
    .select("credits")
    .single();

  if (refundError || !updatedProfile) {
    console.error("[Task Status] Failed to refund credits:", refundError);
    return false;
  }

  const transactionError = await adminClient.from("credit_transactions").insert({
    user_id: userId,
    amount,
    type: "refund",
    description,
    reference_type: "ecom_image_task",
    reference_id: taskId,
    balance_before: currentCredits,
    balance_after: newBalance,
  });

  if (transactionError.error) {
    console.error("[Task Status] Failed to record refund transaction:", transactionError.error);
  }

  return true;
}
