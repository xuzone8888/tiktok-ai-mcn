/**
 * 超级画布 · 离线补丁队列(P0 / D3)——**纯状态机**。
 *
 * 支撑 CHECKLIST #24(自动保存=节点级补丁,非重叠 rebase)与 #30(断网 30s 恢复
 * 自动补存)的**数据面机制**。本文件刻意**不含** fetch / 定时器 / IndexedDB:
 *   - 何时冲刷(节流/断网重连/心跳)= S 侧定时器职责;
 *   - 把快照落 IndexedDB / 读回 = D4 影子副本职责;
 *   - 真正发请求打 `/api/canvas/[id]` = S 侧 fetch。
 * 这里只提供确定性的状态迁移:enqueue(opId 去重)→ buildPatch(coalesce+标记在途)
 * → ack(成功,推进 baseRev)/ fail(失败,回队重发)→ snapshot/restore(供 D4 持久化)。
 *
 * 单在途纪律(single-flight):同一时刻至多一个补丁在途;buildPatch 在 inflight
 * 未结算前返回 idle。重发安全由服务端幂等保证(当前值==next / 目标已删 → no-op)。
 */
import { z } from "zod";
import {
  coalesce,
  CanvasOpSchema,
  type CanvasOp,
} from "./patch";
import { CanvasRevisionSchema } from "./schema";

/** 去重表容量:最近 opId 环形保留,超出淘汰最旧(仍会兜查 pending/inflight)。 */
export const OFFLINE_QUEUE_SEEN_CAP = 2048;
/** pending 上限(防 UI 失控无限入队);超限入队被拒(返回原状态)。 */
export const OFFLINE_QUEUE_MAX_PENDING = 10_000;
/** 快照结构版本(落 IndexedDB;将来结构变更时据此迁移/丢弃)。 */
export const OFFLINE_QUEUE_SNAPSHOT_VERSION = 1 as const;

export interface QueuedOp {
  /** 客户端生成的幂等键;同 opId 只入队一次(去重防 UI 双触发)。 */
  opId: string;
  /** 单调本地序号;决定 coalesce/重发的先后。 */
  seq: number;
  op: CanvasOp;
}

export interface OfflineInflight {
  token: string;
  /** 发起该在途补丁时的 baseRev(诊断用)。 */
  baseRev: number;
  ops: QueuedOp[];
}

export interface OfflineQueueState {
  /** 队列锚定的服务端 rev;ack 后推进为服务端返回的新 rev。 */
  baseRev: number;
  /** 单调序号发号器(永不回退,reset 也保留,避免 token/seq 复用)。 */
  seq: number;
  /** 已入队、尚未进入某次冲刷的 op(按 seq 升序)。 */
  pending: QueuedOp[];
  /** 已冲刷、等待 ack/fail 的补丁;null=空闲。 */
  inflight: OfflineInflight | null;
  /** 最近 opId(去重);容量 OFFLINE_QUEUE_SEEN_CAP。 */
  seen: string[];
}

/** buildPatch 产出的线上补丁(title/deps 属 S 侧元数据保存,不走本队列)。 */
export interface OfflineFlushPatch {
  baseRev: number;
  ops: CanvasOp[];
}

export interface OfflineFlush {
  token: string;
  patch: OfflineFlushPatch;
}

/** buildPatch 结果:新状态 + 可选待发补丁(null=无可发/在途中/已抵消清空)。 */
export interface BuildPatchOutcome {
  state: OfflineQueueState;
  flush: OfflineFlush | null;
}

const QueuedOpSchema = z.strictObject({
  opId: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  op: CanvasOpSchema,
});

