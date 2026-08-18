/**
 * 种子配方 — link-video prompt 骨架转生(S2.4 拆除时摘取)
 *
 * BLUEPRINT §一裁决:link-video 值得回收的是 link-video-script.ts 的 prompt 骨架
 * (hook/卖点/CTA + 镜头码 + 平台风格),转为配方库(S4)首批种子配方。
 * §三:配方 = Blueprint 去实例化——保留 hook 模式 / scene 结构 / beat 序列 /
 * 渲染预设,商品具体值以 {商品名} {卖点N} 槽位表达。
 *
 * 本文件是纯数据 + 纯函数(零 IO 零依赖),配方库落地前先由蓝图服务按需取用。
 * 原文出处:src/lib/link-video-script.ts(已随 link-video 模块删除)。
 */

// ============================================================================
// 类型(自包含,不依赖已删除的 types/link-video)
// ============================================================================

export type RecipeDuration = 10 | 15 | 25;
export type RecipeStyle = "selfie_talking" | "scene_plus_talking" | "product_only";
export type RecipePlatform = "tiktok_us" | "douyin_cn" | "generic";
export type RecipeLanguage = "zh" | "en";

export interface RecipeProductSlots {
  /** {商品名} */
  title: string;
  /** {卖点1..N} */
  sellingPoints: string[];
  /** {价格}(可空) */
  price?: string;
}

export interface RecipeCreatorProfile {
  name: string;
  gender?: "male" | "female" | "neutral" | null;
  ageRange?: string | null;
  styleTags?: string[];
}

// ============================================================================
// 骨架常量(原文照搬)
// ============================================================================

/** 系统 prompt:电商带货短视频编剧 persona + 输出格式铁律(镜头码 C01/C02…) */
export const ECOM_SCRIPT_SYSTEM_PROMPT = `You are a professional TikTok/Douyin e-commerce short video script writer. You specialize in creating viral, conversion-focused product recommendation scripts.

Core principles:
- Hook viewers in the first 2 seconds with attention-grabbing content
- Highlight product BENEFITS, not just features
- Use natural, conversational language that feels authentic
- Include clear call-to-action at the end
- Match script length PRECISELY to video duration
- Write in the specified language with appropriate cultural tone

Output format rules:
- Output ONLY the script, no explanations or meta text
- Each shot starts with shot code (C01, C02, etc.)
- Include: duration estimate, visual description, action, spoken line
- NO headers like "Shot 1" or "Scene 1", only C01, C02 format`;

/** 时长 → 镜头数(beat 序列长度的经验值) */
export const SHOT_COUNTS: Record<RecipeDuration, { min: number; max: number }> = {
  10: { min: 3, max: 5 },
  15: { min: 5, max: 7 },
  25: { min: 7, max: 9 },
};

/** 三种成片风格(渲染预设的脚本侧描述) */
export const STYLE_DESCRIPTIONS: Record<RecipeStyle, string> = {
  selfie_talking:
    "Selfie-style talking head video. The creator holds the camera, speaks directly to audience with enthusiasm and authenticity. Personal and relatable tone.",
  scene_plus_talking:
    "Scene demonstration with voiceover. Show product in use while narrator explains benefits. Mix of product shots and lifestyle scenes.",
  product_only:
    "Pure product showcase with text overlays and background music. Clean, professional product photography with animated text highlighting key features.",
};

/** 平台语感(投放地区文化基调) */
export const PLATFORM_DESCRIPTIONS: Record<RecipePlatform, string> = {
  tiktok_us:
    "TikTok US audience: Casual, fun, trendy. Use American slang, pop culture references. Fast-paced, engaging hooks.",
  douyin_cn: "抖音中国观众：热情、直接、亲和力强。使用中国网络流行语，强调优惠和性价比。",
  generic:
    "General global audience: Clear, professional, universally appealing. Avoid region-specific references.",
};

/** 显示名(配方库 UI 用) */
export const RECIPE_STYLE_NAMES: Record<RecipeStyle, string> = {
  selfie_talking: "达人自拍口播种草",
  scene_plus_talking: "场景演示+口播",
  product_only: "纯产品展示+字幕",
};

export const RECIPE_PLATFORM_NAMES: Record<RecipePlatform, string> = {
  tiktok_us: "TikTok 美区",
  douyin_cn: "国内抖音",
  generic: "通用",
};

/**
 * beat 结构规则(配方核心):C01 强钩子 1-2s → 中段 2-3 个卖点演示 → 末镜紧迫 CTA。
 * 与 Blueprint.scenes 的 beat 序列(hook → point/demo… → cta)同构。
 */
