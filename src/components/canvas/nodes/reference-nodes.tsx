"use client";

/**
 * 超级画布 · 商品/脚本/合成节点
 *
 * 商品节点是 P1 的轻量商品简报，可作为相连图片/视频节点的提示词输入。
 * 脚本与合成节点仍只负责兼容读取旧文档，不在公开创建入口出现。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import type { CanvasNodeData, CanvasNodeType } from "@/lib/canvas/schema";
import { useCanvasReadOnly, useCanvasStore } from "@/stores/canvas-store";

import { NODE_TYPE_ITEMS } from "../node-type-meta";
import { NodeShell } from "./node-shell";

type ReferenceNodeType = Extract<CanvasNodeType, "product" | "script" | "compose">;

/** 引用摘要:只读 data 里的引用 id,不做任何 URL 解析;空态为中性文案。 */
function referenceSummary(type: ReferenceNodeType, data: CanvasNodeData | undefined): string {
  const refs = data?.refs;
  switch (type) {
    case "product":
      return refs?.assetId ? `商品 · ${refs.assetId}` : "暂无商品";
    case "script":
      return refs?.blueprintId
        ? `脚本 · ${refs.blueprintId}`
        : "脚本工作流暂未开放，旧节点仅供查看";
    case "compose":
      return "合成工作流暂未开放，旧节点仅供查看";
    default:
      return "暂无内容";
  }
}

function metaFor(type: CanvasNodeType) {
  return NODE_TYPE_ITEMS.find((item) => item.type === type) ?? NODE_TYPE_ITEMS[0];
}

function makeReferenceNode(type: ReferenceNodeType) {
  const { label, Icon } = metaFor(type);
  const Component = memo(function ReferenceNode({
    id,
    data,
    selected,
  }: NodeProps<CanvasReactFlowNode>) {
    const summary = referenceSummary(type, data);
    return (
      <NodeShell nodeId={id} label={label} Icon={Icon} selected={selected}>
        <div className="truncate text-[11px] text-muted-foreground" title={summary}>
          {summary}
        </div>
      </NodeShell>
    );
  });
  Component.displayName = `${type}Node`;
  return Component;
}

export const ProductNode = memo(function ProductNode({
  id,
  data,
  selected,
}: NodeProps<CanvasReactFlowNode>) {
  const { label, Icon } = metaFor("product");
  const readOnly = useCanvasReadOnly();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const commitTextEdit = useCanvasStore((state) => state.commitTextEdit);
  const brief = typeof data?.title === "string" ? data.title : "";

  return (
    <NodeShell nodeId={id} label={label} Icon={Icon} selected={selected}>
      <textarea
        className="nodrag nopan block w-full resize-none rounded border border-border bg-background/60 px-2 py-1 text-xs leading-relaxed text-foreground outline-none focus:border-ring"
        rows={4}
        maxLength={2000}
        value={brief}
        placeholder="填写商品名称、卖点、材质、受众与使用场景…"
        readOnly={readOnly}
        aria-label="商品简报"
        onChange={(event) => updateNodeData(id, { title: event.target.value })}
        onBlur={() => commitTextEdit()}
      />
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        连接到图片或视频节点后，将作为生成上下文。
      </p>
    </NodeShell>
  );
});

export const ScriptNode = makeReferenceNode("script");
export const ComposeNode = makeReferenceNode("compose");
