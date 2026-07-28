import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  getVideoModelCatalogEntry,
  isVideoModelId,
} from "./catalog";
import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoGenerationMode,
  VideoModelId,
  VideoQuality,
} from "./types";

export type VideoModelContractField =
  | "modelType"
  | "durationSeconds"
  | "quality"
  | "aspectRatio"
  | "mode"
  | "referenceImageCount";

export type VideoModelContractErrorCode =
  | "INVALID_TYPE"
  | "INVALID_NUMBER"
  | "UNSUPPORTED_VALUE"
  | "REFERENCE_REQUIRED"
  | "TOO_MANY_REFERENCES";

export interface RawVideoModelContractInput {
  durationSeconds?: unknown;
  quality?: unknown;
  aspectRatio?: unknown;
  mode?: unknown;
  referenceImageCount?: unknown;
}

export interface RawUntrustedVideoModelContractInput extends RawVideoModelContractInput {
  modelType?: unknown;
}

export interface RawPersistedVideoSelection {
  modelType?: unknown;
  duration?: unknown;
  quality?: unknown;
  aspectRatio?: unknown;
}

export interface PersistedVideoSelection {
  modelType: VideoModelId;
  duration: VideoDurationSeconds;
  quality: VideoQuality;
  aspectRatio: VideoAspectRatio;
}

export interface NormalizedPersistedVideoSelection {
  value: PersistedVideoSelection;
  changed: boolean;
}

export interface ValidatedVideoModelContract {
  modelType: VideoModelId;
  durationSeconds: VideoDurationSeconds;
  quality: VideoQuality;
  aspectRatio: VideoAspectRatio;
  mode: VideoGenerationMode;
  referenceImageCount: number;
}

export type VideoModelContractResult =
  | { ok: true; value: ValidatedVideoModelContract }
  | {
      ok: false;
      error: {
        field: VideoModelContractField;
        code: VideoModelContractErrorCode;
        message: string;
      };
    };

export type LegacyVideoModelSelectionResult =
  | {
      ok: true;
      value: {
        modelType: VideoModelId;
        qualityInput: unknown;
      };
    }
  | {
      ok: false;
      error: {
        field: "modelType" | "quality";
        code: "INVALID_TYPE" | "UNSUPPORTED_VALUE";
        message: string;
      };
    };

/** Resolve supported legacy model aliases without coercing invalid selections. */
export function resolveLegacyVideoModelSelection(
  rawModelType: unknown,
  rawQuality: unknown
): LegacyVideoModelSelectionResult {
  if (typeof rawModelType !== "string") {
    return {
      ok: false,
      error: {
        field: "modelType",
        code: "INVALID_TYPE",
        message: "modelType must be a string",
      },
    };
  }

  if (rawModelType === "veo3-4k") {
    return {
      ok: false,
      error: {
        field: "modelType",
        code: "UNSUPPORTED_VALUE",
        message: "veo3-4k is not supported",
      },
    };
  }

  if (rawModelType === "veo3-fast" || rawModelType === "veo3-std") {
    return {
      ok: true,
      value: { modelType: "veo", qualityInput: rawQuality },
    };
  }

  if (rawModelType === "seedance-pro") {
    if (rawQuality === undefined || rawQuality === "hd") {
      return {
        ok: true,
        value: { modelType: "seedance", qualityInput: "hd" },
      };
    }
    return {
      ok: false,
      error: {
        field: "quality",
        code: typeof rawQuality === "string" ? "UNSUPPORTED_VALUE" : "INVALID_TYPE",
        message: "seedance-pro requires quality hd",
      },
    };
  }

  if (isVideoModelId(rawModelType)) {
    return {
      ok: true,
      value: { modelType: rawModelType, qualityInput: rawQuality },
    };
  }

  return {
    ok: false,
    error: {
      field: "modelType",
      code: "UNSUPPORTED_VALUE",
      message: `Unsupported video model ${rawModelType}`,
    },
  };
}

function failure(
  field: VideoModelContractField,
  code: VideoModelContractErrorCode,
  message: string
): VideoModelContractResult {
  return { ok: false, error: { field, code, message } };
}

/** Normalize only persisted global UI settings to catalog-backed defaults. */
export function normalizePersistedVideoGlobalSelection(
  input: RawPersistedVideoSelection
): NormalizedPersistedVideoSelection {
  const modelType = typeof input.modelType === "string" && isVideoModelId(input.modelType)
    ? input.modelType
    : "sora2";
  const capability = getVideoModelCatalogEntry(modelType);
  const duration = capability.supportedDurations.find(
    (candidate) => candidate === input.duration
  ) ?? capability.durationSeconds;
  const quality = capability.supportedQualities.find(
    (candidate) => candidate === input.quality
  ) ?? capability.supportedQualities[0];
  const aspectRatio = capability.supportedAspectRatios.find(
    (candidate) => candidate === input.aspectRatio
  ) ?? (
    capability.supportedAspectRatios.includes(DEFAULT_VIDEO_ASPECT_RATIO)
      ? DEFAULT_VIDEO_ASPECT_RATIO
      : capability.supportedAspectRatios[0]
  );

  return {
    value: { modelType, duration, quality, aspectRatio },
    changed: input.modelType !== modelType
      || input.duration !== duration
      || input.quality !== quality
      || input.aspectRatio !== aspectRatio,
  };
}

