/**
 * 超级画布 · 渲染层 object key → URL 解析器(P0 · S6,#28 渲染半)
 *
 * 节点只持久化 OSS object key(schema 层拒 dataURL/签名 URL 入库)。渲染层拿 key 经 /api/storage/
 * media-url 换 URL,本模块在其上加一层内存解析:
 *   - **缓存**:同 key 命中不重复请求(peekMediaUrl 同步命中);
 *   - **请求去重**:并发解析同 key 只发一次网络请求,共享同一 in-flight promise;
 *   - **TTL**:成功结果按 expiresInMs(客户端再夹一层上限)过期后重取;
 *   - **失败回收**:失败进短 TTL 负缓存,过期后允许重试;forgetMediaUrl 可强制忘记(用户点重试);
 *   - **abort**:每个调用方传自己的 AbortSignal;某调用方取消**不影响**共享请求(其他调用方照常拿到)。
 *
 * 铁律:解析出的 URL 是**瞬态**,绝不写回节点 data / 持久层(schema 也会拒之入库)。
 * 本模块**不 import canvas-store / 任何持久化通道**,机器上保证 URL 无法回流领域文档。
 *
 * 纯逻辑、无 React、无 window 顶层依赖 —— 可离线单测(configureMediaUrlResolver 注入 fetch/时钟)。
 */
import { describeMediaKeyRejection } from "@/lib/canvas/schema";

/** 解析结果成功值上限 TTL(公有 URL 无过期,仍夹上限使缓存周期刷新)。 */
export const MEDIA_URL_MAX_TTL_MS = 6 * 60 * 60 * 1000; // 6h
/** 失败负缓存 TTL:此窗口内重试直接复用失败(不打网络),过后允许重取。 */
export const MEDIA_URL_ERROR_TTL_MS = 10 * 1000; // 10s

const DEFAULT_ENDPOINT = "/api/storage/media-url";

/**
 * 可信 OSS host(项目 OSS 自定义域 media.toryxai.com);客户端无法读服务端 env
 * (ALIYUN_OSS_CUSTOM_DOMAIN),故在此硬编码可信域。若该域变更须同步此处(或改用 NEXT_PUBLIC 暴露)。
 * 解析结果必须绑定到此 host,防端点异常/被劫持返回任意 https 主机。
 */
export const TRUSTED_MEDIA_HOSTS = ["media.toryxai.com"];

/** 供注入的最小 fetch 形状(offline 单测用假实现)。 */
export interface MediaFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
export type MediaFetchImpl = (
  input: string,
  init?: { credentials?: "include"; signal?: AbortSignal }
) => Promise<MediaFetchResponse>;

interface CacheEntry {
  /** 成功 URL(未过期时有效)。 */
  url: string | null;
  /** 成功新鲜期截止(nowFn() 之后视为过期)。 */
  expiresAt: number;
  /** 失败原因(负缓存期内有效)。 */
  error: string | null;
  /** 负缓存截止。 */
  errorExpiresAt: number;
  /** 进行中的共享请求(去重锚)。 */
  inflight: Promise<string> | null;
}

let cache = new Map<string, CacheEntry>();
let nowFn: () => number = () => Date.now();
let endpoint = DEFAULT_ENDPOINT;
let injectedFetch: MediaFetchImpl | null = null;
let trustedHosts: string[] = [...TRUSTED_MEDIA_HOSTS];

function activeFetch(): MediaFetchImpl {
  if (injectedFetch) return injectedFetch;
  if (typeof fetch === "function") {
    return (input, init) => fetch(input, init as RequestInit) as unknown as Promise<MediaFetchResponse>;
  }
  throw new Error("当前环境无 fetch,无法解析媒体 URL");
}

/** 名为 AbortError 的错误(hook 据 name 静默 abort,不当失败上报)。 */
function abortError(): Error {
  const error = new Error("媒体 URL 解析已取消");
  error.name = "AbortError";
  return error;
}

/**
 * 解析结果严格校验(不信任端点回值):必须 https、**无 credentials**、**无显式端口**、
 * **无 query/hash**、host **绑定可信 OSS 域**、且 pathname **恰为本次请求 key 的对象路径**
 *(`/${expectedKey}`)。防端点异常/被劫持返回任意 https 主机、他人 key、或带凭证/追踪参数的 URL。
 */
export function isSafeResolvedUrl(value: unknown, expectedKey: string): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (typeof expectedKey !== "string" || expectedKey.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false; // 必须 https
  if (url.username !== "" || url.password !== "") return false; // 无 credentials
  if (url.port !== "") return false; // 无异常/显式端口(默认 443)
  if (url.search !== "" || url.hash !== "") return false; // 无 query/hash
  if (!trustedHosts.includes(url.hostname)) return false; // 绑定可信 OSS host
  if (url.pathname !== `/${expectedKey}`) return false; // 绑定本次 key 的对象路径
  return true;
}

