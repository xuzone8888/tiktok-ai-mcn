/**
 * 超级画布 · Tab 建节点策略(P0 · S2,纯逻辑 + DOM 分类器)
 *
 * 只允许**无修饰的纯 Tab**(禁 Ctrl/Alt/Meta/Shift → 不误拦 Ctrl+Tab / Shift+Tab),
 * 且焦点不在交互控件(输入/可编辑/选择框/按钮/链接/菜单/对话框等)、处于画布上下文、非只读时,
 * 才在视口中心建节点。策略纯函数可离线单测;DOM 分类由调用方在 client 侧计算后传入。
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
