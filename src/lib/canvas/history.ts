/**
 * 超级画布 · 撤销/重做历史(P0 · S4,壳工程 authored)
 *
 * 复用 D3 的 op-log 原语(patch.ts 的 CanvasOp/applyPatch/deepEqual)与 D2 的
 * validateCanvasDoc:历史**只**存 forward/inverse 实体 op 数组(每步一对),**绝不**存整份
 * doc snapshot、绝不 persist、绝不引用生成任务。撤销=对当前 doc 应用该步 inverse;重做=应用
 * forward。两者都经 applyPatch(纯拓扑)+ validateCanvasDoc(严格结构+危险值)双关,任一失败
 * 则**原子不动**(调用方保持旧状态),从不产出半个坏 doc。
 *
 * 稳定性硬约束:所有 op 的 value/base/next 载荷在建 entry 时**深拷**(cloneCanvasEntity),
 * 因此后续对源 doc / 入参实体的突变**绝不**改变已建历史项(历史是稳定快照)。
 *
 * 类型安全:op 一律按 entity 字面量**具体构造**(每类一函数,返回 CanvasOp),不做泛型双重盲断言。
 *
 * 放置说明(与 rf-adapter.ts 同一先例,技术负责人已批):shell 把纯域变换落在
 * src/lib/canvas/(纯 TS、仅 import schema/patch,离线可单测),以保持 store→lib 单向依赖。
 */
import {
  validateCanvasDoc,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
} from "./schema";
import { applyPatch, deepEqual, type CanvasOp } from "./patch";

// 供 store 复用同一份结构化深比较(store 不直接依赖 patch.ts;统一从 history 再导出,与验证脚本模块图一致)。
export { deepEqual };

/** 撤销/重做栈容量上限(过大历史无意义且吃内存;超限丢最旧)。 */
export const CANVAS_HISTORY_LIMIT = 100;

/** 单步历史:一对方向相反的实体 op 数组(纯拓扑,无 doc snapshot;载荷已深拷)。 */
export interface HistoryEntry {
  forward: CanvasOp[];
  inverse: CanvasOp[];
}

export interface HistoryStack {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export function createEmptyHistory(): HistoryStack {
  return { past: [], future: [] };
}

/**
 * 历史载荷最终会进入 JSON 持久化文档，因此 structuredClone 能处理并不代表可接受
 * （例如 Date/Map 会被克隆，但与 patch.deepEqual 的 JSON 对象语义不一致）。这里只允许
 * JSON 可稳定表达的普通数据，并沿当前递归路径拒绝循环引用；共享但不循环的子对象允许。
 */
function isPersistableJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
  allowCanonicalNodeVariant = true
): boolean {
  try {
    if (value === null) return true;
    switch (typeof value) {
      case "string":
      case "boolean":
        return true;
      case "number":
        return Number.isFinite(value);
      case "object":
        break;
      default:
        return false;
    }

    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      const ownKeys = Reflect.ownKeys(value);

      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) return false;
        if (ownKeys.some((key) => typeof key === "symbol")) return false;
        if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) return false;

        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
          if (!isPersistableJsonValue(descriptor.value, ancestors, false)) return false;
        }

        return true;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;

      for (const key of ownKeys) {
        if (typeof key === "symbol") return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
        // CanvasNodeSchema 会规范化出可枚举的 `variant: undefined`。它是领域对象的既有
        // 可选字段表示，不是用户 params 载荷；只给形状完整的节点这一处窄例外。
        if (
          descriptor.value === undefined &&
          allowCanonicalNodeVariant &&
          key === "variant" &&
          typeof Object.getOwnPropertyDescriptor(value, "id")?.value === "string" &&
          typeof Object.getOwnPropertyDescriptor(value, "type")?.value === "string" &&
          Object.getOwnPropertyDescriptor(value, "position")?.value !== null &&
          typeof Object.getOwnPropertyDescriptor(value, "position")?.value === "object" &&
          Object.getOwnPropertyDescriptor(value, "data")?.value !== null &&
          typeof Object.getOwnPropertyDescriptor(value, "data")?.value === "object"
        ) {
          continue;
        }
        if (!isPersistableJsonValue(descriptor.value, ancestors, false)) return false;
      }

      return true;
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return false;
  }
}

