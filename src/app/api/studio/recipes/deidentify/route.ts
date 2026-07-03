import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { askQwen } from "@/lib/blueprint/salvage/qwen-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 配方脱敏(S3.5,BLUEPRINT §三红队裁决:脱敏必经 diff 预览+用户确认——
 * LLM 脱敏会漏删品牌词,本端点只产「建议稿」,落库在用户确认后的 POST /recipes)
 *
 * POST { blueprintId } → { success, data: {
 *   name, scenes: [{idx, beat, duration_ms, slot_kind, original, deidentified}],
 *   hooks: [{id, type, original, deidentified}], globals, renderMode, origin
 * } }
 *
 * 脱敏 = 台词/hook 中的商品具体值(名称/品牌/价格/卖点措辞)替换为
 * {商品名}/{卖点1..N}/{价格} 槽位,保 hook 模式/beat 结构/节奏。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rateLog = new Map<string, number[]>();
function checkRate(userId: string): boolean {
  const now = Date.now();
  if (rateLog.size > 5000) {
    for (const [k, times] of rateLog) {
      if (times.every((t) => now - t >= 60_000)) rateLog.delete(k);
    }
  }
  const log = (rateLog.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (log.length >= 5) return false;
  log.push(now);
  rateLog.set(userId, log);
  return true;
}

interface BlueprintRow {
  id: string;
  source_type: string;
  product: {
    title?: string;
    price?: string;
    selling_points?: Array<{ text?: string; selected?: boolean }>;
  } | null;
  hooks: Array<{ id?: string; type?: string; text?: string; selected?: boolean }> | null;
  scenes: Array<{
    idx: number;
    line?: string;
    visual?: string;
    beat?: string;
    duration_ms?: number;
    slot?: { kind?: string };
  }> | null;
  globals: Record<string, unknown> | null;
  render_mode: string | null;
  origin: { viral_ref?: string; why_viral?: string; license?: string } | null;
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
    const blueprintId = typeof body?.blueprintId === "string" ? body.blueprintId : "";
    if (!UUID_RE.test(blueprintId)) {
      return NextResponse.json({ success: false, error: "蓝图 ID 非法" }, { status: 400 });
    }
    if (!checkRate(user.id)) {
      return NextResponse.json({ success: false, error: "脱敏请求太频繁,请稍后再试" }, { status: 429 });
    }

    const db = supabase as unknown as SupabaseClient;
    const { data } = await db
      .from("blueprints")
      .select("id, source_type, product, hooks, scenes, globals, render_mode, origin")
      .eq("id", blueprintId)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ success: false, error: "蓝图不存在" }, { status: 404 });
    }
    const bp = data as BlueprintRow;
    const scenes = (bp.scenes ?? []).filter((s) => (s.line ?? "").trim());
    if (scenes.length === 0) {
      return NextResponse.json({ success: false, error: "蓝图没有台词,无法生成配方" }, { status: 400 });
    }

    const productContext = bp.product?.title
      ? `商品名:${bp.product.title}
价格:${bp.product.price ?? "(未知)"}
卖点:${(bp.product.selling_points ?? [])
          .filter((p) => p.text)
          .map((p, i) => `卖点${i + 1}=${p.text}`)
          .join(";")}`
      : "(无商品卡——请自行识别台词中的具体商品/品牌/数值并槽位化)";

    const hookLines = (bp.hooks ?? []).filter((h) => (h.text ?? "").trim());
    const prompt = `把下面短视频蓝图的台词「去实例化」为可复用配方模板:所有指向具体商品的内容(商品名、品牌词、具体价格数字、具体卖点措辞、型号/规格)替换为槽位 {商品名} {卖点1} {卖点2} {卖点3} {价格};保留句式、节奏、情绪词与结构词,不改写与商品无关的部分。

${productContext}

台词(scene 序号: 内容):
${scenes.map((s) => `${s.idx}: ${s.line}`).join("\n")}
${hookLines.length > 0 ? `\nhook 候选(序号: 内容):\n${hookLines.map((h, i) => `${i}: ${h.text}`).join("\n")}` : ""}

严格按 JSON 返回,不要输出其他内容:
{"scenes":[{"idx":0,"text":"槽位化后的台词"}],"hooks":[{"i":0,"text":"槽位化后的 hook"}],"name":"给这个配方起的短名字(≤20字,概括结构特点)"}`;

    const result = await askQwen(
      "你是短视频配方库管理员,擅长把具体商品文案抽象成可复用模板。只输出 JSON。",
      prompt,
      { maxTokens: 3000, temperature: 0.2, maxRetries: 2 }
    );
    if (!result.success || !result.content) {
      return NextResponse.json({ success: false, error: "脱敏生成失败,请重试" }, { status: 500 });
    }
    const start = result.content.indexOf("{");
    const end = result.content.lastIndexOf("}");
    let parsed: {
      scenes?: Array<{ idx?: number; text?: string }>;
      hooks?: Array<{ i?: number; text?: string }>;
      name?: string;
    };
    try {
      parsed = JSON.parse(result.content.slice(start, end + 1));
    } catch {
      return NextResponse.json({ success: false, error: "脱敏结果格式异常,请重试" }, { status: 500 });
    }
    const byIdx = new Map(
      (parsed.scenes ?? [])
        .filter((s) => typeof s?.idx === "number" && typeof s?.text === "string")
        .map((s) => [s.idx as number, (s.text as string).trim().slice(0, 500)])
    );
    const hookByI = new Map(
      (parsed.hooks ?? [])
        .filter((h) => typeof h?.i === "number" && typeof h?.text === "string")
        .map((h) => [h.i as number, (h.text as string).trim().slice(0, 300)])
    );

    return NextResponse.json({
      success: true,
      data: {
        name: (parsed.name ?? "").trim().slice(0, 100) || "我的配方",
        scenes: scenes.map((s) => ({
          idx: s.idx,
          beat: s.beat ?? "point",
          duration_ms: s.duration_ms ?? 2500,
          slot_kind: s.slot?.kind ?? "product_image",
          // 画面结构描述随配方保留(门B 的 visual_beats 是 structure_only 要
          // 复刻的「结构」的一半——硬编码空串会丢掉它,审查实锤);素材 URL 不进配方
          visual: (s.visual ?? "").startsWith("http") ? "" : (s.visual ?? "").slice(0, 2000),
          original: s.line ?? "",
          // LLM 漏答的行原样带回(diff 里用户能看到未脱敏,自行改)
          deidentified: byIdx.get(s.idx) || s.line || "",
        })),
        hooks: hookLines.map((h, i) => ({
          id: h.id ?? `hook-${i}`,
          type: h.type ?? "悬念",
          original: h.text ?? "",
          deidentified: hookByI.get(i) || h.text || "",
        })),
        globals: bp.globals ?? {},
        renderMode: bp.render_mode,
        origin:
          bp.source_type === "reference_video"
            ? {
                ...(bp.origin?.viral_ref ? { viral_ref: bp.origin.viral_ref } : {}),
                ...(bp.origin?.why_viral ? { why_viral: bp.origin.why_viral } : {}),
                license: "structure_only",
              }
            : null,
      },
    });
  } catch (error) {
    console.error("[Studio Recipes Deidentify] error:", error);
    return NextResponse.json({ success: false, error: "脱敏生成失败" }, { status: 500 });
  }
}
