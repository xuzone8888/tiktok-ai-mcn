/**
 * 超级画布 · 响应式布局策略(P0 · S6,#33 最小适配)
 *
 * 1366×768 是走查 DoD 的最小分辨率。本模块把「窄屏适配」拆成可离线单测的**纯策略**,供画布壳消费:
 *   - isCompactViewport:是否窄屏(≤1366),侧栏走图标态、生成面板停靠底部的总闸;
 *   - shouldExpandMinimap:仅足够宽(>1440)才自动展开小地图,窄屏默认收起(1366×768 条款);
 *   - resolveGenerationPanelDock:生成面板超视口/窄屏 → dock 底部(P0 落机制,P1 生成面板消费);
 *   - planCapsuleCollapse:参数胶囊 ≥5 自动折叠「更多」(P0 落机制,P1 生成器参数消费);
 *   - LOW_ZOOM_MEDIA_THRESHOLD:低于此 zoom,媒体节点降级为语义色块(见 nodes/media-node.tsx)。
 *
 * P0 只落布局骨架与策略常量;生成面板/参数胶囊本体属 P1,故这里是它们的「响应式规则单一事实源」。
 * 纯逻辑、无 React/window —— 可离线单测。
 */

/** 走查 DoD 最小分辨率(CHECKLIST #33)。 */
export const MIN_SUPPORTED_WIDTH = 1366;
export const MIN_SUPPORTED_HEIGHT = 768;

/** 窄屏上限:视口宽 ≤ 此值视为紧凑布局(含 1366×768)。 */
export const COMPACT_MAX_WIDTH = 1366;

/** 小地图自动展开的最小视口宽;≤1440(含 1366)默认收起。 */
export const MINIMAP_AUTO_EXPAND_MIN_WIDTH = 1440;

/** 低于此 zoom,媒体节点不解码真实图/视频,降级为语义色块(节流解码器与内存)。 */
export const LOW_ZOOM_MEDIA_THRESHOLD = 0.4;

/** 参数胶囊数 ≥ 此阈值 → 折叠「更多」。 */
export const CAPSULE_COLLAPSE_THRESHOLD = 5;

/** 折叠时保留可见的胶囊数(其余进「更多」)。 */
export const CAPSULE_VISIBLE_WHEN_COLLAPSED = 4;

/** 生成面板 inline 悬挂允许占用的最大视口高比例;超出则 dock 底部。 */
export const GENERATION_PANEL_MAX_HEIGHT_RATIO = 0.55;

/** 视口是否紧凑(窄屏)。非有限宽按紧凑处理(fail-safe 到更保守布局)。 */
export function isCompactViewport(width: number): boolean {
  return !Number.isFinite(width) || width <= COMPACT_MAX_WIDTH;
}

/** 是否应自动展开小地图(仅足够宽)。 */
export function shouldExpandMinimap(width: number): boolean {
  return Number.isFinite(width) && width > MINIMAP_AUTO_EXPAND_MIN_WIDTH;
}

export type GenerationPanelDock = "inline" | "bottom";

/**
 * 生成面板停靠决策:窄屏、或面板高超过视口高允许比例 → dock 底部(避免超视口/遮挡);否则挂节点下方。
 * 非有限视口尺寸一律 dock 底部(最保守)。
 */
export function resolveGenerationPanelDock(input: {
  viewportWidth: number;
  viewportHeight: number;
  panelHeight: number;
}): GenerationPanelDock {
  const { viewportWidth, viewportHeight, panelHeight } = input;
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return "bottom";
  if (isCompactViewport(viewportWidth)) return "bottom";
  const maxInline = viewportHeight * GENERATION_PANEL_MAX_HEIGHT_RATIO;
  if (Number.isFinite(panelHeight) && panelHeight > maxInline) return "bottom";
  return "inline";
}

export interface CapsuleCollapsePlan {
  /** 是否折叠。 */
  collapsed: boolean;
  /** 直接可见的胶囊数。 */
  visibleCount: number;
  /** 收进「更多」的胶囊数。 */
  overflowCount: number;
}

/**
 * 胶囊折叠计划:count < 阈值 → 全展开;≥ 阈值 → 折叠,保留前 N 个可见,其余进「更多」。
 * 负数/非有限 count 归零处理。
 */
export function planCapsuleCollapse(
  count: number,
  opts?: { threshold?: number; visibleWhenCollapsed?: number }
): CapsuleCollapsePlan {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const threshold = opts?.threshold ?? CAPSULE_COLLAPSE_THRESHOLD;
  const visibleWhenCollapsed = Math.max(0, opts?.visibleWhenCollapsed ?? CAPSULE_VISIBLE_WHEN_COLLAPSED);
  if (total < threshold) {
    return { collapsed: false, visibleCount: total, overflowCount: 0 };
  }
  const visibleCount = Math.min(visibleWhenCollapsed, total);
  return { collapsed: true, visibleCount, overflowCount: total - visibleCount };
}
