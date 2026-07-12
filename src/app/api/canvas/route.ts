import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  CANVAS_SCHEMA_VERSION,
  createEmptyCanvasDoc,
  createEmptyCanvasDeps,
  validateCanvasDoc,
  CanvasDepsSchema,
  type CanvasDoc,
  type CanvasDeps,
} from "@/lib/canvas/schema";
import { checkDocSize } from "@/lib/canvas/doc-limits";
import {
  canvasApiError,
  canvasApiSuccess,
  httpStatusForCanvasError,
  type CanvasApiErrorCode,
  type CanvasCreatedData,
} from "@/lib/canvas/api-types";
import {
  buildSizeWarning,
  CanvasCreateRequestSchema,
  sanitizeCanvasTitle,
} from "@/lib/canvas/api-helpers";

export const dynamic = "force-dynamic";

/**
 * 超级画布文档表 · 新建(P0 · D3)
 *
 * POST /api/canvas  body: { title?, doc?, deps? }
 *   → 201 { success, data: CanvasCreatedData, warning? }
 *
 * - 鉴权:cookie 用户 client;RLS insert_own 兜属主(user_id 必须 = auth.uid)。
 * - doc/deps 可选:给了就严格校验(危险值/引用完整性),不给用空画布 / 空 deps。
 * - schema_version 恒取运行时 CANVAS_SCHEMA_VERSION(不接受客户端伪造版本)。
 * - 体积双闸:>2MB 硬拒(DOC_TOO_LARGE 400);>512KB 附软告警;doc_bytes 落库。
 * - rev 从 0 起(与迁移默认一致);updated_at 手动写(表无触发器,沿用 blueprints 惯例)。
 * - canvases 未进 database.ts 生成类型,沿用 blueprints 路由的 untyped client 断言。
 */

function fail(code: CanvasApiErrorCode, message: string) {
  return NextResponse.json(canvasApiError(code, message), {
    status: httpStatusForCanvasError(code),
  });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("UNAUTHENTICATED", "请先登录");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("INVALID_BODY", "请求体不是合法 JSON");
    }
    // 严格顶层:损坏 JSON/数组/基元/未知字段一律 INVALID_BODY,绝不误当空画布创建。
    const parsedBody = CanvasCreateRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return fail("INVALID_BODY", "请求体字段非法(仅允许 title/doc/deps)");
    }
    const input = parsedBody.data;

    const title = sanitizeCanvasTitle(input.title);

    // doc:缺省空画布;给了就严格双校验(结构 + 危险值 + 引用完整性)。
    let doc: CanvasDoc;
    if (input.doc === undefined || input.doc === null) {
      doc = createEmptyCanvasDoc();
    } else {
      const validation = validateCanvasDoc(input.doc);
      if (!validation.ok || !validation.data) {
        return NextResponse.json(
          canvasApiError("CANVAS_DOC_INVALID", "初始画布文档非法", {
            issues: validation.errors.slice(0, 50),
          }),
          { status: httpStatusForCanvasError("CANVAS_DOC_INVALID") }
        );
      }
      doc = validation.data;
    }

    // deps:缺省空;给了就按 schema 解析(非法 → INVALID_BODY)。
    let deps: CanvasDeps;
    if (input.deps === undefined || input.deps === null) {
      deps = createEmptyCanvasDeps();
    } else {
      const parsed = CanvasDepsSchema.safeParse(input.deps);
      if (!parsed.success) return fail("INVALID_BODY", "deps 结构非法");
      deps = parsed.data;
    }

    const size = checkDocSize(doc);
    if (size.overHardLimit) {
      return NextResponse.json(
        canvasApiError("DOC_TOO_LARGE", size.message ?? "画布文档超出 2MB 上限,已拒绝保存"),
        { status: httpStatusForCanvasError("DOC_TOO_LARGE") }
      );
    }

    const nowIso = new Date().toISOString();
    const db = supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("canvases")
      .insert({
        user_id: user.id,
        title,
        schema_version: CANVAS_SCHEMA_VERSION,
        doc,
        deps,
        rev: 0,
        doc_bytes: size.bytes,
        updated_at: nowIso,
      } as never)
      .select("id, title, rev, schema_version, doc_bytes, created_at, updated_at")
      .single();

    if (error || !data) {
      console.error("[Canvas POST] insert failed:", error);
      return fail("INTERNAL", "画布创建失败");
    }

    const row = data as unknown as {
      id: string;
      title: string;
      rev: number;
      schema_version: number;
      doc_bytes: number | null;
      created_at: string;
      updated_at: string;
    };

    const created: CanvasCreatedData = {
      id: row.id,
      title: row.title,
      rev: row.rev,
      schemaVersion: row.schema_version,
      docBytes: row.doc_bytes ?? size.bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return NextResponse.json(canvasApiSuccess(created, buildSizeWarning(size) ?? undefined), {
      status: 201,
    });
  } catch (error) {
    console.error("[Canvas POST] error:", error);
    return fail("INTERNAL", "画布创建失败");
  }
}
