/**
 * 电商图片工厂 - 类型定义
 * 
 * 用于 /image-factory 模块的所有类型
 */

// ============================================================================
// 枚举类型
// ============================================================================

/** 电商图片模式 */
export type EcomImageMode = 
  | 'ecom_five_pack'    // 电商五图套装
  | 'white_background'  // 一键白底图
  | 'scene_image'       // 一键产品场景图
  | 'try_on'            // 一键试穿试戴
  | 'buyer_show';       // 一键买家秀

/** 任务状态 */
export type EcomTaskStatus = 
  | 'created'            // 已创建
  | 'generating_prompts' // 正在生成提示词
  | 'generating_images'  // 正在生成图片
  | 'success'            // 全部成功
  | 'partial_success'    // 部分成功（五图套装可能有部分失败）
  | 'failed';            // 失败

/** 图片模型类型 */
export type ImageModelType = 'nano-banana' | 'nano-banana-pro';

/** 语言 */
export type EcomLanguage = 'zh' | 'en';

/** 图片比例 */
export type EcomAspectRatio = 'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

/** 输出分辨率（仅 Pro） */
export type EcomResolution = '1k' | '2k' | '4k';

/** 五图套装的图片类型 */
export type FivePackImageType = 'main' | 'scene' | 'detail' | 'selling' | 'compare';

/** 产品类目 */
export type ProductCategory = 'clothing' | 'beauty' | '3c' | 'home' | 'food' | 'other';

/** 场景类型 */
export type SceneType = 
  | 'bedroom'
  | 'living_room'
  | 'kitchen'
  | 'office'
  | 'outdoor'
  | 'sports'
  | 'beauty_desk'
  | 'smart_recommend';

/** 产品类型（试穿试戴） */
export type TryOnProductType = 'clothing' | 'shoes' | 'accessories' | 'jewelry';

/** 买家秀风格 */
export type BuyerShowStyle = 
  | 'selfie'
  | 'party'
  | 'family'
  | 'indoor'
  | 'outdoor'
  | 'desk'
  | 'unboxing';

/** 买家人设年龄段 */
export type PersonaAge = '18-25' | '25-35' | '35+';

/** 买家人设性别 */
export type PersonaGender = 'male' | 'female' | 'mixed';

/** 买家人设地区 */
export type PersonaRegion = 'western' | 'asian' | 'southeast_asia' | 'china';

// ============================================================================
// 模式特有配置
// ============================================================================

/** 电商五图套装配置 */
export interface EcomFivePackConfig {
  product_category?: ProductCategory;
}

/** 一键白底图配置 */
export interface WhiteBackgroundConfig {
  // 白底图使用固定模板，无需额外配置
}

/** 一键场景图配置 */
export interface SceneImageConfig {
  scene_type: SceneType;
}

/** 一键试穿试戴配置 */
export interface TryOnConfig {
  model_id: string;
  model_name?: string;
  model_avatar?: string;
  model_trigger_word?: string;
  product_type: TryOnProductType;
}

/** 买家人设 */
export interface BuyerPersona {
  age?: PersonaAge;
  gender?: PersonaGender;
  region?: PersonaRegion;
}

/** 一键买家秀配置 */
export interface BuyerShowConfig {
  style: BuyerShowStyle;
  persona?: BuyerPersona;
}

/** 模式配置联合类型 */
export type ModeConfig = 
  | EcomFivePackConfig 
  | WhiteBackgroundConfig
  | SceneImageConfig 
  | TryOnConfig 
  | BuyerShowConfig 
  | Record<string, never>;

// ============================================================================
// 输出项
// ============================================================================

/** 单个输出项状态 */
export type OutputItemStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** 单个输出项 */
export interface OutputItem {
  type: string;               // 图片类型: 'main', 'scene', 'detail', 'selling', 'compare', 'white_bg', etc.
  label?: string;             // 显示标签: '主图', '场景图', etc.
  url?: string;               // 生成的图片URL
  task_id?: string;           // Nano Banana 任务ID
  status: OutputItemStatus;
  error?: string;
  input_image_url?: string;   // 对应的输入图片（用于对比展示）
}

// ============================================================================
// 提示词
// ============================================================================

/** 提示词结构 */
export interface EcomPrompts {
  /** 原始生成的提示词 */
  original?: Record<string, string>;
  /** 用户修改后的提示词 */
  modified?: Record<string, string>;
}

