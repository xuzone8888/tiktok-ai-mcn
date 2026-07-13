#!/usr/bin/env node
/**
 * Super Canvas S7 focused verifier.
 *
 * Runs production state machines and guards for atomic hydration, privacy-safe monitoring,
 * writer lifecycle/StrictMode behavior, PATCH preparation, size thresholds, and boundary recovery.
 * React wiring is exercised through transpiled production components and deterministic stubs.
 */
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

function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

async function loadExtra(sourcePath, outputName, rewrites = {}, jsx = false) {
  mkdirSync(OUT, { recursive: true });
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
    fileName: sourcePath,
  });
  let code = addExt(outputText);
  for (const [from, to] of Object.entries(rewrites)) code = code.split(from).join(to);
  const outputPath = join(OUT, outputName);
  writeFileSync(outputPath, code, "utf8");
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
}

function storeSnapshot(state) {
  return JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    schemaVersion: state.schemaVersion,
    brokenNodes: state.brokenNodes,
    brokenEdges: state.brokenEdges,
    migratedFrom: state.migratedFrom,
    migrationComplete: state.migrationComplete,
    recoveryRequired: state.recoveryRequired,
    loadIssues: state.loadIssues,
    hydrated: state.hydrated,
    sessionCanvasId: state.sessionCanvasId,
    hydratedCanvasId: state.hydratedCanvasId,
    readOnly: state.readOnly,
    past: state.past,
    future: state.future,
    editAnchor: state.editAnchor,
    dragAnchor: state.dragAnchor,
  });
}

function makeWriterStatus(tag, canWrite, reason) {
  return {
    role: canWrite ? "writer" : "reader",
    canWrite,
    reason,
    tag,
    serverWriter: null,
    leaseMs: 30_000,
    heartbeatMs: 10_000,
  };
}

function makeFakeTimeoutScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function runDue() {
    while (true) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (due.length === 0) return;
      const [id, task] = due[0];
      tasks.delete(id);
      task.handler();
    }
  }

  return {
    setTimeout(handler, delayMs) {
      const id = nextId++;
      tasks.set(id, { handler, at: now + delayMs });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    advance(delayMs) {
      now += delayMs;
      runDue();
    },
    pendingCount: () => tasks.size,
  };
}

