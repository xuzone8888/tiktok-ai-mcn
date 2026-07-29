"use client";

/**
 * 超级画布 · 客户端挂载根(P0 · S1)
 *
 * 唯一的 React Flow 样式 import 点——**只在 /canvas 路由子树内**,绝不进 root layout 或
 * globals.css(避免样式进入 /studio 与 (main) 共享的全局 chunk;React Flow 样式已是
 * .react-flow* 前缀,配合本处局部 import 双保险)。若 Next 对 client 组件 import CSS 报限制,
 * 退回把本 import 移到 (canvas)/canvas/layout.tsx。
 *
 * 组合:错误边界(S1 出壳)→ ReactFlowProvider(useReactFlow 依赖)→ 受控底盘。
 */
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import type { CanvasErrorMonitor } from "@/lib/canvas/canvas-monitoring";
import type {
  CanvasRuntimeDebugState,
  CanvasRuntimeUiState,
  CanvasRuntimeWriterSignal,
  CanvasShadowRecoveryNotice,
} from "@/lib/canvas/canvas-runtime";
import { normalizeCanvasId } from "@/lib/canvas/canvas-writer-lifecycle";
import { useCanvasStore } from "@/stores/canvas-store";

import { CanvasBoard } from "./canvas-board";
import { CanvasGenerationProvider } from "./canvas-generation-context";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { CanvasHealthBanners } from "./canvas-health-banners";
import {
  CanvasProjectBar,
  type CanvasProjectNavigationTarget,
} from "./canvas-project-bar";
import { CanvasSaveFeedbackBridge } from "./canvas-save-feedback-bridge";
import { useCanvasRuntime } from "./use-canvas-runtime";
import { useCanvasWriterLock } from "./use-canvas-writer-lock";

export interface CanvasRootProps {
  canvasId?: string | null;
  currentTitle?: string | null;
  onRecover?: () => boolean | void | Promise<boolean | void>;
  onReload?: () => void;
  monitor?: Pick<CanvasErrorMonitor, "capture">;
}

interface CanvasRuntimeInnerProps {
  canvasId?: string | null;
  currentTitle?: string | null;
  authIdentity?: string | null;
  runtimeState?: CanvasRuntimeUiState;
  shadowRecovery?: CanvasShadowRecoveryNotice | null;
  onWriterSignal?: (signal: CanvasRuntimeWriterSignal) => void;
  getRuntimeDebugState?: () => CanvasRuntimeDebugState;
  onRestoreShadow?: () => boolean;
  onDiscardShadow?: () => boolean;
}

interface CanvasSessionBootstrapProps {
  requestedCanvasId: string | null;
  hydrated: boolean;
  writerCanvasId: string | null;
  writerCanEdit: boolean;
  documentIdentityReady: boolean;
}

function CanvasSaveStateBadge({
  getRuntimeDebugState,
}: {
  getRuntimeDebugState?: () => CanvasRuntimeDebugState;
}) {
  const [debug, setDebug] = useState<CanvasRuntimeDebugState | null>(() =>
    getRuntimeDebugState ? getRuntimeDebugState() : null
  );

  useEffect(() => {
    if (!getRuntimeDebugState) return;
    const sync = () => setDebug(getRuntimeDebugState());
    sync();
    const timer = globalThis.setInterval(sync, 500);
    return () => globalThis.clearInterval(timer);
  }, [getRuntimeDebugState]);

  let label = "正在连接";
  let tone = "text-muted-foreground";
  if (debug?.conflicted || debug?.mode === "failed") {
    label = "保存已暂停";
    tone = "text-destructive";
  } else if (
    debug?.mode === "creating" ||
    debug?.mode === "loading" ||
    debug?.mode === "repairing" ||
    debug?.inflight ||
    (debug?.pending ?? 0) > 0
  ) {
    label = "保存中…";
  } else if (debug?.mode === "persisted") {
    label = "已保存";
    tone = "text-emerald-600 dark:text-emerald-400";
  } else if (debug?.mode === "local") {
    label = "首次编辑后自动保存";
  }

  return (
    <span
      className={`hidden shrink-0 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] shadow-sm sm:inline-flex ${tone}`}
      aria-live="polite"
      data-canvas-save-state={debug?.mode ?? "idle"}
    >
      {label}
    </span>
  );
}

