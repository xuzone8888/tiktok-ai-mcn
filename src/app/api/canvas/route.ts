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
import { deepEqual } from "@/lib/canvas/patch";

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

const CREATED_COLUMNS = "id, title, rev, schema_version, doc_bytes, created_at, updated_at";
/** 幂等采纳读回列:额外取 doc/deps,以逐字段比对既有行是否仍是本次创建请求的原始未改副本。 */
const ADOPT_COLUMNS =
  "id, user_id, title, rev, schema_version, doc, deps, doc_bytes, created_at, updated_at";

interface CanvasCreatedRow {
  id: string;
  title: string;
  rev: number;
  schema_version: number;
  doc_bytes: number | null;
  created_at: string;
  updated_at: string;
}

interface CanvasAdoptRow extends CanvasCreatedRow {
  user_id: string;
  doc: unknown;
  deps: unknown;
}

/** Postgres unique-violation(重复主键)。supabase-js 透传 PostgREST 的 `code`。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "23505"
  );
}

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
      return fail("INVALID_BODY", "请求体字段非法(仅允许 id/title/doc/deps)");
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
    const insertValues: Record<string, unknown> = {
      user_id: user.id,
      title,
      schema_version: CANVAS_SCHEMA_VERSION,
      doc,
      deps,
      rev: 0,
      doc_bytes: size.bytes,
      updated_at: nowIso,
    };
    // 客户端提供稳定 UUID → 显式落主键,使并发/重试/中止/重挂的多次创建幂等收敛为一行。
    if (input.id !== undefined) insertValues.id = input.id;

    const { data, error } = await db
      .from("canvases")
      .insert(insertValues as never)
      .select(CREATED_COLUMNS)
      .single();

    let row: CanvasCreatedRow | null = (data as unknown as CanvasCreatedRow) ?? null;
    let adopted = false;

    if (error || !row) {
      // 幂等新建:同一 own UUID 的重复创建撞主键(23505)→ 读回**本人**既有行,仅当它仍是这次创建请求的
      // **原始未改**副本(rev===0 且 title/schema/doc/deps/doc_bytes 逐字段全等)才原样采纳。
      // 一旦已被后续 PATCH 推进(rev>0),或标题/文档/依赖已不同,或非本人持有(RLS 命中 0 行)→ REV_CONFLICT,
      // 绝不把一次「新建」静默返回成他人的或已演进的画布(fail-closed)。
      if (input.id !== undefined && isUniqueViolation(error)) {
        const { data: existing, error: readbackError } = await db
          .from("canvases")
          .select(ADOPT_COLUMNS)
          .eq("id", input.id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (readbackError) {
          console.error("[Canvas POST] idempotent readback failed:", readbackError);
          return fail("INTERNAL", "画布创建结果确认失败，请重试");
        }
        const existingRow = (existing as unknown as CanvasAdoptRow) ?? null;
        if (
          existingRow &&
          existingRow.user_id === user.id &&
          existingRow.rev === 0 &&
          existingRow.schema_version === CANVAS_SCHEMA_VERSION &&
          existingRow.title === title &&
          existingRow.doc_bytes === size.bytes &&
          deepEqual(existingRow.doc, doc) &&
          deepEqual(existingRow.deps, deps)
        ) {
          row = existingRow;
          adopted = true;
        } else {
          return fail("REV_CONFLICT", "画布 ID 冲突,请重试");
        }
      } else {
        console.error("[Canvas POST] insert failed:", error);
        return fail("INTERNAL", "画布创建失败");
      }
    }

    const created: CanvasCreatedData = {
      id: row.id,
      title: row.title,
      rev: row.rev,
      schemaVersion: row.schema_version,
      docBytes: row.doc_bytes ?? size.bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // 新建 201;幂等采纳既有行 200(不改动其内容,仅回其权威摘要)。
    return NextResponse.json(canvasApiSuccess(created, buildSizeWarning(size) ?? undefined), {
      status: adopted ? 200 : 201,
    });
  } catch (error) {
    console.error("[Canvas POST] error:", error);
    return fail("INTERNAL", "画布创建失败");
  }
}
