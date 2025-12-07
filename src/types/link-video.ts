/**
 * 链接秒变视频模块类型定义
 * 
 * 核心功能：
 * 1. 解析商品链接 → 提取商品信息
 * 2. 生成带货脚本 → 豆包 API
 * 3. 生成九宫格图片 → Nano Banana Pro
 * 4. 生成视频 → Sora2 / Sora2 Pro
 */

// ============================================================================
// 枚举类型
// ============================================================================

/** 支持的电商平台 */
export type ProductPlatform = 
  | 'douyin'      // 抖音
  | 'taobao'      // 淘宝
  | 'tmall'       // 天猫
  | 'jd'          // 京东
  | 'tiktok'      // TikTok (国际)
  | 'amazon'      // 亚马逊
  | 'pinduoduo'   // 拼多多
  | 'other';      // 其他

/** 视频时长 */
export type LinkVideoDuration = 10 | 15 | 25;

/** 视频风格 */
export type VideoStyle = 
  | 'selfie_talking'       // 达人自拍口播种草
  | 'scene_plus_talking'   // 场景演示+口播
  | 'product_only';        // 纯产品展示+字幕+配音

/** 目标平台/区域 */
export type PlatformStyle =
  | 'tiktok_us'            // TikTok 美区
  | 'douyin_cn'            // 国内抖音
  | 'generic';             // 通用

/** 语言 */
export type ScriptLanguage = 'en' | 'zh';

/** 链接解析状态 */
export type LinkParseStatus = 'pending' | 'parsing' | 'success' | 'failed';

/** 任务状态 */
export type LinkVideoJobStatus =
  | 'created'              // 刚创建
  | 'parsing_link'         // 正在解析链接
  | 'link_parsed'          // 链接解析完成
  | 'configuring'          // 配置中
  | 'generating_script'    // 正在生成脚本
  | 'script_generated'     // 脚本生成完成
  | 'generating_grid'      // 正在生成九宫格
  | 'grid_generated'       // 九宫格生成完成
  | 'generating_video'     // 正在生成视频
  | 'success'              // 全部完成
  | 'failed'               // 失败
  | 'cancelled';           // 已取消

// ============================================================================
// 商品数据结构
// ============================================================================

/** 商品图片 */
export interface ProductImage {
  url: string;
  type: 'main' | 'detail' | 'scene';
  selected: boolean;
  is_primary: boolean;
}

/** 商品价格 */
export interface ProductPrice {
  current: string;
  original?: string;
  discount?: string;
}

/** 解析后的商品数据 */
export interface ParsedProductData {
  title: string;
  selling_points: string[];
  price: ProductPrice;
  brand?: string;
  store_name?: string;
  category?: string;
  images: ProductImage[];
}

/** 手动输入的商品信息 */
export interface ManualProductInfo {
  title: string;
  selling_points: string;
  price: string;
  images: string[];
}

// ============================================================================
// 商品链接缓存表类型
// ============================================================================

/** 商品链接缓存 */
export interface ProductLinkCache {
  id: string;
  url: string;
  url_hash: string;
  platform: ProductPlatform;
  
  // 原始数据
  raw_title: string | null;
  raw_description: string | null;
  raw_price: string | null;
  raw_promo_info: string | null;
  raw_images: string[];
  
  // 结构化数据
  parsed_data: ParsedProductData | null;
  
  // 状态
  parse_status: LinkParseStatus;
  parse_error: string | null;
  
  // 时间戳
  created_at: string;
  updated_at: string;
  last_fetched_at: string | null;
}

// ============================================================================
// 视频配置
// ============================================================================

/** 视频生成配置 */
export interface VideoConfig {
  duration: LinkVideoDuration;
  aspect_ratio: '9:16' | '16:9';
  video_style: VideoStyle;
  platform_style: PlatformStyle;
  language: ScriptLanguage;
}

/** 默认视频配置 */
export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  duration: 15,
  aspect_ratio: '9:16',
  video_style: 'selfie_talking',
  platform_style: 'tiktok_us',
  language: 'en',
};