function clampTtl(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.min(raw, MEDIA_URL_MAX_TTL_MS)
    : MEDIA_URL_MAX_TTL_MS;
}

async function fetchResolved(key: string): Promise<{ url: string; ttl: number }> {
  const response = await activeFetch()(`${endpoint}?key=${encodeURIComponent(key)}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`媒体 URL 解析失败(HTTP ${response.status})`);
  const body = (await response.json()) as { url?: unknown; expiresInMs?: unknown } | null;
  const url = body?.url;
  // 按**本次请求的 key** 严格校验回值:host/凭证/端口/query/hash + 精确对象路径,均须过。
  if (!isSafeResolvedUrl(url, key)) {
    throw new Error("媒体 URL 解析响应非法(host/key/凭证/query 校验未过)");
  }
  return { url, ttl: clampTtl(body?.expiresInMs) };
}

/**
 * 取(或发起)key 的共享解析 promise:命中新鲜缓存直接返回;命中负缓存直接拒;进行中复用去重;
 * 否则发起一次请求并把 in-flight 记入缓存(供并发去重),完成时写成功/失败结果。
 */
function ensureShared(key: string): Promise<string> {
  const now = nowFn();
  const entry = cache.get(key);
  if (entry) {
    if (entry.inflight) return entry.inflight;
    if (entry.url !== null && now < entry.expiresAt) return Promise.resolve(entry.url);
    if (entry.error !== null && now < entry.errorExpiresAt) {
      return Promise.reject(new Error(entry.error));
    }
    // 过期(成功或失败)→ 落到下方重取。
  }

  // 竞态防护:只有当缓存里当前条目仍指向**本次** inflight 时才写结果。若期间被 forgetMediaUrl
  // 删除、或被更新的 inflight 取代(如用户重试),本次(陈旧/被弃)结果一律丢弃,绝不复活/覆盖新条目。
  const inflight: Promise<string> = fetchResolved(key).then(
    ({ url, ttl }) => {
      const current = cache.get(key);
      if (current && current.inflight === inflight) {
        cache.set(key, {
          url,
          expiresAt: nowFn() + ttl,
          error: null,
          errorExpiresAt: 0,
          inflight: null,
        });
      }
      return url;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const current = cache.get(key);
      if (current && current.inflight === inflight) {
        cache.set(key, {
          url: null,
          expiresAt: 0,
          error: message,
          errorExpiresAt: nowFn() + MEDIA_URL_ERROR_TTL_MS,
          inflight: null,
        });
      }
      throw error instanceof Error ? error : new Error(message);
    }
  );
  // 先把 in-flight 记入缓存(同步),后续并发调用即命中去重;保留可能存在的旧成功值供 peek 兜底。
  cache.set(key, {
    url: entry?.url ?? null,
    expiresAt: entry?.expiresAt ?? 0,
    error: null,
    errorExpiresAt: 0,
    inflight,
  });
  return inflight;
}

/**
 * 解析 object key → https URL。非法 key 同步拒(不打网络)。传 signal 时:该调用方 abort 只拒**本次**
 * 返回的 promise,共享请求继续为其他调用方兑现(去重语义下 abort 一个不牵连全部)。
 */
export function resolveMediaUrl(key: string, opts?: { signal?: AbortSignal }): Promise<string> {
  const rejection = describeMediaKeyRejection(key);
  if (rejection) return Promise.reject(new Error(`非法 object key:${rejection}`));

  const shared = ensureShared(key);
  const signal = opts?.signal;
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (url) => {
        signal.removeEventListener("abort", onAbort);
        resolve(url);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** 同步命中:仅当有未过期的成功 URL 时返回,否则 null(供首帧即时渲染/单测断言)。 */
export function peekMediaUrl(key: string): string | null {
  if (describeMediaKeyRejection(key)) return null;
  const entry = cache.get(key);
  return entry && entry.url !== null && nowFn() < entry.expiresAt ? entry.url : null;
}

/** 强制忘记某 key 的缓存(用户点「重试」:清负缓存,下次解析立即重取)。 */
export function forgetMediaUrl(key: string): void {
  cache.delete(key);
}

/** 注入 fetch/时钟/端点/可信 host(仅测试用);不传的项保持原值。 */
export function configureMediaUrlResolver(opts: {
  fetchImpl?: MediaFetchImpl | null;
  now?: () => number;
  endpoint?: string;
  trustedHosts?: string[];
}): void {
  if ("fetchImpl" in opts) injectedFetch = opts.fetchImpl ?? null;
  if (opts.now) nowFn = opts.now;
  if (opts.endpoint) endpoint = opts.endpoint;
  if (opts.trustedHosts) trustedHosts = [...opts.trustedHosts];
}

/** 清空缓存(测试隔离用)。 */
export function resetMediaUrlCache(): void {
  cache = new Map();
}

/** 当前缓存条目数(测试观测用)。 */
export function mediaUrlCacheSize(): number {
  return cache.size;
}
