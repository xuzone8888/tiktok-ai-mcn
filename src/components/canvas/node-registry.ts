/**
 * 超级画布 · 节点类型注册表(P0 · S3)
 *
 * 领域 6 类各映射到各自可辨识组件;`__broken` 为纯视图恢复实体占位卡。用
 * `Record<CanvasNodeType, …>` 强制覆盖 D2 白名单全集——新增/删类型即编译报错,
 * 绝不硬编码平行类型数组。nodeTypes 为模块级稳定引用,避免 React Flow 重渲告警。
 */
import type { NodeTypes } from "@xyflow/react";

import { BROKEN_NODE_TYPE } from "@/lib/canvas/rf-adapter";
import type { CanvasNodeType } from "@/lib/canvas/schema";

import { BrokenNode } from "./nodes/broken-node";
import {
  ComposeNode,
  ImageNode,
  ProductNode,
  ScriptNode,
  VideoNode,
} from "./nodes/reference-nodes";
import { TextNode } from "./nodes/text-node";

// satisfies:强制 6 类白名单全覆盖(缺一即编译错),值为合法 RF 节点组件。
const domainNodeTypes = {
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  product: ProductNode,
  script: ScriptNode,
  compose: ComposeNode,
} satisfies Record<CanvasNodeType, NodeTypes[string]>;

export const canvasNodeTypes: NodeTypes = {
  ...domainNodeTypes,
  [BROKEN_NODE_TYPE]: BrokenNode,
};
