/**
 * 超级画布 · 空态 / 底部工具栏 门控策略(P0 · S5,纯逻辑)
 *
 * 纯配置 + 判定,供空态引导与底部工具栏消费,并可离线单测。空态只在真空(无领域节点、无
 * broken 实体)时显示 4 个 P0 真节点起点引导;底部工具栏列 8 个入口,点亮已有的
 * 「添加节点」「上传素材」「快捷键」「历史记录」,其余未来入口 disabled(不写开发状态/操作说明)。
 */
import type { CanvasNodeType } from "@/lib/canvas/schema";

/** 空态门控:仅当没有领域节点且没有 broken 实体时,显示起点引导。 */
export function shouldShowEmptyState(nodeCount: number, brokenCount: number): boolean {
  return nodeCount === 0 && brokenCount === 0;
}

/** 可发布 P1 起点:提示词、商品信息、图片与视频。 */
export const EMPTY_STATE_GUIDE_TYPES: readonly CanvasNodeType[] = [
  "text",
  "product",
  "image",
  "video",
];

export type BottomToolbarAction =
  | "add-node"
  | "upload"
  | "workflow"
  | "assets"
  | "characters"
  | "history"
  | "shortcuts"
  | "tutorial";

export interface BottomToolbarEntry {
  id: BottomToolbarAction;
  label: string;
  /** P0 是否点亮;未点亮者 disabled 但不显示开发状态。 */
  enabled: boolean;
}

/** 看板入口(顺序即渲染顺序);点亮 add-node、upload、history 与 shortcuts。 */
export const BOTTOM_TOOLBAR_ENTRIES: readonly BottomToolbarEntry[] = [
  { id: "add-node", label: "添加节点", enabled: true },
  { id: "upload", label: "上传素材", enabled: true },
  { id: "workflow", label: "工作流", enabled: false },
  { id: "assets", label: "素材库", enabled: false },
  { id: "characters", label: "角色库", enabled: false },
  { id: "history", label: "历史记录", enabled: true },
  { id: "shortcuts", label: "快捷键", enabled: true },
  { id: "tutorial", label: "教程", enabled: false },
];
