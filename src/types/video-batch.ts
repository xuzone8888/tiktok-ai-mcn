/**
 * Video Batch Types - 批量视频生产单元类型定义
 */

// ============================================================================
// 基础类型
// ============================================================================

// ============================================================================
// API 线路配置
// ============================================================================

/** API 线路类型 */
export type ApiLineType = "line1" | "line2" | "line3";

/** API 线路配置详情 */
export interface ApiLineConfig {
  id: ApiLineType;
  name: string;
  description: string;
}

/** 可用的 API 线路 */
export const API_LINES: Record<ApiLineType, ApiLineConfig> = {
  line1: {
    id: "line1",
    name: "默认线路",
    description: "速创 API"
  },
  line2: {
    id: "line2",
    name: "备用线路",
    description: "望景API sora-2 (10/15秒)"
  },
  line3: {
    id: "line3",
    name: "备用线路2",
    description: "无印科技 sora2-new (10/15秒, ¥0.5/次)"
  },
} as const;

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
export type VideoAspectRatio = "9:16" | "16:9";

/** 视频时长 */
export type VideoDuration = 8 | 10 | 15 | 25;

/** 视频质量 */
export type VideoQuality = "standard" | "hd";

/** 视频模型类型 */
export type VideoModelType = "sora2" | "sora2-pro" | "veo3" | "veo3-quality";

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
  if (modelType === "sora2") {
    return [10, 15];
  } else if (modelType === "sora2-pro") {
    if (quality === "hd") {
      return [15]; // 高清只有 15 秒
    }
    return [25]; // Pro 标清只有 25 秒
  } else if (modelType === "veo3" || modelType === "veo3-quality") {
    return [8]; // VEO3 固定 8 秒
  }
  return [15]; // 默认
}

/** 获取可用的质量选项 */
export function getAvailableQualities(modelType: VideoModelType): VideoQuality[] {
  if (modelType === "sora2") {
    return ["standard"]; // 标清版只有标清
  } else if (modelType === "sora2-pro") {
    return ["standard", "hd"]; // Pro 版有标清和高清
  } else if (modelType === "veo3") {
    return ["standard"]; // VEO3 快速版
  } else if (modelType === "veo3-quality") {
    return ["hd"]; // VEO3 高清版
  }
  return ["standard"];
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

  // 任务模式
  mode?: VideoBatchTaskMode;  // 默认 "image_to_video"

  // 纯提示词模式的自定义提示词
  customPrompt?: string;      // 用户输入的提示词
  referenceImageUrl?: string; // 可选的参考图片

  // AI 模特配置（任务创建时保存）
  useAiModel?: boolean;       // 是否使用 AI 模特
  aiModelId?: string;         // AI 模特 ID（不暴露给用户）
  aiModelName?: string;       // AI 模特显示名称（用户可见）

  modelType: VideoModelType;
  duration: VideoDuration;
  quality: VideoQuality;
  apiLine?: ApiLineType;          // 任务创建时使用的 API 线路

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
  // AI 模特配置
  useAiModel: boolean;
  aiModelId: string | null;
  aiModelName: string | null;        // 显示名称（用户可见）
  aiModelTriggerWord: string | null; // 触发词（后台使用，不暴露给用户）
  aiModelCover: string | null;       // AI 模特封面图URL
  // API 线路配置
  apiLine: ApiLineType;              // API 线路选择
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
// - 标准款（10秒/15秒 横/竖屏）：20 积分/条
// - PRO 款（25秒 横/竖屏）：350 积分/条
// - PRO 高清款（15秒 横/竖屏）：350 积分/条
// ============================================================================

/** 视频生成定价 */
export const VIDEO_BATCH_PRICING = {
  doubaoScript: 0,      // 豆包生成脚本（包含在总价中）
  doubaoPrompt: 0,      // 豆包生成提示词（包含在总价中）
  // Sora2 标清
  sora2_10s: 20,        // 10秒 标清 = 20积分
  sora2_15s: 20,        // 15秒 标清 = 20积分
  // Sora2 Pro
  sora2Pro_15s_hd: 350, // 15秒 高清 = 350积分
  sora2Pro_25s: 350,    // 25秒 标清 = 350积分
  // VEO3 (固定 8 秒)
  veo3_fast: 30,        // VEO3 快速版 = 30积分
  veo3_quality: 80,     // VEO3 高清版 = 80积分
};

/** 获取视频生成总价 */
export function getVideoBatchTotalPrice(
  modelType: VideoModelType,
  duration: VideoDuration,
  quality: VideoQuality
): number {
  // 标准款：10秒/15秒 = 20积分
  if (modelType === "sora2") {
    if (duration === 10) return VIDEO_BATCH_PRICING.sora2_10s;
    if (duration === 15) return VIDEO_BATCH_PRICING.sora2_15s;
  }

  // PRO 款
  if (modelType === "sora2-pro") {
    // PRO 高清款 15秒 = 350积分
    if (quality === "hd" && duration === 15) return VIDEO_BATCH_PRICING.sora2Pro_15s_hd;
    // PRO 款 25秒 = 350积分
    if (duration === 25) return VIDEO_BATCH_PRICING.sora2Pro_25s;
  }

  // VEO3 快速版
  if (modelType === "veo3") {
    return VIDEO_BATCH_PRICING.veo3_fast;
  }

  // VEO3 高清版
  if (modelType === "veo3-quality") {
    return VIDEO_BATCH_PRICING.veo3_quality;
  }

  return VIDEO_BATCH_PRICING.sora2_15s; // 默认
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

