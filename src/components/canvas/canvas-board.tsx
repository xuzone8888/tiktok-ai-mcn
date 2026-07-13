"use client";

/**
 * 超级画布 · 底盘(P0 · S1–S5)
 *
 * S5:真空画布显示 4 起点引导(CanvasEmptyState),底部工具栏(CanvasBottomToolbar,看板 7 入口、
 * P0 点亮添加节点/快捷键),Alt+Shift+F 整理画布(dagre LR 纯布局 → applyNodePositions → fitView)。
 *
 * S4:成组/解组/连接/复制/删除/撤销/重做全套快捷键(use-canvas-command-shortcuts,只在画布上下文、非
 * 交互控件、非 IME 时处理,文档键只读不动、只在真正执行时 preventDefault);Alt/Ctrl+Alt 拖动复制(原节点
 * 保留、副本落点=拖拽落点,带线只复制内部边);一段拖动经 begin/endPositionDrag 合并成一个 undo 项;
 * 成组用纯视图 __group 组框投影(projectGroupFrames,不可选/拖/连/删,永不写回文档);批量删除走一次
 * AlertDialog 二确认。缩放走 RF zoomIn/zoomOut。
 *
 * 视图/领域分层(硬约束):领域真相 = canvas-store 的 nodes/edges/groups(无任何 RF 视图字段);
 * 视图态 = 本组件本地 ephemeral viewNodes/viewEdges。onNodesChange 先 applyNodeChanges 更新
 * 视图,再经 rf-adapter 只把合法 position 回写领域(复制拖动时不回写,落点转为造副本);领域更新按 id
 * reconcile。视图字段永不进 store。
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
import type {
  CanvasMedia,
  CanvasNodeType,
  CanvasPosition,
} from "@/lib/canvas/schema";
import type { HistoryItem } from "@/lib/canvas/history-client";
import {
  useCanvasBrokenNodes,
  useCanvasEdges,
  useCanvasEdgesHidden,
  useCanvasGroups,
  useCanvasMinimapCollapsed,
  useCanvasNodes,
  useCanvasReadOnly,
  useCanvasSnapToGrid,
  useCanvasStore,
} from "@/stores/canvas-store";

import {
  clearCanvasDraggingFlags,
  hasTerminalCanvasDragFrame,
  isCanvasViewOnlyNodeChange,
  shouldSuppressCanvasNodeChanges,
} from "./canvas-command-shortcuts";
import { CanvasBatchDeleteDialog } from "./canvas-batch-delete-dialog";
import { CanvasAsyncSession, runGuardedCanvasTask } from "./canvas-async-session";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { shouldShowEmptyState } from "./canvas-chrome-policy";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { CanvasEmptyState } from "./canvas-empty-state";
import { layoutCanvasNodes } from "./canvas-layout";
import { CanvasToolbar } from "./canvas-toolbar";
import { canvasNodeTypes } from "./node-registry";
import { ConnectNodeMenu } from "./connect-menu";
import { NodePalette } from "./node-palette";
import { projectGroupFrames } from "./group-frame";
import { ShortcutPanel } from "./shortcut-panel";
import { shouldExpandMinimap } from "./canvas-responsive";
import { uploadCanvasFile } from "./canvas-upload";
import { useCanvasShortcuts } from "./use-canvas-shortcuts";
import { useCanvasCommandShortcuts } from "./use-canvas-command-shortcuts";
import { useViewportSize } from "./use-viewport-size";
import {
  CANVAS_INTERACTIVE_FOCUS_SELECTOR,
  shouldTabCreateNode,
  shouldTidyCanvas,
} from "./tab-create-policy";

const GRID_SIZE = 16;
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];
/** Ctrl+D 键盘复制的固定落点偏移(与网格对齐,避免与原节点完全重叠)。 */
const DUPLICATE_OFFSET: CanvasPosition = { x: GRID_SIZE * 2, y: GRID_SIZE * 2 };
// Stable media node footprint (flow units; nodes are sized in unzoomed flow
// space) used to center an imported asset on its projected drop point.
const MEDIA_NODE_WIDTH = 208;
const MEDIA_NODE_HEIGHT = 156;
// Bounded 3x3 screen-space offset table (px) around the wrapper center. A
// deterministic start slot (by fresh node count) fans repeated imports out with
// no unbounded diagonal; every target is clamped inside the wrapper.
const HISTORY_OFFSET_AXIS = [-48, 0, 48] as const;
const HISTORY_SCREEN_OFFSETS: readonly { dx: number; dy: number }[] =
  HISTORY_OFFSET_AXIS.flatMap((dx) =>
    HISTORY_OFFSET_AXIS.map((dy) => ({ dx, dy }))
  );

