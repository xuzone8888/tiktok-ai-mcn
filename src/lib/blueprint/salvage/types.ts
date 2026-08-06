/**
 * Viral Clone V1.5 — 全部类型定义
 *
 * 覆盖: 数据库行类型、MasterPlan、Provider 配置、QC 结果、API 请求/响应
 *
 * 约束:
 * - Provider alias 不写死业务层，统一走 ProviderAlias 类型
 * - 所有 URL 字段要求自有 OSS URL，禁止第三方临时 URL
 */

// ============================================================================
// 基础枚举
// ============================================================================

/** 三入口类型 */
export type EntryType = 'upload' | 'link' | 'prompt';

/** Job 状态机（9 态 + failed + manual_review） */
export type JobStatus =
  | 'created'
  | 'ingesting'
  | 'analyzing'
  | 'planning'
  | 'awaiting_confirmation'
  | 'generating'
  | 'stitching'
  | 'upscaling'
  | 'completed'
  | 'failed'
  | 'manual_review';

/** Segment 状态机（7 态） */
export type SegmentStatus =
  | 'queued'
  | 'generating'
  | 'ready_for_qc'
  | 'ready'
  | 'stitched'
  | 'replaced'
  | 'failed';

/** 分段角色 */
export type SegmentRole = 'hook' | 'body' | 'demo' | 'cta' | 'b_roll' | 'proof';

/** 素材类型 */
export type AssetType =
  | 'source_video'
  | 'anchor_frame'
  | 'raw_segment'
  | 'rescued_segment'
  | 'stitched_video'
  | 'upscaled_video'
  | 'thumbnail';

/** Provider 别名 — 业务层只用这个，不直接写模型字符串 */
export type ProviderAlias = 'veo_std_refs' | 'veo_fast_frames' | 'grok_ref' | 'grok_extend';

/** 音频策略 */
export type AudioStrategy = 'native_per_segment' | 'unified_tts' | 'no_audio';

/** 编排模式 */
export type OrchestrationMode = 'sequential' | 'parallel_2' | 'chain_extend';

/** 画面比例 */
export type AspectRatio = '9:16' | '16:9';

/** 审计操作类型 */
export type AttemptType =
  | 'generate'
  | 'download'
  | 'tech_qc'
  | 'semantic_qc'
  | 'continuity_qc'
  | 'stitch'
  | 'upscale'
  | 'analyze'
  | 'plan';

/** 审计状态 */
export type AttemptStatus = 'started' | 'completed' | 'failed' | 'timeout';

/** 事件类型 */
export type EventType =
  | 'job_created'
  | 'ingest_started' | 'ingest_completed' | 'ingest_failed'
  | 'analysis_started' | 'analysis_completed'
  | 'plan_ready'
  | 'plan_confirmed'
  | 'segment_queued' | 'segment_generating' | 'segment_completed' | 'segment_failed'
  | 'segment_qc_passed' | 'segment_qc_failed'
  | 'segment_rescued'
  | 'continuity_qc_started' | 'continuity_qc_completed'
  | 'seam_qc_started' | 'seam_qc_completed'
  | 'stitch_started' | 'stitch_completed' | 'stitch_failed'
  | 'upscale_started' | 'upscale_completed' | 'upscale_failed'
  | 'bgm_generated'
  | 'job_completed' | 'job_failed'
  | 'budget_warning' | 'budget_exhausted'
  | 'manual_review_needed';

// ============================================================================
// 数据库行类型
// ============================================================================

