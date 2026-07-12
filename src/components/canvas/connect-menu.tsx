"use client";

/**
 * 超级画布 · 拉线到空白处的建节点菜单(P0 · S2)
 *
 * 从已有 handle 拉到空白释放时,在落点弹出 6 类选择;选中后 CanvasBoard 在落点建节点并
 * 按拉线方向自动连好。绝对定位于画布容器(x/y 为容器内坐标)。
 */
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { CanvasNodeType } from "@/lib/canvas/schema";

import { NODE_TYPE_ITEMS } from "./node-type-meta";

export function ConnectNodeMenu({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (type: CanvasNodeType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="选择节点类型"
      className="absolute z-50 min-w-[136px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <div className="px-2 py-1 text-[11px] text-muted-foreground">连到新节点</div>
      {NODE_TYPE_ITEMS.map(({ type, label, Icon }) => (
        <Button
          key={type}
          type="button"
          variant="ghost"
          size="sm"
          role="menuitem"
          className="w-full justify-start gap-2"
          onClick={() => onPick(type)}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Button>
      ))}
    </div>
  );
}
