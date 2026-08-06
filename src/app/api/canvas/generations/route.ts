import { NextRequest, NextResponse } from "next/server";

import {
  CanvasGenerationCreateSuccessSchema,
  CanvasGenerationErrorSchema,
  CanvasGenerationIdSchema,
  CanvasGenerationListSuccessSchema,
} from "@/lib/canvas/generation-api-types";
import {
  CanvasGenerationServiceError,
  createCanvasGeneration,
  listCanvasGenerations,
} from "@/lib/canvas/generation-service";
import { kickCanvasReconciliation } from "@/lib/canvas/generation-reconciliation";
import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false
) {
  return NextResponse.json(
    CanvasGenerationErrorSchema.parse({
      success: false,
      error: {
        code,
        message,
        ...(retryable ? { retryable: true } : {}),
      },
    }),
    { status }
  );
}

async function currentUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const auth = await createClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  return error || !user
    ? null
    : { id: user.id, email: user.email ?? null };
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return errorResponse("UNAUTHENTICATED", "请先登录", 401);
  }
  if (!canAccessSuperCanvas(user)) {
    return errorResponse("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "请求体不是合法 JSON", 400);
  }

  try {
    const result = await createCanvasGeneration(body, user.id);
    const response = CanvasGenerationCreateSuccessSchema.parse({
      success: true,
      data: {
        generation: result.generation,
        ...(result.balanceAfter !== undefined
          ? { balanceAfter: result.balanceAfter }
          : {}),
        ...(result.deduplicated ? { deduplicated: true } : {}),
      },
    });
    return NextResponse.json(response, {
      status:
        result.generation.status === "completed" ||
        result.generation.status === "failed"
          ? 200
          : 202,
    });
  } catch (error) {
    if (error instanceof CanvasGenerationServiceError) {
      return errorResponse(
        error.code,
        error.message,
        error.status,
        error.retryable
      );
    }
    console.error("[Canvas generations POST] unexpected failure", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      "INTERNAL",
      "生成服务暂时不可用，请稍后重试",
      500,
      true
    );
  }
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return errorResponse("UNAUTHENTICATED", "请先登录", 401);
  }
  if (!canAccessSuperCanvas(user)) {
    return errorResponse("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放", 403);
  }

  const allowed = new Set(["canvasId", "actionId", "limit"]);
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!allowed.has(key)) {
      return errorResponse("INVALID_QUERY", `不支持的查询字段: ${key}`, 400);
    }
  }
  const canvasId = request.nextUrl.searchParams.get("canvasId");
  const actionId = request.nextUrl.searchParams.get("actionId");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (!canvasId || !CanvasGenerationIdSchema.safeParse(canvasId).success) {
    return errorResponse("INVALID_QUERY", "canvasId 非法", 400);
  }
  if (
    actionId !== null &&
    !CanvasGenerationIdSchema.safeParse(actionId).success
  ) {
    return errorResponse("INVALID_QUERY", "actionId 非法", 400);
  }
  let limit = 50;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return errorResponse("INVALID_QUERY", "limit 必须是 1..100 的整数", 400);
    }
  }

  // Best effort only: the read remains owner-scoped and available even when a
  // provider or the global reconciliation lane is temporarily unavailable.
  await kickCanvasReconciliation({ limit: 5, waitMs: 700 }).catch(() => {});

  try {
    const generations = await listCanvasGenerations({
      userId: user.id,
      canvasId,
      ...(actionId ? { actionId } : {}),
      limit,
    });
    return NextResponse.json(
      CanvasGenerationListSuccessSchema.parse({
        success: true,
        data: { generations },
      })
    );
  } catch (error) {
    if (error instanceof CanvasGenerationServiceError) {
      return errorResponse(
        error.code,
        error.message,
        error.status,
        error.retryable
      );
    }
    console.error("[Canvas generations GET] unexpected failure", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("INTERNAL", "任务列表读取失败", 500, true);
  }
}
