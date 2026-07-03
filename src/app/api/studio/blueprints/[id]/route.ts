import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeCard, type ProductCard } from "@/lib/studio/product-vision";

export const dynamic = "force-dynamic";

/**
 * 蓝图单条读写(S2.2,蓝图编辑器首版)
 *
 * GET  → { success, data: blueprint 全量行 }
 * PATCH { product?, scenes?, status? } → { success, data: { blueprintId } }
 *
 * 权限:cookie 用户 client + RLS own 策略兜属主(跨用户读写命中 0 行 → 404)。
 * PATCH 白名单字段逐元素消毒(product 走 normalizeCard 同一消毒器;scenes 逐
 * 字段校验),user_id/id/source_* 永不可改;updated_at 手动写(表无触发器)。
 * blueprints 未进 database.ts 生成类型,沿用 POST 路由的 untyped client 断言。
 */

interface SanitizedScene {
  idx: number;
  line: string;
  visual: string;
  slot: { kind: string; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

const SCENE_BEATS = new Set(["hook", "point", "demo", "cta"]);
const SLOT_KINDS = new Set(["product_image", "broll", "avatar", "ai_gen"]);
const MAX_SCENES = 30;

function sanitizeScenes(raw: unknown): SanitizedScene[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SCENES) return null;
  const scenes: SanitizedScene[] = [];
  const seenIdx = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const idx = typeof rec.idx === "number" && Number.isInteger(rec.idx) ? rec.idx : null;
    if (idx === null || idx < 0 || idx >= MAX_SCENES) return null;
    // idx 是下游唯一键(clientTaskId=`${jobId}-s${idx}`、updateScene 按 idx 寻址),
    // 重复 idx 会让重复镜永不提交、job 无限重试无解
    if (seenIdx.has(idx)) return null;
    seenIdx.add(idx);
    const beat = typeof rec.beat === "string" && SCENE_BEATS.has(rec.beat) ? rec.beat : null;
    if (!beat) return null;
    const slotRec =
      rec.slot && typeof rec.slot === "object" ? (rec.slot as Record<string, unknown>) : null;
    const slotKind =
      typeof slotRec?.kind === "string" && SLOT_KINDS.has(slotRec.kind)
        ? slotRec.kind
        : "product_image";
    const assetRef = typeof slotRec?.asset_ref === "string" ? slotRec.asset_ref.slice(0, 2000) : "";
    scenes.push({
      idx,
      line: typeof rec.line === "string" ? rec.line.slice(0, 500) : "",
      visual: typeof rec.visual === "string" ? rec.visual.slice(0, 2000) : "",
      slot: { kind: slotKind, asset_ref: assetRef },
      duration_ms:
        typeof rec.duration_ms === "number" && Number.isFinite(rec.duration_ms)
          ? Math.min(Math.max(Math.round(rec.duration_ms), 500), 60_000)
          : 2000,
      beat: beat as SanitizedScene["beat"],
    });
  }
  return scenes;
}

type RouteParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: RouteParams) {
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

    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("blueprints")
      .select(
        "id, source_type, source_ref, rights_ack, product, hooks, scenes, globals, render_mode, origin, status, version, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[Studio Blueprint GET] query failed:", error);
      return NextResponse.json({ success: false, error: "蓝图读取失败" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "蓝图不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Studio Blueprint GET] error:", error);
    return NextResponse.json({ success: false, error: "蓝图读取失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    const body = await request.json();
    const patch: Record<string, unknown> = {};

    if (body?.product !== undefined) {
      const rawProduct = body.product as Record<string, unknown> | undefined;
      const images = Array.isArray(rawProduct?.images)
        ? rawProduct.images
            .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
            .slice(0, 9)
        : [];
      const product: ProductCard | null = normalizeCard(rawProduct, images);
      if (!product) {
        return NextResponse.json({ success: false, error: "商品卡数据不完整" }, { status: 400 });
      }
      if (!product.selling_points.some((p) => p.selected)) {
        return NextResponse.json({ success: false, error: "至少勾选一个卖点" }, { status: 400 });
      }
      patch.product = product;
    }

    if (body?.scenes !== undefined) {
      const scenes = sanitizeScenes(body.scenes);
      if (!scenes) {
        return NextResponse.json({ success: false, error: "分镜数据不合法" }, { status: 400 });
      }
      patch.scenes = scenes;
    }

    if (body?.status !== undefined) {
      if (body.status !== "draft" && body.status !== "ready") {
        return NextResponse.json({ success: false, error: "status 非法" }, { status: 400 });
      }
      patch.status = body.status;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: "没有可更新的字段" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("blueprints")
      .update(patch as never)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[Studio Blueprint PATCH] update failed:", error);
      return NextResponse.json({ success: false, error: "蓝图保存失败" }, { status: 500 });
    }
    if (!data) {
      // RLS 兜属主:跨用户/不存在都表现为 0 行命中
      return NextResponse.json({ success: false, error: "蓝图不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { blueprintId: id } });
  } catch (error) {
    console.error("[Studio Blueprint PATCH] error:", error);
    return NextResponse.json({ success: false, error: "蓝图保存失败" }, { status: 500 });
  }
}
