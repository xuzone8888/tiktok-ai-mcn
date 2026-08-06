"use client";

/**
 * 超级画布 · 运行时协调器 React 接线(P0 · D-runtime)。
 *
 * 把纯核心 {@link createCanvasRuntime} 接到生产依赖:浏览器 fetch / 全局定时器 / crypto UUID /
 * canvas-store / D4 影子(按登录用户命名空间)/ next router URL 规范化 / D3 保存反馈桥。
 *
 * 生命周期纪律:
 *   - 协调器**按登录用户重建**(effect keyed on userId):鉴权切换/登出即 dispose 旧协调器 →
 *     abort 一切在途、清定时器、作废影子重放,再以新用户命名空间重建(never localStorage)。
 *   - canvasId 变化只调 configure(不重建协调器),使**本地→持久化晋升后的 URL 规范化**(null→uuid)
 *     成为一次 no-op configure —— 绝不把创建期入队的补丁在重挂中丢掉。
 *   - 挂载在 CanvasRoot(错误边界之外),故 error-boundary key 随 id 变化重挂时协调器**存活**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createCanvasAuthStateCoordinator,
  createCanvasCreateIntentRegistry,
  createCanvasRuntime,
  resolveCanvasAuthSnapshot,
  subscribeCanvasRuntimeStore,
  type CanvasRuntime,
  type CanvasRuntimeDebugState,
  type CanvasRuntimeWriterSignal,
  type CanvasShadowRecoveryNotice,
  type CanvasRuntimeUiState,
  type CanvasRuntimeStore,
} from "@/lib/canvas/canvas-runtime";
import { createCanvasShadowStore } from "@/lib/canvas/shadow";
import { consumeCanvasPatchResponse } from "@/lib/canvas/canvas-save-adapter";
import { normalizeCanvasId } from "@/lib/canvas/canvas-writer-lifecycle";
import { createClient } from "@/lib/supabase/client";
import { useCanvasStore } from "@/stores/canvas-store";

/** Stable client UUID (idempotent create key). Prefers crypto.randomUUID; falls back to v4. */
function generateClientUuid(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
  );
}

/**
 * A Runtime/IndexedDB ownership identity must not consume the injected create-id UUID
 * stream.  In particular, deterministic create tests rely on the first `uuid()` call
 * remaining the idempotent POST id.  Generate an independent v4 value from random bytes
 * and keep it for exactly one Runtime construction.
 */
function generateShadowOwnerId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  let filled = false;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    try {
      cryptoObj.getRandomValues(bytes);
      filled = true;
    } catch {
      // Fall through to the non-cryptographic uniqueness fallback below.
    }
  }
  if (!filled) {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
  );
}

/** Adapter over the singleton canvas-store exposing exactly what the coordinator needs. */
const storeAdapter: CanvasRuntimeStore = {
  getState: () => {
    const s = useCanvasStore.getState();
    return {
      nodes: s.nodes,
      edges: s.edges,
      groups: s.groups,
      hydrated: s.hydrated,
      sessionCanvasId: s.sessionCanvasId,
      hydratedCanvasId: s.hydratedCanvasId,
      readOnly: s.readOnly,
      recoveryRequired: s.recoveryRequired,
    };
  },
  hydrate: (result, id) => useCanvasStore.getState().hydrate(result, id),
  promoteLocalToPersisted: (id) => useCanvasStore.getState().promoteLocalToPersisted(id),
  adoptAuthoritativeDoc: (id, doc) => useCanvasStore.getState().adoptAuthoritativeDoc(id, doc),
  preparePatchSave: (input) => useCanvasStore.getState().preparePatchSave(input),
  prepareRepairSave: (input) => useCanvasStore.getState().prepareRepairSave(input),
};

const createIntentRegistry = createCanvasCreateIntentRegistry();

export interface CanvasRuntimeView {
  /** undefined while Supabase auth is unresolved; never render a retained document in that state. */
  authIdentity: string | null | undefined;
  runtimeState: CanvasRuntimeUiState;
  shadowRecovery: CanvasShadowRecoveryNotice | null;
  handleWriterSignal(signal: CanvasRuntimeWriterSignal): void;
  /**
   * Read the transport fence at the instant a paid action is about to start.
   *
   * Generation callers must require a persisted session with no pending or
   * in-flight document patch, then submit this exact `baseRev` together with
   * the active writer tag.  Returning a snapshot function (instead of copying
   * the revision into React state) keeps the fence synchronous with Runtime.
   */
  getDebugState(): CanvasRuntimeDebugState;
  restoreShadowSnapshot(): boolean;
  discardShadowSnapshot(): boolean;
}

