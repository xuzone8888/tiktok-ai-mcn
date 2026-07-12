"use client";

/**
 * 超级画布 · 图片/视频/商品/脚本/合成 节点(P0 · S3)
 *
 * 五类非文本节点:各自可辨识(lucide 图标 + 标签 + 引用摘要),紧凑稳定尺寸,复用 NodeShell
 * 的左右 Handle 与二次确认删除。**只做真实空壳/引用摘要**——不接生成、不解析 OSS URL(S6)。
 * media 只展示 object key 的文件名,绝不当 URL 解析。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import type { CanvasNodeData, CanvasNodeType } from "@/lib/canvas/schema";

import { NODE_TYPE_ITEMS } from "../node-type-meta";
import { NodeShell } from "./node-shell";

function basename(objectKey: string): string {
  const slash = objectKey.lastIndexOf("/");
  return slash >= 0 ? objectKey.slice(slash + 1) : objectKey;
}

/** 引用摘要:只读 data 里的 object key / 引用 id,不做任何 URL 解析;空态为中性文案。 */
function referenceSummary(type: CanvasNodeType, data: CanvasNodeData | undefined): string {
  const media = data?.media;
  const refs = data?.refs;
  switch (type) {
    case "image":
      return media?.ossKey ? `图片 · ${basename(media.ossKey)}` : "暂无图片";
    case "video":
      return media?.ossKey ? `视频 · ${basename(media.ossKey)}` : "暂无视频";
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

function makeReferenceNode(type: CanvasNodeType) {
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

export const ImageNode = makeReferenceNode("image");
export const VideoNode = makeReferenceNode("video");
export const ProductNode = makeReferenceNode("product");
export const ScriptNode = makeReferenceNode("script");
export const ComposeNode = makeReferenceNode("compose");
