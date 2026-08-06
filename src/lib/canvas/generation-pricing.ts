import { getImageResolutionCost } from "../../types/generation";
import {
  getVideoModelCatalogEntry,
  getVideoModelCreditCost,
} from "../video-models/catalog";
import type { CanvasGenerationIntentV1 } from "./generation-intent";
import type { CanvasGenerationEstimateRequest } from "./generation-api-types";

export const CANVAS_GENERATION_PRICING_VERSION =
  "canvas-generation-2026-07-29-v1" as const;

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
