import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeCard, type ProductCard } from "@/lib/studio/product-vision";

export const dynamic = "force-dynamic";

/**
 * 蓝图落库(S1.3,商品图腿:商品卡 → Blueprint)
 *
 * POST {
 *   sourceType?: 'product_images' | 'product_link'(缺省 product_images;S2.1 链接腿),
 *   sourceUrl?: string(sourceType='product_link' 时必填,记进 source_ref.url),
 *   product: ProductCard(勾选态已定),
 *   globals?: { aspect?, total_sec?, bgm_style?, voice_id?, cta_text? },
 *   renderMode?: 'slideshow',
 *   rightsAck?: boolean   // 商品图腿默认自有素材,缺省 true
 * } → { success, data: { blueprintId, scenes } }
 *
 * 写库走 cookie 用户 client:blueprints 四条 RLS own 策略已就位(S0.1 迁移),
 * 无需 service role。scenes 首版为图序骨架(beat: hook→point→cta),
 * 台词行内编辑/卖点重排属 S2 蓝图编辑器范围。
 */

interface BlueprintScene {
  idx: number;
  line: string;
  visual: string;
  slot: { kind: "product_image"; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

function buildScenes(card: ProductCard, durationMs: number): BlueprintScene[] {
  const selectedPoints = card.selling_points.filter((p) => p.selected);
  return card.images.map((url, idx) => {
    const beat: BlueprintScene["beat"] =
      idx === 0 ? "hook" : idx === card.images.length - 1 ? "cta" : "point";
    // 首版台词骨架:hook=标题,point=按序轮换勾选卖点,cta 留空由文案生成器补
    const line =
      beat === "hook"
        ? card.title
        : beat === "point"
          ? selectedPoints[(idx - 1) % Math.max(selectedPoints.length, 1)]?.text ?? ""
          : "";
    return {
      idx,
      line,
      visual: url,
      slot: { kind: "product_image", asset_ref: url },
      duration_ms: durationMs,
      beat,
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();

    // renderMode 白名单:首版只放行 slideshow(scenes 形状按幻灯片腿生成)
    if (body?.renderMode !== undefined && body.renderMode !== "slideshow") {
      return NextResponse.json({ success: false, error: "renderMode 非法" }, { status: 400 });
    }

    // sourceType 白名单(S2.1 链接腿加 product_link;reference_video 属门B,S3)
    const sourceType = body?.sourceType === "product_link" ? "product_link" : "product_images";
    let sourceUrl: string | undefined;
    if (sourceType === "product_link") {
      const rawUrl: string =
        typeof body?.sourceUrl === "string" ? body.sourceUrl.trim().slice(0, 2000) : "";
      if (!/^https?:\/\//.test(rawUrl)) {
        return NextResponse.json(
          { success: false, error: "链接来源蓝图缺少 sourceUrl" },
          { status: 400 }
        );
      }
      sourceUrl = rawUrl;
    }

    // 元素级消毒后重建商品卡再落库(normalizeCard:逐项类型校验/截断/滤 null),
    // 不把客户端原对象直插 JSONB 列
    const rawProduct = body?.product as Record<string, unknown> | undefined;
    const images = Array.isArray(rawProduct?.images)
      ? rawProduct.images
          .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
          .slice(0, 9)
      : [];
    if (images.length === 0) {
      return NextResponse.json({ success: false, error: "商品卡缺少有效图片" }, { status: 400 });
    }
    const product: ProductCard | null = normalizeCard(rawProduct, images);
    if (!product) {
      return NextResponse.json({ success: false, error: "商品卡数据不完整" }, { status: 400 });
    }
    if (!product.selling_points.some((p) => p.selected)) {
      return NextResponse.json({ success: false, error: "至少勾选一个卖点" }, { status: 400 });
    }

    // globals 白名单拾取,拒绝任意键注入
    const rawGlobals = (body?.globals ?? {}) as Record<string, unknown>;
    const durationMs =
      typeof rawGlobals.duration_per_image_ms === "number" &&
      Number.isFinite(rawGlobals.duration_per_image_ms)
        ? Math.min(Math.max(Math.round(rawGlobals.duration_per_image_ms), 500), 15_000)
        : 2000;
    const globals: Record<string, unknown> = { duration_per_image_ms: durationMs };
    for (const key of ["aspect", "bgm_style", "voice_id", "cta_text"] as const) {
      if (typeof rawGlobals[key] === "string") {
        globals[key] = (rawGlobals[key] as string).slice(0, 100);
      }
    }

    const scenes = buildScenes(product, durationMs);

    // blueprints 为 S0.1 新表,尚未进 database.ts 生成类型——用未参数化 client 访问
    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("blueprints")
      .insert({
        user_id: user.id,
        source_type: sourceType,
        source_ref: sourceUrl
          ? { url: sourceUrl, asset_urls: product.images }
          : { asset_urls: product.images },
        rights_ack: body?.rightsAck !== false, // 商品图腿=用户自传自有素材,默认确认
        product,
        hooks: [],
        scenes,
        globals,
        render_mode: "slideshow",
        status: "ready",
      } as never)
      .select("id")
      .single();

    if (error || !data) {
      console.error("[Studio Blueprints] insert failed:", error);
      return NextResponse.json({ success: false, error: "蓝图保存失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: { blueprintId: (data as { id: string }).id, scenes },
    });
  } catch (error) {
    console.error("[Studio Blueprints] error:", error);
    return NextResponse.json({ success: false, error: "蓝图保存失败" }, { status: 500 });
  }
}
