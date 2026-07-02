/**
 * Reference Parser - 海外商品链接抓取(S2.1,链接腿第一跳)
 *
 * 承诺范围(BLUEPRINT §四裁决):Amazon / Shopify / TikTok Shop(OG meta 可抓)。
 * 通道:Shopify 公开 /products/{handle}.json(结构最全)→ 通用 OG meta 正则。
 * 淘宝/1688 等登录墙站点不承诺,失败时由前端引导走拖图腿。
 *
 * 器官回收:generateUrlHash / cleanTrackingParams / OG 正则 / 图片过滤
 * 摘自 src/lib/link-parser.ts(该文件随 link-video 在 S2.4 拆除,本文件自包含)。
 *
 * SSRF:所有服务端 fetch 走 safeFetch —— 手动跟随重定向,每一跳都过
 * isPrivateOrLoopbackHostname 闸(修复旧 parseGenericPage redirect:'follow'
 * 逐跳不校验的缺口;DNS 重绑定局限见 url-safety.ts 头注释)。
 */

import crypto from "crypto";
import { isPrivateOrLoopbackHostname } from "@/lib/publish/url-safety";

// ============================================================================
// 类型
// ============================================================================

export type ReferencePlatform = "amazon" | "shopify" | "tiktok_shop" | "generic";

export interface ReferenceRaw {
  platform: ReferencePlatform;
  /** 实际命中的抓取通道 */
  channel: "shopify_json" | "og_meta";
  title: string;
  description?: string;
  price?: string;
  /** 页面原始图片 URL(未转存;调用方负责转存 OSS) */
  images: string[];
}

export interface ParseReferenceResult {
  success: boolean;
  data?: ReferenceRaw;
  error?: string;
}

// ============================================================================
// URL 工具(摘自 link-parser.ts)
// ============================================================================

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "ref", "source", "spm", "scm", "pvid", "from",
];

export function cleanTrackingParams(url: string): string {
  try {
    const urlObj = new URL(url);
    TRACKING_PARAMS.forEach((param) => urlObj.searchParams.delete(param));
    return urlObj.toString();
  } catch {
    return url;
  }
}

/** 缓存键:MD5(去追踪参数后的 URL)——与 reference_cache.url_hash 对应 */
export function generateUrlHash(url: string): string {
  return crypto.createHash("md5").update(cleanTrackingParams(url)).digest("hex");
}

/** 从任意文本中提取第一个 http(s) URL(omnibox 贴入检测同款正则的服务端镜像) */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>)\]]+/i);
  return match ? match[0] : null;
}

export function detectReferencePlatform(rawUrl: string): ReferencePlatform {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (/(^|\.)amazon\.[a-z.]{2,10}$/.test(host) || /(^|\.)amzn\.[a-z.]{2,10}$/.test(host)) {
      return "amazon";
    }
    if (/(^|\.)tiktok\.com$/.test(host)) {
      return "tiktok_shop";
    }
    // Shopify 店铺多为自有域名,按标准商品路径 /products/{handle} 识别(启发式,
    // JSON 通道失败会自动落回 OG meta,误判无害)
    if (/\/products\/[^/?#]+/.test(u.pathname)) {
      return "shopify";
    }
    return "generic";
  } catch {
    return "generic";
  }
}

// ============================================================================
// SSRF 安全 fetch(手动跟跳,逐跳校验)
// ============================================================================

const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

const MAX_REDIRECTS = 5;

/** 校验外链 URL 可抓:仅 http/https 且主机非私网/环回。不合法返回错误文案。 */
export function validateExternalUrl(rawUrl: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "链接格式不正确" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "仅支持 http/https 链接" };
  }
  if (isPrivateOrLoopbackHostname(url.hostname)) {
    return { error: "该链接不可访问" };
  }
  return { url };
}

/**
 * SSRF 安全 fetch:redirect:'manual' + 逐跳 isPrivateOrLoopbackHostname 校验。
 * 返回终跳 Response(非 2xx 也返回,由调用方判定)。
 */
