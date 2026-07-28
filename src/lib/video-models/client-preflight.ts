import {
  QUICK_GEN_VIDEO_PRICING,
  isVideoModelPricingKey,
} from "@/types/generation";
import {
  parseUntrustedVideoModelContract,
  validatePersistedVideoSelection,
  type RawUntrustedVideoModelContractInput,
  type VideoModelContractResult,
} from "./contract";
import type { VideoModelId, VideoQuality } from "./types";

export interface UntrustedQuickGenVideoSelection {
  model?: unknown;
  apiModel?: unknown;
  duration?: unknown;
  quality?: unknown;
  aspectRatio?: unknown;
  sourceImageUrl?: unknown;
}

export interface ResolvedQuickGenVideoSelection {
  modelType: VideoModelId;
  durationSeconds: number;
  quality: VideoQuality;
  creditCost: number;
  apiModel: string;
}

export interface UntrustedVideoStatusSelection {
  model?: unknown;
  modelType?: unknown;
  duration?: unknown;
  quality?: unknown;
}

export interface ResolvedVideoStatusSelection {
  modelType: VideoModelId;
  durationSeconds: number;
  quality: VideoQuality;
}

export type PersistedVideoTaskRecoveryResult =
  | {
      ok: true;
      mode: "status";
      value: ResolvedVideoStatusSelection;
    }
  | {
      ok: true;
      mode: "submit";
    }
  | {
      ok: false;
      error: {
        field: "upstreamTaskId" | "modelType" | "durationSeconds" | "quality" | "aspectRatio";
        message: string;
      };
    };

interface HistoricalStatusConfig extends ResolvedVideoStatusSelection {
  acceptedQualities?: readonly unknown[];
}

const HISTORICAL_STATUS_MODELS: Readonly<Record<string, HistoricalStatusConfig>> = {
  "sora2-10s": { modelType: "sora2", durationSeconds: 10, quality: "standard" },
  "sora2-12s": { modelType: "sora2", durationSeconds: 12, quality: "standard" },
  "sora2-15s": { modelType: "sora2", durationSeconds: 15, quality: "standard" },
  "sora2-pro-12s-hd": { modelType: "sora2-pro", durationSeconds: 12, quality: "hd" },
  "sora2-pro-15s-hd": { modelType: "sora2-pro", durationSeconds: 15, quality: "hd" },
  "sora2-pro-25s": { modelType: "sora2-pro", durationSeconds: 25, quality: "standard" },
  "seedance-5s": { modelType: "seedance", durationSeconds: 5, quality: "standard" },
  "seedance-10s": { modelType: "seedance", durationSeconds: 10, quality: "standard" },
  "seedance-5s-pro": { modelType: "seedance", durationSeconds: 5, quality: "hd" },
  "seedance-10s-pro": { modelType: "seedance", durationSeconds: 10, quality: "hd" },
  "happyhorse-5s": { modelType: "happyhorse", durationSeconds: 5, quality: "standard" },
  "happyhorse-12s": { modelType: "happyhorse", durationSeconds: 12, quality: "standard" },
  "veo3-components": { modelType: "veo", durationSeconds: 8, quality: "standard" },
  "veo3-fast": { modelType: "veo", durationSeconds: 8, quality: "standard" },
  "veo3-std": { modelType: "veo", durationSeconds: 8, quality: "standard" },
  "veo3-fast-4k": {
    modelType: "veo",
    durationSeconds: 8,
    quality: "standard",
    acceptedQualities: ["standard", "4k"],
  },
  "veo3-4k": {
    modelType: "veo",
    durationSeconds: 8,
    quality: "standard",
    acceptedQualities: ["standard", "4k"],
  },
  "grok-10s": { modelType: "grok", durationSeconds: 10, quality: "standard" },
  "grok-15s": { modelType: "grok", durationSeconds: 15, quality: "standard" },
  "grok-imagine-10s": { modelType: "grok", durationSeconds: 10, quality: "standard" },
  "grok-imagine-15s": { modelType: "grok", durationSeconds: 15, quality: "standard" },
  "omni-10s": { modelType: "omni", durationSeconds: 10, quality: "standard" },
  "omni-flash": { modelType: "omni", durationSeconds: 10, quality: "standard" },
};

function getCanonicalStatusConfig(
  modelType: string,
  duration: unknown,
  quality: unknown
): HistoricalStatusConfig | null {
  if (modelType === "sora2" && [10, 12, 15].includes(duration as number) && quality === "standard") {
    return { modelType, durationSeconds: duration as number, quality };
  }
  if (
    modelType === "sora2-pro"
    && ((duration === 12 && quality === "hd")
      || (duration === 15 && quality === "hd")
      || (duration === 25 && quality === "standard"))
  ) {
    return { modelType, durationSeconds: duration as number, quality };
  }
  if (modelType === "seedance" && [5, 10].includes(duration as number) && (quality === "standard" || quality === "hd")) {
    return { modelType, durationSeconds: duration as number, quality };
  }
  if (modelType === "happyhorse" && [5, 12].includes(duration as number) && quality === "standard") {
    return { modelType, durationSeconds: duration as number, quality };
  }
  if (modelType === "veo" && duration === 8 && (quality === "standard" || quality === "4k")) {
    return { modelType, durationSeconds: 8, quality: "standard" };
  }
  if (modelType === "grok" && [10, 15].includes(duration as number) && quality === "standard") {
    return { modelType, durationSeconds: duration as number, quality };
  }
  if (modelType === "omni" && duration === 10 && quality === "standard") {
    return { modelType, durationSeconds: 10, quality };
  }
  return null;
}

