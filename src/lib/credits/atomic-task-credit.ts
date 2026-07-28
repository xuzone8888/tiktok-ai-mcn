import "server-only";

import { createHash } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TaskCreditEntryKind = "consume" | "refund" | "grant";

export type TaskCreditScope =
  | "character-board"
  | "character-video"
  | "legacy-generate"
  | "quick-video"
  | "legacy-generation"
  | "seedance"
  | "happyhorse"
  | "sora-status"
  | "quick-image"
  | "ecom-image"
  | "video-model"
  | "slideshow"
  | "studio-assembly"
  | "contract";

export interface ApplyTaskCreditDeltaInput {
  supabase: AdminClient;
  userId: string;
  entryKind: TaskCreditEntryKind;
  amount: number;
  scope: TaskCreditScope;
  taskId: string;
  operation: string;
  pricingVersion: string;
  description: string;
}

export interface AppliedTaskCreditDelta {
  ledgerId: string;
  balanceBefore: number;
  balanceAfter: number;
  applied: boolean;
  operationAnchor: string;
  taskId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function requireNonblank(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be nonblank and at most ${maxLength} characters`);
  }
  return normalized;
}

function validateSignedAmount(entryKind: TaskCreditEntryKind, amount: number) {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("credit amount must be a safe integer");
  }
  if (entryKind === "consume" ? amount >= 0 : amount <= 0) {
    throw new Error(`${entryKind} has an invalid signed amount`);
  }
}

export function deriveTaskCreditOperationAnchor(params: {
  userId: string;
  scope: TaskCreditScope;
  taskId: string;
  operation: string;
}) {
  const userId = requireNonblank(params.userId, "userId", 64).toLowerCase();
  if (!UUID_RE.test(userId)) {
    throw new Error("userId must be a canonical UUID");
  }

  const taskId = requireNonblank(params.taskId, "taskId", 512);
  const operation = requireNonblank(params.operation, "operation", 64);
  if (!OPERATION_RE.test(operation)) {
    throw new Error("operation must be a controlled lowercase token");
  }

  const taskDigest = createHash("sha256")
    .update(`${params.scope}\0${taskId}`, "utf8")
    .digest("hex");

  return {
    taskId,
    operationAnchor: `canvas-p1-task:${params.scope}:${operation}:${taskDigest}`,
  };
}

export async function applyTaskCreditDelta(
  input: ApplyTaskCreditDeltaInput
): Promise<AppliedTaskCreditDelta> {
  validateSignedAmount(input.entryKind, input.amount);
  const pricingVersion = requireNonblank(
    input.pricingVersion,
    "pricingVersion",
    128
  );
  const description = requireNonblank(input.description, "description", 512);
  const identity = deriveTaskCreditOperationAnchor(input);

  const { data, error } = await (input.supabase as any).rpc(
    "canvas_p1_apply_credit_delta_v1",
    {
      p_user_id: input.userId,
      p_entry_kind: input.entryKind,
      p_amount: input.amount,
      p_operation_anchor: identity.operationAnchor,
      p_generation_id: null,
      p_action_id: null,
      p_canvas_id: null,
      p_canvas_id_snapshot: null,
      p_canvas_node_id: null,
      p_task_id: identity.taskId,
      p_batch_id: null,
      p_pricing_version: pricingVersion,
      p_quota_key: null,
      p_quota_window_start: null,
      p_description: description,
    }
  );

  if (error) {
    throw new Error(error.message || "原子积分操作失败");
  }

  const row = Array.isArray(data) ? data[0] : data;
  const ledgerId = row?.ledger_id;
  const balanceBefore = Number(row?.balance_before);
  const balanceAfter = Number(row?.balance_after);
  const applied = row?.applied;

  if (
    typeof ledgerId !== "string" ||
    !UUID_RE.test(ledgerId) ||
    !Number.isSafeInteger(balanceBefore) ||
    !Number.isSafeInteger(balanceAfter) ||
    typeof applied !== "boolean"
  ) {
    throw new Error("原子积分操作返回了无效结果");
  }

  return {
    ledgerId,
    balanceBefore,
    balanceAfter,
    applied,
    operationAnchor: identity.operationAnchor,
    taskId: identity.taskId,
  };
}
