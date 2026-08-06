import { NextRequest, NextResponse } from "next/server";
import {
  applyTaskCreditDelta,
  type AppliedTaskCreditDelta,
} from "@/lib/credits/atomic-task-credit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ContractAdminClient = ReturnType<typeof createAdminClient>;
type ContractBillingStage = "create" | "renew";

function getContractPricingVersion(
  stage: ContractBillingStage,
  rentalPeriod: string
): string {
  return `contract-${stage}-${rentalPeriod}-v1`;
}

async function consumeBuyerCredits(params: {
  supabase: ContractAdminClient;
  userId: string;
  taskId: string;
  stage: ContractBillingStage;
  rentalPeriod: string;
  price: number;
  description: string;
}): Promise<AppliedTaskCreditDelta> {
  return applyTaskCreditDelta({
    supabase: params.supabase,
    userId: params.userId,
    entryKind: "consume",
    amount: -params.price,
    scope: "contract",
    taskId: params.taskId,
    operation: "buyer-consume",
    pricingVersion: getContractPricingVersion(params.stage, params.rentalPeriod),
    description: params.description,
  });
}

async function refundBuyerCredits(params: {
  supabase: ContractAdminClient;
  userId: string;
  taskId: string;
  stage: ContractBillingStage;
  rentalPeriod: string;
  price: number;
  description: string;
}) {
  return applyTaskCreditDelta({
    supabase: params.supabase,
    userId: params.userId,
    entryKind: "refund",
    amount: params.price,
    scope: "contract",
    taskId: params.taskId,
    operation: "buyer-refund",
    pricingVersion: getContractPricingVersion(params.stage, params.rentalPeriod),
    description: params.description,
  });
}

async function grantCreatorRevenue(params: {
  supabase: ContractAdminClient;
  creatorId: string;
  taskId: string;
  stage: ContractBillingStage;
  rentalPeriod: string;
  price: number;
  description: string;
}) {
  return applyTaskCreditDelta({
    supabase: params.supabase,
    userId: params.creatorId,
    entryKind: "grant",
    amount: params.price,
    scope: "contract",
    taskId: params.taskId,
    operation: "creator-grant",
    pricingVersion: getContractPricingVersion(params.stage, params.rentalPeriod),
    description: params.description,
  });
}

function getContractMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function getRenewalBillingState(metadata: unknown): Record<string, unknown> | null {
  const state = getContractMetadata(metadata).canvas_p1_contract_billing;
  return state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : null;
}

function buildRenewalStageKey(params: {
  contractId: string;
  oldEndDate: string;
  creditsPaid: number;
  rentalPeriod: string;
  targetEndDate: string;
}): string {
  return [
    params.contractId,
    "renew",
    params.oldEndDate,
    params.creditsPaid,
    params.rentalPeriod,
    params.targetEndDate,
  ].join(":");
}

async function hasContractTaskRefund(
  supabase: ContractAdminClient,
  userId: string,
  taskId: string
): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("credit_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .eq("entry_kind", "refund")
    .limit(1);

  if (error) {
    throw new Error(error.message || "续约退款状态读取失败");
  }
  return Boolean(data?.length);
}

