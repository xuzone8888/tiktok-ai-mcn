/**
 * 超级画布 · 节点级补丁保存协议(P0 / D3)。
 *
 * 自动保存 = 对 doc 拓扑(nodes/edges/groups)发**实体级 op**,而非整包覆盖。
 * 三种 op 语义(与 CLAUDE.md 铁律#2「画布文档只存引用」正交,纯拓扑变更):
 *   - `add(value)`            新增实体
 *   - `update(base, next)`    把某实体从 base 改成 next(base=客户端最后已知的服务端值)
 *   - `remove(base)`          删除某实体(base=客户端最后已知的服务端值)
 *
 * 服务端把补丁**应用到当前库内文档**(不是客户端的 base),由此得到确定性的
 * 幂等 / rebase / 冲突判定(纯函数 {@link applyPatch}):
 *   - 当前值 === next(update)/ 目标已缺失(remove) → **幂等 no-op**(重放安全)
 *   - 当前值 === base                              → **非重叠 rebase**,应用
 *   - 其余                                          → **冲突**(409,附诊断),绝不盲目覆盖
 *
 * 引用完整性(悬空连线 / 成组成员 / group_id 双向一致)**不在 apply 层兜**——
 * apply 只做逐实体拓扑变更,最终由路由用严格 `CanvasDocSchema` + 容错 `loadCanvasDoc`
 * 双校验兜底(违反 → 422),从而保持 apply 的确定性与无隐藏级联。
 *
 * 纯类型 + 纯函数 + zod,无 IO,可被服务端路由与客户端离线队列共同 import。
 */
import { z } from "zod";
import {
  CanvasNodeSchema,
  CanvasEdgeSchema,
  CanvasGroupSchema,
  CanvasRevisionSchema,
  CanvasDepsSchema,
  type CanvasNode,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasDoc,
} from "./schema";

export const CANVAS_ENTITY_KINDS = ["node", "edge", "group"] as const;
export type CanvasEntityKind = (typeof CANVAS_ENTITY_KINDS)[number];

export const CANVAS_OP_TYPES = ["add", "update", "remove"] as const;
export type CanvasOpType = (typeof CANVAS_OP_TYPES)[number];

/** 单个补丁最多携带多少 op(防滥用 / 防 DOS;正常自动保存远小于此)。 */
export const CANVAS_PATCH_MAX_OPS = 2000;

/** 三类实体共有的值类型(op 的 value/base/next 之一)。 */
export type CanvasEntityValue = CanvasNode | CanvasEdge | CanvasGroup;

/**
 * 为某一实体类型产出 add/update/remove 三个严格 op schema。
 * update 强制 `base.id === next.id`——改 id 必须表达成 remove+add,不能借 update 偷换。
 * 严格对象(strictObject)天然拒绝 RF 视图字段混入(与 CanvasNodeSchema 同一纪律)。
 */
function entityOps<K extends CanvasEntityKind, S extends z.ZodTypeAny>(kind: K, schema: S) {
  const add = z.strictObject({ entity: z.literal(kind), op: z.literal("add"), value: schema });
  const update = z
    .strictObject({ entity: z.literal(kind), op: z.literal("update"), base: schema, next: schema })
    .superRefine((value, ctx) => {
      // 泛型 S 下 zod 不透出 base/next 的属性形状,显式窄化到已知实体结构(恒含 id)。
      const { base, next } = value as unknown as { base: { id: string }; next: { id: string } };
      if (base.id !== next.id) {
        ctx.addIssue({
          code: "custom",
          path: ["next", "id"],
          message: "update 不可改实体 id(改 id 需 remove 旧 + add 新)",
        });
      }
    });
  const remove = z.strictObject({ entity: z.literal(kind), op: z.literal("remove"), base: schema });
  return [add, update, remove] as const;
}

/** 全部 9 个 op 变体的联合。zod 逐个尝试;`entity`+`op` 两枚举字段唯一定位分支。 */
export const CanvasOpSchema = z.union([
  ...entityOps("node", CanvasNodeSchema),
  ...entityOps("edge", CanvasEdgeSchema),
  ...entityOps("group", CanvasGroupSchema),
]);
export type CanvasOp = z.infer<typeof CanvasOpSchema>;

