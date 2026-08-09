import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "../supabase/admin";
import {
  getFileMetadataStrict,
  getPublicUrl,
  type OssUserMetadata,
} from "../oss";
import {
  submitVideoPlatformImage,
  type VideoPlatformImageResult,
} from "../video-platform-image-api";
import { getRegisteredVideoModel } from "../video-models/registry";
import { getVideoModelCatalogEntry } from "../video-models/catalog";
import { isOwnedObjectKey } from "./media-ownership";
import {
  canonicalizeCanvasJson,
  computeCanvasGenerationFingerprint,
  computeCanvasGenerationTextSha256,
  normalizeCanvasGenerationText,
  type CanvasGenerationInputSnapshot,
  type CanvasGenerationIntentV1,
} from "./generation-intent";
import {
  CanvasGenerationCreateRequestSchema,
  toCanvasGenerationView,
  type CanvasGenerationCreateRequest,
  type CanvasGenerationEstimateRequest,
  type CanvasGenerationProjectionRow,
  type CanvasGenerationView,
} from "./generation-api-types";
import {
  estimateCanvasGeneration,
  estimateCanvasGenerationSelection,
  resolveCanvasConfirmationTrigger,
  type CanvasConfirmationTrigger,
} from "./generation-pricing";
import {
  CanvasVideoModelPolicyConfigurationError,
  isCanvasVideoModelEnabled,
} from "./generation-model-policy";
import {
  validateCanvasDoc,
  type CanvasDoc,
  type CanvasNode,
} from "./schema";
import {
  assertCanvasInputKeysReady,
  CanvasMediaReadinessError,
} from "./upload-registry";

type UntypedSupabaseClient = SupabaseClient<any, any, any>;

const GENERATION_PROJECTION_COLUMNS = [
  "id",
  "action_id",
  "canvas_id_snapshot",
  "canvas_node_id",
  "type",
  "status",
  "provider_submission_state",
  "task_id",
  "progress",
  "credit_cost",
  "billing_mode",
  "output_oss_key",
  "output_text",
  "error_message",
  "last_reconcile_error_code",
  "credits_refunded",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");

const GENERATION_INTERNAL_COLUMNS = [
  GENERATION_PROJECTION_COLUMNS,
  "user_id",
  "planned_output_oss_key",
  "model",
  "duration",
  "aspect_ratio",
  "quality",
  "resolution",
  "spec",
  "request_fingerprint",
  "fingerprint_version",
  "reconcile_profile_version",
  "reconcile_interval_ms",
].join(",");

interface CanvasAuthorityRow {
  id: string;
  user_id: string;
  rev: number;
  doc: unknown;
  writer_tag: string | null;
  writer_heartbeat_at: string | null;
}

export interface CanvasGenerationInternalRow
  extends CanvasGenerationProjectionRow {
  user_id: string;
  planned_output_oss_key: string | null;
  model: string | null;
  duration: number | null;
  aspect_ratio: string | null;
  quality: string | null;
  resolution: string | null;
  spec: unknown;
  request_fingerprint: string;
  fingerprint_version: string;
  reconcile_profile_version: string | null;
  reconcile_interval_ms: number | null;
}

interface BeginResult {
  generation_id: string;
  created: boolean;
  status: string;
  provider_submission_state: string;
  billing_mode: string;
  credit_cost: number;
  balance_after: number;
}

interface SubmissionClaim {
  generation_id: string;
  bearer_token: string;
  kind: "image" | "video" | "text";
}

export class CanvasGenerationServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status = 400,
    retryable = false
  ) {
    super(message);
    this.name = "CanvasGenerationServiceError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type ProviderSubmissionDisposition =
  | "definite_rejection"
  | "unknown";

function assertCanvasVideoModelEnabled(
  intent:
    | CanvasGenerationIntentV1
    | CanvasGenerationEstimateRequest
): void {
  if (intent.kind !== "video") return;
  try {
    if (isCanvasVideoModelEnabled(intent.config.model)) return;
  } catch (error) {
    if (error instanceof CanvasVideoModelPolicyConfigurationError) {
      console.error("[Canvas generation] invalid video model allowlist", {
        message: error.message,
      });
      throw new CanvasGenerationServiceError(
        "CANVAS_VIDEO_MODELS_MISCONFIGURED",
        "视频生成暂时不可用，请联系管理员",
        503,
        true
      );
    }
    throw error;
  }
  throw new CanvasGenerationServiceError(
    "CANVAS_VIDEO_MODEL_NOT_ENABLED",
    "所选视频模型尚未在超级画布开放",
    422
  );
}

/**
 * A network failure, timeout, 408/409/425/429, 5xx, or malformed successful
 * response can all hide an accepted provider job. They must never trigger an
 * automatic refund or a second submit.
 */
export function classifyProviderSubmissionFailure(input: {
  statusCode?: number;
  retryable?: boolean;
  message?: string;
  upstreamCallCount?: number;
}): ProviderSubmissionDisposition {
  const message = input.message ?? "";
  const statusCode =
    input.statusCode ??
    Number(
      message.match(/\b(?:HTTP|API Error)\s*([1-5]\d\d)\b/i)?.[1] ??
        Number.NaN
    );

  // A failure before the provider submit request is sent is conclusive even
  // when that local/reference-fetch error is itself retryable. Refunding here
  // cannot create a duplicate provider job because no provider call occurred.
  if (input.upstreamCallCount === 0) return "definite_rejection";
  if (input.retryable === true) return "unknown";
  if (
    Number.isFinite(statusCode) &&
    (statusCode >= 500 ||
      statusCode === 408 ||
      statusCode === 409 ||
      statusCode === 425 ||
      statusCode === 429)
  ) {
    return "unknown";
  }
  if (
    /(fetch failed|network|timeout|timed out|aborted|socket|econn|etimedout|enotfound|eai_again|non-json|未返回.*(?:task|id)|malformed)/i.test(
      message
    )
  ) {
    return "unknown";
  }
  if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
    return "definite_rejection";
  }
  if (
    /(not configured|unsupported|does not support|must be validated|too many reference|invalid (?:prompt|request|parameter|argument))/i.test(
      message
    )
  ) {
    return "definite_rejection";
  }
  return "unknown";
}