// ============================================================================
// 脚本版本
// ============================================================================

/** 脚本版本 */
export interface ScriptVersion {
  version: number;
  content: string;
  created_at: string;
}

// ============================================================================
// 链接转视频任务表类型
// ============================================================================

/** 链接转视频任务 */
export interface LinkVideoJob {
  id: string;
  user_id: string;
  
  // 关联
  product_link_id: string | null;
  ai_model_id: string | null;
  
  // 商品信息 (手动模式)
  manual_product_info: ManualProductInfo | null;
  
  // 配置
  video_config: VideoConfig;
  
  // 选中的图片
  selected_main_image_url: string | null;
  selected_image_urls: string[];
  
  // 生成内容
  script_text: string | null;
  script_versions: ScriptVersion[];
  grid_image_url: string | null;
  final_video_url: string | null;
  thumbnail_url: string | null;
  
  // 外部任务 ID
  grid_task_id: string | null;
  video_task_id: string | null;
  
  // 状态
  status: LinkVideoJobStatus;
  current_step: number;
  progress: number;
  error_message: string | null;
  
  // 积分
  credits_estimated: number;
  credits_used: number;
  credits_refunded: number;
  
  // 重试计数
  script_rewrite_count: number;
  grid_retry_count: number;
  video_retry_count: number;
  
