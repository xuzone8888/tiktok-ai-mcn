/**
 * Video Batch Types - 批量视频生产单元类型定义
 */

import type { CharacterAssetSnapshot } from "@/lib/character-assets";
import {
  getVideoModelCatalogEntry,
  getVideoModelCreditCost,
} from "@/lib/video-models/catalog";
import type {
  VideoAspectRatio as SharedVideoAspectRatio,
  VideoDurationSeconds,
  VideoModelId,
  VideoQuality as SharedVideoQuality,
} from "@/lib/video-models/types";

// ============================================================================
// 基础类型
// ============================================================================

/** 视频任务状态 */
export type VideoBatchTaskStatus =
  | "pending"           // 待处理
  | "uploading"         // 上传中
  | "generating_script" // 生成口播脚本中 (豆包 Step 1)
  | "generating_prompt" // 生成AI提示词中 (豆包 Step 2)
  | "generating_video"  // 生成视频中 (Sora2 Pro)
  | "success"           // 成功
  | "failed";           // 失败

/** 视频比例 */
export type VideoAspectRatio = SharedVideoAspectRatio;

/** 视频时长 */
export type VideoDuration = VideoDurationSeconds;

/** 视频质量 */
export type VideoQuality = SharedVideoQuality;

/** 视频模型类型 */
export type VideoModelType = VideoModelId;

/** 流水线步骤 */
export type PipelineStep = 0 | 1 | 2 | 3 | 4;

/** 视频模型配置 */
export interface VideoModelConfig {
  type: VideoModelType;
  duration: VideoDuration;
  quality: VideoQuality;
  aspectRatio: VideoAspectRatio;
}

/** 获取可用的时长选项 */
export function getAvailableDurations(modelType: VideoModelType, quality: VideoQuality): VideoDuration[] {
  void quality;
  return Array.from(getVideoModelCatalogEntry(modelType).supportedDurations);
}

/** 获取可用的质量选项 */
export function getAvailableQualities(modelType: VideoModelType): VideoQuality[] {
  return Array.from(getVideoModelCatalogEntry(modelType).supportedQualities);
}

// ============================================================================
// 图片信息
// ============================================================================

/** 任务中的图片信息 */
export interface TaskImageInfo {
  id: string;
  url: string;
  name: string;
  isMainGrid: boolean;  // 是否为第一张高清九宫格图
  order: number;        // 排序顺序
  file?: File;          // 原始文件（上传前）
}

// ============================================================================
// 视频任务
// ============================================================================

/** 视频批量任务模式 */
export type VideoBatchTaskMode = "image_to_video" | "prompt_to_video";

/** 视频批量任务 */
export interface VideoBatchTask {
  id: string;
  images: TaskImageInfo[];
  aspectRatio: VideoAspectRatio;

  // 任务组名称（必填，用于Tab切换和批量管理）
  groupName: string;

  // Studio 批次 ID（S1：随提交透传，落 generations.batch_id）
  batchId?: string;

  // 任务模式
  mode?: VideoBatchTaskMode;  // 默认 "image_to_video"

  // 纯提示词模式的自定义提示词
  customPrompt?: string;      // 用户输入的提示词
  referenceImageUrl?: string; // 可选的参考图片
  referenceImageUrls?: string[]; // HappyHorse R2V 参考图组

  // AI 模特配置（任务创建时保存, Sora2 用）
  useAiModel?: boolean;       // 是否使用 AI 模特
  aiModelId?: string;         // AI 模特 ID（不暴露给用户）
  aiModelName?: string;       // AI 模特显示名称（用户可见）
  aiModelTriggerWord?: string;// AI 模特触发词（任务创建时冻结）
  aiModelCover?: string | null;// AI 模特封面图URL（任务创建时冻结）
  // Veo3 自建角色配置（任务创建时保存）
  characterId?: string;
  characterName?: string;
  characterRefUrl?: string;   // 自建角色参考图 URL
  characterReferenceImages?: string[];
  characterAsset?: CharacterAssetSnapshot;
  // VEO 首尾帧兼容字段（统一模型会作为可选参考图处理）
  firstFrameUrl?: string;     // 首帧图片 URL（已上传 OSS）
  lastFrameUrl?: string;      // 尾帧图片 URL（已上传 OSS，可选）

  modelType: VideoModelType;
  duration: VideoDuration;
  quality: VideoQuality;
  // apiLine 已移除 (2026-03-20), Sora 固定走 line3

  // 豆包 AI 生成结果
  doubaoTalkingScript: string | null;   // 步骤1: 口播脚本 (C01-C07)
  doubaoAiVideoPrompt: string | null;   // 步骤2: AI视频提示词

  // Sora2 Pro 生成结果
  soraTaskId: string | null;
  soraVideoUrl: string | null;

  // 状态
  status: VideoBatchTaskStatus;
  currentStep: PipelineStep;  // 0-4 表示当前步骤
  progress: number;           // 0-100
  errorMessage: string | null;