function asDb(
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): UntypedSupabaseClient {
  return client as unknown as UntypedSupabaseClient;
}

function firstRpcRow<T>(data: unknown, rpcName: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new CanvasGenerationServiceError(
      "CANVAS_GENERATION_DB_CONTRACT",
      `${rpcName} returned no row`,
      500,
      true
    );
  }
  return row as T;
}

function dbErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function mapDatabaseError(
  error: unknown,
  fallbackCode = "CANVAS_GENERATION_DB_ERROR"
): CanvasGenerationServiceError {
  const message = dbErrorMessage(error);
  if (/insufficient credits/i.test(message)) {
    return new CanvasGenerationServiceError(
      "INSUFFICIENT_CREDITS",
      "积分不足，请先充值后再生成",
      402
    );
  }
  if (/free quota exhausted/i.test(message)) {
    return new CanvasGenerationServiceError(
      "FREE_QUOTA_EXHAUSTED",
      "今日免费额度已用完",
      429
    );
  }
  if (/canvas-p1 fence|writer|heartbeat|observed rev/i.test(message)) {
    return new CanvasGenerationServiceError(
      "CANVAS_FENCE_CONFLICT",
      "画布版本或写者租约已变化，请刷新后重试",
      409
    );
  }
  if (/different fingerprint|immutable identity|identity\/fingerprint mismatch/i.test(message)) {
    return new CanvasGenerationServiceError(
      "ACTION_ID_CONFLICT",
      "actionId 已用于另一项生成请求",
      409
    );
  }
  return new CanvasGenerationServiceError(
    fallbackCode,
    "生成服务暂时不可用，请稍后重试",
    500,
    true
  );
}

