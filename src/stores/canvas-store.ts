/**
 * 超级画布 · 画布状态 store(P0 · S1)
 *
 * 房内惯例的单文件例外(技术负责人 R-d 批准):遵循 zustand 房内风格,但**严禁 persist 文档**。
 * 领域文档(nodes/edges/groups/schemaVersion)是唯一真相;React Flow 的视图字段一律经
 * src/lib/canvas/rf-adapter.ts 投影/回写,绝不进入本 store 的持久化域。
 *
 * 消费 D2 的 schema.ts:类型与 loadCanvasDoc 容错读取路径全部复用,零平行类型。
 * 关键不变量(技术负责人硬约束):loadCanvasDoc 返回 recoveryRequired=true 时必须阻断自动保存
 * (见 isCanvasAutosaveBlocked);broken 实体原样保留交给 S3 显式处理,S1 不渲染、不静默丢弃。
 *
 * P0 边界:S1 底盘(文档装载 + 视图开关 + 单写者只读位 + 位置回写)+ S2 建节点/连线
 * (addNode/addEdge,受 readOnly 保护,一律经 D2 createCanvasNode/createCanvasEdge 落库,
 * 零平行类型)。成组/撤销(S4)、错误监控(S7)各自阶段再加,不在此提前实现。
 */
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { NodeChange } from "@xyflow/react";

import {
  CANVAS_SCHEMA_VERSION,
  createCanvasEdge,
  createCanvasNode,
  createEmptyCanvasDoc,
  loadCanvasDoc,
  type BrokenCanvasEdge,
  type BrokenCanvasNode,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type CreateCanvasNodeInput,
  type LoadCanvasResult,
} from "@/lib/canvas/schema";
import { collectNodePositionUpdates } from "@/lib/canvas/rf-adapter";

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

  // ---- 会话态(单写者只读:D5 接线设置,S7 渲染横幅) ----
  readOnly: boolean;

  // ---- 视图开关(短暂态,永不持久化、永不进领域文档) ----
  edgesHidden: boolean;
  snapToGrid: boolean;
  minimapCollapsed: boolean;
}

export interface CanvasStoreActions {
  /** 用 schema.loadCanvasDoc 的容错结果装载(SSR/测试可传预算结果)。 */
  hydrate: (result: LoadCanvasResult) => void;
  /** 便捷装载:内部走 loadCanvasDoc(永不抛错)。 */
  hydrateFromDoc: (rawDoc: unknown, fromVersion?: number) => void;
  /**
   * 仅在**尚未 hydrated** 时用空文档初始化(P0 无持久化时的兜底)。
   * 已 hydrated(D3/SSR/路由预加载已灌入服务端文档)则原样保留,绝不覆盖。
   */
  initializeEmptyDoc: () => void;
  /**
   * 建节点(S2):经 D2 createCanvasNode 落库;只读时忽略。非法输入(如 media.ossKey 非
   * OSS object key)返回 null,不建半节点。成功返回节点 id。
   */
  addNode: (input: CreateCanvasNodeInput) => string | null;
  /**
   * 连线(S2):经 canAddCanvasEdge 校验(禁自环/悬空端/重复)+ D2 createCanvasEdge 落库;
   * 只读或非法返回 null,成功返回 edge id。
   */
  addEdge: (connection: CanvasConnection) => string | null;
  /**
   * 原子建「新节点 + 连线」(S2 拉线到空白建节点):同一次 set 前完整校验(只读 / 源节点仍在 /
   * 节点可建 / 连线合法),要么节点+边同时写入,要么都不写——不留孤儿节点。成功返回 {nodeId,edgeId}。
   */
  addNodeAndEdge: (input: AddNodeAndEdgeInput) => { nodeId: string; edgeId: string } | null;
  /** React Flow 节点变更回写:只取 position,其余视图变更丢弃;只读时忽略。 */
  applyNodePositionChanges: (changes: NodeChange[]) => void;
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
    readOnly: false,
    edgesHidden: false,
    snapToGrid: true,
    // 1366×768 默认收起(CHECKLIST 条款);宽屏由 CanvasBoard 挂载时展开。
    minimapCollapsed: true,
  };
}

