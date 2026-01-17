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
3. Include 2-3 topic hashtags (trending/discoverable)
4. Include 3-5 content tags for algorithm discovery

Output Format: Valid JSON array only, no explanations, no markdown code blocks.
[
  {
    "title": "The engaging title text",
    "topics": ["#topic1", "#topic2"],
    "tags": ["#tag1", "#tag2", "#tag3"]
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
3. 话题: 2-3个热门话题标签 (如 #穿搭分享 #美妆教程)
4. 标签: 3-5个发现标签 (如 #fyp #推荐 #热门)
5. 每条标题要独特，避免重复
6. 适合中国用户习惯和热点

返回严格的JSON数组格式，不要任何解释、注释或markdown代码块。`,

    // 英文用户提示词模板
    user_en: `Generate {{COUNT}} engaging TikTok titles in English for videos about:

{{DESCRIPTION}}

Requirements:
1. Style: Catchy TikTok hooks that stop the scroll
2. Length: Title under 100 characters
3. Topics: 2-3 trending topic hashtags
4. Tags: 3-5 discovery tags for algorithm
5. Each title must be unique, no repetition
6. Optimized for Western TikTok audience

Return ONLY valid JSON array, no explanations, no markdown code blocks.`
};

// ============================================================================
// 类型定义
// ============================================================================

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
    language: 'zh' | 'en'
): Promise<GenerateTitlesResult> {
    // 动态导入避免循环依赖
    const { callDoubaoAPI } = await import('./doubao-api-client');

    if (!description || description.trim().length === 0) {
        return { success: false, error: '请输入视频内容描述' };
    }

    if (count <= 0 || count > 50) {
        return { success: false, error: '生成数量需在 1-50 之间' };
    }

    console.log(`[Title Generator] Generating ${count} titles in ${language} for: ${description.substring(0, 50)}...`);

    // 选择对应语言的提示词模板
    const userPromptTemplate = language === 'zh'
        ? TITLE_GENERATOR_PROMPTS.user_zh
        : TITLE_GENERATOR_PROMPTS.user_en;

    // 替换模板变量
    const userPrompt = userPromptTemplate
        .replace('{{COUNT}}', count.toString())
        .replace('{{DESCRIPTION}}', description);

    // 调用豆包 API
    const result = await callDoubaoAPI([
        { role: 'system', content: TITLE_GENERATOR_PROMPTS.system },
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
        }, index: number) => {
            const title = item.title || '';
            const topics = Array.isArray(item.topics) ? item.topics : [];
            const tags = Array.isArray(item.tags) ? item.tags : [];

            // 合并为完整字符串
            const allHashtags = [...topics, ...tags].filter(Boolean);
            const combined = allHashtags.length > 0
                ? `${title} ${allHashtags.join(' ')}`
                : title;

            return {
                index,
                title,
                topics,
                tags,
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
        ? `请为以下视频内容生成 1 条中文标题。\n\n视频内容描述:\n${description}\n\n要求: 标题风格吸引眼球，包含2-3个话题标签和3-5个发现标签。${avoidPrompt}\n\n返回严格的JSON数组格式。`
        : `Generate 1 engaging TikTok title in English for:\n\n${description}\n\nInclude 2-3 topic hashtags and 3-5 discovery tags.${avoidPrompt}\n\nReturn ONLY valid JSON array.`;

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
        const topics = Array.isArray(item.topics) ? item.topics : [];
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const allHashtags = [...topics, ...tags].filter(Boolean);
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
