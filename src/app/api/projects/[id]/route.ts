// ============================================================================
// TikTok AI MCN - 单个项目 API
// ============================================================================

import { NextResponse } from "next/server";
import { Project, ProjectUpdate } from "@/types/database";

// Mock 存储
const mockProjects: Map<string, Project> = new Map();

// ============================================================================
// GET - 获取单个项目
// ============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = mockProjects.get(id);

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: project,
    });
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - 更新项目
// ============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = mockProjects.get(id);

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const updates: ProjectUpdate = await request.json();

    // 合并全局设置
    const globalSettings = updates.global_settings
      ? { ...project.global_settings, ...updates.global_settings }
      : project.global_settings;

    const updatedProject: Project = {
      ...project,
      ...updates,
      global_settings: globalSettings,
      updated_at: new Date().toISOString(),
    };

    mockProjects.set(id, updatedProject);

    return NextResponse.json({
      success: true,
      data: updatedProject,
    });
  } catch (error) {
    console.error("Error updating project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update project" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - 删除/归档项目
// ============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = mockProjects.get(id);

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // 软删除 - 设置为不活跃
    const archivedProject: Project = {
      ...project,
      is_active: false,
      updated_at: new Date().toISOString(),
    };

    mockProjects.set(id, archivedProject);

    return NextResponse.json({
      success: true,
      message: "Project archived successfully",
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete project" },
      { status: 500 }
    );
  }
}

