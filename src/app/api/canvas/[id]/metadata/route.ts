import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CANVAS_UUID_RE } from "@/lib/canvas/api-helpers";
import {
  canvasApiError,
  canvasApiSuccess,
  httpStatusForCanvasError,
  type CanvasApiErrorCode,
  type CanvasApiErrorDetails,
  type CanvasProjectDeleteData,
  type CanvasProjectSummary,
} from "@/lib/canvas/api-types";
import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

interface CanvasMetadataRow {
  id: string;
  title: string;
  rev: number;
  doc_bytes: number | null;
  created_at: string;
  updated_at: string;
}

interface CanvasDeleteRpcRow {
  outcome: unknown;
  deleted_canvas_id: unknown;
  active_generation_count: unknown;
}

type MetadataGate =
  | { ok: true; db: SupabaseClient; id: string; userId: string }
  | { ok: false; response: NextResponse };

const METADATA_COLUMNS = "id, title, rev, doc_bytes, created_at, updated_at";
const METADATA_CAS_MAX_ATTEMPTS = 5;
const CANVAS_TITLE_MAX_LENGTH = 200;
const CANVAS_TITLE_CONTROL_RE = /[\u0000-\u001f\u007f]/;

const CanvasMetadataPatchSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, "title 不能为空")
    .max(CANVAS_TITLE_MAX_LENGTH, `title 不能超过 ${CANVAS_TITLE_MAX_LENGTH} 个字符`)
    .refine((value) => !CANVAS_TITLE_CONTROL_RE.test(value), "title 不能包含控制字符"),
});

function errorResponse(
  code: CanvasApiErrorCode,
  message: string,
  details?: CanvasApiErrorDetails
) {
  return NextResponse.json(canvasApiError(code, message, details), {
    status: httpStatusForCanvasError(code),
  });
}

