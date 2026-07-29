import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import {
  buildSizeWarning,
  CANVAS_UUID_RE,
  CanvasCreateRequestSchema,
  sanitizeCanvasTitle,
} from "@/lib/canvas/api-helpers";
import {
  canvasApiError,
  canvasApiSuccess,
  httpStatusForCanvasError,
  type CanvasApiErrorCode,
  type CanvasCreatedData,
  type CanvasProjectListData,
  type CanvasProjectSummary,
} from "@/lib/canvas/api-types";
import { checkDocSize } from "@/lib/canvas/doc-limits";
import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { deepEqual } from "@/lib/canvas/patch";
import {
  assertCanvasDocumentMediaReady,
  CanvasMediaReadinessError,
} from "@/lib/canvas/upload-registry";
import {
  CANVAS_SCHEMA_VERSION,
  createEmptyCanvasDoc,
  createEmptyCanvasDeps,
  validateCanvasDoc,
  CanvasDepsSchema,
  type CanvasDoc,
  type CanvasDeps,
} from "@/lib/canvas/schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 超级画布文档表 · 新建(P0 · D3)
 *
 * POST /api/canvas  body: { title?, doc?, deps? }
 *   → 201 { success, data: CanvasCreatedData, warning? }
 *
 * - 鉴权:cookie 用户 client;数据库 RPC 以 auth.uid 定属主并原子执行每用户 100 项目硬上限。
 * - doc/deps 可选:给了就严格校验(危险值/引用完整性),不给用空画布 / 空 deps。
 * - schema_version 恒取运行时 CANVAS_SCHEMA_VERSION(不接受客户端伪造版本)。
 * - 体积双闸:>2MB 硬拒(DOC_TOO_LARGE 400);>512KB 附软告警;doc_bytes 落库。
 * - rev 从 0 起(与迁移默认一致);updated_at 手动写(表无触发器,沿用 blueprints 惯例)。
 * - canvases 未进 database.ts 生成类型,沿用 blueprints 路由的 untyped client 断言。
 */

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

interface CanvasProjectRow {
  id: string;
  title: string;
  rev: number;
  doc_bytes: number | null;
  created_at: string;
  updated_at: string;
}

const PROJECT_LIST_COLUMNS = "id, title, rev, doc_bytes, created_at, updated_at";
const PROJECT_LIST_DEFAULT_LIMIT = 20;
const PROJECT_LIST_MAX_LIMIT = 100;
const PROJECT_LIST_MAX_PAGE = 1_000_000;

function fail(code: CanvasApiErrorCode, message: string) {
  return NextResponse.json(canvasApiError(code, message), {
    status: httpStatusForCanvasError(code),
  });
}

function parsePositiveInteger(
  raw: string | null,
  fallback: number,
  maximum: number
): number | null {
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}

