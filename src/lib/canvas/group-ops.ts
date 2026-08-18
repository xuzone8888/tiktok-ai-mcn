/**
 * 超级画布 · 成组/解组/复制 纯变换(P0 · S4,壳工程 authored)
 *
 * 纯 doc→doc planner:输入当前 CanvasDoc + 选择集,产出**新** doc(不改入参),非法/空操作返回
 * null。核心不变量:成组严格维持 `group.node_ids` ↔ `node.group_id` **双向一致**;只对**未成组的
 * 合法领域节点**成组(≥2 个才成立);跨组策略=已属某组的节点被排除,**不隐式改动旧组**;复制用 D2
 * 工厂造**新 id**、`group_id` 置空(副本不入任何组),data 经 structuredClone **深拷解耦**(改副本任意
 * 嵌套 params 绝不污染原节点;不可克隆则原子返回 null),带线只复制**两端都在所选集合内**的合法内部
 * 边(端点都可映射→无悬空/无重复/无自环;tuple 键用 JSON.stringify,无 NUL/控制字)。broken 实体
 * 不在 doc.nodes 内,天然被排除。
 *
 * 放置说明:与 history.ts/rf-adapter.ts 同一先例(shell 落纯域变换于 lib/canvas,离线可单测,
 * 保持 store→lib 单向依赖);不含 React、只 import D2 schema 工厂与类型。
 */
import {
  createCanvasEdge,
  createCanvasGroup,
  createCanvasId,
  createCanvasNode,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasPosition,
} from "./schema";

/** 新 ID 有界碰撞重试次数(nanoid 碰撞概率极低,耗尽即原子失败,绝不产重复 id)。 */
const ID_COLLISION_RETRIES = 8;

/**
 * 对当前 doc 同类实体 id 集合做有界碰撞重试,产一个未占用的新 id 并登记;耗尽返回 null(原子失败)。
 * schema 拒重复 id,故成组/复制的新 id 必须与现存同类 id 不碰撞。
 */