/** 补丁的 op 数组(带上限)。路由单独校验它以便回稳定错误码 INVALID_OPS。 */
export const CanvasOpsArraySchema = z.array(CanvasOpSchema).max(CANVAS_PATCH_MAX_OPS);

/**
 * PATCH 请求体线上契约:CAS 锚 baseRev + op 数组 + 可选 title/deps 整列替换。
 * deps 是独立 DB 列、非 op-log 对象,故整体替换而非打补丁(体积小、无并发热点)。
 */
export const CanvasPatchRequestSchema = z.strictObject({
  baseRev: CanvasRevisionSchema,
  ops: CanvasOpsArraySchema,
  title: z.string().min(1).max(200).optional(),
  deps: CanvasDepsSchema.optional(),
});
export type CanvasPatchRequest = z.infer<typeof CanvasPatchRequestSchema>;

/** 取 op 的目标实体 id(add 取 value,update 取 next==base,remove 取 base)。 */
export function opTargetId(op: CanvasOp): string {
  if (op.op === "add") return op.value.id;
  if (op.op === "update") return op.next.id;
  return op.base.id;
}

/** op 分组键:实体类型 + id(coalesce/apply 按此聚合)。 */
export function opKey(op: CanvasOp): string {
  return `${op.entity}:${opTargetId(op)}`;
}

/**
 * 结构化深比较——对象键序无关、数组序敏感、无 NaN(schema 保证有限数值)。
 * 用于幂等/冲突判定与 coalesce 的净变化收敛。base/next/当前值均经同一 zod 归一化,
 * 因此默认字段(refs/group_id 等)在两侧一致,可安全逐字段比较。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) return false;
  if (aArray && bArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
    if (!deepEqual(ao[key], bo[key])) return false;
  }
  return true;
}

/**
 * 从 (origin, final) 合成净 op。origin=序列开始时该实体在服务端的值(undefined=不存在),
 * final=一串本地编辑后的目标值(undefined=删除)。四种组合:
 *   ∅→v: add / ∅→∅: 无(add 后又 remove,抵消) / v→∅: remove / v→v': update 或(相等则)无。
 */
function netOp(
  entity: CanvasEntityKind,
  origin: CanvasEntityValue | undefined,
  final: CanvasEntityValue | undefined
): CanvasOp | null {
  if (origin === undefined && final === undefined) return null;
  if (origin === undefined) {
    // final 必非空(上一分支已排除双空)。
    return { entity, op: "add", value: final as CanvasEntityValue } as CanvasOp;
  }
  if (final === undefined) {
    return { entity, op: "remove", base: origin } as CanvasOp;
  }
  if (deepEqual(origin, final)) return null;
  return { entity, op: "update", base: origin, next: final } as CanvasOp;
}

interface CoalesceAcc {
  entity: CanvasEntityKind;
  origin: CanvasEntityValue | undefined;
  final: CanvasEntityValue | undefined;
  order: number;
}

/**
 * 确定性 coalesce:把作用于同一实体的一串 op 折叠成**单个净 op**。
 * - 首个 op 确立 origin(add→∅;update/remove→其 base);后续 op 只推进 final。
 * - 输出保持各实体**首次出现顺序**,同一输入恒产出同一输出(可用于快照对账)。
 * - 抵消(add 后 remove、update 回原值)直接消失,不进线上补丁。
 * 服务端应用前、客户端离线队列出队前都跑它,收敛重复编辑、缩小补丁体积。
 */
export function coalesce(ops: CanvasOp[]): CanvasOp[] {
  const map = new Map<string, CoalesceAcc>();
  let order = 0;
  for (const op of ops) {
    const key = opKey(op);
    let acc = map.get(key);
    if (!acc) {
      const origin = op.op === "add" ? undefined : op.base;
      acc = { entity: op.entity, origin, final: undefined, order: (order += 1) };
      map.set(key, acc);
    }
    if (op.op === "add") acc.final = op.value;
    else if (op.op === "update") acc.final = op.next;
    else acc.final = undefined;
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order)
    .map((acc) => netOp(acc.entity, acc.origin, acc.final))
    .filter((op): op is CanvasOp => op !== null);
}

