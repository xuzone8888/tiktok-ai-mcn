/**
 * 超级画布 · IndexedDB 影子副本(P0 / D4)。
 *
 * 把「最后一次已知可写状态 + D3 离线补丁队列」镜像到 IndexedDB(每 canvas 独立 key),
 * 以便标签崩溃/断网后能一键把**领先于服务端**的本地状态恢复回来。恢复只产出**候选**,
 * 真正写回必须走 D3 PATCH/CAS(不自动覆写服务端、不绕过并发控制)。
 *
 * 纪律(与看板裁决 2 一致):
 *   - **只用 IndexedDB,绝不写浏览器本地键值存储**(不占 5MB 配额);优先原生 IDB;零新依赖。
 *   - 复用 D2/D3 完整合约:doc 用 D2 `validateCanvasDoc`(结构+引用+**深层危险值扫描**)、
 *     deps 用 CanvasDepsSchema、队列用 D3 OfflineQueueSnapshotSchema;不新建平行 doc/entity schema。
 *   - 结构/版本双锁:shadow.version 与 doc schemaVersion 都固定为当前 literal;损坏 / 旧版 /
 *     跨 canvas / 队列锚点不一致的记录一律安全拒绝(返回 null,不抛)。
 *   - 写入深拷贝且**永不抛**:入库值与调用方对象解耦;循环引用/BigInt 等不可序列化输入 → false。
 *   - close / versionchange / 事务 abort / Quota / blocked / 迟到成功 全部可恢复,绝不抛到整页。
 */
import { z } from "zod";
import {
  CanvasDocSchema,
  CanvasDepsSchema,
  CanvasRevisionSchema,
  CANVAS_SCHEMA_VERSION,
  validateCanvasDoc,
  type CanvasDoc,
  type CanvasDeps,
} from "./schema";
import { OfflineQueueSnapshotSchema, type OfflineQueueSnapshot } from "./offline-queue";

export const CANVAS_SHADOW_DB_NAME = "stargaze-canvas-shadow";
export const CANVAS_SHADOW_STORE = "shadows";
export const CANVAS_SHADOW_DB_VERSION = 1;
/** 影子记录结构版本;旧版记录由 z.literal 拒绝(将来结构变更时据此迁移/丢弃)。 */
export const CANVAS_SHADOW_SCHEMA_VERSION = 1 as const;

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 严格记录契约。结构/版本双锁:
 *   - `version` = 当前影子结构版本(literal);`schemaVersion` = 当前 doc schema 版本(literal,
 *     旧 doc 版本非「当前严格可写」→ 拒绝)。
 *   - `doc` 仅做结构/引用层(CanvasDocSchema);**深层危险值**(嵌套 dataURL/签名 URL)由
 *     fullyValidateRecord 追加复用 D2 validateCanvasDoc 拦截。
 *   - queue 非空时:`queue.baseRev` 必须 === `serverRev`(恢复候选按此 baseRev 走 D3 CAS 重放);
 *     若含在途,`inflight.baseRev` 必须与队列锚点一致(D3 快照不变量)。
 */
export const CanvasShadowRecordSchema = z
  .strictObject({
    version: z.literal(CANVAS_SHADOW_SCHEMA_VERSION),
    canvasId: z.string().min(1).max(200),
    schemaVersion: z.literal(CANVAS_SCHEMA_VERSION),
    doc: CanvasDocSchema,
    deps: CanvasDepsSchema,
    serverRev: CanvasRevisionSchema,
    updatedAt: z.string().regex(ISO_DATETIME_RE, "updatedAt 必须是 ISO datetime"),
    queue: OfflineQueueSnapshotSchema.nullable(),
  })
  .superRefine((record, ctx) => {
    if (record.queue) {
      if (record.queue.baseRev !== record.serverRev) {
        ctx.addIssue({
          code: "custom",
          path: ["queue", "baseRev"],
          message: "队列锚点 baseRev 必须等于 serverRev(否则候选无法按 baseRev 安全重放)",
        });
      }
      if (record.queue.inflight && record.queue.inflight.baseRev !== record.queue.baseRev) {
        ctx.addIssue({
          code: "custom",
          path: ["queue", "inflight", "baseRev"],
          message: "在途 baseRev 必须与队列锚点一致(D3 快照不变量)",
        });
      }
    }
  });

