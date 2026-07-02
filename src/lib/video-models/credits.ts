import type { AdminSupabaseClient, VideoModelId } from "./types";
import type { Json } from "@/types/database";

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
    ? value as Record<string, unknown>
    : {};
}

function getMissingSchemaColumn(error: unknown): string | null {
  const message = typeof (error as { message?: unknown })?.message === "string"
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

export async function insertCreditTransaction(
  supabase: AdminSupabaseClient,
  params: {
    userId: string;
    type: "consume" | "refund";
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    taskId: string;
    description: string;
    metadata?: Record<string, unknown>;
  }
) {
  const candidateTypes = params.type === "consume" ? ["usage", "consume"] : ["refund"];
  let lastError: unknown;

  for (const type of candidateTypes) {
    const payload = {
      user_id: params.userId,
      type,
      amount: params.amount,
      balance_before: params.balanceBefore,
      balance_after: params.balanceAfter,
      reference_type: "generation",
      reference_id: null,
      description: `${params.description} [task:${params.taskId}]`,
    };

    const { error } = await supabase.from("credit_transactions").insert({
      ...payload,
      metadata: {
        ...(params.metadata || {}),
        task_id: params.taskId,
      } as Json,
    });

    if (!error) return;
    if (error.code === "PGRST204" && error.message?.includes("metadata")) {
      const retry = await supabase.from("credit_transactions").insert(payload);
      if (!retry.error) return;
      lastError = retry.error;
      continue;
    }
    lastError = error;
  }

  throw lastError instanceof Error ? lastError : new Error("写入积分流水失败");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function adjustProfileCredits(params: {
  supabase: AdminSupabaseClient;
  userId: string;
  delta: number;
  insufficientError?: string;
}): Promise<{ before: number; after: number }> {
  const { supabase, userId, delta, insufficientError } = params;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      throw new Error("用户未找到");
    }

    const before = profile.credits;
    const after = before + delta;
    if (after < 0) {
      throw new Error(insufficientError || "积分不足");
    }

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ credits: after })
      .eq("id", userId)
      .eq("credits", before)
      .select("credits")
      .maybeSingle();

    if (!updateError && updated) {
      return { before, after };
    }

    await sleep(80 * attempt);
  }

  throw new Error("积分更新冲突，请重试");
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
    if (missingColumn && Object.prototype.hasOwnProperty.call(candidate, missingColumn)) {
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
  const { supabase, userId, taskId, modelType, creditCost, clientTaskId } = params;
  const { before, after } = await adjustProfileCredits({
    supabase,
    userId,
    delta: -creditCost,
    insufficientError: "积分不足",
  });

  try {
    await insertCreditTransaction(supabase, {
      userId,
      type: "consume",
      amount: -creditCost,
      balanceBefore: before,
      balanceAfter: after,
      taskId,
      description: `素材生成视频 ${modelType} 扣费 (${taskId})`,
      metadata: {
        model_type: modelType,
        client_task_id: clientTaskId,
      },
    });
  } catch (transactionError) {
    await adjustProfileCredits({
      supabase,
      userId,
      delta: creditCost,
    });
    throw transactionError;
  }

  return { before, after, deducted: creditCost };
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
  const { supabase, userId, taskId, modelType, amount, reason, metadata } = params;
  if (amount <= 0) return { refunded: false };

  if (await hasRefundTransaction(supabase, taskId)) {
    return { refunded: false };
  }

  let adjusted: { before: number; after: number };
  try {
    adjusted = await adjustProfileCredits({
      supabase,
      userId,
      delta: amount,
    });
  } catch {
    return { refunded: false };
  }

  try {
    await insertCreditTransaction(supabase, {
      userId,
      type: "refund",
      amount,
      balanceBefore: adjusted.before,
      balanceAfter: adjusted.after,
      taskId,
      description: `素材生成视频 ${modelType} 失败退款 (${taskId})`,
      metadata: {
        ...(metadata || {}),
        model_type: modelType,
        reason,
        direct_refund: true,
      },
    });
  } catch (transactionError) {
    await adjustProfileCredits({
      supabase,
      userId,
      delta: -amount,
    });
    throw transactionError;
  }

  return { refunded: true, amount };
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

  const { data: updated, error: updateError } = await updateGenerationForRefund({
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

  let adjusted: { before: number; after: number };
  try {
    adjusted = await adjustProfileCredits({
      supabase,
      userId: generation.user_id,
      delta: amount,
    });
  } catch {
    return { refunded: false };
  }

  try {
    await insertCreditTransaction(supabase, {
      userId: generation.user_id,
      type: "refund",
      amount,
      balanceBefore: adjusted.before,
      balanceAfter: adjusted.after,
      taskId,
      description: `素材生成视频 ${modelType} 失败退款 (${taskId})`,
      metadata: {
        model_type: modelType,
        reason,
        refunded_once: true,
      },
    });
  } catch (transactionError) {
    await adjustProfileCredits({
      supabase,
      userId: generation.user_id,
      delta: -amount,
    });
    await updateGenerationForRefund({
      supabase,
      taskId,
      payload: { status: "processing", error_message: null, credits_refunded: 0 },
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
