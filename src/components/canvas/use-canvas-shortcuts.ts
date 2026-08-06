"use client";

/**
 * 超级画布 · S1 视图快捷键 hook。
 *
 * 把窗口 keydown 交给纯匹配器 matchCanvasShortcut,只驱动 React Flow 的视图动作
 * (fit / zoom)与「?」面板开关。变更类按键一律不接(S4 接缝)。必须在
 * ReactFlowProvider 内使用(依赖 useReactFlow)。
 */
import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

import { matchCanvasShortcut } from "./canvas-shortcuts";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useCanvasShortcuts(options: { onToggleShortcuts: () => void }): void {
  const { fitView } = useReactFlow();
  const { onToggleShortcuts } = options;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const id = matchCanvasShortcut(event);
      if (!id) return;
      // Ctrl+0 与浏览器缩放冲突,画布内必须夺取。
      event.preventDefault();
      switch (id) {
        case "fit-view":
          void fitView({ duration: 200 });
          break;
        case "toggle-shortcuts":
          onToggleShortcuts();
          break;
        default:
          // pan-canvas 由 React Flow 接管;缩放键归 S4,均不在此处理。
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fitView, onToggleShortcuts]);
}
