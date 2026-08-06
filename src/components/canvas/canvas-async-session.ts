export interface CanvasAsyncSessionToken {
  generation: number;
}

/** Invalidates every captured task when interaction is lost or the Board unmounts. */
export class CanvasAsyncSession {
  private generation = 0;
  private mounted = true;
  private interactive: boolean;

  constructor(interactive: boolean) {
    this.interactive = interactive;
  }

  setInteraction(interactive: boolean): void {
    if (!this.mounted || this.interactive === interactive) return;
    this.interactive = interactive;
    this.generation += 1;
  }

  capture(): CanvasAsyncSessionToken | null {
    return this.mounted && this.interactive ? { generation: this.generation } : null;
  }

  isCurrent(token: CanvasAsyncSessionToken): boolean {
    return this.mounted && this.interactive && token.generation === this.generation;
  }

  invalidate(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.interactive = false;
    this.generation += 1;
  }
}

export interface GuardedCanvasTaskHandlers<T> {
  onSuccess(value: T): void;
  onError(error: unknown): void;
}

/** Runs handlers only if the exact Board interaction generation is still active at settlement. */
export async function runGuardedCanvasTask<T>(
  session: CanvasAsyncSession,
  task: PromiseLike<T>,
  handlers: GuardedCanvasTaskHandlers<T>
): Promise<boolean> {
  const token = session.capture();
  if (!token) return false;

  let value: T;
  try {
    value = await task;
  } catch (error) {
    if (!session.isCurrent(token)) return false;
    handlers.onError(error);
    return false;
  }

  if (!session.isCurrent(token)) return false;
  handlers.onSuccess(value);
  return true;
}