  // 时间戳
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================================
// 带关联数据的扩展类型
// ============================================================================

/** 带商品数据的任务 */
export interface LinkVideoJobWithProduct extends LinkVideoJob {
  product_link?: ProductLinkCache | null;
}

/** 带 AI 模特数据的任务 */
export interface LinkVideoJobWithModel extends LinkVideoJob {
  ai_model?: {
    id: string;
    name: string;
    avatar_url: string | null;
    trigger_word?: string;
  } | null;
}

/** 完整任务数据 */
export interface LinkVideoJobFull extends LinkVideoJob {
  product_link?: ProductLinkCache | null;
  ai_model?: {
    id: string;
    name: string;
    avatar_url: string | null;
    gender: 'male' | 'female' | 'neutral' | null;
    age_range: string | null;
    style_tags: string[];
  } | null;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 解析链接请求 */
export interface ParseLinkRequest {
  url: string;
  platform?: ProductPlatform;
}

/** 解析链接响应 */
export interface ParseLinkResponse {
  success: boolean;
  data?: {
    product_link_id: string;
    parsed_data: ParsedProductData;
    from_cache: boolean;
  };
  error?: string;
}

/** 创建任务请求 */
export interface CreateJobRequest {
  product_link_id?: string;
  manual_product_info?: ManualProductInfo;
  video_config: VideoConfig;
  ai_model_id?: string;
  selected_main_image_url: string;
  selected_image_urls: string[];
}

/** 创建任务响应 */
export interface CreateJobResponse {
  success: boolean;
  job?: LinkVideoJob;
  error?: string;
}

/** 生成脚本请求 */
export interface GenerateScriptRequest {
  rewrite?: boolean;  // 是否重写
}

/** 生成脚本响应 */
export interface GenerateScriptResponse {
  success: boolean;
  script?: string;
  version?: number;
  credits_charged?: number;  // 重写收费时返回
  error?: string;
}

/** 更新任务请求 */
export interface UpdateJobRequest {
  video_config?: Partial<VideoConfig>;
  ai_model_id?: string | null;
  selected_main_image_url?: string;
  selected_image_urls?: string[];
  script_text?: string;
}

/** 任务状态响应 */
export interface JobStatusResponse {
  success: boolean;
  job?: LinkVideoJob;
  error?: string;
}

// ============================================================================
// 积分定价
// ============================================================================

/** 链接转视频积分定价 */
export const LINK_VIDEO_CREDITS = {
  "10": 50,    // 10秒视频
  "15": 100,   // 15秒视频
  "25": 380,   // 25秒视频
  script_rewrite: 5,       // 脚本重写 (第4次起)
  script_free_rewrites: 3, // 免费重写次数
} as const;

/** 获取视频积分价格 */
export function getLinkVideoCredits(duration: LinkVideoDuration): number {
  return LINK_VIDEO_CREDITS[String(duration) as keyof typeof LINK_VIDEO_CREDITS] as number;
}

/** 判断脚本重写是否收费 */
export function isScriptRewriteCharged(rewriteCount: number): boolean {
  return rewriteCount >= LINK_VIDEO_CREDITS.script_free_rewrites;
}

/** 获取脚本重写费用 */
export function getScriptRewriteCost(rewriteCount: number): number {
  return isScriptRewriteCharged(rewriteCount) ? LINK_VIDEO_CREDITS.script_rewrite : 0;
}

// ============================================================================
// 步骤定义
// ============================================================================

/** 步骤配置 */
export interface StepConfig {
  step: number;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

/** 获取步骤配置 */
export function getStepConfigs(currentStep: number, jobStatus: LinkVideoJobStatus): StepConfig[] {
  const steps: StepConfig[] = [
    { step: 1, title: '粘贴链接', description: '解析商品信息', status: 'pending' },
    { step: 2, title: '配置参数', description: '选择视频风格', status: 'pending' },
    { step: 3, title: '生成脚本', description: 'AI 撰写文案', status: 'pending' },
    { step: 4, title: '九宫格图', description: '多角度展示', status: 'pending' },
    { step: 5, title: '生成视频', description: 'AI 合成视频', status: 'pending' },
  ];

  // 根据状态更新步骤状态
  for (let i = 0; i < steps.length; i++) {
    if (i + 1 < currentStep) {
      steps[i].status = 'completed';
    } else if (i + 1 === currentStep) {
      steps[i].status = jobStatus === 'failed' ? 'error' : 'active';
    }
  }

  if (jobStatus === 'success') {
    steps.forEach(s => s.status = 'completed');
  }

  return steps;
}

// ============================================================================
// 平台识别工具
// ============================================================================

/** 平台识别规则 */
const PLATFORM_PATTERNS: Array<{ pattern: RegExp; platform: ProductPlatform }> = [
  { pattern: /douyin\.com|v\.douyin\.com/i, platform: 'douyin' },
  { pattern: /taobao\.com|m\.tb\.cn/i, platform: 'taobao' },
  { pattern: /tmall\.com|detail\.tmall/i, platform: 'tmall' },
  { pattern: /jd\.com|3\.cn/i, platform: 'jd' },
  { pattern: /tiktok\.com/i, platform: 'tiktok' },
  { pattern: /amazon\.(com|cn|co\.|de|fr|es|it|jp)/i, platform: 'amazon' },
  { pattern: /pinduoduo\.com|yangkeduo\.com/i, platform: 'pinduoduo' },
];

/** 根据 URL 识别平台 */
export function detectPlatform(url: string): ProductPlatform {
  for (const { pattern, platform } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) {
      return platform;
    }
  }
  return 'other';
}

/** 平台显示名称 */
export const PLATFORM_NAMES: Record<ProductPlatform, string> = {
  douyin: '抖音',
  taobao: '淘宝',
  tmall: '天猫',
  jd: '京东',
  tiktok: 'TikTok',
  amazon: '亚马逊',
  pinduoduo: '拼多多',
  other: '其他',
};

/** 视频风格显示名称 */
export const VIDEO_STYLE_NAMES: Record<VideoStyle, string> = {
  selfie_talking: '达人自拍口播种草',
  scene_plus_talking: '场景演示+口播',
  product_only: '纯产品展示+字幕',
};

/** 平台风格显示名称 */
export const PLATFORM_STYLE_NAMES: Record<PlatformStyle, string> = {
  tiktok_us: 'TikTok 美区',
  douyin_cn: '国内抖音',
  generic: '通用',
};

/** 语言显示名称 */
export const LANGUAGE_NAMES: Record<ScriptLanguage, string> = {
  en: 'English',
  zh: '中文',
};





