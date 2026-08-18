/**
 * 超级画布 · S4 命令快捷键权威匹配器(纯逻辑,无 React)
 *
 * S1 的 matchCanvasShortcut(canvas-shortcuts.ts)只管**视图**键(Ctrl+0 适应、? 面板),且 S1
 * 验证器锁定它对 S4 键返 null——故 S4 的**变更/缩放**键走本独立匹配器,不改 S1 那张表。
 *
 * 只登记**真生效**的键(权威表=CHECKLIST A 组);字母键按 event.code(布局无关,Alt 不 mangle,
 * 与 S5 shouldTidyCanvas 的 "KeyF" 同规),缩放/删除键按 event.key。守卫(画布上下文 / 非交互控件 /
 * 非 IME / readOnly 分级)由 decideCanvasCommand 统一裁定,便于离线单测;hook 只做 preventDefault 与
 * 派发的最小胶水。
 */

export type CanvasCommandId =
  | "group"
  | "ungroup"
  | "connect"
  | "duplicate"
  | "delete"
  | "undo"
  | "redo"
  | "zoom-in"
  | "zoom-out";

export interface CanvasCommandKeyEvent {
  /** 布局相关键值(缩放/删除键用它)。 */
  key: string;
  /** 布局无关物理码(字母键用它:KeyG/KeyL/KeyD/KeyZ)。 */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 视图命令(缩放):只读也可用、总会执行;其余为文档命令(只读不动)。 */
const VIEW_COMMANDS = new Set<CanvasCommandId>(["zoom-in", "zoom-out"]);

export function isViewCommand(command: CanvasCommandId): boolean {
  return VIEW_COMMANDS.has(command);
}

export function isCanvasDocumentInteractionBlocked(
  interactionEnabled: boolean,
  storeReadOnly: boolean
): boolean {
  return !interactionEnabled || storeReadOnly;
}

/** 把一次按键映射为 S4 命令;不属于本表则 null。守卫不在此处,见 decideCanvasCommand。 */
export function matchCanvasCommand(event: CanvasCommandKeyEvent): CanvasCommandId | null {
  const primary = event.ctrlKey || event.metaKey; // Ctrl(Win/Linux)/⌘(Mac)
  const groupMod = primary || event.altKey; // 成组支持 Ctrl/⌘/Alt + G

  // 成组 / 解组:Ctrl/Alt/⌘ + G(+Shift=解组)
  if (event.code === "KeyG" && groupMod) {
    return event.shiftKey ? "ungroup" : "group";
  }
  // 连接恰好两个所选:Ctrl/⌘ + L(非 Alt、非 Shift)
  if (event.code === "KeyL" && primary && !event.altKey && !event.shiftKey) {
    return "connect";
  }
  // 复制所选(+内部连线):Ctrl/⌘ + D(非 Alt、非 Shift)
  if (event.code === "KeyD" && primary && !event.altKey && !event.shiftKey) {
    return "duplicate";
  }
  // 撤销 / 重做:Ctrl/⌘ + Z(+Shift=重做),非 Alt
  if (event.code === "KeyZ" && primary && !event.altKey) {
    return event.shiftKey ? "redo" : "undo";
  }
  // 删除所选:只登记 Delete(**不**含 Backspace,避免在画布上误拦浏览器/系统退格行为)。
  if (event.key === "Delete" && !primary && !event.altKey) {
    return "delete";
  }
  // 缩放:Ctrl/⌘ + 加/减号(非 Alt;含小键盘 +/-)
  if (primary && !event.altKey) {
    if (event.key === "=" || event.key === "+") return "zoom-in";
    if (event.key === "-" || event.key === "_") return "zoom-out";
  }
  return null;
}

export interface CanvasCommandContext {
  /** 焦点在画布容器内,或为无聚焦的 body/html。 */
  inCanvasContext: boolean;
  /** 焦点(或祖先)是 input/textarea/contenteditable/button/menu/dialog 等交互控件。 */
  targetInteractive: boolean;
  /** IME 输入合成中(event.isComposing 或 keyCode 229)。 */
  composing: boolean;
  /** 单写者只读(D5 接线;文档命令只读不动,视图命令仍可用)。 */
  readOnly: boolean;
}

export type CanvasCommandDecision =
  | { kind: "ignore" }
  | { kind: "view"; command: CanvasCommandId }
  | { kind: "document"; command: CanvasCommandId };

/**
 * 统一裁定(纯函数):非画布上下文 / 交互控件聚焦 / IME 合成中 → ignore(不劫持,原生优先,如
 * textarea 的原生 Ctrl+Z);匹配到视图命令 → view(只读也执行);文档命令且 readOnly → ignore
 * (文档键不动、不 preventDefault);文档命令且可写 → document(由 hook 执行,仅真正执行时 preventDefault)。
 */
export function decideCanvasCommand(
  event: CanvasCommandKeyEvent,
  ctx: CanvasCommandContext
): CanvasCommandDecision {
  if (ctx.composing || !ctx.inCanvasContext || ctx.targetInteractive) return { kind: "ignore" };
  const command = matchCanvasCommand(event);
  if (!command) return { kind: "ignore" };
  if (isViewCommand(command)) return { kind: "view", command };
  if (ctx.readOnly) return { kind: "ignore" };
  return { kind: "document", command };
}

export interface CanvasCommandShortcutSpec {
  id: string;
  keys: string;
  label: string;
}

/**
 * 「?」面板的 S4 命令段(只列真生效键;含两条拖拽手势,它们由 CanvasBoard 的 onNodeDrag* 生效,
 * 非 keydown,但同属权威表)。视图段(Space/Ctrl+0/整理/?)仍由 S1 的 CANVAS_VIEW_SHORTCUTS 提供。
 */
export const CANVAS_COMMAND_SHORTCUTS: CanvasCommandShortcutSpec[] = [
  { id: "group", keys: "Ctrl / Alt + G", label: "成组 · Group" },
  { id: "ungroup", keys: "Ctrl / Alt + Shift + G", label: "解组 · Ungroup" },
  { id: "connect", keys: "Ctrl / ⌘ + L", label: "连接所选两点 · Connect" },
  { id: "duplicate", keys: "Ctrl / ⌘ + D", label: "复制所选(带内部连线) · Duplicate" },
  { id: "delete", keys: "Delete", label: "删除所选(批量二确认) · Delete" },
  { id: "undo", keys: "Ctrl / ⌘ + Z", label: "撤销 · Undo" },
  { id: "redo", keys: "Ctrl / ⌘ + Shift + Z", label: "重做 · Redo" },
  { id: "zoom-in", keys: "Ctrl / ⌘ + =", label: "放大 · Zoom in" },
  { id: "zoom-out", keys: "Ctrl / ⌘ + -", label: "缩小 · Zoom out" },
  { id: "drag-copy", keys: "Alt + 拖动", label: "拖动复制节点 · Duplicate on drag" },
  { id: "drag-copy-edges", keys: "Ctrl + Alt + 拖动", label: "拖动创建带线副本 · Duplicate + edges" },
];

/** onNodesChange 抑制门(纯逻辑,无 React,便于离线单测):当前只读态 + RF 手势态 + 领域拖动锚存活态。 */
export interface CanvasNodeChangeGate {
  /** 单写者只读(D5):只读期只抑制文档型变化，select/dimensions 仍属本地视图态。 */
  readOnly: boolean;
  /** RF 拖动手势仍进行中(onNodeDragStart..Stop 之间)。 */
  gestureActive: boolean;
  /** 本次手势是 Alt/Ctrl+Alt 复制手势(落点转造副本、原节点不动),不走领域拖动锚。 */
  copyGestureActive: boolean;
  /** store 领域拖动锚仍存活(dragAnchor !== null);被结构动作的事务屏障 endPositionDrag 后转 false。 */
  domainDragActive: boolean;
  /** 本批含 position/add/remove/replace 等文档型变化；select/dimensions 不计。 */
  documentAffectingChanges: boolean;
}

/** React Flow NodeChange 中仅这两类完全属于 ephemeral 视图态。 */
export function isCanvasViewOnlyNodeChange(change: { type: string }): boolean {
  return change.type === "select" || change.type === "dimensions";
}

/** RF 在取消触摸拖动时可能只发终止 position 帧而不发 stop callback。 */
export function hasTerminalCanvasDragFrame(
  changes: ReadonlyArray<{ type: string; dragging?: boolean }>
): boolean {
  return changes.some((change) => change.type === "position" && change.dragging === false);
}

/**
 * onNodesChange 是否应**抑制**本批变更(不回写视图/领域,改由调用方从领域重同步视图)。纯函数、无 React。
 * 规则:
 *   ① 纯 select/dimensions → false(只读窗口也必须能选择节点、接收测量尺寸);
 *   ② readOnly + 文档型变化 → true(不许改领域,防分叉);
 *   ③ 普通(非 copy)手势仍 active、但领域拖动锚已被事务屏障(结构动作)结束(domainDragActive=false)→ true
 *      —— 这些是拖动被 finalize 后 RF 仍吐的剩余帧,放行会逐帧走键盘分支入历史;
 *   ④ 其余 → false(正常拖动帧领域锚仍活、copy 手势帧均照常处理)。
 * Alt/Ctrl+Alt 复制手势(copyGestureActive)绝不被误抑制。
 */
export function shouldSuppressCanvasNodeChanges(gate: CanvasNodeChangeGate): boolean {
  if (!gate.documentAffectingChanges) return false;
  if (gate.readOnly) return true;
  if (gate.gestureActive && !gate.copyGestureActive && !gate.domainDragActive) return true;
  return false;
}

/** 领域重同步用于结束/截断手势；显式清掉 RF 保留的 dragging 标记，防节点卡在拖动态。 */
export function clearCanvasDraggingFlags<T extends { dragging?: boolean }>(nodes: readonly T[]): T[] {
  return nodes.map((node) =>
    node.dragging === false ? node : { ...node, dragging: false }
  );
}
