/**
 * 超级画布 · 画布状态 store(P0 · S1–S5)
 *
 * 房内惯例的单文件例外(技术负责人 R-d 批准):遵循 zustand 房内风格,但**严禁 persist 文档**。
 * 领域文档(nodes/edges/groups/schemaVersion)是唯一真相;React Flow 的视图字段一律经
 * src/lib/canvas/rf-adapter.ts 投影/回写,绝不进入本 store 的持久化域。
 *
 * 消费 D2 的 schema.ts:类型与 loadCanvasDoc 容错读取路径全部复用,零平行类型。
 * 关键不变量(技术负责人硬约束):loadCanvasDoc 返回 recoveryRequired=true 时必须阻断自动保存
 * (见 isCanvasAutosaveBlocked);broken 实体原样保留交给 S3 显式处理,S1 不渲染、不静默丢弃。
 *
 * S4 撤销/重做(硬契约):历史只存 forward/inverse 实体 op log(复用 D3 patch.ts + D2
 * validateCanvasDoc,见 lib/canvas/history.ts),**绝不**存整份 doc snapshot、绝不 persist、绝不碰
 * 生成任务。所有**结构性**用户文档变更走 applyDocWithHistory(**先屏障后构造**:先 endPositionDrag 结束
 * 进行中拖动、再 flush 待提交文本会话 → 取屏障后的 fresh doc → builder(current) 构造候选/跑 planner 合法性
 * → 严格 validateCanvasDoc 失败原子不动 → 单次 set 写入并入栈,新变更清空 redo,容量上限)。一段拖动经
 * beginPositionDrag/endPositionDrag 合并为**一个** entry;文本编辑经 editAnchor 会话合并(blur 提交为
 * 一个 entry,非每键入栈);load/reset/recovery/视图开关不进历史。成组/解组/复制/连接/批量删除为纯
 * 变换(lib/canvas/group-ops.ts)+ store 原子动作,严格维持 group.node_ids ↔ node.group_id 双向一致。
 *
 * 锚点最小化(硬契约):撤销/重做绝不存 doc 快照 —— 文本会话只锚**该 node 的原始深拷实体**
 * (editAnchor.base),拖动只锚**本次可能移动节点的原始深拷实体**(dragAnchor.bases,可序列化 entry
 * array,由 begin 传入 nodeIds);commit/end 时才与当前实体生成一对 node update op(经 applyPatch+validate,
 * 载荷深拷稳定)。
 * 任何 anchor 均**不含** CanvasDoc/nodes+edges+groups 全量快照。applyDocWithHistory 内的 getDoc() 仅为
 * **临时**求 diff(用后即弃),不存快照。
 */
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { z } from "zod";

import type { NodeChange } from "@xyflow/react";

import {
  CANVAS_SCHEMA_VERSION,
  CanvasNodeDataSchema,
  CanvasEdgeSchema,
  CanvasGroupSchema,
  CanvasIdSchema,
  CanvasNodeSchema,
  CanvasPositionSchema,
  createCanvasEdge,
  createCanvasNode,
  createEmptyCanvasDoc,
  inspectUnsafeCanvasValue,
  loadCanvasDoc,
  validateCanvasDoc,
  type BrokenCanvasEdge,
  type BrokenCanvasNode,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeDataUnsettableKey,
  type CreateCanvasNodeInput,
  type LoadCanvasResult,
} from "@/lib/canvas/schema";
import {
  collectNodePositionUpdates,
  type CanvasNodePositionUpdate,
} from "@/lib/canvas/rf-adapter";
import {
  applyOpsToDoc,
  CANVAS_HISTORY_LIMIT,
  cloneCanvasEntity,
  deepEqual,
  makeHistoryEntry,
  makeNodeUpdateEntry,
  type HistoryEntry,
} from "@/lib/canvas/history";
import {
  planDuplicate,
  planGroupNodes,
  planUngroupNodes,
  type DuplicateOptions,
} from "@/lib/canvas/group-ops";
import type {
  CanvasPatchPreparationInput,
  CanvasRepairPreparationInput,
  CanvasSavePreparation,
  CanvasSaveStateView,
} from "@/lib/canvas/canvas-save-adapter";
import { CANVAS_UUID_RE } from "@/lib/canvas/api-helpers";

/** 连线入参(与 React Flow Connection 兼容,但 store 不依赖 RF 类型)。 */
export interface CanvasConnection {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** 原子建「新节点 + 与已有节点的连线」入参(拉线到空白建节点用)。 */
export interface AddNodeAndEdgeInput {
  node: CreateCanvasNodeInput;
  fromNodeId: string;
  fromHandleId: string | null;
  /** 拉出的 handle 类型:source → 边为 源→新;target → 边为 新→源。 */
  fromHandleType: "source" | "target";
}

/** 待提交文本编辑会话(同一 node 的连续编辑合并成一个历史项)。锚=该 node 的原始深拷实体,非 doc。 */
export interface CanvasTextEditSession {
  nodeId: string;
  /** 会话起点(首个成功修改前)该 node 的**深拷实体**;commit 时与当前 node 生成一对 update op。 */
  base: CanvasNode;
}

/**
 * 拖动锚:仅本次可能移动节点的**原始深拷实体**条目。用**可序列化 entry array** 而非 Record<string,…> ——
 * 合法节点 id 如 "__proto__"/"constructor"/"prototype" 在普通对象上会被原型链吞掉/误落原型,entry array
 * 则与普通 id 完全同语义。按 doc 顺序收集;end 时对真正变化的节点逐条生成 update op,整段合并成一个历史项。非 doc。
 */
export interface CanvasDragAnchor {
  bases: Array<{ id: string; base: CanvasNode }>;
}

export interface CanvasStoreState {
  // ---- 领域文档(唯一真相;可持久化子集,但 S1 不接持久化) ----
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  schemaVersion: number;

  // ---- 装载 / 恢复(全部来自 schema.loadCanvasDoc,broken 交给 S3) ----
  brokenNodes: BrokenCanvasNode[];
  brokenEdges: BrokenCanvasEdge[];
  migratedFrom: number;
  migrationComplete: boolean;
  /** true 时禁止自动保存(D3 接线后消费),坏档/迁移未完成的护栏。 */
  recoveryRequired: boolean;
  loadIssues: string[];
  hydrated: boolean;
  /** Runtime session requested by CanvasRoot. null is the local, unpersisted canvas. */
  sessionCanvasId: string | null;
  /** Identity of the document currently held in nodes/edges/groups. */
  hydratedCanvasId: string | null;

  // ---- 会话态(单写者只读:D5 接线设置,S7 渲染横幅) ----
  readOnly: boolean;

  // ---- 撤销/重做(S4;运行态,永不持久化) ----
  /** 已发生的用户文档变更栈(每项=一对 forward/inverse op log)。 */
  past: HistoryEntry[];
  /** 被撤销、可重做的变更栈(新用户变更即清空)。 */
  future: HistoryEntry[];
  /** 待提交的文本编辑会话(blur/切 node/结构动作时合并入栈);无则 null。锚=最小实体,非 doc。 */
  editAnchor: CanvasTextEditSession | null;
  /** 一段拖动的最小实体锚(拖动中非 null);endPositionDrag 据此合并成一个 entry。非 doc 快照。 */
  dragAnchor: CanvasDragAnchor | null;

