/** D5 单写者锁验证。运行:node scripts/verify-canvas-d5.mjs
 *
 * 脱离浏览器/数据库直测:
 *   - 纯决策(租约活跃/可 claim/heartbeat·release 归属/PATCH 活跃门禁/失败分类/cutoff·since 格式)真值表;
 *   - 服务端 claim/heartbeat/release **原子条件**(用生产纯谓词驱动的内存行引擎);
 *   - D3 PATCH decidePatch 的 writerTag 门禁(**活跃同 tag** 授权、过期同 tag 拒复活、未来/缺失/now 缺失
 *     fail-closed、锁冲突 vs rev 冲突可区分、legacy 不回归);
 *   - 客户端控制器(fake LockManager/transport/scheduler/visibility/clock):本地双标签、release/过期接管、
 *     **兄弟关闭后低频定时重试自动接管(无 visibilitychange)**、迟到/abort/无 locks fail-closed、心跳调度、
 *     visibility 续租、stop 清理;**心跳 Promise 永不 settle 时按本地租约超时判死(busy 不豁免)、迟到
 *     heartbeat/claim 结果不复活状态且补偿 release 幽灵租约(claim 在途 stop / 超租约换代)**;
 *   - 严格请求体(writer 路由 body + 决策层宽松 body + **生产 PATCH 强制 writerTag**);
 *   - 旧 D1–D4 不回归(decidePatch legacy、错误码↔状态、离线队列 smoke);
 *   - 源码卫生(writer-lock 依赖/无 web storage/无控制字;writer 路由 cookie client 非 service-role、
 *     .or/.eq 原子谓词、零平行表;PATCH 路由写者谓词与 CAS 同 UPDATE、WRITER_LOCKED 可区分)。
 *
 * 全部为**运行断言**(fake 驱动真实生产代码),源码检查仅作补充卫生项。IO(真 RLS/CAS 写)
 * 由 Next 路由承接,不在此测;其原子性以「生产纯谓词 + 源码谓词形态」双向印证。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasModule } from "./canvas-build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const fails = [];
let pass = 0;

function ok(condition, label) {
  if (condition) pass += 1;
  else {
    fails.push(label);
    console.log(`  ❌ ${label}`);
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

// 依赖顺序构建(leaf 先落盘,relative import 才解析):schema/doc-limits/patch/queue/api-types/writer-lock/helpers
const schema = await loadCanvasModule("schema");
await loadCanvasModule("doc-limits");
const patch = await loadCanvasModule("patch");
const queue = await loadCanvasModule("offline-queue");
const apiTypes = await loadCanvasModule("api-types");
const writerLock = await loadCanvasModule("writer-lock");
const helpers = await loadCanvasModule("api-helpers");

const { createCanvasNode } = schema;
const { CanvasOpSchema } = patch;
const { createOfflineQueue, enqueue, buildPatch } = queue;
const { CANVAS_API_ERROR_CODES, httpStatusForCanvasError } = apiTypes;
const {
  WRITER_LEASE_MS,
  WRITER_HEARTBEAT_MS,
  isWriterTag,
  createWriterTag,
  heartbeatEpochMs,
  isWriterLeaseActive,
  canClaimWriter,
  authorizeWriterWrite,
  authorizeWriterPatch,
  classifyWriterFailure,
  writerLeaseCutoffIso,
  writerActiveSinceIso,
  createWriterLockController,
} = writerLock;
const {
  decidePatch,
  buildWriterLeaseData,
  writerLockedDetails,
  CanvasWriterRequestSchema,
  CanvasPatchBodySchema,
  CanvasPatchWriteBodySchema,
} = helpers;

const addOp = (value) => CanvasOpSchema.parse({ entity: "node", op: "add", value });
const isoOf = (ms) => new Date(ms).toISOString();

// ── fake 基础设施 ─────────────────────────────────────────────────────────────

function makeClock(start = 1_000_000_000) {
  let ms = start;
  return { now: () => ms, advance: (d) => (ms += d) };
}

/** 内存 canvas 行引擎:claim/heartbeat/release 全部经**生产纯谓词**决策,忠实镜像路由原子条件。 */
function makeFakeServer(now) {
  const row = { writerTag: null, writerHeartbeatAt: null };
  const info = () => ({ tag: row.writerTag, heartbeatAt: row.writerHeartbeatAt });
  return {
    row,
    claim(tag) {
      // 镜像 UPDATE ... WHERE writer_tag IS NULL OR writer_tag=:tag OR heartbeat<now-lease
      if (canClaimWriter(row, tag, now())) {
        row.writerTag = tag;
        row.writerHeartbeatAt = isoOf(now());
        return { status: "holding", writer: info(), serverNow: isoOf(now()) };
      }
      return { status: "locked", writer: info(), serverNow: isoOf(now()) };
    },
    heartbeat(tag) {
      // 镜像 UPDATE ... WHERE writer_tag=:tag(只能同 tag)
      if (authorizeWriterWrite(row, tag)) {
        row.writerHeartbeatAt = isoOf(now());
        return { status: "holding", writer: info(), serverNow: isoOf(now()) };
      }
      return { status: "locked", writer: info(), serverNow: isoOf(now()) };
    },
    release(tag) {
      if (authorizeWriterWrite(row, tag)) {
        row.writerTag = null;
        row.writerHeartbeatAt = null;
      }
    },
  };
}

function makeCounters() {
  return { claim: 0, heartbeat: 0, release: 0 };
}
function transportFor(server, tag, counters) {
  return {
    claim: async () => {
      counters.claim += 1;
      return server.claim(tag);
    },
    heartbeat: async () => {
      counters.heartbeat += 1;
      return server.heartbeat(tag);
    },
    release: async () => {
      counters.release += 1;
      server.release(tag);
    },
  };
}

/** 忠实模拟 navigator.locks:exclusive + ifAvailable。持锁期间他者请求得 null(不排队、不误删他人锁)。 */
function makeFakeLockManager() {
  const held = new Set();
  return {
    request(name, options, cb) {
      if (held.has(name)) {
        // 已被占用:ifAvailable → 授 null(绝不触碰 held,不释放在持者)
        return Promise.resolve(cb(null));
      }
      held.add(name);
      let ret;
      try {
        ret = cb({ name, mode: options.mode });
      } catch (error) {
        held.delete(name);
        return Promise.reject(error);
      }
      // 持有直至回调返回的 Promise 结算(控制器保持其悬挂到 stop→releaseNavLock)
      return Promise.resolve(ret).finally(() => held.delete(name));
    },
  };
}

