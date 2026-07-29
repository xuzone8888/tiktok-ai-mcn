import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reconcileCanvasGenerations } from "@/lib/canvas/generation-reconciliation";
import {
  hasCanvasInternalBearer,
  isCanvasInternalSecretConfigured,
} from "@/lib/canvas/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(),
  leaseSeconds: z.number().int().min(240).max(300).optional(),
  timeBudgetMs: z.number().int().min(1_000).max(240_000).optional(),
});

export async function POST(request: NextRequest) {
  if (!isCanvasInternalSecretConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "NOT_CONFIGURED", message: "reconciler 未配置" },
      },
      { status: 503 }
    );
  }
  if (!hasCanvasInternalBearer(request)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "无权调用" },
      },
      { status: 401 }
    );
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_JSON", message: "请求体不是合法 JSON" },
      },
      { status: 400 }
    );
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "reconcile 参数非法" },
      },
      { status: 400 }
    );
  }

  try {
    const result = await reconcileCanvasGenerations(parsed.data);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[Canvas reconcile route] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RECONCILE_FAILED",
          message: "reconciliation 本轮执行失败",
        },
      },
      { status: 500 }
    );
  }
}