  // ---- 视图开关(短暂态,永不持久化、永不进领域文档) ----
  edgesHidden: boolean;
  snapToGrid: boolean;
  minimapCollapsed: boolean;
}

export interface CanvasStoreActions {
  /** Begin a runtime session, retaining only a preloaded document with the same identity. */
  beginCanvasSession: (canvasId: string | null) => boolean;
  /** 用 schema.loadCanvasDoc 的容错结果装载(SSR/测试可传预算结果)。 */
  hydrate: (result: LoadCanvasResult, canvasId?: string | null) => boolean;
  /** 便捷装载:内部走 loadCanvasDoc(永不抛错)。 */
  hydrateFromDoc: (
    rawDoc: unknown,
    fromVersionOrCanvasId?: number | string | null,
    canvasId?: string | null
  ) => boolean;
  /**
   * 仅在**尚未 hydrated** 时用空文档初始化(P0 无持久化时的兜底)。
   * 已 hydrated(D3/SSR/路由预加载已灌入服务端文档)则原样保留,绝不覆盖。
   */
  initializeEmptyDoc: () => boolean;
  /** Revalidate and atomically replace the current load state. Used by the error boundary recovery action. */
  recoverCurrentState: () => boolean;
  /** Explicitly accept a strictly valid recovered topology after damaged metadata was removed. */
  confirmSafeRecovery: () => boolean;
  /**
   * Prepare, but never send, the real D3 PATCH request. The single adapter enforces load/recovery/read-only,
   * document size, active writer identity, and request validation before exposing a RequestInit.
   */
  preparePatchSave: (input: CanvasPatchPreparationInput) => CanvasSavePreparation;
  /** Prepare the explicit full-document repair PUT after local recovery is complete. */
  prepareRepairSave: (input: CanvasRepairPreparationInput) => CanvasSavePreparation;
  /**
   * Runtime create-adoption(D-runtime):把**本地未持久化**且已 hydrated 的文档原子性地重挂到
   * 服务端持久化 id。**保留 doc 与历史**(不清 nodes/edges/groups/past/future),仅将 session /
   * hydrated 身份切到该 id 并转只读——直到 D5 写者租约就绪后由 setReadOnly 放开。
   * 绝不走 beginCanvasSession(newId)(那会清空 doc)。前置(descriptor-safe):hydrated 且当前身份
   * 恰为本地未持久化(sessionCanvasId===null && hydratedCanvasId===null);否则原子拒绝返回 false。
   */
  promoteLocalToPersisted: (canvasId: string) => boolean;
  /**
   * Runtime rebase-adoption(D-runtime):为**当前活动的持久化会话**原子采纳权威(rebased)文档。
   * 校验后替换 nodes/edges/groups 并清空历史(rebase 跳变使旧撤销栈失真);session/hydrated 身份与
   * 只读态保留。仅当身份严格匹配(sessionCanvasId===hydratedCanvasId===canvasId 且 hydrated)且
   * doc 通过 validateCanvasDoc 才写入,否则原子拒绝返回 false(fail-closed,绝不吞掉冲突)。
   */
  adoptAuthoritativeDoc: (canvasId: string, doc: CanvasDoc) => boolean;
  /**
   * 建节点(S2):经 D2 createCanvasNode 落库;只读时忽略。非法输入(如 media.ossKey 非
   * OSS object key)返回 null,不建半节点。成功返回节点 id 并入历史。
   */
  addNode: (input: CreateCanvasNodeInput) => string | null;
  /**
   * 连线(S2):经 canAddCanvasEdge 校验(禁自环/悬空端/重复)+ D2 createCanvasEdge 落库;
   * 只读或非法返回 null,成功返回 edge id 并入历史。
   */
  addEdge: (connection: CanvasConnection) => string | null;
  /**
   * 原子建「新节点 + 连线」(S2 拉线到空白建节点):同一次 set 前完整校验(只读 / 源节点仍在 /
   * 节点可建 / 连线合法),要么节点+边同时写入(一个历史项),要么都不写——不留孤儿节点。
   */
  addNodeAndEdge: (input: AddNodeAndEdgeInput) => { nodeId: string; edgeId: string } | null;
  /**
   * 更新节点 data(S3 文本编辑等):合并 patch 后经 CanvasNodeDataSchema 校验 + 危险值扫描
   * (拒 dataURL/签名 URL),通过才回写;只读/节点不存在/校验失败返回 false。成功则并入(或开启)
   * 该 node 的文本编辑会话——连续编辑合并、blur/结构动作时提交为一个历史项(非每键入栈)。
   *
   * `options.unset` 是**删键**通道,也是移除可选键(如清空 `media`)的**唯一**办法:合并是
   * `{...node.data, ...patch}` 浅展开,传 `key: undefined` 删不掉键,只会留下一个值为 undefined
   * 的 own 键 —— 而 `isPersistableJsonValue` 对这种键一律判否,于是 `cloneCanvasEntity` 返回 null、
   * 整次写入**静默失败**(2026-08-14 商品节点「移除商品图」全线不可用,根因就是这个)。
   * 刻意**不**把 `patch` 里的 undefined 当成删除:`params`/`generation` 有「absent-or-strict」的
   * fail-closed 守卫,把误传的 undefined 解释成「删掉计费意图」远比拒绝这次写入危险。
   */
  updateNodeData: (
    id: string,
    patch: Partial<CanvasNodeData>,
    options?: { unset?: readonly CanvasNodeDataUnsettableKey[] }
  ) => boolean;
  /**
   * 提交当前待提交的文本编辑会话(textarea blur 调用):把整段会话合并为一个 forward/inverse
   * 历史项(无净变化则只清会话不入栈)。清空 redo。
   */
  commitTextEdit: () => void;
  /**
   * 删除单个内容节点(S3):级联移除其 edges、从各 group.node_ids 移除,保持 group_id/group 一致;
   * 只读时忽略。二次确认 UI 由卡片承担。入历史。
   */
  removeNode: (id: string) => void;
  /**
   * 批量删除所选(S4 Delete):原子级联删除所选领域节点(连带其 edges)+ 所选独立 edges,并从各
   * group.node_ids 移除,清掉变空的组;只读时忽略。一次批量二确认(AlertDialog)后调用,入一个历史项。
   */
  removeEntities: (nodeIds: readonly string[], edgeIds?: readonly string[]) => void;
  /**
   * 删除损坏恢复实体(S3):同一次原子 set 从 brokenNodes 移除、级联清理 domain edges/groups 里指向它
   * 的引用,重算 recoveryRequired;**清空历史**(恢复动作不可撤销)。只读时忽略。绝不触碰领域 nodes。
  */
  removeBrokenNode: (id: string) => void;
  /** Explicit user-triggered cleanup for every isolated broken edge; ignored while read-only. */
  removeBrokenEdges: () => void;
  /** React Flow 节点变更回写:只取 position,其余视图变更丢弃;只读时忽略。历史由 begin/endPositionDrag 合并。 */
  applyNodePositionChanges: (changes: NodeChange[]) => void;
  /**
   * 批量写节点 position(S5 整理画布用):一次原子 set 只改 position,只读时忽略;
   * 绝不触碰 RF 视图字段或 viewport。入一个历史项。
   */
  applyNodePositions: (updates: CanvasNodePositionUpdate[]) => void;
  /** 成组(S4 Ctrl/Alt+G):把≥2 个未成组的合法领域节点收进新组,返回 group id;非法/只读返回 null。入历史。 */
  groupNodes: (nodeIds: readonly string[]) => string | null;
  /** 解组(S4 Ctrl/Alt+Shift+G):解散所选任一节点所属的全部组;有变更返回 true。只读返回 false。入历史。 */
  ungroupNodes: (nodeIds: readonly string[]) => boolean;
  /** 复制所选(S4 Ctrl+D / Alt|Ctrl+Alt 拖动):造新 id 副本(+可选内部连线),返回新节点 id;只读/空返回 null。入历史。 */
  duplicateNodes: (nodeIds: readonly string[], opts: DuplicateOptions) => string[] | null;
  /** 连接两点(S4 Ctrl+L):恰好两个所选领域节点由调用方保证;禁自环/悬空/重复。返回 edge id 或 null。入历史。 */
  connectNodes: (source: string, target: string) => string | null;
  /** 撤销(S4 Ctrl+Z):对当前 doc 应用上一步 inverse(applyPatch+validate 失败原子不动);只读/空栈/拖动中返回 false。 */
  undo: () => boolean;
  /** 重做(S4 Ctrl+Shift+Z):对当前 doc 应用下一步 forward;只读/空栈/拖动中返回 false。 */
  redo: () => boolean;
  /**
   * 拖动开始(S4):flush 待提交文本会话,并只对**传入的可能移动节点** id 记下原始深拷实体锚
   * (不存 doc 快照);合并整段拖动为一个历史项。只读/已在拖动中/无有效 id 时忽略。
   */
  beginPositionDrag: (nodeIds: readonly string[]) => void;
  /** 拖动结束(S4):对锚定节点里**真正变化**的生成 update op 合并成一个历史项(无移动不入栈);清 dragAnchor。 */
  endPositionDrag: () => void;
  setReadOnly: (readOnly: boolean) => void;
  setEdgesHidden: (hidden: boolean) => void;
  toggleEdgesHidden: () => void;
  setSnapToGrid: (enabled: boolean) => void;
  toggleSnapToGrid: () => void;
  setMinimapCollapsed: (collapsed: boolean) => void;
  toggleMinimapCollapsed: () => void;
  reset: () => void;
}

export type CanvasStore = CanvasStoreState & CanvasStoreActions;

type CanvasSavePreparer = (
  state: CanvasSaveStateView,
  input: CanvasPatchPreparationInput
) => CanvasSavePreparation;

type CanvasRepairPreparer = (
  state: CanvasSaveStateView,
  input: CanvasRepairPreparationInput
) => CanvasSavePreparation;

let canvasSavePreparer: CanvasSavePreparer | null = null;
let canvasRepairPreparer: CanvasRepairPreparer | null = null;

/** Root-owned runtime wiring keeps the store testable while preserving one save adapter. */
export function connectCanvasSavePreparer(preparer: CanvasSavePreparer): () => void {
  canvasSavePreparer = preparer;
  return () => {
    if (canvasSavePreparer === preparer) canvasSavePreparer = null;
  };
}

interface PreparedCanvasHydration {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  brokenNodes: BrokenCanvasNode[];
  brokenEdges: BrokenCanvasEdge[];
  schemaVersion: number;
  migratedFrom: number;
  migrationComplete: boolean;
  recoveryRequired: boolean;
  loadIssues: string[];
}

type DataFieldSnapshot = Record<string, unknown>;

function isCanvasSessionIdentity(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && CANVAS_UUID_RE.test(value));
}

