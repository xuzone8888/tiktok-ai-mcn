import type { SupabaseClient } from "@supabase/supabase-js";

import { isOwnedObjectKey } from "@/lib/canvas/media-ownership";
import type { CanvasDoc } from "@/lib/canvas/schema";
import { createAdminClient } from "@/lib/supabase/admin";

export type CanvasMediaReadinessReason =
  | "MEDIA_NOT_OWNED"
  | "MEDIA_NOT_READY"
  | "CANVAS_REVISION_MISMATCH"
  | "INTERNAL";

export class CanvasMediaReadinessError extends Error {
  readonly reason: CanvasMediaReadinessReason;
  readonly rejectedCount: number;

  constructor(
    reason: CanvasMediaReadinessReason,
    message: string,
    rejectedCount = 0
  ) {
    super(message);
    this.name = "CanvasMediaReadinessError";
    this.reason = reason;
    this.rejectedCount = rejectedCount;
  }
}

interface ReadinessRejection {
  objectKey: string;
  reason: string;
}

interface ReadinessResult {
  ok: boolean;
  reason: string | null;
  rejected: ReadinessRejection[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseReadinessResult(value: unknown): ReadinessResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.ok !== "boolean" ||
    !(record.reason === null || typeof record.reason === "string") ||
    !Array.isArray(record.rejected)
  ) {
    return null;
  }
  const rejected: ReadinessRejection[] = [];
  for (const item of record.rejected) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.objectKey !== "string" ||
      typeof candidate.reason !== "string"
    ) {
      return null;
    }
    rejected.push({
      objectKey: candidate.objectKey,
      reason: candidate.reason,
    });
  }
  if (
    (record.ok && rejected.length > 0) ||
    (!record.ok &&
      record.reason !== "canvas_revision_mismatch" &&
      rejected.length === 0)
  ) {
    return null;
  }
  return { ok: record.ok, reason: record.reason, rejected };
}

function assertOwner(userId: string, keys: readonly string[]) {
  const rejected = keys.filter((key) => !isOwnedObjectKey(key, userId));
  if (rejected.length > 0) {
    throw new CanvasMediaReadinessError(
      "MEDIA_NOT_OWNED",
      "画布包含不属于当前账号的媒体对象",
      rejected.length
    );
  }
}

async function assertReadyViaRegistry(input: {
  userId: string;
  canvasId: string | null;
  baseRev: number | null;
  objectKeys: readonly string[];
}) {
  const objectKeys = unique(input.objectKeys);
  if (objectKeys.length === 0) return;
  if (objectKeys.length > 2_000) {
    throw new CanvasMediaReadinessError(
      "MEDIA_NOT_READY",
      "画布媒体对象数量超出允许范围",
      objectKeys.length
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc(
    "assert_canvas_media_keys_ready_v1",
    {
      p_user_id: input.userId,
      p_canvas_id: input.canvasId,
      p_base_rev: input.baseRev,
      p_object_keys: objectKeys,
    }
  );
  if (error) {
    console.error("[Canvas media readiness] RPC failed", { code: error.code });
    throw new CanvasMediaReadinessError(
      "INTERNAL",
      "媒体对象状态暂时无法确认"
    );
  }
  const result = parseReadinessResult(data);
  if (!result) {
    console.error("[Canvas media readiness] RPC returned invalid result");
    throw new CanvasMediaReadinessError(
      "INTERNAL",
      "媒体对象状态确认结果无效"
    );
  }
  if (result.ok) return;
  if (result.reason === "canvas_revision_mismatch") {
    throw new CanvasMediaReadinessError(
      "CANVAS_REVISION_MISMATCH",
      "画布版本已变化"
    );
  }
  const notOwned = result.rejected.filter(
    (item) => item.reason === "not_owned"
  ).length;
  throw new CanvasMediaReadinessError(
    notOwned > 0 ? "MEDIA_NOT_OWNED" : "MEDIA_NOT_READY",
    notOwned > 0
      ? "画布包含不属于当前账号的媒体对象"
      : "画布包含尚未完成服务端确认的上传对象",
    result.rejected.length
  );
}

function documentMediaKeys(doc: CanvasDoc) {
  const primary: string[] = [];
  const posters: string[] = [];
  for (const node of doc.nodes) {
    const media = node.data.media;
    if (!media) continue;
    primary.push(media.ossKey);
    if (media.posterKey) posters.push(media.posterKey);
  }
  return {
    primary: unique(primary),
    posters: unique(posters),
  };
}

/**
 * Persistence boundary for a validated Canvas document. All media keys must
 * be owner-scoped. Primary objects must be a ready direct upload, a completed
 * generation output, or an already-present legacy key at this exact revision.
 */
export async function assertCanvasDocumentMediaReady(input: {
  userId: string;
  canvasId: string | null;
  baseRev: number | null;
  doc: CanvasDoc;
}) {
  const keys = documentMediaKeys(input.doc);
  assertOwner(input.userId, [...keys.primary, ...keys.posters]);
  await assertReadyViaRegistry({
    userId: input.userId,
    canvasId: input.canvasId,
    baseRev: input.baseRev,
    objectKeys: keys.primary,
  });
}

/**
 * 生成输入**没有**「存量文档」那条豁免:这里传 `canvasId: null / baseRev: null`,
 * 于是 RPC 里的 `v_existing_keys` 恒为空数组,那条分支对生成输入永远不可达。
 * 也就是说文档里能存下的老 key,不等于能拿来当付费生成的输入。
 *
 * ⚠️ 但从 20260810 起,「历史面板给得出的素材」(自己的蓝图引用的 key、
 * 自己已完成生成的 URL 列换算出的 key)对**两条通道一视同仁**地放行 ——
 * 这是有意的:#23「从历史记录选一张图」建出来的就是上游节点,
 * 若它能进文档却不能当生成输入,用户会在点生成时撞第二种错。
 * 代价是这类 key 未经服务端 HEAD 证实对象真实存在,可能走到扣费后才由厂商侧失败退款。
 * 详见该迁移文件抬头。
 */
export async function assertCanvasInputKeysReady(input: {
  userId: string;
  objectKeys: readonly string[];
}) {
  assertOwner(input.userId, input.objectKeys);
  await assertReadyViaRegistry({
    userId: input.userId,
    canvasId: null,
    baseRev: null,
    objectKeys: input.objectKeys,
  });
}
