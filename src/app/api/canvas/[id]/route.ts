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
  type CanvasRepairResultData,
} from "@/lib/canvas/api-types";
import {
  CANVAS_CAS_MAX_ATTEMPTS,
  CANVAS_UUID_RE,
  CanvasPatchWriteBodySchema,
  decidePatch,
  decideRepair,
  envelopeWithMeta,
  parseDepsForTransport,
  parseCanvasRepairRequest,
  recoveryReport,
  sanitizeCanvasTitle,
  tolerantEnvelope,
  type RepairDecision,
} from "@/lib/canvas/api-helpers";
import { WRITER_LEASE_MS, writerActiveSinceIso } from "@/lib/canvas/writer-lock";

export const dynamic = "force-dynamic";

/**
 * 超级画布文档 · 整包读 / 节点级补丁保存(P0 · D3)
 *
 * GET   /api/canvas/[id] → { success, data: CanvasDocumentData }
 *   容错加载(loadCanvasDoc):坏档不抛;tolerant loaded topology 供渲染,完整 recovery 负载
 *   (brokenNodes/brokenEdges/迁移状态/issues)交客户端占位可删,坏实体绝不静默丢弃。
 *
 * PATCH /api/canvas/[id]  body: { baseRev, writerTag, ops[], title?, deps? }
 *   → { success, data: CanvasPatchResultData, warning? }
 *   判定全在纯函数 decidePatch:单写者门禁(D5)、存量坏档 422 阻断一切写、
 *   stale rev 元数据 409 保护、幂等重放 / 非重叠 rebase / 重叠 409、双校验 422、>2MB 400;
 *   rev CAS 失败重读重试,写路由手动维护 updated_at(表无触发器,沿用 blueprints 惯例)。
 *   单写者(D5,P0 安全边界):**writerTag 必填**(缺失/非法 → INVALID_BODY,杜绝无 tag 绕过);
 *   写门禁要求**活跃同 tag**(合法同 tag + 心跳 30s 内未过期),**三谓词与 rev CAS 同一原子 UPDATE**
 *   (`writer_tag=:tag AND writer_heartbeat_at>=now-lease AND rev=:baseRev`)——0 行时下一轮重读:
 *   tag 已变或心跳过期 → WRITER_LOCKED(409),仅 rev 变 → 续 rebase;锁冲突与 rev 冲突严格可区分。
 *   过期同 tag 不得经 PATCH 复活(须先走 writer 路由续租);活跃写者保存顺带续租(writer_heartbeat_at=now)。
 *
 * PUT /api/canvas/[id] body: { baseRev, writerTag, confirmRecovery:true, doc, deps }
 *   仅当库内 raw doc/deps 确实损坏或 recoveryRequired 时允许当前 schema 整包恢复。健康行拒绝,
 *   防止 PUT 成为普通覆盖旁路;owner+rev+writer+活跃心跳同一 UPDATE。提交后响应丢失时，仅
 *   rev=baseRev+1 且 schema/doc/deps/doc_bytes 全等的重试按 already-applied 成功返回，不二次写。
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
  | { ok: true; db: SupabaseClient; id: string; userId: string }
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
  return {
    ok: true,
    db: supabase as unknown as SupabaseClient,
    id: id.toLowerCase(),
    userId: user.id,
  };
}

type RepairRejection = Exclude<
  RepairDecision,
  { kind: "write" } | { kind: "already_applied" }
>;
type RepairAccepted = Extract<
  RepairDecision,
  { kind: "write" } | { kind: "already_applied" }
>;

function repairErrorResponse(decision: RepairRejection) {
  if (decision.kind === "locked") {
    return errorResponse("WRITER_LOCKED", decision.message, decision.details);
  }
  if (decision.kind === "stale") {
    return errorResponse("REV_CONFLICT", decision.message, decision.details);
  }
  if (decision.kind === "too_large") {
    return errorResponse("DOC_TOO_LARGE", decision.message);
  }
  return errorResponse("CANVAS_DOC_INVALID", decision.message, decision.details);
}

function repairSuccessResponse(
  id: string,
  rev: number,
  updatedAt: string,
  decision: RepairAccepted
) {
  const envelope = envelopeWithMeta(decision.doc, decision.deps, rev, decision.docBytes);
  const result: CanvasRepairResultData = {
    id,
    rev,
    schemaVersion: decision.schemaVersion,
    docBytes: decision.docBytes,
    persisted: true,
    recovered: true,
    updatedAt,
    envelope,
  };
  return NextResponse.json(canvasApiSuccess(result));
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

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const gate = await requireUserAndId(params);
    if (!gate.ok) return gate.response;
    const { db, id, userId } = gate;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_BODY", "请求体不是合法 JSON");
    }

    const parsedBody = parseCanvasRepairRequest(body);
    if (!parsedBody.ok) {
      return errorResponse(
        "INVALID_BODY",
        "恢复请求字段非法(仅允许且必须包含 baseRev/writerTag/confirmRecovery:true/doc/deps)",
        { issues: parsedBody.issues }
      );
    }
    const { baseRev, writerTag, doc, deps } = parsedBody.data;

    // RLS remains authoritative; the explicit owner predicate is defense in depth and is also
    // repeated on the CAS UPDATE and its zero-row classification reread.
    const { data, error } = await db
      .from("canvases")
      .select(ROW_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[Canvas PUT repair] read failed:", error);
      return errorResponse("INTERNAL", "画布恢复读取失败");
    }
    if (!data) return errorResponse("NOT_FOUND", "画布不存在");

    const row = data as unknown as CanvasRow;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const decideForRow = (current: CanvasRow) =>
      decideRepair({
        storedDoc: current.doc,
        storedDeps: current.deps,
        storedDocBytes: current.doc_bytes,
        storedRev: current.rev,
        storedSchemaVersion: current.schema_version,
        storedWriter: {
          writerTag: current.writer_tag,
          writerHeartbeatAt: current.writer_heartbeat_at,
        },
        baseRev,
        writerTag,
        doc,
        deps,
        nowMs,
        nowIso,
      });

    const decision = decideForRow(row);
    if (decision.kind === "already_applied") {
      if (
        row.id !== id ||
        row.rev !== baseRev + 1 ||
        row.schema_version !== decision.schemaVersion ||
        row.doc_bytes !== decision.docBytes ||
        typeof row.updated_at !== "string"
      ) {
        console.error("[Canvas PUT repair] unexpected idempotent readback metadata");
        return errorResponse("INTERNAL", "画布恢复结果校验失败");
      }
      return repairSuccessResponse(row.id, row.rev, row.updated_at, decision);
    }
    if (decision.kind !== "write") return repairErrorResponse(decision);

    const nextRev = baseRev + 1;
    const update: Record<string, unknown> = {
      doc: decision.doc,
      deps: decision.deps,
      rev: nextRev,
      schema_version: decision.schemaVersion,
      doc_bytes: decision.docBytes,
      updated_at: nowIso,
      writer_heartbeat_at: nowIso,
    };

    // Exactly one atomic write attempt. WHERE evaluates the old lease while SET renews it.
    const { data: saved, error: saveError } = await db
      .from("canvases")
      .update(update as never)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("rev", baseRev)
      .eq("writer_tag", writerTag)
      .gte("writer_heartbeat_at", writerActiveSinceIso(nowMs, WRITER_LEASE_MS))
      .select("id, rev, schema_version, doc_bytes, updated_at")
      .maybeSingle();

    if (saveError) {
      console.error("[Canvas PUT repair] update failed:", saveError);
      return errorResponse("INTERNAL", "画布恢复保存失败");
    }

    if (!saved) {
      // No blind retry: classify the failed CAS against the current owner-scoped row. Only
      // expected state transitions are surfaced; an unchanged write-eligible row is INTERNAL.
      const { data: reread, error: rereadError } = await db
        .from("canvases")
        .select(ROW_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (rereadError) {
        console.error("[Canvas PUT repair] CAS reread failed:", rereadError);
        return errorResponse("INTERNAL", "画布恢复状态确认失败");
      }
      if (!reread) return errorResponse("NOT_FOUND", "画布不存在");

      const rereadRow = reread as unknown as CanvasRow;
      const rereadDecision = decideForRow(rereadRow);
      if (rereadDecision.kind === "already_applied") {
        if (
          rereadRow.id !== id ||
          rereadRow.rev !== baseRev + 1 ||
          rereadRow.schema_version !== rereadDecision.schemaVersion ||
          rereadRow.doc_bytes !== rereadDecision.docBytes ||
          typeof rereadRow.updated_at !== "string"
        ) {
          console.error("[Canvas PUT repair] unexpected idempotent CAS readback metadata");
          return errorResponse("INTERNAL", "画布恢复结果校验失败");
        }
        return repairSuccessResponse(
          rereadRow.id,
          rereadRow.rev,
          rereadRow.updated_at,
          rereadDecision
        );
      }
      if (
        rereadDecision.kind === "locked" ||
        rereadDecision.kind === "stale" ||
        rereadDecision.kind === "not_required"
      ) {
        return repairErrorResponse(rereadDecision);
      }
      console.error("[Canvas PUT repair] zero-row CAS remained write-eligible");
      return errorResponse("INTERNAL", "画布恢复竞争状态无法确认");
    }

    const savedRow = saved as unknown as {
      id: string;
      rev: number;
      schema_version: number;
      doc_bytes: number;
      updated_at: string;
    };
    if (
      savedRow.id !== id ||
      savedRow.rev !== nextRev ||
      savedRow.schema_version !== decision.schemaVersion ||
      savedRow.doc_bytes !== decision.docBytes ||
      typeof savedRow.updated_at !== "string"
    ) {
      console.error("[Canvas PUT repair] unexpected update result metadata");
      return errorResponse("INTERNAL", "画布恢复结果校验失败");
    }

    return repairSuccessResponse(savedRow.id, savedRow.rev, savedRow.updated_at, decision);
  } catch (error) {
    console.error("[Canvas PUT repair] error:", error);
    return errorResponse("INTERNAL", "画布恢复失败");
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

    // 第一阶段:顶层严格契约——非对象/数组/未知顶层字段/title 超长/baseRev·deps 非法/
    // **缺失或非法 writerTag**(P0 单写者:写请求必须持合法写者标签)→ INVALID_BODY。
    const parsedBody = CanvasPatchWriteBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return errorResponse(
        "INVALID_BODY",
        "请求体字段非法(仅允许 baseRev/ops/title/deps/writerTag,title≤200,writerTag 必填且合法)"
      );
    }
    const { baseRev, deps: reqDeps, writerTag } = parsedBody.data;

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
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
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
        writerTag,
        storedWriter: {
          writerTag: row.writer_tag,
          writerHeartbeatAt: row.writer_heartbeat_at,
        },
        nowIso,
        nowMs,
      });

      if (decision.kind === "reload") {
        return errorResponse(decision.code, decision.message, decision.details);
      }
      if (decision.kind === "locked") {
        return errorResponse("WRITER_LOCKED", decision.message, decision.details);
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
      const update: Record<string, unknown> = {
        doc: decision.doc,
        deps: decision.deps,
        rev: row.rev + 1,
        doc_bytes: decision.docBytes,
        updated_at: nowIso,
      };
      if (decision.title !== null) update.title = decision.title;
      // 活跃写者保存时顺带续租(写 writer_heartbeat_at=now),避免长时间保存流期间租约漂移。
      // writerTag 由 CanvasPatchWriteBodySchema 保证必填,故三谓词恒生效(P0 无 tag 写已在解析层拦下)。
      update.writer_heartbeat_at = nowIso;

      // 写者谓词与 rev CAS **同一原子 UPDATE**,单写者三谓词:
      //   writer_tag = :tag  AND  writer_heartbeat_at >= now-lease(仍活跃)  AND  rev = :baseRev。
      // heartbeat 下界与读门禁 authorizeWriterPatch 用同一 nowMs → 逐毫秒一致;过期或被接管同 tag
      // 命中 0 行,绝不让过期租约经 PATCH 顺手复活。WHERE 判旧行心跳,SET 再把心跳推进到 now(续租)。
      const { data: saved, error: saveError } = await db
        .from("canvases")
        .update(update as never)
        .eq("id", id)
        .eq("rev", row.rev)
        .eq("writer_tag", writerTag)
        .gte("writer_heartbeat_at", writerActiveSinceIso(nowMs, WRITER_LEASE_MS))
        .select("rev, updated_at")
        .maybeSingle();

      if (saveError) {
        console.error("[Canvas PATCH] update failed:", saveError);
        return errorResponse("INTERNAL", "画布保存失败");
      }
      if (!saved) {
        // CAS 落空:读→写之间他人已 bump rev,或(带 writerTag 时)写者锁被接管 / 本租约已过期。
        // 重读重试:下一轮 decidePatch 若 tag 已变或心跳过期返 WRITER_LOCKED,仅 rev 变则续 rebase
        //(锁冲突 WRITER_LOCKED 与 rev 冲突 REV_CONFLICT 严格可区分)。
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
