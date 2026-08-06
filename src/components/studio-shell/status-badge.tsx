"use client";

/**
 * 状态角标 - 全站唯一状态语义(STUDIO_REDESIGN_PLAN §三视觉原则 2)
 * 排队灰 / 进行蓝脉冲 / 成功绿 / 失败红 / 入库金
 */

import { cn } from "@/lib/utils";
import type { StudioJobStatus } from "@/lib/studio/batch-view";

export type StatusBadgeKind = StudioJobStatus | "library";

const STYLES: Record<StatusBadgeKind, { dot: string; text: string; label: string }> = {
  queued: { dot: "bg-zinc-400", text: "text-zinc-400", label: "排队" },
  running: { dot: "bg-sky-400 animate-pulse", text: "text-sky-400", label: "进行中" },
  success: { dot: "bg-emerald-400", text: "text-emerald-400", label: "完成" },
  failed: { dot: "bg-red-400", text: "text-red-400", label: "失败" },
  missing: { dot: "bg-zinc-600", text: "text-zinc-500", label: "已清理" },
  library: { dot: "bg-amber-400", text: "text-amber-400", label: "已入库" },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusBadgeKind;
  /** 覆盖默认文案(如细分状态「生成脚本」) */
  label?: string;
  className?: string;
}) {
  const style = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm",
        style.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {label ?? style.label}
    </span>
  );
}
