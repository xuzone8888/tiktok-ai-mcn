import type { CanvasApiErrorBody, CanvasApiErrorCode, CanvasSizeWarning } from "./api-types";
import { CANVAS_API_ERROR_CODES } from "./api-types";
import { CANVAS_UUID_RE } from "./api-helpers";
import { checkDocSize } from "./doc-limits";
import { CanvasOpsArraySchema, type CanvasOp } from "./patch";
import {
  CanvasDepsSchema,
  validateCanvasDoc,
  type BrokenCanvasEdge,
  type BrokenCanvasNode,
  type CanvasDeps,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
} from "./schema";
import { isWriterTag } from "./writer-lock";

export type CanvasSaveClientCode =
  | CanvasApiErrorCode
  | "NOT_HYDRATED"
  | "NO_ACTIVE_WRITER"
  | "CANVAS_IDENTITY_MISMATCH";

export interface CanvasSaveStateView {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  brokenNodes: BrokenCanvasNode[];
  brokenEdges: BrokenCanvasEdge[];
  hydrated: boolean;
  sessionCanvasId: string | null;
  hydratedCanvasId: string | null;
  migrationComplete: boolean;
  recoveryRequired: boolean;
  readOnly: boolean;
}

export interface CanvasPatchPreparationInput {
  baseRev: number;
  ops: CanvasOp[];
  title?: string;
  deps?: CanvasDeps;
}

export interface CanvasSaveFeedback {
  code: CanvasSaveClientCode;
  title: string;
  description: string;
}

export type CanvasSavePreparation =
  | {
      ok: true;
      request: { url: string; init: RequestInit };
      warning: CanvasSizeWarning | null;
    }
  | { ok: false; error: CanvasSaveFeedback };

export interface CanvasWriterIdentity {
  canvasId: string;
  writerTag: string;
}

type WriterOwner = object;
type FeedbackListener = (feedback: CanvasSaveFeedback) => void;

function feedback(
  code: CanvasSaveClientCode,
  description?: string
): CanvasSaveFeedback {
  if (code === "DOC_TOO_LARGE") {
    return {
      code,
      title: "画布超过保存上限",
      description: description || "画布文档已超过 2MB,请拆分后再保存。",
    };
  }
  if (code === "CANVAS_DOC_INVALID") {
    return {
      code,
      title: "画布需要恢复",
      description: description || "请先处理损坏内容或迁移问题,当前不会保存。",
    };
  }
  if (code === "WRITER_LOCKED") {
    return {
      code,
      title: "画布当前只读",
      description: description || "仅持有活动写者锁的标签页可以保存。",
    };
  }
  if (code === "NO_ACTIVE_WRITER") {
    return {
      code,
      title: "尚未连接持久化画布",
      description: description || "等待真实画布加载入口提供 canvasId 与写者租约。",
    };
  }
  if (code === "NOT_HYDRATED") {
    return {
      code,
      title: "画布尚未加载",
      description: description || "文档加载完成前不会准备提交。",
    };
  }
  if (code === "CANVAS_IDENTITY_MISMATCH") {
    return {
      code,
      title: "画布会话已切换",
      description: description || "当前文档与活动写者不属于同一画布,已阻止提交。",
    };
  }
  return {
    code,
    title: "画布提交未执行",
    description: description || "请求元数据未通过客户端预检。",
  };
}

export function mapCanvasApiErrorToSaveFeedback(
  body: CanvasApiErrorBody
): CanvasSaveFeedback {
  return feedback(body.code, body.error);
}

function snapshotCanvasApiErrorBody(value: unknown): CanvasApiErrorBody | null {
  if (!value || typeof value !== "object") return null;
  try {
    const success = Object.getOwnPropertyDescriptor(value, "success");
    const code = Object.getOwnPropertyDescriptor(value, "code");
    const error = Object.getOwnPropertyDescriptor(value, "error");
    if (
      !success ||
      !("value" in success) ||
      !code ||
      !("value" in code) ||
      !error ||
      !("value" in error) ||
      success.value !== false ||
      typeof code.value !== "string" ||
      !(CANVAS_API_ERROR_CODES as readonly string[]).includes(code.value) ||
      typeof error.value !== "string"
    ) {
      return null;
    }
    return { success: false, code: code.value as CanvasApiErrorCode, error: error.value };
  } catch {
    return null;
  }
}

