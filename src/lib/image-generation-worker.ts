import {
  getVideoPlatformImageMaxPollMs,
  queryVideoPlatformImageTask,
  submitVideoPlatformImage,
} from "@/lib/video-platform-image-api";
import {
  COMPLEX_IMAGE_MAX_WAIT_MS,
  NORMAL_IMAGE_MAX_WAIT_MS,
  type ImageQueueLane,
} from "@/lib/image-prompt-complexity";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { isImageFactoryEnabled } from "@/lib/feature-flags";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  isImageResolution,
  type ImageResolution,
} from "@/types/generation";
import type { EcomResolution, EcomTaskStatus, OutputItem } from "@/types/ecom-image";

const OPENAI_IMAGE_MAX_ATTEMPTS = 6;
const OPENAI_IMAGE_LOCK_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 180_000, 180_000, 300_000];
const DEFAULT_MAX_RUNTIME_MS = 270_000;
const DEFAULT_MAX_GENERATION_ITEMS = 3;
const DEFAULT_MAX_ECOM_ITEMS = 0;
const DEFAULT_MAX_SLOW_GENERATION_ITEMS = 1;
const MAX_STANDARD_GENERATION_WORKER_CONCURRENCY = 3;
const MAX_SLOW_GENERATION_WORKER_CONCURRENCY = 1;
const MAX_ECOM_OUTPUT_ITEM_CONCURRENCY = 3;
const MAX_ECOM_SLOW_OUTPUT_ITEM_CONCURRENCY = 1;

type AdminClient = ReturnType<typeof createAdminClient>;

type WorkerCounters = {
  scannedGenerations: number;
  processedGenerations: number;
  completedGenerations: number;
  failedGenerations: number;
  retriedGenerations: number;
  skippedGenerations: number;
  scannedEcomTasks: number;
  processedEcomItems: number;
  completedEcomItems: number;
  failedEcomItems: number;
  retriedEcomItems: number;
  finalizedEcomTasks: number;
  refunded: number;
  errors: Array<{ scope: string; id?: string; message: string }>;
};

export type ProcessImageGenerationQueueOptions = {
  maxRuntimeMs?: number;
  maxGenerationItems?: number;
  maxEcomItems?: number;
};

export type ProcessImageGenerationQueueResult = WorkerCounters & {
  startedAt: string;
  finishedAt: string;
  runtimeMs: number;
  stoppedByRuntime: boolean;
};

type GenerationRecord = Record<string, unknown> & {
  id: string;
  task_id?: string | null;
  user_id: string;
  status: string;
  prompt?: string | null;
  model?: string | null;
  aspect_ratio?: string | null;
  quality?: string | null;
  resolution?: string | null;
  source_image_url?: string | null;
  credit_cost?: number | null;
  metadata?: unknown;
  created_at?: string | null;
};

type EcomTaskRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
  status: string;
  mode: string;
  model_type?: string | null;
  ratio?: string | null;
  resolution?: string | null;
  output_items?: unknown;
  metadata?: unknown;
  credits_charged?: boolean | null;
  credits_cost?: number | null;
  updated_at?: string | null;
};

type OpenAIOutputItem = OutputItem & Record<string, unknown>;
type RefundCreditResult = {
  status: "refunded" | "retry" | "manual_review";
  error?: string;
};

const REFUND_TRANSIENT_METADATA_KEYS = [
  "refund_retry_count",
  "last_refund_error",
  "refund_next_attempt_at",
  "refund_lock_id",
  "refund_lock_expires_at",
  "refund_retry_delay_ms",
] as const;

function createCounters(): WorkerCounters {
  return {
    scannedGenerations: 0,
    processedGenerations: 0,
    completedGenerations: 0,
    failedGenerations: 0,
    retriedGenerations: 0,
    skippedGenerations: 0,
    scannedEcomTasks: 0,
    processedEcomItems: 0,
    completedEcomItems: 0,
    failedEcomItems: 0,
    retriedEcomItems: 0,
    finalizedEcomTasks: 0,
    refunded: 0,
    errors: [],
  };
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function shouldStop(startedMs: number, maxRuntimeMs: number): boolean {
  return Date.now() - startedMs >= maxRuntimeMs;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await worker(items[currentIndex], currentIndex),
        };
      } catch (error) {
        results[currentIndex] = {
          status: "rejected",
          reason: error,
        };
      }
    }
  }));

  return results;
}

function getUuidReferenceId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function getMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }

  return {};
}

function getEcomBillingAttempt(metadata: Record<string, unknown>): number {
  const value = Number(metadata.billing_attempt || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function getEcomPricingVersion(task: EcomTaskRecord, billingAttempt: number): string {
  return `ecom-image-${task.mode}-attempt-${billingAttempt}-v1`;
}

function getEcomRefundOperation(
  billingAttempt: number,
  failedCount: number,
  totalCount: number
): string {
  return `refund-a${billingAttempt}-f${failedCount}-of-${totalCount}`;
}

function getAttempts(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(metadata.attempts)
    ? metadata.attempts as Array<Record<string, unknown>>
    : [];
}

function getFailureAttemptCount(attempts: Array<Record<string, unknown>>): number {
  return attempts.filter(attempt => {
    if (attempt.success === true) return false;
    return attempt.upstreamStatus !== "processing" && attempt.upstreamResponseType !== "processing";
  }).length;
}

function getMaxAttempts(metadata: Record<string, unknown>, fallback = OPENAI_IMAGE_MAX_ATTEMPTS): number {
  const maxAttempts = Number(metadata.maxAttempts || fallback);
  return Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.min(maxAttempts, OPENAI_IMAGE_MAX_ATTEMPTS)
    : OPENAI_IMAGE_MAX_ATTEMPTS;
}

function getRetryDelayMs(attemptNumber: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(0, attemptNumber - 1), RETRY_DELAYS_MS.length - 1)];
}

function getQueueLaneFromMetadata(metadata: Record<string, unknown>): ImageQueueLane {
  return metadata.queueLane === "slow" ? "slow" : "standard";
}

function getGenerationMaxWaitMs(metadata: Record<string, unknown>): number {
  const configuredMaxWaitMs = Number(metadata.maxWaitMs || 0);
  if (Number.isFinite(configuredMaxWaitMs) && configuredMaxWaitMs > 0) {
    return configuredMaxWaitMs;
  }

  return getQueueLaneFromMetadata(metadata) === "slow"
    ? COMPLEX_IMAGE_MAX_WAIT_MS
    : NORMAL_IMAGE_MAX_WAIT_MS;
}

function getRecordAgeMs(createdAt: unknown, fallbackStartedAt?: string): number {
  const timestamp = typeof createdAt === "string"
    ? Date.parse(createdAt)
    : typeof fallbackStartedAt === "string"
      ? Date.parse(fallbackStartedAt)
      : 0;
  return timestamp ? Math.max(0, Date.now() - timestamp) : 0;
}

function getOpenAIOutputItemMetadata(item: OpenAIOutputItem): Record<string, unknown> {
  return item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
}

function getOpenAIOutputItemQueueLane(item: OpenAIOutputItem): ImageQueueLane {
  const itemMetadata = getOpenAIOutputItemMetadata(item);
  return item.queue_lane === "slow" || itemMetadata.queueLane === "slow" ? "slow" : "standard";
}

function getOpenAIOutputItemMaxWaitMs(item: OpenAIOutputItem, taskMetadata: Record<string, unknown>): number {
  const itemMetadata = getOpenAIOutputItemMetadata(item);
  const configuredMaxWaitMs = Number(item.max_wait_ms || itemMetadata.maxWaitMs || taskMetadata.maxWaitMs || 0);
  if (Number.isFinite(configuredMaxWaitMs) && configuredMaxWaitMs > 0) {
    return configuredMaxWaitMs;
  }

  return getOpenAIOutputItemQueueLane(item) === "slow"
    ? COMPLEX_IMAGE_MAX_WAIT_MS
    : NORMAL_IMAGE_MAX_WAIT_MS;
}

function parseImageResolution(value: unknown): ImageResolution {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  return isImageResolution(normalized) ? normalized : DEFAULT_IMAGE_RESOLUTION;
}

function parseEcomResolution(value: unknown): EcomResolution {
  return parseImageResolution(value) as EcomResolution;
}

function isRetryableOpenAIImageError(
  error: string | undefined,
  statusCode?: number,
  upstreamStatus?: number,
  retryable?: boolean
): boolean {
  if (retryable === true) return true;
  if (statusCode && [429, 500, 502, 503, 504, 524].includes(statusCode)) return true;
  if (upstreamStatus && [429, 500, 502, 503, 504, 524].includes(upstreamStatus)) return true;

  const message = (error || "").toLowerCase();
  if (!message) return false;

  if (
    message.includes("tool choice") &&
    message.includes("image_generation") &&
    message.includes("tools")
  ) {
    return true;
  }

  return [
    "429",
    "500",
    "502",
    "503",
    "504",
    "524",
    "timeout",
    "timed out",
    "overloaded",
    "cpu overloaded",
    "rate limit",
    "temporarily unavailable",
    "busy",
    "capacity",
    "fetch failed",
    "network",
    "socket",
    "econnreset",
    "upstream",
    "长时间",
    "超时",
  ].some(keyword => message.includes(keyword));
}

