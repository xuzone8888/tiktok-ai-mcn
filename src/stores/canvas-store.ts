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
 * P0 边界:S1 底盘 + S2 建节点/连线 + S3 文本编辑/删除/损坏实体删除
 * (updateNodeData 经 CanvasNodeDataSchema 校验回写、removeNode 级联 edges/group、
 * removeBrokenNode 删纯视图恢复实体并重算 recoveryRequired,全部受 readOnly 保护,零平行类型)。
 * 成组/撤销(S4)、错误监控(S7)各自阶段再加,不在此提前实现。
 */
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { NodeChange } from "@xyflow/react";

import {
  CANVAS_SCHEMA_VERSION,
  CanvasNodeDataSchema,
  createCanvasEdge,
  createCanvasNode,
  createEmptyCanvasDoc,
  inspectUnsafeCanvasValue,
  loadCanvasDoc,
  type BrokenCanvasEdge,
  type BrokenCanvasNode,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type CanvasNodeData,
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
  /**
   * 更新节点 data(S3 文本编辑等):合并 patch 后经 CanvasNodeDataSchema 校验 + 危险值扫描
   * (拒 dataURL/签名 URL),通过才回写;只读/节点不存在/校验失败返回 false。
   */
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => boolean;
  /**
   * 删除内容节点(S3):级联移除其 edges、从各 group.node_ids 移除,保持 group_id/group 一致;
   * 只读时忽略。二次确认 UI 由卡片承担。
   */
  removeNode: (id: string) => void;
  /**
   * 删除损坏恢复实体(S3):同一次原子 set 从 brokenNodes 移除、级联清理 domain edges 中 source/target
   * 指向它的正常引用、从各 group.node_ids 移除它(D2 容错加载会保留这些引用供占位展示),再按剩余
   * brokenNodes/brokenEdges/migrationComplete 重算 recoveryRequired;只读时忽略。绝不触碰领域 nodes。
   */
  removeBrokenNode: (id: string) => void;
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

      updateNodeData: (id, patch) => {
        if (get().readOnly) return false;
        const node = get().nodes.find((candidate) => candidate.id === id);
        if (!node) return false;
        let nextData: CanvasNodeData;
        try {
          nextData = CanvasNodeDataSchema.parse({ ...node.data, ...patch });
        } catch {
          return false;
        }
        // 危险值扫描(与保存写契约一致):title/params 等任何字符串拒 dataURL/签名 URL。
        if (inspectUnsafeCanvasValue(nextData).length > 0) return false;
        set(
          (state) => {
            const target = state.nodes.find((candidate) => candidate.id === id);
            if (target) target.data = nextData;
          },
          false,
          "canvas/updateNodeData"
        );
        return true;
      },

      removeNode: (id) => {
        if (get().readOnly) return;
        set(
          (state) => {
            state.nodes = state.nodes.filter((node) => node.id !== id);
            // 级联删除关联连线。
            state.edges = state.edges.filter(
              (edge) => edge.source !== id && edge.target !== id
            );
            // 从各 group.node_ids 移除;剩余节点的 group_id 不受影响(与 group 一致)。
            for (const group of state.groups) {
              const index = group.node_ids.indexOf(id);
              if (index !== -1) group.node_ids.splice(index, 1);
            }
          },
          false,
          "canvas/removeNode"
        );
      },

      removeBrokenNode: (id) => {
        if (get().readOnly) return;
        set(
          (state) => {
            state.brokenNodes = state.brokenNodes.filter((node) => node.id !== id);
            // D2 容错加载会在 domain edges/groups 里保留指向安全 broken id 的正常引用(供占位展示);
            // 显式删除 broken 实体必须同一次原子 set 一并级联清理这些引用,否则留悬空 edge/group
            // 成员,recoveryRequired 归 false 后下次 autosave 会非法。domain nodes 不动。
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
          },
          false,
          "canvas/removeBrokenNode"
        );
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
export const useCanvasLoadIssues = () => useCanvasStore((state) => state.loadIssues);

/**
 * 自动保存闸(纯函数,供 D3 接线与离线单测复用):未装载 / 需恢复 / 只读 三者任一为真时,
 * 绝不允许自动保存。技术负责人硬约束:recoveryRequired=true 必须阻断 autosave。
 */
export function isCanvasAutosaveBlocked(state: CanvasStore): boolean {
  return !state.hydrated || state.recoveryRequired || state.readOnly;
}

export const useCanvasAutosaveBlocked = () => useCanvasStore(isCanvasAutosaveBlocked);