/** 单条影子记录(每 canvas 独立 key = canvasId);类型直接由 schema 推断,与校验恒同步。 */
export type CanvasShadowRecord = z.infer<typeof CanvasShadowRecordSchema>;

export interface CanvasShadowInput {
  canvasId: string;
  schemaVersion?: number;
  doc: CanvasDoc;
  deps: CanvasDeps;
  serverRev: number;
  queue?: OfflineQueueSnapshot | null;
  updatedAt?: string;
}

/** 有界严格 JSON 深拷贝的深度/节点上限(远超 2MB 文档实际规模,纯防御恶意超深/超大)。 */
const SHADOW_CLONE_MAX_DEPTH = 128;
const SHADOW_CLONE_MAX_NODES = 500_000;

type CloneResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * **有界严格 JSON 深拷贝/校验器**。只接受 JSON.stringify↔parse 往返**不会静默改变**的形态:
 * null / string / boolean / **有限** number / 无稀疏项数组 / 普通数据对象。
 * 拒绝(返回 {ok:false},绝不抛):undefined / function / symbol / bigint / NaN·Infinity /
 * 循环引用 / Date·Map·Set·类实例(非普通原型) / accessor(get/set) / symbol 键 / non-enumerable 键 /
 * 稀疏数组 / 深度或节点数超限。hostile getter/proxy 的 trap 抛出也被吞掉 → {ok:false}。
 *
 * 用途:build/get/candidate 一律经此(替代 JSON.parse(JSON.stringify)),保证 read/write 全链
 * JSON-safe——绝不把「JSON 会篡改的值」当作可写影子或恢复候选,也绝不在后续 clone 时才抛。
 */
export function strictJsonClone<T>(input: T): CloneResult<T> {
  let nodes = 0;
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > SHADOW_CLONE_MAX_NODES) throw new Error("节点数超限");
    if (depth > SHADOW_CLONE_MAX_DEPTH) throw new Error("嵌套深度超限");

    if (value === null) return null;
    const type = typeof value;
    if (type === "string" || type === "boolean") return value;
    if (type === "number") {
      if (!Number.isFinite(value)) throw new Error("非有限数值(NaN/Infinity)");
      return value;
    }
    if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
      throw new Error(`非 JSON 值:${type}`);
    }

    const obj = value as object;
    if (ancestors.has(obj)) throw new Error("循环引用");
    ancestors.add(obj);
    try {
      if (Array.isArray(obj)) {
        // 数组同样按 descriptors 严校:原型仅 Array.prototype、无 symbol 键、只允许 length + 规范
        // enumerable data 索引(拒 accessor index / 额外 own 键 / non-enumerable),避免静默实体化。
        if (Object.getPrototypeOf(obj) !== Array.prototype) throw new Error("非普通数组(改过原型)");
        if (Object.getOwnPropertySymbols(obj).length > 0) throw new Error("数组含 symbol 键");
        const len = obj.length;
        const arrDescriptors = Object.getOwnPropertyDescriptors(obj);
        for (const key of Object.keys(arrDescriptors)) {
          if (key === "length") continue; // 内建 length(non-enumerable data),不深拷本身
          const idx = Number(key);
          if (!Number.isInteger(idx) || idx < 0 || idx >= len || String(idx) !== key) {
            throw new Error("数组含额外/非索引 own 键");
          }
          const d = arrDescriptors[key];
          if (!d.enumerable) throw new Error("数组索引 non-enumerable");
          if (typeof d.get === "function" || typeof d.set === "function") throw new Error("数组索引 accessor");
        }
        const out: unknown[] = [];
        for (let i = 0; i < len; i += 1) {
          if (!Object.prototype.hasOwnProperty.call(obj, i)) throw new Error("稀疏数组");
          out.push(visit((obj as unknown[])[i], depth + 1)); // 索引已证为 data,读取不触发 getter
        }
        return out;
      }

      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error("非普通对象(Date/Map/Set/类实例)");
      }
      if (Object.getOwnPropertySymbols(obj).length > 0) throw new Error("含 symbol 键");
      const descriptors = Object.getOwnPropertyDescriptors(obj);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const d = descriptors[key];
        if (!d.enumerable) throw new Error("含 non-enumerable 键");
        if (typeof d.get === "function" || typeof d.set === "function") throw new Error("含 accessor 键");
        // 取 descriptor.value(而非 obj[key]):避免触发 "__proto__" 特殊 accessor / 任何 getter。
        const cloned = visit(d.value, depth + 1);
        // 用 defineProperty 落键:own key '__proto__' 也成普通 own data 属性,不改 out 原型、不丢键。
        Object.defineProperty(out, key, {
          value: cloned,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    } finally {
      ancestors.delete(obj);
    }
  };

  try {
    return { ok: true, value: visit(input, 0) as T };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "非法值" };
  }
}

