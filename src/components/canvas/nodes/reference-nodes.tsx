"use client";

/**
 * 超级画布 · 商品/脚本/合成 节点(P0 · S3)
 *
 * 三类引用型非媒体节点:各自可辨识(lucide 图标 + 标签 + 引用摘要),紧凑稳定尺寸,复用 NodeShell
 * 的左右 Handle 与二次确认删除。**只做真实空壳/引用摘要**——不接生成。图片/视频节点(含 S6 媒体降级
 * 与 object key→URL 解析)见 media-node.tsx。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import type { CanvasNodeData, CanvasNodeType } from "@/lib/canvas/schema";

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
      return refs?.blueprintId ? `脚本 · ${refs.blueprintId}` : "暂无脚本";
    case "compose":
      return "暂无合成内容";
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

export const ProductNode = makeReferenceNode("product");
export const ScriptNode = makeReferenceNode("script");
export const ComposeNode = makeReferenceNode("compose");
