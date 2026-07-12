/**
 * 超级画布 · S1 视图快捷键权威表(纯逻辑,无 React)
 *
 * 只登记 S1 底盘**已生效**的视图类按键。变更类按键(Ctrl+Z/L/D、G 族、Delete、Alt+拖动
 * 等)刻意**不匹配**——那是 S4 的范畴,这里留作接缝。Space 拖画布由 React Flow 的
 * panActivationKeyCode 直接接管,不走本匹配器(仅在面板中展示)。
 *
 * 「?」面板只列本表,S4 落地全套快捷键时再扩为 CHECKLIST A 组权威表。
 */

export type CanvasShortcutId = "pan-canvas" | "fit-view" | "toggle-shortcuts";

export interface CanvasShortcutSpec {
  id: CanvasShortcutId;
  /** 展示用按键文案。 */
  keys: string;
  label: string;
}

/**
 * 面板展示顺序即本数组顺序。只列 S1 已生效键:缩放按键(Ctrl+加减号)归 S4(看板 #22),
 * S1 不列、不宣称已生效;鼠标缩放走 React Flow 原生 <Controls>。
 */
export const CANVAS_VIEW_SHORTCUTS: CanvasShortcutSpec[] = [
  { id: "pan-canvas", keys: "Space + 拖动", label: "拖动画布 · Pan canvas" },
  { id: "fit-view", keys: "Ctrl / ⌘ + 0", label: "适应视图 · Fit view" },
  { id: "toggle-shortcuts", keys: "?", label: "快捷键面板 · Shortcuts" },
];

export interface CanvasKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * 把一次按键映射为 S1 hook 会执行的动作;不属于视图集则返回 null。
 * pan-canvas 归 React Flow,故本匹配器不产出它。
 */
export function matchCanvasShortcut(event: CanvasKeyEvent): CanvasShortcutId | null {
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const { key } = event;

  if (mod && key === "0") return "fit-view";
  // Ctrl/⌘ 加减号缩放归 S4(看板 #22),S1 不匹配。
  if (!mod && (key === "?" || (Boolean(event.shiftKey) && key === "/"))) {
    return "toggle-shortcuts";
  }
  return null;
}