function assertCanonicalIntentMatchesConnectedInputs(
  doc: CanvasDoc,
  targetNode: CanvasNode,
  intent: CanvasGenerationIntentV1,
  userId: string
): CanvasGenerationInputSnapshot[] {
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const incoming = doc.edges
    .filter((edge) => edge.target === targetNode.id)
    .map((edge) => edge.source)
    .filter((sourceId) => {
      if (seen.has(sourceId)) return false;
      seen.add(sourceId);
      return true;
    })
    .map((sourceId) => {
      const source = nodeById.get(sourceId);
      if (!source) {
        throw new CanvasGenerationServiceError(
          "CANVAS_INPUT_MISSING",
          `连接的输入节点 ${sourceId} 不存在`,
          409
        );
      }
      return source;
    });

  const textNodes = incoming.filter(
    (source) =>
      (source.type === "text" || source.type === "product") &&
      typeof source.data.title === "string" &&
      source.data.title.trim().length > 0
  );
  const imageNodes = incoming.filter(
    (source) =>
      source.type === "image" && Boolean(source.data.media?.ossKey)
  );
  const referenceLimit =
    intent.kind === "image"
      ? 1
      : intent.kind === "video" &&
          intent.config.mode === "image_to_video"
        ? getVideoModelCatalogEntry(intent.config.model).maxImages
        : 0;
  const referencedImages = imageNodes.slice(0, referenceLimit);

  const textSnapshots: CanvasGenerationInputSnapshot[] = textNodes.map(
    (source) => ({
      kind: "text",
      nodeId: source.id,
      textSha256: computeCanvasGenerationTextSha256(
        source.data.title ?? ""
      ),
    })
  );
  const imageSnapshots: CanvasGenerationInputSnapshot[] =
    referencedImages.map((source) => {
      const ossKey = source.data.media?.ossKey;
      if (!ossKey || !isOwnedObjectKey(ossKey, userId)) {
        throw new CanvasGenerationServiceError(
          "CANVAS_INPUT_NOT_OWNED",
          `节点 ${source.id} 的媒体不属于当前用户`,
          403
        );
      }
      const generationId = source.data.refs.generationId;
      if (
        generationId !== null &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          generationId
        )
      ) {
        throw new CanvasGenerationServiceError(
          "CANVAS_INPUT_INVALID_GENERATION",
          `节点 ${source.id} 的 generationId 非法`,
          422
        );
      }
      return {
        kind: "image",
        nodeId: source.id,
        ossKey,
        ...(generationId ? { generationId } : {}),
      };
    });
  const snapshots = [...textSnapshots, ...imageSnapshots];

  if (
    canonicalizeCanvasJson(snapshots) !==
    canonicalizeCanvasJson(intent.inputs)
  ) {
    throw new CanvasGenerationServiceError(
      "CANVAS_INPUTS_CHANGED",
      "连接输入已变化，请刷新节点后重新生成",
      409
    );
  }

  const promptParts = [
    targetNode.data.title,
    ...textNodes.map((source) => source.data.title),
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .map(normalizeCanvasGenerationText);
  const authoritativePrompt = Array.from(new Set(promptParts)).join("\n\n");
  if (authoritativePrompt !== intent.prompt) {
    throw new CanvasGenerationServiceError(
      "CANVAS_PROMPT_CHANGED",
      "节点提示词已变化，请保存后重新生成",
      409
    );
  }

  return snapshots;
}