async function requireOwner(
  params: RouteParams["params"]
): Promise<MetadataGate> {
  const { id: rawId } = await params;
  if (!CANVAS_UUID_RE.test(rawId)) {
    return {
      ok: false,
      response: errorResponse("INVALID_ID", "画布 ID 非法"),
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (
    claimsError ||
    typeof userId !== "string" ||
    !CANVAS_UUID_RE.test(userId)
  ) {
    return {
      ok: false,
      response: errorResponse("UNAUTHENTICATED", "请先登录"),
    };
  }
  const email = claimsData?.claims?.email;
  if (
    !canAccessSuperCanvas({
      id: userId,
      email: typeof email === "string" ? email : null,
    })
  ) {
    return {
      ok: false,
      response: errorResponse(
        "CANVAS_NOT_ENABLED",
        "超级画布尚未对当前账号开放"
      ),
    };
  }

  return {
    ok: true,
    db: supabase as unknown as SupabaseClient,
    id: rawId.toLowerCase(),
    userId: userId.toLowerCase(),
  };
}

function toProjectSummary(
  value: CanvasMetadataRow
): CanvasProjectSummary | null {
  if (
    !CANVAS_UUID_RE.test(value.id) ||
    typeof value.title !== "string" ||
    !Number.isSafeInteger(value.rev) ||
    value.rev < 0 ||
    !(
      value.doc_bytes === null ||
      (Number.isSafeInteger(value.doc_bytes) && value.doc_bytes >= 0)
    ) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    title: value.title,
    rev: value.rev,
    docBytes: value.doc_bytes,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function parseActiveGenerationCount(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Rename one owned Canvas without touching the document revision. Canvas
 * generation fences and Runtime persistence both treat `rev` as the topology
 * version, so metadata-only writes must never advance it.
 *
 * Title + updated_at form a metadata CAS. A concurrent autosave or rename
 * causes a retry; among competing renames the last successful retry wins.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const gate = await requireOwner(params);
    if (!gate.ok) return gate.response;
    const { db, id, userId } = gate;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_BODY", "请求体不是合法 JSON");
    }

    const parsed = CanvasMetadataPatchSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_BODY", "画布标题不合法", {
        issues: parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "(root)"}: ${issue.message}`
          )
          .slice(0, 20),
      });
    }
    const { title } = parsed.data;

    for (
      let attempt = 0;
      attempt < METADATA_CAS_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const { data, error } = await db
        .from("canvases")
        .select(METADATA_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("[Canvas metadata PATCH] read failed:", error);
        return errorResponse("INTERNAL", "画布标题读取失败");
      }
      if (!data) return errorResponse("NOT_FOUND", "画布不存在");

      const row = data as unknown as CanvasMetadataRow;
      const current = toProjectSummary(row);
      if (!current || current.id !== id) {
        console.error("[Canvas metadata PATCH] invalid row metadata");
        return errorResponse("INTERNAL", "画布元数据校验失败");
      }
      if (current.title === title) {
        return NextResponse.json(canvasApiSuccess(current));
      }

      const nowIso = new Date().toISOString();
      const { data: saved, error: saveError } = await db
        .from("canvases")
        .update({
          title,
          updated_at: nowIso,
        } as never)
        .eq("id", id)
        .eq("user_id", userId)
        .eq("title", current.title)
        .eq("updated_at", current.updatedAt)
        .select(METADATA_COLUMNS)
        .maybeSingle();

      if (saveError) {
        console.error("[Canvas metadata PATCH] update failed:", saveError);
        return errorResponse("INTERNAL", "画布重命名失败");
      }
      if (!saved) continue;

      const updated = toProjectSummary(
        saved as unknown as CanvasMetadataRow
      );
      if (
        !updated ||
        updated.id !== id ||
        updated.title !== title ||
        updated.rev !== current.rev
      ) {
        console.error("[Canvas metadata PATCH] invalid update result");
        return errorResponse("INTERNAL", "画布重命名结果校验失败");
      }
      return NextResponse.json(canvasApiSuccess(updated));
    }

    return errorResponse(
      "REV_CONFLICT",
      "画布正在被频繁更新，请稍后重试重命名"
    );
  } catch (error) {
    console.error("[Canvas metadata PATCH] error:", error);
    return errorResponse("INTERNAL", "画布重命名失败");
  }
}

/**
 * Permanently delete one owned Canvas through the database's atomic
 * lock/check/delete function. Active generations are a hard 409 conflict.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
) {
  try {
    const gate = await requireOwner(params);
    if (!gate.ok) return gate.response;
    const { db, id } = gate;

    const { data, error } = await db.rpc(
      "delete_canvas_project_v1" as never,
      { p_canvas_id: id } as never
    );
    if (error) {
      console.error("[Canvas metadata DELETE] RPC failed:", error);
      return errorResponse("INTERNAL", "画布删除失败");
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      console.error("[Canvas metadata DELETE] invalid RPC row count");
      return errorResponse("INTERNAL", "画布删除结果校验失败");
    }

    const row = rows[0] as unknown as CanvasDeleteRpcRow;
    const activeCount = parseActiveGenerationCount(
      row.active_generation_count
    );
    if (activeCount === null) {
      console.error("[Canvas metadata DELETE] invalid active count");
      return errorResponse("INTERNAL", "画布删除结果校验失败");
    }

    if (row.outcome === "not_found") {
      return errorResponse("NOT_FOUND", "画布不存在");
    }
    if (row.outcome === "active_generations") {
      return errorResponse(
        "ENTITY_CONFLICT",
        `画布仍有 ${activeCount} 个生成任务正在运行，请等待完成后再删除`,
        { activeGenerations: activeCount }
      );
    }
    if (
      row.outcome !== "deleted" ||
      row.deleted_canvas_id !== id ||
      activeCount !== 0
    ) {
      console.error("[Canvas metadata DELETE] unexpected RPC outcome");
      return errorResponse("INTERNAL", "画布删除结果校验失败");
    }

    const payload: CanvasProjectDeleteData = { id, deleted: true };
    return NextResponse.json(canvasApiSuccess(payload));
  } catch (error) {
    console.error("[Canvas metadata DELETE] error:", error);
    return errorResponse("INTERNAL", "画布删除失败");
  }
}
