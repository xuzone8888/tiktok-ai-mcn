/**
 * 超级画布 · 文档存取 API 的**纯核心**(P0 / D3)。
 *
 * 把 PATCH 的全部判定链抽成无 IO 纯函数 {@link decidePatch},route 只保留鉴权 / 读行 /
 * CAS 写 / 组装响应。好处:幂等重放、重叠 409、非重叠 rebase、引用完整性、体积边界、
 * **存量坏档阻断**、**stale-rev 并发元数据保护**都能在 verifier 里脱离数据库直测。
 *
 * 关键恢复/并发契约(与看板裁决 5、用户合流评审一致):
 *   - 存量文档 recoveryRequired(坏实体/危险值/迁移未完成)→ **422 阻断一切写**,
 *     绝不「先 clean 再保存」覆盖原始坏实体;错误里带 recovery + clean latest,客户端可恢复。
 *   - stale rev(baseRev<storedRev)下 title/deps 无 base 无法证明非重叠 → 与当前不同即
 *     **REV_CONFLICT**;相同则视作未改。仅实体 ops 允许按 base/next rebase。
 *   - GET 容错读:返回 clean envelope + 完整 recovery 负载,坏实体原样交客户端占位可删。
 */
import { z } from "zod";
import {
  CanvasDepsSchema,
  CanvasRevisionSchema,
  CANVAS_SCHEMA_VERSION,
  createEmptyCanvasDeps,
  loadCanvasDoc,
  validateCanvasDoc,
  type CanvasDoc,
  type CanvasDeps,
  type LoadCanvasResult,
} from "./schema";
import { applyPatch, coalesce, deepEqual, type CanvasOp, type CanvasPatchConflict } from "./patch";
import { checkDocSize, computeDocBytes, type DocSizeResult } from "./doc-limits";
import {
  authorizeWriterPatch,
  CANVAS_WRITER_TAG_RE,
  WRITER_HEARTBEAT_MS,
  WRITER_LEASE_MS,
  type StoredWriterState,
} from "./writer-lock";
import { CANVAS_WRITER_ACTIONS } from "./api-types";
import type {
  CanvasApiErrorDetails,
  CanvasEnvelopeWithMeta,
  CanvasRecoveryReport,
  CanvasSizeWarning,
  CanvasTolerantEnvelope,
  CanvasTolerantEnvelopeWithMeta,
  CanvasWriterAction,
  CanvasWriterInfo,
  CanvasWriterLeaseData,
} from "./api-types";

/** 画布 id 必须是 UUID(表主键 gen_random_uuid);非 UUID 直接 INVALID_ID,避免打空查询。 */
export const CANVAS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CAS 写总尝试次数(1 次初始 + 4 次重读重试);耗尽 → REV_CONFLICT。 */
export const CANVAS_CAS_MAX_ATTEMPTS = 5;

export const CANVAS_DEFAULT_TITLE = "未命名画布";

/** POST /api/canvas 请求体严格契约:只允许 title/doc/deps,拒数组/基元/未知字段。 */
export const CanvasCreateRequestSchema = z.strictObject({
  title: z.string().max(200).optional(),
  doc: z.unknown().optional(),
  deps: z.unknown().optional(),
});
export type CanvasCreateRequest = z.infer<typeof CanvasCreateRequestSchema>;

/** 单写者 tag 严格契约(D5):`[A-Za-z0-9_-]{8,128}`,可安全内插 PostgREST `.or()` 过滤。 */
export const CanvasWriterTagSchema = z
  .string()
  .regex(CANVAS_WRITER_TAG_RE, "writer tag 非法(需 [A-Za-z0-9_-]{8,128})");

/**
 * **决策层**宽松 PATCH body(writerTag 可选)。`ops` 在此仅收为 unknown,**结构校验留第二阶段**
 * CanvasOpsArraySchema,使 op 非法回稳定的 INVALID_OPS 而非 INVALID_BODY。
 * writerTag 可选以镜像纯决策 {@link decidePatch} 的旧行为(D1–D4 单测不带 tag 仍走 legacy 分支)。
 * **注意:这不是生产路由用的 schema**——真实 PATCH 路由用 {@link CanvasPatchWriteBodySchema}
 * (强制 writerTag);本 schema 仅供决策层/纯 helper 单测,勿在任何 route 直接消费,以免绕过 D5。
 */
