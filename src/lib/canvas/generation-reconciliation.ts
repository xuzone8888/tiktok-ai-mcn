import { randomUUID } from "node:crypto";

import {
  getFileMetadataStrict,
  getPublicUrl,
} from "../oss";
import {
  queryVideoPlatformImageTask,
  type VideoPlatformImageResult,
} from "../video-platform-image-api";
import { getRegisteredVideoModel } from "../video-models/registry";
import { transferVideoToOss } from "../video-models/storage";
import type {
  VideoModelStatusResult,
} from "../video-models/types";
import {
  CanvasGenerationIntentV1Schema,
  type CanvasGenerationIntentV1,
} from "./generation-intent";
import {
  createCanvasGenerationAdminClient,
  fetchGenerationInternal,
  mediaIdentityMetadata,
  syncLegacyGenerationMediaColumns,
  verifyCanvasMediaObject,
  type CanvasGenerationInternalRow,
} from "./generation-service";

interface GenericClaim {
  generation_id: string;
  user_id: string;
  kind: "image" | "video";
  status: "pending" | "processing";
  provider_submission_state: string;
  task_id: string | null;
  model: string | null;
  reconcile_profile_version: string;
  reconcile_interval_ms: number;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: string;
  attempt_count: number;
}

interface DirectImageClaim {
  generation_id: string;
  user_id: string;
  action_id: string;
  status: "pending";
  provider_submission_state: "submitting" | "unknown";
  planned_output_oss_key: string;
  reconcile_interval_ms: number;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: string;
  attempt_count: number;
}

export type ProviderPollDisposition =
  | "processing"
  | "completed"
  | "terminal_failure"
  | "retry";

const RECONCILIATION_LEASE_SECONDS = 300;
const MAX_RECONCILIATION_CLAIMS_PER_RUN = 10;
const PROVIDER_STATUS_DEADLINE_MS = 90_000;
const MEDIA_PERSIST_DEADLINE_MS = 180_000;

async function withinDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withinAbortableDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`${label} timed out after ${timeoutMs}ms`)
      ),
    timeoutMs
  );
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function classifyProviderPollResult(input: {
  status: "processing" | "completed" | "failed";
  errorMessage?: string;
  statusCode?: number;
  retryable?: boolean;
}): ProviderPollDisposition {
  if (input.status === "processing") return "processing";
  if (input.status === "completed") return "completed";
  const message = input.errorMessage ?? "";
  const parsedStatus =
    input.statusCode ??
    Number(
      message.match(/\b(?:HTTP|API Error|Query Error)\s*([1-5]\d\d)\b/i)?.[1] ??
        Number.NaN
    );
  if (
    input.retryable === true ||
    (Number.isFinite(parsedStatus) &&
      (parsedStatus >= 500 ||
        parsedStatus === 408 ||
        parsedStatus === 409 ||
        parsedStatus === 425 ||
        parsedStatus === 429)) ||
    /(fetch failed|network|timeout|timed out|aborted|socket|econn|etimedout|enotfound|eai_again|temporarily unavailable)/i.test(
      message
    )
  ) {
    return "retry";
  }
  return "terminal_failure";
}

function rpcRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is T => !!row && typeof row === "object"
  ) as T[];
}

function utcAuthorityTimestamp(value: string): string {
  if (value.endsWith("Z")) return value;
  if (value.endsWith("+00:00")) return `${value.slice(0, -6)}Z`;
  if (value.endsWith("+0000")) return `${value.slice(0, -5)}Z`;
  return new Date(value).toISOString();
}

function leaseAuthority(claim: {
  lease_owner: string;
  lease_token: string;
  lease_expires_at: string;
}) {
  return {
    kind: "reconciliation_lease",
    owner: claim.lease_owner,
    leaseToken: claim.lease_token,
    leaseExpiresAt: utcAuthorityTimestamp(claim.lease_expires_at),
  } as const;
}

async function safeReleaseGeneric(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: GenericClaim
): Promise<void> {
  const { error } = await db.rpc(
    "release_canvas_generation_reconciliation_v1",
    {
      p_generation_id: claim.generation_id,
      p_authority: leaseAuthority(claim),
    }
  );
  if (error) {
    console.warn("[Canvas reconcile] generic release skipped", {
      generationId: claim.generation_id,
      code: error.code,
    });
  }
}

