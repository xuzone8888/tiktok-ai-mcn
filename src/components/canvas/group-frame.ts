/**
 * 超级画布 · 成组视图投影(P0 · S4,纯函数)
 *
 * 组框是**纯视图投影**:从领域 groups + 成员节点 position(及纯视图 dimensionsById)现算包围盒,产出
 * 不可选/拖/连/删、指针穿透、zIndex 更低(画在成员之后/背面)的 `__group` RF 视图节点。**绝不**把 RF
 * parent/measured/selected/尺寸写回领域文档;组的唯一真相仍是 group.node_ids ↔ node.group_id。
 *
 * RF 节点 id 用稳定前缀 `__group:<groupId>`(schema 不保证跨 entity id 不碰撞,故不能直接用 group.id
 * 当 RF id,否则可能与同 id 的领域节点撞车)。成员随节点拖动/测量实时重算跟随。
 */
import type { Node } from "@xyflow/react";

import type { CanvasGroup, CanvasPosition } from "@/lib/canvas/schema";

/** 组框 RF 视图类型(非领域白名单,纯视图,绝不入持久化)。 */
export const GROUP_FRAME_TYPE = "__group" as const;
/** 组框 RF 节点 id 前缀(与领域 node id 隔离,防跨 entity 碰撞)。 */
export const GROUP_FRAME_ID_PREFIX = "__group:";

/**
 * 合成组框 RF 节点 id。基础 id = `__group:<groupId>`。传入 `occupied`(真实 node id + 同批已分配 frame id)
 * 时做**确定性避碰**:基础被占则按 `:1`、`:2`… 递增到首个空位。occupied 有限,鸽巢保证 occupied.size+1 个
 * 候选中必有空位,循环必终止。无参调用保持原有简单语义(直接返回基础 id),既有调用不受影响。
 */
export function groupFrameNodeId(groupId: string, occupied?: ReadonlySet<string>): string {
  const base = `${GROUP_FRAME_ID_PREFIX}${groupId}`;
  if (!occupied || !occupied.has(base)) return base;
  for (let suffix = 1; suffix <= occupied.size + 1; suffix += 1) {
    const candidate = `${base}:${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  // 理论不可达(occupied.size+1 个候选中必有空位);兜底返回确定值以满足类型系统。
  return `${base}:${occupied.size + 1}`;
}

/** 成员卡片兜底尺寸(与 NodeShell 宽度一致 + 略高冗余;仅在缺真实测量尺寸时用)+ 组框内边距。 */
const NODE_WIDTH_FALLBACK = 208;
const NODE_HEIGHT_FALLBACK = 112;
const FRAME_PADDING = 20;
/** 组框 zIndex:低于成员(成员默认 0),保证背景边框不遮节点。 */
const FRAME_Z_INDEX = -1;

export interface GroupFrameData extends Record<string, unknown> {
  label: string;
  count: number;
}

/** 纯视图尺寸(来自 RF measured/width/height),绝不写回 doc;缺失时回退兜底尺寸。 */
export interface GroupFrameDimensions {
  width?: number;
  height?: number;
}

interface FramePositionSource {
  id: string;
  position: CanvasPosition;
}

function finiteDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * groups → __group 视图节点数组。只对**至少含一个在场成员**的组产框;成员坐标缺失的组跳过。
 * 每个成员优先用 dimensionsById[id] 的真实有限尺寸(避免高文本/媒体节点被截断),仅缺失时回退兜底。
 * position=包围盒左上角,尺寸经 style.width/height 注入,pointerEvents:none 使其永不拦截交互。
 */
export function projectGroupFrames(
  groups: readonly CanvasGroup[],
  nodes: readonly FramePositionSource[],
  dimensionsById: Record<string, GroupFrameDimensions> = {}
): Node<GroupFrameData>[] {
  const posById = new Map(nodes.map((node) => [node.id, node.position] as const));
  // 合成 frame id 必须与**真实 node id**、以及**同批已分配 frame id** 全不碰撞(RF 要求全局唯一 node id)。
  // 从真实 nodes 建占用集,每分配一个 frame id 即登记 → 同批 frame 互避。
  const occupied = new Set(nodes.map((node) => node.id));
  const frames: Node<GroupFrameData>[] = [];

  // 碰撞避让的**分配顺序**必须由 canonical group-id 字典序决定,而非传入数组顺序 —— 否则 remove→undo 把组
  // append 到末尾改变数组序,会让同一 group 的 synthetic frame id 漂移。复制后排序(不改传入数组),分配与
  // 输出都按此 canonical 序,故 frame id 与历史数组顺序完全无关(确定性,无随机/持久化/副作用)。group id
  // 由 schema 保证唯一,无同键;字典序为 UTF-16 code unit 稳定序。
  const orderedGroups = [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const group of orderedGroups) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let present = 0;

    for (const memberId of group.node_ids) {
      const position = posById.get(memberId);
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      const dims = dimensionsById[memberId];
      const width = finiteDimension(dims?.width, NODE_WIDTH_FALLBACK);
      const height = finiteDimension(dims?.height, NODE_HEIGHT_FALLBACK);
      present += 1;
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + width);
      maxY = Math.max(maxY, position.y + height);
    }
    if (present === 0) continue;

    const frameId = groupFrameNodeId(group.id, occupied);
    occupied.add(frameId); // 登记本次分配 → 后续 group 的 frame 与之互避(同批稳定唯一)
    frames.push({
      id: frameId,
      type: GROUP_FRAME_TYPE,
      position: { x: minX - FRAME_PADDING, y: minY - FRAME_PADDING },
      data: { label: group.label, count: present },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      zIndex: FRAME_Z_INDEX,
      style: {
        width: maxX - minX + FRAME_PADDING * 2,
        height: maxY - minY + FRAME_PADDING * 2,
        pointerEvents: "none",
      },
    });
  }
  return frames;
}