export const CanvasPatchBodySchema = z.strictObject({
  baseRev: CanvasRevisionSchema,
  ops: z.unknown().optional(),
  title: z.string().max(200).optional(),
  deps: CanvasDepsSchema.optional(),
  writerTag: CanvasWriterTagSchema.optional(),
});
export type CanvasPatchBody = z.infer<typeof CanvasPatchBodySchema>;

/**
 * PATCH /api/canvas/[id] **生产** write 请求体(D5 收紧,真实路由第一阶段解析用此)。
 * 与 {@link CanvasPatchBodySchema} 唯一差异:**强制 writerTag**——P0 单写者安全边界要求任何
 * 文档写都必须持合法写者标签,杜绝无 tag 绕过单写者门禁。缺 tag / tag 非法 / 未知顶层字段
 * 一律 → INVALID_BODY;`ops` 仍留第二阶段结构校验(INVALID_OPS)。
 * (纯决策 decidePatch 仍容忍省略 writerTag,仅供旧单测;真实 route/schema 永不无 tag 写。)
 */
export const CanvasPatchWriteBodySchema = z.strictObject({
  baseRev: CanvasRevisionSchema,
  ops: z.unknown().optional(),
  title: z.string().max(200).optional(),
  deps: CanvasDepsSchema.optional(),
  writerTag: CanvasWriterTagSchema,
});
export type CanvasPatchWriteBody = z.infer<typeof CanvasPatchWriteBodySchema>;

/** POST /api/canvas/[id]/writer 请求体严格契约(D5):只允许 writerTag/action,拒未知字段。 */
export const CanvasWriterRequestSchema = z.strictObject({
  writerTag: CanvasWriterTagSchema,
  action: z.enum(CANVAS_WRITER_ACTIONS),
});
export type CanvasWriterRequest = z.infer<typeof CanvasWriterRequestSchema>;

/**
 * 组装 writer 路由成功响应体(claim/heartbeat/release 共用)。`row` 为动作后**权威**
 * 写者列(release 清空后为 {null,null});`holding` = 本 tag 动作后是否持锁。
 */
export function buildWriterLeaseData(
  action: CanvasWriterAction,
  holding: boolean,
  tag: string,
  row: StoredWriterState,
  serverNowIso: string
): CanvasWriterLeaseData {
  return {
    action,
    holding,
    tag,
    writer: { tag: row.writerTag ?? null, heartbeatAt: row.writerHeartbeatAt ?? null },
    leaseMs: WRITER_LEASE_MS,
    heartbeatMs: WRITER_HEARTBEAT_MS,
    serverNow: serverNowIso,
  };
}

/** WRITER_LOCKED 错误 details(供 S7 只读横幅展示当前持有者 + 租约预算)。 */
export function writerLockedDetails(
  writer: CanvasWriterInfo,
  serverNowIso: string,
  serverRev?: number
): CanvasApiErrorDetails {
  return {
    writer,
    leaseMs: WRITER_LEASE_MS,
    heartbeatMs: WRITER_HEARTBEAT_MS,
    serverNow: serverNowIso,
    ...(serverRev !== undefined ? { serverRev } : {}),
  };
}

export function sanitizeCanvasTitle(raw: unknown, fallback = CANVAS_DEFAULT_TITLE): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 200);
}

export interface DepsParseResult {
  /** 严格解析结果;失败时为空 deps(供 GET 容错展示,绝不当作可写真值)。 */
  deps: CanvasDeps;
  /** 原始 deps 是否通过严格 CanvasDepsSchema。 */
  ok: boolean;
  /** 失败时的 deps 校验错误(挂进 recovery.issues,并驱动 forceRecovery)。 */
  issues: string[];
}

/**
 * 库内 deps 列**严格解析 + 容错降级**。GET/decidePatch 共用:损坏时仍回空 deps 供展示,
 * 但 `ok=false`+`issues` 让调用方 forceRecovery(从加载起阻断 autosave,避免"先允许保存再反复 422")。
 */
