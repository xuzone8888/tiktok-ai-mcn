import { z } from "zod";

import {
  CANVAS_IMAGE_ASPECT_RATIOS,
  CanvasGenerationIntentV1Schema,
  type CanvasGenerationIntentV1,
} from "./generation-intent";
import { parseUntrustedVideoModelContract } from "../video-models/contract";
import { VIDEO_MODEL_IDS } from "../video-models/types";

const LOWERCASE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NODE_ID_RE = /^[!-~]+$/;
const WRITER_TAG_RE = /^[A-Za-z0-9_-]{8,128}$/;

export const CanvasGenerationIdSchema = z
  .string()
  .regex(LOWERCASE_UUID_RE, "must be a lowercase canonical UUID");

export const CanvasGenerationNodeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(NODE_ID_RE, "must be printable ASCII without whitespace or controls");

/**
 * The browser supplies identity and a strict intent only. In particular this
 * object intentionally has no cost/credits/URL/provider fields.
 */
export const CanvasGenerationCreateRequestSchema = z
  .strictObject({
    canvasId: CanvasGenerationIdSchema,
    nodeId: CanvasGenerationNodeIdSchema,
    actionId: CanvasGenerationIdSchema,
    observedRev: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    writerTag: z.string().regex(WRITER_TAG_RE),
    intent: CanvasGenerationIntentV1Schema,
  })
  .superRefine((value, ctx) => {
    if (value.intent.actionId !== value.actionId) {
      ctx.addIssue({
        code: "custom",
        path: ["intent", "actionId"],
        message: "intent.actionId must equal actionId",
      });
    }
  });
export type CanvasGenerationCreateRequest = z.infer<
  typeof CanvasGenerationCreateRequestSchema
>;

const CanvasImageEstimateConfigSchema = z.strictObject({
  resolution: z.enum(["1k", "2k", "4k"]),
  // 画幅枚举与 intent 同源(见 generation-intent.ts 的 CANVAS_IMAGE_ASPECT_RATIOS);
  // 估价与提交必须收同一个集合,否则会出现「估得出价、提交被拒」或反之。
  aspectRatio: z.enum(CANVAS_IMAGE_ASPECT_RATIOS),
});

const CanvasVideoEstimateConfigSchema = z.strictObject({
  model: z.enum(VIDEO_MODEL_IDS),
  durationSeconds: z.union([
    z.literal(5),
    z.literal(8),
    z.literal(10),
    z.literal(12),
    z.literal(15),
  ]),
  quality: z.enum(["standard", "hd"]),
  aspectRatio: z.enum(["9:16", "16:9"]),
  mode: z.enum(["prompt_to_video", "image_to_video"]),
});

export const CanvasGenerationEstimateRequestSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("image"),
      config: CanvasImageEstimateConfigSchema,
    }),
    z.strictObject({
      kind: z.literal("video"),
      config: CanvasVideoEstimateConfigSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.kind !== "video") return;
    const capability = parseUntrustedVideoModelContract({
      modelType: value.config.model,
      durationSeconds: value.config.durationSeconds,
      quality: value.config.quality,
      aspectRatio: value.config.aspectRatio,
      mode: value.config.mode,
      // Reference presence does not affect price. Use the minimal valid count
      // solely to validate the selected mode against the model catalog.
      referenceImageCount:
        value.config.mode === "image_to_video" ? 1 : 0,
    });
    if (!capability.ok) {
      ctx.addIssue({
        code: "custom",
        path: [
          "config",
          capability.error.field === "modelType"
            ? "model"
            : capability.error.field,
        ],
        message: capability.error.message,
      });
    }
  });
export type CanvasGenerationEstimateRequest = z.infer<
  typeof CanvasGenerationEstimateRequestSchema
>;

export const CanvasGenerationStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "unknown",
]);
export type CanvasGenerationStatus = z.infer<
  typeof CanvasGenerationStatusSchema
>;

export const CanvasProviderSubmissionStateSchema = z.enum([
  "not_started",
  "submitting",
  "bound",
  "unknown",
]);
export type CanvasProviderSubmissionState = z.infer<
  typeof CanvasProviderSubmissionStateSchema
>;