/**
 * 深拷一个实体载荷,使历史项与源 doc/入参彻底解耦(稳定快照)。**仅** structuredClone 成功才返回;
 * 不支持 structuredClone、或载荷含不可克隆物(函数/symbol/抛错的 toJSON 等)一律返回 null,由调用方
 * **原子放弃**该历史项(fail-closed)——绝不退化到 JSON 克隆或返回原引用(那会让历史项与源实体共享引用,
 * 后续突变污染历史,破坏「稳定快照」硬约束)。
 */
export function cloneCanvasEntity<T>(value: T): T | null {
  if (typeof structuredClone !== "function") return null;
  if (!isPersistableJsonValue(value)) return null;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

interface EntityChanges<T> {
  added: T[];
  updated: Array<{ base: T; next: T }>;
  removed: T[];
}

/** 先克隆为已验证的普通数据再比较，避免循环/访问器载荷在 deepEqual 中递归抛错。 */
function safeEntityEqual<T>(before: T, after: T): boolean | null {
  const safeBefore = cloneCanvasEntity(before);
  const safeAfter = cloneCanvasEntity(after);
  if (safeBefore === null || safeAfter === null) return null;
  return deepEqual(safeBefore, safeAfter);
}

/** 前后数组按 id 分类为 新增/更新/删除；危险载荷在比较前 fail-closed。 */
function classifyChanges<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[]
): EntityChanges<T> | null {
  const beforeById = new Map(before.map((item) => [item.id, item] as const));
  const afterById = new Map(after.map((item) => [item.id, item] as const));
  const changes: EntityChanges<T> = { added: [], updated: [], removed: [] };
  for (const [id, next] of afterById) {
    const base = beforeById.get(id);
    if (base === undefined) changes.added.push(next);
    else {
      const equal = safeEntityEqual(base, next);
      if (equal === null) return null;
      if (!equal) changes.updated.push({ base, next });
    }
  }
  for (const [id, base] of beforeById) {
    if (!afterById.has(id)) changes.removed.push(base);
  }
  return changes;
}

// —— 按 entity 字面量具体构造 op(返回 CanvasOp,无双重断言;载荷深拷)。 ——
// 任一载荷不可安全深拷(cloneCanvasEntity→null)则**整份返回 null**,让上层原子放弃该历史项:
// 绝不产出「一半克隆、一半共享引用」的坏 op 列表。

function nodeChangeOps(
  before: readonly CanvasNode[],
  after: readonly CanvasNode[]
): CanvasOp[] | null {
  const changes = classifyChanges(before, after);
  if (changes === null) return null;
  const { added, updated, removed } = changes;
  const ops: CanvasOp[] = [];
  for (const value of added) {
    const cloned = cloneCanvasEntity(value);
    if (cloned === null) return null;
    ops.push({ entity: "node", op: "add", value: cloned });
  }
  for (const { base, next } of updated) {
    const clonedBase = cloneCanvasEntity(base);
    const clonedNext = cloneCanvasEntity(next);
    if (clonedBase === null || clonedNext === null) return null;
    ops.push({ entity: "node", op: "update", base: clonedBase, next: clonedNext });
  }
  for (const base of removed) {
    const cloned = cloneCanvasEntity(base);
    if (cloned === null) return null;
    ops.push({ entity: "node", op: "remove", base: cloned });
  }
  return ops;
}

function edgeChangeOps(
  before: readonly CanvasEdge[],
  after: readonly CanvasEdge[]
): CanvasOp[] | null {
  const changes = classifyChanges(before, after);
  if (changes === null) return null;
  const { added, updated, removed } = changes;
  const ops: CanvasOp[] = [];
  for (const value of added) {
    const cloned = cloneCanvasEntity(value);
    if (cloned === null) return null;
    ops.push({ entity: "edge", op: "add", value: cloned });
  }
  for (const { base, next } of updated) {
    const clonedBase = cloneCanvasEntity(base);
    const clonedNext = cloneCanvasEntity(next);
    if (clonedBase === null || clonedNext === null) return null;
    ops.push({ entity: "edge", op: "update", base: clonedBase, next: clonedNext });
  }
  for (const base of removed) {
    const cloned = cloneCanvasEntity(base);
    if (cloned === null) return null;
    ops.push({ entity: "edge", op: "remove", base: cloned });
  }
  return ops;
}