function isOpenAIImageGenerationRecord(record: GenerationRecord): boolean {
  const metadata = getMetadata(record.metadata);
  return record.model === DEFAULT_IMAGE_MODEL ||
    metadata.provider === "openai" ||
    metadata.provider === "video_platform_image";
}

function isMetadataFlagEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

function isRefundPendingMetadata(metadata: Record<string, unknown>): boolean {
  return isMetadataFlagEnabled(metadata.refund_pending);
}

function isRefundManualReviewMetadata(metadata: Record<string, unknown>): boolean {
  return isMetadataFlagEnabled(metadata.refund_manual_review_required) ||
    isMetadataFlagEnabled(metadata.refund_balance_maybe_applied);
}

function buildRefundMetadata(
  metadata: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const nextMetadata = { ...metadata };
  for (const key of REFUND_TRANSIENT_METADATA_KEYS) {
    delete nextMetadata[key];
  }

  return {
    ...nextMetadata,
    ...patch,
  };
}

function getRefundRetryCount(metadata: Record<string, unknown>): number {
  const retryCount = Number(metadata.refund_retry_count || 0);
  return Number.isFinite(retryCount) && retryCount > 0 ? Math.floor(retryCount) : 0;
}

function isRefundDue(metadata: Record<string, unknown>, now: number): boolean {
  if (!isRefundPendingMetadata(metadata)) return false;
  if (isRefundManualReviewMetadata(metadata)) return false;

  const lockExpiresAt = typeof metadata.refund_lock_expires_at === "string"
    ? Date.parse(metadata.refund_lock_expires_at)
    : 0;
  if (lockExpiresAt && lockExpiresAt > now) return false;

  const nextAttemptAt = typeof metadata.refund_next_attempt_at === "string"
    ? Date.parse(metadata.refund_next_attempt_at)
    : 0;
  return !nextAttemptAt || nextAttemptAt <= now;
}

function isGenerationDue(record: GenerationRecord, now: number): boolean {
  const status = String(record.status || "");
  const metadata = getMetadata(record.metadata);

  if (isRefundPendingMetadata(metadata)) {
    return isRefundDue(metadata, now);
  }

  if (status === "pending") {
    const lockExpiresAt = typeof metadata.lockExpiresAt === "string" ? Date.parse(metadata.lockExpiresAt) : 0;
    return Boolean(lockExpiresAt && lockExpiresAt <= now);
  }

  if (status !== "processing") return false;

  const nextAttemptAt = typeof metadata.nextAttemptAt === "string" ? Date.parse(metadata.nextAttemptAt) : 0;
  if (nextAttemptAt) return nextAttemptAt <= now;

  // 恢复旧 processing 任务：无 attempts / 无 nextAttemptAt 时直接纳入 worker。
  return true;
}

function getOpenAIImagePromptFromMetadata(metadata: Record<string, unknown>, fallbackPrompt: string | null): string {
  return typeof metadata.prompt === "string" ? metadata.prompt : fallbackPrompt || "";
}

async function releaseExpiredGenerationLock(
  adminClient: AdminClient,
  generation: GenerationRecord
): Promise<GenerationRecord | null> {
  const metadata = getMetadata(generation.metadata);
  const releasedMetadata = {
    ...metadata,
    staleLockReleasedAt: new Date().toISOString(),
    lockId: null,
    lockExpiresAt: null,
    currentAttempt: null,
  };

  const { data } = await adminClient
    .from("generations")
    .update({ status: "processing", metadata: releasedMetadata as any })
    .eq("id", generation.id)
    .eq("status", "pending")
    .select("*")
    .single();

  return data as GenerationRecord | null;
}

async function getRecordedQuickImageRefundAmount(
  adminClient: AdminClient,
  userId: string,
  taskId: string,
  generationId?: string
): Promise<number> {
  const referenceId = generationId ? getUuidReferenceId(generationId) : null;
  const [legacyResult, taskScopedResult] = await Promise.all([
    adminClient
      .from("credit_transactions")
      .select("amount, description, reference_id")
      .eq("user_id", userId)
      .eq("reference_type", "quick_gen_image")
      .eq("type", "refund"),
    (adminClient as any)
      .from("credit_transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("task_id", generationId || "")
      .eq("entry_kind", "refund")
      .eq("pricing_version", "quick-image-gpt-image-2-v1"),
  ]);
  if (legacyResult.error || taskScopedResult.error) {
    console.error(
      "[Image Worker] Failed to read quick-gen refund transactions:",
      legacyResult.error || taskScopedResult.error
    );
    return 0;
  }

  const legacyAmount = (legacyResult.data || [])
    .filter((row) => {
      const record = row as { reference_id?: string | null; description?: string | null };
      return (referenceId && record.reference_id === referenceId) ||
        (!!taskId && !!record.description && record.description.includes(taskId));
    })
    .reduce((sum, row) => sum + Math.max(0, Number((row as { amount?: number }).amount || 0)), 0);
  const taskScopedAmount = ((taskScopedResult.data || []) as Array<{ amount?: number }>)
    .reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);

  return legacyAmount + taskScopedAmount;
}

async function refundQuickGenerationCredits(
  adminClient: AdminClient,
  generation: GenerationRecord,
  amount: number
): Promise<RefundCreditResult> {
  if (amount <= 0) return { status: "refunded" };

  const taskId = String(generation.task_id || "");
  const generationId = String(generation.id || "");
  const metadata = getMetadata(generation.metadata);
  const metadataRefundAmount = Number(metadata.refundAmount || 0);
  const recordedRefundAmount = await getRecordedQuickImageRefundAmount(
    adminClient,
    generation.user_id,
    taskId,
    generationId
  );
  const alreadyRefunded = Math.max(
    Number.isFinite(metadataRefundAmount) ? metadataRefundAmount : 0,
    recordedRefundAmount
  );
  const refundAmount = Math.max(0, amount - alreadyRefunded);
  if (refundAmount <= 0) return { status: "refunded" };

  try {
    await applyTaskCreditDelta({
      supabase: adminClient,
      userId: generation.user_id,
      entryKind: "refund",
      amount: refundAmount,
      scope: "quick-image",
      taskId: generationId,
      operation: "refund",
      pricingVersion: "quick-image-gpt-image-2-v1",
      description: `图片生成失败自动退款 - GPT Image 2 (${taskId})`,
    });
  } catch (error) {
    console.error("[Image Worker] Failed to refund quick-gen credits:", error);
    return {
      status: "retry",
      error: error instanceof Error ? error.message : "原子退款失败",
    };
  }

  await adminClient
    .from("generations")
    .update({
      metadata: buildRefundMetadata(metadata, {
        refund_pending: false,
        refund_pending_amount: 0,
        refundAmount: alreadyRefunded + refundAmount,
        refundedAt: new Date().toISOString(),
      }) as any,
    })
    .eq("id", generation.id);

  return { status: "refunded" };
}

