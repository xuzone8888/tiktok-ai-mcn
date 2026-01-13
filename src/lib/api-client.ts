/**
 * 优化的 API 客户端
 * 
 * 功能：
 * - 请求去重（防止重复请求）
 * - 请求缓存
 * - 自动重试
 * - 超时控制
 * - 错误处理
 */

import { createLogger } from './logger';

const logger = createLogger('APIClient');

// ============================================================================
// 类型定义
// ============================================================================

interface RequestConfig extends RequestInit {
  /** 缓存时间（毫秒），0 表示不缓存 */
  cacheTTL?: number;
  /** 重试次数 */
  retries?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否启用去重 */
  dedupe?: boolean;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}

// ============================================================================
// 请求缓存
// ============================================================================

const cache = new Map<string, CacheEntry<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();

function getCacheKey(url: string, config?: RequestConfig): string {
  const method = config?.method || 'GET';
  const body = config?.body ? JSON.stringify(config.body) : '';
  return `${method}:${url}:${body}`;
}

function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache<T>(key: string, data: T, ttl: number): void {
  if (ttl <= 0) return;
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
}

// 清理过期缓存
function cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      cache.delete(key);
    }
  }
}

// 每分钟清理一次缓存
if (typeof window !== 'undefined') {
  setInterval(cleanupCache, 60000);
}

// ============================================================================
// 请求函数
// ============================================================================

async function fetchWithTimeout(
  url: string,
  config: RequestConfig,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...config,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry<T>(
  url: string,
  config: RequestConfig,
  retries: number
): Promise<T> {
  let lastError: Error | null = null;
  const timeout = config.timeout || 30000;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetchWithTimeout(url, config, timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        // 如果不是 JSON，返回文本
        return text as unknown as T;
      }
    } catch (error) {
      lastError = error as Error;
      
      // 如果是最后一次重试，或者是客户端错误（4xx），不再重试
      if (i === retries || (error instanceof Error && error.message.includes('HTTP 4'))) {
        break;
      }

      // 指数退避
      const delay = Math.min(1000 * Math.pow(2, i), 10000);
      logger.warn(`Request failed, retrying in ${delay}ms (${i + 1}/${retries})`, { url, error });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Request failed');
}

// ============================================================================
// 导出的 API 客户端
// ============================================================================

export const apiClient = {
  /**
   * 发送 GET 请求
   */
  async get<T = unknown>(url: string, config: RequestConfig = {}): Promise<T> {
    const {
      cacheTTL = 0,
      retries = 0,
      dedupe = true,
      ...fetchConfig
    } = config;

    const cacheKey = getCacheKey(url, { method: 'GET', ...fetchConfig });

    // 检查缓存
    if (cacheTTL > 0) {
      const cached = getFromCache<T>(cacheKey);
      if (cached) {
        logger.debug('Cache hit', { url });
        return cached;
      }
    }

    // 检查是否有正在进行的相同请求
    if (dedupe && pendingRequests.has(cacheKey)) {
      logger.debug('Deduping request', { url });
      return pendingRequests.get(cacheKey) as Promise<T>;
    }

    // 发送请求
    const requestPromise = fetchWithRetry<T>(url, {
      method: 'GET',
      ...fetchConfig,
    }, retries);

    // 添加到进行中的请求
    if (dedupe) {
      pendingRequests.set(cacheKey, requestPromise);
    }

    try {
      const data = await requestPromise;

      // 缓存响应
      if (cacheTTL > 0) {
        setCache(cacheKey, data, cacheTTL);
      }

      return data;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  },

  /**
   * 发送 POST 请求
   */
  async post<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {}
  ): Promise<T> {
    const { retries = 0, dedupe = false, ...fetchConfig } = config;

    const requestConfig: RequestConfig = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...fetchConfig.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      ...fetchConfig,
    };

    const cacheKey = getCacheKey(url, requestConfig);

    // POST 请求也可以去重（同一时间只允许一个相同请求）
    if (dedupe && pendingRequests.has(cacheKey)) {
      logger.debug('Deduping POST request', { url });
      return pendingRequests.get(cacheKey) as Promise<T>;
    }

    const requestPromise = fetchWithRetry<T>(url, requestConfig, retries);

    if (dedupe) {
      pendingRequests.set(cacheKey, requestPromise);
    }

    try {
      return await requestPromise;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  },

  /**
   * 发送 PUT 请求
   */
  async put<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {}
  ): Promise<T> {
    const { retries = 0, ...fetchConfig } = config;

    return fetchWithRetry<T>(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...fetchConfig.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      ...fetchConfig,
    }, retries);
  },

  /**
   * 发送 DELETE 请求
   */
  async delete<T = unknown>(url: string, config: RequestConfig = {}): Promise<T> {
    const { retries = 0, ...fetchConfig } = config;

    return fetchWithRetry<T>(url, {
      method: 'DELETE',
      ...fetchConfig,
    }, retries);
  },

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    cache.clear();
    logger.info('Cache cleared');
  },

  /**
   * 清除指定 URL 的缓存
   */
  invalidateCache(url: string): void {
    for (const key of cache.keys()) {
      if (key.includes(url)) {
        cache.delete(key);
      }
    }
    logger.debug('Cache invalidated', { url });
  },
};

// ============================================================================
// 便捷的 API 响应包装器
// ============================================================================

export async function safeApiCall<T>(
  promise: Promise<ApiResponse<T>>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await promise;
    if (response.success && response.data) {
      return { data: response.data, error: null };
    }
    return { data: null, error: response.error || 'Unknown error' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    logger.error('API call failed', { error: message });
    return { data: null, error: message };
  }
}

export default apiClient;
