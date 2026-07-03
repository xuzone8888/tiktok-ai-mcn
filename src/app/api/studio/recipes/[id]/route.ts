import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 配方管理(S4.3 配方库收编模板中心)
 *
 * PATCH { name?, description? } → 重命名/改描述(仅 active 配方)
 * DELETE → 软删除(status='archived';blueprints.recipe_id 无外键,历史蓝图不连坐)
 *
 * 仅用户自有 UUID 配方;内置种子(seed-*)是客户端常量,不经此路由。
 * RLS:cookie client + recipes 四条 own 策略,0 行命中 = 不存在或非属主 → 404。
 */

function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  return (
    !!error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message ?? "").includes("schema cache"))
  );
}

function validId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!validId(id)) {
      return NextResponse.json({ success: false, error: "配方 id 非法" }, { status: 400 });
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
    if (typeof body?.name === "string") {
      const name = body.name.trim().slice(0, 100);
      if (!name) {
        return NextResponse.json({ success: false, error: "配方名不能为空" }, { status: 400 });
      }
      patch.name = name;
    }
    if (typeof body?.description === "string") {
      patch.description = body.description.trim().slice(0, 500) || null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: "没有可更新的字段" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("recipes")
      .update(patch as never)
      .eq("id", id)
      .eq("status", "active")
      .select("id, name, description")
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) {
        return NextResponse.json(
          { success: false, error: "配方库尚未就绪(迁移待执行)" },
          { status: 503 }
        );
      }
      console.error("[Studio Recipes PATCH] failed:", error);
      return NextResponse.json({ success: false, error: "更新失败" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "配方不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Studio Recipes PATCH] error:", error);
    return NextResponse.json({ success: false, error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!validId(id)) {
      return NextResponse.json({ success: false, error: "配方 id 非法" }, { status: 400 });
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
      .from("recipes")
      .update({ status: "archived", updated_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) {
        return NextResponse.json(
          { success: false, error: "配方库尚未就绪(迁移待执行)" },
          { status: 503 }
        );
      }
      console.error("[Studio Recipes DELETE] failed:", error);
      return NextResponse.json({ success: false, error: "删除失败" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "配方不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    console.error("[Studio Recipes DELETE] error:", error);
    return NextResponse.json({ success: false, error: "删除失败" }, { status: 500 });
  }
}
