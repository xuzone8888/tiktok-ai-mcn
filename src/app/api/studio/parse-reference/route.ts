import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateUrlHash,
  parseReference,
  readBodyWithCap,
  safeFetch,
  validateExternalUrl,
  type ReferenceRaw,
} from "@/lib/studio/reference-parser";
import { getCachedReference, saveReference } from "@/lib/studio/reference-cache";
import {
  analyzeProductImages,
  buildCardFromMeta,
  normalizeCard,
  type ProductCard,
} from "@/lib/studio/product-vision";
import { generateProductPath, isOSSConfigured, uploadImageBuffer } from "@/lib/oss";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * 链接腿(S2.1):海外商品链接 → 商品卡
 *
 * POST { url } → { success, data: { card, platform, fromCache } }
 *
 * 管线:reference_cache 查缓存 → 抓取(Shopify JSON / OG meta,SSRF 逐跳闸)
 * → 商品图转存自有 OSS(外链 CDN 防盗链会挡豆包与渲染端,转存后全链路可靠)
 * → 商品卡补全(豆包视觉+meta 上下文 → 纯文本 → 规则兜底)→ 写缓存。
 *
 * 承诺范围 Amazon/Shopify/TikTok Shop(BLUEPRINT §四);登录墙站点返回
 * 友好错误,前端引导走拖图腿。无第三方抓取 key,全部直抓(降级链见上)。
 */

/** 单图转存预算:下载 12s、≤15MB;失败丢弃该图不阻塞整体 */
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** 转存图片上限:轮播成片素材上限 9,取前 6 控制耗时(每图并行) */
const MAX_TRANSFER_IMAGES = 6;

// ---------------------------------------------------------------------------
// 每用户频控(对抗审查确认项:无频控时单账号可放大 OSS 存储/视觉 LLM/外抓成本;
// 缓存键是全 URL hash,追加任意 query 即强制 miss,缓存兜不住)。
// 进程内滑动窗口:部署形态为单容器长驻 node server.js,单进程计数即有效;
// 多实例横扩时各实例独立计数,上限放大 N 倍仍是硬闸。
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 5;
const RATE_DAY_MS = 24 * 60 * 60 * 1000;
const RATE_MAX_PER_DAY = 100;
const MAX_INFLIGHT_PER_USER = 2;

const requestLog = new Map<string, number[]>();
const inflightByUser = new Map<string, number>();

function checkRateLimit(userId: string): string | null {
  const now = Date.now();
  const log = (requestLog.get(userId) ?? []).filter((t) => now - t < RATE_DAY_MS);
  if (log.length >= RATE_MAX_PER_DAY) return "今日链接解析次数已达上限";
  if (log.filter((t) => now - t < RATE_WINDOW_MS).length >= RATE_MAX_PER_WINDOW) {
    return "解析太频繁,请稍候再试";
  }
  log.push(now);
  requestLog.set(userId, log);
  // 防 Map 无界增长:超 5000 用户时清掉一天内无活动的键
  if (requestLog.size > 5000) {
    for (const [key, times] of requestLog) {
      if (times.every((t) => now - t >= RATE_DAY_MS)) requestLog.delete(key);
    }
  }
  return null;
}

