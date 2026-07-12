"use client";

/**
 * 超级画布 · 底盘(P0 · S1)
 *
 * 视图/领域分层(技术负责人硬约束):
 *   - 领域真相 = canvas-store 的 nodes/edges(干净,无任何 RF 视图字段);
 *   - 视图态 = 本组件本地 ephemeral viewNodes/viewEdges,承载 selected/dragging/measured 等。
 *   onNodesChange:先 applyNodeChanges 更新视图(保留 select/dimensions/dragging),
 *   再经 rf-adapter 只把合法 position 回写领域 store。领域更新时按 id reconcile:
 *   领域 id/type/position/data 为真相,保留上一帧视图字段。视图字段永不进 store/schema。
 *
 * 覆盖 S1 底盘:pan/zoom、小地图(1366×768 默认收起)、网格吸附、原生缩放控件 + Ctrl+0
 * fitView、隐藏连线开关、Space 拖画布。缩放键(Ctrl±)归 S4;建节点/连线归 S2。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useTheme } from "next-themes";

import {
  reconcileReactFlowEdges,
  reconcileReactFlowNodes,
  toReactFlowEdges,
  toReactFlowNodes,
} from "@/lib/canvas/rf-adapter";
import {
  useCanvasEdges,
  useCanvasEdgesHidden,
  useCanvasMinimapCollapsed,
  useCanvasNodes,
  useCanvasSnapToGrid,
  useCanvasStore,
} from "@/stores/canvas-store";

import { CanvasToolbar } from "./canvas-toolbar";
import { canvasNodeTypes } from "./node-registry";
import { ShortcutPanel } from "./shortcut-panel";
import { useCanvasShortcuts } from "./use-canvas-shortcuts";

const GRID_SIZE = 16;
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];
/** 超过此视口宽度时挂载即展开小地图;≤此宽(含 1366×768)默认收起。 */
const MINIMAP_EXPAND_MIN_WIDTH = 1440;

export function CanvasBoard() {
  const domainNodes = useCanvasNodes();
  const domainEdges = useCanvasEdges();
  const edgesHidden = useCanvasEdgesHidden();
  const snapToGrid = useCanvasSnapToGrid();
  const minimapCollapsed = useCanvasMinimapCollapsed();
  const setMinimapCollapsed = useCanvasStore((state) => state.setMinimapCollapsed);
  const applyNodePositionChanges = useCanvasStore(
    (state) => state.applyNodePositionChanges
  );
  const { resolvedTheme } = useTheme();
  const [shortcutOpen, setShortcutOpen] = useState(false);

  // 本地 ephemeral 视图态(承载 selected/dragging/measured 等,永不回流领域)。
  const [viewNodes, setViewNodes] = useState<Node[]>(() =>
    toReactFlowNodes(useCanvasStore.getState().nodes)
  );
  const [viewEdges, setViewEdges] = useState<Edge[]>(() =>
    toReactFlowEdges(useCanvasStore.getState().edges, {
      hidden: useCanvasStore.getState().edgesHidden,
    })
  );

  // P0 无持久化(D3):仅当 store 尚未 hydrated 时用空文档初始化;已 hydrated(未来 D3/SSR
  // 预加载的服务端文档)绝不被空文档覆盖。
  useEffect(() => {
    useCanvasStore.getState().initializeEmptyDoc();
  }, []);

  // 领域 → 视图 reconcile:领域 id/type/position/data 为真相,保留上一帧视图字段。
  useEffect(() => {
    setViewNodes((previous) => reconcileReactFlowNodes(previous, domainNodes));
  }, [domainNodes]);
  useEffect(() => {
    setViewEdges((previous) =>
      reconcileReactFlowEdges(previous, domainEdges, { hidden: edgesHidden })
    );
  }, [domainEdges, edgesHidden]);

  // 1366×768 默认收起;宽屏挂载时展开(仅依据挂载时视口,避免 hydration 抖动)。
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth > MINIMAP_EXPAND_MIN_WIDTH) {
      setMinimapCollapsed(false);
    }
  }, [setMinimapCollapsed]);

  useCanvasShortcuts({
    onToggleShortcuts: () => setShortcutOpen((open) => !open),
  });

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 全量视图变更(select/dimensions/dragging/position)进视图层……
      setViewNodes((previous) => applyNodeChanges(changes, previous));
      // ……仅合法 position 回写领域(rf-adapter 剥离所有视图字段)。
      applyNodePositionChanges(changes);
    },
    [applyNodePositionChanges]
  );

  // S1 领域连线不可变(建线归 S2),但边选择态等视图变更须进视图层,不得空吞。
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setViewEdges((previous) => applyEdgeChanges(changes, previous));
  }, []);

  const colorMode = resolvedTheme === "light" ? "light" : "dark";
  const memoizedNodeTypes = useMemo(() => canvasNodeTypes, []);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={viewNodes}
        edges={viewEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={memoizedNodeTypes}
        colorMode={colorMode}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        panActivationKeyCode="Space"
        deleteKeyCode={null}
        nodesConnectable={false}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} />
        <Controls showInteractive={false} />
        {!minimapCollapsed && (
          <MiniMap pannable zoomable ariaLabel="画布小地图" className="!bg-card" />
        )}
        <CanvasToolbar onOpenShortcuts={() => setShortcutOpen(true)} />
      </ReactFlow>
      <ShortcutPanel open={shortcutOpen} onOpenChange={setShortcutOpen} />
    </div>
  );
}
