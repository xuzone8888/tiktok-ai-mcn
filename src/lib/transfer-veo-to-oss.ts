/**
 * VEO 视频 OSS 转存工具
 *
 * 当 VEO3 视频生成完成后，video_url 指向临时 CDN（videos-us3.ss2.life），
 * 该链接有效期仅几分钟。此模块在视频完成的第一时间将其下载并上传到
 * 自有阿里云 OSS（media.toryxai.com），返回永久可下载地址。
 *
 * 特性：
 * - 强制 IPv4（阿里云 ECS 兼容）
 * - 3 次重试 + 递增间隔（应对 ss2.life 不稳定）
 * - 30 秒单次下载超时
 * - 视频约 2-3MB，使用 Buffer（无需流式）
 */

import https from 'https';
import http from 'http';
import { uploadVideoBuffer, getPublicUrl, isOSSUrl } from '@/lib/oss';

const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com';
const OSS_BUCKET = process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos';
const OSS_ENDPOINT_HOST = (() => {
  try {
    return new URL(process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com').hostname;
  } catch {
    return 'oss-cn-beijing.aliyuncs.com';
  }
})();

/**
 * 从 URL 下载视频到 Buffer（强制 IPv4，带超时）
 */
function downloadVideo(url: string, timeoutMs: number = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;

    const req = mod.get(
      url,
      {
        family: 4,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'ToryxAI-VideoTransfer/1.0',
          'Accept': 'video/mp4, video/*, */*',
        },
      },
      (res) => {
        // 跟随重定向
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            console.log(`[Transfer VEO] Redirecting to: ${redirectUrl.substring(0, 80)}...`);
            downloadVideo(redirectUrl, timeoutMs).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const maxSize = 200 * 1024 * 1024; // 200MB safety limit

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxSize) {
            req.destroy();
            reject(new Error(`File too large: ${totalBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * 将 VEO 视频从临时 CDN 转存到自有 OSS
 *
 * @param taskId - VEO 任务 ID
 * @param videoUrl - 原始视频 URL（ss2.life 等临时 CDN）
 * @param userId - 用户 ID（可选，用于 OSS 路径组织）
 * @returns OSS 永久 URL 或错误
 */
export async function transferVeoVideoToOSS(
  taskId: string,
  videoUrl: string,
  userId?: string
): Promise<{ success: boolean; ossUrl?: string; error?: string }> {
  // 如果已经是 OSS URL，直接返回
  if (isOSSUrl(videoUrl)) {
    console.log(`[Transfer VEO] Already OSS URL, skipping: ${videoUrl.substring(0, 60)}`);
    return { success: true, ossUrl: videoUrl };
  }

  const maxRetries = 3;
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Transfer VEO] Downloading (attempt ${attempt}/${maxRetries}): ${videoUrl.substring(0, 80)}...`);

      const startTime = Date.now();
      const videoBuffer = await downloadVideo(videoUrl, 30000);
      const downloadTime = Date.now() - startTime;

      console.log(`[Transfer VEO] Downloaded: ${videoBuffer.length} bytes in ${downloadTime}ms`);

      // 生成 OSS 路径
      const userFolder = userId || 'anonymous';
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const ossPath = `veo-videos/${userFolder}/${timestamp}-${randomId}-${taskId.substring(0, 10)}.mp4`;

      // 上传到 OSS
      console.log(`[Transfer VEO] Uploading to OSS: ${ossPath}`);
      const ossUrl = await uploadVideoBuffer(videoBuffer, ossPath, 'video/mp4');

      console.log(`[Transfer VEO] ✅ Transfer complete: ${ossUrl}`);
      return { success: true, ossUrl };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[Transfer VEO] Attempt ${attempt}/${maxRetries} failed:`, lastError);

      if (attempt < maxRetries) {
        const waitMs = 3000 * attempt; // 3s, 6s, 9s
        console.log(`[Transfer VEO] Retrying in ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  console.error(`[Transfer VEO] ❌ All ${maxRetries} attempts failed for task ${taskId}: ${lastError}`);
  return { success: false, error: `转存失败（${maxRetries}次重试）: ${lastError}` };
}

/**
 * 检查 URL 是否是自有 OSS 的永久地址
 */
export function isOSSPermanentUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === CUSTOM_DOMAIN ||
      urlObj.hostname === `${OSS_BUCKET}.${OSS_ENDPOINT_HOST}` ||
      urlObj.hostname.startsWith(`${OSS_BUCKET}.oss-`)
    );
  } catch {
    return false;
  }
}
