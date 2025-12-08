/**
 * 电商图片工厂 - 豆包 AI 提示词生成服务
 * 
 * 调用豆包大模型为不同模式生成优化的图片提示词
 */

import type { 
  EcomImageMode, 
  ProductCategory, 
  SceneType,
  TryOnProductType,
  BuyerShowStyle,
  BuyerPersona,
} from "@/types/ecom-image";

// ============================================================================
// 配置
// ============================================================================

const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || "";
const DOUBAO_API_ENDPOINT = process.env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID || "";

// ============================================================================
// 类型定义
// ============================================================================

interface DoubaoMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GeneratePromptsParams {
  mode: EcomImageMode;
  language: "zh" | "en";
  inputImageUrls: string[];
  modeConfig?: Record<string, unknown>;
}

interface GeneratePromptsResult {
  success: boolean;
  prompts?: Record<string, string>;
  error?: string;
}

// ============================================================================
// Prompt 模板
// ============================================================================

const SYSTEM_PROMPTS = {
  zh: `你是一个专业的电商图片文案助手，负责为 AI 图片生成模型编写高质量的提示词。

【最重要的规则】
用户会上传一张产品参考图。你生成的所有提示词都必须明确要求 AI 保持参考图中的产品完全不变。
产品的外形、颜色、材质、细节都必须与参考图保持一致，只能改变背景、场景、光线或角度。

你的提示词应该：
- 简洁明了，适合 AI 图片生成模型理解
- 专注于视觉描述，不包含产品功能说明
- 避免任何违法、违规、夸大宣传内容
- 每个提示词控制在 100-200 字以内
- 必须包含"keep the exact same product from reference"或类似指令`,

  en: `You are a professional e-commerce image copywriter, responsible for writing high-quality prompts for AI image generation models.

【MOST IMPORTANT RULE】
The user will upload a product reference image. All your prompts MUST explicitly instruct the AI to keep the product from the reference image EXACTLY the same.
The product's shape, color, material, and details must remain identical to the reference. Only the background, scene, lighting, or angle can be changed.

Your prompts should be:
- Clear and concise, suitable for AI image generation models
- Focused on visual descriptions, not product features
- Avoid any illegal, non-compliant, or exaggerated content
- Keep each prompt within 100-200 words
- MUST include "keep the exact same product from reference" or similar instruction`,
};

// 电商五图套装提示词模板
const FIVE_PACK_PROMPT_TEMPLATES = {
  zh: `请根据产品类型"{{CATEGORY}}"，为以下5种电商图片类型编写 AI 图片生成提示词：

【重要】用户上传了一张产品参考图，每个提示词都必须明确要求 AI 保持参考图中的产品完全不变！

1. 主图：保持产品不变，纯白背景，清晰展示产品外观
2. 场景图：保持产品不变，将产品放入真实使用场景
3. 细节图：保持产品不变，放大展示产品某个关键细节
4. 卖点图：保持产品不变，用视觉方式突出产品特点
5. 对比图：保持产品不变，展示使用效果对比

要求：
- 每个提示词必须以"Keep the EXACT SAME product from the reference image unchanged."开头
- 每个提示词单独一行
- 格式为：类型:提示词内容
- 只输出5行，不要多余解释
- 提示词用英文编写（因为 AI 图片模型对英文支持更好）

输出格式：
main:Keep the EXACT SAME product from the reference image unchanged. [场景描述]
scene:Keep the EXACT SAME product from the reference image unchanged. [场景描述]
detail:Keep the EXACT SAME product from the reference image unchanged. [场景描述]
selling:Keep the EXACT SAME product from the reference image unchanged. [场景描述]
compare:Keep the EXACT SAME product from the reference image unchanged. [场景描述]`,

  en: `Based on the product category "{{CATEGORY}}", write AI image generation prompts for these 5 types of e-commerce images:

【IMPORTANT】The user has uploaded a product reference image. Each prompt MUST explicitly require the AI to keep the product from the reference image EXACTLY the same!

1. Main: Keep product unchanged, pure white background, clear product appearance
2. Scene: Keep product unchanged, place in real-life usage scenario
3. Detail: Keep product unchanged, close-up of key product detail
4. Selling: Keep product unchanged, visually highlight selling points
5. Compare: Keep product unchanged, show before/after comparison

Requirements:
- Each prompt MUST start with "Keep the EXACT SAME product from the reference image unchanged."
- One prompt per line
- Format: type:prompt content
- Only output 5 lines, no extra explanations

Output format:
main:Keep the EXACT SAME product from the reference image unchanged. [scene description]
scene:Keep the EXACT SAME product from the reference image unchanged. [scene description]
detail:Keep the EXACT SAME product from the reference image unchanged. [scene description]
selling:Keep the EXACT SAME product from the reference image unchanged. [scene description]
compare:Keep the EXACT SAME product from the reference image unchanged. [scene description]`,
};