export function connectCanvasRepairPreparer(preparer: CanvasRepairPreparer): () => void {
  canvasRepairPreparer = preparer;
  return () => {
    if (canvasRepairPreparer === preparer) canvasRepairPreparer = null;
  };
}

/** Reads each requested field exactly once through its own data descriptor. */
function snapshotDataFields(
  source: unknown,
  fields: readonly string[]
): DataFieldSnapshot | null {
  if (!source || typeof source !== "object") return null;
  const snapshot: DataFieldSnapshot = Object.create(null) as DataFieldSnapshot;
  try {
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(source, field);
      if (!descriptor || !("value" in descriptor)) return null;
      snapshot[field] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** Snapshots a dense ordinary array without invoking iteration or index accessors. */
function snapshotArrayEntries(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => typeof key === "symbol") ||
      !keys.includes("length")
    ) {
      return null;
    }

    const entries: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      entries.push(descriptor.value);
    }
    return entries;
  } catch {
    return null;
  }
}

function cloneAndParse<T>(value: unknown, schema: z.ZodType<T>): T | null {
  const detached = cloneCanvasEntity(value);
  if (detached === null) return null;
  try {
    const parsed = schema.safeParse(detached);
    if (!parsed.success) return null;
    return cloneCanvasEntity(parsed.data);
  } catch {
    return null;
  }
}

function prepareBrokenNodes(value: unknown): {
  entities: BrokenCanvasNode[];
  cloneIssues: string[];
} | null {
  const entries = snapshotArrayEntries(value);
  if (!entries) return null;
  const entities: BrokenCanvasNode[] = [];
  const cloneIssues: string[] = [];

  try {
    for (const candidate of entries) {
      const item = snapshotDataFields(candidate, [
        "id",
        "position",
        "group_id",
        "rawType",
        "issues",
        "raw",
      ]);
      if (!item) return null;

      const id = cloneAndParse(item.id, CanvasIdSchema);
      const issues = cloneAndParse(item.issues, z.array(z.string()));
      const position =
        item.position === null
          ? null
          : cloneAndParse(item.position, CanvasPositionSchema);
      const groupId =
        item.group_id === null
          ? null
          : cloneAndParse(item.group_id, CanvasIdSchema);
      const rawType = item.rawType === null ? null : cloneCanvasEntity(item.rawType);
      if (
        id === null ||
        issues === null ||
        (item.position !== null && position === null) ||
        (item.group_id !== null && groupId === null) ||
        (item.rawType !== null && rawType === null)
      ) {
        return null;
      }

      const rawValue = item.raw;
      const raw = cloneCanvasEntity(rawValue);
      if (rawValue !== null && raw === null) {
        issues.push("raw payload was not safely cloneable");
        cloneIssues.push(`broken node ${id}: raw payload omitted from runtime diagnostics`);
      }

      entities.push({
        id,
        position,
        group_id: groupId,
        rawType,
        issues,
        raw: raw ?? null,
      });
    }
  } catch {
    return null;
  }
  return { entities, cloneIssues };
}

function prepareBrokenEdges(value: unknown): {
  entities: BrokenCanvasEdge[];
  cloneIssues: string[];
} | null {
  const entries = snapshotArrayEntries(value);
  if (!entries) return null;
  const entities: BrokenCanvasEdge[] = [];
  const cloneIssues: string[] = [];

  try {
    for (const candidate of entries) {
      const item = snapshotDataFields(candidate, ["id", "issues", "raw"]);
      if (!item) return null;
      const id = cloneAndParse(item.id, CanvasIdSchema);
      const issues = cloneAndParse(item.issues, z.array(z.string()));
      if (id === null || issues === null) return null;
      const rawValue = item.raw;
      const raw = cloneCanvasEntity(rawValue);
      if (rawValue !== null && raw === null) {
        issues.push("raw payload was not safely cloneable");
        cloneIssues.push(`broken edge ${id}: raw payload omitted from runtime diagnostics`);
      }
      entities.push({ id, issues, raw: raw ?? null });
    }
  } catch {
    return null;
  }
  return { entities, cloneIssues };
}

/** Build a detached replacement before entering zustand/immer. Any exception returns null with zero writes. */
export function prepareCanvasHydration(result: LoadCanvasResult): PreparedCanvasHydration | null {
  try {
    const source = snapshotDataFields(result, [
      "nodes",
      "brokenNodes",
      "edges",
      "brokenEdges",
      "groups",
      "schemaVersion",
      "migratedFrom",
      "targetSchemaVersion",
      "migrationComplete",
      "recoveryRequired",
      "issues",
    ]);
    if (!source) return null;

    const nodes = cloneAndParse(source.nodes, z.array(CanvasNodeSchema));
    const edges = cloneAndParse(source.edges, z.array(CanvasEdgeSchema));
    const groups = cloneAndParse(source.groups, z.array(CanvasGroupSchema));
    const brokenNodes = prepareBrokenNodes(source.brokenNodes);
    const brokenEdges = prepareBrokenEdges(source.brokenEdges);
    const issues = cloneAndParse(source.issues, z.array(z.string()));
    if (!nodes || !edges || !groups || !brokenNodes || !brokenEdges || !issues) {
      return null;
    }
    if (!Number.isSafeInteger(source.schemaVersion) || (source.schemaVersion as number) < 1) {
      return null;
    }
    if (!Number.isSafeInteger(source.migratedFrom) || (source.migratedFrom as number) < 1) {
      return null;
    }
    if (
      !Number.isSafeInteger(source.targetSchemaVersion) ||
      (source.targetSchemaVersion as number) < 1
    ) {
      return null;
    }
    if (typeof source.migrationComplete !== "boolean") return null;
    if (typeof source.recoveryRequired !== "boolean") return null;

    const nodeIds = new Set(nodes.map((node) => node.id));
    if (nodeIds.size !== nodes.length) return null;
    const brokenNodeIds = new Set(brokenNodes.entities.map((node) => node.id));
    if (brokenNodeIds.size !== brokenNodes.entities.length) return null;
    const allNodeIds = new Set([...nodeIds, ...brokenNodeIds]);
    if (allNodeIds.size !== nodeIds.size + brokenNodeIds.size) return null;
    const edgeIds = new Set(edges.map((edge) => edge.id));
    if (edgeIds.size !== edges.length) return null;
    const brokenEdgeIds = new Set(brokenEdges.entities.map((edge) => edge.id));
    if (brokenEdgeIds.size !== brokenEdges.entities.length) return null;
    if (new Set([...edgeIds, ...brokenEdgeIds]).size !== edgeIds.size + brokenEdgeIds.size) {
      return null;
    }
    const groupIds = new Set(groups.map((group) => group.id));
    if (groupIds.size !== groups.length) return null;
    if (edges.some((edge) => !allNodeIds.has(edge.source) || !allNodeIds.has(edge.target))) {
      return null;
    }
    if (groups.some((group) => group.node_ids.some((id) => !allNodeIds.has(id)))) return null;

    // Broken nodes stay isolated from state.nodes, but their safe placeholder identities participate
    // in topology validation so recovery-only edge/group references cannot bypass graph invariants.
    const recoveryPlaceholders = brokenNodes.entities.map((node) =>
      createCanvasNode({
        id: node.id,
        type: "text",
        position: node.position ?? { x: 0, y: 0 },
        groupId: node.group_id,
      })
    );
    const strict = validateCanvasDoc({
      nodes: [...nodes, ...recoveryPlaceholders],
      edges,
      groups,
    });
    if (!strict.ok) return null;

    const recoveryRequired =
      source.recoveryRequired ||
      !source.migrationComplete ||
      brokenNodes.entities.length > 0 ||
      brokenEdges.entities.length > 0;

    return {
      nodes,
      edges,
      groups,
      brokenNodes: brokenNodes.entities,
      brokenEdges: brokenEdges.entities,
      schemaVersion: source.schemaVersion as number,
      migratedFrom: source.migratedFrom as number,
      migrationComplete: source.migrationComplete,
      recoveryRequired,
      loadIssues: [
        ...issues,
        ...brokenNodes.cloneIssues,
        ...brokenEdges.cloneIssues,
      ],
    };
  } catch {
    return null;
  }
}

