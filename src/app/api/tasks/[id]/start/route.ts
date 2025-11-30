// ============================================================================
// TikTok AI MCN - 启动任务 API
// ============================================================================
// 将草稿任务转为队列状态，扣除积分，触发 API 调用
// ============================================================================

import { NextResponse } from "next/server";
import { Task } from "@/types/database";

// Mock 存储（实际应用中应使用数据库）
const mockTasks: Map<string, Task> = new Map();

// Mock 用户积分
let mockUserCredits = 1000;

// ============================================================================
// POST - 启动单个任务
// ============================================================================

export async function POST(
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

    // 验证任务状态
    if (task.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "Task is not in draft status" },
        { status: 400 }
      );
    }

    // 检查积分余额
    if (mockUserCredits < task.cost_credits) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient credits. Required: ${task.cost_credits}, Available: ${mockUserCredits}` 
        },
        { status: 400 }
      );
    }

    // 扣除积分
    mockUserCredits -= task.cost_credits;

    // 更新任务状态
    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...task,
      status: "queued",
      credits_deducted: true,
      queued_at: now,
      updated_at: now,
    };

    mockTasks.set(id, updatedTask);

    // 模拟异步触发 API 调用
    // 在实际应用中，这里会调用 Sora API 并更新任务状态
    setTimeout(() => {
      simulateApiProcessing(id);
    }, 1000);

    return NextResponse.json({
      success: true,
      data: updatedTask,
      credits_remaining: mockUserCredits,
      message: "Task started successfully",
    });
  } catch (error) {
    console.error("Error starting task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start task" },
      { status: 500 }
    );
  }
}

// ============================================================================
// 模拟 API 处理
// ============================================================================

async function simulateApiProcessing(taskId: string) {
  const task = mockTasks.get(taskId);
  if (!task || task.status !== "queued") return;

  // 更新为处理中
  const processingTask: Task = {
    ...task,
    status: "processing",
    api_task_id: `sora-${Date.now()}`,
    api_provider: "sora",
    started_at: new Date().toISOString(),
    timeout_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分钟超时
    updated_at: new Date().toISOString(),
  };
  mockTasks.set(taskId, processingTask);

  // 模拟进度更新
  const progressInterval = setInterval(() => {
    const currentTask = mockTasks.get(taskId);
    if (!currentTask || currentTask.status !== "processing") {
      clearInterval(progressInterval);
      return;
    }

    const newProgress = Math.min(currentTask.progress + 10, 90);
    mockTasks.set(taskId, {
      ...currentTask,
      progress: newProgress,
      updated_at: new Date().toISOString(),
    });
  }, 1000);

  // 模拟完成（10秒后）
  setTimeout(() => {
    clearInterval(progressInterval);
    const currentTask = mockTasks.get(taskId);
    if (!currentTask || currentTask.status !== "processing") return;

    // 90% 成功率
    const isSuccess = Math.random() > 0.1;

    if (isSuccess) {
      const completedTask: Task = {
        ...currentTask,
        status: "completed",
        progress: 100,
        output_url: `https://example.com/videos/${taskId}.mp4`,
        thumbnail_url: `https://example.com/thumbnails/${taskId}.jpg`,
        resolution: currentTask.aspect_ratio === "9:16" ? "1080x1920" : "1920x1080",
        file_size: 15 * 1024 * 1024, // 15MB
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockTasks.set(taskId, completedTask);
    } else {
      // 失败并退还积分
      mockUserCredits += currentTask.cost_credits;
      
      const failedTask: Task = {
        ...currentTask,
        status: "failed",
        error_message: "API processing failed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockTasks.set(taskId, failedTask);
    }
  }, 10000);
}