/** 延迟型锁管理器:回调不立即触发,由 fire() 手动触发——用于测「迟到回调 fail-closed」。 */
function makeDeferredLockManager() {
  let pending = null;
  return {
    manager: {
      request(name, options, cb) {
        return new Promise((resolve) => {
          pending = () => resolve(Promise.resolve(cb({ name, mode: options.mode })));
        });
      },
    },
    fire() {
      const f = pending;
      pending = null;
      if (f) f();
    },
  };
}

function makeFakeScheduler() {
  const timers = new Map();
  let nextId = 1;
  return {
    scheduler: {
      setInterval(fn, ms) {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearInterval(handle) {
        timers.delete(handle);
      },
    },
    count: () => timers.size,
    firstMs: () => {
      const it = timers.values().next();
      return it.done ? null : it.value.ms;
    },
    fireAll() {
      for (const t of [...timers.values()]) t.fn();
    },
  };
}

function makeFakeVisibility(state = "visible") {
  const source = {
    visibilityState: state,
    addEventListener(type, l) {
      if (type === "visibilitychange") this._l = l;
    },
    removeEventListener(type, l) {
      if (type === "visibilitychange" && this._l === l) this._l = null;
    },
    _l: null,
  };
  return {
    source,
    count: () => (source._l ? 1 : 0),
    setState: (s) => (source.visibilityState = s),
    fire: () => {
      if (source._l) source._l();
    },
  };
}

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("① writer tag(唯一/合法/字符集)");
ok(isWriterTag(createWriterTag()), "createWriterTag 产出合法 tag");
{
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(createWriterTag());
  eq(seen.size, 200, "createWriterTag 200 次全唯一");
}
ok(!isWriterTag(""), "空串非 tag");
ok(!isWriterTag("has space"), "含空格非 tag(防 .or 注入)");
ok(!isWriterTag("short7x"), "7 字符非 tag(min 8)");
ok(isWriterTag("abcd1234"), "8 字符合法");
ok(isWriterTag("A_b-9".padEnd(20, "z")), "字母数字下划连字符合法");
ok(!isWriterTag("a".repeat(129)), "129 字符超上限被拒");
ok(!isWriterTag("tag.with.dot!!"), "含 . ! 等保留/非法字符被拒");
ok(!isWriterTag(12345678), "非字符串被拒");

// ─────────────────────────────────────────────────────────────────────────────
console.log("② 纯决策真值表(与服务端 SQL 谓词一一对应)");
const NOW = 1_000_000_000;
const A = createWriterTag();
const B = createWriterTag();
const freshHb = isoOf(NOW);
const staleHb = isoOf(NOW - WRITER_LEASE_MS - 1000);
const edgeHb = isoOf(NOW - WRITER_LEASE_MS); // 恰好一个租约前

// canClaimWriter
ok(canClaimWriter({ writerTag: null, writerHeartbeatAt: null }, A, NOW) === true, "claim 空行 → 可领");
ok(canClaimWriter({ writerTag: A, writerHeartbeatAt: freshHb }, A, NOW) === true, "重入领自己(活跃)→ 可领");
ok(canClaimWriter({ writerTag: B, writerHeartbeatAt: freshHb }, A, NOW) === false, "他人活跃 → 不可领");
ok(canClaimWriter({ writerTag: B, writerHeartbeatAt: staleHb }, A, NOW) === true, "他人过期 → 可接管");
ok(canClaimWriter({ writerTag: B, writerHeartbeatAt: edgeHb }, A, NOW) === false, "他人恰好整租约 → 尚不可接管(严格 >)");
ok(canClaimWriter({ writerTag: B, writerHeartbeatAt: null }, A, NOW) === false, "他人心跳为 null → SQL null 语义不可接管");
ok(canClaimWriter({ writerTag: null, writerHeartbeatAt: null }, "bad tag", NOW) === false, "非法 tag → 不可领");
ok(canClaimWriter({ writerTag: B, writerHeartbeatAt: staleHb }, A, Number.NaN) === false, "now 非有限 → 不可领(防误接管)");

// authorizeWriterWrite(heartbeat/release 归属谓词:精确同 tag,与租约新鲜度无关——镜像 .eq("writer_tag",tag))
ok(authorizeWriterWrite({ writerTag: A, writerHeartbeatAt: freshHb }, A) === true, "同 tag 活跃 → 归属(heartbeat/release 可续/可清)");
ok(authorizeWriterWrite({ writerTag: A, writerHeartbeatAt: staleHb }, A) === true, "同 tag 即使心跳逾期 → 仍归属(未被接管,heartbeat 可自我恢复)");
ok(authorizeWriterWrite({ writerTag: B, writerHeartbeatAt: freshHb }, A) === false, "他 tag → 非归属");
ok(authorizeWriterWrite({ writerTag: null, writerHeartbeatAt: null }, A) === false, "无持有者 → 非归属(须先 claim)");
ok(authorizeWriterWrite({ writerTag: A, writerHeartbeatAt: freshHb }, "bad tag") === false, "来袭 tag 非法 → 非归属");

// authorizeWriterPatch(PATCH 写门禁:**活跃同 tag**,合法 tag + 同 tag + 心跳 30s 内未过期;fail-closed)
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: freshHb }, A, NOW) === true, "同 tag + 新心跳 → 授权写");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: edgeHb }, A, NOW) === true, "同 tag + 心跳恰好整租约 → 授权(闭区间)");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: staleHb }, A, NOW) === false, "同 tag + 心跳过期 → 拒写(不得经 PATCH 复活过期租约)");
ok(authorizeWriterPatch({ writerTag: B, writerHeartbeatAt: freshHb }, A, NOW) === false, "他 tag → 拒写");
ok(authorizeWriterPatch({ writerTag: null, writerHeartbeatAt: null }, A, NOW) === false, "无持有者 → 拒写(须先 claim)");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: null }, A, NOW) === false, "同 tag 但心跳缺失 → 拒写(fail-closed)");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: isoOf(NOW + 5000) }, A, NOW) === false, "同 tag 但心跳位于未来(时钟异常)→ 拒写(fail-closed)");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: freshHb }, "bad tag", NOW) === false, "非法来袭 tag → 拒写");
ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: freshHb }, A, Number.NaN) === false, "now 非有限 → 拒写(fail-closed)");