function createInitialState(): CanvasStoreState {
  return {
    nodes: [],
    edges: [],
    groups: [],
    schemaVersion: CANVAS_SCHEMA_VERSION,
    brokenNodes: [],
    brokenEdges: [],
    migratedFrom: CANVAS_SCHEMA_VERSION,
    migrationComplete: true,
    recoveryRequired: false,
    loadIssues: [],
    hydrated: false,
    sessionCanvasId: null,
    hydratedCanvasId: null,
    readOnly: false,
    past: [],
    future: [],
    editAnchor: null,
    dragAnchor: null,
    edgesHidden: false,
    snapToGrid: true,
    // 1366×768 默认收起(CHECKLIST 条款);宽屏由 CanvasBoard 挂载时展开。
    minimapCollapsed: true,
  };
}

export const useCanvasStore = create<CanvasStore>()(
  devtools(
    immer((set, get) => {
      /** 当前领域 doc 的浅快照(引用已由 immer 冻结,仅供 diff/apply 只读)。 */
      const getDoc = (): CanvasDoc => {
        const state = get();
        return { nodes: state.nodes, edges: state.edges, groups: state.groups };
      };

      const canMutateCurrentDocument = (): boolean => {
        const state = get();
        return (
          !state.readOnly &&
          state.hydrated &&
          state.sessionCanvasId === state.hydratedCanvasId
        );
      };

      /** 危险 current 先克隆失败即视为有变化，绝不把循环/访问器直接交给 deepEqual。 */
      const nodeChangedOrUnsafe = (before: CanvasNode, after: CanvasNode | undefined): boolean => {
        if (after === undefined) return true;
        const safeAfter = cloneCanvasEntity(after);
        return safeAfter === null || !deepEqual(before, safeAfter);
      };

      /**
       * 提交待提交文本会话:把 会话起点→当前 的净变化合并成一个历史项(无净变化只清会话)。
       * 有净变化时清空 redo(它是一次新的用户变更)。供 blur/结构动作/undo/redo 前统一调用。
       */
      const flushTextSession = (): void => {
        const anchor = get().editAnchor;
        if (!anchor) return;
        const current = get().nodes.find((node) => node.id === anchor.nodeId);
        // 最小实体锚:该 node 的 原始→当前 合并成一个 node update op(无净变化则不入栈)。
        const entry = makeNodeUpdateEntry([{ before: anchor.base, after: current }]);
        // 防御路径:当前与 base 确有净变化、却因载荷不可深拷而 entry===null(makeNodeUpdateEntry 原子放弃)。
        // updateNodeData 的预检本应挡住此路,这里兜底:doc 里已有一个进不了历史、不可撤销的变更 → 回滚该
        // node 到会话起点 anchor.base 后清 anchor,绝不留「改了 doc 却无历史」。无净变化(entry===null 且
        // deepEqual)则正常只清 anchor。
        const needsRollback =
          entry === null && current !== undefined && nodeChangedOrUnsafe(anchor.base, current);
        set(
          (state) => {
            if (entry) {
              state.past.push(entry);
              if (state.past.length > CANVAS_HISTORY_LIMIT) state.past.shift();
              state.future = [];
            } else if (needsRollback) {
              const index = state.nodes.findIndex((node) => node.id === anchor.nodeId);
              if (index !== -1) state.nodes[index] = anchor.base;
            }
            state.editAnchor = null;
          },
          false,
          "canvas/commitTextEdit"
        );
      };

      /**
       * 结构性文档变更的唯一原子入口。**先屏障,后构造**:任何结构动作都必须先把进行中的交互 finalize,
       * 再基于「屏障后的 fresh doc」构造候选 —— 否则(1)拖动中删除会拿旧位置生成冲突历史;(2)flush 文本会话
       * 的防御回滚会改动 doc,而预先构造的 candidate 基于回滚前的脏 doc,diff 后要么冲突、要么静默取消动作。
       *
       * 因此本函数接收 **builder(currentDoc)=>CanvasDoc|null**(而非预构造 candidate):内部依次
       *   ① endPositionDrag(若拖动中)—— 合并已写位置为一个历史项(或 fail-closed 回滚);
       *   ② flushTextSession —— 提交/回滚待提交文本会话;
       *   ③ 取**屏障后的 fresh current**;④ 调 builder(planner/合法性检查须在此基于 fresh current);
       *   ⑤ validate;⑥ 与 fresh current diff 成一个历史项(无净变化/载荷不可克隆 → 不写);⑦ 单次 set 写入。
       * builder 返回 null(planner/合法性拒绝)→ 原子不动。返回是否真正写入。
       */
      const applyDocWithHistory = (
        name: string,
        build: (currentDoc: CanvasDoc) => CanvasDoc | null
      ): boolean => {
        // ①② 屏障:先结束进行中的拖动、再 flush 文本会话(顺序即历史顺序:交互 finalize 早于本结构动作)。
        if (get().dragAnchor !== null) get().endPositionDrag();
        flushTextSession();
        // ③ 屏障后的 fresh current —— candidate、diff 基线都取自它,绝不用屏障前的旧快照。
        const current = getDoc();
        const candidate = build(current);
        if (candidate === null) return false; // builder(planner/合法性)拒绝 → 原子不动
        const validated = validateCanvasDoc(candidate);
        if (!validated.ok || validated.data === null) return false;
        const entry = makeHistoryEntry(current, validated.data);
        if (!entry) return false;
        const next = validated.data;
        set(
          (state) => {
            state.nodes = next.nodes;
            state.edges = next.edges;
            state.groups = next.groups;
            state.past.push(entry);
            if (state.past.length > CANVAS_HISTORY_LIMIT) state.past.shift();
            state.future = [];
          },
          false,
          name
        );
        return true;
      };

      const commitHydration = (
        next: PreparedCanvasHydration,
        canvasId: string | null
      ): boolean => {
        try {
          set(
            (state) => {
              state.nodes = next.nodes;
              state.edges = next.edges;
              state.groups = next.groups;
              state.schemaVersion = next.schemaVersion;
              state.brokenNodes = next.brokenNodes;
              state.brokenEdges = next.brokenEdges;
              state.migratedFrom = next.migratedFrom;
              state.migrationComplete = next.migrationComplete;
              state.recoveryRequired = next.recoveryRequired;
              state.loadIssues = next.loadIssues;
              state.hydrated = true;
              state.hydratedCanvasId = canvasId;
              state.past = [];
              state.future = [];
              state.editAnchor = null;
              state.dragAnchor = null;
            },
            false,
            "canvas/hydrate"
          );
          return true;
        } catch {
          return false;
        }
      };

      return {
        ...createInitialState(),

        beginCanvasSession: (canvasId) => {
          if (!isCanvasSessionIdentity(canvasId)) return false;
          try {
            const current = snapshotDataFields(get(), [
              "sessionCanvasId",
              "hydratedCanvasId",
              "hydrated",
            ]);
            if (!current || !isCanvasSessionIdentity(current.sessionCanvasId)) return false;
            if (!isCanvasSessionIdentity(current.hydratedCanvasId)) return false;

            const documentMatches =
              current.hydrated === true && current.hydratedCanvasId === canvasId;
            const sessionMatches = current.sessionCanvasId === canvasId;
            if (sessionMatches && documentMatches) return true;

            set(
              (state) => {
                state.sessionCanvasId = canvasId;
                state.readOnly = canvasId !== null;
                state.past = [];
                state.future = [];
                state.editAnchor = null;
                state.dragAnchor = null;
                if (documentMatches) return;

                state.nodes = [];
                state.edges = [];
                state.groups = [];
                state.schemaVersion = CANVAS_SCHEMA_VERSION;
                state.brokenNodes = [];
                state.brokenEdges = [];
                state.migratedFrom = CANVAS_SCHEMA_VERSION;
                state.migrationComplete = true;
                state.recoveryRequired = false;
                state.loadIssues = [];
                state.hydrated = false;
                state.hydratedCanvasId = null;
              },
              false,
              "canvas/beginSession"
            );
            return true;
          } catch {
            return false;
          }
        },

        hydrate: (result, canvasId = null) => {
          if (!isCanvasSessionIdentity(canvasId)) return false;
          const next = prepareCanvasHydration(result);
          return next ? commitHydration(next, canvasId) : false;
        },

        hydrateFromDoc: (rawDoc, fromVersionOrCanvasId, canvasId = null) => {
          const resolvedCanvasId =
            typeof fromVersionOrCanvasId === "string" || fromVersionOrCanvasId === null
              ? fromVersionOrCanvasId
              : canvasId;
          const fromVersion =
            typeof fromVersionOrCanvasId === "number" ? fromVersionOrCanvasId : undefined;
          if (!isCanvasSessionIdentity(resolvedCanvasId)) return false;
          try {
            const result = loadCanvasDoc(rawDoc, fromVersion);
            const next = prepareCanvasHydration(result);
            return next ? commitHydration(next, resolvedCanvasId) : false;
          } catch {
            return false;
          }
        },

        initializeEmptyDoc: () => {
          try {
            const current = snapshotDataFields(get(), [
              "hydrated",
              "sessionCanvasId",
              "hydratedCanvasId",
            ]);
            if (!current || typeof current.hydrated !== "boolean") return false;
            if (current.sessionCanvasId !== null) return false;
            if (current.hydrated) return current.hydratedCanvasId === null;
            const next = prepareCanvasHydration(loadCanvasDoc(createEmptyCanvasDoc()));
            return next ? commitHydration(next, null) : false;
          } catch {
            return false;
          }
        },

        recoverCurrentState: () => {
          try {
            const current = snapshotDataFields(get(), [
              "hydrated",
              "sessionCanvasId",
              "hydratedCanvasId",
              "nodes",
              "edges",
              "groups",
              "brokenNodes",
              "brokenEdges",
              "schemaVersion",
              "migratedFrom",
              "migrationComplete",
              "recoveryRequired",
              "loadIssues",
            ]);
            if (!current || current.hydrated !== true) return false;
            if (current.sessionCanvasId !== current.hydratedCanvasId) return false;
            if (!isCanvasSessionIdentity(current.hydratedCanvasId)) return false;
            const next = prepareCanvasHydration({
              nodes: current.nodes,
              edges: current.edges,
              groups: current.groups,
              brokenNodes: current.brokenNodes,
              brokenEdges: current.brokenEdges,
              schemaVersion: current.schemaVersion,
              migratedFrom: current.migratedFrom,
              targetSchemaVersion: CANVAS_SCHEMA_VERSION,
              migrationComplete: current.migrationComplete,
              recoveryRequired: current.recoveryRequired,
              issues: current.loadIssues,
            } as LoadCanvasResult);
            return next ? commitHydration(next, current.hydratedCanvasId) : false;
          } catch {
            return false;
          }
        },

        confirmSafeRecovery: () => {
          if (!canMutateCurrentDocument()) return false;
          try {
            const current = snapshotDataFields(get(), [
              "sessionCanvasId",
              "hydratedCanvasId",
              "recoveryRequired",
              "schemaVersion",
              "migratedFrom",
              "nodes",
              "edges",
              "groups",
              "brokenNodes",
              "brokenEdges",
            ]);
            if (!current || current.recoveryRequired !== true) return false;
            if (
              !Number.isSafeInteger(current.schemaVersion) ||
              !Number.isSafeInteger(current.migratedFrom) ||
              (current.schemaVersion as number) > CANVAS_SCHEMA_VERSION ||
              (current.migratedFrom as number) > CANVAS_SCHEMA_VERSION
            ) {
              // Recovery may explicitly advance an older/incomplete document, but a client that
              // only understands vCurrent must never clear the gate by relabeling future data.
              return false;
            }
            if (
              typeof current.sessionCanvasId !== "string" ||
              current.sessionCanvasId !== current.hydratedCanvasId ||
              !Array.isArray(current.brokenNodes) ||
              !Array.isArray(current.brokenEdges) ||
              current.brokenNodes.length > 0 ||
              current.brokenEdges.length > 0
            ) {
              return false;
            }
            const validated = validateCanvasDoc({
              nodes: current.nodes,
              edges: current.edges,
              groups: current.groups,
            });
            if (!validated.ok || !validated.data) return false;
            set(
              (state) => {
                state.schemaVersion = CANVAS_SCHEMA_VERSION;
                state.migratedFrom = CANVAS_SCHEMA_VERSION;
                state.migrationComplete = true;
                state.recoveryRequired = false;
                state.loadIssues = [];
              },
              false,
              "canvas/confirmSafeRecovery"
            );
            return true;
          } catch {
            return false;
          }
        },

        preparePatchSave: (input) => {
          if (canvasSavePreparer) return canvasSavePreparer(get(), input);
          return {
            ok: false,
            error: {
              code: "NO_ACTIVE_WRITER",
              title: "尚未连接持久化画布",
              description: "保存适配器尚未由画布根组件接线。",
            },
          };
        },

        prepareRepairSave: (input) => {
          if (canvasRepairPreparer) return canvasRepairPreparer(get(), input);
          return {
            ok: false,
            error: {
              code: "NO_ACTIVE_WRITER",
              title: "尚未连接持久化画布",
              description: "恢复适配器尚未由画布根组件接线。",
            },
          };
        },

        promoteLocalToPersisted: (canvasId) => {
          // 仅接受持久化 uuid 身份;本地(null)不是合法晋升目标。
          if (!isCanvasSessionIdentity(canvasId) || canvasId === null) return false;
          try {
            // 前置铁律:必须处于**本地未持久化**且已 hydrated 身份,否则拒绝(绝不覆盖既有持久化会话)。
            const before = snapshotDataFields(get(), [
              "hydrated",
              "sessionCanvasId",
              "hydratedCanvasId",
              "recoveryRequired",
            ]);
            if (!before || before.hydrated !== true) return false;
            if (before.sessionCanvasId !== null || before.hydratedCanvasId !== null) return false;
            if (before.recoveryRequired !== false) return false;

            // ① 先经**既有屏障** finalize 进行中的交互(与 applyDocWithHistory 同序:先结束拖动、再提交
            //    文本会话)——把创建期的拖动位置/文本编辑作为历史项合并进 doc+past,使晋升后协调器的
            //    diff 能完整捕获它们。绝不在晋升点直接丢弃锚点(那会静默吞掉创建期编辑)。
            if (get().dragAnchor !== null) get().endPositionDrag();
            flushTextSession();

            // ② 屏障后重读并**重校仍为本地未持久化**身份(fail-closed:屏障理应不改身份,但复核后再切)。
            const current = snapshotDataFields(get(), [
              "hydrated",
              "sessionCanvasId",
              "hydratedCanvasId",
              "recoveryRequired",
            ]);
            if (!current || current.hydrated !== true) return false;
            if (current.sessionCanvasId !== null || current.hydratedCanvasId !== null) return false;
            if (current.recoveryRequired !== false) return false;

            // ③ 只重挂身份 + 转只读;doc(nodes/edges/groups)、历史(past/future)、broken/迁移态、
            //    以及已被屏障 finalize 的锚点全部**保留**——绝不清空(清空会丢刚 finalize 的历史与创建期编辑)。
            set(
              (state) => {
                state.sessionCanvasId = canvasId;
                state.hydratedCanvasId = canvasId;
                state.readOnly = true;
              },
              false,
              "canvas/promoteLocalToPersisted"
            );
            return true;
          } catch {
            return false;
          }
        },

        adoptAuthoritativeDoc: (canvasId, doc) => {
          if (!isCanvasSessionIdentity(canvasId) || canvasId === null) return false;
          try {
            const current = snapshotDataFields(get(), [
              "hydrated",
              "sessionCanvasId",
              "hydratedCanvasId",
            ]);
            if (!current || current.hydrated !== true) return false;
            // rebase 采纳只作用于**身份严格自洽**的活动会话。
            if (current.sessionCanvasId !== canvasId || current.hydratedCanvasId !== canvasId) {
              return false;
            }
            const validated = validateCanvasDoc(doc);
            if (!validated.ok || validated.data === null) return false;
            // 复用 prepareCanvasHydration 做 descriptor-safe 深拷 + 严格拓扑校验,再经 commitHydration
            // 原子替换 doc 并清空历史(rebase 跳变使旧撤销栈失真);session/readOnly 由本 set 之外保留。
            const next = prepareCanvasHydration({
              nodes: validated.data.nodes,
              edges: validated.data.edges,
              groups: validated.data.groups,
              brokenNodes: [],
              brokenEdges: [],
              schemaVersion: CANVAS_SCHEMA_VERSION,
              migratedFrom: CANVAS_SCHEMA_VERSION,
              targetSchemaVersion: CANVAS_SCHEMA_VERSION,
              migrationComplete: true,
              recoveryRequired: false,
              issues: [],
            } as LoadCanvasResult);
            if (!next) return false;
            return commitHydration(next, canvasId);
          } catch {
            return false;
          }
        },

        addNode: (input) => {
          if (!canMutateCurrentDocument()) return null;
          let node: CanvasNode;
          try {
            node = createCanvasNode(input);
          } catch {
            // 非法输入(如 media.ossKey 非 OSS object key)——不建半节点。
            return null;
          }
          // builder 在屏障后基于 fresh current 追加(node 工厂结果与 doc 无关,可在外造并闭包捕获 id)。
          const ok = applyDocWithHistory("canvas/addNode", (current) => ({
            nodes: [...current.nodes, node],
            edges: current.edges,
            groups: current.groups,
          }));
          return ok ? node.id : null;
        },

        addEdge: (connection) => {
          if (!canMutateCurrentDocument()) return null;
          // 合法性检查(禁自环/悬空/重复)与建边都在 builder 内基于屏障后的 fresh current 完成。
          // 只用闭包回传**标量 edgeId**(而非闭包赋值的对象:那会被 TS 控制流判为 never;属性访问放闭包内)。
          let edgeId: string | null = null;
          const ok = applyDocWithHistory("canvas/addEdge", (current) => {
            if (!canAddCanvasEdge(current.nodes, current.edges, connection)) return null;
            let edge: CanvasEdge;
            try {
              edge = createCanvasEdge({
                source: connection.source as string,
                target: connection.target as string,
                sourceHandle: connection.sourceHandle ?? null,
                targetHandle: connection.targetHandle ?? null,
              });
            } catch {
              return null;
            }
            edgeId = edge.id;
            return { nodes: current.nodes, edges: [...current.edges, edge], groups: current.groups };
          });
          return ok ? edgeId : null;
        },

        addNodeAndEdge: ({ node: nodeInput, fromNodeId, fromHandleId, fromHandleType }) => {
          if (!canMutateCurrentDocument()) return null;

          let node: CanvasNode;
          try {
            node = createCanvasNode(nodeInput);
          } catch {
            return null;
          }

          const connection: CanvasConnection =
            fromHandleType === "source"
              ? { source: fromNodeId, sourceHandle: fromHandleId, target: node.id, targetHandle: null }
              : { source: node.id, sourceHandle: null, target: fromNodeId, targetHandle: fromHandleId };

          // 源节点仍存在 + 连线合法性 + 建边,全部在 builder 内基于屏障后的 fresh current 判定(避免选类型
          // 期间源被删或期间被拖动 finalize 后拿旧 doc 判定 → 孤儿节点/冲突历史)。node 在闭包外造(未被闭包
          // 赋值,node.id 可安全外读);edge 仅闭包内造,只回传标量 edgeId。
          let edgeId: string | null = null;
          const ok = applyDocWithHistory("canvas/addNodeAndEdge", (current) => {
            if (!current.nodes.some((candidate) => candidate.id === fromNodeId)) return null;
            if (!canAddCanvasEdge([...current.nodes, node], current.edges, connection)) return null;
            let edge: CanvasEdge;
            try {
              edge = createCanvasEdge({
                source: connection.source as string,
                target: connection.target as string,
                sourceHandle: connection.sourceHandle ?? null,
                targetHandle: connection.targetHandle ?? null,
              });
            } catch {
              return null;
            }
            edgeId = edge.id;
            return {
              nodes: [...current.nodes, node],
              edges: [...current.edges, edge],
              groups: current.groups,
            };
          });
          return ok && edgeId ? { nodeId: node.id, edgeId } : null;
        },

        updateNodeData: (id, patch, options) => {
          if (!canMutateCurrentDocument()) return false;
          const unsetKeys = options?.unset ?? [];
          const prepareNextData = (node: CanvasNode): CanvasNodeData | null => {
            let prepared: CanvasNodeData;
            try {
              // 删键必须在 parse **之前**:zod 对「present 但值为 undefined」的可选键会原样保留成
              // own 键,留到 parse 之后再删就晚了(那时 clone 已经判否)。
              const merged: Record<string, unknown> = { ...node.data, ...patch };
              for (const key of unsetKeys) delete merged[key];
              prepared = CanvasNodeDataSchema.parse(merged);
            } catch {
              return null;
            }
            if (inspectUnsafeCanvasValue(prepared).length > 0) return null;
            return cloneCanvasEntity({ ...node, data: prepared }) === null ? null : prepared;
          };

          // 先在**当前状态**预检；无效补丁必须完全无副作用，不能仅因尝试失败就结束拖动。
          let current = get();
          let node = current.nodes.find((candidate) => candidate.id === id);
          if (!node) return false;
          let nextData = prepareNextData(node);
          if (nextData === null) return false;

          // 文本编辑与拖动是两个独立事务。合法补丁先结束拖动再建立文本锚，避免同一 data 变化同时被
          // 拖动 entry 和文本 entry 捕获，导致第二次 undo 的 base 冲突、历史栈卡死。
          if (current.dragAnchor !== null) get().endPositionDrag();

          // 屏障可能 fail-closed 回滚当前节点；必须基于 fresh node 重算并再次预检，不能沿用旧闭包。
          current = get();
          node = current.nodes.find((candidate) => candidate.id === id);
          if (!node) return false;
          nextData = prepareNextData(node);
          if (nextData === null) return false;

          // 切到别的 node 编辑 → 先提交上一个待提交文本会话(顺序正确)。
          if (current.editAnchor && current.editAnchor.nodeId !== id) flushTextSession();

          // 该 node 尚无进行中的会话 → 记下会话起点该 node 的**深拷实体**(本次修改前);连续编辑复用同一锚。
          const startSession = get().editAnchor?.nodeId !== id;
          const baseNode = startSession ? get().nodes.find((candidate) => candidate.id === id) : undefined;
          const base = baseNode ? cloneCanvasEntity(baseNode) : null;
          // 需开新会话但锚实体不可安全深拷(cloneCanvasEntity→null)→ 原子拒绝本次编辑:不改 doc、不开会话。
          // 保证「文本编辑必可撤销」——绝不产出改了 doc 却无历史锚的不可撤销状态(fail-closed)。
          if (startSession && baseNode && base === null) return false;
          set(
            (state) => {
              if (startSession && base) state.editAnchor = { nodeId: id, base };
              const target = state.nodes.find((candidate) => candidate.id === id);
              if (target) target.data = nextData;
            },
            false,
            "canvas/updateNodeData"
          );
          return true;
        },

        commitTextEdit: () => {
          if (!canMutateCurrentDocument()) return;
          flushTextSession();
        },

        removeNode: (id) => {
          if (!canMutateCurrentDocument()) return;
          // 在 builder 内基于屏障后的 fresh current 判定存在性并级联(拖动中删除会先 finalize 拖动再基于
          // 屏障后的位置删,不再拿旧位置生成冲突历史)。
          applyDocWithHistory("canvas/removeNode", (current) => {
            if (!current.nodes.some((node) => node.id === id)) return null;
            const nodes = current.nodes.filter((node) => node.id !== id);
            // 级联删除关联连线。
            const edges = current.edges.filter((edge) => edge.source !== id && edge.target !== id);
            // 从各 group.node_ids 移除;剩余节点的 group_id 不受影响(与 group 一致)。单删保留成员>0 的组。
            const groups = current.groups.map((group) =>
              group.node_ids.includes(id)
                ? { ...group, node_ids: group.node_ids.filter((member) => member !== id) }
                : group
            );
            return { nodes, edges, groups };
          });
        },

        removeEntities: (nodeIds, edgeIds) => {
          if (!canMutateCurrentDocument()) return;
          const removeNodes = new Set(nodeIds);
          const removeEdges = new Set(edgeIds ?? []);
          if (removeNodes.size === 0 && removeEdges.size === 0) return;
          applyDocWithHistory("canvas/removeEntities", (current) => {
            const nodes = current.nodes.filter((node) => !removeNodes.has(node.id));
            // 级联:删掉端点被删的边 + 显式所选独立边。
            const edges = current.edges.filter(
              (edge) =>
                !removeNodes.has(edge.source) &&
                !removeNodes.has(edge.target) &&
                !removeEdges.has(edge.id)
            );
            // 各组移除被删成员;变空的组一并删掉(保持双向一致)。
            const groups = current.groups
              .map((group) => ({
                ...group,
                node_ids: group.node_ids.filter((member) => !removeNodes.has(member)),
              }))
              .filter((group) => group.node_ids.length > 0);
            return { nodes, edges, groups };
          });
        },

        removeBrokenNode: (id) => {
          if (!canMutateCurrentDocument()) return;
          set(
            (state) => {
              state.brokenNodes = state.brokenNodes.filter((node) => node.id !== id);
              // D2 容错加载会在 domain edges/groups 里保留指向安全 broken id 的正常引用(供占位展示);
              // 显式删除 broken 实体必须同一次原子 set 一并级联清理这些引用,否则留悬空 edge/group
              // 成员,recoveryRequired 归 false 后未来 transport 提交会非法。domain nodes 不动。
              state.edges = state.edges.filter(
                (edge) => edge.source !== id && edge.target !== id
              );
              for (const group of state.groups) {
                const index = group.node_ids.indexOf(id);
                if (index !== -1) group.node_ids.splice(index, 1);
              }
              state.recoveryRequired = computeRecoveryRequired(
                state.migrationComplete,
                state.brokenNodes,
                state.brokenEdges
              );
              // 恢复动作不可撤销:清空历史与待提交会话(避免旧 op 指向已被恢复清理的实体)。
              state.past = [];
              state.future = [];
              state.editAnchor = null;
              state.dragAnchor = null;
            },
            false,
            "canvas/removeBrokenNode"
          );
        },

        removeBrokenEdges: () => {
          if (!canMutateCurrentDocument() || get().brokenEdges.length === 0) return;
          set(
            (state) => {
              state.brokenEdges = [];
              state.recoveryRequired = computeRecoveryRequired(
                state.migrationComplete,
                state.brokenNodes,
                state.brokenEdges
              );
              state.past = [];
              state.future = [];
              state.editAnchor = null;
              state.dragAnchor = null;
            },
            false,
            "canvas/removeBrokenEdges"
          );
        },

        applyNodePositionChanges: (changes) => {
          if (!canMutateCurrentDocument()) return;
          const updates = collectNodePositionUpdates(changes);
          if (updates.length === 0) return;
          if (get().dragAnchor !== null) {
            // 拖动中:逐帧只写领域 position(不入历史;整段拖动由 begin/endPositionDrag 合并成一个 entry)。
            set(
              (state) => {
                for (const update of updates) {
                  const node = state.nodes.find((candidate) => candidate.id === update.id);
                  if (node) node.position = { x: update.position.x, y: update.position.y };
                }
              },
              false,
              "canvas/applyNodePositionChanges"
            );
            return;
          }
          // 无 active drag(如键盘方向键移动焦点节点,只发 position、不触发 begin/end):作为**原子历史项**
          // 写入,可撤销并清空 redo(applyDocWithHistory 的无净变化保护使拖动结束的重复 settle 不产多余项)。
          const byId = new Map(updates.map((update) => [update.id, update.position] as const));
          applyDocWithHistory("canvas/moveNodesKeyboard", (current) => ({
            nodes: current.nodes.map((node) => {
              const position = byId.get(node.id);
              return position ? { ...node, position: { x: position.x, y: position.y } } : node;
            }),
            edges: current.edges,
            groups: current.groups,
          }));
        },

        applyNodePositions: (updates) => {
          if (!canMutateCurrentDocument()) return;
          if (!Array.isArray(updates) || updates.length === 0) return;
          // 公共写入口,不盲信布局输入:只接受 id 为非空字符串、x/y 有限的更新;
          // NaN/Infinity/非法 id 一律丢弃,绝不污染领域 doc。
          const byId = new Map<string, { x: number; y: number }>();
          for (const update of updates) {
            if (!update || typeof update.id !== "string" || update.id === "") continue;
            const position = update.position;
            if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
              continue;
            }
            byId.set(update.id, { x: position.x, y: position.y });
          }
          if (byId.size === 0) return;
          applyDocWithHistory("canvas/applyNodePositions", (current) => ({
            nodes: current.nodes.map((node) => {
              const position = byId.get(node.id);
              return position ? { ...node, position: { x: position.x, y: position.y } } : node;
            }),
            edges: current.edges,
            groups: current.groups,
          }));
        },

        groupNodes: (nodeIds) => {
          if (!canMutateCurrentDocument()) return null;
          // planner 在屏障后基于 fresh current 运行(拖动/文本会话已 finalize),group id 闭包捕获。
          let groupId: string | null = null;
          const ok = applyDocWithHistory("canvas/groupNodes", (current) => {
            const plan = planGroupNodes(current, nodeIds);
            if (!plan) return null;
            groupId = plan.groupId;
            return plan.doc;
          });
          return ok ? groupId : null;
        },

        ungroupNodes: (nodeIds) => {
          if (!canMutateCurrentDocument()) return false;
          return applyDocWithHistory("canvas/ungroupNodes", (current) =>
            planUngroupNodes(current, nodeIds)
          );
        },

        duplicateNodes: (nodeIds, opts) => {
          if (!canMutateCurrentDocument()) return null;
          // planner 在屏障后基于 fresh current 运行;新 id 集闭包捕获。
          let newNodeIds: string[] | null = null;
          const ok = applyDocWithHistory("canvas/duplicateNodes", (current) => {
            const plan = planDuplicate(current, nodeIds, opts);
            if (!plan) return null;
            newNodeIds = plan.newNodeIds;
            return plan.doc;
          });
          return ok ? newNodeIds : null;
        },

        connectNodes: (source, target) => {
          if (!canMutateCurrentDocument()) return null;
          const connection: CanvasConnection = {
            source,
            target,
            sourceHandle: null,
            targetHandle: null,
          };
          // 合法性检查与建边都在 builder 内基于屏障后的 fresh current 完成;只回传标量 edgeId。
          let edgeId: string | null = null;
          const ok = applyDocWithHistory("canvas/connectNodes", (current) => {
            if (!canAddCanvasEdge(current.nodes, current.edges, connection)) return null;
            let edge: CanvasEdge;
            try {
              edge = createCanvasEdge({ source, target, sourceHandle: null, targetHandle: null });
            } catch {
              return null;
            }
            edgeId = edge.id;
            return { nodes: current.nodes, edges: [...current.edges, edge], groups: current.groups };
          });
          return ok ? edgeId : null;
        },

        undo: () => {
          if (!canMutateCurrentDocument()) return false;
          flushTextSession();
          const state0 = get();
          if (state0.dragAnchor !== null) return false; // 拖动中不撤销
          if (state0.past.length === 0) return false;
          const entry = state0.past[state0.past.length - 1];
          const result = applyOpsToDoc(getDoc(), entry.inverse);
          if (!result.ok) return false; // 原子不动
          const next = result.doc;
          set(
            (state) => {
              state.nodes = next.nodes;
              state.edges = next.edges;
              state.groups = next.groups;
              state.past.pop();
              state.future.push(entry);
              if (state.future.length > CANVAS_HISTORY_LIMIT) state.future.shift();
            },
            false,
            "canvas/undo"
          );
          return true;
        },

        redo: () => {
          if (!canMutateCurrentDocument()) return false;
          flushTextSession();
          const state0 = get();
          if (state0.dragAnchor !== null) return false;
          if (state0.future.length === 0) return false;
          const entry = state0.future[state0.future.length - 1];
          const result = applyOpsToDoc(getDoc(), entry.forward);
          if (!result.ok) return false;
          const next = result.doc;
          set(
            (state) => {
              state.nodes = next.nodes;
              state.edges = next.edges;
              state.groups = next.groups;
              state.future.pop();
              state.past.push(entry);
              if (state.past.length > CANVAS_HISTORY_LIMIT) state.past.shift();
            },
            false,
            "canvas/redo"
          );
          return true;
        },

        beginPositionDrag: (nodeIds) => {
          if (!canMutateCurrentDocument()) return;
          if (get().dragAnchor !== null) return; // 双触发去重:已在拖动中不重设锚
          flushTextSession();
          // 只锚**可能移动的节点**的原始深拷实体(不存 doc 快照);按 doc 顺序收集成可序列化 entry array。
          const wanted = new Set(nodeIds);
          const bases: Array<{ id: string; base: CanvasNode }> = [];
          for (const node of get().nodes) {
            if (!wanted.has(node.id)) continue;
            const base = cloneCanvasEntity(node);
            // 任一选中的现存节点不可安全深拷 → **整个 begin 原子放弃**(绝不部分锚定:否则漏锚节点会让本段
            // 拖动只半可撤销)。schema 合法节点恒可克隆,此为 fail-closed 兜底。
            if (base === null) return;
            bases.push({ id: node.id, base });
          }
          if (bases.length === 0) return; // 无有效可锚节点 → 放弃
          set(
            (state) => {
              state.dragAnchor = { bases };
            },
            false,
            "canvas/beginPositionDrag"
          );
        },

        endPositionDrag: () => {
          const anchor = get().dragAnchor;
          if (anchor === null) return;
          const nodesById = new Map(get().nodes.map((node) => [node.id, node] as const));
          // 只对**真正变化**的锚定节点生成 update op,整段多选合并成**一个**历史项(无移动不入栈)。
          // 走 entry array + Map 查找,合法 id "__proto__"/"constructor"/"prototype" 与普通 id 完全同语义。
          const pairs = anchor.bases.map(({ id, base }) => ({ before: base, after: nodesById.get(id) }));
          const entry = canMutateCurrentDocument() ? makeNodeUpdateEntry(pairs) : null;
          // 净变化检测(仿 flushTextSession):任一锚定 node 与其 base 不同(或已不在)即有净变化。
          const changed = pairs.some(({ before, after }) => nodeChangedOrUnsafe(before, after));
          // 有净变化但建不出 entry(readOnly / 载荷不可克隆 → makeNodeUpdateEntry 原子放弃):把已逐帧写入的
          // 位置原子回滚到各 base —— 绝不留「改了 doc 却无历史、不可撤销」的状态;无净变化则正常只清 anchor。
          const needsRollback = entry === null && changed;
          const rollbackById = needsRollback
            ? new Map(anchor.bases.map(({ id, base }) => [id, base] as const))
            : null;
          set(
            (state) => {
              state.dragAnchor = null;
              if (entry) {
                state.past.push(entry);
                if (state.past.length > CANVAS_HISTORY_LIMIT) state.past.shift();
                state.future = [];
              } else if (rollbackById) {
                for (let index = 0; index < state.nodes.length; index += 1) {
                  const base = rollbackById.get(state.nodes[index].id);
                  if (base) state.nodes[index] = base;
                }
              }
            },
            false,
            "canvas/endPositionDrag"
          );
        },

        setReadOnly: (readOnly) => {
          if (readOnly) {
            // 转只读前(readOnly 尚为 false):原子 finalize 进行中的拖动——把已逐帧写入的位置合并成一个
            // 历史项(避免已写位置既不回滚也不入历史),并提交待提交文本会话。之后再置只读。
            if (get().dragAnchor !== null) get().endPositionDrag();
            flushTextSession();
          }
          set(
            (state) => {
              state.readOnly = readOnly;
            },
            false,
            "canvas/setReadOnly"
          );
        },

        setEdgesHidden: (hidden) =>
          set(
            (state) => {
              state.edgesHidden = hidden;
            },
            false,
            "canvas/setEdgesHidden"
          ),

        toggleEdgesHidden: () =>
          set(
            (state) => {
              state.edgesHidden = !state.edgesHidden;
            },
            false,
            "canvas/toggleEdgesHidden"
          ),

        setSnapToGrid: (enabled) =>
          set(
            (state) => {
              state.snapToGrid = enabled;
            },
            false,
            "canvas/setSnapToGrid"
          ),

        toggleSnapToGrid: () =>
          set(
            (state) => {
              state.snapToGrid = !state.snapToGrid;
            },
            false,
            "canvas/toggleSnapToGrid"
          ),

        setMinimapCollapsed: (collapsed) =>
          set(
            (state) => {
              state.minimapCollapsed = collapsed;
            },
            false,
            "canvas/setMinimapCollapsed"
          ),

        toggleMinimapCollapsed: () =>
          set(
            (state) => {
              state.minimapCollapsed = !state.minimapCollapsed;
            },
            false,
            "canvas/toggleMinimapCollapsed"
          ),

        reset: () =>
          set(
            (state) => {
              Object.assign(state, createInitialState());
            },
            false,
            "canvas/reset"
          ),
      };
    }),
    { name: "CanvasStore", enabled: process.env.NODE_ENV !== "production" }
  )
);