function CanvasSessionBootstrap({
  requestedCanvasId,
  hydrated,
  writerCanvasId,
  writerCanEdit,
  documentIdentityReady,
}: CanvasSessionBootstrapProps) {
  useEffect(() => {
    const store = useCanvasStore.getState();
    if (!store.beginCanvasSession(requestedCanvasId)) return;
    if (requestedCanvasId === null) store.initializeEmptyDoc();
  }, [hydrated, requestedCanvasId]);

  useEffect(() => {
    const current = useCanvasStore.getState();
    const ready =
      documentIdentityReady &&
      current.hydrated &&
      current.sessionCanvasId === requestedCanvasId &&
      current.hydratedCanvasId === requestedCanvasId &&
      writerCanvasId === requestedCanvasId &&
      writerCanEdit;
    current.setReadOnly(!ready);
  }, [documentIdentityReady, requestedCanvasId, writerCanEdit, writerCanvasId]);

  return null;
}

export function CanvasRuntimeInner({
  canvasId,
  currentTitle,
  authIdentity,
  runtimeState = { mode: "local", interactionReady: true, issue: null },
  shadowRecovery = null,
  onWriterSignal,
  getRuntimeDebugState,
  onRestoreShadow,
  onDiscardShadow,
}: CanvasRuntimeInnerProps) {
  const requestedCanvasId = normalizeCanvasId(canvasId);
  const writer = useCanvasWriterLock(requestedCanvasId, authIdentity);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const sessionCanvasId = useCanvasStore((state) => state.sessionCanvasId);
  const hydratedCanvasId = useCanvasStore((state) => state.hydratedCanvasId);
  const readOnly = useCanvasStore((state) => state.readOnly);
  const documentIdentityReady =
    hydrated &&
    sessionCanvasId === requestedCanvasId &&
    hydratedCanvasId === requestedCanvasId;
  const writerCanEdit = writer.canvasId === requestedCanvasId && writer.canEdit;
  const writerTag =
    writer.canvasId === requestedCanvasId &&
    typeof writer.status?.tag === "string" &&
    writer.status.tag.length > 0
      ? writer.status.tag
      : null;
  const writerAcquired =
    requestedCanvasId !== null &&
    writerTag !== null &&
    writer.status?.canWrite === true &&
    writer.status.reason === "acquired" &&
    writerCanEdit &&
    documentIdentityReady &&
    !readOnly;

  // D5 ownership is a distinct Runtime gate.  `readOnly === false` is not a proxy for
  // ownership: only the exact controller canvas/tag/acquired status can open it.  A
  // layout cleanup closes the old exact tag before a replacement tag can be published;
  // Runtime additionally ignores a stale old-tag cleanup once the new tag is active.
  useLayoutEffect(() => {
    if (!onWriterSignal || requestedCanvasId === null || writerTag === null) return;
    const identity = { canvasId: requestedCanvasId, writerTag };
    onWriterSignal({ ...identity, acquired: writerAcquired });
    if (!writerAcquired) return;
    return () => onWriterSignal({ ...identity, acquired: false });
  }, [onWriterSignal, requestedCanvasId, writerAcquired, writerTag]);

  const interactionEnabled =
    documentIdentityReady &&
    writerCanEdit &&
    !readOnly &&
    runtimeState.interactionReady &&
    shadowRecovery === null;

  const waitForSafeNavigation = useCallback(async (
    target: CanvasProjectNavigationTarget
  ) => {
    if (
      (target.kind === "rename" || target.kind === "delete") &&
      requestedCanvasId !== null &&
      !writerAcquired
    ) {
      throw new Error("当前标签页为只读，取得画布编辑权后才能修改项目");
    }
    if (!getRuntimeDebugState) return true;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const debug = getRuntimeDebugState();
      if (
        debug.mode === "failed" ||
        debug.conflicted ||
        debug.repairRequired
      ) {
        throw new Error("画布保存已暂停，请先处理顶部提示后再离开");
      }
      if (
        (debug.mode === "persisted" || debug.mode === "local") &&
        !debug.inflight &&
        debug.pending === 0
      ) {
        return true;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
    throw new Error("画布仍在保存，请稍后再离开");
  }, [getRuntimeDebugState, requestedCanvasId, writerAcquired]);

  if (authIdentity === undefined) {
    return (
      <div
        className="h-full w-full min-h-0 bg-background"
        data-canvas-auth-pending
        aria-busy="true"
      />
    );
  }

  const bootstrap = (
    <CanvasSessionBootstrap
      requestedCanvasId={requestedCanvasId}
      hydrated={hydrated}
      writerCanvasId={writer.canvasId}
      writerCanEdit={writer.canEdit}
      documentIdentityReady={documentIdentityReady}
    />
  );

  if (!documentIdentityReady) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-canvas-root>
        {bootstrap}
        <div
          className="min-h-0 flex-1 bg-background"
          data-canvas-document-pending
          aria-busy="true"
          aria-label="正在加载画布"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-canvas-root>
      {bootstrap}
      <CanvasSaveFeedbackBridge />
      <div className="relative z-40 flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background/85 px-2 py-1 backdrop-blur">
        <CanvasProjectBar
          canvasId={requestedCanvasId}
          currentTitle={currentTitle}
          mutationDisabled={
            requestedCanvasId !== null && !writerAcquired
          }
          beforeNavigate={waitForSafeNavigation}
        />
        <CanvasSaveStateBadge getRuntimeDebugState={getRuntimeDebugState} />
      </div>
      <CanvasHealthBanners
        persistent={writer.persistent}
        writerStatus={writer.status}
        runtimeIssue={runtimeState.issue}
        shadowRecovery={shadowRecovery}
        onRestoreShadow={onRestoreShadow}
        onDiscardShadow={onDiscardShadow}
      />
      <div
        className="min-h-0 flex-1"
        data-canvas-critical-area
        inert={interactionEnabled ? undefined : true}
        aria-busy={!runtimeState.interactionReady}
      >
        <CanvasGenerationProvider
          canvasId={requestedCanvasId}
          writerTag={writerTag}
          enabled={writerAcquired && runtimeState.interactionReady && shadowRecovery === null}
          getRuntimeDebugState={
            getRuntimeDebugState ??
            (() => ({
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
            }))
          }
        >
          <ReactFlowProvider>
            <CanvasBoard interactionEnabled={interactionEnabled} />
          </ReactFlowProvider>
        </CanvasGenerationProvider>
      </div>
    </div>
  );
}

