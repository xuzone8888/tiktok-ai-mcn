import {
  VIDEO_MODEL_IDS,
  type VideoAspectRatio,
  type VideoModelCatalogEntry,
  type VideoModelId,
  type VideoQuality,
} from "./types";

export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = "9:16";

export const VIDEO_MODEL_CATALOG: Record<VideoModelId, VideoModelCatalogEntry> = {
  "sora2": {
    id: "sora2",
    label: "Sora2",
    provider: "video-platform",
    durationSeconds: 12,
    qualityLabel: "12s standard",
    resolution: "adaptive",
    supportedDurations: [12],
    supportedQualities: ["standard"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "always",
    supportsCancel: false,
    maxImages: 1,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 30_000,
    maxPollMs: 12 * 60_000,
    creditCostPlaceholder: 20,
    healthProvider: "video-platform-sora",
  },
  "sora2-pro": {
    id: "sora2-pro",
    label: "Sora2 Pro",
    provider: "video-platform",
    durationSeconds: 12,
    qualityLabel: "12s Pro",
    resolution: "adaptive",
    supportedDurations: [12],
    supportedQualities: ["hd"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "always",
    supportsCancel: false,
    maxImages: 1,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 45_000,
    maxPollMs: 35 * 60_000,
    creditCostPlaceholder: 350,
    healthProvider: "video-platform-sora-pro",
  },
  grok: {
    id: "grok",
    label: "Grok",
    provider: "video-platform",
    durationSeconds: 10,
    qualityLabel: "10s 720P",
    resolution: "720P",
    supportedDurations: [10, 15],
    supportedQualities: ["standard"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "unknown",
    supportsCancel: false,
    maxImages: 4,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 30_000,
    maxPollMs: 12 * 60_000,
    creditCostPlaceholder: 5,
    healthProvider: "video-platform-grok",
  },
  veo: {
    id: "veo",
    label: "VEO",
    provider: "video-platform",
    durationSeconds: 8,
    qualityLabel: "8s 1080P",
    resolution: "1080P",
    supportedDurations: [8],
    supportedQualities: ["standard"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "unknown",
    supportsCancel: false,
    maxImages: 3,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 30_000,
    maxPollMs: 15 * 60_000,
    creditCostPlaceholder: 50,
    healthProvider: "video-platform-veo",
  },
  omni: {
    id: "omni",
    label: "Omni",
    provider: "video-platform",
    durationSeconds: 10,
    qualityLabel: "10s 720P",
    resolution: "720P",
    supportedDurations: [10],
    supportedQualities: ["standard"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "unknown",
    supportsCancel: false,
    maxImages: 7,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 30_000,
    maxPollMs: 15 * 60_000,
    creditCostPlaceholder: 50,
    healthProvider: "video-platform-omni",
  },
  seedance: {
    id: "seedance",
    label: "Seedance",
    provider: "volcengine",
    durationSeconds: 5,
    qualityLabel: "5/10s existing capability",
    resolution: "1080P / Pro 720P",
    supportedDurations: [5, 10],
    supportedQualities: ["standard", "hd"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "always",
    supportsCancel: false,
    maxImages: 1,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 5_000,
    maxPollMs: 5 * 60_000,
    creditCostPlaceholder: 233,
    healthProvider: "volcengine-seedance",
  },
  happyhorse: {
    id: "happyhorse",
    label: "HappyHorse",
    provider: "dashscope",
    durationSeconds: 5,
    qualityLabel: "5/12s 720P",
    resolution: "720P",
    supportedDurations: [5, 12],
    supportedQualities: ["standard"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedModes: ["prompt_to_video", "image_to_video"],
    referenceRoles: ["generic"],
    nativeAudio: "unknown",
    supportsCancel: false,
    maxImages: 9,
    supportsNoImage: true,
    requiresOssTransfer: true,
    pollIntervalMs: 15_000,
    maxPollMs: 18 * 60_000,
    creditCostPlaceholder: 450,
    healthProvider: "dashscope-happyhorse",
  },
};

export const VIDEO_MODEL_OPTIONS = VIDEO_MODEL_IDS.map((id) => VIDEO_MODEL_CATALOG[id]);

export function isVideoModelId(value: string): value is VideoModelId {
  return (VIDEO_MODEL_IDS as readonly string[]).includes(value);
}

export function getVideoModelCatalogEntry(modelType: VideoModelId): VideoModelCatalogEntry {
  return VIDEO_MODEL_CATALOG[modelType];
}

export function getDefaultDurationForVideoModel(modelType: VideoModelId): number {
  return VIDEO_MODEL_CATALOG[modelType].durationSeconds;
}

export function getVideoModelCreditCost(
  modelType: VideoModelId,
  durationSeconds?: number,
  quality?: VideoQuality
): number {
  const entry = VIDEO_MODEL_CATALOG[modelType];
  const duration = durationSeconds === undefined ? entry.durationSeconds : durationSeconds;
  const resolvedQuality = quality === undefined ? entry.supportedQualities[0] : quality;

  if (!Number.isFinite(duration) || !Number.isInteger(duration) || !entry.supportedDurations.some((value) => value === duration)) {
    throw new RangeError(`${entry.label} does not support duration ${String(durationSeconds)}`);
  }
  if (!entry.supportedQualities.includes(resolvedQuality)) {
    throw new RangeError(`${entry.label} does not support quality ${String(quality)}`);
  }

  if (modelType === "seedance") {
    if (resolvedQuality === "hd") return duration === 10 ? 994 : 497;
    return duration === 10 ? 466 : 233;
  }

  if (modelType === "happyhorse") {
    return duration === 12 ? 1080 : 450;
  }

  if (modelType === "grok") return duration === 15 ? 8 : 5;

  return entry.creditCostPlaceholder;
}

export function getVideoModelImageLimit(modelType: VideoModelId): number {
  return VIDEO_MODEL_CATALOG[modelType].maxImages;
}
