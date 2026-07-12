"use client";

/**
 * 超级画布 · 占位节点(P0 · S1 接缝)
 *
 * S1 只提供一个通用占位渲染,让 6 类节点都有可挂载的渲染目标 + 单一默认连接柄
 * (edge handle 为 null,S2 连线复用)。**这不是 S3 的节点空壳**:S3 会按 6 类各自实现
 * 真渲染、二次删除确认与损坏占位卡,并保留本组件为未知/兜底渲染。S1 不冒领这些。
 */
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  product: "商品",
  script: "脚本",
  compose: "合成",
};

export const PlaceholderNode = memo(function PlaceholderNode({ type, data }: NodeProps) {
  const nodeType = typeof type === "string" ? type : "text";
  const title = (data as { title?: unknown })?.title;
  const label = TYPE_LABELS[nodeType] ?? nodeType;

  return (
    <div
      className={cn(
        "min-w-[140px] max-w-[220px] rounded-lg border border-border bg-card/95 px-3 py-2 text-card-foreground shadow-sm",
        "backdrop-blur"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border !border-border !bg-muted" />
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {typeof title === "string" && title.trim() ? (
          <span className="truncate text-xs text-foreground">{title}</span>
        ) : (
          <span className="text-xs text-muted-foreground">占位节点</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border !border-border !bg-muted" />
    </div>
  );
});