function makeSizedDoc(createCanvasNode, computeDocBytes, targetBytes) {
  const node = createCanvasNode({
    id: "sized_node",
    type: "text",
    position: { x: 0, y: 0 },
    data: { params: { payload: "" } },
  });
  const doc = { nodes: [node], edges: [], groups: [] };
  const base = computeDocBytes(doc);
  if (base > targetBytes) throw new Error(`target ${targetBytes} is below base ${base}`);
  node.data.params.payload = "x".repeat(targetBytes - base);
  if (computeDocBytes(doc) !== targetBytes) throw new Error("exact byte fixture failed");
  return doc;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const schema = await loadCanvasModule("schema");
  const limits = await loadCanvasModule("doc-limits");
  await loadCanvasModule("patch");
  await loadCanvasModule("api-types");
  await loadCanvasModule("writer-lock");
  await loadCanvasModule("api-helpers");
  await loadCanvasModule("history");
  await loadCanvasModule("group-ops");
  await loadCanvasModule("rf-adapter");
  const sizeControllerModule = await loadCanvasModule("canvas-size-controller");
  const saveModule = await loadCanvasModule("canvas-save-adapter");
  const lifecycleModule = await loadCanvasModule("canvas-writer-lifecycle");
  const commandModule = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-command-shortcuts.ts"),
    "canvas-command-shortcuts-s7.mjs"
  );
  const asyncSessionModule = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-async-session.ts"),
    "canvas-async-session-test.mjs"
  );

  writeFileSync(
    join(OUT, "logger-stub.mjs"),
    "export const createLogger=()=>({warn(){},error(){}});\n",
    "utf8"
  );
  const monitoringModule = await loadExtra(
    join(ROOT, "src", "lib", "canvas", "canvas-monitoring.ts"),
    "canvas-monitoring-test.mjs",
    { '"@/lib/logger"': '"./logger-stub.mjs"' }
  );
  const storeModule = await loadExtra(
    join(ROOT, "src", "stores", "canvas-store.ts"),
    "canvas-store.mjs",
    {
      '"@/lib/canvas/schema"': '"./schema.mjs"',
      '"@/lib/canvas/rf-adapter"': '"./rf-adapter.mjs"',
      '"@/lib/canvas/history"': '"./history.mjs"',
      '"@/lib/canvas/group-ops"': '"./group-ops.mjs"',
    }
  );

  const { createCanvasNode, loadCanvasDoc } = schema;
  const {
    DOC_BYTES_HARD_LIMIT,
    DOC_JSONB_WARN_LIMIT,
    checkDocSize,
    computeDocBytes,
  } = limits;
  const {
    CanvasSaveAdapter,
    canvasSaveAdapter: productionSaveAdapter,
    consumeCanvasPatchResponse,
  } = saveModule;
  const { createCanvasDocSizeController } = sizeControllerModule;
  const { createCanvasWriterLifecycle, resolveCanvasWriterSession } = lifecycleModule;
  const { decideCanvasCommand, isCanvasDocumentInteractionBlocked } = commandModule;
  const { CanvasAsyncSession, runGuardedCanvasTask } = asyncSessionModule;
  const { createCanvasErrorMonitor } = monitoringModule;
  const { connectCanvasSavePreparer, useCanvasStore } = storeModule;
  const state = () => useCanvasStore.getState();
  const canvasId = "11111111-1111-4111-8111-111111111111";
  const canvasIdB = "22222222-2222-4222-8222-222222222222";

  console.log("1. Atomic store hydration and recovery guard");
  state().reset();
  ok(state().hydrateFromDoc({ nodes: [], edges: [], groups: [] }) === true, "empty hydrate succeeds");
  state().setReadOnly(true);
  const before = storeSnapshot(state());
  const dangerous = loadCanvasDoc({
    nodes: [createCanvasNode({ id: "replacement", type: "text", position: { x: 1, y: 2 } })],
    edges: [],
    groups: [],
  });
  Object.defineProperty(dangerous, "issues", {
    configurable: true,
    get() {
      throw new Error("diagnostic getter failed");
    },
  });
  ok(state().hydrate(dangerous) === false, "throwing load result is rejected");
  eq(storeSnapshot(state()), before, "throwing hydrate rolls back every tracked field");

  const malformed = loadCanvasDoc({ nodes: [], edges: [], groups: [] });
  malformed.nodes = [{ id: "bad" }];
  ok(state().hydrate(malformed) === false, "malformed replacement is rejected");
  eq(storeSnapshot(state()), before, "malformed hydrate leaves state unchanged");
  ok(state().recoverCurrentState() === true, "boundary recovery revalidates current state");
  ok(state().readOnly === true, "recovery transaction preserves writer readOnly state");

  const descriptorFixture = loadCanvasDoc({
    nodes: [createCanvasNode({ id: "descriptor_node", type: "text", position: { x: 3, y: 4 } })],
    edges: [],
    groups: [],
  });
  const descriptorReads = new Map();
  const descriptorOnlyResult = new Proxy(descriptorFixture, {
    get() {
      throw new Error("hydrate must not use property get");
    },
    getOwnPropertyDescriptor(target, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  ok(state().hydrate(descriptorOnlyResult) === true, "descriptor-only load result hydrates");
  for (const field of [
    "nodes",
    "brokenNodes",
    "edges",
    "brokenEdges",
    "groups",
    "schemaVersion",
    "migratedFrom",
    "targetSchemaVersion",
    "migrationComplete",
    "recoveryRequired",
    "issues",
  ]) {
    eq(descriptorReads.get(field), 1, `top-level ${field} is snapshotted exactly once`);
  }
  descriptorFixture.nodes[0].position.x = 999;
  eq(state().nodes[0].position.x, 3, "hydrated domain nodes are detached from the source result");

  const stableHydration = storeSnapshot(state());
  for (const field of ["schemaVersion", "migrationComplete"]) {
    const accessorResult = loadCanvasDoc({ nodes: [], edges: [], groups: [] });
    let getterCalls = 0;
    Object.defineProperty(accessorResult, field, {
      configurable: true,
      get() {
        getterCalls += 1;
        return getterCalls === 1 ? descriptorFixture[field] : null;
      },
    });
    ok(state().hydrate(accessorResult) === false, `${field} accessor result is rejected`);
    eq(getterCalls, 0, `${field} accessor is never invoked`);
    eq(storeSnapshot(state()), stableHydration, `${field} accessor causes zero store writes`);
  }

  const brokenIdAccessor = loadCanvasDoc({
    nodes: [{ id: "broken_accessor", type: "unknown", position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
  });
  let brokenIdGetterCalls = 0;
  Object.defineProperty(brokenIdAccessor.brokenNodes[0], "id", {
    configurable: true,
    get() {
      brokenIdGetterCalls += 1;
      return brokenIdGetterCalls === 1 ? "broken_accessor" : "changed_accessor";
    },
  });
  ok(state().hydrate(brokenIdAccessor) === false, "broken id accessor is rejected");
  eq(brokenIdGetterCalls, 0, "broken id accessor is never invoked");
  eq(storeSnapshot(state()), stableHydration, "broken id accessor causes zero store writes");

  const liveState = state();
  const originalSchemaDescriptor = Object.getOwnPropertyDescriptor(liveState, "schemaVersion");
  const liveNodes = liveState.nodes;
  let recoverGetterCalls = 0;
  Object.defineProperty(liveState, "schemaVersion", {
    configurable: true,
    get() {
      recoverGetterCalls += 1;
      throw new Error("hostile recover state");
    },
  });
  ok(state().recoverCurrentState() === false, "hostile current state recovery fails closed");
  eq(recoverGetterCalls, 0, "recover does not invoke a state accessor");
  ok(state().nodes === liveNodes, "hostile recover performs zero domain writes");
  Object.defineProperty(liveState, "schemaVersion", originalSchemaDescriptor);

  const broken = loadCanvasDoc({
    nodes: [{ id: "broken_1", type: "unknown", position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
  });
  ok(state().hydrate(broken) === true, "tolerant broken document hydrates");
  ok(state().recoveryRequired && state().brokenNodes.length === 1, "broken document remains blocked");
  const brokenRaw = new Proxy({}, {
    ownKeys() {
      throw new Error("hostile raw payload");
    },
  });
  const brokenRawResult = loadCanvasDoc({
    nodes: [{ id: "broken_raw", type: "unknown", position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
  });
  brokenRawResult.brokenNodes[0].raw = brokenRaw;
  ok(state().hydrate(brokenRawResult) === true, "hostile broken raw payload is tolerantly omitted");
  ok(
    state().brokenNodes[0].raw === null &&
      state().brokenNodes[0].issues.some((issue) => issue.includes("not safely cloneable")),
    "omitted broken raw payload leaves a safe diagnostic"
  );

  const invariantBaseline = storeSnapshot(state());
  const duplicateNodeResult = loadCanvasDoc({ nodes: [], edges: [], groups: [] });
  const duplicateNode = createCanvasNode({ id: "duplicate_node", type: "text" });
  duplicateNodeResult.nodes = [duplicateNode, createCanvasNode({ id: "duplicate_node", type: "text" })];
  duplicateNodeResult.recoveryRequired = true;
  ok(state().hydrate(duplicateNodeResult) === false, "recovery cannot bypass duplicate node ids");

  const graphLeft = createCanvasNode({ id: "graph_left", type: "text" });
  const graphRight = createCanvasNode({ id: "graph_right", type: "text" });
  const duplicateEdgeResult = loadCanvasDoc({
    nodes: [graphLeft, graphRight],
    edges: [{ id: "duplicate_edge", source: graphLeft.id, target: graphRight.id }],
    groups: [],
  });
  duplicateEdgeResult.edges.push({ ...duplicateEdgeResult.edges[0] });
  duplicateEdgeResult.recoveryRequired = true;
  ok(state().hydrate(duplicateEdgeResult) === false, "recovery cannot bypass duplicate edge ids");

  const groupedNode = createCanvasNode({
    id: "grouped_node",
    type: "text",
    groupId: "duplicate_group",
  });
  const duplicateGroupResult = loadCanvasDoc({
    nodes: [groupedNode],
    edges: [],
    groups: [{ id: "duplicate_group", label: "", node_ids: [groupedNode.id] }],
  });
  duplicateGroupResult.groups.push({ ...duplicateGroupResult.groups[0] });
  duplicateGroupResult.recoveryRequired = true;
  ok(state().hydrate(duplicateGroupResult) === false, "recovery cannot bypass duplicate group ids");

  const mismatchNode = createCanvasNode({ id: "mismatch_node", type: "text" });
  const groupMismatchResult = loadCanvasDoc({ nodes: [mismatchNode], edges: [], groups: [] });
  groupMismatchResult.groups = [{ id: "mismatch_group", label: "", node_ids: [mismatchNode.id] }];
  groupMismatchResult.recoveryRequired = true;
  ok(state().hydrate(groupMismatchResult) === false, "recovery cannot bypass group membership mismatch");
  eq(storeSnapshot(state()), invariantBaseline, "all invariant counterexamples perform zero writes");

  const docA = {
    nodes: [createCanvasNode({ id: "canvas_a_node", type: "text" })],
    edges: [],
    groups: [],
  };
  const docB = {
    nodes: [createCanvasNode({ id: "canvas_b_node", type: "text" })],
    edges: [],
    groups: [],
  };
  state().reset();
  ok(state().beginCanvasSession(canvasId), "A session begins");
  ok(state().hydrateFromDoc(docA, undefined, canvasId), "A hydrates with explicit identity");
  state().setReadOnly(false);
  state().addNode({ id: "canvas_a_history", type: "text" });
  ok(state().past.length === 1, "A has session history before switch");
  ok(state().hydrateFromDoc(docB, canvasIdB), "B can preload before route switch");
  eq(state().sessionCanvasId, canvasId, "preloading B does not impersonate the requested A session");
  eq(state().hydratedCanvasId, canvasIdB, "preloaded document records B identity");
  ok(state().beginCanvasSession(canvasIdB), "runtime begins preloaded B session");
  eq(state().nodes.map((node) => node.id), ["canvas_b_node"], "matching preloaded B document is retained");
  ok(state().past.length === 0 && state().readOnly, "B starts with cleared history and read-only gate");

  ok(state().beginCanvasSession(canvasId), "switching back to unpreloaded A begins a fresh session");
  ok(
    !state().hydrated && state().nodes.length === 0 && state().hydratedCanvasId === null,
    "identity mismatch clears document, hydration, and recovery state"
  );
  ok(state().readOnly, "persistent identity remains read-only while unhydrated");
  ok(state().beginCanvasSession(null), "persistent to local switch begins local session");
  ok(state().initializeEmptyDoc(), "local session initializes a controlled empty document");
  ok(
    state().hydrated &&
      state().sessionCanvasId === null &&
      state().hydratedCanvasId === null &&
      state().nodes.length === 0,
    "local document has an explicit null identity"
  );

  const danglingEdgeDoc = {
    nodes: [createCanvasNode({ id: "edge_source", type: "text" })],
    edges: [{ id: "broken_edge_visible", source: "edge_source", target: "missing_target" }],
    groups: [],
  };
  ok(state().hydrateFromDoc(danglingEdgeDoc), "broken edge document remains inspectable");
  eq(state().brokenEdges.length, 1, "broken edge count is exposed for explicit recovery");
  state().setReadOnly(true);
  state().removeBrokenEdges();
  eq(state().brokenEdges.length, 1, "read-only cleanup cannot discard broken edges");
  state().setReadOnly(false);
  state().addNode({ id: "recovery_history", type: "text" });
  ok(state().past.length === 1, "recovery fixture has history to invalidate");
  state().removeBrokenEdges();
  ok(
    state().brokenEdges.length === 0 && !state().recoveryRequired && state().past.length === 0,
    "explicit broken-edge cleanup recomputes recovery and clears history"
  );

  console.log("2. Monitoring privacy, daily threshold, dedupe, and bounds");
  const events = [];
  const monitor = createCanvasErrorMonitor({
    sink: (event) => events.push(event),
    maxEntries: 3,
    now: () => new Date("2026-07-13T08:00:00.000Z"),
  });
  const sensitiveCanvasId = "canvas-secret-raw-id";
  const sensitiveError = new Error("prompt=private token=abc https://signed.example/file?sig=secret");
  const firstReport = await monitor.capture({
    canvasId: sensitiveCanvasId,
    error: sensitiveError,
    componentStack: "https://private.example/path",
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  const secondReport = await monitor.capture({
    canvasId: sensitiveCanvasId,
    error: sensitiveError,
    boundary: "canvas-critical-area",
    action: "recovery_failed",
  });
  const thirdReport = await monitor.capture({
    canvasId: sensitiveCanvasId,
    error: sensitiveError,
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  ok(firstReport.emitted && !firstReport.alerted && firstReport.count === 1, "first daily error records only");
  ok(secondReport.emitted && secondReport.alerted && secondReport.count === 2, "second daily error alerts");
  ok(!thirdReport.emitted && thirdReport.count === 3, "later daily duplicate is suppressed");
  eq(events.length, 2, "sink receives first event and one alert only");
  eq(
    Object.keys(events[0]).sort(),
    ["action", "boundary", "canvasId", "count", "date", "fingerprint"],
    "monitor event has privacy allowlist fields only"
  );
  const serializedEvents = JSON.stringify(events);
  ok(events[0].canvasId.startsWith("hash:"), "canvas identity is opaque");
  ok(events[0].fingerprint.startsWith("hash:"), "error is fingerprinted");
  ok(!serializedEvents.includes(sensitiveCanvasId), "raw canvas id is absent");
  ok(!serializedEvents.includes("prompt") && !serializedEvents.includes("token"), "prompt and token are absent");
  ok(!serializedEvents.includes("https://"), "URLs are absent");

  const digestInputSizes = [];
  const hugeEvents = [];
  const hugeMonitor = createCanvasErrorMonitor({
    sink: (event) => hugeEvents.push(event),
    subtle: {
      async digest(_algorithm, data) {
        digestInputSizes.push(data.byteLength);
        return new Uint8Array(32).buffer;
      },
    },
    now: () => new Date("2026-07-13T08:05:00.000Z"),
  });
  const hugeMarker = "RAW_MILLION_LINE_SECRET";
  const hugeError = new Error("bounded");
  Object.defineProperty(hugeError, "stack", {
    value: `${hugeMarker}\n${"frame\n".repeat(1_000_000)}`,
    configurable: true,
  });
  await hugeMonitor.capture({
    canvasId: "huge-monitor-canvas",
    error: hugeError,
    componentStack: `${hugeMarker}\n${"component\n".repeat(1_000_000)}`,
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  ok(Math.max(...digestInputSizes) < 512, "million-line inputs produce only bounded digest material");
  ok(!JSON.stringify(hugeEvents).includes(hugeMarker), "million-line event contains no original text");

  const boundaryLeakEvents = [];
  const boundaryLeakMonitor = createCanvasErrorMonitor({
    sink: (event) => boundaryLeakEvents.push(event),
    now: () => new Date("2026-07-13T08:10:00.000Z"),
  });
  await boundaryLeakMonitor.capture({
    canvasId: "boundary-leak-canvas",
    error: new Error("private"),
    boundary: "token_private_abc123",
    action: "render_error",
  });
  eq(boundaryLeakEvents[0].boundary, "canvas-critical-area", "unknown boundary maps to fixed safe default");
  ok(
    !JSON.stringify(boundaryLeakEvents).includes("token_private_abc123"),
    "boundary token cannot pass through to the sink"
  );

  let hostileErrorGetterCalls = 0;
  const hostileError = {};
  for (const key of ["name", "message", "stack"]) {
    Object.defineProperty(hostileError, key, {
      configurable: true,
      get() {
        hostileErrorGetterCalls += 1;
        throw new Error("hostile error getter");
      },
    });
  }
  const hostileClockEvents = [];
  const hostileClockMonitor = createCanvasErrorMonitor({
    sink: (event) => hostileClockEvents.push(event),
    now: () => new Proxy(new Date(), { get() { throw new Error("hostile clock"); } }),
  });
  const hostileCapture = await hostileClockMonitor.capture({
    canvasId: "hostile-monitor-canvas",
    error: hostileError,
    componentStack: "prompt=private component=https://private.invalid",
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  ok(hostileCapture.emitted, "hostile error and clock do not reject capture");
  eq(hostileErrorGetterCalls, 0, "monitor never invokes hostile error accessors");
  eq(hostileClockEvents[0].date, "1970-01-01", "hostile clock falls back to stable date bucket");
  ok(
    !JSON.stringify(hostileClockEvents).includes("private"),
    "hostile monitor input still emits allowlisted data only"
  );

  let hostileOptionGetterCalls = 0;
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, "sink", {
    get() {
      hostileOptionGetterCalls += 1;
      throw new Error("hostile option getter");
    },
  });
  const hostileOptionMonitor = createCanvasErrorMonitor(hostileOptions);
  const hostileInput = new Proxy({}, {
    get() {
      throw new Error("hostile capture get");
    },
    getOwnPropertyDescriptor() {
      throw new Error("hostile capture descriptor");
    },
  });
  const hostileInputResult = await hostileOptionMonitor.capture(hostileInput);
  ok(hostileInputResult.emitted, "hostile capture input resolves without throwing");
  eq(hostileOptionGetterCalls, 0, "monitor options accessors are never invoked");

  for (let index = 0; index < 6; index += 1) {
    await monitor.capture({
      canvasId: `canvas-${index}`,
      error: new Error(`error-${index}`),
      boundary: "canvas-critical-area",
      action: "render_error",
    });
  }
  ok(monitor.getEntryCount() === 3, "monitor counter map obeys maxEntries");

  let releaseBlockedSink;
  const blockedSink = new Promise((resolve) => {
    releaseBlockedSink = resolve;
  });
  const boundedMonitor = createCanvasErrorMonitor({
    maxEntries: 1,
    now: () => new Date("2026-07-13T08:30:00.000Z"),
    sink: async (event) => {
      if (event.count === 1) await blockedSink;
    },
  });
  const boundedCaptures = Array.from({ length: 6 }, (_, index) =>
    boundedMonitor.capture({
      canvasId: "bounded-pending-canvas",
      error: new Error(`bounded-${index}`),
      boundary: "canvas-critical-area",
      action: "render_error",
    })
  );
  const overflowResults = await Promise.all(boundedCaptures.slice(4));
  ok(overflowResults.every((result) => result.count === 0 && !result.emitted), "monitor drops work beyond bounded pending queue");
  releaseBlockedSink();
  await Promise.all(boundedCaptures.slice(0, 4));
  ok(boundedMonitor.getEntryCount() === 1, "bounded pending run still obeys counter-map limit");

  const concurrentEvents = [];
  const concurrentMonitor = createCanvasErrorMonitor({
    sink: (event) => concurrentEvents.push(event),
    now: () => new Date("2026-07-13T09:00:00.000Z"),
  });
  const [concurrentFirst, concurrentSecond] = await Promise.all([
    concurrentMonitor.capture({
      canvasId: "concurrent-canvas",
      error: new Error("first sensitive prompt"),
      boundary: "canvas-critical-area",
      action: "render_error",
    }),
    concurrentMonitor.capture({
      canvasId: "concurrent-canvas",
      error: new Error("second sensitive token"),
      boundary: "canvas-critical-area",
      action: "render_error",
    }),
  ]);
  eq(
    [concurrentFirst.count, concurrentSecond.count],
    [1, 2],
    "Promise.all captures reserve counts in invocation order"
  );
  ok(!concurrentFirst.alerted && concurrentSecond.alerted, "concurrent second capture alerts");
  eq(concurrentEvents.map((event) => event.count), [1, 2], "concurrent sink sees count 1 then 2");

  const signatureEvents = [];
  const signatureMonitor = createCanvasErrorMonitor({
    sink: (event) => signatureEvents.push(event),
    now: () => new Date("2026-07-13T10:00:00.000Z"),
  });
  const promptError = new Error("prompt=private-value");
  const tokenError = new Error("token=another-secret");
  promptError.stack = "Error\n at frame\n at frame";
  tokenError.stack = "Error\n at frame\n at frame";
  await signatureMonitor.capture({
    canvasId: "signature-a",
    error: promptError,
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  await signatureMonitor.capture({
    canvasId: "signature-b",
    error: tokenError,
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  eq(signatureEvents[0].fingerprint, signatureEvents[1].fingerprint, "fingerprint ignores sensitive message content");

  const fallbackEvents = [];
  let fallbackRandomCalls = 0;
  const fallbackMonitor = createCanvasErrorMonitor({
    subtle: null,
    maxEntries: 2,
    random: () => `randomtoken_${String(++fallbackRandomCalls).padStart(2, "0")}`,
    sink: (event) => fallbackEvents.push(event),
    now: () => new Date("2026-07-13T11:00:00.000Z"),
  });
  const rawFallbackA = "raw-fallback-canvas-a";
  const rawFallbackB = "raw-fallback-canvas-b";
  const [fallbackA, fallbackB] = await Promise.all([
    fallbackMonitor.capture({
      canvasId: rawFallbackA,
      error: new Error("a"),
      boundary: "canvas-critical-area",
      action: "render_error",
    }),
    fallbackMonitor.capture({
      canvasId: rawFallbackB,
      error: new Error("b"),
      boundary: "canvas-critical-area",
      action: "render_error",
    }),
  ]);
  eq([fallbackA.count, fallbackB.count], [1, 1], "no-crypto canvas buckets count independently");
  ok(!fallbackA.alerted && !fallbackB.alerted, "no-crypto first errors do not cross-alert");
  ok(
    fallbackEvents[0].canvasId.startsWith("opaque:") &&
      fallbackEvents[1].canvasId.startsWith("opaque:") &&
      fallbackEvents[0].canvasId !== fallbackEvents[1].canvasId,
    "no-crypto canvas buckets use distinct random opaque tokens"
  );
  const fallbackSerialized = JSON.stringify(fallbackEvents);
  ok(!fallbackSerialized.includes(rawFallbackA) && !fallbackSerialized.includes(rawFallbackB), "no-crypto events never expose raw canvas ids");

  const fallbackASecond = await fallbackMonitor.capture({
    canvasId: rawFallbackA,
    error: new Error("a2"),
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  ok(fallbackASecond.count === 2 && fallbackASecond.alerted, "no-crypto same canvas still alerts on second error");
  const tokenBeforeReset = fallbackEvents[0].canvasId;
  fallbackMonitor.reset();
  const fallbackAfterReset = await fallbackMonitor.capture({
    canvasId: rawFallbackA,
    error: new Error("a3"),
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  const tokenAfterReset = fallbackEvents.at(-1).canvasId;
  ok(fallbackAfterReset.count === 1 && !fallbackAfterReset.alerted, "reset clears no-crypto counts");
  ok(tokenAfterReset !== tokenBeforeReset, "reset clears raw-id opaque mapping");

  await fallbackMonitor.capture({
    canvasId: rawFallbackB,
    error: new Error("b2"),
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  await fallbackMonitor.capture({
    canvasId: "raw-fallback-canvas-c",
    error: new Error("c"),
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  const fallbackAfterEviction = await fallbackMonitor.capture({
    canvasId: rawFallbackA,
    error: new Error("a4"),
    boundary: "canvas-critical-area",
    action: "render_error",
  });
  ok(fallbackAfterEviction.count === 1, "no-crypto LRU evicts identity and count buckets at shared capacity");
  ok(fallbackRandomCalls === 6, "no-crypto opaque mapping allocation is LRU-bounded and deterministic in test");

  const asyncWrites = [];
  const asyncToasts = [];
  let resolveOldUpload;
  let rejectOldUpload;
  const oldSuccessPromise = new Promise((resolve) => {
    resolveOldUpload = resolve;
  });
  const oldFailurePromise = new Promise((_resolve, reject) => {
    rejectOldUpload = reject;
  });
  const boardSessionA = new CanvasAsyncSession(true);
  const oldSuccessTask = runGuardedCanvasTask(boardSessionA, oldSuccessPromise, {
    onSuccess: (value) => asyncWrites.push(value),
    onError: (error) => asyncToasts.push(error),
  });
  const oldFailureTask = runGuardedCanvasTask(boardSessionA, oldFailurePromise, {
    onSuccess: (value) => asyncWrites.push(value),
    onError: (error) => asyncToasts.push(error),
  });
  boardSessionA.invalidate();
  const boardSessionB = new CanvasAsyncSession(true);
  const liveBTask = runGuardedCanvasTask(boardSessionB, Promise.resolve("B upload"), {
    onSuccess: (value) => asyncWrites.push(value),
    onError: (error) => asyncToasts.push(error),
  });
  resolveOldUpload("A upload");
  rejectOldUpload(new Error("A failed after switch"));
  await Promise.all([oldSuccessTask, oldFailureTask, liveBTask]);
  eq(asyncWrites, ["B upload"], "deferred A success cannot add a node after Board switches to B");
  eq(asyncToasts, [], "deferred A rejection cannot toast into B session");

  console.log("3. Writer lifecycle status mapping, tag binding, stop, and StrictMode");
  const writerAdapter = new CanvasSaveAdapter();
  const controllers = [];
  const readOnlyTransitions = [];
  const factory = (id, onStatusChange) => {
    const index = controllers.length + 1;
    const controller = {
      tag: `writer_tag_${index}`,
      starts: 0,
      stops: 0,
      emit(next) {
        onStatusChange(next);
      },
      getStatus() {
        return makeWriterStatus(this.tag, false, "starting");
      },
      start() {
        this.starts += 1;
        this.emit(makeWriterStatus(this.tag, false, "starting"));
      },
      async stop() {
        this.stops += 1;
      },
      refresh() {},
      canvasId: id,
    };
    controllers.push(controller);
    return controller;
  };
  const lifecycle = createCanvasWriterLifecycle({
    saveAdapter: writerAdapter,
    createController: factory,
    setReadOnly: (value) => readOnlyTransitions.push(value),
    onStatusChange: () => {},
  });

  ok((await lifecycle.start(null)) === false, "missing canvasId does not start writer");
  eq(controllers.length, 0, "missing canvasId creates no controller");
  ok(writerAdapter.getActiveWriter() === null, "missing canvasId exposes no writer tag");
  ok(readOnlyTransitions.at(-1) === false, "local unpersisted mode remains locally editable");

  ok((await lifecycle.start(canvasId)) === true, "real canvasId starts controller");
  const firstController = controllers[0];
  ok(readOnlyTransitions.at(-1) === true, "starting is read-only");
  firstController.emit(makeWriterStatus(firstController.tag, true, "acquired"));
  ok(readOnlyTransitions.at(-1) === false, "active writer restores write access");
  eq(
    writerAdapter.getActiveWriter(),
    { canvasId, writerTag: firstController.tag },
    "active writer tag is exposed through the single save adapter"
  );
  for (const reason of ["held-by-other-tab", "held-by-server", "no-locks-api", "error"]) {
    firstController.emit(makeWriterStatus(firstController.tag, false, reason));
    ok(readOnlyTransitions.at(-1) === true, `${reason} maps to read-only`);
    ok(writerAdapter.getActiveWriter() === null, `${reason} clears writer tag`);
  }
  firstController.emit(makeWriterStatus(firstController.tag, true, "acquired"));
  ok(readOnlyTransitions.at(-1) === false, "only acquired writer recovers write access");
  await lifecycle.stop();
  ok(firstController.stops === 1, "stop reaches controller once");
  ok(readOnlyTransitions.at(-1) === true && writerAdapter.getActiveWriter() === null, "stop fails closed");

  const strictControllers = [];
  const strictAdapter = new CanvasSaveAdapter();
  const strictLifecycle = createCanvasWriterLifecycle({
    saveAdapter: strictAdapter,
    createController: (id, onStatusChange) => {
      const controller = {
        tag: `strict_tag_${strictControllers.length + 1}`,
        starts: 0,
        stops: 0,
        start() {
          this.starts += 1;
          onStatusChange(makeWriterStatus(this.tag, false, "starting"));
        },
        async stop() {
          this.stops += 1;
        },
        getStatus() {
          return makeWriterStatus(this.tag, false, "starting");
        },
        refresh() {},
        emit(next) {
          onStatusChange(next);
        },
        canvasId: id,
      };
      strictControllers.push(controller);
      return controller;
    },
    setReadOnly: () => {},
    onStatusChange: () => {},
  });
  const strictStart1 = strictLifecycle.start(canvasId);
  const strictStop = strictLifecycle.stop();
  const strictStart2 = strictLifecycle.start(canvasId);
  await Promise.all([strictStart1, strictStop, strictStart2]);
  eq(strictControllers.length, 1, "StrictMode start-stop-start creates one live controller");
  eq(strictControllers[0].starts, 1, "StrictMode live controller starts once");
  strictControllers[0].emit(makeWriterStatus(strictControllers[0].tag, true, "acquired"));
  eq(strictAdapter.getActiveWriter()?.writerTag, strictControllers[0].tag, "StrictMode binds live tag");
  const stale = strictControllers[0];
  const stopOld = strictLifecycle.stop();
  const startNew = strictLifecycle.start(canvasId);
  stale.emit(makeWriterStatus(stale.tag, true, "acquired"));
  await Promise.all([stopOld, startNew]);
  ok(strictAdapter.getActiveWriter() === null, "stale controller cannot revive writer during restart");
  ok(strictControllers.length === 2, "restart creates a fresh controller after stop barrier");
  const live = strictControllers[1];
  live.emit(makeWriterStatus(live.tag, true, "acquired"));
  eq(strictAdapter.getActiveWriter()?.writerTag, live.tag, "fresh controller owns writer tag");
  stale.emit(makeWriterStatus(stale.tag, true, "acquired"));
  eq(strictAdapter.getActiveWriter()?.writerTag, live.tag, "late stale status cannot replace fresh tag");
  await strictLifecycle.stop();
  await strictLifecycle.stop();
  eq(live.stops, 1, "repeated stop is idempotent for the live controller");

  const acquiredA = makeWriterStatus("render_tag_a", true, "acquired");
  const switchedFirstFrame = resolveCanvasWriterSession(canvasIdB, canvasId, acquiredA);
  ok(
    switchedFirstFrame.persistent &&
      switchedFirstFrame.status === null &&
      !switchedFirstFrame.canEdit,
    "A to B render frame cannot expose A acquired state"
  );
  const localFirstFrame = resolveCanvasWriterSession(null, canvasId, acquiredA);
  ok(
    !localFirstFrame.persistent && localFirstFrame.status === null && localFirstFrame.canEdit,
    "local draft render remains editable without a writer status"
  );
  const startingB = resolveCanvasWriterSession(
    canvasIdB,
    canvasIdB,
    makeWriterStatus("render_tag_b", false, "starting")
  );
  ok(!startingB.canEdit, "matching persisted session stays gated while lease is starting");
  const acquiredB = resolveCanvasWriterSession(
    canvasIdB,
    canvasIdB,
    makeWriterStatus("render_tag_b", true, "acquired")
  );
  ok(acquiredB.canEdit, "matching acquired persisted session opens the render gate");
  const ownerAdapter = new CanvasSaveAdapter();
  const oldOwner = {};
  const newOwner = {};
  ownerAdapter.beginWriterSession(oldOwner);
  ok(
    ownerAdapter.activateWriter(oldOwner, { canvasId, writerTag: "owner_tag_old" }),
    "current adapter owner can activate"
  );
  ownerAdapter.beginWriterSession(newOwner);
  ok(ownerAdapter.getActiveWriter() === null, "new adapter session clears previous owner synchronously");
  ok(
    !ownerAdapter.activateWriter(oldOwner, { canvasId, writerTag: "owner_tag_stale" }),
    "stale adapter owner cannot reactivate"
  );
  ok(
    ownerAdapter.activateWriter(newOwner, { canvasId: canvasIdB, writerTag: "owner_tag_new" }),
    "new adapter owner can activate B"
  );
  ownerAdapter.clearWriter(oldOwner);
  eq(ownerAdapter.getActiveWriter()?.canvasId, canvasIdB, "old cleanup cannot clear new owner");
  const gateReadOnly = isCanvasDocumentInteractionBlocked(false, false);
  ok(gateReadOnly, "interaction gate blocks document shortcuts even before store readOnly commits");
  eq(
    decideCanvasCommand(
      {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      },
      {
        inCanvasContext: true,
        targetInteractive: false,
        composing: false,
        readOnly: gateReadOnly,
      }
    ),
    { kind: "ignore" },
    "global document key handler ignores undo while interaction gate is closed"
  );

  const switchAdapter = new CanvasSaveAdapter();
  const switchControllers = [];
  const switchReadOnly = [];
  const switchLifecycle = createCanvasWriterLifecycle({
    saveAdapter: switchAdapter,
    setReadOnly: (value) => switchReadOnly.push(value),
    onStatusChange: () => {},
    createController: (id, onStatusChange) => {
      const controller = {
        tag: `switch_tag_${switchControllers.length + 1}`,
        canvasId: id,
        start() {
          onStatusChange(makeWriterStatus(this.tag, false, "starting"));
        },
        stop: async () => {},
        refresh() {},
        getStatus() {
          return makeWriterStatus(this.tag, false, "starting");
        },
        emit(next) {
          onStatusChange(next);
        },
      };
      switchControllers.push(controller);
      return controller;
    },
  });
  await switchLifecycle.start(canvasId);
  switchControllers[0].emit(makeWriterStatus(switchControllers[0].tag, true, "acquired"));
  ok(switchAdapter.getActiveWriter()?.canvasId === canvasId, "switch fixture owns canvas A");
  const switchToB = switchLifecycle.start(canvasIdB);
  ok(switchAdapter.getActiveWriter() === null, "B commit synchronously clears A writer owner");
  ok(switchReadOnly.at(-1) === true && switchLifecycle.getStatus() === null, "B commit synchronously fails closed");
  switchControllers[0].emit(makeWriterStatus(switchControllers[0].tag, true, "acquired"));
  ok(switchAdapter.getActiveWriter() === null, "A callback cannot revive its tag during B commit");
  await switchToB;
  eq(switchControllers.length, 2, "B controller starts after A stop barrier");
  switchControllers[1].emit(makeWriterStatus(switchControllers[1].tag, true, "acquired"));
  eq(switchAdapter.getActiveWriter()?.canvasId, canvasIdB, "only B acquired status binds after switch");
  switchControllers[0].emit(makeWriterStatus(switchControllers[0].tag, true, "acquired"));
  eq(switchAdapter.getActiveWriter()?.canvasId, canvasIdB, "late A callback cannot replace B owner");
  await switchLifecycle.stop();

  const stopTimeouts = makeFakeTimeoutScheduler();
  const hangingAdapter = new CanvasSaveAdapter();
  const hangingControllers = [];
  const hangingLifecycle = createCanvasWriterLifecycle({
    saveAdapter: hangingAdapter,
    stopTimeoutMs: 50,
    scheduler: stopTimeouts,
    setReadOnly: () => {},
    onStatusChange: () => {},
    createController: (id, onStatusChange) => {
      const index = hangingControllers.length;
      const controller = {
        tag: `hanging_tag_${index + 1}`,
        canvasId: id,
        start() {
          onStatusChange(makeWriterStatus(this.tag, false, "starting"));
        },
        stop() {
          return index === 0 ? new Promise(() => {}) : Promise.resolve();
        },
        refresh() {},
        getStatus() {
          return makeWriterStatus(this.tag, false, "starting");
        },
        emit(next) {
          onStatusChange(next);
        },
      };
      hangingControllers.push(controller);
      return controller;
    },
  });
  await hangingLifecycle.start(canvasId);
  hangingControllers[0].emit(makeWriterStatus(hangingControllers[0].tag, true, "acquired"));
  const hangingSwitch = hangingLifecycle.start(canvasIdB);
  ok(hangingAdapter.getActiveWriter() === null, "hanging stop still clears old owner immediately");
  await flushPromises();
  stopTimeouts.advance(49);
  await flushPromises();
  eq(hangingControllers.length, 1, "new controller waits before bounded stop timeout");
  stopTimeouts.advance(1);
  await flushPromises();
  await hangingSwitch;
  eq(hangingControllers.length, 2, "bounded stop timeout releases the new session");
  hangingControllers[0].emit(makeWriterStatus(hangingControllers[0].tag, true, "acquired"));
  ok(hangingAdapter.getActiveWriter() === null, "timed-out stale controller cannot revive a tag");
  hangingControllers[1].emit(makeWriterStatus(hangingControllers[1].tag, true, "acquired"));
  eq(hangingAdapter.getActiveWriter()?.canvasId, canvasIdB, "post-timeout live controller can acquire B");
  await hangingLifecycle.stop();

  console.log("4. Debounced document-size controller");
  const fakeTimeouts = makeFakeTimeoutScheduler();
  let sizeComputations = 0;
  let stableNotifications = 0;
  const initialSizeDoc = { nodes: [], edges: [], groups: [] };
  const sizeController = createCanvasDocSizeController({
    initial: initialSizeDoc,
    delayMs: 400,
    scheduler: fakeTimeouts,
    compute: (doc) => {
      sizeComputations += 1;
      return checkDocSize(doc);
    },
  });
  ok(sizeComputations === 1, "initial snapshot is computed synchronously once");
  sizeController.subscribe(() => {
    stableNotifications += 1;
  });
  let latestSizeDoc = initialSizeDoc;
  for (let index = 0; index < 20; index += 1) {
    latestSizeDoc = {
      nodes: [
        createCanvasNode({
          id: `debounced_${index}`,
          type: "text",
          position: { x: index, y: index },
          data: { params: { payload: "x".repeat(index * 10) } },
        }),
      ],
      edges: [],
      groups: [],
    };
    sizeController.update(latestSizeDoc);
  }
  ok(fakeTimeouts.pendingCount() === 1, "continuous updates retain one trailing timer");
  ok(sizeComputations === 1 && stableNotifications === 0, "drag frames do not serialize or announce");
  fakeTimeouts.advance(399);
  ok(sizeComputations === 1 && stableNotifications === 0, "399ms remains debounced");
  fakeTimeouts.advance(1);
  ok(sizeComputations === 2 && stableNotifications === 1, "400ms computes and announces once");
  eq(
    sizeController.getCurrent().bytes,
    checkDocSize(latestSizeDoc).bytes,
    "trailing computation uses latest snapshot"
  );
  sizeController.update(initialSizeDoc);
  ok(fakeTimeouts.pendingCount() === 1, "post-flush update schedules timer");
  sizeController.dispose();
  ok(fakeTimeouts.pendingCount() === 0, "dispose clears pending timer");
  fakeTimeouts.advance(1000);
  ok(sizeComputations === 2 && stableNotifications === 1, "disposed controller never computes or announces");

  console.log("5. Save adapter, recovery block, size boundaries, and DOC_TOO_LARGE mapping");
  const saveAdapter = new CanvasSaveAdapter();
  const feedbackEvents = [];
  saveAdapter.subscribe((event) => feedbackEvents.push(event));
  const disconnect = connectCanvasSavePreparer((storeState, input) =>
    saveAdapter.preparePatch(storeState, input)
  );
  const owner = {};
  saveAdapter.beginWriterSession(owner);
  ok(saveAdapter.activateWriter(owner, { canvasId, writerTag: "writer_tag_save" }), "valid writer binds");

  state().beginCanvasSession(canvasId);
  state().hydrateFromDoc(danglingEdgeDoc, undefined, canvasId);
  state().setReadOnly(false);
  useCanvasStore.setState({ recoveryRequired: false });
  const bypassAttempt = state().preparePatchSave({ baseRev: 0, ops: [] });
  ok(!bypassAttempt.ok && bypassAttempt.error.code === "CANVAS_DOC_INVALID", "broken entities block save even if flag is forced false");

  const exactWarn = makeSizedDoc(createCanvasNode, computeDocBytes, DOC_JSONB_WARN_LIMIT);
  ok(state().hydrate(loadCanvasDoc(exactWarn), canvasId) === true, "exact warning fixture hydrates");
  state().setReadOnly(false);
  const atWarn = state().preparePatchSave({ baseRev: 3, ops: [] });
  ok(atWarn.ok && atWarn.warning === null, "exactly 512KB is allowed without warning");

  const overWarn = makeSizedDoc(createCanvasNode, computeDocBytes, DOC_JSONB_WARN_LIMIT + 1);
  ok(state().hydrate(loadCanvasDoc(overWarn), canvasId) === true, "over-warning fixture hydrates");
  state().setReadOnly(false);
  const warned = state().preparePatchSave({ baseRev: 3, ops: [] });
  ok(warned.ok && warned.warning?.code === "DOC_SIZE_WARNING", "512KB + 1 is soft warning only");
  ok(state().readOnly === false, "soft warning does not make canvas read-only");
  if (warned.ok) {
    ok(warned.request.init.method === "PATCH", "adapter constructs real PATCH request metadata");
    const body = JSON.parse(warned.request.init.body);
    eq(body.writerTag, "writer_tag_save", "PATCH body gets tag only from active writer adapter");
    eq(warned.request.url, `/api/canvas/${canvasId}`, "PATCH URL uses real supplied canvasId");
  }

  const exactHard = makeSizedDoc(createCanvasNode, computeDocBytes, DOC_BYTES_HARD_LIMIT);
  ok(checkDocSize(exactHard).ok, "exactly 2MB passes shared size guard");
  ok(state().hydrate(loadCanvasDoc(exactHard), canvasId) === true, "exact hard fixture hydrates");
  state().setReadOnly(false);
  const atHard = state().preparePatchSave({ baseRev: 3, ops: [] });
  ok(atHard.ok, "exactly 2MB prepares PATCH");

  const overHard = makeSizedDoc(createCanvasNode, computeDocBytes, DOC_BYTES_HARD_LIMIT + 1);
  ok(!checkDocSize(overHard).ok, "2MB + 1 fails shared size guard");
  ok(state().hydrate(loadCanvasDoc(overHard), canvasId) === true, "over-hard fixture remains inspectable in store");
  state().setReadOnly(false);
  const rejected = state().preparePatchSave({ baseRev: 3, ops: [] });
  ok(!rejected.ok && rejected.error.code === "DOC_TOO_LARGE", "2MB + 1 is rejected before PATCH");
  ok(feedbackEvents.at(-1)?.code === "DOC_TOO_LARGE", "hard rejection maps to root toast feedback code");
  const productionFeedback = [];
  const unsubscribeProductionFeedback = productionSaveAdapter.subscribe((event) =>
    productionFeedback.push(event)
  );
  const productionOwner = {};
  productionSaveAdapter.beginWriterSession(productionOwner);
  ok(
    productionSaveAdapter.activateWriter(productionOwner, {
      canvasId,
      writerTag: "production_feedback_tag",
    }),
    "production feedback fixture binds writer"
  );
  const productionLocalTooLarge = productionSaveAdapter.preparePatch(state(), {
    baseRev: 3,
    ops: [],
  });
  ok(
    !productionLocalTooLarge.ok && productionLocalTooLarge.error.code === "DOC_TOO_LARGE",
    "production adapter emits local hard-limit rejection"
  );
  const productionLocalFeedback = productionFeedback.at(-1);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("S7 preparation must not execute fetch");
  };
  const mapped = consumeCanvasPatchResponse({
    success: false,
    code: "DOC_TOO_LARGE",
    error: "server size rejection",
  });
  ok(
    mapped?.code === "DOC_TOO_LARGE" && mapped.title.length > 0,
    "production response consumer maps server DOC_TOO_LARGE"
  );
  eq(productionFeedback.at(-1)?.code, "DOC_TOO_LARGE", "production response consumer reaches bridge toast channel");
  eq(
    productionFeedback.at(-1)?.title,
    productionLocalFeedback?.title,
    "local and server hard-limit failures share one toast title contract"
  );

  ok(state().hydrate(loadCanvasDoc({ nodes: [], edges: [], groups: [] }), canvasId) === true, "healthy doc restored");
  state().setReadOnly(false);
  const preparedOnly = state().preparePatchSave({ baseRev: 4, ops: [] });
  ok(preparedOnly.ok && preparedOnly.request.init.method === "PATCH", "healthy state only prepares PATCH metadata");
  const identityMismatch = saveAdapter.preparePatch(
    { ...state(), hydratedCanvasId: canvasIdB },
    { baseRev: 4, ops: [] }
  );
  ok(
    !identityMismatch.ok && identityMismatch.error.code === "CANVAS_IDENTITY_MISMATCH",
    "preparePatch rejects a document identity that differs from the active writer"
  );
  let hostilePatchGetterCalls = 0;
  const hostilePatchInput = {};
  for (const field of ["baseRev", "ops", "title", "deps"]) {
    Object.defineProperty(hostilePatchInput, field, {
      get() {
        hostilePatchGetterCalls += 1;
        throw new Error(`hostile ${field}`);
      },
    });
  }
  const hostilePatchResult = saveAdapter.preparePatch(state(), hostilePatchInput);
  ok(
    !hostilePatchResult.ok && hostilePatchResult.error.code === "INVALID_BODY",
    "hostile PATCH input fails closed without throwing"
  );
  eq(hostilePatchGetterCalls, 0, "preparePatch never invokes hostile field getters");
  eq(fetchCalls, 0, "prepare and response consumption execute no network request");
  globalThis.fetch = originalFetch;
  productionSaveAdapter.clearWriter(productionOwner);
  unsubscribeProductionFeedback();

  saveAdapter.clearWriter(owner);
  const noWriter = state().preparePatchSave({ baseRev: 0, ops: [] });
  ok(!noWriter.ok && noWriter.error.code === "NO_ACTIVE_WRITER", "no writer means no PATCH construction");
  disconnect();

  console.log("6. Boundary behavior and client wiring");
  writeFileSync(
    join(OUT, "ui-stub.mjs"),
    "export const Button=()=>null;export const Tooltip=()=>null;export const TooltipContent=()=>null;export const TooltipProvider=()=>null;export const TooltipTrigger=()=>null;\n",
    "utf8"
  );
  writeFileSync(
    join(OUT, "icons-stub.mjs"),
    "export const LoaderCircle=()=>null;export const RefreshCw=()=>null;export const RotateCcw=()=>null;\n",
    "utf8"
  );
  writeFileSync(
    join(OUT, "monitor-stub.mjs"),
    "export const canvasErrorMonitor={capture:async()=>({emitted:true,alerted:false,count:1})};\n",
    "utf8"
  );
  const boundaryModule = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-error-boundary.tsx"),
    "canvas-error-boundary-test.mjs",
    {
      '"@/components/ui/button"': '"./ui-stub.mjs"',
      '"@/components/ui/tooltip"': '"./ui-stub.mjs"',
      '"@/lib/canvas/canvas-monitoring"': '"./monitor-stub.mjs"',
      '"lucide-react"': '"./icons-stub.mjs"',
    },
    true
  );
  const { CanvasErrorBoundary } = boundaryModule;
  const boundaryEvents = [];
  let recoverCalls = 0;
  let reloadCalls = 0;
  let resolveRecovery;
  const pendingRecovery = new Promise((resolve) => {
    resolveRecovery = resolve;
  });
  const boundary = new CanvasErrorBoundary({
    children: null,
    canvasId,
    onRecover: () => {
      recoverCalls += 1;
      return pendingRecovery;
    },
    onReload: () => {
      reloadCalls += 1;
    },
    monitor: { capture: async (event) => boundaryEvents.push(event) },
  });
  boundary.state = { error: new Error("render"), recovering: false };
  boundary.setState = function setState(update, callback) {
    const next = typeof update === "function" ? update(this.state, this.props) : update;
    this.state = { ...this.state, ...next };
    if (callback) callback();
  };
  const initialFallback = boundary.render();
  eq(initialFallback.props.role, "alert", "fallback exposes alert semantics");
  eq(initialFallback.props.tabIndex, -1, "fallback is programmatically focusable");
  ok(initialFallback.props["aria-busy"] === false, "idle fallback is not busy");
  let fallbackFocusCalls = 0;
  boundary.focusFallback({ focus: () => { fallbackFocusCalls += 1; } });
  eq(fallbackFocusCalls, 1, "fallback moves focus when it appears");
  const originalBoundaryError = boundary.state.error;
  boundary.handleRecover();
  ok(
    recoverCalls === 1 &&
      boundary.state.error === originalBoundaryError &&
      boundary.state.recovering === true,
    "pending recovery keeps fallback error mounted with spinner"
  );
  ok(boundary.render().props["aria-busy"] === true, "pending fallback exposes aria-busy");
  await flushPromises();
  ok(boundary.state.error === originalBoundaryError, "children remain blocked while recovery promise is pending");
  resolveRecovery(true);
  await flushPromises();
  ok(recoverCalls === 1 && boundary.state.error === null, "recover clears current error and invokes controlled callback");
  boundary.handleReload();
  ok(reloadCalls === 1, "reload callback runs only after explicit handler invocation");
  boundary.componentDidCatch(new Error("caught"), { componentStack: "stack" });
  await flushPromises();
  ok(boundaryEvents.at(-1)?.action === "render_error", "componentDidCatch reaches monitor adapter");

  const failedBoundary = new CanvasErrorBoundary({
    children: null,
    canvasId,
    onRecover: () => {
      throw new Error("controlled failure");
    },
    monitor: { capture: async (event) => boundaryEvents.push(event) },
  });
  failedBoundary.state = { error: new Error("render"), recovering: false };
  failedBoundary.setState = boundary.setState;
  failedBoundary.handleRecover();
  await flushPromises();
  ok(failedBoundary.state.error?.message === "render", "failed recovery preserves original fallback error");
  ok(boundaryEvents.at(-1)?.action === "recovery_failed", "failed recovery is fingerprinted by monitor");

  let rejectStaleRecovery;
  const staleRecovery = new Promise((_resolve, reject) => {
    rejectStaleRecovery = reject;
  });
  const staleBoundaryEvents = [];
  const staleBoundary = new CanvasErrorBoundary({
    children: null,
    canvasId,
    onRecover: () => staleRecovery,
    monitor: { capture: async (event) => staleBoundaryEvents.push(event) },
  });
  staleBoundary.state = { error: new Error("A render"), recovering: false };
  let staleStateWrites = 0;
  staleBoundary.setState = function setState(update, callback) {
    staleStateWrites += 1;
    const next = typeof update === "function" ? update(this.state, this.props) : update;
    this.state = { ...this.state, ...next };
    if (callback) callback();
  };
  staleBoundary.handleRecover();
  staleBoundary.componentWillUnmount();
  staleBoundary.props = { ...staleBoundary.props, canvasId: canvasIdB };
  rejectStaleRecovery(new Error("late A recovery failure"));
  await flushPromises();
  eq(staleStateWrites, 1, "unmounted A recovery promise cannot update the replacement boundary");
  eq(staleBoundaryEvents, [], "late A recovery failure is never monitored as B");

  const fallbackElements = [];
  const visitElement = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visitElement);
      return;
    }
    if (!value || typeof value !== "object" || !value.props) return;
    fallbackElements.push(value);
    visitElement(value.props.children);
  };
  visitElement(initialFallback);
  eq(
    fallbackElements.filter((element) => typeof element.props["aria-label"] === "string").length,
    2,
    "fallback exposes labelled recovery and reload commands"
  );

  writeFileSync(
    join(OUT, "root-store-stub.mjs"),
    `let state={hydrated:false,sessionCanvasId:null,hydratedCanvasId:null,readOnly:true,beginCanvasSession(){return true},recoverCurrentState(){return false},initializeEmptyDoc(){return false},setReadOnly(){}};
export function setRootStoreState(next){state=next}
export function useCanvasStore(selector){return selector(state)}
useCanvasStore.getState=()=>state;
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "root-writer-hook-stub.mjs"),
    `let session={canvasId:null,status:null,persistent:false,canEdit:true};
export function setWriterSession(next){session=next}
export function useCanvasWriterLock(){return session}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "root-xyflow-stub.mjs"),
    "export function ReactFlowProvider({children}){return children}\n",
    "utf8"
  );
  writeFileSync(join(OUT, "canvas-board.mjs"), "export function CanvasBoard(){return null}\n", "utf8");
  writeFileSync(
    join(OUT, "canvas-error-boundary.mjs"),
    `import {createElement} from "react";
export function CanvasErrorBoundary({children}){return createElement("section",{"data-test-boundary":"true"},children)}
`,
    "utf8"
  );
  writeFileSync(join(OUT, "canvas-health-banners.mjs"), "export function CanvasHealthBanners(){return null}\n", "utf8");
  writeFileSync(join(OUT, "canvas-save-feedback-bridge.mjs"), "export function CanvasSaveFeedbackBridge(){return null}\n", "utf8");

  const rootModule = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-root.tsx"),
    "canvas-root-test.mjs",
    {
      'import "@xyflow/react/dist/style.css";': "",
      '"@xyflow/react"': '"./root-xyflow-stub.mjs"',
      '"@/stores/canvas-store"': '"./root-store-stub.mjs"',
      '"@/lib/canvas/canvas-writer-lifecycle"': '"./canvas-writer-lifecycle.mjs"',
      '"./use-canvas-writer-lock.mjs"': '"./root-writer-hook-stub.mjs"',
    },
    true
  );
  ok(
    /<CanvasErrorBoundary\s+key=\{runtimeKey\}/.test(
      readFileSync(join(ROOT, "src", "components", "canvas", "canvas-root.tsx"), "utf8")
    ),
    "runtimeKey is applied to CanvasErrorBoundary itself"
  );
  const rootStoreStub = await import(pathToFileURL(join(OUT, "root-store-stub.mjs")).href);
  const rootWriterStub = await import(pathToFileURL(join(OUT, "root-writer-hook-stub.mjs")).href);
  const reactModule = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");

  rootWriterStub.setWriterSession({
    canvasId: null,
    status: null,
    persistent: false,
    canEdit: true,
  });
  rootStoreStub.setRootStoreState({
    hydrated: true,
    sessionCanvasId: null,
    hydratedCanvasId: null,
    readOnly: false,
    beginCanvasSession: () => true,
    recoverCurrentState: () => true,
    initializeEmptyDoc: () => true,
    setReadOnly: () => {},
  });
  const rootedMarkup = renderToStaticMarkup(
    reactModule.createElement(rootModule.CanvasRoot, { canvasId: null })
  );
  ok(
    rootedMarkup.indexOf("data-test-boundary") >= 0 &&
      rootedMarkup.indexOf("data-test-boundary") < rootedMarkup.indexOf("data-canvas-root"),
    "rendered error boundary wraps the complete runtime subtree"
  );

  writeFileSync(
    join(OUT, "health-store-stub.mjs"),
    `let cleanupCalls=0;
const state={nodes:[],edges:[],groups:[],recoveryRequired:true,loadIssues:["issue"],brokenEdges:[{id:"broken_1"},{id:"broken_2"}],readOnly:false,removeBrokenEdges(){cleanupCalls+=1}};
export function useCanvasStore(selector){return selector(state)}
export function getHealthCleanupCalls(){return cleanupCalls}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "health-doc-limits-stub.mjs"),
    `export function checkDocSize(){return {overWarnLimit:false,overHardLimit:false,bytes:0}}
export function formatBytes(value){return String(value)}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "health-size-controller-stub.mjs"),
    `export function createCanvasDocSizeController(){return {subscribe(){return ()=>{}},dispose(){},update(){}}}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "health-utils-stub.mjs"),
    `export function cn(...values){return values.filter(Boolean).join(" ")}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "health-button-stub.mjs"),
    `import {createElement} from "react";
export function Button({variant,size,...props}){return createElement("button",props)}
`,
    "utf8"
  );
  writeFileSync(
    join(OUT, "health-icons-stub.mjs"),
    `import {createElement} from "react";
const Icon=(props)=>createElement("span",props);
export const AlertTriangle=Icon;export const Info=Icon;export const LockKeyhole=Icon;export const Trash2=Icon;
`,
    "utf8"
  );
  const healthModule = await loadExtra(
    join(ROOT, "src", "components", "canvas", "canvas-health-banners.tsx"),
    "canvas-health-banners-test.mjs",
    {
      '"@/components/ui/button"': '"./health-button-stub.mjs"',
      '"@/lib/canvas/doc-limits"': '"./health-doc-limits-stub.mjs"',
      '"@/lib/canvas/canvas-size-controller"': '"./health-size-controller-stub.mjs"',
      '"@/lib/utils"': '"./health-utils-stub.mjs"',
      '"@/stores/canvas-store"': '"./health-store-stub.mjs"',
      '"lucide-react"': '"./health-icons-stub.mjs"',
    },
    true
  );
  const healthStoreStub = await import(pathToFileURL(join(OUT, "health-store-stub.mjs")).href);
  const healthMarkup = renderToStaticMarkup(
    reactModule.createElement(healthModule.CanvasHealthBanners, {
      persistent: false,
      writerStatus: null,
    })
  );
  ok(
    healthMarkup.includes("清除 2 条损坏连线") &&
      healthMarkup.includes('aria-label="清除 2 条损坏连线"'),
    "health banner exposes the broken-edge count and an explicit cleanup command"
  );
  eq(healthStoreStub.getHealthCleanupCalls(), 0, "health banner never silently cleans broken edges");

  function renderRuntime(writerSession, storeView) {
    rootWriterStub.setWriterSession(writerSession);
    rootStoreStub.setRootStoreState({
      ...storeView,
      beginCanvasSession: () => true,
      recoverCurrentState: () => false,
      initializeEmptyDoc: () => false,
      setReadOnly: () => {},
    });
    const runtime = rootModule.CanvasRuntimeInner({ canvasId: writerSession.canvasId });
    const runtimeChildren = runtime.props.children;
    const critical = runtimeChildren[3];
    const provider = critical.props.children;
    return {
      runtime,
      runtimeChildren,
      critical,
      board: provider.props.children,
    };
  }

  const switchedRuntime = renderRuntime(
    { canvasId: canvasIdB, status: null, persistent: true, canEdit: false },
    {
      hydrated: true,
      sessionCanvasId: canvasIdB,
      hydratedCanvasId: canvasIdB,
      readOnly: true,
    }
  );
  ok(
    switchedRuntime.critical.props.inert === true &&
      switchedRuntime.critical.props["aria-busy"] === true &&
      switchedRuntime.board.props.interactionEnabled === false,
    "persisted switch commit renders Board inert until B acquires"
  );
  ok(
    switchedRuntime.runtimeChildren[0].props.requestedCanvasId === canvasIdB,
    "runtime bootstrap begins the requested persistent identity before interaction"
  );
  eq(switchedRuntime.runtimeChildren.length, 4, "bootstrap, feedback, banners, and Board share one runtime subtree");

  const acquiredRuntime = renderRuntime(
    { canvasId: canvasIdB, status: makeWriterStatus("root_tag_b", true, "acquired"), persistent: true, canEdit: true },
    {
      hydrated: true,
      sessionCanvasId: canvasIdB,
      hydratedCanvasId: canvasIdB,
      readOnly: false,
    }
  );
  ok(
    acquiredRuntime.critical.props.inert === undefined &&
      acquiredRuntime.board.props.interactionEnabled === true,
    "hydrated acquired B commit enables Board interaction"
  );

  const mismatchedRuntime = renderRuntime(
    { canvasId: canvasIdB, status: makeWriterStatus("root_tag_b", true, "acquired"), persistent: true, canEdit: true },
    {
      hydrated: true,
      sessionCanvasId: canvasIdB,
      hydratedCanvasId: canvasId,
      readOnly: false,
    }
  );
  ok(
    mismatchedRuntime.critical.props.inert === true &&
      mismatchedRuntime.board.props.interactionEnabled === false,
    "requested B, hydrated A, and writer B cannot pass the three-way identity gate"
  );

  const localUnhydratedRuntime = renderRuntime(
    { canvasId: null, status: null, persistent: false, canEdit: true },
    { hydrated: false, sessionCanvasId: null, hydratedCanvasId: null, readOnly: false }
  );
  ok(
    localUnhydratedRuntime.critical.props.inert === true &&
      localUnhydratedRuntime.runtimeChildren[0].props.requestedCanvasId === null,
    "local first render stays gated while requesting controlled empty initialization"
  );
  const localHydratedRuntime = renderRuntime(
    { canvasId: null, status: null, persistent: false, canEdit: true },
    { hydrated: true, sessionCanvasId: null, hydratedCanvasId: null, readOnly: false }
  );
  ok(
    localHydratedRuntime.critical.props.inert === undefined &&
      localHydratedRuntime.board.props.interactionEnabled === true,
    "initialized local draft becomes editable without writer identity"
  );

  let rootRecoverCalls = 0;
  let rootInitializeCalls = 0;
  rootStoreStub.setRootStoreState({
    hydrated: false,
    sessionCanvasId: null,
    hydratedCanvasId: null,
    recoverCurrentState() {
      rootRecoverCalls += 1;
      return false;
    },
    initializeEmptyDoc() {
      rootInitializeCalls += 1;
      return true;
    },
  });
  ok(rootModule.recoverCanvasRuntimeState(null) === true, "unhydrated local fallback initializes empty doc");
  eq([rootRecoverCalls, rootInitializeCalls], [1, 1], "local fallback initializes only after failed revalidation");

  rootRecoverCalls = 0;
  rootInitializeCalls = 0;
  rootStoreStub.setRootStoreState({
    hydrated: true,
    sessionCanvasId: null,
    hydratedCanvasId: null,
    recoverCurrentState() {
      rootRecoverCalls += 1;
      return false;
    },
    initializeEmptyDoc() {
      rootInitializeCalls += 1;
      return true;
    },
  });
  ok(
    rootModule.recoverCanvasRuntimeState(null) === false,
    "failed recovery of hydrated local state keeps fallback mounted"
  );
  eq([rootRecoverCalls, rootInitializeCalls], [1, 0], "hydrated recovery failure never reports empty initialization success");

  rootRecoverCalls = 0;
  rootInitializeCalls = 0;
  rootStoreStub.setRootStoreState({
    hydrated: false,
    sessionCanvasId: canvasId,
    hydratedCanvasId: null,
    recoverCurrentState() {
      rootRecoverCalls += 1;
      return false;
    },
    initializeEmptyDoc() {
      rootInitializeCalls += 1;
      return true;
    },
  });
  ok(rootModule.recoverCanvasRuntimeState(canvasId) === false, "unhydrated persisted canvas recovery fails closed");
  eq([rootRecoverCalls, rootInitializeCalls], [1, 0], "persisted fallback never creates an empty document");

  state().reset();
  ok(state().initializeEmptyDoc() === true && state().hydrated, "production store initializes an unhydrated local document");

  console.log(`\nS7 result: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("S7 focused verifier passed");
}

main().catch((error) => {
  console.error("S7 verifier crashed", error);
  process.exit(1);
});