export function parseDepsForTransport(rawDeps: unknown): DepsParseResult {
  const parsed = CanvasDepsSchema.safeParse(rawDeps);
  if (parsed.success) return { deps: parsed.data, ok: true, issues: [] };
  return {
    deps: createEmptyCanvasDeps(),
    ok: false,
    issues: parsed.error.issues.map(
      (i) => `deps.${i.path.join(".") || "(root)"}: ${i.message}`
    ),
  };
}

/** 容错取 deps 值(不要 ok/issues);损坏/缺失 → 空 deps。 */
export function parseStoredDeps(rawDeps: unknown): CanvasDeps {
  return parseDepsForTransport(rawDeps).deps;
}

function dedupeIssues(issues: string[]): string[] {
  return [...new Set(issues)].slice(0, 50);
}

/** >512KB 且未超硬闸时的软告警;超硬闸(会走 too_large)或未超告警闸 → null。 */
export function buildSizeWarning(size: DocSizeResult): CanvasSizeWarning | null {
  if (size.overHardLimit || !size.overWarnLimit) return null;
  return {
    code: "DOC_SIZE_WARNING",
    bytes: size.bytes,
    warnLimit: size.warnLimit,
    hardLimit: size.hardLimit,
    message: size.message ?? `画布文档已达 ${size.bytes} 字节,建议拆分为多个画布`,
  };
}

// ── 容错加载 → 传输结构 ───────────────────────────────────────────────────────

/**
 * 容错加载 → **tolerant** 拓扑传输结构。broken 节点不在 doc.nodes(在 recovery.brokenNodes),
 * 但 D2 会保留指向其安全 id 的 edges 与 group 成员——故本结构在 recoveryRequired 时**并非
 * 严格 CanvasDoc、不可直接写回**,仅供 hydrate 完整 LoadCanvasResult / 渲染占位;健康档恰为严格可写。
 */
export function tolerantEnvelope(load: LoadCanvasResult, deps: CanvasDeps): CanvasTolerantEnvelope {
  return {
    schemaVersion: load.schemaVersion,
    doc: { nodes: load.nodes, edges: load.edges, groups: load.groups },
    deps,
  };
}

/**
 * 完整恢复负载(= D2 LoadCanvasResult 去掉 clean 拓扑与 schemaVersion)。客户端据此
 * 与 envelope 合成完整 LoadCanvasResult,渲染/删除坏实体占位卡,绝不静默丢弃。
 */
export function recoveryReport(
  load: LoadCanvasResult,
  options: { forceRecovery?: boolean; extraIssues?: string[] } = {}
): CanvasRecoveryReport {
  const { forceRecovery = false, extraIssues = [] } = options;
  return {
    // forceRecovery:doc 本身可能健康,但外围损坏(如 deps 非法)也必须从加载起阻断 autosave。
    recoveryRequired: load.recoveryRequired || forceRecovery,
    brokenNodes: load.brokenNodes,
    brokenEdges: load.brokenEdges,
    migratedFrom: load.migratedFrom,
    targetSchemaVersion: load.targetSchemaVersion,
    migrationComplete: load.migrationComplete,
    issues: dedupeIssues([...load.issues, ...extraIssues]),
  };
}

/** 由严格当前文档拼装带 rev/字节的权威 envelope(schemaVersion 恒为运行时版本)。 */
export function envelopeWithMeta(
  doc: CanvasDoc,
  deps: CanvasDeps,
  rev: number,
  docBytes: number
): CanvasEnvelopeWithMeta {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, doc, deps, rev, docBytes };
}

/** 冲突/重载时回传的最新 **tolerant** 拓扑,来自容错加载,避免二次往返(可能含 broken 引用)。 */
function reloadEnvelope(
  load: LoadCanvasResult,
  deps: CanvasDeps,
  rev: number,
  docBytes: number
): CanvasTolerantEnvelopeWithMeta {
  return { ...tolerantEnvelope(load, deps), rev, docBytes };
}

// ── 补丁应用管线(computePatch)────────────────────────────────────────────────

export type PatchComputation =
  | { status: "conflict"; conflicts: CanvasPatchConflict[] }
  | { status: "invalid"; issues: string[] }
  | { status: "too_large"; bytes: number }
  | {
      status: "ok";
      doc: CanvasDoc;
      docBytes: number;
      applied: number;
      noop: number;
      warning: CanvasSizeWarning | null;
    };

