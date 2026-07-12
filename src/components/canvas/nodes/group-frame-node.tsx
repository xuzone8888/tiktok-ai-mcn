"use client";

/**
 * 超级画布 · 成组组框(P0 · S4,纯视图)
 *
 * 渲染 group-frame.ts 投影出的 `__group` 视图节点:一圈虚线框 + 左上角标签胶囊(组名/成员数)。
 * 整体指针穿透(pointer-events:none,由投影 style 注入 + 本组件不接任何交互),**不可**选/拖/连/删——
 * 解组走键盘 Ctrl/Alt+Shift+G。绝不承载领域数据,绝不写回文档。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { GroupFrameData } from "../group-frame";

export const GroupFrameNode = memo(function GroupFrameNode({ data }: NodeProps) {
  const frame = (data ?? {}) as Partial<GroupFrameData>;
  const label = typeof frame.label === "string" && frame.label.trim() ? frame.label : "成组";
  const count = typeof frame.count === "number" ? frame.count : 0;

  return (
    <div className="pointer-events-none h-full w-full rounded-xl border border-dashed border-ring/50 bg-ring/5">
      <span className="absolute -top-2.5 left-3 inline-flex items-center gap-1 rounded-full border border-ring/40 bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
        {label}
        <span className="text-muted-foreground/70">· {count}</span>
      </span>
    </div>
  );
});