interface CanvasPatchInputSnapshot {
  baseRev: unknown;
  ops: unknown;
  title: unknown;
  deps: unknown;
}

function snapshotPatchInput(input: unknown): CanvasPatchInputSnapshot | null {
  if (!input || typeof input !== "object") return null;
  try {
    const baseRev = Object.getOwnPropertyDescriptor(input, "baseRev");
    const ops = Object.getOwnPropertyDescriptor(input, "ops");
    const title = Object.getOwnPropertyDescriptor(input, "title");
    const deps = Object.getOwnPropertyDescriptor(input, "deps");
    if (!baseRev || !("value" in baseRev) || !ops || !("value" in ops)) return null;
    if (title && !("value" in title)) return null;
    if (deps && !("value" in deps)) return null;
    return {
      baseRev: baseRev.value,
      ops: ops.value,
      title: title && "value" in title ? title.value : undefined,
      deps: deps && "value" in deps ? deps.value : undefined,
    };
  } catch {
    return null;
  }
}

function snapshotSaveIdentity(
  state: unknown
): { sessionCanvasId: string | null; hydratedCanvasId: string | null } | null {
  if (!state || typeof state !== "object") return null;
  try {
    const session = Object.getOwnPropertyDescriptor(state, "sessionCanvasId");
    const hydrated = Object.getOwnPropertyDescriptor(state, "hydratedCanvasId");
    if (!session || !("value" in session) || !hydrated || !("value" in hydrated)) return null;
    const sessionCanvasId = session.value;
    const hydratedCanvasId = hydrated.value;
    if (
      (sessionCanvasId !== null && typeof sessionCanvasId !== "string") ||
      (hydratedCanvasId !== null && typeof hydratedCanvasId !== "string")
    ) {
      return null;
    }
    return { sessionCanvasId, hydratedCanvasId };
  } catch {
    return null;
  }
}

export function guardCanvasSaveState(
  state: CanvasSaveStateView
):
  | { ok: true; doc: { nodes: CanvasNode[]; edges: CanvasEdge[]; groups: CanvasGroup[] } }
  | { ok: false; error: CanvasSaveFeedback } {
  try {
    if (!state.hydrated) return { ok: false, error: feedback("NOT_HYDRATED") };
    if (
      state.recoveryRequired ||
      !state.migrationComplete ||
      state.brokenNodes.length > 0 ||
      state.brokenEdges.length > 0
    ) {
      return { ok: false, error: feedback("CANVAS_DOC_INVALID") };
    }
    if (state.readOnly) return { ok: false, error: feedback("WRITER_LOCKED") };

    const validation = validateCanvasDoc({
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
    });
    if (!validation.ok || !validation.data) {
      return {
        ok: false,
        error: feedback("CANVAS_DOC_INVALID", "当前文档未通过完整性校验,已阻止保存。"),
      };
    }
    return { ok: true, doc: validation.data };
  } catch {
    return {
      ok: false,
      error: feedback("CANVAS_DOC_INVALID", "读取画布状态失败,已阻止保存。"),
    };
  }
}

export class CanvasSaveAdapter {
  private writer: CanvasWriterIdentity | null = null;
  private writerOwner: WriterOwner | null = null;
  private readonly listeners = new Set<FeedbackListener>();

  beginWriterSession(owner: WriterOwner): void {
    this.writerOwner = owner;
    this.writer = null;
  }

  activateWriter(owner: WriterOwner, identity: CanvasWriterIdentity): boolean {
    if (!CANVAS_UUID_RE.test(identity.canvasId) || !isWriterTag(identity.writerTag)) return false;
    if (this.writerOwner !== owner) return false;
    this.writer = { ...identity };
    return true;
  }

  deactivateWriter(owner: WriterOwner): void {
    if (this.writerOwner === owner) this.writer = null;
  }

  clearWriter(owner: WriterOwner): void {
    if (this.writerOwner !== owner) return;
    this.writerOwner = null;
    this.writer = null;
  }

  getActiveWriter(): CanvasWriterIdentity | null {
    return this.writer ? { ...this.writer } : null;
  }