async function claimRenewalBillingTask(params: {
  supabase: ContractAdminClient;
  contract: Record<string, any>;
  userId: string;
  rentalPeriod: string;
  price: number;
  targetEndDate: string;
}): Promise<{ contract: Record<string, any>; taskId: string; stageKey: string }> {
  const stageKey = buildRenewalStageKey({
    contractId: params.contract.id,
    oldEndDate: params.contract.end_date,
    creditsPaid: params.contract.credits_paid,
    rentalPeriod: params.rentalPeriod,
    targetEndDate: params.targetEndDate,
  });
  const metadata = getContractMetadata(params.contract.metadata);
  const existing = getRenewalBillingState(metadata);
  const existingTaskId =
    existing?.kind === "renew" &&
    existing.stage_key === stageKey &&
    existing.status === "pending" &&
    typeof existing.task_id === "string"
      ? existing.task_id
      : null;

  if (
    existingTaskId &&
    !(await hasContractTaskRefund(params.supabase, params.userId, existingTaskId))
  ) {
    return { contract: params.contract, taskId: existingTaskId, stageKey };
  }

  const taskId = `contract:${params.contract.id}:renew:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    canvas_p1_contract_billing: {
      kind: "renew",
      stage_key: stageKey,
      task_id: taskId,
      status: "pending",
      price: params.price,
      rental_period: params.rentalPeriod,
      from_end_date: params.contract.end_date,
      target_end_date: params.targetEndDate,
      claimed_at: now,
    },
  };
  const { data: claimed, error } = await params.supabase
    .from("contracts")
    .update({ metadata: nextMetadata as any, updated_at: now } as any)
    .eq("id", params.contract.id)
    .eq("user_id", params.userId)
    .eq("end_date", params.contract.end_date)
    .eq("credits_paid", params.contract.credits_paid)
    .eq("updated_at", params.contract.updated_at)
    .select("*")
    .single();

  if (error || !claimed) {
    throw new Error("续约任务已被其他请求更新，请重试");
  }

  return {
    contract: claimed as Record<string, any>,
    taskId,
    stageKey,
  };
}

async function markRenewalBillingRefunded(params: {
  supabase: ContractAdminClient;
  contractId: string;
  userId: string;
  taskId: string;
}) {
  const { data: current } = await params.supabase
    .from("contracts")
    .select("metadata, updated_at")
    .eq("id", params.contractId)
    .eq("user_id", params.userId)
    .single();
  if (!current) return;

  const metadata = getContractMetadata(current.metadata);
  const state = getRenewalBillingState(metadata);
  if (state?.task_id !== params.taskId) return;

  await params.supabase
    .from("contracts")
    .update({
      metadata: {
        ...metadata,
        canvas_p1_contract_billing: {
          ...state,
          status: "refunded",
          refunded_at: new Date().toISOString(),
        },
      } as any,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", params.contractId)
    .eq("user_id", params.userId)
    .eq("updated_at", current.updated_at);
}

async function renewContractWithAtomicCredits(params: {
  supabase: ContractAdminClient;
  contract: Record<string, any>;
  userId: string;
  modelName: string;
  rentalPeriod: string;
  price: number;
  targetEndDate: string;
  activateContract: boolean;
  isCommunityCharacter: boolean;
  creatorId: string | null | undefined;
}): Promise<{
  taskId: string;
  balanceAfter: number;
  newEndDate: string;
}> {
  const claim = await claimRenewalBillingTask({
    supabase: params.supabase,
    contract: params.contract,
    userId: params.userId,
    rentalPeriod: params.rentalPeriod,
    price: params.price,
    targetEndDate: params.targetEndDate,
  });
  const charge = await consumeBuyerCredits({
    supabase: params.supabase,
    userId: params.userId,
    taskId: claim.taskId,
    stage: "renew",
    rentalPeriod: params.rentalPeriod,
    price: params.price,
    description: `续约角色 ${params.modelName} (${params.rentalPeriod})`,
  });

  const claimedMetadata = getContractMetadata(claim.contract.metadata);
  const claimedState = getRenewalBillingState(claimedMetadata);
  if (
    claimedState?.task_id !== claim.taskId ||
    claimedState.stage_key !== claim.stageKey
  ) {
    await refundBuyerCredits({
      supabase: params.supabase,
      userId: params.userId,
      taskId: claim.taskId,
      stage: "renew",
      rentalPeriod: params.rentalPeriod,
      price: params.price,
      description: `续约角色 ${params.modelName} 任务状态异常退款`,
    });
    throw new Error("续约任务状态不一致，积分已退还");
  }

  const appliedAt = new Date().toISOString();
  const nextCreditsPaid = Number(claim.contract.credits_paid) + params.price;
  const updateValues: Record<string, unknown> = {
    end_date: params.targetEndDate,
    credits_paid: nextCreditsPaid,
    metadata: {
      ...claimedMetadata,
      canvas_p1_contract_billing: {
        ...claimedState,
        status: "applied",
        applied_at: appliedAt,
      },
    },
    updated_at: appliedAt,
  };
  if (params.activateContract) {
    updateValues.status = "active";
  }

  const { data: updated, error: updateError } = await params.supabase
    .from("contracts")
    .update(updateValues as any)
    .eq("id", claim.contract.id)
    .eq("user_id", params.userId)
    .eq("end_date", claim.contract.end_date)
    .eq("credits_paid", claim.contract.credits_paid)
    .eq("updated_at", claim.contract.updated_at)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    const { data: current } = await params.supabase
      .from("contracts")
      .select("end_date, credits_paid, metadata")
      .eq("id", claim.contract.id)
      .eq("user_id", params.userId)
      .single();
    const currentState = getRenewalBillingState(current?.metadata);
    const alreadyApplied =
      current?.end_date === params.targetEndDate &&
      Number(current?.credits_paid) === nextCreditsPaid &&
      currentState?.task_id === claim.taskId &&
      currentState.status === "applied";

    if (!alreadyApplied) {
      await refundBuyerCredits({
        supabase: params.supabase,
        userId: params.userId,
        taskId: claim.taskId,
        stage: "renew",
        rentalPeriod: params.rentalPeriod,
        price: params.price,
        description: `续约角色 ${params.modelName} 失败退款`,
      });
      await markRenewalBillingRefunded({
        supabase: params.supabase,
        contractId: claim.contract.id,
        userId: params.userId,
        taskId: claim.taskId,
      });
      throw new Error(updateError?.message || "续约写入冲突，积分已退还");
    }
  }

  if (
    params.isCommunityCharacter &&
    params.creatorId &&
    params.creatorId !== params.userId
  ) {
    try {
      await grantCreatorRevenue({
        supabase: params.supabase,
        creatorId: params.creatorId,
        taskId: claim.taskId,
        stage: "renew",
        rentalPeriod: params.rentalPeriod,
        price: params.price,
        description: `角色 ${params.modelName} 续约收益`,
      });
    } catch (error) {
      console.error("[Contracts API] Renew creator grant failed:", error);
    }
  }

  return {
    taskId: claim.taskId,
    balanceAfter: charge.balanceAfter,
    newEndDate: params.targetEndDate,
  };
}

// GET: 获取用户合约
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const adminSupabase = createAdminClient();

    // 从数据库获取用户的签约合约，关联模特信息。认证仍由用户 client 完成，
    // 数据读取用 admin client 并显式限定 user_id，避免本地 RLS 策略递归。
    let query = adminSupabase
      .from("contracts")
      .select(`
        *,
        ai_models (
          id,
          name,
          description,
          avatar_url,
          trigger_word,
          category,
          gender,
          style_tags,
          price_daily,
          price_weekly,
          price_monthly,
          price_yearly,
          is_featured,
          is_trending,
          total_rentals,
          total_generations,
          rating,
          source,
          publish_price,
          owner_id,
          is_public,
          character_type,
          reference_images,
          reference_sheet_url,
          preview_video_url,
          reference_status,
          created_at
        )
      `)
      .eq("user_id", user.id);

    // 按状态过滤
    if (status) {
      query = query.eq("status", status as never);
    } else {
      // 默认只返回 active 状态的合约
      query = query.eq("status", "active");
    }

    // ⚠️ 重要：必须检查合约是否过期！
    // 只返回未过期的合约（end_date > 当前时间）
    query = query.gt("end_date", new Date().toISOString());

    const { data: contracts, error } = await query;

    if (error) {
      console.error("[Contracts API] Database error:", error);
      return NextResponse.json(
        { success: false, error: "获取合约失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: contracts || [],
    });
  } catch (error) {
    console.error("[Contracts API] Error fetching contracts:", error);
    return NextResponse.json(
      { success: false, error: "获取签约信息失败" },
      { status: 500 }
    );
  }
}

// POST: 创建新合约（签约角色）或续约
// 支持官方角色（积分归平台）和社区角色（积分 100% 归创作者）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, rental_period, action } = body;

    if (!model_id || !rental_period) {
      return NextResponse.json(
        { success: false, error: "请选择角色和租约周期" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 获取角色信息
    const { data: model, error: modelError } = await adminSupabase
      .from("ai_models")
      .select("*")
      .eq("id", model_id)
      .single();

    if (modelError || !model) {
      return NextResponse.json(
        { success: false, error: "角色不存在" },
        { status: 404 }
      );
    }

    // 判断角色来源
    const isCommunityCharacter = model.source === "user_created";
    const creatorId = model.owner_id;

    // 阻止创作者聘用自己的角色（自建角色已永久拥有）
    if (isCommunityCharacter && creatorId === user.id) {
      return NextResponse.json(
        { success: false, error: "无法聘用自己创建的角色，你已永久拥有该角色" },
        { status: 400 }
      );
    }

    // 检查用户是否已有有效合约
    const { data: existingContract } = await adminSupabase
      .from("contracts")
      .select("*")
      .eq("user_id", user.id)
      .eq("model_id", model_id)
      .eq("status", "active")
      .maybeSingle();

    // 如果是续约操作，允许在合约即将过期时续约
    if (action !== "renew" && existingContract) {
      const endDate = new Date(existingContract.end_date);
      if (endDate > new Date()) {
        return NextResponse.json(
          { success: false, error: "已有有效合约，请在合约即将过期时续约" },
          { status: 400 }
        );
      }
    }

    // 计算价格：社区角色用 publish_price，官方角色用周期定价
    let price: number;
    if (isCommunityCharacter) {
      // 社区角色：统一使用 publish_price，不区分周期
      price = model.publish_price || 100;
    } else {
      // 官方角色：按周期定价
      const prices: Record<string, number> = {
        daily: model.price_daily || 10,
        weekly: model.price_weekly || 50,
        monthly: model.price_monthly || 150,
        yearly: model.price_yearly || 1200,
      };
      price = prices[rental_period];
    }

    if (!price) {
      return NextResponse.json(
        { success: false, error: "无效的租约周期" },
        { status: 400 }
      );
    }

    // 获取用户积分
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "获取用户信息失败" },
        { status: 500 }
      );
    }

    if (profile.credits < price) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${price} 积分，当前余额 ${profile.credits}`,
          required: price,
          available: profile.credits,
        },
        { status: 400 }
      );
    }

    // 计算结束日期
    const startDate = new Date();
    const endDate = new Date();

    // 如果是续约，从当前合约结束日期开始计算
    if (action === "renew" && existingContract) {
      const currentEndDate = new Date(existingContract.end_date);
      if (currentEndDate > startDate) {
        endDate.setTime(currentEndDate.getTime());
      }
    }

    switch (rental_period) {
      case "daily":
        endDate.setDate(endDate.getDate() + 1);
        break;
      case "weekly":
        endDate.setDate(endDate.getDate() + 7);
        break;
      case "monthly":
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case "yearly":
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }

    // 如果是续约，更新现有合约
    if (action === "renew" && existingContract) {
      const renewal = await renewContractWithAtomicCredits({
        supabase: adminSupabase,
        contract: existingContract as Record<string, any>,
        userId: user.id,
        modelName: model.name,
        rentalPeriod: rental_period,
        price,
        targetEndDate: endDate.toISOString(),
        activateContract: false,
        isCommunityCharacter,
        creatorId,
      });

      return NextResponse.json({
        success: true,
        message: "续约成功",
        contract_id: existingContract.id,
        new_end_date: renewal.newEndDate,
        new_balance: renewal.balanceAfter,
      });
    }

    // 【重要】在创建新合约前，先将该模特的所有过期合约标记为 expired
    // 这是为了避免唯一约束 (user_id, model_id, status) 冲突
    // 注意：更新所有用户的过期合约，不仅仅是当前用户的
    const { error: expireError, count: expiredCount } = await adminSupabase
      .from("contracts")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("model_id", model_id)
      .eq("status", "active")
      .lt("end_date", new Date().toISOString());

    if (expireError) {
      console.warn("[Contracts API] Failed to expire old contracts:", expireError);
    } else if (expiredCount && expiredCount > 0) {
      console.log("[Contracts API] Expired old contracts:", expiredCount);
    }

    const newContractId = crypto.randomUUID();
    const contractTaskId = `contract:${newContractId}:create`;
    const charge = await consumeBuyerCredits({
      supabase: adminSupabase,
      userId: user.id,
      taskId: contractTaskId,
      stage: "create",
      rentalPeriod: rental_period,
      price,
      description: `签约角色 ${model.name} (${rental_period})`,
    });

    // 创建新合约
    const { data: newContract, error: createError } = await adminSupabase
      .from("contracts")
      .insert({
        id: newContractId,
        user_id: user.id,
        model_id: model_id,
        rental_period,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: "active",
        credits_paid: price,
        generations_count: 0,
        auto_renew: false,
        created_at: startDate.toISOString(),
      })
      .select()
      .single();

    if (createError) {
      await refundBuyerCredits({
        supabase: adminSupabase,
        userId: user.id,
        taskId: contractTaskId,
        stage: "create",
        rentalPeriod: rental_period,
        price,
        description: `签约角色 ${model.name} 失败退款`,
      });
      console.error("[Contracts API] Create error:", createError);
      return NextResponse.json(
        { success: false, error: "创建合约失败" },
        { status: 500 }
      );
    }

    // 社区角色积分分成：合约创建成功后，100% 归创作者。
    if (isCommunityCharacter && creatorId && creatorId !== user.id) {
      try {
        await grantCreatorRevenue({
          supabase: adminSupabase,
          creatorId,
          taskId: contractTaskId,
          stage: "create",
          rentalPeriod: rental_period,
          price,
          description: `角色 ${model.name} 被签约收益`,
        });
      } catch (error) {
        console.error("[Contracts API] Creator grant failed:", error);
      }
    }

    // 更新模特的总签约数
    await adminSupabase
      .from("ai_models")
      .update({ total_rentals: (model.total_rentals || 0) + 1 })
      .eq("id", model_id);

    // 触发积分刷新
    return NextResponse.json({
      success: true,
      message: "签约成功",
      contract: newContract,
      new_balance: charge.balanceAfter,
    });
  } catch (error) {
    console.error("[Contracts API] Error creating contract:", error);
    return NextResponse.json(
      { success: false, error: "签约失败" },
      { status: 500 }
    );
  }
}

