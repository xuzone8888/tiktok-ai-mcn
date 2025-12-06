// ============================================================================
// TikTok AI MCN - 单个任务 API
// ============================================================================

import { NextResponse } from "next/server";
import { Task, TaskUpdate } from "@/types/database";

// 共享 Mock 存储（实际应用中应使用数据库）
// 注意：这里为了演示，每个文件都有独立的存储，实际应共享
const mockTasks: Map<string, Task> = new Map();

// ============================================================================
// GET - 获取单个任务
// ============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = mockTasks.get(id);

    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error("Error fetching task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch task" },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - 更新任务
// ============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = mockTasks.get(id);

    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const updates: TaskUpdate = await request.json();
    
    // 只有草稿状态的任务才能修改大部分字段
    if (task.status !== "draft" && updates.input_params) {
      return NextResponse.json(
        { success: false, error: "Cannot modify input params of non-draft task" },
        { status: 400 }
      );
    }

    // 更新任务
    const updatedTask: Task = {
      ...task,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    mockTasks.set(id, updatedTask);

    return NextResponse.json({
      success: true,
      data: updatedTask,
    });
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update task" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - 删除任务（仅草稿状态）
// ============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = mockTasks.get(id);

    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    // 只有草稿状态才能删除
    if (task.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "Can only delete draft tasks" },
        { status: 400 }
      );
    }

    mockTasks.delete(id);

    return NextResponse.json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete task" },
      { status: 500 }
    );
  }
}

