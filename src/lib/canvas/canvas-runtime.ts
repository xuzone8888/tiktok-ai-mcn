/**
 * 超级画布 · 运行时协调器(P0 · D-runtime)。
 *
 * 把「本地空画布 → 首次可持久化变更 → 幂等新建 → 晋升 → 自动补丁保存 → rebase 采纳 →
 * 影子持久化 / 断网重放 / 单写者门禁」这条端到端链路收敛为**一个纯核心**:
 *   - 只 import 画布数据层(schema/patch/history/offline-queue/shadow/api-*),
 *     **不 import** React / next / supabase / store —— 环境(fetch/定时器/uuid/store/影子/
 *     URL 规范化/API 错误上报)全部依赖注入,故可被 scripts/verify-canvas-runtime.mjs
 *     用 fake 驱动做**行为断言**(幂等新建竞态、创建期编辑、加载身份竞态、≤5s 保存、迟到响应、
 *     rebase+待发、断网恢复重连、鉴权/画布隔离、写者只读集成),也可被 React 壳接线到生产依赖。
 *
 * 关键不变量(与看板裁决 2/5、CLAUDE.md 铁律一致):
 *   - generations = 执行状态唯一真相源;画布文档只存引用,协调器只搬运 doc 补丁,绝不 fork。
 *   - 影子(D4)只存**严格可写** doc + D3 队列快照,scope 到 user(库命名空间)+ canvas(记录键);
 *     **只用 IndexedDB**,绝不本地键值存储;鉴权切换/登出由壳销毁本协调器 → invalidate 一切重放。
 *   - 一切跨 await 步骤都以 isActive(session) 兜底:导航/鉴权/画布切换/卸载后的迟到响应一律丢弃,
 *     绝不把它作用到已死会话或他人上下文(reject stale token/generation/canvas/auth)。
 *   - 冲突(ENTITY/REV/writer)一律 fail-closed 且**不丢影子意图**(待发 op 回队并落影子)。
 */
import {
  CANVAS_SCHEMA_VERSION,
  CanvasDepsSchema,
  createEmptyCanvasDeps,
  createEmptyCanvasDoc,
  validateCanvasDoc,
  type CanvasDeps,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasGroup,
  type CanvasNode,
  type LoadCanvasResult,
} from "./schema";
import type { CanvasOp } from "./patch";
import { applyOpsToDoc, diffDocs } from "./history";
import {
  OFFLINE_QUEUE_MAX_PENDING,
  ack as queueAck,
  buildPatch as queueBuildPatch,
  createOfflineQueue,
  enqueue as queueEnqueue,
  fail as queueFail,
  isDirty as queueIsDirty,
  previewOps,
  restore as queueRestore,
  snapshot as queueSnapshot,
  type OfflineQueueSnapshot,
  type OfflineQueueState,
} from "./offline-queue";
import { CANVAS_SAVE_PROOF_RE, CANVAS_UUID_RE } from "./api-helpers";
import {
  decideShadowRecovery,
  strictJsonClone,
  type CanvasPendingCreateLease,
  type CanvasPendingCreateRecord,
  type CanvasShadowLease,
  type CanvasShadowRecord,
  type CanvasShadowStore,
  type ShadowRecoveryCandidate,
} from "./shadow";
import type {
  CanvasEnvelopeWithMeta,
} from "./api-types";
import type {
  CanvasPatchPreparationInput,
  CanvasRepairPreparationInput,
  CanvasSavePreparation,
} from "./canvas-save-adapter";

// ── 注入契约(生产=浏览器/store;测试=fake)────────────────────────────────────

export interface CanvasRuntimeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface CanvasRuntimeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

export type CanvasRuntimeFetch = (
  url: string,
  init: CanvasRuntimeFetchInit
) => Promise<CanvasRuntimeResponse>;

export interface CanvasRuntimeScheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/** Read-only view the coordinator needs from the canvas store. */
export interface CanvasRuntimeStoreState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  hydrated: boolean;
  sessionCanvasId: string | null;
  hydratedCanvasId: string | null;
  readOnly: boolean;
  recoveryRequired: boolean;
}

export interface CanvasRuntimeStore {
  getState(): CanvasRuntimeStoreState;
  hydrate(result: LoadCanvasResult, canvasId: string | null): boolean;
  promoteLocalToPersisted(canvasId: string): boolean;
  adoptAuthoritativeDoc(canvasId: string, doc: CanvasDoc): boolean;
  preparePatchSave(input: CanvasPatchPreparationInput): CanvasSavePreparation;
  prepareRepairSave(input: CanvasRepairPreparationInput): CanvasSavePreparation;
}

interface CanvasRuntimeObservedState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  hydrated: boolean;
  sessionCanvasId: string | null;
  hydratedCanvasId: string | null;
  readOnly: boolean;
  recoveryRequired: boolean;
}

function observeRuntimeState(state: CanvasRuntimeStoreState): CanvasRuntimeObservedState {
  return {
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    hydrated: state.hydrated,
    sessionCanvasId: state.sessionCanvasId,
    hydratedCanvasId: state.hydratedCanvasId,
    readOnly: state.readOnly,
    recoveryRequired: state.recoveryRequired,
  };
}

function runtimeStateChanged(
  previous: CanvasRuntimeObservedState,
  next: CanvasRuntimeObservedState
): boolean {
  return (
    previous.nodes !== next.nodes ||
    previous.edges !== next.edges ||
    previous.groups !== next.groups ||
    previous.hydrated !== next.hydrated ||
    previous.sessionCanvasId !== next.sessionCanvasId ||
    previous.hydratedCanvasId !== next.hydratedCanvasId ||
    previous.readOnly !== next.readOnly ||
    previous.recoveryRequired !== next.recoveryRequired
  );
}

/** Subscribe only to fields that can affect persistence; selection/view/history churn is ignored. */
export function subscribeCanvasRuntimeStore<State extends CanvasRuntimeStoreState>(
  store: {
    getState(): State;
    subscribe(listener: (state: State, previousState: State) => void): () => void;
  },
  onRelevantChange: () => void
): () => void {
  let previous = observeRuntimeState(store.getState());
  return store.subscribe((state) => {
    const next = observeRuntimeState(state);
    if (!runtimeStateChanged(previous, next)) return;
    previous = next;
    onRelevantChange();
  });
}

export interface CanvasAuthStateCoordinator {
  resolveInitial(userId: string | null): void;
  resolveEvent(userId: string | null): void;
  dispose(): void;
}

export interface CanvasAuthSnapshotResult {
  data: { user?: { id?: string | null } | null };
}

/** Auth events are authoritative; a late getUser snapshot must never overwrite one. */
export function createCanvasAuthStateCoordinator(
  commit: (userId: string | null) => void
): CanvasAuthStateCoordinator {
  let disposed = false;
  let eventSeen = false;
  return {
    resolveInitial: (userId) => {
      if (!disposed && !eventSeen) commit(userId);
    },
    resolveEvent: (userId) => {
      if (disposed) return;
      eventSeen = true;
      commit(userId);
    },
    dispose: () => {
      disposed = true;
    },
  };
}

/** Resolve a trustworthy initial auth snapshot. Transport failure stays unresolved and inert. */
export function resolveCanvasAuthSnapshot(
  request: PromiseLike<CanvasAuthSnapshotResult>,
  coordinator: CanvasAuthStateCoordinator
): void {
  void request.then(
    ({ data }) => {
      const id = data.user?.id;
      coordinator.resolveInitial(typeof id === "string" ? id : null);
    },
    () => {
      // A failed probe is not evidence of logout. onAuthStateChange may still deliver the
      // authoritative identity; preserving the unresolved state avoids deleting local work.
    }
  );
}

/** A captured intent to create a persisted canvas from a still-local doc (client id + captured doc). */
export interface CanvasCreateIntent {
  id: string;
  capturedDoc: CanvasDoc;
}

/**
 * Proven local persisted-session intent carried across a runtime dispose/remount for one user.
 * A same-id singleton document without this revision/queue/recovery proof is only a cache and
 * must never outrank a fresh GET.
 */
export interface CanvasRuntimeSessionHandoff {
  version: 1;
  canvasId: string;
  doc: CanvasDoc;
  deps: CanvasDeps;
  serverRev: number;
  queue: OfflineQueueSnapshot;
  snapshotRecoveryRequired: boolean;
  serverRecoveryRequired: boolean;
  localRecoveryRequired: boolean;
  updatedAt: string;
}

/** Per-user durable in-memory intents for pending create and proven persisted-session work. */
export interface CanvasCreateIntentStore {
  get(): CanvasCreateIntent | null;
  set(intent: CanvasCreateIntent): void;
  clear(expectedId: string): void;
  getSessionHandoff(canvasId: string): unknown;
  setSessionHandoff(handoff: CanvasRuntimeSessionHandoff): void;
  clearSessionHandoff(canvasId: string): void;
}

export interface CanvasCreateIntentRegistry {
  forUser(userId: string | null): CanvasCreateIntentStore;
  handleUserChange(
    previousUserId: string | null | undefined,
    nextUserId: string | null | undefined,
    resetCanvasState: () => void
  ): void;
}

export function createCanvasCreateIntentRegistry(): CanvasCreateIntentRegistry {
  const intents = new Map<string, CanvasCreateIntent>();
  const sessionHandoffs = new Map<string, Map<string, CanvasRuntimeSessionHandoff>>();
  let activeUserId: string | null | undefined = undefined;
  return {
    forUser: (userId) => ({
      get: () => (userId ? intents.get(userId) ?? null : null),
      set: (intent) => {
        if (userId) intents.set(userId, intent);
      },
      clear: (expectedId) => {
        if (!userId) return;
        const current = intents.get(userId);
        if (current?.id === expectedId) intents.delete(userId);
      },
      getSessionHandoff: (canvasId) =>
        userId ? sessionHandoffs.get(userId)?.get(canvasId) ?? null : null,
      setSessionHandoff: (handoff) => {
        if (!userId) return;
        let byCanvas = sessionHandoffs.get(userId);
        if (!byCanvas) {
          byCanvas = new Map();
          sessionHandoffs.set(userId, byCanvas);
        }
        byCanvas.set(handoff.canvasId, handoff);
      },
      clearSessionHandoff: (canvasId) => {
        if (!userId) return;
        const byCanvas = sessionHandoffs.get(userId);
        byCanvas?.delete(canvasId);
        if (byCanvas?.size === 0) sessionHandoffs.delete(userId);
      },
    }),
    handleUserChange: (_previousUserId, nextUserId, resetCanvasState) => {
      if (nextUserId === undefined) return;
      if (activeUserId === undefined) {
        activeUserId = nextUserId;
        return;
      }
      if (activeUserId === nextUserId) return;
      const retiredUserId = activeUserId;
      // Dispose/reset first so teardown may capture an in-flight handoff, then erase every
      // artifact for the retired identity. Reversing this order lets teardown recreate data
      // after the auth cleanup and leak it into a later login of the same account.
      try {
        resetCanvasState();
      } finally {
        if (retiredUserId !== null) {
          intents.delete(retiredUserId);
          sessionHandoffs.delete(retiredUserId);
        }
        activeUserId = nextUserId;
      }
    },
  };
}

export interface CanvasRuntimeDeps {
  store: CanvasRuntimeStore;
  fetch: CanvasRuntimeFetch;
  scheduler: CanvasRuntimeScheduler;
  /** Stable client UUID generator (crypto.randomUUID in production). */
  uuid: () => string;
  /** Durable pending-create intent handoff (D-runtime); consumed by runCreate in a follow-up. */
  createIntentStore: CanvasCreateIntentStore;
  /** D4 shadow store, already scoped to the authenticated user (per-user db namespace). */
  shadow?: CanvasShadowStore | null;
  /** Stable, per-realm owner id used by the Shadow v2 CAS (never the D5 writer tag). */
  shadowOwnerId: string;
  /** Stable namespace used to serialize shadow writes across runtime remounts for one user. */
  shadowWriteScope?: string;
  /** Canonicalize the browser URL to /canvas?id=<uuid> after a create adoption. */
  canonicalizeUrl?: (canvasId: string) => void;
  /** Surface a decoded API error body (production = consumeCanvasPatchResponse → toast). */
  notifyApiError?: (body: unknown) => void;
  /** Surface or clear a shadow-ahead recovery decision without exposing the full document to UI. */
  onShadowRecoveryChange?: (notice: CanvasShadowRecoveryNotice | null) => void;
  /** Keep React interaction gating synchronized with the pure runtime state machine. */
  onRuntimeStateChange?: (state: CanvasRuntimeUiState) => void;
  /** Optional online probe; retry flush resumes on reconnect. */
  isOnline?: () => boolean;
  /** Debounce window for a normal save (clamped to ≤5000ms). */
  debounceMs?: number;
  /** Retry ceiling for offline/transient flush (clamped to ≤30000ms). */
  maxRetryMs?: number;
  /** Base for create-attempt POST + PATCH transport (default "/api/canvas"). */
  basePath?: string;
}

export type CanvasRuntimeMode =
  | "idle"
  | "local"
  | "creating"
  | "loading"
  | "recovery-pending"
  | "repairing"
  | "persisted"
  | "failed";

export interface CanvasShadowRecoveryNotice {
  canvasId: string;
  serverRev: number;
  shadowServerRev: number;
  updatedAt: string;
}

export interface CanvasRuntimeIssue {
  code: "failed" | "conflicted";
  message: string;
}

export interface CanvasRuntimeUiState {
  mode: CanvasRuntimeMode;
  interactionReady: boolean;
  issue: CanvasRuntimeIssue | null;
}

export interface CanvasRuntimeDebugState {
  mode: CanvasRuntimeMode;
  activeId: string | null;
  targetCanvasId: string | null;
  createId: string | null;
  baseRev: number;
  pending: number;
  inflight: boolean;
  conflicted: boolean;
  repairRequired: boolean;
  disposed: boolean;
}

export interface CanvasRuntime {
  /** Point the coordinator at a URL target (uuid = persisted, null = local editable). */
  configure(canvasId: string | null): void;
  /** Forward a store change (the React hook subscribes once and calls this). */
  handleStoreChange(): void;
  /** Network reconnect: reset backoff and flush immediately. */
  handleOnline(): void;
  /** Exact D5 writer lifecycle signal. Persisted transport is inert until `acquired` is true. */
  handleWriterSignal(signal: CanvasRuntimeWriterSignal): void;
  /** Accept a shadow-ahead snapshot, merge it with any edits made during load, then queue PATCH. */
  restoreShadowSnapshot(): Promise<boolean>;
  /** Keep the server document (plus any edits made during load) and replace the stale shadow. */
  discardShadowSnapshot(): Promise<boolean>;
  /** Tear everything down: abort in-flight, clear timers, invalidate the session. */
  dispose(): void;
  /** Test/diagnostic snapshot of the active session. */
  getDebugState(): CanvasRuntimeDebugState;
}

export interface CanvasRuntimeWriterSignal {
  canvasId: string;
  writerTag: string;
  acquired: boolean;
}

interface AbortHandle {
  signal: unknown;
  abort(): void;
}