/** 快照 = 状态本体 + version;结构已是 JSON 安全,restore 时严格重校(含逐 op)。 */
export const OfflineQueueSnapshotSchema = z.strictObject({
  version: z.literal(OFFLINE_QUEUE_SNAPSHOT_VERSION),
  baseRev: CanvasRevisionSchema,
  seq: z.number().int().nonnegative(),
  pending: z.array(QueuedOpSchema).max(OFFLINE_QUEUE_MAX_PENDING),
  inflight: z
    .strictObject({
      token: z.string().min(1).max(200),
      baseRev: CanvasRevisionSchema,
      ops: z.array(QueuedOpSchema).max(OFFLINE_QUEUE_MAX_PENDING),
    })
    .nullable(),
  seen: z.array(z.string().min(1).max(200)).max(OFFLINE_QUEUE_SEEN_CAP),
});
export type OfflineQueueSnapshot = z.infer<typeof OfflineQueueSnapshotSchema>;

/**
 * 深拷贝一条 op(op 恒为 JSON 安全值:无函数/undefined/Date/循环)。入队与快照都克隆,
 * 使队列彻底拥有自己的副本——调用方事后改动传入的 op 引用不会污染队列或快照。
 */
function cloneOp(op: CanvasOp): CanvasOp {
  return JSON.parse(JSON.stringify(op)) as CanvasOp;
}

function normalizeRev(next: unknown, fallback: number): number {
  const parsed = CanvasRevisionSchema.safeParse(next);
  if (!parsed.success) return fallback;
  // 服务端权威:采纳其 rev,但绝不回退(防乱序 ack)。
  return Math.max(fallback, parsed.data);
}

function maxSeq(ops: QueuedOp[]): number {
  let max = 0;
  for (const q of ops) if (q.seq > max) max = q.seq;
  return max;
}

/** 新建空队列,锚定给定服务端 rev(rev 非法则归 0)。 */
export function createOfflineQueue(baseRev = 0): OfflineQueueState {
  return {
    baseRev: normalizeRev(baseRev, 0),
    seq: 0,
    pending: [],
    inflight: null,
    seen: [],
  };
}

/** opId 是否已知(去重):兜查 seen + 当前 pending + 在途,防淘汰后重入。 */
export function isKnownOpId(state: OfflineQueueState, opId: string): boolean {
  if (state.seen.includes(opId)) return true;
  if (state.pending.some((q) => q.opId === opId)) return true;
  if (state.inflight && state.inflight.ops.some((q) => q.opId === opId)) return true;
  return false;
}

function trimSeen(seen: string[]): string[] {
  return seen.length > OFFLINE_QUEUE_SEEN_CAP
    ? seen.slice(seen.length - OFFLINE_QUEUE_SEEN_CAP)
    : seen;
}

/**
 * 入队一条 op(带 opId 去重)。同 opId 重复入队 → 幂等,返回原状态。
 * pending 超上限 → 拒绝入队(返回原状态);S 侧应据此触发强制冲刷或提示。
 */
export function enqueue(state: OfflineQueueState, opId: string, op: CanvasOp): OfflineQueueState {
  if (isKnownOpId(state, opId)) return state;
  if (state.pending.length >= OFFLINE_QUEUE_MAX_PENDING) return state;
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    pending: [...state.pending, { opId, seq, op: cloneOp(op) }],
    seen: trimSeen([...state.seen, opId]),
  };
}

/** 当前是否有待保存内容(pending 或在途)。 */
export function isDirty(state: OfflineQueueState): boolean {
  return state.pending.length > 0 || state.inflight !== null;
}

/** 预览:把 pending coalesce 成净 op(不改状态;供 UI/体积预检)。 */
export function previewOps(state: OfflineQueueState): CanvasOp[] {
  return coalesce(state.pending.map((q) => q.op));
}

/**
 * 冲刷:若空闲且有 pending,则 coalesce 出净补丁并把 pending 整体转入途。
 * - 在途未结算 → idle(单在途纪律)。
 * - pending 为空 → idle。
 * - coalesce 后净空(add 后 remove 抵消等)→ 直接消费 pending 清空,idle 无需上行。
 * token 由 (baseRev, 首末 seq) 确定性派生:同一批 pending 恒得同 token,便于对账。
 */