export async function safeFetch(
  rawUrl: string,
  init: { accept?: string; timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = validateExternalUrl(current);
    if ("error" in checked) throw new Error(checked.error);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("抓取超时");

    const response = await fetch(current, {
      headers: {
        "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        Accept:
          init.accept ??
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("重定向次数过多");
}

// ============================================================================
// 文本/图片工具(摘自 link-parser.ts)
// ============================================================================

function cleanText(text: string): string {
  return text.replace(/[\n\r\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return cleanText(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractPrice(text: string): string {
  const match = text.match(/[\d,]+\.?\d*/);
  return match ? match[0].replace(/,/g, "") : text;
}

/** 过滤 logo/icon/广告等非商品图 */
function filterValidImages(urls: string[]): string[] {
  return urls.filter((url) => {
    if (url.length < 20) return false;
    if (!/\.(jpg|jpeg|png|webp|gif)/i.test(url) && !/image|img|pic/i.test(url)) return false;
    if (/logo|icon|avatar|banner|ad|promotion|sprite|favicon/i.test(url)) return false;
    return true;
  });
}

// ============================================================================
// 通道一:Shopify 公开商品 JSON(/products/{handle}.json)
// ============================================================================

async function parseShopifyJson(rawUrl: string): Promise<ReferenceRaw | null> {
  try {
    const u = new URL(rawUrl);
    const match = u.pathname.match(/(.*\/products\/[^/?#]+)/);
    if (!match) return null;
    const jsonUrl = `${u.origin}${match[1]}.json`;

    const res = await safeFetch(jsonUrl, { accept: "application/json", timeoutMs: 15_000 });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return null;

    const body = (await res.json()) as {
      product?: {
        title?: string;
        body_html?: string;
        vendor?: string;
        images?: Array<{ src?: string }>;
        variants?: Array<{ price?: string }>;
      };
    };
    const product = body?.product;
    if (!product?.title) return null;

    const images = (product.images ?? [])
      .map((img) => (typeof img?.src === "string" ? img.src : ""))
      .filter((src) => src.startsWith("http"))
      .slice(0, 9);

    return {
      platform: "shopify",
      channel: "shopify_json",
      title: cleanText(product.title).slice(0, 200),
      description: product.body_html ? stripHtml(product.body_html).slice(0, 2000) : undefined,
      price: product.variants?.[0]?.price ? extractPrice(String(product.variants[0].price)) : undefined,
      images,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// 通道二:通用 OG meta 抓取
// ============================================================================

const MAX_HTML_BYTES = 3 * 1024 * 1024;

async function parseOgMeta(rawUrl: string, platform: ReferencePlatform): Promise<ReferenceRaw | null> {
  const res = await safeFetch(rawUrl, { timeoutMs: 25_000 });
  if (!res.ok) {
    throw new Error(`目标页面返回 HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_HTML_BYTES) {
    throw new Error("页面过大,无法解析");
  }
  const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);

  let title = "";
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = cleanText(titleMatch[1]);
  const ogTitleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogTitleMatch) title = cleanText(ogTitleMatch[1]);
  title = decodeEntities(title);

  let description = "";
  const ogDescMatch =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (ogDescMatch) description = decodeEntities(cleanText(ogDescMatch[1]));

  const images: string[] = [];
  for (const match of html.matchAll(
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi
  )) {
    const src = decodeEntities(match[1]);
    if (src.startsWith("http") && !images.includes(src)) images.push(src);
    if (images.length >= 9) break;
  }
  if (images.length < 9) {
    for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const src = match[1];
      if (src?.startsWith("http") && !images.includes(src)) images.push(src);
      if (images.length >= 20) break;
    }
  }

  let price = "";
  const pricePatterns = [
    /<meta[^>]+property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i,
    /["']price["']\s*:\s*["']?([\d,.]+)/i,
    /¥\s*([\d,.]+)/,
    /\$\s*([\d,.]+)/,
  ];
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      price = extractPrice(match[1]);
      break;
    }
  }

  if (!title) return null;

  return {
    platform,
    channel: "og_meta",
    title: title.slice(0, 200),
    description: description ? description.slice(0, 2000) : undefined,
    price: price || undefined,
    images: filterValidImages(images).slice(0, 9),
  };
}

// ============================================================================
// 入口
// ============================================================================

/**
 * 抓取商品参考链接:Shopify JSON 优先(路径命中时),失败落 OG meta。
 * 不做 LLM 补全、不转存图片——那是 parse-reference 路由的职责。
 */
export async function parseReference(rawUrl: string): Promise<ParseReferenceResult> {
  const checked = validateExternalUrl(rawUrl);
  if ("error" in checked) return { success: false, error: checked.error };

  const platform = detectReferencePlatform(rawUrl);

  if (platform === "shopify") {
    const fromJson = await parseShopifyJson(rawUrl);
    if (fromJson) return { success: true, data: fromJson };
  }

  try {
    const fromOg = await parseOgMeta(rawUrl, platform);
    if (fromOg) return { success: true, data: fromOg };
    return { success: false, error: "页面里找不到商品信息(可能有登录墙或反爬)" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "链接抓取失败",
    };
  }
}
