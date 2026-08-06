import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createCanvasGenerationAdminClient } from "@/lib/canvas/generation-service";
import {
  hasCanvasBearer,
  hasCanvasHeaderSecret,
  isCanvasSecretConfigured,
} from "@/lib/canvas/internal-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RequestSchema = z
  .strictObject({
    resolutionId: z.string().uuid(),
    generationId: z.string().uuid(),
    resolution: z.enum(["bind_task", "verified_no_task_refund"]),
    taskId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .nullable()
      .optional(),
    approvalTicket: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    providerEvidence: z
      .string()
      .min(8)
      .max(1700)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  })
  .superRefine((value, context) => {
    if (value.resolution === "bind_task" && !value.taskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskId"],
        message: "bind_task requires taskId",
      });
    }
    if (
      value.resolution === "verified_no_task_refund" &&
      value.taskId != null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskId"],
        message: "refund resolution must not include taskId",
      });
    }
  });

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  const operatorLabel = process.env.CANVAS_RECOVERY_OPERATOR_LABEL ?? "";
  const approverLabel = process.env.CANVAS_RECOVERY_APPROVER_LABEL ?? "";
  const labelsValid =
    /^[A-Za-z0-9._@-]{3,48}$/.test(operatorLabel) &&
    /^[A-Za-z0-9._@-]{3,48}$/.test(approverLabel) &&
    operatorLabel !== approverLabel;
  const secretsDistinct =
    process.env.CANVAS_RECOVERY_ADMIN_SECRET !==
    process.env.CANVAS_RECOVERY_APPROVER_SECRET;
  if (
    !isCanvasSecretConfigured("CANVAS_RECOVERY_ADMIN_SECRET") ||
    !isCanvasSecretConfigured("CANVAS_RECOVERY_APPROVER_SECRET") ||
    !labelsValid ||
    !secretsDistinct
  ) {
    return json(
      {
        success: false,
        error: { code: "NOT_CONFIGURED", message: "内部恢复通道未配置" },
      },
      503
    );
  }
  if (
    !hasCanvasBearer(request, "CANVAS_RECOVERY_ADMIN_SECRET") ||
    !hasCanvasHeaderSecret(
      request,
      "x-canvas-recovery-approval",
      "CANVAS_RECOVERY_APPROVER_SECRET"
    )
  ) {
    return json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "无权调用" },
      },
      401
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: { code: "INVALID_JSON", message: "请求体不是合法 JSON" },
      },
      400
    );
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "恢复参数非法" },
      },
      400
    );
  }

  const input = parsed.data;
  const auditOperator = `${operatorLabel}:${approverLabel}`;
  const auditEvidence =
    `ticket=${input.approvalTicket};approver=${approverLabel};` +
    `evidence=${input.providerEvidence}`;
  const db = createCanvasGenerationAdminClient();
  const { data, error } = await db.rpc(
    "resolve_canvas_video_unknown_v1",
    {
      p_resolution_id: input.resolutionId,
      p_generation_id: input.generationId,
      p_resolution: input.resolution,
      p_task_id: input.taskId ?? null,
      p_operator_label: auditOperator,
      p_provider_evidence: auditEvidence,
    }
  );
  if (error) {
    console.error("[Canvas unknown resolution] rejected", {
      generationId: input.generationId,
      resolution: input.resolution,
      code:
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "unknown",
    });
    return json(
      {
        success: false,
        error: {
          code: "RESOLUTION_REJECTED",
          message: "恢复操作未通过状态或审计校验",
        },
      },
      409
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length !== 1) {
    return json(
      {
        success: false,
        error: { code: "AMBIGUOUS_RESULT", message: "恢复结果无法确认" },
      },
      500
    );
  }
  const row = rows[0] as Record<string, unknown>;
  return json(
    {
      success: true,
      data: {
        resolutionId: row.resolution_id,
        generationId: row.generation_id,
        status: row.status,
        providerSubmissionState: row.provider_submission_state,
        taskId: row.task_id,
        refundedAmount: row.refunded_amount,
        balanceAfter: row.balance_after,
        transitioned: row.transitioned,
      },
    },
    200
  );
}
