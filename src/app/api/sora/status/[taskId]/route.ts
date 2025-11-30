import { NextRequest, NextResponse } from "next/server";
import { checkSoraTaskStatus, cancelSoraTask } from "@/lib/sora-api";
import { mockUser } from "@/lib/mock-data";

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

    const result = await checkSoraTaskStatus(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Task not found" },
        { status: 404 }
      );
    }

    const task = result.task!;

    // 如果有积分退还，更新用户余额
    if (task.credits_refunded && task.credits_refunded > 0) {
      // 检查是否已经退还过（避免重复退还）
      const refundKey = `refunded_${taskId}`;
      if (!(global as any)[refundKey]) {
        mockUser.credits += task.credits_refunded;
        (global as any)[refundKey] = true;
        console.log(`[Sora API] Refunded ${task.credits_refunded} credits to user`);
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
      user_balance: mockUser.credits,
      created_at: task.created_at,
      completed_at: task.completed_at,
    });
  } catch (error: any) {
    console.error("[Sora Status API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
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

    const result = await cancelSoraTask(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to cancel task" },
        { status: 400 }
      );
    }

    // 退还积分
    if (result.refunded_credits && result.refunded_credits > 0) {
      mockUser.credits += result.refunded_credits;
    }

    return NextResponse.json({
      success: true,
      refunded_credits: result.refunded_credits,
      new_balance: mockUser.credits,
    });
  } catch (error: any) {
    console.error("[Sora Cancel API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}