interface ConnectMenuState {
  x: number; // 容器内坐标(渲染菜单)
  y: number;
  flowPosition: CanvasPosition; // 落点画布坐标(建节点)
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: "source" | "target";
}

/** 复制拖动手势态(Alt=仅节点;Ctrl+Alt=带内部连线):记下参与节点与起点位置以判定是否真移动。 */
interface CopyDragState {
  withEdges: boolean;
  ids: string[];
  startById: Map<string, CanvasPosition>;
}

interface PendingDelete {
  nodeIds: string[];
  edgeIds: string[];
}

function eventClientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
}

export interface CanvasBoardProps {
  interactionEnabled?: boolean;
}

export function CanvasBoard({
  interactionEnabled = true,
}: CanvasBoardProps) {
  const domainNodes = useCanvasNodes();
  const domainEdges = useCanvasEdges();
  const domainGroups = useCanvasGroups();
  const brokenNodes = useCanvasBrokenNodes();
  const edgesHidden = useCanvasEdgesHidden();
  const snapToGrid = useCanvasSnapToGrid();
  const minimapCollapsed = useCanvasMinimapCollapsed();
  const storeReadOnly = useCanvasReadOnly();
  const readOnly = storeReadOnly || !interactionEnabled;
  const interactionActive = interactionEnabled && !storeReadOnly;
  const asyncSessionRef = useRef<CanvasAsyncSession | null>(null);
  if (asyncSessionRef.current === null) {
    asyncSessionRef.current = new CanvasAsyncSession(interactionActive);
  }
  const asyncSession = asyncSessionRef.current;
  asyncSession.setInteraction(interactionActive);
  const uploadControllersRef = useRef(new Set<AbortController>());
  const setMinimapCollapsed = useCanvasStore((state) => state.setMinimapCollapsed);
  const applyNodePositionChanges = useCanvasStore(
    (state) => state.applyNodePositionChanges
  );
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const addNodeAndEdge = useCanvasStore((state) => state.addNodeAndEdge);
  const applyNodePositions = useCanvasStore((state) => state.applyNodePositions);
  const groupNodes = useCanvasStore((state) => state.groupNodes);
  const ungroupNodes = useCanvasStore((state) => state.ungroupNodes);
  const duplicateNodes = useCanvasStore((state) => state.duplicateNodes);
  const connectNodes = useCanvasStore((state) => state.connectNodes);
  const removeEntities = useCanvasStore((state) => state.removeEntities);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const beginPositionDrag = useCanvasStore((state) => state.beginPositionDrag);
  const endPositionDrag = useCanvasStore((state) => state.endPositionDrag);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const { width: viewportWidth } = useViewportSize();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fitRafRef = useRef<number | null>(null);
  // 记录上一次小地图自动展开阈值状态,仅在跨越阈值时干预(不覆盖用户手动开关)。
  const minimapWideRef = useRef<boolean | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // 本地 ephemeral 视图态(承载 selected/dragging/measured 等,永不回流领域)。
  // viewNodes = 领域投影 + brokenNodes 的 __broken 投影;__group 组框在**渲染时**派生(见 nodesForRF),
  // 随成员测量尺寸/位置实时重算,绝不进入 viewNodes state,也绝不写回领域。
  const [viewNodes, setViewNodes] = useState<Node[]>(() => {
    const state = useCanvasStore.getState();
    return [
      ...toReactFlowNodes(state.nodes),
      ...toBrokenReactFlowNodes(state.brokenNodes),
    ];
  });
  const [viewEdges, setViewEdges] = useState<Edge[]>(() =>
    toReactFlowEdges(useCanvasStore.getState().edges, {
      hidden: useCanvasStore.getState().edgesHidden,
    })
  );

  // 选择读取 refs(命令 handler 与复制拖动需要最新视图选择态,避免闭包过期)。
  const viewNodesRef = useRef(viewNodes);
  viewNodesRef.current = viewNodes;
  const viewEdgesRef = useRef(viewEdges);
  viewEdgesRef.current = viewEdges;
  // 复制拖动手势态 + 拖动进行中标记(begin/end 双触发去重:node 与 selection 事件都可能触发)。
  const copyDragRef = useRef<CopyDragState | null>(null);
  const dragActiveRef = useRef(false);

  useEffect(() => {
    if (interactionActive) return;
    for (const controller of uploadControllersRef.current) controller.abort();
    uploadControllersRef.current.clear();
  }, [interactionActive]);

  useEffect(
    () => () => {
      asyncSession.invalidate();
      for (const controller of uploadControllersRef.current) controller.abort();
      uploadControllersRef.current.clear();
    },
    [asyncSession]
  );

  // 整理后的 fitView:双 requestAnimationFrame 等提交(RF 依 reconcile 重排后)→ fitView。
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
  // 响应式小地图(#33):仅在视口宽**跨越** 1440 阈值时自动展开/收起;阈值内不干预用户手动开关。
  // 窄屏(含 1366×768)默认收起,避免小地图占用宝贵横向空间、与右上工具条挤压。
  useEffect(() => {
    const wide = shouldExpandMinimap(viewportWidth);
    if (minimapWideRef.current === wide) return;
    minimapWideRef.current = wide;
    setMinimapCollapsed(!wide);
  }, [viewportWidth, setMinimapCollapsed]);

  useCanvasShortcuts({
    onToggleShortcuts: () => setShortcutOpen((open) => !open),
  });

  // 从领域重建视图节点(复制拖动结束时:原节点未动 → ghost 位归位;副本从领域投影补入)。
  const syncViewNodesFromDomain = useCallback((viewOnlyChanges: NodeChange[] = []) => {
    const state = useCanvasStore.getState();
    const reconciled = clearCanvasDraggingFlags([
      ...reconcileReactFlowNodes(viewNodesRef.current, state.nodes),
      ...toBrokenReactFlowNodes(state.brokenNodes),
    ]);
    const nextViewNodes =
      viewOnlyChanges.length > 0 ? applyNodeChanges(viewOnlyChanges, reconciled) : reconciled;
    viewNodesRef.current = nextViewNodes;
    setViewNodes(nextViewNodes);
  }, []);

  // __group 组框:渲染时从领域 groups + 当前视图成员位置/测量尺寸派生(纯视图,zIndex 更低画在背面)。
  // dimensionsById 取自 RF measured/width/height —— 绝不写回领域;组框永不进 viewNodes state。
  const frameNodes = useMemo(() => {
    const dimensionsById: Record<string, { width?: number; height?: number }> = {};
    for (const view of viewNodes) {
      const width = view.measured?.width ?? view.width ?? undefined;
      const height = view.measured?.height ?? view.height ?? undefined;
      if (width != null || height != null) dimensionsById[view.id] = { width, height };
    }
    return projectGroupFrames(domainGroups, viewNodes, dimensionsById);
  }, [domainGroups, viewNodes]);
  const nodesForRF = useMemo<Node[]>(() => [...frameNodes, ...viewNodes], [frameNodes, viewNodes]);

  // ---------------------------------------------------------------- 选择读取
  const getSelectedDomainNodeIds = useCallback((): string[] => {
    const domainIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
    return viewNodesRef.current
      .filter((node) => node.selected && domainIds.has(node.id))
      .map((node) => node.id);
  }, []);
  const getSelectedEdgeIds = useCallback(
    (): string[] => viewEdgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id),
    []
  );

  // ---------------------------------------------------------------- S4 命令
  const handleGroup = useCallback(
    () => !readOnly && groupNodes(getSelectedDomainNodeIds()) !== null,
    [groupNodes, getSelectedDomainNodeIds, readOnly]
  );
  const handleUngroup = useCallback(
    () => !readOnly && ungroupNodes(getSelectedDomainNodeIds()),
    [ungroupNodes, getSelectedDomainNodeIds, readOnly]
  );
  const handleConnect = useCallback(() => {
    if (readOnly) return false;
    const ids = getSelectedDomainNodeIds();
    if (ids.length !== 2) return false; // 恰好两个所选领域节点
    return connectNodes(ids[0], ids[1]) !== null;
  }, [connectNodes, getSelectedDomainNodeIds, readOnly]);
  const handleDuplicate = useCallback(() => {
    if (readOnly) return false;
    const ids = getSelectedDomainNodeIds();
    if (ids.length === 0) return false;
    return duplicateNodes(ids, { withEdges: true, offset: DUPLICATE_OFFSET }) !== null;
  }, [duplicateNodes, getSelectedDomainNodeIds, readOnly]);
  const handleDelete = useCallback(() => {
    if (readOnly) return false;
    const nodeIds = getSelectedDomainNodeIds();
    const edgeIds = getSelectedEdgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return false;
    setPendingDelete({ nodeIds, edgeIds }); // 一次批量二确认
    return true;
  }, [getSelectedDomainNodeIds, getSelectedEdgeIds, readOnly]);
  const handleZoomIn = useCallback(() => {
    void zoomIn({ duration: 200 });
  }, [zoomIn]);
  const handleZoomOut = useCallback(() => {
    void zoomOut({ duration: 200 });
  }, [zoomOut]);

  useCanvasCommandShortcuts({
    wrapperRef,
    interactionEnabled,
    handlers: {
      onGroup: handleGroup,
      onUngroup: handleUngroup,
      onConnect: handleConnect,
      onDuplicate: handleDuplicate,
      onDelete: handleDelete,
      onUndo: () => !readOnly && undo(),
      onRedo: () => !readOnly && redo(),
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
    },
  });

  const confirmBatchDelete = useCallback(() => {
    if (!readOnly && pendingDelete) {
      removeEntities(pendingDelete.nodeIds, pendingDelete.edgeIds);
    }
    setPendingDelete(null);
  }, [pendingDelete, readOnly, removeEntities]);

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

  // Add a history asset to the canvas as an image/video node. Synchronous
  // boolean: true only when addNode yields an id (the panel closes itself on
  // true). Audio is browse-only; P0 has no independent audio node.
  const handleAddHistoryAsset = useCallback(
    (item: HistoryItem): boolean => {
      // Gate on both the render closure AND the freshest store readOnly right
      // before mutating, so a writer/identity/readOnly change landing between
      // render and click cannot slip a write past the gate.
      if (readOnly || !interactionActive) return false;
      if (useCanvasStore.getState().readOnly) return false;
      if (item.type !== "image" && item.type !== "video") return false;

      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const store = useCanvasStore.getState();
      // Bounded, deterministic, visible placement: start from a slot chosen by
      // the fresh node count, walk the 3x3 screen-offset table around the
      // wrapper center, clamp each target inside the wrapper, project it to
      // flow, and center the stable media node on it (flow-unit half-size, so
      // the center stays on-screen at any zoom). Use the first slot that does
      // not land exactly on an existing node; fall back to the first slot.
      const occupied = new Set(
        store.nodes.map((node) => `${node.position.x},${node.position.y}`)
      );
      const startSlot = store.nodes.length % HISTORY_SCREEN_OFFSETS.length;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let firstCandidate: CanvasPosition | null = null;
      let position: CanvasPosition | null = null;
      for (let i = 0; i < HISTORY_SCREEN_OFFSETS.length; i += 1) {
        const offset =
          HISTORY_SCREEN_OFFSETS[
            (startSlot + i) % HISTORY_SCREEN_OFFSETS.length
          ];
        const screenX = Math.min(
          Math.max(centerX + offset.dx, rect.left),
          rect.right
        );
        const screenY = Math.min(
          Math.max(centerY + offset.dy, rect.top),
          rect.bottom
        );
        const projected = screenToFlowPosition({ x: screenX, y: screenY });
        const candidate: CanvasPosition = {
          x: projected.x - MEDIA_NODE_WIDTH / 2,
          y: projected.y - MEDIA_NODE_HEIGHT / 2,
        };
        if (firstCandidate === null) firstCandidate = candidate;
        if (!occupied.has(`${candidate.x},${candidate.y}`)) {
          position = candidate;
          break;
        }
      }
      position = position ?? firstCandidate;
      if (!position) return false;

      // Persist only the OSS object keys; never source/sourceId/URLs/metadata.
      const media: CanvasMedia = { ossKey: item.objectKey };
      if (item.posterKey) media.posterKey = item.posterKey;

      const id = addNode({ type: item.type, position, data: { media } });
      if (!id) {
        toast({
          title: "添加失败",
          description: "无法将素材添加到画布",
          variant: "destructive",
        });
        return false;
      }
      toast({ title: "已添加到画布" });
      return true;
    },
    [addNode, interactionActive, readOnly, screenToFlowPosition]
  );

  // Opening the history panel is gated on both the render closure interaction
  // state and the freshest store readOnly, never an unconditional setter.
  const openHistory = useCallback(() => {
    if (!interactionActive) return;
    if (useCanvasStore.getState().readOnly) return;
    setHistoryOpen(true);
  }, [interactionActive]);

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
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!interactionEnabled) return;
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
          readOnly,
        })
      ) {
        return;
      }
      event.preventDefault();
      createNodeAtCenter("text");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNodeAtCenter, interactionEnabled, readOnly]);

  // S5 整理画布:纯 dagre LR 布局 → applyNodePositions(只写 position)→ fitView。
  const tidyCanvas = useCallback(() => {
    if (readOnly) return;
    const state = useCanvasStore.getState();
    if (state.readOnly) return;
    const updates = layoutCanvasNodes(state.nodes, state.edges);
    if (updates.length === 0) return;
    applyNodePositions(updates);
    scheduleFit();
  }, [applyNodePositions, readOnly, scheduleFit]);

  // Alt+Shift+F → 整理画布:仅画布上下文、焦点非交互控件、非只读时生效。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!interactionEnabled) return;
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
          readOnly,
        })
      ) {
        return;
      }
      event.preventDefault();
      tidyCanvas();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [interactionEnabled, readOnly, tidyCanvas]);

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
        const controller = new AbortController();
        uploadControllersRef.current.add(controller);
        void runGuardedCanvasTask(
          asyncSession,
          uploadCanvasFile(file, controller.signal),
          {
            onSuccess: ({ kind, ossKey }) => {
            const id = addNode({ type: kind, position, data: { media: { ossKey } } });
            if (!id) {
              toast({ title: "建节点失败", description: file.name, variant: "destructive" });
            }
            },
            onError: (error) => {
              const message = error instanceof Error ? error.message : "上传失败";
              toast({
                title: "上传失败",
                description: `${file.name}:${message}`,
                variant: "destructive",
              });
            },
          }
        ).finally(() => {
          uploadControllersRef.current.delete(controller);
        });
      });
    },
    [addNode, asyncSession, readOnly, screenToFlowPosition]
  );

  // 5a) 已有节点间连线
  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      addEdge(connection);
    },
    [addEdge, readOnly]
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
      if (readOnly || !connectMenu) return;
      addNodeAndEdge({
        node: { type, position: connectMenu.flowPosition },
        fromNodeId: connectMenu.fromNodeId,
        fromHandleId: connectMenu.fromHandleId,
        fromHandleType: connectMenu.fromHandleType,
      });
      setConnectMenu(null);
    },
    [connectMenu, addNodeAndEdge, readOnly]
  );

  // ---------------------------------------------------------------- S4 拖动/复制
  // 拖动开始:Alt=复制手势(不动领域,记参与节点+起点视图位);否则常规拖动(store 只锚这批节点的原始
  // 实体、合并成一项,不存 doc 快照)。共享 beginDrag 只接纯 modifiers,不绑定某一事件类
  //(OnNodeDrag=原生 MouseEvent|TouchEvent;SelectionDragHandler=ReactMouseEvent)。
  const beginDrag = useCallback(
    (modifiers: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }, dragged: Node[]) => {
      if (readOnly) return;
      if (dragActiveRef.current) return; // node 与 selection 事件双触发去重
      const domainIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
      const ids = dragged.map((node) => node.id).filter((id) => domainIds.has(id));
      if (ids.length === 0) return;
      dragActiveRef.current = true;
      if (modifiers.altKey) {
        const startById = new Map<string, CanvasPosition>();
        const byId = new Map(viewNodesRef.current.map((node) => [node.id, node] as const));
        for (const id of ids) {
          const view = byId.get(id);
          if (view) startById.set(id, { x: view.position.x, y: view.position.y });
        }
        copyDragRef.current = { withEdges: modifiers.ctrlKey || modifiers.metaKey, ids, startById };
      } else {
        copyDragRef.current = null;
        beginPositionDrag(ids); // 只锚可能移动的这批节点(最小实体锚,不存 doc 快照)
      }
    },
    [beginPositionDrag, readOnly]
  );

  // 拖动结束:复制手势 → 用落点(视图末位)造副本(原节点保留、ghost 归位);常规 → 合并成一个位置历史项。
  const endDrag = useCallback(() => {
    if (!dragActiveRef.current) return;
    dragActiveRef.current = false;
    const copy = copyDragRef.current;
    copyDragRef.current = null;
    if (copy) {
      const byId = new Map(viewNodesRef.current.map((node) => [node.id, node] as const));
      // Map(非普通 Record):落点按真实 node id 存取,合法 id "__proto__"/"constructor" 等既不写污染原型、
      // 也不丢精确落点(group-ops lookupDuplicatePosition 对 Map 走 get)。
      const positionsById = new Map<string, CanvasPosition>();
      let moved = false;
      for (const id of copy.ids) {
        const view = byId.get(id);
        if (!view) continue;
        const final = { x: view.position.x, y: view.position.y };
        positionsById.set(id, final);
        const start = copy.startById.get(id);
        if (!start || start.x !== final.x || start.y !== final.y) moved = true;
      }
      // 仅在真正拖动过时造副本(Alt+点击无位移不造重叠副本);无论是否造副本都把 ghost 从领域归位。
      if (moved) duplicateNodes(copy.ids, { withEdges: copy.withEdges, positionsById });
      syncViewNodesFromDomain();
    } else {
      endPositionDrag();
    }
  }, [duplicateNodes, endPositionDrag, syncViewNodesFromDomain]);

  // OnNodeDrag 的 event 是**原生** MouseEvent|TouchEvent:触摸手势无修饰键(不触发复制),鼠标取实际修饰键。
  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent, _node: Node, nodes: Node[]) => {
      const modifiers =
        event instanceof MouseEvent
          ? { altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey }
          : { altKey: false, ctrlKey: false, metaKey: false };
      beginDrag(modifiers, nodes);
    },
    [beginDrag]
  );
  const onNodeDragStop = useCallback(() => endDrag(), [endDrag]);
  // SelectionDragHandler 的 event 是 ReactMouseEvent:取其修饰键。
  const onSelectionDragStart = useCallback(
    (event: ReactMouseEvent, nodes: Node[]) =>
      beginDrag({ altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey }, nodes),
    [beginDrag]
  );
  const onSelectionDragStop = useCallback(() => endDrag(), [endDrag]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 在任何 setViewNodes/applyNodePositionChanges 之前:领域拖动锚是否仍存活(可能已被结构动作的事务
      // 屏障 endPositionDrag 提前结束,而 RF 手势仍在吐剩余帧)。
      const domainDragActive = useCanvasStore.getState().dragAnchor !== null;
      const viewOnlyChanges = changes.filter(isCanvasViewOnlyNodeChange);
      const documentAffectingChanges = viewOnlyChanges.length !== changes.length;
      const terminalDragFrame =
        dragActiveRef.current && hasTerminalCanvasDragFrame(changes);
      if (
        shouldSuppressCanvasNodeChanges({
          readOnly,
          gestureActive: dragActiveRef.current,
          copyGestureActive: copyDragRef.current !== null,
          domainDragActive,
          documentAffectingChanges,
        })
      ) {
        // 抑制文档型帧但保留同批 select/dimensions；领域重同步同时清 dragging。终止帧自身也收口
        // 手势，覆盖触摸加入第二指等 RF 不发 stop callback 的取消路径。
        syncViewNodesFromDomain(viewOnlyChanges);
        if (terminalDragFrame) endDrag();
        return;
      }
      const nextViewNodes = applyNodeChanges(changes, viewNodesRef.current);
      viewNodesRef.current = nextViewNodes;
      setViewNodes(nextViewNodes);
      // 复制拖动中不回写领域(原节点不动;落点在 endDrag 转为造副本)。
      if (!copyDragRef.current) applyNodePositionChanges(changes);
      if (terminalDragFrame) endDrag();
    },
    [applyNodePositionChanges, endDrag, readOnly, syncViewNodesFromDomain]
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
      inert={interactionEnabled ? undefined : true}
      aria-busy={!interactionEnabled}
      data-canvas-interactive={interactionEnabled ? "true" : "false"}
      onDoubleClick={onWrapperDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodesForRF}
        edges={viewEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragStop={onSelectionDragStop}
        nodeTypes={memoizedNodeTypes}
        colorMode={colorMode}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        panActivationKeyCode="Space"
        deleteKeyCode={null}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        autoPanOnNodeDrag={false}
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
          onOpenHistory={openHistory}
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
      <CanvasBatchDeleteDialog
        open={pendingDelete !== null}
        nodeCount={pendingDelete?.nodeIds.length ?? 0}
        edgeCount={pendingDelete?.edgeIds.length ?? 0}
        onConfirm={confirmBatchDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      />
      <ShortcutPanel open={shortcutOpen} onOpenChange={setShortcutOpen} />
      {/* Rendered outside ReactFlow but inside the board lifecycle; its own gate
          (interactionEnabled) closes it when identity/writer/readOnly is lost. */}
      <CanvasHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        interactionEnabled={interactionActive}
        onAddAsset={handleAddHistoryAsset}
      />
    </div>
  );
}