// writerActiveSinceIso:PATCH 原子 UPDATE 的 .gte 下界,与 authorizeWriterPatch 边界逐毫秒一致
{
  const since = writerActiveSinceIso(NOW);
  eq(Date.parse(since), NOW - WRITER_LEASE_MS, "writerActiveSinceIso = now-lease(保留毫秒全精度)");
  ok(!/[,()]/.test(since) && since.endsWith("Z"), "since ISO 形态合法(单列 .gte,不经 .or 无需去毫秒)");
  ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: since }, A, NOW) === true, "hb == since(now-lease)→ 活跃(闭区间,与 .gte 一致)");
  ok(authorizeWriterPatch({ writerTag: A, writerHeartbeatAt: isoOf(NOW - WRITER_LEASE_MS - 1) }, A, NOW) === false, "hb < since → 过期(与 .gte 落 0 行一致)");
}

// isWriterLeaseActive
ok(isWriterLeaseActive({ writerTag: A, writerHeartbeatAt: freshHb }, NOW) === true, "新心跳 → 活跃");
ok(isWriterLeaseActive({ writerTag: A, writerHeartbeatAt: staleHb }, NOW) === false, "陈旧心跳 → 不活跃");
ok(isWriterLeaseActive({ writerTag: null, writerHeartbeatAt: freshHb }, NOW) === false, "无 tag → 不活跃");
ok(isWriterLeaseActive({ writerTag: A, writerHeartbeatAt: edgeHb }, NOW) === true, "恰好整租约 → 仍活跃(<=)");

// heartbeatEpochMs
ok(heartbeatEpochMs(null) === null, "heartbeatEpochMs(null) → null");
ok(heartbeatEpochMs("") === null, "heartbeatEpochMs('') → null");
ok(heartbeatEpochMs("not-a-date") === null, "heartbeatEpochMs 垃圾 → null");
ok(heartbeatEpochMs(freshHb) === NOW, "heartbeatEpochMs 合法 ISO → epoch ms");

// classifyWriterFailure
eq(classifyWriterFailure(null), "not_found", "重读 null → not_found");
eq(classifyWriterFailure({ writerTag: B, writerHeartbeatAt: freshHb }), "locked", "重读有行 → locked");

