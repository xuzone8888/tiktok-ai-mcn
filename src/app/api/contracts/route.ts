import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

function buildContractTransactionMetadata(params: {
  contractId: string;
  modelId: string;
  modelName?: string | null;
  rentalPeriod: string;
  isCommunityCharacter: boolean;
}): Json {
  return {
    contract_id: params.contractId,
    model_id: params.modelId,
    model_name: params.modelName || null,
    rental_period: params.rentalPeriod,
    source: params.isCommunityCharacter ? "community_character" : "official_character",
  };
}

async function refundBuyerCredits(params: {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
  credits: number;
}) {
  await params.supabase
    .from("profiles")
    .update({ credits: params.credits })
    .eq("id", params.userId);
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
          reference_sheet_url,
          reference_status,
          forge_type,
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

    console.log("[Contracts API] Loaded contracts from database:", contracts?.length || 0);

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

    // 【独占签约检查】仅官方角色需要独占检查，社区角色允许多人聘用
    if (!isCommunityCharacter && (!existingContract || new Date(existingContract.end_date) <= new Date())) {
      const { data: otherContracts } = await adminSupabase
        .from("contracts")
        .select("id, user_id, end_date")
        .eq("model_id", model_id)
        .eq("status", "active")
        .neq("user_id", user.id)
        .gt("end_date", new Date().toISOString())
        .limit(1);

      if (otherContracts && otherContracts.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "该角色已被其他用户签约，暂时无法聘用。请等待当前签约到期后再试。"
          },
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

    const buyerBalanceAfter = profile.credits - price;

    // 扣除聊用者积分
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: buyerBalanceAfter })
      .eq("id", user.id);

    if (deductError) {
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
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
      const { error: updateError } = await adminSupabase
        .from("contracts")
        .update({
          end_date: endDate.toISOString(),
          credits_paid: existingContract.credits_paid + price,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingContract.id);

      if (updateError) {
        // 退还积分
        await adminSupabase
          .from("profiles")
          .update({ credits: profile.credits })
          .eq("id", user.id);

        return NextResponse.json(
          { success: false, error: "续约失败" },
          { status: 500 }
        );
      }

      console.log("[Contracts API] Contract renewed:", existingContract.id);

      const transactionMetadata = buildContractTransactionMetadata({
        contractId: existingContract.id,
        modelId: model_id,
        modelName: model.name,
        rentalPeriod: rental_period,
        isCommunityCharacter,
      });

      const { error: buyerTxError } = await adminSupabase
        .from("credit_transactions")
        .insert({
          user_id: user.id,
          type: "consume",
          amount: -price,
          balance_before: profile.credits,
          balance_after: buyerBalanceAfter,
          reference_type: "contract",
          reference_id: existingContract.id,
          description: `续约角色 ${model.name} (${rental_period})`,
          metadata: transactionMetadata,
        });

      if (buyerTxError) {
        console.error("[Contracts API] Failed to log POST renew buyer transaction:", buyerTxError);
        await adminSupabase
          .from("contracts")
          .update({
            end_date: existingContract.end_date,
            credits_paid: existingContract.credits_paid,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingContract.id);
        await refundBuyerCredits({
          supabase: adminSupabase,
          userId: user.id,
          credits: profile.credits,
        });
        return NextResponse.json(
          { success: false, error: "积分流水写入失败，已回滚续约" },
          { status: 500 }
        );
      }

      if (isCommunityCharacter && creatorId && creatorId !== user.id) {
        const { data: creatorProfile } = await adminSupabase
          .from("profiles")
          .select("credits")
          .eq("id", creatorId)
          .single();

        if (creatorProfile) {
          const creatorBalanceAfter = creatorProfile.credits + price;
          const { error: revenueError } = await adminSupabase
            .from("profiles")
            .update({ credits: creatorBalanceAfter })
            .eq("id", creatorId);

          if (revenueError) {
            console.error("[Contracts API] POST renew revenue transfer failed:", revenueError);
          } else {
            const { error: creatorTxError } = await adminSupabase
              .from("credit_transactions")
              .insert({
                user_id: creatorId,
                type: "bonus",
                amount: price,
                balance_before: creatorProfile.credits,
                balance_after: creatorBalanceAfter,
                reference_type: "contract",
                reference_id: existingContract.id,
                description: `角色 ${model.name} 续约收益`,
                metadata: transactionMetadata,
              });

            if (creatorTxError) {
              console.error("[Contracts API] Failed to log POST renew creator transaction:", creatorTxError);
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        message: "续约成功",
        contract_id: existingContract.id,
        new_end_date: endDate.toISOString(),
        new_balance: buyerBalanceAfter,
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
      console.log("[Contracts API] Expired", expiredCount, "old contracts for model:", model_id);
    }

    // 创建新合约
    const { data: newContract, error: createError } = await adminSupabase
      .from("contracts")
      .insert({
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
      // 退还积分
      await adminSupabase
        .from("profiles")
        .update({ credits: profile.credits })
        .eq("id", user.id);

      console.error("[Contracts API] Create error:", createError);
      return NextResponse.json(
        { success: false, error: "创建合约失败" },
        { status: 500 }
      );
    }

    const transactionMetadata = buildContractTransactionMetadata({
      contractId: newContract.id,
      modelId: model_id,
      modelName: model.name,
      rentalPeriod: rental_period,
      isCommunityCharacter,
    });

    const { error: buyerTxError } = await adminSupabase
      .from("credit_transactions")
      .insert({
        user_id: user.id,
        type: "consume",
        amount: -price,
        balance_before: profile.credits,
        balance_after: buyerBalanceAfter,
        reference_type: "contract",
        reference_id: newContract.id,
        description: `签约角色 ${model.name} (${rental_period})`,
        metadata: transactionMetadata,
      });

    if (buyerTxError) {
      console.error("[Contracts API] Failed to log buyer transaction:", buyerTxError);
      await adminSupabase
        .from("contracts")
        .delete()
        .eq("id", newContract.id);
      await refundBuyerCredits({
        supabase: adminSupabase,
        userId: user.id,
        credits: profile.credits,
      });
      return NextResponse.json(
        { success: false, error: "积分流水写入失败，已回滚签约" },
        { status: 500 }
      );
    }

    // 社区角色积分分成：合约创建成功后，100% 归创作者。
    if (isCommunityCharacter && creatorId && creatorId !== user.id) {
      const { data: creatorProfile } = await adminSupabase
        .from("profiles")
        .select("credits")
        .eq("id", creatorId)
        .single();

      if (creatorProfile) {
        const creatorBalanceAfter = creatorProfile.credits + price;
        const { error: revenueError } = await adminSupabase
          .from("profiles")
          .update({ credits: creatorBalanceAfter })
          .eq("id", creatorId);

        if (revenueError) {
          console.error("[Contracts API] Revenue transfer failed:", revenueError);
        } else {
          const { error: creatorTxError } = await adminSupabase
            .from("credit_transactions")
            .insert({
              user_id: creatorId,
              type: "bonus",
              amount: price,
              balance_before: creatorProfile.credits,
              balance_after: creatorBalanceAfter,
              reference_type: "contract",
              reference_id: newContract.id,
              description: `角色 ${model.name} 被签约收益`,
              metadata: transactionMetadata,
            });

          if (creatorTxError) {
            console.error("[Contracts API] Failed to log creator transaction:", creatorTxError);
          }
        }
      }
    }

    // 更新模特的总签约数
    await adminSupabase
      .from("ai_models")
      .update({ total_rentals: (model.total_rentals || 0) + 1 })
      .eq("id", model_id);

    console.log("[Contracts API] Contract created:", newContract.id);

    // 触发积分刷新
    return NextResponse.json({
      success: true,
      message: "签约成功",
      contract: newContract,
      new_balance: buyerBalanceAfter,
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

    const buyerBalanceAfter = profile.credits - price;

    // 扣除积分
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: buyerBalanceAfter })
      .eq("id", user.id);

    if (deductError) {
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
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

    // 更新合约
    const { error: updateError } = await adminSupabase
      .from("contracts")
      .update({
        end_date: newEndDate.toISOString(),
        status: "active",
        credits_paid: contract.credits_paid + price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contract_id);

    if (updateError) {
      // 退还积分
      await adminSupabase
        .from("profiles")
        .update({ credits: profile.credits })
        .eq("id", user.id);

      return NextResponse.json(
        { success: false, error: "续约失败" },
        { status: 500 }
      );
    }

    console.log("[Contracts API] Contract renewed:", contract_id);

    const transactionMetadata = buildContractTransactionMetadata({
      contractId: contract_id,
      modelId: model.id,
      modelName: model.name,
      rentalPeriod: rental_period,
      isCommunityCharacter,
    });

    const { error: buyerTxError } = await adminSupabase
      .from("credit_transactions")
      .insert({
        user_id: user.id,
        type: "consume",
        amount: -price,
        balance_before: profile.credits,
        balance_after: buyerBalanceAfter,
        reference_type: "contract",
        reference_id: contract_id,
        description: `续约角色 ${model.name} (${rental_period})`,
        metadata: transactionMetadata,
      });

    if (buyerTxError) {
      console.error("[Contracts API] Failed to log renew buyer transaction:", buyerTxError);
      await adminSupabase
        .from("contracts")
        .update({
          end_date: contract.end_date,
          status: contract.status,
          credits_paid: contract.credits_paid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contract_id);
      await refundBuyerCredits({
        supabase: adminSupabase,
        userId: user.id,
        credits: profile.credits,
      });
      return NextResponse.json(
        { success: false, error: "积分流水写入失败，已回滚续约" },
        { status: 500 }
      );
    }

    if (isCommunityCharacter && creatorId && creatorId !== user.id) {
      const { data: creatorProfile } = await adminSupabase
        .from("profiles")
        .select("credits")
        .eq("id", creatorId)
        .single();

      if (creatorProfile) {
        const creatorBalanceAfter = creatorProfile.credits + price;
        const { error: revenueError } = await adminSupabase
          .from("profiles")
          .update({ credits: creatorBalanceAfter })
          .eq("id", creatorId);

        if (revenueError) {
          console.error("[Contracts API] Renew revenue transfer failed:", revenueError);
        } else {
          const { error: creatorTxError } = await adminSupabase
            .from("credit_transactions")
            .insert({
              user_id: creatorId,
              type: "bonus",
              amount: price,
              balance_before: creatorProfile.credits,
              balance_after: creatorBalanceAfter,
              reference_type: "contract",
              reference_id: contract_id,
              description: `角色 ${model.name} 续约收益`,
              metadata: transactionMetadata,
            });

          if (creatorTxError) {
            console.error("[Contracts API] Failed to log renew creator transaction:", creatorTxError);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "续约成功",
      new_end_date: newEndDate.toISOString(),
      new_balance: buyerBalanceAfter,
    });
  } catch (error) {
    console.error("[Contracts API] Error renewing contract:", error);
    return NextResponse.json(
      { success: false, error: "续约失败" },
      { status: 500 }
    );
  }
}
