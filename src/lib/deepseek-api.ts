/**
 * DeepSeek API 封装
 * 用于 AI 生成视频文案
 */

// API 密钥从环境变量获取
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1/chat/completions';

export type CaptionStyle = 'lively' | 'professional' | 'humorous' | 'poetic' | 'minimal';
export type CaptionMode = 'unified' | 'diverse';
export type CaptionLanguage = 'en' | 'zh';

interface GenerateCaptionsParams {
    keywords: string;
    style: CaptionStyle;
    count: number;
    mode: CaptionMode;
    maxLength?: number;
    language?: CaptionLanguage; // 语言选项，默认英文
    videoDurationSeconds?: number; // 视频时长（秒），用于匹配文案长度
}

interface DeepSeekError extends Error {
    code?: string;
    status?: number;
}

/**
 * 生成视频文案
 * @param params 生成参数
 * @returns 文案数组
 */
export async function generateCaptions({
    keywords,
    style,
    count,
    mode,
    maxLength = 50,
    language = 'en', // 默认英文
    videoDurationSeconds = 8, // 默认 8 秒
}: GenerateCaptionsParams): Promise<string[]> {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY in environment.');
    }

    // 根据语言选择风格描述
    const styleMapEn: Record<CaptionStyle, string> = {
        lively: 'Fun and energetic, young and casual tone',
        professional: 'Professional and formal, concise and impactful',
        humorous: 'Witty and fun, with light humor or trending phrases',
        poetic: 'Poetic and artistic, beautiful imagery',
        minimal: 'Minimalistic, one-liner punch',
    };

    const styleMapZh: Record<CaptionStyle, string> = {
        lively: '活泼有趣，使用轻松的语气和年轻化表达',
        professional: '专业正式，简洁有力，突出产品价值',
        humorous: '幽默风趣，带有轻微调侃或网络流行语',
        poetic: '富有诗意，优美的文字和意境',
        minimal: '极简风格，一句话点睛',
    };

    const styleMap = language === 'en' ? styleMapEn : styleMapZh;
    const langLabel = language === 'en' ? 'English' : 'Chinese';

    // 根据视频时长计算推荐文案长度
    // 英文: 约 2.5 词/秒 (正常语速)
    // 中文: 约 4 字/秒 (正常语速)
    const wordsPerSecond = language === 'en' ? 2.5 : 4;
    const recommendedLength = Math.round(videoDurationSeconds * wordsPerSecond);
    const minLength = Math.round(recommendedLength * 0.7);
    const maxLengthCalc = Math.min(maxLength, Math.round(recommendedLength * 1.3));

    const prompt = language === 'en'
        ? (mode === 'diverse'
            ? `Generate ${count} different short video captions in ${langLabel}.
               Keywords: ${keywords}
               Style: ${styleMap[style]}
               Video duration: ${videoDurationSeconds} seconds
               
               IMPORTANT Requirements:
               - Each caption should be ${minLength}-${maxLengthCalc} words (optimized for ${videoDurationSeconds} second video)
               - DO NOT use any emojis or special symbols
               - Each caption should have a slightly different style, avoid repetition
               - Suitable for video subtitles and voiceover
               - Use hashtags at the end if appropriate
               
               Return JSON format: {"captions": ["caption1", "caption2", ...]}`
            : `Generate 1 engaging short video caption in ${langLabel}.
               Keywords: ${keywords}
               Style: ${styleMap[style]}
               Video duration: ${videoDurationSeconds} seconds
               
               IMPORTANT Requirements:
               - Caption should be ${minLength}-${maxLengthCalc} words (optimized for ${videoDurationSeconds} second video)
               - DO NOT use any emojis or special symbols
               - Suitable for video subtitles and voiceover
               - Use hashtags at the end if appropriate
               
               Return JSON format: {"captions": ["caption"]}`)
        : (mode === 'diverse'
            ? `为短视频生成 ${count} 条不同的中文文案。
               关键词：${keywords}
               风格：${styleMap[style]}
               视频时长：${videoDurationSeconds} 秒
               
               重要要求：
               - 每条文案控制在 ${minLength}-${maxLengthCalc} 字（适合 ${videoDurationSeconds} 秒视频配音）
               - 禁止使用任何表情符号或特殊符号
               - 每条风格略有不同，避免重复
               - 适合作为视频字幕和配音文本
               - 可在末尾使用话题标签
               
               返回 JSON 格式：{"captions": ["文案1", "文案2", ...]}`
            : `为短视频生成 1 条吸引人的中文文案。
               关键词：${keywords}
               风格：${styleMap[style]}
               视频时长：${videoDurationSeconds} 秒
               
               重要要求：
               - 控制在 ${minLength}-${maxLengthCalc} 字（适合 ${videoDurationSeconds} 秒视频配音）
               - 禁止使用任何表情符号或特殊符号
               - 适合作为视频字幕和配音文本
               - 可在末尾使用话题标签
               
               返回 JSON 格式：{"captions": ["文案"]}`);


    const systemMessage = language === 'en'
        ? 'You are a short video caption expert, skilled at generating catchy and concise captions. Always return valid JSON format.'
        : '你是短视频文案专家，擅长生成简短有吸引力的文案。始终返回有效的 JSON 格式。';

    try {
        const response = await fetch(DEEPSEEK_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: systemMessage,
                    },
                    { role: 'user', content: prompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.8,
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            const error = new Error(`DeepSeek API error: ${response.status}`) as DeepSeekError;
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Empty response from DeepSeek API');
        }

        // 解析返回的 JSON
        const parsed = JSON.parse(content);
        const captions: string[] = parsed.captions || [parsed.caption] || [];

        if (captions.length === 0) {
            throw new Error('No captions generated');
        }

        // 统一模式：复制 N 份
        if (mode === 'unified') {
            return Array(count).fill(captions[0]);
        }

        // 多样模式：确保返回正确数量
        if (captions.length < count) {
            // 如果返回不足，循环填充
            const result: string[] = [];
            for (let i = 0; i < count; i++) {
                result.push(captions[i % captions.length]);
            }
            return result;
        }

        return captions.slice(0, count);
    } catch (error) {
        console.error('[DeepSeek API Error]:', error);
        throw error;
    }
}

