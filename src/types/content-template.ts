// ============================================================================
// 模板中心 - 类型定义
// 对应数据库表：content_templates、user_template_favorites
// ============================================================================

/**
 * 模板分类
 */
export type TemplateCategory =
  | 'ecommerce'   // 电商带货
  | 'brand'       // 品牌营销
  | 'tutorial'    // 知识教程
  | 'lifestyle'   // 生活方式
  | 'creative'    // 创意内容
  | 'engagement'; // 互动引导

/**
 * 分类显示名称映射
 */
export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  ecommerce: '电商带货',
  brand: '品牌营销',
  tutorial: '知识教程',
  lifestyle: '生活方式',
  creative: '创意内容',
  engagement: '互动引导',
};

/**
 * 所有分类列表（用于筛选 UI）
 */
export const ALL_CATEGORIES: TemplateCategory[] = [
  'ecommerce',
  'brand',
  'tutorial',
  'lifestyle',
  'creative',
  'engagement',
];

/**
 * 推荐配置
 */
export interface TemplateRecommendedConfig {
  duration?: string;
  aspect_ratio?: string;
  model?: string;
  scene?: string;
  [key: string]: string | undefined;
}

/**
 * 内容模板（对应 content_templates 表）
 */
export interface ContentTemplate {
  id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  prompt_template: string;
  script_outline: string[];
  style_tags: string[];
  recommended_config: TemplateRecommendedConfig;
  preview_video_url: string | null;
  usage_count: number;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * 用户收藏（对应 user_template_favorites 表）
 */
export interface TemplateFavorite {
  id: string;
  user_id: string;
  template_id: string;
  created_at: string;
}
