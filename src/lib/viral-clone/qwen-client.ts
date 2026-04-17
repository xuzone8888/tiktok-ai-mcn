/**
 * Qwen/DashScope 客户端 — 审计采纳 3.4
 *
 * 复用 doubao-api-client.ts 的 OpenAI 兼容调用模式
 * 换 endpoint + model + API key
 *
 * 支持:
 * - 文本对话: qwen-plus / qwen-max
 * - 视频理解: qwen-vl-max（多模态）
 * - 图片理解: qwen-vl-max（多模态）
 */

// ============================================================================
// 配置
// ============================================================================

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';

/**
 * DashScope OpenAI 兼容 endpoint
 * 文档: https://help.aliyun.com/document_detail/2400395.html
 */
const DASHSCOPE_ENDPOINT = process.env.DASHSCOPE_ENDPOINT
  || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/** 默认文本模型 */
const DEFAULT_TEXT_MODEL = process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.5-omni-flash';

/** 默认多模态模型（视频/图片理解） — 使用最强的 omni-plus 做分析和 QC */
const DEFAULT_VL_MODEL = process.env.DASHSCOPE_VL_MODEL || 'qwen3.5-omni-plus';

// ============================================================================
// 类型定义
// ============================================================================

/** 消息内容块（多模态） */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

/** 标准消息 */
export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** 调用选项 */
export interface QwenCallOptions {
  /** 使用的模型（默认 qwen-plus） */
  model?: string;
  /** 最大输出 tokens */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否多模态模型 */
  multimodal?: boolean;
}

/** 调用结果 */
export interface QwenCallResult {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// 限流
// ============================================================================

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // DashScope RPM 限制

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 调用 Qwen 文本模型
 */
export async function callQwenText(
  messages: QwenMessage[],
  options?: Omit<QwenCallOptions, 'multimodal'>
): Promise<QwenCallResult> {
  return callQwen(messages, { ...options, multimodal: false });
}

/**
 * 调用 Qwen 多模态模型（视频/图片理解）
 */
export async function callQwenVision(
  messages: QwenMessage[],
  options?: Omit<QwenCallOptions, 'multimodal'>
): Promise<QwenCallResult> {
  return callQwen(messages, { ...options, multimodal: true });
}

/**
 * 便捷: 单轮对话（文本）
 */
export async function askQwen(
  systemPrompt: string,
  userMessage: string,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  return callQwenText([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], options);
}

/**
 * 便捷: 分析视频（多模态）
 */
export async function analyzeVideo(
  videoUrl: string,
  systemPrompt: string,
  userPrompt: string,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  return callQwenVision([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'video_url', video_url: { url: videoUrl } },
        { type: 'text', text: userPrompt },
      ],
    },
  ], options);
}

// ============================================================================
// V2 深度分析函数
// ============================================================================

/**
 * V2: 全视频深度分析 — 完整转录 + 时间线 + 画面节拍
 *
 * 一次 Qwen 调用完成全局分析，输出 AnalysisArtifactV2 JSON。
 * 使用最强多模态模型，maxTokens=8192 以容纳完整转录。
 */
