"use client";

/**
 * 超级画布 · 文本节点(P0 · S3)
 *
 * data.title 作为 P0 可编辑正文(提示词/文案载体),onChange 经 store.updateNodeData →
 * CanvasNodeDataSchema 校验回写(拒 dataURL/签名 URL)。textarea 带 nodrag/nopan;聚焦时
 * Tab 由 tab-create-policy 判为交互控件不建节点。只读时只读展示。
 */
import { memo } from "react";
import { Type } from "lucide-react";
import type { NodeProps } from "@xyflow/react";

import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import { useCanvasReadOnly, useCanvasStore } from "@/stores/canvas-store";

import { NodeShell } from "./node-shell";

export const TextNode = memo(function TextNode({
  id,
  data,
  selected,
}: NodeProps<CanvasReactFlowNode>) {
  const readOnly = useCanvasReadOnly();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const title = typeof data?.title === "string" ? data.title : "";

  return (
    <NodeShell nodeId={id} label="文本" Icon={Type} selected={selected}>
      <textarea
        className="nodrag nopan block w-full resize-none rounded border border-border bg-background/60 px-2 py-1 text-xs leading-relaxed text-foreground outline-none focus:border-ring"
        rows={3}
        maxLength={2000}
        value={title}
        placeholder="输入文案 / 提示词…"
        readOnly={readOnly}
        onChange={(event) => updateNodeData(id, { title: event.target.value })}
      />
    </NodeShell>
  );
});