// ============================================================================
// 主任务类型
// ============================================================================

/** 电商图片任务 */
export interface EcomImageTask {
  id: string;
  user_id: string;
  
  // 模式配置
  mode: EcomImageMode;
  model_type: ImageModelType;
  language: EcomLanguage;
  ratio: EcomAspectRatio;
  resolution?: EcomResolution;
  
  // 输入数据
  input_image_urls: string[];
  
  // 模式特有配置
  mode_config: ModeConfig;
  
  // 提示词
  prompts: EcomPrompts;
  
  // 输出结果
  output_items: OutputItem[];
  
  // 状态
  status: EcomTaskStatus;
  current_step: number;  // 1=上传, 2=生成提示词, 3=生成图片
  error_message?: string;
  
  // 积分
  credits_cost: number;
  credits_charged: boolean;
  credits_charged_at?: string;
  
  // 时间戳
  created_at: string;
  updated_at: string;
  completed_at?: string;
  
  // 元数据
  metadata?: Record<string, unknown>;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 创建任务请求 */
export interface CreateEcomTaskRequest {
  mode: EcomImageMode;
  model_type: ImageModelType;
  language: EcomLanguage;
  ratio: EcomAspectRatio;
  resolution?: EcomResolution;
  input_image_urls: string[];
  mode_config?: ModeConfig;
  is_one_click?: boolean;
}

/** 创建任务响应 */
export interface CreateEcomTaskResponse {
  success: boolean;
  task_id?: string;
  task?: EcomImageTask;
  credits_required?: number;
  error?: string;
}

/** 生成提示词请求 */
export interface GeneratePromptsRequest {
  task_id: string;
}

/** 生成提示词响应 */
export interface GeneratePromptsResponse {
  success: boolean;
  prompts?: Record<string, string>;
  task?: EcomImageTask;
  error?: string;
}

/** 生成图片请求 */
export interface GenerateImagesRequest {
  task_id: string;
  prompts?: Record<string, string>;  // 可选：用户修改后的提示词
}

/** 生成图片响应 */
export interface GenerateImagesResponse {
  success: boolean;
  nano_task_ids?: string[];
  task?: EcomImageTask;
  error?: string;
}

/** 任务状态响应 */
export interface TaskStatusResponse {
  success: boolean;
  task?: EcomImageTask;
  error?: string;
}

// ============================================================================
// 前端状态类型
// ============================================================================

/** 上传的图片项 */
export interface UploadedImage {
  id: string;
  file?: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
  size?: number;
  uploading?: boolean;
  error?: string;
}

/** 步骤状态 */
export type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

/** 步骤定义 */
export interface Step {
  id: number;
  title: string;
  description: string;
  status: StepStatus;
}

// ============================================================================
// 常量配置
// ============================================================================

/** 模式配置 */
export const ECOM_MODE_CONFIG: Record<EcomImageMode, {
  title: string;
  description: string;
  icon: string;
  needsPromptGeneration: boolean;
  outputCount: number | 'dynamic';  // 'dynamic' = 根据输入图片数量
}> = {
  ecom_five_pack: {
    title: '电商五图套装',
    description: '一键生成主图、场景图、细节图、卖点图、对比图',
    icon: 'LayoutGrid',
    needsPromptGeneration: true,
    outputCount: 5,
  },
  white_background: {
    title: '一键白底图',
    description: '将产品图片转换为标准白底图',
    icon: 'Square',
    needsPromptGeneration: false,
    outputCount: 'dynamic',
  },
  scene_image: {
    title: '一键产品场景图',
    description: '让产品出现在合适的生活场景中',
    icon: 'Image',
    needsPromptGeneration: true,
    outputCount: 'dynamic',
  },
  try_on: {
    title: '一键试穿试戴',
    description: '让产品呈现在AI模特身上',
    icon: 'User',
    needsPromptGeneration: true,
    outputCount: 'dynamic',
  },
  buyer_show: {
    title: '一键买家秀',
    description: '生成真实买家晒图风格的图片',
    icon: 'Camera',
    needsPromptGeneration: true,
    outputCount: 'dynamic',
  },
};

/** 五图套装类型配置 */
export const FIVE_PACK_TYPES: Record<FivePackImageType, {
  label: string;
  labelEn: string;
  description: string;
}> = {
  main: {
    label: '主图',
    labelEn: 'Main',
    description: '突出产品主体，干净背景，清晰突出品牌和卖点',
  },
  scene: {
    label: '场景图',
    labelEn: 'Scene',
    description: '展示产品在真实使用场景中的样子',
  },
  detail: {
    label: '细节图',
    labelEn: 'Detail',
    description: '放大展示关键细节、做工或材质',
  },
  selling: {
    label: '卖点图',
    labelEn: 'Selling Points',
    description: '用简短文案和排版突出核心卖点',
  },
  compare: {
    label: '对比图',
    labelEn: 'Comparison',
    description: '展示使用前后对比，或与普通产品的差别',
  },
};

/** 产品类目选项 */
export const PRODUCT_CATEGORY_OPTIONS: { value: ProductCategory; label: string; labelEn: string }[] = [
  { value: 'clothing', label: '服饰', labelEn: 'Clothing' },
  { value: 'beauty', label: '美妆', labelEn: 'Beauty' },
  { value: '3c', label: '3C数码', labelEn: '3C Electronics' },
  { value: 'home', label: '家居', labelEn: 'Home' },
  { value: 'food', label: '食品', labelEn: 'Food' },
  { value: 'other', label: '其他', labelEn: 'Other' },
];

/** 场景类型选项 */
export const SCENE_TYPE_OPTIONS: { value: SceneType; label: string; labelEn: string }[] = [
  { value: 'smart_recommend', label: '智能推荐', labelEn: 'Smart Recommend' },
  { value: 'bedroom', label: '卧室', labelEn: 'Bedroom' },
  { value: 'living_room', label: '客厅', labelEn: 'Living Room' },
  { value: 'kitchen', label: '厨房', labelEn: 'Kitchen' },
  { value: 'office', label: '办公室', labelEn: 'Office' },
  { value: 'outdoor', label: '户外', labelEn: 'Outdoor' },
  { value: 'sports', label: '运动', labelEn: 'Sports' },
  { value: 'beauty_desk', label: '美妆台', labelEn: 'Beauty Desk' },
];

/** 试穿产品类型选项 */
export const TRY_ON_PRODUCT_OPTIONS: { value: TryOnProductType; label: string; labelEn: string }[] = [
  { value: 'clothing', label: '服装', labelEn: 'Clothing' },
  { value: 'shoes', label: '鞋子', labelEn: 'Shoes' },
  { value: 'accessories', label: '配饰', labelEn: 'Accessories' },
  { value: 'jewelry', label: '珠宝', labelEn: 'Jewelry' },
];

/** 买家秀风格选项 */
export const BUYER_SHOW_STYLE_OPTIONS: { value: BuyerShowStyle; label: string; labelEn: string }[] = [
  { value: 'selfie', label: '自拍风', labelEn: 'Selfie' },
  { value: 'party', label: '聚会', labelEn: 'Party' },
  { value: 'family', label: '家庭', labelEn: 'Family' },
  { value: 'indoor', label: '室内', labelEn: 'Indoor' },
  { value: 'outdoor', label: '户外', labelEn: 'Outdoor' },
  { value: 'desk', label: '桌面', labelEn: 'Desk' },
  { value: 'unboxing', label: '开箱', labelEn: 'Unboxing' },
];

/** 买家人设年龄选项 */
export const PERSONA_AGE_OPTIONS: { value: PersonaAge; label: string }[] = [
  { value: '18-25', label: '18-25岁' },
  { value: '25-35', label: '25-35岁' },
  { value: '35+', label: '35岁以上' },
];

/** 买家人设性别选项 */
export const PERSONA_GENDER_OPTIONS: { value: PersonaGender; label: string }[] = [
  { value: 'female', label: '女性' },
  { value: 'male', label: '男性' },
  { value: 'mixed', label: '混合' },
];

/** 买家人设地区选项 */
export const PERSONA_REGION_OPTIONS: { value: PersonaRegion; label: string }[] = [
  { value: 'china', label: '国内' },
  { value: 'asian', label: '日韩' },
  { value: 'southeast_asia', label: '东南亚' },
  { value: 'western', label: '欧美' },
];

/** 图片比例选项 */
export const ASPECT_RATIO_OPTIONS: { value: EcomAspectRatio; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

/** 分辨率选项 */
export const RESOLUTION_OPTIONS: { value: EcomResolution; label: string }[] = [
  { value: '1k', label: '1K (默认)' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];


