/**
 * Link Adapter — 链接导入服务
 *
 * 审计采纳 3.6: 复用 link-parser.ts 的 URL 分类，但单独做下载 + OSS 转存
 *
 * 职责:
 * 1. URL 分类（使用 detectPlatform）
 * 2. 视频下载
 * 3. 转存到自有 OSS
 * 4. 失败回退"请上传原视频"
 *
 * V1.5 支持矩阵:
 * - 直链 mp4 ✅
 * - TikTok 单条公开视频 ✅ (best effort)
 * - 抖音单条公开视频 ✅ (best effort)
 */

import { detectPlatform } from '@/types/link-video';
import { uploadBuffer, generateMediaPath } from '@/lib/oss';

// ============================================================================
// 配置
// ============================================================================

/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 120000; // 2 分钟

/** 最大视频大小（bytes） */
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

/** User-Agent 列表 */
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// ============================================================================
// 类型
// ============================================================================

export interface LinkIngestResult {
  success: boolean;
  /** 视频 OSS URL */
  videoUrl?: string;
  /** OSS 对象键 */
  ossKey?: string;
  /** 文件大小（bytes） */
  sizeBytes?: number;
  /** 检测到的平台 */
  platform?: string;
  /** 失败时的回退消息 */
  fallbackMessage?: string;
  error?: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 从链接导入视频
 *
 * @param url 用户粘贴的链接
 * @param userId 用户 ID
 */
export async function ingestFromLink(
  url: string,
  userId: string
): Promise<LinkIngestResult> {
  console.log(`[LinkAdapter] Ingesting: ${url.substring(0, 80)}`);

  // Step 1: 检测平台
  const platform = detectPlatform(url);
  console.log(`[LinkAdapter] Platform: ${platform}`);

  // Step 2: 根据平台获取视频下载 URL
  let downloadUrl: string;

  try {
    switch (platform) {
      case 'tiktok':
        downloadUrl = await resolveTikTokUrl(url);
        break;
      case 'douyin':
        downloadUrl = await resolveDouyinUrl(url);
        break;
      default:
        // 直链或其他平台，直接用原 URL
        downloadUrl = url;
    }
  } catch (error) {
    return {
      success: false,
      platform: platform || 'unknown',
      fallbackMessage: '链接解析失败，请直接上传原视频',
      error: error instanceof Error ? error.message : '链接解析失败',
    };
  }

  // Step 3: 下载视频
  try {
    console.log(`[LinkAdapter] Downloading: ${downloadUrl.substring(0, 80)}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'video/*,*/*',
        'Referer': url,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        platform,
        fallbackMessage: '视频下载失败，请直接上传原视频',
        error: `HTTP ${response.status}`,
      };
    }

    // 检查 content-type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
      // 可能是 HTML 页面而非视频
      return {
        success: false,
        platform,
        fallbackMessage: '链接未返回视频文件，请直接上传原视频',
        error: `Unexpected content-type: ${contentType}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);

    // 检查文件大小
    if (videoBuffer.length > MAX_VIDEO_SIZE) {
      return {
        success: false,
        platform,
        fallbackMessage: '视频文件过大（超过 500MB），请压缩后上传',
        error: `File too large: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`,
      };
    }

    if (videoBuffer.length < 10000) {
      return {
        success: false,
        platform,
        fallbackMessage: '下载的文件太小，可能不是有效视频，请直接上传原视频',
        error: `File too small: ${videoBuffer.length} bytes`,
      };
    }

    // Step 4: 上传到自有 OSS
    const ossKey = generateMediaPath('videos', userId, `vc-ingest-${Date.now()}.mp4`);
    const ossUrl = await uploadBuffer(videoBuffer, ossKey, 'video/mp4');

    console.log(`[LinkAdapter] Ingested: ${platform}, ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB → ${ossUrl.substring(0, 60)}`);

    return {
      success: true,
      videoUrl: ossUrl,
      ossKey,
      sizeBytes: videoBuffer.length,
      platform,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isAbort = errMsg.includes('abort');

    return {
      success: false,
      platform,
      fallbackMessage: isAbort
        ? '视频下载超时，请直接上传原视频'
        : '视频下载失败，请直接上传原视频',
      error: errMsg,
    };
  }
}

// ============================================================================
// 平台特定解析
// ============================================================================

/**
 * 解析 TikTok 短链接/分享链接 → 视频直链
 */
async function resolveTikTokUrl(url: string): Promise<string> {
  // TikTok 分享链接通常是短链，需要跟随重定向获取真实页面
  // 然后从 __UNIVERSAL_DATA_FOR_REHYDRATION__ 中提取 downloadAddr
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENTS[0],
      },
      redirect: 'follow',
    });

    if (!response.ok) throw new Error(`TikTok page: HTTP ${response.status}`);

    const html = await response.text();

    // 尝试从 JSON 数据中提取视频 URL
    const videoUrlMatch = html.match(/"downloadAddr":"([^"]+)"/);
    if (videoUrlMatch) {
      return videoUrlMatch[1].replace(/\\u002F/g, '/');
    }

    // 备用: 从 playAddr 提取
    const playAddrMatch = html.match(/"playAddr":"([^"]+)"/);
    if (playAddrMatch) {
      return playAddrMatch[1].replace(/\\u002F/g, '/');
    }

    throw new Error('无法从 TikTok 页面提取视频 URL');
  } catch (error) {
    throw new Error(`TikTok 解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 解析抖音短链接/分享链接 → 视频直链
 */
async function resolveDouyinUrl(url: string): Promise<string> {
  try {
    // 抖音短链需要跟随重定向
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENTS[0],
      },
      redirect: 'follow',
    });

    if (!response.ok) throw new Error(`Douyin page: HTTP ${response.status}`);

    const html = await response.text();

    // 从 SSR 数据中提取
    const videoMatch = html.match(/"playApi":"([^"]+)"/);
    if (videoMatch) {
      const videoPath = videoMatch[1].replace(/\\u002F/g, '/');
      return videoPath.startsWith('http') ? videoPath : `https:${videoPath}`;
    }

    throw new Error('无法从抖音页面提取视频 URL');
  } catch (error) {
    throw new Error(`抖音解析失败 (best effort): ${error instanceof Error ? error.message : '未知错误'}`);
  }
}
