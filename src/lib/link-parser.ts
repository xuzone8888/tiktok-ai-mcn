/**
 * 商品链接解析服务
 * 
 * 支持平台：
 * - 抖音 (douyin.com, v.douyin.com)
 * - 淘宝 (taobao.com, m.tb.cn)
 * - 天猫 (tmall.com)
 * - 京东 (jd.com, 3.cn)
 * - TikTok (tiktok.com)
 * - 亚马逊 (amazon.*)
 * - 拼多多 (pinduoduo.com)
 */

import type {
  ProductPlatform,
  ParsedProductData,
  ProductImage,
  ProductPrice,
} from '@/types/link-video';
import { detectPlatform } from '@/types/link-video';
import crypto from 'crypto';

// ============================================================================
// 配置
// ============================================================================

// 解析超时时间 (毫秒)
const PARSE_TIMEOUT = 30000;

// User-Agent 列表 (模拟浏览器)
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// ============================================================================
// 工具函数
// ============================================================================

/** 生成 URL 哈希 */
export function generateUrlHash(url: string): string {
  // 清理 URL (移除追踪参数)
  const cleanUrl = cleanTrackingParams(url);
  return crypto.createHash('md5').update(cleanUrl).digest('hex');
}

/** 清理追踪参数 */
function cleanTrackingParams(url: string): string {
  try {
    const urlObj = new URL(url);
    // 移除常见的追踪参数
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'spm', 'scm', 'pvid', 'from',
    ];
    trackingParams.forEach(param => urlObj.searchParams.delete(param));
    return urlObj.toString();
  } catch {
    return url;
  }
}

/** 获取随机 User-Agent */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** 提取数字价格 */
function extractPrice(text: string): string {
  const match = text.match(/[\d,]+\.?\d*/);
  return match ? match[0].replace(/,/g, '') : text;
}

/** 清理文本 */
function cleanText(text: string): string {
  return text
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 过滤有效图片 URL */
function filterValidImages(urls: string[]): string[] {
  return urls.filter(url => {
    // 过滤太短的 URL
    if (url.length < 20) return false;
    // 过滤非图片 URL
    if (!/\.(jpg|jpeg|png|webp|gif)/i.test(url) && !/image|img|pic/i.test(url)) return false;
    // 过滤 logo、icon 等
    if (/logo|icon|avatar|banner|ad|promotion/i.test(url)) return false;
    return true;
  });
}

// ============================================================================
// 解析器接口
// ============================================================================

interface ParseResult {
  success: boolean;
  data?: {
    title: string;
    description?: string;
    price?: string;
    originalPrice?: string;
    promoInfo?: string;
    brand?: string;
    storeName?: string;
    images: string[];
  };
  error?: string;
}

// ============================================================================
// 通用网页解析器 (基于 fetch + 正则)
// ============================================================================

async function parseGenericPage(url: string): Promise<ParseResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PARSE_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    
    // 提取标题
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = cleanText(titleMatch[1]);
    }

    // 提取 Open Graph 数据
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitleMatch) {
      title = cleanText(ogTitleMatch[1]);
    }

    // 提取描述
    let description = '';
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch) {
      description = cleanText(descMatch[1]);
    }

    // 提取图片
    const images: string[] = [];
    
    // Open Graph 图片
    const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImageMatch) {
      images.push(ogImageMatch[1]);
    }

    // 主图
    const mainImageMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    for (const match of mainImageMatches) {
      const src = match[1];
      if (src && !images.includes(src)) {
        images.push(src);
      }
      if (images.length >= 10) break;
    }

    // 提取价格 (通用模式)
    let price = '';
    const pricePatterns = [
      /["']price["']\s*:\s*["']?([^"',}]+)/i,
      /¥\s*([\d,.]+)/,
      /\$\s*([\d,.]+)/,
      /price[^>]*>([^<]*[\d,.]+[^<]*)</i,
    ];
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        price = extractPrice(match[1]);
        break;
      }
    }

    return {
      success: true,
      data: {
        title,
        description,
        price,
        images: filterValidImages(images).slice(0, 5),
      },
    };
  } catch (error) {
    console.error('[LinkParser] Generic parse error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '解析失败',
    };
  }
}

