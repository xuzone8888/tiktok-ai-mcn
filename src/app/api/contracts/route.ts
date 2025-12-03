import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Contract, AIModel } from "@/types/model";

interface ContractWithModel extends Contract {
  ai_models: AIModel | null;
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

    // 从数据库获取用户的签约合约，关联模特信息
    let query = supabase
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
          rating
        )
      `)
      .eq("user_id", user.id);

    // 按状态过滤
    if (status) {
      query = query.eq("status", status);
    } else {
      // 默认只返回 active 状态的合约
      query = query.eq("status", "active");
    }

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

// POST: 创建新合约（签约模特）或续约
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, rental_period, action } = body;

    if (!model_id || !rental_period) {
      return NextResponse.json(
        { success: false, error: "请选择模特和租约周期" },
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

    // 获取模特信息
    const { data: model, error: modelError } = await adminSupabase
      .from("ai_models")
      .select("*")
      .eq("id", model_id)
      .single();

    if (modelError || !model) {
      return NextResponse.json(
        { success: false, error: "模特不存在" },
        { status: 404 }
      );
    }

    // 检查是否已有有效合约
    const { data: existingContract } = await adminSupabase
      .from("contracts")
      .select("*")
      .eq("user_id", user.id)
      .eq("ai_model_id", model_id)
      .eq("status", "active")
      .single();

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

    // 计算价格
    const prices: Record<string, number> = {
      daily: model.price_daily || 10,
      weekly: model.price_weekly || 50,
      monthly: model.price_monthly || 150,
      yearly: model.price_yearly || 1200,
    };
    const price = prices[rental_period];

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

    // 扣除积分
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: profile.credits - price })
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

      return NextResponse.json({
        success: true,
        message: "续约成功",
        contract_id: existingContract.id,
        new_end_date: endDate.toISOString(),
        new_balance: profile.credits - price,
      });
    }

    // 创建新合约
    const { data: newContract, error: createError } = await adminSupabase
      .from("contracts")
      .insert({
        user_id: user.id,
        ai_model_id: model_id,
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
      new_balance: profile.credits - price,
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

    // 计算价格
    const prices: Record<string, number> = {
      daily: model.price_daily || 10,
      weekly: model.price_weekly || 50,
      monthly: model.price_monthly || 150,
      yearly: model.price_yearly || 1200,
    };
    const price = prices[rental_period];

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

    // 扣除积分
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: profile.credits - price })
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

    return NextResponse.json({
      success: true,
      message: "续约成功",
      new_end_date: newEndDate.toISOString(),
      new_balance: profile.credits - price,
    });
  } catch (error) {
    console.error("[Contracts API] Error renewing contract:", error);
    return NextResponse.json(
      { success: false, error: "续约失败" },
      { status: 500 }
    );
  }
}