  subscribe(listener: FeedbackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyApiError(body: unknown): CanvasSaveFeedback | null {
    const snapshot = snapshotCanvasApiErrorBody(body);
    if (!snapshot) return null;
    const value = mapCanvasApiErrorToSaveFeedback(snapshot);
    this.emit(value);
    return value;
  }

  preparePatch(
    state: CanvasSaveStateView,
    input: CanvasPatchPreparationInput
  ): CanvasSavePreparation {
    try {
      const patchInput = snapshotPatchInput(input);
      if (!patchInput) {
        return this.reject(feedback("INVALID_BODY", "补丁输入读取失败,未构造保存请求。"));
      }
      const guard = guardCanvasSaveState(state);
      if (!guard.ok) return this.reject(guard.error);

      const writer = this.getActiveWriter();
      if (!writer) return this.reject(feedback("NO_ACTIVE_WRITER"));
      const identity = snapshotSaveIdentity(state);
      if (
        !identity ||
        identity.sessionCanvasId !== writer.canvasId ||
        identity.hydratedCanvasId !== writer.canvasId
      ) {
        return this.reject(feedback("CANVAS_IDENTITY_MISMATCH"));
      }
      const size = checkDocSize(guard.doc);
      if (size.overHardLimit) {
        return this.reject(feedback("DOC_TOO_LARGE", size.message ?? undefined));
      }
      if (!Number.isSafeInteger(patchInput.baseRev) || (patchInput.baseRev as number) < 0) {
        return this.reject(feedback("INVALID_BODY", "baseRev 非法,未构造保存请求。"));
      }

      let parsedOps;
      try {
        parsedOps = CanvasOpsArraySchema.safeParse(patchInput.ops);
      } catch {
        parsedOps = { success: false } as const;
      }
      if (!parsedOps.success) {
        return this.reject(feedback("INVALID_OPS", "补丁结构非法,未构造保存请求。"));
      }

      let deps: CanvasDeps | undefined;
      if (patchInput.deps !== undefined) {
        try {
          const parsedDeps = CanvasDepsSchema.safeParse(patchInput.deps);
          if (!parsedDeps.success) {
            return this.reject(feedback("INVALID_BODY", "依赖清单非法,未构造保存请求。"));
          }
          deps = parsedDeps.data;
        } catch {
          return this.reject(feedback("INVALID_BODY", "依赖清单读取失败,未构造保存请求。"));
        }
      }

      if (patchInput.title !== undefined && typeof patchInput.title !== "string") {
        return this.reject(feedback("INVALID_BODY", "title 非法,未构造保存请求。"));
      }
      const body = {
        baseRev: patchInput.baseRev,
        writerTag: writer.writerTag,
        ops: parsedOps.data,
        ...(patchInput.title !== undefined ? { title: patchInput.title } : {}),
        ...(deps !== undefined ? { deps } : {}),
      };

      let serialized: string;
      try {
        serialized = JSON.stringify(body);
      } catch {
        return this.reject(feedback("INVALID_BODY", "保存请求无法序列化。"));
      }

      const warning: CanvasSizeWarning | null = size.overWarnLimit
        ? {
            code: "DOC_SIZE_WARNING",
            bytes: size.bytes,
            warnLimit: size.warnLimit,
            hardLimit: size.hardLimit,
            message: size.message || "画布偏大,建议拆分。",
          }
        : null;

      return {
        ok: true,
        request: {
          url: `/api/canvas/${encodeURIComponent(writer.canvasId)}`,
          init: {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: serialized,
          },
        },
        warning,
      };
    } catch {
      return this.reject(feedback("INVALID_BODY", "保存预检读取失败,未构造保存请求。"));
    }
  }

  private reject(error: CanvasSaveFeedback): CanvasSavePreparation {
    this.emit(error);
    return { ok: false, error };
  }

  private emit(value: CanvasSaveFeedback): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        // UI feedback must not weaken the save guard.
      }
    }
  }
}

export const canvasSaveAdapter = new CanvasSaveAdapter();

/**
 * Stable transport handoff for a decoded PATCH error body. It only maps and emits feedback;
 * it never performs a request and is safe to call from a future transport implementation.
 */
export function consumeCanvasPatchResponse(body: unknown): CanvasSaveFeedback | null {
  return canvasSaveAdapter.notifyApiError(body);
}
