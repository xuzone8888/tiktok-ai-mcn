/**
 * AI 标题助手 - 标题生成核心模块
 * 
 * 使用豆包大模型生成 TikTok 视频标题、话题和标签
 */

// ============================================================================
// Prompt 模板 (后台固定，用户不可见)
// ============================================================================

const TITLE_GENERATOR_PROMPTS = {
    // 系统提示词
    system: `You are a professional TikTok content strategist specializing in creating scroll-stopping titles that maximize engagement. You understand TikTok's algorithm and user behavior patterns.

Your task is to generate engaging video titles with relevant hashtags. Each title should:
1. Use proven hooks (curiosity gaps, emotions, transformations)
2. Be concise but impactful
3. Include a MAXIMUM of 5 hashtags total (mix of topic and discovery tags)
4. IMPORTANT: TikTok strictly limits to 5 hashtags per post. Never exceed this.

Output Format: Valid JSON array only, no explanations, no markdown code blocks.
[
  {
    "title": "The engaging title text",
    "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
  }
]

Title Hook Patterns to Use:
- "This changed my..." / "I can't believe..."
- "The secret to..." / "Why nobody talks about..."
- "Stop doing X, do this instead"
- "POV: You discovered..." / "Day in my life..."
- Numbers: "5 ways to...", "The $10 trick..."
- Questions: "Why is everyone...?", "Did you know...?"`,
    // 中文用户提示词模板
    user_zh: `请为以下视频内容生成 {{COUNT}} 条中文 TikTok/抖音 标题。

视频内容描述:
{{DESCRIPTION}}

要求:
1. 标题风格: 抖音爆款风格，吸引眼球，有创意
2. 长度: 标题主体不超过50个汉字
3. 标签: 最多5个标签（话题+发现标签合计不超过5个）
4. 每条标题要独特，避免重复
5. 适合中国用户习惯和热点
6. 严格要求: TikTok限制每个视频最多5个Hashtag，绝对不能超过

返回严格的JSON数组格式，不要任何解释、注释或markdown代码块。
每个元素格式: {"title": "标题文字", "hashtags": ["#标签1", "#标签2", ...]}`,

    // 英文用户提示词模板
    user_en: `Generate {{COUNT}} engaging TikTok titles in English for videos about:

{{DESCRIPTION}}

Requirements:
1. Style: Catchy TikTok hooks that stop the scroll
2. Length: Title under 100 characters
3. Hashtags: Maximum 5 hashtags total (mix of topic and discovery tags)
4. Each title must be unique, no repetition
5. Optimized for Western TikTok audience
6. STRICT: TikTok limits 5 hashtags per post, never exceed this

Return ONLY valid JSON array, no explanations, no markdown code blocks.
Each element format: {"title": "Title text", "hashtags": ["#tag1", "#tag2", ...]}`
};

const YOUTUBE_TITLE_GENERATOR_PROMPTS = {
    system: `You are a professional YouTube content strategist. Generate clear, specific, search-friendly video titles that match viewer intent and are suitable for YouTube recommendations.

Each title should:
1. Be natural and ready to publish on YouTube
2. Be specific about the video's core value or topic
3. Avoid exaggerated clickbait and unrelated short-form platform hooks
4. Keep the title under 100 characters when possible
5. Do not put hashtags in the title

Output Format: Valid JSON array only, no explanations, no markdown code blocks.
[
  {
    "title": "Title text",
    "hashtags": []
  }
]`,
    user_zh: `请为以下视频内容生成 {{COUNT}} 条中文 YouTube 标题。

视频内容描述:
{{DESCRIPTION}}

要求:
1. 标题清晰、具体，适合 YouTube 搜索和推荐
2. 准确表达视频核心看点或用户意图
3. 避免夸张标题党和无关短视频平台风格
4. 标题尽量控制在 90-100 个字符以内
5. 不要把 hashtag 放进标题
6. 每条标题要独特，避免重复

返回严格的JSON数组格式，不要任何解释、注释或markdown代码块。
每个元素格式: {"title": "标题文字", "hashtags": []}`,

    user_en: `Generate {{COUNT}} English YouTube titles for videos about:

{{DESCRIPTION}}

Requirements:
1. Make each title clear, specific, search-friendly, and aligned with viewer intent
2. Highlight the core value or topic of the video accurately
3. Avoid exaggerated clickbait and unrelated short-form platform hooks
4. Keep each title under 100 characters when possible
5. Do not include hashtags in the title
6. Each title must be unique, no repetition

Return ONLY valid JSON array, no explanations, no markdown code blocks.
Each element format: {"title": "Title text", "hashtags": []}`
};

// ============================================================================
// 类型定义
// ============================================================================

export type TitleGenerationPlatform = 'tiktok' | 'youtube'

export interface GeneratedTitle {
    index: number
    title: string
    topics: string[]
    tags: string[]
    combined: string  // 合并后的完整字符串
}

