/**
 * Product Vision - 商品图视觉分析(S1.3,商品图腿第一跳)
 *
 * 传商品图(OSS URL)→ 结构化商品卡 JSON(标题/卖点/受众/分类),
 * 形状对齐 blueprints.product 列注释:
 *   { title, price?, category, images[], selling_points[{id,text,evidence,selected}], audience[] }
 *
 * 通道:豆包视觉(doubao-seed vision,主)→ Qwen omni(salvage qwen-client,兜底)。
 * 管线复用 doubao-api.ts 的 imageUrlToBase64 + callDoubaoAPI(429 退避重试),
 * JSON 输出协议回收自 link-parser.ts aiEnhanceProductInfo(已扩成商品卡形状)。
 */

import {
  callDoubaoAPI,
  imageUrlToBase64,
  type DoubaoContentPart,
} from "@/lib/doubao-api";
import { analyzeImage } from "@/lib/blueprint/salvage/qwen-client";

// ============================================================================
// 商品卡类型(与 blueprints.product JSONB 形状一致)
// ============================================================================

export interface ProductSellingPoint {
  id: string;
  text: string;
  /** 证据来源(视觉推断说明,可为空) */
  evidence?: string;
  /** 是否被用户勾选参与成片(默认 true) */
  selected: boolean;
}

export interface ProductCard {
  title: string;
  price?: string;
  category?: string;
  images: string[];
  selling_points: ProductSellingPoint[];
  audience: string[];
}

// ============================================================================
// Prompt(中文商品卡协议)
// ============================================================================

const SYSTEM_PROMPT = `你是资深电商运营专家,擅长从商品图片提炼带货信息。只返回 JSON,不要任何其他内容。`;

const USER_PROMPT = `仔细观察这些商品图片,输出商品卡 JSON:

{
  "title": "商品标题(简洁有卖相,≤30字)",
  "category": "商品分类",
  "selling_points": [
    { "text": "卖点(≤20字,具体可感)", "evidence": "从图片哪里看出来的(≤15字)" }
  ],
  "audience": ["目标人群1", "目标人群2"]
}

要求:selling_points 给 4-6 条,按带货说服力排序;audience 给 2-4 个;
如果图片里有价格信息,额外加 "price" 字段(字符串)。只返回 JSON。`;

// ============================================================================
// 解析与归一化
// ============================================================================

/**
 * 商品卡消毒/归一化(视觉输出与客户端回传共用):
 * 逐元素校验、截断,selected 默认 true、尊重显式 false。
 * blueprints 落库路由也用它防垃圾 JSON 直插 JSONB 列。
 */
export function normalizeCard(raw: unknown, images: string[]): ProductCard | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
  if (!title) return null;

  const rawPoints = Array.isArray(record.selling_points) ? record.selling_points : [];
  const selling_points: ProductSellingPoint[] = rawPoints
    .map((p, i): ProductSellingPoint | null => {
      if (typeof p === "string" && p.trim()) {
        return { id: `sp-${i}`, text: p.trim().slice(0, 100), selected: true };
      }
      if (p && typeof p === "object") {
        const rec = p as Record<string, unknown>;
        const text = typeof rec.text === "string" ? rec.text.trim().slice(0, 100) : "";
        if (!text) return null;
        return {
          id: typeof rec.id === "string" ? rec.id : `sp-${i}`,
          text,
          evidence: typeof rec.evidence === "string" ? rec.evidence.slice(0, 100) : undefined,
          selected: rec.selected !== false,
        };
      }
      return null;
    })
    .filter((p): p is ProductSellingPoint => p !== null)
    .slice(0, 8);

  if (selling_points.length === 0) return null;

  const audience = Array.isArray(record.audience)
    ? record.audience
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .map((a) => a.trim().slice(0, 50))
        .slice(0, 6)
    : [];

  return {
    title,
    price: typeof record.price === "string" ? record.price.slice(0, 50) : undefined,
    category: typeof record.category === "string" ? record.category.slice(0, 50) : undefined,
    images,
    selling_points,
    audience,
  };
}

function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ============================================================================
// 分析入口
// ============================================================================

export interface AnalyzeProductResult {
  success: boolean;
  card?: ProductCard;
  /** 实际使用的视觉通道 */
  provider?: "doubao" | "qwen";
  error?: string;
}

/** 总预算控制:超时返回 null(转入下一通道),不让单通道吃光路由 maxDuration */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** 豆包视觉通道(主):多图一次调用 */
async function analyzeWithDoubao(imageUrls: string[]): Promise<ProductCard | null> {
  // 未配置豆包直接让位给 qwen,不浪费预算
  if (!process.env.DOUBAO_API_KEY || !process.env.DOUBAO_ENDPOINT_ID) return null;

  // 图片并行转 base64(每图 10s 预算);转换失败的原始 http URL 丢弃,
  // 避免坏 URL 触发豆包端 "Timeout while downloading" 重试链
  const converted = await Promise.all(
    imageUrls.map((url) =>
      imageUrlToBase64(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    )
  );
  const parts: DoubaoContentPart[] = converted
    .filter(
      (v): v is string =>
        typeof v === "string" && (v.startsWith("data:") || v.includes("supabase.co"))
    )
    .map((url) => ({ type: "image_url" as const, image_url: { url, detail: "auto" as const } }));
  if (parts.length === 0) return null;
  parts.push({ type: "text", text: USER_PROMPT });

  const result = await callDoubaoAPI(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: parts },
    ],
    { maxTokens: 1000, temperature: 0.4, maxRetries: 2 }
  );
  if (!result.success || !result.content) return null;
  return normalizeCard(extractJson(result.content), imageUrls);
}

/** Qwen 兜底通道:analyzeImage 单图接口,只喂首图(通常是主图) */
async function analyzeWithQwen(imageUrls: string[]): Promise<ProductCard | null> {
  const result = await analyzeImage(imageUrls[0], SYSTEM_PROMPT, USER_PROMPT, {
    maxTokens: 1000,
    temperature: 0.4,
  });
  if (!result.success || !result.content) return null;
  return normalizeCard(extractJson(result.content), imageUrls);
}

/**
 * 商品图 → 商品卡。豆包视觉优先,失败(未配 vision 接入点/超时)退 Qwen。
 * 两通道都失败时返回 error,由调用方决定是否降级为手填。
 */
export async function analyzeProductImages(imageUrls: string[]): Promise<AnalyzeProductResult> {
  const urls = imageUrls.filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, 9);
  if (urls.length === 0) {
    return { success: false, error: "没有可分析的图片" };
  }

  // 时间预算:豆包 70s、qwen 35s,合计留在 analyze-product 路由 maxDuration=120 之内
  try {
    const doubaoCard = await withBudget(analyzeWithDoubao(urls), 70_000);
    if (doubaoCard) return { success: true, card: doubaoCard, provider: "doubao" };
  } catch (error) {
    console.error("[ProductVision] doubao channel failed:", error);
  }

  try {
    const qwenCard = await withBudget(analyzeWithQwen(urls), 35_000);
    if (qwenCard) return { success: true, card: qwenCard, provider: "qwen" };
  } catch (error) {
    console.error("[ProductVision] qwen channel failed:", error);
  }

  return { success: false, error: "商品图分析失败,请稍后重试" };
}
