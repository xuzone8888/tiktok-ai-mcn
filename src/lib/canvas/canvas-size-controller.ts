import { checkDocSize, type DocSizeResult } from "./doc-limits";
import type { CanvasDoc } from "./schema";

export const CANVAS_SIZE_DEBOUNCE_MS = 400;

export interface CanvasSizeScheduler {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CanvasDocSizeControllerOptions {
  initial: CanvasDoc;
  initialSize?: DocSizeResult;
  delayMs?: number;
  scheduler?: CanvasSizeScheduler;
  compute?: (doc: CanvasDoc) => DocSizeResult;
}

export interface CanvasDocSizeController {
  getCurrent(): DocSizeResult;
  update(doc: CanvasDoc): void;
  subscribe(listener: (size: DocSizeResult) => void): () => void;
  dispose(): void;
}

function defaultScheduler(): CanvasSizeScheduler {
  return {
    setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function createCanvasDocSizeController(
  options: CanvasDocSizeControllerOptions
): CanvasDocSizeController {
  const scheduler = options.scheduler ?? defaultScheduler();
  const compute = options.compute ?? checkDocSize;
  const delayMs = Number.isFinite(options.delayMs)
    ? Math.max(100, Math.min(2000, Math.floor(options.delayMs ?? CANVAS_SIZE_DEBOUNCE_MS)))
    : CANVAS_SIZE_DEBOUNCE_MS;
  const listeners = new Set<(size: DocSizeResult) => void>();

  let current = options.initialSize ?? compute(options.initial);
  let pending = options.initial;
  let timer: unknown = null;
  let disposed = false;

  function flush(): void {
    timer = null;
    if (disposed) return;
    current = compute(pending);
    for (const listener of listeners) listener(current);
  }

  return {
    getCurrent: () => current,
    update(doc) {
      if (disposed) return;
      pending = doc;
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = scheduler.setTimeout(flush, delayMs);
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