function groupChangeOps(
  before: readonly CanvasGroup[],
  after: readonly CanvasGroup[]
): CanvasOp[] | null {
  const changes = classifyChanges(before, after);
  if (changes === null) return null;
  const { added, updated, removed } = changes;
  const ops: CanvasOp[] = [];
  for (const value of added) {
    const cloned = cloneCanvasEntity(value);
    if (cloned === null) return null;
    ops.push({ entity: "group", op: "add", value: cloned });
  }
  for (const { base, next } of updated) {
    const clonedBase = cloneCanvasEntity(base);
    const clonedNext = cloneCanvasEntity(next);
    if (clonedBase === null || clonedNext === null) return null;
    ops.push({ entity: "group", op: "update", base: clonedBase, next: clonedNext });
  }
  for (const base of removed) {
    const cloned = cloneCanvasEntity(base);
    if (cloned === null) return null;
    ops.push({ entity: "group", op: "remove", base: cloned });
  }
  return ops;
}

/**
 * 从 (before, after) 两份 doc 合成 forward op 列表(before→after 的最小实体变更,载荷深拷)。
 * 每个 (entity,id) 至多产出一个 op —— 序列内互不相干,故对 applyPatch 顺序无关。
 * 任一实体载荷不可安全深拷 → 返回 null(调用方原子放弃)。
 * 注意:仅供 store 内**临时**求 diff(before/after 皆用后即弃),不把 doc 快照放进历史。
 */
export function diffDocs(before: CanvasDoc, after: CanvasDoc): CanvasOp[] | null {
  const nodeOps = nodeChangeOps(before.nodes, after.nodes);
  if (nodeOps === null) return null;
  const edgeOps = edgeChangeOps(before.edges, after.edges);
  if (edgeOps === null) return null;
  const groupOps = groupChangeOps(before.groups, after.groups);
  if (groupOps === null) return null;
  return [...nodeOps, ...edgeOps, ...groupOps];
}

/**
 * 组一步历史:forward=diff(before→after),inverse=diff(after→before)。
 * 无净变化(forward 为空)→ 返回 null,调用方据此不入栈(空动作不污染历史)。
 * 任一方向的任一载荷不可安全深拷(diffDocs→null)→ 返回 null,调用方**原子放弃**(store 不改 doc/history)。
 */
export function makeHistoryEntry(before: CanvasDoc, after: CanvasDoc): HistoryEntry | null {
  const forward = diffDocs(before, after);
  if (forward === null) return null; // 载荷不可深拷 → 原子放弃
  if (forward.length === 0) return null; // 无净变化
  const inverse = diffDocs(after, before);
  if (inverse === null) return null; // 载荷不可深拷 → 原子放弃(不产单向历史项)
  return { forward, inverse };
}

/**
 * 单节点前后值 → 一对 forward/inverse node op(按 "node" 字面量具体构造,载荷深拷)。供**最小实体
 * 锚**(文本会话/拖动)按涉及节点逐个建项,绝不快照整份 doc。返回三态:
 *   - null:both 缺 / 相等 → 无变化,调用方**跳过**该节点;
 *   - { aborted: true }:某载荷不可安全深拷 → 调用方**原子放弃**整份 entry(不把该节点当作无变化吞掉);
 *   - { forward, inverse }:正常一对 op(forward/inverse 各自独立深拷,互不共享引用)。
 */
type NodeOpPair = { forward: CanvasOp; inverse: CanvasOp } | { aborted: true } | null;

function nodeOpPair(
  before: CanvasNode | undefined,
  after: CanvasNode | undefined
): NodeOpPair {
  if (!before) {
    if (!after) return null;
    const value = cloneCanvasEntity(after);
    const base = cloneCanvasEntity(after);
    if (value === null || base === null) return { aborted: true };
    return {
      forward: { entity: "node", op: "add", value },
      inverse: { entity: "node", op: "remove", base },
    };
  }
  if (!after) {
    const base = cloneCanvasEntity(before);
    const value = cloneCanvasEntity(before);
    if (base === null || value === null) return { aborted: true };
    return {
      forward: { entity: "node", op: "remove", base },
      inverse: { entity: "node", op: "add", value },
    };
  }
  const forwardBase = cloneCanvasEntity(before);
  const forwardNext = cloneCanvasEntity(after);
  if (forwardBase === null || forwardNext === null) return { aborted: true };
  if (deepEqual(forwardBase, forwardNext)) return null;
  const inverseBase = cloneCanvasEntity(after);
  const inverseNext = cloneCanvasEntity(before);
  if (inverseBase === null || inverseNext === null) return { aborted: true };
  return {
    forward: { entity: "node", op: "update", base: forwardBase, next: forwardNext },
    inverse: { entity: "node", op: "update", base: inverseBase, next: inverseNext },
  };
}