/** Strictly validate an untrusted canonical model selection and generation contract. */
export function parseUntrustedVideoModelContract(
  input: RawUntrustedVideoModelContractInput
): VideoModelContractResult {
  if (typeof input.modelType !== "string") {
    return failure("modelType", "INVALID_TYPE", "modelType must be a string");
  }
  if (!isVideoModelId(input.modelType)) {
    return failure(
      "modelType",
      "UNSUPPORTED_VALUE",
      `Unsupported video model ${input.modelType}`
    );
  }
  return parseVideoModelContract(input.modelType, input);
}

/** Strictly validate the four persisted task-selection fields without normalizing them. */
export function validatePersistedVideoSelection(
  input: RawPersistedVideoSelection
): VideoModelContractResult {
  return parseUntrustedVideoModelContract({
    modelType: input.modelType,
    durationSeconds: input.duration,
    quality: input.quality,
    aspectRatio: input.aspectRatio,
    mode: "prompt_to_video",
    referenceImageCount: 0,
  });
}

/**
 * Parse the untrusted, model-dependent request surface against the production catalog.
 * Defaults are applied only when a field is absent (`undefined`); every explicit value
 * is checked without coercion or fallback.
 */
export function parseVideoModelContract(
  modelType: VideoModelId,
  input: RawVideoModelContractInput
): VideoModelContractResult {
  const capability = getVideoModelCatalogEntry(modelType);

  const rawDuration = input.durationSeconds === undefined
    ? capability.durationSeconds
    : input.durationSeconds;
  if (typeof rawDuration !== "number") {
    return failure("durationSeconds", "INVALID_TYPE", "durationSeconds must be a number");
  }
  if (!Number.isFinite(rawDuration) || !Number.isInteger(rawDuration)) {
    return failure("durationSeconds", "INVALID_NUMBER", "durationSeconds must be a finite integer");
  }
  const durationSeconds = capability.supportedDurations.find(
    (duration) => duration === rawDuration
  );
  if (durationSeconds === undefined) {
    return failure(
      "durationSeconds",
      "UNSUPPORTED_VALUE",
      `${capability.label} does not support duration ${rawDuration}`
    );
  }
  const rawQuality = input.quality === undefined
    ? capability.supportedQualities[0]
    : input.quality;
  if (typeof rawQuality !== "string") {
    return failure("quality", "INVALID_TYPE", "quality must be a string");
  }
  const quality = capability.supportedQualities.find(
    (candidate) => candidate === rawQuality
  );
  if (quality === undefined) {
    return failure(
      "quality",
      "UNSUPPORTED_VALUE",
      `${capability.label} does not support quality ${rawQuality}`
    );
  }
  const rawAspectRatio = input.aspectRatio === undefined
    ? DEFAULT_VIDEO_ASPECT_RATIO
    : input.aspectRatio;
  if (typeof rawAspectRatio !== "string") {
    return failure("aspectRatio", "INVALID_TYPE", "aspectRatio must be a string");
  }
  const aspectRatio = capability.supportedAspectRatios.find(
    (candidate) => candidate === rawAspectRatio
  );
  if (aspectRatio === undefined) {
    return failure(
      "aspectRatio",
      "UNSUPPORTED_VALUE",
      `${capability.label} does not support aspect ratio ${rawAspectRatio}`
    );
  }
  const rawReferenceCount = input.referenceImageCount === undefined
    ? 0
    : input.referenceImageCount;
  if (typeof rawReferenceCount !== "number") {
    return failure("referenceImageCount", "INVALID_TYPE", "referenceImageCount must be a number");
  }
  if (!Number.isFinite(rawReferenceCount) || !Number.isInteger(rawReferenceCount) || rawReferenceCount < 0) {
    return failure(
      "referenceImageCount",
      "INVALID_NUMBER",
      "referenceImageCount must be a non-negative finite integer"
    );
  }
  if (rawReferenceCount > capability.maxImages) {
    return failure(
      "referenceImageCount",
      "TOO_MANY_REFERENCES",
      `${capability.label} supports at most ${capability.maxImages} reference images`
    );
  }

  const rawMode = input.mode === undefined
    ? (rawReferenceCount > 0 ? "image_to_video" : "prompt_to_video")
    : input.mode;
  if (typeof rawMode !== "string") {
    return failure("mode", "INVALID_TYPE", "mode must be a string");
  }
  const mode = capability.supportedModes.find((candidate) => candidate === rawMode);
  if (mode === undefined) {
    return failure(
      "mode",
      "UNSUPPORTED_VALUE",
      `${capability.label} does not support mode ${rawMode}`
    );
  }
  if (rawMode === "image_to_video" && rawReferenceCount === 0) {
    return failure(
      "referenceImageCount",
      "REFERENCE_REQUIRED",
      "image_to_video requires at least one reference image"
    );
  }
  return {
    ok: true,
    value: {
      modelType,
      durationSeconds,
      quality,
      aspectRatio,
      mode,
      referenceImageCount: rawReferenceCount,
    },
  };
}