async function loadAuthoritativeCanvas(
  db: UntypedSupabaseClient,
  input: CanvasGenerationCreateRequest,
  userId: string
): Promise<{ row: CanvasAuthorityRow; doc: CanvasDoc; targetNode: CanvasNode }> {
  const { data, error } = await db
    .from("canvases")
    .select("id,user_id,rev,doc,writer_tag,writer_heartbeat_at")
    .eq("id", input.canvasId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw mapDatabaseError(error);
  if (!data) {
    throw new CanvasGenerationServiceError(
      "CANVAS_NOT_FOUND",
      "画布不存在或无权访问",
      404
    );
  }
  const row = data as unknown as CanvasAuthorityRow;
  if (row.rev !== input.observedRev || row.writer_tag !== input.writerTag) {
    throw new CanvasGenerationServiceError(
      "CANVAS_FENCE_CONFLICT",
      "画布版本或写者租约已变化，请刷新后重试",
      409
    );
  }

  const validation = validateCanvasDoc(row.doc);
  if (!validation.ok || !validation.data) {
    throw new CanvasGenerationServiceError(
      "CANVAS_DOC_INVALID",
      "画布数据需要修复后才能生成",
      422
    );
  }
  const targetNode = validation.data.nodes.find(
    (node) => node.id === input.nodeId
  );
  if (!targetNode) {
    throw new CanvasGenerationServiceError(
      "CANVAS_NODE_NOT_FOUND",
      "目标节点不存在",
      404
    );
  }
  if (targetNode.type !== input.intent.kind) {
    throw new CanvasGenerationServiceError(
      "CANVAS_NODE_KIND_MISMATCH",
      `目标节点类型 ${targetNode.type} 与生成类型 ${input.intent.kind} 不一致`,
      422
    );
  }
  const persistedIntent = targetNode.data.params?.generation;
  if (
    !persistedIntent ||
    canonicalizeCanvasJson(persistedIntent) !==
      canonicalizeCanvasJson(input.intent)
  ) {
    throw new CanvasGenerationServiceError(
      "CANVAS_INTENT_NOT_PERSISTED",
      "生成参数尚未保存到当前画布版本，请稍后重试",
      409,
      true
    );
  }

  return { row, doc: validation.data, targetNode };
}

async function fetchGenerationInternal(
  db: UntypedSupabaseClient,
  generationId: string,
  userId: string
): Promise<CanvasGenerationInternalRow> {
  const { data, error } = await db
    .from("generations")
    .select(GENERATION_INTERNAL_COLUMNS)
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) {
    throw new CanvasGenerationServiceError(
      "GENERATION_NOT_FOUND",
      "生成任务不存在",
      404
    );
  }
  return data as unknown as CanvasGenerationInternalRow;
}

function submissionAuthority(bearerToken: string) {
  return {
    kind: "submission_bearer",
    bearerToken,
  } as const;
}

function mediaIdentityMetadata(input: {
  generationId: string;
  userId: string;
  actionId: string;
}): {
  oss: OssUserMetadata;
  rpc: { generationId: string; userId: string; actionId: string };
} {
  return {
    oss: {
      "generation-id": input.generationId,
      "user-id": input.userId,
      "action-id": input.actionId,
    },
    rpc: input,
  };
}

export async function verifyCanvasMediaObject(input: {
  objectKey: string;
  generationId: string;
  userId: string;
  actionId: string;
  kind: "image" | "video";
}): Promise<boolean> {
  const metadata = await getFileMetadataStrict(input.objectKey);
  if (!metadata || metadata.size <= 0) return false;
  if (
    input.kind === "image" &&
    !metadata.contentType.toLowerCase().startsWith("image/")
  ) {
    return false;
  }
  if (
    input.kind === "video" &&
    !metadata.contentType.toLowerCase().startsWith("video/")
  ) {
    return false;
  }
  return (
    metadata.metadata["generation-id"] === input.generationId &&
    metadata.metadata["user-id"] === input.userId &&
    metadata.metadata["action-id"] === input.actionId
  );
}

function missingSchemaColumn(error: unknown): string | null {
  const message = dbErrorMessage(error);
  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ??
    message.match(/column generations\.([a-zA-Z0-9_]+) does not exist/)?.[1] ??
    null
  );
}

/**
 * Compatibility-only projection for existing library/publishing surfaces.
 * output_oss_key remains the lifecycle truth; missing legacy columns or a
 * transient compatibility update never invalidate a completed action.
 */
export async function syncLegacyGenerationMediaColumns(input: {
  db: UntypedSupabaseClient;
  generationId: string;
  kind: "image" | "video";
  objectKey: string;
}): Promise<void> {
  const url = getPublicUrl(input.objectKey);
  let candidate: Record<string, unknown> =
    input.kind === "image"
      ? { result_url: url, image_url: url, output_url: url }
      : { result_url: url, video_url: url, output_url: url };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await input.db
      .from("generations")
      .update(candidate)
      .eq("id", input.generationId);
    if (!error) return;
    const missing = missingSchemaColumn(error);
    if (!missing || !Object.prototype.hasOwnProperty.call(candidate, missing)) {
      console.error("[Canvas generation] legacy media projection failed", {
        generationId: input.generationId,
        kind: input.kind,
        code:
          error && typeof error === "object"
            ? (error as { code?: unknown }).code
            : undefined,
      });
      return;
    }
    const { [missing]: _removed, ...next } = candidate;
    candidate = next;
  }
}