/**
 * 把补丁应用到**当前库内文档**并做最终双校验 + 体积闸,产出可入库的新文档或分类拒因。
 * 纯函数,不碰 rev / DB;rebase 与幂等语义完全由 applyPatch 相对 currentDoc 判定。
 *
 * - conflict:重叠修改(add 已存异值 / update 基线不符或目标已删 / remove 基线不符)→ 409
 * - invalid:应用后严格 schema 失败(如悬空连线)/ 危险 params / recoveryRequired → 422
 * - too_large:序列化 >2MB → 400
 * - ok:附 docBytes(写 doc_bytes)、applied/noop 计数、可选 >512KB 告警
 */
export function computePatch(currentDoc: CanvasDoc, ops: CanvasOp[]): PatchComputation {
  const netOps = coalesce(ops);
  const applied = applyPatch(currentDoc, netOps);
  if (!applied.ok) return { status: "conflict", conflicts: applied.conflicts };

  const newDoc = applied.doc;
  const validation = validateCanvasDoc(newDoc);
  const load = loadCanvasDoc(newDoc, CANVAS_SCHEMA_VERSION);
  if (!validation.ok || load.recoveryRequired) {
    const issues = [
      ...(validation.ok ? [] : validation.errors),
      ...(load.recoveryRequired ? load.issues : []),
    ];
    return {
      status: "invalid",
      issues: dedupeIssues(issues.length ? issues : ["应用补丁后文档校验失败"]),
    };
  }

  const size = checkDocSize(newDoc);
  if (size.overHardLimit) return { status: "too_large", bytes: size.bytes };

  return {
    status: "ok",
    doc: newDoc,
    docBytes: size.bytes,
    applied: applied.applied,
    noop: applied.noop,
    warning: buildSizeWarning(size),
  };
}

// ── PATCH 判定(decidePatch)——route 逐 CAS attempt 调用的纯决策 ────────────────

export interface DecidePatchInput {
  /** 库内原始列(未归一化)。 */
  storedDoc: unknown;
  storedDeps: unknown;
  storedTitle: string;
  storedRev: number;
  storedSchemaVersion: number;
  storedDocBytes: number | null;
  /** 客户端锚定的 base rev + 补丁 ops + 可选 title/deps(整列替换)。 */
  baseRev: number;
  ops: CanvasOp[];
  title?: string;
  deps?: CanvasDeps;
  /**
   * 单写者门禁(D5):
   *   - `writerTag` 省略 → 不做门禁(D1–D4 旧行为,契约不回归);
   *   - 给了 → 必须精确匹配 `storedWriter.writerTag` 才放行,否则 `kind:"locked"`(→ WRITER_LOCKED)。
   * 最终原子安全由路由 UPDATE 的 `writer_tag=:tag AND rev=:baseRev` 兜底;本门禁是读行后快速失败。
   */
  writerTag?: string;
  storedWriter?: StoredWriterState;
  /** 锁冲突响应里的 serverNow(路由传入,保持 decidePatch 纯净不读时钟)。 */
  nowIso?: string;
  /**
   * 单写者门禁判活跃租约用的当前时刻(ms)。路由每个 CAS attempt 传入,与 UPDATE 的
   * `.gte("writer_heartbeat_at", now-lease)` 用同一 now,读门禁与原子写门禁逐毫秒一致。
   * 缺失/非有限 → {@link authorizeWriterPatch} fail-closed(→ WRITER_LOCKED)。
   */
  nowMs?: number;
}

export type PatchDecision =
  | {
      kind: "reload";
      code: "REV_CONFLICT" | "CANVAS_DOC_INVALID";
      message: string;
      details: CanvasApiErrorDetails;
    }
  | { kind: "conflict"; message: string; details: CanvasApiErrorDetails }
  | { kind: "invalid"; message: string; details: CanvasApiErrorDetails }
  | { kind: "locked"; message: string; details: CanvasApiErrorDetails }
  | { kind: "too_large"; message: string }
  | {
      kind: "noop";
      rev: number;
      schemaVersion: number;
      docBytes: number;
      applied: number;
      noop: number;
      warning: CanvasSizeWarning | null;
      rebased: boolean;
      envelope: CanvasEnvelopeWithMeta | null;
    }
  | {
      kind: "write";
      doc: CanvasDoc;
      deps: CanvasDeps;
      /** 非空 = 一并改名(仅 fresh rev 允许);null = 不改 title。 */
      title: string | null;
      schemaVersion: number;
      docBytes: number;
      applied: number;
      noop: number;
      warning: CanvasSizeWarning | null;
      rebased: boolean;
    };

