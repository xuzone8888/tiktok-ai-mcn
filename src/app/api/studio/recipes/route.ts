import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 配方库(S3.5)
 *
 * GET  → { success, data: { recipes, dbReady } }(仅用户自有;内置种子由
 *   客户端 BUILTIN_RECIPES 合并展示,不进 DB。recipes 表迁移未执行时
 *   dbReady=false 且 recipes=[],种子链路不受影响)
 * POST { name, description?, hooks, scenes, globals?, renderMode?,
 *   sourceBlueprintId?, origin? } → { success, data: { recipeId } }
 *   (脱敏 diff 已在客户端经用户确认,此处做结构消毒落库)
 *
 * RLS:cookie client + 四条 own 策略(迁移 20260703_recipes.sql)。
 */

const SCENE_BEATS = new Set(["hook", "point", "demo", "cta"]);
const SLOT_KINDS = new Set(["product_image", "broll", "avatar", "ai_gen"]);
const HOOK_TYPES = new Set(["痛点", "悬念", "对比", "场景"]);
const MAX_SCENES = 30;
const MAX_HOOKS = 8;

/**
 * recipes 表未建(迁移待用户经 dashboard 执行)的判定:
 * 42P01(Postgres relation 不存在)/ PGRST205 + 'schema cache'(PostgREST 缺表)。
 * 不用宽松的 message.includes('relation'):约束类错误消息也含 relation 字样,
 * 会被误判成表缺失静默吞掉(审查实锤)
 */
function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  return (
    !!error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message ?? "").includes("schema cache"))
  );
}

function sanitizeRecipeScenes(raw: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SCENES) return null;
  const scenes: Array<Record<string, unknown>> = [];
  const seenIdx = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const idx = typeof rec.idx === "number" && Number.isInteger(rec.idx) ? rec.idx : null;
    if (idx === null || idx < 0 || idx >= MAX_SCENES || seenIdx.has(idx)) return null;
    seenIdx.add(idx);
    const beat = typeof rec.beat === "string" && SCENE_BEATS.has(rec.beat) ? rec.beat : null;
    if (!beat) return null;
    const line = typeof rec.line === "string" ? rec.line.trim().slice(0, 500) : "";
    if (!line) return null; // 配方台词是骨架本体,不允许空行
    const slotRec =
      rec.slot && typeof rec.slot === "object" ? (rec.slot as Record<string, unknown>) : null;
    const slotKind =
      typeof slotRec?.kind === "string" && SLOT_KINDS.has(slotRec.kind)
        ? slotRec.kind
        : "product_image";
    scenes.push({
      idx,
      line,
      visual: typeof rec.visual === "string" ? rec.visual.slice(0, 2000) : "",
      // 配方素材槽恒空 asset_ref(实例化时按商品图补):具体素材 URL 不进配方
      slot: { kind: slotKind, asset_ref: "" },
      duration_ms:
        typeof rec.duration_ms === "number" && Number.isFinite(rec.duration_ms)
          ? Math.min(Math.max(Math.round(rec.duration_ms), 500), 60_000)
          : 2500,
      beat,
    });
  }
  return scenes;
}

