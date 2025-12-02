/**
 * 豆包 API 客户端
 * 
 * 使用火山引擎 ARK 平台调用 doubao-seed-1.6 视觉语言模型
 * 
 * 文档: https://www.volcengine.com/docs/82379/1494384
 */

// ============================================================================
// 配置
// ============================================================================

const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || "";
const DOUBAO_API_ENDPOINT = process.env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

// Endpoint ID - 需要在火山引擎控制台创建推理接入点获取
// 格式: ep-20240101000000-xxxxx
// 必须使用 doubao-seed-1.6-vision 或 doubao-1.5-vision-pro 视觉模型
const DOUBAO_ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID || "";

// ============================================================================
// 类型定义
// ============================================================================

interface DoubaoMessage {
  role: "system" | "user" | "assistant";
  content: string | DoubaoContentPart[];
}

interface DoubaoContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

interface DoubaoRequest {
  model: string;  // 使用 Endpoint ID，如 ep-20240101000000-xxxxx
  messages: DoubaoMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface DoubaoResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Prompt 模板 (可通过管理员后台配置)
// ============================================================================

// 默认提示词
const DEFAULT_PROMPTS = {
  talkingScriptSystem: `You are a professional short-form video script generator for TikTok e-commerce. You create engaging, viral-style product recommendation scripts that follow TikTok trends and best practices.`,
  
  talkingScriptUser: `Based on all the product images provided (the first image is a 3x3 high-resolution grid showing multiple angles of the product, and the following images provide extra details and usage scenes), extract the core selling points and write a TikTok selfie-style talking-head product recommendation script in English.

Requirements:
- Platform: TikTok short video product promotion, compliant with TikTok e-commerce and ad policies.
- Duration: about 15 seconds in total.
- Split the script into exactly 7 consecutive simple shots.
- For each shot, provide:
  - a shot code: C01, C02, C03, C04, C05, C06, C07
  - a visual description (what we see, framing, camera angle, product position)
  - detailed action of the creator (body movement, facial expression)
  - the spoken line in natural English (first person, influencer tone, very convincing and enthusiastic).
- The opening must be fun, eye-catching, and hook the viewer in the first seconds.
- The content must strongly plant the desire to buy, highlight benefits and key features clearly.
- Use simple, easy-to-understand language suitable for a broad TikTok audience.
- Do NOT include any explanations, comments, or meta text.
- Do NOT output any headings like 'Shot 1' or 'Explanation'.
- Output only the script content itself.
- Each shot should start with the shot code like: 'C01: ...', 'C02: ...', up to 'C07: ...'.`,

  aiVideoPromptSystem: `You are a TikTok e-commerce creator and AI video director. You specialize in turning talking-head product recommendation scripts into detailed shot-by-shot prompts for AI video generation models like Sora.`,

  aiVideoPromptUser: `Below is a 7-shot TikTok talking-head product recommendation script, with shot codes C01 to C07:

{{SCRIPT}}

Please rewrite this into an English, shot-by-shot AI video generation prompt suitable for a model like Sora2 Pro.

Requirements:
- Keep exactly 7 shots with the same shot codes: C01, C02, C03, C04, C05, C06, C07.
- For each shot, describe:
  - the camera framing and angle (e.g. close-up, medium shot, handheld, selfie angle),
  - the environment and background (e.g. bedroom, street, studio, etc.),
  - the lighting style and mood,
  - the creator's appearance, outfit, and key actions,
  - how the product is shown in the frame,
  - timing and pacing so that the total duration is about 15 seconds.
- Also suggest the style of background music for the entire video (mood, tempo, instruments), integrated into the description.
- Follow the logic of viral TikTok short videos:
  - very strong hook in C01,
  - show clear benefits and key features in the next shots,
  - end with a strong call-to-action and emotional push to buy.
- Do NOT output any tables.
- Do NOT include meta explanations or comments.
- Output only the final AI video prompt content.
- Each shot should start with its code like: 'C01: ...', 'C02: ...', etc.`,
};

// 缓存配置的提示词
let cachedPrompts = { ...DEFAULT_PROMPTS };

/**
 * 获取配置的提示词
 */
async function getConfiguredPrompts(): Promise<typeof DEFAULT_PROMPTS> {
  try {
    // 在服务端环境中尝试获取配置
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/admin/prompts`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (data.success && data.data) {
      cachedPrompts = data.data;
      return data.data;
    }
  } catch (error) {
    console.log("[Doubao API] Using cached/default prompts");
  }
  return cachedPrompts;
}

// ============================================================================
// API 函数
// ============================================================================

/**
 * 调用豆包 API 进行文本/图片理解
 */
async function callDoubaoAPI(
  messages: DoubaoMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = DOUBAO_API_KEY;
  const endpointId = DOUBAO_ENDPOINT_ID;
  
  if (!apiKey) {
    console.error("[Doubao API] API key not configured");
    return { success: false, error: "豆包 API 密钥未配置，请在 .env.local 中配置 DOUBAO_API_KEY" };
  }

  if (!endpointId) {
    console.error("[Doubao API] Endpoint ID not configured");
    return { success: false, error: "豆包 Endpoint ID 未配置，请在火山引擎控制台创建推理接入点，并在 .env.local 中配置 DOUBAO_ENDPOINT_ID" };
  }

  try {
    const requestBody: DoubaoRequest = {
      model: endpointId,  // 使用 Endpoint ID 而不是模型名称
      messages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature || 0.7,
      stream: false,
    };

    console.log("[Doubao API] Calling API:", {
      endpoint: endpointId,
      messageCount: messages.length,
      hasImages: messages.some(m => 
        Array.isArray(m.content) && m.content.some(c => c.type === "image_url")
      ),
    });

    const response = await fetch(DOUBAO_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Doubao API] HTTP error:", response.status, errorText);
      return { 
        success: false, 
        error: `API 请求失败: ${response.status} - ${errorText}` 
      };
    }

    const data: DoubaoResponse = await response.json();

    if (!data.choices || data.choices.length === 0) {
      console.error("[Doubao API] No choices in response:", data);
      return { success: false, error: "API 返回结果为空" };
    }

    const content = data.choices[0].message.content;
    
    console.log("[Doubao API] Success:", {
      contentLength: content.length,
      usage: data.usage,
    });

    return { success: true, content };
  } catch (error) {
    console.error("[Doubao API] Error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "网络请求失败" 
    };
  }
}

/**
 * 将图片URL转换为base64格式
 * 豆包API对外部URL下载有超时限制，使用base64可以避免这个问题
 */
async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    // 如果已经是base64格式，直接返回
    if (url.startsWith("data:image")) {
      return url;
    }

    console.log("[Doubao] Converting image to base64:", url.substring(0, 80) + "...");
    
    const response = await fetch(url, {
      headers: {
        "Accept": "image/*",
      },
    });
    
    if (!response.ok) {
      console.error("[Doubao] Failed to fetch image:", response.status);
      return null;
    }
    
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    
    // 获取图片类型
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${contentType};base64,${base64}`;
    
    console.log("[Doubao] Image converted to base64, size:", Math.round(base64.length / 1024), "KB");
    
    return dataUrl;
  } catch (error) {
    console.error("[Doubao] Error converting image to base64:", error);
    return null;
  }
}

/**
 * 生成口播脚本 (Step 1)
 * 
 * 根据产品图片生成 TikTok 达人自拍口播种草脚本 (C01-C07)
 */
export async function generateTalkingScript(
  imageUrls: string[]
): Promise<{ success: boolean; script?: string; error?: string }> {
  if (!imageUrls || imageUrls.length === 0) {
    return { success: false, error: "请提供至少一张图片" };
  }

  console.log("[Doubao] Generating talking script for", imageUrls.length, "images");

  // 获取配置的提示词
  const prompts = await getConfiguredPrompts();

  // 将图片URL转换为base64，避免豆包API下载超时
  const base64Images: string[] = [];
  for (const url of imageUrls) {
    const base64 = await imageUrlToBase64(url);
    if (base64) {
      base64Images.push(base64);
    } else {
      console.warn("[Doubao] Failed to convert image, using original URL:", url);
      base64Images.push(url);
    }
  }

  // 构建消息内容 - 包含文本和图片
  const userContent: DoubaoContentPart[] = [
    { type: "text", text: prompts.talkingScriptUser },
    ...base64Images.map(url => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const messages: DoubaoMessage[] = [
    { role: "system", content: prompts.talkingScriptSystem },
    { role: "user", content: userContent },
  ];

  const result = await callDoubaoAPI(messages, {
    maxTokens: 2000,
    temperature: 0.8,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, script: result.content };
}

/**
 * 生成 AI 视频提示词 (Step 2)
 * 
 * 将口播脚本转换为 Sora2 Pro 可用的分镜提示词
 * 
 * @param talkingScript 口播脚本
 * @param modelTriggerWord 可选的AI模特触发词，会添加到提示词开头
 */
export async function generateAiVideoPrompt(
  talkingScript: string,
  modelTriggerWord?: string
): Promise<{ success: boolean; prompt?: string; error?: string }> {
  if (!talkingScript || talkingScript.trim().length === 0) {
    return { success: false, error: "请提供口播脚本" };
  }

  console.log("[Doubao] Generating AI video prompt from script:", 
    talkingScript.substring(0, 100) + "...",
    modelTriggerWord ? `with model: ${modelTriggerWord}` : ""
  );

  // 获取配置的提示词
  const prompts = await getConfiguredPrompts();

  const userPrompt = prompts.aiVideoPromptUser.replace("{{SCRIPT}}", talkingScript);

  const messages: DoubaoMessage[] = [
    { role: "system", content: prompts.aiVideoPromptSystem },
    { role: "user", content: userPrompt },
  ];

  const result = await callDoubaoAPI(messages, {
    maxTokens: 3000,
    temperature: 0.7,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  let finalPrompt = result.content || "";

  // 如果有AI模特触发词，添加到提示词开头
  if (modelTriggerWord) {
    const modelPrefix = `[AI MODEL APPEARANCE: The creator/influencer in this video should have the appearance of ${modelTriggerWord}. Maintain this consistent appearance throughout all 7 shots.]\n\n`;
    finalPrompt = modelPrefix + finalPrompt;
    console.log("[Doubao] Added model trigger word to prompt");
  }

  return { success: true, prompt: finalPrompt };
}

/**
 * 测试 API 连接
 */
export async function testDoubaoConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  const apiKey = DOUBAO_API_KEY;
  
  if (!apiKey) {
    return { success: false, message: "API 密钥未配置" };
  }

  try {
    const result = await callDoubaoAPI([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Say 'Hello' in one word." },
    ], {
      maxTokens: 10,
    });

    if (result.success) {
      return { success: true, message: `连接成功: ${result.content}` };
    }

    return { success: false, message: result.error || "未知错误" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "连接失败",
    };
  }
}

export { DOUBAO_API_KEY, DOUBAO_ENDPOINT_ID };

