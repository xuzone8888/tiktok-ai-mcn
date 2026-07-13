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

import { useCallback, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import type { CanvasErrorMonitor } from "@/lib/canvas/canvas-monitoring";
import { normalizeCanvasId } from "@/lib/canvas/canvas-writer-lifecycle";
import { useCanvasStore } from "@/stores/canvas-store";

import { CanvasBoard } from "./canvas-board";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { CanvasHealthBanners } from "./canvas-health-banners";
import { CanvasSaveFeedbackBridge } from "./canvas-save-feedback-bridge";
import { useCanvasWriterLock } from "./use-canvas-writer-lock";

export interface CanvasRootProps {
  canvasId?: string | null;
  onRecover?: () => boolean | void | Promise<boolean | void>;
  onReload?: () => void;
  monitor?: Pick<CanvasErrorMonitor, "capture">;
}

interface CanvasRuntimeInnerProps {
  canvasId?: string | null;
}

interface CanvasSessionBootstrapProps {
  requestedCanvasId: string | null;
  writerCanvasId: string | null;
  writerCanEdit: boolean;
  identityReady: boolean;
}

function CanvasSessionBootstrap({
  requestedCanvasId,
  writerCanvasId,
  writerCanEdit,
  identityReady,
}: CanvasSessionBootstrapProps) {
  useEffect(() => {
    const store = useCanvasStore.getState();
    if (!store.beginCanvasSession(requestedCanvasId)) return;
    if (requestedCanvasId === null) store.initializeEmptyDoc();

    const current = useCanvasStore.getState();
    const ready =
      current.hydrated &&
      current.sessionCanvasId === requestedCanvasId &&
      current.hydratedCanvasId === requestedCanvasId &&
      writerCanvasId === requestedCanvasId &&
      writerCanEdit;
    current.setReadOnly(!ready);
  }, [identityReady, requestedCanvasId, writerCanEdit, writerCanvasId]);

  return null;
}

export function CanvasRuntimeInner({ canvasId }: CanvasRuntimeInnerProps) {
  const requestedCanvasId = normalizeCanvasId(canvasId);
  const writer = useCanvasWriterLock(requestedCanvasId);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const sessionCanvasId = useCanvasStore((state) => state.sessionCanvasId);
  const hydratedCanvasId = useCanvasStore((state) => state.hydratedCanvasId);
  const readOnly = useCanvasStore((state) => state.readOnly);
  const identityReady =
    hydrated &&
    sessionCanvasId === requestedCanvasId &&
    hydratedCanvasId === requestedCanvasId &&
    writer.canvasId === requestedCanvasId &&
    writer.canEdit;
  const interactionEnabled = identityReady && !readOnly;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-canvas-root>
      <CanvasSessionBootstrap
        requestedCanvasId={requestedCanvasId}
        writerCanvasId={writer.canvasId}
        writerCanEdit={writer.canEdit}
        identityReady={identityReady}
      />
      <CanvasSaveFeedbackBridge />
      <CanvasHealthBanners persistent={writer.persistent} writerStatus={writer.status} />
      <div
        className="min-h-0 flex-1"
        data-canvas-critical-area
        inert={interactionEnabled ? undefined : true}
        aria-busy={!interactionEnabled}
      >
        <ReactFlowProvider>
          <CanvasBoard interactionEnabled={interactionEnabled} />
        </ReactFlowProvider>
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

export function CanvasRoot({ canvasId, onRecover, onReload, monitor }: CanvasRootProps) {
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
      <CanvasRuntimeInner canvasId={canvasId} />
    </CanvasErrorBoundary>
  );
}
