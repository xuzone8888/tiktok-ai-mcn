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
  type ChangeEvent as ReactChangeEvent,
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

import { Button } from "@/components/ui/button";
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
import { CanvasAsyncSession } from "./canvas-async-session";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { shouldShowEmptyState } from "./canvas-chrome-policy";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { CanvasEmptyState } from "./canvas-empty-state";
import { useCanvasGeneration } from "./canvas-generation-context";
import { layoutCanvasNodes } from "./canvas-layout";
import { CanvasToolbar } from "./canvas-toolbar";
import { canvasNodeTypes } from "./node-registry";
import { ConnectNodeMenu } from "./connect-menu";
import { NodePalette } from "./node-palette";
import { projectGroupFrames } from "./group-frame";
import { ShortcutPanel } from "./shortcut-panel";
import { shouldExpandMinimap } from "./canvas-responsive";
import { CanvasDockHostProvider } from "./canvas-dock-context";
import {
  GENERATION_CANCEL_UNSUPPORTED_REASON,
  generationCancelUnsupportedReason,
  generationDeleteBlockReason,
  generationDeleteDisposition,
} from "./nodes/generation-controls";
import {
  CANVAS_UPLOAD_MAX_CONCURRENCY,
  prepareCanvasUploads,
  uploadPreparedCanvasFile,
  validateCanvasUploadFiles,
} from "./canvas-upload";
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
/** Exact browser-picker filter for every image/video format accepted by upload-contract. */
const CANVAS_UPLOAD_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
].join(",");
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
  /** 所选中处于 running、只能「仅移除」的节点数(CHECKLIST #251);0 = 普通删除。 */
  detachCount: number;
  /** 非 null = 这批 running 节点都撤不了单,弹窗里明示「取消并退款」不可用。 */
  detachCancelUnsupportedReason: string | null;
}

