/**
 * 超级画布 · 单写者锁(P0 / D5)。
 *
 * 支撑 CHECKLIST #26「单写者锁(navigator.locks)+ 双标签第二个只读+横幅」的**数据面**:
 *   - 同浏览器多标签互斥由 `navigator.locks`(exclusive + `ifAvailable`,非阻塞)兜底,
 *     第一个标签拿锁=写者,第二个标签得到 `null`=只读,永不排队阻塞 UI;
 *   - 跨浏览器/跨设备、以及标签崩溃(navigator.locks 会自动释放,但服务端需要判死接管)
 *     由**服务端租约**兜底:写者持锁后向 `/api/canvas/[id]/writer` 领租约(claim),
 *     心跳(建议 10s)续租,租约(30s)过期后其他标签可原子接管;
 *   - 横幅 UI(#26 的 UI 半)归 S7,消费本控制器的 `WriterLockStatus`。
 *
 * 纪律(与 CLAUDE.md 铁律一致):
 *   - **零平行事件表**:租约状态复用 canvases 行的 `writer_tag`/`writer_heartbeat_at` 两列
 *     (20260714 迁移已就位),不建任何锁表/事件表;写路由用 cookie 用户 client + RLS,
 *     **绝不 service-role**。
 *   - **fail-closed**:无 `navigator.locks` / 异常 / abort / 重复 start·stop / 迟到回调,
 *     一律安全降级为**只读**(reader),绝不误判为写者去覆盖他人。
 *   - **纯决策可离线测试**:租约活跃/可接管/写者授权/失败分类等判定全是无 IO 纯函数
 *     (与服务端 SQL 谓词一一对应),控制器把传输/锁管理器/时钟/可见性全部依赖注入,
 *     故双标签、释放接管、过期接管、心跳调度、visibility 续租都能脱离浏览器直测。
 */
import { nanoid } from "nanoid";
import type { CanvasWriterInfo } from "./api-types";

// ── 常量(心跳 10s / 租约 30s)──────────────────────────────────────────────────

/** 服务端租约时长:写者心跳超过此值未续 → 其他标签可接管(与迁移注释「30s」一致)。 */
export const WRITER_LEASE_MS = 30_000;
/** 客户端心跳间隔:活跃写者每隔此值向服务端续租(远小于租约,留重试余量)。 */
export const WRITER_HEARTBEAT_MS = 10_000;

/**
 * writer tag 字符集**刻意收敛为** `[A-Za-z0-9_-]`(nanoid 默认字母表),使其可安全
 * 内插进服务端 PostgREST `.or()` 过滤串(不含 `, . ( )` 等保留分隔符),杜绝过滤注入。
 */
export const CANVAS_WRITER_TAG_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function isWriterTag(value: unknown): value is string {
  return typeof value === "string" && CANVAS_WRITER_TAG_RE.test(value);
}

/** 生成本标签唯一写者标签(nanoid,天然落在 `[A-Za-z0-9_-]`)。 */
export function createWriterTag(): string {
  return `writer_${nanoid(16)}`;
}

// ── 纯决策:租约谓词(与服务端 SQL 一一对应,离线可测)────────────────────────────

/** 库内单写者列快照(未归一化;来自 canvases 行的 writer_tag / writer_heartbeat_at)。 */
export interface StoredWriterState {
  writerTag: string | null;
  writerHeartbeatAt: string | null;
}

const EMPTY_WRITER: StoredWriterState = { writerTag: null, writerHeartbeatAt: null };

function normalizeStoredTag(stored: StoredWriterState | null | undefined): string | null {
  if (!stored) return null;
  const tag = stored.writerTag;
  return typeof tag === "string" && tag ? tag : null;
}

