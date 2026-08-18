"use client";

/**
 * 超级画布 · 脚本/合成节点(只做旧文档兼容读取,不在公开创建入口出现)
 *
 * ⚠️ **商品节点已迁出到 `./product-node.tsx`**(CHECKLIST #67:上传图 + 卖点卡 +
 * 低 zoom 降级,已经不是一张"引用摘要卡")。这里保留的 `referenceSummary` 仍带
 * `product` 分支,是给**旧文档**里那些没有任何内容的商品节点兜底用的。
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

export const ScriptNode = makeReferenceNode("script");
export const ComposeNode = makeReferenceNode("compose");
