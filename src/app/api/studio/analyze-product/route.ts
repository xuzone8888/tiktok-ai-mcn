import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeProductImages } from "@/lib/studio/product-vision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 商品图视觉分析(S1.3,商品图腿第一跳)
 * POST { imageUrls: string[] } → { success, data: { card: ProductCard, provider } }
 */
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
    const imageUrls = Array.isArray(body?.imageUrls)
      ? body.imageUrls
          .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
          .slice(0, 9)
      : [];
    if (imageUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供至少一张商品图(OSS URL)" },
        { status: 400 }
      );
    }

    const result = await analyzeProductImages(imageUrls);
    if (!result.success || !result.card) {
      return NextResponse.json(
        { success: false, error: result.error || "商品图分析失败" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { card: result.card, provider: result.provider },
    });
  } catch (error) {
    console.error("[Studio AnalyzeProduct] error:", error);
    return NextResponse.json({ success: false, error: "商品图分析失败" }, { status: 500 });
  }
}
