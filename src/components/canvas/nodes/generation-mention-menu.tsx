"use client";

/**
 * @引用素材的提及浮层(CHECKLIST #182)
 *
 * 判定全在纯模块 `generation-mention-policy.ts` 里,本文件只负责画和收键。
 *
 * ## 为什么必须 portal 到 body,而不是挂在面板里
 *
 * 两条硬理由,都不是审美问题:
 *  1. **会被缩放**。生成面板渲染在 React Flow 的节点里,整棵子树吃画布的 transform;
 *     面板只在 zoom ≥ 0.4 时才渲染,最坏情况下浮层会被缩到 40%,而节点选中宽也才 304px。
 *     (`ConnectNodeMenu` 没这个问题,是因为它挂在 board wrapper 上、不在 flow 内 ——
 *     面板里的浮层学不了这一招。)
 *  2. **会被换父重挂**。面板 inline ↔ 停靠底部是靠实测高度决策的,切换时整块走 `createPortal`
 *     换父;内联长列表会把面板顶过阈值,于是选择器的展开态、高亮项、焦点**当场丢失**。
 *
 * portal 到 body 后,浮层对面板高度的贡献恒为 0,也不受 zoom 影响。
 *
 * ## 无障碍与快捷键让路
 *
 * 用 `role="listbox"` / `role="option"` —— 这两个选择器已经在画布的
 * 「交互焦点白名单」里,所以浮层聚焦时画布自研快捷键(Tab 建节点、Delete 删节点等)
 * 会自动让路,不需要在这里另写拦截。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { MentionCandidate } from "./generation-mention-policy";

export interface GenerationMentionMenuProps {
  open: boolean;
  /** 视口坐标(CSS px);由调用方按 textarea 或「+」按钮的位置算好。 */
  anchor: { x: number; y: number } | null;
  candidates: readonly MentionCandidate[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
  onClose: () => void;
  /** 「从历史记录选一张」入口;为 null 时不渲染那一行。 */
  onPickFromHistory: (() => void) | null;
}

export function GenerationMentionMenu({
  open,
  anchor,
  candidates,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onClose,
  onPickFromHistory,
}: GenerationMentionMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // Escape 在这里也收一次:textarea 可能已经失焦(用户直接点了浮层),
    // 那时 textarea 的 onKeyDown 收不到键。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !anchor || typeof document === "undefined") return null;

  // 贴着锚点右下方展开,并夹在视口内 —— 节点可能靠近屏幕边缘。
  const width = 260;
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8));
  const top = Math.min(anchor.y, Math.max(8, window.innerHeight - 240));

  return createPortal(
    <div
      ref={ref}
      className="nodrag nopan nowheel fixed z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ left, top, width }}
      role="listbox"
      aria-label="引用素材"
    >
      <div className="border-b border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
        引用素材 · 选中后会自动连线成为本节点的输入
      </div>
      <div className="max-h-[220px] overflow-y-auto py-1">
        {candidates.length === 0 && (
          <p className="px-2.5 py-3 text-[11px] text-muted-foreground">
            画布上还没有可引用的文本、商品或图片节点。
          </p>
        )}
        {candidates.map((candidate, index) => (
          <button
            key={candidate.nodeId}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-disabled={candidate.disabled}
            disabled={candidate.disabled}
            title={candidate.reason ?? undefined}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onPick(candidate)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left text-[11px] transition-colors",
              candidate.disabled
                ? "cursor-not-allowed opacity-55"
                : "hover:bg-accent hover:text-accent-foreground",
              index === activeIndex && !candidate.disabled && "bg-accent text-accent-foreground"
            )}
          >
            <span className="flex w-full items-center gap-1.5">
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                {candidate.type === "image"
                  ? "图片"
                  : candidate.type === "product"
                    ? "商品"
                    : "文本"}
              </span>
              <span className="truncate">{candidate.title}</span>
            </span>
            {/* 灰置原因常显而非 tooltip:窄屏与触屏摸不到 hover。 */}
            {candidate.reason && (
              <span className="text-[10px] leading-tight text-muted-foreground">
                {candidate.reason}
              </span>
            )}
          </button>
        ))}
      </div>
      {onPickFromHistory && (
        <button
          type="button"
          className="w-full border-t border-border/60 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={onPickFromHistory}
        >
          从历史记录选一张图…
        </button>
      )}
    </div>,
    document.body
  );
}
