// ============================================================================
// TikTok AI MCN - 批量启动任务 API
// ============================================================================

import { NextResponse } from "next/server";
import { Task } from "@/types/database";

// Mock 存储
const mockTasks: Map<string, Task> = new Map();
let mockUserCredits = 1000;

// ============================================================================
// POST - 批量启动任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const { task_ids } = await request.json();

    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "task_ids array is required" },
        { status: 400 }
      );
    }

    // 收集所有草稿任务
    const draftTasks: Task[] = [];
    let totalCreditsRequired = 0;

    for (const taskId of task_ids) {
      const task = mockTasks.get(taskId);
      if (task && task.status === "draft") {
        draftTasks.push(task);
        totalCreditsRequired += task.cost_credits;
      }
    }

    if (draftTasks.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid draft tasks found" },
        { status: 400 }
      );
    }

    // 检查总积分
    if (mockUserCredits < totalCreditsRequired) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient credits. Required: ${totalCreditsRequired}, Available: ${mockUserCredits}`,
          required_credits: totalCreditsRequired,
          available_credits: mockUserCredits,
        },
        { status: 400 }
      );
    }

    // 扣除积分并更新任务状态
    mockUserCredits -= totalCreditsRequired;
    const now = new Date().toISOString();
    const startedTasks: Task[] = [];

    for (const task of draftTasks) {
      const updatedTask: Task = {
        ...task,
        status: "queued",
        credits_deducted: true,
        queued_at: now,
        updated_at: now,
      };
      mockTasks.set(task.id, updatedTask);
      startedTasks.push(updatedTask);
    }

    return NextResponse.json({
      success: true,
      data: {
        started_count: startedTasks.length,
        total_credits_deducted: totalCreditsRequired,
        credits_remaining: mockUserCredits,
        tasks: startedTasks,
      },
      message: `Successfully started ${startedTasks.length} tasks`,
    });
  } catch (error) {
    console.error("Error batch starting tasks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to batch start tasks" },
      { status: 500 }
    );
  }
}