export async function analyzeVideoDeep(
  videoUrl: string,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  const systemPrompt = `你是一个专业的短视频逆向分析师。你的任务是把给定的视频完整还原成结构化数据，用于后续自动化复制这条视频。

你必须做到：
1. 完整逐字转录视频中所有的口播/对白/旁白内容，不遗漏任何一句话
2. 为每句话标注近似开始/结束时间（秒，精确到 0.5 秒即可）
3. 描述视频中每个画面阶段发生了什么（人物动作、产品展示、场景切换等）
4. 提取画面中必须保留的关键视觉元素（产品外观、人物特征、场景特征）
5. 总结视频的核心卖点和信息
6. 推荐适合的分段数(2/3/4)

请严格按 JSON 格式返回，不要输出其他内容。`;

  const userPrompt = `请深度分析这条视频，返回以下 JSON 结构：
{
  "summary": "一两句话概括视频内容和目的",
  "transcript_full": "完整的口播/旁白逐字转录，所有话连在一起",
  "utterances": [
    { "id": "utt_0", "approx_start_s": 0.0, "approx_end_s": 3.5, "text": "这句话的逐字内容" },
    { "id": "utt_1", "approx_start_s": 3.5, "approx_end_s": 7.0, "text": "下一句话的逐字内容" }
  ],
  "visual_beats": [
    {
      "id": "beat_0",
      "approx_start_s": 0.0,
      "approx_end_s": 3.5,
      "description": "详细描述这段时间内的画面内容，包括人物动作、产品展示、场景等",
      "key_elements": ["产品名/外观", "人物特征", "场景特征"],
      "camera": "镜头类型（如：中景正面、特写俯拍、手持跟拍）",
      "on_screen_text": ["画面上出现的文字"]
    }
  ],
  "key_claims": ["核心卖点1", "核心卖点2"],
  "suggested_segments": 3,
  "suggested_duration": 24,
  "language": "en 或 zh 或 mixed",
  "video_type": "product_review 或 ad_oral 或 tutorial 或 lifestyle 或 other"
}

注意：
- utterances 必须覆盖视频中所有口播内容，不能遗漏
- visual_beats 的 description 必须足够详细，让人仅凭文字就能想象出画面
- key_elements 是后续生成视频时必须保留的元素，请仔细提取`;

  return callQwenVision([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'video_url', video_url: { url: videoUrl } },
        { type: 'text', text: userPrompt },
      ],
    },
  ], { maxTokens: 8192, temperature: 0.3, ...options });
}

/**
 * V2: 一次性细化全部分段 — 补充每段的精确画面描述
 *
 * 传入视频 URL + 全局分析结果 + 分段时间范围，
 * 让 Qwen 对每段的台词和画面做更精确的描述。
 * 1 次调用完成全部段的细化。
 */
export async function refineSegments(
  videoUrl: string,
  segmentRanges: Array<{ index: number; start_s: number; end_s: number; role: string }>,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  const segmentDesc = segmentRanges.map(s =>
    `- 第${s.index + 1}段 (${s.role}): ${s.start_s}s - ${s.end_s}s`
  ).join('\n');

  const systemPrompt = `你是一个精确的视频分段分析师。你会收到一条完整视频和明确的分段时间范围。

关键规则：
1. 你必须严格只分析每段指定时间范围内的内容
2. 不要将其他时间段的内容混入当前段
3. 每段的 spoken_text_exact 只包含该时间范围内说的话
4. visual_description 只描述该时间范围内的画面
5. camera_movement 只描述该时间范围内的镜头运动

请严格按 JSON 格式返回。`;

  const userPrompt = `这条视频被分成了以下几段，每段有精确的时间范围：
${segmentDesc}

⚠️ 重要：请严格按照每段的时间范围来分析，不要把其他时段的内容混入。

请对每段分析，返回 JSON：
{
  "segments": [
    {
      "index": 0,
      "spoken_text_exact": "该时间范围内说的完整台词（逐字转录，只含该范围内的口播）",
      "visual_description": "该时间范围内画面的详细场景描述（人物动作、产品状态、背景、灯光等）",
      "key_elements": ["该段内必须保留的关键视觉元素"],
      "camera_movement": "该段内的镜头运动（特写、中景、推拉、平移、固定等）"
    }
  ]
}

注意：
- spoken_text_exact 必须只是这个时间范围（${segmentRanges[0]?.start_s}s-${segmentRanges[segmentRanges.length - 1]?.end_s}s）内说的话
- visual_description 要详细到可以据此生成画面
- camera_movement 要具体描述镜头如何运动
- key_elements 是重新生成视频时必须保留的视觉元素`;

  return callQwenVision([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'video_url', video_url: { url: videoUrl } },
        { type: 'text', text: userPrompt },
      ],
    },
  ], { maxTokens: 6144, temperature: 0.3, ...options });
}

/**
 * 便捷: 分析图片或视频帧（多模态）
 *
 * 支持:
 * - 普通图片 URL → image_url content
 * - video_frame_ref JSON → video_url content（Serverless 兼容模式）
 */
export async function analyzeImage(
  imageOrFrameRef: string,
  systemPrompt: string,
  userPrompt: string,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  const { content: mediaContent, positionHint } = buildMediaContent(imageOrFrameRef);

  // 如果有帧位置提示，附加到 userPrompt
  const enrichedPrompt = positionHint
    ? `${userPrompt}\n\n[Frame position: ${positionHint.position}, seek ≈ ${positionHint.seek_hint_s}s — focus your analysis on this point in the video]`
    : userPrompt;

  return callQwenVision([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        mediaContent,
        { type: 'text', text: enrichedPrompt },
      ],
    },
  ], options);
}