export interface GenerateTitlesResult {
    success: boolean
    titles?: GeneratedTitle[]
    error?: string
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 调用豆包 API 生成标题
 */
export async function generateTitles(
    description: string,
    count: number,
    language: 'zh' | 'en',
    platform: TitleGenerationPlatform = 'tiktok'
): Promise<GenerateTitlesResult> {
    // 动态导入避免循环依赖
    const { callDoubaoAPI } = await import('./doubao-api-client');

    if (!description || description.trim().length === 0) {
        return { success: false, error: '请输入视频内容描述' };
    }

    if (count <= 0 || count > 50) {
        return { success: false, error: '生成数量需在 1-50 之间' };
    }

    console.log(`[Title Generator] Generating ${platform} titles (${count}) in ${language} for: ${description.substring(0, 50)}...`);

    const prompts = platform === 'youtube'
        ? YOUTUBE_TITLE_GENERATOR_PROMPTS
        : TITLE_GENERATOR_PROMPTS;

    // 选择对应语言的提示词模板
    const userPromptTemplate = language === 'zh'
        ? prompts.user_zh
        : prompts.user_en;

    // 替换模板变量
    const userPrompt = userPromptTemplate
        .replace('{{COUNT}}', count.toString())
        .replace('{{DESCRIPTION}}', description);

    // 调用豆包 API
    const result = await callDoubaoAPI([
        { role: 'system', content: prompts.system },
        { role: 'user', content: userPrompt }
    ], {
        maxTokens: 4000,
        temperature: 0.8,  // 稍高的温度增加创意
    });

    if (!result.success) {
        return { success: false, error: result.error || '生成失败' };
    }

    // 解析 JSON 响应
    try {
        const content = result.content || '';

        // 尝试清理可能的 markdown 代码块
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.slice(7);
        }
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.slice(3);
        }
        if (jsonStr.endsWith('```')) {
            jsonStr = jsonStr.slice(0, -3);
        }
        jsonStr = jsonStr.trim();

        const parsed = JSON.parse(jsonStr);

        if (!Array.isArray(parsed)) {
            console.error('[Title Generator] Response is not an array:', parsed);
            return { success: false, error: 'AI 返回格式错误，请重试' };
        }

        // 格式化输出
        const titles: GeneratedTitle[] = parsed.slice(0, count).map((item: {
            title?: string;
            topics?: string[];
            tags?: string[];
            hashtags?: string[];
        }, index: number) => {
            const title = item.title || '';
            // Support both old format (topics+tags) and new format (hashtags)
            const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];
            const topics = Array.isArray(item.topics) ? item.topics : [];
            const tags = Array.isArray(item.tags) ? item.tags : [];

            const allHashtags = platform === 'youtube'
                ? []
                // Merge and hard-cap at 5 hashtags (TikTok API limit)
                : (hashtags.length > 0 ? hashtags : [...topics, ...tags])
                    .filter(Boolean)
                    .slice(0, 5);
            const combined = allHashtags.length > 0
                ? `${title} ${allHashtags.join(' ')}`
                : title;

            return {
                index,
                title,
                topics: platform === 'youtube' ? [] : topics,
                tags: platform === 'youtube' ? [] : tags,
                combined
            };
        });

        console.log(`[Title Generator] Successfully generated ${titles.length} titles`);
        return { success: true, titles };

    } catch (parseError) {
        console.error('[Title Generator] Failed to parse response:', parseError, result.content?.substring(0, 200));
        return { success: false, error: 'AI 返回格式解析失败，请重试' };
    }
}

/**
 * 生成单条标题 (用于重新生成)
 */
export async function regenerateSingleTitle(
    description: string,
    language: 'zh' | 'en',
    existingTitles: string[]  // 已有标题，用于避免重复
): Promise<GenerateTitlesResult> {
    const { callDoubaoAPI } = await import('./doubao-api-client');

    const avoidPrompt = existingTitles.length > 0
        ? `\n\nIMPORTANT: Avoid these existing titles:\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : '';

    const basePrompt = language === 'zh'
        ? `请为以下视频内容生成 1 条中文标题。\n\n视频内容描述:\n${description}\n\n要求: 标题风格吸引眼球，最多包含5个标签（话题+发现标签合计不超过5个）。${avoidPrompt}\n\n返回严格的JSON数组格式，每个元素格式: {"title": "标题", "hashtags": ["#标签1", ...]}`
        : `Generate 1 engaging TikTok title in English for:\n\n${description}\n\nInclude a maximum of 5 hashtags total.${avoidPrompt}\n\nReturn ONLY valid JSON array, format: {"title": "Title", "hashtags": ["#tag1", ...]}`;

    const result = await callDoubaoAPI([
        { role: 'system', content: TITLE_GENERATOR_PROMPTS.system },
        { role: 'user', content: basePrompt }
    ], {
        maxTokens: 500,
        temperature: 0.9,  // 更高温度确保差异化
    });

    if (!result.success) {
        return { success: false, error: result.error };
    }

    try {
        let jsonStr = (result.content || '').trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const parsed = JSON.parse(jsonStr);
        const item = Array.isArray(parsed) ? parsed[0] : parsed;

        const title = item.title || '';
        const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];
        const topics = Array.isArray(item.topics) ? item.topics : [];
        const tags = Array.isArray(item.tags) ? item.tags : [];
        // Hard-cap at 5 hashtags
        const allHashtags = (hashtags.length > 0 ? hashtags : [...topics, ...tags])
            .filter(Boolean)
            .slice(0, 5);
        const combined = allHashtags.length > 0
            ? `${title} ${allHashtags.join(' ')}`
            : title;

        return {
            success: true,
            titles: [{
                index: 0,
                title,
                topics,
                tags,
                combined
            }]
        };
    } catch (parseError) {
        console.error('[Title Generator] Failed to parse single title:', parseError);
        return { success: false, error: '解析失败，请重试' };
    }
}