async function processQuickGenerationRefundPending(
  adminClient: AdminClient,
  generation: GenerationRecord
): Promise<"failed" | "retried" | "skipped"> {
  const metadata = getMetadata(generation.metadata);
  if (!isRefundPendingMetadata(metadata)) return "skipped";

  const now = Date.now();
  if (!isRefundDue(metadata, now)) return "skipped";

  const refundAmount = Number(metadata.refund_pending_amount || generation.credit_cost || 0);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    const { error } = await adminClient
      .from("generations")
      .update({
        status: "failed",
        metadata: {
          ...metadata,
          refund_pending: false,
          refund_pending_amount: 0,
          refund_lock_id: null,
          refund_lock_expires_at: null,
          refund_next_attempt_at: null,
          refund_completed_at: new Date().toISOString(),
        } as any,
      })
      .eq("id", generation.id);

    return error ? "skipped" : "failed";
  }

  const lockId = crypto.randomUUID();
  const retryCount = getRefundRetryCount(metadata);
  const lockedMetadata = {
    ...metadata,
    refund_lock_id: lockId,
    refund_lock_expires_at: new Date(Date.now() + OPENAI_IMAGE_LOCK_TTL_MS).toISOString(),
    refund_last_attempt_at: new Date().toISOString(),
  };

  const { data: lockedGeneration, error: lockError } = await adminClient
    .from("generations")
    .update({
      status: "pending",
      metadata: lockedMetadata as any,
    })
    .eq("id", generation.id)
    .eq("status", generation.status)
    .select("*")
    .single();

  if (lockError || !lockedGeneration) {
    console.warn("[Image Worker] Failed to lock quick-gen refund compensation:", {
      taskId: generation.task_id || generation.id,
      lockError,
    });
    return "skipped";
  }

  const lockedRecord = lockedGeneration as GenerationRecord;
  const lockedRefundMetadata = getMetadata(lockedRecord.metadata);
  const refundResult = await refundQuickGenerationCredits(adminClient, lockedRecord, refundAmount);

  if (refundResult.status === "refunded") {
    const recordedRefundAmount = await getRecordedQuickImageRefundAmount(
      adminClient,
      lockedRecord.user_id,
      String(lockedRecord.task_id || ""),
      String(lockedRecord.id || "")
    );
    const { error: completeError } = await adminClient
      .from("generations")
      .update({
        status: "failed",
        completed_at: typeof lockedRefundMetadata.failedAt === "string"
          ? lockedRefundMetadata.failedAt
          : new Date().toISOString(),
        metadata: buildRefundMetadata(lockedRefundMetadata, {
          refund_pending: false,
          refund_pending_amount: 0,
          refund_completed_at: new Date().toISOString(),
          refundAmount: Math.max(
            Number(lockedRefundMetadata.refundAmount || 0),
            recordedRefundAmount,
            refundAmount
          ),
        }) as any,
      })
      .eq("id", lockedRecord.id)
      .eq("status", "pending");

    if (completeError) {
      console.warn("[Image Worker] Quick-gen refund succeeded but metadata finalization failed:", {
        taskId: lockedRecord.task_id || lockedRecord.id,
        completeError,
      });
      return "skipped";
    }

    return "failed";
  }

  if (refundResult.status === "manual_review") {
    return "failed";
  }

  const nextRetryCount = retryCount + 1;
  const retryDelayMs = getRetryDelayMs(nextRetryCount);
  const { error: retryError } = await adminClient
    .from("generations")
    .update({
      status: "failed",
      metadata: {
        ...lockedRefundMetadata,
        refund_pending: true,
        refund_pending_amount: refundAmount,
        refund_retry_count: nextRetryCount,
        refund_next_attempt_at: new Date(Date.now() + retryDelayMs).toISOString(),
        refund_retry_delay_ms: retryDelayMs,
        refund_lock_id: null,
        refund_lock_expires_at: null,
        last_refund_error: refundResult.error || "退款或退款流水写入失败，等待 worker 重试",
      } as any,
    })
    .eq("id", lockedRecord.id)
    .eq("status", "pending");

  if (retryError) {
    console.error("[Image Worker] Failed to schedule quick-gen refund retry:", retryError);
    return "skipped";
  }

  return "retried";
}

