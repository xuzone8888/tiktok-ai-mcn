/**
 * 生成任务 API
 * 
 * POST /api/generations - 创建生成任务
 * GET /api/generations - 获取生成任务列表/状态
 */

import { NextRequest, NextResponse } from "next/server";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST: 创建生成任务
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { model_id, product_id, type, script, template } = body;

    if (!model_id || !type) {
      return NextResponse.json(
        { error: "model_id and type are required" },
        { status: 400 }
      );
    }

    // 检查是否有有效合约
    const { data: contract } = await supabase
      .from("contracts")
      .select("*")
      .eq("user_id", user.id)
      .eq("model_id", model_id)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .single();

    if (!contract) {
      return NextResponse.json(
        { error: "没有该模特的有效签约" },
        { status: 400 }
      );
    }

    // 获取用户积分
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "用户不存在" },
        { status: 404 }
      );
    }

    // 计算消耗积分
    const creditsRequired = type === "video" ? 50 : 10;

    if (profile.credits < creditsRequired) {
      return NextResponse.json(
        { error: "积分不足", required: creditsRequired, available: profile.credits },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminClient();
    const generationId = crypto.randomUUID();
    let chargeResult;
    try {
      chargeResult = await applyTaskCreditDelta({
        supabase: adminSupabase,
        userId: user.id,
        entryKind: "consume",
        amount: -creditsRequired,
        scope: "legacy-generation",
        taskId: generationId,
        operation: "consume",
        pricingVersion: `legacy-generation-${type}-v1`,
        description: `旧版 generation ${type} 扣费`,
      });
    } catch (error) {
      console.error("[Generations API] Failed to deduct credits:", error);
      return NextResponse.json(
        { error: "扣除积分失败" },
        { status: 500 }
      );
    }

    // 创建生成任务记录
    const { data: generation, error: insertError } = await adminSupabase
      .from("generations")
      .insert({
        id: generationId,
        user_id: user.id,
        model_id,
        product_id: product_id || null,
        type,
        status: "processing",
        progress: 0,
        input_params: { script, template },
        credits_used: creditsRequired,
      })
      .select()
      .single();

    if (insertError) {
      await applyTaskCreditDelta({
        supabase: adminSupabase,
        userId: user.id,
        entryKind: "refund",
        amount: creditsRequired,
        scope: "legacy-generation",
        taskId: generationId,
        operation: "refund",
        pricingVersion: `legacy-generation-${type}-v1`,
        description: `旧版 generation ${type} 创建失败退款`,
      });

      console.error("[Generations API] Failed to create generation:", insertError);
      return NextResponse.json(
        { error: "创建任务失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      generation,
      new_balance: chargeResult.balanceAfter,
    });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: "Failed to create generation" },
      { status: 500 }
    );
  }
}

// GET: 获取生成任务状态
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      // 获取单个任务
      const { data: generation, error } = await supabase
        .from("generations")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (error || !generation) {
        return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      }

      return NextResponse.json(generation);
    }

    // 返回用户的所有生成记录
    const { data: generations, error } = await supabase
      .from("generations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[Generations API] Failed to fetch generations:", error);
      return NextResponse.json(
        { error: "获取任务列表失败" },
        { status: 500 }
      );
    }

    return NextResponse.json(generations || []);
  } catch (error) {
    console.error("[Generations API] Error:", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 }
    );
  }
}
