/**
 * @deprecated 2026-03-19 — 已废弃，由 /api/video-batch/veo-status 替代
 *
 * Sora 任务状态 API（旧版路由，保留仅供历史兼容）
 *
 * 注意: sora-api.ts 已删除，此路由不再可用。
 */

import { NextRequest, NextResponse } from "next/server";

// GET: 查询任务状态 — 已废弃
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  return NextResponse.json(
    { error: "此接口已废弃，请使用新版批量视频状态查询接口" },
    { status: 410 }
  );
}

// DELETE: 取消任务 — 已废弃
export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  return NextResponse.json(
    { error: "此接口已废弃" },
    { status: 410 }
  );
}