function mintUniqueId(prefix: string, taken: Set<string>): string | null {
  for (let attempt = 0; attempt < ID_COLLISION_RETRIES; attempt += 1) {
    const id = createCanvasId(prefix);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  return null;
}

export interface PlanGroupResult {
  doc: CanvasDoc;
  groupId: string;
  memberIds: string[];
}

/**
 * 成组:把选择集里**未成组的合法领域节点**收进一个新组(≥2 个方成立)。
 * 跨组节点(已有 group_id)被排除,旧组一字不改。成员顺序取 doc.nodes 原序(确定性)。
 */
export function planGroupNodes(doc: CanvasDoc, nodeIds: readonly string[]): PlanGroupResult | null {
  const wanted = new Set(nodeIds);
  const memberIds = doc.nodes
    .filter((node) => wanted.has(node.id) && (node.group_id ?? null) === null)
    .map((node) => node.id);
  if (memberIds.length < 2) return null;

  const groupId = mintUniqueId("group", new Set(doc.groups.map((group) => group.id)));
  if (groupId === null) return null; // 碰撞重试耗尽 → 原子失败
  let group: CanvasGroup;
  try {
    group = createCanvasGroup({ id: groupId, nodeIds: memberIds });
  } catch {
    return null; // 工厂(zod 归一化)异常 → 原子失败,绝不抛
  }
  const memberSet = new Set(memberIds);
  const nodes = doc.nodes.map((node) =>
    memberSet.has(node.id) ? { ...node, group_id: group.id } : node
  );
  return {
    doc: { nodes, edges: doc.edges, groups: [...doc.groups, group] },
    groupId: group.id,
    memberIds,
  };
}

/**
 * 解组:解散**选择集里任一节点所属**的全部组(一次事务,不逐组);把这些组的成员 group_id 清空并
 * 删掉这些组。没有任何选中节点属于某组则返回 null(无操作)。
 */
export function planUngroupNodes(doc: CanvasDoc, nodeIds: readonly string[]): CanvasDoc | null {
  const wanted = new Set(nodeIds);
  const targetGroupIds = new Set<string>();
  for (const node of doc.nodes) {
    if (wanted.has(node.id) && node.group_id) targetGroupIds.add(node.group_id);
  }
  if (targetGroupIds.size === 0) return null;

  const nodes = doc.nodes.map((node) =>
    node.group_id && targetGroupIds.has(node.group_id) ? { ...node, group_id: null } : node
  );
  const groups = doc.groups.filter((group) => !targetGroupIds.has(group.id));
  return { nodes, edges: doc.edges, groups };
}

export interface DuplicateOptions {
  /** 带线副本:同时复制**两端都在所选集合内**的内部边(端点重映射到副本)。 */
  withEdges: boolean;
  /** 落点策略之一:统一位移(键盘 Ctrl+D 用固定偏移)。 */
  offset?: CanvasPosition;
  /**
   * 落点策略之二:逐 id 绝对落点(拖拽复制用落点坐标);缺项回退 offset。用 **Map(推荐)** 或普通对象。
   * 安全约束(见 lookupDuplicatePosition):普通对象**仅**取自有属性(hasOwnProperty),绝不读继承原型 ——
   * 否则 id 为 "__proto__"/"constructor"/"toString" 等会读到 Object.prototype 值被误当落点(且以 record[id]=
   * 写入还会污染原型/丢精确落点)。Map 无此问题,故为首选。
   */
  positionsById?: ReadonlyMap<string, CanvasPosition> | Record<string, CanvasPosition>;
}

export interface PlanDuplicateResult {
  doc: CanvasDoc;
  newNodeIds: string[];
  newEdgeIds: string[];
}

function finitePosition(position: CanvasPosition | undefined): CanvasPosition | null {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return { x: position.x, y: position.y };
}

/** 判定 positionsById 是否为(Readonly)Map:自定义 type guard,使 else 分支确定性缩窄为普通对象(Record)。 */
function isPositionMap(
  value: ReadonlyMap<string, CanvasPosition> | Record<string, CanvasPosition>
): value is ReadonlyMap<string, CanvasPosition> {
  return value instanceof Map;
}

/**
 * 从 positionsById 安全取某 id 的绝对落点:Map 走 get;普通对象**仅**取自有属性(hasOwnProperty),绝不读
 * 继承原型(免 id="__proto__"/"constructor"/"toString" 等读到 Object.prototype 值被误当落点)。缺项 undefined。
 */
function lookupDuplicatePosition(
  positionsById: DuplicateOptions["positionsById"],
  id: string
): CanvasPosition | undefined {
  if (!positionsById) return undefined;
  if (isPositionMap(positionsById)) return positionsById.get(id);
  // type guard 已把此分支确定性缩窄为 Record;显式局部类型后再 own-property 索引(对 union 直接索引会 TS7053)。
  const record: Record<string, CanvasPosition> = positionsById;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
}

/**
 * 深拷节点 data,使副本与原节点彻底解耦(嵌套 params 也独立)。**仅** structuredClone 成功才返回;
 * 不支持 structuredClone、或 data 含不可克隆物(params 为 z.unknown(),可含 function/symbol 等)一律返回
 * null(原子失败)——绝不退化到 JSON 克隆(会静默丢函数/undefined、误调 toJSON),也绝不返回原引用。
 */
function cloneNodeData(data: CanvasNodeData): CanvasNodeData | null {
  if (typeof structuredClone !== "function") return null;
  try {
    return structuredClone(data);
  } catch {
    return null;
  }
}

/**
 * 复制节点时剥掉待恢复的生成意图(2026-08-09 R2-Q4 审计)。
 *
 * `params.generation` 存的是**一次具体提交**的 intent(含 actionId)。它随 structuredClone
 * 一起进副本后,副本会被 `deriveUnresolvedActions` 当成「也有一笔待恢复的提交」——
 * 于是复制一个提交失败的节点,就凭空多出一个会被自动恢复/引导用户重提的付费候选。
 * 意图属于原节点那一次动作,不属于副本。
 *
 * **只剥 `generation`,保留 `refs`**:refs 指向已有产物,剥掉会让副本不显示原图/原片;
 * 而没有 intent 时 `deriveUnresolvedActions` 走 `if (!intent) continue`,根本不会去读 refs。
 *
 * 具名导出是为了可 grep、可断言,并供将来的粘贴/导入路径复用。
 */
export function stripGenerationIntent(
  params: Record<string, unknown>
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(params, "generation")) return params;
  const next = { ...params };
  delete next.generation;
  return next;
}

