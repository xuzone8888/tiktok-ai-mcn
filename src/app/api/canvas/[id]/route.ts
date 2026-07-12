import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadCanvasDoc } from "@/lib/canvas/schema";
import { computeDocBytes } from "@/lib/canvas/doc-limits";
import { CanvasOpsArraySchema, type CanvasOp } from "@/lib/canvas/patch";
import {
  canvasApiError,
  canvasApiSuccess,
  httpStatusForCanvasError,
  type CanvasApiErrorCode,
  type CanvasApiErrorDetails,
  type CanvasDocumentData,
  type CanvasPatchResultData,
} from "@/lib/canvas/api-types";
import {
  CANVAS_CAS_MAX_ATTEMPTS,
  CANVAS_UUID_RE,
  CanvasPatchBodySchema,
  decidePatch,
  envelopeWithMeta,
  parseDepsForTransport,
  recoveryReport,
  sanitizeCanvasTitle,
  tolerantEnvelope,
} from "@/lib/canvas/api-helpers";

export const dynamic = "force-dynamic";

/**
 * 超级画布文档 · 整包读 / 节点级补丁保存(P0 · D3)
 *
 * GET   /api/canvas/[id] → { success, data: CanvasDocumentData }
 *   容错加载(loadCanvasDoc):坏档不抛;tolerant loaded topology 供渲染,完整 recovery 负载
 *   (brokenNodes/brokenEdges/迁移状态/issues)交客户端占位可删,坏实体绝不静默丢弃。
 *
 * PATCH /api/canvas/[id]  body: { baseRev, ops[], title?, deps? }
 *   → { success, data: CanvasPatchResultData, warning? }
 *   判定全在纯函数 decidePatch:存量坏档 422 阻断一切写、stale rev 元数据 409 保护、
 *   幂等重放 / 非重叠 rebase / 重叠 409、双校验 422、>2MB 400;rev CAS 失败重读重试,
 *   写路由手动维护 updated_at(表无触发器,沿用 blueprints 惯例)。
 *
 * 权限:cookie 用户 client + RLS own,跨用户/不存在都表现为 0 行 → NOT_FOUND。
 * canvases 未进 database.ts 生成类型,沿用 blueprints 路由的 untyped client 断言。
 */

type RouteParams = { params: Promise<{ id: string }> };

interface CanvasRow {
  id: string;
  title: string;
  rev: number;
  schema_version: number;
  doc: unknown;
  deps: unknown;
  doc_bytes: number | null;
  status: string;
  writer_tag: string | null;
  writer_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

const ROW_COLUMNS =
  "id, title, rev, schema_version, doc, deps, doc_bytes, status, writer_tag, writer_heartbeat_at, created_at, updated_at";

function errorResponse(
  code: CanvasApiErrorCode,
  message: string,
  details?: CanvasApiErrorDetails
) {
  return NextResponse.json(canvasApiError(code, message, details), {
    status: httpStatusForCanvasError(code),
  });
}

type CanvasGate =
  | { ok: true; db: SupabaseClient; id: string }
  | { ok: false; response: NextResponse };

async function requireUserAndId(params: RouteParams["params"]): Promise<CanvasGate> {
  const { id } = await params;
  if (!CANVAS_UUID_RE.test(id)) {
    return { ok: false, response: errorResponse("INVALID_ID", "画布 ID 非法") };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: errorResponse("UNAUTHENTICATED", "请先登录") };
  }
  return { ok: true, db: supabase as unknown as SupabaseClient, id };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const gate = await requireUserAndId(params);
    if (!gate.ok) return gate.response;
    const { db, id } = gate;

    const { data, error } = await db
      .from("canvases")
      .select(ROW_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[Canvas GET] query failed:", error);
      return errorResponse("INTERNAL", "画布读取失败");
    }
    if (!data) return errorResponse("NOT_FOUND", "画布不存在");

    const row = data as unknown as CanvasRow;
    const load = loadCanvasDoc(row.doc, row.schema_version);
    // deps 损坏时仍回空 deps 供展示,但 forceRecovery → recoveryRequired=true(从加载阻断 autosave,
    // 避免客户端先允许保存再对损坏 deps 反复 422)。
    const depsView = parseDepsForTransport(row.deps);
    const docBytes = row.doc_bytes ?? computeDocBytes(row.doc);

    const payload: CanvasDocumentData = {
      id: row.id,
      title: row.title,
      rev: row.rev,
      schemaVersion: row.schema_version,
      envelope: tolerantEnvelope(load, depsView.deps),
      recovery: recoveryReport(load, { forceRecovery: !depsView.ok, extraIssues: depsView.issues }),
      docBytes,
      status: row.status,
      writer: { tag: row.writer_tag, heartbeatAt: row.writer_heartbeat_at },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return NextResponse.json(canvasApiSuccess(payload));
  } catch (error) {
    console.error("[Canvas GET] error:", error);
    return errorResponse("INTERNAL", "画布读取失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const gate = await requireUserAndId(params);
    if (!gate.ok) return gate.response;
    const { db, id } = gate;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_BODY", "请求体不是合法 JSON");
    }

    // 第一阶段:顶层严格契约——非对象/数组/未知顶层字段/title 超长/baseRev·deps 非法 → INVALID_BODY。
    const parsedBody = CanvasPatchBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return errorResponse(
        "INVALID_BODY",
        "请求体字段非法(仅允许 baseRev/ops/title/deps,title≤200)"
      );
    }
    const { baseRev, deps: reqDeps } = parsedBody.data;