  // 时间戳
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 全局设置
// ============================================================================

/** 批量视频生产全局设置 */
export interface VideoBatchGlobalSettings {
  aspectRatio: VideoAspectRatio;
  modelType: VideoModelType;
  duration: VideoDuration;
  quality: VideoQuality;
  language: "en" | "zh";
  autoStart: boolean;
  // AI 模特配置 (Sora2 签约模特)
  useAiModel: boolean;
  aiModelId: string | null;
  aiModelName: string | null;        // 显示名称（用户可见）
  aiModelTriggerWord: string | null; // 触发词（后台使用，不暴露给用户）
  aiModelCover: string | null;       // AI 模特封面图URL
  // Veo3 自建角色配置
  characterId: string | null;        // 自建角色 ID
  characterName: string | null;      // 自建角色名称
  characterRefUrl: string | null;    // 自建角色参考图 URL
  characterReferenceImages?: string[];
  characterAsset?: CharacterAssetSnapshot | null;
  // API 线路已移除 (2026-03-20), Sora 固定走 line3
}

// ============================================================================
// 流水线步骤配置
// ============================================================================

export interface PipelineStepConfig {
  step: PipelineStep;
  label: string;
  description: string;
  icon: string;
}

export const PIPELINE_STEPS: PipelineStepConfig[] = [
  { step: 0, label: "素材上传", description: "上传产品图片", icon: "📷" },
  { step: 1, label: "生成脚本", description: "豆包AI生成口播脚本", icon: "📝" },
  { step: 2, label: "生成提示词", description: "豆包AI生成分镜提示词", icon: "🎬" },
  { step: 3, label: "生成视频", description: "Sora2生成视频", icon: "🎥" },
  { step: 4, label: "完成", description: "视频生成完成", icon: "✅" },
];

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 生成口播脚本请求 */
export interface GenerateTalkingScriptRequest {
  images: string[];  // 图片URL列表
  taskId: string;
  language?: "en" | "zh";
}

/** 生成口播脚本响应 */
export interface GenerateTalkingScriptResponse {
  success: boolean;
  data?: {
    script: string;
    taskId: string;
  };
  error?: string;
}

/** 生成AI视频提示词请求 */
export interface GenerateAiVideoPromptRequest {
  talkingScript: string;
  taskId: string;
}

/** 生成AI视频提示词响应 */
export interface GenerateAiVideoPromptResponse {
  success: boolean;
  data?: {
    prompt: string;
    taskId: string;
  };
  error?: string;
}

/** 生成Sora视频请求 */
export interface GenerateSoraVideoRequest {
  aiVideoPrompt: string;
  mainGridImageUrl: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds?: number;  // 默认15
  taskId: string;
}

/** 生成Sora视频响应 */
export interface GenerateSoraVideoResponse {
  success: boolean;
  data?: {
    soraTaskId: string;
    status: "queued" | "running" | "success" | "failed";
    videoUrl?: string;
  };
  error?: string;
}

// ============================================================================
// 定价配置
// 批量生产视频扣分机制：
// 占位价格必须与服务端 VideoModelRegistry 保持一致；服务端为可信来源。
// ============================================================================

/** 视频生成定价 */
export const VIDEO_BATCH_PRICING = {
  doubaoScript: 0,      // 豆包生成脚本（包含在总价中）
  doubaoPrompt: 0,      // 豆包生成提示词（包含在总价中）
  sora2_12s: 20,
  sora2Pro_12s: 350,
  veo_8s: 50,
  grok_10s: 5,
  grok_15s: 8,
  omni_10s: 50,
  // Seedance 2.0 标准版 (480p→1080p超分)
  seedance_5s: 233,     // Seedance 2.0 5秒 高清1080P (¥2.33)
  seedance_10s: 466,    // Seedance 2.0 10秒 高清1080P (¥4.66)
  // Seedance 2.0 Pro (720p原生)
  seedancePro_5s: 497,  // Seedance 2.0 5秒 Pro 原生720P (¥4.97)
  seedancePro_10s: 994, // Seedance 2.0 10秒 Pro 原生720P (¥9.94)
  happyhorse_5s: 450,   // DashScope HappyHorse 1.0 T2V 5s 720P
  happyhorse_12s: 1080, // DashScope HappyHorse 1.0 T2V 12s 720P
};

/** 获取视频生成总价 */
export function getVideoBatchTotalPrice(
  modelType: VideoModelType,
  duration: VideoDuration,
  quality: VideoQuality
): number {
  return getVideoModelCreditCost(modelType, duration, quality);
}

// ============================================================================
// 工具函数
// ============================================================================

/** 获取状态显示文本 */
export function getStatusLabel(status: VideoBatchTaskStatus): string {
  const labels: Record<VideoBatchTaskStatus, string> = {
    pending: "待处理",
    uploading: "上传素材",
    generating_script: "生成脚本",
    generating_prompt: "生成提示词",
    generating_video: "生成视频",
    success: "已完成",
    failed: "失败",
  };
  return labels[status];
}

/** 获取步骤进度百分比 */
export function getStepProgress(step: PipelineStep): number {
  const progressMap: Record<PipelineStep, number> = {
    0: 0,
    1: 25,
    2: 50,
    3: 75,
    4: 100,
  };
  return progressMap[step];
}