// 场景图提示词模板
const SCENE_PROMPT_TEMPLATES = {
  zh: `为这个产品生成一个"{{SCENE_TYPE}}"场景的图片提示词。

【重要】用户上传了一张产品参考图，提示词必须明确要求 AI 保持参考图中的产品完全不变！

要求：
- 提示词必须以"Keep the EXACT SAME product from the reference image unchanged."开头
- 提示词用英文编写
- 描述场景氛围、光线、产品位置
- 突出生活气息和真实感
- 只输出一行提示词，不要多余解释

输出格式：
scene:Keep the EXACT SAME product from the reference image unchanged. [场景描述]`,

  en: `Generate an image prompt for this product in a "{{SCENE_TYPE}}" scene.

【IMPORTANT】The user has uploaded a product reference image. The prompt MUST explicitly require the AI to keep the product EXACTLY the same!

Requirements:
- Prompt MUST start with "Keep the EXACT SAME product from the reference image unchanged."
- Describe the scene atmosphere, lighting, product placement
- Emphasize lifestyle feel and authenticity
- Only output one line of prompt

Output format:
scene:prompt content`,
};

// 试穿试戴提示词模板
const TRY_ON_PROMPT_TEMPLATES = {
  zh: `为这个{{PRODUCT_TYPE}}产品生成一个试穿/试戴图片的提示词。

【重要】用户上传了一张产品参考图，提示词必须明确要求 AI 保持参考图中的产品完全不变！

模特信息：{{MODEL_INFO}}

要求：
- 提示词必须以"Keep the EXACT SAME product from the reference image unchanged."开头
- 提示词用英文编写
- 描述模特姿态、产品穿戴方式、场景氛围
- 保持专业时尚摄影风格
- 避免不当内容
- 只输出一行提示词

输出格式：
try_on:Keep the EXACT SAME product from the reference image unchanged. [描述]`,

  en: `Generate a try-on image prompt for this {{PRODUCT_TYPE}} product.

【IMPORTANT】The user has uploaded a product reference image. The prompt MUST explicitly require the AI to keep the product EXACTLY the same!

Model info: {{MODEL_INFO}}

Requirements:
- Prompt MUST start with "Keep the EXACT SAME product from the reference image unchanged."
- Describe model pose, how product is worn, scene atmosphere
- Maintain professional fashion photography style
- Avoid inappropriate content
- Only output one line of prompt

Output format:
try_on:Keep the EXACT SAME product from the reference image unchanged. [description]`,
};

// 买家秀提示词模板
const BUYER_SHOW_PROMPT_TEMPLATES = {
  zh: `为这个产品生成一个"{{STYLE}}"风格的买家秀图片提示词。

【重要】用户上传了一张产品参考图，提示词必须明确要求 AI 保持参考图中的产品完全不变！

买家人设：{{PERSONA}}

要求：
- 提示词必须以"Keep the EXACT SAME product from the reference image unchanged."开头
- 提示词用英文编写
- 描述拍摄风格、场景、产品位置
- 保持真实、自然、生活化
- 像普通用户晒单，不要太专业
- 只输出一行提示词

输出格式：
buyer_show:Keep the EXACT SAME product from the reference image unchanged. [描述]`,

  en: `Generate a buyer show image prompt for this product in "{{STYLE}}" style.

【IMPORTANT】The user has uploaded a product reference image. The prompt MUST explicitly require the AI to keep the product EXACTLY the same!

Buyer persona: {{PERSONA}}

Requirements:
- Prompt MUST start with "Keep the EXACT SAME product from the reference image unchanged."
- Describe shooting style, scene, product placement
- Keep it authentic, natural, lifestyle-oriented
- Like a regular user sharing, not too professional
- Only output one line of prompt

Output format:
buyer_show:Keep the EXACT SAME product from the reference image unchanged. [description]`,
};

// ============================================================================
// 辅助函数
// ============================================================================

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 产品类目中英文映射
const CATEGORY_LABELS: Record<ProductCategory, { zh: string; en: string }> = {
  clothing: { zh: "服饰", en: "clothing/apparel" },
  beauty: { zh: "美妆", en: "beauty/cosmetics" },
  "3c": { zh: "3C数码", en: "electronics/gadgets" },
  home: { zh: "家居", en: "home/furniture" },
  food: { zh: "食品", en: "food/beverage" },
  other: { zh: "其他", en: "other products" },
};