export const useCanvasStore = create<CanvasStore>()(
  devtools(
    immer((set, get) => ({
      ...createInitialState(),

      hydrate: (result) =>
        set(
          (state) => {
            state.nodes = result.nodes;
            state.edges = result.edges;
            state.groups = result.groups;
            state.schemaVersion = result.schemaVersion;
            state.brokenNodes = result.brokenNodes;
            state.brokenEdges = result.brokenEdges;
            state.migratedFrom = result.migratedFrom;
            state.migrationComplete = result.migrationComplete;
            state.recoveryRequired = result.recoveryRequired;
            state.loadIssues = result.issues;
            state.hydrated = true;
          },
          false,
          "canvas/hydrate"
        ),

      hydrateFromDoc: (rawDoc, fromVersion) => {
        const result = loadCanvasDoc(rawDoc, fromVersion);
        get().hydrate(result);
      },

      initializeEmptyDoc: () => {
        if (get().hydrated) return;
        get().hydrateFromDoc(createEmptyCanvasDoc());
      },

      addNode: (input) => {
        if (get().readOnly) return null;
        let node: CanvasNode;
        try {
          node = createCanvasNode(input);
        } catch {
          // 非法输入(如 media.ossKey 非 OSS object key)——不建半节点。
          return null;
        }
        set(
          (state) => {
            state.nodes.push(node);
          },
          false,
          "canvas/addNode"
        );
        return node.id;
      },

      addEdge: (connection) => {
        if (get().readOnly) return null;
        if (!canAddCanvasEdge(get().nodes, get().edges, connection)) return null;
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
        set(
          (state) => {
            state.edges.push(edge);
          },
          false,
          "canvas/addEdge"
        );
        return edge.id;
      },

      addNodeAndEdge: ({ node: nodeInput, fromNodeId, fromHandleId, fromHandleType }) => {
        if (get().readOnly) return null;
        const current = get();
        // 源节点必须仍存在(避免选类型期间源被删 → 孤儿节点)。
        if (!current.nodes.some((candidate) => candidate.id === fromNodeId)) return null;

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

        // 针对「含新节点」的集合校验连线合法性(禁自环/悬空/重复)。
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

        // 单次原子 set:节点与边同时写入(全部校验已在前置完成)。
        set(
          (state) => {
            state.nodes.push(node);
            state.edges.push(edge);
          },
          false,
          "canvas/addNodeAndEdge"
        );
        return { nodeId: node.id, edgeId: edge.id };
      },

      applyNodePositionChanges: (changes) => {
        if (get().readOnly) return;
        const updates = collectNodePositionUpdates(changes);
        if (updates.length === 0) return;
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
      },

      setReadOnly: (readOnly) =>
        set(
          (state) => {
            state.readOnly = readOnly;
          },
          false,
          "canvas/setReadOnly"
        ),

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
    })),
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

// ============================================================================
// 选择器(房内惯例:窄选择 hooks)
// ============================================================================

export const useCanvasNodes = () => useCanvasStore((state) => state.nodes);
export const useCanvasEdges = () => useCanvasStore((state) => state.edges);
export const useCanvasGroups = () => useCanvasStore((state) => state.groups);
export const useCanvasEdgesHidden = () => useCanvasStore((state) => state.edgesHidden);
export const useCanvasSnapToGrid = () => useCanvasStore((state) => state.snapToGrid);
export const useCanvasMinimapCollapsed = () =>
  useCanvasStore((state) => state.minimapCollapsed);
export const useCanvasReadOnly = () => useCanvasStore((state) => state.readOnly);
export const useCanvasRecoveryRequired = () =>
  useCanvasStore((state) => state.recoveryRequired);
export const useCanvasHydrated = () => useCanvasStore((state) => state.hydrated);
export const useCanvasLoadIssues = () => useCanvasStore((state) => state.loadIssues);

/**
 * 自动保存闸(纯函数,供 D3 接线与离线单测复用):未装载 / 需恢复 / 只读 三者任一为真时,
 * 绝不允许自动保存。技术负责人硬约束:recoveryRequired=true 必须阻断 autosave。
 */
export function isCanvasAutosaveBlocked(state: CanvasStore): boolean {
  return !state.hydrated || state.recoveryRequired || state.readOnly;
}

export const useCanvasAutosaveBlocked = () => useCanvasStore(isCanvasAutosaveBlocked);