/** ISO datetime → epoch ms;非字符串/空/非法 → null(绝不抛)。 */
export function heartbeatEpochMs(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || !iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 租约是否**活跃**:tag 非空 且 心跳存在 且 距今 ≤ lease。
 * 用于 UI「谁在写」判定;PATCH 门禁另用 {@link authorizeWriterPatch}(活跃同 tag)。
 */
export function isWriterLeaseActive(
  stored: StoredWriterState | null | undefined,
  nowMs: number,
  leaseMs = WRITER_LEASE_MS
): boolean {
  if (normalizeStoredTag(stored) === null) return false;
  if (!Number.isFinite(nowMs)) return false;
  const hb = heartbeatEpochMs(stored?.writerHeartbeatAt);
  if (hb === null) return false;
  return nowMs - hb <= leaseMs;
}

/**
 * 能否领取写者锁(claim)。**逐字对应服务端 SQL 谓词**
 * `writer_tag IS NULL OR writer_tag = :tag OR writer_heartbeat_at < now()-lease`:
 *   - 无写者(tag 空)→ 可领;
 *   - 已是本 tag → 可重入续领;
 *   - 他 tag:心跳缺失(异常/遗留半行)或早于 now-lease 时可接管。
 */
export function canClaimWriter(
  stored: StoredWriterState | null | undefined,
  tag: string,
  nowMs: number,
  leaseMs = WRITER_LEASE_MS
): boolean {
  if (!isWriterTag(tag)) return false;
  const current = normalizeStoredTag(stored);
  if (current === null) return true;
  if (current === tag) return true;
  if (!Number.isFinite(nowMs)) return false;
  const hb = heartbeatEpochMs(stored?.writerHeartbeatAt);
  if (hb === null) return true; // 非空 tag + NULL heartbeat 是不可能续租的半行，按失效租约接管。
  return nowMs - hb > leaseMs; // 严格早于 cutoff ⟺ now-hb>lease
}

/**
 * **同 tag 归属**判定(与租约新鲜度无关)。逐字镜像 heartbeat / release 路由的原子谓词
 * `WHERE writer_tag = :tag`:只要 tag 未被他人接管即仍属本标签,故:
 *   - heartbeat:同 tag 可续租——即便心跳曾短暂逾期而**无人接管**,写者仍能自我恢复;
 *   - release:同 tag 才清空(绝不清他人锁)。
 * **这不是 PATCH 写门禁**——文档写要求**活跃**租约,见 {@link authorizeWriterPatch}。
 * 过期但未被接管的 tag 可经 heartbeat(writer 路由)复活租约,但**绝不可**经 PATCH 顺手复活
 * (P0 单写者安全边界:文档写必须持活跃租约,续租只走显式的 writer 路由)。
 */
export function authorizeWriterWrite(
  stored: StoredWriterState | null | undefined,
  tag: string
): boolean {
  if (!isWriterTag(tag)) return false;
  return normalizeStoredTag(stored) === tag;
}

/**
 * PATCH 写门禁(D5 收紧):**活跃同 tag** 才授权——合法 tag + 精确同 tag + 心跳在
 * `leaseMs`(30s)内未过期。逐字对应原子 UPDATE 的三谓词
 * `WHERE writer_tag = :tag AND writer_heartbeat_at >= now-lease AND rev = :baseRev`。
 * **fail-closed**(一律拒绝 → WRITER_LOCKED):tag 非法 / 非同 tag / 心跳缺失或非法 /
 * 心跳位于**未来**(时钟异常)/ `nowMs` 缺失或非有限——绝不让过期或异常心跳的写者复活覆盖他人。
 * 供读行后快速失败;最终原子安全由同一条 UPDATE 的三谓词兜底(与 rev CAS 同一 UPDATE)。
 * 边界闭区间:心跳恰好 now-lease 仍算活跃(与 {@link isWriterLeaseActive} / {@link writerActiveSinceIso} 一致)。
 */
export function authorizeWriterPatch(
  stored: StoredWriterState | null | undefined,
  tag: string,
  nowMs: number,
  leaseMs = WRITER_LEASE_MS
): boolean {
  if (!isWriterTag(tag)) return false;
  if (normalizeStoredTag(stored) !== tag) return false;
  if (!Number.isFinite(nowMs)) return false; // now 缺失/非有限 → fail-closed
  const hb = heartbeatEpochMs(stored?.writerHeartbeatAt);
  if (hb === null) return false; // 心跳缺失/非法 → fail-closed
  const delta = nowMs - hb;
  if (delta < 0) return false; // 未来心跳(时钟异常)→ fail-closed
  return delta <= leaseMs; // 30s 内有效(闭区间)
}

/** 条件 UPDATE 返回 0 行后,据**重读行**区分:行不存在(或非属主)=not_found;行在=被他人锁定。 */
export function classifyWriterFailure(
  rereadRow: StoredWriterState | null | undefined
): "not_found" | "locked" {
  return rereadRow ? "locked" : "not_found";
}

/**
 * 生成 claim 用的租约 cutoff ISO(= now-lease),**刻意去毫秒**(秒精度 ISO 不含 `.`),
 * 使其可安全内插进 PostgREST `.or("...writer_heartbeat_at.lt.<cutoff>")`(`.` 是 or() 保留分隔符)。
 */
export function writerLeaseCutoffIso(nowMs: number, leaseMs = WRITER_LEASE_MS): string {
  const base = Number.isFinite(nowMs) ? nowMs : 0;
  return new Date(base - leaseMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * PATCH 写门禁的**租约活跃下界** ISO(= now-lease,**保留毫秒全精度**)。供 PATCH 原子 UPDATE
 * `.gte("writer_heartbeat_at", <since>)` 约束「写者租约仍未过期」——与 {@link authorizeWriterPatch}
 * 的 `now-hb <= lease` 边界逐毫秒一致(闭区间:hb 恰好等于 since 仍匹配)。
 * 与 {@link writerLeaseCutoffIso} 的区别:此值走单列 `.gte` 过滤(**不经 `.or()` 解析**),
 * 故无需去毫秒,得以与读门禁精确吻合、杜绝秒级截断带来的读/写窗口错位。
 */
export function writerActiveSinceIso(nowMs: number, leaseMs = WRITER_LEASE_MS): string {
  const base = Number.isFinite(nowMs) ? nowMs : 0;
  return new Date(base - leaseMs).toISOString();
}

// ── 写者锁控制器(客户端;navigator.locks + 心跳 + 可见性,依赖注入以离线可测)──────

/** 传输层:claim / heartbeat / release(生产=HTTP,测试=fake);tag 已绑定,故无参。 */
export interface WriterLockTransport {
  claim(): Promise<WriterTransportResult>;
  heartbeat(): Promise<WriterTransportResult>;
  /** 释放为**尽力而为**:失败静默(卸载信标场景),不抛。 */
  release(): Promise<void>;
}

export type WriterTransportResult =
  | { status: "holding"; writer: CanvasWriterInfo; serverNow: string | null }
  | { status: "locked"; writer: CanvasWriterInfo | null; serverNow: string | null }
  | { status: "error"; message: string };

export type WriterLockRole = "writer" | "reader";

export type WriterLockReason =
  | "starting" // 初始/获取中
  | "acquired" // 写者:持锁+租约
  | "held-by-other-tab" // 只读:同浏览器兄弟标签持 navigator 锁
  | "held-by-server" // 只读:服务端租约被他设备/他标签持有
  | "no-locks-api" // 只读:无 navigator.locks(fail-closed)
  | "error" // 只读:异常/abort/持续续租失败(fail-closed)
  | "stopped"; // 已停止

export interface WriterLockStatus {
  role: WriterLockRole;
  /** 便捷位:role === "writer"。S7 横幅据此判定只读态。 */
  canWrite: boolean;
  reason: WriterLockReason;
  tag: string;
  /** 最近已知库内写者({tag,heartbeatAt});只读时供横幅展示「谁在编辑」。 */
  serverWriter: CanvasWriterInfo | null;
  leaseMs: number;
  heartbeatMs: number;
}

// navigator.locks 的最小结构子集(避免强依赖 lib.dom 的 LockManager 精确签名)。
export interface WebLockLike {
  readonly name?: string;
  readonly mode?: string;
}
export interface WebLockRequestOptionsLike {
  mode?: "exclusive" | "shared";
  ifAvailable?: boolean;
}
export interface LockManagerLike {
  request(
    name: string,
    options: WebLockRequestOptionsLike,
    callback: (lock: WebLockLike | null) => Promise<unknown> | unknown
  ): Promise<unknown>;
}

/** 定时器抽象(默认全局 setInterval/clearInterval;测试注入可控 fake)。 */
export interface WriterLockScheduler {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** 可见性源(默认 document;测试注入 fake 以驱动 visibilitychange)。 */
export interface WriterVisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface WriterLockControllerOptions {
  canvasId: string;
  transport: WriterLockTransport;
  /** 本标签写者 tag;省略则自动生成。 */
  tag?: string;
  /**
   * 锁管理器。**presence-aware**:显式传键(含 null)即采用之;未传键才回退 navigator.locks。
   * 传 null 或无 navigator.locks → fail-closed 只读。
   */
  locks?: LockManagerLike | null;
  scheduler?: WriterLockScheduler;
  /** 可见性源;显式传 null 可禁用 visibility 续租;未传键回退 globalThis.document。 */
  visibility?: WriterVisibilitySource | null;
  now?: () => number;
  leaseMs?: number;
  heartbeatMs?: number;
  /**
   * 未持 navigator 锁时的**低频重试竞锁**间隔(默认 = heartbeatMs)。兄弟标签关闭后、且无
   * visibilitychange 可依赖时,靠此节流窗口自动重新竞锁并接管;节流仅作用于 tick 驱动的重试,
   * start/refresh 的显式竞锁不受其约束。
   */
  retryMs?: number;
  lockName?: string;
  onStatusChange?: (status: WriterLockStatus) => void;
}

export interface WriterLockController {
  readonly tag: string;
  /** 当前状态快照(冻结副本)。 */
  getStatus(): WriterLockStatus;
  /** 启动获取(幂等:重复调用 no-op)。异步在内部推进,不阻塞返回。 */
  start(): void;
  /** 停止:释放 navigator 锁 + 服务端租约 + 定时器/监听(幂等;尽力而为释放)。 */
  stop(): Promise<void>;
  /** 立即续租/尝试接管(visibility 回前台调用;也可手动触发)。 */
  refresh(): void;
}

function resolveScheduler(injected?: WriterLockScheduler): WriterLockScheduler {
  if (injected) return injected;
  // 抹平 DOM(number)与 Node(Timeout)两套 timer 类型:把 globalThis 视作我们需要的窄形状。
  const g = globalThis as unknown as {
    setInterval: (handler: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
  return {
    setInterval: (handler, ms) => g.setInterval(handler, ms),
    clearInterval: (handle) => g.clearInterval(handle),
  };
}

function resolveLocks(options: WriterLockControllerOptions): LockManagerLike | null {
  const candidate =
    "locks" in options
      ? options.locks
      : ((globalThis as { navigator?: { locks?: unknown } }).navigator?.locks as
          | LockManagerLike
          | undefined);
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

function resolveVisibility(
  options: WriterLockControllerOptions
): WriterVisibilitySource | null {
  const candidate =
    "visibility" in options
      ? options.visibility
      : ((globalThis as { document?: unknown }).document as
          | WriterVisibilitySource
          | undefined);
  return candidate && typeof candidate.addEventListener === "function" ? candidate : null;
}

/**
 * 创建写者锁控制器。**单次使用**:start 一次、stop 一次;stop 后不重启
 * (visibility 续跑用 refresh 复用同一实例)。所有分支 fail-closed 到只读。
 */
export function createWriterLockController(
  options: WriterLockControllerOptions
): WriterLockController {
  const tag = options.tag && isWriterTag(options.tag) ? options.tag : createWriterTag();
  const transport = options.transport;
  const locks = resolveLocks(options);
  const scheduler = resolveScheduler(options.scheduler);
  const visibility = resolveVisibility(options);
  const now = options.now ?? (() => Date.now());
  const leaseMs = options.leaseMs ?? WRITER_LEASE_MS;
  const heartbeatMs = options.heartbeatMs ?? WRITER_HEARTBEAT_MS;
  const retryMs = options.retryMs ?? heartbeatMs;
  const lockName = options.lockName ?? `stargaze-canvas-writer:${options.canvasId}`;
  const onStatusChange = options.onStatusChange;

  let phase: "idle" | "running" | "stopped" = "idle";
  let generation = 0;
  let role: WriterLockRole = "reader";
  let reason: WriterLockReason = "stopped";
  let serverWriter: CanvasWriterInfo | null = null;
  let holdingNavLock = false;
  let acquiring = false;
  let busy = false; // 传输在途:防重叠的心跳/接管
  let releaseNavLock: (() => void) | null = null;
  let lastLeaseOkMs: number | null = null;
  // 写者会话令牌:每次跨越写者边界(进入/离开写者)+1,用于作废在途/迟到 heartbeat 结果——
  // 心跳 Promise 迟到(甚至永不 settle 后本地租约已降级)时,其结果绝不复活已换代的写者态。
  let writerLeaseToken = 0;
  let lastAcquireAttemptMs: number | null = null; // 上次竞锁时刻;供未持锁时的低频重试节流
  let timer: unknown = null;
  let visibilityHandler: (() => void) | null = null;

  function snapshot(): WriterLockStatus {
    return Object.freeze({
      role,
      canWrite: role === "writer",
      reason,
      tag,
      serverWriter: serverWriter ? { ...serverWriter } : null,
      leaseMs,
      heartbeatMs,
    });
  }

  function setStatus(
    nextRole: WriterLockRole,
    nextReason: WriterLockReason,
    writer: CanvasWriterInfo | null | undefined = serverWriter
  ): void {
    if ((role === "writer") !== (nextRole === "writer")) {
      // 跨越写者会话边界(进入/离开写者)→ 作废在途/迟到 heartbeat 结果,防其复活状态
      writerLeaseToken += 1;
    }
    role = nextRole;
    reason = nextReason;
    serverWriter = writer ?? null;
    if (onStatusChange) {
      try {
        onStatusChange(snapshot());
      } catch {
        // 订阅方异常绝不反噬锁状态机
      }
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      try {
        scheduler.clearInterval(timer);
      } catch {
        // ignore
      }
      timer = null;
    }
  }

  function startTimer(gen: number): void {
    clearTimer();
    timer = scheduler.setInterval(() => {
      void tick(gen);
    }, heartbeatMs);
  }

  /**
   * 写者本地租约是否已失活:从未成功续过(null)/ 时钟异常(非有限)/ 距上次成功续租超过 lease
   * → 一律视为失活(fail-closed)。不依赖传输层是否 settle,故心跳永不 settle 时也能据此判死。
   */
  function leaseExpiredLocally(): boolean {
    if (lastLeaseOkMs === null) return true;
    const t = now();
    return !Number.isFinite(t) || t - lastLeaseOkMs > leaseMs;
  }

  async function tick(gen: number): Promise<void> {
    if (gen !== generation || phase !== "running") return;
    if (!holdingNavLock) {
      // 只读且未持 navigator 锁(兄弟标签占用)→ 低频重试竞锁(兄弟可能已关闭)。
      // 不触碰传输层,故与 busy(传输在途)无关。
      reacquireIfDue(gen);
      return;
    }
    // 本地租约活性守卫:**即便有心跳在途(busy)**,写者本地租约超 lease 未续成功也立即 fail-closed,
    // 绝不因心跳 Promise 永不 settle 而悬在 writer/canWrite。setStatus 会 ++writerLeaseToken,
    // 使这条在途心跳的迟到结果(见下)无法复活写者态。
    if (role === "writer" && leaseExpiredLocally()) {
      setStatus("reader", "error");
    }
    if (busy) return; // 传输在途:不重叠派发新的心跳/claim(仅上面的本地租约守卫可无视 busy)
    busy = true;
    const token = writerLeaseToken; // 记录本次派发所属的写者会话,用于作废迟到结果
    try {
      if (role === "writer") {
        const r = await transport.heartbeat();
        if (gen !== generation || phase !== "running" || token !== writerLeaseToken) {
          // 已停止 / 被新一代替代 / 本地租约已失活换代:迟到心跳结果**绝不复活**状态;
          // 若其竟续租成功(holding),服务端残留幽灵租约 → 补偿 release(release 恒绑本 tag,
          // `.eq("writer_tag", tag)` 幂等安全,**绝不清他人锁**)。
          if (r.status === "holding") {
            if (phase === "running") {
              // 仍在运行(本地超租约换代):补偿 release 必须作为**重入屏障**——await 其结算前**不解除
              // busy**(finally 不到),从而阻断下一 tick 以同一 writerTag 抢到新租约后,被这条迟到
              // release 清掉。release 永不 settle → 永久保持 busy → reader fail-closed(不发新 claim)。
              await transport.release().catch(() => {});
            } else {
              // 已 stopped:实例已死,后续 tick 均被 phase 守卫拦下,不会再 claim → fire-and-forget 幂等安全。
              void transport.release().catch(() => {});
            }
          }
          return;
        }
        if (r.status === "holding") {
          lastLeaseOkMs = now();
          setStatus("writer", "acquired", r.writer);
        } else if (r.status === "locked") {
          setStatus("reader", "held-by-server", r.writer); // 丢租约(被接管)
        } else if (leaseExpiredLocally()) {
          // 续租网络错误:租约窗口内保留写者不抖动;超窗则 fail-closed 只读
          setStatus("reader", "error");
        }
      } else {
        // 只读但仍持 navigator 锁 → 轮询尝试接管服务端租约
        const r = await transport.claim();
        if (gen !== generation || phase !== "running") {
          // 首次 claim 在途期间 stop/替代:若竟领到锁(holding),stop 的 release 可能已先行 no-op
          // (彼时 tag 尚未写入),服务端将残留幽灵租约至 30s 过期 → 尽力补偿 release;**绝不更新状态**。
          if (r.status === "holding") void transport.release().catch(() => {});
          return;
        }
        if (r.status === "holding") {
          lastLeaseOkMs = now();
          setStatus("writer", "acquired", r.writer);
        } else if (r.status === "locked") {
          setStatus("reader", "held-by-server", r.writer);
        } else {
          setStatus("reader", "error");
        }
      }
    } catch {
      // 传输层契约上不 reject;真出意外一律 fail-closed 只读,绝不悬在写者态覆盖他人
      if (gen === generation && phase === "running") setStatus("reader", "error");
    } finally {
      busy = false;
    }
  }

  /**
   * 未持 navigator 锁时的**低频、无重叠**重试竞锁:兄弟标签可能已关闭 → 定时重新 request 锁,
   * 拿到则 onAcquired 转写者(#26 双标签:第一标签关闭、无 visibilitychange 也能自行接管)。
   * 节流到 retryMs;acquire 自身以 acquiring/holdingNavLock 互斥,双重保证无重叠。stop 后
   * generation/phase 守卫使其立即失效(fail-closed);无 locks API 则无从竞锁,原地只读。
   */
  function reacquireIfDue(gen: number): void {
    if (gen !== generation || phase !== "running") return;
    if (!locks || holdingNavLock || acquiring) return;
    if (reason === "no-locks-api") return; // 无锁 API:无从竞锁
    const t = now();
    if (
      lastAcquireAttemptMs !== null &&
      Number.isFinite(t) &&
      t - lastAcquireAttemptMs < retryMs
    ) {
      return; // 距上次竞锁未满 retryMs:低频跳过,避免 spam
    }
    acquire(gen);
  }

  async function onAcquired(gen: number): Promise<void> {
    // 定时器已在 start() 启动并贯穿 running(承载心跳与低频重试),此处只做初次 claim。
    await tick(gen); // 初次 claim(role 仍 reader → claim 分支)
  }

  function acquire(gen: number): void {
    if (!locks) {
      setStatus("reader", "no-locks-api");
      return;
    }
    if (acquiring || holdingNavLock) return;
    acquiring = true;
    lastAcquireAttemptMs = now(); // 记录竞锁时刻供 reacquireIfDue 节流(start/refresh 不受节流约束)
    let request: Promise<unknown>;
    try {
      request = Promise.resolve(
        locks.request(
          lockName,
          // Web Locks rejects `signal` together with `ifAvailable` with
          // NotSupportedError. An ifAvailable request never queues, so the
          // generation/phase guard below is the cancellation boundary.
          { mode: "exclusive", ifAvailable: true },
          (lock) => {
            acquiring = false;
            if (gen !== generation || phase !== "running") return; // 迟到/已停止:fail-closed
            if (!lock) {
              // ifAvailable 未授:兄弟标签持锁,只读且不排队。重试幂等——同态不重复通知订阅方。
              if (!holdingNavLock && reason !== "held-by-other-tab") {
                setStatus("reader", "held-by-other-tab");
              }
              return;
            }
            holdingNavLock = true;
            // 返回一个悬挂 Promise 以**持有** navigator 锁,直至 stop 解析 releaseNavLock
            return new Promise<void>((resolve) => {
              releaseNavLock = resolve;
              onAcquired(gen).catch(() => {
                // onAcquired 内部 tick 已 fail-closed;此处兜底防未处理 rejection
              });
            });
          }
        )
      );
    } catch {
      acquiring = false;
      setStatus("reader", "error");
      return;
    }
    request.catch(() => {
      acquiring = false;
      if (gen === generation && phase === "running" && !holdingNavLock) {
        setStatus("reader", "error"); // abort/reject:fail-closed
      }
    });
  }

  function attachVisibility(): void {
    if (!visibility || visibilityHandler) return;
    visibilityHandler = () => {
      if (phase !== "running") return;
      if (visibility.visibilityState === "visible") refresh();
    };
    try {
      visibility.addEventListener("visibilitychange", visibilityHandler);
    } catch {
      visibilityHandler = null;
    }
  }

  function detachVisibility(): void {
    if (visibility && visibilityHandler) {
      try {
        visibility.removeEventListener("visibilitychange", visibilityHandler);
      } catch {
        // ignore
      }
    }
    visibilityHandler = null;
  }

  function refresh(): void {
    if (phase !== "running") return;
    if (holdingNavLock) {
      void tick(generation); // 写者:立即续租;只读持锁:立即尝试接管
      return;
    }
    if (reason === "no-locks-api") return; // 无锁 API:无从续
    acquire(generation); // 只读未持锁(兄弟标签曾占用)→ 重新竞锁(兄弟可能已关闭)
  }

  function start(): void {
    if (phase !== "idle") return; // 重复 start:no-op
    phase = "running";
    const gen = ++generation;
    setStatus("reader", "starting");
    if (!locks) {
      setStatus("reader", "no-locks-api");
      return;
    }
    attachVisibility();
    // 定时器贯穿整个 running:持 navigator 锁时承载心跳/接管服务端租约,未持锁时承载低频
    // 重试竞锁(兄弟标签关闭后无 visibilitychange 也能自行接管)。stop() 统一 clearTimer 清理。
    startTimer(gen);
    acquire(gen);
  }

  async function stop(): Promise<void> {
    if (phase === "stopped") return; // 重复 stop:no-op
    const wasRunning = phase === "running";
    phase = "stopped";
    generation += 1; // 使一切迟到回调失效
    clearTimer();
    detachVisibility();
    const attemptedClaim = holdingNavLock; // 持过 navigator 锁 → 曾尝试领租约,需尽力释放
    if (releaseNavLock) {
      try {
        releaseNavLock();
      } catch {
        // ignore
      }
      releaseNavLock = null;
    }
    holdingNavLock = false;
    acquiring = false;
    setStatus("reader", "stopped", null);
    if (wasRunning && attemptedClaim) {
      try {
        await transport.release();
      } catch {
        // 尽力而为:释放失败靠服务端租约 30s 自然过期兜底
      }
    }
  }

  return {
    tag,
    getStatus: snapshot,
    start,
    stop,
    refresh,
  };
}

// ── HTTP 传输(生产用;走 /api/canvas/[id]/writer)────────────────────────────────

export interface WriterHttpTransportOptions {
  canvasId: string;
  tag: string;
  /** 注入 fetch(默认 globalThis.fetch)。 */
  fetchFn?: typeof fetch;
  /** 基础路径(默认 /api/canvas)。 */
  basePath?: string;
}

interface WriterLeaseResponseBody {
  success?: boolean;
  data?: { writer?: CanvasWriterInfo; serverNow?: string };
  code?: string;
  details?: { writer?: CanvasWriterInfo; serverNow?: string };
}

function mapWriterResponse(
  ok: boolean,
  status: number,
  body: WriterLeaseResponseBody | null
): WriterTransportResult {
  if (ok && body?.success && body.data) {
    return {
      status: "holding",
      writer: body.data.writer ?? { tag: null, heartbeatAt: null },
      serverNow: body.data.serverNow ?? null,
    };
  }
  if (status === 409 && body?.code === "WRITER_LOCKED") {
    return {
      status: "locked",
      writer: body.details?.writer ?? null,
      serverNow: body.details?.serverNow ?? null,
    };
  }
  return { status: "error", message: body?.code ?? `HTTP ${status}` };
}

/** 组建绑定到某 canvas + tag 的 HTTP 传输;供 createWriterLockController 消费。 */
export function createWriterHttpTransport(
  options: WriterHttpTransportOptions
): WriterLockTransport {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as typeof fetch | undefined);
  const base = options.basePath ?? "/api/canvas";
  const url = `${base}/${options.canvasId}/writer`;

  async function post(
    action: "claim" | "heartbeat" | "release",
    keepalive: boolean
  ): Promise<WriterTransportResult> {
    if (!fetchFn) return { status: "error", message: "no-fetch" };
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writerTag: options.tag, action }),
        keepalive,
      });
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "network" };
    }
    let body: WriterLeaseResponseBody | null = null;
    try {
      body = (await res.json()) as WriterLeaseResponseBody;
    } catch {
      body = null;
    }
    return mapWriterResponse(res.ok, res.status, body);
  }

  return {
    claim: () => post("claim", false),
    heartbeat: () => post("heartbeat", false),
    release: async () => {
      // 卸载信标:keepalive 让请求在页面关闭后仍发出;结果不关心。
      await post("release", true).catch(() => undefined);
    },
  };
}
