"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { toast } from "@/hooks/use-toast";
import {
  CanvasGenerationIntentV1Schema,
  computeCanvasGenerationTextSha256,
  normalizeCanvasGenerationText,
  type CanvasGenerationIntentV1,
} from "@/lib/canvas/generation-intent";
import type { CanvasRuntimeDebugState } from "@/lib/canvas/canvas-runtime";
import type { CanvasNode, CanvasNodeData } from "@/lib/canvas/schema";
import {
  getVideoModelCatalogEntry,
  isVideoModelId,
} from "@/lib/video-models/catalog";
import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoGenerationMode,
  VideoModelId,
  VideoQuality,
} from "@/lib/video-models/types";
import { useCanvasStore } from "@/stores/canvas-store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;
const SAVE_FENCE_TIMEOUT_MS = 20_000;
const GENERATION_LIST_LIMIT = 100;

export type CanvasGenerationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "unknown";

export type CanvasGenerationSyncState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface CanvasGenerationView {
  generationId: string;
  actionId: string;
  canvasId: string;
  nodeId: string;
  kind: "text" | "image" | "video";
  status: CanvasGenerationStatus;
  providerSubmissionState: string;
  taskId: string | null;
  progress: number;
  creditCost: number;
  billingMode: "debit" | "free_quota";
  outputOssKey: string | null;
  outputText: string | null;
  errorCode: string | null;
  refundedCredits: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CanvasGenerationEstimate {
  kind: "text" | "image" | "video";
  cost: number;
  pricingVersion: string;
  balance: number;
  needsConfirmation: boolean;
}

export interface CanvasImageDraftConfig {
  resolution: "1k" | "2k" | "4k";
  aspectRatio:
    | "auto"
    | "1:1"
    | "16:9"
    | "9:16"
    | "4:3"
    | "3:4"
    | "3:2"
    | "2:3"
    | "5:4"
    | "4:5"
    | "21:9";
}

export interface CanvasVideoDraftConfig {
  model: VideoModelId;
  durationSeconds: VideoDurationSeconds;
  quality: VideoQuality;
  aspectRatio: VideoAspectRatio;
  mode: VideoGenerationMode;
}

const configuredCanvasVideoModels = (
  process.env.NEXT_PUBLIC_CANVAS_VIDEO_MODELS ?? ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(isVideoModelId);

/**
 * This is only a UX mirror of the server-side CANVAS_VIDEO_MODELS gate. The
 * server remains authoritative before billing; defaulting both sides to Grok
 * avoids advertising providers that production has not explicitly enabled.
 */
export const ENABLED_CANVAS_VIDEO_MODELS: readonly VideoModelId[] =
  configuredCanvasVideoModels.length > 0
    ? Array.from(new Set(configuredCanvasVideoModels))
    : ["grok"];

export const DEFAULT_CANVAS_IMAGE_CONFIG: CanvasImageDraftConfig = {
  resolution: "1k",
  aspectRatio: "9:16",
};

export const DEFAULT_CANVAS_VIDEO_CONFIG: CanvasVideoDraftConfig = {
  model: ENABLED_CANVAS_VIDEO_MODELS[0] ?? "grok",
  durationSeconds: 10,
  quality: "standard",
  aspectRatio: "9:16",
  mode: "prompt_to_video",
};

interface CanvasGenerationContextValue {
  canvasId: string | null;
  enabled: boolean;
  syncState: CanvasGenerationSyncState;
  syncError: string | null;
  submittingNodeIds: ReadonlySet<string>;
  unresolvedActionByNodeId: ReadonlyMap<string, string>;
  generationByNodeId: ReadonlyMap<string, CanvasGenerationView>;
  submitNode(nodeId: string): Promise<CanvasGenerationView | null>;
  refresh(): Promise<void>;
  estimate(
    kind: "image" | "video",
    config: CanvasImageDraftConfig | CanvasVideoDraftConfig,
    signal?: AbortSignal
  ): Promise<CanvasGenerationEstimate | null>;
}

const CanvasGenerationContext = createContext<CanvasGenerationContextValue | null>(
  null
);

export interface CanvasGenerationProviderProps {
  canvasId: string | null;
  writerTag: string | null;
  enabled: boolean;
  getRuntimeDebugState(): CanvasRuntimeDebugState;
  children: ReactNode;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeGeneration(value: unknown): CanvasGenerationView | null {
  const row = asRecord(value);
  if (!row) return null;
  const generationId = optionalString(row.generationId);
  const actionId = optionalString(row.actionId);
  const canvasId = optionalString(row.canvasId);
  const nodeId = optionalString(row.nodeId);
  const kind = row.kind;
  const providerSubmissionState = optionalString(row.providerSubmissionState);
  const rawStatus = optionalString(row.status);
  const status =
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "processing" ||
    rawStatus === "pending" ||
    rawStatus === "unknown"
      ? rawStatus
      : null;
  const taskId =
    row.taskId === null ? null : optionalString(row.taskId);
  const outputOssKey =
    row.outputOssKey === null ? null : optionalString(row.outputOssKey);
  const outputText =
    row.outputText === null || typeof row.outputText === "string"
      ? row.outputText
      : undefined;
  const errorCode =
    row.errorCode === null ? null : optionalString(row.errorCode);
  const completedAt =
    row.completedAt === null ? null : optionalString(row.completedAt);

  if (
    !generationId ||
    !UUID_RE.test(generationId) ||
    !actionId ||
    !UUID_RE.test(actionId) ||
    !canvasId ||
    !UUID_RE.test(canvasId) ||
    !nodeId ||
    (kind !== "text" && kind !== "image" && kind !== "video") ||
    !status ||
    (providerSubmissionState !== "not_started" &&
      providerSubmissionState !== "submitting" &&
      providerSubmissionState !== "bound" &&
      providerSubmissionState !== "unknown") ||
    (row.taskId !== null && taskId === null) ||
    !Number.isSafeInteger(row.progress) ||
    (row.progress as number) < 0 ||
    (row.progress as number) > 100 ||
    !Number.isSafeInteger(row.creditCost) ||
    (row.creditCost as number) < 0 ||
    (row.billingMode !== "debit" && row.billingMode !== "free_quota") ||
    (row.outputOssKey !== null && outputOssKey === null) ||
    outputText === undefined ||
    (row.errorCode !== null && errorCode === null) ||
    !Number.isSafeInteger(row.refundedCredits) ||
    (row.refundedCredits as number) < 0 ||
    !optionalString(row.createdAt) ||
    !optionalString(row.updatedAt) ||
    (row.completedAt !== null && completedAt === null)
  ) {
    return null;
  }

  return {
    generationId,
    actionId,
    canvasId,
    nodeId,
    kind,
    status,
    providerSubmissionState,
    taskId,
    progress: row.progress as number,
    creditCost: row.creditCost as number,
    billingMode: row.billingMode,
    outputOssKey,
    outputText,
    errorCode,
    refundedCredits: row.refundedCredits as number,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    completedAt,
  };
}

function generationsFromResponse(value: unknown): CanvasGenerationView[] | null {
  const root = asRecord(value);
  if (root?.success !== true) return null;
  const data = asRecord(root?.data);
  if (!Array.isArray(data?.generations)) return null;
  const generations: CanvasGenerationView[] = [];
  for (const row of data.generations) {
    const generation = normalizeGeneration(row);
    if (!generation) return null;
    generations.push(generation);
  }
  return generations;
}

function generationFromResponse(value: unknown): CanvasGenerationView | null {
  const root = asRecord(value);
  if (root?.success !== true) return null;
  const data = asRecord(root?.data);
  return normalizeGeneration(data?.generation);
}

function apiErrorMessage(value: unknown, fallback: string): string {
  const root = asRecord(value);
  const error = root?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (asRecord(error) && typeof asRecord(error)?.message === "string") {
    return String(asRecord(error)?.message);
  }
  if (typeof root?.message === "string" && root.message.trim()) {
    return root.message.trim();
  }
  return fallback;
}

function randomUuid(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  cryptoObject?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function objectParams(data: CanvasNodeData): Record<string, unknown> {
  return asRecord(data.params) ?? {};
}

function persistedGenerationIntent(
  data: CanvasNodeData
): CanvasGenerationIntentV1 | null {
  const parsed = CanvasGenerationIntentV1Schema.safeParse(
    objectParams(data).generation
  );
  return parsed.success ? parsed.data : null;
}

export function getCanvasImageDraftConfig(data: CanvasNodeData): CanvasImageDraftConfig {
  const raw = asRecord(objectParams(data).canvasImage);
  const resolution =
    raw?.resolution === "2k" || raw?.resolution === "4k"
      ? raw.resolution
      : "1k";
  const aspectValues: CanvasImageDraftConfig["aspectRatio"][] = [
    "auto",
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "5:4",
    "4:5",
    "21:9",
  ];
  const aspectRatio = aspectValues.includes(
    raw?.aspectRatio as CanvasImageDraftConfig["aspectRatio"]
  )
    ? (raw?.aspectRatio as CanvasImageDraftConfig["aspectRatio"])
    : DEFAULT_CANVAS_IMAGE_CONFIG.aspectRatio;
  return { resolution, aspectRatio };
}

export function getCanvasVideoDraftConfig(data: CanvasNodeData): CanvasVideoDraftConfig {
  const raw = asRecord(objectParams(data).canvasVideo);
  const requestedModel = String(raw?.model ?? "");
  const model =
    isVideoModelId(requestedModel) &&
    ENABLED_CANVAS_VIDEO_MODELS.includes(requestedModel)
    ? requestedModel
    : DEFAULT_CANVAS_VIDEO_CONFIG.model;
  const catalog = getVideoModelCatalogEntry(model);
  const durationSeconds = catalog.supportedDurations.includes(
    raw?.durationSeconds as VideoDurationSeconds
  )
    ? (raw?.durationSeconds as VideoDurationSeconds)
    : catalog.supportedDurations[0];
  const quality = catalog.supportedQualities.includes(raw?.quality as VideoQuality)
    ? (raw?.quality as VideoQuality)
    : catalog.supportedQualities[0];
  const aspectRatio = catalog.supportedAspectRatios.includes(
    raw?.aspectRatio as VideoAspectRatio
  )
    ? (raw?.aspectRatio as VideoAspectRatio)
    : catalog.supportedAspectRatios[0];
  const requestedMode =
    raw?.mode === "image_to_video" ? "image_to_video" : "prompt_to_video";
  const mode = catalog.supportedModes.includes(requestedMode)
    ? requestedMode
    : catalog.supportedModes[0];
  return { model, durationSeconds, quality, aspectRatio, mode };
}

function generationInputNodes(targetNodeId: string): CanvasNode[] {
  const state = useCanvasStore.getState();
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const sourceIds = state.edges
    .filter((edge) => edge.target === targetNodeId)
    .map((edge) => edge.source);
  const seen = new Set<string>();
  return sourceIds
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => byId.get(id))
    .filter((node): node is CanvasNode => Boolean(node));
}

function normalizedPrompt(target: CanvasNode, inputs: readonly CanvasNode[]): string {
  const parts = [target.data.title, ...inputs
    .filter((node) => node.type === "text" || node.type === "product")
    .map((node) => node.data.title)]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeCanvasGenerationText(value));
  return Array.from(new Set(parts)).join("\n\n");
}

function inputTextSnapshot(node: CanvasNode) {
  const text = typeof node.data.title === "string" ? node.data.title : "";
  return {
    kind: "text" as const,
    nodeId: node.id,
    textSha256: computeCanvasGenerationTextSha256(text),
  };
}

function inputImageSnapshot(node: CanvasNode) {
  const ossKey = node.data.media?.ossKey;
  if (!ossKey) return null;
  const generationId = node.data.refs.generationId;
  return {
    kind: "image" as const,
    nodeId: node.id,
    ossKey,
    ...(generationId && UUID_RE.test(generationId)
      ? { generationId: generationId.toLowerCase() }
      : {}),
  };
}

function buildGenerationIntent(nodeId: string): CanvasGenerationIntentV1 {
  const target = useCanvasStore.getState().nodes.find((node) => node.id === nodeId);
  if (!target || (target.type !== "image" && target.type !== "video")) {
    throw new Error("只能从图片或视频节点发起生成");
  }

  const incoming = generationInputNodes(nodeId);
  const unsupported = incoming.filter(
    (node) =>
      node.type !== "text" &&
      node.type !== "product" &&
      node.type !== "image"
  );
  if (unsupported.length > 0) {
    throw new Error(
      `当前生成节点不支持 ${unsupported
        .map((node) => node.type)
        .join("、")} 输入，请移除对应连线`
    );
  }
  const emptyImageInputs = incoming.filter(
    (node) => node.type === "image" && !node.data.media?.ossKey
  );
  if (emptyImageInputs.length > 0) {
    throw new Error("相连图片节点尚无可用内容，请先生成或上传图片");
  }
  const textInputs = incoming
    .filter((node) => node.type === "text" || node.type === "product")
    .filter((node) => typeof node.data.title === "string" && node.data.title.trim())
    .map(inputTextSnapshot);
  const imageInputNodes = incoming.filter(
    (node) => node.type === "image" && Boolean(node.data.media?.ossKey)
  );
  const prompt = normalizedPrompt(target, incoming);
  if (Array.from(prompt).length < 2) {
    throw new Error("请在当前节点或相连的文本/商品节点中填写至少 2 个字的提示词");
  }
  if (Array.from(prompt).length > 8_000) {
    throw new Error("当前节点与相连文本合计超过 8000 字，请精简后再生成");
  }

  const base = {
    version: 1 as const,
    actionId: randomUuid(),
    submittedAt: new Date().toISOString(),
    prompt,
  };

  if (target.type === "image") {
    const config = getCanvasImageDraftConfig(target.data);
    if (imageInputNodes.length > 1) {
      throw new Error("图片生成最多支持 1 张参考图，请只保留一条图片输入连线");
    }
    const referenceNodes = imageInputNodes;
    if (textInputs.length + referenceNodes.length > 32) {
      throw new Error("生成输入最多支持 32 个节点，请减少相连节点");
    }
    return CanvasGenerationIntentV1Schema.parse({
      ...base,
      kind: "image",
      inputs: [
        ...textInputs,
        ...referenceNodes
          .map(inputImageSnapshot)
          .filter((item): item is NonNullable<typeof item> => item !== null),
      ],
      config: {
        model: "gpt-image-2",
        resolution: config.resolution,
        aspectRatio: config.aspectRatio,
        referenceNodeIds: referenceNodes.map((node) => node.id),
      },
    });
  }

  const config = getCanvasVideoDraftConfig(target.data);
  const catalog = getVideoModelCatalogEntry(config.model);
  if (config.mode === "prompt_to_video" && imageInputNodes.length > 0) {
    throw new Error("文生视频不会使用图片输入；请移除图片连线或切换为图生视频");
  }
  if (
    config.mode === "image_to_video" &&
    imageInputNodes.length > catalog.maxImages
  ) {
    throw new Error(
      `当前模型最多支持 ${catalog.maxImages} 张参考图，请减少图片输入连线`
    );
  }
  const referenceNodes =
    config.mode === "image_to_video"
      ? imageInputNodes
      : [];
  if (config.mode === "image_to_video" && referenceNodes.length === 0) {
    throw new Error("图生视频需要先把至少一个有内容的图片节点连接到当前视频节点");
  }
  if (textInputs.length + referenceNodes.length > 32) {
    throw new Error("生成输入最多支持 32 个节点，请减少相连节点");
  }
  return CanvasGenerationIntentV1Schema.parse({
    ...base,
    kind: "video",
    inputs: [
      ...textInputs,
      ...referenceNodes
        .map(inputImageSnapshot)
        .filter((item): item is NonNullable<typeof item> => item !== null),
    ],
    config: {
      model: config.model,
      durationSeconds: config.durationSeconds,
      quality: config.quality,
      aspectRatio: config.aspectRatio,
      mode: config.mode,
      referenceNodeIds: referenceNodes.map((node) => node.id),
    },
  });
}

function patchNodeGeneration(nodeId: string, generation: CanvasGenerationView): void {
  const state = useCanvasStore.getState();
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;

  const refs = {
    ...node.data.refs,
    generationId: generation.generationId,
    taskId: generation.taskId,
  };
  const media =
    generation.status === "completed" && generation.outputOssKey
      ? {
          ossKey: generation.outputOssKey,
          ...(node.data.media?.ossKey === generation.outputOssKey &&
          node.data.media.posterKey
            ? { posterKey: node.data.media.posterKey }
            : {}),
        }
      : node.data.media;
  const changed =
    refs.generationId !== node.data.refs.generationId ||
    refs.taskId !== node.data.refs.taskId ||
    (media?.ossKey ?? null) !== (node.data.media?.ossKey ?? null);
  if (!changed) return;
  const patch: Partial<CanvasNodeData> = { refs };
  if (media) patch.media = media;
  if (state.updateNodeData(nodeId, patch)) state.commitTextEdit();
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function generationCreatedTime(value: CanvasGenerationView): number {
  return Date.parse(value.createdAt ?? "") || 0;
}

function selectLatestGenerationByNode(
  generations: readonly CanvasGenerationView[],
  expectedCanvasId: string
): Map<string, CanvasGenerationView> {
  const latest = new Map<string, CanvasGenerationView>();
  for (const generation of generations) {
    if (generation.canvasId !== expectedCanvasId) continue;
    const prior = latest.get(generation.nodeId);
    if (!prior || generationCreatedTime(generation) > generationCreatedTime(prior)) {
      latest.set(generation.nodeId, generation);
    }
  }
  return latest;
}

function clearPersistedGenerationIntent(nodeId: string, actionId: string): void {
  const state = useCanvasStore.getState();
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  const currentIntent = persistedGenerationIntent(node.data);
  if (!currentIntent || currentIntent.actionId !== actionId) return;
  const params = { ...objectParams(node.data) };
  delete params.generation;
  if (state.updateNodeData(nodeId, { params })) state.commitTextEdit();
}

class CanvasSubmissionError extends Error {
  readonly definitive: boolean;

  constructor(message: string, definitive: boolean) {
    super(message);
    this.name = "CanvasSubmissionError";
    this.definitive = definitive;
  }
}

function isDefinitiveClientResponse(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 425 &&
    status !== 429
  );
}

export function CanvasGenerationProvider({
  canvasId,
  writerTag,
  enabled,
  getRuntimeDebugState,
  children,
}: CanvasGenerationProviderProps) {
  const [generationByNodeId, setGenerationByNodeId] = useState<
    ReadonlyMap<string, CanvasGenerationView>
  >(new Map());
  const [submittingNodeIds, setSubmittingNodeIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [unresolvedActionByNodeId, setUnresolvedActionByNodeId] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [syncState, setSyncState] =
    useState<CanvasGenerationSyncState>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const refreshInFlight = useRef<{
    canvasId: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const generationByNodeIdRef = useRef(generationByNodeId);
  const unresolvedActionByNodeIdRef = useRef(unresolvedActionByNodeId);
  const submittingNodeIdsRef = useRef(new Set<string>());
  const syncStateRef = useRef(syncState);
  const optimisticActionExpiryRef = useRef(new Map<string, number>());
  const automaticRecoveryAttemptedRef = useRef(new Set<string>());
  const mounted = useRef(true);
  const writerTagRef = useRef(writerTag);
  const enabledRef = useRef(enabled);
  const canvasIdRef = useRef(canvasId);
  const getRuntimeDebugStateRef = useRef(getRuntimeDebugState);
  writerTagRef.current = writerTag;
  enabledRef.current = enabled;
  canvasIdRef.current = canvasId;
  getRuntimeDebugStateRef.current = getRuntimeDebugState;
  generationByNodeIdRef.current = generationByNodeId;
  unresolvedActionByNodeIdRef.current = unresolvedActionByNodeId;
  syncStateRef.current = syncState;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshInFlight.current?.controller.abort();
    };
  }, []);

  const publishUnresolved = useCallback((next: Map<string, string>) => {
    unresolvedActionByNodeIdRef.current = next;
    if (mounted.current) setUnresolvedActionByNodeId(next);
  }, []);

  const currentCanvasIdentity = useCallback((): string | null => {
    const requested = canvasIdRef.current;
    const active = getRuntimeDebugStateRef.current().activeId;
    const resolved = requested ?? active;
    if (!resolved || !UUID_RE.test(resolved)) return null;
    const state = useCanvasStore.getState();
    if (
      !state.hydrated ||
      state.sessionCanvasId !== resolved ||
      state.hydratedCanvasId !== resolved
    ) {
      return null;
    }
    return resolved.toLowerCase();
  }, []);

  const deriveUnresolvedActions = useCallback(
    (
      latest: ReadonlyMap<string, CanvasGenerationView>
    ): Map<string, string> => {
      const next = new Map<string, string>();
      for (const node of useCanvasStore.getState().nodes) {
        if (node.type !== "image" && node.type !== "video") continue;
        const intent = persistedGenerationIntent(node.data);
        if (!intent || intent.kind !== node.type) continue;
        const known = latest.get(node.id);
        if (known?.actionId === intent.actionId) {
          // begin_canvas_generation_v1 may have committed immediately before
          // the serving process exited. This exact shape proves no submission
          // bearer was ever claimed, so replaying the same persisted action is
          // safe: the database one-winner claim still prevents a second POST.
          if (
            known.status === "pending" &&
            known.providerSubmissionState === "not_started"
          ) {
            next.set(node.id, intent.actionId);
          }
          continue;
        }

        // A different, newer server action plus mismatching refs usually means
        // the document was undone/copied. Replaying that stale action would
        // regress the node. A matching current ref, or no known action at all,
        // identifies an intent saved immediately before an ambiguous submit.
        if (
          !known ||
          node.data.refs.generationId === known.generationId ||
          unresolvedActionByNodeIdRef.current.get(node.id) === intent.actionId
        ) {
          next.set(node.id, intent.actionId);
        }
      }
      return next;
    },
    []
  );

  const refresh = useCallback(async (): Promise<void> => {
    const currentCanvasId = currentCanvasIdentity();
    if (!currentCanvasId) return;

    const existing = refreshInFlight.current;
    if (existing?.canvasId === currentCanvasId) return existing.promise;
    existing?.controller.abort();

    if (syncStateRef.current !== "ready") {
      syncStateRef.current = "loading";
      setSyncState("loading");
    }
    setSyncError(null);
    const controller = new AbortController();
    const task = (async () => {
      try {
        const response = await fetch(
          `/api/canvas/generations?canvasId=${encodeURIComponent(
            currentCanvasId
          )}&limit=${GENERATION_LIST_LIMIT}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );
        const body = await responseJson(response);
        if (!response.ok) {
          throw new Error(apiErrorMessage(body, "生成状态读取失败"));
        }
        if (
          controller.signal.aborted ||
          currentCanvasIdentity() !== currentCanvasId
        ) {
          return;
        }

        const generations = generationsFromResponse(body);
        if (
          !generations ||
          generations.some(
            (generation) => generation.canvasId !== currentCanvasId
          )
        ) {
          throw new Error("生成状态响应无法验证");
        }
        const latest = selectLatestGenerationByNode(
          generations,
          currentCanvasId
        );
        const now = Date.now();
        for (const [nodeId, current] of generationByNodeIdRef.current) {
          const optimisticUntil =
            optimisticActionExpiryRef.current.get(current.actionId) ?? 0;
          if (
            current.canvasId === currentCanvasId &&
            optimisticUntil > now &&
            !latest.has(nodeId)
          ) {
            latest.set(nodeId, current);
          }
        }
        for (const [actionId, expiresAt] of optimisticActionExpiryRef.current) {
          if (expiresAt <= now) optimisticActionExpiryRef.current.delete(actionId);
        }

        // Patch only the selected newest row for each node. The API is
        // newest-first; patching every historical row would finish on the
        // oldest task and silently roll refs/media backwards.
        for (const generation of latest.values()) {
          patchNodeGeneration(generation.nodeId, generation);
        }
        generationByNodeIdRef.current = latest;
        if (mounted.current) setGenerationByNodeId(latest);
        publishUnresolved(deriveUnresolvedActions(latest));
        syncStateRef.current = "ready";
        if (mounted.current) {
          setSyncState("ready");
          setSyncError(null);
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error as { name?: string })?.name === "AbortError"
        ) {
          return;
        }
        if (currentCanvasIdentity() !== currentCanvasId) return;
        const message =
          error instanceof Error ? error.message : "生成状态读取失败";
        syncStateRef.current = "error";
        if (mounted.current) {
          setSyncState("error");
          setSyncError(message);
        }
        throw error;
      }
    })().finally(() => {
      if (refreshInFlight.current?.promise === task) {
        refreshInFlight.current = null;
      }
    });
    refreshInFlight.current = { canvasId: currentCanvasId, controller, promise: task };
    return task;
  }, [
    currentCanvasIdentity,
    deriveUnresolvedActions,
    publishUnresolved,
  ]);

  useEffect(() => {
    if (!canvasId) {
      refreshInFlight.current?.controller.abort();
      refreshInFlight.current = null;
      generationByNodeIdRef.current = new Map();
      unresolvedActionByNodeIdRef.current = new Map();
      setGenerationByNodeId(new Map());
      setUnresolvedActionByNodeId(new Map());
      syncStateRef.current = "idle";
      setSyncState("idle");
      setSyncError(null);
      return;
    }
    refreshInFlight.current?.controller.abort();
    refreshInFlight.current = null;
    generationByNodeIdRef.current = new Map();
    unresolvedActionByNodeIdRef.current = new Map();
    optimisticActionExpiryRef.current.clear();
    automaticRecoveryAttemptedRef.current.clear();
    setGenerationByNodeId(new Map());
    setUnresolvedActionByNodeId(new Map());
    syncStateRef.current = "loading";
    setSyncState("loading");
    setSyncError(null);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        await refresh();
      } catch {
        // A polling failure is transient. Submission paths surface errors directly.
      }
      if (cancelled) return;
      const hasActive = Array.from(generationByNodeIdRef.current.values()).some(
        (item) => item.status === "pending" || item.status === "processing"
      );
      timer = setTimeout(tick, hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canvasId, refresh]);

  const waitForFence = useCallback(async () => {
    const started = Date.now();
    while (Date.now() - started < SAVE_FENCE_TIMEOUT_MS) {
      const debug = getRuntimeDebugStateRef.current();
      const state = useCanvasStore.getState();
      const activeCanvasId = debug.activeId;
      const tag = writerTagRef.current;
      const ready =
        enabledRef.current &&
        debug.mode === "persisted" &&
        activeCanvasId !== null &&
        UUID_RE.test(activeCanvasId) &&
        canvasIdRef.current === activeCanvasId &&
        debug.pending === 0 &&
        !debug.inflight &&
        !debug.conflicted &&
        !debug.repairRequired &&
        state.hydrated &&
        state.sessionCanvasId === activeCanvasId &&
        state.hydratedCanvasId === activeCanvasId &&
        !state.readOnly &&
        typeof tag === "string" &&
        tag.length > 0;
      if (ready) {
        return {
          canvasId: activeCanvasId,
          observedRev: debug.baseRev,
          writerTag: tag,
        };
      }
      if (
        debug.conflicted ||
        debug.repairRequired ||
        debug.mode === "failed"
      ) {
        throw new Error("画布保存已暂停，请先处理顶部提示后再生成");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("画布尚未保存完成，请检查网络后重试");
  }, []);

  const refreshAfterCurrent = useCallback(async () => {
    const current = refreshInFlight.current?.promise;
    if (current) await current.catch(() => {});
    await refresh();
  }, [refresh]);

  const submitNode = useCallback(
    async (nodeId: string): Promise<CanvasGenerationView | null> => {
      // Synchronous mutex: React state cannot close the same-tick double-click
      // window, and two fresh actionIds here would be two legitimate debits.
      if (submittingNodeIdsRef.current.has(nodeId)) return null;
      submittingNodeIdsRef.current.add(nodeId);
      if (mounted.current) {
        setSubmittingNodeIds(new Set(submittingNodeIdsRef.current));
      }

      let intent: CanvasGenerationIntentV1 | null = null;
      let recovered = false;
      let requestDispatched = false;
      try {
        if (syncStateRef.current !== "ready") {
          throw new CanvasSubmissionError(
            syncStateRef.current === "error"
              ? "任务状态尚未同步，请先重试同步"
              : "正在同步任务状态，请稍候",
            true
          );
        }
        const state = useCanvasStore.getState();
        const node = state.nodes.find((candidate) => candidate.id === nodeId);
        if (!node || (node.type !== "image" && node.type !== "video")) {
          throw new CanvasSubmissionError("节点已不存在或类型不支持", true);
        }
        const persisted = persistedGenerationIntent(node.data);
        const unresolvedAction =
          unresolvedActionByNodeIdRef.current.get(nodeId);
        const existingGeneration = generationByNodeIdRef.current.get(nodeId);
        const canResumePreProvider =
          existingGeneration?.status === "pending" &&
          existingGeneration.providerSubmissionState === "not_started" &&
          persisted?.actionId === existingGeneration.actionId &&
          persisted.kind === node.type &&
          unresolvedAction === existingGeneration.actionId;
        if (
          !canResumePreProvider &&
          (existingGeneration?.status === "pending" ||
            existingGeneration?.status === "processing" ||
            existingGeneration?.status === "unknown")
        ) {
          throw new CanvasSubmissionError(
            existingGeneration.status === "unknown"
              ? "上游状态仍在核对，不能创建新任务"
              : "当前节点已有生成任务在运行",
            true
          );
        }

        if (
          persisted &&
          persisted.kind === node.type &&
          persisted.actionId === unresolvedAction
        ) {
          intent = persisted;
          recovered = true;
        } else {
          intent = buildGenerationIntent(nodeId);
          const params = {
            ...objectParams(node.data),
            generation: intent,
          };
          if (!state.updateNodeData(nodeId, { params })) {
            throw new CanvasSubmissionError(
              "生成意图无法写入画布，请检查节点数据",
              true
            );
          }
          state.commitTextEdit();
          const unresolved = new Map(unresolvedActionByNodeIdRef.current);
          unresolved.set(nodeId, intent.actionId);
          publishUnresolved(unresolved);
        }

        const fence = await waitForFence();
        const currentNode = useCanvasStore
          .getState()
          .nodes.find((candidate) => candidate.id === nodeId);
        const currentIntent = currentNode
          ? persistedGenerationIntent(currentNode.data)
          : null;
        if (
          !currentNode ||
          !currentIntent ||
          currentIntent.actionId !== intent.actionId ||
          currentIntent.kind !== currentNode.type
        ) {
          throw new CanvasSubmissionError(
            "等待保存期间节点参数已变化，请重新确认",
            true
          );
        }

        let response: Response;
        try {
          requestDispatched = true;
          response = await fetch("/api/canvas/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              canvasId: fence.canvasId,
              nodeId,
              actionId: intent.actionId,
              observedRev: fence.observedRev,
              writerTag: fence.writerTag,
              intent,
            }),
          });
        } catch (error) {
          throw new CanvasSubmissionError(
            error instanceof Error ? error.message : "生成提交网络中断",
            false
          );
        }
        const body = await responseJson(response);
        if (!response.ok) {
          throw new CanvasSubmissionError(
            apiErrorMessage(body, "生成任务提交失败"),
            isDefinitiveClientResponse(response.status)
          );
        }
        const generation = generationFromResponse(body);
        if (
          !generation ||
          generation.canvasId !== fence.canvasId ||
          generation.actionId !== intent.actionId
        ) {
          throw new CanvasSubmissionError(
            "生成服务响应无法确认，已保留原 actionId 等待核对",
            false
          );
        }
        if (
          generation.nodeId !== nodeId ||
          generation.kind !== currentNode.type
        ) {
          throw new CanvasSubmissionError(
            "该 actionId 已属于另一个生成节点，请重新确认本节点参数",
            true
          );
        }
        if (currentCanvasIdentity() !== fence.canvasId) {
          throw new CanvasSubmissionError(
            "画布已切换，原任务会在返回该画布时自动恢复",
            false
          );
        }

        optimisticActionExpiryRef.current.set(
          generation.actionId,
          Date.now() + 2 * 60_000
        );
        patchNodeGeneration(nodeId, generation);
        const nextGenerations = new Map(generationByNodeIdRef.current);
        nextGenerations.set(nodeId, generation);
        generationByNodeIdRef.current = nextGenerations;
        if (mounted.current) setGenerationByNodeId(nextGenerations);
        const unresolved = new Map(unresolvedActionByNodeIdRef.current);
        unresolved.delete(nodeId);
        publishUnresolved(unresolved);
        automaticRecoveryAttemptedRef.current.delete(intent.actionId);

        toast({
          title:
            generation.status === "completed"
              ? "内容已生成"
              : recovered
                ? "已恢复上次提交"
                : "生成任务已提交",
          description:
            generation.creditCost > 0
              ? `本次计费 ${generation.creditCost} 积分`
              : "本次使用免费额度",
        });
        await refreshAfterCurrent().catch(() => {});
        return generation;
      } catch (error) {
        const submissionError =
          error instanceof CanvasSubmissionError ? error : null;
        const message =
          error instanceof Error ? error.message : "生成任务提交失败";
        const definitive =
          submissionError?.definitive === true || !requestDispatched;
        if (intent && definitive) {
          clearPersistedGenerationIntent(nodeId, intent.actionId);
          const unresolved = new Map(unresolvedActionByNodeIdRef.current);
          if (unresolved.get(nodeId) === intent.actionId) {
            unresolved.delete(nodeId);
            publishUnresolved(unresolved);
          }
        } else if (intent) {
          automaticRecoveryAttemptedRef.current.add(intent.actionId);
          void refreshAfterCurrent().catch(() => {});
        }
        toast({
          title: definitive
            ? "无法开始生成"
            : "提交结果待核对",
          description: definitive
            ? message
            : `${message}。系统已保留原 actionId，只会幂等恢复，不会新建任务或重复扣费。`,
          variant: "destructive",
        });
        return null;
      } finally {
        submittingNodeIdsRef.current.delete(nodeId);
        if (mounted.current) {
          setSubmittingNodeIds(new Set(submittingNodeIdsRef.current));
        }
      }
    },
    [
      currentCanvasIdentity,
      publishUnresolved,
      refreshAfterCurrent,
      waitForFence,
    ]
  );

  useEffect(() => {
    if (!enabled || syncState !== "ready") return;
    const candidate = Array.from(unresolvedActionByNodeId.entries()).find(
      ([nodeId, actionId]) =>
        !submittingNodeIdsRef.current.has(nodeId) &&
        !automaticRecoveryAttemptedRef.current.has(actionId)
    );
    if (!candidate) return;
    automaticRecoveryAttemptedRef.current.add(candidate[1]);
    void submitNode(candidate[0]);
  }, [enabled, submitNode, syncState, unresolvedActionByNodeId]);

  const estimate = useCallback(
    async (
      kind: "image" | "video",
      config: CanvasImageDraftConfig | CanvasVideoDraftConfig,
      signal?: AbortSignal
    ): Promise<CanvasGenerationEstimate | null> => {
      const response = await fetch("/api/canvas/generations/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, config }),
        signal,
      });
      const body = await responseJson(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(body, "积分预估失败"));
      }
      const root = asRecord(body);
      if (root?.success !== true) return null;
      const data = asRecord(root?.data);
      const estimateValue = asRecord(data?.estimate) ?? data;
      if (
        !estimateValue ||
        estimateValue.kind !== kind ||
        (estimateValue.kind !== "image" && estimateValue.kind !== "video") ||
        !Number.isSafeInteger(estimateValue.cost) ||
        (estimateValue.cost as number) < 0 ||
        !Number.isSafeInteger(estimateValue.balance) ||
        (estimateValue.balance as number) < 0 ||
        !optionalString(estimateValue.pricingVersion) ||
        typeof estimateValue.needsConfirmation !== "boolean"
      ) {
        return null;
      }
      return {
        kind: estimateValue.kind,
        cost: estimateValue.cost as number,
        pricingVersion: String(estimateValue.pricingVersion),
        balance: estimateValue.balance as number,
        needsConfirmation: estimateValue.needsConfirmation,
      };
    },
    []
  );

  const value = useMemo<CanvasGenerationContextValue>(
    () => ({
      canvasId,
      enabled,
      syncState,
      syncError,
      submittingNodeIds,
      unresolvedActionByNodeId,
      generationByNodeId,
      submitNode,
      refresh,
      estimate,
    }),
    [
      canvasId,
      enabled,
      syncState,
      syncError,
      submittingNodeIds,
      unresolvedActionByNodeId,
      generationByNodeId,
      submitNode,
      refresh,
      estimate,
    ]
  );

  return (
    <CanvasGenerationContext.Provider value={value}>
      {children}
    </CanvasGenerationContext.Provider>
  );
}

export function useCanvasGeneration(): CanvasGenerationContextValue {
  const value = useContext(CanvasGenerationContext);
  if (!value) {
    throw new Error("useCanvasGeneration must be used inside CanvasGenerationProvider");
  }
  return value;
}

export function useOptionalCanvasGeneration(): CanvasGenerationContextValue | null {
  return useContext(CanvasGenerationContext);
}