/**
 * 连线合法性(纯函数,供 addEdge 与离线单测复用):
 * 需源/目标都有值、非自环、两端节点都存在、且不与现有 edge 重复
 * (source + target + 两个 handle 全等视为重复)。
 */
export function canAddCanvasEdge(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  connection: CanvasConnection
): boolean {
  const { source, target } = connection;
  if (!source || !target) return false;
  if (source === target) return false; // 禁自环
  if (!nodes.some((node) => node.id === source)) return false; // 悬空源
  if (!nodes.some((node) => node.id === target)) return false; // 悬空目标
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  return !edges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (edge.sourceHandle ?? null) === sourceHandle &&
      (edge.targetHandle ?? null) === targetHandle
  );
}

/**
 * 恢复闸重算(纯函数,供 removeBrokenNode 与离线单测复用):迁移未完成、或仍有 broken 节点/边
 * 时需恢复。与 schema.loadCanvasDoc 的口径一致。
 */
export function computeRecoveryRequired(
  migrationComplete: boolean,
  brokenNodes: readonly BrokenCanvasNode[],
  brokenEdges: readonly BrokenCanvasEdge[]
): boolean {
  return !migrationComplete || brokenNodes.length > 0 || brokenEdges.length > 0;
}

// ============================================================================
// 选择器(房内惯例:窄选择 hooks)
// ============================================================================