function getQuickGenVideoModelType(modelName: string): VideoModelId {
  if (modelName.startsWith("seedance")) return "seedance";
  if (modelName.startsWith("happyhorse")) return "happyhorse";
  if (modelName === "sora2-pro-12s-hd") return "sora2-pro";
  if (modelName === "sora2-12s") return "sora2";
  if (modelName.includes("grok")) return "grok";
  if (modelName.includes("veo")) return "veo";
  if (modelName.includes("omni")) return "omni";
  throw new RangeError(`Unsupported Quick Gen video model ${modelName}`);
}

export function resolveQuickGenVideoTaskSelection(
  input: UntrustedQuickGenVideoSelection
): ResolvedQuickGenVideoSelection {
  if (!isVideoModelPricingKey(input.model)) {
    throw new RangeError(
      `Saved Quick Gen video configuration “${String(input.model)}” is no longer supported. Open Quick Gen, review the model, and create a new task.`
    );
  }

  const pricing = QUICK_GEN_VIDEO_PRICING[input.model];
  if (
    input.apiModel !== pricing.apiModel
    || input.duration !== pricing.apiDuration
    || input.quality !== pricing.quality
  ) {
    throw new RangeError(
      `Saved Quick Gen video configuration “${input.model}” does not match its supported model, duration, or quality. Review the configuration and create a new task.`
    );
  }

  const hasReference = typeof input.sourceImageUrl === "string" && input.sourceImageUrl.length > 0;
  const contract = parseUntrustedVideoModelContract({
    modelType: getQuickGenVideoModelType(input.model),
    durationSeconds: input.duration,
    quality: input.quality,
    aspectRatio: input.aspectRatio,
    mode: hasReference ? "image_to_video" : "prompt_to_video",
    referenceImageCount: hasReference ? 1 : 0,
  });
  if (!contract.ok) {
    throw new RangeError(
      `Saved Quick Gen video configuration “${input.model}” is invalid (${contract.error.field}): ${contract.error.message}. Review the configuration and create a new task.`
    );
  }

  return {
    modelType: contract.value.modelType,
    durationSeconds: contract.value.durationSeconds,
    quality: contract.value.quality,
    creditCost: pricing.credits,
    apiModel: pricing.apiModel,
  };
}

/**
 * Resolve only the immutable metadata needed to poll an already-paid task.
 * This deliberately accepts a closed set of historical names that new submit
 * validation must continue to reject.
 */
export function resolveQuickGenVideoStatusSelection(
  input: UntrustedVideoStatusSelection
): ResolvedVideoStatusSelection {
  if (input.model !== undefined && input.modelType !== undefined && input.model !== input.modelType) {
    throw new RangeError("Saved video status configuration has conflicting model names");
  }
  const rawModel = input.model === undefined ? input.modelType : input.model;
  if (typeof rawModel !== "string") {
    throw new RangeError("Saved video status configuration requires a known model name");
  }

  const historical = Object.prototype.hasOwnProperty.call(HISTORICAL_STATUS_MODELS, rawModel)
    ? HISTORICAL_STATUS_MODELS[rawModel]
    : undefined;
  if (historical) {
    const acceptedQualities = historical.acceptedQualities || [historical.quality];
    if (input.duration !== historical.durationSeconds || !acceptedQualities.includes(input.quality)) {
      throw new RangeError(
        `Saved video status configuration ${rawModel} does not match its historical duration or quality`
      );
    }
    return {
      modelType: historical.modelType,
      durationSeconds: historical.durationSeconds,
      quality: historical.quality,
    };
  }

  const canonical = getCanonicalStatusConfig(rawModel, input.duration, input.quality);
  if (canonical) {
    return {
      modelType: canonical.modelType,
      durationSeconds: canonical.durationSeconds,
      quality: canonical.quality,
    };
  }

  throw new RangeError(`Unsupported saved video status model ${rawModel}`);
}

/** Pure rehydrate decision: paid tasks poll; only never-submitted tasks may be resubmitted. */
export function resolvePersistedVideoTaskRecovery(input: {
  upstreamTaskId?: unknown;
  modelType?: unknown;
  duration?: unknown;
  quality?: unknown;
  aspectRatio?: unknown;
}): PersistedVideoTaskRecoveryResult {
  if (
    input.upstreamTaskId !== undefined
    && input.upstreamTaskId !== null
    && typeof input.upstreamTaskId !== "string"
  ) {
    return {
      ok: false,
      error: {
        field: "upstreamTaskId",
        message: "Saved upstream video task ID must be a string",
      },
    };
  }

  if (typeof input.upstreamTaskId === "string" && input.upstreamTaskId.trim().length > 0) {
    try {
      return {
        ok: true,
        mode: "status",
        value: resolveQuickGenVideoStatusSelection({
          modelType: input.modelType,
          duration: input.duration,
          quality: input.quality,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          field: "modelType",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  const selection = validatePersistedVideoSelection(input);
  if (!selection.ok) {
    return {
      ok: false,
      error: {
        field: selection.error.field as "modelType" | "durationSeconds" | "quality" | "aspectRatio",
        message: selection.error.message,
      },
    };
  }
  return { ok: true, mode: "submit" };
}

export function preflightBatchVideoSubmission(
  input: RawUntrustedVideoModelContractInput
): VideoModelContractResult {
  return parseUntrustedVideoModelContract(input);
}
