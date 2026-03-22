/**
 * Sora2 角色 PID 提取 API
 *
 * POST /api/characters/create-sora — 从视频中提取角色 pid
 * Body: { videoUrl, timestamps? }
 * Returns: { success, taskId }
 *
 * GET /api/characters/create-sora?taskId=xxx — 查询提取状态
 * Returns: { success, status, pid? }
 */

import { NextResponse } from "next/server";
import { submitCharacterCreate, queryCharacterResult } from "@/lib/suchuang-api";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoUrl, timestamps } = body;

    if (!videoUrl) {
      return NextResponse.json(
        { success: false, error: "缺少视频 URL" },
        { status: 400 }
      );
    }

    console.log("[Create-Sora] Submitting character creation:", {
      videoUrl: videoUrl.substring(0, 80) + "...",
      timestamps,
    });

    const result = await submitCharacterCreate(videoUrl, timestamps);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "角色创建提交失败" },
        { status: 500 }
      );
    }

    console.log("[Create-Sora] Task submitted:", result.taskId);

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
    });
  } catch (error) {
    console.error("[Create-Sora] POST error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "缺少 taskId" },
        { status: 400 }
      );
    }

    const result = await queryCharacterResult(taskId);

    // 确保 pid 以 @ 开头
    let pid = result.pid;
    if (pid && !pid.startsWith("@")) {
      pid = `@${pid}`;
    }

    return NextResponse.json({
      success: result.success,
      status: result.status,
      pid: pid || null,
      error: result.error || null,
    });
  } catch (error) {
    console.error("[Create-Sora] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
