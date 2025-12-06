// ============================================================================
// TikTok AI MCN - 任务状态查询 API
// ============================================================================

import { NextResponse } from "next/server";
import type { TaskStatus } from "@/types/database";

// Mock 任务存储（与其他路由共享）
interface MockTask {
  id: string;
  status: TaskStatus;
  progress: number;
  output_url: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// 全局任务存储（模拟数据库）
const globalTaskStore = new Map<string, MockTask>();

// 导出供其他模块使用
export function getTaskStore() {
  return globalTaskStore;
}

export function setTask(task: MockTask) {
  globalTaskStore.set(task.id, task);
}

export function getTask(taskId: string): MockTask | undefined {
  return globalTaskStore.get(taskId);
}

// ============================================================================
// GET - 查询任务状态
// ============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = globalTaskStore.get(id);

    if (!task) {
      // 返回模拟数据用于演示
      return NextResponse.json({
        success: true,
        task: {
          id,
          status: "processing" as TaskStatus,
          progress: Math.floor(Math.random() * 100),
          output_url: null,
          thumbnail_url: null,
          error_message: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        progress: task.progress,
        output_url: task.output_url,
        thumbnail_url: task.thumbnail_url,
        error_message: task.error_message,
        started_at: task.started_at,
        completed_at: task.completed_at,
      },
    });
  } catch (error) {
    console.error("Error fetching task status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch task status" },
      { status: 500 }
    );
  }
}

