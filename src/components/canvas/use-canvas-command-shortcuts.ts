"use client";

/**
 * 超级画布 · S4 命令快捷键 hook。
 *
 * 把 window keydown 交给纯裁决 decideCanvasCommand:仅画布上下文、非交互控件(input/textarea/
 * contenteditable/button/menu/dialog)、非 IME 合成时处理;视图键(缩放)只读也执行、文档键只读不动。
 * **只在真正执行时 preventDefault**:视图命令总执行→preventDefault;文档命令由 handler 返回是否真的
 * 处理了(如无选择/空栈→false),false 则不 preventDefault(不劫持无用键、让浏览器默认照常)。
 *
 * handler 放 ref,监听器只注册一次(不随选择态频繁重挂);readOnly 每次事件即时读 store(不订阅)。
 */
import { useEffect, useRef, type RefObject } from "react";

import { useCanvasStore } from "@/stores/canvas-store";

import {
  decideCanvasCommand,
  isCanvasDocumentInteractionBlocked,
  type CanvasCommandId,
} from "./canvas-command-shortcuts";
import { CANVAS_INTERACTIVE_FOCUS_SELECTOR } from "./tab-create-policy";

export interface CanvasCommandHandlers {
  /** 文档命令返回 boolean:是否真的处理了(true→preventDefault)。 */
  onGroup: () => boolean;
  onUngroup: () => boolean;
  onConnect: () => boolean;
  onDuplicate: () => boolean;
  onDelete: () => boolean;
  onUndo: () => boolean;
  onRedo: () => boolean;
  /** 视图命令(缩放)总执行;只读也可用。 */
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function useCanvasCommandShortcuts(options: {
  wrapperRef: RefObject<HTMLElement | null>;
  handlers: CanvasCommandHandlers;
  interactionEnabled?: boolean;
}): void {
  const { wrapperRef } = options;
  const handlersRef = useRef(options.handlers);
  handlersRef.current = options.handlers;
  const interactionEnabledRef = useRef(options.interactionEnabled ?? true);
  interactionEnabledRef.current = options.interactionEnabled ?? true;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const wrapper = wrapperRef.current;
      const inCanvasContext =
        target === null ||
        target === document.body ||
        target === document.documentElement ||
        (!!wrapper && (target === wrapper || wrapper.contains(target)));
      const targetInteractive =
        !!target && target.closest(CANVAS_INTERACTIVE_FOCUS_SELECTOR) !== null;
      const composing = event.isComposing || event.keyCode === 229;

      const decision = decideCanvasCommand(
        {
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        },
        {
          inCanvasContext,
          targetInteractive,
          composing,
          readOnly: isCanvasDocumentInteractionBlocked(
            interactionEnabledRef.current,
            useCanvasStore.getState().readOnly
          ),
        }
      );
      if (decision.kind === "ignore") return;

      const handlers = handlersRef.current;
      if (decision.kind === "view") {
        if (decision.command === "zoom-in") handlers.onZoomIn();
        else handlers.onZoomOut();
        event.preventDefault();
        return;
      }

      const dispatch: Record<CanvasCommandId, () => boolean> = {
        group: handlers.onGroup,
        ungroup: handlers.onUngroup,
        connect: handlers.onConnect,
        duplicate: handlers.onDuplicate,
        delete: handlers.onDelete,
        undo: handlers.onUndo,
        redo: handlers.onRedo,
        // 视图命令不会走到这里(上面已处理);占位以满足全量映射。
        "zoom-in": () => false,
        "zoom-out": () => false,
      };
      if (dispatch[decision.command]()) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wrapperRef]);
}