interface RuntimeSession {
  generation: number;
  targetCanvasId: string | null;
  mode: CanvasRuntimeMode;
  activeId: string | null;
  createId: string | null;
  baseline: CanvasDoc;
  deps: CanvasDeps;
  queue: OfflineQueueState;
  opCounter: number;
  flushTimer: unknown | null;
  retryTimer: unknown | null;
  retryDelay: number;
  createAbort: AbortHandle | null;
  saveAbort: AbortHandle | null;
  saveAttempt: number;
  saveToken: string | null;
  /** Opaque server-issued proof for the exact activeId/queue revision. Never persisted locally. */
  saveProof: string | null;
  recoveryEpoch: number;
  loadInFlight: boolean;
  loadAttempt: number;
  bootstrapAttempt: number;
  bootstrapReady: boolean;
  bootstrapInFlight: boolean;
  takeoverAttempt: number;
  takeoverInFlight: boolean;
  writerAcquired: boolean;
  writerTag: string | null;
  writerEpoch: number;
  shadowLease: CanvasShadowLease | null;
  shadowReady: boolean;
  shadowMutationChain: Promise<void>;
  pendingCreateLease: CanvasPendingCreateLease | null;
  pendingCreateRecord: CanvasPendingCreateRecord | null;
  pendingRouteObserved: boolean;
  pendingRetired: boolean;
  shadowRecovery: {
    candidate: ShadowRecoveryCandidate;
    serverDoc: CanvasDoc;
    coversRetainedHandoff: boolean;
  } | null;
  shadowRecoverySettlementAttempt: number;
  shadowRecoverySettlementToken: number | null;
  issue: CanvasRuntimeIssue | null;
  conflicted: boolean;
  snapshotRecoveryRequired: boolean;
  serverRecoveryRequired: boolean;
  retainedHandoff: CanvasRuntimeSessionHandoff | null;
  disposed: boolean;
  /** True while the coordinator itself is writing the store (adopt), so its synchronous
   *  subscriber notification is not mistaken for a fresh user edit. */
  applying: boolean;
}

const RETRY_BASE_MS = 1_000;
const DEFAULT_DEBOUNCE_MS = 1_200;
const MAX_DEBOUNCE_MS = 5_000;
const DEFAULT_MAX_RETRY_MS = 30_000;

function clampMs(value: number | undefined, fallback: number, hardMax: number): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(hardMax, Math.floor(raw)));
}

function makeAbortHandle(): AbortHandle {
  const ctor = (globalThis as { AbortController?: new () => AbortController }).AbortController;
  if (typeof ctor === "function") {
    const controller = new ctor();
    return {
      signal: controller.signal,
      abort: () => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      },
    };
  }
  return { signal: undefined, abort: () => {} };
}

interface DecodedApiBody {
  success: boolean;
  data: unknown;
  code: string | null;
}

/** Descriptor-safe read of the stable {success,data,code} contract; hostile bodies → benign shape. */
function decodeApiBody(body: unknown): DecodedApiBody {
  if (!body || typeof body !== "object") return { success: false, data: null, code: null };
  try {
    const success = Object.getOwnPropertyDescriptor(body, "success");
    const data = Object.getOwnPropertyDescriptor(body, "data");
    const code = Object.getOwnPropertyDescriptor(body, "code");
    return {
      success: !!success && "value" in success && success.value === true,
      data: data && "value" in data ? data.value : null,
      code:
        code && "value" in code && typeof code.value === "string" ? code.value : null,
    };
  } catch {
    return { success: false, data: null, code: null };
  }
}

function readOwnDataValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function decodeCreateIntent(value: unknown): CanvasCreateIntent | null {
  const id = readOwnDataValue(value, "id");
  const capturedDoc = readOwnDataValue(value, "capturedDoc");
  if (
    typeof id !== "string" ||
    !CANVAS_UUID_RE.test(id) ||
    id !== id.toLowerCase()
  ) {
    return null;
  }
  const validated = validateCanvasDoc(capturedDoc);
  return validated.ok && validated.data !== null
    ? { id, capturedDoc: validated.data }
    : null;
}

