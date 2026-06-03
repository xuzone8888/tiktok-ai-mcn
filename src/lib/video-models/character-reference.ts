import { getVideoModelImageLimit, isVideoModelId } from "./catalog";
import type { VideoModelId } from "./types";

export type CharacterReferenceMode = "reference_image" | "trigger_word" | "none";

interface CharacterReferenceCapability {
  mode: CharacterReferenceMode;
  maxImages: number;
}

const CHARACTER_REFERENCE_MATRIX: Partial<Record<VideoModelId, CharacterReferenceCapability>> = {
  veo: { mode: "reference_image", maxImages: 3 },
  grok: { mode: "reference_image", maxImages: 4 },
  omni: { mode: "reference_image", maxImages: 7 },
  happyhorse: { mode: "reference_image", maxImages: 9 },
  sora2: { mode: "trigger_word", maxImages: 1 },
  "sora2-pro": { mode: "trigger_word", maxImages: 1 },
  seedance: { mode: "none", maxImages: 1 },
};

function resolveModelId(modelType: string): VideoModelId | null {
  return isVideoModelId(modelType) ? modelType : null;
}

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  return trimmed;
}

export function getCharacterReferenceMode(modelType: string): CharacterReferenceMode {
  const modelId = resolveModelId(modelType);
  if (!modelId) return "none";
  return CHARACTER_REFERENCE_MATRIX[modelId]?.mode || "none";
}

export function supportsCharacterReferenceImage(modelType: string): boolean {
  return getCharacterReferenceMode(modelType) === "reference_image";
}

export function getCharacterReferenceMaxImages(modelType: string): number {
  const modelId = resolveModelId(modelType);
  if (!modelId) return 1;
  return CHARACTER_REFERENCE_MATRIX[modelId]?.maxImages || getVideoModelImageLimit(modelId);
}

export function mergeCharacterReferenceImages(
  modelType: string,
  characterRefUrl: string | null | undefined,
  uploadedImageUrls: Array<string | null | undefined>
): string[] {
  const modelId = resolveModelId(modelType);
  const limit = modelId ? getVideoModelImageLimit(modelId) : 1;
  const candidates = [
    ...(supportsCharacterReferenceImage(modelType) ? [characterRefUrl] : []),
    ...uploadedImageUrls,
  ];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
    if (normalized.length >= limit) break;
  }

  return normalized;
}