// PUT: 续约合约
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { contract_id, rental_period } = body;

    if (!contract_id || !rental_period) {
      return NextResponse.json(
        { success: false, error: "请选择合约和续约周期" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 获取合约信息
    const { data: contract, error: contractError } = await adminSupabase
      .from("contracts")
      .select(`
        *,
        ai_models (*)
      `)
      .eq("id", contract_id)
      .eq("user_id", user.id)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { success: false, error: "合约不存在" },
        { status: 404 }
      );
    }

    const model = contract.ai_models;
    if (!model) {
      return NextResponse.json(
        { success: false, error: "模特信息不存在" },
        { status: 404 }
      );
    }

    const isCommunityCharacter = model.source === "user_created";
    const creatorId = model.owner_id;

    // 计算价格：社区角色续约仍使用发布价，官方角色按周期价。
    const prices: Record<string, number> = {
      daily: model.price_daily || 10,
      weekly: model.price_weekly || 50,
      monthly: model.price_monthly || 150,
      yearly: model.price_yearly || 1200,
    };
    const price = isCommunityCharacter ? (model.publish_price || 100) : prices[rental_period];

    if (!price) {
      return NextResponse.json(
        { success: false, error: "无效的续约周期" },
        { status: 400 }
      );
    }

    // 获取用户积分
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "获取用户信息失败" },
        { status: 500 }
      );
    }

    if (profile.credits < price) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${price} 积分，当前余额 ${profile.credits}`,
        },
        { status: 400 }
      );
    }

    // 计算新的结束日期（从当前结束日期开始累加）
    const currentEndDate = new Date(contract.end_date);
    const newEndDate = new Date(Math.max(currentEndDate.getTime(), Date.now()));

    switch (rental_period) {
      case "daily":
        newEndDate.setDate(newEndDate.getDate() + 1);
        break;
      case "weekly":
        newEndDate.setDate(newEndDate.getDate() + 7);
        break;
      case "monthly":
        newEndDate.setMonth(newEndDate.getMonth() + 1);
        break;
      case "yearly":
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
        break;
    }

    const renewal = await renewContractWithAtomicCredits({
      supabase: adminSupabase,
      contract: contract as Record<string, any>,
      userId: user.id,
      modelName: model.name,
      rentalPeriod: rental_period,
      price,
      targetEndDate: newEndDate.toISOString(),
      activateContract: true,
      isCommunityCharacter,
      creatorId,
    });

    return NextResponse.json({
      success: true,
      message: "续约成功",
      new_end_date: renewal.newEndDate,
      new_balance: renewal.balanceAfter,
    });
  } catch (error) {
    console.error("[Contracts API] Error renewing contract:", error);
    return NextResponse.json(
      { success: false, error: "续约失败" },
      { status: 500 }
    );
  }
}