export function useCanvasRuntime(canvasId?: string | null): CanvasRuntimeView {
  const normalized = normalizeCanvasId(canvasId);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // undefined = auth unresolved; null = signed out; string = user id.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [shadowRecovery, setShadowRecovery] =
    useState<CanvasShadowRecoveryNotice | null>(null);
  const [runtimeState, setRuntimeState] = useState<CanvasRuntimeUiState>({
    mode: "idle",
    interactionReady: false,
    issue: null,
  });
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const runtimeRef = useRef<CanvasRuntime | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const commitIdentity = (nextUserId: string | null) => {
      const previousUserId = previousUserIdRef.current;
      createIntentRegistry.handleUserChange(previousUserId, nextUserId, () => {
        // Reset before publishing the new identity so a retained singleton document can never
        // render for the next account, even for one React paint.
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        useCanvasStore.getState().reset();
        setShadowRecovery(null);
        setRuntimeState({ mode: "idle", interactionReady: false, issue: null });
      });
      previousUserIdRef.current = nextUserId;
      setUserId(nextUserId);
    };
    const authState = createCanvasAuthStateCoordinator(commitIdentity);
    resolveCanvasAuthSnapshot(supabase.auth.getUser(), authState);
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      authState.resolveEvent(sess?.user?.id ?? null);
    });
    return () => {
      authState.dispose();
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (userId === undefined) return; // wait for auth to resolve before touching persistence
    setShadowRecovery(null);
    let acceptsRuntimeEvents = true;

    // Shadow is scoped to the authenticated user (per-user db namespace); signed out → disabled.
    const shadow = userId
      ? createCanvasShadowStore({ dbName: `stargaze-canvas-shadow:${userId}` })
      : createCanvasShadowStore({ factory: null });

    const runtime = createCanvasRuntime({
      store: storeAdapter,
      fetch: async (url, init) => {
        const res = await fetch(url, init as unknown as RequestInit);
        return res;
      },
      scheduler: {
        setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
        clearTimeout: (handle) =>
          globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      },
      uuid: generateClientUuid,
      shadowOwnerId: generateShadowOwnerId(),
      createIntentStore: createIntentRegistry.forUser(userId),
      shadow,
      shadowWriteScope: `stargaze-canvas-shadow:${userId ?? "signed-out"}`,
      canonicalizeUrl: (id) => {
        try {
          routerRef.current.replace(`/canvas?id=${id}`);
        } catch {
          // Keep the visible URL truthful even if the router rejects synchronously.
          try {
            globalThis.history?.replaceState(null, "", `/canvas?id=${id}`);
          } catch {
            // The store already holds the persisted identity.
          }
        }
      },
      notifyApiError: (body) => {
        consumeCanvasPatchResponse(body);
      },
      onShadowRecoveryChange: (notice) => {
        if (acceptsRuntimeEvents) setShadowRecovery(notice);
      },
      onRuntimeStateChange: (state) => {
        if (acceptsRuntimeEvents) setRuntimeState(state);
      },
      isOnline: () => {
        const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
        return nav?.onLine !== false;
      },
    });
    runtimeRef.current = runtime;

    const unsubscribe = subscribeCanvasRuntimeStore(
      useCanvasStore,
      () => runtime.handleStoreChange()
    );
    const onOnline = () => runtime.handleOnline();
    globalThis.addEventListener?.("online", onOnline);

    return () => {
      acceptsRuntimeEvents = false;
      globalThis.removeEventListener?.("online", onOnline);
      unsubscribe();
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.configure(normalized);
  }, [normalized, userId]);

  const handleWriterSignal = useCallback(
    (signal: CanvasRuntimeWriterSignal) => {
      runtimeRef.current?.handleWriterSignal(signal);
    },
    []
  );

  const getDebugState = useCallback((): CanvasRuntimeDebugState => {
    const runtime = runtimeRef.current;
    if (runtime) return runtime.getDebugState();
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
  }, []);

  const restoreShadowSnapshot = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    try {
      void runtime.restoreShadowSnapshot().catch(() => false);
      return true;
    } catch {
      return false;
    }
  }, []);
  const discardShadowSnapshot = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    try {
      void runtime.discardShadowSnapshot().catch(() => false);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    authIdentity: userId,
    runtimeState,
    shadowRecovery,
    handleWriterSignal,
    getDebugState,
    restoreShadowSnapshot,
    discardShadowSnapshot,
  };
}