async function processGeneration(
  adminClient: AdminClient,
  generation: GenerationRecord
): Promise<"completed" | "retried" | "failed" | "skipped"> {
  let current = generation;
  const now = Date.now();

  if (isRefundPendingMetadata(getMetadata(current.metadata))) {
    return processQuickGenerationRefundPending(adminClient, current);
  }

  if (current.status === "pending") {
    const released = await releaseExpiredGenerationLock(adminClient, current);
    if (!released) return "skipped";
    current = released;
  }

  if (!isGenerationDue(current, now)) return "skipped";

  const metadata = getMetadata(current.metadata);
  const attempts = getAttempts(metadata);
  const attemptNumber = attempts.length + 1;
  const maxAttempts = getMaxAttempts(metadata);
  const lockId = crypto.randomUUID();
  const attemptStartedAt = new Date().toISOString();
  const lockedMetadata = {
    ...metadata,
    nextAttemptAt: null,
    lockId,
    lockExpiresAt: new Date(Date.now() + OPENAI_IMAGE_LOCK_TTL_MS).toISOString(),
    currentAttempt: {
      lockId,
      attemptNumber,
      startedAt: attemptStartedAt,
    },
  };

  const { data: lockedTask, error: lockError } = await adminClient
    .from("generations")
    .update({ status: "pending", metadata: lockedMetadata as any })
    .eq("id", current.id)
    .eq("status", "processing")
    .select("*")
    .single();

  if (lockError || !lockedTask) return "skipped";

  const lockedRecord = lockedTask as GenerationRecord;
  const lockedMetadataAfterDb = getMetadata(lockedRecord.metadata);
  const sourceImageUrls = Array.isArray(lockedMetadataAfterDb.sourceImageUrls)
    ? (lockedMetadataAfterDb.sourceImageUrls as string[])
    : undefined;
  const resolution = parseImageResolution(lockedMetadataAfterDb.resolution || lockedRecord.resolution || lockedRecord.quality);
  const aspectRatio = typeof lockedMetadataAfterDb.aspectRatio === "string"
    ? lockedMetadataAfterDb.aspectRatio
    : "auto";
  const platformTaskId = typeof lockedMetadataAfterDb.platformTaskId === "string"
    ? lockedMetadataAfterDb.platformTaskId
    : null;
  const startedMs = Date.now();
  let imageResult = platformTaskId
    ? await queryVideoPlatformImageTask(platformTaskId, resolution, aspectRatio)
    : await submitVideoPlatformImage({
      prompt: getOpenAIImagePromptFromMetadata(lockedMetadataAfterDb, lockedRecord.prompt || null),
      sourceImageUrls: sourceImageUrls && sourceImageUrls.length > 0 ? sourceImageUrls : undefined,
      resolution,
      aspectRatio,
    });
  const finishedAt = new Date().toISOString();
  const platformSubmittedAt = typeof lockedMetadataAfterDb.platformSubmittedAt === "string"
    ? lockedMetadataAfterDb.platformSubmittedAt
    : attemptStartedAt;
  const platformPollExceeded = imageResult.status === "processing" &&
    Date.now() - Date.parse(platformSubmittedAt) > getVideoPlatformImageMaxPollMs();

  if (platformPollExceeded) {
    imageResult = {
      ...imageResult,
      success: false,
      status: "failed",
      error: `视频平台图片任务轮询超过 ${getVideoPlatformImageMaxPollMs()}ms`,
      upstreamResponseType: "failed",
    };
  }

  const workerRetryable = isRetryableOpenAIImageError(
    imageResult.error,
    imageResult.statusCode,
    imageResult.upstreamStatus,
    imageResult.retryable
  );
  const maxWaitMs = getGenerationMaxWaitMs(lockedMetadataAfterDb);
  const taskAgeMs = getRecordAgeMs(lockedRecord.created_at, attemptStartedAt);
  const maxWaitExceeded = taskAgeMs >= maxWaitMs;
  const queueLane = getQueueLaneFromMetadata(lockedMetadataAfterDb);

  const attemptRecord = {
    attemptNumber,
    startedAt: attemptStartedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    provider: "video_platform_image",
    endpoint: imageResult.endpoint || null,
    upstreamStatus: imageResult.status,
    success: imageResult.success,
    error: imageResult.error || null,
    requestedSize: imageResult.requestedSize,
    upstreamSize: imageResult.upstreamSize,
    upstreamQuality: imageResult.upstreamQuality,
    outputFormat: imageResult.outputFormat,
    outputCompression: imageResult.outputCompression,
    requestTimeoutMs: imageResult.requestTimeoutMs,
    hasUrls: imageResult.hasUrls,
    referenceCount: imageResult.referenceCount,
    referenceCountReceived: imageResult.referenceCountReceived ?? imageResult.referenceCount ?? 0,
    referenceCountUsed: imageResult.referenceCountUsed ?? imageResult.referenceCount ?? 0,
    referenceReductionReason: imageResult.referenceReductionReason || null,
    platformTaskId: imageResult.platformTaskId || platformTaskId || null,
    upstreamResponseType: imageResult.upstreamResponseType,
    upstreamHttpStatus: imageResult.statusCode || imageResult.upstreamStatus || null,
    retryable: workerRetryable,
    providerRetryable: imageResult.retryable ?? null,
    workerRetryable,
    complexityProfile: lockedMetadataAfterDb.complexityProfile || "normal",
    queueLane,
    maxWaitMs,
    taskAgeMs,
    maxWaitExceeded,
    rawStatus: imageResult.rawStatus || null,
    originalPromptLength: getOpenAIImagePromptFromMetadata(lockedMetadataAfterDb, lockedRecord.prompt || null).length,
    fallbackMode: "none",
    fallbackAttempt: 0,
    upstreamCallCount: imageResult.upstreamCallCount || 0,
  };
  const updatedAttempts = [...attempts, attemptRecord];
  const nextPlatformTaskId = imageResult.platformTaskId || platformTaskId || null;
  const baseMetadataAfterAttempt = {
    ...lockedMetadataAfterDb,
    provider: "video_platform_image",
    attempts: updatedAttempts,
    lastAttempt: attemptRecord,
    platformTaskId: nextPlatformTaskId,
    platformSubmittedAt: nextPlatformTaskId
      ? (lockedMetadataAfterDb.platformSubmittedAt || platformSubmittedAt)
      : null,
    platformPollExceeded,
    lockId: null,
    lockExpiresAt: null,
    currentAttempt: null,
  };

  if (imageResult.success && imageResult.imageUrl) {
    const { error: completeError } = await adminClient
      .from("generations")
      .update({
        status: "completed",
        result_url: imageResult.imageUrl,
        image_url: imageResult.imageUrl,
        error_message: null,
        completed_at: finishedAt,
        metadata: {
          ...baseMetadataAfterAttempt,
          completedAt: finishedAt,
        } as any,
      })
      .eq("id", lockedRecord.id)
      .eq("status", "pending");

    if (completeError) {
      console.error("[Image Worker] Failed to mark generation completed:", completeError);
      return "skipped";
    }

    return "completed";
  }

  if (imageResult.status === "processing" && nextPlatformTaskId && !maxWaitExceeded) {
    const retryDelayMs = getRetryDelayMs(attemptNumber);
    const { error: processingError } = await adminClient
      .from("generations")
      .update({
        status: "processing",
        error_message: null,
        metadata: {
          ...baseMetadataAfterAttempt,
          nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
          retryDelayMs,
        } as any,
      })
      .eq("id", lockedRecord.id)
      .eq("status", "pending");

    if (processingError) {
      console.error("[Image Worker] Failed to schedule generation platform polling:", processingError);
      return "skipped";
    }

    return "retried";
  }

  const retryable = workerRetryable;
  const failureAttemptCount = getFailureAttemptCount(updatedAttempts);
  const shouldRetry = retryable && failureAttemptCount < maxAttempts && !maxWaitExceeded;
  if (shouldRetry) {
    const retryDelayMs = getRetryDelayMs(attemptNumber);
    const { error: retryError } = await adminClient
      .from("generations")
      .update({
        status: "processing",
        error_message: imageResult.error || null,
        metadata: {
          ...baseMetadataAfterAttempt,
          nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
          retryDelayMs,
          platformTaskId: platformPollExceeded ? null : baseMetadataAfterAttempt.platformTaskId,
          platformSubmittedAt: platformPollExceeded ? null : baseMetadataAfterAttempt.platformSubmittedAt,
        } as any,
      })
      .eq("id", lockedRecord.id)
      .eq("status", "pending");

    if (retryError) {
      console.error("[Image Worker] Failed to schedule generation retry:", retryError);
      return "skipped";
    }

    return "retried";
  }

  const finalError = maxWaitExceeded
    ? `图片生成超过最大等待时间 ${maxWaitMs}ms`
    : imageResult.error || "图片生成失败";
  const creditCost = Number(lockedRecord.credit_cost || 0);
  const failedMetadata = {
    ...baseMetadataAfterAttempt,
    failedAt: finishedAt,
    finalError,
    retryable,
    maxWaitExceeded,
    refund_pending: creditCost > 0,
    refund_pending_amount: creditCost > 0 ? creditCost : 0,
    refund_retry_count: 0,
    refund_next_attempt_at: creditCost > 0 ? finishedAt : null,
    refund_lock_id: null,
    refund_lock_expires_at: null,
  };

  const { data: failedGeneration, error: failError } = await adminClient
    .from("generations")
    .update({
      status: "failed",
      error_message: finalError,
      completed_at: finishedAt,
      metadata: failedMetadata as any,
    })
    .eq("id", lockedRecord.id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (failError || !failedGeneration) {
    console.error("[Image Worker] Failed to mark generation failed:", failError);
    return "skipped";
  }

  if (creditCost > 0) {
    return processQuickGenerationRefundPending(adminClient, failedGeneration as GenerationRecord);
  }

  return "failed";
}

function hasOpenAIOutputItems(task: EcomTaskRecord, outputItems: OutputItem[]): boolean {
  const metadata = getMetadata(task.metadata);
  if (metadata.taskEngine === "gpt_image_2_polling") return true;
  if (task.model_type === DEFAULT_IMAGE_MODEL) return true;
  return outputItems.some(item => {
    const record = item as OpenAIOutputItem;
    return record.provider === "openai" ||
      record.provider === "video_platform_image" ||
      record.model_type === DEFAULT_IMAGE_MODEL;
  });
}

function getOpenAIOutputAttempts(item: OpenAIOutputItem): Array<Record<string, unknown>> {
  return Array.isArray(item.attempts) ? item.attempts as Array<Record<string, unknown>> : [];
}

function getOpenAIOutputMaxAttempts(item: OpenAIOutputItem, taskMetadata: Record<string, unknown>): number {
  const value = Number(item.max_attempts || taskMetadata.maxAttempts || OPENAI_IMAGE_MAX_ATTEMPTS);
  return Number.isFinite(value) && value > 0
    ? Math.min(value, OPENAI_IMAGE_MAX_ATTEMPTS)
    : OPENAI_IMAGE_MAX_ATTEMPTS;
}

function getOpenAIOutputPrompt(item: OpenAIOutputItem): string {
  return typeof item.prompt === "string" && item.prompt.trim()
    ? item.prompt
    : "Create a high quality e-commerce product image. Keep the reference product consistent.";
}

function getOpenAIOutputSourceImageUrls(item: OpenAIOutputItem): string[] | undefined {
  if (Array.isArray(item.source_image_urls)) {
    return (item.source_image_urls as string[]).filter(Boolean);
  }
  return typeof item.input_image_url === "string" && item.input_image_url
    ? [item.input_image_url]
    : undefined;
}

function getOpenAIOutputStatus(outputItems: OpenAIOutputItem[]): {
  status: EcomTaskStatus;
  processingCount: number;
  failedCount: number;
  completedCount: number;
  errorMessage: string | null;
} {
  const processingCount = outputItems.filter(item => item.status === "processing" || item.status === "pending").length;
  const failedCount = outputItems.filter(item => item.status === "failed").length;
  const completedCount = outputItems.filter(item => item.status === "completed").length;
  const totalCount = outputItems.length;

  if (processingCount > 0) {
    return { status: "generating_images", processingCount, failedCount, completedCount, errorMessage: null };
  }

  if (failedCount === totalCount && totalCount > 0) {
    return { status: "failed", processingCount, failedCount, completedCount, errorMessage: "图片生成失败" };
  }

  if (failedCount > 0) {
    return {
      status: "partial_success",
      processingCount,
      failedCount,
      completedCount,
      errorMessage: `${failedCount}/${totalCount} 张图片生成失败`,
    };
  }

  return { status: "success", processingCount, failedCount, completedCount, errorMessage: null };
}

function getOpenAIItemLock(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const lock = metadata.openaiItemLock;
  return lock && typeof lock === "object" && !Array.isArray(lock)
    ? lock as Record<string, unknown>
    : null;
}

function isLockActive(lock: Record<string, unknown> | null, now: number): boolean {
  if (!lock) return false;
  const expiresAt = typeof lock.expiresAt === "string" ? Date.parse(lock.expiresAt) : 0;
  return Boolean(expiresAt && expiresAt > now);
}

function isOpenAIOutputItemDue(task: EcomTaskRecord, item: OpenAIOutputItem, now: number): boolean {
  if (item.status !== "processing" && item.status !== "pending") return false;
  if (!hasOpenAIOutputItems(task, [item])) return false;

  const itemLockExpiresAt = typeof item.lock_expires_at === "string" ? Date.parse(item.lock_expires_at) : 0;
  if (itemLockExpiresAt && itemLockExpiresAt > now) return false;

  const nextAttemptAt = typeof item.next_attempt_at === "string" ? Date.parse(item.next_attempt_at) : 0;
  return !nextAttemptAt || nextAttemptAt <= now;
}

async function getRecordedOpenAIFailureRefundAmount(
  adminClient: AdminClient,
  taskId: string,
  pricingVersion: string,
  includeLegacy: boolean
): Promise<number> {
  const taskScopedResult = await (adminClient as any)
    .from("credit_transactions")
    .select("amount")
    .eq("task_id", taskId)
    .eq("entry_kind", "refund")
    .eq("pricing_version", pricingVersion);
  if (taskScopedResult.error) {
    console.error(
      "[Image Worker] Failed to read ecom refund transactions:",
      taskScopedResult.error
    );
    return 0;
  }

  const taskScopedAmount = ((taskScopedResult.data || []) as Array<{ amount?: number }>)
    .reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
  if (!includeLegacy) return taskScopedAmount;

  const legacyResult = await adminClient
    .from("credit_transactions")
    .select("amount, description")
    .eq("reference_type", "ecom_image_task")
    .eq("reference_id", taskId)
    .eq("type", "refund");
  if (legacyResult.error) {
    console.error("[Image Worker] Failed to read legacy ecom refunds:", legacyResult.error);
    return taskScopedAmount;
  }

  const legacyAmount = (legacyResult.data || []).reduce((sum, row) => {
    const transaction = row as { amount?: number; description?: string | null };
    if (!transaction.description?.includes("GPT Image 2 失败按比例退款")) {
      return sum;
    }

    return sum + Math.max(0, transaction.amount || 0);
  }, 0);

  return legacyAmount + taskScopedAmount;
}

async function refundEcomTaskCredits(
  adminClient: AdminClient,
  userId: string,
  taskId: string,
  amount: number,
  description: string,
  operation: string,
  pricingVersion: string
): Promise<RefundCreditResult> {
  if (amount <= 0) return { status: "refunded" };

  try {
    await applyTaskCreditDelta({
      supabase: adminClient,
      userId,
      entryKind: "refund",
      amount,
      scope: "ecom-image",
      taskId,
      operation,
      pricingVersion,
      description,
    });
  } catch (error) {
    console.error("[Image Worker] Failed to refund ecom credits:", error);
    return {
      status: "retry",
      error: error instanceof Error ? error.message : "原子退款失败",
    };
  }

  return { status: "refunded" };
}

function getEcomFailureRefundTarget(task: EcomTaskRecord, outputItems: OutputItem[]): {
  shouldRefund: boolean;
  targetRefundAmount: number;
  failedCount: number;
  totalCount: number;
  processingCount: number;
} {
  const processingCount = outputItems.filter(item => item.status === "processing" || item.status === "pending").length;
  const failedCount = outputItems.filter(item => item.status === "failed").length;
  const totalCount = outputItems.length;
  const creditsCost = Number(task.credits_cost || 0);

  if (processingCount > 0 || failedCount <= 0 || totalCount <= 0 || !task.credits_charged || creditsCost <= 0) {
    return { shouldRefund: false, targetRefundAmount: 0, failedCount, totalCount, processingCount };
  }

  const targetRefundAmount = failedCount === totalCount
    ? creditsCost
    : Math.round(creditsCost * failedCount / totalCount);

  return {
    shouldRefund: targetRefundAmount > 0,
    targetRefundAmount,
    failedCount,
    totalCount,
    processingCount,
  };
}

async function markEcomRefundPending(
  adminClient: AdminClient,
  task: EcomTaskRecord,
  refundPlan: ReturnType<typeof getEcomFailureRefundTarget>,
  patch: Record<string, unknown> = {}
): Promise<void> {
  const metadata = getMetadata(task.metadata);
  const retryCount = getRefundRetryCount(metadata);
  const retryDelayMs = getRetryDelayMs(retryCount + 1);

  const { error } = await adminClient
    .from("ecom_image_tasks")
    .update({
      metadata: {
        ...metadata,
        refund_pending: true,
        refund_pending_amount: refundPlan.targetRefundAmount,
        refund_pending_failed_count: refundPlan.failedCount,
        refund_pending_total_count: refundPlan.totalCount,
        refund_retry_count: retryCount + 1,
        refund_next_attempt_at: new Date(Date.now() + retryDelayMs).toISOString(),
        refund_retry_delay_ms: retryDelayMs,
        refund_lock_id: null,
        refund_lock_expires_at: null,
        last_refund_error: "退款或退款流水写入失败，等待 worker 重试",
        ...patch,
      },
    } as any)
    .eq("id", task.id)
    .eq("user_id", task.user_id);

  if (error) {
    console.error("[Image Worker] Failed to mark ecom refund pending:", {
      taskId: task.id,
      error,
    });
  }
}

async function markEcomRefundManualReview(
  adminClient: AdminClient,
  task: EcomTaskRecord,
  refundPlan: ReturnType<typeof getEcomFailureRefundTarget>,
  uncertainAmount: number,
  errorMessage: string
): Promise<void> {
  const metadata = getMetadata(task.metadata);
  const { error } = await adminClient
    .from("ecom_image_tasks")
    .update({
      metadata: buildRefundMetadata(metadata, {
        refund_pending: false,
        refund_pending_amount: 0,
        refund_manual_review_required: true,
        refund_transaction_missing: true,
        refund_balance_maybe_applied: true,
        refund_uncertain_amount: uncertainAmount,
        refund_pending_failed_count: refundPlan.failedCount,
        refund_pending_total_count: refundPlan.totalCount,
        last_refund_error: errorMessage,
        refund_manual_review_at: new Date().toISOString(),
      }),
    } as any)
    .eq("id", task.id)
    .eq("user_id", task.user_id);

  if (error) {
    console.error("[Image Worker] Failed to mark ecom refund manual review:", {
      taskId: task.id,
      error,
    });
  }
}

async function reconcileOpenAIFailureRefund(
  adminClient: AdminClient,
  task: EcomTaskRecord
): Promise<boolean> {
  const outputItems = (task.output_items as unknown as OutputItem[]) || [];
  if (!hasOpenAIOutputItems(task, outputItems)) return false;

  const creditsCost = Number(task.credits_cost || 0);
  if (creditsCost <= 0) return false;

  const refundPlan = getEcomFailureRefundTarget(task, outputItems);
  if (!refundPlan.shouldRefund) {
    if (isRefundPendingMetadata(getMetadata(task.metadata))) {
      const metadata = getMetadata(task.metadata);
      await adminClient
        .from("ecom_image_tasks")
        .update({
          metadata: buildRefundMetadata(metadata, {
            refund_pending: false,
            refund_pending_amount: 0,
          }),
        } as any)
        .eq("id", task.id)
        .eq("user_id", task.user_id);
    }
    return false;
  }

  const metadata = getMetadata(task.metadata);
  const billingAttempt = getEcomBillingAttempt(metadata);
  const pricingVersion = getEcomPricingVersion(task, billingAttempt);
  const alreadyRefundedAmount = Math.max(
    Number(metadata.openai_failed_refund_amount || 0),
    await getRecordedOpenAIFailureRefundAmount(
      adminClient,
      task.id,
      pricingVersion,
      billingAttempt === 1
    )
  );
  const alreadyRefundedFailedCount = Number(metadata.openai_failed_refund_count || 0);

  if (refundPlan.failedCount <= alreadyRefundedFailedCount) {
    await adminClient
      .from("ecom_image_tasks")
      .update({
        metadata: buildRefundMetadata(metadata, {
          refund_pending: false,
          refund_pending_amount: 0,
          refund_completed_at: new Date().toISOString(),
        }),
      } as any)
      .eq("id", task.id)
      .eq("user_id", task.user_id);
    return true;
  }

  const amount = Math.max(0, refundPlan.targetRefundAmount - alreadyRefundedAmount);
  if (amount <= 0) {
    await adminClient
      .from("ecom_image_tasks")
      .update({
        metadata: buildRefundMetadata(metadata, {
          refund_pending: false,
          refund_pending_amount: 0,
          refund_completed_at: new Date().toISOString(),
        }),
      } as any)
      .eq("id", task.id)
      .eq("user_id", task.user_id);
    return true;
  }

  const refundResult = await refundEcomTaskCredits(
    adminClient,
    task.user_id,
    task.id,
    amount,
    `电商图片 GPT Image 2 失败按比例退款 (${refundPlan.failedCount}/${refundPlan.totalCount}, ${task.id})`,
    getEcomRefundOperation(billingAttempt, refundPlan.failedCount, refundPlan.totalCount),
    pricingVersion
  );

  if (refundResult.status === "manual_review") {
    await markEcomRefundManualReview(
      adminClient,
      task,
      refundPlan,
      amount,
      refundResult.error || "退款流水写入失败且余额回滚失败，需人工对账"
    );
    return false;
  }

  if (refundResult.status !== "refunded") {
    await markEcomRefundPending(adminClient, task, refundPlan, {
      last_refund_error: refundResult.error || "退款或退款流水写入失败，等待 worker 重试",
    });
    return false;
  }

  const updateData: Record<string, unknown> = {
    metadata: buildRefundMetadata(metadata, {
      refund_pending: false,
      refund_pending_amount: 0,
      refund_completed_at: new Date().toISOString(),
      openai_failed_refund_count: refundPlan.failedCount,
      openai_failed_refund_amount: alreadyRefundedAmount + amount,
      openai_failure_refunded_at: new Date().toISOString(),
    }),
  };
  if (refundPlan.failedCount === refundPlan.totalCount && amount >= creditsCost) {
    updateData.credits_charged = false;
    updateData.credits_charged_at = null;
  }

  const { error: metadataError } = await adminClient
    .from("ecom_image_tasks")
    .update(updateData as any)
    .eq("id", task.id)
    .eq("user_id", task.user_id);

  if (metadataError) {
    console.warn("[Image Worker] Ecom refund succeeded but metadata update failed:", {
      taskId: task.id,
      metadataError,
    });
  }

  return true;
}

async function processEcomRefundPending(
  adminClient: AdminClient,
  task: EcomTaskRecord
): Promise<"finalized" | "retried" | "skipped"> {
  const metadata = getMetadata(task.metadata);
  if (!isRefundPendingMetadata(metadata)) return "skipped";

  const now = Date.now();
  if (!isRefundDue(metadata, now)) return "skipped";

  const lockId = crypto.randomUUID();
  const lockedMetadata = {
    ...metadata,
    refund_lock_id: lockId,
    refund_lock_expires_at: new Date(Date.now() + OPENAI_IMAGE_LOCK_TTL_MS).toISOString(),
    refund_last_attempt_at: new Date().toISOString(),
  };

  const { data: lockedTask, error: lockError } = await adminClient
    .from("ecom_image_tasks")
    .update({ metadata: lockedMetadata as any })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", task.status)
    .eq("updated_at", task.updated_at || "")
    .select("*")
    .single();

  if (lockError || !lockedTask) {
    console.warn("[Image Worker] Failed to lock ecom refund compensation:", {
      taskId: task.id,
      lockError,
    });
    return "skipped";
  }

  const reconciled = await reconcileOpenAIFailureRefund(adminClient, lockedTask as EcomTaskRecord);
  return reconciled ? "finalized" : "retried";
}

type ProcessedEcomOutputItemResult = {
  index: number;
  item: OpenAIOutputItem;
  outcome: "completed" | "retried" | "failed";
  summary: Record<string, unknown>;
};

async function processLockedEcomOutputItem(
  lockedRecord: EcomTaskRecord,
  lockedItem: OpenAIOutputItem,
  index: number,
  lockedTaskMetadata: Record<string, unknown>
): Promise<ProcessedEcomOutputItemResult> {
  const currentAttempt = lockedItem.current_attempt && typeof lockedItem.current_attempt === "object"
    ? lockedItem.current_attempt as Record<string, unknown>
    : {};
  const attempts = getOpenAIOutputAttempts(lockedItem);
  const attemptNumber = Number(currentAttempt.attemptNumber || attempts.length + 1);
  const attemptStartedAt = typeof currentAttempt.startedAt === "string"
    ? currentAttempt.startedAt
    : new Date().toISOString();
  const startedMs = Date.now();
  const resolution = parseEcomResolution(lockedItem.resolution || lockedRecord.resolution);
  const aspectRatio = typeof lockedItem.aspect_ratio === "string"
    ? lockedItem.aspect_ratio
    : (typeof lockedRecord.ratio === "string" ? lockedRecord.ratio : "auto");
  const itemPlatformTaskId = typeof lockedItem.platform_task_id === "string"
    ? lockedItem.platform_task_id
    : (typeof lockedItem.platformTaskId === "string" ? lockedItem.platformTaskId : null);
  let result = itemPlatformTaskId
    ? await queryVideoPlatformImageTask(itemPlatformTaskId, resolution, aspectRatio)
    : await submitVideoPlatformImage({
      prompt: getOpenAIOutputPrompt(lockedItem),
      sourceImageUrls: getOpenAIOutputSourceImageUrls(lockedItem),
      resolution,
      aspectRatio,
    });
  const finishedAt = new Date().toISOString();
  const itemPlatformSubmittedAt = typeof lockedItem.platform_submitted_at === "string"
    ? lockedItem.platform_submitted_at
    : attemptStartedAt;
  const platformPollExceeded = result.status === "processing" &&
    Date.now() - Date.parse(itemPlatformSubmittedAt) > getVideoPlatformImageMaxPollMs();

  if (platformPollExceeded) {
    result = {
      ...result,
      success: false,
      status: "failed",
      error: `视频平台图片任务轮询超过 ${getVideoPlatformImageMaxPollMs()}ms`,
      upstreamResponseType: "failed",
    };
  }

  const workerRetryable = isRetryableOpenAIImageError(
    result.error,
    result.statusCode,
    result.upstreamStatus,
    result.retryable
  );
  const itemQueueLane = getOpenAIOutputItemQueueLane(lockedItem);
  const itemMaxWaitMs = getOpenAIOutputItemMaxWaitMs(lockedItem, lockedTaskMetadata);
  const itemAgeMs = getRecordAgeMs(lockedItem.queued_at || lockedRecord.updated_at, attemptStartedAt);
  const itemMaxWaitExceeded = itemAgeMs >= itemMaxWaitMs;

  const attemptRecord = {
    attemptNumber,
    startedAt: attemptStartedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    provider: "video_platform_image",
    endpoint: result.endpoint || null,
    upstreamStatus: result.status,
    success: result.success,
    error: result.error || null,
    requestedSize: result.requestedSize,
    upstreamSize: result.upstreamSize,
    upstreamQuality: result.upstreamQuality,
    outputFormat: result.outputFormat,
    outputCompression: result.outputCompression,
    requestTimeoutMs: result.requestTimeoutMs,
    hasUrls: result.hasUrls,
    referenceCount: result.referenceCount,
    referenceCountReceived: result.referenceCountReceived ?? result.referenceCount ?? 0,
    referenceCountUsed: result.referenceCountUsed ?? result.referenceCount ?? 0,
    referenceReductionReason: result.referenceReductionReason || null,
    platformTaskId: result.platformTaskId || itemPlatformTaskId || null,
    upstreamResponseType: result.upstreamResponseType,
    upstreamHttpStatus: result.statusCode || result.upstreamStatus || null,
    retryable: workerRetryable,
    providerRetryable: result.retryable ?? null,
    workerRetryable,
    complexityProfile: getOpenAIOutputItemMetadata(lockedItem).complexityProfile || lockedItem.complexity_profile || "normal",
    queueLane: itemQueueLane,
    maxWaitMs: itemMaxWaitMs,
    itemAgeMs,
    maxWaitExceeded: itemMaxWaitExceeded,
    rawStatus: result.rawStatus || null,
    originalPromptLength: getOpenAIOutputPrompt(lockedItem).length,
    fallbackMode: "none",
    fallbackAttempt: 0,
    upstreamCallCount: result.upstreamCallCount || 0,
  };
  const updatedAttempts = [...attempts, attemptRecord];
  const nextPlatformTaskId = result.platformTaskId || itemPlatformTaskId || null;
  let itemOutcome: "completed" | "retried" | "failed";
  let item: OpenAIOutputItem;

  if (result.success && result.imageUrl) {
    const existingItemMetadata = getOpenAIOutputItemMetadata(lockedItem);
    itemOutcome = "completed";
    item = {
      ...lockedItem,
      status: "completed",
      url: result.imageUrl,
      attempts: updatedAttempts,
      last_attempt: attemptRecord,
      metadata: {
        ...existingItemMetadata,
      },
      provider: "video_platform_image",
      platform_task_id: nextPlatformTaskId,
      lock_id: null,
      lock_expires_at: null,
      current_attempt: null,
      next_attempt_at: null,
      completed_at: finishedAt,
      error: undefined,
    };
  } else if (result.status === "processing" && nextPlatformTaskId && !itemMaxWaitExceeded) {
    itemOutcome = "retried";
    item = {
      ...lockedItem,
      status: "processing",
      attempts: updatedAttempts,
      last_attempt: attemptRecord,
      provider: "video_platform_image",
      platform_task_id: nextPlatformTaskId,
      platform_submitted_at: lockedItem.platform_submitted_at || itemPlatformSubmittedAt,
      lock_id: null,
      lock_expires_at: null,
      current_attempt: null,
      next_attempt_at: new Date(Date.now() + getRetryDelayMs(attemptNumber)).toISOString(),
      error: undefined,
    };
  } else {
    const retryable = workerRetryable;
    const maxAttempts = getOpenAIOutputMaxAttempts(lockedItem, lockedTaskMetadata);
    const failureAttemptCount = getFailureAttemptCount(updatedAttempts);
    const shouldRetry = retryable && failureAttemptCount < maxAttempts && !itemMaxWaitExceeded;
    itemOutcome = shouldRetry ? "retried" : "failed";
    item = {
      ...lockedItem,
      status: shouldRetry ? "processing" : "failed",
      attempts: updatedAttempts,
      last_attempt: attemptRecord,
      provider: "video_platform_image",
      platform_task_id: platformPollExceeded ? null : nextPlatformTaskId,
      platform_submitted_at: platformPollExceeded ? null : lockedItem.platform_submitted_at,
      lock_id: null,
      lock_expires_at: null,
      current_attempt: null,
      next_attempt_at: shouldRetry ? new Date(Date.now() + getRetryDelayMs(attemptNumber)).toISOString() : null,
      failed_at: shouldRetry ? null : finishedAt,
      error: itemMaxWaitExceeded ? `图片生成超过最大等待时间 ${itemMaxWaitMs}ms` : result.error || "图片生成失败",
    };
  }

  return {
    index,
    item,
    outcome: itemOutcome,
    summary: {
      index,
      type: lockedItem.type,
      attemptNumber,
      success: result.success,
      outcome: itemOutcome,
      finishedAt,
    },
  };
}

function buildEcomOutputItemExceptionResult(
  lockedRecord: EcomTaskRecord,
  lockedTaskMetadata: Record<string, unknown>,
  lockedItem: OpenAIOutputItem,
  index: number,
  error: unknown
): ProcessedEcomOutputItemResult {
  const currentAttempt = lockedItem.current_attempt && typeof lockedItem.current_attempt === "object"
    ? lockedItem.current_attempt as Record<string, unknown>
    : {};
  const attempts = getOpenAIOutputAttempts(lockedItem);
  const attemptNumber = Number(currentAttempt.attemptNumber || attempts.length + 1);
  const attemptStartedAt = typeof currentAttempt.startedAt === "string"
    ? currentAttempt.startedAt
    : new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : "图片生成失败";
  const itemMaxWaitMs = getOpenAIOutputItemMaxWaitMs(lockedItem, lockedTaskMetadata);
  const itemAgeMs = getRecordAgeMs(lockedItem.queued_at || lockedRecord.updated_at, attemptStartedAt);
  const itemMaxWaitExceeded = itemAgeMs >= itemMaxWaitMs;
  const attemptRecord = {
    attemptNumber,
    startedAt: attemptStartedAt,
    finishedAt,
    durationMs: 0,
    provider: "video_platform_image",
    upstreamStatus: "failed",
    success: false,
    error: errorMessage,
    upstreamResponseType: "failed",
    retryable: true,
    providerRetryable: null,
    workerRetryable: !itemMaxWaitExceeded,
    complexityProfile: getOpenAIOutputItemMetadata(lockedItem).complexityProfile || lockedItem.complexity_profile || "normal",
    queueLane: getOpenAIOutputItemQueueLane(lockedItem),
    maxWaitMs: itemMaxWaitMs,
    itemAgeMs,
    maxWaitExceeded: itemMaxWaitExceeded,
    fallbackMode: "none",
    fallbackAttempt: 0,
    upstreamCallCount: 0,
  };
  const updatedAttempts = [...attempts, attemptRecord];
  const maxAttempts = getOpenAIOutputMaxAttempts(lockedItem, lockedTaskMetadata);
  const shouldRetry = getFailureAttemptCount(updatedAttempts) < maxAttempts && !itemMaxWaitExceeded;
  const item: OpenAIOutputItem = {
    ...lockedItem,
    status: shouldRetry ? "processing" : "failed",
    attempts: updatedAttempts,
    last_attempt: attemptRecord,
    provider: "video_platform_image",
    lock_id: null,
    lock_expires_at: null,
    current_attempt: null,
    next_attempt_at: shouldRetry ? new Date(Date.now() + getRetryDelayMs(attemptNumber)).toISOString() : null,
    failed_at: shouldRetry ? null : finishedAt,
    error: itemMaxWaitExceeded ? `图片生成超过最大等待时间 ${itemMaxWaitMs}ms` : errorMessage,
  };

  return {
    index,
    item,
    outcome: shouldRetry ? "retried" : "failed",
    summary: {
      index,
      type: lockedItem.type,
      attemptNumber,
      success: false,
      outcome: shouldRetry ? "retried" : "failed",
      finishedAt,
      error: errorMessage,
      taskId: lockedRecord.id,
    },
  };
}

async function processEcomTaskItem(
  adminClient: AdminClient,
  task: EcomTaskRecord
): Promise<"completed" | "retried" | "failed" | "finalized" | "skipped"> {
  const outputItems = ((task.output_items as unknown as OpenAIOutputItem[]) || []).map(item => ({ ...item }));
  if (!hasOpenAIOutputItems(task, outputItems)) return "skipped";

  const metadata = getMetadata(task.metadata);
  const now = Date.now();

  if (isRefundPendingMetadata(metadata)) {
    return processEcomRefundPending(adminClient, task);
  }

  if (isLockActive(getOpenAIItemLock(metadata), now)) {
    return "skipped";
  }

  const dueCandidates = outputItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isOpenAIOutputItemDue(task, item, now));
  const standardDueEntries = dueCandidates
    .filter(({ item }) => getOpenAIOutputItemQueueLane(item) !== "slow")
    .slice(0, MAX_ECOM_OUTPUT_ITEM_CONCURRENCY);
  const slowDueEntries = dueCandidates
    .filter(({ item }) => getOpenAIOutputItemQueueLane(item) === "slow")
    .slice(0, Math.max(0, MAX_ECOM_OUTPUT_ITEM_CONCURRENCY - standardDueEntries.length))
    .slice(0, MAX_ECOM_SLOW_OUTPUT_ITEM_CONCURRENCY);
  const dueEntries = [...standardDueEntries, ...slowDueEntries];

  if (dueEntries.length === 0) {
    const statusInfo = getOpenAIOutputStatus(outputItems);
    if (statusInfo.status === "generating_images") return "skipped";
    const refundPlan = getEcomFailureRefundTarget(task, outputItems);

    const { data: updatedTask } = await adminClient
      .from("ecom_image_tasks")
      .update({
        status: statusInfo.status,
        completed_at: new Date().toISOString(),
        error_message: statusInfo.errorMessage,
        metadata: {
          ...metadata,
          ...(refundPlan.shouldRefund
            ? {
              refund_pending: true,
              refund_pending_amount: refundPlan.targetRefundAmount,
              refund_pending_failed_count: refundPlan.failedCount,
              refund_pending_total_count: refundPlan.totalCount,
              refund_next_attempt_at: new Date().toISOString(),
              refund_lock_id: null,
              refund_lock_expires_at: null,
            }
            : {}),
        } as any,
      })
      .eq("id", task.id)
      .eq("user_id", task.user_id)
      .eq("status", "generating_images")
      .select("*")
      .single();

    if (updatedTask) {
      await reconcileOpenAIFailureRefund(adminClient, updatedTask as EcomTaskRecord);
      return "finalized";
    }
    return "skipped";
  }

  const batchLockId = crypto.randomUUID();
  const batchStartedAt = new Date().toISOString();
  const lockExpiresAt = new Date(now + OPENAI_IMAGE_LOCK_TTL_MS).toISOString();
  const itemLocks = dueEntries.map(({ item, index }) => {
    const lockId = crypto.randomUUID();
    const attemptNumber = getOpenAIOutputAttempts(item).length + 1;
    outputItems[index] = {
      ...item,
      status: "pending",
      lock_id: lockId,
      lock_expires_at: lockExpiresAt,
      current_attempt: {
        lockId,
        batchLockId,
        attemptNumber,
        startedAt: batchStartedAt,
      },
    };

    return {
      index,
      lockId,
      itemType: item.type,
      attemptNumber,
    };
  });

  const lockedMetadata = {
    ...metadata,
    openaiItemLock: {
      lockId: batchLockId,
      itemIndexes: itemLocks.map(itemLock => itemLock.index),
      itemTypes: itemLocks.map(itemLock => itemLock.itemType),
      attemptNumbers: itemLocks.map(itemLock => itemLock.attemptNumber),
      items: itemLocks,
      concurrency: itemLocks.length,
      startedAt: batchStartedAt,
      expiresAt: lockExpiresAt,
    },
  };

  const { data: lockedTask, error: lockError } = await adminClient
    .from("ecom_image_tasks")
    .update({ output_items: outputItems as any, metadata: lockedMetadata as any })
    .eq("id", task.id)
    .eq("user_id", task.user_id)
    .eq("status", "generating_images")
    .eq("updated_at", task.updated_at || "")
    .select("*")
    .single();

  if (lockError || !lockedTask) return "skipped";

  const lockedRecord = lockedTask as EcomTaskRecord;
  const lockedOutputItems = ((lockedRecord.output_items as unknown as OpenAIOutputItem[]) || []).map(lockedItem => ({ ...lockedItem }));
  const lockedTaskMetadata = getMetadata(lockedRecord.metadata);
  const itemResults = await runWithConcurrency(
    itemLocks,
    itemLocks.length,
    async itemLock => {
      const lockedItem = lockedOutputItems[itemLock.index] || outputItems[itemLock.index];
      return processLockedEcomOutputItem(lockedRecord, lockedItem, itemLock.index, lockedTaskMetadata);
    }
  );
  const processedItems: ProcessedEcomOutputItemResult[] = itemResults.map((result, resultIndex) => {
    const itemLock = itemLocks[resultIndex];
    const lockedItem = lockedOutputItems[itemLock.index] || outputItems[itemLock.index];
    return result.status === "fulfilled"
      ? result.value
      : buildEcomOutputItemExceptionResult(
        lockedRecord,
        lockedTaskMetadata,
        lockedItem,
        itemLock.index,
        result.reason
      );
  });

  for (const processedItem of processedItems) {
    lockedOutputItems[processedItem.index] = processedItem.item;
  }

  const statusInfo = getOpenAIOutputStatus(lockedOutputItems);
  const batchFinishedAt = new Date().toISOString();
  const nextMetadata = {
    ...lockedTaskMetadata,
    provider: "video_platform_image",
    openaiItemLock: null,
    lastAdvancedItems: processedItems.map(processedItem => processedItem.summary),
    lastAdvancedItem: {
      ...processedItems[processedItems.length - 1]?.summary,
    },
  };
  const refundPlan = getEcomFailureRefundTarget(lockedRecord, lockedOutputItems);
  const updateData: Record<string, unknown> = {
    output_items: lockedOutputItems,
    status: statusInfo.status,
    error_message: statusInfo.errorMessage,
    metadata: {
      ...nextMetadata,
      ...(statusInfo.status !== "generating_images" && refundPlan.shouldRefund
        ? {
          refund_pending: true,
          refund_pending_amount: refundPlan.targetRefundAmount,
          refund_pending_failed_count: refundPlan.failedCount,
          refund_pending_total_count: refundPlan.totalCount,
          refund_next_attempt_at: new Date().toISOString(),
          refund_lock_id: null,
          refund_lock_expires_at: null,
        }
        : {}),
    },
  };

  if (statusInfo.status !== "generating_images") {
    updateData.completed_at = batchFinishedAt;
  }

  const { data: updatedTask, error: updateError } = await adminClient
    .from("ecom_image_tasks")
    .update(updateData as any)
    .eq("id", lockedRecord.id)
    .eq("user_id", lockedRecord.user_id)
    .eq("status", "generating_images")
    .select("*")
    .single();

  if (updateError || !updatedTask) {
    console.warn("[Image Worker] Failed to update ecom output item:", {
      taskId: lockedRecord.id,
      updateError,
    });
    return "skipped";
  }

  if (statusInfo.status !== "generating_images") {
    await reconcileOpenAIFailureRefund(adminClient, updatedTask as EcomTaskRecord);
  }

  if (processedItems.some(item => item.outcome === "failed")) return "failed";
  if (processedItems.some(item => item.outcome === "completed")) return "completed";
  if (processedItems.some(item => item.outcome === "retried")) return "retried";
  return "skipped";
}

