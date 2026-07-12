"use client";

/**
 * 超级画布 · 6 类白名单节点的展示元数据(P0 · S2)
 *
 * 类型顺序取自 D2 的运行时白名单 NODE_TYPES(绝不硬编码平行数组);标签/图标供左侧节点
 * 工具条与拉线建节点菜单共用。S3 真渲染另有其组件,本处仅入口展示。
 */
import {
  Image as ImageIcon,
  Layers,
  ScrollText,
  ShoppingBag,
  Type,
  Video,
  type LucideIcon,
} from "lucide-react";

import { NODE_TYPES, type CanvasNodeType } from "@/lib/canvas/schema";

const LABELS: Record<CanvasNodeType, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  product: "商品",
  script: "脚本",
  compose: "合成",
};

const ICONS: Record<CanvasNodeType, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  product: ShoppingBag,
  script: ScrollText,
  compose: Layers,
};

export interface NodeTypeItem {
  type: CanvasNodeType;
  label: string;
  Icon: LucideIcon;
}

/** 按白名单顺序的 6 类入口项。 */
export const NODE_TYPE_ITEMS: NodeTypeItem[] = NODE_TYPES.map((type) => ({
  type,
  label: LABELS[type],
  Icon: ICONS[type],
}));