async function completeDirectImage(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  bearerToken: string
): Promise<void> {
  const plannedKey = row.planned_output_oss_key;
  if (!plannedKey) {
    throw new CanvasGenerationServiceError(
      "PLANNED_OUTPUT_MISSING",
      "图片任务缺少计划输出键",
      500
    );
  }
  const verified = await verifyCanvasMediaObject({
    objectKey: plannedKey,
    generationId: row.id,
    userId: row.user_id,
    actionId: row.action_id,
    kind: "image",
  });
  if (!verified) {
    const { error } = await db.rpc("mark_canvas_generation_unknown_v1", {
      p_user_id: row.user_id,
      p_generation_id: row.id,
      p_authority: submissionAuthority(bearerToken),
      p_error_code: "direct_image_object_proof_missing",
    });
    if (error) throw mapDatabaseError(error);
    return;
  }

  const metadata = mediaIdentityMetadata({
    generationId: row.id,
    userId: row.user_id,
    actionId: row.action_id,
  });
  const { error } = await db.rpc("complete_canvas_generation_v1", {
    p_user_id: row.user_id,
    p_generation_id: row.id,
    p_authority: submissionAuthority(bearerToken),
    p_output_text: null,
    p_output_oss_key: plannedKey,
    p_media_metadata: metadata.rpc,
  });
  if (error) throw mapDatabaseError(error);
  await syncLegacyGenerationMediaColumns({
    db,
    generationId: row.id,
    kind: "image",
    objectKey: plannedKey,
  });
}

async function markSubmissionUnknown(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  bearerToken: string,
  errorCode: string
): Promise<void> {
  const { error } = await db.rpc("mark_canvas_generation_unknown_v1", {
    p_user_id: row.user_id,
    p_generation_id: row.id,
    p_authority: submissionAuthority(bearerToken),
    p_error_code: errorCode,
  });
  if (error) throw mapDatabaseError(error);
}

async function failSubmission(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  bearerToken: string,
  errorCode: string
): Promise<number | undefined> {
  const { data, error } = await db.rpc("fail_canvas_generation_v1", {
    p_user_id: row.user_id,
    p_generation_id: row.id,
    p_authority: submissionAuthority(bearerToken),
    p_error_code: errorCode,
  });
  if (error) throw mapDatabaseError(error);
  return firstRpcRow<{ balance_after?: number }>(
    data,
    "fail_canvas_generation_v1"
  ).balance_after;
}

async function bindProviderTask(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  bearerToken: string,
  taskId: string
): Promise<void> {
  const { error } = await db.rpc("bind_canvas_generation_task_v1", {
    p_user_id: row.user_id,
    p_generation_id: row.id,
    p_authority: submissionAuthority(bearerToken),
    p_task_id: taskId,
  });
  if (error) throw mapDatabaseError(error);
}

function imageFailureDisposition(
  result: VideoPlatformImageResult
): ProviderSubmissionDisposition {
  return classifyProviderSubmissionFailure({
    statusCode: result.statusCode ?? result.upstreamStatus,
    retryable: result.retryable,
    message: result.error,
    upstreamCallCount: result.upstreamCallCount,
  });
}