export async function processImageGenerationQueue(
  options: ProcessImageGenerationQueueOptions = {}
): Promise<ProcessImageGenerationQueueResult> {
  const startedAt = new Date();
  const startedMs = startedAt.getTime();
  const maxRuntimeMs = Math.max(1, normalizeNonNegativeInteger(options.maxRuntimeMs, DEFAULT_MAX_RUNTIME_MS));
  const maxGenerationItems = normalizeNonNegativeInteger(options.maxGenerationItems, DEFAULT_MAX_GENERATION_ITEMS);
  const maxSlowGenerationItems = maxGenerationItems > 0 ? DEFAULT_MAX_SLOW_GENERATION_ITEMS : 0;
  const maxEcomItems = normalizeNonNegativeInteger(options.maxEcomItems, DEFAULT_MAX_ECOM_ITEMS);
  const counters = createCounters();
  const adminClient = createAdminClient();

  const { data: activeGenerationRows, error: generationError } = await adminClient
    .from("generations")
    .select("*")
    .in("status", ["processing", "pending"])
    .eq("type", "image")
    .order("created_at", { ascending: true })
      .limit(Math.max((maxGenerationItems + maxSlowGenerationItems) * 10, maxGenerationItems + maxSlowGenerationItems));
  const { data: refundPendingGenerationRows, error: generationRefundScanError } = maxGenerationItems > 0
    ? await adminClient
      .from("generations")
      .select("*")
      .eq("status", "failed")
      .eq("type", "image")
      .eq("metadata->>refund_pending", "true")
      .order("created_at", { ascending: true })
      .limit(Math.max((maxGenerationItems + maxSlowGenerationItems) * 10, maxGenerationItems + maxSlowGenerationItems))
    : { data: [], error: null };

  if (generationError) {
    counters.errors.push({ scope: "generations.scan", message: generationError.message });
  } else if (generationRefundScanError) {
    counters.errors.push({ scope: "generations.refund_scan", message: generationRefundScanError.message });
  } else {
    const now = Date.now();
    const generationById = new Map<string, GenerationRecord>();
    for (const record of [
      ...((activeGenerationRows || []) as GenerationRecord[]),
      ...((refundPendingGenerationRows || []) as GenerationRecord[]),
    ]) {
      generationById.set(record.id, record);
    }
    const dueGenerationCandidates = Array.from(generationById.values())
      .filter(record => isOpenAIImageGenerationRecord(record) && isGenerationDue(record, now));
    const standardDueGenerations = dueGenerationCandidates
      .filter(record => getQueueLaneFromMetadata(getMetadata(record.metadata)) !== "slow")
      .slice(0, maxGenerationItems);
    const slowDueGenerations = dueGenerationCandidates
      .filter(record => getQueueLaneFromMetadata(getMetadata(record.metadata)) === "slow")
      .slice(0, maxSlowGenerationItems);
    const dueGenerations = [...standardDueGenerations, ...slowDueGenerations];
    counters.scannedGenerations = dueGenerations.length;

    const processGenerationLane = (generations: GenerationRecord[], concurrency: number) => runWithConcurrency(
      generations,
      concurrency,
      async generation => {
        if (shouldStop(startedMs, maxRuntimeMs)) return "skipped" as const;
        return processGeneration(adminClient, generation);
      }
    );
    const [standardGenerationResults, slowGenerationResults] = await Promise.all([
      processGenerationLane(
        standardDueGenerations,
        Math.min(MAX_STANDARD_GENERATION_WORKER_CONCURRENCY, Math.max(1, maxGenerationItems))
      ),
      processGenerationLane(
        slowDueGenerations,
        Math.min(MAX_SLOW_GENERATION_WORKER_CONCURRENCY, Math.max(1, maxSlowGenerationItems))
      ),
    ]);
    const generationResults = [...standardGenerationResults, ...slowGenerationResults];

    for (let index = 0; index < generationResults.length; index += 1) {
      const result = generationResults[index];
      const generation = dueGenerations[index];
      try {
        if (result.status === "rejected") {
          throw result.reason;
        }
        const outcome = result.value;
        if (outcome === "completed") counters.completedGenerations += 1;
        if (outcome === "retried") counters.retriedGenerations += 1;
        if (outcome === "failed") counters.failedGenerations += 1;
        if (outcome === "skipped") counters.skippedGenerations += 1;
        if (outcome !== "skipped") counters.processedGenerations += 1;
      } catch (error) {
        counters.errors.push({
          scope: "generations.process",
          id: generation.task_id || generation.id,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  if (maxEcomItems > 0 && isImageFactoryEnabled()) {
    const { data: activeEcomRows, error: ecomError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("status", "generating_images")
      .order("updated_at", { ascending: true })
      .limit(Math.max(maxEcomItems * 5, maxEcomItems));
    const { data: refundPendingEcomRows, error: ecomRefundScanError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .in("status", ["failed", "partial_success"])
      .eq("metadata->>refund_pending", "true")
      .order("updated_at", { ascending: true })
      .limit(Math.max(maxEcomItems * 5, maxEcomItems));

    if (ecomError) {
      counters.errors.push({ scope: "ecom.scan", message: ecomError.message });
    } else if (ecomRefundScanError) {
      counters.errors.push({ scope: "ecom.refund_scan", message: ecomRefundScanError.message });
    } else {
    const now = Date.now();
    const ecomById = new Map<string, EcomTaskRecord>();
    for (const task of [
      ...((activeEcomRows || []) as EcomTaskRecord[]),
      ...((refundPendingEcomRows || []) as EcomTaskRecord[]),
    ]) {
      ecomById.set(task.id, task);
    }
    const dueEcomTasks = Array.from(ecomById.values())
      .filter(task => {
        const metadata = getMetadata(task.metadata);
        if (isRefundPendingMetadata(metadata)) return isRefundDue(metadata, now);
        const outputItems = (task.output_items as unknown as OpenAIOutputItem[]) || [];
        if (!hasOpenAIOutputItems(task, outputItems)) return false;
        if (isLockActive(getOpenAIItemLock(getMetadata(task.metadata)), now)) return false;
        return outputItems.some(item => isOpenAIOutputItemDue(task, item, now))
          || getOpenAIOutputStatus(outputItems).status !== "generating_images";
      })
      .slice(0, maxEcomItems);
    counters.scannedEcomTasks = dueEcomTasks.length;

    const ecomResults = await runWithConcurrency(
      dueEcomTasks,
      Math.max(1, maxEcomItems),
      async task => {
        if (shouldStop(startedMs, maxRuntimeMs)) return "skipped" as const;
        return processEcomTaskItem(adminClient, task);
      }
    );

    for (let index = 0; index < ecomResults.length; index += 1) {
      const result = ecomResults[index];
      const task = dueEcomTasks[index];
      try {
        if (result.status === "rejected") {
          throw result.reason;
        }
        const outcome = result.value;
        if (outcome === "completed") counters.completedEcomItems += 1;
        if (outcome === "retried") counters.retriedEcomItems += 1;
        if (outcome === "failed") counters.failedEcomItems += 1;
        if (outcome === "finalized") counters.finalizedEcomTasks += 1;
        if (outcome === "completed" || outcome === "retried" || outcome === "failed") {
          counters.processedEcomItems += 1;
        }
      } catch (error) {
        counters.errors.push({
          scope: "ecom.process",
          id: task.id,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    }
  }

  const finishedAt = new Date();
  return {
    ...counters,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    runtimeMs: finishedAt.getTime() - startedMs,
    stoppedByRuntime: shouldStop(startedMs, maxRuntimeMs),
  };
}
