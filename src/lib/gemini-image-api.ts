/**
 * Gemini 图片生成 API 统一封装
 *
 * 三个模型 (按分辨率分级):
 * - gemini-1k: 高瑞 flash (1K, 快速~10s)
 * - gemini-2k: xas231 portrait (2K, 最佳画质~90s)
 * - gemini-4k: 高瑞 pro-preview (4K, ~25s)
 *
 * 所有模型都使用:
 * - 端点: /v1/chat/completions
 * - 格式: messages 数组 (OpenAI 格式)
 * - 模式: stream: true (SSE 流式响应)
 * - 认证: Authorization: Bearer {key}
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { type ImageModel, type ImageModelConfig, IMAGE_MODEL_CONFIG } from '@/types/generation';

// 调试日志写入文件（终端不可靠）
function debugLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  try {
    const logPath = path.join(process.cwd(), 'gemini-debug.log');
    fs.appendFileSync(logPath, logLine);
  } catch { /* ignore */ }
}

// ============================================================================
// 配置
// ============================================================================

// 高瑞 (gemini-1k + gemini-4k)
const GAORUI_API_KEY = process.env.VEO3_GAORUI_API_KEY || "";

// xas231 (gemini-2k)
const XAS231_API_KEY = process.env.GEMINI_IMAGE_API_KEY || "";

// ============================================================================
// 类型定义
// ============================================================================

export interface GeminiImageParams {
  model: ImageModel;
  prompt: string;
  sourceImageUrls?: string[];  // 参考图 URL
  aspectRatio?: string;
}

export interface GeminiImageResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

// ============================================================================
// SSE 流式响应解析
// ============================================================================

/**
 * 从 SSE 流式数据中提取图片 URL 或 base64 数据
 *
 * 高瑞返回 ~2MB base64 数据嵌入 SSE content 中
 * xas231 返回图片 URL
 * 
 * 不能对 2MB 文本使用正则匹配 [A-Za-z0-9+/=]+，会灾难性回溯
 */
