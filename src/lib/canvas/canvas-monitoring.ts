import { createLogger } from "@/lib/logger";

export type CanvasMonitorAction = "render_error" | "recovery_failed";
export type CanvasMonitorBoundary = "canvas-critical-area";

export interface CanvasMonitoringEvent {
  canvasId: string;
  fingerprint: string;
  boundary: CanvasMonitorBoundary;
  action: CanvasMonitorAction;
  date: string;
  count: number;
}

export type CanvasMonitoringSink = (
  event: Readonly<CanvasMonitoringEvent>
) => void | Promise<void>;

export interface CanvasErrorMonitorOptions {
  sink?: CanvasMonitoringSink;
  maxEntries?: number;
  now?: () => Date;
  /** Test seam: explicit null forces the no-digest runtime path. */
  subtle?: Pick<SubtleCrypto, "digest"> | null;
  /** Test seam for process-local opaque canvas buckets. */
  random?: () => string;
}

export interface CaptureCanvasErrorInput {
  canvasId: string | null | undefined;
  error: unknown;
  componentStack?: string | null;
  boundary: string;
  action: CanvasMonitorAction;
}

export interface CanvasMonitoringResult {
  emitted: boolean;
  alerted: boolean;
  count: number;
}

export interface CanvasErrorMonitor {
  capture(input: CaptureCanvasErrorInput): Promise<CanvasMonitoringResult>;
  getEntryCount(): number;
  reset(): void;
}

const DEFAULT_MAX_ENTRIES = 128;
const MAX_LINE_BUCKET_SCAN_CHARS = 8_192;
const monitorLogger = createLogger("CanvasMonitor");

function safeErrorPart(error: unknown, key: "name" | "message" | "stack"): string {
  try {
    if (error && typeof error === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
        return descriptor.value;
      }
    }
  } catch {
    // A hostile error object must never break the boundary.
  }
  return "";
}

async function sha256Digest(
  value: string,
  subtle: Pick<SubtleCrypto, "digest"> | null
): Promise<string | null> {
  try {
    if (subtle) {
      const bytes = new TextEncoder().encode(value);
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
    }
  } catch {
    // A fixed fallback is safer than a weak dictionary-attackable hash of sensitive text.
  }
  return null;
}

function defaultRandomToken(): string {
  try {
    const values = new Uint32Array(4);
    globalThis.crypto?.getRandomValues(values);
    if (values.some((value) => value !== 0)) {
      return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
    }
  } catch {
    // A process-local token does not derive from sensitive input; Math.random is a final isolation fallback.
  }
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, "0")
  ).join("");
}

function safeRandomToken(random: () => string): string {
  try {
    const value = random();
    if (/^[a-z0-9_-]{8,128}$/i.test(value)) return value;
  } catch {
    // Fall through to the local random source.
  }
  return defaultRandomToken();
}

function monitoringDate(now: () => Date): string {
  try {
    const value = now();
    const time = Date.prototype.getTime.call(value);
    if (Number.isFinite(time)) return new Date(time).toISOString().slice(0, 10);
  } catch {
    // Fall through to a stable non-sensitive bucket.
  }
  return "1970-01-01";
}

function safeBoundary(value: unknown): CanvasMonitorBoundary {
  switch (value) {
    case "canvas-critical-area":
      return value;
    default:
      return "canvas-critical-area";
  }
}

interface SafeCaptureCanvasErrorInput {
  canvasId: string | null;
  error: unknown;
  componentStack: string;
  boundary: CanvasMonitorBoundary;
  action: CanvasMonitorAction;
}

function ownDataValue(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotCaptureInput(input: unknown): SafeCaptureCanvasErrorInput {
  const canvasId = ownDataValue(input, "canvasId");
  const componentStack = ownDataValue(input, "componentStack");
  const action = ownDataValue(input, "action");
  return {
    canvasId: typeof canvasId === "string" ? canvasId : null,
    error: ownDataValue(input, "error"),
    componentStack: typeof componentStack === "string" ? componentStack : "",
    boundary: safeBoundary(ownDataValue(input, "boundary")),
    action: action === "recovery_failed" ? "recovery_failed" : "render_error",
  };
}

function knownErrorName(error: unknown): string {
  const name = safeErrorPart(error, "name");
  const known = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "AggregateError",
    "DOMException",
  ]);
  return known.has(name) ? name : "Error";
}

function lengthBucket(value: string): "empty" | "short" | "medium" | "long" {
  if (value.length === 0) return "empty";
  if (value.length <= 80) return "short";
  if (value.length <= 500) return "medium";
  return "long";
}

function lineBucket(value: string): number {
  if (!value) return 0;
  let lines = 1;
  const limit = Math.min(value.length, MAX_LINE_BUCKET_SCAN_CHARS);
  for (let index = 0; index < limit; index += 1) {
    if (value.charCodeAt(index) !== 10) continue;
    lines += 1;
    if (lines >= 20) return 20;
  }
  return lines;
}

/** No message, URL, token, prompt, stack text, or component name enters fingerprint material. */
function structuralErrorMaterial(input: SafeCaptureCanvasErrorInput): string {
  const message = safeErrorPart(input.error, "message");
  const stack = safeErrorPart(input.error, "stack");
  const componentStack = input.componentStack;
  return JSON.stringify({
    name: knownErrorName(input.error),
    messageLength: lengthBucket(message),
    stackLines: lineBucket(stack),
    componentDepth: lineBucket(componentStack),
    action: input.action === "recovery_failed" ? "recovery_failed" : "render_error",
  });
}

