/**
 * Prompt 组装模块
 * 
 * 功能：
 * - 从数据库获取 AI 模特的 trigger_word
 * - 将 trigger_word 注入到用户 Prompt 中
 * - 保证 trigger_word 对前端不可见
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface PromptAssemblyResult {
  final_prompt: string;
  model_used: boolean;
  trigger_word_injected: boolean;
}

export interface PromptAssemblyOptions {
  user_prompt: string;
  model_id?: string | null;
  source_image_url?: string | null;
  style?: string;
  aspect_ratio?: string;
}

// ============================================================================
// Mock 模特唤醒词数据库 (生产环境应从 Supabase 查询)
// ============================================================================

const MOCK_MODEL_TRIGGER_WORDS: Record<string, string> = {
  // 这些 ID 对应 mock-data.ts 中的模特 ID
  "model-001": "@luna_fashion_v1",      // Luna AI
  "model-002": "@alex_fitness_v1",      // Alex Storm
  "model-003": "@mia_beauty_v1",        // Mia Rose
  "model-004": "@max_tech_v1",          // Marcus Tech
  "model-005": "@sophia_lifestyle_v2",  // Sophia Chen
  "model-006": "@leo_food_v1",          // Leo Foodie
  "model-007": "@emma_luxury_v1",       // Emma Grace
  "model-008": "@jake_street_v1",       // Jake Urban
  "model-009": "@yuki_kawaii_v1",       // Yuki Tanaka
  "model-010": "@daniel_kstyle_v1",     // Daniel Kim
  
  // 也支持通过名字查询 (备用)
  "Luna AI": "@luna_fashion_v1",
  "Alex Storm": "@alex_fitness_v1",
  "Mia Rose": "@mia_beauty_v1",
  "Marcus Tech": "@max_tech_v1",
  "Sophia Chen": "@sophia_lifestyle_v2",
  "Leo Foodie": "@leo_food_v1",
  "Emma Grace": "@emma_luxury_v1",
  "Jake Urban": "@jake_street_v1",
  "Yuki Tanaka": "@yuki_kawaii_v1",
  "Daniel Kim": "@daniel_kstyle_v1",
  
  // Auto Match 模式 - AI 自动选择最佳模特
  "auto": "@ai_model_auto",
};

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 从数据库获取模特的 trigger_word
 * 
 * @param modelId - 模特 ID 或 "auto" (自动匹配)
 * @returns trigger_word 或 null
 */
export async function getModelTriggerWord(modelId: string): Promise<string | null> {
  // 生产环境：从 Supabase 查询
  // const { data, error } = await supabase
  //   .from('ai_models')
  //   .select('trigger_word')
  //   .eq('id', modelId)
  //   .eq('is_active', true)
  //   .single();
  // 
  // if (error || !data) return null;
  // return data.trigger_word;

  // 开发环境：使用 Mock 数据
  return MOCK_MODEL_TRIGGER_WORDS[modelId] || null;
}

/**
 * 组装最终发送给 Sora 2 API 的 Prompt
 * 
 * 逻辑：
 * 1. 如果有 model_id → 查询 trigger_word → 注入 "Featuring {trigger_word}, "
 * 2. 如果没有 model_id → 使用通用前缀 "Cinematic shot of product, "
 * 
 * @param options - 组装选项
 * @returns 组装结果
 */
