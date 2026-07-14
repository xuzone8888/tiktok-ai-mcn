/** D4 IndexedDB 影子副本验证。运行:node scripts/verify-canvas-shadow.mjs
 *
 * 用**注入的 fake IndexedDB**(异步事务 + 故障注入 + close 计数 + blocked→迟到成功)
 * 脱离浏览器直测 shadow.ts:put/get/delete、每 canvas/每库隔离、覆盖写、写入/读取深拷贝、
 * 结构/版本双锁、深层危险值拒绝、队列锚点一致性、循环/BigInt 永不抛、无 IndexedDB/Quota/
 * abort/open-fail/blocked 降级、factory presence-aware、ahead 判定、绝不触碰 localStorage、零新依赖。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasModule } from "./canvas-build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const fails = [];
let pass = 0;
const ISO = "2026-07-13T00:00:00.000Z";

function ok(condition, label) {
  if (condition) pass += 1;
  else {
    fails.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function cloneJson(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
// fake IDB 用 structured-clone 语义(可存/取循环对象),忠实模拟真实 IndexedDB。
const idbClone = (v) => (v === undefined ? undefined : structuredClone(v));

async function returnsNullNoThrow(label, fn) {
  try {
    ok((await fn()) === null, label);
  } catch (e) {
    ok(false, `${label}(意外抛出:${e && e.message})`);
  }
}

// ── fake IndexedDB(异步微任务事务 + 按操作名注入故障 + close 计数 + blocked→迟到成功)──
function makeLegacyFakeIndexedDB(faults = {}) {
  const dbs = new Map(); // name -> { name, stores: Map<storeName, Map<key,val>>, closeCount }

  function makeTx(storeMap) {
    let aborted = false;
    let pending = 0;
    let hadError = false;
    const tx = {
      oncomplete: null,
      onabort: null,
      onerror: null,
      abort() {
        doAbort();
      },
      objectStore() {
        const op = (fn, faultKey) => {
          const req = { onsuccess: null, onerror: null, result: undefined, error: null };
          pending += 1;
          queueMicrotask(() => {
            if (aborted) return;
            if (faults[faultKey]) {
              req.error = new Error(`${faultKey} failed`);
              hadError = true;
              if (typeof req.onerror === "function") req.onerror({ target: req });
              pending -= 1;
              settle();
              return;
            }
            try {
              req.result = fn(storeMap);
            } catch (e) {
              req.error = e;
              hadError = true;
              if (typeof req.onerror === "function") req.onerror({ target: req });
              pending -= 1;
              settle();
              return;
            }
            if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
            pending -= 1;
            settle();
          });
          return req;
        };
        return {
          get: (key) => op((m) => idbClone(m.get(key)), "get"),
          put: (value) =>
            op((m) => {
              m.set(value.canvasId, idbClone(value));
              return value.canvasId;
            }, "put"),
          delete: (key) => op((m) => (m.delete(key), undefined), "delete"),
          clear: () => op((m) => (m.clear(), undefined), "clear"),
        };
      },
    };
    function settle() {
      if (aborted || pending !== 0) return;
      if (hadError) doAbort();
      else
        queueMicrotask(() => {
          if (!aborted && typeof tx.oncomplete === "function") tx.oncomplete({ target: tx });
        });
    }
    function doAbort() {
      if (aborted) return;
      aborted = true;
      queueMicrotask(() => {
        if (typeof tx.onabort === "function") tx.onabort({ target: tx });
      });
    }
    return tx;
  }

  function makeDb(entry) {
    return {
      objectStoreNames: { contains: (n) => entry.stores.has(n) },
      createObjectStore(name) {
        if (!entry.stores.has(name)) entry.stores.set(name, new Map());
        return {};
      },
      onversionchange: null,
      close() {
        entry.closeCount = (entry.closeCount || 0) + 1;
      },
      transaction(storeName) {
        const storeMap = entry.stores.get(storeName);
        if (!storeMap) throw new Error(`NotFoundError: ${storeName}`);
        return makeTx(storeMap);
      },
    };
  }

  function ensureEntry(name) {
    let entry = dbs.get(name);
    const isNew = !entry;
    if (isNew) {
      entry = { name, stores: new Map(), closeCount: 0 };
      dbs.set(name, entry);
    }
    return { entry, isNew };
  }

  function fireOpen(req, name) {
    const { entry, isNew } = ensureEntry(name);
    req.result = makeDb(entry);
    if (isNew && typeof req.onupgradeneeded === "function") req.onupgradeneeded({ target: req });
    if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
  }

  return {
    _dbs: dbs,
    open(name) {
      const req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        result: null,
      };
      if (faults.blockedThenSuccess) {
        queueMicrotask(() => {
          if (typeof req.onblocked === "function") req.onblocked({ target: req });
        });
        queueMicrotask(() => fireOpen(req, name)); // 迟到成功
        return req;
      }
      queueMicrotask(() => {
        if (faults.open) {
          if (typeof req.onerror === "function") req.onerror({ target: req });
          return;
        }
        fireOpen(req, name);
      });
      return req;
    },
  };
}

// v2 verifier fake: version-aware, keyPath-aware and transactionally serialized. Readwrite
// mutations are staged and commit only on oncomplete, so abort/error tests cannot accidentally
// pass against state that a real IndexedDB transaction would have rolled back.
function makeFakeIndexedDB(faults = {}) {
  const dbs = new Map();

  const makeEntry = (name) => ({
    name,
    version: 0,
    stores: new Map(),
    keyPaths: new Map(),
    connections: new Set(),
    closeCount: 0,
    txTail: Promise.resolve(),
  });

  const cloneMap = (source) => {
    const out = new Map();
    for (const [key, value] of source) out.set(key, idbClone(value));
    return out;
  };

  function makeTx(entry, storeName, mode) {
    const source = entry.stores.get(storeName);
    if (!source) throw new Error(`NotFoundError: ${storeName}`);
    const keyPath = entry.keyPaths.get(storeName);
    let active = false;
    let processing = false;
    let finished = false;
    let aborted = false;
    let working = null;
    const operations = [];
    let release;
    const predecessor = entry.txTail;
    entry.txTail = new Promise((resolve) => {
      release = resolve;
    });

    const tx = {
      oncomplete: null,
      onabort: null,
      onerror: null,
      abort() {
        abortTx(false);
      },
      objectStore(requestedName) {
        if (requestedName !== undefined && requestedName !== storeName) {
          throw new Error(`NotFoundError: ${requestedName}`);
        }
        const request = (kind, argument, faultKey) => {
          if (finished) throw new Error("TransactionInactiveError");
          if (mode === "readonly" && ["put", "delete", "clear"].includes(kind)) {
            throw new Error("ReadOnlyError");
          }
          const req = { onsuccess: null, onerror: null, result: undefined, error: null };
          operations.push({ kind, argument, faultKey, req });
          pump();
          return req;
        };
        return {
          get: (key) => request("get", key, "get"),
          put: (value) => request("put", value, "put"),
          delete: (key) => request("delete", key, "delete"),
          clear: () => request("clear", undefined, "clear"),
        };
      },
    };

    function finishSuccess() {
      if (finished || aborted) return;
      finished = true;
      if (mode === "readwrite") {
        source.clear();
        for (const [key, value] of working) source.set(key, idbClone(value));
      }
      queueMicrotask(() => {
        if (typeof tx.oncomplete === "function") tx.oncomplete({ target: tx });
        release();
      });
    }

    function abortTx(fromRequest) {
      if (finished || aborted) return;
      aborted = true;
      finished = true;
      queueMicrotask(() => {
        if (fromRequest && typeof tx.onerror === "function") tx.onerror({ target: tx });
        if (typeof tx.onabort === "function") tx.onabort({ target: tx });
        release();
      });
    }

    function pump() {
      if (!active || processing || finished || aborted) return;
      const next = operations.shift();
      if (!next) {
        queueMicrotask(() => {
          if (operations.length === 0 && !processing) finishSuccess();
          else pump();
        });
        return;
      }
      processing = true;
      queueMicrotask(() => {
        if (finished || aborted) return;
        const { kind, argument, faultKey, req } = next;
        if (faults[faultKey]) {
          req.error = new Error(`${faultKey} failed`);
          if (typeof req.onerror === "function") req.onerror({ target: req });
          processing = false;
          abortTx(true);
          return;
        }
        try {
          if (kind === "get") req.result = idbClone(working.get(argument));
          else if (kind === "put") {
            const value = idbClone(argument);
            const key = value?.[keyPath];
            if (key === undefined) throw new Error(`DataError: missing keyPath ${keyPath}`);
            working.set(key, value);
            req.result = key;
          } else if (kind === "delete") {
            working.delete(argument);
            req.result = undefined;
          } else if (kind === "clear") {
            working.clear();
            req.result = undefined;
          }
        } catch (error) {
          req.error = error;
          if (typeof req.onerror === "function") req.onerror({ target: req });
          processing = false;
          abortTx(true);
          return;
        }
        if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
        processing = false;
        pump();
      });
    }

    void predecessor.then(() => {
      if (finished) {
        release();
        return;
      }
      working = mode === "readwrite" ? cloneMap(source) : source;
      active = true;
      pump();
    });
    return tx;
  }

  function makeDb(entry) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: (name) => entry.stores.has(name) },
      createObjectStore(name, options = {}) {
        if (faults.createStore === true || faults.createStore === name) {
          throw new Error(`CreateStoreError: ${name}`);
        }
        if (entry.stores.has(name)) throw new Error(`ConstraintError: ${name}`);
        entry.stores.set(name, new Map());
        entry.keyPaths.set(name, options.keyPath);
        return {};
      },
      onversionchange: null,
      close() {
        if (closed) return;
        closed = true;
        entry.connections.delete(db);
        entry.closeCount += 1;
      },
      transaction(storeName, mode = "readonly") {
        if (closed) throw new Error("InvalidStateError: closed");
        if (Array.isArray(storeName)) {
          if (storeName.length !== 1) throw new Error("fake supports one store per transaction");
          return makeTx(entry, storeName[0], mode);
        }
        return makeTx(entry, storeName, mode);
      },
      get version() {
        return entry.version;
      },
    };
    return db;
  }

  function fireError(req, name) {
    req.error = new Error(name);
    if (typeof req.onerror === "function") req.onerror({ target: req });
  }

  function fireOpen(req, name, requestedVersion) {
    let entry = dbs.get(name);
    if (!entry) {
      entry = makeEntry(name);
      dbs.set(name, entry);
    }
    const version = requestedVersion ?? (entry.version || 1);
    if (version < entry.version) {
      fireError(req, "VersionError");
      return;
    }
    const upgrading = version > entry.version;
    if (upgrading) {
      for (const connection of [...entry.connections]) {
        if (typeof connection.onversionchange === "function") {
          connection.onversionchange({ oldVersion: entry.version, newVersion: version });
        }
      }
      if (entry.connections.size > 0) {
        if (typeof req.onblocked === "function") req.onblocked({ target: req });
        return;
      }
    }
    const db = makeDb(entry);
    req.result = db;
    let upgradeAborted = false;
    const storesBeforeUpgrade = new Map(
      [...entry.stores].map(([storeName, values]) => [storeName, cloneMap(values)])
    );
    const keyPathsBeforeUpgrade = new Map(entry.keyPaths);
    req.transaction = {
      abort() {
        upgradeAborted = true;
      },
    };
    if (upgrading && typeof req.onupgradeneeded === "function") {
      req.onupgradeneeded({ target: req, oldVersion: entry.version, newVersion: version });
    }
    if (upgradeAborted) {
      for (const storeName of [...entry.stores.keys()]) {
        if (!storesBeforeUpgrade.has(storeName)) entry.stores.delete(storeName);
      }
      for (const [storeName, values] of storesBeforeUpgrade) {
        let target = entry.stores.get(storeName);
        if (!target) {
          target = new Map();
          entry.stores.set(storeName, target);
        }
        target.clear();
        for (const [key, value] of values) target.set(key, idbClone(value));
      }
      entry.keyPaths.clear();
      for (const [storeName, keyPath] of keyPathsBeforeUpgrade) {
        entry.keyPaths.set(storeName, keyPath);
      }
      fireError(req, "AbortError");
      return;
    }
    entry.version = version;
    entry.connections.add(db);
    if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
  }

  return {
    _dbs: dbs,
    open(name, version) {
      const req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        result: null,
        error: null,
        transaction: null,
      };
      if (faults.blockedThenSuccess) {
        queueMicrotask(() => {
          if (typeof req.onblocked === "function") req.onblocked({ target: req });
        });
        queueMicrotask(() => fireOpen(req, name, version));
        return req;
      }
      queueMicrotask(() => {
        if (faults.open) {
          fireError(req, "OpenError");
          return;
        }
        fireOpen(req, name, version);
      });
      return req;
    },
  };
}

// ── 载入模块(依赖顺序:schema → patch → offline-queue → shadow)─────────────────
const schema = await loadCanvasModule("schema");
const patch = await loadCanvasModule("patch");
const offlineQueue = await loadCanvasModule("offline-queue");
const shadow = await loadCanvasModule("shadow");

const { createEmptyCanvasDoc, createEmptyCanvasDeps, createCanvasNode, createCanvasRefs } = schema;
const { CanvasOpSchema } = patch;
const { createOfflineQueue, enqueue, buildPatch, snapshot } = offlineQueue;
const {
  createCanvasShadowStore,
  decideShadowRecovery,
  validateShadowRecord,
  strictJsonClone,
  CANVAS_SHADOW_SCHEMA_VERSION,
  CANVAS_SHADOW_DB_VERSION,
  CANVAS_SHADOW_STORAGE_VERSION,
  CANVAS_PENDING_CREATE_KEY,
} = shadow;

const validDoc = createEmptyCanvasDoc();
const validDeps = createEmptyCanvasDeps();
const node = createCanvasNode({ id: "node_1", type: "text", position: { x: 0, y: 0 } });
const addOp = CanvasOpSchema.parse({ entity: "node", op: "add", value: node });
const dirtyQueue = (baseRev) => snapshot(enqueue(createOfflineQueue(baseRev), "op1", addOp));
const cleanQueue = (baseRev) => snapshot(createOfflineQueue(baseRev));
const inflightSnap = (baseRev) => {
  const q = enqueue(createOfflineQueue(baseRev), "op1", addOp);
  return snapshot(buildPatch(q).state); // pending 空、inflight.baseRev === baseRev
};
const paramsNode = (id, params) => ({
  id,
  type: "text",
  position: { x: 0, y: 0 },
  group_id: null,
  data: { refs: createCanvasRefs(), params },
});
const rec = (canvasId, serverRev, queueSnap = null, snapshotRecoveryRequired = false) => ({
  version: CANVAS_SHADOW_SCHEMA_VERSION,
  canvasId,
  schemaVersion: 1,
  doc: validDoc,
  deps: validDeps,
  serverRev,
  updatedAt: ISO,
  queue: queueSnap,
  snapshotRecoveryRequired,
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("① store put/get/delete/覆盖(fake IDB)");
const fake = makeFakeIndexedDB();
const store = createCanvasShadowStore({ factory: fake, dbName: "t1" });
ok(store.available === true, "注入 fake IDB → available=true");
ok(await store.put({ canvasId: "cv-1", doc: validDoc, deps: validDeps, serverRev: 3, queue: dirtyQueue(3), updatedAt: ISO }), "put 合法影子(队列锚点一致)→ true");
const got = await store.get("cv-1");
ok(got && got.canvasId === "cv-1" && got.serverRev === 3, "get 取回影子(canvasId/serverRev 正确)");
ok(got?.queue && got.queue.pending.length === 1, "get 保留 D3 队列快照");
ok(got?.snapshotRecoveryRequired === false, "普通 shadow 默认无需显式快照恢复");
ok(
  await store.put({
    canvasId: "cv-overflow",
    doc: validDoc,
    deps: validDeps,
    serverRev: 3,
    queue: dirtyQueue(3),
    snapshotRecoveryRequired: true,
    updatedAt: ISO,
  }),
  "put 接受队列溢出后的显式快照恢复标记"
);
ok(
  (await store.get("cv-overflow"))?.snapshotRecoveryRequired === true,
  "显式快照恢复标记可持久化往返"
);
ok(await store.put({ canvasId: "cv-1", doc: validDoc, deps: validDeps, serverRev: 5, queue: cleanQueue(5), updatedAt: ISO }), "覆盖 put → true");
const got2 = await store.get("cv-1");
ok(got2?.serverRev === 5 && got2.queue.pending.length === 0, "覆盖后取回新值");
ok((await store.remove("cv-1")) === true, "remove → true");
ok((await store.get("cv-1")) === null, "remove 后 get → null");

// ─────────────────────────────────────────────────────────────────────────────
console.log("② 隔离(每 canvas 独立 key + 每库隔离)");
await store.put({ canvasId: "cv-a", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO });
await store.put({ canvasId: "cv-b", doc: validDoc, deps: validDeps, serverRev: 2, updatedAt: ISO });
ok((await store.get("cv-a"))?.serverRev === 1 && (await store.get("cv-b"))?.serverRev === 2, "同库不同 canvas 独立 key");
await store.remove("cv-a");
ok((await store.get("cv-a")) === null && (await store.get("cv-b"))?.serverRev === 2, "删一个 canvas 不影响另一个");
const store2 = createCanvasShadowStore({ factory: fake, dbName: "t2" });
ok((await store2.get("cv-b")) === null, "不同 dbName → 库隔离");

// ─────────────────────────────────────────────────────────────────────────────
console.log("③ 写入/读取深拷贝");
const mutDoc = createEmptyCanvasDoc();
const mutNode = createCanvasNode({ id: "node_m", type: "text", position: { x: 1, y: 2 } });
mutDoc.nodes.push(mutNode);
// 先断言 put 成功(factory 节点须 JSON-safe);失败时不再让后续解引用以 TypeError 掩盖根因。
ok((await store.put({ canvasId: "cv-mut", doc: mutDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === true, "深拷贝场景 put 成功(createCanvasNode 输出 JSON-safe)");
mutNode.position.x = 999;
mutDoc.nodes.push(createCanvasNode({ id: "node_extra", type: "text", position: { x: 0, y: 0 } }));
const gotMut = await store.get("cv-mut");
ok(gotMut && gotMut.doc.nodes.length === 1 && gotMut.doc.nodes[0].position.x === 1, "写入深拷贝:put 后突变入参不污染已存副本");
if (gotMut) gotMut.doc.nodes[0].position.x = 777;
const reMut = await store.get("cv-mut");
ok(reMut && reMut.doc.nodes[0].position.x === 1, "读取深拷贝:改返回值不污染库内");

// ─────────────────────────────────────────────────────────────────────────────
console.log("④ 结构/版本双锁 + 损坏/跨 canvas/非严格 doc/深层危险值 拒绝");
const t1 = fake._dbs.get("t1").stores.get("shadows");
t1.set("cv-corrupt", { version: 1, canvasId: "cv-corrupt", garbage: true });
ok((await store.get("cv-corrupt")) === null, "损坏记录 → null(严格拒绝)");
t1.set("cv-old", { version: 0, canvasId: "cv-old", schemaVersion: 1, doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO, queue: null });
ok((await store.get("cv-old")) === null, "旧结构版本(version=0)→ null");
t1.set("cv-oldschema", { version: 1, canvasId: "cv-oldschema", schemaVersion: 999, doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO, queue: null });
ok((await store.get("cv-oldschema")) === null, "旧/错 doc schemaVersion(999)→ null(非当前严格可写)");
ok((await store.put({ canvasId: "cv-sv", doc: validDoc, deps: validDeps, serverRev: 1, schemaVersion: 999, updatedAt: ISO })) === false, "put schemaVersion≠当前 → 拒绝 false");
t1.set("cv-badiso", { version: 1, canvasId: "cv-badiso", schemaVersion: 1, doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: "x", queue: null });
ok((await store.get("cv-badiso")) === null, "updatedAt 非 ISO datetime → null");
const legacyWithoutRecoveryMarker = { version: 1, canvasId: "cv-legacy-marker", schemaVersion: 1, doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO, queue: null };
t1.set("cv-legacy-marker", legacyWithoutRecoveryMarker);
ok((await store.get("cv-legacy-marker"))?.snapshotRecoveryRequired === false, "旧 shadow 缺少恢复标记时向后兼容为 false");
t1.set("cv-bad-marker", { ...legacyWithoutRecoveryMarker, canvasId: "cv-bad-marker", snapshotRecoveryRequired: "yes" });
ok((await store.get("cv-bad-marker")) === null, "非布尔恢复标记严格拒绝");
ok(validateShadowRecord(rec("cv-x", 1), "cv-x") !== null, "validateShadowRecord 属主一致 → 通过");
ok(validateShadowRecord(rec("cv-x", 1), "cv-y") === null, "validateShadowRecord 跨 canvas → null");
const danglingDoc = { nodes: [node], edges: [{ id: "e", source: "node_1", target: "ghost" }], groups: [] };
ok((await store.put({ canvasId: "cv-bad", doc: danglingDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "put 非严格 doc(悬空 edge)→ 拒绝 false");
ok((await store.get("cv-bad")) === null, "被拒 doc 未入库");
const dangerDoc = { nodes: [paramsNode("node_d", { nested: "data:image/png;base64,AA" })], edges: [], groups: [] };
ok((await store.put({ canvasId: "cv-danger", doc: dangerDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "深层 dataURL params → put 拒绝(validateCanvasDoc 危险值扫描)");
ok((await store.get("cv-danger")) === null, "被拒危险 doc 未入库");
t1.set("cv-danger-read", { version: 1, canvasId: "cv-danger-read", schemaVersion: 1, doc: dangerDoc, deps: validDeps, serverRev: 1, updatedAt: ISO, queue: null });
ok((await store.get("cv-danger-read")) === null, "读到深层危险值记录 → null(read validate 复用 validateCanvasDoc)");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑤ 队列锚点一致性(baseRev / inflight)");
t1.set("cv-qmm", { version: 1, canvasId: "cv-qmm", schemaVersion: 1, doc: validDoc, deps: validDeps, serverRev: 3, updatedAt: ISO, queue: dirtyQueue(99) });
ok((await store.get("cv-qmm")) === null, "queue.baseRev(99)≠serverRev(3)→ null(候选无法按 baseRev 安全重放)");
const okInflight = inflightSnap(3);
ok((await store.put({ canvasId: "cv-if-ok", doc: validDoc, deps: validDeps, serverRev: 3, queue: okInflight, updatedAt: ISO })) === true, "一致 inflight(baseRev===serverRev)→ put 通过");
const tampered = { ...okInflight, inflight: { ...okInflight.inflight, baseRev: 7 } };
t1.set("cv-ifmm", { version: 1, canvasId: "cv-ifmm", schemaVersion: 1, doc: validDoc, deps: validDeps, serverRev: 3, updatedAt: ISO, queue: tampered });
ok((await store.get("cv-ifmm")) === null, "inflight.baseRev(7)≠队列锚点(3)→ null(D3 快照不变量)");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑥ put 永不抛(循环引用 / BigInt)");
const circParams = {};
circParams.self = circParams;
const circDoc = { nodes: [paramsNode("node_c", circParams)], edges: [], groups: [] };
ok((await store.put({ canvasId: "cv-circ", doc: circDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "循环引用 doc → put false(clone 抛被 catch,不抛整页)");
const bigDoc = { nodes: [paramsNode("node_bg", { big: 10n })], edges: [], groups: [] };
ok((await store.put({ canvasId: "cv-big", doc: bigDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "BigInt doc → put false(clone 抛被 catch)");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑦ 降级:无 IndexedDB / Quota / abort / open-fail / blocked→迟到成功");
const noIdb = createCanvasShadowStore({});
ok(noIdb.available === false, "无 IndexedDB → available=false");
ok((await noIdb.put({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "无 IDB:put 降级 false");
ok((await noIdb.get("cv")) === null, "无 IDB:get 降级 null");
const quotaStore = createCanvasShadowStore({ factory: makeFakeIndexedDB({ put: true }), dbName: "q" });
ok((await quotaStore.put({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "Quota/事务 abort:put → false(不抛)");
const getFailStore = createCanvasShadowStore({ factory: makeFakeIndexedDB({ get: true }), dbName: "g" });
ok((await getFailStore.get("cv")) === null, "事务 abort:get → null(不抛)");
const openFailStore = createCanvasShadowStore({ factory: makeFakeIndexedDB({ open: true }), dbName: "o" });
ok((await openFailStore.put({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "open 失败:put → false(不抛)");
const blockedFake = makeFakeIndexedDB({ blockedThenSuccess: true });
const blockedStore = createCanvasShadowStore({ factory: blockedFake, dbName: "b" });
ok((await blockedStore.put({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO })) === false, "onblocked→resolve(null):put 降级 false(不双结算)");
ok((blockedFake._dbs.get("b")?.closeCount || 0) >= 1, "迟到 onsuccess 的 db 被立即 close(不泄漏)");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑧ factory presence-aware(全局 vs 显式 null)");
globalThis.indexedDB = makeFakeIndexedDB();
try {
  ok(createCanvasShadowStore({}).available === true, "有全局 factory + 未注入 factory 键 → available=true(采用全局)");
  ok(createCanvasShadowStore({ factory: null }).available === false, "显式 factory:null → 禁用(available=false,不回退全局)");
} finally {
  delete globalThis.indexedDB;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑨ ahead 判定 + 恢复策略(replay_queue / restore_snapshot)");
console.log("⑨ v2 discriminated reads / version fence / transactional rollback");

const openFakeDb = (factory, name, version, upgrade) =>
  new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("open failed"));
    req.onblocked = () => reject(new Error("open blocked"));
  });
const openFakeDbFails = (factory, name, version) =>
  new Promise((resolve) => {
    const req = factory.open(name, version);
    req.onsuccess = () => {
      req.result.close();
      resolve(false);
    };
    req.onerror = () => resolve(true);
    req.onblocked = () => resolve(false);
  });

{
  const f = makeFakeIndexedDB();
  const s = createCanvasShadowStore({ factory: f, dbName: "v2-read" });
  ok((await s.read("missing")).status === "absent", "v2 read: committed undefined alone is absent");
  const raw = f._dbs.get("v2-read").stores.get("shadows");
  raw.set("damaged", { canvasId: "damaged", garbage: true });
  const damaged = await s.read("damaged");
  ok(damaged.status === "failure" && damaged.reason === "invalid-record", "v2 read: damaged row is failure, never absent");
  const unavailable = createCanvasShadowStore({ factory: null });
  ok((await unavailable.read("cv")).status === "unavailable", "v2 read: missing IDB is explicit unavailable");
  const failedGet = createCanvasShadowStore({ factory: makeFakeIndexedDB({ get: true }), dbName: "v2-get-fail" });
  const getOutcome = await failedGet.read("cv");
  ok(getOutcome.status === "failure" && getOutcome.reason === "request", "v2 read: get abort is failure, never absent");
  const failedOpen = createCanvasShadowStore({ factory: makeFakeIndexedDB({ open: true }), dbName: "v2-open-fail" });
  const openOutcome = await failedOpen.read("cv");
  ok(openOutcome.status === "failure" && openOutcome.reason === "open", "v2 read: open failure is discriminated");
  const tooLongId = "x".repeat(201);
  const rejectedLongClaim = await s.claim(tooLongId, "owner-long-id");
  ok(rejectedLongClaim.status === "failure" && rejectedLongClaim.reason === "invalid-input", "claim rejects an id that cannot form a valid envelope");
  ok(!raw.has(tooLongId), "rejected overlong claim cannot poison a durable row");
  const hostileLease = new Proxy({}, { ownKeys() { throw new Error("lease trap"); } });
  let hostileLeaseThrew = false;
  let hostileLeaseResult;
  try {
    hostileLeaseResult = await s.putIfOwned(
      { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO },
      hostileLease
    );
  } catch {
    hostileLeaseThrew = true;
  }
  ok(!hostileLeaseThrew && hostileLeaseResult?.status === "failure", "hostile lease input is rejected without escaping an exception");
}

{
  const f = makeFakeIndexedDB();
  const oldDb = await openFakeDb(f, "upgrade", 1, (db) => {
    db.createObjectStore("shadows", { keyPath: "canvasId" });
  });
  f._dbs.get("upgrade").stores.get("shadows").set("legacy", rec("legacy", 7, dirtyQueue(7)));
  let sawVersionChange = false;
  oldDb.onversionchange = () => {
    sawVersionChange = true;
    oldDb.close();
  };
  const upgraded = createCanvasShadowStore({ factory: f, dbName: "upgrade" });
  const legacy = await upgraded.read("legacy");
  const entry = f._dbs.get("upgrade");
  ok(sawVersionChange, "v2 upgrade notifies and closes an already-open v1 connection");
  ok(entry.version === CANVAS_SHADOW_DB_VERSION && entry.stores.has("pending-creates"), "v2 upgrade creates pending store and records DB version");
  ok(legacy.status === "found" && legacy.record.serverRev === 7, "v2 migration reads the exact legacy shadow payload");
  ok(await openFakeDbFails(f, "upgrade", 1), "after v2 upgrade an old bundle open(version=1) gets VersionError");
}

{
  const faults = {};
  const f = makeFakeIndexedDB(faults);
  const oldDb = await openFakeDb(f, "upgrade-abort", 1, (db) => {
    db.createObjectStore("shadows", { keyPath: "canvasId" });
  });
  f._dbs.get("upgrade-abort").stores.get("shadows").set("legacy", rec("legacy", 8));
  oldDb.onversionchange = () => oldDb.close();
  faults.createStore = "pending-creates";
  const brokenUpgradeStore = createCanvasShadowStore({ factory: f, dbName: "upgrade-abort" });
  const brokenUpgrade = await brokenUpgradeStore.read("legacy");
  const entry = f._dbs.get("upgrade-abort");
  ok(brokenUpgrade.status === "failure" && brokenUpgrade.reason === "open", "failed v2 store creation aborts the upgrade");
  ok(entry.version === 1 && !entry.stores.has("pending-creates") && entry.stores.get("shadows").has("legacy"), "aborted upgrade rolls back stores/version and preserves v1 payload");
  delete faults.createStore;
  const recoveredUpgrade = await brokenUpgradeStore.read("legacy");
  ok(recoveredUpgrade.status === "found" && recoveredUpgrade.record.serverRev === 8 && entry.version === 2, "a later clean v2 upgrade succeeds after rollback");
}

{
  const faults = {};
  const f = makeFakeIndexedDB(faults);
  const s = createCanvasShadowStore({ factory: f, dbName: "rollback" });
  faults.put = true;
  const failedClaim = await s.claim("cv", "owner-rollback");
  ok(failedClaim.status === "failure" && failedClaim.reason === "request", "claim put failure is surfaced");
  delete faults.put;
  ok((await s.read("cv")).status === "absent", "aborted claim leaves no half-committed lease/envelope");
}

console.log("⑩ v2 cross-realm owner epoch/write sequence CAS + tombstones");
{
  const f = makeFakeIndexedDB();
  const a = createCanvasShadowStore({ factory: f, dbName: "cas" });
  const b = createCanvasShadowStore({ factory: f, dbName: "cas" });
  const claimedA = await a.claim("cv", "owner-A");
  ok(claimedA.status === "claimed" && claimedA.record === null, "first writer atomically claims an absent canvas");
  const wroteA1 = await a.putIfOwned(
    { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: "2099-01-01T00:00:00.000Z" },
    claimedA.lease
  );
  ok(wroteA1.status === "written" && wroteA1.lease.writeSeq === 1, "owned put advances writeSeq");
  const observedByB = await b.read("cv");
  ok(observedByB.status === "found" && observedByB.record.serverRev === 1, "reader observes without claiming or mutating");
  const wroteA2 = await a.putIfOwned(
    { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 2, updatedAt: "2099-02-01T00:00:00.000Z" },
    wroteA1.lease
  );
  const claimedB = await b.claim("cv", "owner-B");
  ok(wroteA2.status === "written" && claimedB.status === "claimed" && claimedB.record.serverRev === 2, "claim transaction returns the latest record, not an earlier read");
  ok(claimedB.lease.ownerEpoch > wroteA2.lease.ownerEpoch && claimedB.lease.writeSeq === 0, "takeover increments epoch and resets sequence");
  const wroteB = await b.putIfOwned(
    { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 3, updatedAt: "1970-01-01T00:00:00.000Z" },
    claimedB.lease
  );
  const lateA = await a.putIfOwned(
    { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 99, updatedAt: "2100-01-01T00:00:00.000Z" },
    wroteA2.lease
  );
  const lateRemoveA = await a.removeIfOwned(wroteA2.lease);
  const final = await b.read("cv");
  ok(lateA.status === "stale" && lateRemoveA.status === "stale", "old owner late put/remove are both fenced stale");
  ok(final.status === "found" && final.record.serverRev === 3, "reverse/forward clocks cannot override owner epoch CAS");
  const removedB = await b.removeIfOwned(wroteB.lease);
  ok(removedB.status === "removed" && (await b.read("cv")).status === "absent", "owned remove writes a logical tombstone");
  const claimedC = await a.claim("cv", "owner-C");
  ok(claimedC.status === "claimed" && claimedC.record === null && claimedC.lease.ownerEpoch > removedB.lease.ownerEpoch, "claim after tombstone advances epoch (no ABA)");
  ok((await b.putIfOwned({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 4, updatedAt: ISO }, removedB.lease)).status === "stale", "tombstone owner's old sequence cannot revive after takeover");
}

{
  const f = makeFakeIndexedDB();
  const a = createCanvasShadowStore({ factory: f, dbName: "concurrent" });
  const b = createCanvasShadowStore({ factory: f, dbName: "concurrent" });
  const [claimA, claimB] = await Promise.all([a.claim("cv", "parallel-A"), b.claim("cv", "parallel-B")]);
  ok(claimA.status === "claimed" && claimB.status === "claimed" && claimB.lease.ownerEpoch === claimA.lease.ownerEpoch + 1, "concurrent claims serialize with strictly increasing epochs");
  ok((await a.putIfOwned({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 1, updatedAt: ISO }, claimA.lease)).status === "stale", "serialized second claim immediately fences first lease");
}

{
  const f = makeFakeIndexedDB();
  const beforeCrash = createCanvasShadowStore({ factory: f, dbName: "response-lost" });
  const claimed = await beforeCrash.claim("cv", "crash-owner-A");
  await beforeCrash.putIfOwned(
    { canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 9, updatedAt: ISO },
    claimed.lease
  ); // Simulate commit followed by caller/realm loss before consuming the returned lease.
  const afterCrash = createCanvasShadowStore({ factory: f, dbName: "response-lost" });
  const reclaimed = await afterCrash.claim("cv", "crash-owner-B");
  ok(reclaimed.status === "claimed" && reclaimed.record.serverRev === 9, "committed put with lost response converges through a fresh claim");
  await afterCrash.removeIfOwned(reclaimed.lease); // discard response again
  const afterRemoveCrash = await beforeCrash.claim("cv", "crash-owner-C");
  ok(afterRemoveCrash.status === "claimed" && afterRemoveCrash.record === null, "committed tombstone with lost response also converges through claim");
}

console.log("⑪ durable per-user pending-create singleton CAS");
{
  const id = "11111111-1111-4111-8111-111111111111";
  const f = makeFakeIndexedDB();
  const a = createCanvasShadowStore({ factory: f, dbName: "pending" });
  const b = createCanvasShadowStore({ factory: f, dbName: "pending" });
  const seed = { createId: id.toUpperCase(), capturedDoc: validDoc, latestDoc: validDoc, trailingQueue: null, phase: "pending", updatedAt: ISO };
  const claimed = await a.pendingCreate.claim("pending-A", seed);
  ok(claimed.status === "claimed" && claimed.record.createId === id, "pending claim canonicalizes UUID and durably seeds singleton");
  const pendingRead = await b.pendingCreate.read();
  ok(pendingRead.status === "found" && pendingRead.record.phase === "pending", "pending singleton is discoverable after a new store/runtime instance");
  const latestDoc = { nodes: [node], edges: [], groups: [] };
  const wrote = await a.pendingCreate.putIfOwned(
    { ...seed, createId: id, latestDoc, trailingQueue: dirtyQueue(0), phase: "posting" },
    claimed.lease
  );
  ok(wrote.status === "written" && wrote.lease.writeSeq === 1, "pending edits/queue/phase advance under CAS");
  const takeover = await b.pendingCreate.claim("pending-B");
  ok(takeover.status === "claimed" && takeover.record.latestDoc.nodes.length === 1 && takeover.record.phase === "posting", "pending takeover preserves exact latest doc and phase");
  ok((await a.pendingCreate.putIfOwned({ ...seed, createId: id, phase: "posting" }, wrote.lease)).status === "stale", "old pending owner cannot overwrite newer tab");
  const changedCapture = { nodes: [node], edges: [], groups: [] };
  const immutable = await b.pendingCreate.putIfOwned(
    { ...seed, createId: id, capturedDoc: changedCapture, latestDoc: changedCapture, phase: "posting" },
    takeover.lease
  );
  ok(immutable.status === "failure" && immutable.reason === "invalid-record", "captured POST document is immutable after first durable write");
  const regressedPhase = await b.pendingCreate.putIfOwned(
    { ...seed, createId: id, latestDoc, trailingQueue: dirtyQueue(0), phase: "pending" },
    takeover.lease
  );
  ok(regressedPhase.status === "failure" && regressedPhase.reason === "invalid-record", "pending phase cannot regress from posting to pending");
  ok((await b.pendingCreate.removeIfOwned(takeover.lease, { createId: id, phase: "pending" })).status === "stale", "pending remove requires exact expected phase");
  const removed = await b.pendingCreate.removeIfOwned(takeover.lease, { createId: id, phase: "posting" });
  ok(removed.status === "removed" && (await a.pendingCreate.read()).status === "absent", "exact owned pending remove leaves a tombstone");
  const afterRemove = await a.pendingCreate.claim("pending-C");
  ok(afterRemove.status === "claimed" && afterRemove.record === null && afterRemove.lease.ownerEpoch > removed.lease.ownerEpoch, "pending tombstone also prevents ABA");
  const skippedPhase = await a.pendingCreate.putIfOwned(
    { ...seed, createId: id, phase: "created-awaiting-route" },
    afterRemove.lease
  );
  ok(skippedPhase.status === "failure" && skippedPhase.reason === "invalid-record", "new pending intent cannot skip directly to created-awaiting-route");
  const invalidUuid = await a.pendingCreate.claim("pending-D", { ...seed, createId: "not-a-uuid" });
  ok(invalidUuid.status === "failure" && invalidUuid.reason === "invalid-input", "pending seed rejects non-UUID createId");
  const skipSeedStore = createCanvasShadowStore({ factory: f, dbName: "pending-skip-seed" });
  const skippedSeed = await skipSeedStore.pendingCreate.claim("pending-seed-owner", {
    ...seed,
    createId: id,
    phase: "created-awaiting-route",
  });
  ok(skippedSeed.status === "failure" && skippedSeed.reason === "invalid-input", "an absent pending singleton can only be seeded in pending phase");
  ok((await skipSeedStore.pendingCreate.read()).status === "absent", "rejected phase-skipping seed leaves no durable intent");
  const invalidInflight = await a.pendingCreate.putIfOwned({ ...seed, createId: id, trailingQueue: inflightSnap(0) }, afterRemove.lease);
  ok(invalidInflight.status === "failure" && invalidInflight.reason === "invalid-input", "pending record rejects inflight PATCH state");
  const invalidAnchor = await a.pendingCreate.putIfOwned({ ...seed, createId: id, trailingQueue: dirtyQueue(1) }, afterRemove.lease);
  ok(invalidAnchor.status === "failure" && invalidAnchor.reason === "invalid-input", "pending trailing queue is fixed at revision zero");
}

console.log("鈶?pending-create expected-id/phase claim is atomic and mismatch-inert");
{
  const idA = "33333333-3333-4333-8333-333333333333";
  const idC = "44444444-4444-4444-8444-444444444444";
  const f = makeFakeIndexedDB();
  const a = createCanvasShadowStore({ factory: f, dbName: "pending-expected" });
  const b = createCanvasShadowStore({ factory: f, dbName: "pending-expected" });
  const seedA = {
    createId: idA,
    capturedDoc: validDoc,
    latestDoc: validDoc,
    trailingQueue: null,
    phase: "pending",
  };
  const ownerA = await a.pendingCreate.claim("expected-owner-A", seedA);
  const postingA = await a.pendingCreate.putIfOwned(
    { ...seedA, phase: "posting" },
    ownerA.lease
  );

  const wrongId = await b.pendingCreate.claimIfMatches("wrong-id-owner", {
    createId: idC,
    phase: "posting",
  });
  ok(wrongId.status === "mismatch", "expected claim rejects an unrelated replacement without claiming it");
  const stillOwnedAfterWrongId = await a.pendingCreate.putIfOwned(
    { ...seedA, phase: "posting" },
    postingA.lease
  );
  ok(stillOwnedAfterWrongId.status === "written", "id mismatch leaves the exact prior owner lease writable");

  const wrongPhase = await b.pendingCreate.claimIfMatches("wrong-phase-owner", {
    createId: idA,
    phase: "pending",
  });
  ok(wrongPhase.status === "mismatch", "expected claim also matches the optional phase exactly");
  const stillOwnedAfterWrongPhase = await a.pendingCreate.putIfOwned(
    { ...seedA, phase: "posting" },
    stillOwnedAfterWrongId.lease
  );
  ok(stillOwnedAfterWrongPhase.status === "written", "phase mismatch performs no ownerEpoch or writeSeq mutation");

  const hostileExpected = await b.pendingCreate.claimIfMatches("hostile-expected-owner", {
    createId: idA,
    phase: "posting",
    extra: true,
  });
  ok(hostileExpected.status === "failure" && hostileExpected.reason === "invalid-input", "expected claim rejects unknown fields descriptor-safely");
  const exact = await b.pendingCreate.claimIfMatches("expected-owner-B", {
    createId: idA.toUpperCase(),
    phase: "posting",
  });
  ok(
    exact.status === "claimed" &&
      exact.record.createId === idA &&
      exact.record.phase === "posting" &&
      exact.lease.ownerEpoch === ownerA.lease.ownerEpoch + 1,
    "exact expected claim canonicalizes id and advances owner epoch once"
  );

  const removedA = await b.pendingCreate.removeIfOwned(exact.lease, {
    createId: idA,
    phase: "posting",
  });
  const seedC = { ...seedA, createId: idC };
  const ownerC = await a.pendingCreate.claim("replacement-owner-C", seedC);
  const staleExpectedA = await b.pendingCreate.claimIfMatches("late-route-A", {
    createId: idA,
    phase: "posting",
  });
  ok(staleExpectedA.status === "mismatch", "late route A cannot claim a singleton atomically replaced by C");
  const postingC = await a.pendingCreate.putIfOwned(
    { ...seedC, phase: "posting" },
    ownerC.lease
  );
  ok(postingC.status === "written", "mismatched late route leaves replacement C ownership intact");

  const removedC = await a.pendingCreate.removeIfOwned(postingC.lease, {
    createId: idC,
    phase: "posting",
  });
  const absentMatch = await b.pendingCreate.claimIfMatches("absent-match-owner", {
    createId: idC,
  });
  ok(absentMatch.status === "mismatch", "expected claim treats a tombstone as mismatch without reviving it");
  const afterAbsentMismatch = await b.pendingCreate.claim("after-absent-mismatch");
  ok(
    afterAbsentMismatch.status === "claimed" &&
      afterAbsentMismatch.record === null &&
      afterAbsentMismatch.lease.ownerEpoch === removedC.lease.ownerEpoch + 1,
    "tombstone mismatch performs no hidden ownerEpoch increment"
  );
}

{
  const id = "22222222-2222-4222-8222-222222222222";
  const f = makeFakeIndexedDB();
  const userA = createCanvasShadowStore({ factory: f, dbName: "user:A" });
  const userB = createCanvasShadowStore({ factory: f, dbName: "user:B" });
  const seed = { createId: id, capturedDoc: validDoc, latestDoc: validDoc, phase: "pending", updatedAt: ISO };
  await userA.pendingCreate.claim("owner-user-A", seed);
  ok((await userA.pendingCreate.read()).status === "found" && (await userB.pendingCreate.read()).status === "absent", "per-user database scope isolates pending create drafts");
  ok(f._dbs.get("user:A").stores.get("pending-creates").has(CANVAS_PENDING_CREATE_KEY), "pending envelope uses the declared keyPath singleton key");
}

{
  const f = makeFakeIndexedDB();
  const s = createCanvasShadowStore({ factory: f, dbName: "recovery-flags" });
  await s.put({ canvasId: "cv", doc: validDoc, deps: validDeps, serverRev: 4, serverRecoveryRequired: true, localRecoveryRequired: false, updatedAt: ISO });
  const flagged = await s.read("cv");
  ok(flagged.status === "found" && flagged.record.serverRecoveryRequired === true && flagged.record.localRecoveryRequired === false, "explicit same-revision recovery confirmation flags round-trip");
  ok(CANVAS_SHADOW_STORAGE_VERSION === 2, "storage envelope version is explicitly v2");
}

console.log("⑫ ahead 判定 + 恢复策略(replay_queue / restore_snapshot)");
ok(decideShadowRecovery(null, { rev: 0 }).canRecover === false, "无影子 → 不恢复");
ok(decideShadowRecovery(rec("cv-1", 3, cleanQueue(3)), { rev: 3 }).canRecover === false, "同 rev + 无 dirty → 不恢复");
{
  const d = decideShadowRecovery(rec("cv-1", 3, dirtyQueue(3)), { rev: 3 });
  ok(d.canRecover === true && d.candidate.strategy === "replay_queue", "同 rev + dirty → replay_queue");
  ok(d.candidate.baseRev === 3 && d.candidate.queue && d.candidate.queue.pending.length === 1, "replay_queue:baseRev=server.rev、携带队列");
  ok(d.candidate.shadowServerRev === 3, "候选带只读诊断 shadowServerRev");
}
ok(decideShadowRecovery(rec("cv-1", 3, dirtyQueue(3)), { rev: 5 }).canRecover === false, "server rev 更新(5>3)→ 绝不误提示(即便 dirty)");
{
  const d = decideShadowRecovery(rec("cv-1", 6, dirtyQueue(6)), { rev: 4 });
  ok(d.canRecover === true && d.candidate.strategy === "restore_snapshot", "shadow rev 新于 server(6>4)→ restore_snapshot");
  ok(d.candidate.baseRev === 4, "restore_snapshot:baseRev 恒取 server.rev(4),绝不 shadow.serverRev(6)");
  ok(d.candidate.queue === null && d.candidate.shadowServerRev === 6, "restore_snapshot:queue 置 null(锚点超前不可送 D3),诊断保留原 rev");
}
ok(decideShadowRecovery(rec("cv-1", 3, null), { rev: -1 }).canRecover === false, "server rev 非法 → 不提示");
{
  const s = rec("cv-1", 6, dirtyQueue(6));
  const d = decideShadowRecovery(s, { rev: 4 });
  d.candidate.doc.nodes.push(createCanvasNode());
  ok(s.doc.nodes.length === 0, "恢复候选为深拷贝,改候选不污染 shadow");
}
{
  // 关键 CAS 安全:候选 baseRev 永不 > server.rev(否则 D3 拒 baseRev>storedRev)
  let violated = false;
  for (const [sv, rv] of [[3, 3], [6, 4], [10, 0], [1, 1], [100, 50]]) {
    const d = decideShadowRecovery(rec("cv-1", sv, dirtyQueue(sv)), { rev: rv });
    if (d.canRecover && d.candidate.baseRev > rv) violated = true;
  }
  ok(!violated, "候选 baseRev 永不 > server.rev");
}
ok(decideShadowRecovery(42, { rev: 0 }).canRecover === false, "decide 垃圾 shadow(数字)→ false(不抛)");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑩ 源文件卫生(零 localStorage / 零新依赖)");
const src = readFileSync(join(ROOT, "src", "lib", "canvas", "shadow.ts"), "utf8");
ok(!/localStorage/.test(src), "shadow.ts 绝不引用 localStorage");
ok(!/sessionStorage/.test(src), "shadow.ts 绝不引用 sessionStorage");
const allowed = new Set(["zod", "./schema", "./offline-queue"]);
const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
ok(specs.length > 0 && specs.every((s) => allowed.has(s)), "shadow.ts 只从 zod/./schema/./offline-queue 导入(零新依赖)");
ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(src), "shadow.ts 无 NUL/控制字节");

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑪ 容错:循环 / hostile raw 永不抛(fullyValidateRecord try/catch)");
// 循环 corrupt stored record(IDB structured-clone 可存;绕过 put 直接注入,因 put 会在 buildRecord 提前拒绝)
const circStored = {
  version: 1,
  canvasId: "cv-circ-read",
  schemaVersion: 1,
  doc: { nodes: [paramsNode("n", {})], edges: [], groups: [] },
  deps: validDeps,
  serverRev: 1,
  updatedAt: ISO,
  queue: null,
};
circStored.doc.nodes[0].data.params.self = circStored.doc.nodes[0].data.params;
t1.set("cv-circ-read", circStored);
await returnsNullNoThrow("循环 corrupt stored record 读取 → null(不 throw)", () => store.get("cv-circ-read"));

const circRaw = {
  version: 1,
  canvasId: "cv",
  schemaVersion: 1,
  doc: { nodes: [paramsNode("n", {})], edges: [], groups: [] },
  deps: validDeps,
  serverRev: 1,
  updatedAt: ISO,
  queue: null,
};
circRaw.doc.nodes[0].data.params.self = circRaw.doc.nodes[0].data.params;
await returnsNullNoThrow("validateShadowRecord 循环 raw → null(不 throw)", () =>
  validateShadowRecord(circRaw, "cv")
);

const hostileGetter = {
  get version() {
    throw new Error("boom-getter");
  },
};
await returnsNullNoThrow("validateShadowRecord hostile getter raw → null(不 throw)", () =>
  validateShadowRecord(hostileGetter, "cv")
);

const hostileProxy = new Proxy(
  {},
  {
    get() {
      throw new Error("boom-proxy");
    },
    ownKeys() {
      throw new Error("boom-keys");
    },
    has() {
      return true;
    },
  }
);
await returnsNullNoThrow("validateShadowRecord hostile proxy raw → null(不 throw)", () =>
  validateShadowRecord(hostileProxy, "cv")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑫ 严格 JSON 深拷贝:拒绝 JSON 会篡改的值(put/read/decide),合法值仍深拷贝");
const putParams = (canvasId, params) =>
  store.put({
    canvasId,
    doc: { nodes: [paramsNode("n", params)], edges: [], groups: [] },
    deps: validDeps,
    serverRev: 1,
    updatedAt: ISO,
  });
ok((await putParams("cv-undef", { u: undefined })) === false, "params 含 undefined → put false");
ok((await putParams("cv-fn", { f: () => 1 })) === false, "params 含 function → put false");
ok((await putParams("cv-nan", { n: NaN })) === false, "params 含 NaN → put false");
ok((await putParams("cv-inf", { i: Infinity })) === false, "params 含 Infinity → put false");
ok((await putParams("cv-dt", { d: new Date() })) === false, "params 含 Date → put false");
ok((await putParams("cv-map", { m: new Map() })) === false, "params 含 Map → put false");
ok((await putParams("cv-set", { s: new Set() })) === false, "params 含 Set → put false");
ok((await putParams("cv-bi", { b: 10n })) === false, "params 含 BigInt → put false");
ok((await putParams("cv-symval", { s: Symbol("x") })) === false, "params 含 symbol 值 → put false");
{
  const symKey = {};
  symKey[Symbol("k")] = 1;
  ok((await putParams("cv-symkey", symKey)) === false, "params 含 symbol 键 → put false");
  const accessor = Object.defineProperty({}, "g", { get: () => 1, enumerable: true, configurable: true });
  ok((await putParams("cv-getter", accessor)) === false, "params 含 accessor(getter)→ put false");
  const nonEnum = {};
  Object.defineProperty(nonEnum, "ne", { value: 1, enumerable: false });
  ok((await putParams("cv-nonenum", nonEnum)) === false, "params 含 non-enumerable 键 → put false");
  const sparse = [1];
  sparse[3] = 2;
  ok((await putParams("cv-sparse", { arr: sparse })) === false, "params 含稀疏数组 → put false");
}
{
  const legal = { str: "ok", num: 3.14, bool: true, nul: null, arr: [1, 2, 3], nested: { a: 1 } };
  ok((await putParams("cv-legal", legal)) === true, "合法 params(string/有限数/bool/null/数组/嵌套)→ put true");
  const g = await store.get("cv-legal");
  ok(
    g && g.doc.nodes[0].data.params.nested.a === 1 && g.doc.nodes[0].data.params.arr.length === 3,
    "合法 params 深拷贝完整取回"
  );
}
// 读侧:库内存了 Date/Map(structured-clone 可存)→ read validate 也拒
t1.set("cv-date-read", {
  version: 1,
  canvasId: "cv-date-read",
  schemaVersion: 1,
  doc: { nodes: [paramsNode("n", { d: new Date() })], edges: [], groups: [] },
  deps: validDeps,
  serverRev: 1,
  updatedAt: ISO,
  queue: null,
});
await returnsNullNoThrow("读到含 Date 的 record → null(JSON 会篡改)", () => store.get("cv-date-read"));
await returnsNullNoThrow("validateShadowRecord 含 Map 的 raw → null", () =>
  validateShadowRecord(
    {
      version: 1,
      canvasId: "cv",
      schemaVersion: 1,
      doc: { nodes: [paramsNode("n", { m: new Map() })], edges: [], groups: [] },
      deps: validDeps,
      serverRev: 1,
      updatedAt: ISO,
      queue: null,
    },
    "cv"
  )
);
{
  const badShadow = rec("cv-1", 6, null);
  badShadow.doc = { nodes: [paramsNode("n", { d: new Date() })], edges: [], groups: [] };
  ok(decideShadowRecovery(badShadow, { rev: 4 }).canRecover === false, "decide:非 JSON 安全 doc(含 Date)→ false(不抛)");
}
// 损坏队列快照(乱序 seq,违反 D3 不变量)的 record 读回 → null
{
  const q0 = enqueue(enqueue(createOfflineQueue(3), "qa", addOp), "qb", addOp);
  const good = snapshot(q0);
  const corruptQueue = { ...good, pending: [good.pending[1], good.pending[0]] };
  t1.set("cv-badqueue", {
    version: 1,
    canvasId: "cv-badqueue",
    schemaVersion: 1,
    doc: validDoc,
    deps: validDeps,
    serverRev: 3,
    updatedAt: ISO,
    queue: corruptQueue,
  });
  await returnsNullNoThrow("含损坏队列快照(乱序 seq)的 record 读回 → null", () => store.get("cv-badqueue"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("⑬ 严格克隆硬化:数组 descriptors / own __proto__ / hostile decide");
{
  const accArr = [1, 2];
  Object.defineProperty(accArr, 0, { get: () => 99, enumerable: true, configurable: true });
  ok((await putParams("cv-arracc", { arr: accArr })) === false, "数组含 accessor index → put false");
}
{
  const extraArr = [1, 2];
  extraArr.foo = "bar";
  ok((await putParams("cv-arrextra", { arr: extraArr })) === false, "数组含额外 own 键(foo)→ put false");
}
{
  const protoArr = [1, 2];
  Object.setPrototypeOf(protoArr, { custom: true });
  ok((await putParams("cv-arrproto", { arr: protoArr })) === false, "数组改过原型 → put false");
}
{
  const neArr = [1, 2];
  Object.defineProperty(neArr, 0, { value: 1, enumerable: false, configurable: true, writable: true });
  ok((await putParams("cv-arrne", { arr: neArr })) === false, "数组含 non-enumerable index → put false");
}
{
  // own __proto__ 数据键(JSON.parse 造):strictJsonClone 直测——保留 own data、不改原型、不污染全局
  const withProto = JSON.parse('{"__proto__":{"x":1},"n":2}');
  const c = strictJsonClone(withProto);
  ok(c.ok, "own __proto__ 对象 strictJsonClone 成功");
  ok(Object.prototype.hasOwnProperty.call(c.value, "__proto__"), "clone 保留 __proto__ own 键(未丢)");
  ok(Object.getPrototypeOf(c.value) === Object.prototype, "clone 原型仍为 Object.prototype(未被 __proto__ 改写)");
  ok(c.value.n === 2, "clone 保留其它键值");
  ok(({}).x === undefined, "clone 未污染 Object.prototype");
  const src = { a: { b: [1, 2] } };
  const c2 = strictJsonClone(src);
  ok(c2.ok && c2.value.a !== src.a && c2.value.a.b !== src.a.b && c2.value.a.b[1] === 2, "合法值深拷贝:嵌套为新引用、值完整");
  ok(!strictJsonClone({ d: new Date() }).ok, "strictJsonClone 拒 Date");
  ok(!strictJsonClone({ m: new Map() }).ok, "strictJsonClone 拒 Map");
  ok(!strictJsonClone(Object.assign([1], { extra: 1 })).ok, "strictJsonClone 拒数组额外键");
}
{
  const proxyShadow = new Proxy({}, { get() { throw new Error("boom"); }, ownKeys() { throw new Error("keys"); }, has() { return true; } });
  let threw = false;
  let res;
  try {
    res = decideShadowRecovery(proxyShadow, { rev: 0 });
  } catch {
    threw = true;
  }
  ok(!threw && res && res.canRecover === false, "decide hostile proxy shadow → false(不抛)");
  const hostileServer = {
    get rev() {
      throw new Error("boom-server");
    },
  };
  let threw2 = false;
  let res2;
  try {
    res2 = decideShadowRecovery(rec("cv-1", 6, dirtyQueue(6)), hostileServer);
  } catch {
    threw2 = true;
  }
  ok(!threw2 && res2 && res2.canRecover === false, "decide hostile server getter → false(不抛)");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n结果:${pass} 通过,${fails.length} 失败`);
if (fails.length) {
  console.log("失败项:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("✅ D4 本地验证全绿");