const defaultSink: CanvasMonitoringSink = (event) => {
  if (event.count > 1) monitorLogger.error("canvas boundary daily alert", event);
  else monitorLogger.warn("canvas boundary event", event);
};

export function createCanvasErrorMonitor(
  options: CanvasErrorMonitorOptions = {}
): CanvasErrorMonitor {
  const sinkOption = ownDataValue(options, "sink");
  const sink = typeof sinkOption === "function" ? sinkOption as CanvasMonitoringSink : defaultSink;
  const maxOption = ownDataValue(options, "maxEntries");
  const requestedMax = typeof maxOption === "number" ? maxOption : DEFAULT_MAX_ENTRIES;
  const maxEntries = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(1024, Math.floor(requestedMax)))
    : DEFAULT_MAX_ENTRIES;
  const nowOption = ownDataValue(options, "now");
  const now = typeof nowOption === "function" ? nowOption as () => Date : () => new Date();
  const subtleOption = ownDataValue(options, "subtle");
  const digestOption = ownDataValue(subtleOption, "digest");
  const subtle = subtleOption === undefined
    ? globalThis.crypto?.subtle ?? null
    : subtleOption && typeof subtleOption === "object" && typeof digestOption === "function"
      ? { digest: digestOption.bind(subtleOption) } as Pick<SubtleCrypto, "digest">
      : null;
  const randomOption = ownDataValue(options, "random");
  const random = typeof randomOption === "function" ? randomOption as () => string : defaultRandomToken;
  const counts = new Map<string, number>();
  const opaqueCanvasIds = new Map<string, string>();
  let captureChain: Promise<void> = Promise.resolve();
  let pendingCaptures = 0;
  let opaqueSequence = 0;
  const maxPendingCaptures = Math.max(4, Math.min(256, maxEntries * 2));

  function processLocalCanvasId(rawCanvasIdentity: string): string {
    const existing = opaqueCanvasIds.get(rawCanvasIdentity);
    if (existing) {
      opaqueCanvasIds.delete(rawCanvasIdentity);
      opaqueCanvasIds.set(rawCanvasIdentity, existing);
      return existing;
    }

    opaqueSequence += 1;
    const opaque = `opaque:${safeRandomToken(random)}_${opaqueSequence.toString(36)}`;
    opaqueCanvasIds.set(rawCanvasIdentity, opaque);
    while (opaqueCanvasIds.size > maxEntries) {
      const oldestRawId = opaqueCanvasIds.keys().next().value as string | undefined;
      if (oldestRawId === undefined) break;
      opaqueCanvasIds.delete(oldestRawId);
    }
    return opaque;
  }

  async function captureSerial(
    input: SafeCaptureCanvasErrorInput
  ): Promise<CanvasMonitoringResult> {
    const rawCanvasIdentity = input.canvasId || "local-unpersisted-canvas";
    const date = monitoringDate(now);
    const [canvasDigest, errorDigest] = await Promise.all([
      sha256Digest(`canvas:${rawCanvasIdentity}`, subtle),
      sha256Digest(`error:${structuralErrorMaterial(input)}`, subtle),
    ]);
    const opaqueCanvasId = canvasDigest
      ? `hash:${canvasDigest}`
      : processLocalCanvasId(rawCanvasIdentity);
    const fingerprint = `hash:${errorDigest ?? "opaque-unavailable"}`;
    const key = `${opaqueCanvasId}|${date}`;
    const previous = counts.get(key) ?? 0;
    const count = Math.min(Number.MAX_SAFE_INTEGER, previous + 1);

    if (counts.has(key)) counts.delete(key);
    counts.set(key, count);
    while (counts.size > maxEntries) {
      const oldest = counts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      counts.delete(oldest);
    }

    if (count > 2) return { emitted: false, alerted: true, count };

    const event: CanvasMonitoringEvent = Object.freeze({
      canvasId: opaqueCanvasId,
      fingerprint,
      boundary: input.boundary,
      action: input.action,
      date,
      count,
    });
    try {
      await sink(event);
    } catch {
      // Telemetry must never affect canvas recovery.
    }
    return { emitted: true, alerted: count === 2, count };
  }

  return {
    capture(input) {
      // Serialize complete captures in invocation order. The chain never stores a raw id as a key.
      if (pendingCaptures >= maxPendingCaptures) {
        return Promise.resolve({ emitted: false, alerted: false, count: 0 });
      }
      pendingCaptures += 1;
      const snapshot = snapshotCaptureInput(input);
      const task = captureChain
        .then(() => captureSerial(snapshot))
        .catch(() => ({ emitted: false, alerted: false, count: 0 }));
      captureChain = task.then(
        () => undefined,
        () => undefined
      );
      return task.finally(() => {
        pendingCaptures -= 1;
      });
    },
    getEntryCount: () => counts.size,
    reset: () => {
      counts.clear();
      opaqueCanvasIds.clear();
    },
  };
}

export const canvasErrorMonitor = createCanvasErrorMonitor();