/** viral_clone_assets 行 */
export interface ViralCloneAsset {
  id: string;
  user_id: string;
  asset_type: AssetType;
  url: string;
  oss_key: string | null;
  filename: string | null;
  content_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** viral_clone_jobs 行 */
export interface ViralCloneJob {
  id: string;
  user_id: string;
  entry_type: EntryType;
  status: JobStatus;
  source_asset_id: string | null;
  confirmed_plan_snapshot: MasterPlan | CloneSpecV2 | null;
  audio_strategy: AudioStrategy;
  orchestration_mode: OrchestrationMode;
  provider_capability_snapshot: Record<string, unknown>;
  currency_code: string;
  budget_minor: number;
  spent_minor: number;
  budget_exhausted: boolean;
  final_asset_id: string | null;
  aspect_ratio: AspectRatio;
  target_resolution: string;
  total_segments: number;
  completed_segments: number;
  failed_segments: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  error_message: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** viral_clone_segments 行 */
export interface ViralCloneSegment {
  id: string;
  job_id: string;
  segment_index: number;
  segment_role: SegmentRole;
  spoken_text: string;
  visual_goal: string;
  /** @deprecated 保留兼容旧代码，新代码改读 generation_duration / source_span_duration */
  target_duration: number;
  /** 源视频这段覆盖多少秒 */
  source_span_duration: number | null;
  /** 模型真正要生成多少秒 */
  generation_duration: number | null;
  /** Tech QC 对比的目标时长 */
  qc_expected_duration: number | null;
  provider: ProviderAlias;
  prompt_en: string | null;
  prompt_zh: string | null;
  anchors: string[];                   // URL 数组
  raw_asset_id: string | null;
  provider_task_id: string | null;
  status: SegmentStatus;
  tech_qc: TechQCResult | null;
  semantic_qc: SemanticQCResult | null;
  continuity_qc: ContinuityQCResult | null;
  trim_start_ms: number;
  trim_end_ms: number;
  seam_hint: string;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** viral_clone_attempts 行 */
export interface ViralCloneAttempt {
  id: string;
  job_id: string;
  segment_id: string | null;
  attempt_type: AttemptType;
  provider: string | null;
  provider_task_id: string | null;
  provider_result_url: string | null;  // 仅审计用
  status: AttemptStatus;
  result: Record<string, unknown> | null;
  error_message: string | null;
  cost_minor: number;
  duration_ms: number;
  output_asset_id: string | null;
  created_at: string;
  completed_at: string | null;
}

/** viral_clone_events 行 */
export interface ViralCloneEvent {
  id: string;
  job_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  segment_id: string | null;
  created_at: string;
}

// ============================================================================
// MasterPlan — 用户确认后冻结的方案对象
// ============================================================================

/** 风格圣经 */
export interface StyleBible {
  subject: string;         // 主体描述
  product: string;         // 产品描述
  color_temp: string;      // 色温（warm/cool/neutral）
  lighting: string;        // 布光描述
  camera: string;          // 机位描述
  pacing: string;          // 节奏描述（fast/medium/slow）
  mood: string;            // 情绪基调
}

/** 视觉锚点 */
export interface VisualAnchors {
  product_frame: string;        // 产品 hero 图 OSS URL
  spokesperson_frame: string;   // 人物/角色关键帧 OSS URL
  style_frame: string;          // 场景/风格关键帧 OSS URL
}

/** 分段定义 */
export interface SegmentPlan {
  spoken_text: string;           // 口播文案（每段必须有）
  visual_goal: string;           // 画面目标描述
  role: SegmentRole;
  target_seconds: number;        // 目标时长
  seam_hint: string;             // 衔接提示
  ref_images: string[];          // 参考图 OSS URL（最多 3 张）
}

/** 输出配置 */
export interface OutputProfile {
  aspect: AspectRatio;
  resolution: '1080x1920' | '1920x1080';
  caption_style?: string;        // 字幕风格（V1.5 可选）
  publish_targets: string[];     // 发布目标（如 'tiktok', 'douyin'）
}

/** 主计划对象 */
export interface MasterPlan {
  full_script: string;           // 整条连贯口播文案
  style_bible: StyleBible;
  visual_anchors: VisualAnchors;
  segments: SegmentPlan[];
  provider_route: ProviderAlias;     // 默认 'veo_std_refs'
  fallback_route: ProviderAlias;     // 默认 'veo_fast_frames'
  output_profile: OutputProfile;
  estimated_cost: number;            // 预估积分消耗
  estimated_time: number;            // 预估耗时（秒）
}

// ============================================================================
// CloneSpec V2 — 时间线克隆数据结构
// ============================================================================

/** V2 分析产物 — 带完整转录和时间线 */
export interface AnalysisArtifactV2 {
  /** 内容摘要 */
  summary: string;
  /** 完整转录文本 */
  transcript_full: string;
  /** 逐句转录（带近似时间戳） */
  utterances: Array<{
    id: string;
    approx_start_s: number;
    approx_end_s: number;
    text: string;
  }>;
  /** 画面节拍（自由文本为主） */
  visual_beats: Array<{
    id: string;
    approx_start_s: number;
    approx_end_s: number;
    description: string;       // 自由文本：画面发生了什么
    key_elements: string[];    // 必须保留的关键元素
    camera?: string;           // 可选：镜头描述
    on_screen_text?: string[]; // 可选：画面上的文字
  }>;
  /** 核心卖点 */
  key_claims: string[];
  /** 系统推荐段数 */
  suggested_segments: 2 | 3 | 4;
  /** 建议总时长 */
  suggested_duration: number;
  /** 语言 */
  language: 'zh' | 'en' | 'mixed';
  /** 视频类型 */
  video_type: string;
}

/** V2 分段蓝图 */
export interface SegmentBlueprintV2 {
  index: number;
  /** 源视频对应时间范围（秒，近似） */
  source_start_s: number;
  source_end_s: number;
  /** 角色 */
  role: 'hook' | 'demo' | 'proof' | 'cta' | 'b_roll';
  /** 关联的 utterance ID */
  utterance_ids: string[];
  /** 关联的 beat ID */
  beat_ids: string[];
  /** 原始台词（精确还原） */
  spoken_text_exact: string;
  /** 适配生成的台词（可选，仅当原文需压缩时使用） */
  spoken_text_for_generation?: string;
  /** 必须保留的关键元素 */
  key_elements: string[];
  /** 细化后的画面描述（来自 Qwen 分段细化） */
  visual_description?: string;
  /** 镜头运动描述（来自 Qwen 分段细化） */
  camera?: string;
  /** 衔接提示 */
  seam_hint: string;
  /** 参考图 URL */
  ref_images: string[];
  /**
   * @deprecated 使用 source_span_seconds / generation_duration_seconds 代替
   * 保留兼容旧代码，等于 source_span_seconds
   */
  target_seconds: number;
  /** 源视频这段覆盖多少秒（source_end_s - source_start_s） */
  source_span_seconds: number;
  /** 模型真正要生成多少秒（provider-aware，VEO 固定 8s） */
  generation_duration_seconds: number;
  /** Tech QC 对比的目标时长，通常等于 generation_duration_seconds */
  qc_expected_duration_seconds: number;
}

/** V2 克隆规格 — 统一中间对象 */
export interface CloneSpecV2 {
  /** 分析产物 */
  source_analysis: AnalysisArtifactV2;
  /** 风格指南 */
  style_bible: StyleBible;
  /** 视觉锚点 */
  visual_anchors: VisualAnchors;
  /** 分段蓝图 */
  segments: SegmentBlueprintV2[];
  /** Provider 路由 */
  provider_route: ProviderAlias;
  fallback_route: ProviderAlias;
  /** 输出配置 */
  output_profile: OutputProfile;
  /** 预估成本 */
  estimated_cost: number;
  /** 预估时间 */
  estimated_time: number;
  /** 模式标记: clone=还原原视频, creative=纯创作 */
  mode: 'clone' | 'creative';
}

// ============================================================================
// Provider 配置 — 审计约束 3.1: model 名不写死业务层
// ============================================================================

/** Provider 能力配置 */
export interface ProviderCapability {
  /** Provider 别名 */
  alias: ProviderAlias;
  /** 实际发送给聚合商的 model 字符串 — 可配置可更新 */
  actual_model: string;
  /** API 格式 */
  api_format: 'json' | 'multipart' | 'vercel_ai_sdk';
  /** 最大参考图数量 */
  max_ref_images: number;
  /** 是否支持原生音频 */
  supports_audio: boolean;
  /** 默认时长（秒） */
  default_seconds: number;
  /** 每次调用的积分消耗 */
  credit_cost: number;
  /** 是否支持链式延伸 */
  supports_extend?: boolean;
}

/** Provider 注册表配置 */
export type ProviderRegistry = Record<ProviderAlias, ProviderCapability>;

// ============================================================================
// QC 结果类型
// ============================================================================

/** Tech QC 结果 */
export interface TechQCResult {
  passed: boolean;
  duration_ok: boolean;
  duration_actual_ms: number;
  /** provider 期望输出时长（秒），用于 QC 比较 */
  expected_output_duration_s?: number;
  /** 源视频跨度时长（秒），仅用于展示，不参与判定 */
  source_span_duration_s?: number;
  resolution_ok: boolean;
  width: number;
  height: number;
  has_audio: boolean;
  has_black_frames: boolean;
  decode_errors: number;
  details: string;
}

/** Semantic QC 结果 */
export interface SemanticQCResult {
  passed: boolean;
  content_match: boolean;         // 口播内容是否体现
  visual_direction_ok: boolean;   // 画面方向是否正确
  product_visible: boolean;       // 产品是否出现
  person_visible: boolean;        // 人物是否出现
  confidence: number;             // 0-1 置信度
  details: string;
}

/** Continuity QC 结果 */
export interface ContinuityQCResult {
  passed: boolean;
  person_consistent: boolean;     // 人物一致性
  product_consistent: boolean;    // 产品一致性
  wardrobe_consistent: boolean;   // 服装一致性
  background_consistent: boolean; // 背景一致性
  tone_consistent: boolean;       // 语气一致性
  color_consistent: boolean;      // 色调一致性
  severity: 'none' | 'minor' | 'major' | 'critical';
  details: string;
}

/** Seam QC 结果（拼接前检查） */
export interface SeamQCResult {
  passed: boolean;
  tail_energy: number;           // 段尾 0.6s 音频能量
  head_energy: number;           // 下段首 0.6s 音频能量
  has_tail_silence: boolean;     // 段尾是否有静音
  sentence_complete: boolean;    // 句子是否完整
  recommended_trim_ms: number;   // 建议裁剪毫秒
  details: string;
}

// ============================================================================
// Stitcher 配置
// ============================================================================

/** 拼接配置 */
export interface StitchConfig {
  /** 保留的自然呼吸时长范围 (ms) */
  breath_min_ms: number;    // 80
  breath_max_ms: number;    // 200
  /** 音频标准化 */
  loudnorm: boolean;
  /** 过渡类型映射 */
  transitions: {
    'speech_to_speech': 'cut' | 'short_fade';
    'speech_to_broll': 'audio_continue';
    'broll_to_broll': 'crossfade';
  };
  /** crossfade 时长 (s) */
  crossfade_duration: number;  // 0.2-0.3
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 上传初始化请求 */
export interface UploadInitRequest {
  filename: string;
  content_type: string;
  file_size: number;
}

/** 上传初始化响应 */
export interface UploadInitResponse {
  success: boolean;
  data?: {
    upload_url: string;     // OSS 签名 PUT URL
    public_url: string;     // 上传完成后的公网 URL
    oss_key: string;
    job_id: string;         // 已创建的 job
    asset_id: string;       // 已创建的 source_asset
  };
  error?: string;
}

/** 上传确认请求 */
export interface UploadConfirmRequest {
  job_id: string;
  asset_id: string;
}

/** 图片上传凭证请求 */
export interface ImageCredentialsRequest {
  filename: string;
  content_type: string;
}

/** 图片上传凭证响应 */
export interface ImageCredentialsResponse {
  success: boolean;
  data?: {
    upload_url: string;
    public_url: string;
    oss_key: string;
  };
  error?: string;
}

/** 链接导入请求 */
export interface IngestLinkRequest {
  url: string;
  aspect_ratio?: AspectRatio;
}

/** 链接导入响应 */
export interface IngestLinkResponse {
  success: boolean;
  data?: {
    job_id: string;
    asset_id: string;
    platform: string;
    status: 'downloading' | 'completed' | 'failed';
  };
  error?: string;
  fallback_message?: string;   // "请上传原视频"
}

/** 提示词入口请求 */
export interface IngestPromptRequest {
  prompt: string;
  ref_image_urls?: string[];   // 可选参考图 (已上传到 OSS)
  aspect_ratio?: AspectRatio;
}

/** 提示词入口响应 */
export interface IngestPromptResponse {
  success: boolean;
  data?: {
    job_id: string;
  };
  error?: string;
}

/** Job 详情响应 */
export interface JobDetailResponse {
  success: boolean;
  data?: {
    job: ViralCloneJob;
    segments: ViralCloneSegment[];
    assets: ViralCloneAsset[];
    events: ViralCloneEvent[];
  };
  error?: string;
}

/** Job 列表响应 */
export interface JobListResponse {
  success: boolean;
  data?: {
    jobs: ViralCloneJob[];
    total: number;
  };
  error?: string;
}

/** 确认方案请求 */
export interface ConfirmPlanRequest {
  job_id: string;
  /** 用户可能编辑了分段脚本/提示词 */
  edited_plan?: Partial<MasterPlan>;
}

/** 重试单段请求 */
export interface RetrySegmentRequest {
  job_id: string;
  segment_id: string;
  /** 可选：使用替代 provider */
  override_provider?: ProviderAlias;
}

/** 发布请求 */
export interface PublishRequest {
  job_id: string;
  account_ids: string[];
  title: string;
  privacy_level?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  is_aigc?: boolean;
}

// ============================================================================
// Analyzer 输出类型
// ============================================================================

/** Qwen 分析结果 */
export interface AnalysisResult {
  /** 视频内容摘要 */
  summary: string;
  /** 检测到的产品/商品 */
  products: string[];
  /** 检测到的人物/角色 */
  persons: string[];
  /** 场景描述 */
  scenes: string[];
  /** 关键帧时间戳（秒） */
  key_moments: number[];
  /** 语言 */
  language: 'zh' | 'en' | 'mixed';
  /** 视频类型推断 */
  video_type: 'product_review' | 'ad_oral' | 'tutorial' | 'lifestyle' | 'other';
  /** 建议的段数 */
  suggested_segments: number;
  /** 预估成片时长（秒） */
  suggested_duration: number;
}

// ============================================================================
// 常量
// ============================================================================

/** Job 状态显示名 */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  created: '已创建',
  ingesting: '导入中',
  analyzing: '分析中',
  planning: '规划中',
  awaiting_confirmation: '等待确认',
  generating: '生成中',
  stitching: '拼接中',
  upscaling: '清晰化中',
  completed: '已完成',
  failed: '失败',
  manual_review: '需人工审核',
};

/** Segment 状态显示名 */
export const SEGMENT_STATUS_LABELS: Record<SegmentStatus, string> = {
  queued: '排队中',
  generating: '生成中',
  ready_for_qc: '质检中',
  ready: '已就绪',
  stitched: '已拼接',
  replaced: '已替换',
  failed: '失败',
};

/** 分段规则常量 */
export const SEGMENTATION_RULES = {
  /** 每段默认时长（秒） */
  DEFAULT_SEGMENT_SECONDS: 8,
  /** 口播目标时长范围（秒） */
  SPOKEN_MIN_SECONDS: 6.0,
  SPOKEN_MAX_SECONDS: 7.0,
  /** 分段数映射：总时长 → 段数 */
  SEGMENT_COUNT_MAP: [
    { maxDuration: 16, segments: 2 },
    { maxDuration: 24, segments: 3 },
    { maxDuration: 32, segments: 4 },
    { maxDuration: Infinity, segments: 4 },
  ] as const,
  /** 最大重试次数 */
  MAX_RETRIES: 3,
} as const;

/** Stitcher 默认配置 */
export const DEFAULT_STITCH_CONFIG: StitchConfig = {
  breath_min_ms: 80,
  breath_max_ms: 200,
  loudnorm: true,
  transitions: {
    'speech_to_speech': 'cut',
    'speech_to_broll': 'audio_continue',
    'broll_to_broll': 'crossfade',
  },
  crossfade_duration: 0.25,
};

/** Upscale 配置常量 — 审计补充②: 独立 timeout */
export const UPSCALE_CONFIG = {
  /** 最终成片超分超时（秒） */
  TIMEOUT_SECONDS: 300,
  /** Worker 并发上限 */
  MAX_CONCURRENT: 3,
  /** 不降级：Worker 繁忙时排队等待 */
  ALLOW_DEGRADED: false,
} as const;