export type CanvasConflictReason =
  | "add-exists-different"
  | "update-target-missing"
  | "update-base-mismatch"
  | "remove-base-mismatch";

/** ENTITY_CONFLICT 时逐 op 的可诊断冲突项(经 api-types 挂进错误 details.conflicts)。 */
export interface CanvasPatchConflict {
  entity: CanvasEntityKind;
  id: string;
  op: CanvasOpType;
  reason: CanvasConflictReason;
  message: string;
}

export type ApplyPatchResult =
  | { ok: true; doc: CanvasDoc; applied: number; noop: number }
  | { ok: false; conflicts: CanvasPatchConflict[] };

function conflict(
  entity: CanvasEntityKind,
  id: string,
  op: CanvasOpType,
  reason: CanvasConflictReason,
  message: string
): CanvasPatchConflict {
  return { entity, id, op, reason, message };
}

/**
 * 纯应用:把(已 coalesce 的)op 逐个作用到**当前**文档,产出新文档 + 幂等/应用计数,
 * 或返回一份冲突清单。不修改入参 doc(实体对象按引用复用,从不原地改)。
 *
 * 判定矩阵(current=库内当前实体):
 *   add:    ∅→写入 | current==value→no-op | 否则冲突(已存在且不同)
 *   update: ∅→冲突(目标已删) | current==next→no-op | current==base→写入 next | 否则冲突(重叠)
 *   remove: ∅→no-op(已删) | current==base→删除 | 否则冲突(重叠)
 *
 * Map 保序:set 既有键保留原位、set 新键追加末尾、delete 移除——最终数组顺序稳定。
 * 类型上三 Map 统一存 CanvasEntityValue;op.entity 判别保证同类,末尾数组按类回收断言。
 */
export function applyPatch(doc: CanvasDoc, ops: CanvasOp[]): ApplyPatchResult {
  const nodes = new Map<string, CanvasEntityValue>(doc.nodes.map((n) => [n.id, n]));
  const edges = new Map<string, CanvasEntityValue>(doc.edges.map((e) => [e.id, e]));
  const groups = new Map<string, CanvasEntityValue>(doc.groups.map((g) => [g.id, g]));
  const pick = (entity: CanvasEntityKind): Map<string, CanvasEntityValue> =>
    entity === "node" ? nodes : entity === "edge" ? edges : groups;

  const conflicts: CanvasPatchConflict[] = [];
  let applied = 0;
  let noop = 0;

  for (const op of ops) {
    const id = opTargetId(op);
    const map = pick(op.entity);
    const current = map.get(id);
    if (op.op === "add") {
      if (current === undefined) {
        map.set(id, op.value);
        applied += 1;
      } else if (deepEqual(current, op.value)) {
        noop += 1;
      } else {
        conflicts.push(
          conflict(op.entity, id, "add", "add-exists-different", "实体已存在且与 add 值不同")
        );
      }
    } else if (op.op === "update") {
      if (current === undefined) {
        conflicts.push(
          conflict(op.entity, id, "update", "update-target-missing", "更新目标已被删除")
        );
      } else if (deepEqual(current, op.next)) {
        noop += 1;
      } else if (deepEqual(current, op.base)) {
        map.set(id, op.next);
        applied += 1;
      } else {
        conflicts.push(
          conflict(op.entity, id, "update", "update-base-mismatch", "更新基线与当前值不一致(重叠修改)")
        );
      }
    } else {
      if (current === undefined) {
        noop += 1;
      } else if (deepEqual(current, op.base)) {
        map.delete(id);
        applied += 1;
      } else {
        conflicts.push(
          conflict(op.entity, id, "remove", "remove-base-mismatch", "删除基线与当前值不一致(重叠修改)")
        );
      }
    }
  }

  if (conflicts.length) return { ok: false, conflicts };
  return {
    ok: true,
    doc: {
      nodes: [...nodes.values()] as CanvasNode[],
      edges: [...edges.values()] as CanvasEdge[],
      groups: [...groups.values()] as CanvasGroup[],
    },
    applied,
    noop,
  };
}