function toProjectSummary(row: CanvasProjectRow): CanvasProjectSummary | null {
  if (
    !CANVAS_UUID_RE.test(row.id) ||
    typeof row.title !== "string" ||
    !Number.isSafeInteger(row.rev) ||
    row.rev < 0 ||
    !(
      row.doc_bytes === null ||
      (Number.isSafeInteger(row.doc_bytes) && row.doc_bytes >= 0)
    ) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: row.id.toLowerCase(),
    title: row.title,
    rev: row.rev,
    docBytes: row.doc_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/canvas?page=1&limit=20
 *
 * Returns only owner-safe project summaries, newest edit first. Pagination is
 * deliberately bounded so a project picker can never turn into an unbounded
 * document query; RLS and the explicit owner predicate both scope the result.
 */
export async function GET(request: NextRequest) {
  try {
    const pageValues = request.nextUrl.searchParams.getAll("page");
    const limitValues = request.nextUrl.searchParams.getAll("limit");
    if (pageValues.length > 1 || limitValues.length > 1) {
      return fail("INVALID_BODY", "分页参数不能重复");
    }

    const page = parsePositiveInteger(
      pageValues[0] ?? null,
      1,
      PROJECT_LIST_MAX_PAGE
    );
    const limit = parsePositiveInteger(
      limitValues[0] ?? null,
      PROJECT_LIST_DEFAULT_LIMIT,
      PROJECT_LIST_MAX_LIMIT
    );
    if (page === null || limit === null) {
      return fail(
        "INVALID_BODY",
        `page 必须为 1-${PROJECT_LIST_MAX_PAGE} 的整数，limit 必须为 1-${PROJECT_LIST_MAX_LIMIT} 的整数`
      );
    }

    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      return fail("INVALID_BODY", "分页范围过大");
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return fail("UNAUTHENTICATED", "请先登录");
    if (
      !canAccessSuperCanvas({
        id: user.id,
        email: user.email ?? null,
      })
    ) {
      return fail("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放");
    }

    const db = supabase as unknown as SupabaseClient;
    const { data, error, count } = await db
      .from("canvases")
      .select(PROJECT_LIST_COLUMNS, { count: "exact" })
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[Canvas GET list] query failed:", error);
      return fail("INTERNAL", "画布列表读取失败");
    }

    const canvases: CanvasProjectSummary[] = [];
    for (const value of data ?? []) {
      const summary = toProjectSummary(value as unknown as CanvasProjectRow);
      if (!summary) {
        console.error("[Canvas GET list] invalid project row metadata");
        return fail("INTERNAL", "画布列表数据校验失败");
      }
      canvases.push(summary);
    }

    const total =
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0
        ? count
        : offset + canvases.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const payload: CanvasProjectListData = {
      canvases,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
    return NextResponse.json(canvasApiSuccess(payload));
  } catch (error) {
    console.error("[Canvas GET list] error:", error);
    return fail("INTERNAL", "画布列表读取失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("UNAUTHENTICATED", "请先登录");
    if (
      !canAccessSuperCanvas({
        id: user.id,
        email: user.email ?? null,
      })
    ) {
      return fail("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放");
    }

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

    try {
      await assertCanvasDocumentMediaReady({
        userId: user.id,
        canvasId: null,
        baseRev: null,
        doc,
      });
    } catch (error) {
      if (error instanceof CanvasMediaReadinessError) {
        if (error.reason === "INTERNAL") {
          console.error("[Canvas POST] media readiness unavailable");
          return fail("INTERNAL", "媒体对象状态暂时无法确认");
        }
        return NextResponse.json(
          canvasApiError("CANVAS_DOC_INVALID", error.message, {
            issues: [`rejected media objects: ${error.rejectedCount}`],
          }),
          { status: httpStatusForCanvasError("CANVAS_DOC_INVALID") }
        );
      }
      throw error;
    }

    const db = supabase as unknown as SupabaseClient;
    // The database serializes project creation per user, enforces the hard
    // project cap, and returns an owned same-id row for idempotent verification.
    // generated database.ts predates this additive RPC.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: createData, error } = await (db as any).rpc(
      "create_canvas_project_v1",
      {
        p_canvas_id: input.id ?? null,
        p_title: title,
        p_schema_version: CANVAS_SCHEMA_VERSION,
        p_doc: doc,
        p_deps: deps,
        p_doc_bytes: size.bytes,
      }
    );
    if (error) {
      if (error.code === "23505") {
        return fail("REV_CONFLICT", "画布 ID 冲突,请重试");
      }
      if (
        error.code === "54000" &&
        typeof error.message === "string" &&
        error.message.includes("project limit reached")
      ) {
        return fail(
          "PROJECT_LIMIT_REACHED",
          "每个账号最多可创建 100 个画布项目，请先整理旧项目"
        );
      }
      console.error("[Canvas POST] create RPC failed:", {
        code: error.code,
      });
      return fail("INTERNAL", "画布创建失败");
    }
    const rpcResult = Array.isArray(createData) ? createData[0] : createData;
    const row = (rpcResult?.canvas as CanvasAdoptRow | undefined) ?? null;
    const adopted = rpcResult?.created === false;
    if (!row || (rpcResult?.created !== true && !adopted)) {
      return fail("INTERNAL", "画布创建结果无法确认");
    }

    // Same UUID retries only succeed when the owned row is still the exact
    // original request. A changed project is never silently adopted.
    if (
      adopted &&
      !(
        row.user_id === user.id &&
        row.rev === 0 &&
        row.schema_version === CANVAS_SCHEMA_VERSION &&
        row.title === title &&
        row.doc_bytes === size.bytes &&
        deepEqual(row.doc, doc) &&
        deepEqual(row.deps, deps)
      )
    ) {
      return fail("REV_CONFLICT", "画布 ID 冲突,请重试");
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
