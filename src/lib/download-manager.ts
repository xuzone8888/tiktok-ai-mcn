/**
 * 统一下载管理器（精简版）
 * 
 * 功能:
 * - 智能下载（OSS 直连 / 代理转发）
 * - AbortController 支持取消
 * - ReadableStream 分块读取 + 精确进度
 * - 自动重试（最多 3 次）
 * - 正确的文件扩展名检测
 * - 内存泄漏防护（revokeObjectURL）
 */

// ============ 类型定义 ============

export interface DownloadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface SmartDownloadOptions extends DownloadOptions {
  maxRetries?: number;
  onRetry?: (attempt: number, error: string) => void;
  /** If true, returns the blob instead of triggering browser download */
  returnBlob?: boolean;
}

export interface DownloadManagerConfig {
  maxRetries: number;
  downloadTimeout: number;
  retryDelay: number;
}

// ============ 常量配置 ============

const DEFAULT_CONFIG: DownloadManagerConfig = {
  maxRetries: 3,
  downloadTimeout: 120000,    // 120 秒超时（与 download-proxy API 一致）
  retryDelay: 1000,           // 1 秒后重试
};

// ============ 工具函数 ============

/**
 * 判断 URL 是否可以直连下载（不需要再套代理）
 * - 自有 OSS 域名（media.toryxai.com）
 * - 已经是代理 URL（/api/ 开头的 same-origin 请求）
 */
export function isOSSDirectUrl(url: string): boolean {
  // 已经是 same-origin 代理 URL，直接 fetch 即可，不要再套一层代理
  if (url.startsWith("/api/")) {
    return true;
  }
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === "media.toryxai.com" ||
      urlObj.hostname.endsWith(".toryxai.com")
    );
  } catch {
    return false;
  }
}

/**
 * 从 URL 路径或 Content-Type 头检测正确的文件扩展名
 */
export function detectFileExtension(url: string, contentType?: string): string {
  // 优先从 Content-Type 判断
  if (contentType) {
    const mimeMap: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/svg+xml": ".svg",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "video/quicktime": ".mov",
      "application/pdf": ".pdf",
    };
    // Content-Type 可能带参数，如 "image/png; charset=utf-8"
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (mimeMap[mime]) return mimeMap[mime];
  }

  // 从 URL 路径提取扩展名
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (match) {
      const ext = match[1].toLowerCase();
      const validExts = ["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "webm", "mov", "pdf"];
      if (validExts.includes(ext)) {
        return `.${ext === "jpeg" ? "jpg" : ext}`;
      }
    }
  } catch {
    // URL 解析失败，忽略
  }

  // 默认返回空（由调用方决定）
  return "";
}

/**
 * 确保文件名有正确的扩展名
 */
export function ensureFileExtension(filename: string, url: string, contentType?: string): string {
  const currentExt = filename.match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase();
  const detectedExt = detectFileExtension(url, contentType);

  // 如果已有正确扩展名，直接返回
  if (currentExt && detectedExt && currentExt === detectedExt) {
    return filename;
  }

  // 如果检测到扩展名但当前没有或不匹配，替换/追加
  if (detectedExt) {
    if (currentExt) {
      return filename.replace(/\.[a-zA-Z0-9]+$/, detectedExt);
    }
    return `${filename}${detectedExt}`;
  }

  return filename;
}

// ============ 核心下载函数 ============

/**
 * 通过流式读取下载文件（内部通用逻辑）
 * 支持 AbortSignal 和精确进度回调
 */
async function streamDownload(
  fetchUrl: string,
  options?: DownloadOptions
): Promise<Blob | null> {
  const { onProgress, signal } = options || {};

  try {
    const response = await fetch(fetchUrl, { signal });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "下载失败" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    // 使用 ReadableStream 分块读取（精确进度 + 不一次性加载全部内存）
    if (onProgress && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytesLoaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        bytesLoaded += value.length;
        onProgress(bytesLoaded, totalBytes);
      }

      return new Blob(chunks as unknown as BlobPart[]);
    }

    // 无进度回调时，直接 blob（更简洁）
    return await response.blob();
  } catch (error) {
    // AbortError 不算异常（用户主动取消）
    if (error instanceof DOMException && error.name === "AbortError") {
      console.log("[DownloadManager] Download cancelled by user");
      return null;
    }
    console.error("[DownloadManager] Stream download failed:", error);
    throw error; // 向上抛出以便重试
  }
}

/**
 * 通过代理下载文件（用于跨域资源）
 */
export async function downloadViaProxy(
  url: string,
  filename: string,
  options?: DownloadOptions
): Promise<Blob | null> {
  const params = new URLSearchParams({ url, filename });
  const proxyUrl = `/api/download-proxy?${params}`;
  return streamDownload(proxyUrl, options);
}

/**
 * 直连下载（用于 OSS 自有域名文件，不走代理更快）
 */
export async function directDownload(
  url: string,
  options?: DownloadOptions
): Promise<Blob | null> {
  return streamDownload(url, options);
}

/**
 * 触发浏览器保存文件
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 延迟释放 blob URL，防止内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 智能下载文件
 * 
 * - 自动判断 OSS 直连 vs 代理
 * - 自动重试（默认 3 次）
 * - 支持 AbortController 取消
 * - 支持进度回调
 */
export async function smartDownload(
  url: string,
  filename: string,
  options?: SmartDownloadOptions
): Promise<{ success: boolean; blob?: Blob }> {
  const {
    maxRetries = DEFAULT_CONFIG.maxRetries,
    onProgress,
    onRetry,
    signal,
    returnBlob = false,
  } = options || {};

  const useDirectDownload = isOSSDirectUrl(url);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 检查是否已取消
    if (signal?.aborted) {
      return { success: false };
    }

    try {
      console.log(
        `[DownloadManager] Attempt ${attempt}/${maxRetries}, ` +
        `mode: ${useDirectDownload ? "direct" : "proxy"}, ` +
        `url: ${url.substring(0, 80)}...`
      );

      const downloadOptions: DownloadOptions = { onProgress, signal };

      const blob = useDirectDownload
        ? await directDownload(url, downloadOptions)
        : await downloadViaProxy(url, filename, downloadOptions);

      if (blob && blob.size > 0) {
        if (returnBlob) {
          return { success: true, blob };
        }
        triggerBrowserDownload(blob, filename);
        return { success: true };
      }

      throw new Error("下载数据为空");
    } catch (error) {
      // 用户取消，不重试
      if (error instanceof DOMException && error.name === "AbortError") {
        return { success: false };
      }
      if (signal?.aborted) {
        return { success: false };
      }

      const errorMsg = error instanceof Error ? error.message : "下载失败";
      console.error(`[DownloadManager] Attempt ${attempt} failed:`, errorMsg);

      if (attempt < maxRetries) {
        onRetry?.(attempt, errorMsg);
        await new Promise(resolve => setTimeout(resolve, DEFAULT_CONFIG.retryDelay));
      }
    }
  }

  return { success: false };
}

// ============ 导出配置 ============

export const downloadManagerConfig = DEFAULT_CONFIG;