/**
 * 完整严格校验(结构 + 版本 + 队列锚点 + **D2 深层危险值扫描**)。任何失败/异常 → null。
 * doc 的 CanvasDocSchema 只覆盖结构/引用;validateCanvasDoc 追加 inspectUnsafeCanvasValue,
 * 拒绝嵌套 params 里的 signed URL / dataURL 等非法值——绝不把不可写状态当成可恢复候选。
 *
 * **永不抛**:IndexedDB 可存 structured-clone 循环对象;损坏/旧脚本写入的循环 record,或
 * hostile getter/proxy 传入导出的 validateShadowRecord,都可能让 safeParse 抛异常或递归溢出。
 * 整条 parse+校验链包在 try/catch 内,统一吞异常返回 null,兑现「任何失败返回 null、绝不崩页」。
 */
function fullyValidateRecord(raw: unknown): CanvasShadowRecord | null {
  try {
    // Zod **前**:canonical strict clone——拒绝 JSON 会静默篡改的形态(undefined/函数/BigInt/
    // 非有限数/Date/Map/循环/accessor/稀疏 等),并得到 JSON-safe 的解耦副本。
    const canonical = strictJsonClone(raw);
    if (!canonical.ok) return null;
    const parsed = CanvasShadowRecordSchema.safeParse(canonical.value);
    if (!parsed.success) return null;
    const docCheck = validateCanvasDoc(parsed.data.doc);
    if (!docCheck.ok || !docCheck.data) return null;
    // Zod **后**:再 canonical clone 一次,确保返回值 read/write 全链 JSON-safe 且与内部彻底解耦。
    const out = strictJsonClone({ ...parsed.data, doc: docCheck.data });
    return out.ok ? out.value : null;
  } catch {
    return null;
  }
}

/**
 * 校验一条原始记录:结构/版本/危险值/队列锚点失败 → null;`canvasId` 与请求不一致
 * (跨 canvas 污染/碰撞)→ null。纯函数,可脱离 IDB 直测。
 */
export function validateShadowRecord(
  raw: unknown,
  expectedCanvasId: string
): CanvasShadowRecord | null {
  const record = fullyValidateRecord(raw);
  if (!record || record.canvasId !== expectedCanvasId) return null;
  return record;
}

/**
 * 由输入构造并**完整严格校验**记录(只 shadow 可写状态)。**永不抛**:非法 doc/deps、
 * 旧 doc 版本、循环引用/BigInt 等不可序列化输入 → 一律返回 null(put 据此回 false)。
 */
