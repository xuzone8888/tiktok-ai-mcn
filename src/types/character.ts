/**
 * 角色系统 (Character Studio) — 全局类型定义
 *
 * 所有角色相关的 TypeScript 类型集中定义于此，
 * 供前端页面、Store、后端 API 统一导入，杜绝字段拼写不一致。
 */

// ============================================================================
// DNA 配置
// ============================================================================

/** DNA 配置 — 所有值均使用英文 key 标识，不使用中文 */
export interface CharacterDna {
  /** 大类与物种 */
  species: "realistic" | "anime" | "mascot" | "animal";
  /** 基础特征风格（英文 key，如 "chinese_cool"、"ghibli"、"cute_cat"） */
  baseDna: string;
  /** 性别 */
  gender: "female" | "male" | "neutral";
  /** 年龄阶段（英文 key，如 "youth"、"teen"、"mature"） */
  ageGroup: string;
  /** 身材比例（英文 key，如 "tall_model"、"slim"、"petite"） */
  bodyType: string;
  /** 发型（英文 key，如 "long_straight"、"french_curl"） */
  hairStyle: string;
  /** 发色（英文 key，如 "natural_black"、"ash_blonde"） */
  hairColor: string;
  /** 默认穿搭（英文 key，如 "white_tee_jeans"、"cheongsam"） */
  outfit: string;
}

/** CharacterDna 的默认空值 */
export const DEFAULT_DNA: CharacterDna = {
  species: "realistic",
  baseDna: "",
  gender: "female",
  ageGroup: "",
  bodyType: "",
  hairStyle: "",
  hairColor: "",
  outfit: "",
};

// ============================================================================
// 角色实体
// ============================================================================

/** 保存到数据库的角色实体（映射 ai_models 表中 source='user_created' 的行） */
export interface Character {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  reference_images: string[];
  preview_video_url: string | null;
  character_type: string;
  dna_config: CharacterDna | Record<string, unknown>;
  style_tags: string[];
  gender: string | null;
  age_range: string | null;
  /** 多角度合成参考图 URL（用于图片/视频生产引用） */
  reference_sheet_url: string | null;
  /** 参考图生成状态：none | pending | completed | failed */
  reference_status: string;
  /** 参考图异步任务 ID */
  reference_task_id: string | null;
  /** 是否已发布到角色资源广场 */
  is_public: boolean;
  /** 广场发布价格（积分） */
  publish_price: number;
  source: "user_created";
  owner_id: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 创建角色请求体 */
export interface CreateCharacterRequest {
  userId: string;
  name: string;
  description?: string;
  avatar_url: string;
  reference_images: string[];
  preview_video_url?: string;
  character_type: string;
  dna_config: CharacterDna | Record<string, unknown>;
  style_tags?: string[];
  gender?: string;
  age_range?: string;
  /** 多角度合成参考图 URL */
  reference_sheet_url?: string;
  /** 参考图生成状态 */
  reference_status?: string;
  /** 参考图异步任务 ID */
  reference_task_id?: string;
  /** Sora2 角色 @pid */
  trigger_word?: string;
  /** 铸造类型：veo 写真角色 | sora2 影视角色 */
  forge_type?: "veo" | "sora2";
}

/** 生成角色图片请求体 */
export interface GenerateCharacterRequest {
  prompt: string;
  sourceImageUrl?: string;
  userId: string;
  type?: "hero" | "reference";
  heroImageUrl?: string;
}

/** 增强提示词请求体 */
export interface EnhancePromptRequest {
  prompt: string;
  mode: "expand" | "translate";
}

/** 通用 API 成功响应 */
export interface CharacterApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
