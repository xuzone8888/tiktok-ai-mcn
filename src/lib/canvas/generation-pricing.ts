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
/**
 * 大额单次阈值。**2026-08-09 用户裁决由 5000 下调为 1000。**
 *
 * 下调的原因是原值在本产品上物理不可达:画布单次成本的天花板是 happyhorse 12 秒 = 1080
 * (次高 seedance hd 10 秒 = 994,图片 1K/2K/4K = 5/10/15),5000 是天花板的 4.6 倍,
 * 于是 `cost > 5000` 这条臂**在任何输入下都不返回**,「双阈值」实际塌缩成
 * 「余额 < 预估×1.2」单条 —— 生产余额 18459、单次 450 时,要连做约 40 次零确认生成、
 * 花掉约 18000 积分,弹窗才会第一次出现。
 *
 * 1000 这个数同时与主站 `omnibox.tsx` 的 `CONFIRM_CREDITS_THRESHOLD` 对齐(此前画布反而
 * 比主站宽 5 倍,而画布恰恰是 `supportsCancel` 全 false、提交即不可退的那条链路)。
 *
 * `verify-canvas-generation-backend.mjs` 有一道守卫穷举整个视频目录的
 * `supportedDurations × supportedQualities`,断言本阈值**低于**价目天花板 —— 即证明这条臂
 * 真的可达。将来若上调阈值或下调价目导致它重新变成死支路,那道守卫会红。
 */
export const CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD = 1000;

/**
 * 拦截原因。
 *
 * `indeterminate` 是**兜底而非主防线**:三道规整叠在本函数前面(服务端把 balance 兜成 0、
 * cost 越界直接 throw、客户端把非整数报价整体判 null),所以真实调用链上它几乎不返回。
 * 报价读不出时真正生效的保护是另一条:`estimateValue === null` → `actionDisabled` →
 * 按钮灰置且 Ctrl+Enter 早退。留着它是为了「万一上游校验被放宽」时仍然 fail-closed,
 * **不要因为它看起来不可达就删掉**。
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