function extractImageFromSSE(sseData: string): { type: 'url' | 'base64'; value: string } | null {
  const lines = sseData.split('\n');
  let fullContent = '';

  for (const line of lines) {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try {
        const jsonStr = line.substring(6).trim();
        if (!jsonStr) continue;
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
        }
        const message = parsed.choices?.[0]?.message?.content;
        if (message && typeof message === 'string') {
          fullContent += message;
        }
      } catch {
        // 跳过无法解析的行
      }
    }
  }

  debugLog("[Gemini-Image] fullContent length:", fullContent.length);
  debugLog("[Gemini-Image] fullContent first 300:", fullContent.substring(0, 300));
  debugLog("[Gemini-Image] fullContent last 100:", fullContent.substring(Math.max(0, fullContent.length - 100)));

  // ========================================
  // 1. 检查 data:image base64 内联数据（用 indexOf，不用正则）
  //    高瑞格式: ![image](data:image/png;base64,iVBOR...) 或 data:image/png;base64,...
  // ========================================
  const dataImageIdx = fullContent.indexOf('data:image/');
  if (dataImageIdx !== -1) {
    // 找到 data:image/ 后，提取 MIME 和 base64 数据
    const afterDataImage = fullContent.substring(dataImageIdx);
    const base64Marker = ';base64,';
    const base64Start = afterDataImage.indexOf(base64Marker);
    
    if (base64Start !== -1) {
      const dataStart = base64Start + base64Marker.length;
      // 找到 base64 数据的结束位置：遇到 ) " ' 空格 或字符串结束
      let dataEnd = dataStart;
      while (dataEnd < afterDataImage.length) {
        const ch = afterDataImage[dataEnd];
        if (ch === ')' || ch === '"' || ch === "'" || ch === ' ' || ch === '\n' || ch === '\r') {
          break;
        }
        dataEnd++;
      }
      
      const dataUri = afterDataImage.substring(0, dataEnd);
      debugLog("[Gemini-Image] Found base64 data URI, total length:", dataUri.length);
      return { type: 'base64', value: dataUri };
    }
  }

  // ========================================
  // 2. 检查 http URL（markdown 格式或直接 URL）
  //    xas231 格式: ![image](https://flow.xas231.online/tmp/xxx.jpg) 或直接 URL
  // ========================================
  // 用 indexOf 先快速检查是否包含 http
  const httpIdx = fullContent.indexOf('http');
  if (httpIdx !== -1) {
    // 使用正则只在 http 附近搜索（截取小范围，避免大字符串性能问题）
    const searchRange = fullContent.substring(httpIdx, Math.min(httpIdx + 500, fullContent.length));
    
    // 先尝试 markdown 格式 ![...](url)
    const mdMatch = searchRange.match(/^(https?:\/\/[^\s)"']+)/);
    if (mdMatch && mdMatch[1]) {
      // 检查是否在 markdown 图片中
      const beforeHttp = fullContent.substring(Math.max(0, httpIdx - 10), httpIdx);
      if (beforeHttp.includes('](')) {
        // markdown 图片格式
        const url = mdMatch[1];
        debugLog("[Gemini-Image] Found URL in markdown:", url.substring(0, 80));
        return { type: 'url', value: url };
      }
      // 直接 URL
      debugLog("[Gemini-Image] Found direct URL:", mdMatch[1].substring(0, 80));
      return { type: 'url', value: mdMatch[1] };
    }
  }

  // ========================================
  // 3. 整个内容就是 URL
  // ========================================
  if (fullContent.startsWith('http')) {
    return { type: 'url', value: fullContent.trim() };
  }

  // ========================================
  // 4. 大内容可能是裸 base64（没有 data: 前缀）
  // ========================================
  if (fullContent.length > 10000 && !fullContent.includes('http')) {
    // 去掉可能的 markdown 文本部分，只留 base64 字符
    // 高瑞有时在 base64 前有一些说明文字
    const cleaned = fullContent.replace(/[^A-Za-z0-9+/=]/g, '');
    if (cleaned.length > 10000) {
      debugLog("[Gemini-Image] Detected raw base64 (no prefix), length:", cleaned.length);
      return { type: 'base64', value: `data:image/png;base64,${cleaned}` };
    }
  }

  return null;
}

// ============================================================================
// 核心提交函数
// ============================================================================

/**
 * 提交 Gemini 图片生成任务
 *
 * 所有模型走 stream: true + SSE 模式
 */
export async function submitGeminiImage(
  params: GeminiImageParams
): Promise<GeminiImageResult> {
  const config = IMAGE_MODEL_CONFIG[params.model];
  if (!config) {
    return { success: false, error: `未知图片模型: ${params.model}` };
  }

  // 第一次尝试：使用主供应商
  const primaryResult = await _executeGeminiImageCall(params, config);
  
  // 如果成功或没有 fallback 配置，直接返回
  if (primaryResult.success || !config.fallback) {
    return primaryResult;
  }

  // 主供应商失败且有 fallback 配置 → 切换备用供应商重试
  debugLog(
    `[Gemini-Image] Primary provider (${config.provider}) failed: ${primaryResult.error}. Trying fallback (${config.fallback.provider})...`
  );

  // 构造 fallback 配置：用原始 config 为基础，替换供应商信息
  const fallbackConfig: ImageModelConfig = {
    ...config,
    provider: config.fallback.provider,
    apiModel: config.fallback.apiModel,
    hostname: config.fallback.hostname,
    path: config.fallback.path,
    nativePath: config.fallback.nativePath,
    imageSize: config.fallback.imageSize,
    fallback: undefined, // 防止无限递归
  };

  const fallbackResult = await _executeGeminiImageCall(params, fallbackConfig);
  
  if (fallbackResult.success) {
    debugLog(`[Gemini-Image] Fallback provider (${config.fallback.provider}) succeeded!`);
  } else {
    debugLog(`[Gemini-Image] Fallback also failed: ${fallbackResult.error}`);
    // 返回时附带两个错误信息
    return {
      success: false,
      error: `主线路 (${config.provider}) 失败: ${primaryResult.error} | 备用线路 (${config.fallback.provider}) 也失败: ${fallbackResult.error}`,
    };
  }

  return fallbackResult;
}

/**
 * 内部执行函数 — 单次 Gemini 图片生成调用
 * 
 * 从 submitGeminiImage 提取出来，支持 fallback 重试
 */
async function _executeGeminiImageCall(
  params: GeminiImageParams,
  config: ImageModelConfig
): Promise<GeminiImageResult> {
  // 根据 provider 选择 API Key
  const apiKey = config.provider === "xas231" ? XAS231_API_KEY : GAORUI_API_KEY;
  if (!apiKey) {
    return { success: false, error: `${config.provider} API Key 未配置` };
  }

  try {
    let requestBody: string;
    let requestPath: string;
    let isNativeFormat = false;

    if (config.nativePath) {
      // ========================================
      // 高瑞原生 Gemini 格式（支持 imageConfig 精确控制比例/分辨率）
      // ========================================
      isNativeFormat = true;
      requestPath = `${config.nativePath}?key=${apiKey}`;

      // 构建 parts
      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
        { text: params.prompt },
      ];

      // 参考图片转 inline_data（原生格式不支持 image_url，需要下载后传 base64）
      // 暂时跳过参考图片——原生格式需要 inline_data，后续优化
      if (params.sourceImageUrls && params.sourceImageUrls.length > 0) {
        debugLog("[Gemini-Image] Native format: source images will be included via download");
        for (const imgUrl of params.sourceImageUrls) {
          try {
            // 下载图片转 base64
            const imgResponse = await fetch(imgUrl);
            const imgBuffer = await imgResponse.arrayBuffer();
            const imgBase64 = Buffer.from(imgBuffer).toString('base64');
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            parts.push({ inline_data: { mime_type: contentType, data: imgBase64 } });
          } catch (dlErr) {
            debugLog("[Gemini-Image] Failed to download source image:", imgUrl, dlErr);
          }
        }
      }

      // 构建 imageConfig
      const imageConfig: Record<string, string> = {};
      if (params.aspectRatio && params.aspectRatio !== "auto") {
        imageConfig.aspectRatio = params.aspectRatio;
      }
      if (config.imageSize) {
        imageConfig.imageSize = config.imageSize;
      }

      requestBody = JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["Text", "Image"],
          ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        },
      });

      debugLog("[Gemini-Image] Native Gemini format:", {
        model: config.apiModel,
        path: requestPath.substring(0, 80),
        imageConfig,
        partsCount: parts.length,
      });

    } else {
      // ========================================
      // xas231 OpenAI 兼容格式
      // ========================================
      requestPath = config.path;

      let promptText = params.prompt;
      let actualApiModel = config.apiModel;

      // 对 xas231 2K 模型：根据比例选择 portrait/landscape 模型变体
      if (config.provider === "xas231") {
        const isPortrait = params.aspectRatio === "9:16" || params.aspectRatio === "3:4" || params.aspectRatio === "2:3";
        actualApiModel = isPortrait
          ? "gemini-3.0-pro-image-portrait-2k"
          : "gemini-3.0-pro-image-landscape-2k";
        debugLog("[Gemini-Image] xas231 model variant:", actualApiModel, "for aspect:", params.aspectRatio);
      }

      // 通过 prompt 注入宽高比
      if (params.aspectRatio && params.aspectRatio !== "auto") {
        promptText = `生成的图片请使用 ${params.aspectRatio} 的宽高比例。${promptText}`;
      }

      // 图生图用数组格式，纯文本生图用字符串格式
      let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
      if (params.sourceImageUrls && params.sourceImageUrls.length > 0) {
        messageContent = [
          { type: "text", text: promptText },
          ...params.sourceImageUrls.map(url => ({ type: "image_url" as const, image_url: { url } })),
        ];
      } else {
        messageContent = promptText;
      }

      requestBody = JSON.stringify({
        model: actualApiModel,
        messages: [{ role: "user", content: messageContent }],
        stream: true,
      });
    }

    debugLog("[Gemini-Image] Submitting:", {
      model: config.apiModel,
      provider: config.provider,
      hostname: config.hostname,
      native: isNativeFormat,
      imageCount: params.sourceImageUrls?.length || 0,
      prompt: params.prompt.substring(0, 50) + "...",
    });

    // 发送 HTTP 请求
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(requestBody)),
    };
    // 原生格式用 query param 传 key，OpenAI 格式用 Authorization header
    if (!isNativeFormat) {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
      reqHeaders['Accept'] = 'text/event-stream';
    }

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const reqOptions = {
        hostname: config.hostname,
        port: 443,
        path: requestPath,
        method: 'POST',
        family: 4,
        headers: reqHeaders,
        timeout: 180000,
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });

    debugLog("[Gemini-Image] Response status:", result.statusCode, "data length:", result.data.length);
    // 转存原始响应前 1000 字符用于调试
    debugLog("[Gemini-Image] Raw response first 1000:", result.data.substring(0, 1000));

    if (result.statusCode >= 400) {
      debugLog("[Gemini-Image] Error response:", result.data.substring(0, 300));

      // 尝试解析错误信息
      try {
        const errData = JSON.parse(result.data);
        return { success: false, error: errData.error?.message || `图片服务错误 (${result.statusCode})` };
      } catch {
        return { success: false, error: `图片服务错误 (${result.statusCode})` };
      }
    }

    // 解析响应
    let imageResult: { type: 'url' | 'base64'; value: string } | null = null;

    if (isNativeFormat) {
      // ========================================
      // 原生 Gemini 格式：JSON 响应
      // { candidates: [{ content: { parts: [{ inline_data: { mime_type, data } }] } }] }
      // ========================================
      try {
        const json = JSON.parse(result.data);
        const parts = json.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            // 支持 camelCase (inlineData/mimeType) 和 snake_case (inline_data/mime_type)
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData?.data) {
              const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
              debugLog("[Gemini-Image] Native: found inlineData, mime:", mimeType, "length:", inlineData.data.length);
              imageResult = { type: 'base64', value: `data:${mimeType};base64,${inlineData.data}` };
              break;
            }
          }
        }
        if (!imageResult) {
          debugLog("[Gemini-Image] Native: no inline_data found in response:", JSON.stringify(json).substring(0, 500));
        }
      } catch (parseErr) {
        debugLog("[Gemini-Image] Native: JSON parse error:", parseErr, "data:", result.data.substring(0, 300));
      }
    } else {
      // ========================================
      // OpenAI 格式：SSE 响应
      // ========================================
      imageResult = extractImageFromSSE(result.data);
    }

    if (!imageResult) {
      debugLog("[Gemini-Image] No image found in response, raw data first 500:", result.data.substring(0, 500));
      return { success: false, error: "图片生成成功但未提取到图片数据，请重试" };
    }

    // 如果是 URL，直接返回
    if (imageResult.type === 'url') {
      debugLog("[Gemini-Image] Got image URL:", imageResult.value.substring(0, 80) + "...");
      return { success: true, imageUrl: imageResult.value };
    }

    // 如果是 base64，上传到阿里云 OSS
    if (imageResult.type === 'base64') {
      debugLog("[Gemini-Image] Got base64 data, uploading to OSS...");
      try {
        const { uploadImageBuffer, generateMediaPath, getPublicUrl } = await import('@/lib/oss');

        // 从 data URI 提取 buffer
        const base64Data = imageResult.value.split(',')[1];
        const mimeType = imageResult.value.match(/data:(image\/[a-z]+);/)?.[1] || 'image/png';
        const ext = mimeType.split('/')[1] || 'png';
        const buffer = Buffer.from(base64Data, 'base64');

        const objectPath = generateMediaPath(
          'images',
          'gemini-gen',
          `gemini-${Date.now()}.${ext}`
        );

        const url = await uploadImageBuffer(buffer, objectPath, mimeType);

        debugLog("[Gemini-Image] Uploaded to OSS:", url);
        return { success: true, imageUrl: url };
      } catch (uploadErr) {
        debugLog("[Gemini-Image] OSS upload error:", uploadErr);
        return { success: false, error: "图片上传 OSS 失败: " + (uploadErr instanceof Error ? uploadErr.message : "未知错误") };
      }
    }

    return { success: false, error: "未知图片格式" };
  } catch (error) {
    debugLog("[Gemini-Image] Submit error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