export const CanvasGenerationViewSchema = z.strictObject({
  generationId: CanvasGenerationIdSchema,
  actionId: CanvasGenerationIdSchema,
  canvasId: CanvasGenerationIdSchema,
  nodeId: CanvasGenerationNodeIdSchema,
  kind: z.enum(["text", "image", "video"]),
  status: CanvasGenerationStatusSchema,
  providerSubmissionState: CanvasProviderSubmissionStateSchema,
  taskId: z.string().min(1).nullable(),
  progress: z.number().int().min(0).max(100),
  creditCost: z.number().int().min(0),
  billingMode: z.enum(["debit", "free_quota"]),
  outputOssKey: z.string().min(1).nullable(),
  outputText: z.string().nullable(),
  errorCode: z.string().min(1).nullable(),
  refundedCredits: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CanvasGenerationView = z.infer<
  typeof CanvasGenerationViewSchema
>;

export const CanvasGenerationCreateSuccessSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    generation: CanvasGenerationViewSchema,
    balanceAfter: z.number().int().min(0).optional(),
    deduplicated: z.boolean().optional(),
  }),
});
export type CanvasGenerationCreateSuccess = z.infer<
  typeof CanvasGenerationCreateSuccessSchema
>;

export const CanvasGenerationListSuccessSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    generations: z.array(CanvasGenerationViewSchema),
  }),
});
export type CanvasGenerationListSuccess = z.infer<
  typeof CanvasGenerationListSuccessSchema
>;

export const CanvasGenerationEstimateSchema = z.strictObject({
  kind: z.enum(["text", "image", "video"]),
  cost: z.number().int().min(0),
  pricingVersion: z.string().min(1),
  balance: z.number().int().min(0),
  needsConfirmation: z.boolean(),
  /** 拦截原因(CHECKLIST #185);不拦时为 null。仅用于文案分支,不参与任何金额计算。 */
  confirmationReason: z
    .enum(["low_balance", "high_cost", "indeterminate"])
    .nullable(),
});
export type CanvasGenerationEstimate = z.infer<
  typeof CanvasGenerationEstimateSchema
>;

export const CanvasGenerationEstimateSuccessSchema = z.strictObject({
  success: z.literal(true),
  data: CanvasGenerationEstimateSchema,
});
export type CanvasGenerationEstimateSuccess = z.infer<
  typeof CanvasGenerationEstimateSuccessSchema
>;

export const CanvasGenerationErrorSchema = z.strictObject({
  success: z.literal(false),
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
  }),
});
export type CanvasGenerationError = z.infer<
  typeof CanvasGenerationErrorSchema
>;

export interface CanvasGenerationProjectionRow {
  id: string;
  action_id: string;
  canvas_id_snapshot: string;
  canvas_node_id: string;
  type: string;
  status: string;
  provider_submission_state: string | null;
  task_id: string | null;
  progress: number | null;
  credit_cost: number | null;
  billing_mode: string | null;
  output_oss_key: string | null;
  output_text: string | null;
  error_message: string | null;
  last_reconcile_error_code?: string | null;
  credits_refunded: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function mapCanvasGenerationStatus(input: {
  status: unknown;
  providerSubmissionState: unknown;
}): CanvasGenerationStatus {
  if (input.status === "completed") return "completed";
  if (input.status === "failed") return "failed";
  if (input.providerSubmissionState === "unknown") return "unknown";
  if (
    input.status === "processing" ||
    input.providerSubmissionState === "bound"
  ) {
    return "processing";
  }
  return "pending";
}

function clampProgress(value: unknown, status: CanvasGenerationStatus): number {
  if (status === "completed" || status === "failed") return 100;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return status === "processing" ? 10 : 0;
  }
  return Math.max(0, Math.min(99, Math.round(value)));
}

/** Strictly map the owner-scoped database projection to the public DTO. */
export function toCanvasGenerationView(
  row: CanvasGenerationProjectionRow
): CanvasGenerationView {
  const status = mapCanvasGenerationStatus({
    status: row.status,
    providerSubmissionState: row.provider_submission_state,
  });
  const providerSubmissionState =
    CanvasProviderSubmissionStateSchema.parse(
      row.provider_submission_state ?? "not_started"
    );
  const kind = z.enum(["text", "image", "video"]).parse(row.type);

  return CanvasGenerationViewSchema.parse({
    generationId: row.id,
    actionId: row.action_id,
    canvasId: row.canvas_id_snapshot,
    nodeId: row.canvas_node_id,
    kind,
    status,
    providerSubmissionState,
    taskId: row.task_id,
    progress: clampProgress(row.progress, status),
    creditCost: row.credit_cost ?? 0,
    billingMode: row.billing_mode ?? (kind === "text" ? "free_quota" : "debit"),
    outputOssKey: status === "completed" ? row.output_oss_key : null,
    outputText: status === "completed" ? row.output_text : null,
    errorCode:
      row.error_message ?? row.last_reconcile_error_code ?? null,
    refundedCredits: row.credits_refunded ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

export type { CanvasGenerationIntentV1 };
