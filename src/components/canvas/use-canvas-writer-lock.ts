"use client";

import { useLayoutEffect, useRef, useState } from "react";

import {
  createCanvasWriterLifecycle,
  normalizeCanvasId,
  resolveCanvasWriterSession,
  type CanvasWriterLifecycle,
} from "@/lib/canvas/canvas-writer-lifecycle";
import type { WriterLockStatus } from "@/lib/canvas/writer-lock";
import { useCanvasStore } from "@/stores/canvas-store";

export interface CanvasWriterSession {
  canvasId: string | null;
  status: WriterLockStatus | null;
  persistent: boolean;
  canEdit: boolean;
}

interface ObservedWriterSession {
  canvasId: string | null;
  status: WriterLockStatus | null;
}

export function useCanvasWriterLock(
  canvasId?: string | null,
  authIdentity?: string | null
): CanvasWriterSession {
  const normalized = normalizeCanvasId(canvasId);
  const [observed, setObserved] = useState<ObservedWriterSession>({
    canvasId: null,
    status: null,
  });
  const lifecycleRef = useRef<CanvasWriterLifecycle | null>(null);

  if (lifecycleRef.current === null) {
    lifecycleRef.current = createCanvasWriterLifecycle({
      setReadOnly: (readOnly) => useCanvasStore.getState().setReadOnly(readOnly),
      onStatusChange: (status) => {
        setObserved({
          canvasId: lifecycleRef.current?.getCanvasId() ?? null,
          status,
        });
      },
    });
  }

  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    if (normalized !== null && authIdentity === undefined) {
      void lifecycle.stop();
      return;
    }
    void lifecycle.start(normalized);
    return () => {
      void lifecycle.stop();
    };
  }, [authIdentity, normalized]);

  return resolveCanvasWriterSession(normalized, observed.canvasId, observed.status);
}
