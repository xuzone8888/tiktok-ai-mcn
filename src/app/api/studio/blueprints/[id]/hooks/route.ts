import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { askQwen } from "@/lib/blueprint/salvage/qwen-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * hook 候选生成(S3.4,修 S2.2 遗留「hooks 恒空」——批量矩阵的 hook 维度生成源)
 *
 * POST /api/studio/blueprints/[id]/hooks → 按商品卡(标题+勾选卖点+人群)
 * 生成 4 个 hook 候选(痛点/悬念/对比/场景各一)→ 覆盖写 blueprints.hooks
 * (旧候选被替换;已选中项的 text 若仍在新候选中保留勾选)→ 返回 hooks。
 *
 * 模型:qwen flash(askQwen,便宜/已接线);拆解蓝图(reference_video)自带
 * 分析出的 hook,不支持本端点(400)。频控:进程内 5/分/用户。
 */

const HOOK_TYPES = ["痛点", "悬念", "对比", "场景"] as const;
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

interface ProductLike {
  title?: string;
  selling_points?: Array<{ text?: string; selected?: boolean }>;
  audience?: string[];
}

function buildPrompt(product: ProductLike, language: "zh" | "en"): string {
  const points = (product.selling_points ?? [])
    .filter((p) => p.selected && p.text)
    .map((p) => p.text)
    .slice(0, 6);
  const audience = (product.audience ?? []).slice(0, 4);
  return `为下面的商品短视频写 4 个开场 hook(前 1-3 秒抓注意力的口播句),四种类型各一个:痛点、悬念、对比、场景。

商品:${product.title ?? ""}
卖点:${points.join(";") || "(未提供)"}
目标人群:${audience.join("、") || "(未提供)"}
语言:${language === "zh" ? "中文" : "English"}

要求:
- 每条 ≤40 字,口语化,能直接当第一句口播
- 痛点=直击用户困扰;悬念=留钩子引好奇;对比=前后/竞品反差;场景=代入具体使用场景
- 严格按 JSON 数组返回,不要输出其他内容:
[{"type":"痛点","text":"..."},{"type":"悬念","text":"..."},{"type":"对比","text":"..."},{"type":"场景","text":"..."}]`;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: "蓝图 ID 非法" }, { status: 400 });
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }
    if (!checkRate(user.id)) {
      return NextResponse.json(
        { success: false, error: "生成太频繁,请稍后再试" },
        { status: 429 }
      );
    }

    const db = supabase as unknown as SupabaseClient;
    const { data: bp } = await db
      .from("blueprints")
      .select("id, source_type, product, hooks")
      .eq("id", id)
      .maybeSingle();
    if (!bp) {
      return NextResponse.json({ success: false, error: "蓝图不存在" }, { status: 404 });
    }
    const row = bp as {
      source_type: string;
      product: ProductLike | null;
      hooks: Array<{ text?: string; selected?: boolean }> | null;
    };
    if (row.source_type === "reference_video") {
      return NextResponse.json(
        { success: false, error: "拆解蓝图的 hook 来自原片分析,不支持生成" },
        { status: 400 }
      );
    }
    if (!row.product?.title) {
      return NextResponse.json({ success: false, error: "蓝图缺少商品卡" }, { status: 400 });
    }

    const language = /[一-鿿]/.test(row.product.title) ? "zh" : "en";
    const result = await askQwen(
      "你是短视频电商编剧,擅长写高留存的开场 hook。只输出 JSON。",
      buildPrompt(row.product, language),
      { maxTokens: 800, temperature: 0.8, maxRetries: 2 }
    );
    if (!result.success || !result.content) {
      return NextResponse.json(
        { success: false, error: "hook 生成失败,请重试" },
        { status: 500 }
      );
    }

    // 解析:取最外层 JSON 数组,逐项消毒
    const start = result.content.indexOf("[");
    const end = result.content.lastIndexOf("]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content.slice(start, end + 1));
    } catch {
      return NextResponse.json(
        { success: false, error: "hook 生成结果格式异常,请重试" },
        { status: 500 }
      );
    }
    // 已勾选的旧 hook 文案保留勾选(按 text 匹配)
    const previouslySelected = new Set(
      (row.hooks ?? []).filter((h) => h.selected && h.text).map((h) => h.text)
    );
    const hooks = (Array.isArray(parsed) ? parsed : [])
      .map((h: Record<string, unknown>, i: number) => {
        const text = typeof h?.text === "string" ? h.text.trim().slice(0, 300) : "";
        if (!text) return null;
        const type = HOOK_TYPES.includes(h?.type as (typeof HOOK_TYPES)[number])
          ? (h.type as string)
          : HOOK_TYPES[i % HOOK_TYPES.length];
        return { id: `hook-${i}`, type, text, selected: previouslySelected.has(text) };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .slice(0, 8);
    if (hooks.length === 0) {
      return NextResponse.json(
        { success: false, error: "hook 生成结果为空,请重试" },
        { status: 500 }
      );
    }

    const { error: updateError } = await db
      .from("blueprints")
      .update({ hooks, updated_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (updateError) {
      console.error("[Studio Blueprint Hooks] update failed:", updateError);
      return NextResponse.json({ success: false, error: "hook 保存失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { hooks } });
  } catch (error) {
    console.error("[Studio Blueprint Hooks] error:", error);
    return NextResponse.json({ success: false, error: "hook 生成失败" }, { status: 500 });
  }
}
