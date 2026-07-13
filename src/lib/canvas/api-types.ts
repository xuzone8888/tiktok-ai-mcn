/**
 * Super Canvas document API · stable wire contract (P0 / D3).
 *
 * The shell consumes ONLY the codes/types declared here. Every /api/canvas
 * response is either `{ success: true, data, warning? }` or
 * `{ success: false, code, error, details? }` — the `success` boolean keeps
 * parity with the existing studio routes, while `code` adds a machine-stable
 * discriminant the shell can branch on without string-matching Chinese copy.
 *
 * This module is pure types + tiny builders (no IO, no schema runtime imports),
 * so it is safe to import from both server routes and client code.
 */
import type { CanvasDeps, CanvasDocumentEnvelope, LoadCanvasResult } from "./schema";
import type { CanvasPatchConflict } from "./patch";

/** Machine-stable error discriminants. Never renumber/rename — the shell branches on these. */
export const CANVAS_API_ERROR_CODES = [
  "UNAUTHENTICATED", // 401 未登录
  "INVALID_ID", // 400 画布 id 非 UUID
  "INVALID_BODY", // 400 请求体非法(JSON 解析失败 / 顶层字段校验失败)
  "INVALID_OPS", // 400 补丁 op 数组 zod 校验失败
  "DOC_TOO_LARGE", // 400 doc 序列化 >2MB 硬闸
  "NOT_FOUND", // 404 画布不存在或非属主(RLS 命中 0 行)
  "REV_CONFLICT", // 409 CAS 竞争耗尽 / baseRev 越前 / 库内文档损坏,需整包重载
  "ENTITY_CONFLICT", // 409 重叠补丁(目标实体已变化),附可诊断冲突清单
  "WRITER_LOCKED", // 409 单写者锁被他标签/他设备持有(D5),写被拒;details.writer 供只读横幅
  "CANVAS_DOC_INVALID", // 422 应用后文档校验失败 / recoveryRequired / 危险值,绝不保存
  "INTERNAL", // 500 未预期错误
] as const;

export type CanvasApiErrorCode = (typeof CANVAS_API_ERROR_CODES)[number];

/** Canonical HTTP status per error code — the single source both routes call. */
export const CANVAS_API_ERROR_STATUS: Record<CanvasApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_ID: 400,
  INVALID_BODY: 400,
  INVALID_OPS: 400,
  DOC_TOO_LARGE: 400,
  NOT_FOUND: 404,
  REV_CONFLICT: 409,
  ENTITY_CONFLICT: 409,
  WRITER_LOCKED: 409,
  CANVAS_DOC_INVALID: 422,
  INTERNAL: 500,
};

export function httpStatusForCanvasError(code: CanvasApiErrorCode): number {
  return CANVAS_API_ERROR_STATUS[code] ?? 500;
}

/** Soft size-warning metadata (>512KB, still saved). Rendered by S7 as a banner. */
export interface CanvasSizeWarning {
  code: "DOC_SIZE_WARNING";
  bytes: number;
  warnLimit: number;
  hardLimit: number;
  message: string;
}

/**
 * STRICT, writable envelope + server rev/size. `doc` satisfies CanvasDocSchema
 * (referential integrity holds) — used for PATCH write / noop-rebased results whose doc
 * already passed validateCanvasDoc, i.e. the client may adopt and re-save it verbatim.
 */
export interface CanvasEnvelopeWithMeta extends CanvasDocumentEnvelope {
  rev: number;
  docBytes: number;
}

/**
 * TOLERANT loaded topology — same entity shapes as a strict doc, but `doc.edges` /
 * `doc.groups` MAY reference broken-node ids that D2's `loadCanvasDoc` deliberately keeps
 * (the broken nodes themselves live in `recovery.brokenNodes`, not in `doc.nodes`; see the
 * verify-canvas-schema assertions "指向安全坏节点占位符的连线保留" + broken group members).
 *
 * Use ONLY to hydrate a complete LoadCanvasResult / render placeholders. It is **NOT a
 * strict CanvasDoc and MUST NOT be written back** while `recovery.recoveryRequired` is true
 * — the shell must first cascade-remove each broken node's dangling edges + group
 * memberships (S3 `removeBrokenNode`) to turn it into a strict, writable doc. A healthy doc
 * (no broken entities) is coincidentally strict, but consumers must gate on recoveryRequired.
 */
export interface CanvasTolerantEnvelope {
  schemaVersion: number;
  doc: Pick<LoadCanvasResult, "nodes" | "edges" | "groups">;
  deps: CanvasDeps;
}

/** Tolerant loaded topology + server rev/size (GET metadata, error `latest`). */
export interface CanvasTolerantEnvelopeWithMeta extends CanvasTolerantEnvelope {
  rev: number;
  docBytes: number;
}