/**
 * 便捷: 比较两段视频的连续性（多模态）
 *
 * 支持 video_frame_ref JSON 格式（来自 extractFrame）
 */
export async function compareVideoFrames(
  frameRef1: string,
  frameRef2: string,
  systemPrompt: string,
  userPrompt: string,
  options?: QwenCallOptions
): Promise<QwenCallResult> {
  const { content: media1, positionHint: hint1 } = buildMediaContent(frameRef1);
  const { content: media2, positionHint: hint2 } = buildMediaContent(frameRef2);

  // 附加帧位置上下文
  let enrichedPrompt = userPrompt;
  if (hint1 || hint2) {
    const ctx: string[] = [];
    if (hint1) ctx.push(`Video 1 frame: ${hint1.position} (≈${hint1.seek_hint_s}s)`);
    if (hint2) ctx.push(`Video 2 frame: ${hint2.position} (≈${hint2.seek_hint_s}s)`);
    enrichedPrompt += `\n\n[${ctx.join(' | ')} — compare content at these specific points]`;
  }

  return callQwenVision([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        media1,
        media2,
        { type: 'text', text: enrichedPrompt },
      ],
    },
  ], options);
}

interface FramePositionHint {
  position: 'head' | 'mid' | 'tail';
  seek_hint_s: number;
}

/**
 * 根据输入构建正确的多模态 content block
 *
 * - video_frame_ref JSON → video_url + 位置提示
 * - 普通 URL → image_url
 */
function buildMediaContent(input: string): { content: ContentBlock; positionHint?: FramePositionHint } {
  try {
    const parsed = JSON.parse(input);
    if (parsed?.type === 'video_frame_ref' && parsed.url) {
      return {
        content: {
          type: 'video_url',
          video_url: {
            url: parsed.url,
          },
        },
        positionHint: parsed.position ? {
          position: parsed.position,
          seek_hint_s: parsed.seek_hint_s ?? 0,
        } : undefined,
      };
    }
  } catch {
    // 不是 JSON，当作普通 URL 处理
  }

  return { content: { type: 'image_url', image_url: { url: input } } };
}

// ============================================================================
// 核心调用函数
// ============================================================================

async function callQwen(
  messages: QwenMessage[],
  options: QwenCallOptions = {}
): Promise<QwenCallResult> {
  if (!DASHSCOPE_API_KEY) {
    return { success: false, error: 'DASHSCOPE_API_KEY 未配置' };
  }

  const model = options.model
    || (options.multimodal ? DEFAULT_VL_MODEL : DEFAULT_TEXT_MODEL);
  const maxRetries = options.maxRetries ?? 3;
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature ?? 0.7;

  await waitForRateLimit();

  const requestBody = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[QwenClient] Calling ${model} (attempt ${attempt}/${maxRetries}):`, {
        messageCount: messages.length,
        maxTokens,
      });

      const response = await fetch(DASHSCOPE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[QwenClient] HTTP ${response.status}:`, errorText.substring(0, 300));

        // 429 限流 → 指数退避重试
        if (response.status === 429 && attempt < maxRetries) {
          const retryDelay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          console.log(`[QwenClient] Rate limited, retrying in ${retryDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // 5xx 服务端错误 → 重试
        if (response.status >= 500 && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
          continue;
        }

        return { success: false, error: `Qwen API 请求失败: ${response.status}` };
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return { success: false, error: 'Qwen API 返回结果为空' };
      }

      const content = data.choices[0].message?.content;
      if (!content) {
        return { success: false, error: 'Qwen API 返回内容为空' };
      }

      console.log(`[QwenClient] Success:`, {
        model,
        contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length,
        usage: data.usage,
      });

      return {
        success: true,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        usage: data.usage,
      };

    } catch (error) {
      console.error(`[QwenClient] Error (attempt ${attempt}):`, error);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
        continue;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : '网络请求失败',
      };
    }
  }

  return { success: false, error: 'Qwen API 请求失败，已达到最大重试次数' };
}
