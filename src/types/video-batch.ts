/**
 * Video Batch Types - 批量视频生产单元类型定义
 */

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
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

/** 流水线步骤 */
export type PipelineStep = 0 | 1 | 2 | 3 | 4;

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

/** 视频批量任务 */
export interface VideoBatchTask {
  id: string;
  images: TaskImageInfo[];
  aspectRatio: VideoAspectRatio;
  
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
  language: "en" | "zh";
  autoStart: boolean;
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
  { step: 3, label: "生成视频", description: "Sora2 Pro生成15秒视频", icon: "🎥" },
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
// ============================================================================

export const VIDEO_BATCH_PRICING = {
  doubaoScript: 5,      // 豆包生成脚本 5 Credits
  doubaoPrompt: 5,      // 豆包生成提示词 5 Credits
  sora15s: 50,          // Sora2 Pro 15秒视频 50 Credits
  total: 60,            // 总计 60 Credits
};

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