interface UploadBatchProgress {
  completed: number;
  total: number;
  percent: number;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
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
  const mountedRef = useRef(false);
  const uploadControllersRef = useRef(new Set<AbortController>());
  const uploadBatchActiveRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
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
  // #189 生成面板底部停靠位。用 state 而非 ref:面板要在宿主挂载后才能 portal 过去,
  // ref 变化不触发重渲会让首个被选中的节点永远停在 inline。
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const fitRafRef = useRef<number | null>(null);
  // 记录上一次小地图自动展开阈值状态,仅在跨越阈值时干预(不覆盖用户手动开关)。
  const minimapWideRef = useRef<boolean | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<UploadBatchProgress | null>(null);
  const {
    canvasId: generationCanvasId,
    syncState: generationSyncState,
    unresolvedActionByNodeId,
    generationByNodeId,
  } = useCanvasGeneration();

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
  }, [interactionActive]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Invalidate authority before aborting. Any pending continuation then
      // observes both a stale session and an unmounted UI before it can write.
      mountedRef.current = false;
      asyncSession.invalidate();
      for (const controller of uploadControllersRef.current) controller.abort();
    };
  }, [asyncSession]);

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
  const generationProtectionReason = useCallback(
    (nodeIds: readonly string[]): string | null => {
      const nodesById = new Map(
        useCanvasStore.getState().nodes.map((node) => [node.id, node])
      );
      for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (!node || (node.type !== "image" && node.type !== "video")) continue;
        const reason = generationDeleteBlockReason(
          generationByNodeId.get(nodeId),
          {
            syncState:
              generationCanvasId === null ? undefined : generationSyncState,
            unresolvedActionId: unresolvedActionByNodeId.get(nodeId),
          }
        );
        if (reason) return reason;
      }
      return null;
    },
    [
      generationByNodeId,
      generationCanvasId,
      generationSyncState,
      unresolvedActionByNodeId,
    ]
  );
  /**
   * 批量删除的处置计划(CHECKLIST #251)。返回 null = 这批里有「状态未定」的节点,
   * 整批不可删(由 `generationProtectionReason` 给出具体文案);否则返回其中
   * 只能「仅移除」的 running 节点及其撤单能力。
   *
   * 注意与 `generationProtectionReason` 分工:后者把 running 也算阻断,继续供
   * 复制/撤销/重做复用 —— 那些动作没有「仅移除」语义,不能在任务跑着时放行。
   */
  const generationDetachPlan = useCallback(
    (
      nodeIds: readonly string[]
    ): { detachIds: string[]; cancelUnsupportedReason: string | null } | null => {
      const nodesById = new Map(
        useCanvasStore.getState().nodes.map((node) => [node.id, node])
      );
      const detachIds: string[] = [];
      let everyDetachUncancellable = true;
      for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (!node || (node.type !== "image" && node.type !== "video")) continue;
        const disposition = generationDeleteDisposition(
          generationByNodeId.get(nodeId),
          {
            syncState:
              generationCanvasId === null ? undefined : generationSyncState,
            unresolvedActionId: unresolvedActionByNodeId.get(nodeId),
          }
        );
        if (!disposition) continue;
        if (disposition.kind === "blocked") return null;
        detachIds.push(nodeId);
        if (generationCancelUnsupportedReason(node.type, node.data) === null) {
          everyDetachUncancellable = false;
        }
      }
      return {
        detachIds,
        cancelUnsupportedReason:
          detachIds.length > 0 && everyDetachUncancellable
            ? GENERATION_CANCEL_UNSUPPORTED_REASON
            : null,
      };
    },
    [
      generationByNodeId,
      generationCanvasId,
      generationSyncState,
      unresolvedActionByNodeId,
    ]
  );
  const allGenerationProtectedNodeIds = useMemo(
    () =>
      domainNodes
        .filter((node) => node.type === "image" || node.type === "video")
        .map((node) => node.id),
    [domainNodes]
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
    const protectedReason = generationProtectionReason(ids);
    if (protectedReason) {
      toast({
        title: "当前节点暂不可复制",
        description: protectedReason,
        variant: "destructive",
      });
      return true;
    }
    return duplicateNodes(ids, { withEdges: true, offset: DUPLICATE_OFFSET }) !== null;
  }, [
    duplicateNodes,
    generationProtectionReason,
    getSelectedDomainNodeIds,
    readOnly,
  ]);
  const handleDelete = useCallback(() => {
    if (readOnly) return false;
    const nodeIds = getSelectedDomainNodeIds();
    const edgeIds = getSelectedEdgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return false;
    const plan = generationDetachPlan(nodeIds);
    if (plan === null) {
      // 这批含「状态未定」的节点:连仅移除都不安全,沿用原禁删文案。
      const protectedReason = generationProtectionReason(nodeIds);
      toast({
        title: "当前所选暂不可删除",
        description: protectedReason ?? "任务状态待核对，暂不可删除",
        variant: "destructive",
      });
      return true;
    }
    setPendingDelete({
      nodeIds,
      edgeIds,
      detachCount: plan.detachIds.length,
      detachCancelUnsupportedReason: plan.cancelUnsupportedReason,
    }); // 一次批量二确认
    return true;
  }, [
    generationDetachPlan,
    generationProtectionReason,
    getSelectedDomainNodeIds,
    getSelectedEdgeIds,
    readOnly,
  ]);
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
      onUndo: () => {
        if (readOnly) return false;
        const protectedReason = generationProtectionReason(
          allGenerationProtectedNodeIds
        );
        if (protectedReason) {
          toast({
            title: "任务核对期间暂不可撤销",
            description: protectedReason,
            variant: "destructive",
          });
          return true;
        }
        return undo();
      },
      onRedo: () => {
        if (readOnly) return false;
        const protectedReason = generationProtectionReason(
          allGenerationProtectedNodeIds
        );
        if (protectedReason) {
          toast({
            title: "任务核对期间暂不可重做",
            description: protectedReason,
            variant: "destructive",
          });
          return true;
        }
        return redo();
      },
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
    },
  });

  const confirmBatchDelete = useCallback(() => {
    if (!readOnly && pendingDelete) {
      // 弹窗开着期间状态可能变化,确认时按同一分类复检:running 仍走「仅移除」,
      // 一旦退化成「状态未定」立即撤销本次删除。
      if (generationDetachPlan(pendingDelete.nodeIds) === null) {
        const protectedReason = generationProtectionReason(
          pendingDelete.nodeIds
        );
        toast({
          title: "删除已取消",
          description: protectedReason ?? "任务状态待核对，删除已取消",
          variant: "destructive",
        });
        setPendingDelete(null);
        return;
      }
      removeEntities(pendingDelete.nodeIds, pendingDelete.edgeIds);
    }
    setPendingDelete(null);
  }, [
    generationDetachPlan,
    generationProtectionReason,
    pendingDelete,
    readOnly,
    removeEntities,
  ]);

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

  // 3) 文件选择与拖入共用同一批量链路:
  // 校验 → 服务端配额预留/凭证 → 有界并发直传/进度 → 安全确认 → 建图片/视频节点。
  const startCanvasUpload = useCallback(
    (files: File[], base: CanvasPosition) => {
      if (
        !mountedRef.current ||
        readOnly ||
        !interactionActive ||
        useCanvasStore.getState().readOnly
      ) {
        return;
      }
      if (files.length === 0) return;
      if (uploadBatchActiveRef.current) {
        toast({
          title: "上一批文件仍在上传",
          description: "请等待上传完成后再选择或拖入新文件",
          variant: "destructive",
        });
        return;
      }

      try {
        validateCanvasUploadFiles(files);
      } catch (error) {
        toast({
          title: "无法上传这批文件",
          description:
            error instanceof Error ? error.message : "文件信息不符合上传要求",
          variant: "destructive",
        });
        return;
      }

      const controller = new AbortController();
      const token = asyncSession.capture();
      if (!token) return;
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const loadedByIndex = files.map(() => 0);
      let completed = 0;
      let uploaded = 0;
      let lastPublishedCompleted = -1;
      let lastPublishedPercent = -1;
      uploadBatchActiveRef.current = true;
      uploadControllersRef.current.add(controller);
      setUploading(true);
      setUploadProgress({ completed: 0, total: files.length, percent: 0 });

      const publishProgress = () => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          !asyncSession.isCurrent(token)
        ) {
          return;
        }
        const loadedBytes = loadedByIndex.reduce(
          (total, loaded) => total + loaded,
          0
        );
        const transferPercent =
          totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
        // A 100% byte transfer can still be awaiting the server's HEAD, MIME,
        // byte-length and magic-number confirmation. Reserve 100% for a fully
        // finalized batch so the visible status never promises too early.
        const percent =
          completed === files.length && uploaded === files.length
            ? 100
            : Math.min(99, transferPercent);
        if (
          completed === lastPublishedCompleted &&
          percent === lastPublishedPercent
        ) {
          return;
        }
        lastPublishedCompleted = completed;
        lastPublishedPercent = percent;
        setUploadProgress({ completed, total: files.length, percent });
      };

      toast({
        title:
          files.length > 1
            ? `正在上传 ${files.length} 个文件`
            : "正在上传素材",
        description:
          files.length > 1
            ? `同时最多上传 ${CANVAS_UPLOAD_MAX_CONCURRENCY} 个`
            : files[0].name,
      });

      void (async () => {
        const prepared = await prepareCanvasUploads(files, controller.signal);
        let nextIndex = 0;
        let failed = 0;

        const worker = async () => {
          while (nextIndex < prepared.length) {
            const index = nextIndex;
            nextIndex += 1;
            const item = prepared[index];
            try {
              const { kind, ossKey } = await uploadPreparedCanvasFile(item, {
                signal: controller.signal,
                onProgress: ({ loaded }) => {
                  loadedByIndex[index] = Math.max(
                    loadedByIndex[index],
                    Math.min(item.file.size, loaded)
                  );
                  publishProgress();
                },
              });
              if (
                controller.signal.aborted ||
                !asyncSession.isCurrent(token) ||
                useCanvasStore.getState().readOnly
              ) {
                continue;
              }
              const position = {
                x: base.x + index * 24,
                y: base.y + index * 24,
              };
              const id = addNode({
                type: kind,
                position,
                data: { media: { ossKey } },
              });
              if (id) {
                uploaded += 1;
              } else {
                failed += 1;
                toast({
                  title: "文件已上传，但创建节点失败",
                  description: item.file.name,
                  variant: "destructive",
                });
              }
            } catch (error) {
              if (
                controller.signal.aborted ||
                isAbortError(error) ||
                !asyncSession.isCurrent(token)
              ) {
                continue;
              }
              failed += 1;
              toast({
                title: "上传失败",
                description: `${item.file.name}：${
                  error instanceof Error ? error.message : "请稍后重试"
                }`,
                variant: "destructive",
              });
            } finally {
              completed += 1;
              publishProgress();
            }
          }
        };

        const workerCount = Math.min(
          CANVAS_UPLOAD_MAX_CONCURRENCY,
          prepared.length
        );
        await Promise.all(
          Array.from({ length: workerCount }, () => worker())
        );

        if (
          asyncSession.isCurrent(token) &&
          !controller.signal.aborted &&
          !useCanvasStore.getState().readOnly
        ) {
          if (files.length === 1 && uploaded === 1) {
            toast({ title: "素材上传完成" });
          } else if (files.length > 1) {
            toast({
              title:
                failed === 0
                  ? `${uploaded} 个文件上传完成`
                  : `已上传 ${uploaded} 个，失败 ${failed} 个`,
              ...(failed > 0 ? { variant: "destructive" as const } : {}),
            });
          }
        }
      })()
        .catch((error) => {
          if (
            controller.signal.aborted ||
            isAbortError(error) ||
            !asyncSession.isCurrent(token)
          ) {
            return;
          }
          toast({
            title: "无法开始上传",
            description:
              error instanceof Error ? error.message : "请检查网络后重试",
            variant: "destructive",
          });
        })
        .finally(() => {
          uploadControllersRef.current.delete(controller);
          uploadBatchActiveRef.current = false;
          if (mountedRef.current) {
            // Interaction loss invalidates the session but does not unmount the
            // board. Mounted UI must still leave its uploading state here.
            setUploading(false);
            setUploadProgress(null);
          }
        });
    },
    [addNode, asyncSession, interactionActive, readOnly]
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (readOnly) return;
      event.dataTransfer.dropEffect = "copy";
    },
    [readOnly]
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (readOnly) return;
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      const base = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      startCanvasUpload(files, base);
    },
    [readOnly, screenToFlowPosition, startCanvasUpload]
  );

  const openUploadPicker = useCallback(() => {
    if (
      readOnly ||
      !interactionActive ||
      useCanvasStore.getState().readOnly
    ) {
      return;
    }
    if (uploadBatchActiveRef.current) {
      toast({
        title: "上一批文件仍在上传",
        description: "请等待上传完成后再选择或拖入新文件",
        variant: "destructive",
      });
      return;
    }
    const input = uploadInputRef.current;
    if (!input) return;
    // Clearing before click makes choosing the same file twice fire change in
    // desktop and mobile browsers alike.
    input.value = "";
    input.click();
  }, [interactionActive, readOnly]);

  const onUploadInputChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      // Release the FileList immediately and allow the same selection next time.
      event.currentTarget.value = "";
      if (files.length === 0) return;
      const center = viewportCenterFlow();
      if (!center) {
        toast({
          title: "无法定位上传素材",
          description: "请刷新画布后重试",
          variant: "destructive",
        });
        return;
      }
      startCanvasUpload(files, {
        x: center.x - MEDIA_NODE_WIDTH / 2,
        y: center.y - MEDIA_NODE_HEIGHT / 2,
      });
    },
    [startCanvasUpload, viewportCenterFlow]
  );

  const cancelCanvasUpload = useCallback(() => {
    // Abort is only a request. The promise chain owns controller removal,
    // mutex release and mounted UI settlement in its single finally block.
    for (const controller of uploadControllersRef.current) controller.abort();
  }, []);

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
      data-upload-state={uploading ? "uploading" : "idle"}
      onDoubleClick={onWrapperDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CanvasDockHostProvider host={dockHost}>
      <input
        ref={uploadInputRef}
        type="file"
        accept={CANVAS_UPLOAD_ACCEPT}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-canvas-upload-input=""
        data-upload-state={uploading ? "uploading" : "idle"}
        onChange={onUploadInputChange}
      />
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
          onUploadFiles={openUploadPicker}
          onOpenShortcuts={() => setShortcutOpen(true)}
          onOpenHistory={openHistory}
          uploading={uploading}
          disabled={readOnly}
        />
      </ReactFlow>
      {uploadProgress && (
        <div
          className="absolute bottom-16 left-1/2 z-20 w-72 max-w-[calc(100%_-_2rem)] -translate-x-1/2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
        >
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="font-medium text-foreground">正在上传素材</span>
            <span className="tabular-nums text-muted-foreground">
              {uploadProgress.completed}/{uploadProgress.total} ·{" "}
              {uploadProgress.percent}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-label="素材上传进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress.percent}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              aria-label="取消上传"
              data-canvas-upload-cancel=""
              onClick={cancelCanvasUpload}
            >
              取消上传
            </Button>
          </div>
        </div>
      )}
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
        detachCount={pendingDelete?.detachCount ?? 0}
        detachCancelUnsupportedReason={
          pendingDelete?.detachCancelUnsupportedReason ?? null
        }
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
      {/* #189 生成面板底部停靠位。两条约束:
          ① 宿主本体 pointer-events-none,只有真正 portal 进来的面板恢复 pointer-events,
             避免空停靠位吃掉画布底部的点击与框选;
          ② **必须让开底部工具条**——工具条是 React Flow 的 `<Panel position="bottom-center">`
             (内层 z-index 5),而本宿主是 `<ReactFlow>` 的兄弟节点、z-20,贴 bottom-0 会把
             「添加节点/上传/历史记录」整条盖住。故留出 bottom-16 的让位高度。 */}
      <div
        ref={setDockHost}
        data-canvas-generation-dock=""
        className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex max-h-[55%] flex-col items-center gap-2 overflow-y-auto px-3"
      />
      </CanvasDockHostProvider>
    </div>
  );
}
