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

  aiVideoPromptSystem: `Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.`,

  aiVideoPromptUser: `Convert this script to 7 Sora shots:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [camera+action, under 50 chars]
C02: [camera+action, under 50 chars]
C03: [camera+action, under 50 chars]
C04: [camera+action, under 50 chars]
C05: [camera+action, under 50 chars]
C06: [camera+action, under 50 chars]
C07: [camera+action, under 50 chars]`,
};

// 缓存配置的提示词
let cachedPrompts = { ...DEFAULT_PROMPTS };

/**
 * 获取配置的提示词
 */
async function getConfiguredPrompts(): Promise<typeof DEFAULT_PROMPTS> {
  try {
    // 在服务端环境中尝试获取配置
    // 使用环境变量或根据当前端口动态获取
    const port = process.env.PORT || "3000";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;
    const response = await fetch(`${baseUrl}/api/admin/prompts`, {
      cache: "no-store",
    });
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Doubao API] Failed to parse prompts response");
      return cachedPrompts;
    }
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

// 全局请求计数器和时间戳，用于控制请求频率
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 最小请求间隔 3 秒

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待至少到达最小请求间隔
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`[Doubao API] Rate limiting: waiting ${waitTime}ms before next request`);
    await delay(waitTime);
  }
  
  lastRequestTime = Date.now();
}

/**
 * 调用豆包 API 进行文本/图片理解（带重试机制）
 */