export async function assemblePrompt(
  options: PromptAssemblyOptions
): Promise<PromptAssemblyResult> {
  const { user_prompt, model_id, source_image_url, style } = options;
  
  let final_prompt = "";
  let model_used = false;
  let trigger_word_injected = false;

  // 1. 处理模特唤醒词
  if (model_id) {
    const triggerWord = await getModelTriggerWord(model_id);
    
    if (triggerWord) {
      // 有唤醒词：注入到 Prompt 开头
      final_prompt = `Featuring ${triggerWord}, `;
      model_used = true;
      trigger_word_injected = true;
    } else {
      // 模特没有唤醒词：使用通用模特描述
      final_prompt = "Featuring AI model, ";
      model_used = true;
    }
  } else {
    // 没有选择模特：纯产品/场景展示
    final_prompt = "Cinematic shot of product, ";
  }

  // 2. 添加用户 Prompt
  if (user_prompt && user_prompt.trim()) {
    final_prompt += user_prompt.trim();
  } else {
    // 用户没有写 Prompt，使用默认描述
    final_prompt += "professional product showcase with dynamic movement";
  }

  // 3. 如果有参考图片，添加图片引导词
  if (source_image_url) {
    // 图生视频模式：强调基于图片的生成
    final_prompt = `Based on the reference image, ${final_prompt}`;
  }

  // 4. 添加风格修饰词（可选）
  if (style) {
    final_prompt += `. Style: ${style}`;
  }

  // 5. 添加通用品质提升词
  final_prompt += ". High quality, professional lighting, 4K resolution, viral TikTok style.";

  return {
    final_prompt,
    model_used,
    trigger_word_injected,
  };
}

/**
 * 简化版：直接组装 Prompt 字符串
 */
export async function assemblePromptString(
  userPrompt: string,
  modelId?: string | null,
  hasSourceImage?: boolean
): Promise<string> {
  const result = await assemblePrompt({
    user_prompt: userPrompt,
    model_id: modelId,
    source_image_url: hasSourceImage ? "placeholder" : undefined,
  });
  
  return result.final_prompt;
}

// ============================================================================
// Prompt 模板预设
// ============================================================================

export const PROMPT_TEMPLATES = {
  // 产品展示
  product_showcase: "Product rotating slowly with elegant lighting, showing all angles and details",
  
  // 模特展示产品
  model_with_product: "Model confidently presenting the product, natural movements, engaging expression",
  
  // 开箱视频
  unboxing: "Exciting unboxing experience, revealing product with anticipation and satisfaction",
  
  // 使用演示
  usage_demo: "Demonstrating product usage in real-life scenario, highlighting key features",
  
  // 生活方式
  lifestyle: "Product integrated into aspirational lifestyle scene, aesthetic and inspiring",
  
  // 对比展示
  before_after: "Showing transformation or comparison, dramatic reveal of product benefits",
};

/**
 * 获取带模板的完整 Prompt
 */
export function getTemplatedPrompt(
  templateKey: keyof typeof PROMPT_TEMPLATES,
  customAdditions?: string
): string {
  const base = PROMPT_TEMPLATES[templateKey];
  return customAdditions ? `${base}. ${customAdditions}` : base;
}

// ============================================================================
// 安全检查
// ============================================================================

/**
 * 检查 Prompt 中是否包含敏感词
 */
export function sanitizePrompt(prompt: string): string {
  // 移除可能泄露唤醒词的尝试
  let sanitized = prompt;
  
  // 移除 @ 开头的词（可能是唤醒词）
  sanitized = sanitized.replace(/@\w+/g, "[model]");
  
  // 移除 sks_ 类型的 LoRA 标记
  sanitized = sanitized.replace(/\bsks_\w+/gi, "[model]");
  
  // 移除 lora: 标记
  sanitized = sanitized.replace(/\blora:\w+/gi, "[style]");
  
  return sanitized;
}

/**
 * 验证用户输入的 Prompt 安全性
 */
export function validateUserPrompt(prompt: string): {
  isValid: boolean;
  sanitizedPrompt: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let sanitizedPrompt = prompt;
  
  // 检查是否尝试注入唤醒词
  if (/@\w+/.test(prompt)) {
    warnings.push("Detected @ symbol which may interfere with model system");
    sanitizedPrompt = sanitizePrompt(prompt);
  }
  
  // 检查长度
  if (prompt.length > 2000) {
    warnings.push("Prompt too long, may be truncated");
    sanitizedPrompt = sanitizedPrompt.substring(0, 2000);
  }
  
  return {
    isValid: warnings.length === 0,
    sanitizedPrompt,
    warnings,
  };
}