async function submitImage(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  intent: Extract<CanvasGenerationIntentV1, { kind: "image" }>,
  bearerToken: string
): Promise<number | undefined> {
  if (!row.planned_output_oss_key) {
    return failSubmission(
      db,
      row,
      bearerToken,
      "planned_output_key_missing"
    );
  }
  const metadata = mediaIdentityMetadata({
    generationId: row.id,
    userId: row.user_id,
    actionId: row.action_id,
  });
  const referenceUrls = intent.inputs
    .filter(
      (
        item
      ): item is Extract<CanvasGenerationInputSnapshot, { kind: "image" }> =>
        item.kind === "image"
    )
    .map((item) => getPublicUrl(item.ossKey));

  let result: VideoPlatformImageResult;
  try {
    result = await submitVideoPlatformImage({
      prompt: intent.prompt,
      sourceImageUrls: referenceUrls,
      resolution: intent.config.resolution,
      aspectRatio: intent.config.aspectRatio,
      outputObjectKey: row.planned_output_oss_key,
      outputMetadata: metadata.oss,
    });
  } catch {
    await markSubmissionUnknown(
      db,
      row,
      bearerToken,
      "image_submission_transport_unknown"
    );
    return undefined;
  }

  if (result.status === "completed" && result.success) {
    try {
      await completeDirectImage(db, row, bearerToken);
    } catch (error) {
      if (error instanceof CanvasGenerationServiceError) throw error;
      await markSubmissionUnknown(
        db,
        row,
        bearerToken,
        "direct_image_completion_unknown"
      );
    }
    return undefined;
  }

  if (result.status === "processing" && result.platformTaskId) {
    await bindProviderTask(
      db,
      row,
      bearerToken,
      result.platformTaskId
    );
    return undefined;
  }

  if (imageFailureDisposition(result) === "definite_rejection") {
    return failSubmission(
      db,
      row,
      bearerToken,
      "image_provider_rejected"
    );
  }

  await markSubmissionUnknown(
    db,
    row,
    bearerToken,
    "image_submission_outcome_unknown"
  );
  return undefined;
}

async function submitVideo(
  db: UntypedSupabaseClient,
  row: CanvasGenerationInternalRow,
  intent: Extract<CanvasGenerationIntentV1, { kind: "video" }>,
  bearerToken: string
): Promise<number | undefined> {
  const referenceUrls = intent.inputs
    .filter(
      (
        item
      ): item is Extract<CanvasGenerationInputSnapshot, { kind: "image" }> =>
        item.kind === "image"
    )
    .map((item) => getPublicUrl(item.ossKey));
  const model = getRegisteredVideoModel(intent.config.model);

  try {
    const submitted = await model.adapter.submit({
      modelType: intent.config.model,
      prompt: intent.prompt,
      aspectRatio: intent.config.aspectRatio,
      imageUrls: referenceUrls,
      clientTaskId: intent.actionId,
      groupName: "超级画布",
      userId: row.user_id,
      durationSeconds: intent.config.durationSeconds,
      quality: intent.config.quality,
      mode: intent.config.mode,
      atMostOnce: true,
    });
    if (!submitted.taskId?.trim()) {
      await markSubmissionUnknown(
        db,
        row,
        bearerToken,
        "video_provider_missing_task_id"
      );
      return undefined;
    }
    await bindProviderTask(db, row, bearerToken, submitted.taskId.trim());
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      classifyProviderSubmissionFailure({ message }) ===
      "definite_rejection"
    ) {
      return failSubmission(
        db,
        row,
        bearerToken,
        "video_provider_rejected"
      );
    }
    await markSubmissionUnknown(
      db,
      row,
      bearerToken,
      "video_submission_outcome_unknown"
    );
    return undefined;
  }
}