async function callDoubaoAPI(
  messages: DoubaoMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    maxRetries?: number;
  }
): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = DOUBAO_API_KEY;
  const endpointId = DOUBAO_ENDPOINT_ID;
  const maxRetries = options?.maxRetries ?? 3;
  
  if (!apiKey) {
    console.error("[Doubao API] API key not configured");
    return { success: false, error: "豆包 API 密钥未配置，请在 .env.local 中配置 DOUBAO_API_KEY" };
  }

  if (!endpointId) {
    console.error("[Doubao API] Endpoint ID not configured");
    return { success: false, error: "豆包 Endpoint ID 未配置，请在火山引擎控制台创建推理接入点，并在 .env.local 中配置 DOUBAO_ENDPOINT_ID" };
  }

  // 请求频率限制
  await waitForRateLimit();

  const requestBody: DoubaoRequest = {
    model: endpointId,
    messages,
    max_tokens: options?.maxTokens || 4096,
    temperature: options?.temperature || 0.7,
    stream: false,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log("[Doubao API] Calling API:", {
        endpoint: endpointId,
        messageCount: messages.length,
        hasImages: messages.some(m => 
          Array.isArray(m.content) && m.content.some(c => c.type === "image_url")
        ),
        attempt,
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
        
        // 处理 429 限流错误
        if (response.status === 429) {
          // 解析错误信息
          let errorMessage = "API 请求频率过高，请稍后重试";
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              // 检查是否是账户限制
              if (errorJson.error.message.includes("SetLimitExceeded")) {
                errorMessage = "豆包 API 账户已达到推理限制，请前往火山引擎控制台调整「安全体验模式」或提升配额";
              } else {
                errorMessage = `API 限流: ${errorJson.error.message}`;
              }
            }
          } catch {
            // 忽略 JSON 解析错误
          }
          
          // 如果是账户限制，不重试
          if (errorMessage.includes("安全体验模式")) {
            return { success: false, error: errorMessage };
          }
          
          // 其他 429 错误，等待后重试
          if (attempt < maxRetries) {
            const retryDelay = Math.min(5000 * Math.pow(2, attempt - 1), 30000); // 指数退避，最大30秒
            console.log(`[Doubao API] Rate limited (429), retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
            await delay(retryDelay);
            continue;
          }
          
          return { success: false, error: errorMessage };
        }
        
        // 400 错误 - 检查是否是图片下载超时，可以重试
        if (response.status === 400 && errorText.includes("Timeout while downloading")) {
          if (attempt < maxRetries) {
            const retryDelay = 5000 * attempt; // 等待更长时间再重试
            console.log(`[Doubao API] Image download timeout, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
            await delay(retryDelay);
            continue;
          }
          return { 
            success: false, 
            error: "图片下载超时，请检查网络或稍后重试" 
          };
        }
        
        // 其他 5xx 错误，可能重试
        if (response.status >= 500 && attempt < maxRetries) {
          const retryDelay = 3000 * attempt;
          console.log(`[Doubao API] Server error (${response.status}), retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
          await delay(retryDelay);
          continue;
        }
        
        // 400 错误的中文提示
        if (response.status === 400) {
          let errorMsg = "请求参数错误";
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              errorMsg = errorJson.error.message;
            }
          } catch {}
          return { 
            success: false, 
            error: `API 请求失败: ${errorMsg}` 
          };
        }
        
        return { 
          success: false, 
          error: `API 请求失败: ${response.status}` 
        };
      }

      const responseText = await response.text();
      let data: DoubaoResponse;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("[Doubao API] Failed to parse response:", responseText.substring(0, 200));
        return { success: false, error: "豆包 API 响应格式错误" };
      }

      if (!data.choices || data.choices.length === 0) {
        console.error("[Doubao API] No choices in response:", data);
        return { success: false, error: "API 返回结果为空" };
      }

      const content = data.choices[0].message.content;
      
      console.log("[Doubao API] Success:", {
        contentLength: content.length,
        usage: data.usage,
        attempt,
      });

      return { success: true, content };
    } catch (error) {
      console.error("[Doubao API] Error:", error);
      
      // 网络错误，可能重试
      if (attempt < maxRetries) {
        const retryDelay = 3000 * attempt;
        console.log(`[Doubao API] Network error, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
        await delay(retryDelay);
        continue;
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "网络请求失败" 
      };
    }
  }

  return { success: false, error: "API 请求失败，已达到最大重试次数" };
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

    console.log("[Doubao] Converting image to base64:", url);
    
    // 对于 Supabase Storage URL，直接使用原始 URL
    // Supabase 公开存储桶的 URL 可能在服务端访问时遇到问题
    // 让豆包 API 直接获取是更可靠的方式
    if (url.includes("supabase.co/storage/v1/object/public")) {
      console.log("[Doubao] Supabase public URL detected, using original URL directly");
      // 直接返回原始URL，让豆包API自己获取
      return url;
    }
    
    const response = await fetch(url, {
      headers: {
        "Accept": "image/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "follow",
    });
    
    if (!response.ok) {
      console.error("[Doubao] Failed to fetch image:", response.status, response.statusText);
      // 返回原始 URL 作为 fallback
      return url;
    }
    
    // 获取图片类型
    const contentType = response.headers.get("content-type") || "";
    
    // 验证是否为图片类型
    if (!contentType.startsWith("image/")) {
      console.error("[Doubao] Response is not an image, content-type:", contentType);
      // 返回原始 URL，让豆包 API 尝试获取
      return url;
    }
    
    const buffer = await response.arrayBuffer();
    
    // 检查 buffer 是否为空或太小
    if (buffer.byteLength < 100) {
      console.error("[Doubao] Image buffer too small:", buffer.byteLength, "bytes");
      return url;
    }
    
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;
    
    console.log("[Doubao] Image converted to base64, size:", Math.round(base64.length / 1024), "KB, type:", contentType);
    
    return dataUrl;
  } catch (error) {
    console.error("[Doubao] Error converting image to base64:", error);
    // 返回原始 URL 作为 fallback
    return url;
  }
}

/**
 * 生成口播脚本 (Step 1)
 * 
 * 根据产品图片生成 TikTok 达人自拍口播种草脚本 (C01-C07)
 * 
 * @param imageUrls 产品图片 URL 列表
 * @param customPrompts 可选的自定义提示词
 */
