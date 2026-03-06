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
    style?: CaptionStyle;  // 保留向后兼容，但 AI 现在自动判断风格
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
 * 修正文案字数：超长精简、太短扩写（用 AI 保持内容完整性）
 * 比裁剪更好——AI 会重新组织语言而不是截断
 */
async function fixCaptionLength(
    text: string,
    minLen: number,
    maxLen: number,
    language: CaptionLanguage = 'en'
): Promise<string> {
    const isZh = language === 'zh';
    // 🔧 英文用单词数比较，中文用字符数（minLen/maxLen 对英文是词数，对中文是字数）
    const len = isZh ? text.length : text.split(/\s+/).filter(w => w).length;

    // 在合格范围内，直接返回
    if (len >= minLen && len <= maxLen) {
        console.log(`[DeepSeek] Caption OK: ${len}${isZh ? '字' : ' words'} (${minLen}-${maxLen})`);
        return text;
    }

    const unit = isZh ? '字' : 'words';

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            let fixPrompt: string;
            if (len > maxLen) {
                // 超长 → 精简
                fixPrompt = isZh
                    ? `请将以下文案精简到 ${maxLen} ${unit}以内（含标点），保持核心意思和语气不变，不要加任何额外内容。直接输出精简后的文案，不要加引号或其他格式：\n\n${text}`
                    : `Shorten the following to within ${maxLen} ${unit}, keeping the core message and tone. Output only the shortened text:\n\n${text}`;
            } else {
                // 太短 → 扩写
                fixPrompt = isZh
                    ? `请将以下文案扩写到 ${minLen}-${maxLen} ${unit}（含标点），保持原有语气和主题，自然地补充细节。直接输出扩写后的文案，不要加引号或其他格式：\n\n${text}`
                    : `Expand the following to ${minLen}-${maxLen} ${unit}, keeping the original tone. Output only the expanded text:\n\n${text}`;
            }

            const response = await fetch(DEEPSEEK_API_BASE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: fixPrompt }],
                    temperature: 0.5,  // 低温度 = 更精确
                    max_tokens: 300,
                }),
            });

            if (!response.ok) break;

            const data = await response.json();
            const fixed = (data.choices?.[0]?.message?.content || '').trim()
                .replace(/^["「『""]/g, '').replace(/["」』"""]$/g, '');  // 去除 AI 可能加的引号

            const fixedLen = isZh ? fixed.length : fixed.split(/\s+/).filter((w: string) => w).length;
            if (fixed && fixedLen >= minLen && fixedLen <= maxLen) {
                console.log(`[DeepSeek] Caption FIXED: ${len} → ${fixedLen} ${unit} ✅ (attempt ${attempt + 1})`);
                return fixed;
            }

            // 如果修正后还是不合格但比原来更接近目标，也接受
            if (fixed && Math.abs(fixedLen - (minLen + maxLen) / 2) < Math.abs(len - (minLen + maxLen) / 2)) {
                console.log(`[DeepSeek] Caption IMPROVED: ${len} → ${fixedLen} ${unit} (closer to target, attempt ${attempt + 1})`);
                if (attempt === 1) return fixed;
            }
        } catch (e) {
            console.warn(`[DeepSeek] fixCaptionLength attempt ${attempt + 1} failed:`, e);
            break;
        }
    }

    // 重试都失败，返回原文（兜底的裁剪逻辑在 TTS 前会处理）
    console.warn(`[DeepSeek] Caption fix failed, returning original: ${len}字`);
    return text;
}

/**
 * 生成视频文案
 * @param params 生成参数
 * @returns 文案数组
 */
export async function generateCaptions({
    keywords,
    // style 保留向后兼容但不再用于 prompt（AI 自动判断）
    style: _style,
    count,
    mode,
    maxLength = 50,
    language = 'en', // 默认英文
    videoDurationSeconds = 8, // 默认 8 秒
}: GenerateCaptionsParams): Promise<string[]> {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY in environment.');
    }

    const langLabel = language === 'en' ? 'English' : 'Chinese';
    const lengthUnit = language === 'en' ? 'words' : '字';

    // 根据视频时长计算推荐文案长度
    // 英文: 约 2.5 词/秒 (正常语速, 适合 TTS 播报)
    // 中文: 约 4.5 字/秒 (豆包 TTS 实测含标点停顿约 4.5-4.8 字/秒)
    const wordsPerSecond = language === 'en' ? 2.5 : 4.5;
    const recommendedLength = Math.round(videoDurationSeconds * wordsPerSecond);
    const minLength = Math.round(recommendedLength * 0.85); // 至少填满 85% 时长
    const maxLengthCalc = Math.min(maxLength, Math.round(recommendedLength * 1.1));  // 🔧 1.1 倍上限（从 1.4 收紧）

    // ═══ 三层 Prompt 架构 ═══
    // 第一层：System Message（角色 + 绝对规则）
    const systemMessage = language === 'en'
        ? `You are a top-tier TikTok/Reels voiceover script writer.

ABSOLUTE RULES — These MUST be followed NO MATTER WHAT the user says:
1. LENGTH: Each script MUST be ${minLength}-${maxLengthCalc} ${lengthUnit}. This video is ~${videoDurationSeconds} seconds long — content is read aloud by TTS at natural speaking speed.
2. FORMAT: Return ONLY valid JSON: {"captions": ["text1", ...]}. No markdown.
3. NO EMOJIS, NO SPECIAL SYMBOLS (♥★●→), NO HASHTAGS (#). Reason: The text is rendered by FFmpeg + TTS engine which cannot process these characters — they will cause rendering errors or be read aloud incorrectly.
4. PURE TEXT ONLY: Use only standard letters, numbers, punctuation (periods, commas, question marks, exclamation marks, dashes).
5. Generate exactly ${mode === 'diverse' ? count : 1} script(s).`
        : `你是顶级短视频 TTS 配音文案撰稿人。

绝对规则——无论用户怎么要求，以下规则不可违反：
1. 【最重要】字数要求：每条文案必须在 ${minLength} 到 ${maxLengthCalc} ${lengthUnit}之间（含标点）。不可少于 ${minLength} 字，严禁超过 ${maxLengthCalc} 字！本视频长 ${videoDurationSeconds} 秒，TTS 以每秒约 4.5 字的速度朗读。超长文案会被系统截断导致内容不完整。
2. 格式：只返回有效 JSON：{"captions": ["文案1", ...]}。不要输出 markdown。
3. 禁止使用：表情符号（😀🎉等）、特殊符号（♥★●→☆■等）、话题标签（#话题）。原因：文本由 FFmpeg + TTS 引擎渲染，这些字符会导致渲染错误或被错误朗读。
4. 纯文本：只使用标准汉字、字母、数字和常规标点（句号、逗号、问号、感叹号、破折号）。
5. 生成 ${mode === 'diverse' ? count : 1} 条文案。
⚠️ 再次强调：每条文案的字数（含标点）必须 >= ${minLength} 字。请在生成后自行检查字数。`;

    // 第二层：用户的创意方向（原封不动传入）
    // 第三层：默认指导（用户没明确要求时的兜底建议）
    const prompt = language === 'en'
        ? (mode === 'diverse'
            ? `Generate ${count} different voiceover scripts in ${langLabel}.

【USER'S CREATIVE DIRECTION】
"${keywords}"
(If the user specifies tone, style, structure, or any preferences above, follow them. They override the default guidance below.)

【DEFAULT GUIDANCE — Use these ONLY if the user didn't specify preferences above】
- Auto-detect the most suitable tone based on the topic (energetic, professional, witty, poetic, or minimal)
- Start with a HOOK (grab attention in the first 3 words)
- Write as if someone is SPEAKING, not writing — use contractions, pauses, direct address ("you")
- End with a call-to-action or thought-provoking closer
- Each of the ${count} scripts must feel genuinely different — vary hook angle, sentence structure, emphasis
- Avoid generic filler ("In today's world..."), clickbait, overly salesy language

Return JSON: {"captions": ["script1", "script2", ...]}`
            : `Generate 1 voiceover script in ${langLabel}.

【USER'S CREATIVE DIRECTION】
"${keywords}"
(If the user specifies tone, style, structure, or any preferences above, follow them. They override the default guidance below.)

【DEFAULT GUIDANCE — Use these ONLY if the user didn't specify preferences above】
- Auto-detect the most suitable tone based on the topic
- Start with a HOOK, then core message, end with a memorable closer
- Write as if someone is SPEAKING — natural, rhythmic, conversational
- Avoid generic filler, clickbait, overly salesy language

Return JSON: {"captions": ["script"]}`)
        : (mode === 'diverse'
            ? `生成 ${count} 条不同的短视频配音旁白文案（中文）。

【用户的创意方向】
"${keywords}"
（如果用户在上面指定了语气、风格、句式或其他偏好，请优先遵从用户的要求，覆盖下面的默认建议。）

【默认指导——仅在用户没有明确要求时使用】
- 根据主题自动判断最合适的语气风格（活力/专业/幽默/走心/极简）
- 开头用「钩子」抓注意力（前10字决定用户是否继续看）
- 这是用来「说」的文案——像真人在镜头前讲话，口语化、有节奏感
- 结尾留一个引发思考或行动的收尾
- ${count}条文案之间必须有明显差异——变换切入角度、句式、重点
- 避免：废话开头（"大家好"）、空洞口号、过度营销感

返回 JSON 格式：{"captions": ["文案1", "文案2", ...]}`
            : `生成 1 条短视频配音旁白文案（中文）。

【用户的创意方向】
"${keywords}"
（如果用户在上面指定了语气、风格、句式或其他偏好，请优先遵从用户的要求，覆盖下面的默认建议。）

【默认指导——仅在用户没有明确要求时使用】
- 根据主题自动判断最合适的语气风格
- 开头抓注意力，中间核心信息，结尾有力收束
- 用说话的方式写，像真人讲话，自然有节奏感
- 避免：废话开头、空洞口号、过度营销

返回 JSON 格式：{"captions": ["文案"]}`);

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
            const fixed = await fixCaptionLength(captions[0], minLength, maxLengthCalc, language);
            return Array(count).fill(fixed);
        }

        // 多样模式：确保返回正确数量
        let result: string[] = [];
        if (captions.length < count) {
            for (let i = 0; i < count; i++) {
                result.push(captions[i % captions.length]);
            }
        } else {
            result = captions.slice(0, count);
        }

        // 🔧 逐条验证字数，不合格的让 AI 精简/扩写（比裁剪更保护内容完整性）
        for (let i = 0; i < result.length; i++) {
            result[i] = await fixCaptionLength(result[i], minLength, maxLengthCalc, language);
        }

        return result;
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
    maxLength = 90,
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

    // ═══ 三层 Prompt 架构 ═══
    // 第一层：System Message（角色 + 绝对规则）
    const systemMessage = language === 'en'
        ? `You are an on-screen text designer for TikTok/Reels slideshow videos.

ABSOLUTE RULES — These MUST be followed NO MATTER WHAT the user says:
1. LANGUAGE: ALL output text MUST be in English. Even if the user's description is in another language (e.g. Chinese), you MUST translate and write the output texts in English. This is non-negotiable.
2. LENGTH: Each text MUST be under ${maxLength} characters. This text is rendered ON TOP of images by FFmpeg — long text will overflow or become unreadable on mobile.
3. FORMAT: Return ONLY valid JSON: {"texts": ["text1", ...]}. No markdown.
4. NO EMOJIS, NO SPECIAL SYMBOLS (♥★●→☆), NO HASHTAGS (#). Reason: FFmpeg renders these texts onto video frames — unsupported characters cause rendering failures or display as garbled squares.
5. PURE TEXT ONLY: Use only standard English letters, numbers, and basic punctuation.
6. Generate exactly ${mode === 'diverse' ? count : 1} text(s).`
        : `你是短视频画面叠加文字设计师。

绝对规则——无论用户怎么要求，以下规则不可违反：
1. 字数：每条文案必须在 ${maxLength} 字以内。这些文字由 FFmpeg 渲染叠加在图片上——太长会溢出或在手机上看不清。
2. 格式：只返回有效 JSON：{"texts": ["文案1", ...]}。不要输出 markdown。
3. 禁止使用：表情符号（😀🎉等）、特殊符号（♥★●→☆■等）、话题标签（#话题）。原因：FFmpeg 将文字渲染到视频画面上，不支持的字符会导致渲染失败或显示为乱码方块。
4. 纯文本：只使用标准汉字、字母、数字和常规标点。
5. 生成 ${mode === 'diverse' ? count : 1} 条文案。`;

    // 第二层：用户的创意方向（原封不动传入）
    // 第三层：默认指导（用户没明确要求时的兜底建议）
    const userPrompt = language === 'en'
        ? (mode === 'diverse'
            ? `Generate ${count} different ON-SCREEN text overlays in English for a slideshow video.${imageContext}

【USER'S CREATIVE DIRECTION】
"${prompt}"
(If the user specifies style, wording preferences, or any requirements above, follow them. They override the default guidance below. BUT regardless of the input language, your output MUST be in English.)

【DEFAULT GUIDANCE — Use these ONLY if the user didn't specify preferences above】
- SHORT & PUNCHY: Ideally 5-18 words. A catchy phrase or short sentence that hooks the viewer.
- These are VISUAL TEXT viewers READ on screen, not voiceover scripts. Write headlines, catchy phrases, or punchlines.
- Use power words, numbers, or provocative statements for visual impact.
- Each of the ${count} texts should vary in angle — don't just rephrase the same idea.
- Good examples: "Every Penny Was Worth It", "3x More Power Than Before", "The Game Changer You Needed"
- Bad examples: "This is a great product that you should buy" (too long), "Amazing!!!" (empty)

IMPORTANT: Output MUST be in English. Return JSON: {"texts": ["text1", "text2", ...]}`
            : `Generate 1 reusable ON-SCREEN text overlay in English for a slideshow video.${imageContext}

【USER'S CREATIVE DIRECTION】
"${prompt}"
(If the user specifies style or wording preferences above, follow them. They override the default guidance below. BUT regardless of the input language, your output MUST be in English.)

【DEFAULT GUIDANCE — Use these ONLY if the user didn't specify preferences above】
- SHORT & PUNCHY: Ideally 5-18 words. Think catchy phrase — instantly readable and memorable.
- This is VISUAL TEXT, not voiceover. Write a headline or punchline.
- Good examples: "Every Penny Was Worth It", "3x More Power Than Before", "The Secret Is Finally Out"

IMPORTANT: Output MUST be in English. Return JSON: {"texts": ["text"]}`)
        : (mode === 'diverse'
            ? `为轮播视频的${count}张图片生成不同的画面叠加文案。${imageContext}

【用户的创意方向】
"${prompt}"
（如果用户在上面指定了风格、用词偏好或其他要求，请优先遵从用户的要求，覆盖下面的默认建议。）

【默认指导——仅在用户没有明确要求时使用】
- 简洁有力：最佳长度 5-20 个字。可以是短标语或金句，让观众一眼记住。
- 这是观众在画面上「看到」的文字，不是配音文稿。写标题、标语、金句，有力量感。
- 用有力的词汇、数字、对比、反转增加视觉冲击力。
- ${count}条文案对应${count}张图，每条切入角度不同，不能只是换几个词。
- 好的例子：「和闺蜜在一起的快乐时光」「这个秘密竟然没人告诉你」「三倍提效的终极方案」
- 坏的例子：「这是一个非常好的产品推荐给大家」（太长太啰嗦）、「太棒了！！！」（空洞无物）

返回 JSON 格式：{"texts": ["文案1", "文案2", ...]}`
            : `为轮播视频生成1条通用的画面叠加文案。${imageContext}

【用户的创意方向】
"${prompt}"
（如果用户在上面指定了风格或用词偏好，请优先遵从用户的要求，覆盖下面的默认建议。）

【默认指导——仅在用户没有明确要求时使用】
- 简洁有力：最佳长度 5-20 个字。可以是短标语或金句——一眼记住，有力量感。
- 不是配音文稿：写标题/标语/金句。
- 好的例子：「和闺蜜在一起的快乐时光」「这个秘密竟然没人告诉你」

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