// 场景类型中英文映射
const SCENE_TYPE_LABELS: Record<SceneType, { zh: string; en: string }> = {
  bedroom: { zh: "卧室", en: "bedroom" },
  living_room: { zh: "客厅", en: "living room" },
  kitchen: { zh: "厨房", en: "kitchen" },
  office: { zh: "办公室", en: "office" },
  outdoor: { zh: "户外", en: "outdoor" },
  sports: { zh: "运动", en: "sports" },
  beauty_desk: { zh: "美妆台", en: "vanity/beauty desk" },
  smart_recommend: { zh: "智能推荐", en: "lifestyle scene" },
};

// 产品类型中英文映射
const PRODUCT_TYPE_LABELS: Record<TryOnProductType, { zh: string; en: string }> = {
  clothing: { zh: "服装", en: "clothing" },
  shoes: { zh: "鞋子", en: "shoes/footwear" },
  accessories: { zh: "配饰", en: "accessories" },
  jewelry: { zh: "珠宝", en: "jewelry" },
};

// 买家秀风格中英文映射
const BUYER_STYLE_LABELS: Record<BuyerShowStyle, { zh: string; en: string }> = {
  selfie: { zh: "自拍风", en: "selfie style" },
  party: { zh: "聚会", en: "party/gathering" },
  family: { zh: "家庭", en: "family" },
  indoor: { zh: "室内", en: "indoor" },
  outdoor: { zh: "户外", en: "outdoor" },
  desk: { zh: "桌面", en: "desk/tabletop" },
  unboxing: { zh: "开箱", en: "unboxing" },
};

// ============================================================================
// 核心 API 调用
// ============================================================================

async function callDoubaoForPrompts(
  messages: DoubaoMessage[],
  maxRetries: number = 3
): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!DOUBAO_API_KEY || !DOUBAO_ENDPOINT_ID) {
    console.error("[Ecom Doubao] API not configured");
    return { success: false, error: "豆包 API 未配置" };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Ecom Doubao] Calling API (attempt ${attempt}/${maxRetries})`);

      const response = await fetch(DOUBAO_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DOUBAO_API_KEY}`,
        },
        body: JSON.stringify({
          model: DOUBAO_ENDPOINT_ID,
          messages,
          max_tokens: 2000,
          temperature: 0.7,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Ecom Doubao] API error:", response.status, errorText);
        
        if (response.status === 429 && attempt < maxRetries) {
          const waitTime = 5000 * attempt;
          console.log(`[Ecom Doubao] Rate limited, waiting ${waitTime}ms`);
          await delay(waitTime);
          continue;
        }
        
        return { success: false, error: `API 请求失败: ${response.status}` };
      }

      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        return { success: false, error: "API 返回结果为空" };
      }

      const content = data.choices[0].message.content;
      console.log("[Ecom Doubao] Success, content length:", content.length);
      
      return { success: true, content };
    } catch (error) {
      console.error("[Ecom Doubao] Error:", error);
      
      if (attempt < maxRetries) {
        await delay(3000 * attempt);
        continue;
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "网络请求失败" 
      };
    }
  }

  return { success: false, error: "API 请求失败" };
}

// 解析提示词响应
function parsePromptResponse(content: string): Record<string, string> {
  const prompts: Record<string, string> = {};
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    // 匹配格式：type:content 或 type: content
    const match = trimmedLine.match(/^(\w+)\s*:\s*(.+)$/);
    if (match) {
      const [, type, prompt] = match;
      prompts[type.toLowerCase()] = prompt.trim();
    }
  }
  
  return prompts;
}

// ============================================================================
// 主要导出函数
// ============================================================================

/**
 * 生成电商图片提示词
 */