export function recoverCanvasRuntimeState(canvasId?: string | null): boolean {
  try {
    const requestedCanvasId = normalizeCanvasId(canvasId);
    const state = useCanvasStore.getState();
    if (
      state.sessionCanvasId !== requestedCanvasId ||
      (state.hydrated && state.hydratedCanvasId !== requestedCanvasId)
    ) {
      return false;
    }
    if (state.recoverCurrentState()) return true;
    if (requestedCanvasId === null) {
      const current = useCanvasStore.getState();
      const hydrated = Object.getOwnPropertyDescriptor(current, "hydrated");
      if (hydrated && "value" in hydrated && hydrated.value === false) {
        return current.initializeEmptyDoc();
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function CanvasRoot({
  canvasId,
  currentTitle,
  onRecover,
  onReload,
  monitor,
}: CanvasRootProps) {
  // Mounted ABOVE the error boundary so the create-adoption remount (key flips local→uuid)
  // preserves the coordinator, its offline queue, and any in-flight transport.
  const runtime = useCanvasRuntime(canvasId);

  const recover = useCallback(() => {
    if (onRecover) return onRecover();
    return recoverCanvasRuntimeState(canvasId);
  }, [canvasId, onRecover]);

  const runtimeKey = normalizeCanvasId(canvasId) ?? "local-unpersisted";

  return (
    <CanvasErrorBoundary
      key={runtimeKey}
      canvasId={canvasId}
      onRecover={recover}
      onReload={onReload}
      monitor={monitor}
    >
      <CanvasRuntimeInner
        canvasId={canvasId}
        currentTitle={currentTitle}
        authIdentity={runtime.authIdentity}
        runtimeState={runtime.runtimeState}
        shadowRecovery={runtime.shadowRecovery}
        onWriterSignal={runtime.handleWriterSignal}
        getRuntimeDebugState={runtime.getDebugState}
        onRestoreShadow={runtime.restoreShadowSnapshot}
        onDiscardShadow={runtime.discardShadowSnapshot}
      />
    </CanvasErrorBoundary>
  );
}
