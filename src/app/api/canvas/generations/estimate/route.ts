import { NextRequest, NextResponse } from "next/server";

import {
  CanvasGenerationErrorSchema,
  CanvasGenerationEstimateRequestSchema,
  CanvasGenerationEstimateSuccessSchema,
} from "@/lib/canvas/generation-api-types";
import {
  CanvasGenerationServiceError,
  getCanvasGenerationEstimate,
} from "@/lib/canvas/generation-service";
import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
    error: authError,
  } = await auth.auth.getUser();
  if (authError || !user) {
    return errorResponse("UNAUTHENTICATED", "请先登录", 401);
  }
  if (!canAccessSuperCanvas({ id: user.id, email: user.email ?? null })) {
    return errorResponse("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
  const parsed = CanvasGenerationEstimateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "估价请求字段非法；不允许金额、URL 或引用数据",
      400
    );
  }

  try {
    const estimate = await getCanvasGenerationEstimate({
      userId: user.id,
      request: parsed.data,
    });
    return NextResponse.json(
      CanvasGenerationEstimateSuccessSchema.parse({
        success: true,
        data: estimate,
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
    console.error("[Canvas generation estimate] unexpected failure", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("INTERNAL", "估价失败，请稍后重试", 500, true);
  }
}