function sanitizeRecipeHooks(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const hooks: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length && hooks.length < MAX_HOOKS; i++) {
    const rec = raw[i] as Record<string, unknown>;
    const text = typeof rec?.text === "string" ? rec.text.trim().slice(0, 300) : "";
    if (!text) continue;
    let id =
      typeof rec.id === "string" && rec.id.trim() ? rec.id.trim().slice(0, 40) : `hook-${i}`;
    while (seenIds.has(id)) id = `${id}-dup`;
    seenIds.add(id);
    hooks.push({
      id,
      type: typeof rec.type === "string" && HOOK_TYPES.has(rec.type) ? rec.type : "悬念",
      text,
      selected: rec.selected === true,
    });
  }
  return hooks;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }
    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("recipes")
      .select("id, name, description, hooks, scenes, globals, render_mode, origin, use_count, created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (isTableMissing(error)) {
        return NextResponse.json({ success: true, data: { recipes: [], dbReady: false } });
      }
      console.error("[Studio Recipes GET] query failed:", error);
      return NextResponse.json({ success: false, error: "配方读取失败" }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { recipes: data ?? [], dbReady: true } });
  } catch (error) {
    console.error("[Studio Recipes GET] error:", error);
    return NextResponse.json({ success: false, error: "配方读取失败" }, { status: 500 });
  }
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
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!name) {
      return NextResponse.json({ success: false, error: "配方需要名称" }, { status: 400 });
    }
    const scenes = sanitizeRecipeScenes(body?.scenes);
    if (!scenes) {
      return NextResponse.json({ success: false, error: "配方分镜不合法" }, { status: 400 });
    }
    const hooks = sanitizeRecipeHooks(body?.hooks);
    const renderMode =
      body?.renderMode === "slideshow" || body?.renderMode === "assembly" || body?.renderMode === "ai_gen"
        ? body.renderMode
        : null;
    const rawGlobals = (body?.globals ?? {}) as Record<string, unknown>;
    const globals: Record<string, unknown> = {};
    if (
      typeof rawGlobals.duration_per_image_ms === "number" &&
      Number.isFinite(rawGlobals.duration_per_image_ms)
    ) {
      globals.duration_per_image_ms = Math.min(
        Math.max(Math.round(rawGlobals.duration_per_image_ms), 500),
        15_000
      );
    }
    for (const key of ["aspect", "bgm_style", "voice_id", "cta_text"] as const) {
      if (typeof rawGlobals[key] === "string") globals[key] = (rawGlobals[key] as string).slice(0, 100);
    }
    // 门B 溯源:只透传白名单键(配方详情页据 license 明示「复刻结构,非复刻素材」)
    const rawOrigin = body?.origin as Record<string, unknown> | undefined;
    const origin =
      rawOrigin && typeof rawOrigin === "object"
        ? {
            ...(typeof rawOrigin.viral_ref === "string"
              ? { viral_ref: rawOrigin.viral_ref.slice(0, 2000) }
              : {}),
            ...(typeof rawOrigin.why_viral === "string"
              ? { why_viral: rawOrigin.why_viral.slice(0, 2000) }
              : {}),
            ...(rawOrigin.license === "structure_only" ? { license: "structure_only" } : {}),
          }
        : null;
    // UUID 校验:非法值直插 UUID 列会 22P02 落进通用 500(审查实锤)
    const rawSourceId = typeof body?.sourceBlueprintId === "string" ? body.sourceBlueprintId : "";
    if (rawSourceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSourceId)) {
      return NextResponse.json({ success: false, error: "sourceBlueprintId 非法" }, { status: 400 });
    }
    const sourceBlueprintId = rawSourceId || null;

    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("recipes")
      .insert({
        user_id: user.id,
        name,
        description:
          typeof body?.description === "string" ? body.description.trim().slice(0, 500) : null,
        hooks,
        scenes,
        globals,
        render_mode: renderMode,
        origin: origin && Object.keys(origin).length > 0 ? origin : null,
        source_blueprint_id: sourceBlueprintId,
        status: "active",
      } as never)
      .select("id")
      .single();

    if (error || !data) {
      if (isTableMissing(error)) {
        return NextResponse.json(
          { success: false, error: "配方表尚未就绪(数据库迁移待执行),内置配方不受影响" },
          { status: 503 }
        );
      }
      console.error("[Studio Recipes POST] insert failed:", error);
      return NextResponse.json({ success: false, error: "配方保存失败" }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { recipeId: (data as { id: string }).id } });
  } catch (error) {
    console.error("[Studio Recipes POST] error:", error);
    return NextResponse.json({ success: false, error: "配方保存失败" }, { status: 500 });
  }
}
