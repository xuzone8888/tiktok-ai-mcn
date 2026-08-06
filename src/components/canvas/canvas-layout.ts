/**
 * 超级画布 · 整理画布自动布局(P0 · S5,纯函数)
 *
 * 用 @dagrejs/dagre(MIT,自带 TS 声明,唯一新增直接依赖)对**领域** nodes/edges 做**确定性**
 * LR 布局,忽略 broken 视图节点。dagre 的 setNode/setEdge 插入顺序会影响同构图结果,故对
 * node id 与去重后的 edge tuple 做 canonical 排序后再插入、updates 也按 id 稳定排序——同一逻辑图
 * 的任意输入排列都产出**完全相同**的位置。固定兜底节点尺寸 + rank/node 间距 → 0/1 节点、孤立、
 * 环、缺尺寸都稳定,不产 NaN、不重叠。**绝不**接触 RF 视图字段或 viewport。
 */
import { Graph, layout as dagreLayout } from "@dagrejs/dagre";

import type { CanvasNodePositionUpdate } from "@/lib/canvas/rf-adapter";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas/schema";

/** 固定兜底节点尺寸(与 NodeShell 宽度一致),避免依赖 RF 测量导致 NaN/重叠。 */
const NODE_WIDTH = 208;
const NODE_HEIGHT = 96;
const RANK_SEP = 96; // LR 层间距(水平)
const NODE_SEP = 48; // 同层节点间距

export function layoutCanvasNodes(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): CanvasNodePositionUpdate[] {
  if (nodes.length === 0) return [];

  const graph = new Graph({ directed: true });
  graph.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(nodes.map((node) => node.id));
  // canonical 排序节点 id:插入顺序不再影响同构图结果。
  const sortedNodeIds = [...nodeIds].sort();
  for (const id of sortedNodeIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // 去重(跳过自环/悬空)+ canonical 排序 edge tuple,再插入。
  const seen = new Set<string>();
  const tuples: Array<[string, string]> = [];
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const key = JSON.stringify([edge.source, edge.target]); // 可见 ASCII,无 NUL/歧义
    if (seen.has(key)) continue;
    seen.add(key);
    tuples.push([edge.source, edge.target]);
  }
  tuples.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  );
  for (const [source, target] of tuples) {
    graph.setEdge(source, target);
  }

  dagreLayout(graph);

  // 按 id 稳定顺序产出;dagre 给节点中心坐标 → 转左上角(与领域/RF position 语义一致)。
  const updates: CanvasNodePositionUpdate[] = [];
  for (const id of sortedNodeIds) {
    const laid = graph.node(id) as { x?: number; y?: number } | undefined;
    const cx = laid?.x;
    const cy = laid?.y;
    if (
      typeof cx !== "number" ||
      typeof cy !== "number" ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy)
    ) {
      continue; // 不产 NaN;理论不发生(固定尺寸 + dagre 确定性)。
    }
    updates.push({
      id,
      position: { x: cx - NODE_WIDTH / 2, y: cy - NODE_HEIGHT / 2 },
    });
  }
  return updates;
}
