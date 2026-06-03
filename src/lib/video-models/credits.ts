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

async function insertCreditTransaction(
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
  const check = await checkVideoCredits(supabase, userId, creditCost);
  if (!check.ok || check.currentCredits === undefined) {
    throw new Error(check.error || "积分不足");
  }

  const before = check.currentCredits;
  const after = before - creditCost;
  const { error } = await supabase
    .from("profiles")
    .update({ credits: after })
    .eq("id", userId);

  if (error) throw new Error("扣除积分失败");

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
    await supabase
      .from("profiles")
      .update({ credits: before })
      .eq("id", userId);
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    return { refunded: false };
  }

  const before = profile.credits;
  const after = before + amount;
  const { error: creditError } = await supabase
    .from("profiles")
    .update({ credits: after })
    .eq("id", userId);

  if (creditError) {
    return { refunded: false };
  }

  try {
    await insertCreditTransaction(supabase, {
      userId,
      type: "refund",
      amount,
      balanceBefore: before,
      balanceAfter: after,
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
    await supabase
      .from("profiles")
      .update({ credits: before })
      .eq("id", userId);
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

  const { data: updated, error: updateError } = await supabase
    .from("generations")
    .update({
      status: "failed",
      error_message: reason,
      credits_refunded: 0,
    } as any)
    .eq("task_id", taskId)
    .in("status", ["processing"])
    .select("user_id, credit_cost, metadata")
    .maybeSingle();

  if (updateError || !updated) {
    return { refunded: false };
  }

  const generation = updated as GenerationForRefund;
  const amount = generation.credit_cost || 0;
  if (amount <= 0 || !generation.user_id) {
    return { refunded: false };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", generation.user_id)
    .single();

  if (profileError || !profile) {
    return { refunded: false };
  }

  const before = profile.credits;
  const after = before + amount;
  const { error: creditError } = await supabase
    .from("profiles")
    .update({ credits: after })
    .eq("id", generation.user_id);

  if (creditError) {
    await supabase
      .from("generations")
      .update({ status: "processing", error_message: null } as any)
      .eq("task_id", taskId)
      .eq("status", "failed")
      .eq("credits_refunded", 0);
    return { refunded: false };
  }

  try {
    await insertCreditTransaction(supabase, {
      userId: generation.user_id,
      type: "refund",
      amount,
      balanceBefore: before,
      balanceAfter: after,
      taskId,
      description: `素材生成视频 ${modelType} 失败退款 (${taskId})`,
      metadata: {
        model_type: modelType,
        reason,
        refunded_once: true,
      },
    });
  } catch (transactionError) {
    await supabase
      .from("profiles")
      .update({ credits: before })
      .eq("id", generation.user_id);
    await supabase
      .from("generations")
      .update({ status: "processing", error_message: null } as any)
      .eq("task_id", taskId)
      .eq("status", "failed")
      .eq("credits_refunded", 0);
    throw transactionError;
  }

  await supabase
    .from("generations")
    .update({ credits_refunded: amount } as any)
    .eq("task_id", taskId);

  return { refunded: true, amount };
}
