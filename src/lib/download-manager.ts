/**
 * 智能下载管理器
 * 
 * 功能:
 * - 线路测速和智能选择
 * - 并发下载控制
 * - 自动重试和线路切换
 * - 下载进度追踪
 */

// ============ 类型定义 ============

export interface DownloadRoute {
  id: string;
  name: string;
  description: string;
  testSize: number;
  priority: number;
}

export interface SpeedTestResult {
  routeId: string;
  status: "pending" | "testing" | "success" | "failed" | "timeout";
  speed: number;        // MB/s
  latency: number;      // ms
  size?: number;        // bytes
  duration?: number;    // seconds
  error?: string;
  testedAt?: number;    // timestamp
}

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  status: "pending" | "downloading" | "success" | "failed";
  progress: number;     // 0-100
  speed?: number;       // MB/s
  error?: string;
  retryCount: number;
  routeUsed?: string;
}

export interface DownloadManagerConfig {
  maxConcurrent: number;      // 最大并发数
  maxRetries: number;         // 最大重试次数
  downloadTimeout: number;    // 下载超时（毫秒）
  retryDelay: number;         // 重试间隔（毫秒）
  cacheExpiry: number;        // 测速缓存过期时间（毫秒）
}

export interface DownloadProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  currentFile?: string;
  currentSpeed?: number;
  estimatedTimeRemaining?: number;
  startTime: number;
}

// ============ 常量配置 ============

const DEFAULT_CONFIG: DownloadManagerConfig = {
  maxConcurrent: 2,             // 同时下载2个
  maxRetries: 3,                // 最多重试3次
  downloadTimeout: 60000,       // 60秒超时
  retryDelay: 1000,             // 1秒后重试
  cacheExpiry: 24 * 60 * 60 * 1000, // 24小时缓存
};

const STORAGE_KEY = "download_speed_test_results";

// ============ 工具函数 ============

/**
 * 从localStorage获取缓存的测速结果
 */
export function getCachedSpeedTestResults(): SpeedTestResult[] {
  if (typeof window === "undefined") return [];
  
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return [];
    
    const data = JSON.parse(cached);
    const now = Date.now();
    
    // 过滤过期的结果
    return (data.results || []).filter((r: SpeedTestResult) => 
      r.testedAt && (now - r.testedAt) < DEFAULT_CONFIG.cacheExpiry
    );
  } catch {
    return [];
  }
}

/**
 * 保存测速结果到localStorage
 */
export function saveSpeedTestResults(results: SpeedTestResult[]): void {
  if (typeof window === "undefined") return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      results,
      savedAt: Date.now(),
    }));
  } catch (error) {
    console.error("[DownloadManager] Failed to save speed test results:", error);
  }
}

/**
 * 获取推荐的线路（按速度排序）
 */
export function getRecommendedRoutes(results: SpeedTestResult[]): SpeedTestResult[] {
  return [...results]
    .filter(r => r.status === "success" && r.speed > 0)
    .sort((a, b) => b.speed - a.speed);
}

/**
 * 获取最佳线路ID
 */
export function getBestRouteId(results: SpeedTestResult[]): string | null {
  const recommended = getRecommendedRoutes(results);
  return recommended[0]?.routeId || null;
}

// ============ 测速功能 ============

/**
 * 获取可用线路列表
 */
export async function fetchAvailableRoutes(): Promise<DownloadRoute[]> {
  try {
    const response = await fetch("/api/speed-test");
    if (!response.ok) throw new Error("Failed to fetch routes");
    const data = await response.json();
    return data.routes || [];
  } catch (error) {
    console.error("[DownloadManager] Failed to fetch routes:", error);
    return [];
  }
}

/**
 * 测试单条线路速度
 */
export async function testRouteSpeed(
  routeId: string, 
  testUrl?: string,
  onProgress?: (status: string) => void
): Promise<SpeedTestResult> {
  onProgress?.(`正在测试 ${routeId} 线路...`);
  
  try {
    const response = await fetch("/api/speed-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId, testUrl }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    return {
      ...result,
      testedAt: Date.now(),
    };
  } catch (error) {
    return {
      routeId,
      status: "failed",
      speed: 0,
      latency: 0,
      error: error instanceof Error ? error.message : "测速失败",
      testedAt: Date.now(),
    };
  }
}

/**
 * 测试所有线路速度
 */
export async function testAllRoutes(
  onProgress?: (results: SpeedTestResult[], currentRoute: string) => void
): Promise<SpeedTestResult[]> {
  const routes = await fetchAvailableRoutes();
  const results: SpeedTestResult[] = [];
  
  for (const route of routes) {
    // 初始化为testing状态
    const pendingResult: SpeedTestResult = {
      routeId: route.id,
      status: "testing",
      speed: 0,
      latency: 0,
    };
    results.push(pendingResult);
    onProgress?.(results, route.name);
    
    // 执行测速
    const result = await testRouteSpeed(route.id);
    
    // 更新结果
    const index = results.findIndex(r => r.routeId === route.id);
    if (index >= 0) {
      results[index] = result;
    }
    onProgress?.(results, route.name);
  }
  
  // 保存结果
  saveSpeedTestResults(results);
  
  return results;
}

// ============ 前端测速功能（直接在浏览器测试） ============

/**
 * 在浏览器端直接测速（更准确反映用户网络情况）
 */
