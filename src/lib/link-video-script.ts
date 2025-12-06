/**
 * 链接秒变视频 - 脚本生成服务
 * 
 * 使用豆包 API 生成电商带货脚本
 */

import type { 
  VideoConfig, 
  ParsedProductData, 
  ManualProductInfo,
  VideoStyle,
  PlatformStyle,
  ScriptLanguage,
  LinkVideoDuration,
} from '@/types/link-video';

// ============================================================================
// 配置
// ============================================================================

const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || "";
const DOUBAO_API_ENDPOINT = process.env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID || "";

// ============================================================================
// Prompt 模板
// ============================================================================

/** 系统 Prompt */
const SYSTEM_PROMPT = `You are a professional TikTok/Douyin e-commerce short video script writer. You specialize in creating viral, conversion-focused product recommendation scripts.

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

/** 镜头数量配置 */
const SHOT_COUNTS: Record<LinkVideoDuration, { min: number; max: number }> = {
  10: { min: 3, max: 5 },
  15: { min: 5, max: 7 },
  25: { min: 7, max: 9 },
};

/** 视频风格描述 */
const STYLE_DESCRIPTIONS: Record<VideoStyle, string> = {
  selfie_talking: 'Selfie-style talking head video. The creator holds the camera, speaks directly to audience with enthusiasm and authenticity. Personal and relatable tone.',
  scene_plus_talking: 'Scene demonstration with voiceover. Show product in use while narrator explains benefits. Mix of product shots and lifestyle scenes.',
  product_only: 'Pure product showcase with text overlays and background music. Clean, professional product photography with animated text highlighting key features.',
};

/** 平台风格描述 */
const PLATFORM_DESCRIPTIONS: Record<PlatformStyle, string> = {
  tiktok_us: 'TikTok US audience: Casual, fun, trendy. Use American slang, pop culture references. Fast-paced, engaging hooks.',
  douyin_cn: '抖音中国观众：热情、直接、亲和力强。使用中国网络流行语，强调优惠和性价比。',
  generic: 'General global audience: Clear, professional, universally appealing. Avoid region-specific references.',
};

// ============================================================================
// 脚本生成函数
// ============================================================================

interface GenerateScriptParams {
  productInfo: ParsedProductData | ManualProductInfo;
  videoConfig: VideoConfig;
  modelProfile?: {
    name: string;
    gender: 'male' | 'female' | 'neutral' | null;
    ageRange: string | null;
    styleTags: string[];
  };
}

interface GenerateScriptResult {
  success: boolean;
  script?: string;
  error?: string;
}

/**
 * 生成带货脚本
 */
export async function generateLinkVideoScript(
  params: GenerateScriptParams
): Promise<GenerateScriptResult> {
  const { productInfo, videoConfig, modelProfile } = params;

  // 验证 API 配置
  if (!DOUBAO_API_KEY || !DOUBAO_ENDPOINT_ID) {
    console.error('[Script Generator] API not configured');
    return { success: false, error: '脚本生成服务未配置' };
  }

  // 构建 Prompt
  const userPrompt = buildUserPrompt(productInfo, videoConfig, modelProfile);

  try {
    console.log('[Script Generator] Generating script...', {
      duration: videoConfig.duration,
      style: videoConfig.video_style,
      platform: videoConfig.platform_style,
      language: videoConfig.language,
    });

    const response = await fetch(DOUBAO_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_ENDPOINT_ID,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Script Generator] API error:', response.status, errorText);
      return { success: false, error: `脚本生成失败: ${response.status}` };
    }

    const data = await response.json();
    const script = data.choices?.[0]?.message?.content;

    if (!script) {
      return { success: false, error: '生成的脚本为空' };
    }

    // 验证脚本格式
    const validatedScript = validateAndCleanScript(script, videoConfig.duration);

    console.log('[Script Generator] Generated script:', {
      length: validatedScript.length,
      shotCount: (validatedScript.match(/C\d{2}:/g) || []).length,
    });

    return { success: true, script: validatedScript };

  } catch (error) {
    console.error('[Script Generator] Error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '脚本生成失败' 
    };
  }
}

/**
 * 构建用户 Prompt
 */
function buildUserPrompt(
  productInfo: ParsedProductData | ManualProductInfo,
  videoConfig: VideoConfig,
  modelProfile?: GenerateScriptParams['modelProfile']
): string {
  const { duration, video_style, platform_style, language } = videoConfig;
  const shotCount = SHOT_COUNTS[duration];

  // 提取商品信息
  let title: string;
  let sellingPoints: string[];
  let price: string;

  if ('selling_points' in productInfo && Array.isArray(productInfo.selling_points)) {
    // ParsedProductData
    title = productInfo.title;
    sellingPoints = productInfo.selling_points;
    price = typeof productInfo.price === 'object' 
      ? `${productInfo.price.current}${productInfo.price.discount ? ` (${productInfo.price.discount})` : ''}`
      : productInfo.price;
  } else {
    // ManualProductInfo
    title = productInfo.title;
    sellingPoints = productInfo.selling_points.split(/[,，;；\n]/).filter(s => s.trim());
    price = productInfo.price;
  }

  // 构建 Prompt
  const prompt = `Write a ${language === 'zh' ? 'Chinese' : 'English'} TikTok-style product recommendation script.

