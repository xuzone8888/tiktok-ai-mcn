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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
    supportedAspectRatios: ["9:16", "16:9"],
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
  if (modelType === "seedance") {
    const duration = durationSeconds === 10 ? 10 : 5;
    if (quality === "hd") return duration === 10 ? 994 : 497;
    return duration === 10 ? 466 : 233;
  }

  if (modelType === "happyhorse") {
    return durationSeconds === 12 ? 1080 : 450;
  }

  return VIDEO_MODEL_CATALOG[modelType].creditCostPlaceholder;
}

export function getVideoModelImageLimit(modelType: VideoModelId): number {
  return VIDEO_MODEL_CATALOG[modelType].maxImages;
}
