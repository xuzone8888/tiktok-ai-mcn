import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  canvasApiError,
  canvasApiSuccess,
  httpStatusForCanvasError,
  type CanvasApiErrorCode,
  type CanvasApiErrorDetails,
  type CanvasWriterLeaseData,
} from "@/lib/canvas/api-types";
import {
  buildWriterLeaseData,
  CanvasWriterRequestSchema,
  CANVAS_UUID_RE,
  writerLockedDetails,
} from "@/lib/canvas/api-helpers";
import {
  classifyWriterFailure,
  WRITER_LEASE_MS,
  writerLeaseCutoffIso,
  type StoredWriterState,
} from "@/lib/canvas/writer-lock";

export const dynamic = "force-dynamic";

/**
 * 超级画布 · 单写者锁租约(P0 · D5)
 *
 * POST /api/canvas/[id]/writer  body: { writerTag, action: "claim" | "heartbeat" | "release" }
 *   → { success, data: CanvasWriterLeaseData }  或  { success:false, code:"WRITER_LOCKED", details }
 *
 * 复用 canvases 行两列(writer_tag / writer_heartbeat_at,20260714 迁移),**零平行事件表**;
 * cookie 用户 client + RLS own,**绝不 service-role**,跨用户/不存在都表现为 0 行 → NOT_FOUND(不泄露)。
 *
 * - claim:**单条原子** UPDATE,谓词 `writer_tag IS NULL OR writer_tag = :tag OR writer_heartbeat_at < now-30s`
 *   (PostgREST `.or()`;cutoff 秒精度可安全内插);1 行=领到(writer),0 行→重读区分 NOT_FOUND / WRITER_LOCKED。
 * - heartbeat / release:谓词 `writer_tag = :tag`(**只能同 tag**)。heartbeat 0 行=丢租约→WRITER_LOCKED;
 *   release 0 行=已非持有者→幂等成功(holding=false),便于卸载信标盲发。
 * - schema_version / rev / doc 一律不动;仅摸两列写者列。canvases 未进 database.ts,沿用 untyped client 断言。
 */

type RouteParams = { params: Promise<{ id: string }> };
type WriterRow = { writer_tag: string | null; writer_heartbeat_at: string | null };
const WRITER_COLS = "writer_tag, writer_heartbeat_at";

function errorResponse(
  code: CanvasApiErrorCode,
  message: string,
  details?: CanvasApiErrorDetails
) {
  return NextResponse.json(canvasApiError(code, message, details), {
    status: httpStatusForCanvasError(code),
  });
}

function successResponse(data: CanvasWriterLeaseData) {
  return NextResponse.json(canvasApiSuccess(data));
}

function rowToStored(row: WriterRow | null | undefined): StoredWriterState {
  return {
    writerTag: row?.writer_tag ?? null,
    writerHeartbeatAt: row?.writer_heartbeat_at ?? null,
  };
}

type WriterGate =
  | { ok: true; db: SupabaseClient; id: string }
  | { ok: false; response: NextResponse };

async function requireUserAndId(params: RouteParams["params"]): Promise<WriterGate> {
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

/** 条件 UPDATE 落 0 行后重读区分 NOT_FOUND / WRITER_LOCKED;读失败 → INTERNAL。 */
async function classifyMiss(
  db: SupabaseClient,
  id: string
): Promise<
  | { kind: "not_found" }
  | { kind: "locked"; stored: StoredWriterState }
  | { kind: "error" }
> {
  const { data, error } = await db
    .from("canvases")
    .select(WRITER_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[Canvas writer] reread failed:", error);
    return { kind: "error" };
  }
  const row = (data ?? null) as WriterRow | null;
  if (classifyWriterFailure(row ? rowToStored(row) : null) === "not_found") {
    return { kind: "not_found" };
  }
  return { kind: "locked", stored: rowToStored(row) };
}

function lockedResponse(stored: StoredWriterState, serverNowIso: string) {
  return errorResponse(
    "WRITER_LOCKED",
    "画布正被另一个标签/设备编辑(单写者锁),已进入只读",
    writerLockedDetails(
      { tag: stored.writerTag, heartbeatAt: stored.writerHeartbeatAt },
      serverNowIso
    )
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const parsed = CanvasWriterRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_BODY", "请求体字段非法(仅允许 writerTag/action)");
    }
    const { writerTag, action } = parsed.data;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (action === "claim") {
      const cutoff = writerLeaseCutoffIso(nowMs, WRITER_LEASE_MS);
      const { data, error } = await db
        .from("canvases")
        .update({ writer_tag: writerTag, writer_heartbeat_at: nowIso } as never)
        .eq("id", id)
        .or(`writer_tag.is.null,writer_tag.eq.${writerTag},writer_heartbeat_at.lt.${cutoff}`)
        .select(WRITER_COLS)
        .maybeSingle();
      if (error) {
        console.error("[Canvas writer] claim failed:", error);
        return errorResponse("INTERNAL", "写者锁领取失败");
      }
      if (data) {
        return successResponse(
          buildWriterLeaseData("claim", true, writerTag, rowToStored(data as WriterRow), nowIso)
        );
      }
      const miss = await classifyMiss(db, id);
      if (miss.kind === "error") return errorResponse("INTERNAL", "写者锁领取失败");
      if (miss.kind === "not_found") return errorResponse("NOT_FOUND", "画布不存在");
      return lockedResponse(miss.stored, nowIso);
    }

    if (action === "heartbeat") {
      const { data, error } = await db
        .from("canvases")
        .update({ writer_heartbeat_at: nowIso } as never)
        .eq("id", id)
        .eq("writer_tag", writerTag)
        .select(WRITER_COLS)
        .maybeSingle();
      if (error) {
        console.error("[Canvas writer] heartbeat failed:", error);
        return errorResponse("INTERNAL", "写者心跳失败");
      }
      if (data) {
        return successResponse(
          buildWriterLeaseData("heartbeat", true, writerTag, rowToStored(data as WriterRow), nowIso)
        );
      }
      const miss = await classifyMiss(db, id);
      if (miss.kind === "error") return errorResponse("INTERNAL", "写者心跳失败");
      if (miss.kind === "not_found") return errorResponse("NOT_FOUND", "画布不存在");
      return lockedResponse(miss.stored, nowIso); // 丢租约(被接管)→ 只读
    }

    // action === "release"(尽力而为幂等:非持有者也回 200 holding=false)
    const { data, error } = await db
      .from("canvases")
      .update({ writer_tag: null, writer_heartbeat_at: null } as never)
      .eq("id", id)
      .eq("writer_tag", writerTag)
      .select(WRITER_COLS)
      .maybeSingle();
    if (error) {
      console.error("[Canvas writer] release failed:", error);
      return errorResponse("INTERNAL", "写者锁释放失败");
    }
    if (data) {
      return successResponse(
        buildWriterLeaseData("release", false, writerTag, rowToStored(data as WriterRow), nowIso)
      );
    }
    const miss = await classifyMiss(db, id);
    if (miss.kind === "error") return errorResponse("INTERNAL", "写者锁释放失败");
    if (miss.kind === "not_found") return errorResponse("NOT_FOUND", "画布不存在");
    // 行在但 tag 不符:已被他人接管,本次释放视为幂等 no-op(不清他人锁),回当前持有者态。
    return successResponse(
      buildWriterLeaseData("release", false, writerTag, miss.stored, nowIso)
    );
  } catch (error) {
    console.error("[Canvas writer] error:", error);
    return errorResponse("INTERNAL", "写者锁操作失败");
  }
}