async function beginGeneration(
  db: UntypedSupabaseClient,
  input: CanvasGenerationCreateRequest,
  userId: string,
  fingerprint: string
): Promise<BeginResult> {
  const pricing = estimateCanvasGeneration(input.intent);
  const config = input.intent.config;
  const { data, error } = await db.rpc("begin_canvas_generation_v1", {
    p_user_id: userId,
    p_canvas_id: input.canvasId,
    p_canvas_node_id: input.nodeId,
    p_action_id: input.actionId,
    p_observed_rev: input.observedRev,
    p_observed_writer_tag: input.writerTag,
    p_kind: input.intent.kind,
    p_request_fingerprint: fingerprint,
    p_fingerprint_version: "canvas-generation-v1",
    p_pricing_version: pricing.pricingVersion,
    p_billing_mode: pricing.billingMode,
    p_credit_cost: pricing.cost,
    p_prompt: input.intent.prompt,
    p_model: config.model,
    p_duration:
      input.intent.kind === "video"
        ? input.intent.config.durationSeconds
        : null,
    p_aspect_ratio:
      input.intent.kind === "image" || input.intent.kind === "video"
        ? input.intent.config.aspectRatio
        : null,
    p_quality:
      input.intent.kind === "video" ? input.intent.config.quality : null,
    p_resolution:
      input.intent.kind === "image" ? input.intent.config.resolution : null,
    p_reconcile_profile_version: pricing.reconcileProfileVersion,
    p_reconcile_interval_ms: pricing.reconcileIntervalMs,
    // Exact normalized intent is the immutable provider-bound specification.
    p_spec: input.intent,
  });
  if (error) throw mapDatabaseError(error);
  return firstRpcRow<BeginResult>(data, "begin_canvas_generation_v1");
}

async function claimSubmission(
  db: UntypedSupabaseClient,
  input: CanvasGenerationCreateRequest,
  userId: string,
  fingerprint: string
): Promise<SubmissionClaim | null> {
  const { data, error } = await db.rpc(
    "claim_canvas_generation_submission_v1",
    {
      p_user_id: userId,
      p_canvas_id: input.canvasId,
      p_canvas_node_id: input.nodeId,
      p_action_id: input.actionId,
      p_observed_rev: input.observedRev,
      p_observed_writer_tag: input.writerTag,
      p_request_fingerprint: fingerprint,
    }
  );
  if (error) {
    // Another same-action request may have won the one-time claim. The caller
    // will read the owner-scoped row and must not submit again.
    if (/not claimable/i.test(dbErrorMessage(error))) return null;
    throw mapDatabaseError(error);
  }
  return firstRpcRow<SubmissionClaim>(
    data,
    "claim_canvas_generation_submission_v1"
  );
}

export interface CreateCanvasGenerationResult {
  generation: CanvasGenerationView;
  balanceAfter?: number;
  deduplicated: boolean;
}

export async function createCanvasGeneration(
  rawInput: unknown,
  userId: string
): Promise<CreateCanvasGenerationResult> {
  const parsed = CanvasGenerationCreateRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CanvasGenerationServiceError(
      "INVALID_REQUEST",
      "生成请求字段非法；仅允许画布身份、写者栅栏和严格 intent",
      400
    );
  }
  const input = parsed.data;
  if (input.intent.kind === "text") {
    throw new CanvasGenerationServiceError(
      "TEXT_GENERATION_NOT_AVAILABLE",
      "文本节点生成尚未开放，请使用文本节点作为图片或视频输入",
      422
    );
  }
  // Product capability must be rejected before begin_canvas_generation_v1,
  // because begin is the atomic debit boundary.
  assertCanvasVideoModelEnabled(input.intent);

  const db = asDb();
  const authoritative = await loadAuthoritativeCanvas(db, input, userId);
  const connectedInputs = assertCanonicalIntentMatchesConnectedInputs(
    authoritative.doc,
    authoritative.targetNode,
    input.intent,
    userId
  );
  try {
    await assertCanvasInputKeysReady({
      userId,
      objectKeys: connectedInputs.flatMap((item) =>
        item.kind === "text" ? [] : [item.ossKey]
      ),
    });
  } catch (error) {
    if (error instanceof CanvasMediaReadinessError) {
      if (error.reason === "MEDIA_NOT_OWNED") {
        throw new CanvasGenerationServiceError(
          "CANVAS_INPUT_NOT_OWNED",
          "连接媒体不属于当前用户",
          403
        );
      }
      if (error.reason === "MEDIA_NOT_READY") {
        throw new CanvasGenerationServiceError(
          "CANVAS_INPUT_NOT_READY",
          "连接媒体尚未完成上传确认，请等待上传完成后重试",
          409
        );
      }
      throw new CanvasGenerationServiceError(
        "CANVAS_INPUT_READINESS_UNAVAILABLE",
        "媒体状态暂时无法确认，请稍后重试",
        503,
        true
      );
    }
    throw error;
  }
  const fingerprint = computeCanvasGenerationFingerprint(input.intent);
  const begun = await beginGeneration(db, input, userId, fingerprint);
  let row = await fetchGenerationInternal(db, begun.generation_id, userId);

  if (
    row.status === "completed" ||
    row.status === "failed" ||
    row.provider_submission_state !== "not_started"
  ) {
    return {
      generation: toCanvasGenerationView(row),
      balanceAfter: begun.balance_after,
      deduplicated: !begun.created,
    };
  }

  const claim = await claimSubmission(db, input, userId, fingerprint);
  if (!claim) {
    row = await fetchGenerationInternal(db, begun.generation_id, userId);
    return {
      generation: toCanvasGenerationView(row),
      balanceAfter: begun.balance_after,
      deduplicated: true,
    };
  }

  let balanceAfter = begun.balance_after;
  if (input.intent.kind === "image") {
    balanceAfter =
      (await submitImage(db, row, input.intent, claim.bearer_token)) ??
      balanceAfter;
  } else {
    balanceAfter =
      (await submitVideo(db, row, input.intent, claim.bearer_token)) ??
      balanceAfter;
  }

  row = await fetchGenerationInternal(db, begun.generation_id, userId);
  return {
    generation: toCanvasGenerationView(row),
    balanceAfter,
    deduplicated: !begun.created,
  };
}