/**
 * 获取可用的文案风格列表
 */
export const CAPTION_STYLES: { value: CaptionStyle; label: string; description: string }[] = [
    { value: 'lively', label: '活泼', description: '轻松有趣，年轻化' },
    { value: 'professional', label: '专业', description: '简洁正式，突出价值' },
    { value: 'humorous', label: '幽默', description: '风趣调侃，网络风格' },
    { value: 'poetic', label: '诗意', description: '优美文字，富有意境' },
    { value: 'minimal', label: '极简', description: '一句话点睛' },
];

// === 图文字幕生成 ===

export type TextOverlayMode = 'uniform' | 'diverse';

interface GenerateTextOverlaysParams {
    prompt: string;                    // 用户提示词
    mode: TextOverlayMode;             // 统一或多样
    count: number;                     // 生成数量（通常等于图片数）
    imageDescriptions?: string[];      // 图片描述（可选，用于更相关的文案）
    maxLength?: number;                // 每条最大字符数
    language?: CaptionLanguage;        // 语言选项，默认英文
}

/**
 * 生成图文字幕文案
 * @param params 生成参数
 * @returns 文案数组
 */
export async function generateTextOverlays({
    prompt,
    mode,
    count,
    imageDescriptions = [],
    maxLength = 50,
    language = 'en',  // 默认英文
}: GenerateTextOverlaysParams): Promise<string[]> {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY in environment.');
    }

    // 构建图片描述部分
    const imageContext = imageDescriptions.length > 0
        ? (language === 'en'
            ? `\nImage descriptions:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join('\n')}`
            : `\n图片描述：\n${imageDescriptions.map((desc, i) => `图片${i + 1}: ${desc}`).join('\n')}`)
        : '';

    const systemMessage = language === 'en'
        ? 'You are a short video caption expert, skilled at generating catchy and concise text overlays. Always return valid JSON format.'
        : '你是短视频文案专家，擅长生成简短有吸引力的图文叠加文案。始终返回有效的 JSON 格式。';

    const userPrompt = language === 'en'
        ? (mode === 'diverse'
            ? `Generate ${count} different text overlays for images.
User prompt: ${prompt}${imageContext}

Requirements:
- Generate exactly ${count} text overlays, one for each image
- Each text should be under ${maxLength} characters
- DO NOT use any emojis
- Text should be short and impactful, suitable for image overlay
- Each can have slight style variations while maintaining consistency

Return JSON format: {"texts": ["text1", "text2", ...]}`
            : `Generate 1 reusable text overlay for images.
User prompt: ${prompt}${imageContext}

Requirements:
- Generate 1 universal text for all images
- Keep it under ${maxLength} characters
- DO NOT use any emojis
- Text should be short and impactful, suitable for image overlay

Return JSON format: {"texts": ["text"]}`)
        : (mode === 'diverse'
            ? `为${count}张图片生成不同的叠加文案。
用户提示词：${prompt}${imageContext}

重要要求：
- 生成正好 ${count} 条文案，每条对应一张图片
- 每条文案控制在 ${maxLength} 字以内
- 禁止使用任何表情符号
- 文案应简短有力，适合作为图片叠加文字
- 每条风格可略有变化，但保持整体一致性

返回 JSON 格式：{"texts": ["文案1", "文案2", ...]}`
            : `生成1条可复用的图片叠加文案。
用户提示词：${prompt}${imageContext}

重要要求：
- 生成1条可用于所有图片的通用文案
- 控制在 ${maxLength} 字以内
- 禁止使用任何表情符号
- 文案应简短有力，适合作为图片叠加文字

返回 JSON 格式：{"texts": ["文案"]}`);

    try {
        const response = await fetch(DEEPSEEK_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userPrompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.8,
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            const error = new Error(`DeepSeek API error: ${response.status}`) as DeepSeekError;
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Empty response from DeepSeek API');
        }

        const parsed = JSON.parse(content);
        const texts: string[] = parsed.texts || [];

        if (texts.length === 0) {
            throw new Error('No texts generated');
        }

        // 统一模式：复制 N 份
        if (mode === 'uniform') {
            return Array(count).fill(texts[0]);
        }

        // 多样模式：确保返回正确数量
        if (texts.length < count) {
            const result: string[] = [];
            for (let i = 0; i < count; i++) {
                result.push(texts[i % texts.length]);
            }
            return result;
        }

        return texts.slice(0, count);
    } catch (error) {
        console.error('[DeepSeek TextOverlay Error]:', error);
        throw error;
    }
}