// writerLeaseCutoffIso:可安全内插 PostgREST .or()
{
  const cutoff = writerLeaseCutoffIso(NOW);
  ok(!cutoff.includes("."), "cutoff ISO 无小数点(可内插 .or)");
  ok(!/[,()]/.test(cutoff) && cutoff.endsWith("Z"), "cutoff 无 or() 保留分隔符");
  ok(Date.parse(cutoff) <= NOW - WRITER_LEASE_MS, "cutoff ≤ now-lease");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("③ 服务端 claim/heartbeat/release 原子条件(内存行引擎,生产谓词驱动)");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const wa = createWriterTag();
  const wb = createWriterTag();

  let r = server.claim(wa);
  ok(r.status === "holding" && server.row.writerTag === wa, "空行 claim → 领到(写 tag+心跳)");
  r = server.claim(wb);
  ok(r.status === "locked" && server.row.writerTag === wa, "他人活跃时 claim → LOCKED,原持有者不变");
  r = server.claim(wa);
  ok(r.status === "holding", "同 tag 重复 claim → 续领(幂等续租)");
  r = server.heartbeat(wa);
  ok(r.status === "holding", "同 tag heartbeat → 续租成功");
  r = server.heartbeat(wb);
  ok(r.status === "locked", "他 tag heartbeat → LOCKED(只能同 tag)");
  server.release(wb);
  ok(server.row.writerTag === wa, "他 tag release → no-op(不清他人锁)");
  clock.advance(WRITER_LEASE_MS + 1);
  r = server.claim(wb);
  ok(r.status === "holding" && server.row.writerTag === wb, "租约过期后他人 claim → 接管");
  r = server.heartbeat(wa);
  ok(r.status === "locked", "丢锁者 heartbeat → LOCKED");
  server.release(wb);
  ok(server.row.writerTag === null && server.row.writerHeartbeatAt === null, "持有者 release → 清空两列");
  r = server.claim(wa);
  ok(r.status === "holding", "释放后可再被 claim");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("④ D3 PATCH decidePatch writerTag 门禁 + 锁/rev 冲突可区分 + 响应构造");
{
  const nodeA = createCanvasNode({ id: "node_a", type: "text", position: { x: 0, y: 0 } });
  const nodeC = createCanvasNode({ id: "node_c", type: "video", position: { x: 7, y: 7 } });
  const stored = { nodes: [nodeA], edges: [], groups: [] };
  const hb = isoOf(NOW);
  const base = {
    storedDoc: stored,
    storedDeps: {},
    storedTitle: "t",
    storedRev: 5,
    storedSchemaVersion: 1,
    storedDocBytes: null,
    baseRev: 5,
    ops: [],
    nowIso: hb,
    nowMs: NOW, // D5:门禁判活跃租约需当前时刻(与路由每 attempt 传入 nowMs 一致)
  };

  let d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: hb } });
  ok(d.kind === "write" && d.applied === 1, "授权(活跃同 tag)写者 → write");

  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: B, writerHeartbeatAt: hb } });
  ok(d.kind === "locked", "他 tag → locked(WRITER_LOCKED)");
  ok(d.details.writer && d.details.writer.tag === B, "locked details 暴露当前持有者 tag");
  ok(d.details.leaseMs === WRITER_LEASE_MS && d.details.heartbeatMs === WRITER_HEARTBEAT_MS && d.details.serverNow === hb, "locked details 带租约预算 + serverNow");
  ok(d.details.serverRev === 5, "locked details 带 serverRev");

  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: null, writerHeartbeatAt: null } });
  ok(d.kind === "locked", "无持有者(tag null)→ locked(须先 claim)");

  d = decidePatch({ ...base, ops: [addOp(nodeC)] });
  ok(d.kind === "write" && d.applied === 1, "不带 writerTag → legacy write(D1–D4 门禁不回归)");

  // 锁冲突优先于 rev,且与 rev 冲突严格可区分(不同 kind/错误码)
  d = decidePatch({ ...base, baseRev: 9, ops: [], writerTag: A, storedWriter: { writerTag: B, writerHeartbeatAt: hb } });
  ok(d.kind === "locked", "他 tag + baseRev 超前 → 锁冲突优先(locked)");
  d = decidePatch({ ...base, baseRev: 9, ops: [], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: hb } });
  ok(d.kind === "reload" && d.code === "REV_CONFLICT", "授权但 baseRev 超前 → REV_CONFLICT(rev 冲突,非锁)");

  // 同 tag 但心跳过期 → 现按 P0 单写者安全边界收紧:PATCH 拒写(不得顺手复活过期租约;须先经 writer 路由续租)
  const stale = isoOf(NOW - WRITER_LEASE_MS - 5000);
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: stale } });
  ok(d.kind === "locked", "同 tag 心跳过期 → locked(过期租约不得经 PATCH 复活)");

  // 心跳边界:恰好整租约仍可写(闭区间);越界 1ms 即拒
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: isoOf(NOW - WRITER_LEASE_MS) } });
  ok(d.kind === "write", "同 tag 心跳恰好整租约 → write(闭区间)");
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: isoOf(NOW - WRITER_LEASE_MS - 1) } });
  ok(d.kind === "locked", "同 tag 心跳越界 1ms → locked");

  // fail-closed:未来心跳(时钟异常)/ 心跳缺失 / now 缺失 → 一律 locked,绝不误放过期或异常写者
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: isoOf(NOW + 5000) } });
  ok(d.kind === "locked", "同 tag 未来心跳(时钟异常)→ locked(fail-closed)");
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: null } });
  ok(d.kind === "locked", "同 tag 心跳为 null → locked(fail-closed)");
  d = decidePatch({ ...base, ops: [addOp(nodeC)], writerTag: A, storedWriter: { writerTag: A, writerHeartbeatAt: hb }, nowMs: undefined });
  ok(d.kind === "locked", "now 缺失(nowMs undefined)→ locked(fail-closed)");

  // 响应构造
  const lease = buildWriterLeaseData("claim", true, A, { writerTag: A, writerHeartbeatAt: hb }, hb);
  ok(
    lease.action === "claim" && lease.holding === true && lease.tag === A && lease.writer.tag === A && lease.leaseMs === WRITER_LEASE_MS && lease.heartbeatMs === WRITER_HEARTBEAT_MS && lease.serverNow === hb,
    "buildWriterLeaseData 形状(claim holding)"
  );
  const rel = buildWriterLeaseData("release", false, A, { writerTag: null, writerHeartbeatAt: null }, hb);
  ok(rel.holding === false && rel.writer.tag === null && rel.writer.heartbeatAt === null, "buildWriterLeaseData(release)→ holding false,writer 清空");
  const det = writerLockedDetails({ tag: B, heartbeatAt: hb }, hb, 5);
  ok(det.writer.tag === B && det.leaseMs === WRITER_LEASE_MS && det.serverNow === hb && det.serverRev === 5, "writerLockedDetails 形状");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑤ 控制器:本地双标签(第二个只读)+ 释放接管");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager();
  const sched = makeFakeScheduler();
  const tagA = createWriterTag();
  const tagB = createWriterTag();
  const cA = makeCounters();
  const cB = makeCounters();
  const opts = (tag, counters) => ({
    canvasId: "cv",
    tag,
    locks,
    scheduler: sched.scheduler,
    visibility: null,
    now: clock.now,
    transport: transportFor(server, tag, counters),
  });
  const w1 = createWriterLockController(opts(tagA, cA));
  const w2 = createWriterLockController(opts(tagB, cB));

  w1.start();
  await flush();
  ok(w1.getStatus().role === "writer" && w1.getStatus().reason === "acquired" && w1.getStatus().canWrite === true, "第一个标签 → 写者");
  ok(server.row.writerTag === tagA, "服务端行记 tagA");
  ok(w1.getStatus().serverWriter && w1.getStatus().serverWriter.tag === tagA, "写者 serverWriter 反映自身持有");

  w2.start();
  await flush();
  ok(w2.getStatus().role === "reader" && w2.getStatus().reason === "held-by-other-tab", "第二个标签 → 只读(兄弟标签持锁)");
  eq(cB.claim, 0, "第二个标签在 navigator 锁层即被挡,从不 claim 服务端");
  ok(server.row.writerTag === tagA, "服务端仍是 tagA(第二标签未夺锁)");

  await w1.stop();
  await flush();
  ok(server.row.writerTag === null, "写者 stop 释放服务端租约");
  ok(cA.release >= 1, "stop 调用 release");

  w2.refresh();
  await flush();
  ok(w2.getStatus().role === "writer" && server.row.writerTag === tagB, "释放后第二标签 refresh 接管 → 写者");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑤b 控制器:兄弟标签关闭后低频定时重试自动接管(无 visibilitychange / 无 refresh)");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager(); // 同浏览器:共享一个 LockManager(兄弟标签互斥)
  const schedA = makeFakeScheduler();
  const schedB = makeFakeScheduler();
  const tagA = createWriterTag();
  const tagB = createWriterTag();
  const cA = makeCounters();
  const cB = makeCounters();
  // 关键:visibility 显式 null(禁用 visibilitychange 续租)且全程从不调用 refresh,
  // 证明纯靠 running 期贯穿的低频定时重试即可在兄弟关闭后自行接管(修复:旧实现无重试会永久卡只读)。
  const mk = (tag, sched, counters) =>
    createWriterLockController({
      canvasId: "cv",
      tag,
      locks,
      scheduler: sched.scheduler,
      visibility: null,
      now: clock.now,
      transport: transportFor(server, tag, counters),
    });
  const w1 = mk(tagA, schedA, cA);
  const w2 = mk(tagB, schedB, cB);

  w1.start();
  await flush();
  ok(w1.getStatus().role === "writer", "标签1 → 写者");

  w2.start();
  await flush();
  ok(w2.getStatus().role === "reader" && w2.getStatus().reason === "held-by-other-tab", "标签2 → 只读(兄弟持锁)");
  eq(schedB.count(), 1, "标签2 running 期即注册定时器(未持锁也承载低频重试)");

  // 兄弟仍在:定时重试仍拿不到锁(cb null),不夺锁、不 claim 服务端(节流 + acquiring/holding 互斥,无重叠)
  clock.advance(WRITER_HEARTBEAT_MS);
  schedB.fireAll();
  await flush();
  ok(w2.getStatus().role === "reader" && server.row.writerTag === tagA, "兄弟在:重试仍只读,不夺兄弟锁");
  eq(cB.claim, 0, "兄弟在:重试从不 claim 服务端(nav 锁层即挡)");
  eq(schedB.count(), 1, "重试不新增定时器(无泄漏/无重叠)");

  // 标签1 关闭(stop 释放 nav 锁 + 服务端租约);标签2 从不 refresh(无 visibilitychange 可依赖)
  await w1.stop();
  await flush();
  ok(server.row.writerTag === null, "标签1 stop 释放服务端租约");
  eq(schedA.count(), 0, "标签1 stop 清空自身定时器(有清理)");

  // 仅靠标签2 的低频定时重试:推进一个节流周期 → 自动重新竞锁并接管
  clock.advance(WRITER_HEARTBEAT_MS);
  schedB.fireAll();
  await flush();
  ok(w2.getStatus().role === "writer" && server.row.writerTag === tagB, "兄弟关闭后定时重试自动接管 → 写者(无需 visibilitychange/refresh)");
  eq(schedB.count(), 1, "接管后仍单一定时器(承载心跳,无重叠)");

  // 接管后 stop 仍 fail-closed 清理
  await w2.stop();
  await flush();
  ok(w2.getStatus().role === "reader" && w2.getStatus().reason === "stopped", "标签2 stop → 只读 stopped(fail-closed)");
  eq(schedB.count(), 0, "标签2 stop 清空定时器");
  ok(cB.release >= 1, "接管过写者,stop 释放服务端租约");
  ok(server.row.writerTag === null, "标签2 stop 后服务端行清空");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑥ 控制器:过期接管 + 丢锁降级(跨浏览器=独立 LockManager,共享服务端)");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locksA = makeFakeLockManager();
  const locksB = makeFakeLockManager();
  const schedA = makeFakeScheduler();
  const schedB = makeFakeScheduler();
  const tagA = createWriterTag();
  const tagB = createWriterTag();
  const cA = makeCounters();
  const cB = makeCounters();
  const wA = createWriterLockController({ canvasId: "cv", tag: tagA, locks: locksA, scheduler: schedA.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tagA, cA) });
  const wB = createWriterLockController({ canvasId: "cv", tag: tagB, locks: locksB, scheduler: schedB.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tagB, cB) });

  wA.start();
  await flush();
  ok(wA.getStatus().role === "writer", "浏览器 A 经服务端租约成为写者");

  wB.start();
  await flush();
  ok(wB.getStatus().role === "reader" && wB.getStatus().reason === "held-by-server", "浏览器 B 被活跃服务端租约挡为只读(held-by-server)");

  clock.advance(WRITER_LEASE_MS + 1000); // A 疑似崩溃:停止心跳,租约过期
  schedB.fireAll();
  await flush();
  ok(wB.getStatus().role === "writer" && server.row.writerTag === tagB, "A 租约过期后 B 轮询接管 → 写者");

  schedA.fireAll();
  await flush();
  ok(wA.getStatus().role === "reader" && wA.getStatus().reason === "held-by-server", "A 心跳发现丢锁 → 降级只读");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑦ 控制器:fail-closed(无 locks / 抛错 / reject·abort / 迟到回调)");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const sched = makeFakeScheduler();
  const tag = createWriterTag();

  // 无 navigator.locks
  const cN = makeCounters();
  const wN = createWriterLockController({ canvasId: "cv", tag, locks: null, scheduler: sched.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tag, cN) });
  wN.start();
  await flush();
  ok(wN.getStatus().role === "reader" && wN.getStatus().reason === "no-locks-api" && wN.getStatus().canWrite === false, "无 navigator.locks → 只读(no-locks-api)fail-closed");
  eq(cN.claim, 0, "无 locks 从不 claim 服务端");

  // request 同步抛
  const throwing = { request() { throw new Error("boom"); } };
  const wT = createWriterLockController({ canvasId: "cv", tag, locks: throwing, scheduler: sched.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tag, makeCounters()) });
  wT.start();
  await flush();
  ok(wT.getStatus().role === "reader" && wT.getStatus().reason === "error", "request 抛错 → 只读(error)fail-closed");

  // request 异步 reject(abort 类)
  const rejecting = { request() { return Promise.reject(new Error("abort")); } };
  const wR = createWriterLockController({ canvasId: "cv", tag, locks: rejecting, scheduler: sched.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tag, makeCounters()) });
  wR.start();
  await flush();
  ok(wR.getStatus().role === "reader" && wR.getStatus().reason === "error", "request reject/abort → 只读(error)fail-closed");

  // 迟到回调:stop 后才触发 → 忽略,绝不翻转写者
  const deferred = makeDeferredLockManager();
  const cL = makeCounters();
  const wL = createWriterLockController({ canvasId: "cv", tag, locks: deferred.manager, scheduler: sched.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tag, cL) });
  wL.start();
  await flush();
  ok(wL.getStatus().role === "reader", "回调未触发前 → 只读");
  await wL.stop();
  await flush();
  deferred.fire();
  await flush();
  ok(wL.getStatus().role === "reader" && wL.getStatus().reason === "stopped", "stop 后迟到 nav-lock 回调被忽略(fail-closed)");
  eq(cL.claim, 0, "迟到回调从不 claim(generation 守卫)");

  // 重复 start / stop 幂等
  const dup = makeDeferredLockManager();
  const wD = createWriterLockController({ canvasId: "cv", tag, locks: dup.manager, scheduler: sched.scheduler, visibility: null, now: clock.now, transport: transportFor(server, tag, makeCounters()) });
  wD.start();
  wD.start(); // 第二次 no-op
  await flush();
  await wD.stop();
  await wD.stop(); // 第二次 no-op(不抛)
  await flush();
  ok(wD.getStatus().reason === "stopped", "重复 start/stop 幂等(不抛)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧ 控制器:心跳调度 + visibility 续租 + stop 清理");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager();
  const sched = makeFakeScheduler();
  const vis = makeFakeVisibility("visible");
  const tag = createWriterTag();
  const c = makeCounters();
  const w = createWriterLockController({
    canvasId: "cv",
    tag,
    locks,
    scheduler: sched.scheduler,
    visibility: vis.source,
    now: clock.now,
    heartbeatMs: WRITER_HEARTBEAT_MS,
    transport: transportFor(server, tag, c),
  });

  w.start();
  await flush();
  ok(w.getStatus().role === "writer", "获取到写者");
  eq(sched.count(), 1, "心跳定时器已注册(1 个)");
  eq(sched.firstMs(), WRITER_HEARTBEAT_MS, "心跳间隔 = heartbeatMs(10s)");
  eq(c.claim, 1, "初次获取用 claim(非 heartbeat)");
  eq(c.heartbeat, 0, "尚无心跳");

  const beforeHb = c.heartbeat;
  sched.fireAll();
  await flush();
  sched.fireAll();
  await flush();
  eq(c.heartbeat, beforeHb + 2, "两次定时触发 → 两次心跳");

  eq(vis.count(), 1, "visibility 监听已挂");
  const beforeVis = c.heartbeat;
  vis.fire();
  await flush();
  eq(c.heartbeat, beforeVis + 1, "visibility 回前台 → 立即续租一次心跳");

  // 隐藏态不续租(仅 visible 触发)
  vis.setState("hidden");
  const beforeHidden = c.heartbeat;
  vis.fire();
  await flush();
  eq(c.heartbeat, beforeHidden, "隐藏态 visibilitychange 不续租");

  await w.stop();
  await flush();
  eq(sched.count(), 0, "stop 清空心跳定时器");
  eq(vis.count(), 0, "stop 移除 visibility 监听");
  ok(c.release >= 1, "stop 释放服务端租约");
  ok(server.row.writerTag === null, "stop 后服务端行清空");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧b 控制器:心跳 Promise 永不 settle → 超租约本地判死 fail-closed(busy 不豁免)+ 迟到心跳不复活");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager();
  const sched = makeFakeScheduler();
  const tag = createWriterTag();
  const c = makeCounters();
  let hbResolve = null; // 手动结算的挂起心跳
  const transport = {
    claim: async () => {
      c.claim += 1;
      return server.claim(tag);
    },
    heartbeat: () =>
      new Promise((resolve) => {
        c.heartbeat += 1;
        hbResolve = () => resolve(server.heartbeat(tag));
      }),
    release: async () => {
      c.release += 1;
      server.release(tag);
    },
  };
  const w = createWriterLockController({ canvasId: "cv", tag, locks, scheduler: sched.scheduler, visibility: null, now: clock.now, transport });

  w.start();
  await flush();
  ok(w.getStatus().role === "writer" && w.getStatus().canWrite === true, "初次 claim → 写者");
  eq(c.claim, 1, "初次用 claim");

  // 触发一次心跳 → 挂起(永不 settle)
  sched.fireAll();
  await flush();
  eq(c.heartbeat, 1, "一次心跳已派发(在途挂起)");
  ok(w.getStatus().role === "writer", "心跳在途、仍在租约窗口内 → 保持写者(不抖动)");

  // 跨过 lease 后再 tick:即便心跳仍 busy 在途,也须按**本地租约最后成功时间**判死,立即降级
  clock.advance(WRITER_LEASE_MS + 1);
  sched.fireAll();
  await flush();
  ok(
    w.getStatus().role === "reader" && w.getStatus().reason === "error" && w.getStatus().canWrite === false,
    "心跳在途 + 超 lease → fail-closed 降 reader/error(busy 不豁免)"
  );
  eq(c.heartbeat, 1, "降级期间不重叠派发第二次心跳(无重叠)");

  // 迟到心跳结算(holding)→ 绝不复活写者;其续成的服务端幽灵租约被补偿 release
  const beforeRelease = c.release;
  hbResolve();
  await flush();
  ok(
    w.getStatus().role === "reader" && w.getStatus().reason === "error",
    "迟到 heartbeat(holding)不复活写者态(已换代)"
  );
  eq(c.release, beforeRelease + 1, "迟到 holding 心跳 → 补偿 release 清幽灵租约");
  ok(server.row.writerTag === null, "补偿后服务端行清空(无幽灵租约残留)");

  await w.stop();
  await flush();
  ok(w.getStatus().reason === "stopped", "stop 幂等清理(迟到心跳后仍可正常 stop)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧c 控制器:首次 claim 在途时 stop → 幽灵租约补偿 release,状态仍 stopped 不复活");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager();
  const sched = makeFakeScheduler();
  const tag = createWriterTag();
  const c = makeCounters();
  let claimResolve = null; // 手动结算的挂起 claim
  const transport = {
    claim: () =>
      new Promise((resolve) => {
        c.claim += 1;
        claimResolve = () => resolve(server.claim(tag));
      }),
    heartbeat: async () => {
      c.heartbeat += 1;
      return server.heartbeat(tag);
    },
    release: async () => {
      c.release += 1;
      server.release(tag);
    },
  };
  const w = createWriterLockController({ canvasId: "cv", tag, locks, scheduler: sched.scheduler, visibility: null, now: clock.now, transport });

  w.start();
  await flush();
  // 首次 claim 已派发但挂起(未 settle)→ 尚未成为写者、服务端尚未写 tag
  eq(c.claim, 1, "首次 claim 已派发(在途挂起)");
  ok(w.getStatus().role === "reader", "claim 未结算前仍只读");
  ok(server.row.writerTag === null, "claim 未结算前服务端未写 tag");

  // claim 在途时 stop:stop 的 release 先行 no-op(此刻 tag 尚未写入服务端)
  await w.stop();
  await flush();
  ok(w.getStatus().role === "reader" && w.getStatus().reason === "stopped", "stop → reader/stopped");
  const afterStopRelease = c.release; // stop 已尝试一次 release(此刻 no-op)

  // 迟到 claim 结算 holding:服务端此刻才写入 tag(幽灵租约)→ 必须二次补偿 release,且绝不复活状态
  claimResolve();
  await flush();
  ok(
    w.getStatus().role === "reader" && w.getStatus().reason === "stopped",
    "迟到 claim(holding)不复活状态(仍 stopped,无回调翻转)"
  );
  eq(c.release, afterStopRelease + 1, "迟到 claim holding → 二次补偿 release(清 stop 遗漏的幽灵租约)");
  ok(server.row.writerTag === null, "补偿后无幽灵租约残留(服务端行清空)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧d 控制器:迟到 heartbeat 补偿 release = 重入屏障(未 resolve 前不发新 claim,resolve 后方恢复)");
{
  const clock = makeClock();
  const server = makeFakeServer(clock.now);
  const locks = makeFakeLockManager();
  const sched = makeFakeScheduler();
  const tag = createWriterTag();
  const c = makeCounters();
  let hbResolve = null;
  let releaseResolve = null; // 手动结算的补偿 release(deferred)
  let deferRelease = true; // 首个补偿 release 挂起(可控);置 false 后(如 stop)即时结算
  const transport = {
    claim: async () => {
      c.claim += 1;
      return server.claim(tag);
    },
    heartbeat: () =>
      new Promise((resolve) => {
        c.heartbeat += 1;
        hbResolve = () => resolve(server.heartbeat(tag));
      }),
    release: () =>
      new Promise((resolve) => {
        c.release += 1;
        if (deferRelease) {
          releaseResolve = () => {
            server.release(tag);
            resolve();
          };
        } else {
          server.release(tag);
          resolve();
        }
      }),
  };
  const w = createWriterLockController({ canvasId: "cv", tag, locks, scheduler: sched.scheduler, visibility: null, now: clock.now, transport });

  w.start();
  await flush();
  ok(w.getStatus().role === "writer", "初次 claim → 写者");
  eq(c.claim, 1, "初次 claim 计 1");

  // 触发心跳 → 挂起(永不自动 settle)
  sched.fireAll();
  await flush();
  eq(c.heartbeat, 1, "心跳派发并挂起");

  // 跨租约后 tick:即便心跳仍 busy,按本地租约判死降级
  clock.advance(WRITER_LEASE_MS + 1);
  sched.fireAll();
  await flush();
  ok(w.getStatus().role === "reader" && w.getStatus().reason === "error", "超租约 → reader/error(busy 不豁免)");

  // 迟到 heartbeat 结算 holding → 触发补偿 release,但 release 挂起未 resolve
  hbResolve();
  await flush();
  eq(c.release, 1, "迟到 holding 心跳 → 发起补偿 release(deferred,挂起)");
  ok(w.getStatus().role === "reader", "补偿在途仍 reader");
  ok(server.row.writerTag === tag, "补偿未 resolve → 服务端幽灵租约尚在(本 tag)");

  // 补偿 release 未 resolve 期间:多次 tick 均被 busy 屏障挡下,不发新 claim、不重复 release
  const claimBefore = c.claim;
  sched.fireAll();
  await flush();
  sched.fireAll();
  await flush();
  eq(c.claim, claimBefore, "补偿 release 未结算 → 多次 tick 不发新 claim(重入屏障)");
  eq(c.release, 1, "屏障期间不重复发起 release");
  ok(w.getStatus().role === "reader" && w.getStatus().canWrite === false, "屏障期间保持 reader fail-closed");

  // 补偿 release resolve → 清除幽灵租约;此后 release 即时结算(供 stop),下一 tick 方可恢复
  deferRelease = false;
  releaseResolve();
  await flush();
  ok(server.row.writerTag === null, "补偿 release resolve → 幽灵租约清除");
  ok(w.getStatus().role === "reader", "resolve 当拍尚未自动 claim(需下一 tick)");

  sched.fireAll();
  await flush();
  ok(w.getStatus().role === "writer" && server.row.writerTag === tag, "屏障解除后下一 tick 重新 claim 同 tag → 恢复写者");
  eq(c.claim, claimBefore + 1, "恢复仅发一次新 claim(旧迟到 release 已先行结算,绝不清新租约)");

  await w.stop();
  await flush();
  ok(w.getStatus().reason === "stopped", "stop 清理");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑨ 严格请求体(writer 路由 body + PATCH body 的 writerTag)");
{
  const tag = createWriterTag();
  ok(CanvasWriterRequestSchema.safeParse({ writerTag: tag, action: "claim" }).success, "合法 claim body");
  ok(CanvasWriterRequestSchema.safeParse({ writerTag: tag, action: "heartbeat" }).success, "合法 heartbeat body");
  ok(CanvasWriterRequestSchema.safeParse({ writerTag: tag, action: "release" }).success, "合法 release body");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: tag, action: "steal" }).success, "未知 action 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: tag }).success, "缺 action 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ action: "claim" }).success, "缺 writerTag 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: tag, action: "claim", extra: 1 }).success, "未知字段被拒(strict)");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: "bad tag", action: "claim" }).success, "含空格 tag 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: "short", action: "claim" }).success, "过短 tag 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: "x".repeat(129), action: "claim" }).success, "过长 tag 被拒");
  ok(!CanvasWriterRequestSchema.safeParse({ writerTag: "", action: "claim" }).success, "空 tag 被拒");
  ok(!CanvasWriterRequestSchema.safeParse([]).success, "数组体被拒");

  // 决策层宽松 body(CanvasPatchBodySchema):writerTag 可选——仅供 decidePatch 纯 helper 单测,
  // **非生产路由 schema**(生产收紧见下方 CanvasPatchWriteBodySchema)。
  ok(CanvasPatchBodySchema.safeParse({ baseRev: 0 }).success, "决策层 body 不带 writerTag 仍合法(纯 helper 兼容)");
  ok(CanvasPatchBodySchema.safeParse({ baseRev: 0, writerTag: tag }).success, "决策层 body 带合法 writerTag");
  ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, writerTag: "bad tag" }).success, "决策层 body 非法 writerTag 被拒");
  ok(!CanvasPatchBodySchema.safeParse({ baseRev: 0, foo: 1 }).success, "决策层 body 未知顶层字段仍被拒");
  ok(CanvasPatchBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {}, writerTag: tag }).success, "决策层 body 全字段(含 writerTag)合法");

  // **生产** write body(CanvasPatchWriteBodySchema,真实 PATCH 路由用此):**强制 writerTag**——
  // 无 tag 写在解析层即被拦下,杜绝绕过 D5 单写者门禁(真实 route/schema 不得无 tag 写)。
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0 }).success, "生产 body 缺 writerTag → 被拒(不得无 tag 写)");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {} }).success, "生产 body 全字段但缺 writerTag → 被拒");
  ok(CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: tag }).success, "生产 body 带合法 writerTag → 合法");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: "bad tag" }).success, "生产 body 非法 writerTag → 被拒");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: "short" }).success, "生产 body 过短 writerTag → 被拒");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: 0, writerTag: tag, foo: 1 }).success, "生产 body 未知顶层字段 → 被拒(strict)");
  ok(!CanvasPatchWriteBodySchema.safeParse({ baseRev: -1, writerTag: tag }).success, "生产 body baseRev 负数 → 被拒");
  ok(CanvasPatchWriteBodySchema.safeParse({ baseRev: 3, ops: [], title: "x", deps: {}, writerTag: tag }).success, "生产 body 全字段(含 writerTag)→ 合法");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑩ 旧 D1–D4 不回归(decidePatch legacy / 错误码↔状态 / 离线队列)");
{
  const nodeA = createCanvasNode({ id: "node_a", type: "text", position: { x: 0, y: 0 } });
  const nodeB = createCanvasNode({ id: "node_b", type: "image", position: { x: 5, y: 5 } });
  const nodeC = createCanvasNode({ id: "node_c", type: "video", position: { x: 7, y: 7 } });
  const base = {
    storedDoc: { nodes: [nodeA, nodeB], edges: [], groups: [] },
    storedDeps: {},
    storedTitle: "t",
    storedRev: 5,
    storedSchemaVersion: 1,
    storedDocBytes: null,
    baseRev: 5,
    ops: [],
  };
  let d = decidePatch({ ...base, ops: [addOp(nodeC)] });
  ok(d.kind === "write" && d.applied === 1, "legacy 新增节点 → write");
  d = decidePatch({ ...base, baseRev: 9, ops: [] });
  ok(d.kind === "reload" && d.code === "REV_CONFLICT", "legacy baseRev 超前 → REV_CONFLICT");
  d = decidePatch({ ...base, storedDocBytes: 100, ops: [addOp(nodeA)] });
  ok(d.kind === "noop" && d.applied === 0, "legacy 重放已存在 add → noop(幂等)");

  // 错误码↔状态(含 D5 新增 WRITER_LOCKED)
  eq(httpStatusForCanvasError("WRITER_LOCKED"), 409, "WRITER_LOCKED → 409");
  ok(CANVAS_API_ERROR_CODES.includes("WRITER_LOCKED"), "WRITER_LOCKED 已登记入错误码集合");
  ok(CANVAS_API_ERROR_CODES.every((code) => Number.isInteger(httpStatusForCanvasError(code))), "每个错误码都映射到整数状态");
  ok(
    httpStatusForCanvasError("REV_CONFLICT") === 409 &&
      httpStatusForCanvasError("ENTITY_CONFLICT") === 409 &&
      httpStatusForCanvasError("CANVAS_DOC_INVALID") === 422 &&
      httpStatusForCanvasError("NOT_FOUND") === 404 &&
      httpStatusForCanvasError("UNAUTHENTICATED") === 401,
    "既有错误码映射不变"
  );

  // 离线队列(D3 机制)smoke
  let q = createOfflineQueue(3);
  q = enqueue(q, "op1", addOp(nodeA));
  const built = buildPatch(q);
  ok(built.flush && built.flush.patch.ops.length === 1 && built.flush.patch.baseRev === 3, "离线队列 buildPatch 仍正常(D3 无回归)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑪ 源码卫生(writer-lock 依赖 / writer·PATCH 路由 cookie client + 原子谓词 + 零平行表)");
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
{
  const wlSrc = readFileSync(join(ROOT, "src", "lib", "canvas", "writer-lock.ts"), "utf8");
  ok(!/localStorage|sessionStorage/.test(wlSrc), "writer-lock.ts 不引用 web storage");
  ok(!CONTROL_CHARS.test(wlSrc), "writer-lock.ts 无 NUL/控制字节");
  const allowed = new Set(["nanoid", "./api-types"]);
  const specs = [...wlSrc.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  ok(specs.length > 0 && specs.every((s) => allowed.has(s)), "writer-lock.ts 只依赖 nanoid + ./api-types(type)");
  ok(!/service_role|SERVICE_ROLE|serviceRole/.test(wlSrc), "writer-lock.ts 无 service-role");
}
{
  const routeSrc = readFileSync(join(ROOT, "src", "app", "api", "canvas", "[id]", "writer", "route.ts"), "utf8");
  ok(/from\s+"@\/lib\/supabase\/server"/.test(routeSrc) && /createClient\(\)/.test(routeSrc), "writer 路由用 cookie 用户 client");
  ok(!/service_role|SERVICE_ROLE|serviceRole/.test(routeSrc), "writer 路由绝不 service-role");
  ok(/auth\.getUser\(\)/.test(routeSrc), "writer 路由做鉴权");
  ok(/\.or\(/.test(routeSrc), "claim 用原子 .or() 谓词(null/同 tag/过期)");
  ok(/\.eq\("writer_tag"/.test(routeSrc), "heartbeat/release 谓词 writer_tag=:tag(只能同 tag)");
  ok(routeSrc.includes('.from("canvases")') && !/create\s+table|CREATE\s+TABLE|\.rpc\(/i.test(routeSrc), "writer 路由只摸 canvases,零平行事件表 / 零 RPC");
  ok(!CONTROL_CHARS.test(routeSrc), "writer 路由无 NUL/控制字节");
}
{
  const patchSrc = readFileSync(join(ROOT, "src", "app", "api", "canvas", "[id]", "route.ts"), "utf8");
  ok(/\.eq\("writer_tag", writerTag\)/.test(patchSrc), "PATCH 把 writer_tag 谓词并入 CAS UPDATE(写者谓词与 rev CAS 同一 UPDATE)");
  ok(/\.gte\("writer_heartbeat_at",\s*writerActiveSinceIso\(/.test(patchSrc), "PATCH 原子 UPDATE 增 .gte(writer_heartbeat_at>=now-lease) 活跃谓词(过期同 tag 不得复活)");
  ok(/\.eq\("rev", row\.rev\)/.test(patchSrc), "PATCH 保留 rev CAS 条件");
  ok(/WRITER_LOCKED/.test(patchSrc), "PATCH 回 WRITER_LOCKED(与 REV_CONFLICT 区分)");
  ok(/writer_heartbeat_at = nowIso|writer_heartbeat_at: nowIso|update\.writer_heartbeat_at/.test(patchSrc), "PATCH 活跃写者保存时顺带续租心跳");
  ok(/CanvasPatchWriteBodySchema/.test(patchSrc) && !/CanvasPatchBodySchema/.test(patchSrc), "PATCH 生产路由用强制 writerTag 的 CanvasPatchWriteBodySchema(不用宽松 body,杜绝无 tag 写)");
  ok(!/service_role|SERVICE_ROLE|serviceRole/.test(patchSrc), "PATCH 路由绝不 service-role");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n结果:${pass} 通过,${fails.length} 失败`);
if (fails.length) {
  console.log("失败项:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("✅ D5 本地验证全绿");