export const ECOM_BEAT_STRUCTURE = [
  "C01: STRONG HOOK - grab attention immediately (1-2 seconds)",
  "Middle shots: Highlight 2-3 key selling points with demos/explanations",
  "Final shot: Clear CTA with urgency",
] as const;

// ============================================================================
// 骨架模板函数(原 buildUserPrompt 去实例化)
// ============================================================================

/**
 * 电商脚本 user prompt(镜头码/时长/Visual/Action/Line 四要素逐镜结构)。
 * 商品信息经 slots 传入;产出脚本可由 segmenter/正则按 C\d{2}: 切镜,
 * 逐镜喂 AI 生成腿(scene 结构贯穿到生成端)。
 */
export function buildEcomScriptPrompt(options: {
  product: RecipeProductSlots;
  duration: RecipeDuration;
  style: RecipeStyle;
  platform: RecipePlatform;
  language: RecipeLanguage;
  creator?: RecipeCreatorProfile;
}): string {
  const { product, duration, style, platform, language, creator } = options;
  const shotCount = SHOT_COUNTS[duration];

  return `Write a ${language === "zh" ? "Chinese" : "English"} TikTok-style product recommendation script.

【Video Configuration】
- Total Duration: ${duration} seconds
- Style: ${STYLE_DESCRIPTIONS[style]}
- Platform: ${PLATFORM_DESCRIPTIONS[platform]}
- Language: ${language === "zh" ? "中文 (Simplified Chinese)" : "English"}

【Product Information】
- Product: ${product.title}
- Key Selling Points:
${product.sellingPoints.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}
${product.price ? `- Price: ${product.price}` : ""}

${
  creator
    ? `【AI Model/Creator Profile】
- Name: ${creator.name}
- Gender: ${creator.gender || "neutral"}
- Age Range: ${creator.ageRange || "25-35"}
- Style: ${creator.styleTags?.join(", ") || "professional, friendly"}
The script should match this creator's persona and speaking style.`
    : ""
}

【Script Requirements】
1. Total duration: EXACTLY ${duration} seconds
2. Number of shots: ${shotCount.min}-${shotCount.max} shots (C01 to C0${shotCount.max})
3. Each shot must include:
   - Shot code: C01, C02, C03...
   - Duration: approximate seconds for this shot
   - Visual: camera angle, framing, what we see
   - Action: creator's movement, expression, gestures
   - Line: spoken dialogue in ${language === "zh" ? "Chinese" : "English"}

4. Structure:
   - ${ECOM_BEAT_STRUCTURE[0]}
   - ${ECOM_BEAT_STRUCTURE[1]}
   - ${ECOM_BEAT_STRUCTURE[2]}

5. Format example:
C01: (2s) [Visual: Close-up selfie shot, bright lighting]
[Action: Creator looks surprised, points at product]
[Line: "OMG you guys need to see this!"]

C02: (3s) [Visual: Medium shot showing product]
[Action: Creator holds product, genuine excitement]
[Line: "This is the best thing I've bought all year..."]

Now generate the complete script:`;
}

/** 产出脚本清理:去 markdown 围栏、压缩空行(镜头码校验由调用方按需做) */
export function cleanEcomScript(script: string): string {
  return script
    .replace(/```[\s\S]*?```/g, "")
    .replace(/```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================================
// 种子配方清单(配方库 S4 首批;render_mode 预设与 Blueprint 对齐)
// ============================================================================

export interface SeedRecipe {
  id: string;
  name: string;
  style: RecipeStyle;
  platform: RecipePlatform;
  duration: RecipeDuration;
  renderMode: "slideshow" | "ai_gen" | "assembly";
  description: string;
}

export const SEED_RECIPES: SeedRecipe[] = [
  {
    id: "seed-selfie-tiktok-15",
    name: "美区自拍种草 15s",
    style: "selfie_talking",
    platform: "tiktok_us",
    duration: 15,
    renderMode: "ai_gen",
    description: "达人自拍口播,前 2 秒强钩子,5-7 镜,美式语感,末镜紧迫 CTA。",
  },
  {
    id: "seed-scene-douyin-15",
    name: "抖音场景演示 15s",
    style: "scene_plus_talking",
    platform: "douyin_cn",
    duration: 15,
    renderMode: "ai_gen",
    description: "场景演示+口播,强调优惠与性价比,网络流行语,小黄车 CTA。",
  },
  {
    id: "seed-product-generic-10",
    name: "纯产品展示 10s",
    style: "product_only",
    platform: "generic",
    duration: 10,
    renderMode: "slideshow",
    description: "纯产品图+字幕+BGM,3-5 镜轮播,全球通用语感,幻灯片腿最低成本。",
  },
];