async function transferImageToOss(rawUrl: string, userId: string): Promise<string | null> {
  try {
    const res = await safeFetch(rawUrl, {
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    // 流式上限:绝不先全量入内存再判大小(OOM 面,对抗审查确认项)
    const buf = await readBodyWithCap(res, MAX_IMAGE_BYTES);
    if (buf.byteLength < 100) return null;

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";
    const path = generateProductPath(userId, `link-ref.${ext}`);
    return await uploadImageBuffer(buf, path, contentType.split(";")[0]);
  } catch {
    return null;
  }
}

/** 规则兜底:LLM 全部失败时,用抓到的标题+描述切分出卖点(保证无 key 环境可用) */
function buildCardByRules(raw: ReferenceRaw, images: string[]): ProductCard | null {
  const points = (raw.description ?? "")
    .split(/[。.;;!!\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 60)
    .slice(0, 5);
  const sellingPoints = points.length > 0 ? points : ["实拍展示,所见即所得"];
  return normalizeCard(
    {
      title: raw.title,
      price: raw.price,
      selling_points: sellingPoints,
      audience: [],
    },
    images
  );
}

function buildMetaContext(raw: ReferenceRaw): string {
  return [
    `标题:${raw.title}`,
    raw.price ? `价格:${raw.price}` : "",
    raw.description ? `页面描述:${raw.description.slice(0, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: NextRequest) {
  let inflightUserId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const rateError = checkRateLimit(user.id);
    if (rateError) {
      return NextResponse.json({ success: false, error: rateError }, { status: 429 });
    }
    const inflight = inflightByUser.get(user.id) ?? 0;
    if (inflight >= MAX_INFLIGHT_PER_USER) {
      return NextResponse.json(
        { success: false, error: "已有解析进行中,请稍候再贴" },
        { status: 429 }
      );
    }
    inflightByUser.set(user.id, inflight + 1);
    inflightUserId = user.id;

    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim().slice(0, 2000) : "";
    const checked = validateExternalUrl(url);
    if ("error" in checked) {
      return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
    }

    const urlHash = generateUrlHash(url);
    const cached = await getCachedReference(urlHash);
    if (cached) {
      return NextResponse.json({
        success: true,
        data: { card: cached.card, fromCache: true },
      });
    }

    // ---------- 抓取 ----------
    const parsed = await parseReference(url);
    if (!parsed.success || !parsed.data) {
      await saveReference({
        urlHash,
        sourceUrl: url,
        raw: {},
        status: "failed",
        errorMessage: parsed.error,
      });
      return NextResponse.json(
        {
          success: false,
          error: `${parsed.error ?? "链接解析失败"}。可改为直接拖入商品图。`,
        },
        { status: 502 }
      );
    }
    const raw = parsed.data;

    // ---------- 商品图转存 OSS(并行,失败丢弃) ----------
    let ossImages: string[] = [];
    if (isOSSConfigured() && raw.images.length > 0) {
      const transferred = await Promise.all(
        raw.images.slice(0, MAX_TRANSFER_IMAGES).map((img) => transferImageToOss(img, user.id))
      );
      ossImages = transferred.filter((u): u is string => !!u);
    }

    // ---------- 商品卡补全(视觉+meta → 纯文本 → 规则) ----------
    const context = buildMetaContext(raw);
    let card: ProductCard | null = null;

    if (ossImages.length > 0) {
      const result = await analyzeProductImages(ossImages, {
        context,
        doubaoBudgetMs: 60_000,
        qwenBudgetMs: 25_000,
      });
      if (result.success && result.card) card = result.card;
    }
    if (!card) {
      try {
        card = await buildCardFromMeta(context, ossImages);
      } catch {
        card = null;
      }
    }
    if (!card) {
      card = buildCardByRules(raw, ossImages);
    }
    if (!card) {
      await saveReference({
        urlHash,
        sourceUrl: url,
        raw: raw as unknown as Record<string, unknown>,
        status: "failed",
        errorMessage: "抓到页面但提炼不出商品卡",
      });
      return NextResponse.json(
        { success: false, error: "页面里提炼不出商品信息,可改为直接拖入商品图" },
        { status: 422 }
      );
    }

    await saveReference({
      urlHash,
      sourceUrl: url,
      raw: raw as unknown as Record<string, unknown>,
      parsed: card,
      status: "success",
    });

    return NextResponse.json({
      success: true,
      data: { card, platform: raw.platform, channel: raw.channel, fromCache: false },
    });
  } catch (error) {
    console.error("[Studio ParseReference] error:", error);
    return NextResponse.json({ success: false, error: "链接解析失败" }, { status: 500 });
  } finally {
    if (inflightUserId) {
      const current = inflightByUser.get(inflightUserId) ?? 1;
      if (current <= 1) inflightByUser.delete(inflightUserId);
      else inflightByUser.set(inflightUserId, current - 1);
    }
  }
}