function buildRecord(input: CanvasShadowInput): CanvasShadowRecord | null {
  try {
    if (!input || typeof input.canvasId !== "string" || !input.canvasId) return null;
    // 直接组装原始输入;解耦 + JSON-safe 校验 + 深拷贝全交给 fullyValidateRecord 的 canonical clone
    // (它在 Zod 前 strictJsonClone,非 JSON-safe 输入如 Date/Map/undefined/循环/BigInt → null → put false)。
    const record = {
      version: CANVAS_SHADOW_SCHEMA_VERSION,
      canvasId: input.canvasId,
      schemaVersion: input.schemaVersion ?? CANVAS_SCHEMA_VERSION,
      doc: input.doc,
      deps: input.deps,
      serverRev: input.serverRev,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      queue: input.queue ?? null,
    };
    return fullyValidateRecord(record);
  } catch {
    return null;
  }
}

// ── 原生 IndexedDB 封装(全部错误可恢复,绝不抛到整页)─────────────────────────

export interface ShadowStoreOptions {
  /**
   * 注入 IDBFactory(测试用 fake)。**显式传 null 可禁用**(available=false);
   * 未提供该键时才回退到 globalThis.indexedDB(presence-aware,非 nullish)。
   */
  factory?: IDBFactory | null;
  dbName?: string;
}

function resolveFactory(options: ShadowStoreOptions): IDBFactory | null {
  // presence-aware:只要显式给了 factory 键(哪怕是 null)就采用它,不回退全局。
  const candidate =
    "factory" in options
      ? options.factory
      : (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return candidate && typeof candidate.open === "function" ? candidate : null;
}

function openDb(factory: IDBFactory, dbName: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) {
        // 迟到结果:blocked/error 已结算后姗姗来迟的成功 db,立即关闭避免泄漏。
        if (db) {
          try {
            db.close();
          } catch {
            // ignore
          }
        }
        return;
      }
      settled = true;
      resolve(db);
    };

    let req: IDBOpenDBRequest;
    try {
      req = factory.open(dbName, CANVAS_SHADOW_DB_VERSION);
    } catch {
      settle(null);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(CANVAS_SHADOW_STORE)) {
          db.createObjectStore(CANVAS_SHADOW_STORE, { keyPath: "canvasId" });
        }
      } catch {
        // 建库失败:后续事务会因缺 store 自然降级,不抛。
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        // 另一标签升级/删除库时主动让路,避免阻塞(可恢复)。
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore
      }
      settle(db); // 若已结算(blocked/error 在前),settle 会 close 这个迟到 db。
    };
    req.onerror = () => settle(null);
    req.onblocked = () => settle(null);
  });
}

interface TxResult {
  ok: boolean;
  value: unknown;
}

