// ============================================================================
// TikTok AI MCN - 任务队列 API
// ============================================================================
// 支持备料台草稿任务和任务队列管理
// ============================================================================

import { NextResponse } from "next/server";
import { 
  Task, 
  TaskInsert, 
  TaskStatus, 
  AspectRatio, 
  VideoDuration,
  VIDEO_CREDITS_PRICING 
} from "@/types/database";

// Mock 任务存储
const mockTasks: Map<string, Task> = new Map();

// 生成 UUID
function generateId(): string {
  return 'task-' + Math.random().toString(36).substring(2, 15);
}

// Mock 用户 ID
const MOCK_USER_ID = "mock-user-123";

// ============================================================================
// GET - 获取任务列表
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TaskStatus | null;
    const projectId = searchParams.get("project_id");
    
    // 过滤任务
    let tasks = Array.from(mockTasks.values());
    
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }
    
    if (projectId) {
      tasks = tasks.filter(t => t.project_id === projectId);
    }
    
    // 按创建时间倒序
    tasks.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    return NextResponse.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 创建草稿任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      project_id,
      model_id,
      product_id,
      type = "video",
      aspect_ratio = "9:16",
      duration = "10s",
      is_auto_download = false,
      input_params = {},
    } = body;

    // 验证必填字段
    if (!model_id) {
      return NextResponse.json(
        { success: false, error: "model_id is required" },
        { status: 400 }
      );
    }

    // 计算积分消耗
    const costCredits = type === "video" 
      ? VIDEO_CREDITS_PRICING[duration as VideoDuration] || 50
      : 10;

    // 创建草稿任务
    const taskId = generateId();
    const now = new Date().toISOString();
    
    const newTask: Task = {
      id: taskId,
      user_id: MOCK_USER_ID,
      project_id: project_id || null,
      model_id,
      product_id: product_id || null,
      contract_id: null,
      type,
      status: "draft",
      aspect_ratio: aspect_ratio as AspectRatio,
      duration: duration as VideoDuration,
      is_auto_download,
      cost_credits: costCredits,
      credits_deducted: false,
      input_params,
      output_url: null,
      output_urls: [],
      thumbnail_url: null,
      resolution: null,
      file_size: null,
      api_task_id: null,
      api_provider: null,
      progress: 0,
      error_message: null,
      retry_count: 0,
      max_retries: 3,
      priority: 0,
      queue_position: null,
      metadata: {},
      created_at: now,
      updated_at: now,
      queued_at: null,
      started_at: null,
      completed_at: null,
      timeout_at: null,
    };

    mockTasks.set(taskId, newTask);

    return NextResponse.json({
      success: true,
      data: newTask,
      message: "Draft task created successfully",
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create task" },
      { status: 500 }
    );
  }
}