export async function generateEcomPrompts(
  params: GeneratePromptsParams
): Promise<GeneratePromptsResult> {
  const { mode, language, modeConfig = {} } = params;

  console.log("[Ecom Doubao] Generating prompts:", { mode, language });

  const systemPrompt = SYSTEM_PROMPTS[language];
  let userPrompt = "";

  switch (mode) {
    case "ecom_five_pack": {
      const category = (modeConfig.product_category as ProductCategory) || "other";
      const categoryLabel = CATEGORY_LABELS[category]?.[language === "zh" ? "zh" : "en"] || category;
      userPrompt = FIVE_PACK_PROMPT_TEMPLATES[language].replace("{{CATEGORY}}", categoryLabel);
      break;
    }

    case "scene_image": {
      const sceneType = (modeConfig.scene_type as SceneType) || "smart_recommend";
      const sceneLabel = SCENE_TYPE_LABELS[sceneType]?.[language === "zh" ? "zh" : "en"] || sceneType;
      userPrompt = SCENE_PROMPT_TEMPLATES[language].replace("{{SCENE_TYPE}}", sceneLabel);
      break;
    }

    case "try_on": {
      const productType = (modeConfig.product_type as TryOnProductType) || "clothing";
      const productLabel = PRODUCT_TYPE_LABELS[productType]?.[language === "zh" ? "zh" : "en"] || productType;
      const modelInfo = modeConfig.model_name 
        ? `${modeConfig.model_name}${modeConfig.model_trigger_word ? ` (${modeConfig.model_trigger_word})` : ""}`
        : "professional AI model";
      
      userPrompt = TRY_ON_PROMPT_TEMPLATES[language]
        .replace("{{PRODUCT_TYPE}}", productLabel)
        .replace("{{MODEL_INFO}}", modelInfo);
      break;
    }

    case "buyer_show": {
      const style = (modeConfig.style as BuyerShowStyle) || "selfie";
      const styleLabel = BUYER_STYLE_LABELS[style]?.[language === "zh" ? "zh" : "en"] || style;
      
      const persona = modeConfig.persona as BuyerPersona | undefined;
      let personaDesc = "typical buyer";
      if (persona) {
        const parts: string[] = [];
        if (persona.age) parts.push(persona.age);
        if (persona.gender) parts.push(persona.gender === "female" ? "woman" : persona.gender === "male" ? "man" : "person");
        if (persona.region) parts.push(`from ${persona.region === "china" ? "China" : persona.region}`);
        personaDesc = parts.join(" ") || personaDesc;
      }
      
      userPrompt = BUYER_SHOW_PROMPT_TEMPLATES[language]
        .replace("{{STYLE}}", styleLabel)
        .replace("{{PERSONA}}", personaDesc);
      break;
    }

    case "white_background":
      // 白底图使用固定模板，不需要调用豆包
      return {
        success: true,
        prompts: {
          white_bg: "Keep the EXACT SAME product from the reference image unchanged. Place the product on a pure white background. Maintain all product details, colors, textures and shape exactly as in the reference. Professional studio lighting, soft even illumination, no harsh shadows, no extra objects, no text, no watermark. The product must be IDENTICAL to the reference image.",
        },
      };

    default:
      return { success: false, error: `不支持的模式: ${mode}` };
  }

  // 调用豆包 API
  const result = await callDoubaoForPrompts([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  if (!result.success || !result.content) {
    return { success: false, error: result.error || "提示词生成失败" };
  }

  // 解析响应
  const prompts = parsePromptResponse(result.content);
  
  if (Object.keys(prompts).length === 0) {
    console.error("[Ecom Doubao] Failed to parse prompts:", result.content);
    return { success: false, error: "提示词解析失败" };
  }

  console.log("[Ecom Doubao] Parsed prompts:", Object.keys(prompts));
  
  return { success: true, prompts };
}

/**
 * 生成电商五图套装提示词
 */
export async function generateEcomFivePackPrompts(
  productCategory: ProductCategory = "other",
  language: "zh" | "en" = "zh"
): Promise<GeneratePromptsResult> {
  return generateEcomPrompts({
    mode: "ecom_five_pack",
    language,
    inputImageUrls: [],
    modeConfig: { product_category: productCategory },
  });
}

/**
 * 生成场景图提示词
 */
export async function generateScenePrompt(
  sceneType: SceneType = "smart_recommend",
  language: "zh" | "en" = "zh"
): Promise<GeneratePromptsResult> {
  return generateEcomPrompts({
    mode: "scene_image",
    language,
    inputImageUrls: [],
    modeConfig: { scene_type: sceneType },
  });
}

/**
 * 生成试穿试戴提示词
 */
export async function generateTryOnPrompt(
  productType: TryOnProductType,
  modelInfo?: { model_name?: string; model_trigger_word?: string },
  language: "zh" | "en" = "zh"
): Promise<GeneratePromptsResult> {
  return generateEcomPrompts({
    mode: "try_on",
    language,
    inputImageUrls: [],
    modeConfig: {
      product_type: productType,
      ...modelInfo,
    },
  });
}

/**
 * 生成买家秀提示词
 */
export async function generateBuyerShowPrompt(
  style: BuyerShowStyle = "selfie",
  persona?: BuyerPersona,
  language: "zh" | "en" = "zh"
): Promise<GeneratePromptsResult> {
  return generateEcomPrompts({
    mode: "buyer_show",
    language,
    inputImageUrls: [],
    modeConfig: { style, persona },
  });
}