/**
 * 复制所选节点(+可选内部连线)。副本用 D2 工厂造新 id、`group_id` 置空、data 经 structuredClone
 * **深拷解耦**后再经 schema 归一(拒 RF 视图字段/危险值);任一节点 data 不可安全克隆 → 整体返回
 * null(原子失败,不产半个副本)。落点:优先 positionsById[id],否则 原位+offset,再否则 原位+(24,24)。
 * 带线只复制两端都在所选集合内的非自环边,重映射到副本 id;tuple 键 JSON.stringify(无控制字)去重。
 */
export function planDuplicate(
  doc: CanvasDoc,
  nodeIds: readonly string[],
  opts: DuplicateOptions
): PlanDuplicateResult | null {
  const wanted = new Set(nodeIds);
  const sources = doc.nodes.filter((node) => wanted.has(node.id)); // 合法领域节点、doc 原序、去重
  if (sources.length === 0) return null;

  const fallbackOffset = finitePosition(opts.offset) ?? { x: 24, y: 24 };
  const takenNodeIds = new Set(doc.nodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  const copies: CanvasNode[] = [];
  for (const node of sources) {
    const clonedData = cloneNodeData(node.data);
    if (clonedData === null) return null; // 无法安全解耦 → 原子失败,不产半个副本
    const newNodeId = mintUniqueId("node", takenNodeIds);
    if (newNodeId === null) return null; // 碰撞重试耗尽 → 原子失败
    // 落点:优先 positionsById 绝对落点(非有限视同缺项);否则 原位+offset。相加可能溢出为 ±Infinity
    //(如 MAX_VALUE + MAX_VALUE),故对**最终** position 统一再验 finite —— 非有限即原子失败(既不产坐标
    // 非法的半份副本,也绝不抛)。
    const position =
      finitePosition(lookupDuplicatePosition(opts.positionsById, node.id)) ??
      finitePosition({
        x: node.position.x + fallbackOffset.x,
        y: node.position.y + fallbackOffset.y,
      });
    if (position === null) return null; // 落点非有限(溢出/NaN)→ 原子失败
    let copy: CanvasNode;
    try {
      copy = createCanvasNode({
        id: newNodeId,
        type: node.type,
        variant: node.variant,
        position,
        groupId: null,
        data: {
          ...(clonedData.title !== undefined ? { title: clonedData.title } : {}),
          ...(clonedData.params !== undefined
            ? { params: stripGenerationIntent(clonedData.params) }
            : {}),
          ...(clonedData.media !== undefined ? { media: clonedData.media } : {}),
          refs: clonedData.refs,
        },
      });
    } catch {
      return null; // 工厂(zod 归一化)异常 → 原子失败,不产半份副本,绝不抛
    }
    idMap.set(node.id, copy.id);
    copies.push(copy);
  }

  const edgeCopies: CanvasEdge[] = [];
  if (opts.withEdges) {
    const takenEdgeIds = new Set(doc.edges.map((edge) => edge.id));
    const seen = new Set<string>();
    for (const edge of doc.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target || source === target) continue; // 端点须都可映射、非自环
      const handleKey = JSON.stringify([
        source,
        target,
        edge.sourceHandle ?? null,
        edge.targetHandle ?? null,
      ]); // 结构键,可见 ASCII,无 NUL/控制字/歧义
      if (seen.has(handleKey)) continue; // 防重复边(理论上源图已去重)
      seen.add(handleKey);
      const newEdgeId = mintUniqueId("edge", takenEdgeIds);
      if (newEdgeId === null) return null; // 碰撞重试耗尽 → 原子失败
      let edgeCopy: CanvasEdge;
      try {
        edgeCopy = createCanvasEdge({
          id: newEdgeId,
          source,
          target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        });
      } catch {
        return null; // 工厂(zod 归一化)异常 → 原子失败,绝不抛
      }
      edgeCopies.push(edgeCopy);
    }
  }

  return {
    doc: {
      nodes: [...doc.nodes, ...copies],
      edges: [...doc.edges, ...edgeCopies],
      groups: doc.groups,
    },
    newNodeIds: copies.map((node) => node.id),
    newEdgeIds: edgeCopies.map((edge) => edge.id),
  };
}