/** Structured, actionable detail attached to error responses. */
export interface CanvasApiErrorDetails {
  /** ENTITY_CONFLICT: per-op diagnostic list. */
  conflicts?: CanvasPatchConflict[];
  /** CANVAS_DOC_INVALID / REV_CONFLICT: human-readable validation notes. */
  issues?: string[];
  /** The server's current revision (so the client can decide whether to resync). */
  serverRev?: number;
  /** The authoritative latest topology (TOLERANT — may reference broken ids; gate on `recovery`) so the shell can rebase/reload without a second round-trip. */
  latest?: CanvasTolerantEnvelopeWithMeta;
  /** Broken-entity recovery payload — present when the stored doc needs recovery, so the client can render/repair placeholders instead of silently losing them. */
  recovery?: CanvasRecoveryReport;
  /** WRITER_LOCKED (D5): the current single-writer holder so S7 can render "someone else is editing". */
  writer?: CanvasWriterInfo;
  /** WRITER_LOCKED (D5): server lease/heartbeat budgets + clock so the client can reason about when it might take over. */
  leaseMs?: number;
  heartbeatMs?: number;
  serverNow?: string;
}

export interface CanvasApiSuccessBody<T> {
  success: true;
  data: T;
  warning?: CanvasSizeWarning;
}

export interface CanvasApiErrorBody {
  success: false;
  code: CanvasApiErrorCode;
  error: string;
  details?: CanvasApiErrorDetails;
}

export type CanvasApiResponse<T> = CanvasApiSuccessBody<T> | CanvasApiErrorBody;

/** POST /api/canvas → created row summary. */
export interface CanvasCreatedData {
  id: string;
  title: string;
  rev: number;
  schemaVersion: number;
  docBytes: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full tolerant-load recovery report (D2 `LoadCanvasResult` minus the clean topology
 * already carried by `envelope`). Reuses the D2 type verbatim so the store can hydrate
 * a COMPLETE `LoadCanvasResult` = `{ ...envelope.doc, schemaVersion, ...recovery }` and
 * render/delete broken placeholders — never silently dropping broken entities (裁决 5.2).
 */
export type CanvasRecoveryReport = Omit<
  LoadCanvasResult,
  "nodes" | "edges" | "groups" | "schemaVersion"
>;

/** Single-writer bookkeeping surfaced to the shell (D5 populates it; D3 just relays). */
export interface CanvasWriterInfo {
  tag: string | null;
  heartbeatAt: string | null;
}

/** Single-writer actions the shell may take over the lease (D5). */
export const CANVAS_WRITER_ACTIONS = ["claim", "heartbeat", "release"] as const;
export type CanvasWriterAction = (typeof CANVAS_WRITER_ACTIONS)[number];

/**
 * POST /api/canvas/[id]/writer success payload (D5). One shape for claim/heartbeat/release:
 * `holding` says whether the caller owns the lock after this action; `writer` is the
 * authoritative DB bookkeeping; `serverNow` lets the client reason about lease expiry
 * despite clock skew. A failed claim/heartbeat is a WRITER_LOCKED error, not this shape.
 */
export interface CanvasWriterLeaseData {
  action: CanvasWriterAction;
  holding: boolean;
  tag: string;
  writer: CanvasWriterInfo;
  leaseMs: number;
  heartbeatMs: number;
  serverNow: string;
}

/** GET /api/canvas/[id] → clean envelope + full recovery payload + metadata. */
export interface CanvasDocumentData {
  id: string;
  title: string;
  rev: number;
  schemaVersion: number;
  /** Tolerant loaded topology — may reference broken-node ids kept for placeholder display; NOT directly writable while `recovery.recoveryRequired`. */
  envelope: CanvasTolerantEnvelope;
  /** Broken entities + migration/issue state so the store hydrates a complete LoadCanvasResult. */
  recovery: CanvasRecoveryReport;
  docBytes: number;
  status: string;
  writer: CanvasWriterInfo;
  createdAt: string;
  updatedAt: string;
}

/** PATCH /api/canvas/[id] → save result. `envelope` is present iff `rebased`. */
export interface CanvasPatchResultData {
  id: string;
  rev: number;
  schemaVersion: number;
  docBytes: number;
  rebased: boolean;
  appliedOps: number;
  noopOps: number;
  persisted: boolean;
  updatedAt: string;
  /** Authoritative envelope, returned when the save rebased onto newer server state. */
  envelope?: CanvasEnvelopeWithMeta;
}

export function canvasApiSuccess<T>(data: T, warning?: CanvasSizeWarning): CanvasApiSuccessBody<T> {
  return warning ? { success: true, data, warning } : { success: true, data };
}

export function canvasApiError(
  code: CanvasApiErrorCode,
  error: string,
  details?: CanvasApiErrorDetails
): CanvasApiErrorBody {
  return details ? { success: false, code, error, details } : { success: false, code, error };
}
