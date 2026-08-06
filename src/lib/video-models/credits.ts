import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import type { Json } from "@/types/database";
import type { AdminSupabaseClient, VideoModelId } from "./types";

interface CreditCheckResult {
  ok: boolean;
  currentCredits?: number;
  error?: string;
}

interface GenerationForRefund {
  user_id: string;
  credit_cost: number;
  metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getMissingSchemaColumn(error: unknown): string | null {
  const message =
    typeof (error as { message?: unknown })?.message === "string"
      ? (error as { message: string }).message
      : "";

  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ||
    message.match(/column generations\.([a-zA-Z0-9_]+) does not exist/)?.[1] ||
    null
  );
}

async function hasRefundTransaction(
  supabase: AdminSupabaseClient,
  taskId: string
) {
  const { data } = await supabase
    .from("credit_transactions")
    .select("id")
    .eq("type", "refund")
    .ilike("description", `%[task:${taskId}]%`)
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

async function updateGenerationForRefund(params: {
  supabase: AdminSupabaseClient;
  taskId: string;
  payload: Record<string, unknown>;
  select?: string;
  onlyProcessing?: boolean;
  onlyFailed?: boolean;
}): Promise<{ data: unknown; error: unknown }> {
  let candidate = { ...params.payload };
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = params.supabase
      .from("generations")
      .update(candidate as any)
      .eq("task_id", params.taskId);

    if (params.onlyProcessing) query = query.in("status", ["processing"]);
    if (params.onlyFailed) query = query.eq("status", "failed");

    const result = params.select
      ? await query.select(params.select).maybeSingle()
      : await query;

    if (!result.error) return { data: result.data, error: null };

    lastError = result.error;
    const missingColumn = getMissingSchemaColumn(result.error);
    if (
      missingColumn &&
      Object.prototype.hasOwnProperty.call(candidate, missingColumn)
    ) {
      const { [missingColumn]: _removed, ...nextCandidate } = candidate;
      candidate = nextCandidate;
      continue;
    }

    break;
  }

  return { data: null, error: lastError };
}

export async function checkVideoCredits(
  supabase: AdminSupabaseClient,
  userId: string,
  creditCost: number
): Promise<CreditCheckResult> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    return { ok: false, error: "用户未找到" };
  }

  if (profile.credits < creditCost) {
    return {
      ok: false,
      currentCredits: profile.credits,
      error: `积分不足！需要 ${creditCost} 积分，当前余额 ${profile.credits}`,
    };
  }

  return { ok: true, currentCredits: profile.credits };
}

export async function deductVideoCredits(params: {
  supabase: AdminSupabaseClient;
  userId: string;
  taskId: string;
  modelType: VideoModelId;
  creditCost: number;
  clientTaskId: string;
}) {
  const { supabase, userId, taskId, modelType, creditCost, clientTaskId } =
    params;
  const charge = await applyTaskCreditDelta({
    supabase: supabase as any,
    userId,
    entryKind: "consume",
    amount: -creditCost,
    scope: "video-model",
    taskId,
    operation: "consume",
    pricingVersion: `video-model-${modelType}-v1`,
    description: `素材生成视频 ${modelType} 扣费 (${taskId}) [task:${taskId}]`,
  });

  return {
    before: charge.balanceBefore,
    after: charge.balanceAfter,
    deducted: creditCost,
    applied: charge.applied,
    clientTaskId,
  };
}

export async function refundVideoCreditsDirect(params: {
  supabase: AdminSupabaseClient;
  userId: string;
  taskId: string;
  modelType: VideoModelId;
  amount: number;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<{ refunded: boolean; amount?: number }> {
  const { supabase, userId, taskId, modelType, amount } = params;
  if (amount <= 0) return { refunded: false };

  if (await hasRefundTransaction(supabase, taskId)) {
    return { refunded: false };
  }

  try {
    const refund = await applyTaskCreditDelta({
      supabase: supabase as any,
      userId,
      entryKind: "refund",
      amount,
      scope: "video-model",
      taskId,
      operation: "refund",
      pricingVersion: `video-model-${modelType}-v1`,
      description: `素材生成视频 ${modelType} 失败退款 (${taskId}) [task:${taskId}]`,
    });
    return { refunded: refund.applied, amount };
  } catch {
    return { refunded: false };
  }
}

export async function refundVideoCreditsOnce(params: {
  supabase: AdminSupabaseClient;
  taskId: string;
  modelType: VideoModelId;
  reason: string;
}): Promise<{ refunded: boolean; amount?: number }> {
  const { supabase, taskId, modelType, reason } = params;

  if (await hasRefundTransaction(supabase, taskId)) {
    return { refunded: false };
  }

  const { data: updated, error: updateError } =
    await updateGenerationForRefund({
      supabase,
      taskId,
      payload: {
        status: "failed",
        error_message: reason,
        credits_refunded: 0,
      },
      onlyProcessing: true,
      select: "user_id, credit_cost, metadata",
    });

  if (updateError || !updated) {
    return { refunded: false };
  }

  const generation = updated as GenerationForRefund;
  const amount = generation.credit_cost || 0;
  if (amount <= 0 || !generation.user_id) {
    return { refunded: false };
  }

  try {
    const refund = await applyTaskCreditDelta({
      supabase: supabase as any,
      userId: generation.user_id,
      entryKind: "refund",
      amount,
      scope: "video-model",
      taskId,
      operation: "refund",
      pricingVersion: `video-model-${modelType}-v1`,
      description: `素材生成视频 ${modelType} 失败退款 (${taskId}) [task:${taskId}]`,
    });
    if (!refund.applied) return { refunded: false };
  } catch (transactionError) {
    await updateGenerationForRefund({
      supabase,
      taskId,
      payload: {
        status: "processing",
        error_message: null,
        credits_refunded: 0,
      },
      onlyFailed: true,
    });
    throw transactionError;
  }

  await updateGenerationForRefund({
    supabase,
    taskId,
    payload: {
      credits_refunded: amount,
      metadata: {
        ...asRecord(generation.metadata),
        billing: {
          ...asRecord(asRecord(generation.metadata).billing),
          charged: true,
          refunded: true,
          refund_amount: amount,
          refund_reason: reason,
          refunded_at: new Date().toISOString(),
        },
      } as Json,
    },
  });

  return { refunded: true, amount };
}