    // 第二阶段:op 数组结构校验——非法(含非数组)→ INVALID_OPS,与顶层错误分流。
    const opsResult = CanvasOpsArraySchema.safeParse(parsedBody.data.ops ?? []);
    if (!opsResult.success) {
      return errorResponse("INVALID_OPS", "补丁 op 校验失败", {
        issues: opsResult.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .slice(0, 50),
      });
    }
    const ops: CanvasOp[] = opsResult.data;

    // title:已保证 string≤200;trim + 空→默认(undefined = 不改名)。
    const title =
      parsedBody.data.title !== undefined
        ? sanitizeCanvasTitle(parsedBody.data.title)
        : undefined;

    // CAS 失败重读重试:每个 attempt 读到最新行 → decidePatch 纯决策 → 仅 write 才 CAS 写。
    for (let attempt = 0; attempt < CANVAS_CAS_MAX_ATTEMPTS; attempt += 1) {
      const { data, error } = await db
        .from("canvases")
        .select(ROW_COLUMNS)
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("[Canvas PATCH] read failed:", error);
        return errorResponse("INTERNAL", "画布读取失败");
      }
      if (!data) return errorResponse("NOT_FOUND", "画布不存在");

      const row = data as unknown as CanvasRow;
      const decision = decidePatch({
        storedDoc: row.doc,
        storedDeps: row.deps,
        storedTitle: row.title,
        storedRev: row.rev,
        storedSchemaVersion: row.schema_version,
        storedDocBytes: row.doc_bytes,
        baseRev,
        ops,
        title,
        deps: reqDeps,
      });

      if (decision.kind === "reload") {
        return errorResponse(decision.code, decision.message, decision.details);
      }
      if (decision.kind === "conflict") {
        return errorResponse("ENTITY_CONFLICT", decision.message, decision.details);
      }
      if (decision.kind === "invalid") {
        return errorResponse("CANVAS_DOC_INVALID", decision.message, decision.details);
      }
      if (decision.kind === "too_large") {
        return errorResponse("DOC_TOO_LARGE", decision.message);
      }

      if (decision.kind === "noop") {
        const result: CanvasPatchResultData = {
          id: row.id,
          rev: decision.rev,
          schemaVersion: decision.schemaVersion,
          docBytes: decision.docBytes,
          rebased: decision.rebased,
          appliedOps: decision.applied,
          noopOps: decision.noop,
          persisted: false,
          updatedAt: row.updated_at,
          ...(decision.envelope ? { envelope: decision.envelope } : {}),
        };
        return NextResponse.json(canvasApiSuccess(result, decision.warning ?? undefined));
      }

      // decision.kind === "write"
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        doc: decision.doc,
        deps: decision.deps,
        rev: row.rev + 1,
        doc_bytes: decision.docBytes,
        updated_at: nowIso,
      };
      if (decision.title !== null) update.title = decision.title;

      const { data: saved, error: saveError } = await db
        .from("canvases")
        .update(update as never)
        .eq("id", id)
        .eq("rev", row.rev)
        .select("rev, updated_at")
        .maybeSingle();

      if (saveError) {
        console.error("[Canvas PATCH] update failed:", saveError);
        return errorResponse("INTERNAL", "画布保存失败");
      }
      if (!saved) {
        // CAS 落空:读→写之间他人已 bump rev;重读重试。
        continue;
      }

      const savedRow = saved as unknown as { rev: number; updated_at: string };
      const result: CanvasPatchResultData = {
        id: row.id,
        rev: savedRow.rev,
        schemaVersion: decision.schemaVersion,
        docBytes: decision.docBytes,
        rebased: decision.rebased,
        appliedOps: decision.applied,
        noopOps: decision.noop,
        persisted: true,
        updatedAt: savedRow.updated_at,
        ...(decision.rebased
          ? {
              envelope: envelopeWithMeta(
                decision.doc,
                decision.deps,
                savedRow.rev,
                decision.docBytes
              ),
            }
          : {}),
      };
      return NextResponse.json(canvasApiSuccess(result, decision.warning ?? undefined));
    }

    // 尝试耗尽:保存竞争过于激烈,让客户端整包重载再来。
    return errorResponse("REV_CONFLICT", "保存竞争激烈,请重载画布后重试");
  } catch (error) {
    console.error("[Canvas PATCH] error:", error);
    return errorResponse("INTERNAL", "画布保存失败");
  }
}