【Video Configuration】
- Total Duration: ${duration} seconds
- Style: ${STYLE_DESCRIPTIONS[video_style]}
- Platform: ${PLATFORM_DESCRIPTIONS[platform_style]}
- Language: ${language === 'zh' ? '中文 (Simplified Chinese)' : 'English'}

【Product Information】
- Product: ${title}
- Key Selling Points:
${sellingPoints.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}
- Price: ${price}

${modelProfile ? `【AI Model/Creator Profile】
- Name: ${modelProfile.name}
- Gender: ${modelProfile.gender || 'neutral'}
- Age Range: ${modelProfile.ageRange || '25-35'}
- Style: ${modelProfile.styleTags?.join(', ') || 'professional, friendly'}
The script should match this creator's persona and speaking style.` : ''}

【Script Requirements】
1. Total duration: EXACTLY ${duration} seconds
2. Number of shots: ${shotCount.min}-${shotCount.max} shots (C01 to C0${shotCount.max})
3. Each shot must include:
   - Shot code: C01, C02, C03...
   - Duration: approximate seconds for this shot
   - Visual: camera angle, framing, what we see
   - Action: creator's movement, expression, gestures
   - Line: spoken dialogue in ${language === 'zh' ? 'Chinese' : 'English'}

4. Structure:
   - C01: STRONG HOOK - grab attention immediately (1-2 seconds)
   - Middle shots: Highlight 2-3 key selling points with demos/explanations
   - Final shot: Clear CTA with urgency

5. Format example:
C01: (2s) [Visual: Close-up selfie shot, bright lighting]
[Action: Creator looks surprised, points at product]
[Line: "OMG you guys need to see this!"]

C02: (3s) [Visual: Medium shot showing product]
[Action: Creator holds product, genuine excitement]
[Line: "This is the best thing I've bought all year..."]

Now generate the complete script:`;

  return prompt;
}

/**
 * 验证和清理脚本
 */
function validateAndCleanScript(script: string, duration: LinkVideoDuration): string {
  // 移除可能的 markdown 代码块
  let cleaned = script
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```/g, '')
    .trim();

  // 检查是否包含镜头标记
  const shotMatches = cleaned.match(/C\d{2}:/g);
  if (!shotMatches || shotMatches.length < 3) {
    // 脚本格式不正确，尝试添加基本格式
    console.warn('[Script Generator] Script format may be incorrect, shot count:', shotMatches?.length || 0);
  }

  // 移除多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned;
}

// ============================================================================
// Mock 脚本生成 (开发测试用)
// ============================================================================

/**
 * 生成 Mock 脚本
 */
export function generateMockScript(duration: LinkVideoDuration, language: ScriptLanguage): string {
  if (language === 'zh') {
    return `C01: (2秒) [画面: 自拍特写，明亮背景]
[动作: 创作者惊讶表情，手指指向镜头]
[台词: "家人们！我发现了一个超级好物！"]

C02: (3秒) [画面: 中景展示产品]
[动作: 双手捧着产品，眼神发光]
[台词: "就是这个，用了一个月真的爱上了"]

C03: (3秒) [画面: 产品特写，展示细节]
[动作: 手指划过产品，强调质感]
[台词: "你们看这个质感，这个做工，绝了！"]

C04: (3秒) [画面: 使用场景演示]
[动作: 边使用边介绍]
[台词: "每天用它，省时省力，效果超赞"]

C05: (2秒) [画面: 价格展示+购买引导]
[动作: 指向评论区，期待表情]
[台词: "链接在小黄车，冲！"]`;
  }

  return `C01: (2s) [Visual: Close-up selfie, bright background]
[Action: Creator looks excited, points at camera]
[Line: "Okay wait, you NEED to see this!"]

C02: (3s) [Visual: Medium shot showing product]
[Action: Holding product with both hands, genuine excitement]
[Line: "I've been using this for a month and I'm obsessed"]

C03: (3s) [Visual: Product close-up, showing details]
[Action: Fingers tracing product, emphasizing quality]
[Line: "Look at this quality, the craftsmanship is insane"]

C04: (3s) [Visual: Demonstration in use]
[Action: Using product while explaining]
[Line: "It saves me so much time every single day"]

C05: (2s) [Visual: Price display + CTA]
[Action: Pointing down, expectant expression]
[Line: "Link in bio, go go go!"]`;
}


