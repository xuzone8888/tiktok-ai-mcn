/**
 * 超级画布 · React Flow 视图适配器(P0 · S1,壳工程 authored)
 *
 * 领域文档(schema.ts 的 CanvasDoc)是唯一真相;React Flow 的视图态(selected / dragging /
 * measured / width / height 等)只活在**组件本地 ephemeral 视图节点**里,经本适配器统一收敛。
 *
 * 两条铁律(技术负责人硬约束):
 *   1) 视图字段绝不进入持久化 schema/store —— 回写用 collectNodePositionUpdates 只取 position;
 *   2) 领域更新时按 id reconcile —— 领域 id/type/position/data 为真相,同时保留上一帧视图节点的
 *      selected/dragging/measured/width/height 等纯视图字段(reconcileReactFlowNodes/Edges)。
 *
 * group_id → React Flow parentId 的映射刻意**不在 P0 做**(成组容器是 S4);group_id 保留在
 * 领域文档里。放置说明:按技术负责人指令落在 src/lib/canvas/ 内(纯 TS、仅 type-import
 * @xyflow/react,便于离线单测),归属 shell authored。
 */
import type { Edge, Node, NodeChange } from "@xyflow/react";

import type {
  BrokenCanvasNode,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  CanvasPosition,
} from "./schema";

/** React Flow 节点的领域投影类型:data 严格为 CanvasNodeData。 */
export type CanvasReactFlowNode = Node<CanvasNodeData, CanvasNodeType>;

/** 领域更新 reconcile 时,从上一帧视图节点保留的纯视图字段白名单(绝不来自领域文档)。 */
export const RF_PRESERVED_NODE_VIEW_KEYS = [
  "selected",
  "dragging",
  "measured",
  "width",
  "height",
] as const;

/** 单个领域节点 → React Flow 节点(全新对象,仅四项领域字段)。 */
export function toReactFlowNode(node: CanvasNode): CanvasReactFlowNode {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: node.data,
  };
}

/** 领域节点数组 → React Flow 节点数组(纯投影,无视图字段)。 */
export function toReactFlowNodes(nodes: readonly CanvasNode[]): CanvasReactFlowNode[] {
  return nodes.map(toReactFlowNode);
}

/** 损坏节点的 React Flow 视图类型(非领域白名单;纯视图,绝不入领域文档/持久化)。 */
export const BROKEN_NODE_TYPE = "__broken" as const;

const BROKEN_FALLBACK_X = -320;
const BROKEN_FALLBACK_GAP = 88;

/**
 * D2 原始恢复实体 brokenNodes → 纯视图 __broken RF 节点(不可拖/连/RF 删除,仅显式删除)。
 * position 用实体原始坐标,缺失时按序确定性降级到画布左侧,避免堆叠原点。data 仅承载
 * rawType/issues 供占位卡展示——绝不构造领域 node,绝不静默丢弃 raw。
 */
export function toBrokenReactFlowNodes(broken: readonly BrokenCanvasNode[]): Node[] {
  return broken.map((entity, index) => ({
    id: entity.id,
    type: BROKEN_NODE_TYPE,
    position: entity.position ?? {
      x: BROKEN_FALLBACK_X,
      y: index * BROKEN_FALLBACK_GAP,
    },
    data: { rawType: entity.rawType, issues: entity.issues },
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: true,
  }));
}

/** 单个领域连线 → React Flow 连线;hidden 为「隐藏连线开关」视图态注入。 */
export function toReactFlowEdge(edge: CanvasEdge, options: { hidden: boolean }): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    hidden: options.hidden,
  };
}

/** 领域连线数组 → React Flow 连线数组。 */
export function toReactFlowEdges(
  edges: readonly CanvasEdge[],
  options: { hidden: boolean }
): Edge[] {
  return edges.map((edge) => toReactFlowEdge(edge, options));
}

/**
 * 领域节点 → 视图节点 reconcile:
 *   - 领域 id/type/position/data 为真相(始终取自领域,覆盖上一帧);
 *   - 上一帧同 id 视图节点的 selected/dragging/measured/width/height 原样保留;
 *   - 领域新增节点 = 纯投影;领域已删节点 = 不出现(按领域数组产出)。
 * 视图字段只在此进入视图层,永不回流领域。
 */
export function reconcileReactFlowNodes(
  previous: readonly Node[],
  domainNodes: readonly CanvasNode[]
): CanvasReactFlowNode[] {
  const prevById = new Map(previous.map((node) => [node.id, node]));
  return domainNodes.map((node) => {
    const projected = toReactFlowNode(node);
    const prev = prevById.get(node.id);
    if (!prev) return projected;
    return {
      ...projected,
      ...(prev.selected !== undefined ? { selected: prev.selected } : {}),
      ...(prev.dragging !== undefined ? { dragging: prev.dragging } : {}),
      ...(prev.measured !== undefined ? { measured: prev.measured } : {}),
      ...(prev.width != null ? { width: prev.width } : {}),
      ...(prev.height != null ? { height: prev.height } : {}),
    };
  });
}

/**
 * 领域连线 → 视图连线 reconcile:领域 id/source/target/handles 为真相,保留上一帧 selected,
 * hidden 由「隐藏连线开关」注入。S1 领域连线不可变(建线属 S2),但选择态须活在视图层。
 */
export function reconcileReactFlowEdges(
  previous: readonly Edge[],
  domainEdges: readonly CanvasEdge[],
  options: { hidden: boolean }
): Edge[] {
  const prevById = new Map(previous.map((edge) => [edge.id, edge]));
  return domainEdges.map((edge) => {
    const base = toReactFlowEdge(edge, options);
    const prev = prevById.get(edge.id);
    return prev?.selected !== undefined ? { ...base, selected: prev.selected } : base;
  });
}

export interface CanvasNodePositionUpdate {
  id: string;
  position: CanvasPosition;
}

/**
 * 从 React Flow 的节点变更流里**只**提取位置更新——「剥离视图字段」的核心。
 * dimensions(measured/width/height)、select、remove、add、replace 等变更全部丢弃,
 * 保证 selected/dragging/measured 等永远无法沿此路径进入领域文档/store。
 */
export function collectNodePositionUpdates(
  changes: readonly NodeChange[]
): CanvasNodePositionUpdate[] {
  const updates: CanvasNodePositionUpdate[] = [];
  for (const change of changes) {
    if (change.type !== "position") continue;
    const position = change.position;
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      continue;
    }
    updates.push({ id: change.id, position: { x: position.x, y: position.y } });
  }
  return updates;
}

/**
 * 纯函数:把位置更新应用到领域节点数组,只改 position,其余字段与引用保持不变;
 * 无实际变化时返回原数组引用(利于选择器/渲染短路)。
 */
export function applyNodePositionUpdates(
  nodes: readonly CanvasNode[],
  updates: readonly CanvasNodePositionUpdate[]
): CanvasNode[] {
  if (updates.length === 0) return nodes as CanvasNode[];
  const byId = new Map(updates.map((update) => [update.id, update.position]));
  let changed = false;
  const next = nodes.map((node) => {
    const position = byId.get(node.id);
    if (!position) return node;
    if (node.position.x === position.x && node.position.y === position.y) return node;
    changed = true;
    return { ...node, position: { x: position.x, y: position.y } };
  });
  return changed ? next : (nodes as CanvasNode[]);
}
