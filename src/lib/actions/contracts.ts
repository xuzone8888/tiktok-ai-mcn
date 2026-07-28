/**
 * 合约管理 Server Actions
 * 
 * 处理模特签约、续费、取消等业务逻辑
 * 
 * ⚠️ 安全注意：
 * - 所有交易必须是原子操作
 * - 必须验证用户身份和余额
 * - 记录完整的交易流水
 */

"use server";

import {
  applyTaskCreditDelta,
  type AppliedTaskCreditDelta,
} from "@/lib/credits/atomic-task-credit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================================
// Types
// ============================================================================

export interface HireModelInput {
  modelId: string;
  userId: string;
  rentalPeriod?: "daily" | "weekly" | "monthly" | "yearly";
}

export interface HireModelResult {
  success: boolean;
  data?: {
    contractId: string;
    creditsUsed: number;
    newBalance: number;
    endDate: string;
  };
  error?: string;
  errorCode?: "INSUFFICIENT_BALANCE" | "ALREADY_HIRED" | "MODEL_NOT_FOUND" | "USER_NOT_FOUND" | "TRANSACTION_FAILED";
}

export interface ContractInfo {
  id: string;
  model_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  credits_paid: number;
}

// ============================================================================
// Price Multipliers
// ============================================================================

const RENTAL_MULTIPLIERS: Record<string, { multiplier: number; days: number }> = {
  daily: { multiplier: 1 / 30, days: 1 },
  weekly: { multiplier: 0.25, days: 7 },
  monthly: { multiplier: 1, days: 30 },
  yearly: { multiplier: 10, days: 365 },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 计算合约结束日期
 */
function calculateEndDate(days: number): string {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  return endDate.toISOString();
}

/**
 * 计算租赁价格
 */
function calculatePrice(basePrice: number, period: string): number {
  const config = RENTAL_MULTIPLIERS[period] || RENTAL_MULTIPLIERS.monthly;
  return Math.round(basePrice * config.multiplier);
}

// ============================================================================
// Main Server Action: hireModel
// ============================================================================

/**
 * 聘用 AI 模特
 * 
 * 业务流程：
 * 1. 验证模特存在且可用
 * 2. 检查用户是否已签约该模特
 * 3. 验证用户余额
 * 4. 执行原子交易：扣费 + 记录流水 + 创建合约
 * 5. 刷新相关页面缓存
 * 
 * @param input - 包含 modelId, userId, rentalPeriod
 * @returns HireModelResult
 */
export async function hireModel(input: HireModelInput): Promise<HireModelResult> {
  const {
    modelId,
    userId: requestedUserId,
    rentalPeriod = "monthly",
  } = input;

  console.log(`[Contracts] Starting hire process: model=${modelId}, user=${requestedUserId}, period=${rentalPeriod}`);

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== requestedUserId) {
      return {
        success: false,
        error: "登录身份与签约用户不一致",
        errorCode: "USER_NOT_FOUND",
      };
    }
    const userId = user.id;
    const adminSupabase = createAdminClient();

    // ========================================================================
    // Step 1: 获取模特信息
    // ========================================================================
    const { data: model, error: modelError } = await adminSupabase
      .from("ai_models")
      .select("id, name, price_monthly, is_active, total_rentals, source, owner_id")
      .eq("id", modelId)
      .single();

    if (modelError || !model) {
      console.error("[Contracts] Model not found:", modelError);
      return {
        success: false,
        error: "模特不存在或已下架",
        errorCode: "MODEL_NOT_FOUND",
      };
    }

    if (!model.is_active) {
      return {
        success: false,
        error: "该模特当前不可签约",
        errorCode: "MODEL_NOT_FOUND",
      };
    }

    // ========================================================================
    // Step 2: 检查是否已签约 (防重)
    // ========================================================================
    const { data: existingContract, error: contractCheckError } = await adminSupabase
      .from("contracts")
      .select("id, end_date")
      .eq("user_id", userId)
      .eq("model_id", modelId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .maybeSingle();

    if (contractCheckError) {
      console.error("[Contracts] Contract check error:", contractCheckError);
    }

    if (existingContract) {
      const endDate = new Date(existingContract.end_date).toLocaleDateString("zh-CN");
      return {
        success: false,
        error: `该模特已在您的团队中，合约将于 ${endDate} 到期。如需续费请前往"我的团队"。`,
        errorCode: "ALREADY_HIRED",
      };
    }

    // ========================================================================
    // Step 3: 获取用户余额
    // ========================================================================
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id, credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[Contracts] User not found:", profileError);
      return {
        success: false,
        error: "用户信息获取失败",
        errorCode: "USER_NOT_FOUND",
      };
    }

    // ========================================================================
    // Step 4: 计算价格并验证余额
    // ========================================================================
    const rentalConfig = RENTAL_MULTIPLIERS[rentalPeriod] || RENTAL_MULTIPLIERS.monthly;
    const price = calculatePrice(model.price_monthly, rentalPeriod);
    const endDate = calculateEndDate(rentalConfig.days);

    console.log(`[Contracts] Price calculation: base=${model.price_monthly}, period=${rentalPeriod}, final=${price}`);

    if (profile.credits < price) {
      return {
        success: false,
        error: `余额不足，当前余额 ${profile.credits} Credits，需要 ${price} Credits`,
        errorCode: "INSUFFICIENT_BALANCE",
      };
    }

    // ========================================================================
    // Step 5: 执行任务级原子积分交易
    // ========================================================================
    const contractId = crypto.randomUUID();
    const taskId = `contract:${contractId}:create`;
    let charge: AppliedTaskCreditDelta;
    try {
      charge = await applyTaskCreditDelta({
        supabase: adminSupabase,
        userId,
        entryKind: "consume",
        amount: -price,
        scope: "contract",
        taskId,
        operation: "buyer-consume",
        pricingVersion: `contract-create-${rentalPeriod}-v1`,
        description: `聘用模特 ${model.name} (${rentalPeriod})`,
      });
    } catch (error) {
      console.error("[Contracts] Failed to deduct credits atomically:", error);
      return {
        success: false,
        error: "扣费失败，请重试",
        errorCode: "TRANSACTION_FAILED",
      };
    }

    // 5.2 创建合约记录
    const { data: contract, error: contractError } = await adminSupabase
      .from("contracts")
      .insert({
        id: contractId,
        user_id: userId,
        model_id: modelId,
        rental_period: rentalPeriod,
        start_date: new Date().toISOString(),
        end_date: endDate,
        status: "active",
        credits_paid: price,
        generations_count: 0,
        auto_renew: false,
      })
      .select("id")
      .single();

    if (contractError || !contract) {
      console.error("[Contracts] Failed to create contract:", contractError);

      let refundSucceeded = true;
      try {
        await applyTaskCreditDelta({
          supabase: adminSupabase,
          userId,
          entryKind: "refund",
          amount: price,
          scope: "contract",
          taskId,
          operation: "buyer-refund",
          pricingVersion: `contract-create-${rentalPeriod}-v1`,
          description: `聘用模特 ${model.name} 失败退款`,
        });
      } catch (refundError) {
        refundSucceeded = false;
        console.error("[Contracts] Failed to refund credits atomically:", refundError);
      }

      return {
        success: false,
        error: refundSucceeded
          ? "创建合约失败，积分已退还"
          : "创建合约失败，自动退款未完成，请联系支持",
        errorCode: "TRANSACTION_FAILED",
      };
    }

    // 5.3 社区角色积分分成：合约创建成功后，100% 归创作者。
    if (
      model.source === "user_created" &&
      model.owner_id &&
      model.owner_id !== userId
    ) {
      try {
        await applyTaskCreditDelta({
          supabase: adminSupabase,
          userId: model.owner_id,
          entryKind: "grant",
          amount: price,
          scope: "contract",
          taskId,
          operation: "creator-grant",
          pricingVersion: `contract-create-${rentalPeriod}-v1`,
          description: `角色 ${model.name} 被签约收益`,
        });
      } catch (grantError) {
        console.error("[Contracts] Failed to grant creator revenue:", grantError);
      }
    }

    // 5.4 更新模特统计
    await adminSupabase
      .from("ai_models")
      .update({ 
        total_rentals: model.total_rentals ? model.total_rentals + 1 : 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", modelId);

    // ========================================================================
    // Step 6: 刷新缓存
    // ========================================================================
    revalidatePath("/team");
    revalidatePath("/models");
    revalidatePath("/quick-gen");

    console.log(`[Contracts] Hire successful: contract=${contract.id}, credits_used=${price}, new_balance=${charge.balanceAfter}`);

    return {
      success: true,
      data: {
        contractId: contract.id,
        creditsUsed: price,
        newBalance: charge.balanceAfter,
        endDate: endDate,
      },
    };

  } catch (error) {
    console.error("[Contracts] Unexpected error:", error);
    return {
      success: false,
      error: "系统错误，请稍后重试",
      errorCode: "TRANSACTION_FAILED",
    };
  }
}

// ============================================================================
// Additional Actions
// ============================================================================

/**
 * 获取用户的活跃合约列表
 */
export async function getUserActiveContracts(userId: string): Promise<{
  success: boolean;
  data?: ContractInfo[];
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const { data: contracts, error } = await supabase
      .from("contracts")
      .select("id, model_id, user_id, start_date, end_date, status, credits_paid")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .order("end_date", { ascending: true });

    if (error) {
      console.error("[Contracts] Failed to fetch contracts:", error);
      return {
        success: false,
        error: "获取合约列表失败",
      };
    }

    return {
      success: true,
      data: contracts || [],
    };
  } catch (error) {
    console.error("[Contracts] Unexpected error:", error);
    return {
      success: false,
      error: "系统错误",
    };
  }
}

/**
 * 检查用户是否已签约指定模特
 */
export async function checkModelHired(
  userId: string, 
  modelId: string
): Promise<{ hired: boolean; endDate?: string }> {
  try {
    const supabase = await createClient();

    const { data: contract } = await supabase
      .from("contracts")
      .select("end_date")
      .eq("user_id", userId)
      .eq("model_id", modelId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .maybeSingle();

    return {
      hired: !!contract,
      endDate: contract?.end_date,
    };
  } catch (error) {
    console.error("[Contracts] Check hired error:", error);
    return { hired: false };
  }
}

/**
 * 获取用户积分余额
 */
export async function getUserCredits(userId: string): Promise<{
  success: boolean;
  credits?: number;
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      return {
        success: false,
        error: "获取余额失败",
      };
    }

    return {
      success: true,
      credits: profile.credits,
    };
  } catch (error) {
    console.error("[Contracts] Get credits error:", error);
    return {
      success: false,
      error: "系统错误",
    };
  }
}

