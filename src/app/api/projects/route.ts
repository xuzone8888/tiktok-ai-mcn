// ============================================================================
// TikTok AI MCN - Projects API
// ============================================================================
// 创作会话/备料台项目管理
// ============================================================================

import { NextResponse } from "next/server";
import { 
  Project, 
  ProjectInsert,
  ProjectGlobalSettings,
} from "@/types/database";

// Mock 项目存储
const mockProjects: Map<string, Project> = new Map();

// 生成 UUID
function generateId(): string {
  return 'project-' + Math.random().toString(36).substring(2, 15);
}

// Mock 用户 ID
const MOCK_USER_ID = "mock-user-123";

// 默认全局设置
const DEFAULT_GLOBAL_SETTINGS: ProjectGlobalSettings = {
  aspect_ratio: "9:16",
  duration: "10s",
  auto_download: false,
};

// ============================================================================
// GET - 获取项目列表
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get("is_active");

    let projects = Array.from(mockProjects.values());

    // 过滤活跃状态
    if (isActive !== null) {
      const activeFilter = isActive === "true";
      projects = projects.filter(p => p.is_active === activeFilter);
    }

    // 按创建时间倒序
    projects.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({
      success: true,
      data: projects,
      count: projects.length,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 创建项目
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: Partial<ProjectInsert> = await request.json();
    const {
      name = "未命名项目",
      description,
      global_settings = DEFAULT_GLOBAL_SETTINGS,
      default_model_id,
      default_product_id,
    } = body;

    const projectId = generateId();
    const now = new Date().toISOString();

    const newProject: Project = {
      id: projectId,
      user_id: MOCK_USER_ID,
      name,
      description: description || null,
      global_settings: {
        ...DEFAULT_GLOBAL_SETTINGS,
        ...global_settings,
      },
      default_model_id: default_model_id || null,
      default_product_id: default_product_id || null,
      total_tasks: 0,
      completed_tasks: 0,
      total_credits_used: 0,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    mockProjects.set(projectId, newProject);

    return NextResponse.json({
      success: true,
      data: newProject,
      message: "Project created successfully",
    });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create project" },
      { status: 500 }
    );
  }
}

