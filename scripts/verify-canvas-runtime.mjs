#!/usr/bin/env node

/** Focused verifier for the Super Canvas runtime persistence coordinator. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, ".temp", "canvas-verify-build");

function addModuleExtensions(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

async function loadHookModule(rewrites) {
  mkdirSync(OUT, { recursive: true });
  const sourcePath = join(ROOT, "src", "components", "canvas", "use-canvas-runtime.ts");
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  let code = addModuleExtensions(outputText);
  for (const [from, to] of Object.entries(rewrites)) code = code.split(from).join(to);
  const outputPath = join(OUT, "use-canvas-runtime-production.mjs");
  writeFileSync(outputPath, code, "utf8");
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
}

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

async function drainMicrotasks(turns = 12) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function makeScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    tasks,
    setTimeout(handler, delay) {
      const id = nextId++;
      tasks.set(id, { handler, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    now: () => 0,
  };
}

function makeIntentStore() {
  let current = null;
  let setCount = 0;
  let clearCount = 0;
  const sessionHandoffs = new Map();
  return {
    api: {
      get: () => current,
      set(intent) {
        setCount += 1;
        current = intent;
      },
      clear(expectedId) {
        if (current?.id !== expectedId) return;
        clearCount += 1;
        current = null;
      },
      getSessionHandoff(canvasId) {
        return sessionHandoffs.get(canvasId) ?? null;
      },
      setSessionHandoff(handoff) {
        sessionHandoffs.set(handoff.canvasId, handoff);
      },
      clearSessionHandoff(canvasId) {
        sessionHandoffs.delete(canvasId);
      },
    },
    current: () => current,
    setCount: () => setCount,
    clearCount: () => clearCount,
    handoff: (canvasId) => sessionHandoffs.get(canvasId) ?? null,
    handoffCount: () => sessionHandoffs.size,
  };
}

function makeStore(emptyDoc, options = {}) {
  const state = {
    nodes: emptyDoc.nodes,
    edges: emptyDoc.edges,
    groups: emptyDoc.groups,
    hydrated: true,
    sessionCanvasId: null,
    hydratedCanvasId: null,
    readOnly: false,
    recoveryRequired: false,
  };
  let promotions = 0;
  let hydrations = 0;
  return {
    state,
    promotions: () => promotions,
    hydrations: () => hydrations,
    api: {
      getState: () => state,
      hydrate(result, id) {
        hydrations += 1;
        state.nodes = result.nodes;
        state.edges = result.edges;
        state.groups = result.groups;
        state.hydrated = true;
        state.sessionCanvasId = id;
        state.hydratedCanvasId = id;
        state.readOnly = false;
        state.recoveryRequired = result.recoveryRequired;
        return true;
      },
      promoteLocalToPersisted(id) {
        if (
          !state.hydrated ||
          state.sessionCanvasId !== null ||
          state.hydratedCanvasId !== null
        ) {
          return false;
        }
        promotions += 1;
        state.sessionCanvasId = id;
        state.hydratedCanvasId = id;
        state.readOnly = true;
        return true;
      },
      adoptAuthoritativeDoc(id, doc) {
        if (options.adoptAuthoritativeDoc) return options.adoptAuthoritativeDoc(id, doc);
        if (
          state.sessionCanvasId !== id ||
          state.hydratedCanvasId !== id ||
          !state.hydrated
        ) {
          return false;
        }
        state.nodes = doc.nodes;
        state.edges = doc.edges;
        state.groups = doc.groups;
        state.recoveryRequired = false;
        return true;
      },
      preparePatchSave:
        options.preparePatchSave ??
        (() => {
          throw new Error("Unexpected PATCH preparation in focused create test");
        }),
      prepareRepairSave:
        options.prepareRepairSave ??
        (() => {
          throw new Error("Unexpected repair preparation in focused runtime test");
        }),
    },
  };
}

function makeRuntimeDeps({ store, intentStore, fetch, uuid, scheduler = makeScheduler(), ...extra }) {
  return {
    store: store.api,
    fetch,
    scheduler,
    uuid,
    createIntentStore: intentStore.api,
    debounceMs: 5_000,
    maxRetryMs: 30_000,
    isOnline: () => true,
    ...extra,
  };
}

async function verifyProductionHookWiring() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "hook-react-stub.mjs"),
    String.raw`
let slots = [];
let cursor = 0;
let pending = [];
const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
export function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { kind: "state", value: initial };
  const setValue = (next) => {
    slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
  };
  return [slots[index].value, setValue];
}
export function useRef(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { kind: "ref", value: { current: initial } };
  return slots[index].value;
}
export function useCallback(callback) {
  cursor += 1;
  return callback;
}
export function useEffect(effect, deps) {
  const index = cursor++;
  const previous = slots[index];
  if (previous?.kind === "effect" && !changed(previous.deps, deps)) return;
  pending.push(() => {
    previous?.cleanup?.();
    const cleanup = effect();
    slots[index] = { kind: "effect", deps, cleanup: typeof cleanup === "function" ? cleanup : null };
  });
}
export function __render(render) {
  cursor = 0;
  const result = render();
  const effects = pending;
  pending = [];
  for (const run of effects) run();
  return result;
}
export function __unmount() {
  for (let index = slots.length - 1; index >= 0; index -= 1) slots[index]?.cleanup?.();
  slots = [];
  pending = [];
  cursor = 0;
}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-next-stub.mjs"),
    "export const __routerCalls=[]; export function useRouter(){return {replace(url){__routerCalls.push(url)}}}\n",
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-supabase-stub.mjs"),
    String.raw`
const clients = [];
export function __queueClient(client) { clients.push(client); }
export function createClient() {
  const client = clients.shift();
  if (!client) throw new Error("No queued Supabase client");
  return client;
}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-store-stub.mjs"),
    String.raw`
const listeners = new Set();
export const __storeMetrics = { resets: 0, subscriptions: 0, unsubscriptions: 0 };
let state = {
  nodes: [{ id: "owner_a_private_doc" }], edges: [], groups: [], hydrated: false,
  sessionCanvasId: null, hydratedCanvasId: null, readOnly: false, recoveryRequired: false,
  hydrate() { return false; }, promoteLocalToPersisted() { return false; },
  adoptAuthoritativeDoc() { return false; },
  preparePatchSave() { return { ok: false, error: { code: "NOT_HYDRATED" } }; },
  reset() {
    __storeMetrics.resets += 1;
    const previous = state;
    state = { ...state, nodes: [], edges: [], groups: [], hydrated: false,
      sessionCanvasId: null, hydratedCanvasId: null, readOnly: false, recoveryRequired: false };
    for (const listener of listeners) listener(state, previous);
  },
};
export function useCanvasStore(selector) { return selector ? selector(state) : state; }
useCanvasStore.getState = () => state;
useCanvasStore.subscribe = (listener) => {
  __storeMetrics.subscriptions += 1;
  listeners.add(listener);
  return () => { __storeMetrics.unsubscriptions += 1; listeners.delete(listener); };
};
export function __storeState() { return state; }
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-shadow-stub.mjs"),
    String.raw`
export const __shadowOptions = [];
export function createCanvasShadowStore(options) {
  __shadowOptions.push(options);
  return { available: false, async get(){return null}, async put(){return false}, async delete(){return false} };
}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-save-stub.mjs"),
    "export function consumeCanvasPatchResponse(){return false}\n",
    "utf8"
  );
  writeFileSync(
    join(OUT, "hook-lifecycle-stub.mjs"),
    "export function normalizeCanvasId(value){return typeof value==='string'?value:null}\n",
    "utf8"
  );

  const react = await import(pathToFileURL(join(OUT, "hook-react-stub.mjs")).href);
  const supabase = await import(pathToFileURL(join(OUT, "hook-supabase-stub.mjs")).href);
  const store = await import(pathToFileURL(join(OUT, "hook-store-stub.mjs")).href);
  const shadow = await import(pathToFileURL(join(OUT, "hook-shadow-stub.mjs")).href);
  const hook = await loadHookModule({
    '"react"': '"./hook-react-stub.mjs"',
    '"next/navigation"': '"./hook-next-stub.mjs"',
    '"@/lib/canvas/canvas-runtime"': '"./canvas-runtime.mjs"',
    '"@/lib/canvas/shadow"': '"./hook-shadow-stub.mjs"',
    '"@/lib/canvas/canvas-save-adapter"': '"./hook-save-stub.mjs"',
    '"@/lib/canvas/canvas-writer-lifecycle"': '"./hook-lifecycle-stub.mjs"',
    '"@/lib/supabase/client"': '"./hook-supabase-stub.mjs"',
    '"@/stores/canvas-store"': '"./hook-store-stub.mjs"',
  });

  const makeAuthClient = (snapshot) => {
    let listener = null;
    let unsubscribed = 0;
    return {
      client: {
        auth: {
          getUser: () => snapshot,
          onAuthStateChange: (callback) => {
            listener = callback;
            return { data: { subscription: { unsubscribe: () => { unsubscribed += 1; } } } };
          },
        },
      },
      emit: (userId) => listener?.("AUTH_CHANGED", userId ? { user: { id: userId } } : null),
      unsubscribed: () => unsubscribed,
    };
  };
  const mountResolvedUser = async (userId) => {
    const auth = makeAuthClient(Promise.resolve({ data: { user: { id: userId } } }));
    supabase.__queueClient(auth.client);
    const pendingView = react.__render(() => hook.useCanvasRuntime(null));
    eq(pendingView.authIdentity, undefined, "production hook keeps auth unresolved before a trustworthy signal");
    await drainMicrotasks();
    auth.view = react.__render(() => hook.useCanvasRuntime(null));
    return auth;
  };

  const authA = await mountResolvedUser("user_a");
  eq(store.__storeMetrics.resets, 0, "production hook keeps the first resolved user's initial store");
  eq(authA.view.authIdentity, "user_a", "production hook exposes the resolved auth identity to UI gating");
  eq(shadow.__shadowOptions.at(-1)?.dbName, "stargaze-canvas-shadow:user_a", "hook scopes shadow to user A");
  authA.emit("user_b");
  eq(store.__storeMetrics.resets, 1, "auth switch resets the singleton synchronously before the next render");
  const switchedView = react.__render(() => hook.useCanvasRuntime(null));
  eq(switchedView.authIdentity, "user_b", "same-mount auth switch publishes the new identity after reset");
  react.__unmount();
  eq(authA.unsubscribed(), 1, "production hook unsubscribes Supabase on unmount");

  const authB = await mountResolvedUser("user_b");
  eq(store.__storeMetrics.resets, 1, "same-user remount does not reset the singleton a second time");
  eq(store.__storeState().nodes, [], "user B cannot inherit user A's singleton document");
  eq(shadow.__shadowOptions.at(-1)?.dbName, "stargaze-canvas-shadow:user_b", "hook scopes shadow to user B");
  react.__unmount();
  eq(authB.unsubscribed(), 1, "second hook mount also cleans Supabase subscription");
  eq(store.__storeMetrics.subscriptions, store.__storeMetrics.unsubscriptions, "runtime store subscriptions are cleaned across remounts");

  let resolveStale;
  const stale = new Promise((resolve) => { resolveStale = resolve; });
  const authEvent = makeAuthClient(stale);
  supabase.__queueClient(authEvent.client);
  react.__render(() => hook.useCanvasRuntime(null));
  authEvent.emit("user_event");
  react.__render(() => hook.useCanvasRuntime(null));
  const optionCount = shadow.__shadowOptions.length;
  resolveStale({ data: { user: { id: "stale_snapshot" } } });
  await drainMicrotasks();
  react.__render(() => hook.useCanvasRuntime(null));
  eq(shadow.__shadowOptions.length, optionCount, "late getUser snapshot cannot rebuild runtime for stale identity");
  eq(shadow.__shadowOptions.at(-1)?.dbName, "stargaze-canvas-shadow:user_event", "auth event remains production hook identity");
  react.__unmount();
  eq(authEvent.unsubscribed(), 1, "event-first hook mount cleans Supabase subscription");
}

// Build the dependency graph in leaf-first order for the repository's offline TS loader.
const schema = await loadCanvasModule("schema");
await loadCanvasModule("doc-limits");
const patchModule = await loadCanvasModule("patch");
await loadCanvasModule("history");
const offlineQueue = await loadCanvasModule("offline-queue");
await loadCanvasModule("api-types");
await loadCanvasModule("writer-lock");
const apiHelpers = await loadCanvasModule("api-helpers");
const routeParams = await loadCanvasModule("canvas-route-params");
await loadCanvasModule("shadow");
await loadCanvasModule("canvas-save-adapter");
const runtimeModule = await loadCanvasModule("canvas-runtime");
await verifyProductionHookWiring();

const { createEmptyCanvasDeps, createEmptyCanvasDoc, createCanvasNode } = schema;
const { CanvasOpSchema } = patchModule;
const { CanvasCreateRequestSchema } = apiHelpers;
const { parseCanvasIdParam } = routeParams;
const { buildPatch: buildQueuePatch, createOfflineQueue, enqueue, snapshot } = offlineQueue;
const {
  createCanvasAuthStateCoordinator,
  createCanvasCreateIntentRegistry,
  createCanvasRuntime: createCanvasRuntimeCore,
  resolveCanvasAuthSnapshot,
  subscribeCanvasRuntimeStore,
} = runtimeModule;
const CREATE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";
const ISO = "2026-07-13T00:00:00.000Z";
const addNodeOp = (node) => CanvasOpSchema.parse({ entity: "node", op: "add", value: node });

// Legacy focused fixtures predate the explicit D5 capability. They still exercise the real
// production state machine, but acquire a deterministic writer capability before persisted
// configure so the initial load itself is the takeover GET (no hidden second request).
let runtimeOwnerCounter = 0;
function adaptLegacyShadow(shadow) {
  if (!shadow || typeof shadow.claim === "function") return shadow;
  // Historical fixtures used `available:false` to mean "D4 omitted". Keep that legacy meaning;
  // new fail-closed unavailable/failure cases below use the actual v2 discriminated surface.
  if (shadow.available === false) return null;
  let epoch = 0;
  let lease = null;
  const pendingCreate = {
    async read() { return { status: "absent" }; },
    async claim(ownerId, seed) {
      epoch += 1;
      return { status: "claimed", record: seed ? { version: 1, ...seed, updatedAt: ISO } : null,
        lease: { ownerId, ownerEpoch: epoch, writeSeq: 0 } };
    },
    async claimIfMatches() { return { status: "mismatch" }; },
    async putIfOwned(_input, current) {
      return { status: "written", lease: { ...current, writeSeq: current.writeSeq + 1 } };
    },
    async removeIfOwned(current) {
      return { status: "removed", lease: { ...current, writeSeq: current.writeSeq + 1 } };
    },
  };
  return {
    available: shadow.available,
    pendingCreate,
    async read(canvasId) {
      if (!shadow.available) return { status: "unavailable" };
      try {
        const record = await shadow.get?.(canvasId);
        return record ? { status: "found", record } : { status: "absent" };
      } catch {
        return { status: "failure", reason: "request" };
      }
    },
    async claim(canvasId, ownerId) {
      if (!shadow.available) return { status: "unavailable" };
      let record;
      try { record = await shadow.get?.(canvasId) ?? null; }
      catch { return { status: "failure", reason: "request" }; }
      epoch += 1;
      lease = { canvasId, ownerId, ownerEpoch: epoch, writeSeq: 0 };
      return { status: "claimed", record, lease };
    },
    async putIfOwned(input, current) {
      if (!lease || JSON.stringify(current) !== JSON.stringify(lease)) return { status: "stale" };
      try {
        const written = await shadow.put?.(input);
        if (written === false) return { status: "failure", reason: "request" };
      } catch { return { status: "failure", reason: "request" }; }
      lease = { ...current, writeSeq: current.writeSeq + 1 };
      return { status: "written", lease };
    },
    async removeIfOwned(current) {
      if (!lease || JSON.stringify(current) !== JSON.stringify(lease)) return { status: "stale" };
      try {
        const removed = await shadow.remove?.(current.canvasId);
        if (removed === false) return { status: "failure", reason: "request" };
      } catch { return { status: "failure", reason: "request" }; }
      lease = { ...current, writeSeq: current.writeSeq + 1 };
      return { status: "removed", lease };
    },
  };
}
function createCanvasRuntime(inputDeps) {
  runtimeOwnerCounter += 1;
  const ownerIndex = runtimeOwnerCounter;
  const runtime = createCanvasRuntimeCore({
    shadowOwnerId: `runtime-verifier-owner-${ownerIndex}`,
    ...inputDeps,
    shadow: adaptLegacyShadow(inputDeps.shadow),
  });
  const configure = runtime.configure.bind(runtime);
  runtime.configure = (canvasId) => {
    if (typeof canvasId === "string" && /^[0-9a-f-]{36}$/i.test(canvasId)) {
      runtime.handleWriterSignal({
        canvasId,
        writerTag: `runtime-verifier-writer-${ownerIndex}`,
        acquired: true,
      });
    }
    configure(canvasId);
  };
  return runtime;
}

// UUIDs are case-insensitive on the wire/DB, but every runtime identity is canonical lowercase.
{
  const upper = CREATE_ID.toUpperCase();
  eq(
    parseCanvasIdParam(`  ${upper}  `),
    { kind: "persisted", id: CREATE_ID },
    "route parser trims and canonicalizes uppercase UUIDs"
  );
  eq(
    CanvasCreateRequestSchema.parse({ id: upper }).id,
    CREATE_ID,
    "POST create schema canonicalizes a supplied UUID"
  );
  ok(
    parseCanvasIdParam([CREATE_ID, OTHER_ID]).kind === "invalid",
    "duplicate id query parameters remain fail-closed"
  );
}

// Auth events outrank a stale initial snapshot, and disposed hook wiring is inert.
{
  const commits = [];
  const auth = createCanvasAuthStateCoordinator((userId) => commits.push(userId));
  auth.resolveEvent("user_from_event");
  auth.resolveInitial("stale_get_user");
  eq(commits, ["user_from_event"], "late getUser cannot overwrite a newer auth event");
  auth.dispose();
  auth.resolveEvent("after_dispose");
  eq(commits, ["user_from_event"], "disposed auth coordinator ignores later events");

  const initialCommits = [];
  const initial = createCanvasAuthStateCoordinator((userId) => initialCommits.push(userId));
  initial.resolveInitial("initial_user");
  initial.resolveEvent(null);
  eq(initialCommits, ["initial_user", null], "initial snapshot commits until an auth event arrives");
  initial.dispose();

  const rejectedCommits = [];
  const rejected = createCanvasAuthStateCoordinator((userId) => rejectedCommits.push(userId));
  resolveCanvasAuthSnapshot(Promise.reject(new Error("auth transport failed")), rejected);
  await drainMicrotasks();
  eq(rejectedCommits, [], "rejected getUser is not misclassified as logout or allowed to delete local work");
  rejected.dispose();
}

// Store wiring ignores view/history churn and forwards document or persistence-identity changes.
{
  const listeners = new Set();
  const base = {
    nodes: [],
    edges: [],
    groups: [],
    hydrated: true,
    sessionCanvasId: CREATE_ID,
    hydratedCanvasId: CREATE_ID,
    readOnly: false,
    recoveryRequired: false,
    selectionVersion: 0,
  };
  let state = base;
  const store = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (next) => {
    const previous = state;
    state = next;
    for (const listener of listeners) listener(state, previous);
  };
  let relevantChanges = 0;
  const unsubscribe = subscribeCanvasRuntimeStore(store, () => {
    relevantChanges += 1;
  });
  emit({ ...state, selectionVersion: 1 });
  eq(relevantChanges, 0, "selection-only churn does not wake the runtime");
  emit({ ...state, readOnly: true });
  eq(relevantChanges, 1, "read-only transition wakes the runtime");
  emit({ ...state, nodes: [...state.nodes] });
  eq(relevantChanges, 2, "document reference change wakes the runtime");
  emit({ ...state, edges: [...state.edges] });
  emit({ ...state, groups: [...state.groups] });
  emit({ ...state, hydrated: false });
  emit({ ...state, sessionCanvasId: OTHER_ID });
  emit({ ...state, hydratedCanvasId: OTHER_ID });
  emit({ ...state, recoveryRequired: true });
  eq(relevantChanges, 8, "all document, identity, hydration, and recovery fields are observed");
  emit({ ...state, selectionVersion: 2 });
  eq(relevantChanges, 8, "unrelated churn remains filtered after relevant changes");
  unsubscribe();
  emit({ ...state, readOnly: false });
  eq(relevantChanges, 8, "unsubscribed runtime receives no store changes");
}

function makeShadowRecord(doc, serverRev, queue, snapshotRecoveryRequired = false) {
  return {
    version: 1,
    canvasId: CREATE_ID,
    schemaVersion: 1,
    doc,
    deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
    serverRev,
    updatedAt: ISO,
    queue,
    snapshotRecoveryRequired,
  };
}

function makeStrictCasShadow(initial = {}) {
  const state = {
    shadow: {
      ownerId: null,
      ownerEpoch: 0,
      writeSeq: 0,
      payload: initial.record ? structuredClone(initial.record) : null,
    },
    pending: {
      ownerId: null,
      ownerEpoch: 0,
      writeSeq: 0,
      payload: initial.pending ? structuredClone(initial.pending) : null,
    },
    events: [],
    shadowClaims: 0,
    shadowPuts: [],
    pendingReads: 0,
    pendingClaims: 0,
    pendingPuts: [],
    pendingRemoves: 0,
    failNextShadowClaim: false,
    failNextShadowPut: false,
    staleNextShadowPut: false,
    staleNextPendingPut: false,
    failNextPendingRemove: false,
    deferSeedClaim: false,
    seedClaimResolver: null,
    deferNextShadowPut: false,
    shadowPutResolver: null,
    deferNextShadowPutReject: false,
    deferNextPendingPut: false,
    pendingPutResolver: null,
    replacePendingBeforeMatch: null,
  };
  const shadowLeaseMatches = (lease) =>
    state.shadow.ownerId === lease.ownerId &&
    state.shadow.ownerEpoch === lease.ownerEpoch &&
    state.shadow.writeSeq === lease.writeSeq;
  const pendingLeaseMatches = (lease) =>
    state.pending.ownerId === lease.ownerId &&
    state.pending.ownerEpoch === lease.ownerEpoch &&
    state.pending.writeSeq === lease.writeSeq;
  const pendingRecord = (input) => ({ version: 1, ...structuredClone(input), updatedAt: ISO });
  const api = {
    available: true,
    async read() {
      return state.shadow.payload
        ? { status: "found", record: structuredClone(state.shadow.payload) }
        : { status: "absent" };
    },
    async claim(canvasId, ownerId) {
      state.events.push(`shadow-claim:${canvasId}`);
      state.shadowClaims += 1;
      if (state.failNextShadowClaim) {
        state.failNextShadowClaim = false;
        return { status: "failure", reason: "transaction" };
      }
      state.shadow.ownerId = ownerId;
      state.shadow.ownerEpoch += 1;
      state.shadow.writeSeq = 0;
      return {
        status: "claimed",
        record: state.shadow.payload ? structuredClone(state.shadow.payload) : null,
        lease: { canvasId, ownerId, ownerEpoch: state.shadow.ownerEpoch, writeSeq: 0 },
      };
    },
    async putIfOwned(input, lease) {
      state.events.push(`shadow-put:${lease.writeSeq}`);
      state.shadowPuts.push({ input: structuredClone(input), lease: structuredClone(lease) });
      if (state.staleNextShadowPut) {
        state.staleNextShadowPut = false;
        return { status: "stale" };
      }
      if (!shadowLeaseMatches(lease)) return { status: "stale" };
      if (state.failNextShadowPut) {
        state.failNextShadowPut = false;
        return { status: "failure", reason: "transaction" };
      }
      const commit = () => {
        state.shadow.payload = makeShadowRecord(
          input.doc,
          input.serverRev,
          input.queue ?? null,
          input.snapshotRecoveryRequired ?? false
        );
        Object.assign(state.shadow.payload, {
          canvasId: input.canvasId,
          deps: structuredClone(input.deps),
          serverRecoveryRequired: input.serverRecoveryRequired ?? false,
          localRecoveryRequired: input.localRecoveryRequired ?? false,
        });
        state.shadow.writeSeq += 1;
        return {
          status: "written",
          lease: { ...lease, writeSeq: state.shadow.writeSeq },
        };
      };
      if (state.deferNextShadowPut || state.deferNextShadowPutReject) {
        const rejectResponse = state.deferNextShadowPutReject;
        state.deferNextShadowPut = false;
        state.deferNextShadowPutReject = false;
        const committed = commit();
        return new Promise((resolve, reject) => {
          state.shadowPutResolver = () => rejectResponse
            ? reject(new Error("committed response lost"))
            : resolve(committed);
        });
      }
      return commit();
    },
    async removeIfOwned(lease) {
      if (!shadowLeaseMatches(lease)) return { status: "stale" };
      state.shadow.payload = null;
      state.shadow.writeSeq += 1;
      return { status: "removed", lease: { ...lease, writeSeq: state.shadow.writeSeq } };
    },
    pendingCreate: {
      async read() {
        state.events.push("pending-read");
        state.pendingReads += 1;
        return state.pending.payload
          ? { status: "found", record: structuredClone(state.pending.payload) }
          : { status: "absent" };
      },
      async claim(ownerId, seed) {
        state.events.push(`pending-claim:${seed ? "seed" : "existing"}`);
        state.pendingClaims += 1;
        const commit = () => {
          if (!state.pending.payload && seed) state.pending.payload = pendingRecord(seed);
          state.pending.ownerId = ownerId;
          state.pending.ownerEpoch += 1;
          state.pending.writeSeq = 0;
          return {
            status: "claimed",
            record: state.pending.payload ? structuredClone(state.pending.payload) : null,
            lease: { ownerId, ownerEpoch: state.pending.ownerEpoch, writeSeq: 0 },
          };
        };
        if (seed && state.deferSeedClaim) {
          state.deferSeedClaim = false;
          return new Promise((resolve) => {
            state.seedClaimResolver = () => resolve(commit());
          });
        }
        return commit();
      },
      async claimIfMatches(ownerId, expected) {
        state.events.push(`pending-claim-match:${expected.createId}`);
        state.pendingClaims += 1;
        if (state.replacePendingBeforeMatch) {
          state.pending.payload = structuredClone(state.replacePendingBeforeMatch);
          state.replacePendingBeforeMatch = null;
          state.pending.ownerId = "replacement-owner";
          state.pending.ownerEpoch += 1;
          state.pending.writeSeq = 0;
        }
        if (
          !state.pending.payload ||
          state.pending.payload.createId !== expected.createId ||
          (expected.phase && state.pending.payload.phase !== expected.phase)
        ) return { status: "mismatch" };
        state.pending.ownerId = ownerId;
        state.pending.ownerEpoch += 1;
        state.pending.writeSeq = 0;
        return {
          status: "claimed",
          record: structuredClone(state.pending.payload),
          lease: { ownerId, ownerEpoch: state.pending.ownerEpoch, writeSeq: 0 },
        };
      },
      async putIfOwned(input, lease) {
        state.events.push(`pending-put:${input.phase}:${lease.writeSeq}`);
        state.pendingPuts.push({ input: structuredClone(input), lease: structuredClone(lease) });
        if (state.staleNextPendingPut) {
          state.staleNextPendingPut = false;
          return { status: "stale" };
        }
        if (!pendingLeaseMatches(lease)) return { status: "stale" };
        const commit = () => {
          state.pending.payload = pendingRecord(input);
          state.pending.writeSeq += 1;
          return {
            status: "written",
            lease: { ...lease, writeSeq: state.pending.writeSeq },
          };
        };
        if (state.deferNextPendingPut) {
          state.deferNextPendingPut = false;
          return new Promise((resolve) => {
            state.pendingPutResolver = () => resolve(commit());
          });
        }
        return commit();
      },
      async removeIfOwned(lease, expected) {
        state.events.push("pending-remove");
        state.pendingRemoves += 1;
        if (state.failNextPendingRemove) {
          state.failNextPendingRemove = false;
          return { status: "failure", reason: "request" };
        }
        if (!pendingLeaseMatches(lease)) return { status: "stale" };
        if (!state.pending.payload || state.pending.payload.createId !== expected.createId) {
          return { status: "stale" };
        }
        state.pending.payload = null;
        state.pending.writeSeq += 1;
        return { status: "removed", lease: { ...lease, writeSeq: state.pending.writeSeq } };
      },
    },
  };
  return { api, state };
}

function makeDocumentData(doc, overrides = {}) {
  return {
    id: CREATE_ID,
    title: "Runtime test",
    rev: 2,
    schemaVersion: 1,
    envelope: {
      schemaVersion: 1,
      doc,
      deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
    },
    recovery: {
      brokenNodes: [],
      brokenEdges: [],
      migratedFrom: 1,
      targetSchemaVersion: 1,
      migrationComplete: true,
      recoveryRequired: false,
      issues: [],
    },
    docBytes: 32,
    status: "active",
    writer: { tag: null, heartbeatAt: null },
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function makePatchData(overrides = {}) {
  return {
    id: CREATE_ID,
    rev: 3,
    schemaVersion: 1,
    docBytes: 64,
    rebased: false,
    appliedOps: 1,
    noopOps: 0,
    persisted: true,
    updatedAt: ISO,
    ...overrides,
  };
}

function makeRepairData(doc, deps = createEmptyCanvasDeps(), overrides = {}) {
  const rev = overrides.rev ?? 3;
  return {
    id: CREATE_ID,
    rev,
    schemaVersion: 1,
    docBytes: 64,
    persisted: true,
    recovered: true,
    updatedAt: ISO,
    envelope: {
      schemaVersion: 1,
      doc,
      deps,
      rev,
      docBytes: 64,
    },
    ...overrides,
  };
}

// Direct runtime callers also canonicalize uppercase ids before transport/identity checks.
{
  const store = makeStore(createEmptyCanvasDoc());
  const urls = [];
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      uuid: () => OTHER_ID,
      fetch: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData(createEmptyCanvasDoc(), { rev: 2 }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID.toUpperCase());
  await drainMicrotasks();
  eq(urls, [`/api/canvas/${CREATE_ID}`], "runtime GET uses canonical lowercase UUID");
  eq(runtime.getDebugState().activeId, CREATE_ID, "runtime identity is canonical lowercase");
  runtime.dispose();
}

// Auth-bound registry isolates users and resets the singleton document on real transitions.
{
  const registry = createCanvasCreateIntentRegistry();
  const userA = registry.forUser("user_a");
  const userB = registry.forUser("user_b");
  const capturedDoc = createEmptyCanvasDoc();
  userA.set({ id: CREATE_ID, capturedDoc });
  userA.setSessionHandoff({
    version: 1,
    canvasId: CREATE_ID,
    doc: capturedDoc,
    deps: createEmptyCanvasDeps(),
    serverRev: 2,
    queue: snapshot(createOfflineQueue(2)),
    snapshotRecoveryRequired: false,
    serverRecoveryRequired: true,
    localRecoveryRequired: false,
    updatedAt: ISO,
  });
  eq(userB.get(), null, "create intent registry isolates authenticated users");
  eq(userB.getSessionHandoff(CREATE_ID), null, "session handoff registry also isolates users");
  let resets = 0;
  registry.handleUserChange(undefined, "user_a", () => {
    resets += 1;
  });
  eq(resets, 0, "initial auth resolution does not reset the canvas");
  registry.handleUserChange(undefined, "user_b", () => {
    resets += 1;
  });
  eq(resets, 1, "user switch across hook remount resets the singleton canvas once");
  eq(userA.get(), null, "user switch deletes the old user's pending intent");
  eq(userA.getSessionHandoff(CREATE_ID), null, "user switch deletes the old user's retained session work");
  userB.set({ id: OTHER_ID, capturedDoc });
  registry.handleUserChange(undefined, null, () => {
    resets += 1;
  });
  eq(resets, 2, "logout resets the singleton canvas once");
  eq(userB.get(), null, "logout deletes the old user's pending intent");
}

// Same-revision shadow replay must update the visible document before rewriting the shadow.
{
  const serverNode = createCanvasNode({
    id: "node_shadow_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const localNode = createCanvasNode({
    id: "node_shadow_local",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const serverDoc = { nodes: [serverNode], edges: [], groups: [] };
  const shadowDoc = { nodes: [serverNode, localNode], edges: [], groups: [] };
  const queued = enqueue(createOfflineQueue(2), "shadow_local_add", addNodeOp(localNode));
  const writes = [];
  const shadow = {
    available: true,
    get: async () => makeShadowRecord(shadowDoc, 2, snapshot(queued)),
    put: async (record) => {
      writes.push(structuredClone(record));
      return true;
    },
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeDocumentData(serverDoc) }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_shadow_server", "node_shadow_local"],
    "matching shadow queue is replayed into the visible document"
  );
  eq(runtime.getDebugState().pending, 1, "matching shadow queue remains pending for PATCH");
  eq(runtime.getDebugState().baseRev, 2, "matching shadow queue keeps server revision anchor");
  eq(
    writes.at(-1)?.doc.nodes.map((node) => node.id),
    ["node_shadow_server", "node_shadow_local"],
    "post-replay shadow write cannot overwrite local visible edits"
  );
  runtime.dispose();
}

// Pending-create durability is separate from the normal persisted shadow; a route load never
// waits on a same-realm promise chain or treats an uncommitted create as a canvas shadow.
{
  const firstNode = createCanvasNode({
    id: "node_shadow_barrier_first",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const laterNode = createCanvasNode({
    id: "node_shadow_barrier_later",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const capturedDoc = { nodes: [firstNode], edges: [], groups: [] };
  let backing = null;
  let resolveFirstPut;
  let putCalls = 0;
  let getCalls = 0;
  const shadow = {
    available: true,
    get: async () => {
      getCalls += 1;
      return backing ? structuredClone(backing) : null;
    },
    put: async (record) => {
      putCalls += 1;
      if (putCalls === 1) {
        return new Promise((resolve) => {
          resolveFirstPut = () => {
            backing = makeShadowRecord(record.doc, record.serverRev, record.queue ?? null);
            resolve(true);
          };
        });
      }
      backing = makeShadowRecord(record.doc, record.serverRev, record.queue ?? null);
      return true;
    },
    remove: async () => true,
  };
  let resolveCreate;
  const firstStore = makeStore(createEmptyCanvasDoc());
  const firstRuntime = createCanvasRuntime(
    makeRuntimeDeps({
      store: firstStore,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => CREATE_ID,
      fetch: () => new Promise((resolve) => { resolveCreate = resolve; }),
    })
  );
  firstRuntime.configure(null);
  firstStore.state.nodes = [firstNode];
  firstRuntime.handleStoreChange();
  firstStore.state.nodes = [firstNode, laterNode];
  firstRuntime.handleStoreChange();
  resolveCreate?.({
    ok: true,
    status: 201,
    json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }),
  });
  await drainMicrotasks(30);
  eq(putCalls, 0, "pre-route create never writes the normal persisted shadow");
  firstRuntime.dispose();

  const secondStore = makeStore(createEmptyCanvasDoc());
  const secondRuntime = createCanvasRuntime(
    makeRuntimeDeps({
      store: secondStore,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeDocumentData(capturedDoc, { rev: 0 }) }),
      }),
    })
  );
  secondRuntime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(getCalls, 1, "remounted writer atomically claims the current durable shadow");
  resolveFirstPut?.();
  await drainMicrotasks(40);
  eq(getCalls, 1, "obsolete same-realm write resolution cannot trigger another claim");
  eq(
    secondStore.state.nodes.map((node) => node.id),
    [firstNode.id],
    "a normal shadow cannot manufacture pre-route pending-create edits"
  );
  secondRuntime.dispose();
}

// A shadow-ahead snapshot is preserved for an explicit decision and merges load-time edits.
{
  const serverNode = createCanvasNode({
    id: "node_shadow_ahead_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const shadowNode = createCanvasNode({
    id: "node_shadow_ahead_local",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const liveNode = createCanvasNode({
    id: "node_shadow_ahead_live",
    type: "text",
    position: { x: 400, y: 0 },
  });
  const serverDoc = { nodes: [serverNode], edges: [], groups: [] };
  const shadowDoc = { nodes: [serverNode, shadowNode], edges: [], groups: [] };
  let resolveShadow;
  const writes = [];
  const notices = [];
  const shadow = {
    available: true,
    get: () => new Promise((resolve) => { resolveShadow = resolve; }),
    put: async (record) => {
      writes.push(structuredClone(record));
      return true;
    },
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      onShadowRecoveryChange: (notice) => notices.push(notice),
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(serverDoc, { rev: 2 }),
        }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  store.state.nodes = [serverNode, liveNode];
  runtime.handleStoreChange();
  resolveShadow?.(makeShadowRecord(shadowDoc, 4, null));
  await drainMicrotasks(30);
  eq(runtime.getDebugState().mode, "recovery-pending", "shadow-ahead load waits for user choice");
  eq(writes.length, 0, "shadow-ahead candidate is never overwritten before the choice");
  eq(
    notices.at(-1),
    {
      canvasId: CREATE_ID,
      serverRev: 2,
      shadowServerRev: 4,
      updatedAt: ISO,
    },
    "shadow-ahead notice exposes only bounded recovery metadata"
  );
  ok(await runtime.restoreShadowSnapshot(), "explicit shadow restore is accepted");
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_shadow_ahead_server", "node_shadow_ahead_local"],
    "takeover keeps the loading phase inert while the atomic shadow claim is pending"
  );
  eq(runtime.getDebugState().pending, 1, "restored snapshot is converted to server-anchored PATCH ops");
  ok(writes.length > 0, "accepted shadow restore writes a replacement recovery record");
  eq(notices.at(-1), null, "accepted shadow restore clears the recovery notice");
  runtime.dispose();
}

// Choosing the cloud copy intentionally replaces the stale shadow without inventing a PATCH.
{
  const serverNode = createCanvasNode({
    id: "node_shadow_discard_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const localNode = createCanvasNode({
    id: "node_shadow_discard_local",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const serverDoc = { nodes: [serverNode], edges: [], groups: [] };
  const writes = [];
  const shadow = {
    available: true,
    get: async () =>
      makeShadowRecord({ nodes: [serverNode, localNode], edges: [], groups: [] }, 5, null),
    put: async (record) => {
      writes.push(structuredClone(record));
      return true;
    },
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeDocumentData(serverDoc, { rev: 2 }) }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  ok(await runtime.discardShadowSnapshot(), "explicit cloud-copy choice is accepted");
  eq(runtime.getDebugState().mode, "persisted", "discard resumes the persisted runtime");
  eq(runtime.getDebugState().pending, 0, "discard creates no synthetic document operations");
  eq(
    writes.at(-1)?.doc.nodes.map((node) => node.id),
    ["node_shadow_discard_server"],
    "discard replaces the ahead shadow with the chosen server document"
  );
  runtime.dispose();
}

// A damaged cloud document must not deadlock an explicit keep-cloud decision.
{
  const serverNode = createCanvasNode({
    id: "node_recovery_required_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const localNode = createCanvasNode({
    id: "node_recovery_required_local",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const removals = [];
  const recoveryWrites = [];
  const shadow = {
    available: true,
    get: async () =>
      makeShadowRecord({ nodes: [serverNode, localNode], edges: [], groups: [] }, 5, null),
    put: async (record) => {
      recoveryWrites.push(structuredClone(record));
      return true;
    },
    remove: async (canvasId) => {
      removals.push(canvasId);
      return true;
    },
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(
            { nodes: [serverNode], edges: [], groups: [] },
            {
              rev: 2,
              recovery: {
                brokenNodes: [],
                brokenEdges: [],
                migratedFrom: 1,
                targetSchemaVersion: 1,
                migrationComplete: true,
                recoveryRequired: true,
                issues: ["stored deps require explicit recovery"],
              },
            }
          ),
        }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(runtime.getDebugState().mode, "recovery-pending", "damaged cloud recovery still presents an explicit choice");
  ok(await runtime.discardShadowSnapshot(), "recoveryRequired keep-cloud choice remains actionable");
  eq(runtime.getDebugState().mode, "persisted", "keep-cloud choice leaves snapshot decision mode");
  eq(removals, [], "keep-cloud never tombstones the only durable recovery intent");
  eq(
    recoveryWrites.at(-1)?.doc.nodes.map((node) => node.id),
    [serverNode.id],
    "keep-cloud durably replaces the candidate before leaving the recovery banner"
  );
  runtime.dispose();
}

// A clean local recovery of damaged cloud metadata must use one explicit PUT, never PATCH.
{
  const repairedNode = createCanvasNode({
    id: "node_explicit_repair",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const repairedDoc = { nodes: [repairedNode], edges: [], groups: [] };
  const repairedDeps = createEmptyCanvasDeps();
  const scheduler = makeScheduler();
  const requests = [];
  let resolveRepair;
  const store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev, deps }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRev,
            writerTag: "writer_repair_1234",
            confirmRecovery: true,
            doc: repairedDoc,
            deps,
          }),
        },
      },
      warning: null,
    }),
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        requests.push(init);
        if (init.method === "PUT") {
          return new Promise((resolve) => {
            resolveRepair = resolve;
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData(repairedDoc, {
              rev: 2,
              envelope: { schemaVersion: 1, doc: repairedDoc, deps: repairedDeps },
              recovery: {
                brokenNodes: [],
                brokenEdges: [],
                migratedFrom: 1,
                targetSchemaVersion: 1,
                migrationComplete: true,
                recoveryRequired: true,
                issues: ["stored deps are invalid"],
              },
            }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(runtime.getDebugState().repairRequired, true, "damaged cloud keeps a durable repair requirement");
  eq(runtime.getDebugState().mode, "persisted", "manual cleanup remains interactive before confirmation");
  eq(requests.filter((request) => request.method === "PUT").length, 0, "recoveryRequired local state sends no repair PUT");

  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  eq(runtime.getDebugState().mode, "repairing", "confirmed clean recovery becomes inert until PUT succeeds");
  const repairTask = [...scheduler.tasks.values()][0];
  scheduler.tasks.clear();
  repairTask.handler();
  await drainMicrotasks(30);
  eq(requests.filter((request) => request.method === "PUT").length, 1, "clean recovery starts exactly one PUT");
  eq(requests.filter((request) => request.method === "PATCH").length, 0, "damaged cloud recovery never falls through to PATCH");
  const repairBody = JSON.parse(requests.find((request) => request.method === "PUT").body);
  eq(repairBody.confirmRecovery, true, "repair PUT carries explicit user confirmation");
  eq(repairBody.baseRev, 2, "repair PUT uses the exact loaded server revision");

  resolveRepair({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: makeRepairData(repairedDoc, repairedDeps) }),
  });
  await drainMicrotasks(50);
  eq(runtime.getDebugState().mode, "persisted", "trusted repair success resumes persisted interaction");
  eq(runtime.getDebugState().repairRequired, false, "trusted repair success clears server repair requirement");
  eq(runtime.getDebugState().baseRev, 3, "repair success advances the exact revision once");
  runtime.dispose();
}

// A hostile repair success with the expected revision but substituted deps cannot clear recovery.
{
  const repairedDoc = createEmptyCanvasDoc();
  const substitutedDeps = { ...createEmptyCanvasDeps(), models: ["substituted_model"] };
  const scheduler = makeScheduler();
  const store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: { method: "PUT", body: JSON.stringify({ baseRev }) },
      },
      warning: null,
    }),
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) =>
        init.method === "PUT"
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                data: makeRepairData(repairedDoc, substitutedDeps, { rev: 3 }),
              }),
            }
          : {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                data: makeDocumentData(repairedDoc, {
                  rev: 2,
                  recovery: {
                    brokenNodes: [], brokenEdges: [], migratedFrom: 1,
                    targetSchemaVersion: 1, migrationComplete: true,
                    recoveryRequired: true, issues: ["damaged"],
                  },
                }),
              }),
            },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const task = [...scheduler.tasks.values()][0];
  scheduler.tasks.clear();
  task.handler();
  await drainMicrotasks(40);
  eq(runtime.getDebugState().conflicted, true, "hostile repair success fails closed");
  eq(runtime.getDebugState().repairRequired, true, "hostile repair success cannot clear recovery");
  eq(runtime.getDebugState().baseRev, 2, "hostile repair success cannot advance revision");
  runtime.dispose();
}

// A late repair response after navigation/auth teardown cannot affect the replacement session.
{
  const scheduler = makeScheduler();
  let resolveOldRepair;
  const store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev }) => ({
      ok: true,
      request: { url: `/api/canvas/${CREATE_ID}`, init: { method: "PUT", body: JSON.stringify({ baseRev }) } },
      warning: null,
    }),
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      uuid: () => OTHER_ID,
      fetch: async (url, init) => {
        if (init.method === "PUT") {
          return new Promise((resolve) => { resolveOldRepair = resolve; });
        }
        const id = url.endsWith(OTHER_ID) ? OTHER_ID : CREATE_ID;
        const isOld = id === CREATE_ID;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData(createEmptyCanvasDoc(), {
              id,
              rev: isOld ? 2 : 9,
              recovery: {
                brokenNodes: [], brokenEdges: [], migratedFrom: 1,
                targetSchemaVersion: 1, migrationComplete: true,
                recoveryRequired: isOld, issues: isOld ? ["damaged"] : [],
              },
            }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const task = [...scheduler.tasks.values()][0];
  scheduler.tasks.clear();
  task.handler();
  await drainMicrotasks(20);
  runtime.configure(OTHER_ID);
  await drainMicrotasks(30);
  resolveOldRepair({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: makeRepairData(createEmptyCanvasDoc()) }),
  });
  await drainMicrotasks(40);
  eq(runtime.getDebugState().activeId, OTHER_ID, "late repair response stays fenced to its old identity");
  eq(runtime.getDebugState().baseRev, 9, "late repair response cannot overwrite replacement revision");
  eq(runtime.getDebugState().conflicted, false, "late repair response cannot poison replacement session");
  runtime.dispose();
}

// If the server advanced, replay every unacknowledged op at least once; patch ops are idempotent.
{
  const committedNode = createCanvasNode({
    id: "node_shadow_committed",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const pendingNode = createCanvasNode({
    id: "node_shadow_pending_tail",
    type: "text",
    position: { x: 200, y: 0 },
  });
  let queued = enqueue(createOfflineQueue(1), "shadow_inflight", addNodeOp(committedNode));
  queued = buildQueuePatch(queued).state;
  queued = enqueue(queued, "shadow_pending_tail", addNodeOp(pendingNode));
  const shadow = {
    available: true,
    get: async () =>
      makeShadowRecord(
        { nodes: [committedNode, pendingNode], edges: [], groups: [] },
        1,
        snapshot(queued)
      ),
    put: async () => true,
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(
            { nodes: [committedNode], edges: [], groups: [] },
            { rev: 2 }
          ),
        }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_shadow_committed", "node_shadow_pending_tail"],
    "server-ahead recovery replays only the post-flight pending tail"
  );
  eq(runtime.getDebugState().pending, 2, "all unacknowledged operations remain queued at least once");
  eq(runtime.getDebugState().baseRev, 2, "pending tail is re-anchored to fresh server rev");
  runtime.dispose();
}

// A newer server revision does not prove that this client's old inflight batch committed.
{
  const remoteNode = createCanvasNode({
    id: "node_shadow_remote_writer",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const unackedNode = createCanvasNode({
    id: "node_shadow_unacked_inflight",
    type: "text",
    position: { x: 200, y: 0 },
  });
  let queued = enqueue(createOfflineQueue(1), "shadow_unacked_inflight", addNodeOp(unackedNode));
  queued = buildQueuePatch(queued).state;
  const shadow = {
    available: true,
    get: async () =>
      makeShadowRecord(
        { nodes: [unackedNode], edges: [], groups: [] },
        1,
        snapshot(queued)
      ),
    put: async () => true,
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [remoteNode], edges: [], groups: [] }, { rev: 2 }),
        }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_shadow_remote_writer", "node_shadow_unacked_inflight"],
    "server-ahead recovery retains unproven inflight intent"
  );
  eq(runtime.getDebugState().pending, 1, "unproven inflight batch remains queued at least once");
  eq(runtime.getDebugState().baseRev, 2, "unproven inflight batch reanchors to fresh server rev");
  runtime.dispose();
}

// Edits made while shadow.get is pending must merge with, not be replaced by, recovered intent.
{
  const serverNode = createCanvasNode({
    id: "node_shadow_deferred_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const shadowNode = createCanvasNode({
    id: "node_shadow_deferred_recovered",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const liveNode = createCanvasNode({
    id: "node_shadow_deferred_live",
    type: "text",
    position: { x: 400, y: 0 },
  });
  const queued = enqueue(createOfflineQueue(2), "shadow_deferred_recovered", addNodeOp(shadowNode));
  let resolveShadow;
  const shadow = {
    available: true,
    get: () => new Promise((resolve) => { resolveShadow = resolve; }),
    put: async () => true,
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [serverNode], edges: [], groups: [] }, { rev: 2 }),
        }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(runtime.getDebugState().mode, "loading", "runtime stays loading while shadow recovery is pending");
  store.state.nodes = [serverNode, liveNode];
  runtime.handleStoreChange();
  resolveShadow(
    makeShadowRecord(
      { nodes: [serverNode, shadowNode], edges: [], groups: [] },
      2,
      snapshot(queued)
    )
  );
  await drainMicrotasks(30);
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_shadow_deferred_server", "node_shadow_deferred_recovered"],
    "deferred atomic claim keeps unready loading edits inert"
  );
  eq(runtime.getDebugState().pending, 1, "only proven recovered intent remains pending");
  runtime.dispose();
}

// Saturation must fence an inflight PATCH even when a late rebased success ignores abort.
{
  const saturatedNode = createCanvasNode({
    id: "node_queue_saturated",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const saturatedOp = addNodeOp(saturatedNode);
  const pending = Array.from({ length: 10_000 }, (_, index) => ({
    opId: `saturated_${index}`,
    seq: index + 1,
    op: saturatedOp,
  }));
  const fullQueue = {
    version: 1,
    baseRev: 2,
    seq: 10_000,
    pending,
    inflight: null,
    seen: [],
  };
  const scheduler = makeScheduler();
  let patchStarted = 0;
  let resolveIgnoredAbortPatch;
  const lateRebaseDeps = {
    models: ["model_late_rebase_must_not_adopt"],
    voices: [],
    characters: [],
    assets: [],
    recipes: [],
  };
  const lateRemoteNode = createCanvasNode({
    id: "node_queue_late_remote",
    type: "text",
    position: { x: 400, y: 0 },
  });
  let shadowRecord = makeShadowRecord(
    { nodes: [saturatedNode], edges: [], groups: [] },
    2,
    fullQueue
  );
  const shadow = {
    available: true,
    get: async () => structuredClone(shadowRecord),
    put: async (record) => {
      shadowRecord = {
        version: 1,
        schemaVersion: 1,
        updatedAt: ISO,
        ...structuredClone(record),
      };
      return true;
    },
  };
  const notifications = [];
  const runtimeStates = [];
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      scheduler,
      notifyApiError: (body) => notifications.push(body),
      onRuntimeStateChange: (state) => runtimeStates.push(state),
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method === "PATCH") {
          patchStarted += 1;
          return new Promise((resolve) => {
            resolveIgnoredAbortPatch = resolve;
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData(createEmptyCanvasDoc(), { rev: 2 }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(runtime.getDebugState().pending, 10_000, "full shadow queue restores at exact cap");
  const flushTask = [...scheduler.tasks.values()][0];
  scheduler.tasks.clear();
  flushTask.handler();
  await drainMicrotasks();
  eq(patchStarted, 1, "full queue enters one PATCH");
  eq(runtime.getDebugState().inflight, true, "full queue is counted while PATCH is inflight");
  store.state.nodes = [
    saturatedNode,
    createCanvasNode({
      id: "node_after_queue_cap",
      type: "text",
      position: { x: 200, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  await drainMicrotasks(60);
  eq(
    runtime.getDebugState().pending,
    10_000,
    "queue cap rejects the uncovered delta but requeues the full inflight batch"
  );
  eq(runtime.getDebugState().conflicted, true, "queue cap pauses autosave fail-closed");
  eq(notifications.length, 1, "queue cap surfaces one user-visible failure");
  runtime.handleStoreChange();
  eq(notifications.length, 1, "conflicted queue does not spam repeated failures");
  await drainMicrotasks(30);
  eq(runtimeStates.at(-1)?.interactionReady, false, "queue-cap conflict disables document interaction");
  eq(runtimeStates.at(-1)?.issue?.code, "conflicted", "queue-cap conflict exposes a stable UI issue code");
  eq(
    shadowRecord.doc.nodes.map((node) => node.id),
    ["node_queue_saturated", "node_after_queue_cap"],
    "queue-cap shadow durably preserves the edit rejected from the transport queue"
  );
  eq(
    shadowRecord.snapshotRecoveryRequired,
    true,
    "queue-cap shadow records that its document contains intent not covered by the transport queue"
  );
  ok(typeof resolveIgnoredAbortPatch === "function", "queue-cap PATCH exposes its ignored-abort resolver");
  resolveIgnoredAbortPatch?.({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: makePatchData({
        rev: 4,
        rebased: true,
        appliedOps: 10_000,
        noopOps: 0,
        envelope: {
          schemaVersion: 1,
          doc: { nodes: [lateRemoteNode, saturatedNode], edges: [], groups: [] },
          deps: lateRebaseDeps,
          rev: 4,
          docBytes: 64,
        },
      }),
    }),
  });
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    ["node_queue_saturated", "node_after_queue_cap"],
    "late ignored-abort rebase cannot replace the live queue-cap tail"
  );
  eq(
    shadowRecord.doc.nodes.map((node) => node.id),
    ["node_queue_saturated", "node_after_queue_cap"],
    "latest shadow still contains the uncovered tail after the late rebase"
  );
  eq(
    shadowRecord.snapshotRecoveryRequired,
    true,
    "late rebase cannot clear the shadow recovery marker"
  );
  eq(runtime.getDebugState().conflicted, true, "late rebase leaves the queue-cap runtime conflicted");
  eq(runtime.getDebugState().baseRev, 2, "late rebase cannot advance the queue base revision");
  eq(shadowRecord.serverRev, 2, "late rebase cannot advance the shadow revision anchor");
  eq(
    shadowRecord.deps,
    createEmptyCanvasDeps(),
    "late rebase cannot adopt substituted dependency metadata"
  );
  eq(runtime.getDebugState().pending, 10_000, "overflow synchronously requeues the full inflight batch");
  eq(runtime.getDebugState().inflight, false, "overflow releases the fenced inflight batch");
  eq(shadowRecord.queue?.pending.length, 10_000, "latest shadow contains the requeued inflight batch");
  eq(shadowRecord.queue?.inflight, null, "latest shadow has no stale inflight token");
  runtime.handleOnline();
  await drainMicrotasks();
  eq(patchStarted, 1, "conflicted queue never starts a second PATCH after the late rebase");
  runtime.dispose();

  const remountStore = makeStore(createEmptyCanvasDoc());
  const recoveryNotices = [];
  const remounted = createCanvasRuntime(
    makeRuntimeDeps({
      store: remountStore,
      intentStore: makeIntentStore(),
      shadow,
      onShadowRecoveryChange: (notice) => recoveryNotices.push(notice),
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(createEmptyCanvasDoc(), { rev: 2 }),
        }),
      }),
    })
  );
  remounted.configure(CREATE_ID);
  await drainMicrotasks(50);
  eq(remounted.getDebugState().mode, "recovery-pending", "queue-cap reload requires an explicit snapshot decision");
  eq(remountStore.state.nodes, [], "queue-cap reload never silently applies a lossy queue-only reconstruction");
  ok(recoveryNotices.at(-1) !== null, "queue-cap reload surfaces the durable tail for recovery");
  remounted.dispose();

  const serverAheadStore = makeStore(createEmptyCanvasDoc());
  const serverAheadNotices = [];
  const serverAhead = createCanvasRuntime(
    makeRuntimeDeps({
      store: serverAheadStore,
      intentStore: makeIntentStore(),
      shadow,
      onShadowRecoveryChange: (notice) => serverAheadNotices.push(notice),
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(
            { nodes: [saturatedNode], edges: [], groups: [] },
            { rev: 3 }
          ),
        }),
      }),
    })
  );
  serverAhead.configure(CREATE_ID);
  await drainMicrotasks(50);
  eq(
    serverAhead.getDebugState().mode,
    "recovery-pending",
    "server-ahead queue-cap reload cannot acknowledge away an uncovered shadow tail"
  );
  eq(
    serverAheadStore.state.nodes.map((node) => node.id),
    ["node_queue_saturated"],
    "server-ahead replay leaves the authoritative server doc visible until explicit recovery"
  );
  ok(serverAheadNotices.at(-1) !== null, "server-ahead uncovered tail remains user-recoverable");
  serverAhead.dispose();
}

// A same-ID singleton document without dirty/revision proof is only a stale cache; GET wins.
{
  const staleNode = createCanvasNode({
    id: "node_stale_same_id",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const remoteNode = createCanvasNode({
    id: "node_remote_newer_rev",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const scheduler = makeScheduler();
  const methods = [];
  const cleanCacheStore = makeIntentStore();
  cleanCacheStore.api.setSessionHandoff({
    version: 1,
    canvasId: CREATE_ID,
    doc: { nodes: [staleNode], edges: [], groups: [] },
    deps: createEmptyCanvasDeps(),
    serverRev: 1,
    queue: snapshot(createOfflineQueue(1)),
    snapshotRecoveryRequired: false,
    serverRecoveryRequired: false,
    localRecoveryRequired: false,
    updatedAt: ISO,
  });
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  store.state.nodes = [staleNode];
  store.state.sessionCanvasId = CREATE_ID;
  store.state.hydratedCanvasId = CREATE_ID;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: cleanCacheStore,
      scheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        methods.push(method);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data:
              method === "GET"
                ? makeDocumentData({ nodes: [remoteNode], edges: [], groups: [] }, { rev: 2 })
                : makePatchData(),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    [remoteNode.id],
    "fresh GET replaces an unproven same-ID singleton cache"
  );
  eq(runtime.getDebugState().pending, 0, "unproven stale cache creates no inverse pending ops");
  eq(cleanCacheStore.handoffCount(), 0, "clean handoff-shaped cache is rejected and retired");
  runtime.handleOnline();
  for (const [taskId, task] of [...scheduler.tasks.entries()]) {
    scheduler.tasks.delete(taskId);
    task.handler();
  }
  await drainMicrotasks(30);
  eq(methods, ["GET"], "unproven stale cache can never trigger a PATCH that reverts remote work");
  eq(runtime.getDebugState().mode, "persisted", "authoritative same-ID reload resumes persisted mode");
  runtime.dispose();
}

// A proven dirty handoff replays only its local ops onto a newer GET (never GET -> old doc).
{
  const serverNode = createCanvasNode({
    id: "node_handoff_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const localNode = createCanvasNode({
    id: "node_handoff_local",
    type: "text",
    position: { x: 180, y: 0 },
  });
  const remoteNode = createCanvasNode({
    id: "node_handoff_remote_newer",
    type: "text",
    position: { x: 360, y: 0 },
  });
  const sharedIntentStore = makeIntentStore();
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  const first = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [serverNode], edges: [], groups: [] }, { rev: 2 }),
        }),
      }),
    })
  );
  first.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.nodes = [serverNode, localNode];
  first.handleStoreChange();
  await drainMicrotasks(20);
  ok(!!sharedIntentStore.handoff(CREATE_ID), "dirty rev-2 edit creates a user-scoped session handoff");
  first.dispose();

  const secondScheduler = makeScheduler();
  const requests = [];
  const second = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      scheduler: secondScheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        requests.push({ method, body: typeof init.body === "string" ? init.body : null });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data:
              method === "GET"
                ? makeDocumentData(
                    { nodes: [serverNode, remoteNode], edges: [], groups: [] },
                    { rev: 3 }
                  )
                : makePatchData({ rev: 4 }),
          }),
        };
      },
    })
  );
  second.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, remoteNode.id, localNode.id],
    "newer remote node survives replay of the proven local add"
  );
  eq(second.getDebugState().baseRev, 3, "proven handoff queue reanchors to the fresh GET revision");
  eq(second.getDebugState().pending, 1, "only the proven local operation remains pending");
  const flushTask = [...secondScheduler.tasks.entries()][0];
  ok(!!flushTask, "replayed handoff schedules one PATCH");
  if (flushTask) {
    secondScheduler.tasks.delete(flushTask[0]);
    flushTask[1].handler();
  }
  await drainMicrotasks(40);
  const patchRequests = requests.filter((request) => request.method === "PATCH");
  const patchBody = patchRequests[0] ? JSON.parse(patchRequests[0].body) : null;
  eq(patchRequests.length, 1, "dirty handoff flushes exactly one PATCH");
  eq(patchBody?.baseRev, 3, "dirty handoff PATCH uses the fresh GET revision");
  eq(
    patchBody?.ops?.map((op) => `${op.op}:${op.entity}:${op.value?.id ?? op.id}`),
    [`add:node:${localNode.id}`],
    "dirty handoff PATCH contains only the local add and no remote delete"
  );
  eq(sharedIntentStore.handoffCount(), 0, "successful replay/flush retires the consumed handoff");
  second.dispose();
}

// A proven handoff that overlaps a newer remote edit fails closed instead of restoring a snapshot.
{
  const baseNode = createCanvasNode({
    id: "node_handoff_overlap",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const localNode = { ...baseNode, position: { x: 120, y: 0 } };
  const remoteNode = { ...baseNode, position: { x: 360, y: 0 } };
  const sharedIntentStore = makeIntentStore();
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: { method: "PATCH", body: JSON.stringify({ baseRev, ops }) },
      },
    }),
  });
  const first = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [baseNode], edges: [], groups: [] }, { rev: 2 }),
        }),
      }),
    })
  );
  first.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.nodes = [localNode];
  first.handleStoreChange();
  await drainMicrotasks(20);
  first.dispose();

  const secondScheduler = makeScheduler();
  const methods = [];
  const second = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      scheduler: secondScheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        methods.push(init.method ?? "GET");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData({ nodes: [remoteNode], edges: [], groups: [] }, { rev: 3 }),
          }),
        };
      },
    })
  );
  second.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(store.state.nodes[0]?.position, remoteNode.position, "overlap conflict keeps the fresh GET visible");
  eq(second.getDebugState().conflicted, true, "overlapping local/remote edits pause autosave fail-closed");
  ok(!!sharedIntentStore.handoff(CREATE_ID), "conflicting handoff remains available and is not discarded");
  second.handleOnline();
  for (const [taskId, task] of [...secondScheduler.tasks.entries()]) {
    secondScheduler.tasks.delete(taskId);
    task.handler();
  }
  await drainMicrotasks(20);
  eq(methods, ["GET"], "overlap conflict sends no PATCH or full-snapshot restore");
  second.dispose();
  ok(!!sharedIntentStore.handoff(CREATE_ID), "disposing a conflicted reload preserves the only local-intent handoff");
}

// A strict same-ID recovery document is the only copy of local edits when shadow storage is unavailable.
{
  const serverNode = createCanvasNode({
    id: "node_retained_recovery_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const retainedEdit = createCanvasNode({
    id: "node_retained_recovery_local_edit",
    type: "text",
    position: { x: 240, y: 0 },
  });
  const retainedDoc = { nodes: [serverNode, retainedEdit], edges: [], groups: [] };
  const scheduler = makeScheduler();
  const requests = [];
  let unavailableShadowCalls = 0;
  const unavailableShadow = {
    available: false,
    get: async () => {
      unavailableShadowCalls += 1;
      return null;
    },
    put: async () => {
      unavailableShadowCalls += 1;
      return false;
    },
    remove: async () => {
      unavailableShadowCalls += 1;
      return false;
    },
  };
  let store;
  store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
    prepareRepairSave: ({ baseRev, deps }) => {
      const doc = {
        nodes: store.state.nodes,
        edges: store.state.edges,
        groups: store.state.groups,
      };
      return {
        ok: true,
        request: {
          url: `/api/canvas/${CREATE_ID}`,
          init: {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseRev,
              writerTag: "writer_retained_recovery_1234",
              schemaVersion: 1,
              doc,
              deps,
              confirmRecovery: true,
            }),
          },
        },
      };
    },
  });
  const intentStore = makeIntentStore();
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      scheduler,
      shadow: unavailableShadow,
      uuid: () => OTHER_ID,
      fetch: async (url, init = {}) => {
        const method = init.method ?? "GET";
        const request = { url, method, body: typeof init.body === "string" ? init.body : null };
        requests.push(request);
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeDocumentData(
                { nodes: [serverNode], edges: [], groups: [] },
                {
                  recovery: {
                    brokenNodes: [],
                    brokenEdges: [],
                    migratedFrom: 1,
                    targetSchemaVersion: 1,
                    migrationComplete: true,
                    recoveryRequired: true,
                    issues: ["dependency metadata requires explicit recovery"],
                  },
                }
              ),
            }),
          };
        }
        if (method === "PUT") {
          const body = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: makeRepairData(body.doc, body.deps) }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData() }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id],
    "fresh recovery GET is authoritative before any proven local repair edit"
  );
  eq(store.state.recoveryRequired, true, "fresh recovery document remains explicitly gated");
  eq(runtime.getDebugState().repairRequired, true, "runtime remembers the server repair requirement");
  eq(unavailableShadowCalls, 0, "unavailable shadow storage is never treated as a recovery source");

  store.state.nodes = retainedDoc.nodes;
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  ok(!!intentStore.handoff(CREATE_ID), "recovery edit creates explicit dirty/revision handoff proof");
  runtime.handleOnline();
  for (const [taskId, task] of [...scheduler.tasks.entries()]) {
    scheduler.tasks.delete(taskId);
    task.handler();
  }
  await drainMicrotasks(20);
  eq(
    requests.map((request) => request.method),
    ["GET"],
    "recovery-gated retained document sends neither PATCH nor PUT before confirmation"
  );

  // This is the runtime boundary emitted after the store's explicit confirmSafeRecovery action.
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const repairTask = [...scheduler.tasks.entries()][0];
  ok(!!repairTask, "explicit recovery confirmation schedules one repair PUT");
  if (repairTask) {
    scheduler.tasks.delete(repairTask[0]);
    repairTask[1].handler();
  }
  await drainMicrotasks(40);
  const repairRequests = requests.filter((request) => request.method === "PUT");
  const repairBody = repairRequests[0] ? JSON.parse(repairRequests[0].body) : null;
  eq(repairRequests.length, 1, "explicit confirmation sends exactly one repair PUT");
  eq(
    requests.filter((request) => request.method === "PATCH").length,
    0,
    "same-ID recovery never leaks through PATCH"
  );
  eq(repairBody?.baseRev, 2, "repair PUT keeps the loaded recovery revision anchor");
  eq(repairBody?.confirmRecovery, true, "repair PUT carries explicit recovery confirmation");
  eq(
    repairBody?.doc?.nodes?.map((node) => node.id),
    [serverNode.id, retainedEdit.id],
    "repair PUT contains the retained local edit missing from the GET document"
  );
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, retainedEdit.id],
    "successful repair keeps the retained document visible"
  );
  runtime.dispose();
}

// A confirmed-but-uncommitted repair remains the strongest same-ID document across remount.
{
  const serverNode = createCanvasNode({
    id: "node_repair_remount_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const retainedEdit = createCanvasNode({
    id: "node_repair_remount_retained_edit",
    type: "text",
    position: { x: 260, y: 0 },
  });
  const remoteEdit = createCanvasNode({
    id: "node_repair_remount_remote_edit",
    type: "text",
    position: { x: 520, y: 0 },
  });
  const retainedDoc = { nodes: [serverNode, retainedEdit], edges: [], groups: [] };
  const unavailableShadow = {
    available: false,
    get: async () => null,
    put: async () => false,
    remove: async () => false,
  };
  const recoveryData = (doc = { nodes: [serverNode], edges: [], groups: [] }, rev = 2) =>
    makeDocumentData(
      doc,
      {
        rev,
        recovery: {
          brokenNodes: [],
          brokenEdges: [],
          migratedFrom: 1,
          targetSchemaVersion: 1,
          migrationComplete: true,
          recoveryRequired: true,
          issues: ["cloud dependency metadata still requires explicit recovery"],
        },
      }
    );
  let store;
  store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
    prepareRepairSave: ({ baseRev, deps }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRev,
            writerTag: "writer_repair_remount_1234",
            schemaVersion: 1,
            doc: {
              nodes: store.state.nodes,
              edges: store.state.edges,
              groups: store.state.groups,
            },
            deps,
            confirmRecovery: true,
          }),
        },
      },
    }),
  });
  const sharedIntentStore = makeIntentStore();
  const firstScheduler = makeScheduler();
  const firstMethods = [];
  let firstPutSignal = null;
  let resolveFirstPut;
  const first = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      scheduler: firstScheduler,
      shadow: unavailableShadow,
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        firstMethods.push(method);
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: recoveryData() }),
          };
        }
        if (method === "PUT") {
          firstPutSignal = init.signal;
          return new Promise((resolve) => {
            resolveFirstPut = resolve;
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData() }),
        };
      },
    })
  );
  first.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id],
    "initial recovery load starts from the authoritative server document"
  );
  eq(store.state.recoveryRequired, true, "initial recovery load remains confirmation-gated");

  store.state.nodes = retainedDoc.nodes;
  first.handleStoreChange();
  await drainMicrotasks(20);
  ok(!!sharedIntentStore.handoff(CREATE_ID), "recovery edit is recorded before confirmation");

  store.state.recoveryRequired = false;
  first.handleStoreChange();
  const firstRepairTask = [...firstScheduler.tasks.entries()][0];
  ok(!!firstRepairTask, "first explicit confirmation schedules repair before remount");
  if (firstRepairTask) {
    firstScheduler.tasks.delete(firstRepairTask[0]);
    firstRepairTask[1].handler();
  }
  await drainMicrotasks(30);
  eq(firstMethods, ["GET", "PUT"], "first repair PUT is genuinely deferred in transport");
  eq(store.state.recoveryRequired, false, "confirmed singleton document remains locally ungated while PUT is pending");
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, retainedEdit.id],
    "pending repair keeps the confirmed retained edit in the singleton store"
  );
  ok(typeof resolveFirstPut === "function", "deferred first repair exposes its ignored-abort resolver");
  first.dispose();
  eq(firstPutSignal?.aborted, true, "disposing the first runtime aborts its uncommitted repair PUT");

  const secondScheduler = makeScheduler();
  const secondRequests = [];
  const second = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: sharedIntentStore,
      scheduler: secondScheduler,
      shadow: unavailableShadow,
      uuid: () => OTHER_ID,
      fetch: async (url, init = {}) => {
        const method = init.method ?? "GET";
        secondRequests.push({
          url,
          method,
          body: typeof init.body === "string" ? init.body : null,
        });
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: recoveryData(
                { nodes: [serverNode, remoteEdit], edges: [], groups: [] },
                3
              ),
            }),
          };
        }
        if (method === "PUT") {
          const body = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeRepairData(body.doc, body.deps, { rev: body.baseRev + 1 }),
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData() }),
        };
      },
    })
  );
  second.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, remoteEdit.id, retainedEdit.id],
    "remount replays the confirmed local edit onto the newer recovery GET without deleting remote work"
  );
  eq(
    store.state.recoveryRequired,
    true,
    "remount reapplies the server recovery gate even though the retained singleton was locally confirmed"
  );
  eq(second.getDebugState().repairRequired, true, "remount keeps the cloud repair requirement active");
  second.handleStoreChange();
  second.handleOnline();
  for (const [taskId, task] of [...secondScheduler.tasks.entries()]) {
    secondScheduler.tasks.delete(taskId);
    task.handler();
  }
  await drainMicrotasks(20);
  eq(
    secondRequests.map((request) => request.method),
    ["GET"],
    "remounted recovery sends neither PATCH nor PUT before a new explicit confirmation"
  );
  eq(
    secondRequests.filter((request) => request.method === "PATCH").length,
    0,
    "remounted retained repair never leaks through PATCH"
  );

  store.state.recoveryRequired = false;
  second.handleStoreChange();
  const secondRepairTask = [...secondScheduler.tasks.entries()][0];
  ok(!!secondRepairTask, "second explicit confirmation schedules the remounted repair PUT");
  if (secondRepairTask) {
    secondScheduler.tasks.delete(secondRepairTask[0]);
    secondRepairTask[1].handler();
  }
  await drainMicrotasks(40);
  const secondPutRequests = secondRequests.filter((request) => request.method === "PUT");
  const secondPutBody = secondPutRequests[0] ? JSON.parse(secondPutRequests[0].body) : null;
  eq(secondPutRequests.length, 1, "remount sends exactly one PUT after the second confirmation");
  eq(
    secondRequests.filter((request) => request.method === "PATCH").length,
    0,
    "completed remount lifecycle never sends PATCH"
  );
  eq(secondPutBody?.confirmRecovery, true, "remounted PUT retains explicit recovery confirmation");
  eq(secondPutBody?.baseRev, 3, "remounted PUT uses the newer recovery GET revision");
  eq(
    secondPutBody?.doc?.nodes?.map((node) => node.id),
    [serverNode.id, remoteEdit.id, retainedEdit.id],
    "remounted repair PUT contains both the newer remote edit and proven local edit"
  );

  resolveFirstPut?.({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: makeRepairData(retainedDoc, createEmptyCanvasDeps()),
    }),
  });
  await drainMicrotasks(30);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, remoteEdit.id, retainedEdit.id],
    "late ignored-abort first PUT cannot disturb the remounted repaired document"
  );
  second.dispose();
}

// Repair stays single-flight while a successful response body is still being decoded.
{
  const serverNode = createCanvasNode({
    id: "node_repair_json_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const repairedNode = createCanvasNode({
    id: "node_repair_json_local",
    type: "text",
    position: { x: 220, y: 0 },
  });
  const repairedDoc = { nodes: [serverNode, repairedNode], edges: [], groups: [] };
  const scheduler = makeScheduler();
  let store;
  store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev, deps }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRev,
            writerTag: "writer_repair_json_1234",
            confirmRecovery: true,
            doc: {
              nodes: store.state.nodes,
              edges: store.state.edges,
              groups: store.state.groups,
            },
            deps,
          }),
        },
      },
    }),
  });
  let putCalls = 0;
  let resolveFirstJson;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeDocumentData(
                { nodes: [serverNode], edges: [], groups: [] },
                {
                  rev: 2,
                  recovery: {
                    brokenNodes: [],
                    brokenEdges: [],
                    migratedFrom: 1,
                    targetSchemaVersion: 1,
                    migrationComplete: true,
                    recoveryRequired: true,
                    issues: ["repair JSON single-flight fixture"],
                  },
                }
              ),
            }),
          };
        }
        if (method === "PUT") {
          putCalls += 1;
          if (putCalls === 1) {
            return {
              ok: true,
              status: 200,
              json: () =>
                new Promise((resolve) => {
                  resolveFirstJson = resolve;
                }),
            };
          }
          return {
            ok: false,
            status: 409,
            json: async () => ({
              success: false,
              code: "CANVAS_DOC_INVALID",
              error: "the first PUT already repaired the row",
            }),
          };
        }
        throw new Error(`unexpected ${method}`);
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.nodes = repairedDoc.nodes;
  runtime.handleStoreChange();
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const repairTask = [...scheduler.tasks.entries()][0];
  ok(!!repairTask, "explicit confirmation schedules the delayed-JSON repair PUT");
  if (repairTask) {
    scheduler.tasks.delete(repairTask[0]);
    repairTask[1].handler();
  }
  await drainMicrotasks(30);
  eq(putCalls, 1, "first repair PUT reaches response.json exactly once");
  ok(typeof resolveFirstJson === "function", "first repair exposes a deferred JSON resolver");

  runtime.handleOnline();
  await drainMicrotasks(30);
  eq(
    putCalls,
    1,
    "online during delayed repair JSON cannot start a second PUT with the same baseRev"
  );

  let decodeReentered = false;
  const trustedRepairBody = {
    success: true,
    data: makeRepairData(repairedDoc, createEmptyCanvasDeps()),
  };
  const reentrantRepairBody = new Proxy(trustedRepairBody, {
    getOwnPropertyDescriptor(target, key) {
      if (!decodeReentered) {
        decodeReentered = true;
        runtime.handleOnline();
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  resolveFirstJson?.(reentrantRepairBody);
  await drainMicrotasks(40);
  ok(decodeReentered, "repair decoder executes the synchronous online-reentry descriptor trap");
  eq(runtime.getDebugState().mode, "persisted", "the original successful repair settles normally");
  eq(runtime.getDebugState().baseRev, 3, "the original repair advances the authoritative revision");
  eq(runtime.getDebugState().conflicted, false, "delayed JSON never creates a false repair conflict");
  eq(putCalls, 1, "delayed JSON and decoder reentry still produce exactly one repair PUT");
  runtime.dispose();
}

// A WRITER_LOCKED retry is not consumed while the error snapshot is waiting on slow IndexedDB.
{
  const serverNode = createCanvasNode({
    id: "node_repair_slow_shadow_server",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const repairedNode = createCanvasNode({
    id: "node_repair_slow_shadow_local",
    type: "text",
    position: { x: 240, y: 0 },
  });
  const repairedDoc = { nodes: [serverNode, repairedNode], edges: [], groups: [] };
  const scheduler = makeScheduler();
  let blockNextShadow = false;
  let resolveBlockedShadow;
  const shadow = {
    available: true,
    get: async () => null,
    put: async () => {
      if (!blockNextShadow) return true;
      blockNextShadow = false;
      return new Promise((resolve) => {
        resolveBlockedShadow = resolve;
      });
    },
    remove: async () => true,
  };
  let store;
  store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev, deps }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRev,
            writerTag: "writer_repair_slow_shadow_1234",
            confirmRecovery: true,
            doc: {
              nodes: store.state.nodes,
              edges: store.state.edges,
              groups: store.state.groups,
            },
            deps,
          }),
        },
      },
    }),
  });
  let putCalls = 0;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      shadow,
      shadowWriteScope: "repair-slow-shadow-user",
      uuid: () => OTHER_ID,
      fetch: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeDocumentData(
                { nodes: [serverNode], edges: [], groups: [] },
                {
                  rev: 2,
                  recovery: {
                    brokenNodes: [],
                    brokenEdges: [],
                    migratedFrom: 1,
                    targetSchemaVersion: 1,
                    migrationComplete: true,
                    recoveryRequired: true,
                    issues: ["slow shadow retry fixture"],
                  },
                }
              ),
            }),
          };
        }
        if (method === "PUT") {
          putCalls += 1;
          const submitted = JSON.parse(init.body);
          if (putCalls === 1) {
            blockNextShadow = true;
            return {
              ok: false,
              status: 409,
              json: async () => ({
                success: false,
                code: "WRITER_LOCKED",
                error: "retry after lease reacquisition",
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeRepairData(submitted.doc, submitted.deps),
            }),
          };
        }
        throw new Error(`unexpected ${method}`);
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(40);
  store.state.nodes = repairedDoc.nodes;
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const initialRepair = [...scheduler.tasks.entries()][0];
  ok(!!initialRepair, "slow-shadow fixture schedules its first repair PUT");
  if (initialRepair) {
    scheduler.tasks.delete(initialRepair[0]);
    initialRepair[1].handler();
  }
  await drainMicrotasks(50);
  eq(putCalls, 1, "first slow-shadow repair receives WRITER_LOCKED");
  ok(typeof resolveBlockedShadow === "function", "WRITER_LOCKED persistence is genuinely blocked");
  const retryTask = [...scheduler.tasks.entries()][0];
  ok(!!retryTask, "WRITER_LOCKED schedules one retry while shadow persistence is blocked");
  if (retryTask) {
    scheduler.tasks.delete(retryTask[0]);
    retryTask[1].handler();
  }
  await drainMicrotasks(30);
  eq(putCalls, 1, "retry waits behind the slow shadow barrier instead of being discarded as busy");
  resolveBlockedShadow?.(true);
  await drainMicrotasks(80);
  eq(putCalls, 2, "released shadow barrier lets the already-fired retry send its second PUT");
  eq(runtime.getDebugState().mode, "persisted", "slow-shadow writer retry converges after success");
  eq(runtime.getDebugState().repairRequired, false, "slow-shadow retry clears the server repair gate");
  eq(runtime.getDebugState().baseRev, 3, "slow-shadow retry advances the repair revision exactly once");
  runtime.dispose();
}

// Reconnect during a pending load must not start a second GET that can resolve out of order.
{
  const requests = [];
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: () => new Promise((resolve) => requests.push(resolve)),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  runtime.handleOnline();
  await drainMicrotasks();
  eq(requests.length, 1, "online event does not duplicate an active GET");
  requests[0]({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: makeDocumentData(createEmptyCanvasDoc()) }),
  });
  await drainMicrotasks(30);
  eq(store.hydrations(), 1, "single GET hydrates exactly once after reconnect");
  runtime.dispose();
}

// The single-flight load lock covers shadow recovery, not only fetch/JSON parsing.
{
  let fetchCalls = 0;
  let resolveShadow;
  const shadow = {
    available: true,
    get: () => new Promise((resolve) => { resolveShadow = resolve; }),
    put: async () => true,
  };
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      shadow,
      uuid: () => OTHER_ID,
      fetch: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeDocumentData(createEmptyCanvasDoc()) }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(runtime.getDebugState().mode, "loading", "load remains active during shadow.get");
  runtime.handleOnline();
  await drainMicrotasks();
  eq(fetchCalls, 0, "fresh GET waits for the atomic shadow claim and online cannot duplicate it");
  resolveShadow(null);
  await drainMicrotasks(30);
  eq(fetchCalls, 1, "one fresh GET follows the completed shadow claim");
  eq(runtime.getDebugState().mode, "persisted", "load completes after shadow recovery");
  runtime.dispose();
}

// Runtime no longer relies on a realm-local global promise chain; cross-realm ordering belongs
// to Shadow v2 CAS (covered by the adversarial shared-store fixtures below).
{
  const firstNode = createCanvasNode({
    id: "node_shadow_write_first",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const secondNode = createCanvasNode({
    id: "node_shadow_write_second",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const writes = [];
  const resolvers = [];
  const shadow = {
    available: true,
    get: async () => null,
    put: (record) => {
      writes.push(structuredClone(record));
      return new Promise((resolve) => resolvers.push(resolve));
    },
  };
  const makeLoadRuntime = (doc) => {
    const store = makeStore(createEmptyCanvasDoc());
    const runtime = createCanvasRuntime(
      makeRuntimeDeps({
        store,
        intentStore: makeIntentStore(),
        shadow,
        shadowWriteScope: "shadow-write-order-user",
        uuid: () => OTHER_ID,
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeDocumentData(doc) }),
        }),
      })
    );
    runtime.configure(CREATE_ID);
    return runtime;
  };
  const first = makeLoadRuntime({ nodes: [firstNode], edges: [], groups: [] });
  await drainMicrotasks(30);
  eq(writes.length, 1, "first runtime starts the first shadow write");
  first.dispose();
  const second = makeLoadRuntime({ nodes: [secondNode], edges: [], groups: [] });
  await drainMicrotasks(30);
  eq(writes.length, 2, "remounted runtime does not depend on an obsolete realm-local barrier");
  resolvers[0](true);
  await drainMicrotasks(30);
  eq(writes.length, 2, "late older realm completion cannot enqueue a third write");
  eq(
    writes[1].doc.nodes.map((node) => node.id),
    ["node_shadow_write_second"],
    "newer remount record is the final ordered shadow write"
  );
  resolvers[1](true);
  await drainMicrotasks();
  second.dispose();
}

// Remount/retry must reuse the exact original id and detached captured document.
{
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  const shadowRecords = [];
  const shadow = {
    available: true,
    get: async () => null,
    put: async (record) => {
      shadowRecords.push(structuredClone(record));
      return true;
    },
  };
  const calls = [];
  const fetch = (url, init) =>
    new Promise((resolve) => {
      calls.push({ url, init, resolve });
    });
  const first = createCanvasRuntime(
    makeRuntimeDeps({
      runtime: runtimeModule,
      store,
      intentStore,
      fetch,
      uuid: () => CREATE_ID,
    })
  );

  first.configure(null);
  const firstNode = createCanvasNode({
    id: "node_b1_first",
    type: "text",
    position: { x: 0, y: 0 },
  });
  store.state.nodes = [firstNode];
  first.handleStoreChange();
  eq(calls.length, 1, "first durable edit starts one create request");
  const firstBody = JSON.parse(calls[0].init.body);
  eq(firstBody.id, CREATE_ID, "first create uses generated stable id");
  eq(firstBody.doc.nodes.map((node) => node.id), ["node_b1_first"], "first create captures doc");

  first.dispose();
  const secondNode = createCanvasNode({
    id: "node_b1_during_post",
    type: "text",
    position: { x: 200, y: 80 },
  });
  store.state.nodes = [firstNode, secondNode];

  let unexpectedUuidCalls = 0;
  const second = createCanvasRuntime(
    makeRuntimeDeps({
      runtime: runtimeModule,
      store,
      intentStore,
      fetch,
      uuid: () => {
        unexpectedUuidCalls += 1;
        return OTHER_ID;
      },
      shadow,
    })
  );
  second.configure(null);
  await drainMicrotasks(30);
  eq(calls.length, 2, "remount retries the pending create");
  const secondBody = JSON.parse(calls[1].init.body);
  eq(secondBody, firstBody, "remount posts the exact original id and captured doc");
  eq(unexpectedUuidCalls, 0, "remount does not generate a replacement id");
  eq(intentStore.setCount(), 1, "shared intent is written once across runtimes");

  calls[1].resolve({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }),
  });
  await drainMicrotasks();

  eq(store.promotions(), 1, "exact successful response promotes once");
  eq(second.getDebugState().activeId, CREATE_ID, "promoted runtime adopts exact id");
  eq(second.getDebugState().pending, 1, "edit made during create remains queued");
  eq(shadowRecords.length, 0, "pre-route create never aliases pending intent into normal shadow");
  eq(intentStore.current(), null, "exact promoted intent is cleared");
  eq(intentStore.clearCount(), 1, "intent is cleared exactly once after promotion");
  second.dispose();
}

// Leaving unresolved local A for persisted B retires A before a fresh local C can reuse it.
{
  const freshId = "33333333-3333-4333-8333-333333333333";
  const intentStore = makeIntentStore();
  const nodeA = createCanvasNode({
    id: "node_abandoned_create_a",
    type: "text",
    position: { x: 0, y: 0 },
  });
  const nodeB = createCanvasNode({
    id: "node_persisted_b",
    type: "text",
    position: { x: 200, y: 0 },
  });
  const nodeC = createCanvasNode({
    id: "node_fresh_local_c",
    type: "text",
    position: { x: 400, y: 0 },
  });

  const storeA = makeStore(createEmptyCanvasDoc());
  let resolveLateA;
  let bodyA = null;
  const runtimeA = createCanvasRuntime(
    makeRuntimeDeps({
      store: storeA,
      intentStore,
      shadow: null,
      uuid: () => CREATE_ID,
      fetch: async (_url, init) => {
        bodyA = JSON.parse(init.body);
        return new Promise((resolve) => {
          resolveLateA = resolve;
        });
      },
    })
  );
  runtimeA.configure(null);
  storeA.state.nodes = [nodeA];
  runtimeA.handleStoreChange();
  await drainMicrotasks();
  eq(bodyA, { id: CREATE_ID, doc: { nodes: [nodeA], edges: [], groups: [] } }, "local A POST captures exact A intent");
  eq(intentStore.current()?.id, CREATE_ID, "unresolved local A leaves one retryable shared intent");
  runtimeA.dispose();

  const storeB = makeStore(createEmptyCanvasDoc());
  const runtimeB = createCanvasRuntime(
    makeRuntimeDeps({
      store: storeB,
      intentStore,
      shadow: null,
      uuid: () => freshId,
      fetch: async (_url, init) => {
        if (init?.method !== "GET") throw new Error("persisted B must only issue GET");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makeDocumentData(
              { nodes: [nodeB], edges: [], groups: [] },
              { id: OTHER_ID }
            ),
          }),
        };
      },
    })
  );
  runtimeB.configure(OTHER_ID);
  eq(intentStore.current(), null, "entering persisted B synchronously retires abandoned A intent");
  eq(intentStore.clearCount(), 1, "persisted B clears abandoned A exactly once");
  await drainMicrotasks(30);
  eq(runtimeB.getDebugState().mode, "persisted", "fresh runtime loads persisted B after retiring A");
  eq(storeB.state.nodes.map((node) => node.id), [nodeB.id], "persisted B hydrates only B data");
  runtimeB.dispose();

  const storeC = makeStore(createEmptyCanvasDoc());
  let bodyC = null;
  let postCallsC = 0;
  const runtimeC = createCanvasRuntime(
    makeRuntimeDeps({
      store: storeC,
      intentStore,
      shadow: null,
      uuid: () => freshId,
      fetch: async (_url, init) => {
        if (init?.method !== "POST") throw new Error("fresh local C must only issue POST");
        postCallsC += 1;
        bodyC = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { id: freshId, rev: 0 } }),
        };
      },
    })
  );
  runtimeC.configure(null);
  storeC.state.nodes = [nodeC];
  runtimeC.handleStoreChange();
  await drainMicrotasks(30);
  eq(postCallsC, 1, "fresh local C starts exactly one create POST");
  eq(
    bodyC,
    { id: freshId, doc: { nodes: [nodeC], edges: [], groups: [] } },
    "fresh local C receives a new UUID and posts exact C data with no A or B content"
  );
  eq(storeC.promotions(), 1, "fresh local C promotes exactly once");
  eq(runtimeC.getDebugState().activeId, freshId, "fresh local C owns only its new persisted identity");
  eq(intentStore.current(), null, "successful C promotion retires the fresh C intent");
  eq(intentStore.clearCount(), 2, "shared store records one A retirement and one C commit retirement");

  ok(typeof resolveLateA === "function", "unresolved A transport exposes its late resolver");
  resolveLateA?.({
    ok: true,
    status: 201,
    json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }),
  });
  await drainMicrotasks(30);
  eq(storeA.promotions(), 0, "late A success is inert after A was abandoned");
  eq(storeA.state.nodes.map((node) => node.id), [nodeA.id], "late A cannot rewrite abandoned local A state");
  eq(storeB.state.nodes.map((node) => node.id), [nodeB.id], "late A cannot rewrite persisted B state");
  eq(storeC.state.nodes.map((node) => node.id), [nodeC.id], "late A cannot rewrite fresh C state");
  eq(storeC.promotions(), 1, "late A cannot promote C a second time");
  eq(runtimeC.getDebugState().activeId, freshId, "late A cannot replace C's active identity");
  eq(intentStore.current(), null, "late A cannot resurrect its retired shared intent");
  runtimeC.dispose();
}

async function verifyRejectedCreateData(dataFactory, label) {
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  const runtimeStates = [];
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      runtime: runtimeModule,
      store,
      intentStore,
      uuid: () => CREATE_ID,
      onRuntimeStateChange: (state) => runtimeStates.push(state),
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: dataFactory() }),
      }),
    })
  );
  runtime.configure(null);
  store.state.nodes = [
    createCanvasNode({
      id: `node_${label.replaceAll(/[^a-z0-9]/gi, "_")}`,
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  await drainMicrotasks();
  eq(store.promotions(), 0, `${label}: no promotion`);
  eq(intentStore.clearCount(), 0, `${label}: intent is not cleared`);
  ok(intentStore.current() !== null, `${label}: retry intent remains available`);
  eq(runtime.getDebugState().mode, "failed", `${label}: runtime fails closed`);
  eq(runtimeStates.at(-1)?.interactionReady, false, `${label}: failed runtime disables document interaction`);
  eq(runtimeStates.at(-1)?.issue?.code, "failed", `${label}: failed runtime publishes a stable issue code`);
  runtime.dispose();
}

let hostileGetterReads = 0;
await verifyRejectedCreateData(() => {
  const data = {};
  Object.defineProperty(data, "id", {
    enumerable: true,
    get() {
      hostileGetterReads += 1;
      return CREATE_ID;
    },
  });
  Object.defineProperty(data, "rev", { enumerable: true, value: 0 });
  return data;
}, "accessor response");
eq(hostileGetterReads, 0, "descriptor-safe decoder never invokes hostile id getter");

await verifyRejectedCreateData(
  () => ({ id: OTHER_ID, rev: 0 }),
  "mismatched response id"
);
await verifyRejectedCreateData(
  () => ({ id: CREATE_ID, rev: -1 }),
  "negative response rev"
);
await verifyRejectedCreateData(
  () => ({ id: CREATE_ID, rev: 1.5 }),
  "fractional response rev"
);
await verifyRejectedCreateData(
  () => ({ id: CREATE_ID, rev: 1 }),
  "positive response rev"
);

async function verifyRejectedLoad(dataFactory, label) {
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      uuid: () => OTHER_ID,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: dataFactory(empty) }),
      }),
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(store.hydrations(), 0, `${label}: malformed GET never hydrates`);
  eq(runtime.getDebugState().mode, "failed", `${label}: malformed GET fails closed`);
  runtime.dispose();
}

await verifyRejectedLoad(
  (doc) => makeDocumentData(doc, { id: OTHER_ID }),
  "mismatched GET id"
);

let getIdAccessorReads = 0;
await verifyRejectedLoad((doc) => {
  const data = makeDocumentData(doc);
  Object.defineProperty(data, "id", {
    enumerable: true,
    get() {
      getIdAccessorReads += 1;
      return CREATE_ID;
    },
  });
  return data;
}, "GET id accessor");
eq(getIdAccessorReads, 0, "GET decoder never invokes hostile id getter");

let getDocAccessorReads = 0;
await verifyRejectedLoad((doc) => {
  const data = makeDocumentData(doc);
  Object.defineProperty(data.envelope, "doc", {
    enumerable: true,
    get() {
      getDocAccessorReads += 1;
      return doc;
    },
  });
  return data;
}, "GET doc accessor");
eq(getDocAccessorReads, 0, "GET decoder never invokes hostile envelope getter");

let getIssueAccessorReads = 0;
await verifyRejectedLoad((doc) => {
  const data = makeDocumentData(doc);
  Object.defineProperty(data.recovery.issues, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getIssueAccessorReads += 1;
      return "hostile issue";
    },
  });
  data.recovery.issues.length = 1;
  return data;
}, "GET nested issue accessor");
eq(getIssueAccessorReads, 0, "GET decoder never invokes nested array getter");

await verifyRejectedLoad((doc) => {
  const data = makeDocumentData(doc);
  data.recovery.brokenNodes = [{ id: "broken_without_recovery" }];
  return data;
}, "GET broken entities without recovery flag");

async function verifyPatchResponse(dataFactory, label, accepted, options = {}) {
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const intentStore = makeIntentStore();
  let preparedSaveProof;
  const store = makeStore(empty, {
    ...options,
    preparePatchSave: ({ baseRev, ops, saveProof }) => {
      preparedSaveProof = saveProof;
      return {
        ok: true,
        request: {
          url: `/api/canvas/${CREATE_ID}`,
          init: {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseRev, ops, saveProof }),
          },
        },
      };
    },
  });
  let patchCalls = 0;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      scheduler,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makeDocumentData(empty, {
                ...(options.loadSaveProof ? { saveProof: options.loadSaveProof } : {}),
              }),
            }),
          };
        }
        patchCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: dataFactory(store.state) }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(runtime.getDebugState().mode, "persisted", `${label}: valid GET enters persisted mode`);
  store.state.nodes = [
    createCanvasNode({
      id: `node_patch_${label.replaceAll(/[^a-z0-9]/gi, "_")}`,
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  const scheduled = [...scheduler.tasks.entries()][0];
  ok(!!scheduled, `${label}: edit schedules PATCH flush`);
  if (scheduled) {
    scheduler.tasks.delete(scheduled[0]);
    scheduled[1].handler();
  }
  await drainMicrotasks();
  eq(patchCalls, 1, `${label}: one PATCH reaches transport`);
  if (Object.prototype.hasOwnProperty.call(options, "expectedPreparedSaveProof")) {
    eq(
      preparedSaveProof,
      options.expectedPreparedSaveProof,
      `${label}: exact GET proof is forwarded to save preparation`
    );
  }
  eq(runtime.getDebugState().conflicted, !accepted, `${label}: conflict state matches decode`);
  eq(runtime.getDebugState().pending, accepted ? 0 : 1, `${label}: local op is not lost`);
  eq(
    runtime.getDebugState().baseRev,
    accepted ? options.expectedBaseRev ?? 3 : 2,
    `${label}: rev advances only on valid ack`
  );
  if (options.expectedNodeIds) {
    eq(
      store.state.nodes.map((node) => node.id),
      options.expectedNodeIds,
      `${label}: adopted document matches expectation`
    );
  }
  runtime.dispose();
}

await verifyPatchResponse(
  () => makePatchData({ saveProof: "N".repeat(43) }),
  "valid PATCH response with save proof",
  true,
  {
    loadSaveProof: "P".repeat(43),
    expectedPreparedSaveProof: "P".repeat(43),
  }
);
await verifyPatchResponse(
  () => makePatchData({ saveProof: "invalid" }),
  "malformed PATCH save proof",
  false
);
await verifyPatchResponse(
  () => makePatchData({ id: OTHER_ID }),
  "mismatched PATCH id",
  false
);

let patchRevAccessorReads = 0;
await verifyPatchResponse(() => {
  const data = makePatchData();
  Object.defineProperty(data, "rev", {
    enumerable: true,
    get() {
      patchRevAccessorReads += 1;
      return 3;
    },
  });
  return data;
}, "PATCH rev accessor", false);
eq(patchRevAccessorReads, 0, "PATCH decoder never invokes hostile rev getter");

await verifyPatchResponse(
  () => makePatchData({ rev: 1 }),
  "regressing PATCH rev",
  false
);
await verifyPatchResponse(
  () => makePatchData({ rev: 99 }),
  "non-rebased PATCH revision jump",
  false
);
await verifyPatchResponse(
  () => makePatchData({ rev: 2 }),
  "persisted PATCH without revision advance",
  false
);
await verifyPatchResponse(
  () => makePatchData({ rev: Number.MAX_SAFE_INTEGER + 1 }),
  "unsafe PATCH revision",
  false
);
await verifyPatchResponse(
  () => makePatchData({ appliedOps: 0, noopOps: 0 }),
  "PATCH operation count mismatch",
  false
);
await verifyPatchResponse(
  () => makePatchData({ rebased: true }),
  "rebased PATCH without envelope",
  false
);
await verifyPatchResponse(
  () =>
    makePatchData({
      rebased: true,
      envelope: {
        schemaVersion: 1,
        doc: createEmptyCanvasDoc(),
        deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
        rev: 99,
        docBytes: 64,
      },
    }),
  "rebased PATCH envelope mismatch",
  false
);

let patchEnvelopeGetterReads = 0;
await verifyPatchResponse(() => {
  const data = makePatchData({
    rev: 4,
    rebased: true,
    envelope: {
      schemaVersion: 1,
      doc: createEmptyCanvasDoc(),
      deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
      rev: 4,
      docBytes: 64,
    },
  });
  Object.defineProperty(data.envelope, "doc", {
    enumerable: true,
    get() {
      patchEnvelopeGetterReads += 1;
      return createEmptyCanvasDoc();
    },
  });
  return data;
}, "PATCH nested envelope accessor", false);
eq(patchEnvelopeGetterReads, 0, "PATCH decoder never invokes nested envelope getter");

const remoteRebaseNode = createCanvasNode({
  id: "node_remote_rebase",
  type: "text",
  position: { x: 400, y: 0 },
});
await verifyPatchResponse(
  (state) =>
    makePatchData({
      rev: 4,
      rebased: true,
      envelope: {
        schemaVersion: 1,
        doc: {
          nodes: [remoteRebaseNode, ...state.nodes],
          edges: [],
          groups: [],
        },
        deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
        rev: 4,
        docBytes: 64,
      },
    }),
  "valid rebased PATCH",
  true,
  {
    expectedBaseRev: 4,
    expectedNodeIds: ["node_remote_rebase", "node_patch_valid_rebased_PATCH"],
  }
);

await verifyPatchResponse(
  (state) =>
    makePatchData({
      rev: 4,
      rebased: true,
      envelope: {
        schemaVersion: 1,
        doc: { nodes: [...state.nodes], edges: [], groups: [] },
        deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
        rev: 4,
        docBytes: 64,
      },
    }),
  "rebased PATCH adoption failure",
  false,
  { adoptAuthoritativeDoc: () => false }
);

async function verifyPostFlightRebase({ conflict }) {
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const store = makeStore(empty, {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  let resolvePatch;
  const firstNode = createCanvasNode({
    id: `node_rebase_inflight_${conflict ? "conflict" : "ok"}`,
    type: "text",
    position: { x: 0, y: 0 },
  });
  const laterNode = createCanvasNode({
    id: `node_rebase_later_${conflict ? "conflict" : "ok"}`,
    type: "text",
    position: { x: 200, y: 0 },
  });
  const remoteNode = createCanvasNode({
    id: `node_rebase_remote_${conflict ? "conflict" : "ok"}`,
    type: "text",
    position: { x: 400, y: 0 },
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: makeDocumentData(empty) }),
          };
        }
        return new Promise((resolve) => {
          resolvePatch = resolve;
        });
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  store.state.nodes = [firstNode];
  runtime.handleStoreChange();
  const flushTask = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(flushTask[0]);
  flushTask[1].handler();
  await drainMicrotasks();
  ok(typeof resolvePatch === "function", "rebase test holds one PATCH in flight");

  store.state.nodes = [firstNode, laterNode];
  runtime.handleStoreChange();
  eq(runtime.getDebugState().pending, 1, "post-flight edit queues behind inflight PATCH");

  const authoritativeLater = conflict
    ? { ...laterNode, position: { x: 999, y: 999 } }
    : null;
  const authoritativeDoc = {
    nodes: [remoteNode, firstNode, ...(authoritativeLater ? [authoritativeLater] : [])],
    edges: [],
    groups: [],
  };
  resolvePatch({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: makePatchData({
        rev: 4,
        rebased: true,
        envelope: {
          schemaVersion: 1,
          doc: authoritativeDoc,
          deps: { models: [], voices: [], characters: [], assets: [], recipes: [] },
          rev: 4,
          docBytes: 64,
        },
      }),
    }),
  });
  await drainMicrotasks();

  if (conflict) {
    eq(runtime.getDebugState().conflicted, true, "overlapping post-flight rebase fails closed");
    eq(runtime.getDebugState().baseRev, 2, "failed rebase does not acknowledge inflight rev");
    eq(runtime.getDebugState().pending, 2, "failed rebase requeues inflight and later edit");
    eq(
      store.state.nodes.map((node) => node.id),
      [firstNode.id, laterNode.id],
      "failed rebase preserves the complete visible local document"
    );
  } else {
    eq(runtime.getDebugState().conflicted, false, "non-overlapping post-flight rebase succeeds");
    eq(runtime.getDebugState().baseRev, 4, "successful rebase advances to authoritative rev");
    eq(runtime.getDebugState().pending, 1, "successful rebase keeps only the later edit pending");
    eq(
      store.state.nodes.map((node) => node.id),
      [remoteNode.id, firstNode.id, laterNode.id],
      "successful rebase atomically adopts authoritative doc plus later edit"
    );
  }
  runtime.dispose();
}

await verifyPostFlightRebase({ conflict: false });
await verifyPostFlightRebase({ conflict: true });

// Transient PATCH failures requeue and retry without changing the request or conflict state.
{
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const requestBodies = [];
  let patchCalls = 0;
  const store = makeStore(empty, {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      maxRetryMs: 0,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: makeDocumentData(empty) }),
          };
        }
        patchCalls += 1;
        requestBodies.push(JSON.parse(init.body));
        if (patchCalls === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ success: false, code: "INTERNAL" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData() }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  store.state.nodes = [
    createCanvasNode({
      id: "node_patch_transient",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  const firstFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(firstFlush[0]);
  firstFlush[1].handler();
  await drainMicrotasks();
  eq(runtime.getDebugState().pending, 1, "503 PATCH requeues the inflight operation");
  eq(runtime.getDebugState().conflicted, false, "503 PATCH remains retryable");
  const retry = [...scheduler.tasks.entries()][0];
  ok(retry[1].delay > 0, "503 PATCH retry uses positive backoff");
  scheduler.tasks.delete(retry[0]);
  retry[1].handler();
  await drainMicrotasks();
  eq(patchCalls, 2, "503 PATCH retries once when scheduler fires");
  eq(requestBodies[1], requestBodies[0], "503 PATCH retry sends the exact same patch");
  eq(runtime.getDebugState().pending, 0, "successful PATCH retry acknowledges the operation");
  eq(runtime.getDebugState().baseRev, 3, "successful PATCH retry advances revision once");
  runtime.dispose();
}

// Transient GET failures retry the same persisted identity instead of entering terminal failure.
{
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const store = makeStore(empty);
  let getCalls = 0;
  const urls = [];
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      maxRetryMs: 0,
      uuid: () => OTHER_ID,
      fetch: async (url) => {
        getCalls += 1;
        urls.push(url);
        if (getCalls === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ success: false, code: "INTERNAL" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeDocumentData(empty) }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks();
  eq(runtime.getDebugState().mode, "loading", "503 GET remains in retryable loading mode");
  eq(store.hydrations(), 0, "503 GET does not hydrate an error response");
  const retry = [...scheduler.tasks.entries()][0];
  ok(retry[1].delay > 0, "zero retry ceiling is clamped to positive delay");
  scheduler.tasks.delete(retry[0]);
  retry[1].handler();
  await drainMicrotasks();
  eq(getCalls, 2, "503 GET retries once when scheduler fires");
  eq(urls[1], urls[0], "503 GET retries the exact same canvas URL");
  eq(store.hydrations(), 1, "successful GET retry hydrates once");
  eq(runtime.getDebugState().mode, "persisted", "successful GET retry enters persisted mode");
  runtime.dispose();
}

// Persisted recovery blocks scheduled saves without losing edits made while recovery is active.
{
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const store = makeStore(empty, {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  let patchCalls = 0;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method === "PATCH") {
          patchCalls += 1;
          const submitted = JSON.parse(init.body).ops.length;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: makePatchData({ appliedOps: submitted }),
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeDocumentData(empty) }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  const firstNode = createCanvasNode({
    id: "node_persisted_before_recovery",
    type: "text",
    position: { x: 0, y: 0 },
  });
  store.state.nodes = [firstNode];
  runtime.handleStoreChange();
  eq(runtime.getDebugState().pending, 1, "persisted edit queues before recovery starts");

  store.state.recoveryRequired = true;
  runtime.handleStoreChange();
  const blockedFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(blockedFlush[0]);
  blockedFlush[1].handler();
  await drainMicrotasks();
  eq(patchCalls, 0, "recoveryRequired blocks an already scheduled persisted PATCH");
  eq(runtime.getDebugState().pending, 1, "blocked recovery PATCH keeps prior local intent queued");

  const secondNode = createCanvasNode({
    id: "node_persisted_during_recovery",
    type: "text",
    position: { x: 200, y: 0 },
  });
  store.state.nodes = [firstNode, secondNode];
  runtime.handleStoreChange();
  eq(runtime.getDebugState().pending, 2, "recovery edits are queued as explicit local-intent proof while transport stays blocked");

  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  eq(runtime.getDebugState().pending, 2, "clearing recovery reuses the already-proven blocked edits without duplication");
  const resumedFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(resumedFlush[0]);
  resumedFlush[1].handler();
  await drainMicrotasks(30);
  eq(patchCalls, 1, "clearing recovery resumes one persisted PATCH");
  eq(runtime.getDebugState().pending, 0, "resumed recovery PATCH acknowledges all queued edits");
  runtime.dispose();
}

// Recovery synchronously requeues inflight work and fences a transport that ignores abort.
{
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const store = makeStore(empty, {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  let patchCalls = 0;
  let resolveIgnoredAbort;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: makeDocumentData(empty) }),
          };
        }
        patchCalls += 1;
        if (patchCalls === 1) {
          return new Promise((resolve) => {
            resolveIgnoredAbort = resolve;
          });
        }
        const submitted = JSON.parse(init.body).ops.length;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makePatchData({ appliedOps: submitted }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.nodes = [
    createCanvasNode({
      id: "node_recovery_inflight",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  const firstFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(firstFlush[0]);
  firstFlush[1].handler();
  await drainMicrotasks();
  eq(patchCalls, 1, "first persisted PATCH is genuinely inflight");
  eq(runtime.getDebugState().inflight, true, "queue records the active PATCH batch");

  store.state.recoveryRequired = true;
  runtime.handleStoreChange();
  eq(runtime.getDebugState().inflight, false, "recovery synchronously releases inflight state");
  eq(runtime.getDebugState().pending, 1, "recovery requeues the unacknowledged PATCH batch");

  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const retryFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(retryFlush[0]);
  retryFlush[1].handler();
  await drainMicrotasks(30);
  eq(patchCalls, 2, "cleared recovery retries while the old transport is still unresolved");
  eq(runtime.getDebugState().pending, 0, "fresh recovery retry acknowledges the queued batch");
  eq(runtime.getDebugState().baseRev, 3, "fresh recovery retry advances revision once");

  resolveIgnoredAbort({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: makePatchData() }),
  });
  await drainMicrotasks(30);
  eq(runtime.getDebugState().baseRev, 3, "late ignored-abort response cannot acknowledge twice");
  eq(runtime.getDebugState().pending, 0, "late ignored-abort response cannot restore stale queue state");
  runtime.dispose();
}

// Recovery during response.json also requeues inflight work before the stale body settles.
{
  const empty = createEmptyCanvasDoc();
  const scheduler = makeScheduler();
  const store = makeStore(empty, {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, ops }),
        },
      },
    }),
  });
  let patchCalls = 0;
  let resolveStaleJson;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore: makeIntentStore(),
      scheduler,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        if (init?.method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: makeDocumentData(empty) }),
          };
        }
        patchCalls += 1;
        if (patchCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: () => new Promise((resolve) => { resolveStaleJson = resolve; }),
          };
        }
        const submitted = JSON.parse(init.body).ops.length;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: makePatchData({ appliedOps: submitted }),
          }),
        };
      },
    })
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  store.state.nodes = [
    createCanvasNode({
      id: "node_recovery_json_inflight",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  const firstFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(firstFlush[0]);
  firstFlush[1].handler();
  await drainMicrotasks();
  eq(patchCalls, 1, "PATCH reaches a pending response.json phase");
  eq(runtime.getDebugState().inflight, true, "JSON-await PATCH remains inflight before recovery");

  store.state.recoveryRequired = true;
  runtime.handleStoreChange();
  eq(runtime.getDebugState().inflight, false, "recovery releases JSON-await inflight state");
  eq(runtime.getDebugState().pending, 1, "recovery requeues JSON-await intent");
  store.state.recoveryRequired = false;
  runtime.handleStoreChange();
  const retryFlush = [...scheduler.tasks.entries()][0];
  scheduler.tasks.delete(retryFlush[0]);
  retryFlush[1].handler();
  await drainMicrotasks(30);
  eq(patchCalls, 2, "JSON-await recovery starts a fresh retry");
  eq(runtime.getDebugState().baseRev, 3, "fresh JSON-await retry advances revision once");

  resolveStaleJson({ success: true, data: makePatchData() });
  await drainMicrotasks(30);
  eq(runtime.getDebugState().baseRev, 3, "late stale JSON body cannot acknowledge twice");
  eq(runtime.getDebugState().pending, 0, "late stale JSON body cannot corrupt the fresh queue");
  runtime.dispose();
}

// A local recovery document is incomplete by definition and must never start create.
{
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  let fetchCalls = 0;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      uuid: () => CREATE_ID,
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("recovery document must not reach fetch");
      },
    })
  );
  runtime.configure(null);
  store.state.recoveryRequired = true;
  store.state.nodes = [
    createCanvasNode({
      id: "node_recovery_blocked",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  await drainMicrotasks();
  eq(fetchCalls, 0, "recoveryRequired local state never starts POST");
  eq(intentStore.current(), null, "recoveryRequired local state creates no intent");
  eq(runtime.getDebugState().mode, "local", "recoveryRequired runtime stays local");
  runtime.dispose();
}

// HTTP transient failures keep the same intent and retry with positive backoff.
{
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  const scheduler = makeScheduler();
  const bodies = [];
  let fetchCalls = 0;
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      scheduler,
      uuid: () => CREATE_ID,
      fetch: async (_url, init) => {
        fetchCalls += 1;
        bodies.push(JSON.parse(init.body));
        if (fetchCalls === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ success: false, code: "INTERNAL" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }),
        };
      },
    })
  );
  runtime.configure(null);
  store.state.nodes = [
    createCanvasNode({
      id: "node_transient_retry",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  await drainMicrotasks();
  eq(runtime.getDebugState().mode, "local", "503 returns runtime to retryable local mode");
  const retryTasks = [...scheduler.tasks.values()];
  eq(retryTasks.length, 1, "503 schedules one retry");
  ok(retryTasks[0]?.delay > 0, "503 retry delay is positive");
  retryTasks[0]?.handler();
  await drainMicrotasks();
  eq(fetchCalls, 2, "scheduled retry performs a second POST");
  eq(bodies[1], bodies[0], "503 retry reuses exact id and captured doc");
  eq(store.promotions(), 1, "successful retry promotes once");
  eq(intentStore.clearCount(), 1, "successful retry clears exact intent once");
  runtime.dispose();
}

// A committed durable create is canonicalized only after the local pending bootstrap is ready.
{
  const empty = createEmptyCanvasDoc();
  const store = makeStore(empty);
  const intentStore = makeIntentStore();
  let resolveShadow;
  let canonicalizeCalls = 0;
  const shadow = {
    available: true,
    get: async () => null,
    put: () =>
      new Promise((resolve) => {
        resolveShadow = resolve;
      }),
  };
  const runtime = createCanvasRuntime(
    makeRuntimeDeps({
      store,
      intentStore,
      shadow,
      canonicalizeUrl: () => {
        canonicalizeCalls += 1;
      },
      uuid: () => CREATE_ID,
      fetch: async () => ({
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }),
      }),
    })
  );
  runtime.configure(null);
  await drainMicrotasks(30);
  store.state.nodes = [
    createCanvasNode({
      id: "node_stale_shadow",
      type: "text",
      position: { x: 0, y: 0 },
    }),
  ];
  runtime.handleStoreChange();
  await drainMicrotasks(60);
  eq(store.promotions(), 1, "durable pending create promotes after its phase write settles");
  eq(canonicalizeCalls, 1, "durable create requests canonical route adoption exactly once");
  eq(intentStore.clearCount(), 0, "durable create does not depend on the legacy in-memory intent");
  eq(intentStore.current(), null, "committed intent is unavailable to later local sessions");
  runtime.dispose();

  const nextStore = makeStore(empty);
  let nextBody = null;
  const nextRuntime = createCanvasRuntime(
    makeRuntimeDeps({
      store: nextStore,
      intentStore,
      shadow: null,
      uuid: () => OTHER_ID,
      fetch: async (_url, init) => {
        nextBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { id: OTHER_ID, rev: 0 } }),
        };
      },
    })
  );
  nextRuntime.configure(null);
  nextStore.state.nodes = [
    createCanvasNode({
      id: "node_after_committed_create",
      type: "text",
      position: { x: 40, y: 40 },
    }),
  ];
  nextRuntime.handleStoreChange();
  await drainMicrotasks();
  eq(nextBody?.id, OTHER_ID, "next local canvas receives a fresh id instead of reusing the committed row");
  nextRuntime.dispose();

  resolveShadow?.(true);
  await drainMicrotasks();
  eq(canonicalizeCalls, 1, "disposed session never repeats canonical navigation");
  eq(intentStore.current(), null, "late shadow completion cannot resurrect a retired create intent");
}

// Shadow v2 ownership is an explicit transport capability: readers never claim/write, and a
// stale CAS result permanently fences that writer until a fresh lifecycle signal.
{
  const cas = makeStrictCasShadow();
  const scheduler = makeScheduler();
  let patchCalls = 0;
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: { method: "PATCH", body: JSON.stringify({ baseRev, ops }) },
      },
    }),
  });
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-stale",
    uuid: () => OTHER_ID,
    fetch: async (_url, init) => {
      if (init.method === "PATCH") {
        patchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ success: true, data: makePatchData() }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeDocumentData(createEmptyCanvasDoc()) }),
      };
    },
  }));
  runtime.configure(CREATE_ID);
  await drainMicrotasks(40);
  eq(cas.state.shadowClaims, 0, "read-only persisted load never claims the normal shadow");
  eq(cas.state.shadowPuts.length, 0, "read-only persisted load never mutates the normal shadow");
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "strict-writer-a", acquired: true });
  await drainMicrotasks(50);
  eq(cas.state.shadowClaims, 1, "exact acquired signal claims normal shadow once");
  eq(cas.state.shadowPuts.length, 1, "takeover durably writes the reconciled baseline");
  cas.state.staleNextShadowPut = true;
  store.state.nodes = [createCanvasNode({ id: "node_strict_stale", type: "text", position: { x: 0, y: 0 } })];
  runtime.handleStoreChange();
  await drainMicrotasks(40);
  eq(runtime.getDebugState().mode, "loading", "stale shadow put makes the writer interaction-inert");
  runtime.handleOnline();
  await drainMicrotasks(40);
  eq(cas.state.shadowClaims, 1, "stale owner never automatically steals the shadow back");
  eq(patchCalls, 0, "stale owner sends no PATCH");
  runtime.dispose();
}

// An uncommitted normal-shadow CAS failure must carry the just-synchronized handoff into the
// automatic writer retry. Otherwise the fresh GET plus old shadow can overwrite the visible edit.
{
  const server = createCanvasNode({ id: "node_shadow_retry_server", type: "text", position: { x: 0, y: 0 } });
  const edit = createCanvasNode({ id: "node_shadow_retry_edit", type: "text", position: { x: 100, y: 0 } });
  const cas = makeStrictCasShadow();
  const scheduler = makeScheduler();
  const intentStore = makeIntentStore();
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore,
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-shadow-retry",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData({ nodes: [server], edges: [], groups: [] }, { rev: 2 }),
      }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "shadow-retry-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(70);
  eq(
    cas.state.shadow.payload?.doc.nodes.map((node) => node.id),
    [server.id],
    "retry fixture begins with a durable baseline shadow"
  );

  cas.state.failNextShadowPut = true;
  store.state.nodes = [server, edit];
  runtime.handleStoreChange();
  await drainMicrotasks(50);
  eq(runtime.getDebugState().mode, "loading", "uncommitted shadow failure makes retry interaction-inert");
  eq(
    intentStore.handoff(CREATE_ID)?.doc.nodes.map((node) => node.id),
    [server.id, edit.id],
    "failed shadow write retains the latest edit in same-realm handoff"
  );
  eq(
    cas.state.shadow.payload?.doc.nodes.map((node) => node.id),
    [server.id],
    "uncommitted failure leaves the durable shadow at its old baseline"
  );

  const retryTask = [...scheduler.tasks.values()].find((task) => task.delay === 1_000);
  ok(!!retryTask, "uncommitted shadow failure schedules the writer takeover retry");
  retryTask?.handler();
  await drainMicrotasks(120);
  eq(runtime.getDebugState().mode, "persisted", "writer retry returns to the persisted mode");
  eq(
    store.state.nodes.map((node) => node.id),
    [server.id, edit.id],
    "fresh GET retry replays the retained edit into the visible document"
  );
  eq(
    cas.state.shadow.payload?.doc.nodes.map((node) => node.id),
    [server.id, edit.id],
    "fresh GET retry makes the retained edit durable before clearing handoff"
  );
  eq(intentStore.handoff(CREATE_ID), null, "handoff clears only after the recovered shadow write commits");
  runtime.dispose();
}

// A committed old-tag shadow write whose response rejects late cannot overwrite or fence the
// lease obtained by a newer exact writer takeover.
{
  const cas = makeStrictCasShadow();
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    shadow: cas.api,
    shadowOwnerId: "strict-owner-late-shadow",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: makeDocumentData(createEmptyCanvasDoc()) }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "late-shadow-old", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(60);
  cas.state.deferNextShadowPutReject = true;
  const first = createCanvasNode({ id: "node_late_shadow_first", type: "text", position: { x: 0, y: 0 } });
  store.state.nodes = [first];
  runtime.handleStoreChange();
  await drainMicrotasks(30);
  ok(typeof cas.state.shadowPutResolver === "function", "old-tag shadow response is delayed after commit");
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "late-shadow-old", acquired: false });
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "late-shadow-new", acquired: true });
  await drainMicrotasks(30);
  cas.state.shadowPutResolver?.();
  await drainMicrotasks(100);
  eq(runtime.getDebugState().mode, "persisted", "late old-tag rejection leaves newer takeover active");
  eq(store.state.nodes.map((node) => node.id), [first.id], "new writer reconciles committed old-tag payload");
  const putsBeforeNext = cas.state.shadowPuts.length;
  const second = createCanvasNode({ id: "node_late_shadow_second", type: "text", position: { x: 100, y: 0 } });
  store.state.nodes = [first, second];
  runtime.handleStoreChange();
  await drainMicrotasks(50);
  eq(cas.state.shadowPuts.length, putsBeforeNext + 1, "new writer keeps a valid lease after old rejection");
  runtime.dispose();
}

// Layout writer signals may beat passive configure during A→B navigation, but only the very
// next matching target consumes the capability.
{
  const cas = makeStrictCasShadow();
  const scheduler = makeScheduler();
  const fetched = [];
  const patchUrls = [];
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${OTHER_ID}`,
        init: { method: "PATCH", body: JSON.stringify({ baseRev, ops }) },
      },
    }),
  });
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-navigation",
    uuid: () => CREATE_ID,
    fetch: async (url, init) => {
      if (init.method === "PATCH") {
        patchUrls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData({ id: OTHER_ID }) }),
        };
      }
      const id = url.split("/").at(-1);
      fetched.push(id);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(createEmptyCanvasDoc(), { id }),
        }),
      };
    },
  }));
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "wrong-a-for-b", acquired: true });
  runtime.configure(OTHER_ID);
  await drainMicrotasks(40);
  eq(
    cas.state.events.filter((event) => event === `shadow-claim:${OTHER_ID}`).length,
    0,
    "A writer capability cannot authorize B"
  );
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  runtime.handleWriterSignal({ canvasId: OTHER_ID, writerTag: "writer-b", acquired: true });
  runtime.configure(OTHER_ID);
  await drainMicrotasks(50);
  ok(cas.state.events.includes(`shadow-claim:${OTHER_ID}`), "off-target B layout signal carries into configure(B)");
  store.state.nodes = [createCanvasNode({ id: "node_navigation_b", type: "text", position: { x: 0, y: 0 } })];
  runtime.handleStoreChange();
  await drainMicrotasks(30);
  const bFlush = [...scheduler.tasks.values()].find((task) => task.delay === 5_000);
  bFlush?.handler();
  await drainMicrotasks(50);
  eq(patchUrls, [`/api/canvas/${OTHER_ID}`], "carried B capability authorizes exactly one B PATCH");
  const claimsABeforeExpiry = cas.state.events.filter((event) => event === `shadow-claim:${CREATE_ID}`).length;
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "stale-a", acquired: true });
  runtime.configure(THIRD_ID);
  await drainMicrotasks(30);
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(
    cas.state.events.filter((event) => event === `shadow-claim:${CREATE_ID}`).length,
    claimsABeforeExpiry,
    "unmatched queued writer capability expires on the very next configure"
  );
  runtime.dispose();
}

// A reader shows only fresh cloud state and retains same-realm handoff proof until an exact
// writer claims, replays, and CAS-writes it—even when the claimed shadow is non-null but older.
{
  const serverNode = createCanvasNode({ id: "node_handoff_server", type: "text", position: { x: 0, y: 0 } });
  const localNode = createCanvasNode({ id: "node_handoff_tail", type: "text", position: { x: 100, y: 0 } });
  const handoffQueue = enqueue(createOfflineQueue(2), "handoff-tail-op", addNodeOp(localNode));
  const intentStore = makeIntentStore();
  intentStore.api.setSessionHandoff({
    version: 1,
    canvasId: CREATE_ID,
    doc: { nodes: [serverNode, localNode], edges: [], groups: [] },
    deps: createEmptyCanvasDeps(),
    serverRev: 2,
    queue: snapshot(handoffQueue),
    snapshotRecoveryRequired: false,
    serverRecoveryRequired: false,
    localRecoveryRequired: false,
    updatedAt: ISO,
  });
  const cas = makeStrictCasShadow({
    record: makeShadowRecord({ nodes: [serverNode], edges: [], groups: [] }, 2, null),
  });
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-handoff",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData({ nodes: [serverNode], edges: [], groups: [] }, { rev: 2 }),
      }),
    }),
  }));
  runtime.configure(CREATE_ID);
  await drainMicrotasks(30);
  eq(store.state.nodes.map((node) => node.id), [serverNode.id], "reader renders only the fresh GET document");
  ok(!!intentStore.handoff(CREATE_ID), "reader does not consume the retained handoff");
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "handoff-writer", acquired: true });
  await drainMicrotasks(60);
  eq(
    store.state.nodes.map((node) => node.id),
    [serverNode.id, localNode.id],
    "writer merges handoff tail missing from an older non-null claimed shadow"
  );
  eq(runtime.getDebugState().pending, 1, "merged handoff tail remains queued exactly once");
  eq(intentStore.handoff(CREATE_ID), null, "handoff clears only after merged normal-shadow durability");
  runtime.dispose();
}

// Divergent non-empty shadow/handoff histories are not ordered by set difference. Runtime keeps
// the claimed branch visible and requires an explicit snapshot decision for the other branch.
{
  const common = createCanvasNode({ id: "node_branch_common", type: "text", position: { x: 0, y: 0 } });
  const shadowOnly = createCanvasNode({ id: "node_branch_shadow", type: "text", position: { x: 100, y: 0 } });
  const handoffOnly = createCanvasNode({ id: "node_branch_handoff", type: "text", position: { x: 200, y: 0 } });
  let shadowQueue = enqueue(createOfflineQueue(2), "branch-common", addNodeOp(common));
  shadowQueue = enqueue(shadowQueue, "branch-shadow", addNodeOp(shadowOnly));
  let handoffQueue = enqueue(createOfflineQueue(2), "branch-common", addNodeOp(common));
  handoffQueue = enqueue(handoffQueue, "branch-handoff", addNodeOp(handoffOnly));
  const intentStore = makeIntentStore();
  intentStore.api.setSessionHandoff({
    version: 1,
    canvasId: CREATE_ID,
    doc: { nodes: [common, handoffOnly], edges: [], groups: [] },
    deps: createEmptyCanvasDeps(),
    serverRev: 2,
    queue: snapshot(handoffQueue),
    snapshotRecoveryRequired: false,
    serverRecoveryRequired: false,
    localRecoveryRequired: false,
    updatedAt: ISO,
  });
  const cas = makeStrictCasShadow({
    record: makeShadowRecord(
      { nodes: [common, shadowOnly], edges: [], groups: [] },
      2,
      snapshot(shadowQueue)
    ),
  });
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-divergent-handoff",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: makeDocumentData(createEmptyCanvasDoc(), { rev: 2 }) }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "divergent-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(80);
  eq(runtime.getDebugState().mode, "recovery-pending", "divergent queue branches require explicit recovery");
  eq(
    store.state.nodes.map((node) => node.id),
    [common.id, shadowOnly.id],
    "divergent handoff tail is never appended after the claimed shadow branch"
  );
  ok(!!intentStore.handoff(CREATE_ID), "divergent retained branch remains durable for recovery");
  runtime.dispose();
}

// Choosing a shadow snapshot does not silently authorize deletion of a distinct retained
// handoff source. Both restore and keep-cloud require a second explicit decision for that proof.
for (const restore of [true, false]) {
  const server = createCanvasNode({ id: `node_multisource_server_${restore}`, type: "text", position: { x: 0, y: 0 } });
  const shadowNode = createCanvasNode({ id: `node_multisource_shadow_${restore}`, type: "text", position: { x: 100, y: 0 } });
  const handoffNode = createCanvasNode({ id: `node_multisource_handoff_${restore}`, type: "text", position: { x: 200, y: 0 } });
  const handoffQueue = enqueue(createOfflineQueue(2), `multisource-handoff-${restore}`, addNodeOp(handoffNode));
  const intentStore = makeIntentStore();
  intentStore.api.setSessionHandoff({
    version: 1,
    canvasId: CREATE_ID,
    doc: { nodes: [server, handoffNode], edges: [], groups: [] },
    deps: createEmptyCanvasDeps(),
    serverRev: 2,
    queue: snapshot(handoffQueue),
    snapshotRecoveryRequired: false,
    serverRecoveryRequired: false,
    localRecoveryRequired: false,
    updatedAt: ISO,
  });
  const cas = makeStrictCasShadow({
    record: makeShadowRecord(
      { nodes: [server, shadowNode], edges: [], groups: [] },
      4,
      null,
      true
    ),
  });
  const store = makeStore(createEmptyCanvasDoc());
  const uiStates = [];
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore,
    shadow: cas.api,
    shadowOwnerId: `strict-owner-multisource-${restore}`,
    onRuntimeStateChange: (state) => uiStates.push(state),
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData({ nodes: [server], edges: [], groups: [] }, { rev: 2 }),
      }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: `multisource-writer-${restore}`, acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(70);
  eq(runtime.getDebugState().mode, "recovery-pending", `multi-source ${restore}: shadow snapshot is presented`);
  const writesBeforeChoice = cas.state.shadowPuts.length;
  cas.state.deferNextShadowPut = true;
  const selectedChoice = restore
    ? runtime.restoreShadowSnapshot()
    : runtime.discardShadowSnapshot();
  await drainMicrotasks(30);
  ok(typeof cas.state.shadowPutResolver === "function", `multi-source ${restore}: selected recovery CAS is in flight`);
  eq(
    await (restore ? runtime.discardShadowSnapshot() : runtime.restoreShadowSnapshot()),
    false,
    `multi-source ${restore}: opposite rapid recovery choice is rejected while settlement is in flight`
  );
  eq(
    cas.state.shadowPuts.length,
    writesBeforeChoice + 1,
    `multi-source ${restore}: rapid double choice issues exactly one recovery CAS`
  );
  cas.state.shadowPutResolver?.();
  ok(await selectedChoice, `multi-source ${restore}: selected snapshot choice persists`);
  const firstChoiceIds = restore ? [server.id, shadowNode.id] : [server.id];
  eq(
    store.state.nodes.map((node) => node.id),
    firstChoiceIds,
    `multi-source ${restore}: visible document matches the accepted first choice`
  );
  eq(
    cas.state.shadow.payload?.doc.nodes.map((node) => node.id),
    firstChoiceIds,
    `multi-source ${restore}: durable document matches the accepted first choice`
  );
  eq(runtime.getDebugState().mode, "recovery-pending", `multi-source ${restore}: uncovered handoff becomes a second recovery gate`);
  eq(uiStates.at(-1)?.interactionReady, false, `multi-source ${restore}: second recovery gate remains interaction-inert`);
  ok(!!intentStore.handoff(CREATE_ID), `multi-source ${restore}: unincorporated handoff is not cleared`);
  ok(await runtime.restoreShadowSnapshot(), `multi-source ${restore}: explicit second choice incorporates handoff`);
  eq(runtime.getDebugState().mode, "persisted", `multi-source ${restore}: second choice completes recovery`);
  eq(intentStore.handoff(CREATE_ID), null, `multi-source ${restore}: covered handoff clears after durable write`);
  eq(
    store.state.nodes.map((node) => node.id),
    [server.id, handoffNode.id],
    `multi-source ${restore}: final document is the explicitly selected handoff`
  );
  runtime.dispose();
}

// Pending-create writes are serialized by lease sequence. Edits made while the seed write is
// blocked are folded into the first posting proof, and a stale result never triggers re-claim.
{
  const cas = makeStrictCasShadow();
  const scheduler = makeScheduler();
  let postResolver;
  let postBody;
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-pending-serialization",
    uuid: () => CREATE_ID,
    fetch: async (_url, init) => {
      postBody = JSON.parse(init.body);
      return new Promise((resolve) => { postResolver = resolve; });
    },
  }));
  runtime.configure(null);
  await drainMicrotasks(30);
  cas.state.deferNextPendingPut = true;
  const first = createCanvasNode({ id: "node_pending_capture", type: "text", position: { x: 0, y: 0 } });
  const duringSeed = createCanvasNode({ id: "node_pending_during_seed", type: "text", position: { x: 100, y: 0 } });
  store.state.nodes = [first];
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  ok(typeof cas.state.pendingPutResolver === "function", "initial pending seed write is genuinely deferred");
  store.state.nodes = [first, duringSeed];
  runtime.handleStoreChange();
  cas.state.pendingPutResolver?.();
  await drainMicrotasks(70);
  eq(postBody?.doc.nodes.map((node) => node.id), [first.id], "POST body remains the immutable first capture");
  eq(
    cas.state.pending.payload?.latestDoc.nodes.map((node) => node.id),
    [first.id, duringSeed.id],
    "edit made during seed wait is folded into durable latestDoc"
  );
  eq(cas.state.pending.payload?.trailingQueue?.pending.length, 1, "seed-wait edit has one replayable trailing op");

  const beforeDeferred = cas.state.pendingPuts.length;
  cas.state.deferNextPendingPut = true;
  const third = createCanvasNode({ id: "node_pending_third", type: "text", position: { x: 200, y: 0 } });
  store.state.nodes = [first, duringSeed, third];
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  eq(cas.state.pendingPuts.length, beforeDeferred + 1, "first rapid edit starts one pending CAS write");
  const fourth = createCanvasNode({ id: "node_pending_fourth", type: "text", position: { x: 300, y: 0 } });
  store.state.nodes = [first, duringSeed, third, fourth];
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  eq(cas.state.pendingPuts.length, beforeDeferred + 1, "second rapid edit waits behind the exact lease sequence");
  cas.state.pendingPutResolver?.();
  await drainMicrotasks(70);
  eq(cas.state.pendingPuts.length, beforeDeferred + 2, "queued rapid edit writes after prior CAS completion");
  const rapidLeases = cas.state.pendingPuts.slice(-2).map((entry) => entry.lease.writeSeq);
  eq(rapidLeases[1], rapidLeases[0] + 1, "rapid pending writes advance writeSeq monotonically");
  eq(
    cas.state.pending.payload?.latestDoc.nodes.map((node) => node.id),
    [first.id, duringSeed.id, third.id, fourth.id],
    "serialized pending writes converge on the latest visible document"
  );

  const claimsBeforeStale = cas.state.pendingClaims;
  cas.state.staleNextPendingPut = true;
  const fifth = createCanvasNode({ id: "node_pending_stale", type: "text", position: { x: 400, y: 0 } });
  store.state.nodes = [first, duringSeed, third, fourth, fifth];
  runtime.handleStoreChange();
  await drainMicrotasks(40);
  eq(runtime.getDebugState().mode, "failed", "stale pending owner is fail-closed");
  runtime.handleOnline();
  for (const task of [...scheduler.tasks.values()]) task.handler();
  await drainMicrotasks(30);
  eq(cas.state.pendingClaims, claimsBeforeStale, "stale pending owner never automatically reclaims the singleton");
  runtime.dispose();
  postResolver?.({ ok: false, status: 503, json: async () => ({ success: false }) });
}

// POST success cannot cut over to the canonical route until every edit made during the final
// created-awaiting-route CAS is durably represented. Disable the same-realm handoff so a fresh
// runtime can recover the late edit from CAS state alone, as it would after a hard crash.
{
  const captured = createCanvasNode({ id: "node_created_cutover_capture", type: "text", position: { x: 0, y: 0 } });
  const late = createCanvasNode({ id: "node_created_cutover_late", type: "text", position: { x: 100, y: 0 } });
  const cas = makeStrictCasShadow();
  const scheduler = makeScheduler();
  const noHandoffIntent = makeIntentStore();
  noHandoffIntent.api.getSessionHandoff = () => null;
  noHandoffIntent.api.setSessionHandoff = () => {};
  noHandoffIntent.api.clearSessionHandoff = () => {};
  const store = makeStore(createEmptyCanvasDoc());
  let canonicalizeCalls = 0;
  let runtime;
  runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: noHandoffIntent,
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-created-cutover",
    uuid: () => CREATE_ID,
    canonicalizeUrl: (id) => {
      canonicalizeCalls += 1;
      runtime.handleWriterSignal({ canvasId: id, writerTag: "created-cutover-writer", acquired: true });
      runtime.configure(id);
    },
    fetch: async (_url, init) => {
      if (init.method === "POST") {
        cas.state.deferNextPendingPut = true;
        return { ok: true, status: 201, json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [captured], edges: [], groups: [] }, { rev: 0 }),
        }),
      };
    },
  }));
  runtime.configure(null);
  await drainMicrotasks(30);
  store.state.nodes = [captured];
  runtime.handleStoreChange();
  await drainMicrotasks(80);
  ok(typeof cas.state.pendingPutResolver === "function", "created-phase cutover CAS is genuinely deferred");
  const putsWhileBlocked = cas.state.pendingPuts.length;
  store.state.nodes = [captured, late];
  runtime.handleStoreChange();
  await drainMicrotasks(20);
  eq(cas.state.pendingPuts.length, putsWhileBlocked, "edit during created-phase CAS queues behind the active lease write");
  cas.state.pendingPutResolver?.();
  await drainMicrotasks(200);
  eq(canonicalizeCalls, 1, "canonical route starts only after the stable created-phase cutover");
  const lastCreatedPut = [...cas.state.pendingPuts]
    .reverse()
    .find((entry) => entry.input.phase === "created-awaiting-route");
  eq(
    lastCreatedPut?.input.latestDoc.nodes.map((node) => node.id),
    [captured.id, late.id],
    "final created-phase CAS durably includes the edit made during its predecessor"
  );
  eq(noHandoffIntent.handoffCount(), 0, "cutover regression receives no same-realm handoff rescue");
  eq(cas.state.pending.payload, null, "canonical adoption retires the fully reconciled pending singleton");
  eq(
    cas.state.shadow.payload?.doc.nodes.map((node) => node.id),
    [captured.id, late.id],
    "canonical adoption carries the late edit into normal durable shadow"
  );
  runtime.dispose();

  const freshStore = makeStore(createEmptyCanvasDoc());
  const freshRuntime = createCanvasRuntimeCore(makeRuntimeDeps({
    store: freshStore,
    intentStore: makeIntentStore(),
    scheduler: makeScheduler(),
    shadow: cas.api,
    shadowOwnerId: "strict-owner-created-cutover-fresh",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData({ nodes: [captured], edges: [], groups: [] }, { rev: 0 }),
      }),
    }),
  }));
  freshRuntime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "created-cutover-fresh-writer", acquired: true });
  freshRuntime.configure(CREATE_ID);
  await drainMicrotasks(120);
  eq(
    freshStore.state.nodes.map((node) => node.id),
    [captured.id, late.id],
    "fresh realm restores the cutover edit from CAS without any handoff state"
  );
  freshRuntime.dispose();
}

// A hard-reloaded posting intent reuses the same UUID/body. POST success may publish D5 acquired
// before canonical configure; the signal is carried into route adoption, normal shadow durability
// and pending retirement, all before the first PATCH.
{
  const capturedNode = createCanvasNode({ id: "node_pending_captured", type: "text", position: { x: 0, y: 0 } });
  const trailingNode = createCanvasNode({ id: "node_pending_trailing", type: "text", position: { x: 100, y: 0 } });
  const trailing = enqueue(createOfflineQueue(0), "pending-route-tail", addNodeOp(trailingNode));
  const cas = makeStrictCasShadow({
    pending: {
      version: 1,
      createId: CREATE_ID,
      capturedDoc: { nodes: [capturedNode], edges: [], groups: [] },
      latestDoc: { nodes: [capturedNode, trailingNode], edges: [], groups: [] },
      trailingQueue: snapshot(trailing),
      phase: "posting",
      updatedAt: ISO,
    },
  });
  const scheduler = makeScheduler();
  const requests = [];
  const routeUiStates = [];
  let routeStateAfterCanonicalReturn = null;
  let uuidCalls = 0;
  let runtime;
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: { method: "PATCH", body: JSON.stringify({ baseRev, ops }) },
      },
    }),
  });
  runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-pending-route",
    onRuntimeStateChange: (state) => routeUiStates.push(state),
    uuid: () => { uuidCalls += 1; return OTHER_ID; },
    canonicalizeUrl: (id) => {
      runtime.handleWriterSignal({ canvasId: id, writerTag: "writer-before-configure", acquired: true });
      runtime.configure(id);
      queueMicrotask(() => {
        routeStateAfterCanonicalReturn = routeUiStates.at(-1) ?? null;
      });
    },
    fetch: async (url, init) => {
      requests.push({ url, method: init.method ?? "GET", body: init.body });
      if (init.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { id: CREATE_ID, rev: 0 } }) };
      }
      if (init.method === "PATCH") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makePatchData({ rev: 1, appliedOps: 1 }) }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData({ nodes: [capturedNode], edges: [], groups: [] }, { rev: 0 }),
        }),
      };
    },
  }));
  runtime.configure(null);
  await drainMicrotasks(120);
  eq(routeStateAfterCanonicalReturn?.mode, "loading", "canonical re-entry remains on the replacement loading session after callback return");
  eq(routeStateAfterCanonicalReturn?.interactionReady, false, "canonical re-entry remains interaction-inert after callback return");
  const post = requests.find((request) => request.method === "POST");
  eq(JSON.parse(post?.body ?? "null")?.id, CREATE_ID, "hard reload retries the exact durable create UUID");
  eq(JSON.parse(post?.body ?? "null")?.doc.nodes.map((node) => node.id), [capturedNode.id], "hard reload retries the immutable captured POST body");
  eq(uuidCalls, 0, "hard reload never generates a replacement create UUID");
  eq(
    store.state.nodes.map((node) => node.id),
    [capturedNode.id, trailingNode.id],
    "canonical route takeover replays durable trailing edits"
  );
  eq(cas.state.pending.payload, null, "pending singleton retires after normal shadow durability");
  ok(
    cas.state.events.indexOf("pending-remove") > cas.state.events.findIndex((event) => event.startsWith("shadow-put:")),
    "normal shadow CAS completes before pending retirement"
  );
  eq(requests.filter((request) => request.method === "PATCH").length, 0, "no PATCH runs before route adoption and pending retirement");
  const flushTask = [...scheduler.tasks.values()].find((task) => task.delay === 5_000);
  flushTask?.handler();
  await drainMicrotasks(50);
  eq(requests.filter((request) => request.method === "PATCH").length, 1, "first PATCH runs only after full durable route adoption");
  ok(
    cas.state.events.indexOf("pending-remove") < cas.state.events.length,
    "pending removal remains ordered before transport"
  );
  runtime.dispose();
}

// A transient pending-remove failure with the record still present is not stale ownership.
// Runtime retries through claimIfMatches and never PATCHes until retirement succeeds.
{
  const base = createCanvasNode({ id: "node_remove_retry_base", type: "text", position: { x: 0, y: 0 } });
  const tail = createCanvasNode({ id: "node_remove_retry_tail", type: "text", position: { x: 100, y: 0 } });
  const queue = enqueue(createOfflineQueue(0), "remove-retry-tail", addNodeOp(tail));
  const cas = makeStrictCasShadow({
    pending: {
      version: 1,
      createId: CREATE_ID,
      capturedDoc: { nodes: [base], edges: [], groups: [] },
      latestDoc: { nodes: [base, tail], edges: [], groups: [] },
      trailingQueue: snapshot(queue),
      phase: "created-awaiting-route",
      updatedAt: ISO,
    },
  });
  cas.state.failNextPendingRemove = true;
  const scheduler = makeScheduler();
  let patchCalls = 0;
  const store = makeStore(createEmptyCanvasDoc(), {
    preparePatchSave: ({ baseRev, ops }) => ({
      ok: true,
      request: { url: `/api/canvas/${CREATE_ID}`, init: { method: "PATCH", body: JSON.stringify({ baseRev, ops }) } },
    }),
  });
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-remove-retry",
    uuid: () => OTHER_ID,
    fetch: async (_url, init) => {
      if (init.method === "PATCH") {
        patchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ success: true, data: makePatchData({ rev: 1 }) }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeDocumentData({ nodes: [base], edges: [], groups: [] }, { rev: 0 }) }),
      };
    },
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "remove-retry-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(80);
  eq(cas.state.pending.payload?.createId, CREATE_ID, "transient remove failure leaves expected pending record intact");
  eq(patchCalls, 0, "transport stays blocked while pending retirement is unconfirmed");
  const retryTask = [...scheduler.tasks.values()].find((task) => task.delay === 1_000);
  retryTask?.handler();
  await drainMicrotasks(90);
  eq(cas.state.pending.payload, null, "retry reclaims exact pending id and retires it");
  eq(patchCalls, 0, "successful retirement still precedes scheduled PATCH");
  const patchTask = [...scheduler.tasks.values()].find((task) => task.delay === 5_000);
  patchTask?.handler();
  await drainMicrotasks(60);
  eq(patchCalls, 1, "PATCH runs once after retry retirement succeeds");
  runtime.dispose();
}

// A hard reload already in created-awaiting-route adopts createId before canonical navigation.
// An edit queued immediately before configure(id) is captured as handoff proof and survives even
// when the old session's pending mutation never starts.
{
  const captured = createCanvasNode({ id: "node_created_reload", type: "text", position: { x: 0, y: 0 } });
  const late = createCanvasNode({ id: "node_created_reload_late", type: "text", position: { x: 100, y: 0 } });
  const cas = makeStrictCasShadow({
    pending: {
      version: 1,
      createId: CREATE_ID,
      capturedDoc: { nodes: [captured], edges: [], groups: [] },
      latestDoc: { nodes: [captured], edges: [], groups: [] },
      trailingQueue: null,
      phase: "created-awaiting-route",
      updatedAt: ISO,
    },
  });
  let canonicalId = null;
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    shadow: cas.api,
    shadowOwnerId: "strict-owner-created-reload",
    canonicalizeUrl: (id) => { canonicalId = id; },
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData({ nodes: [captured], edges: [], groups: [] }, { rev: 0 }),
      }),
    }),
  }));
  runtime.configure(null);
  await drainMicrotasks(50);
  eq(canonicalId, CREATE_ID, "created-phase reload requests its existing canonical id");
  eq(runtime.getDebugState().activeId, CREATE_ID, "created-phase reload adopts persisted identity before navigation");
  store.state.nodes = [captured, late];
  runtime.handleStoreChange();
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "created-reload-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(100);
  eq(
    store.state.nodes.map((node) => node.id),
    [captured.id, late.id],
    "canonical route merges the handoff edit absent from the older pending singleton"
  );
  eq(cas.state.pending.payload, null, "created reload retires pending only after merged normal-shadow write");
  runtime.dispose();
}

// A clean confirmed repair survives a hard crash between confirmation and PUT: even with no
// patch queue, exact same-revision shadow proof resumes one repair PUT.
{
  const serverNode = createCanvasNode({ id: "node_clean_repair_resume", type: "text", position: { x: 0, y: 0 } });
  const serverDoc = { nodes: [serverNode], edges: [], groups: [] };
  const record = makeShadowRecord(serverDoc, 2, null);
  record.serverRecoveryRequired = true;
  record.localRecoveryRequired = false;
  const cas = makeStrictCasShadow({ record });
  const scheduler = makeScheduler();
  const methods = [];
  const depsValue = createEmptyCanvasDeps();
  const store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: ({ baseRev, deps }) => ({
      ok: true,
      request: {
        url: `/api/canvas/${CREATE_ID}`,
        init: {
          method: "PUT",
          body: JSON.stringify({ baseRev, confirmRecovery: true, doc: serverDoc, deps }),
        },
      },
    }),
  });
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    scheduler,
    shadow: cas.api,
    shadowOwnerId: "strict-owner-clean-repair",
    uuid: () => OTHER_ID,
    fetch: async (_url, init) => {
      methods.push(init.method ?? "GET");
      if (init.method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: makeRepairData(serverDoc, depsValue) }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: makeDocumentData(serverDoc, {
            rev: 2,
            recovery: {
              brokenNodes: [], brokenEdges: [], migratedFrom: 1, targetSchemaVersion: 1,
              migrationComplete: true, recoveryRequired: true, issues: ["resume repair"],
            },
          }),
        }),
      };
    },
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "clean-repair-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(70);
  eq(runtime.getDebugState().mode, "repairing", "clean confirmed shadow resumes repair mode without a patch queue");
  const repairTask = [...scheduler.tasks.values()].find((task) => task.delay === 5_000);
  repairTask?.handler();
  await drainMicrotasks(70);
  eq(methods.filter((method) => method === "PUT").length, 1, "clean confirmed shadow sends exactly one repair PUT");
  eq(methods.filter((method) => method === "PATCH").length, 0, "clean repair resume never leaks through PATCH");
  runtime.dispose();
}

// Persisted pending takeover uses atomic expected-id matching. If A is replaced by unrelated C
// between read and claim, Runtime performs no cross-canvas replay or normal-shadow mutation.
{
  const aNode = createCanvasNode({ id: "node_pending_a", type: "text", position: { x: 0, y: 0 } });
  const cNode = createCanvasNode({ id: "node_pending_c", type: "text", position: { x: 100, y: 0 } });
  const pendingA = {
    version: 1,
    createId: CREATE_ID,
    capturedDoc: { nodes: [aNode], edges: [], groups: [] },
    latestDoc: { nodes: [aNode], edges: [], groups: [] },
    trailingQueue: null,
    phase: "created-awaiting-route",
    updatedAt: ISO,
  };
  const pendingC = {
    version: 1,
    createId: THIRD_ID,
    capturedDoc: { nodes: [cNode], edges: [], groups: [] },
    latestDoc: { nodes: [cNode], edges: [], groups: [] },
    trailingQueue: null,
    phase: "created-awaiting-route",
    updatedAt: ISO,
  };
  const cas = makeStrictCasShadow({ pending: pendingA });
  cas.state.replacePendingBeforeMatch = pendingC;
  const store = makeStore(createEmptyCanvasDoc());
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    shadow: cas.api,
    shadowOwnerId: "strict-owner-pending-match",
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: makeDocumentData({ nodes: [aNode], edges: [], groups: [] }) }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: "pending-match-writer", acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(70);
  eq(cas.state.pending.payload?.createId, THIRD_ID, "unrelated replacement pending singleton remains intact");
  eq(cas.state.shadowClaims, 0, "pending id mismatch stops before normal-shadow claim");
  ok(!store.state.nodes.some((node) => node.id === cNode.id), "pending C document never replays into canvas A");
  runtime.dispose();
}

// Recovery confirmation is valid only for the exact same server revision. Unconfirmed local
// metadata and a revision advance both preserve the fresh GET's recovery gate.
for (const fixture of [
  {
    label: "unconfirmed local recovery",
    recordRev: 2,
    serverRecoveryRequired: true,
    localRecoveryRequired: true,
    expectedRecovery: true,
    expectedMode: "persisted",
  },
  {
    label: "confirmed same-revision recovery",
    recordRev: 2,
    serverRecoveryRequired: true,
    localRecoveryRequired: false,
    expectedRecovery: false,
    expectedMode: "repairing",
  },
  {
    label: "confirmation invalidated by rev advance",
    recordRev: 1,
    serverRecoveryRequired: true,
    localRecoveryRequired: false,
    expectedRecovery: true,
    expectedMode: "persisted",
  },
]) {
  const serverNode = createCanvasNode({ id: `node_recovery_server_${fixture.recordRev}_${fixture.localRecoveryRequired}`, type: "text", position: { x: 0, y: 0 } });
  const localNode = createCanvasNode({ id: `node_recovery_local_${fixture.recordRev}_${fixture.localRecoveryRequired}`, type: "text", position: { x: 100, y: 0 } });
  const queued = enqueue(createOfflineQueue(fixture.recordRev), `recovery-op-${fixture.label}`, addNodeOp(localNode));
  const record = makeShadowRecord(
    { nodes: [serverNode, localNode], edges: [], groups: [] },
    fixture.recordRev,
    snapshot(queued)
  );
  record.serverRecoveryRequired = fixture.serverRecoveryRequired;
  record.localRecoveryRequired = fixture.localRecoveryRequired;
  const cas = makeStrictCasShadow({ record });
  const store = makeStore(createEmptyCanvasDoc(), {
    prepareRepairSave: () => ({ ok: false, error: { code: "NO_ACTIVE_WRITER" } }),
  });
  const runtime = createCanvasRuntimeCore(makeRuntimeDeps({
    store,
    intentStore: makeIntentStore(),
    shadow: cas.api,
    shadowOwnerId: `strict-recovery-${fixture.label}`,
    uuid: () => OTHER_ID,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: makeDocumentData(
          { nodes: [serverNode], edges: [], groups: [] },
          {
            rev: 2,
            recovery: {
              brokenNodes: [],
              brokenEdges: [],
              migratedFrom: 1,
              targetSchemaVersion: 1,
              migrationComplete: true,
              recoveryRequired: true,
              issues: [fixture.label],
            },
          }
        ),
      }),
    }),
  }));
  runtime.handleWriterSignal({ canvasId: CREATE_ID, writerTag: `writer-${fixture.label}`, acquired: true });
  runtime.configure(CREATE_ID);
  await drainMicrotasks(70);
  eq(store.state.recoveryRequired, fixture.expectedRecovery, `${fixture.label}: fresh recovery metadata is preserved or cleared exactly`);
  eq(runtime.getDebugState().mode, fixture.expectedMode, `${fixture.label}: runtime enters the correct repair gate`);
  runtime.dispose();
}

if (failures.length > 0) {
  console.error(`\nCanvas runtime verifier: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Canvas runtime verifier: ${passed} passed, 0 failed`);