export async function listCanvasGenerations(input: {
  userId: string;
  canvasId: string;
  actionId?: string;
  limit?: number;
}): Promise<CanvasGenerationView[]> {
  const db = asDb();
  let query = db
    .from("generations")
    .select(GENERATION_PROJECTION_COLUMNS)
    .eq("user_id", input.userId)
    .eq("canvas_id_snapshot", input.canvasId)
    .eq("source", "canvas")
    .not("action_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, input.limit ?? 50)));
  if (input.actionId) query = query.eq("action_id", input.actionId);

  const { data, error } = await query;
  if (error) throw mapDatabaseError(error);
  return ((data ?? []) as unknown as CanvasGenerationProjectionRow[]).map(
    toCanvasGenerationView
  );
}

export async function getCanvasGenerationEstimate(input: {
  userId: string;
  request: CanvasGenerationEstimateRequest;
}): Promise<{
  kind: "image" | "video";
  cost: number;
  pricingVersion: string;
  balance: number;
  needsConfirmation: boolean;
  confirmationReason: CanvasConfirmationTrigger | null;
}> {
  assertCanvasVideoModelEnabled(input.request);
  const pricing = estimateCanvasGenerationSelection(input.request);
  const db = asDb();
  const { data, error } = await db
    .from("profiles")
    .select("credits")
    .eq("id", input.userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) {
    throw new CanvasGenerationServiceError(
      "PROFILE_NOT_FOUND",
      "用户积分账户不存在",
      404
    );
  }
  const rawBalance = Number((data as { credits?: unknown }).credits ?? 0);
  const balance = Number.isFinite(rawBalance)
    ? Math.max(0, Math.floor(rawBalance))
    : 0;
  // CHECKLIST #185:只在「余额<预估×1.2 或单次>5000⚡」时拦截,不再每次付费都弹。
  // 判定用规范化后的 balance(与 UI 显示的同一个数),避免弹窗说的余额与判定依据不一致。
  // 余额不足仍由 begin_canvas_generation_v1 原子拒绝,本字段只影响「要不要多问一句」。
  const confirmationReason = resolveCanvasConfirmationTrigger({
    cost: pricing.cost,
    balance,
  });
  return {
    kind: pricing.kind,
    cost: pricing.cost,
    pricingVersion: pricing.pricingVersion,
    balance,
    needsConfirmation: confirmationReason !== null,
    confirmationReason,
  };
}

export {
  GENERATION_INTERNAL_COLUMNS,
  GENERATION_PROJECTION_COLUMNS,
  asDb as createCanvasGenerationAdminClient,
  fetchGenerationInternal,
  mediaIdentityMetadata,
};