export const useCanvasNodes = () => useCanvasStore((state) => state.nodes);
export const useCanvasEdges = () => useCanvasStore((state) => state.edges);
export const useCanvasBrokenNodes = () => useCanvasStore((state) => state.brokenNodes);
export const useCanvasGroups = () => useCanvasStore((state) => state.groups);
export const useCanvasEdgesHidden = () => useCanvasStore((state) => state.edgesHidden);
export const useCanvasSnapToGrid = () => useCanvasStore((state) => state.snapToGrid);
export const useCanvasMinimapCollapsed = () =>
  useCanvasStore((state) => state.minimapCollapsed);
export const useCanvasReadOnly = () => useCanvasStore((state) => state.readOnly);
export const useCanvasRecoveryRequired = () =>
  useCanvasStore((state) => state.recoveryRequired);
export const useCanvasHydrated = () => useCanvasStore((state) => state.hydrated);
export const useCanvasHydratedCanvasId = () =>
  useCanvasStore((state) => state.hydratedCanvasId);
export const useCanvasLoadIssues = () => useCanvasStore((state) => state.loadIssues);
export const useCanvasCanUndo = () => useCanvasStore((state) => state.past.length > 0);
export const useCanvasCanRedo = () => useCanvasStore((state) => state.future.length > 0);

/**
 * 未来 transport 提交闸(保留既有导出名供 D3 接线):未装载 / 需恢复 / 只读 三者任一为真时,
 * 绝不允许准备持久化提交。S7 当前没有 autosave 或网络执行器。
 */
export function isCanvasAutosaveBlocked(state: CanvasStore): boolean {
  return (
    !state.hydrated ||
    state.sessionCanvasId !== state.hydratedCanvasId ||
    state.recoveryRequired ||
    state.readOnly
  );
}

export const useCanvasAutosaveBlocked = () => useCanvasStore(isCanvasAutosaveBlocked);
