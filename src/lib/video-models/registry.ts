import { VIDEO_MODEL_CATALOG } from "./catalog";
import type { RegisteredVideoModel, VideoModelId } from "./types";
import { soraAdapter } from "./adapters/sora";
import { grokAdapter } from "./adapters/grok";
import { veoAdapter } from "./adapters/veo";
import { omniAdapter } from "./adapters/omni";
import { seedanceAdapter } from "./adapters/seedance";
import { happyHorseAdapter } from "./adapters/happyhorse";

export const VideoModelRegistry: Record<VideoModelId, RegisteredVideoModel> = {
  sora2: {
    ...VIDEO_MODEL_CATALOG.sora2,
    adapter: soraAdapter,
  },
  "sora2-pro": {
    ...VIDEO_MODEL_CATALOG["sora2-pro"],
    adapter: soraAdapter,
  },
  grok: {
    ...VIDEO_MODEL_CATALOG.grok,
    adapter: grokAdapter,
  },
  veo: {
    ...VIDEO_MODEL_CATALOG.veo,
    adapter: veoAdapter,
  },
  omni: {
    ...VIDEO_MODEL_CATALOG.omni,
    adapter: omniAdapter,
  },
  seedance: {
    ...VIDEO_MODEL_CATALOG.seedance,
    adapter: seedanceAdapter,
  },
  happyhorse: {
    ...VIDEO_MODEL_CATALOG.happyhorse,
    adapter: happyHorseAdapter,
  },
};

export function getRegisteredVideoModel(modelType: VideoModelId): RegisteredVideoModel {
  return VideoModelRegistry[modelType];
}