/**
 * 由一组「节点前后值」建一个历史项(文本会话/多节点拖动共用):每个变化的节点产一对 update/add/remove
 * op,合并成**一个** entry(载荷深拷、稳定)。无任何净变化 → null。任一节点载荷不可安全深拷 → 原子放弃
 * 整份 entry 返回 null(store 据此不改 doc/history)。**不涉及整 doc 快照。**
 */
export function makeNodeUpdateEntry(
  pairs: ReadonlyArray<{ before: CanvasNode | undefined; after: CanvasNode | undefined }>
): HistoryEntry | null {
  const forward: CanvasOp[] = [];
  const inverse: CanvasOp[] = [];
  for (const { before, after } of pairs) {
    const pair = nodeOpPair(before, after);
    if (pair === null) continue; // 无变化 → 跳过
    if ("aborted" in pair) return null; // 载荷不可深拷 → 原子放弃整份 entry
    forward.push(pair.forward);
    inverse.push(pair.inverse);
  }
  return forward.length ? { forward, inverse } : null;
}

/**
 * 入栈一步用户变更:追加 past、清空 future(新分支使 redo 失效)、容量截顶(丢最旧)。
 * limit 非有限/负 → 回退默认上限(否则负 limit 会致 while 死循环)。纯函数,返回新栈。
 */
export function pushHistory(
  stack: HistoryStack,
  entry: HistoryEntry,
  limit: number = CANVAS_HISTORY_LIMIT
): HistoryStack {
  const cap = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : CANVAS_HISTORY_LIMIT;
  const past = [...stack.past, entry];
  while (past.length > cap) past.shift();
  return { past, future: [] };
}

export type ApplyOpsResult =
  | { ok: true; doc: CanvasDoc }
  | { ok: false; reason: string };

/**
 * 把一组 op 原子地应用到当前 doc:applyPatch(冲突→失败)后 validateCanvasDoc(结构/引用/危险值
 * →失败)。任一失败返回 { ok:false },**不产出任何 doc**——调用方据此保持旧状态(原子不动)。
 * 成功返回**经 zod 归一化**的 doc(规范化、无 RF 视图字段、无 dataURL/签名 URL)。
 */
export function applyOpsToDoc(doc: CanvasDoc, ops: CanvasOp[]): ApplyOpsResult {
  let patched: ReturnType<typeof applyPatch>;
  try {
    patched = applyPatch(doc, ops);
  } catch {
    return { ok: false, reason: "op 应用异常" };
  }
  if (!patched.ok) {
    return { ok: false, reason: `op 冲突:${patched.conflicts.map((c) => c.reason).join(", ")}` };
  }
  const validated = validateCanvasDoc(patched.doc);
  if (!validated.ok || validated.data === null) {
    return { ok: false, reason: `校验失败:${validated.errors.join("; ")}` };
  }
  // Zod 的 unknown params 可能仍与 op 载荷共享引用；逐实体再克隆一次，确保重放结果
  // 与历史 entry 完全解耦，调用方后续修改结果文档不会污染 forward/inverse。
  const nodes = validated.data.nodes.map((node) => cloneCanvasEntity(node));
  const edges = validated.data.edges.map((edge) => cloneCanvasEntity(edge));
  const groups = validated.data.groups.map((group) => cloneCanvasEntity(group));
  if (
    nodes.some((node) => node === null) ||
    edges.some((edge) => edge === null) ||
    groups.some((group) => group === null)
  ) {
    return { ok: false, reason: "校验后载荷不可安全克隆" };
  }
  return {
    ok: true,
    doc: {
      nodes: nodes as CanvasNode[],
      edges: edges as CanvasEdge[],
      groups: groups as CanvasGroup[],
    },
  };
}