// ============================================================================
// 平台特定解析器
// ============================================================================

/** 解析淘宝/天猫链接 */
async function parseTaobao(url: string): Promise<ParseResult> {
  // 淘宝需要登录才能获取完整信息，这里使用通用解析
  // 未来可以接入淘宝开放平台 API
  return parseGenericPage(url);
}

/** 解析京东链接 */
async function parseJD(url: string): Promise<ParseResult> {
  // 京东可以通过 API 获取，这里先用通用解析
  return parseGenericPage(url);
}

/** 解析抖音链接 */
async function parseDouyin(url: string): Promise<ParseResult> {
  // 抖音商品链接解析
  // 可能需要处理短链接跳转
  return parseGenericPage(url);
}

/** 解析 TikTok 链接 */
async function parseTikTok(url: string): Promise<ParseResult> {
  // TikTok Shop 链接解析
  return parseGenericPage(url);
}

/** 解析亚马逊链接 */
async function parseAmazon(url: string): Promise<ParseResult> {
  // 亚马逊可以通过 Product Advertising API
  return parseGenericPage(url);
}

// ============================================================================
// 主解析函数
// ============================================================================

export interface LinkParseResult {
  success: boolean;
  platform: ProductPlatform;
  urlHash: string;
  data?: ParsedProductData;
  rawData?: {
    title: string | null;
    description: string | null;
    price: string | null;
    promoInfo: string | null;
    images: string[];
  };
  error?: string;
}

/**
 * 解析商品链接
 * 
 * @param url 商品链接
 * @param forcePlatform 强制指定平台 (可选)
 */
export async function parseProductLink(
  url: string,
  forcePlatform?: ProductPlatform
): Promise<LinkParseResult> {
  console.log('[LinkParser] Parsing URL:', url);

  // 验证 URL
  try {
    new URL(url);
  } catch {
    return {
      success: false,
      platform: 'other',
      urlHash: generateUrlHash(url),
      error: '无效的 URL 格式',
    };
  }

  // 识别平台
  const platform = forcePlatform || detectPlatform(url);
  const urlHash = generateUrlHash(url);

  console.log('[LinkParser] Detected platform:', platform);

  // 根据平台选择解析器
  let result: ParseResult;

  switch (platform) {
    case 'taobao':
    case 'tmall':
      result = await parseTaobao(url);
      break;
    case 'jd':
      result = await parseJD(url);
      break;
    case 'douyin':
      result = await parseDouyin(url);
      break;
    case 'tiktok':
      result = await parseTikTok(url);
      break;
    case 'amazon':
      result = await parseAmazon(url);
      break;
    default:
      result = await parseGenericPage(url);
  }

  if (!result.success || !result.data) {
    return {
      success: false,
      platform,
      urlHash,
      error: result.error || '解析失败',
    };
  }

  // 转换为标准格式
  const { data } = result;

  // 构建商品图片列表
  const images: ProductImage[] = data.images.map((imgUrl, index) => ({
    url: imgUrl,
    type: index === 0 ? 'main' : 'detail',
    selected: index < 3, // 默认选中前3张
    is_primary: index === 0,
  }));

  // 构建价格信息
  const price: ProductPrice = {
    current: data.price || '价格待确认',
    original: data.originalPrice,
    discount: undefined,
  };

  // 提取卖点 (从描述中分割)
  const sellingPoints: string[] = [];
  if (data.description) {
    // 尝试用句号、分号、换行分割
    const parts = data.description.split(/[。；\n]+/).filter(p => p.trim().length > 5);
    sellingPoints.push(...parts.slice(0, 5));
  }

  // 如果没有提取到卖点，使用标题
  if (sellingPoints.length === 0 && data.title) {
    sellingPoints.push(data.title);
  }

  const parsedData: ParsedProductData = {
    title: data.title || '未知商品',
    selling_points: sellingPoints,
    price,
    brand: data.brand,
    store_name: data.storeName,
    images,
  };

  return {
    success: true,
    platform,
    urlHash,
    data: parsedData,
    rawData: {
      title: data.title || null,
      description: data.description || null,
      price: data.price || null,
      promoInfo: data.promoInfo || null,
      images: data.images,
    },
  };
}

