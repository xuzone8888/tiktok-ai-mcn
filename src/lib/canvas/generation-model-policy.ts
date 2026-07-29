import { isVideoModelId } from "../video-models/catalog";
import type { VideoModelId } from "../video-models/types";

export const DEFAULT_CANVAS_VIDEO_MODELS = ["grok"] as const;

export class CanvasVideoModelPolicyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasVideoModelPolicyConfigurationError";
  }
}

/**
 * Server-only product allowlist. An unset variable intentionally exposes only
 * the production-default Grok lane; an explicitly present but malformed value
 * fails closed instead of silently broadening access.
 */
export function parseCanvasVideoModelAllowlist(
  rawValue: string | undefined
): readonly VideoModelId[] {
  if (rawValue === undefined) return DEFAULT_CANVAS_VIDEO_MODELS;
  if (rawValue.trim().length === 0) {
    throw new CanvasVideoModelPolicyConfigurationError(
      "CANVAS_VIDEO_MODELS must not be empty"
    );
  }

  const values = rawValue.split(",").map((value) => value.trim());
  if (values.some((value) => value.length === 0)) {
    throw new CanvasVideoModelPolicyConfigurationError(
      "CANVAS_VIDEO_MODELS contains an empty item"
    );
  }
  if (new Set(values).size !== values.length) {
    throw new CanvasVideoModelPolicyConfigurationError(
      "CANVAS_VIDEO_MODELS contains a duplicate item"
    );
  }
  if (values.some((value) => !isVideoModelId(value))) {
    throw new CanvasVideoModelPolicyConfigurationError(
      "CANVAS_VIDEO_MODELS contains an unknown model"
    );
  }
  return values as VideoModelId[];
}

export function isCanvasVideoModelEnabled(
  model: VideoModelId,
  rawValue: string | undefined = process.env.CANVAS_VIDEO_MODELS
): boolean {
  return parseCanvasVideoModelAllowlist(rawValue).includes(model);
}