export async function testRouteSpeedInBrowser(
  url: string,
  onProgress?: (bytesLoaded: number, totalBytes: number) => void
): Promise<{ speed: number; duration: number; size: number } | null> {
  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    // 使用 reader 读取数据以获取进度
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No reader available");
    
    let bytesLoaded = 0;
    const chunks: Uint8Array[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      bytesLoaded += value.length;
      onProgress?.(bytesLoaded, totalBytes);
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const speedMBps = bytesLoaded / duration / (1024 * 1024);
    
    return {
      speed: Math.round(speedMBps * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      size: bytesLoaded,
    };
  } catch (error) {
    console.error("[DownloadManager] Browser speed test failed:", error);
    return null;
  }
}

// ============ 下载功能 ============

/**
 * 通过代理下载文件
 */
export async function downloadViaProxy(
  url: string,
  filename: string,
  routeId?: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<Blob | null> {
  try {
    const params = new URLSearchParams({
      url,
      filename,
      ...(routeId && { route: routeId }),
    });
    
    const proxyUrl = `/api/download-proxy?${params}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "下载失败" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    // 如果有进度回调且支持流式读取
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
      
      // 合并所有chunks
      const blob = new Blob(chunks);
      return blob;
    }
    
    return await response.blob();
  } catch (error) {
    console.error("[DownloadManager] Proxy download failed:", error);
    return null;
  }
}

/**
 * 触发浏览器下载
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 智能下载文件（自动选择最佳线路，支持重试）
 */
export async function smartDownload(
  url: string,
  filename: string,
  options?: {
    preferredRoute?: string;
    maxRetries?: number;
    onProgress?: (loaded: number, total: number) => void;
    onRetry?: (attempt: number, error: string) => void;
  }
): Promise<boolean> {
  const { preferredRoute, maxRetries = 3, onProgress, onRetry } = options || {};
  
  // 获取最佳线路
  let routeId = preferredRoute;
  if (!routeId) {
    const cachedResults = getCachedSpeedTestResults();
    routeId = getBestRouteId(cachedResults) || undefined;
  }
  
  // 尝试下载
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DownloadManager] Download attempt ${attempt}/${maxRetries}, route: ${routeId || "default"}`);
      
      const blob = await downloadViaProxy(url, filename, routeId, onProgress);
      if (blob && blob.size > 0) {
        triggerBrowserDownload(blob, filename);
        return true;
      }
      
      throw new Error("下载数据为空");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "下载失败";
      console.error(`[DownloadManager] Attempt ${attempt} failed:`, errorMsg);
      
      if (attempt < maxRetries) {
        onRetry?.(attempt, errorMsg);
        await new Promise(resolve => setTimeout(resolve, DEFAULT_CONFIG.retryDelay));
        
        // 切换到备用线路
        if (routeId && routeId !== "backup") {
          routeId = "backup";
          console.log("[DownloadManager] Switching to backup route");
        }
      }
    }
  }
  
  return false;
}

// ============ 批量下载管理 ============

export interface BatchDownloadOptions {
  maxConcurrent?: number;
  delayBetweenDownloads?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onTaskComplete?: (taskId: string, success: boolean, filename: string) => void;
  onCancel?: () => boolean;
}

/**
 * 批量下载任务
 */
export async function batchDownload(
  tasks: { id: string; url: string; filename: string }[],
  options?: BatchDownloadOptions
): Promise<{ success: number; failed: number; cancelled: boolean }> {
  const {
    maxConcurrent = 2,
    delayBetweenDownloads = 500,
    onProgress,
    onTaskComplete,
    onCancel,
  } = options || {};
  
  const results = { success: 0, failed: 0, cancelled: false };
  const progress: DownloadProgress = {
    total: tasks.length,
    completed: 0,
    failed: 0,
    inProgress: 0,
    startTime: Date.now(),
  };
  
  // 获取最佳线路
  const cachedResults = getCachedSpeedTestResults();
  const bestRoute = getBestRouteId(cachedResults);
  
  // 创建任务队列
  const queue = [...tasks];
  const activeDownloads = new Map<string, Promise<boolean>>();
  
  const processNext = async (): Promise<void> => {
    // 检查是否取消
    if (onCancel?.()) {
      results.cancelled = true;
      return;
    }
    
    // 获取下一个任务
    const task = queue.shift();
    if (!task) return;
    
    progress.inProgress++;
    progress.currentFile = task.filename;
    onProgress?.({ ...progress });
    
    // 执行下载
    const downloadPromise = smartDownload(task.url, task.filename, {
      preferredRoute: bestRoute || undefined,
    });
    
    activeDownloads.set(task.id, downloadPromise);
    
    try {
      const success = await downloadPromise;
      
      if (success) {
        results.success++;
        progress.completed++;
      } else {
        results.failed++;
        progress.failed++;
      }
      
      onTaskComplete?.(task.id, success, task.filename);
    } catch {
      results.failed++;
      progress.failed++;
      onTaskComplete?.(task.id, false, task.filename);
    } finally {
      progress.inProgress--;
      activeDownloads.delete(task.id);
      
      // 计算预估剩余时间
      const elapsed = Date.now() - progress.startTime;
      const avgTimePerTask = elapsed / (progress.completed + progress.failed);
      const remaining = progress.total - progress.completed - progress.failed;
      progress.estimatedTimeRemaining = Math.round(avgTimePerTask * remaining / 1000);
      
      onProgress?.({ ...progress });
    }
    
    // 添加下载间隔
    if (queue.length > 0 && delayBetweenDownloads > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenDownloads));
    }
  };
  
  // 启动并发下载
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(maxConcurrent, tasks.length); i++) {
    workers.push((async () => {
      while (queue.length > 0 && !results.cancelled) {
        await processNext();
      }
    })());
  }
  
  // 等待所有下载完成
  await Promise.all(workers);
  
  return results;
}

// ============ 导出默认配置 ============

export const downloadManagerConfig = DEFAULT_CONFIG;