async function safeReleaseDirectImage(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: DirectImageClaim,
  errorCode: string,
  manualAudit = false
): Promise<void> {
  const { error } = await db.rpc(
    "release_canvas_gpt_image_direct_media_recovery_v1",
    {
      p_generation_id: claim.generation_id,
      p_authority: leaseAuthority(claim),
      p_manual_audit: manualAudit,
      p_error_code: errorCode,
    }
  );
  if (error) {
    console.warn("[Canvas reconcile] direct-image release skipped", {
      generationId: claim.generation_id,
      code: error.code,
    });
  }
}

async function completeLeasedMedia(input: {
  db: ReturnType<typeof createCanvasGenerationAdminClient>;
  claim: GenericClaim | DirectImageClaim;
  row: CanvasGenerationInternalRow;
  kind: "image" | "video";
}): Promise<boolean> {
  const objectKey = input.row.planned_output_oss_key;
  if (!objectKey) return false;
  const verified = await verifyCanvasMediaObject({
    objectKey,
    generationId: input.row.id,
    userId: input.row.user_id,
    actionId: input.row.action_id,
    kind: input.kind,
  });
  if (!verified) return false;

  const identity = mediaIdentityMetadata({
    generationId: input.row.id,
    userId: input.row.user_id,
    actionId: input.row.action_id,
  });
  const { error } = await input.db.rpc(
    "complete_canvas_generation_v1",
    {
      p_user_id: input.row.user_id,
      p_generation_id: input.row.id,
      p_authority: leaseAuthority(input.claim),
      p_output_text: null,
      p_output_oss_key: objectKey,
      p_media_metadata: identity.rpc,
    }
  );
  if (error) {
    console.warn("[Canvas reconcile] completion did not commit", {
      generationId: input.row.id,
      code: error.code,
    });
    return false;
  }
  await syncLegacyGenerationMediaColumns({
    db: input.db,
    generationId: input.row.id,
    kind: input.kind,
    objectKey,
  });
  return true;
}

function parsePersistedIntent(
  row: CanvasGenerationInternalRow
): CanvasGenerationIntentV1 | null {
  const parsed = CanvasGenerationIntentV1Schema.safeParse(row.spec);
  return parsed.success ? parsed.data : null;
}

async function updateProgressBestEffort(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  row: CanvasGenerationInternalRow,
  progress: number | undefined
): Promise<void> {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return;
  await db
    .from("generations")
    .update({ progress: Math.max(0, Math.min(99, Math.round(progress))) })
    .eq("id", row.id)
    .eq("status", "processing");
}

async function failBoundTask(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: GenericClaim,
  row: CanvasGenerationInternalRow,
  errorCode: string
): Promise<boolean> {
  const { error } = await db.rpc("fail_canvas_generation_v1", {
    p_user_id: row.user_id,
    p_generation_id: row.id,
    p_authority: leaseAuthority(claim),
    p_error_code: errorCode,
  });
  if (error) {
    console.warn("[Canvas reconcile] terminal failure did not commit", {
      generationId: row.id,
      code: error.code,
    });
    return false;
  }
  return true;
}

function imagePollDisposition(
  result: VideoPlatformImageResult
): ProviderPollDisposition {
  if (result.status === "processing") return "processing";
  if (result.status === "completed" && result.success) return "completed";
  // An HTTP error while polling is not provider-terminal. Explicit task-state
  // failures have rawStatus and no HTTP statusCode.
  if (result.statusCode !== undefined || result.upstreamStatus !== undefined) {
    return "retry";
  }
  if (result.rawStatus) {
    return "terminal_failure";
  }
  return classifyProviderPollResult({
    status: "failed",
    errorMessage: result.error,
    retryable: result.retryable,
  });
}

