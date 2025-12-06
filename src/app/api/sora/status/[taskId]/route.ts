/**
 * Sora 任务状态 API
 * 
 * GET /api/sora/status/[taskId] - 查询任务状态
 * DELETE /api/sora/status/[taskId] - 取消任务
 */

import { NextRequest, NextResponse } from "next/server";
import { checkSoraTaskStatus, cancelSoraTask } from "@/lib/sora-api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 记录已退款的任务，避免重复退款
const refundedTasks = new Set<string>();

// GET: 查询任务状态（轮询接口）
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const result = await checkSoraTaskStatus(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "任务不存在" },
        { status: 404 }
      );
    }

    const task = result.task!;
    let userBalance = 0;

    // 获取用户当前积分
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();

      userBalance = profile?.credits || 0;

      // 如果有积分退还，更新用户余额
      if (task.credits_refunded && task.credits_refunded > 0 && !refundedTasks.has(taskId)) {
        const adminSupabase = createAdminClient();
        const { error: refundError } = await adminSupabase
          .from("profiles")
          .update({ credits: userBalance + task.credits_refunded })
          .eq("id", user.id);

        if (!refundError) {
          refundedTasks.add(taskId);
          userBalance += task.credits_refunded;
          console.log(`[Sora API] Refunded ${task.credits_refunded} credits to user ${user.id}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      task_id: task.id,
      status: task.status,
      progress: task.progress,
      video_url: task.video_url,
      thumbnail_url: task.thumbnail_url,
      error: task.error_message,
      credits_used: task.credits_used,
      credits_refunded: task.credits_refunded,
      user_balance: userBalance,
      created_at: task.created_at,
      completed_at: task.completed_at,
    });
  } catch (error: unknown) {
    console.error("[Sora Status API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

// DELETE: 取消任务
export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401 }
      );
    }

    const result = await cancelSoraTask(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "取消任务失败" },
        { status: 400 }
      );
    }

    let newBalance = 0;

    // 退还积分
    if (result.refunded_credits && result.refunded_credits > 0) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();

      if (profile) {
        const adminSupabase = createAdminClient();
        const { error: refundError } = await adminSupabase
          .from("profiles")
          .update({ credits: profile.credits + result.refunded_credits })
          .eq("id", user.id);

        if (!refundError) {
          newBalance = profile.credits + result.refunded_credits;
        }
      }
    }

    return NextResponse.json({
      success: true,
      refunded_credits: result.refunded_credits,
      new_balance: newBalance,
    });
  } catch (error: unknown) {
    console.error("[Sora Cancel API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}
