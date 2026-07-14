import { CANVAS_UUID_RE } from "./api-helpers";
import {
  createWriterHttpTransport,
  createWriterLockController,
  createWriterTag,
  type WriterLockController,
  type WriterLockStatus,
} from "./writer-lock";
import { canvasSaveAdapter, type CanvasSaveAdapter } from "./canvas-save-adapter";

export interface CanvasWriterLifecycleOptions {
  setReadOnly(readOnly: boolean): void;
  onStatusChange(status: WriterLockStatus | null): void;
  saveAdapter?: CanvasSaveAdapter;
  createController?: (
    canvasId: string,
    onStatusChange: (status: WriterLockStatus) => void
  ) => WriterLockController;
  stopTimeoutMs?: number;
  scheduler?: {
    setTimeout(handler: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

export interface CanvasWriterLifecycle {
  start(canvasId?: string | null): Promise<boolean>;
  stop(): Promise<void>;
  getStatus(): WriterLockStatus | null;
  getCanvasId(): string | null;
}

function defaultControllerFactory(
  canvasId: string,
  onStatusChange: (status: WriterLockStatus) => void
): WriterLockController {
  const tag = createWriterTag();
  return createWriterLockController({
    canvasId,
    tag,
    transport: createWriterHttpTransport({ canvasId, tag }),
    onStatusChange,
  });
}

export function normalizeCanvasId(canvasId?: string | null): string | null {
  return typeof canvasId === "string" && CANVAS_UUID_RE.test(canvasId)
    ? canvasId.toLowerCase()
    : null;
}

export interface CanvasWriterSessionView {
  canvasId: string | null;
  status: WriterLockStatus | null;
  persistent: boolean;
  canEdit: boolean;
}

/** Render-safe view: a status only applies to the exact canvas session that produced it. */
export function resolveCanvasWriterSession(
  requestedCanvasId: string | null,
  observedCanvasId: string | null,
  observedStatus: WriterLockStatus | null
): CanvasWriterSessionView {
  const canvasId = normalizeCanvasId(requestedCanvasId);
  if (!canvasId) {
    return { canvasId: null, status: null, persistent: false, canEdit: true };
  }
  const status = observedCanvasId === canvasId ? observedStatus : null;
  return {
    canvasId,
    status,
    persistent: true,
    canEdit: status?.canWrite === true && status.reason === "acquired",
  };
}

export function createCanvasWriterLifecycle(
  options: CanvasWriterLifecycleOptions
): CanvasWriterLifecycle {
  const saveAdapter = options.saveAdapter ?? canvasSaveAdapter;
  const createController = options.createController ?? defaultControllerFactory;
  const writerOwner = {};
  const scheduler = options.scheduler ?? {
    setTimeout: (handler: () => void, delayMs: number) => globalThis.setTimeout(handler, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const requestedStopTimeout = options.stopTimeoutMs ?? 1_000;
  const stopTimeoutMs = Number.isFinite(requestedStopTimeout)
    ? Math.max(25, Math.min(5_000, Math.floor(requestedStopTimeout)))
    : 1_000;

  let generation = 0;
  let controller: WriterLockController | null = null;
  let status: WriterLockStatus | null = null;
  let canvasId: string | null = null;
  let stopBarrier: Promise<void> = Promise.resolve();

  function publish(next: WriterLockStatus | null): void {
    status = next;
    options.onStatusChange(next);
  }

  function stopControllerWithTimeout(active: WriterLockController): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: unknown = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) scheduler.clearTimeout(timer);
        resolve();
      };
      timer = scheduler.setTimeout(finish, stopTimeoutMs);
      void Promise.resolve()
        .then(() => active.stop())
        .catch(() => {})
        .then(finish);
    });
  }

  function enqueueStop(active: WriterLockController | null): void {
    if (!active) return;
    const previousBarrier = stopBarrier;
    stopBarrier = previousBarrier
      .catch(() => {})
      .then(() => stopControllerWithTimeout(active));
  }

  async function start(inputCanvasId?: string | null): Promise<boolean> {
    const normalized = normalizeCanvasId(inputCanvasId);
    const startGeneration = ++generation;
    canvasId = normalized;
    const active = controller;
    controller = null;
    saveAdapter.beginWriterSession(writerOwner);
    publish(null);
    enqueueStop(active);

    if (!normalized) {
      // Local unpersisted mode is editable, but has no writer identity and cannot prepare PATCH.
      options.setReadOnly(false);
      return false;
    }

    // A real persisted canvas is read-only until both browser and server leases are active.
    options.setReadOnly(true);
    await stopBarrier;
    if (startGeneration !== generation || canvasId !== normalized) return false;

    let nextController: WriterLockController;
    try {
      nextController = createController(normalized, (nextStatus) => {
        if (
          startGeneration !== generation ||
          controller !== nextController ||
          canvasId !== normalized
        ) {
          return;
        }

        publish(nextStatus);
        options.setReadOnly(!nextStatus.canWrite);
        if (nextStatus.canWrite && nextStatus.reason === "acquired") {
          saveAdapter.activateWriter(writerOwner, {
            canvasId: normalized,
            writerTag: nextController.tag,
          });
        } else {
          saveAdapter.deactivateWriter(writerOwner);
        }
      });
    } catch {
      options.setReadOnly(true);
      return false;
    }

    if (startGeneration !== generation || canvasId !== normalized) {
      await nextController.stop().catch(() => {});
      return false;
    }

    controller = nextController;
    try {
      nextController.start();
      return true;
    } catch {
      controller = null;
      options.setReadOnly(true);
      saveAdapter.clearWriter(writerOwner);
      await nextController.stop().catch(() => {});
      return false;
    }
  }

  async function stop(): Promise<void> {
    generation += 1;
    canvasId = null;
    publish(null);
    options.setReadOnly(true);
    saveAdapter.clearWriter(writerOwner);

    const active = controller;
    controller = null;
    enqueueStop(active);
    await stopBarrier;
  }

  return {
    start,
    stop,
    getStatus: () => status,
    getCanvasId: () => canvasId,
  };
}