/**
 * PATCH 纯决策。route 每个 CAS attempt 读到最新行后调用它,据 decision.kind 执行:
 * reload/conflict/invalid/too_large → 相应错误码;noop → 不写库回当前态;write → CAS 写。
 */
export function decidePatch(input: DecidePatchInput): PatchDecision {
  // ⓪ 单写者门禁(D5,仅当客户端带 writerTag):**非活跃同 tag** → 直接 WRITER_LOCKED,
  //    不泄露文档健康/内容,也不浪费补丁计算。放最前:非活跃写者本就不该写,与文档状态无关。
  //    活跃 = 合法同 tag 且心跳在 lease(30s)内未过期;过期同 tag 也拒(不得经 PATCH 顺手复活,
  //    须先走 writer 路由续租)。与 rev 冲突严格可区分(kind:"locked" → 409 WRITER_LOCKED,
  //    而非 REV_CONFLICT/ENTITY_CONFLICT)。最终原子安全由路由 UPDATE 的
  //    `writer_tag=:tag AND writer_heartbeat_at>=now-lease AND rev=:baseRev` 三谓词兜底。
  if (input.writerTag !== undefined) {
    const storedWriter: StoredWriterState = input.storedWriter ?? {
      writerTag: null,
      writerHeartbeatAt: null,
    };
    if (!authorizeWriterPatch(storedWriter, input.writerTag, input.nowMs ?? Number.NaN)) {
      const writer: CanvasWriterInfo = {
        tag: storedWriter.writerTag,
        heartbeatAt: storedWriter.writerHeartbeatAt,
      };
      return {
        kind: "locked",
        message: "画布正被另一个标签/设备编辑(单写者锁),已拒绝保存",
        details: writerLockedDetails(
          writer,
          input.nowIso ?? "",
          input.storedRev
        ),
      };
    }
  }

  const load = loadCanvasDoc(input.storedDoc, input.storedSchemaVersion);
  const depsView = parseDepsForTransport(input.storedDeps);
  const storedBytes = input.storedDocBytes ?? computeDocBytes(input.storedDoc);
  // 展示用 latest 恒用 depsView.deps(deps 损坏时为空);ok/issues 驱动 recovery.forceRecovery。
  const latest = reloadEnvelope(load, depsView.deps, input.storedRev, storedBytes);

  // ① 存量文档**原始严格契约**:strict 校验失败(含 group 双向不一致、危险 signed/dataURL)
  //    OR 容错 load 需恢复(broken 实体 / 迁移未完成)→ 422 阻断一切写。
  //    关键:D2 的 loadCanvasDoc 会修复 group_id↔node_ids 且 recoveryRequired 可能仍为 false,
  //    危险值也仅 validateCanvasDoc 发现——绝不能用 tolerant 加载结果续写,在无关补丁里静默覆盖坏档。
  const validation = validateCanvasDoc(input.storedDoc);
  if (!validation.ok || !validation.data || load.recoveryRequired) {
    const issues = dedupeIssues([
      ...(validation.ok ? [] : validation.errors),
      ...load.issues,
      ...depsView.issues,
    ]);
    return {
      kind: "reload",
      code: "CANVAS_DOC_INVALID",
      message: "库内画布文档需先恢复(存在损坏实体、结构不一致或危险值),已拒绝保存",
      details: {
        serverRev: input.storedRev,
        latest,
        recovery: recoveryReport(load, { forceRecovery: !depsView.ok, extraIssues: depsView.issues }),
        issues,
      },
    };
  }
  // 严格解析的存量文档(defaults 补齐,无修复/无重构)——只对严格合法文档 rebase 写回。
  // 紧接 gate ① 捕获,narrowing 最稳(后续 safeParse 调用不影响此常量)。
  const currentDoc: CanvasDoc = validation.data;

  // ② 存量 deps **原始严格契约**:PATCH 不容错——损坏必须阻断,且 recovery.recoveryRequired=true
  //    (forceRecovery),绝不默认空 deps 随补丁把损坏 deps 覆盖掉(GET 可容错展示,PATCH 不写)。
  if (!depsView.ok) {
    return {
      kind: "reload",
      code: "CANVAS_DOC_INVALID",
      message: "库内依赖清单损坏,请重载画布后恢复",
      details: {
        serverRev: input.storedRev,
        latest,
        recovery: recoveryReport(load, { forceRecovery: true, extraIssues: depsView.issues }),
        issues: dedupeIssues(depsView.issues),
      },
    };
  }
  const deps = depsView.deps;

  // ③ 行上 schema_version 与运行时不一致 → 需迁移后重载(P0 恒 v1,防御)。
  if (input.storedSchemaVersion !== CANVAS_SCHEMA_VERSION) {
    return {
      kind: "reload",
      code: "CANVAS_DOC_INVALID",
      message: "文档 schema 版本需先迁移,请重载画布",
      details: { serverRev: input.storedRev, latest, recovery: recoveryReport(load) },
    };
  }

  // ④ 客户端 base 超前于服务端 → 不可能时序,整包重载。
  if (input.baseRev > input.storedRev) {
    return {
      kind: "reload",
      code: "REV_CONFLICT",
      message: "baseRev 超前于服务端,请重载画布",
      details: { serverRev: input.storedRev, latest },
    };
  }

  const rebased = input.storedRev !== input.baseRev;

  // ⑤ stale rev 下 title/deps 无 base 无法证明非重叠:与当前不同 → REV_CONFLICT;相同 → 视作未改。
  if (rebased) {
    if (input.title !== undefined && input.title !== input.storedTitle) {
      return {
        kind: "reload",
        code: "REV_CONFLICT",
        message: "标题被并发修改,请重载画布后重试",
        details: { serverRev: input.storedRev, latest },
      };
    }
    if (input.deps !== undefined && !deepEqual(input.deps, deps)) {
      return {
        kind: "reload",
        code: "REV_CONFLICT",
        message: "依赖清单被并发修改,请重载画布后重试",
        details: { serverRev: input.storedRev, latest },
      };
    }
  }

  // ⑥ 应用 + 双校验 + 体积闸。
  const comp = computePatch(currentDoc, input.ops);
  if (comp.status === "conflict") {
    return {
      kind: "conflict",
      message: "补丁与他人修改重叠,已拒绝以免覆盖",
      details: { conflicts: comp.conflicts, serverRev: input.storedRev, latest },
    };
  }
  if (comp.status === "invalid") {
    return {
      kind: "invalid",
      message: "应用补丁后文档校验失败,已拒绝保存",
      details: { issues: comp.issues },
    };
  }
  if (comp.status === "too_large") {
    return { kind: "too_large", message: "画布文档超出 2MB 上限,请拆分后再保存" };
  }

  // ⑦ 持久化决策(stale rev 下 titleChanged/depsChanged 必为 false,已在 ⑤ 拦截差异)。
  const titleChanged = input.title !== undefined && input.title !== input.storedTitle;
  const depsChanged = input.deps !== undefined && !deepEqual(input.deps, deps);
  const docChanged = comp.applied > 0;
  const nextDeps = input.deps ?? deps;

  if (!docChanged && !titleChanged && !depsChanged) {
    return {
      kind: "noop",
      rev: input.storedRev,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      docBytes: storedBytes,
      applied: comp.applied,
      noop: comp.noop,
      warning: comp.warning,
      rebased,
      envelope: rebased
        ? envelopeWithMeta(comp.doc, nextDeps, input.storedRev, comp.docBytes)
        : null,
    };
  }

  return {
    kind: "write",
    doc: comp.doc,
    deps: nextDeps,
    title: titleChanged ? (input.title as string) : null,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    docBytes: comp.docBytes,
    applied: comp.applied,
    noop: comp.noop,
    warning: comp.warning,
    rebased,
  };
}
