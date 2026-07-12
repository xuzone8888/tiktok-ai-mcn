"use client";

/**
 * 超级画布 · 底盘(P0 · S1–S3 + S5)
 *
 * S5:真空画布显示 4 起点引导(CanvasEmptyState),底部工具栏(CanvasBottomToolbar,看板 7 入口、
 * P0 点亮添加节点/快捷键),Alt+Shift+F 整理画布(dagre LR 纯布局 → applyNodePositions → fitView)。
 *
 * 视图/领域分层(硬约束):领域真相 = canvas-store 的 nodes/edges(无任何 RF 视图字段);
 * 视图态 = 本组件本地 ephemeral viewNodes/viewEdges。onNodesChange 先 applyNodeChanges 更新
 * 视图,再经 rf-adapter 只把合法 position 回写领域;领域更新按 id reconcile。视图字段永不进 store。
 *
 * S2 建节点五入口 + 连线(全部经 store.addNode/addEdge → D2 工厂,受 readOnly 保护):
 *   1) 双击空白在指针处建默认文本节点;2) Tab 在视口中心建默认文本节点(输入区不抢);
 *   3) 拖入文件上传(只取 OSS object key)按类型建图片/视频节点;4) 左侧工具条建 6 类节点;
 *   5) 从 handle 拉到空白弹 6 类菜单,建节点并自动连线;已有节点间 onConnect 建 edge。
 * 坐标一律走 screenToFlowPosition,保证 zoom/pan 后准确。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useTheme } from "next-themes";

import { toast } from "@/hooks/use-toast";
import {
  reconcileReactFlowEdges,
  reconcileReactFlowNodes,
  toBrokenReactFlowNodes,
  toReactFlowEdges,
  toReactFlowNodes,
} from "@/lib/canvas/rf-adapter";
import type { CanvasNodeType, CanvasPosition } from "@/lib/canvas/schema";
import {
  useCanvasBrokenNodes,
  useCanvasEdges,
  useCanvasEdgesHidden,
  useCanvasMinimapCollapsed,
  useCanvasNodes,
  useCanvasReadOnly,
  useCanvasSnapToGrid,
  useCanvasStore,
} from "@/stores/canvas-store";

import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { shouldShowEmptyState } from "./canvas-chrome-policy";
import { CanvasEmptyState } from "./canvas-empty-state";
import { layoutCanvasNodes } from "./canvas-layout";
import { CanvasToolbar } from "./canvas-toolbar";
import { canvasNodeTypes } from "./node-registry";
import { ConnectNodeMenu } from "./connect-menu";
import { NodePalette } from "./node-palette";
import { ShortcutPanel } from "./shortcut-panel";
import { uploadCanvasFile } from "./canvas-upload";
import { useCanvasShortcuts } from "./use-canvas-shortcuts";
import {
  CANVAS_INTERACTIVE_FOCUS_SELECTOR,
  shouldTabCreateNode,
  shouldTidyCanvas,
} from "./tab-create-policy";

const GRID_SIZE = 16;
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];
/** 超过此视口宽度时挂载即展开小地图;≤此宽(含 1366×768)默认收起。 */
const MINIMAP_EXPAND_MIN_WIDTH = 1440;

interface ConnectMenuState {
  x: number; // 容器内坐标(渲染菜单)
  y: number;
  flowPosition: CanvasPosition; // 落点画布坐标(建节点)
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: "source" | "target";
}

function eventClientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
}