async function runTx(
  factory: IDBFactory,
  dbName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest
): Promise<TxResult> {
  const db = await openDb(factory, dbName);
  if (!db) return { ok: false, value: undefined };
  try {
    return await new Promise<TxResult>((resolve) => {
      let settled = false;
      const finish = (result: TxResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      let tx: IDBTransaction;
      try {
        tx = db.transaction(CANVAS_SHADOW_STORE, mode);
      } catch {
        finish({ ok: false, value: undefined });
        return;
      }
      let value: unknown;
      tx.oncomplete = () => finish({ ok: true, value });
      tx.onabort = () => finish({ ok: false, value: undefined });
      tx.onerror = () => finish({ ok: false, value: undefined });
      let req: IDBRequest;
      try {
        req = op(tx.objectStore(CANVAS_SHADOW_STORE));
      } catch {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        finish({ ok: false, value: undefined });
        return;
      }
      req.onsuccess = () => {
        value = req.result;
      };
      // 请求 onerror 不 preventDefault → 事务 abort → onabort/onerror 兜底为失败(如 Quota)。
      req.onerror = () => {
        // no-op;交给 tx.onabort/onerror 结算
      };
    });
  } catch {
    return { ok: false, value: undefined };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export interface CanvasShadowStore {
  /** IndexedDB 是否可用(无/显式禁用则所有操作安全降级为 null/false)。 */
  readonly available: boolean;
  /** 写入/覆盖某 canvas 的影子;非法 doc/deps、不可序列化输入或 IDB 失败(含 Quota/abort)→ false。 */
  put(input: CanvasShadowInput): Promise<boolean>;
  /** 读取并完整严格校验;不存在/损坏/旧版/危险值/跨 canvas/队列锚点不一致 → null。返回值深拷贝解耦。 */
  get(canvasId: string): Promise<CanvasShadowRecord | null>;
  /** 删除某 canvas 的影子。 */
  remove(canvasId: string): Promise<boolean>;
  /** 清空整库(登出/重置用)。 */
  clear(): Promise<boolean>;
}

/**
 * 创建绑定到某 IDBFactory 的影子存储。无 IndexedDB(SSR/隐私模式/显式 factory:null)→
 * available=false,所有操作安全降级(get→null / put→false),不抛。
 */
export function createCanvasShadowStore(options: ShadowStoreOptions = {}): CanvasShadowStore {
  const factory = resolveFactory(options);
  const dbName = options.dbName ?? CANVAS_SHADOW_DB_NAME;

  return {
    available: factory !== null,
    async put(input) {
      if (!factory) return false;
      const record = buildRecord(input);
      if (!record) return false;
      const res = await runTx(factory, dbName, "readwrite", (store) => store.put(record));
      return res.ok;
    },
    async get(canvasId) {
      if (!factory || typeof canvasId !== "string" || !canvasId) return null;
      const res = await runTx(factory, dbName, "readonly", (store) => store.get(canvasId));
      if (!res.ok) return null;
      // validateShadowRecord 已在 Zod 前后 canonical clone,返回值即 JSON-safe 且与库内解耦;从不抛。
      return validateShadowRecord(res.value, canvasId);
    },
    async remove(canvasId) {
      if (!factory || typeof canvasId !== "string" || !canvasId) return false;
      const res = await runTx(factory, dbName, "readwrite", (store) => store.delete(canvasId));
      return res.ok;
    },
    async clear() {
      if (!factory) return false;
      const res = await runTx(factory, dbName, "readwrite", (store) => store.clear());
      return res.ok;
    },
  };
}

// ── 纯判定:是否提示一键恢复 ──────────────────────────────────────────────────

export interface ShadowServerState {
  /** 当前服务端 rev。 */
  rev: number;
  updatedAt?: string;
}

/**
 * 恢复策略:
 *  - `replay_queue`:同 rev + 有 dirty 队列——把 shadow 的队列 ops 经 D3 PATCH 重放到当前 server。
 *  - `restore_snapshot`:shadow 基线新于 server——整档快照恢复;队列锚点超前于 server,**不可**直送 D3,
 *    故 queue 恒 null,客户端据 doc/deps 生成对 server.rev 的新补丁。
 */
export type ShadowRecoveryStrategy = "replay_queue" | "restore_snapshot";

/** 恢复候选:UI 展示 + 交回客户端经 D3 PATCH/CAS 重放/生成,绝不自动覆写服务端。 */
export interface ShadowRecoveryCandidate {
  strategy: ShadowRecoveryStrategy;
  canvasId: string;
  schemaVersion: number;
  doc: CanvasDoc;
  deps: CanvasDeps;
  /** D3 CAS 锚点:**恒 = 当前 server.rev**,绝不 > server.rev(D3 拒 baseRev>storedRev)。 */
  baseRev: number;
  /** replay_queue 时携带待重放队列;restore_snapshot 时恒 null(锚点超前的队列不可直送 D3)。 */
  queue: OfflineQueueSnapshot | null;
  /** 只读诊断:影子记录原 serverRev(restore 时可能 > baseRev)。 */
  shadowServerRev: number;
  updatedAt: string;
}

export type ShadowRecoveryDecision =
  | { canRecover: false; reason: string }
  | { canRecover: true; reason: string; candidate: ShadowRecoveryCandidate };

function queuePendingCount(queue: OfflineQueueSnapshot | null): number {
  if (!queue) return 0;
  const inflight = queue.inflight ? queue.inflight.ops.length : 0;
  return queue.pending.length + inflight;
}

/**
 * 纯判定:仅当**合法 shadow 相对当前 server 确实领先**时才建议一键恢复。**对任意 runtime 输入不抛**。
 *
 * 领先 = 影子基线新于服务端(shadow.serverRev > server.rev,→ restore_snapshot)
 *      或 同基线且队列有未保存 dirty ops(shadow.serverRev === server.rev 且 pending>0,→ replay_queue)。
 * 服务端已领先(server.rev > shadow.serverRev)**绝不误提示**——那需重新同步/rebase 而非恢复。
 *
 * 关键 CAS 安全:候选 baseRev **恒取 server.rev**;restore 时队列锚点(shadow.serverRev)超前 server,
 * 队列不可直送 D3(会被拒 baseRev>storedRev),故 restore 的 queue 恒 null。恢复只返回候选,写回走 D3。
 */
export function decideShadowRecovery(
  shadow: CanvasShadowRecord | null,
  server: ShadowServerState
): ShadowRecoveryDecision {
  try {
    return decideShadowRecoveryInner(shadow, server);
  } catch {
    // hostile getter/proxy 在读 serverRev/queue 等属性时抛出 → 统一吞掉,绝不崩页。
    return { canRecover: false, reason: "影子/服务端输入异常,拒绝恢复" };
  }
}

function decideShadowRecoveryInner(
  shadow: CanvasShadowRecord | null,
  server: ShadowServerState
): ShadowRecoveryDecision {
  // server getter 抛出 → 逃到 decideShadowRecovery 外层 catch;此处只做合法性判定。
  if (!server || !Number.isInteger(server.rev) || server.rev < 0) {
    return { canRecover: false, reason: "服务端 rev 未知,不提示恢复" };
  }
  // 先取 canonical valid shadow:hostile proxy/getter、非 JSON 安全、结构非法/队列锚点不符 → 一律 null。
  // record 是全新 canonical JSON-safe 副本(fullyValidateRecord 前后双 clone),后续直接引用其字段。
  const record = fullyValidateRecord(shadow);
  if (!record) return { canRecover: false, reason: "无有效影子副本" };

  const shadowRev = record.serverRev; // schema 保证非负整数
  if (server.rev > shadowRev) {
    return { canRecover: false, reason: "服务端已领先影子基线,需重新同步而非恢复" };
  }
  const aheadByRev = shadowRev > server.rev;
  const aheadByQueue = shadowRev === server.rev && queuePendingCount(record.queue) > 0;
  if (!aheadByRev && !aheadByQueue) {
    return { canRecover: false, reason: "影子副本未领先服务端,无需恢复" };
  }

  const strategy: ShadowRecoveryStrategy = aheadByRev ? "restore_snapshot" : "replay_queue";
  return {
    canRecover: true,
    reason: aheadByRev ? "影子基线新于服务端(整档恢复)" : "同版本存在未保存的本地补丁(队列重放)",
    candidate: {
      strategy,
      canvasId: record.canvasId,
      schemaVersion: record.schemaVersion,
      doc: record.doc,
      deps: record.deps,
      baseRev: server.rev, // 恒取 server.rev,绝不 shadow.serverRev
      queue: strategy === "replay_queue" ? record.queue : null,
      shadowServerRev: shadowRev,
      updatedAt: record.updatedAt,
    },
  };
}
