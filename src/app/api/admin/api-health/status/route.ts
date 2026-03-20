/**
 * API 健康状态 — 公开接口
 * 
 * GET → 返回精简状态（供前端模型按钮用，无需登录）
 * 
 * 返回格式:
 * {
 *   providers: { gaorui: { status, rate }, xas231: { status, rate }, ... },
 *   lastCheck: timestamp
 * }
 */

import { NextResponse } from "next/server";

// 导入父路由的状态数据（通过动态 import 共享内存）
// Next.js 同一进程内，模块级变量在 route 之间共享

// 由于 Next.js route 模块隔离，我们需要通过全局变量共享状态
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = global as any;

interface ProviderStatusInfo {
  status: "online" | "degraded" | "offline" | "unchecked";
  rate: number;
}

export async function GET() {
  // 从全局状态读取 provider 级别的状态
  const healthData = globalAny.__apiHealthData as {
    providers: Record<string, ProviderStatusInfo>;
    lastCheck: number | null;
  } | undefined;

  if (!healthData) {
    // 还没有检测过
    return NextResponse.json({
      providers: {
        gaorui: { status: "unchecked", rate: 0 },
        xas231: { status: "unchecked", rate: 0 },
        suchuang: { status: "unchecked", rate: 0 },
        deepseek: { status: "unchecked", rate: 0 },
        doubao: { status: "unchecked", rate: 0 },
        elevenlabs: { status: "unchecked", rate: 0 },
      },
      lastCheck: null,
    });
  }

  return NextResponse.json(healthData);
}