export function CanvasBoard() {
  const domainNodes = useCanvasNodes();
  const domainEdges = useCanvasEdges();
  const brokenNodes = useCanvasBrokenNodes();
  const edgesHidden = useCanvasEdgesHidden();
  const snapToGrid = useCanvasSnapToGrid();
  const minimapCollapsed = useCanvasMinimapCollapsed();
  const readOnly = useCanvasReadOnly();
  const setMinimapCollapsed = useCanvasStore((state) => state.setMinimapCollapsed);
  const applyNodePositionChanges = useCanvasStore(
    (state) => state.applyNodePositionChanges
  );
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const addNodeAndEdge = useCanvasStore((state) => state.addNodeAndEdge);
  const applyNodePositions = useCanvasStore((state) => state.applyNodePositions);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fitRafRef = useRef<number | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);

  // 本地 ephemeral 视图态(承载 selected/dragging/measured 等,永不回流领域)。
  // 视图节点 = 领域投影 + brokenNodes 的纯视图 __broken 投影(broken 绝不进领域/持久化)。
  const [viewNodes, setViewNodes] = useState<Node[]>(() => [
    ...toReactFlowNodes(useCanvasStore.getState().nodes),
    ...toBrokenReactFlowNodes(useCanvasStore.getState().brokenNodes),
  ]);
  const [viewEdges, setViewEdges] = useState<Edge[]>(() =>
    toReactFlowEdges(useCanvasStore.getState().edges, {
      hidden: useCanvasStore.getState().edgesHidden,
    })
  );

  // 整理后的 fitView:双 requestAnimationFrame 等提交(RF 依 reconcile 重排后)→ fitView。
  // 由 tidyCanvas 在 applyNodePositions 后直接调用,内部先 cancel 旧帧;不依赖 domainNodes effect,
  // 故重复整理(布局与现状相同、immer 不发状态变化)也重新框选。持有 raf id,unmount 时 cancel。
  const scheduleFit = useCallback(() => {
    if (fitRafRef.current !== null) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = requestAnimationFrame(() => {
        fitRafRef.current = null;
        void fitView({ duration: 400, padding: 0.2 });
      });
    });
  }, [fitView]);

  useEffect(() => {
    useCanvasStore.getState().initializeEmptyDoc();
  }, []);
  useEffect(() => {
    setViewNodes((previous) => [
      ...reconcileReactFlowNodes(previous, domainNodes),
      ...toBrokenReactFlowNodes(brokenNodes),
    ]);
  }, [domainNodes, brokenNodes]);
  // 卸载时取消未跑的 fitView(fitView 绝不在卸载后跑)。
  useEffect(
    () => () => {
      if (fitRafRef.current !== null) cancelAnimationFrame(fitRafRef.current);
    },
    []
  );
  useEffect(() => {
    setViewEdges((previous) =>
      reconcileReactFlowEdges(previous, domainEdges, { hidden: edgesHidden })
    );
  }, [domainEdges, edgesHidden]);
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth > MINIMAP_EXPAND_MIN_WIDTH) {
      setMinimapCollapsed(false);
    }
  }, [setMinimapCollapsed]);

  useCanvasShortcuts({
    onToggleShortcuts: () => setShortcutOpen((open) => !open),
  });

  // ---------------------------------------------------------------- S2
  const createNodeAt = useCallback(
    (type: CanvasNodeType, flowPosition: CanvasPosition) =>
      addNode({ type, position: flowPosition }),
    [addNode]
  );

  const viewportCenterFlow = useCallback((): CanvasPosition | null => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  const createNodeAtCenter = useCallback(
    (type: CanvasNodeType) => {
      const center = viewportCenterFlow();
      if (center) createNodeAt(type, center);
    },
    [viewportCenterFlow, createNodeAt]
  );

  // 1) 双击空白 → 指针处建默认文本节点(节点/控件上双击不触发)
  const onWrapperDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      createNodeAt("text", screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [readOnly, screenToFlowPosition, createNodeAt]
  );

  // 2) Tab → 视口中心建默认文本节点:仅无修饰纯 Tab、焦点非交互控件、画布上下文、非只读。
  //    不误拦 Ctrl+Tab / Shift+Tab;输入/可编辑/按钮/链接/菜单/对话框等聚焦时不抢键。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const wrapper = wrapperRef.current;
      const inCanvasContext =
        target === null ||
        target === document.body ||
        target === document.documentElement ||
        (!!wrapper && (target === wrapper || wrapper.contains(target)));
      const targetInteractive =
        !!target && target.closest(CANVAS_INTERACTIVE_FOCUS_SELECTOR) !== null;
      if (
        !shouldTabCreateNode({
          key: event.key,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          targetInteractive,
          inCanvasContext,
          readOnly: useCanvasStore.getState().readOnly,
        })
      ) {
        return;
      }
      event.preventDefault();
      createNodeAtCenter("text");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNodeAtCenter]);

  // S5 整理画布:纯 dagre LR 布局 → applyNodePositions(只写 position)→ fitView。
  const tidyCanvas = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.readOnly) return;
    const updates = layoutCanvasNodes(state.nodes, state.edges);
    if (updates.length === 0) return;
    applyNodePositions(updates);
    // 直接调度 fitView(双 rAF 等提交);不经 pendingFit/effect,重复整理也框选。
    scheduleFit();
  }, [applyNodePositions, scheduleFit]);

  // Alt+Shift+F → 整理画布:仅画布上下文、焦点非交互控件、非只读时生效。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== "KeyF" || !event.altKey || !event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const wrapper = wrapperRef.current;
      const inCanvasContext =
        target === null ||
        target === document.body ||
        target === document.documentElement ||
        (!!wrapper && (target === wrapper || wrapper.contains(target)));
      const targetInteractive =
        !!target && target.closest(CANVAS_INTERACTIVE_FOCUS_SELECTOR) !== null;
      if (
        !shouldTidyCanvas({
          code: event.code,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          targetInteractive,
          inCanvasContext,
          readOnly: useCanvasStore.getState().readOnly,
        })
      ) {
        return;
      }
      event.preventDefault();
      tidyCanvas();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tidyCanvas]);

  // 3) 拖入文件 → 上传(只取 object key)→ 建图片/视频节点
  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [readOnly]
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      const base = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      files.forEach((file, index) => {
        const position = { x: base.x + index * 24, y: base.y + index * 24 };
        void uploadCanvasFile(file)
          .then(({ kind, ossKey }) => {
            const id = addNode({ type: kind, position, data: { media: { ossKey } } });
            if (!id) {
              toast({ title: "建节点失败", description: file.name, variant: "destructive" });
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "上传失败";
            toast({
              title: "上传失败",
              description: `${file.name}:${message}`,
              variant: "destructive",
            });
          });
      });
    },
    [readOnly, screenToFlowPosition, addNode]
  );

  // 5a) 已有节点间连线
  const onConnect = useCallback(
    (connection: Connection) => {
      addEdge(connection);
    },
    [addEdge]
  );

  // 5b) 从 handle 拉到空白 → 弹 6 类菜单(落在节点上则交给 onConnect)
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (readOnly) return;
      if (connectionState.toNode) return;
      const fromNode = connectionState.fromNode;
      if (!fromNode) return;
      const fromHandle = connectionState.fromHandle;
      const point = eventClientPoint(event);
      const rect = wrapperRef.current?.getBoundingClientRect();
      setConnectMenu({
        x: rect ? point.x - rect.left : point.x,
        y: rect ? point.y - rect.top : point.y,
        flowPosition: screenToFlowPosition({ x: point.x, y: point.y }),
        fromNodeId: fromNode.id,
        fromHandleId: fromHandle?.id ?? null,
        fromHandleType: fromHandle?.type === "target" ? "target" : "source",
      });
    },
    [readOnly, screenToFlowPosition]
  );

  const onConnectMenuPick = useCallback(
    (type: CanvasNodeType) => {
      if (!connectMenu) return;
      // 原子建节点+边:要么同时成功,要么都不写(不留孤儿节点)。
      addNodeAndEdge({
        node: { type, position: connectMenu.flowPosition },
        fromNodeId: connectMenu.fromNodeId,
        fromHandleId: connectMenu.fromHandleId,
        fromHandleType: connectMenu.fromHandleType,
      });
      setConnectMenu(null);
    },
    [connectMenu, addNodeAndEdge]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setViewNodes((previous) => applyNodeChanges(changes, previous));
      applyNodePositionChanges(changes);
    },
    [applyNodePositionChanges]
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setViewEdges((previous) => applyEdgeChanges(changes, previous));
  }, []);

  const colorMode = resolvedTheme === "light" ? "light" : "dark";
  const memoizedNodeTypes = useMemo(() => canvasNodeTypes, []);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDoubleClick={onWrapperDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={viewNodes}
        edges={viewEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        nodeTypes={memoizedNodeTypes}
        colorMode={colorMode}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        panActivationKeyCode="Space"
        deleteKeyCode={null}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} />
        <Controls showInteractive={false} />
        {!minimapCollapsed && (
          <MiniMap pannable zoomable ariaLabel="画布小地图" className="!bg-card" />
        )}
        <NodePalette onCreate={createNodeAtCenter} disabled={readOnly} />
        <CanvasToolbar onOpenShortcuts={() => setShortcutOpen(true)} />
        <CanvasBottomToolbar
          onCreate={createNodeAtCenter}
          onOpenShortcuts={() => setShortcutOpen(true)}
          disabled={readOnly}
        />
      </ReactFlow>
      {shouldShowEmptyState(domainNodes.length, brokenNodes.length) && (
        <CanvasEmptyState onCreate={createNodeAtCenter} disabled={readOnly} />
      )}
      {connectMenu && (
        <ConnectNodeMenu
          x={connectMenu.x}
          y={connectMenu.y}
          onPick={onConnectMenuPick}
          onClose={() => setConnectMenu(null)}
        />
      )}
      <ShortcutPanel open={shortcutOpen} onOpenChange={setShortcutOpen} />
    </div>
  );
}
