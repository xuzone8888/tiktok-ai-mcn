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
  sora2: { mode: "reference_image", maxImages: 1 },
  "sora2-pro": { mode: "reference_image", maxImages: 1 },
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

/** Collect every valid, unique reference so the server contract can reject overflow. */
export function collectCharacterReferenceImagesStrict(
  modelType: string,
  characterRefUrl: string | null | undefined,
  uploadedImageUrls: Array<string | null | undefined>
): string[] {
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
  }

  return normalized;
}

/** Legacy client merge keeps its historical model-specific truncation behavior. */
export function mergeCharacterReferenceImages(
  modelType: string,
  characterRefUrl: string | null | undefined,
  uploadedImageUrls: Array<string | null | undefined>
): string[] {
  const modelId = resolveModelId(modelType);
  const maxImages = modelId ? getVideoModelImageLimit(modelId) : 1;
  return collectCharacterReferenceImagesStrict(
    modelType,
    characterRefUrl,
    uploadedImageUrls
  ).slice(0, maxImages);
}