async function reconcileBoundImage(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: GenericClaim,
  row: CanvasGenerationInternalRow,
  intent: Extract<CanvasGenerationIntentV1, { kind: "image" }>
): Promise<"completed" | "failed" | "released"> {
  if (!claim.task_id || !row.planned_output_oss_key) {
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  // A previous worker can finish the deterministic OSS write but lose its
  // completion RPC response or hit its local deadline. Recover that object
  // before touching the provider again.
  try {
    if (
      await completeLeasedMedia({
        db,
        claim,
        row,
        kind: "image",
      })
    ) {
      return "completed";
    }
  } catch {
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  const identity = mediaIdentityMetadata({
    generationId: row.id,
    userId: row.user_id,
    actionId: row.action_id,
  });
  let status: VideoPlatformImageResult;
  try {
    status = await withinDeadline(
      queryVideoPlatformImageTask(
        claim.task_id,
        intent.config.resolution,
        intent.config.aspectRatio,
        {
          outputObjectKey: row.planned_output_oss_key,
          outputMetadata: identity.oss,
          requestTimeoutMs: PROVIDER_STATUS_DEADLINE_MS,
        }
      ),
      MEDIA_PERSIST_DEADLINE_MS,
      "image provider status and media persistence"
    );
  } catch {
    await safeReleaseGeneric(db, claim);
    return "released";
  }

  const disposition = imagePollDisposition(status);
  if (disposition === "processing" || disposition === "retry") {
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  if (disposition === "terminal_failure") {
    return (await failBoundTask(
      db,
      claim,
      row,
      "image_provider_terminal_failure"
    ))
      ? "failed"
      : "released";
  }

  return (await completeLeasedMedia({
    db,
    claim,
    row,
    kind: "image",
  }))
    ? "completed"
    : (await safeReleaseGeneric(db, claim), "released");
}

async function persistCompletedVideo(input: {
  db: ReturnType<typeof createCanvasGenerationAdminClient>;
  claim: GenericClaim;
  row: CanvasGenerationInternalRow;
  intent: Extract<CanvasGenerationIntentV1, { kind: "video" }>;
  status: VideoModelStatusResult;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (!input.row.planned_output_oss_key || !input.claim.task_id) return false;
  const registered = getRegisteredVideoModel(input.intent.config.model);
  const identity = mediaIdentityMetadata({
    generationId: input.row.id,
    userId: input.row.user_id,
    actionId: input.row.action_id,
  });

  if (registered.adapter.complete) {
    await registered.adapter.complete({
      modelType: input.intent.config.model,
      taskId: input.claim.task_id,
      status: input.status,
      userId: input.row.user_id,
      generationUserId: input.row.user_id,
      aspectRatio: input.intent.config.aspectRatio,
      durationSeconds: input.intent.config.durationSeconds,
      quality: input.intent.config.quality,
      targetObjectKey: input.row.planned_output_oss_key,
      outputMetadata: identity.oss,
      signal: input.signal,
    });
  } else {
    const sourceUrl = input.status.videoUrl ?? input.status.contentUrl;
    if (!sourceUrl) return false;
    await transferVideoToOss({
      taskId: input.claim.task_id,
      modelType: input.intent.config.model,
      videoUrl: sourceUrl,
      userId: input.row.user_id,
      headers: input.status.videoUrl
        ? undefined
        : input.status.contentHeaders,
      targetObjectKey: input.row.planned_output_oss_key,
      outputMetadata: identity.oss,
      signal: input.signal,
    });
  }

  return completeLeasedMedia({
    db: input.db,
    claim: input.claim,
    row: input.row,
    kind: "video",
  });
}

async function reconcileBoundVideo(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: GenericClaim,
  row: CanvasGenerationInternalRow,
  intent: Extract<CanvasGenerationIntentV1, { kind: "video" }>
): Promise<"completed" | "failed" | "released"> {
  if (!claim.task_id) {
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  if (row.planned_output_oss_key) {
    try {
      if (
        await completeLeasedMedia({
          db,
          claim,
          row,
          kind: "video",
        })
      ) {
        return "completed";
      }
    } catch {
      await safeReleaseGeneric(db, claim);
      return "released";
    }
  }
  const registered = getRegisteredVideoModel(intent.config.model);
  let status: VideoModelStatusResult;
  try {
    status = await withinDeadline(
      registered.adapter.status({
        modelType: intent.config.model,
        taskId: claim.task_id,
        userId: row.user_id,
        aspectRatio: intent.config.aspectRatio,
        durationSeconds: intent.config.durationSeconds,
        quality: intent.config.quality,
      }),
      PROVIDER_STATUS_DEADLINE_MS,
      "video provider status"
    );
  } catch {
    await safeReleaseGeneric(db, claim);
    return "released";
  }

  const disposition = classifyProviderPollResult({
    status: status.status,
    errorMessage: status.errorMessage,
  });
  if (disposition === "processing" || disposition === "retry") {
    await updateProgressBestEffort(db, row, status.progress);
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  if (disposition === "terminal_failure") {
    return (await failBoundTask(
      db,
      claim,
      row,
      "video_provider_terminal_failure"
    ))
      ? "failed"
      : "released";
  }

  try {
    return (await withinAbortableDeadline(
      (signal) =>
        persistCompletedVideo({
          db,
          claim,
          row,
          intent,
          status,
          signal,
        }),
      MEDIA_PERSIST_DEADLINE_MS,
      "video media persistence"
    ))
      ? "completed"
      : (await safeReleaseGeneric(db, claim), "released");
  } catch {
    // Provider success is durable; a transfer/OSS problem is retryable and may
    // never turn into a refund.
    await safeReleaseGeneric(db, claim);
    return "released";
  }
}

async function reconcileGenericClaim(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: GenericClaim
): Promise<"completed" | "failed" | "released" | "unknown"> {
  const row = await fetchGenerationInternal(
    db,
    claim.generation_id,
    claim.user_id
  );

  // The generic lane also owns stale unbound video submitters. It must only
  // mark their outcome unknown, never submit again and never refund.
  if (
    claim.status === "pending" &&
    claim.provider_submission_state === "submitting" &&
    !claim.task_id
  ) {
    const { error } = await db.rpc(
      "mark_canvas_generation_unknown_v1",
      {
        p_user_id: claim.user_id,
        p_generation_id: claim.generation_id,
        p_authority: leaseAuthority(claim),
        p_error_code: "stale_video_submission_unknown",
      }
    );
    if (error) {
      await safeReleaseGeneric(db, claim);
      return "released";
    }
    return "unknown";
  }

  const intent = parsePersistedIntent(row);
  if (!intent || intent.kind !== claim.kind) {
    await safeReleaseGeneric(db, claim);
    return "released";
  }
  if (intent.kind === "image") {
    return reconcileBoundImage(db, claim, row, intent);
  }
  if (intent.kind === "video") {
    return reconcileBoundVideo(db, claim, row, intent);
  }
  await safeReleaseGeneric(db, claim);
  return "released";
}

async function reconcileDirectImageClaim(
  db: ReturnType<typeof createCanvasGenerationAdminClient>,
  claim: DirectImageClaim
): Promise<"completed" | "released"> {
  try {
    const metadata = await getFileMetadataStrict(
      claim.planned_output_oss_key
    );
    if (metadata) {
      const row = await fetchGenerationInternal(
        db,
        claim.generation_id,
        claim.user_id
      );
      if (
        await completeLeasedMedia({
          db,
          claim,
          row,
          kind: "image",
        })
      ) {
        return "completed";
      }
    }
    await safeReleaseDirectImage(
      db,
      claim,
      metadata
        ? "direct_image_object_identity_mismatch"
        : "direct_image_object_not_found",
      claim.attempt_count >= 20
    );
    return "released";
  } catch {
    await safeReleaseDirectImage(
      db,
      claim,
      "direct_image_object_head_unavailable"
    );
    return "released";
  }
}

export interface CanvasReconciliationResult {
  workerId: string;
  claimed: number;
  completed: number;
  failed: number;
  markedUnknown: number;
  released: number;
  sweptText: number;
  sweptNotStarted: number;
  errors: number;
}

export async function reconcileCanvasGenerations(options: {
  limit?: number;
  leaseSeconds?: number;
  timeBudgetMs?: number;
} = {}): Promise<CanvasReconciliationResult> {
  const db = createCanvasGenerationAdminClient();
  const workerId = randomUUID();
  // Claims share a lease start time. Do not claim a large queue that would sit
  // idle until its lease expires; process a bounded batch concurrently.
  const limit = Math.max(
    1,
    Math.min(
      MAX_RECONCILIATION_CLAIMS_PER_RUN,
      options.limit ?? MAX_RECONCILIATION_CLAIMS_PER_RUN
    )
  );
  const leaseSeconds = Math.max(
    240,
    Math.min(
      RECONCILIATION_LEASE_SECONDS,
      options.leaseSeconds ?? RECONCILIATION_LEASE_SECONDS
    )
  );
  const startedAt = Date.now();
  const result: CanvasReconciliationResult = {
    workerId,
    claimed: 0,
    completed: 0,
    failed: 0,
    markedUnknown: 0,
    released: 0,
    sweptText: 0,
    sweptNotStarted: 0,
    errors: 0,
  };

  // Run DB-only crash recovery before any slow provider or media operation.
  // This guarantees that a saturated upstream queue cannot starve refunds for
  // requests that never crossed the external-side-effect boundary.
  const { data: notStartedData, error: notStartedError } = await db.rpc(
    "sweep_stale_canvas_not_started_v1",
    { p_limit: Math.min(50, limit) }
  );
  if (!notStartedError) {
    result.sweptNotStarted = rpcRows(notStartedData).length;
  } else {
    result.errors += 1;
  }

  const { data: genericData, error: genericError } = await db.rpc(
    "claim_canvas_generation_reconciliation_v1",
    {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    }
  );
  if (genericError) throw genericError;
  const genericClaims = rpcRows<GenericClaim>(genericData);
  result.claimed += genericClaims.length;

  await Promise.all(
    genericClaims.map(async (claim) => {
      if (
        options.timeBudgetMs &&
        Date.now() - startedAt >= options.timeBudgetMs
      ) {
        await safeReleaseGeneric(db, claim);
        result.released += 1;
        return;
      }
      try {
        const disposition = await reconcileGenericClaim(db, claim);
        if (disposition === "completed") result.completed += 1;
        else if (disposition === "failed") result.failed += 1;
        else if (disposition === "unknown") result.markedUnknown += 1;
        else result.released += 1;
      } catch (error) {
        result.errors += 1;
        console.error("[Canvas reconcile] generic item failed", {
          generationId: claim.generation_id,
          message: error instanceof Error ? error.message : String(error),
        });
        await safeReleaseGeneric(db, claim);
      }
    })
  );

  const remaining = Math.max(1, limit - genericClaims.length);
  const { data: directData, error: directError } = await db.rpc(
    "claim_canvas_gpt_image_direct_media_recovery_v1",
    {
      p_worker_id: workerId,
      p_limit: remaining,
      p_lease_seconds: leaseSeconds,
    }
  );
  if (directError) throw directError;
  const directClaims = rpcRows<DirectImageClaim>(directData);
  result.claimed += directClaims.length;
  await Promise.all(
    directClaims.map(async (claim) => {
      if (
        options.timeBudgetMs &&
        Date.now() - startedAt >= options.timeBudgetMs
      ) {
        await safeReleaseDirectImage(
          db,
          claim,
          "reconcile_time_budget_exhausted"
        );
        result.released += 1;
        return;
      }
      try {
        const disposition = await reconcileDirectImageClaim(db, claim);
        if (disposition === "completed") result.completed += 1;
        else result.released += 1;
      } catch (error) {
        result.errors += 1;
        console.error("[Canvas reconcile] direct image item failed", {
          generationId: claim.generation_id,
          message: error instanceof Error ? error.message : String(error),
        });
        await safeReleaseDirectImage(
          db,
          claim,
          "direct_image_reconcile_exception"
        );
      }
    })
  );

  const { data: swept, error: sweepError } = await db.rpc(
    "sweep_stale_canvas_text_submission_unknown_v1",
    { p_limit: Math.min(50, limit) }
  );
  if (!sweepError) result.sweptText = rpcRows(swept).length;
  else result.errors += 1;

  return result;
}

let foregroundReconciliation: Promise<CanvasReconciliationResult> | null =
  null;

/**
 * Long-lived Alibaba/PM2 deployments can finish the single-flight after the
 * GET response budget. The database leases make overlapping cron/GET kicks
 * safe across processes.
 */
export async function kickCanvasReconciliation(options: {
  limit?: number;
  waitMs?: number;
} = {}): Promise<void> {
  if (!foregroundReconciliation) {
    foregroundReconciliation = reconcileCanvasGenerations({
      limit: options.limit ?? 5,
      leaseSeconds: RECONCILIATION_LEASE_SECONDS,
      timeBudgetMs: 8_000,
    })
      .catch((error) => {
        console.warn("[Canvas reconcile] foreground kick failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          workerId: "",
          claimed: 0,
          completed: 0,
          failed: 0,
          markedUnknown: 0,
          released: 0,
          sweptText: 0,
          sweptNotStarted: 0,
          errors: 1,
        };
      })
      .finally(() => {
        foregroundReconciliation = null;
      });
  }
  const waitMs = Math.max(0, Math.min(2_000, options.waitMs ?? 700));
  await Promise.race([
    foregroundReconciliation.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}
