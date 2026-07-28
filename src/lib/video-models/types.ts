import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export const VIDEO_MODEL_IDS = [
  "sora2",
  "sora2-pro",
  "grok",
  "veo",
  "omni",
  "seedance",
  "happyhorse",
] as const;

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number];
export type VideoAspectRatio = "9:16" | "16:9";
export type UnifiedVideoStatus = "processing" | "completed" | "failed";
export type VideoQuality = "standard" | "hd";
export type VideoDurationSeconds = 5 | 8 | 10 | 12 | 15;
export type VideoGenerationMode = "image_to_video" | "prompt_to_video";
export type VideoReferenceRole = "generic" | "first_frame" | "last_frame";
export type VideoNativeAudioCapability = "always" | "unknown";

export interface VideoModelCatalogEntry {
  id: VideoModelId;
  label: string;
  provider: "video-platform" | "volcengine" | "dashscope";
  durationSeconds: VideoDurationSeconds;
  qualityLabel: string;
  resolution: string;
  supportedDurations: readonly [VideoDurationSeconds, ...VideoDurationSeconds[]];
  supportedQualities: readonly [VideoQuality, ...VideoQuality[]];
  supportedAspectRatios: readonly [VideoAspectRatio, ...VideoAspectRatio[]];
  supportedModes: readonly [VideoGenerationMode, ...VideoGenerationMode[]];
  referenceRoles: readonly [VideoReferenceRole, ...VideoReferenceRole[]];
  nativeAudio: VideoNativeAudioCapability;
  supportsCancel: boolean;
  maxImages: number;
  supportsNoImage: boolean;
  requiresOssTransfer: boolean;
  pollIntervalMs: number;
  maxPollMs: number;
  creditCostPlaceholder: number;
  healthProvider: string;
}

export interface VideoModelSubmitInput {
  modelType: VideoModelId;
  prompt: string;
  aspectRatio: VideoAspectRatio;
  imageUrls: string[];
  clientTaskId: string;
  groupName: string;
  userId: string;
  durationSeconds?: VideoDurationSeconds;
  quality?: VideoQuality;
  mode?: VideoGenerationMode;
}

export interface VideoModelStatusInput {
  modelType: VideoModelId;
  taskId: string;
  userId?: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  quality?: VideoQuality;
}

export interface VideoModelCompleteInput extends VideoModelStatusInput {
  status: VideoModelStatusResult;
  generationUserId?: string;
}

export interface VideoModelSubmitResult {
  taskId: string;
  status: "processing";
  upstreamModel: string;
  metadata?: Json;
}

export interface VideoModelStatusResult {
  taskId: string;
  status: UnifiedVideoStatus;
  progress?: number;
  videoUrl?: string;
  errorMessage?: string;
  upstreamModel?: string;
  contentUrl?: string;
  contentHeaders?: Record<string, string>;
  metadata?: Json;
}

export interface VideoModelCompleteResult {
  videoUrl: string;
  metadata?: Json;
}

export interface VideoModelAdapter {
  submit(input: VideoModelSubmitInput): Promise<VideoModelSubmitResult>;
  status(input: VideoModelStatusInput): Promise<VideoModelStatusResult>;
  complete?(input: VideoModelCompleteInput): Promise<VideoModelCompleteResult>;
}

export interface RegisteredVideoModel extends VideoModelCatalogEntry {
  adapter: VideoModelAdapter;
}

export type AdminSupabaseClient = SupabaseClient<Database>;
