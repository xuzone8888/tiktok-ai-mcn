import { getImageResolutionCost } from "../../types/generation";
import {
  getVideoModelCatalogEntry,
  getVideoModelCreditCost,
} from "../video-models/catalog";
import type { CanvasGenerationIntentV1 } from "./generation-intent";
import type { CanvasGenerationEstimateRequest } from "./generation-api-types";

export const CANVAS_GENERATION_PRICING_VERSION =
  "canvas-generation-2026-07-29-v1" as const;

/**
 * 拦截式确认阈值(CHECKLIST #185)。规格原文=「拦截式确认仅限『余额<预估×1.2 或单次>5000⚡』」。
 *
 * 2026-08-09 用户裁决:按原规格改代码,不改规格。此前实现为 `needsConfirmation: cost > 0`
 * (每次付费都弹),方向与规格相反,且与 #184「费用汇总条常显、替代弹窗」的设计意图冲突。
 *
 * 调整这两个数字等于调整资金确认边界,**须用户裁决**,不得随手改。
 */
export const CANVAS_CONFIRMATION_LOW_BALANCE_MULTIPLIER = 1.2;
export const CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD = 5000;

/**
 * 拦截原因。`indeterminate` 是 fail-closed 兜底:报价或余额读不出可信数值时宁可拦。
 */
export type CanvasConfirmationTrigger =
  | "low_balance"
  | "high_cost"
  | "indeterminate";

/**
 * 拦截式确认判定(CHECKLIST #185)。返回 null=不拦。
 *
 * 判定顺序是刻意的:余额吃紧比单次大额更该先讲——前者意味着这一单可能根本扣不动,
 * 后者只是金额大。两条同时命中时按 `low_balance` 提示。
 *
 * 免费动作(cost<=0)一律不拦:没有资金变动,拦了只是噪音。
 * 服务端 `begin_canvas_generation_v1` 仍会原子拒绝余额不足,本函数只管「要不要多问一句」。
 */
export function resolveCanvasConfirmationTrigger(input: {
  cost: number;
  balance: number;
}): CanvasConfirmationTrigger | null {
  const { cost, balance } = input;
  if (!Number.isFinite(cost) || !Number.isFinite(balance)) return "indeterminate";
  if (cost <= 0) return null;
  if (balance < cost * CANVAS_CONFIRMATION_LOW_BALANCE_MULTIPLIER) {
    return "low_balance";
  }
  if (cost > CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD) return "high_cost";
  return null;
}

export interface CanvasGenerationPricing {
  kind: CanvasGenerationIntentV1["kind"];
  cost: number;
  pricingVersion: typeof CANVAS_GENERATION_PRICING_VERSION;
  billingMode: "debit" | "free_quota";
  reconcileProfileVersion: string | null;
  reconcileIntervalMs: number | null;
}

/**
 * The sole Canvas price calculator used by both estimate and settlement.
 * No caller-provided amount participates in this calculation.
 */
export function estimateCanvasGeneration(
  intent: CanvasGenerationIntentV1
): CanvasGenerationPricing {
  if (intent.kind === "text") {
    return {
      kind: "text",
      cost: 0,
      pricingVersion: CANVAS_GENERATION_PRICING_VERSION,
      billingMode: "free_quota",
      reconcileProfileVersion: null,
      reconcileIntervalMs: null,
    };
  }

  if (intent.kind === "image") {
    return {
      kind: "image",
      cost: getImageResolutionCost(intent.config.resolution),
      pricingVersion: CANVAS_GENERATION_PRICING_VERSION,
      billingMode: "debit",
      reconcileProfileVersion: "gpt-image-2-poll-v1",
      reconcileIntervalMs: 30_000,
    };
  }

  const model = getVideoModelCatalogEntry(intent.config.model);
  return {
    kind: "video",
    cost: getVideoModelCreditCost(
      intent.config.model,
      intent.config.durationSeconds,
      intent.config.quality
    ),
    pricingVersion: CANVAS_GENERATION_PRICING_VERSION,
    billingMode: "debit",
    reconcileProfileVersion: `canvas-${intent.config.model}-poll-v1`,
    reconcileIntervalMs: model.pollIntervalMs,
  };
}

export function estimateCanvasGenerationSelection(
  request: CanvasGenerationEstimateRequest
): {
  kind: "image" | "video";
  cost: number;
  pricingVersion: typeof CANVAS_GENERATION_PRICING_VERSION;
  billingMode: "debit";
} {
  if (request.kind === "image") {
    return {
      kind: "image",
      cost: getImageResolutionCost(request.config.resolution),
      pricingVersion: CANVAS_GENERATION_PRICING_VERSION,
      billingMode: "debit",
    };
  }
  return {
    kind: "video",
    cost: getVideoModelCreditCost(
      request.config.model,
      request.config.durationSeconds,
      request.config.quality
    ),
    pricingVersion: CANVAS_GENERATION_PRICING_VERSION,
    billingMode: "debit",
  };
}