export async function generateTalkingScript(
  imageUrls: string[],
  customPrompts?: {
    systemPrompt?: string;
    userPrompt?: string;
  }
): Promise<{ success: boolean; script?: string; error?: string }> {
  if (!imageUrls || imageUrls.length === 0) {
    return { success: false, error: "请提供至少一张图片" };
  }

  console.log("[Doubao] Generating talking script for", imageUrls.length, "images");

  // 获取配置的提示词
  const prompts = await getConfiguredPrompts();
  
  // 使用自定义提示词或默认配置
  const systemPrompt = customPrompts?.systemPrompt?.trim() || prompts.talkingScriptSystem;
  const userPrompt = customPrompts?.userPrompt?.trim() || prompts.talkingScriptUser;

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
    { type: "text", text: userPrompt },
    ...base64Images.map(url => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const messages: DoubaoMessage[] = [
    { role: "system", content: systemPrompt },
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
 * @param customPrompts 可选的自定义提示词
 */
export async function generateAiVideoPrompt(
  talkingScript: string,
  modelTriggerWord?: string,
  customPrompts?: {
    systemPrompt?: string;
    userPrompt?: string;
  }
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
  
  // 使用自定义提示词或默认配置
  const systemPrompt = customPrompts?.systemPrompt?.trim() || prompts.aiVideoPromptSystem;
  const userPromptTemplate = customPrompts?.userPrompt?.trim() || prompts.aiVideoPromptUser;
  const userPrompt = userPromptTemplate.replace("{{SCRIPT}}", talkingScript);

  const messages: DoubaoMessage[] = [
    { role: "system", content: systemPrompt },
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

  // 限制提示词长度，避免 Sora API 报错 "提示词过长"
  // Sora2 API 限制更严格，设置为 1000 字符以确保安全
  const MAX_PROMPT_LENGTH = 1000;
  if (finalPrompt.length > MAX_PROMPT_LENGTH) {
    console.warn(`[Doubao] Prompt too long (${finalPrompt.length} chars), truncating to ${MAX_PROMPT_LENGTH}`);
    
    // 提取模特前缀
    let modelPrefix = "";
    const modelPrefixMatch = finalPrompt.match(/^\[AI MODEL APPEARANCE:.*?\]\n\n/);
    if (modelPrefixMatch) {
      modelPrefix = modelPrefixMatch[0];
    }
    
    // 提取所有镜头 (C01-C07)
    const shotMatches = finalPrompt.match(/C0[1-7]:[^\n]*/g) || [];
    
    if (shotMatches.length >= 7) {
      // 有足够的镜头，压缩每个镜头到固定长度
      const prefixLength = modelPrefix.length;
      const availableLength = MAX_PROMPT_LENGTH - prefixLength - 50; // 留 50 字符余量
      const maxShotLength = Math.floor(availableLength / 7); // 每个镜头的最大长度
      
      const compressedShots = shotMatches.slice(0, 7).map(shot => {
        if (shot.length <= maxShotLength) return shot;
        // 截断镜头，保留开头
        const shotCode = shot.match(/^C0[1-7]:/)?.[0] || "";
        const content = shot.substring(shotCode.length).trim();
        const maxContentLength = maxShotLength - shotCode.length - 3;
        return shotCode + " " + content.substring(0, maxContentLength).trim() + "...";
      });
      
      finalPrompt = modelPrefix + compressedShots.join("\n");
      console.log(`[Doubao] Compressed all 7 shots to ${finalPrompt.length} chars`);
    } else {
      // 镜头不足，使用原来的截断逻辑
      const shots = finalPrompt.split(/(?=C0[1-7]:)/);
      let truncatedPrompt = modelPrefix;
      
      for (const shot of shots) {
        if (shot.startsWith("[AI MODEL APPEARANCE:")) continue;
        if ((truncatedPrompt + shot).length <= MAX_PROMPT_LENGTH) {
          truncatedPrompt += shot;
        } else {
          const remaining = MAX_PROMPT_LENGTH - truncatedPrompt.length;
          if (remaining > 50) {
            const shotCode = shot.match(/^C0[1-7]:/)?.[0] || "";
            truncatedPrompt += shotCode + shot.substring(shotCode.length, remaining - 3).trim() + "...";
          }
          break;
        }
      }
      
      finalPrompt = truncatedPrompt || finalPrompt.substring(0, MAX_PROMPT_LENGTH);
      console.log(`[Doubao] Truncated prompt to ${finalPrompt.length} chars`);
    }
    
    // 最终长度检查
    if (finalPrompt.length > MAX_PROMPT_LENGTH) {
      finalPrompt = finalPrompt.substring(0, MAX_PROMPT_LENGTH - 3) + "...";
    }
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