export function buildPatch(state: OfflineQueueState): BuildPatchOutcome {
  if (state.inflight) return { state, flush: null };
  if (state.pending.length === 0) return { state, flush: null };

  const ops = coalesce(state.pending.map((q) => q.op));
  if (ops.length === 0) {
    return { state: { ...state, pending: [] }, flush: null };
  }

  const first = state.pending[0].seq;
  const last = state.pending[state.pending.length - 1].seq;
  const token = `flush_${state.baseRev}_${first}_${last}`;
  const inflight: OfflineInflight = { token, baseRev: state.baseRev, ops: state.pending };
  return {
    state: { ...state, pending: [], inflight },
    flush: { token, patch: { baseRev: state.baseRev, ops } },
  };
}

/**
 * 冲刷成功:丢弃在途,推进 baseRev 为服务端返回的新 rev(rebased 成功同样走这里)。
 * token 不匹配(乱序/过期 ack)→ 忽略,返回原状态。
 */
export function ack(state: OfflineQueueState, token: string, newRev: number): OfflineQueueState {
  if (!state.inflight || state.inflight.token !== token) return state;
  return { ...state, inflight: null, baseRev: normalizeRev(newRev, state.baseRev) };
}

/**
 * 冲刷失败(断网/5xx):把在途 op 放回 pending 队首,与其后新编辑一起下次 coalesce 重发。
 * token 不匹配 → 忽略。这是 #30「断网 30s 恢复自动补存」的重发路径。
 */
export function fail(state: OfflineQueueState, token: string): OfflineQueueState {
  if (!state.inflight || state.inflight.token !== token) return state;
  return {
    ...state,
    inflight: null,
    pending: [...state.inflight.ops, ...state.pending],
  };
}

/**
 * 硬重置:整包重载 / 不可 rebase 冲突(409)后,采纳服务端最新 rev、丢弃本地未决补丁。
 * seq 保留单调、清空去重表(重载后客户端会以全新 opId 重建编辑)。
 */
export function reset(state: OfflineQueueState, newRev: number): OfflineQueueState {
  return {
    baseRev: normalizeRev(newRev, state.baseRev),
    seq: state.seq,
    pending: [],
    inflight: null,
    seen: [],
  };
}

/** 导出可 JSON 持久化的**真实深拷贝**快照(op 逐条克隆;交给 D4 落 IndexedDB)。 */
export function snapshot(state: OfflineQueueState): OfflineQueueSnapshot {
  return {
    version: OFFLINE_QUEUE_SNAPSHOT_VERSION,
    baseRev: state.baseRev,
    seq: state.seq,
    pending: state.pending.map((q) => ({ opId: q.opId, seq: q.seq, op: cloneOp(q.op) })),
    inflight: state.inflight
      ? {
          token: state.inflight.token,
          baseRev: state.inflight.baseRev,
          ops: state.inflight.ops.map((q) => ({ opId: q.opId, seq: q.seq, op: cloneOp(q.op) })),
        }
      : null,
    seen: [...state.seen],
  };
}

/**
 * 从快照恢复(重载 / 读回 IndexedDB)。严格重校(含逐 op zod);损坏 → null,
 * 由调用方回退到 createOfflineQueue。**在途折叠回 pending**:重载后无法确认在途补丁
 * 是否已被服务端接收,故一律重发——服务端幂等保证重复应用为 no-op(至少一次交付)。
 */
export function restore(raw: unknown): OfflineQueueState | null {
  const parsed = OfflineQueueSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  const snap = parsed.data;

  const merged = snap.inflight ? [...snap.inflight.ops, ...snap.pending] : snap.pending;
  const seenIds = new Set<string>();
  const pending: QueuedOp[] = [];
  for (const q of merged) {
    if (seenIds.has(q.opId)) continue; // 防持久化损坏导致的 opId 撞车
    seenIds.add(q.opId);
    pending.push({ opId: q.opId, seq: q.seq, op: q.op });
  }

  return {
    baseRev: snap.baseRev,
    seq: Math.max(snap.seq, maxSeq(pending)),
    pending,
    inflight: null,
    seen: trimSeen([...snap.seen]),
  };
}