// ============================================================================
// Mock 解析器 (开发测试用)
// ============================================================================

// ============================================================================
// TikTok Shop 特殊处理
// ============================================================================

/**
 * TikTok Shop 链接解析
 * 
 * 注意：TikTok Shop API 需要 Partner 资质和卖家授权
 * 参考：https://partner.tiktokshop.com/docv2/page/get-product-202309
 * 
 * 当前实现：提取链接中的商品 ID，并提示用户手动补充信息
 */
export async function parseTikTokShopLink(url: string): Promise<ParseResult> {
  // 提取商品 ID (从 URL 中)
  // 典型格式: https://shop.tiktok.com/view/product/1234567890
  const productIdMatch = url.match(/product\/(\d+)/i);
  const productId = productIdMatch ? productIdMatch[1] : null;

  // 提取商品名称 (从 URL 中)
  // 某些链接包含商品名: https://shop.tiktok.com/product/xxx-product-name-xxx
  const urlParts = url.split('/').pop()?.split('-') || [];
  const possibleName = urlParts.filter(p => p.length > 2 && !/^\d+$/.test(p)).join(' ');

  return {
    success: productId !== null,
    data: {
      title: possibleName || `TikTok Shop 商品 ${productId || ''}`,
      description: '检测到 TikTok Shop 链接，建议手动补充商品信息以获得最佳效果',
      price: '',
      images: [],
    },
    error: productId ? undefined : '无法从链接中提取商品 ID，请使用手动输入',
  };
}

/**
 * AI 智能补全商品信息
 * 使用豆包 API 从不完整信息推断完整商品信息
 */
export async function aiEnhanceProductInfo(
  partialInfo: {
    title?: string;
    description?: string;
    url?: string;
    platform?: string;
  }
): Promise<{
  title: string;
  sellingPoints: string[];
  category: string;
}> {
  const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;
  const DOUBAO_ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID;

  if (!DOUBAO_API_KEY || !DOUBAO_ENDPOINT_ID) {
    return {
      title: partialInfo.title || '商品',
      sellingPoints: ['优质商品', '值得购买'],
      category: '其他',
    };
  }

  try {
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_ENDPOINT_ID,
        messages: [{
          role: 'user',
          content: `根据以下不完整的商品信息，推断并补充完整的商品描述：

商品标题: ${partialInfo.title || '未知'}
商品描述: ${partialInfo.description || '无'}
来源平台: ${partialInfo.platform || '电商平台'}

请返回 JSON 格式：
{
  "title": "优化后的商品标题",
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "category": "商品分类"
}

只返回 JSON，不要其他内容。`,
        }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 尝试解析 JSON
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (error) {
    console.error('[AI Enhance] Error:', error);
  }

  return {
    title: partialInfo.title || '商品',
    sellingPoints: ['品质保证', '性价比高', '值得推荐'],
    category: '其他',
  };
}

/**
 * Mock 解析结果 (用于开发测试)
 */
export function getMockParseResult(url: string): LinkParseResult {
  const platform = detectPlatform(url);
  const urlHash = generateUrlHash(url);

  const mockData: ParsedProductData = {
    title: 'Premium Wireless Bluetooth Headphones - Active Noise Cancellation',
    selling_points: [
      '40 小时超长续航',
      '主动降噪 ANC',
      'Hi-Res 高清音质',
      '轻量舒适设计',
      '快充 10 分钟播放 3 小时',
    ],
    price: {
      current: '199.99',
      original: '299.99',
      discount: '33% OFF',
    },
    brand: 'TechAudio',
    store_name: 'TechAudio Official Store',
    images: [
      {
        url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
        type: 'main',
        selected: true,
        is_primary: true,
      },
      {
        url: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
        type: 'detail',
        selected: true,
        is_primary: false,
      },
      {
        url: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800',
        type: 'scene',
        selected: true,
        is_primary: false,
      },
    ],
  };

  return {
    success: true,
    platform,
    urlHash,
    data: mockData,
    rawData: {
      title: mockData.title,
      description: mockData.selling_points.join('。'),
      price: mockData.price.current,
      promoInfo: mockData.price.discount || null,
      images: mockData.images.map(i => i.url),
    },
  };
}