function decodeCreatedData(value: unknown, expectedId: string): { id: string; rev: number } | null {
  const id = readOwnDataValue(value, "id");
  const rev = readOwnDataValue(value, "rev");
  return id === expectedId && rev === 0
    ? { id, rev }
    : null;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeDocumentData(
  value: unknown,
  expectedId: string
): { rev: number; deps: CanvasDeps; loadResult: LoadCanvasResult; saveProof: string | null } | null {
  const cloned = strictJsonClone(value);
  if (!cloned.ok) return null;
  const safeValue = cloned.value;
  const id = readOwnDataValue(safeValue, "id");
  const title = readOwnDataValue(safeValue, "title");
  const rev = readOwnDataValue(safeValue, "rev");
  const schemaVersion = readOwnDataValue(safeValue, "schemaVersion");
  const envelope = readOwnDataValue(safeValue, "envelope");
  const recovery = readOwnDataValue(safeValue, "recovery");
  const docBytes = readOwnDataValue(safeValue, "docBytes");
  const status = readOwnDataValue(safeValue, "status");
  const writer = readOwnDataValue(safeValue, "writer");
  const createdAt = readOwnDataValue(safeValue, "createdAt");
  const updatedAt = readOwnDataValue(safeValue, "updatedAt");
  const rawSaveProof = readOwnDataValue(safeValue, "saveProof");
  if (
    id !== expectedId ||
    typeof title !== "string" ||
    !isNonnegativeInteger(rev) ||
    !isNonnegativeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    !isNonnegativeInteger(docBytes) ||
    typeof status !== "string" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string" ||
    !(
      rawSaveProof === undefined ||
      (typeof rawSaveProof === "string" && CANVAS_SAVE_PROOF_RE.test(rawSaveProof))
    )
  ) {
    return null;
  }

  const writerTag = readOwnDataValue(writer, "tag");
  const writerHeartbeatAt = readOwnDataValue(writer, "heartbeatAt");
  if (
    !(writerTag === null || typeof writerTag === "string") ||
    !(writerHeartbeatAt === null || typeof writerHeartbeatAt === "string")
  ) {
    return null;
  }

  const envelopeVersion = readOwnDataValue(envelope, "schemaVersion");
  const doc = readOwnDataValue(envelope, "doc");
  const deps = readOwnDataValue(envelope, "deps");
  const nodes = readOwnDataValue(doc, "nodes");
  const edges = readOwnDataValue(doc, "edges");
  const groups = readOwnDataValue(doc, "groups");
  let parsedDeps;
  try {
    parsedDeps = CanvasDepsSchema.safeParse(deps);
  } catch {
    return null;
  }
  if (
    envelopeVersion !== schemaVersion ||
    !Array.isArray(nodes) ||
    !Array.isArray(edges) ||
    !Array.isArray(groups) ||
    !parsedDeps.success
  ) {
    return null;
  }

  const brokenNodes = readOwnDataValue(recovery, "brokenNodes");
  const brokenEdges = readOwnDataValue(recovery, "brokenEdges");
  const migratedFrom = readOwnDataValue(recovery, "migratedFrom");
  const targetSchemaVersion = readOwnDataValue(recovery, "targetSchemaVersion");
  const migrationComplete = readOwnDataValue(recovery, "migrationComplete");
  const recoveryRequired = readOwnDataValue(recovery, "recoveryRequired");
  const issues = readOwnDataValue(recovery, "issues");
  if (
    !Array.isArray(brokenNodes) ||
    !Array.isArray(brokenEdges) ||
    !isNonnegativeInteger(migratedFrom) ||
    !isNonnegativeInteger(targetSchemaVersion) ||
    typeof migrationComplete !== "boolean" ||
    typeof recoveryRequired !== "boolean" ||
    !Array.isArray(issues) ||
    !issues.every((issue) => typeof issue === "string") ||
    (!recoveryRequired &&
      (brokenNodes.length > 0 ||
        brokenEdges.length > 0 ||
        !migrationComplete ||
        issues.length > 0))
  ) {
    return null;
  }

  return {
    rev,
    deps: parsedDeps.data,
    saveProof: typeof rawSaveProof === "string" ? rawSaveProof : null,
    loadResult: {
      nodes,
      edges,
      groups,
      brokenNodes,
      brokenEdges,
      schemaVersion,
      migratedFrom,
      targetSchemaVersion,
      migrationComplete,
      recoveryRequired,
      issues,
    },
  };
}

function decodeRepairData(
  value: unknown,
  expectedId: string,
  baseRev: number,
  expectedDoc: CanvasDoc,
  expectedDeps: CanvasDeps
): { rev: number; envelope: CanvasEnvelopeWithMeta; saveProof: string | null } | null {
  const cloned = strictJsonClone(value);
  if (!cloned.ok) return null;
  const safeValue = cloned.value;
  const id = readOwnDataValue(safeValue, "id");
  const rev = readOwnDataValue(safeValue, "rev");
  const schemaVersion = readOwnDataValue(safeValue, "schemaVersion");
  const docBytes = readOwnDataValue(safeValue, "docBytes");
  const persisted = readOwnDataValue(safeValue, "persisted");
  const recovered = readOwnDataValue(safeValue, "recovered");
  const updatedAt = readOwnDataValue(safeValue, "updatedAt");
  const rawEnvelope = readOwnDataValue(safeValue, "envelope");
  const rawSaveProof = readOwnDataValue(safeValue, "saveProof");
  if (
    id !== expectedId ||
    rev !== baseRev + 1 ||
    schemaVersion !== CANVAS_SCHEMA_VERSION ||
    !isNonnegativeInteger(docBytes) ||
    persisted !== true ||
    recovered !== true ||
    typeof updatedAt !== "string" ||
    !(
      rawSaveProof === undefined ||
      (typeof rawSaveProof === "string" && CANVAS_SAVE_PROOF_RE.test(rawSaveProof))
    )
  ) {
    return null;
  }
  const envelopeVersion = readOwnDataValue(rawEnvelope, "schemaVersion");
  const envelopeDoc = readOwnDataValue(rawEnvelope, "doc");
  const envelopeDeps = readOwnDataValue(rawEnvelope, "deps");
  const envelopeRev = readOwnDataValue(rawEnvelope, "rev");
  const envelopeBytes = readOwnDataValue(rawEnvelope, "docBytes");
  const validatedDoc = validateCanvasDoc(envelopeDoc);
  let validatedDeps;
  let validatedExpectedDeps;
  try {
    validatedDeps = CanvasDepsSchema.safeParse(envelopeDeps);
    validatedExpectedDeps = CanvasDepsSchema.safeParse(expectedDeps);
  } catch {
    return null;
  }
  if (
    envelopeVersion !== schemaVersion ||
    envelopeRev !== rev ||
    envelopeBytes !== docBytes ||
    !validatedDoc.ok ||
    validatedDoc.data === null ||
    !validatedDeps.success ||
    !validatedExpectedDeps.success
  ) {
    return null;
  }
  const mismatch = diffDocs(expectedDoc, validatedDoc.data);
  if (
    mismatch === null ||
    mismatch.length > 0 ||
    JSON.stringify(validatedDeps.data) !== JSON.stringify(validatedExpectedDeps.data)
  ) {
    return null;
  }
  return {
    rev,
    saveProof: typeof rawSaveProof === "string" ? rawSaveProof : null,
    envelope: {
      schemaVersion,
      doc: validatedDoc.data,
      deps: validatedDeps.data,
      rev,
      docBytes,
    },
  };
}

function decodePatchData(
  value: unknown,
  expectedId: string,
  baseRev: number,
  submittedOps: number
): {
  rev: number;
  rebased: boolean;
  envelope: CanvasEnvelopeWithMeta | null;
  saveProof: string | null;
} | null {
  const cloned = strictJsonClone(value);
  if (!cloned.ok) return null;
  const safeValue = cloned.value;
  const id = readOwnDataValue(safeValue, "id");
  const rev = readOwnDataValue(safeValue, "rev");
  const schemaVersion = readOwnDataValue(safeValue, "schemaVersion");
  const docBytes = readOwnDataValue(safeValue, "docBytes");
  const rebased = readOwnDataValue(safeValue, "rebased");
  const appliedOps = readOwnDataValue(safeValue, "appliedOps");
  const noopOps = readOwnDataValue(safeValue, "noopOps");
  const persisted = readOwnDataValue(safeValue, "persisted");
  const updatedAt = readOwnDataValue(safeValue, "updatedAt");
  const rawSaveProof = readOwnDataValue(safeValue, "saveProof");
  if (
    id !== expectedId ||
    !isNonnegativeInteger(rev) ||
    !isNonnegativeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    !isNonnegativeInteger(docBytes) ||
    typeof rebased !== "boolean" ||
    !isNonnegativeInteger(appliedOps) ||
    !isNonnegativeInteger(noopOps) ||
    appliedOps + noopOps !== submittedOps ||
    typeof persisted !== "boolean" ||
    typeof updatedAt !== "string" ||
    (persisted ? appliedOps === 0 : appliedOps !== 0) ||
    (!rebased && rev !== baseRev + (persisted ? 1 : 0)) ||
    (rebased && rev <= baseRev + (persisted ? 1 : 0)) ||
    !(
      rawSaveProof === undefined ||
      (typeof rawSaveProof === "string" && CANVAS_SAVE_PROOF_RE.test(rawSaveProof))
    )
  ) {
    return null;
  }

  const rawEnvelope = readOwnDataValue(safeValue, "envelope");
  if (!rebased) {
    return rawEnvelope === undefined
      ? {
          rev,
          rebased,
          envelope: null,
          saveProof: typeof rawSaveProof === "string" ? rawSaveProof : null,
        }
      : null;
  }

  const envelopeVersion = readOwnDataValue(rawEnvelope, "schemaVersion");
  const envelopeDoc = readOwnDataValue(rawEnvelope, "doc");
  const envelopeDeps = readOwnDataValue(rawEnvelope, "deps");
  const envelopeRev = readOwnDataValue(rawEnvelope, "rev");
  const envelopeBytes = readOwnDataValue(rawEnvelope, "docBytes");
  if (
    envelopeVersion !== schemaVersion ||
    envelopeRev !== rev ||
    envelopeBytes !== docBytes
  ) {
    return null;
  }
  const validatedDoc = validateCanvasDoc(envelopeDoc);
  let validatedDeps;
  try {
    validatedDeps = CanvasDepsSchema.safeParse(envelopeDeps);
  } catch {
    return null;
  }
  if (!validatedDoc.ok || validatedDoc.data === null || !validatedDeps.success) return null;
  return {
    rev,
    rebased,
    saveProof: typeof rawSaveProof === "string" ? rawSaveProof : null,
    envelope: {
      schemaVersion,
      doc: validatedDoc.data,
      deps: validatedDeps.data,
      rev,
      docBytes,
    },
  };
}

/** Pre-flight rejection codes that will settle on their own (writer lease / identity / hydration). */
const TRANSIENT_PREFLIGHT_CODES = new Set([
  "WRITER_LOCKED",
  "NO_ACTIVE_WRITER",
  "NOT_HYDRATED",
  "CANVAS_IDENTITY_MISMATCH",
]);

export function createCanvasRuntime(deps: CanvasRuntimeDeps): CanvasRuntime {
  const { store, scheduler, createIntentStore } = deps;
  const basePath = deps.basePath ?? "/api/canvas";
  const debounceMs = clampMs(deps.debounceMs, DEFAULT_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
  const maxRetryMs = Math.max(
    1,
    clampMs(deps.maxRetryMs, DEFAULT_MAX_RETRY_MS, DEFAULT_MAX_RETRY_MS)
  );
  let generationCounter = 0;
  let session: RuntimeSession | null = null;
  let queuedWriterSignal: CanvasRuntimeWriterSignal | null = null;

  function isActive(candidate: RuntimeSession): boolean {
    return session === candidate && !candidate.disposed;
  }

  function readDoc(state: CanvasRuntimeStoreState): CanvasDoc {
    return { nodes: state.nodes, edges: state.edges, groups: state.groups };
  }

  function decodeSessionHandoff(
    raw: unknown,
    expectedCanvasId: string
  ): CanvasRuntimeSessionHandoff | null {
    const cloned = strictJsonClone(raw);
    if (!cloned.ok || !cloned.value || typeof cloned.value !== "object") return null;
    const value = cloned.value as Record<string, unknown>;
    const expectedKeys = [
      "version",
      "canvasId",
      "doc",
      "deps",
      "serverRev",
      "queue",
      "snapshotRecoveryRequired",
      "serverRecoveryRequired",
      "localRecoveryRequired",
      "updatedAt",
    ];
    const keys = Object.keys(value);
    if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) {
      return null;
    }
    if (
      value.version !== 1 ||
      value.canvasId !== expectedCanvasId ||
      !Number.isSafeInteger(value.serverRev) ||
      (value.serverRev as number) < 0 ||
      typeof value.snapshotRecoveryRequired !== "boolean" ||
      typeof value.serverRecoveryRequired !== "boolean" ||
      typeof value.localRecoveryRequired !== "boolean" ||
      typeof value.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.updatedAt))
    ) {
      return null;
    }
    const doc = validateCanvasDoc(value.doc);
    const parsedDeps = CanvasDepsSchema.safeParse(value.deps);
    const queue = queueRestore(value.queue);
    if (
      !doc.ok ||
      doc.data === null ||
      !parsedDeps.success ||
      queue === null ||
      queue.baseRev !== value.serverRev
    ) {
      return null;
    }
    // A clean cached document is not an intent. Reject it even if a caller supplied a perfectly
    // shaped record; only a queue or an explicit recovery/snapshot phase can outrank nothing.
    if (
      !queueIsDirty(queue) &&
      value.snapshotRecoveryRequired !== true &&
      value.serverRecoveryRequired !== true &&
      value.localRecoveryRequired !== true
    ) {
      return null;
    }
    return {
      version: 1,
      canvasId: expectedCanvasId,
      doc: doc.data,
      deps: parsedDeps.data,
      serverRev: value.serverRev as number,
      queue: queueSnapshot(queue),
      snapshotRecoveryRequired: value.snapshotRecoveryRequired,
      serverRecoveryRequired: value.serverRecoveryRequired,
      localRecoveryRequired: value.localRecoveryRequired,
      updatedAt: value.updatedAt,
    };
  }

  function readSessionHandoff(canvasId: string): CanvasRuntimeSessionHandoff | null {
    let raw: unknown;
    try {
      raw = createIntentStore.getSessionHandoff(canvasId);
    } catch {
      return null;
    }
    const decoded = decodeSessionHandoff(raw, canvasId);
    if (raw !== null && decoded === null) {
      try {
        createIntentStore.clearSessionHandoff(canvasId);
      } catch {
        // An invalid optional handoff is ignored; the fresh GET remains authoritative.
      }
    }
    return decoded;
  }

  function clearSessionHandoff(canvasId: string): void {
    try {
      createIntentStore.clearSessionHandoff(canvasId);
    } catch {
      // The active queue/shadow still owns the intent; cleanup is best-effort.
    }
  }

  function publishRuntimeState(active: RuntimeSession): void {
    if (!isActive(active)) return;
    const interactionReady =
      !active.conflicted &&
      (active.mode === "local" || active.mode === "creating" || active.mode === "persisted");
    try {
      deps.onRuntimeStateChange?.({
        mode: active.mode,
        interactionReady,
        issue: active.issue,
      });
    } catch {
      // UI observation is best-effort; transport state remains authoritative.
    }
  }

  function setMode(active: RuntimeSession, mode: CanvasRuntimeMode): void {
    if (!isActive(active)) return;
    active.mode = mode;
    if (mode !== "failed" && !active.conflicted) active.issue = null;
    publishRuntimeState(active);
  }

  function failSession(active: RuntimeSession, message: string): void {
    if (!isActive(active)) return;
    active.mode = "failed";
    active.issue = { code: "failed", message };
    publishRuntimeState(active);
  }

  function markConflict(active: RuntimeSession, message: string): void {
    if (!isActive(active)) return;
    active.conflicted = true;
    active.issue = { code: "conflicted", message };
    publishRuntimeState(active);
  }

  function identitiesMatch(
    active: RuntimeSession,
    state: CanvasRuntimeStoreState
  ): boolean {
    return (
      active.activeId !== null &&
      state.hydrated &&
      state.sessionCanvasId === active.activeId &&
      state.hydratedCanvasId === active.activeId
    );
  }

  function transportAuthorized(
    active: RuntimeSession,
    state: CanvasRuntimeStoreState
  ): boolean {
    if (
      !identitiesMatch(active, state) ||
      !active.writerAcquired ||
      active.writerTag === null ||
      state.readOnly ||
      state.recoveryRequired ||
      (active.pendingCreateRecord !== null && !active.pendingRetired)
    ) {
      return false;
    }
    const shadow = configuredShadow();
    return !shadow ||
      (shadow.available &&
        active.shadowReady &&
        active.shadowLease !== null &&
        active.shadowLease.canvasId === active.activeId);
  }

  function synchronizeSessionHandoff(active: RuntimeSession): void {
    if (active.activeId === null) return;
    // An unconsumed handoff may be the only copy of conflicting local work. A loading/conflicted
    // session owns only the fresh GET in its queue, so rebuilding from that state would erase the
    // retained intent during dispose.
    if (active.retainedHandoff !== null) return;
    let state: CanvasRuntimeStoreState;
    try {
      state = store.getState();
    } catch {
      return;
    }
    // A child/session bootstrap may already have moved the singleton to canvas B before the
    // runtime tears down canvas A. Never overwrite or clear A's existing handoff with B's doc.
    if (!identitiesMatch(active, state)) return;
    const validated = validateCanvasDoc(readDoc(state));
    if (!validated.ok || validated.data === null) return;

    let queue = queueRestore(queueSnapshot(active.queue));
    if (queue === null) return;
    let snapshotRecoveryRequired = active.snapshotRecoveryRequired;
    const trailing = diffDocs(active.baseline, validated.data);
    if (trailing === null) {
      snapshotRecoveryRequired = true;
    } else if (trailing.length > 0) {
      if (queuedOperationCount(queue) + trailing.length > OFFLINE_QUEUE_MAX_PENDING) {
        snapshotRecoveryRequired = true;
      } else {
        for (const op of trailing) {
          const opId = `${active.createId ?? active.activeId}:handoff:${active.opCounter}`;
          active.opCounter += 1;
          queue = queueEnqueue(queue, opId, op);
        }
        active.queue = queue;
        active.baseline = validated.data;
      }
    }
    active.snapshotRecoveryRequired = snapshotRecoveryRequired;

    const hasIntent =
      queueIsDirty(queue) ||
      snapshotRecoveryRequired ||
      active.serverRecoveryRequired ||
      state.recoveryRequired;
    if (!hasIntent) {
      clearSessionHandoff(active.activeId);
      return;
    }

    const now = scheduler.now();
    let updatedAt = "1970-01-01T00:00:00.000Z";
    try {
      updatedAt = new Date(Number.isFinite(now) ? now : 0).toISOString();
    } catch {
      // Keep a canonical diagnostic timestamp; never let a hostile clock break teardown.
    }
    const record: CanvasRuntimeSessionHandoff = {
      version: 1,
      canvasId: active.activeId,
      doc: validated.data,
      deps: active.deps,
      serverRev: queue.baseRev,
      queue: queueSnapshot(queue),
      snapshotRecoveryRequired,
      serverRecoveryRequired: active.serverRecoveryRequired,
      localRecoveryRequired: state.recoveryRequired,
      updatedAt,
    };
    const cloned = strictJsonClone(record);
    if (!cloned.ok) return;
    try {
      createIntentStore.setSessionHandoff(cloned.value);
    } catch {
      // IndexedDB shadow remains the durable fallback; handoff is best-effort but fail-safe.
    }
  }

  function clearTimers(active: RuntimeSession): void {
    if (active.flushTimer !== null) {
      scheduler.clearTimeout(active.flushTimer);
      active.flushTimer = null;
    }
    if (active.retryTimer !== null) {
      scheduler.clearTimeout(active.retryTimer);
      active.retryTimer = null;
    }
  }

  function publishShadowRecovery(
    active: RuntimeSession,
    candidate: ShadowRecoveryCandidate,
    serverDoc: CanvasDoc,
    coversRetainedHandoff: boolean = false
  ): boolean {
    if (!isActive(active) || active.activeId === null || candidate.canvasId !== active.activeId) return false;
    active.shadowRecovery = { candidate, serverDoc, coversRetainedHandoff };
    try {
      deps.onShadowRecoveryChange?.({
        canvasId: candidate.canvasId,
        serverRev: candidate.baseRev,
        shadowServerRev: candidate.shadowServerRev,
        updatedAt: candidate.updatedAt,
      });
      return isActive(active);
    } catch {
      active.shadowRecovery = null;
      return false;
    }
  }

  function clearShadowRecovery(active: RuntimeSession): void {
    if (session !== active || active.shadowRecovery === null) return;
    active.shadowRecovery = null;
    try {
      deps.onShadowRecoveryChange?.(null);
    } catch {
      // UI notification is best-effort; the coordinator state is already cleared.
    }
  }

  function teardown(active: RuntimeSession): void {
    synchronizeSessionHandoff(active);
    active.disposed = true;
    clearShadowRecovery(active);
    clearTimers(active);
    active.createAbort?.abort();
    active.saveAbort?.abort();
    active.createAbort = null;
    active.saveAbort = null;
  }

  function queuedOperationCount(queue: OfflineQueueState): number {
    return queue.pending.length + (queue.inflight?.ops.length ?? 0);
  }

  function markQueueOverflow(active: RuntimeSession): void {
    if (active.conflicted) return;
    // Fence any inflight PATCH before marking conflict. Bump the attempt so a late fetch/JSON
    // response (a transport may ignore abort, so this fence is mandatory) can no longer ack,
    // advance the baseline/rev, or let a rebased body adopt. Requeue the inflight batch with its
    // exact token to preserve its intent, then abort the hop.
    active.saveAttempt += 1;
    if (active.saveToken !== null) {
      active.queue = queueFail(active.queue, active.saveToken);
      active.saveToken = null;
    }
    active.saveAbort?.abort();
    active.saveAbort = null;
    active.snapshotRecoveryRequired = true;
    markConflict(
      active,
      "Local pending operations exceeded the safe limit. Autosave is paused without discarding the local snapshot."
    );
    deps.notifyApiError?.({
      success: false,
      code: "INTERNAL",
      error: "Local pending operations exceeded the safe limit; autosave is paused to preserve edits.",
    });
    // Persist the current full document (including the cap-rejected visible edit), the requeued
    // operations, and the snapshot-recovery marker so the overflow intent survives a reload.
    void persistShadow(active);
  }

  function enqueueDelta(active: RuntimeSession, ops: CanvasOp[]): boolean {
    if (queuedOperationCount(active.queue) + ops.length > OFFLINE_QUEUE_MAX_PENDING) {
      markQueueOverflow(active);
      return false;
    }
    for (const op of ops) {
      const opId = `${active.createId ?? active.activeId ?? "local"}:${active.opCounter}`;
      active.opCounter += 1;
      active.queue = queueEnqueue(active.queue, opId, op);
    }
    return true;
  }

  function configuredShadow(): CanvasShadowStore | null {
    return deps.shadow ?? null;
  }

  function sameShadowLease(
    left: CanvasShadowLease | null,
    right: CanvasShadowLease
  ): boolean {
    return !!left &&
      left.canvasId === right.canvasId &&
      left.ownerId === right.ownerId &&
      left.ownerEpoch === right.ownerEpoch &&
      left.writeSeq === right.writeSeq;
  }

  function samePendingLease(
    left: CanvasPendingCreateLease | null,
    right: CanvasPendingCreateLease
  ): boolean {
    return !!left &&
      left.ownerId === right.ownerId &&
      left.ownerEpoch === right.ownerEpoch &&
      left.writeSeq === right.writeSeq;
  }

  function requeueActiveSave(active: RuntimeSession): void {
    active.saveAttempt += 1;
    active.recoveryEpoch += 1;
    if (active.saveToken !== null) {
      active.queue = queueFail(active.queue, active.saveToken);
      active.saveToken = null;
    }
    active.saveAbort?.abort();
    active.saveAbort = null;
  }

  function retainActiveIntentForTakeover(active: RuntimeSession): void {
    synchronizeSessionHandoff(active);
    if (active.activeId === null) return;
    const retained = readSessionHandoff(active.activeId);
    if (retained) active.retainedHandoff = retained;
  }

  function fenceShadowOwnership(
    active: RuntimeSession,
    message: string,
    retry: boolean = true
  ): void {
    if (!isActive(active)) return;
    requeueActiveSave(active);
    // `persistShadow` synchronizes the latest visible document before crossing the CAS boundary.
    // If that write did not commit, the old durable shadow is insufficient for retry takeover;
    // retain and immediately re-read the same-realm proof before a fresh GET can replace the store.
    // Keep it for stale ownership too so a later exact writer signal can recover the intent.
    retainActiveIntentForTakeover(active);
    active.shadowLease = null;
    active.shadowReady = false;
    if (!retry) {
      active.writerAcquired = false;
      active.writerTag = null;
      active.writerEpoch += 1;
      active.takeoverAttempt += 1;
      active.takeoverInFlight = false;
      clearTimers(active);
    }
    active.issue = { code: "failed", message };
    active.mode = "loading";
    publishRuntimeState(active);
    if (retry) scheduleRetry(active);
  }

  async function enqueueShadowMutation<T>(
    active: RuntimeSession,
    mutation: () => Promise<T>
  ): Promise<T> {
    const execution = active.shadowMutationChain.catch(() => {}).then(mutation);
    active.shadowMutationChain = execution.then(
      () => {},
      () => {}
    );
    return execution;
  }

  interface ShadowWriteSnapshot {
    doc: CanvasDoc;
    deps: CanvasDeps;
    queue: OfflineQueueState;
    snapshotRecoveryRequired: boolean;
    serverRecoveryRequired: boolean;
    localRecoveryRequired: boolean;
  }

  async function writeShadowSnapshot(
    active: RuntimeSession,
    snapshotState: ShadowWriteSnapshot
  ): Promise<boolean> {
    const shadow = configuredShadow();
    // Tests/non-browser embedders may intentionally omit D4. A configured-but-unavailable D4
    // is different: production must stay inert rather than pretending a durable write happened.
    if (!shadow) return true;
    if (
      !shadow.available ||
      active.activeId === null ||
      !active.writerAcquired ||
      active.writerTag === null ||
      active.shadowLease === null ||
      active.shadowLease.canvasId !== active.activeId
    ) {
      return false;
    }
    const validated = validateCanvasDoc(snapshotState.doc);
    if (!validated.ok || validated.data === null) return false;
    const queue = queueIsDirty(snapshotState.queue)
      ? queueSnapshot(snapshotState.queue)
      : null;
    try {
      return await enqueueShadowMutation(active, async () => {
        if (!isActive(active) || !active.writerAcquired || active.shadowLease === null) {
          return false;
        }
        const lease = active.shadowLease;
        const writerEpoch = active.writerEpoch;
        const writerTag = active.writerTag;
        let result;
        try {
          result = await shadow.putIfOwned(
            {
              canvasId: active.activeId as string,
              doc: validated.data as CanvasDoc,
              deps: snapshotState.deps,
              serverRev: snapshotState.queue.baseRev,
              queue,
              snapshotRecoveryRequired: snapshotState.snapshotRecoveryRequired,
              serverRecoveryRequired: snapshotState.serverRecoveryRequired,
              localRecoveryRequired: snapshotState.localRecoveryRequired,
            },
            lease
          );
        } catch {
          if (
            isActive(active) &&
            writerEpoch === active.writerEpoch &&
            writerTag === active.writerTag &&
            sameShadowLease(active.shadowLease, lease)
          ) {
            fenceShadowOwnership(
              active,
              "The durable canvas shadow could not be written safely. Autosave will retry."
            );
          }
          return false;
        }
        if (
          !isActive(active) ||
          writerEpoch !== active.writerEpoch ||
          writerTag !== active.writerTag ||
          !sameShadowLease(active.shadowLease, lease)
        ) return false;
        if (result.status === "written") {
          active.shadowLease = result.lease;
          active.shadowReady = true;
          return true;
        }
        if (result.status === "stale") {
          fenceShadowOwnership(
            active,
            "Another writer took ownership of the durable canvas shadow. Autosave is paused.",
            false
          );
          return false;
        }
        fenceShadowOwnership(
          active,
          "The durable canvas shadow could not be written safely. Autosave will retry."
        );
        return false;
      });
    } catch {
      return false;
    }
  }

  async function persistShadow(active: RuntimeSession): Promise<boolean> {
    // The in-memory handoff is a same-realm fallback, but it never authorizes transport.
    synchronizeSessionHandoff(active);
    const state = store.getState();
    if (!identitiesMatch(active, state)) return false;
    const validated = validateCanvasDoc(readDoc(state));
    if (!validated.ok || validated.data === null) return false;
    return writeShadowSnapshot(active, {
      doc: validated.data,
      deps: active.deps,
      queue: active.queue,
      snapshotRecoveryRequired: active.snapshotRecoveryRequired,
      serverRecoveryRequired: active.serverRecoveryRequired,
      localRecoveryRequired: state.recoveryRequired,
    });
  }

  async function removeShadow(active: RuntimeSession): Promise<boolean> {
    const shadow = configuredShadow();
    if (!shadow) return true;
    if (
      !shadow.available ||
      active.activeId === null ||
      !active.writerAcquired ||
      active.shadowLease === null
    ) {
      return false;
    }
    try {
      return await enqueueShadowMutation(active, async () => {
        if (!isActive(active) || active.shadowLease === null) return false;
        const lease = active.shadowLease;
        const writerEpoch = active.writerEpoch;
        const writerTag = active.writerTag;
        let result;
        try {
          result = await shadow.removeIfOwned(lease);
        } catch {
          if (
            isActive(active) &&
            writerEpoch === active.writerEpoch &&
            writerTag === active.writerTag &&
            sameShadowLease(active.shadowLease, lease)
          ) {
            fenceShadowOwnership(active, "Canvas shadow cleanup could not be confirmed safely.");
          }
          return false;
        }
        if (
          !isActive(active) ||
          writerEpoch !== active.writerEpoch ||
          writerTag !== active.writerTag ||
          !sameShadowLease(active.shadowLease, lease)
        ) return false;
        if (result.status === "removed") {
          active.shadowLease = result.lease;
          active.shadowReady = true;
          return true;
        }
        if (result.status === "stale") {
          fenceShadowOwnership(active, "Canvas shadow ownership changed before cleanup.", false);
        } else {
          fenceShadowOwnership(active, "Canvas shadow cleanup could not be confirmed safely.");
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  function scheduleFlush(active: RuntimeSession): void {
    if (active.disposed || active.conflicted) return;
    if (active.flushTimer !== null) return; // leading debounce, bounded by debounceMs (≤5s)
    active.flushTimer = scheduler.setTimeout(() => {
      active.flushTimer = null;
      void flush(active);
    }, debounceMs);
  }

  function scheduleRetry(active: RuntimeSession): void {
    if (active.disposed) return;
    if (active.retryTimer !== null) return;
    const delay = Math.min(maxRetryMs, active.retryDelay > 0 ? active.retryDelay : RETRY_BASE_MS);
    active.retryDelay = Math.min(maxRetryMs, delay * 2);
    active.retryTimer = scheduler.setTimeout(() => {
      active.retryTimer = null;
      pump(active);
    }, delay);
  }

  function pump(active: RuntimeSession): void {
    if (!isActive(active) || active.conflicted) return;
    if (active.mode === "persisted" || active.mode === "repairing") {
      void flush(active);
    } else if (active.mode === "local") {
      // Retry the first-mutation create with the same (idempotent) createId.
      if (active.pendingCreateRecord !== null) {
        void runCreate(active, active.pendingCreateRecord.capturedDoc);
      } else {
        handleStoreChange();
      }
    } else if (active.mode === "loading") {
      if (active.activeId === null) void bootstrapLocal(active);
      else if (!active.bootstrapReady) void bootstrapPersisted(active);
      else if (active.writerAcquired) void beginWriterTakeover(active);
      else void runLoad(active);
    }
  }

  function pendingQueueProof(
    record: CanvasPendingCreateRecord
  ): OfflineQueueState | null {
    const restored = record.trailingQueue
      ? queueRestore(record.trailingQueue)
      : createOfflineQueue(0);
    if (restored === null || restored.baseRev !== 0 || restored.inflight !== null) return null;
    const replayed = applyOpsToDoc(record.capturedDoc, previewOps(restored));
    if (!replayed.ok) return null;
    const uncovered = diffDocs(replayed.doc, record.latestDoc);
    return uncovered !== null && uncovered.length === 0 ? restored : null;
  }

  function pendingLoadResult(doc: CanvasDoc): LoadCanvasResult {
    return {
      nodes: doc.nodes,
      brokenNodes: [],
      edges: doc.edges,
      brokenEdges: [],
      groups: doc.groups,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      migratedFrom: CANVAS_SCHEMA_VERSION,
      targetSchemaVersion: CANVAS_SCHEMA_VERSION,
      migrationComplete: true,
      recoveryRequired: false,
      issues: [],
    };
  }

  function pendingStorageFailure(active: RuntimeSession, message: string): void {
    if (!isActive(active)) return;
    active.issue = { code: "failed", message };
    active.mode = "loading";
    publishRuntimeState(active);
    scheduleRetry(active);
  }

  async function claimPendingCreate(
    active: RuntimeSession
  ): Promise<CanvasPendingCreateRecord | null | undefined> {
    const shadow = configuredShadow();
    if (!shadow) return null;
    if (!shadow.available) return undefined;
    const writerEpoch = active.writerEpoch;
    let result;
    try {
      result = await shadow.pendingCreate.claim(deps.shadowOwnerId);
    } catch {
      return undefined;
    }
    if (!isActive(active) || writerEpoch !== active.writerEpoch) return undefined;
    if (result.status !== "claimed") return undefined;
    active.pendingCreateLease = result.lease;
    active.pendingCreateRecord = result.record;
    if (result.record !== null && pendingQueueProof(result.record) === null) {
      active.pendingCreateLease = null;
      active.pendingCreateRecord = null;
      return undefined;
    }
    return result.record;
  }

  async function persistPendingCreate(
    active: RuntimeSession,
    phase: "pending" | "posting" | "created-awaiting-route"
  ): Promise<boolean> {
    const shadow = configuredShadow();
    if (!shadow) return true;
    try {
      return await enqueueShadowMutation(active, async () => {
        if (!isActive(active)) return false;
        const record = active.pendingCreateRecord;
        const lease = active.pendingCreateLease;
        if (!shadow.available || record === null || lease === null) return false;
        const state = store.getState();
        const latest = validateCanvasDoc(readDoc(state));
        if (!latest.ok || latest.data === null) return false;
        const proofQueue = active.queue.inflight === null ? active.queue : queueFail(
          active.queue,
          active.queue.inflight.token
        );
        const phaseRank = { pending: 0, posting: 1, "created-awaiting-route": 2 } as const;
        const nextPhase = phaseRank[record.phase] > phaseRank[phase] ? record.phase : phase;
        const input = {
          createId: record.createId,
          capturedDoc: record.capturedDoc,
          latestDoc: latest.data,
          trailingQueue: queueIsDirty(proofQueue) ? queueSnapshot(proofQueue) : null,
          phase: nextPhase,
        };
        const leaseAtWrite = lease;
        let result;
        try {
          result = await shadow.pendingCreate.putIfOwned(input, lease);
        } catch {
          if (isActive(active) && samePendingLease(active.pendingCreateLease, leaseAtWrite)) {
            active.pendingCreateLease = null;
            pendingStorageFailure(active, "The pending canvas creation could not be stored safely.");
          }
          return false;
        }
        if (!isActive(active) || !samePendingLease(active.pendingCreateLease, leaseAtWrite)) {
          return false;
        }
        if (result.status !== "written") {
          active.pendingCreateLease = null;
          if (result.status === "stale") {
            failSession(
              active,
              "Another tab took ownership of the pending canvas creation. Reload to recover its latest durable state."
            );
          } else {
            pendingStorageFailure(active, "The pending canvas creation could not be stored safely.");
          }
          return false;
        }
        active.pendingCreateLease = result.lease;
        let updatedAt = "1970-01-01T00:00:00.000Z";
        try {
          updatedAt = new Date(Number.isFinite(scheduler.now()) ? scheduler.now() : 0).toISOString();
        } catch {
          // Diagnostic only; retain a canonical timestamp.
        }
        active.pendingCreateRecord = {
          ...record,
          latestDoc: latest.data,
          trailingQueue: input.trailingQueue,
          phase: nextPhase,
          updatedAt,
        };
        return true;
      });
    } catch {
      return false;
    }
  }

  async function seedPendingCreate(
    active: RuntimeSession,
    seed: {
      createId: string;
      capturedDoc: CanvasDoc;
      latestDoc: CanvasDoc;
      trailingQueue: OfflineQueueSnapshot | null;
      phase: "pending";
    }
  ): Promise<CanvasPendingCreateRecord | null> {
    const shadow = configuredShadow();
    const lease = active.pendingCreateLease;
    if (!shadow || !shadow.available || lease === null) return null;
    try {
      const result = await shadow.pendingCreate.putIfOwned(seed, lease);
      if (!isActive(active) || !samePendingLease(active.pendingCreateLease, lease)) return null;
      if (result.status !== "written") {
        active.pendingCreateLease = null;
        if (result.status === "stale") {
          failSession(active, "Another local tab claimed the pending creation before it was seeded.");
        } else {
          pendingStorageFailure(active, "The pending creation could not be seeded safely.");
        }
        return null;
      }
      let updatedAt = "1970-01-01T00:00:00.000Z";
      try {
        updatedAt = new Date(Number.isFinite(scheduler.now()) ? scheduler.now() : 0).toISOString();
      } catch {
        // diagnostic only
      }
      const record: CanvasPendingCreateRecord = {
        version: 1,
        ...seed,
        updatedAt,
      };
      active.pendingCreateLease = result.lease;
      active.pendingCreateRecord = record;
      return record;
    } catch {
      if (isActive(active) && samePendingLease(active.pendingCreateLease, lease)) {
        active.pendingCreateLease = null;
        pendingStorageFailure(active, "The pending creation could not be seeded safely.");
      }
      return null;
    }
  }

  async function bootstrapLocal(active: RuntimeSession): Promise<void> {
    if (!isActive(active) || active.activeId !== null || active.bootstrapInFlight) return;
    const attempt = ++active.bootstrapAttempt;
    active.bootstrapInFlight = true;
    const record = await claimPendingCreate(active);
    if (!isActive(active) || attempt !== active.bootstrapAttempt) return;
    active.bootstrapInFlight = false;
    if (record === undefined) {
      pendingStorageFailure(active, "The pending canvas creation could not be read safely.");
      return;
    }
    if (record === null) {
      // Same-realm upgrade bridge: migrate the old in-memory intent into the durable singleton
      // before retrying. A hard reload has no such cache and therefore relies solely on IDB.
      let legacy: CanvasCreateIntent | null = null;
      try {
        legacy = decodeCreateIntent(createIntentStore.get());
      } catch {
        legacy = null;
      }
      if (legacy !== null && configuredShadow()) {
        const current = validateCanvasDoc(readDoc(store.getState()));
        const trailing = current.ok && current.data
          ? diffDocs(legacy.capturedDoc, current.data)
          : null;
        if (current.ok && current.data && trailing !== null) {
          let queue = createOfflineQueue(0);
          for (const op of trailing) {
            queue = queueEnqueue(queue, `${legacy.id}:migrate:${active.opCounter}`, op);
            active.opCounter += 1;
          }
          const migrated = await seedPendingCreate(active, {
            createId: legacy.id,
            capturedDoc: legacy.capturedDoc,
            latestDoc: current.data,
            trailingQueue: queueIsDirty(queue) ? queueSnapshot(queue) : null,
            phase: "pending",
          });
          if (!isActive(active) || attempt !== active.bootstrapAttempt) return;
          if (migrated) {
            active.queue = queue;
            active.baseline = current.data;
            active.createId = migrated.createId;
            setMode(active, "local");
            void runCreate(active, migrated.capturedDoc);
            return;
          }
        }
      }
      setMode(active, "local");
      active.baseline = readDoc(store.getState());
      handleStoreChange();
      return;
    }
    const restored = pendingQueueProof(record);
    if (restored === null || !store.hydrate(pendingLoadResult(record.latestDoc), null)) {
      pendingStorageFailure(active, "The retained canvas creation proof was invalid.");
      return;
    }
    active.createId = record.createId;
    active.queue = restored;
    active.baseline = record.latestDoc;
    active.deps = createEmptyCanvasDeps();
    if (record.phase === "created-awaiting-route") {
      if (!store.promoteLocalToPersisted(record.createId)) {
        failSession(active, "The created pending canvas could not adopt its persisted identity.");
        return;
      }
      active.activeId = record.createId;
      setMode(active, "creating");
      try {
        deps.canonicalizeUrl?.(record.createId);
      } catch {
        pendingStorageFailure(active, "The created canvas route could not be restored.");
      }
      return;
    }
    setMode(active, "local");
    void runCreate(active, record.capturedDoc);
  }

  async function runCreate(active: RuntimeSession, capturedDoc: CanvasDoc): Promise<void> {
    if (!isActive(active) || active.mode !== "local") return;
    setMode(active, "creating");

    let intent: CanvasCreateIntent | null = active.pendingCreateRecord
      ? {
          id: active.pendingCreateRecord.createId,
          capturedDoc: active.pendingCreateRecord.capturedDoc,
        }
      : null;
    const shadow = configuredShadow();
    if (shadow) {
      if (!shadow.available) {
        pendingStorageFailure(active, "Durable storage is unavailable; canvas creation is paused.");
        return;
      }
      if (intent === null) {
        const generatedId = deps.uuid();
        const id = typeof generatedId === "string" ? generatedId.toLowerCase() : generatedId;
        const validated = validateCanvasDoc(capturedDoc);
        if (!CANVAS_UUID_RE.test(id) || !validated.ok || validated.data === null) {
          failSession(active, "The local canvas could not produce a valid persistent identity.");
          return;
        }
        const seed = {
          createId: id,
          capturedDoc: validated.data,
          latestDoc: validated.data,
          trailingQueue: null,
          phase: "pending" as const,
        };
        if (!active.pendingCreateLease) {
          failSession(active, "The local pending-create lease was lost before seeding.");
          return;
        }
        const claimed = await seedPendingCreate(active, seed);
        if (!isActive(active)) return;
        if (claimed === undefined || claimed === null) {
          pendingStorageFailure(active, "The pending canvas creation could not be claimed safely.");
          return;
        }
        const restored = pendingQueueProof(claimed);
        if (restored === null) {
          pendingStorageFailure(active, "The pending canvas creation proof was invalid.");
          return;
        }
        intent = { id: claimed.createId, capturedDoc: claimed.capturedDoc };
        active.queue = restored;
        active.baseline = claimed.latestDoc;
      }
      // Edits may land while the initial IDB claim is pending. They could not be observed by the
      // creating handler before pendingCreateRecord existed, so reconcile them explicitly into
      // the trailing proof before the first `posting` write.
      const latestDuringClaim = validateCanvasDoc(readDoc(store.getState()));
      if (!latestDuringClaim.ok || latestDuringClaim.data === null) {
        pendingStorageFailure(active, "Edits made while claiming the pending creation were invalid.");
        return;
      }
      const claimDelta = diffDocs(active.baseline, latestDuringClaim.data);
      if (claimDelta === null || !enqueueDelta(active, claimDelta)) {
        pendingStorageFailure(active, "Edits made while claiming the pending creation could not be preserved.");
        return;
      }
      active.baseline = latestDuringClaim.data;
      if (!(await persistPendingCreate(active, "posting"))) return;
    } else {
      let stored: unknown = null;
      try {
        stored = createIntentStore.get();
      } catch {
        failSession(active, "The pending canvas create intent could not be read safely.");
        return;
      }
      intent = intent ?? decodeCreateIntent(stored);
      if (intent === null) {
        const staleId = readOwnDataValue(stored, "id");
        if (typeof staleId === "string") {
          try {
            createIntentStore.clear(staleId);
          } catch {
            failSession(active, "A damaged pending create intent could not be cleared safely.");
            return;
          }
        }
        const generatedId = deps.uuid();
        const id = typeof generatedId === "string" ? generatedId.toLowerCase() : generatedId;
        const validated = validateCanvasDoc(capturedDoc);
        if (!CANVAS_UUID_RE.test(id) || !validated.ok || validated.data === null) {
          failSession(active, "The local canvas could not produce a valid persistent identity.");
          return;
        }
        intent = { id, capturedDoc: validated.data };
        try {
          createIntentStore.set(intent);
        } catch {
          failSession(active, "The pending canvas create intent could not be stored safely.");
          return;
        }
      }
    }
    if (intent === null) {
      failSession(active, "The pending canvas creation identity was unavailable.");
      return;
    }
    active.createId = intent.id;

    const abort = makeAbortHandle();
    active.createAbort = abort;
    let response: CanvasRuntimeResponse;
    try {
      response = await deps.fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: intent.id, doc: intent.capturedDoc }),
        signal: abort.signal,
      });
    } catch {
      if (!isActive(active)) return;
      active.createAbort = null;
      // Network failure: revert to local so a reconnect / next edit retries with the SAME id.
      setMode(active, "local");
      scheduleRetry(active);
      return;
    }
    if (!isActive(active)) return;
    active.createAbort = null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!isActive(active)) return;

    const decoded = decodeApiBody(body);
    if (!(response.ok && decoded.success && decoded.data)) {
      if (isTransientHttpStatus(response.status)) {
        setMode(active, "local");
        scheduleRetry(active);
        return;
      }
      if (deps.notifyApiError) deps.notifyApiError(body);
      failSession(active, "Canvas creation was rejected. Local editing is paused to preserve the document.");
      return;
    }

    const created = decodeCreatedData(decoded.data, intent.id);
    if (created === null) {
      failSession(active, "The canvas create response was not trustworthy.");
      return;
    }

    // The server row may already be committed even if a prior response was lost. Reach a stable
    // created-phase CAS cutover before touching the local identity or URL. An edit can enqueue a
    // second pending mutation while the first IDB write is awaiting its response; merely awaiting
    // that first write would let promotion dispose the session before the later mutation runs.
    // Drain the exact per-session chain, reconcile any unobserved store delta, write again, and
    // proceed to promotion in the same synchronous continuation only when no later mutation was
    // enqueued across the awaited write.
    if (shadow) {
      while (true) {
        const queuedMutations = active.shadowMutationChain;
        await queuedMutations;
        if (!isActive(active)) return;
        if (queuedMutations !== active.shadowMutationChain) continue;

        const latestBeforeWrite = validateCanvasDoc(readDoc(store.getState()));
        if (!latestBeforeWrite.ok || latestBeforeWrite.data === null) {
          pendingStorageFailure(active, "Edits made before route adoption were invalid.");
          return;
        }
        const beforeWriteDelta = diffDocs(active.baseline, latestBeforeWrite.data);
        if (beforeWriteDelta === null) {
          pendingStorageFailure(active, "Edits made before route adoption could not be represented safely.");
          return;
        }
        if (beforeWriteDelta.length > 0) {
          if (!enqueueDelta(active, beforeWriteDelta)) return;
          active.baseline = latestBeforeWrite.data;
        }

        const persistence = persistPendingCreate(active, "created-awaiting-route");
        const persistenceChain = active.shadowMutationChain;
        if (!(await persistence)) return;
        if (!isActive(active)) return;
        if (persistenceChain !== active.shadowMutationChain) continue;

        const latestAfterWrite = validateCanvasDoc(readDoc(store.getState()));
        if (!latestAfterWrite.ok || latestAfterWrite.data === null) {
          pendingStorageFailure(active, "Edits made during route adoption were invalid.");
          return;
        }
        const afterWriteDelta = diffDocs(active.baseline, latestAfterWrite.data);
        if (afterWriteDelta === null) {
          pendingStorageFailure(active, "Edits made during route adoption could not be represented safely.");
          return;
        }
        if (afterWriteDelta.length > 0) {
          if (!enqueueDelta(active, afterWriteDelta)) return;
          active.baseline = latestAfterWrite.data;
          continue;
        }
        break;
      }
    }

    // Promote the still-local, hydrated doc onto the persisted id (preserves doc + history).
    if (!store.promoteLocalToPersisted(intent.id)) {
      failSession(active, "The local canvas could not adopt the persisted identity safely.");
      return;
    }
    active.activeId = intent.id;
    // A durable create does not pretend the route already changed. The canonical configure(id)
    // must observe and adopt `created-awaiting-route` before any PATCH can run.
    if (!shadow) active.targetCanvasId = intent.id;
    active.deps = createEmptyCanvasDeps();
    active.serverRecoveryRequired = false;
    const current = readDoc(store.getState());
    if (shadow) {
      // The durable pending queue already proves every post-capture edit with stable opIds.
      // Rebuilding it from a diff would duplicate those operations during canonical adoption.
      if (active.queue.baseRev !== created.rev) {
        failSession(active, "The created row revision did not match its durable pending proof.");
        return;
      }
      active.baseline = current;
    } else {
      active.queue = createOfflineQueue(created.rev);
      // Legacy baseline = exact POSTed doc; edits made during POST are diffed from it.
      active.baseline = intent.capturedDoc;
      const delta = diffDocs(intent.capturedDoc, current);
      if (delta && delta.length > 0) {
        if (enqueueDelta(active, delta)) active.baseline = current;
      }
    }
    // The in-memory compatibility intent can retire now; the durable singleton remains until a
    // canonical route, exact writer lease and normal shadow write have all been confirmed.
    try {
      createIntentStore.clear(intent.id);
    } catch {
      markConflict(active, "The completed create intent could not be retired safely.");
    }
    // Start canonical navigation before awaiting IndexedDB. The bootstrap keeps this promoted
    // identity intact while the route catches up, so a slow shadow write cannot freeze the UI
    // on the local URL or reset the newly persisted document.
    try {
      deps.canonicalizeUrl?.(intent.id);
    } catch {
      // The store already owns the persisted identity; URL replacement is best-effort.
    }
    if (!isActive(active)) return;
    if (shadow) {
      setMode(active, "creating");
      return;
    }
    // Legacy/non-browser embedding: retain the prior immediate adoption behavior, but transport
    // still requires an explicit writer signal before `flush` can cross the network boundary.
    setMode(active, "persisted");
    if (queueIsDirty(active.queue)) scheduleFlush(active);
  }

  async function discoverPendingForRoute(active: RuntimeSession): Promise<boolean> {
    const shadow = configuredShadow();
    if (!shadow) return true;
    if (!shadow.available || active.activeId === null) return false;
    let read;
    try {
      read = await shadow.pendingCreate.read();
    } catch {
      return false;
    }
    if (!isActive(active)) return false;
    if (read.status === "absent") return true;
    if (read.status !== "found") return false;
    if (read.record.createId !== active.activeId) return true;
    if (pendingQueueProof(read.record) === null) return false;
    // Persisted readers are strictly non-mutating. The exact D5 writer claims this singleton in
    // beginWriterTakeover, immediately before the normal shadow takeover barrier.
    active.pendingCreateRecord = read.record;
    active.pendingCreateLease = null;
    active.pendingRouteObserved = true;
    active.pendingRetired = false;
    return true;
  }

  async function claimPendingForWriter(active: RuntimeSession): Promise<boolean> {
    const shadow = configuredShadow();
    if (!shadow || active.activeId === null) return true;
    if (!shadow.available || !active.writerAcquired) return false;
    let read;
    try {
      read = await shadow.pendingCreate.read();
    } catch {
      return false;
    }
    if (!isActive(active) || !active.writerAcquired) return false;
    if (read.status === "absent") {
      active.pendingCreateRecord = null;
      active.pendingCreateLease = null;
      active.pendingRetired = true;
      return true;
    }
    if (read.status !== "found") return false;
    if (read.record.createId !== active.activeId) {
      active.pendingCreateRecord = null;
      active.pendingCreateLease = null;
      active.pendingRetired = true;
      return true;
    }
    const writerEpoch = active.writerEpoch;
    let claimed;
    try {
      claimed = await shadow.pendingCreate.claimIfMatches(deps.shadowOwnerId, {
        createId: active.activeId,
        phase: read.record.phase,
      });
    } catch {
      return false;
    }
    if (!isActive(active) || !active.writerAcquired || writerEpoch !== active.writerEpoch) {
      return false;
    }
    if (
      claimed.status !== "claimed" ||
      !claimed.record ||
      claimed.record.createId !== active.activeId
    ) {
      active.pendingCreateRecord = null;
      active.pendingCreateLease = null;
      active.pendingRetired = true;
      return false;
    }
    if (pendingQueueProof(claimed.record) === null) return false;
    active.pendingCreateRecord = claimed.record;
    active.pendingCreateLease = claimed.lease;
    active.pendingRouteObserved = true;
    active.pendingRetired = false;
    return true;
  }

  async function retireDurablePendingCreate(active: RuntimeSession): Promise<boolean> {
    const shadow = configuredShadow();
    const record = active.pendingCreateRecord;
    if (!shadow || record === null) {
      active.pendingRetired = true;
      return true;
    }
    if (
      !shadow.available ||
      !active.pendingRouteObserved ||
      active.pendingCreateLease === null ||
      record.phase !== "created-awaiting-route"
    ) {
      return false;
    }
    try {
      const leaseAtRemove = active.pendingCreateLease;
      const removed = await shadow.pendingCreate.removeIfOwned(leaseAtRemove, {
        createId: record.createId,
        phase: "created-awaiting-route",
      });
      if (!isActive(active) || !samePendingLease(active.pendingCreateLease, leaseAtRemove)) {
        return false;
      }
      if (removed.status === "removed") {
        active.pendingCreateLease = removed.lease;
        active.pendingCreateRecord = null;
        active.pendingRetired = true;
        return true;
      }
      if (removed.status === "stale") {
        active.pendingCreateLease = null;
        failSession(
          active,
          "Another tab took ownership of the completed pending creation before retirement."
        );
        return false;
      }
      // A transaction may commit while its completion signal is lost. A discriminated read is
      // the only safe convergence proof; failure is never treated as absence.
      const read = await shadow.pendingCreate.read();
      if (!isActive(active)) return false;
      if (read.status === "absent") {
        active.pendingCreateLease = null;
        active.pendingCreateRecord = null;
        active.pendingRetired = true;
        return true;
      }
      if (read.status === "found") {
        active.pendingCreateLease = null;
        if (read.record.createId !== record.createId) {
          // A no-longer-matching singleton is not ours to mutate; the expected create intent is
          // already retired, and the unrelated replacement remains untouched.
          active.pendingCreateRecord = null;
          active.pendingRetired = true;
          return true;
        }
        // Failure + still-found is not evidence of ownership loss. Retry through the atomic
        // expected-id claim barrier; transport remains blocked meanwhile.
      }
      return false;
    } catch {
      return false;
    }
  }

  async function bootstrapPersisted(active: RuntimeSession): Promise<void> {
    if (!isActive(active) || active.activeId === null || active.bootstrapInFlight) return;
    const attempt = ++active.bootstrapAttempt;
    active.bootstrapInFlight = true;
    if (!(await discoverPendingForRoute(active))) {
      if (attempt === active.bootstrapAttempt) active.bootstrapInFlight = false;
      if (isActive(active) && attempt === active.bootstrapAttempt) {
        pendingStorageFailure(active, "Pending canvas creation state could not be read safely.");
      }
      return;
    }
    if (!isActive(active) || attempt !== active.bootstrapAttempt) return;
    active.bootstrapInFlight = false;
    active.bootstrapReady = true;
    if (active.writerAcquired) void beginWriterTakeover(active);
    else void runLoad(active);
  }

  async function beginWriterTakeover(active: RuntimeSession): Promise<void> {
    if (
      !isActive(active) ||
      active.activeId === null ||
      !active.writerAcquired ||
      active.writerTag === null ||
      !active.bootstrapReady ||
      active.takeoverInFlight
    ) {
      return;
    }
    const takeoverAttempt = ++active.takeoverAttempt;
    const writerEpoch = active.writerEpoch;
    active.shadowReady = false;
    active.issue = null;
    setMode(active, "loading");
    active.takeoverInFlight = true;
    try {
    const shadow = configuredShadow();
    let claimedRecord: CanvasShadowRecord | null = null;
    if (shadow) {
      if (!shadow.available) {
        pendingStorageFailure(active, "Durable canvas storage is unavailable.");
        return;
      }
      if (!(await claimPendingForWriter(active))) {
        pendingStorageFailure(active, "The pending created canvas could not be claimed safely.");
        return;
      }
      if (
        !isActive(active) ||
        takeoverAttempt !== active.takeoverAttempt ||
        writerEpoch !== active.writerEpoch ||
        !active.writerAcquired
      ) return;
      let result;
      try {
        result = await shadow.claim(active.activeId, deps.shadowOwnerId);
      } catch {
        result = { status: "failure" as const, reason: "transaction" as const };
      }
      if (
        !isActive(active) ||
        takeoverAttempt !== active.takeoverAttempt ||
        writerEpoch !== active.writerEpoch ||
        !active.writerAcquired
      ) {
        return;
      }
      if (result.status !== "claimed") {
        active.shadowLease = null;
        pendingStorageFailure(active, "The latest durable canvas shadow could not be claimed safely.");
        return;
      }
      active.shadowLease = result.lease;
      claimedRecord = result.record;
    }
    await runLoad(active, {
      force: true,
      writerEpoch,
      claimedRecord,
      takeoverAttempt,
    });
    } finally {
      if (takeoverAttempt === active.takeoverAttempt) active.takeoverInFlight = false;
    }
  }

  async function runLoad(
    active: RuntimeSession,
    writerContext?: {
      force: true;
      writerEpoch: number;
      claimedRecord: CanvasShadowRecord | null;
      takeoverAttempt: number;
    }
  ): Promise<void> {
    if (
      !isActive(active) ||
      active.activeId === null ||
      (active.loadInFlight && !writerContext?.force)
    ) return;
    const loadAttempt = ++active.loadAttempt;
    active.loadInFlight = true;
    const loadIsCurrent = (): boolean =>
      isActive(active) &&
      loadAttempt === active.loadAttempt &&
      (!writerContext ||
        (active.writerAcquired &&
          active.writerEpoch === writerContext.writerEpoch &&
          active.takeoverAttempt === writerContext.takeoverAttempt));
    try {
    const abort = makeAbortHandle();
    active.createAbort = abort;
    let response: CanvasRuntimeResponse;
    try {
      response = await deps.fetch(`${basePath}/${active.activeId}`, {
        method: "GET",
        signal: abort.signal,
      });
    } catch {
      if (!loadIsCurrent()) return;
      active.createAbort = null;
      setMode(active, "loading");
      scheduleRetry(active);
      return;
    }
    if (!loadIsCurrent()) return;
    active.createAbort = null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!loadIsCurrent()) return;

    const decoded = decodeApiBody(body);
    if (!(response.ok && decoded.success && decoded.data)) {
      if (isTransientHttpStatus(response.status)) {
        setMode(active, "loading");
        scheduleRetry(active);
        return;
      }
      if (deps.notifyApiError) deps.notifyApiError(body);
      failSession(active, "The persisted canvas could not be loaded.");
      return;
    }

    const data = decodeDocumentData(decoded.data, active.activeId);
    if (data === null) {
      failSession(active, "The canvas load response was not trustworthy.");
      return;
    }
    // The fresh GET is always authoritative initially. A singleton store document is only a
    // cache; proven local work is replayed below from the user-scoped handoff queue. Never diff
    // GET -> arbitrary retained doc: that manufactures inverse operations for remote changes.
    if (!store.hydrate(data.loadResult, active.activeId)) {
      failSession(active, "The loaded canvas could not be adopted by the active session.");
      return;
    }
    active.queue = createOfflineQueue(data.rev);
    active.deps = data.deps;
    active.saveProof = data.saveProof;
    active.serverRecoveryRequired = data.loadResult.recoveryRequired;
    active.baseline = readDoc(store.getState());
    let handoffOutcome: "none" | "applied" | "halted" = "none";
    if (!writerContext?.claimedRecord && writerContext && active.pendingCreateRecord === null) {
      handoffOutcome = applySessionHandoff(active, data);
    }
    if (handoffOutcome === "halted") return;
    let mayReplaceShadow = true;
    if (writerContext?.claimedRecord) {
      mayReplaceShadow = await tryShadowReplay(
        active,
        data.rev,
        writerContext.claimedRecord,
        data.loadResult
      );
      if (mayReplaceShadow && active.pendingCreateRecord === null) {
        handoffOutcome = mergeRetainedHandoffAfterShadow(active, data);
        if (handoffOutcome === "halted") return;
      }
    } else if (writerContext && active.pendingCreateRecord !== null) {
      if (active.pendingCreateRecord.createId !== active.activeId) {
        markConflict(active, "A pending creation belonged to a different canvas identity.");
        return;
      }
      const restored = pendingQueueProof(active.pendingCreateRecord);
      if (restored === null) {
        markConflict(active, "The pending canvas creation proof became invalid.");
        return;
      }
      const reanchored: OfflineQueueState = { ...restored, baseRev: data.rev };
      if (queueIsDirty(reanchored) && !applyRecoveredQueue(active, reanchored)) {
        markConflict(active, "Pending create edits could not be replayed onto the created row.");
        return;
      }
      active.pendingRouteObserved = true;
      handoffOutcome = mergeRetainedHandoffAfterShadow(active, data);
      if (handoffOutcome === "halted") return;
    }
    if (!loadIsCurrent()) return;
    if (active.shadowRecovery !== null) {
      // Keep the hydrated server document inert until the user chooses restore or discard.
      // This prevents both autosave and an eager shadow rewrite from destroying the candidate.
      setMode(active, "recovery-pending");
      return;
    }
    const current = readDoc(store.getState());
    const liveDelta = diffDocs(active.baseline, current);
    if (liveDelta === null) {
      markConflict(active, "Edits made while loading could not be represented safely.");
    } else if (liveDelta.length > 0 && enqueueDelta(active, liveDelta)) {
      active.baseline = current;
    }
    if (writerContext) {
      if (!mayReplaceShadow || !(await persistShadow(active))) return;
      if (!loadIsCurrent()) return;
      if (active.retainedHandoff?.canvasId === active.activeId) {
        const durableHandoffId = active.retainedHandoff.canvasId;
        active.retainedHandoff = null;
        clearSessionHandoff(durableHandoffId);
      }
      if (!(await retireDurablePendingCreate(active))) {
        if (active.mode !== "failed") {
          pendingStorageFailure(active, "The completed pending creation could not be retired safely.");
        }
        return;
      }
      if (!loadIsCurrent()) return;
    }
    const settledState = store.getState();
    const readyToRepair =
      active.serverRecoveryRequired &&
      !settledState.readOnly &&
      !settledState.recoveryRequired &&
      transportAuthorized(active, settledState);
    setMode(active, readyToRepair ? "repairing" : "persisted");
    if (
      (readyToRepair || queueIsDirty(active.queue)) &&
      !settledState.readOnly &&
      !settledState.recoveryRequired
    ) scheduleFlush(active);
    } finally {
      if (loadAttempt === active.loadAttempt) active.loadInFlight = false;
    }
  }

  function applyRecoveredQueue(
    active: RuntimeSession,
    restored: OfflineQueueState,
    recoveryLoadResult?: LoadCanvasResult
  ): boolean {
    if (active.activeId === null) return false;
    const current = readDoc(store.getState());
    const liveDelta = diffDocs(active.baseline, current);
    if (liveDelta === null) return false;
    if (queuedOperationCount(restored) + liveDelta.length > OFFLINE_QUEUE_MAX_PENDING) {
      return false;
    }
    // Preserve the exact transport order: server baseline -> recovered queue -> edits made
    // while IndexedDB was being read. Applying recovered ops to `current` reverses the last two
    // stages and can make the visible document disagree with the queued PATCH order.
    const recovered = applyOpsToDoc(active.baseline, previewOps(restored));
    if (!recovered.ok) return false;
    const replayed = applyOpsToDoc(recovered.doc, liveDelta);
    if (!replayed.ok) return false;
    let merged = restored;
    let nextOpCounter = Math.max(active.opCounter, restored.seq + 1);
    for (const op of liveDelta) {
      const opId = `${active.createId ?? active.activeId}:live:${nextOpCounter}`;
      nextOpCounter += 1;
      merged = queueEnqueue(merged, opId, op);
    }
    let adopted = false;
    active.applying = true;
    try {
      adopted = recoveryLoadResult
        ? store.hydrate(
            {
              ...recoveryLoadResult,
              nodes: replayed.doc.nodes,
              edges: replayed.doc.edges,
              groups: replayed.doc.groups,
            },
            active.activeId
          )
        : store.adoptAuthoritativeDoc(active.activeId, replayed.doc);
    } finally {
      active.applying = false;
    }
    if (!adopted) {
      return false;
    }
    active.queue = merged;
    active.opCounter = nextOpCounter;
    active.baseline = readDoc(store.getState());
    return true;
  }

  function applySessionHandoff(
    active: RuntimeSession,
    data: { rev: number; deps: CanvasDeps; loadResult: LoadCanvasResult }
  ): "none" | "applied" | "halted" {
    const handoff = active.retainedHandoff;
    if (handoff === null || active.activeId === null) return "none";
    const restored = queueRestore(handoff.queue);
    if (restored === null || restored.baseRev !== handoff.serverRev) {
      markConflict(active, "The retained local intent was invalid and cannot be replayed safely.");
      return "halted";
    }

    // Consumption is deferred until runLoad has durably CAS-written the reconciled normal
    // shadow. Clearing this fallback earlier creates a crash window between replay and IDB.
    const consume = (): void => {};
    const presentSameRevisionSnapshot = (): boolean => {
      if (handoff.serverRev !== data.rev) return false;
      const candidate: ShadowRecoveryCandidate = {
        strategy: "restore_snapshot",
        canvasId: handoff.canvasId,
        schemaVersion: CANVAS_SCHEMA_VERSION,
        doc: handoff.doc,
        deps: handoff.deps,
        baseRev: data.rev,
        queue: null,
        shadowServerRev: handoff.serverRev,
        updatedAt: handoff.updatedAt,
      };
      if (!publishShadowRecovery(active, candidate, active.baseline, true)) return false;
      setMode(active, "recovery-pending");
      return true;
    };

    if (handoff.snapshotRecoveryRequired) {
      if (presentSameRevisionSnapshot()) return "halted";
      markConflict(
        active,
        "Remote changes advanced beyond an incomplete local snapshot. Automatic recovery is paused."
      );
      return "halted";
    }

    if (!queueIsDirty(restored)) {
      const uncovered = diffDocs(active.baseline, handoff.doc);
      if (handoff.serverRev === data.rev && uncovered !== null && uncovered.length > 0) {
        if (presentSameRevisionSnapshot()) return "halted";
        markConflict(active, "The retained recovery document lacked replayable local intent.");
        return "halted";
      }
      // Recovery phase alone does not authorize an old full-document overwrite. The fresh GET
      // already reapplies its own gate, so an unchanged/advanced server document wins.
      consume();
      return "none";
    }

    const reanchored: OfflineQueueState = { ...restored, baseRev: data.rev };
    const ops = previewOps(reanchored);
    const replayed = applyOpsToDoc(active.baseline, ops);
    if (!replayed.ok) {
      markConflict(
        active,
        "Remote changes conflict with the proven retained local operations. Autosave is paused."
      );
      return "halted";
    }
    if (handoff.serverRev === data.rev) {
      const uncovered = diffDocs(replayed.doc, handoff.doc);
      if (uncovered === null || uncovered.length > 0) {
        if (presentSameRevisionSnapshot()) return "halted";
        markConflict(active, "The retained queue did not cover the complete local document.");
        return "halted";
      }
    }

    if (data.loadResult.recoveryRequired) {
      // Preserve the fresh GET's recovery/broken/issues metadata while applying only proven
      // local operations. adoptAuthoritativeDoc intentionally clears recovery metadata, so the
      // recovery path must hydrate the merged data explicitly.
      active.applying = true;
      let hydrated = false;
      try {
        hydrated = store.hydrate(
          {
            ...data.loadResult,
            nodes: replayed.doc.nodes,
            edges: replayed.doc.edges,
            groups: replayed.doc.groups,
          },
          active.activeId
        );
      } finally {
        active.applying = false;
      }
      if (!hydrated) {
        markConflict(active, "The retained recovery operations could not be adopted safely.");
        return "halted";
      }
      active.queue = reanchored;
      active.opCounter = Math.max(active.opCounter, reanchored.seq + 1);
      active.baseline = readDoc(store.getState());
    } else if (!applyRecoveredQueue(active, reanchored)) {
      markConflict(active, "The retained local operations could not be adopted safely.");
      return "halted";
    }

    consume();
    return "applied";
  }

  function mergeRetainedHandoffAfterShadow(
    active: RuntimeSession,
    data: { rev: number; deps: CanvasDeps; loadResult: LoadCanvasResult }
  ): "none" | "applied" | "halted" {
    const handoff = active.retainedHandoff;
    if (handoff === null || active.activeId === null) return "none";
    const restored = queueRestore(handoff.queue);
    if (restored === null) {
      markConflict(active, "The retained local intent was invalid after shadow takeover.");
      return "halted";
    }
    const presentSnapshot = (): "halted" => {
      const candidate: ShadowRecoveryCandidate = {
        strategy: "restore_snapshot",
        canvasId: handoff.canvasId,
        schemaVersion: CANVAS_SCHEMA_VERSION,
        doc: handoff.doc,
        deps: handoff.deps,
        baseRev: data.rev,
        queue: null,
        shadowServerRev: handoff.serverRev,
        updatedAt: handoff.updatedAt,
      };
      if (publishShadowRecovery(active, candidate, readDoc(store.getState()), true)) {
        setMode(active, "recovery-pending");
      } else {
        markConflict(active, "The retained local snapshot could not be presented safely.");
      }
      return "halted";
    };
    if (handoff.snapshotRecoveryRequired) return presentSnapshot();

    const freshDoc: CanvasDoc = {
      nodes: data.loadResult.nodes,
      edges: data.loadResult.edges,
      groups: data.loadResult.groups,
    };
    const proofQueue: OfflineQueueState = { ...restored, baseRev: data.rev };
    const proof = applyOpsToDoc(freshDoc, previewOps(proofQueue));
    if (!proof.ok) return presentSnapshot();
    if (handoff.serverRev === data.rev) {
      const uncovered = diffDocs(proof.doc, handoff.doc);
      if (uncovered === null || uncovered.length > 0) return presentSnapshot();
    }

    const existingEntries = [
      ...(active.queue.inflight?.ops ?? []),
      ...active.queue.pending,
    ];
    const handoffEntries = [
      ...(restored.inflight?.ops ?? []),
      ...restored.pending,
    ];
    const sharedLength = Math.min(existingEntries.length, handoffEntries.length);
    for (let index = 0; index < sharedLength; index += 1) {
      const existing = existingEntries[index];
      const retained = handoffEntries[index];
      if (
        existing.opId !== retained.opId ||
        JSON.stringify(existing.op) !== JSON.stringify(retained.op)
      ) {
        // Divergent/disjoint non-empty histories have no proven causal order. Never append one
        // branch after the other; require an explicit snapshot choice.
        return presentSnapshot();
      }
    }
    const tail = existingEntries.length < handoffEntries.length
      ? handoffEntries.slice(existingEntries.length)
      : [];
    if (tail.length === 0) return "none";
    if (queuedOperationCount(active.queue) + tail.length > OFFLINE_QUEUE_MAX_PENDING) {
      return presentSnapshot();
    }
    const current = readDoc(store.getState());
    const replayed = applyOpsToDoc(current, tail.map((entry) => entry.op));
    if (!replayed.ok) return presentSnapshot();
    let mergedQueue = active.queue;
    for (const entry of tail) {
      mergedQueue = queueEnqueue(mergedQueue, entry.opId, entry.op);
    }
    let adopted = false;
    active.applying = true;
    try {
      adopted = data.loadResult.recoveryRequired
        ? store.hydrate(
            {
              ...data.loadResult,
              nodes: replayed.doc.nodes,
              edges: replayed.doc.edges,
              groups: replayed.doc.groups,
            },
            active.activeId
          )
        : store.adoptAuthoritativeDoc(active.activeId, replayed.doc);
    } finally {
      active.applying = false;
    }
    if (!adopted) return presentSnapshot();
    active.queue = mergedQueue;
    active.opCounter = Math.max(active.opCounter, mergedQueue.seq + 1);
    active.baseline = readDoc(store.getState());
    return "applied";
  }

  async function tryShadowReplay(
    active: RuntimeSession,
    serverRev: number,
    record: CanvasShadowRecord,
    freshLoadResult: LoadCanvasResult
  ): Promise<boolean> {
    if (active.activeId === null || record.canvasId !== active.activeId) return false;
    const confirmedRecovery =
      freshLoadResult.recoveryRequired &&
      record.serverRecoveryRequired === true &&
      record.localRecoveryRequired !== true &&
      record.serverRev === serverRev;
    const recoveryMetadata =
      freshLoadResult.recoveryRequired && !confirmedRecovery
        ? freshLoadResult
        : undefined;
    const finishConfirmedRecovery = (): boolean => {
      if (!confirmedRecovery || !store.getState().recoveryRequired) return true;
      let adopted = false;
      active.applying = true;
      try {
        adopted = store.adoptAuthoritativeDoc(active.activeId as string, readDoc(store.getState()));
      } finally {
        active.applying = false;
      }
      return adopted;
    };

    const presentSnapshot = (candidate: ShadowRecoveryCandidate): boolean => {
      const snapshotCandidate: ShadowRecoveryCandidate = {
        ...candidate,
        strategy: "restore_snapshot",
        baseRev: serverRev,
        queue: null,
      };
      if (publishShadowRecovery(active, snapshotCandidate, active.baseline)) return true;
      markConflict(active, "A local recovery snapshot could not be presented safely.");
      deps.notifyApiError?.({
        success: false,
        code: "INTERNAL",
        error: "A local recovery snapshot could not be presented safely.",
      });
      return false;
    };

    if (record?.snapshotRecoveryRequired) {
      presentSnapshot({
        strategy: "restore_snapshot",
        canvasId: record.canvasId,
        schemaVersion: record.schemaVersion,
        doc: record.doc,
        deps: record.deps,
        baseRev: serverRev,
        queue: null,
        shadowServerRev: record.serverRev,
        updatedAt: record.updatedAt,
      });
      return false;
    }

    // A newer server rev does not prove that this client's inflight batch committed. Re-anchor
    // and replay every unacknowledged op at least once; patch operations are idempotent.
    if (record && record.serverRev < serverRev && record.queue) {
      const replayAll = queueRestore(record.queue);
      if (replayAll && queueIsDirty(replayAll)) {
        const reanchored = { ...replayAll, baseRev: serverRev };
        if (!applyRecoveredQueue(active, reanchored, recoveryMetadata)) {
          presentSnapshot({
            strategy: "restore_snapshot",
            canvasId: record.canvasId,
            schemaVersion: record.schemaVersion,
            doc: record.doc,
            deps: record.deps,
            baseRev: serverRev,
            queue: null,
            shadowServerRev: record.serverRev,
            updatedAt: record.updatedAt,
          });
          return false;
        }
        return finishConfirmedRecovery();
      }
    }

    const decision = decideShadowRecovery(record, { rev: serverRev });
    if (
      decision.canRecover &&
      decision.candidate.strategy === "restore_snapshot"
    ) {
      if (publishShadowRecovery(active, decision.candidate, active.baseline)) {
        return false;
      }
      markConflict(active, "A newer local canvas snapshot could not be presented safely.");
      deps.notifyApiError?.({
        success: false,
        code: "INTERNAL",
        error: "A newer local canvas snapshot could not be presented safely.",
      });
      return false;
    }
    if (
      decision.canRecover &&
      decision.candidate.strategy === "replay_queue" &&
      decision.candidate.queue
    ) {
      const restored = queueRestore(decision.candidate.queue);
      // Only adopt a queue whose anchor matches the current server rev (in-order replay).
      if (restored && restored.baseRev === serverRev) {
        const queueOnly = applyOpsToDoc(active.baseline, previewOps(restored));
        const uncovered = queueOnly.ok ? diffDocs(queueOnly.doc, decision.candidate.doc) : null;
        // The shadow document is authoritative for local durability. If its queue cannot
        // reproduce it exactly (for example, an edit was rejected at the queue cap), require an
        // explicit snapshot decision instead of silently discarding the uncovered tail.
        if (!queueOnly.ok || uncovered === null || uncovered.length > 0) {
          presentSnapshot(decision.candidate);
          return false;
        }
        if (!applyRecoveredQueue(active, restored, recoveryMetadata)) {
          presentSnapshot(decision.candidate);
          return false;
        }
      }
      return finishConfirmedRecovery();
    }
    if (record && record.serverRev === serverRev && record.queue === null) {
      const uncovered = diffDocs(active.baseline, record.doc);
      if (uncovered === null || uncovered.length > 0) {
        presentSnapshot({
          strategy: "restore_snapshot",
          canvasId: record.canvasId,
          schemaVersion: record.schemaVersion,
          doc: record.doc,
          deps: record.deps,
          baseRev: serverRev,
          queue: null,
          shadowServerRev: record.serverRev,
          updatedAt: record.updatedAt,
        });
        return false;
      }
    }
    return finishConfirmedRecovery();
  }

  async function settleShadowRecovery(
    active: RuntimeSession,
    restore: boolean
  ): Promise<boolean> {
    const recovery = active.shadowRecovery;
    if (
      !isActive(active) ||
      active.mode !== "recovery-pending" ||
      recovery === null ||
      active.activeId === null ||
      active.shadowRecoverySettlementToken !== null
    ) {
      return false;
    }
    const settlementToken = ++active.shadowRecoverySettlementAttempt;
    active.shadowRecoverySettlementToken = settlementToken;
    try {
    const state = store.getState();
    if (!identitiesMatch(active, state)) return false;

    const current = readDoc(state);
    const liveOps = diffDocs(recovery.serverDoc, current);
    if (liveOps === null) return false;

    let finalDoc = current;
    if (restore) {
      const restored = applyOpsToDoc(recovery.candidate.doc, liveOps);
      if (!restored.ok) {
        deps.notifyApiError?.({
          success: false,
          code: "ENTITY_CONFLICT",
          error: "The newer local snapshot conflicts with edits made while loading.",
        });
        return false;
      }
      finalDoc = restored.doc;
    }

    const replacementOps = diffDocs(recovery.serverDoc, finalDoc);
    if (replacementOps === null) return false;
    const replacementExceedsQueue = replacementOps.length > OFFLINE_QUEUE_MAX_PENDING;
    if (!active.serverRecoveryRequired && replacementExceedsQueue) {
      deps.notifyApiError?.({
        success: false,
        code: "INTERNAL",
        error: "The selected recovery version exceeds the safe pending-operation limit.",
      });
      return false;
    }

    let nextQueue = createOfflineQueue(recovery.candidate.baseRev);
    let nextOpCounter = active.opCounter;
    if (!replacementExceedsQueue) {
      for (const op of replacementOps) {
        nextQueue = queueEnqueue(
          nextQueue,
          `${active.createId ?? active.activeId}:recovery:${nextOpCounter}`,
          op
        );
        nextOpCounter += 1;
      }
    }
    // Recovery repair still writes a full document, but its queue is retained as merge proof for
    // a dispose/remount before PUT commits. If the full replacement cannot fit, retain the
    // snapshot marker and refuse automatic replay after a newer GET.
    const nextDeps = restore ? recovery.candidate.deps : active.deps;
    // The replacement record must be durable before the banner can disappear. In particular,
    // keep-cloud with live edits writes those edits and the recovery flags; it never tombstones
    // the only durable local intent.
    if (
      !(await writeShadowSnapshot(active, {
        doc: finalDoc,
        deps: nextDeps,
        queue: nextQueue,
        snapshotRecoveryRequired: replacementExceedsQueue,
        serverRecoveryRequired: active.serverRecoveryRequired,
        localRecoveryRequired: state.recoveryRequired,
      }))
    ) {
      return false;
    }
    if (
      !isActive(active) ||
      active.shadowRecovery !== recovery ||
      active.shadowRecoverySettlementToken !== settlementToken
    ) return false;

    if (restore) {
      let adopted = false;
      active.applying = true;
      try {
        adopted = store.adoptAuthoritativeDoc(active.activeId, finalDoc);
      } finally {
        active.applying = false;
      }
      if (!adopted) return false;
    }
    active.deps = nextDeps;
    active.queue = nextQueue;
    active.opCounter = nextOpCounter;
    active.snapshotRecoveryRequired = replacementExceedsQueue;
    active.baseline = readDoc(store.getState());
    active.retryDelay = 0;
    active.conflicted = false;
    active.issue = null;
    const uncoveredHandoff =
      !recovery.coversRetainedHandoff &&
      active.retainedHandoff?.canvasId === active.activeId
        ? active.retainedHandoff
        : null;
    if (uncoveredHandoff) {
      const nextCandidate: ShadowRecoveryCandidate = {
        strategy: "restore_snapshot",
        canvasId: uncoveredHandoff.canvasId,
        schemaVersion: CANVAS_SCHEMA_VERSION,
        doc: uncoveredHandoff.doc,
        deps: uncoveredHandoff.deps,
        baseRev: nextQueue.baseRev,
        queue: null,
        shadowServerRev: uncoveredHandoff.serverRev,
        updatedAt: uncoveredHandoff.updatedAt,
      };
      if (!publishShadowRecovery(active, nextCandidate, finalDoc, true)) return false;
      setMode(active, "recovery-pending");
      return true;
    }
    clearShadowRecovery(active);
    if (
      recovery.coversRetainedHandoff &&
      active.retainedHandoff?.canvasId === active.activeId
    ) {
      const retainedId = active.retainedHandoff.canvasId;
      active.retainedHandoff = null;
      clearSessionHandoff(retainedId);
    }
    const next = store.getState();
    const readyToRepair =
      active.serverRecoveryRequired && !next.readOnly && !next.recoveryRequired;
    setMode(active, readyToRepair ? "repairing" : "persisted");
    if (
      (active.serverRecoveryRequired || queueIsDirty(active.queue)) &&
      !next.readOnly &&
      !next.recoveryRequired
    ) {
      scheduleFlush(active);
    }
    return true;
    } finally {
      if (active.shadowRecoverySettlementToken === settlementToken) {
        active.shadowRecoverySettlementToken = null;
      }
    }
  }

  function adoptRebase(
    active: RuntimeSession,
    envelope: CanvasEnvelopeWithMeta,
    ackedQueue: OfflineQueueState
  ): boolean {
    if (active.activeId === null) return false;
    // Validate the authoritative envelope before trusting it.
    const authoritative = validateCanvasDoc(envelope.doc);
    if (!authoritative.ok || authoritative.data === null) return false;
    let finalDoc = authoritative.data;
    // Reapply still-pending post-flight ops onto the rebased doc before atomic adoption.
    const pending = previewOps(ackedQueue);
    if (pending.length > 0) {
      const reapplied = applyOpsToDoc(authoritative.data, pending);
      if (!reapplied.ok) return false;
      finalDoc = reapplied.doc;
    }
    let adopted = false;
    active.applying = true;
    try {
      adopted = store.adoptAuthoritativeDoc(active.activeId, finalDoc);
    } finally {
      active.applying = false;
    }
    if (!adopted) return false;
    active.queue = ackedQueue;
    active.deps = envelope.deps;
    active.baseline = readDoc(store.getState());
    return true;
  }

  async function repair(active: RuntimeSession): Promise<void> {
    if (
      !isActive(active) ||
      active.mode !== "repairing" ||
      active.conflicted ||
      !active.serverRecoveryRequired ||
      active.activeId === null ||
      active.saveAbort !== null
    ) {
      return;
    }
    const state = store.getState();
    if (!transportAuthorized(active, state)) return;
    const submitted = validateCanvasDoc(readDoc(state));
    if (!submitted.ok || submitted.data === null) {
      markConflict(active, "The repaired canvas is not safe to persist.");
      return;
    }
    const baseRev = active.queue.baseRev;
    const prep = store.prepareRepairSave({ baseRev, deps: active.deps });
    if (!prep.ok) {
      if (TRANSIENT_PREFLIGHT_CODES.has(prep.error.code)) scheduleRetry(active);
      else markConflict(active, `Recovery save was paused by ${prep.error.code}.`);
      await persistShadow(active);
      return;
    }

    const abort = makeAbortHandle();
    const attempt = ++active.saveAttempt;
    const recoveryEpoch = active.recoveryEpoch;
    active.saveAbort = abort;
    if (!(await persistShadow(active))) return;
    if (!isActive(active) || attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) {
      return;
    }
    if (!transportAuthorized(active, store.getState())) return;

    let response: CanvasRuntimeResponse;
    try {
      response = await deps.fetch(prep.request.url, {
        method: prep.request.init.method ?? "PUT",
        headers: (prep.request.init.headers as Record<string, string>) ?? {
          "Content-Type": "application/json",
        },
        body: typeof prep.request.init.body === "string" ? prep.request.init.body : undefined,
        signal: abort.signal,
      });
    } catch {
      if (!isActive(active) || attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) {
        return;
      }
      active.saveAbort = null;
      scheduleRetry(active);
      return;
    }
    if (!isActive(active) || attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) {
      return;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    let persistAfterClassification = false;
    let schedulePatchAfterPersist = false;
    try {
      if (!isActive(active) || attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) {
        return;
      }
      const decoded = decodeApiBody(body);
      if (response.ok && decoded.success && decoded.data) {
        const data = decodeRepairData(
          decoded.data,
          active.activeId,
          baseRev,
          submitted.data,
          active.deps
        );
        if (data === null) {
          markConflict(active, "The recovery response was not trustworthy. The repaired document remains local.");
          persistAfterClassification = true;
        } else {
          active.serverRecoveryRequired = false;
          active.deps = data.envelope.deps;
          active.saveProof = data.saveProof;
          active.queue = createOfflineQueue(data.rev);
          active.baseline = submitted.data;
          const current = readDoc(store.getState());
          const delta = diffDocs(submitted.data, current);
          if (delta === null || !enqueueDelta(active, delta)) {
            markConflict(active, "Edits made during recovery could not be queued safely.");
            persistAfterClassification = true;
          } else {
            active.baseline = current;
            active.retryDelay = 0;
            setMode(active, "persisted");
            persistAfterClassification = true;
            schedulePatchAfterPersist = true;
          }
        }
      } else {
        if (isTransientHttpStatus(response.status)) {
          scheduleRetry(active);
          return;
        }
        deps.notifyApiError?.(body);
        if (decoded.code === "WRITER_LOCKED") scheduleRetry(active);
        else markConflict(active, `Recovery save stopped after ${decoded.code ?? "an API error"}.`);
        persistAfterClassification = true;
      }
    } finally {
      // `saveAbort` is the repair single-flight sentinel. Hold it through all descriptor-safe
      // decoding and synchronous classification: hostile body traps can reenter handleOnline,
      // and must still observe this attempt as busy. Release before IndexedDB persistence so a
      // scheduled retry cannot fire once, see a stale busy sentinel, and be lost forever.
      if (active.saveAbort === abort) active.saveAbort = null;
    }
    if (persistAfterClassification) await persistShadow(active);
    if (
      schedulePatchAfterPersist &&
      isActive(active) &&
      queueIsDirty(active.queue) &&
      !store.getState().readOnly
    ) {
      scheduleFlush(active);
    }
  }

  async function flush(active: RuntimeSession): Promise<void> {
    if (
      !isActive(active) ||
      (active.mode !== "persisted" && active.mode !== "repairing") ||
      active.conflicted
    ) {
      return;
    }
    const state = store.getState();
    if (!transportAuthorized(active, state)) return;
    if (active.serverRecoveryRequired) {
      await repair(active);
      return;
    }
    if (active.queue.inflight) return; // single-flight

    const outcome = queueBuildPatch(active.queue);
    active.queue = outcome.state;
    if (!outcome.flush) {
      void persistShadow(active);
      return;
    }
    const token = outcome.flush.token;
    const prep = store.preparePatchSave({
      baseRev: outcome.flush.patch.baseRev,
      ops: outcome.flush.patch.ops,
      saveProof: active.saveProof ?? undefined,
    });
    if (!prep.ok) {
      // Pre-flight guard rejected (writer/size/identity). Requeue to preserve intent.
      active.queue = queueFail(active.queue, token);
      if (TRANSIENT_PREFLIGHT_CODES.has(prep.error.code)) scheduleRetry(active);
      else {
        markConflict(
          active,
          `Autosave was paused by the ${prep.error.code} preflight guard.`
        );
      }
      void persistShadow(active);
      return;
    }

    const abort = makeAbortHandle();
    const attempt = ++active.saveAttempt;
    const recoveryEpoch = active.recoveryEpoch;
    active.saveToken = token;
    active.saveAbort = abort;
    if (!(await persistShadow(active))) return; // record inflight before the network hop
    if (!isActive(active)) return;
    if (attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) return;
    if (!transportAuthorized(active, store.getState())) return;

    let response: CanvasRuntimeResponse;
    try {
      response = await deps.fetch(prep.request.url, {
        method: prep.request.init.method ?? "PATCH",
        headers: (prep.request.init.headers as Record<string, string>) ?? {
          "Content-Type": "application/json",
        },
        body: typeof prep.request.init.body === "string" ? prep.request.init.body : undefined,
        signal: abort.signal,
      });
    } catch {
      if (!isActive(active)) return;
      if (attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) return;
      active.saveAbort = null;
      active.saveToken = null;
      active.queue = queueFail(active.queue, token); // offline → requeue
      await persistShadow(active);
      scheduleRetry(active);
      return;
    }
    // Stale response after navigation / auth / canvas switch / unmount → discard.
    if (!isActive(active)) return;
    if (attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) return;
    active.saveAbort = null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!isActive(active)) return;
    if (attempt !== active.saveAttempt || recoveryEpoch !== active.recoveryEpoch) return;
    active.saveToken = null;

    const decoded = decodeApiBody(body);
    if (response.ok && decoded.success && decoded.data && active.activeId !== null) {
      const data = decodePatchData(
        decoded.data,
        active.activeId,
        outcome.flush.patch.baseRev,
        outcome.flush.patch.ops.length
      );
      if (data === null) {
        active.queue = queueFail(active.queue, token);
        markConflict(active, "The save response was not trustworthy. Local edits remain in shadow storage.");
        await persistShadow(active);
        return;
      }
      active.saveProof = data.saveProof;
      const ackedQueue = queueAck(active.queue, token, data.rev);
      if (data.rebased && data.envelope) {
        if (!adoptRebase(active, data.envelope, ackedQueue)) {
          active.queue = queueFail(active.queue, token);
          markConflict(active, "Remote changes conflict with local edits. Autosave is paused.");
          await persistShadow(active);
          return;
        }
      } else {
        active.queue = ackedQueue;
      }
      active.retryDelay = 0;
      await persistShadow(active);
      if (!isActive(active)) return;
      if (queueIsDirty(active.queue) && !store.getState().readOnly) scheduleFlush(active);
      return;
    }

    // Error response: surface, requeue (never lose shadow intent), and fail closed on conflicts.
    active.queue = queueFail(active.queue, token);
    if (isTransientHttpStatus(response.status)) {
      await persistShadow(active);
      if (isActive(active)) scheduleRetry(active);
      return;
    }
    if (deps.notifyApiError) deps.notifyApiError(body);
    if (decoded.code === "WRITER_LOCKED") scheduleRetry(active);
    else markConflict(active, `Autosave stopped after ${decoded.code ?? "an API error"}.`);
    await persistShadow(active);
  }

  function handleStoreChange(): void {
    const active = session;
    if (!active || active.disposed || active.applying || active.conflicted) return;
    const state = store.getState();

    if (active.mode === "local") {
      // Local editable empty state: only a real durable nodes/edges/groups mutation triggers create.
      if (
        state.hydrated &&
        state.sessionCanvasId === null &&
        state.hydratedCanvasId === null &&
        !state.readOnly &&
        !state.recoveryRequired
      ) {
        const current = readDoc(state);
        const delta = diffDocs(active.baseline, current);
        if (delta === null) failSession(active, "The local canvas could not be diffed safely.");
        else if (delta.length > 0) void runCreate(active, current);
      }
      return;
    }

    if (active.mode === "creating" && active.pendingCreateRecord !== null) {
      const state = store.getState();
      const identityMatches =
        state.hydrated &&
        ((active.activeId === null &&
          state.sessionCanvasId === null &&
          state.hydratedCanvasId === null) ||
          (active.activeId !== null && identitiesMatch(active, state)));
      if (!identityMatches || state.recoveryRequired) return;
      const current = readDoc(state);
      const delta = diffDocs(active.baseline, current);
      if (delta === null) {
        failSession(active, "Edits made during canvas creation could not be represented safely.");
        return;
      }
      if (delta.length > 0 && enqueueDelta(active, delta)) {
        active.baseline = current;
        void persistPendingCreate(active, active.pendingCreateRecord.phase);
      }
      return;
    }

    if (active.mode === "persisted" || active.mode === "repairing") {
      if (!identitiesMatch(active, state)) return;
      if (state.recoveryRequired) {
        active.recoveryEpoch += 1;
        if (active.saveToken !== null) {
          active.queue = queueFail(active.queue, active.saveToken);
          active.saveToken = null;
        }
        active.saveAbort?.abort();
        active.saveAbort = null;
        const current = readDoc(state);
        const delta = diffDocs(active.baseline, current);
        if (delta === null) {
          markConflict(active, "Recovery edits could not be represented safely.");
        } else if (delta.length > 0 && enqueueDelta(active, delta)) {
          // Recovery remains transport-inert, but the queue is the proof that lets a remount
          // replay only local intent onto a newer GET without reverting remote additions.
          active.baseline = current;
        }
        void persistShadow(active);
        return;
      }
      if (active.serverRecoveryRequired) {
        const current = readDoc(state);
        const delta = diffDocs(active.baseline, current);
        if (delta === null) {
          markConflict(active, "Confirmed recovery edits could not be represented safely.");
          void persistShadow(active);
          return;
        }
        if (delta.length > 0 && enqueueDelta(active, delta)) active.baseline = current;
        void persistShadow(active);
        if (!state.readOnly) {
          setMode(active, "repairing");
          scheduleFlush(active);
        }
        return;
      }
      const current = readDoc(state);
      const delta = diffDocs(active.baseline, current);
      if (delta === null) {
        markConflict(active, "The current canvas could not be diffed safely. Autosave is paused.");
      } else if (delta.length > 0) {
        if (enqueueDelta(active, delta)) active.baseline = current;
        void persistShadow(active);
      }
      if (
        queueIsDirty(active.queue) &&
        !active.conflicted &&
        !state.readOnly &&
        !state.recoveryRequired
      ) {
        scheduleFlush(active);
      }
    }
    // creating / loading / failed / idle: ignore store churn.
  }

  /** Retire an abandoned local-create intent before loading a persisted target, so a later
   *  local canvas can never inherit its id/captured doc. Mirrors runCreate's descriptor-safe
   *  read: a valid stored intent is cleared by its own exact id; an invalid body that still
   *  carries an own string `id` clears that exact stale id. Returns false only when the store
   *  itself is unsafe (get or clear threw) — the caller then fails the session closed and does
   *  not GET, rather than leaving the poison intent active. */
  function retireAbandonedCreateIntent(): boolean {
    let stored: unknown;
    try {
      stored = createIntentStore.get();
    } catch {
      return false;
    }
    const intent = decodeCreateIntent(stored);
    let retireId: string | null = null;
    if (intent !== null) {
      retireId = intent.id;
    } else {
      const staleId = readOwnDataValue(stored, "id");
      if (typeof staleId === "string") retireId = staleId;
    }
    if (retireId === null) return true;
    try {
      createIntentStore.clear(retireId);
    } catch {
      return false;
    }
    return true;
  }

  function configure(canvasId: string | null): void {
    const normalized =
      typeof canvasId === "string" && CANVAS_UUID_RE.test(canvasId)
        ? canvasId.toLowerCase()
        : null;
    // Non-null, non-uuid → fail closed inert (the page fail-closes invalid ids before mount).
    const invalidTarget = canvasId !== null && normalized === null;

    if (session && !session.disposed && session.targetCanvasId === (invalidTarget ? canvasId : normalized)) {
      return; // no-op reconfigure for the same target
    }
    if (session) teardown(session);
    const intentRetirementFailed =
      !configuredShadow() &&
      !invalidTarget &&
      normalized !== null &&
      !retireAbandonedCreateIntent();
    const retainedHandoff =
      !invalidTarget && normalized !== null ? readSessionHandoff(normalized) : null;
    const initialWriter =
      normalized !== null &&
      queuedWriterSignal?.acquired === true &&
      queuedWriterSignal.canvasId.toLowerCase() === normalized
        ? queuedWriterSignal
        : null;
    // A layout-phase capability is valid only for the very next configure target. Never retain
    // an unmatched signal for a later navigation back to that id.
    if (queuedWriterSignal !== null) queuedWriterSignal = null;

    const next: RuntimeSession = {
      generation: ++generationCounter,
      targetCanvasId: invalidTarget ? canvasId : normalized,
      mode:
        invalidTarget || intentRetirementFailed
          ? "failed"
          : normalized === null && !configuredShadow()
            ? "local"
            : "loading",
      activeId: normalized,
      createId: null,
      baseline: createEmptyCanvasDoc(),
      deps: createEmptyCanvasDeps(),
      queue: createOfflineQueue(0),
      opCounter: 0,
      flushTimer: null,
      retryTimer: null,
      retryDelay: 0,
      createAbort: null,
      saveAbort: null,
      saveAttempt: 0,
      saveToken: null,
      saveProof: null,
      recoveryEpoch: 0,
      loadInFlight: false,
      loadAttempt: 0,
      bootstrapAttempt: 0,
      bootstrapReady: false,
      bootstrapInFlight: false,
      takeoverAttempt: 0,
      takeoverInFlight: false,
      writerAcquired: initialWriter !== null,
      writerTag: initialWriter?.writerTag ?? null,
      writerEpoch: initialWriter ? 1 : 0,
      shadowLease: null,
      shadowReady: configuredShadow() === null,
      shadowMutationChain: Promise.resolve(),
      pendingCreateLease: null,
      pendingCreateRecord: null,
      pendingRouteObserved: false,
      pendingRetired: true,
      shadowRecovery: null,
      shadowRecoverySettlementAttempt: 0,
      shadowRecoverySettlementToken: null,
      issue: invalidTarget
        ? { code: "failed", message: "The canvas URL contains an invalid document identity." }
        : intentRetirementFailed
          ? {
              code: "failed",
              message: "The abandoned canvas create intent could not be retired safely.",
            }
          : null,
      conflicted: false,
      snapshotRecoveryRequired: false,
      serverRecoveryRequired: false,
      retainedHandoff,
      disposed: false,
      applying: false,
    };
    session = next;
    publishRuntimeState(next);

    if (next.mode === "loading") {
      if (next.activeId === null) void bootstrapLocal(next);
      else void bootstrapPersisted(next);
    } else if (next.mode === "local") {
      // In case the store already holds a non-empty local doc (remount), check immediately.
      handleStoreChange();
    }
  }

  function handleOnline(): void {
    const active = session;
    if (!active || active.disposed) return;
    if (deps.isOnline && !deps.isOnline()) return;
    active.retryDelay = 0;
    if (active.retryTimer !== null) {
      scheduler.clearTimeout(active.retryTimer);
      active.retryTimer = null;
    }
    pump(active);
  }

  function handleWriterSignal(signal: CanvasRuntimeWriterSignal): void {
    const active = session;
    const normalizedSignalId =
      signal && typeof signal.canvasId === "string" && CANVAS_UUID_RE.test(signal.canvasId)
        ? signal.canvasId.toLowerCase()
        : null;
    if (
      (!active || active.disposed) &&
      normalizedSignalId !== null &&
      typeof signal.writerTag === "string" &&
      signal.writerTag.length > 0
    ) {
      if (signal.acquired) queuedWriterSignal = { ...signal, canvasId: normalizedSignalId };
      else if (
        queuedWriterSignal?.canvasId === normalizedSignalId &&
        queuedWriterSignal.writerTag === signal.writerTag
      ) queuedWriterSignal = null;
      return;
    }
    if (
      !active ||
      active.disposed ||
      active.activeId === null ||
      !signal ||
      typeof signal.canvasId !== "string" ||
      typeof signal.writerTag !== "string" ||
      signal.writerTag.length === 0
    ) {
      return;
    }
    const canvasId = normalizedSignalId;
    if (canvasId !== active.activeId) {
      if (canvasId !== null && signal.acquired) {
        queuedWriterSignal = { ...signal, canvasId };
      } else if (
        canvasId !== null &&
        queuedWriterSignal?.canvasId === canvasId &&
        queuedWriterSignal.writerTag === signal.writerTag
      ) {
        queuedWriterSignal = null;
      }
      return;
    }

    // After POST success the store already owns createId, but the route still targets bare
    // /canvas. A child layout signal can beat the parent's passive configure(id); carry that
    // exact capability into the canonical session instead of spending it on the pre-route one.
    if (active.targetCanvasId !== active.activeId) {
      if (signal.acquired) {
        queuedWriterSignal = { ...signal, canvasId };
      } else if (
        queuedWriterSignal?.canvasId === canvasId &&
        queuedWriterSignal.writerTag === signal.writerTag
      ) {
        queuedWriterSignal = null;
      }
      return;
    }

    if (!signal.acquired) {
      // Only the exact active tag may release this capability. A late cleanup from an older D5
      // controller must not revoke a newer writer session.
      if (!active.writerAcquired || active.writerTag !== signal.writerTag) return;
      active.writerEpoch += 1;
      active.takeoverAttempt += 1;
      active.takeoverInFlight = false;
      active.loadAttempt += 1;
      active.writerAcquired = false;
      active.writerTag = null;
      active.shadowLease = null;
      active.shadowReady = false;
      requeueActiveSave(active);
      retainActiveIntentForTakeover(active);
      clearTimers(active);
      active.mode = "loading";
      publishRuntimeState(active);
      return;
    }

    if (active.writerAcquired && active.writerTag === signal.writerTag) return;
    if (active.writerAcquired) {
      requeueActiveSave(active);
      retainActiveIntentForTakeover(active);
    }
    active.writerEpoch += 1;
    active.takeoverAttempt += 1;
    active.takeoverInFlight = false;
    active.writerAcquired = true;
    active.writerTag = signal.writerTag;
    active.shadowLease = null;
    active.shadowReady = configuredShadow() === null;
    active.createAbort?.abort();
    active.createAbort = null;
    active.loadAttempt += 1;
    active.loadInFlight = false;
    void beginWriterTakeover(active);
  }

  function restoreShadowSnapshot(): Promise<boolean> {
    const active = session;
    return active ? settleShadowRecovery(active, true) : Promise.resolve(false);
  }

  function discardShadowSnapshot(): Promise<boolean> {
    const active = session;
    return active ? settleShadowRecovery(active, false) : Promise.resolve(false);
  }

  function dispose(): void {
    if (session) teardown(session);
    session = null;
  }

  function getDebugState(): CanvasRuntimeDebugState {
    const active = session;
    if (!active) {
      return {
        mode: "idle",
        activeId: null,
        targetCanvasId: null,
        createId: null,
        baseRev: 0,
        pending: 0,
        inflight: false,
        conflicted: false,
        repairRequired: false,
        disposed: true,
      };
    }
    return {
      mode: active.mode,
      activeId: active.activeId,
      targetCanvasId: active.targetCanvasId,
      createId: active.createId,
      baseRev: active.queue.baseRev,
      pending: active.queue.pending.length,
      inflight: active.queue.inflight !== null,
      conflicted: active.conflicted,
      repairRequired: active.serverRecoveryRequired,
      disposed: active.disposed,
    };
  }

  return {
    configure,
    handleStoreChange,
    handleOnline,
    handleWriterSignal,
    restoreShadowSnapshot,
    discardShadowSnapshot,
    dispose,
    getDebugState,
  };
}
