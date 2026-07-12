/**
 * 超级画布 · 节点类型注册表(P0 · S1 接缝)
 *
 * 以 schema.ts 的运行时白名单 NODE_TYPES 为唯一键源(绝不硬编码 6 类字符串数组),
 * S1 全部映射到通用 PlaceholderNode。S3 逐类替换为真渲染器时,只改本表的值,
 * PlaceholderNode 保留为未知/兜底渲染。nodeTypes 为模块级稳定引用,避免 React Flow 重渲告警。
 */
import type { NodeTypes } from "@xyflow/react";

import { NODE_TYPES } from "@/lib/canvas/schema";

import { PlaceholderNode } from "./nodes/placeholder-node";

export const canvasNodeTypes: NodeTypes = Object.fromEntries(
  NODE_TYPES.map((type) => [type, PlaceholderNode])
);
