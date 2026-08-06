/**
 * 超级画布 · 画布键盘策略(P0 · S2 Tab 建节点 / S5 Alt+Shift+F 整理,纯逻辑 + DOM 分类器)
 *
 * shouldTabCreateNode:只允许**无修饰纯 Tab**(不误拦 Ctrl+Tab / Shift+Tab),焦点非交互控件、
 * 画布上下文、非只读时才在视口中心建节点。shouldTidyCanvas:Alt+Shift+F(layout-independent
 * code=KeyF)在同样门控下触发整理画布。策略纯函数可离线单测;DOM 分类由调用方 client 侧算好传入。
 */

/** 交互控件焦点选择器:这些元素(或其祖先)聚焦时 Tab 不抢键。 */
export const CANVAS_INTERACTIVE_FOCUS_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='menubar']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='listbox']",
  "[role='combobox']",
  "[role='option']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='textbox']",
].join(", ");

export interface TabCreateDecisionInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** 焦点(或其祖先)是交互控件。 */
  targetInteractive: boolean;
  /** 焦点在画布容器内,或为无聚焦的 body/html(画布上下文)。 */
  inCanvasContext: boolean;
  readOnly: boolean;
}

/** 纯策略:是否应在此次 Tab 建节点。 */
export function shouldTabCreateNode(input: TabCreateDecisionInput): boolean {
  if (input.key !== "Tab") return false;
  // 纯 Tab:任一修饰键即放弃(Ctrl+Tab 切标签、Shift+Tab 反向聚焦等交给浏览器/系统)。
  if (input.ctrlKey || input.altKey || input.metaKey || input.shiftKey) return false;
  if (input.readOnly) return false;
  if (input.targetInteractive) return false;
  if (!input.inCanvasContext) return false;
  return true;
}

export interface TidyDecisionInput {
  /** KeyboardEvent.code(layout-independent);Alt+Shift+F 用 "KeyF"。 */
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  targetInteractive: boolean;
  inCanvasContext: boolean;
  readOnly: boolean;
}

/** 纯策略:是否应触发「整理画布」(仅 Alt+Shift+F、画布上下文、非交互控件、非只读)。 */
export function shouldTidyCanvas(input: TidyDecisionInput): boolean {
  if (input.code !== "KeyF") return false;
  if (!input.altKey || !input.shiftKey) return false;
  if (input.ctrlKey || input.metaKey) return false;
  if (input.readOnly) return false;
  if (input.targetInteractive) return false;
  if (!input.inCanvasContext) return false;
  return true;
}
