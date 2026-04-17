/**
 * P2-9: Imagen 4 封面超分
 *
 * 从成品视频中选取最佳帧，使用 Imagen 4 进行 AI 超分辨率放大，
 * 生成高质量封面图。
 *
 * 策略:
 * 1. 使用视频第一帧或用户指定帧作为封面源
 * 2. 调用 Imagen 4 upscale/editing API 进行超分
 * 3. 上传到 OSS 并关联到 Job
 */

import { uploadBuffer, generateMediaPath } from '@/lib/oss';

// ============================================================================
// 配置
// ============================================================================

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const IMAGEN_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const UPSCALE_TIMEOUT_MS = 60000;

// ============================================================================
// 类型
// ============================================================================

export interface CoverUpscaleRequest {
  /** 源封面图 URL（从视频截取的帧） */
  sourceImageUrl: string;
  /** 增强提示词（可选） */
  enhancePrompt?: string;
  /** 用户 ID */
  userId: string;
  /** 任务 ID */
  jobId: string;
  /** 画面比例 */
  aspectRatio: '9:16' | '16:9';
}

export interface CoverUpscaleResult {
  success: boolean;
  /** 超分后的封面 URL */
  coverUrl?: string;
  /** OSS 对象键 */
  ossKey?: string;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  error?: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 对封面图执行 AI 超分辨率放大
 */
export async function upscaleCover(request: CoverUpscaleRequest): Promise<CoverUpscaleResult> {
  if (!GOOGLE_AI_API_KEY) {
    return { success: false, error: 'GOOGLE_AI_API_KEY 未配置' };
  }

  try {
    console.log(`[ImagenCover] Upscaling cover for job ${request.jobId}`);

    // Step 1: 下载源封面图
    const imgResponse = await fetch(request.sourceImageUrl);
    if (!imgResponse.ok) {
      return { success: false, error: `下载源封面失败: HTTP ${imgResponse.status}` };
    }
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const imgBase64 = imgBuffer.toString('base64');
    const mimeType = imgResponse.headers.get('content-type') || 'image/jpeg';

    // Step 2: 调用 Imagen 4 upscale
    const prompt = request.enhancePrompt ||
      'Upscale this image to ultra high resolution. Enhance details, sharpen edges, improve clarity. Keep the original composition and colors intact.';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSCALE_TIMEOUT_MS);

    const response = await fetch(
      `${IMAGEN_API_BASE}/models/imagen-4.0-generate-preview-05-20:predict?key=${GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{
            prompt,
            image: {
              bytesBase64Encoded: imgBase64,
            },
          }],
          parameters: {
            sampleCount: 1,
            aspectRatio: request.aspectRatio === '9:16' ? '9:16' : '16:9',
            upscaleFactor: 'x4',
            mode: 'upscale',
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ImagenCover] API error ${response.status}:`, errText.substring(0, 200));

      // 降级: 直接使用原图
      return await fallbackOriginalImage(imgBuffer, request);
    }

    const data = await response.json();

    // Step 3: 提取结果图
    const resultImage = extractImageFromResponse(data);
    if (!resultImage) {
      console.warn('[ImagenCover] No image in response, using original');
      return await fallbackOriginalImage(imgBuffer, request);
    }

    // Step 4: 上传到 OSS
    const ossKey = generateMediaPath('images', request.userId, `vc-cover-hd-${request.jobId}.jpg`);
    const coverUrl = await uploadBuffer(resultImage, ossKey, 'image/jpeg');

    const dimensions = request.aspectRatio === '9:16'
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 };

    console.log(`[ImagenCover] Complete: ${(resultImage.length / 1024).toFixed(0)}KB`);

    return {
      success: true,
      coverUrl,
      ossKey,
      ...dimensions,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ImagenCover] Error:`, errMsg);
    return { success: false, error: errMsg };
  }
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 降级: 直接上传原图作为封面
 */
async function fallbackOriginalImage(
  imgBuffer: Buffer,
  request: CoverUpscaleRequest
): Promise<CoverUpscaleResult> {
  const ossKey = generateMediaPath('images', request.userId, `vc-cover-${request.jobId}.jpg`);
  const coverUrl = await uploadBuffer(imgBuffer, ossKey, 'image/jpeg');

  return {
    success: true,
    coverUrl,
    ossKey,
    error: 'Imagen 超分不可用，已使用原图',
  };
}

/**
 * 从 Imagen API 响应提取图片
 */
function extractImageFromResponse(data: Record<string, unknown>): Buffer | null {
  try {
    const predictions = data.predictions as Array<Record<string, string>> | undefined;
    if (!predictions || predictions.length === 0) return null;

    const b64 = predictions[0].bytesBase64Encoded;
    if (b64) {
      return Buffer.from(b64, 'base64');
    }

    return null;
  } catch {
    return null;
  }
}
