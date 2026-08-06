/**
 * Bounded, owner-checked history extraction for Super Canvas.
 *
 * History is projected only from existing owned rows in generations, products,
 * and blueprints. Full media URLs are reduced to object keys before they can
 * enter a response DTO.
 */

import { isOwnedObjectKey } from "./media-ownership";

export const HISTORY_ASSET_TYPES = ["image", "video", "audio"] as const;
export type HistoryAssetType = (typeof HISTORY_ASSET_TYPES)[number];
export type HistoryQueryType = "all" | HistoryAssetType;

export const HISTORY_ASSET_SOURCES = ["generations", "products", "blueprints"] as const;
export type HistoryAssetSource = (typeof HISTORY_ASSET_SOURCES)[number];

export const HISTORY_DEFAULT_LIMIT = 30;
export const HISTORY_MAX_LIMIT = 100;
export const HISTORY_DIAGNOSTIC_LIMIT = 20;
export const HISTORY_SOURCE_BATCH_SIZE = 128;
export const HISTORY_MAX_SOURCE_ROWS = 2_048;
export const HISTORY_MAX_BATCHES = Math.ceil(HISTORY_MAX_SOURCE_ROWS / HISTORY_SOURCE_BATCH_SIZE) + 1;
export const HISTORY_MAX_ITEMS_PER_ROW = 64;
export const HISTORY_MAX_NORMALIZED_ITEMS = 20_000;

export interface HistoryAssetDimensions {
  width: number;
  height: number;
}

export interface HistoryAssetDto {
  type: HistoryAssetType;
  source: HistoryAssetSource;
  /** Stable identity for one media output, not merely its database row. */
  sourceId: string;
  rowId: string;
  itemId: string;
  createdAt: string;
  title?: string;
  dimensions?: HistoryAssetDimensions;
  duration?: number;
  objectKey: string;
  posterKey?: string;
}

export interface HistoryCursorKey {
  type: HistoryQueryType;
  createdAt: string;
  source: HistoryAssetSource;
  row: string;
  item: string;
}

export interface HistorySourceCursor {
  createdAt: string;
  rowId: string;
}

export interface HistoryBatchRequest {
  source: HistoryAssetSource;
  cursor: HistorySourceCursor | null;
  limit: number;
  batch: number;
}

export type HistoryBatchReader = (request: HistoryBatchRequest) => Promise<readonly unknown[]>;

export interface HistoryQuery {
  type: HistoryQueryType;
  limit: number;
  cursor: HistoryCursorKey | null;
}

export type HistoryQueryResult =
  | { ok: true; value: HistoryQuery }
  | { ok: false; code: "INVALID_QUERY" | "INVALID_CURSOR"; message: string };

export interface HistoryDiagnosticEntry {
  source: HistoryAssetSource;
  code: string;
}

export interface HistoryDiagnostics {
  total: number;
  truncated: boolean;
  entries: HistoryDiagnosticEntry[];
}

export interface HistoryAssetCounts {
  all: number;
  image: number;
  video: number;
  audio: number;
}

export interface HistoryAssetGroup {
  date: string;
  items: HistoryAssetDto[];
}

export interface HistoryPage {
  items: HistoryAssetDto[];
  groups: HistoryAssetGroup[];
  counts: HistoryAssetCounts;
  nextCursor: string | null;
}

interface DiagnosticCollector {
  add(source: HistoryAssetSource, code: string): void;
  snapshot(): HistoryDiagnostics;
}

interface NormalizeInput {
  generations: readonly unknown[];
  products: readonly unknown[];
  blueprints: readonly unknown[];
  userId: string;
  trustedHosts: ReadonlySet<string>;
}

export interface NormalizeResult {
  items: HistoryAssetDto[];
  diagnostics: HistoryDiagnostics;
}

export class HistorySourceTooLargeError extends Error {
  readonly code = "HISTORY_SOURCE_TOO_LARGE";

  constructor(readonly source: HistoryAssetSource) {
    super("History source exceeds bounded limits");
    this.name = "HistorySourceTooLargeError";
  }
}

export class HistorySourceDataError extends Error {
  readonly code = "SOURCE_QUERY_FAILED";

  constructor(readonly source: HistoryAssetSource) {
    super("History source violated its stable keyset contract");
    this.name = "HistorySourceDataError";
  }
}

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mov", "mp4", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]);
const SOURCE_ROW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const OSS_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const OSS_REGION_RE = /^(?:oss-)?[a-z0-9]+(?:-[a-z0-9]+)+$/;
const POSTGRES_UTC_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{1,6})(?:Z|\+00:00)$/;
const CANONICAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DEFAULT_OSS_BUCKET = "tokfactory-videos";
const DEFAULT_OSS_REGION = "oss-cn-beijing";
const DEFAULT_OSS_CUSTOM_DOMAIN = "media.toryxai.com";
const CURSOR_VERSION = 2;
const MAX_QUERY_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function canonicalizeHistoryTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = POSTGRES_UTC_TIMESTAMP_RE.exec(value);
  if (!match) return null;

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, fraction] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  return `${rawYear}-${rawMonth}-${rawDay}T${rawHour}:${rawMinute}:${rawSecond}.${fraction.padEnd(6, "0")}Z`;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return typeof value === "string" &&
    CANONICAL_ISO_RE.test(value) &&
    canonicalizeHistoryTimestamp(value) === value;
}

function normalizeRowId(value: unknown): string | null {
  return typeof value === "string" && SOURCE_ROW_ID_RE.test(value) ? value : null;
}

function normalizeItemId(value: unknown): string | null {
  return typeof value === "string" && ITEM_ID_RE.test(value) ? value : null;
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  const title = value.trim();
  if (!title || /^(?:data:|\/\/)|:\/\//i.test(title)) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(title)) return undefined;
  return title;
}

function normalizePositiveNumber(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
    ? value
    : undefined;
}

function normalizeDimensions(metadata: unknown): HistoryAssetDimensions | undefined {
  if (!isRecord(metadata)) return undefined;
  const nested = isRecord(metadata.dimensions) ? metadata.dimensions : metadata;
  const width = normalizePositiveNumber(nested.width, 32_768);
  const height = normalizePositiveNumber(nested.height, 32_768);
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  return { width, height };
}

function createDiagnosticCollector(): DiagnosticCollector {
  let total = 0;
  const entries: HistoryDiagnosticEntry[] = [];
  return {
    add(source, code) {
      total += 1;
      if (entries.length < HISTORY_DIAGNOSTIC_LIMIT) entries.push({ source, code });
    },
    snapshot() {
      return { total, truncated: total > entries.length, entries: [...entries] };
    },
  };
}

export function describeHistoryObjectKeyRejection(value: unknown): string | null {
  if (typeof value !== "string") return "NOT_STRING";
  if (!value || value.length > 1_024 || value.trim() !== value) return "INVALID_LENGTH_OR_SPACE";
  if (/^data:/i.test(value)) return "DATA_URL";
  if (/^\/\//.test(value) || /:\/\//.test(value)) return "FULL_URL";
  if (/[?#]/.test(value) || value.startsWith("/")) return "URL_COMPONENT";
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(value)) return "INVALID_CHARACTER";
  return null;
}

export function isHistoryOwnedObjectKey(value: unknown, userId: unknown): value is string {
  return describeHistoryObjectKeyRejection(value) === null && isOwnedObjectKey(value, userId);
}

function normalizeConfiguredMediaHost(value: string | undefined): string | null {
  if (!value || value.length > 512 || value.trim() !== value) return null;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function getHistoryTrustedOssHosts(
  env: Record<string, string | undefined> = process.env
): ReadonlySet<string> {
  const hosts = new Set<string>();
  const configuredBucket = env.ALIYUN_OSS_BUCKET;
  const bucket = (configuredBucket === undefined ? DEFAULT_OSS_BUCKET : configuredBucket)
    .trim()
    .toLowerCase();
  const rawRegion = (env.ALIYUN_OSS_REGION === undefined ? DEFAULT_OSS_REGION : env.ALIYUN_OSS_REGION)
    .trim()
    .toLowerCase();
  if (bucket && rawRegion && OSS_BUCKET_RE.test(bucket) && OSS_REGION_RE.test(rawRegion)) {
    const region = rawRegion.startsWith("oss-") ? rawRegion : `oss-${rawRegion}`;
    hosts.add(`${bucket}.${region}.aliyuncs.com`);
  }

  const bucketSwitched = configuredBucket !== undefined && bucket !== DEFAULT_OSS_BUCKET;
  const configuredCustomDomain = env.ALIYUN_OSS_CUSTOM_DOMAIN;
  const customHost = normalizeConfiguredMediaHost(
    configuredCustomDomain === undefined && !bucketSwitched
      ? DEFAULT_OSS_CUSTOM_DOMAIN
      : configuredCustomDomain
  );
  if (customHost) hosts.add(customHost);
  return hosts;
}

export function extractOwnedHistoryObjectKey(
  value: unknown,
  userId: string,
  trustedHosts: ReadonlySet<string>
): string | null {
  if (isHistoryOwnedObjectKey(value, userId)) return value;
  if (typeof value !== "string" || value.length > 4_096 || !/^https:\/\//i.test(value)) return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      !trustedHosts.has(parsed.hostname.toLowerCase())
    ) {
      return null;
    }
    const objectKey = parsed.pathname.slice(1);
    if (!objectKey || objectKey.includes("%")) return null;
    return isHistoryOwnedObjectKey(objectKey, userId) ? objectKey : null;
  } catch {
    return null;
  }
}

function inferTypeFromKey(objectKey: string): HistoryAssetType | null {
  const file = objectKey.split("/").pop() || "";
  const extension = file.includes(".") ? file.split(".").pop()!.toLowerCase() : "";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function parseGenerationType(value: unknown): HistoryAssetType | null {
  return HISTORY_ASSET_TYPES.includes(value as HistoryAssetType) ? (value as HistoryAssetType) : null;
}

function semanticSceneType(kind: unknown): HistoryAssetType | null {
  if (typeof kind !== "string" || kind.length > 80) return null;
  const normalized = kind.toLowerCase();
  if (normalized.includes("audio") || normalized.includes("bgm") || normalized.includes("voice")) return "audio";
  if (normalized.includes("video")) return "video";
  if (normalized.includes("image") || normalized.includes("product")) return "image";
  return null;
}

function createRowBudget(source: HistoryAssetSource): () => void {
  let count = 0;
  return () => {
    count += 1;
    if (count > HISTORY_MAX_ITEMS_PER_ROW) throw new HistorySourceTooLargeError(source);
  };
}

function assertBoundedArray(value: readonly unknown[], source: HistoryAssetSource): void {
  if (value.length > HISTORY_MAX_ITEMS_PER_ROW) throw new HistorySourceTooLargeError(source);
}

function buildAsset(
  source: HistoryAssetSource,
  rowId: string,
  itemId: string,
  createdAt: string,
  type: HistoryAssetType,
  objectKey: string,
  optional: Pick<HistoryAssetDto, "title" | "dimensions" | "duration" | "posterKey"> = {}
): HistoryAssetDto {
  return {
    type,
    source,
    sourceId: `${source}:${rowId}:${itemId}`,
    rowId,
    itemId,
    createdAt,
    objectKey,
    ...(optional.title ? { title: optional.title } : {}),
    ...(optional.dimensions ? { dimensions: optional.dimensions } : {}),
    ...(optional.duration ? { duration: optional.duration } : {}),
    ...(optional.posterKey && optional.posterKey !== objectKey ? { posterKey: optional.posterKey } : {}),
  };
}

function normalizeGeneration(
  value: unknown,
  userId: string,
  trustedHosts: ReadonlySet<string>,
  diagnostics: DiagnosticCollector
): HistoryAssetDto[] {
  const source: HistoryAssetSource = "generations";
  if (!isRecord(value)) {
    diagnostics.add(source, "ROW_NOT_OBJECT");
    return [];
  }
  if (value.user_id !== userId) {
    diagnostics.add(source, "OWNER_MISMATCH");
    return [];
  }
  if (value.status !== "completed") {
    diagnostics.add(source, "GENERATION_NOT_COMPLETED");
    return [];
  }

  const rowId = normalizeRowId(value.id);
  const type = parseGenerationType(value.type ?? value.generation_type);
  const createdAt = canonicalizeHistoryTimestamp(value.created_at);
  if (!rowId || !type || !createdAt) {
    diagnostics.add(source, "ROW_SCHEMA_INVALID");
    return [];
  }

  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const title = normalizeTitle(metadata?.title) ?? normalizeTitle(metadata?.name) ?? normalizeTitle(value.prompt);
  const dimensions = normalizeDimensions(metadata);
  const duration = normalizePositiveNumber(value.duration, 86_400);
  const posterKey = extractOwnedHistoryObjectKey(value.thumbnail_url, userId, trustedHosts) ?? undefined;
  const optional = { title, dimensions, duration, posterKey };
  const result: HistoryAssetDto[] = [];
  const budget = createRowBudget(source);
  let supplied = 0;

  const addCandidate = (raw: unknown, itemId: string) => {
    if (raw === undefined || raw === null || raw === "") return;
    supplied += 1;
    budget();
    const objectKey = extractOwnedHistoryObjectKey(raw, userId, trustedHosts);
    if (!objectKey) {
      diagnostics.add(source, "UNSAFE_OBJECT_KEY");
      return;
    }
    result.push(buildAsset(source, rowId, itemId, createdAt, type, objectKey, optional));
  };

  if (Array.isArray(value.output_urls)) {
    assertBoundedArray(value.output_urls, source);
    value.output_urls.forEach((raw, index) => addCandidate(raw, `0000-output-urls-${String(index).padStart(6, "0")}`));
  } else if (value.output_urls !== undefined && value.output_urls !== null) {
    diagnostics.add(source, "OUTPUT_LIST_INVALID");
  }

  addCandidate(value.output_url, "0001-output-url");
  addCandidate(value.result_url, "0002-result-url");
  addCandidate(value.video_url, "0003-video-url");
  addCandidate(value.image_url, "0004-image-url");
  if (supplied === 0) diagnostics.add(source, "MEDIA_MISSING");
  return result;
}

function normalizeProduct(
  value: unknown,
  userId: string,
  trustedHosts: ReadonlySet<string>,
  diagnostics: DiagnosticCollector
): HistoryAssetDto[] {
  const source: HistoryAssetSource = "products";
  if (!isRecord(value)) {
    diagnostics.add(source, "ROW_NOT_OBJECT");
    return [];
  }
  if (value.user_id !== userId) {
    diagnostics.add(source, "OWNER_MISMATCH");
    return [];
  }
  const rowId = normalizeRowId(value.id);
  const createdAt = canonicalizeHistoryTimestamp(value.created_at);
  if (!rowId || !createdAt) {
    diagnostics.add(source, "ROW_SCHEMA_INVALID");
    return [];
  }

  const title = normalizeTitle(value.name);
  const result: HistoryAssetDto[] = [];
  const budget = createRowBudget(source);
  const addCandidate = (raw: unknown, itemId: string) => {
    if (raw === undefined || raw === null || raw === "") return;
    budget();
    const objectKey = extractOwnedHistoryObjectKey(raw, userId, trustedHosts);
    if (!objectKey) {
      diagnostics.add(source, "UNSAFE_OBJECT_KEY");
      return;
    }
    result.push(buildAsset(source, rowId, itemId, createdAt, "image", objectKey, { title }));
  };

  addCandidate(value.original_image_url, "0000-original");
  if (isRecord(value.processed_images)) {
    const gridImages = value.processed_images.grid_images;
    if (Array.isArray(gridImages)) {
      assertBoundedArray(gridImages, source);
      gridImages.forEach((raw, index) => addCandidate(raw, `0001-grid-${String(index).padStart(6, "0")}`));
    } else if (gridImages !== undefined && gridImages !== null) {
      diagnostics.add(source, "GRID_LIST_INVALID");
    }
  } else if (value.processed_images !== undefined && value.processed_images !== null) {
    diagnostics.add(source, "PROCESSED_IMAGES_INVALID");
  }
  return result;
}

function normalizeBlueprint(
  value: unknown,
  userId: string,
  trustedHosts: ReadonlySet<string>,
  diagnostics: DiagnosticCollector
): HistoryAssetDto[] {
  const source: HistoryAssetSource = "blueprints";
  if (!isRecord(value)) {
    diagnostics.add(source, "ROW_NOT_OBJECT");
    return [];
  }
  if (value.user_id !== userId) {
    diagnostics.add(source, "OWNER_MISMATCH");
    return [];
  }
  const rowId = normalizeRowId(value.id);
  const createdAt = canonicalizeHistoryTimestamp(value.created_at);
  if (!rowId || !createdAt) {
    diagnostics.add(source, "ROW_SCHEMA_INVALID");
    return [];
  }

  const result: HistoryAssetDto[] = [];
  const product = isRecord(value.product) ? value.product : undefined;
  const sourceRef = isRecord(value.source_ref) ? value.source_ref : undefined;
  const title = normalizeTitle(product?.title);
  const budget = createRowBudget(source);

  const addCandidate = (
    raw: unknown,
    itemId: string,
    semanticType: HistoryAssetType | null,
    duration?: number
  ) => {
    if (raw === undefined || raw === null || raw === "") return;
    budget();
    const objectKey = extractOwnedHistoryObjectKey(raw, userId, trustedHosts);
    if (!objectKey) {
      diagnostics.add(source, "UNSAFE_OBJECT_KEY");
      return;
    }
    const type = semanticType ?? inferTypeFromKey(objectKey);
    if (!type) {
      diagnostics.add(source, "MEDIA_TYPE_UNKNOWN");
      return;
    }
    result.push(buildAsset(source, rowId, itemId, createdAt, type, objectKey, { title, duration }));
  };

  // source_ref.url is a media carrier only for reference-video blueprints.
  if (value.source_type === "reference_video") {
    addCandidate(sourceRef?.url, "0000-source-url", "video");
  }
  addCandidate(
    sourceRef?.upload_url,
    "0001-upload-url",
    value.source_type === "reference_video" ? "video" : null
  );

  const sourceAssets = sourceRef?.asset_urls;
  if (Array.isArray(sourceAssets)) {
    assertBoundedArray(sourceAssets, source);
    sourceAssets.forEach((raw, index) =>
      addCandidate(
        raw,
        `0002-source-asset-${String(index).padStart(6, "0")}`,
        value.source_type === "product_images" ? "image" : null
      )
    );
  } else if (sourceAssets !== undefined && sourceAssets !== null) {
    diagnostics.add(source, "ASSET_LIST_INVALID");
  }

  const productImages = product?.images;
  if (Array.isArray(productImages)) {
    assertBoundedArray(productImages, source);
    productImages.forEach((raw, index) =>
      addCandidate(raw, `0003-product-image-${String(index).padStart(6, "0")}`, "image")
    );
  } else if (productImages !== undefined && productImages !== null) {
    diagnostics.add(source, "PRODUCT_IMAGES_INVALID");
  }

  if (Array.isArray(value.scenes)) {
    assertBoundedArray(value.scenes, source);
    value.scenes.forEach((rawScene, index) => {
      if (!isRecord(rawScene)) {
        diagnostics.add(source, "SCENE_INVALID");
        return;
      }
      const slot = isRecord(rawScene.slot) ? rawScene.slot : undefined;
      const durationMs = normalizePositiveNumber(rawScene.duration_ms, 86_400_000);
      addCandidate(
        slot?.asset_ref,
        `0004-scene-slot-${String(index).padStart(6, "0")}`,
        semanticSceneType(slot?.kind),
        durationMs ? durationMs / 1_000 : undefined
      );
      // scenes.visual is descriptive copy, never a media carrier or diagnostic.
    });
  } else if (value.scenes !== undefined && value.scenes !== null) {
    diagnostics.add(source, "SCENES_INVALID");
  }

  const globals = isRecord(value.globals) ? value.globals : undefined;
  ["audio_key", "audio_url", "bgm_key", "bgm_url", "voice_key", "voice_url"].forEach((key, index) => {
    addCandidate(globals?.[key], `0005-global-audio-${String(index).padStart(2, "0")}`, "audio");
  });
  return result;
}

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSource(a: HistoryAssetSource, b: HistoryAssetSource): number {
  return HISTORY_ASSET_SOURCES.indexOf(a) - HISTORY_ASSET_SOURCES.indexOf(b);
}

type HistoryComparable = Pick<HistoryAssetDto, "createdAt" | "source" | "rowId" | "itemId">;

export function compareHistoryAssets(a: HistoryComparable, b: HistoryComparable): number {
  const byDate = compareAscii(b.createdAt, a.createdAt);
  if (byDate !== 0) return byDate;
  const bySource = compareSource(a.source, b.source);
  if (bySource !== 0) return bySource;
  const byRow = compareAscii(a.rowId, b.rowId);
  return byRow !== 0 ? byRow : compareAscii(a.itemId, b.itemId);
}

function compareAssetToCursor(item: HistoryAssetDto, cursor: HistoryCursorKey): number {
  return compareHistoryAssets(item, {
    createdAt: cursor.createdAt,
    source: cursor.source,
    rowId: cursor.row,
    itemId: cursor.item,
  });
}

function assertSourceRowsBounded(source: HistoryAssetSource, rows: readonly unknown[]): void {
  if (rows.length > HISTORY_MAX_SOURCE_ROWS) throw new HistorySourceTooLargeError(source);
}

export function normalizeHistorySources(input: NormalizeInput): NormalizeResult {
  assertSourceRowsBounded("generations", input.generations);
  assertSourceRowsBounded("products", input.products);
  assertSourceRowsBounded("blueprints", input.blueprints);

  const diagnostics = createDiagnosticCollector();
  const normalized: HistoryAssetDto[] = [];
  const append = (source: HistoryAssetSource, items: readonly HistoryAssetDto[]) => {
    if (normalized.length + items.length > HISTORY_MAX_NORMALIZED_ITEMS) {
      throw new HistorySourceTooLargeError(source);
    }
    normalized.push(...items);
  };

  for (const row of input.generations) {
    append("generations", normalizeGeneration(row, input.userId, input.trustedHosts, diagnostics));
  }
  for (const row of input.products) {
    append("products", normalizeProduct(row, input.userId, input.trustedHosts, diagnostics));
  }
  for (const row of input.blueprints) {
    append("blueprints", normalizeBlueprint(row, input.userId, input.trustedHosts, diagnostics));
  }

  normalized.sort(compareHistoryAssets);
  const byObjectKey = new Map<string, HistoryAssetDto>();
  const items: HistoryAssetDto[] = [];
  for (const item of normalized) {
    const existing = byObjectKey.get(item.objectKey);
    if (!existing) {
      byObjectKey.set(item.objectKey, item);
      items.push(item);
      continue;
    }
    if (!existing.title && item.title) existing.title = item.title;
    if (!existing.dimensions && item.dimensions) existing.dimensions = item.dimensions;
    if (!existing.duration && item.duration) existing.duration = item.duration;
    if (!existing.posterKey && item.posterKey) existing.posterKey = item.posterKey;
  }
  return { items, diagnostics: diagnostics.snapshot() };
}

function sourceCursorFromRow(value: unknown, source: HistoryAssetSource): HistorySourceCursor {
  if (!isRecord(value)) throw new HistorySourceDataError(source);
  const createdAt = canonicalizeHistoryTimestamp(value.created_at);
  const rowId = normalizeRowId(value.id);
  if (!createdAt || !rowId) throw new HistorySourceDataError(source);
  return { createdAt, rowId };
}

function isCursorAfter(candidate: HistorySourceCursor, previous: HistorySourceCursor): boolean {
  return candidate.createdAt < previous.createdAt ||
    (candidate.createdAt === previous.createdAt && candidate.rowId > previous.rowId);
}

export function buildHistorySourceKeysetFilter(
  source: HistoryAssetSource,
  cursor: HistorySourceCursor
): string {
  if (
    !isCanonicalIsoDate(cursor.createdAt) ||
    !normalizeRowId(cursor.rowId) ||
    /[(),]/.test(cursor.createdAt) ||
    /[(),.]/.test(cursor.rowId)
  ) {
    throw new HistorySourceDataError(source);
  }
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.rowId})`;
}

export async function readBoundedHistorySourceRows(
  source: HistoryAssetSource,
  readBatch: HistoryBatchReader
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor: HistorySourceCursor | null = null;

  for (let batch = 0; batch < HISTORY_MAX_BATCHES; batch += 1) {
    const remaining = HISTORY_MAX_SOURCE_ROWS - rows.length;
    const limit = remaining > 0 ? Math.min(HISTORY_SOURCE_BATCH_SIZE, remaining) : 1;
    const data = await readBatch({ source, cursor, limit, batch });
    if (!Array.isArray(data) || data.length > limit) throw new HistorySourceDataError(source);

    if (remaining === 0) {
      if (data.length > 0) throw new HistorySourceTooLargeError(source);
      return rows;
    }
    if (data.length === 0) return rows;

    rows.push(...data);
    if (data.length < limit) return rows;
    const nextCursor = sourceCursorFromRow(data[data.length - 1], source);
    if (cursor && !isCursorAfter(nextCursor, cursor)) throw new HistorySourceDataError(source);
    cursor = nextCursor;
  }

  throw new HistorySourceTooLargeError(source);
}

export function encodeHistoryCursor(value: HistoryCursorKey): string {
  const createdAt = canonicalizeHistoryTimestamp(value.createdAt);
  const row = normalizeRowId(value.row);
  const item = normalizeItemId(value.item);
  if (
    !HISTORY_ASSET_TYPES.includes(value.type as HistoryAssetType) && value.type !== "all" ||
    !createdAt ||
    createdAt !== value.createdAt ||
    !HISTORY_ASSET_SOURCES.includes(value.source) ||
    !row ||
    !item
  ) {
    throw new Error("Invalid history cursor key");
  }
  return Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    type: value.type,
    createdAt,
    source: value.source,
    row,
    item,
  }), "utf8").toString("base64url");
}

export function decodeHistoryCursor(value: unknown, expectedType?: HistoryQueryType): HistoryCursorKey | null {
  if (typeof value !== "string" || !value || value.length > 1_024 || !BASE64URL_RE.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(parsed) || !hasExactKeys(parsed, ["v", "type", "createdAt", "source", "row", "item"])) {
      return null;
    }
    const type = parsed.type;
    const createdAt = canonicalizeHistoryTimestamp(parsed.createdAt);
    const row = normalizeRowId(parsed.row);
    const item = normalizeItemId(parsed.item);
    if (
      parsed.v !== CURSOR_VERSION ||
      (type !== "all" && !HISTORY_ASSET_TYPES.includes(type as HistoryAssetType)) ||
      (expectedType !== undefined && type !== expectedType) ||
      !createdAt ||
      createdAt !== parsed.createdAt ||
      !HISTORY_ASSET_SOURCES.includes(parsed.source as HistoryAssetSource) ||
      !row ||
      !item
    ) {
      return null;
    }
    const cursor: HistoryCursorKey = {
      type: type as HistoryQueryType,
      createdAt,
      source: parsed.source as HistoryAssetSource,
      row,
      item,
    };
    return encodeHistoryCursor(cursor) === value ? cursor : null;
  } catch {
    return null;
  }
}

function queryEntries(input: URLSearchParams | string): [string, string][] | null {
  if (typeof input !== "string") return Array.from(input.entries());
  if (input.length > MAX_QUERY_LENGTH || input.startsWith("?") || input.includes("#")) return null;
  if (input === "") return [];

  const entries: [string, string][] = [];
  for (const pair of input.split("&")) {
    if (!pair) return null;
    const separator = pair.indexOf("=");
    if (separator <= 0 || separator !== pair.lastIndexOf("=")) return null;
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!/^[a-z]+$/.test(key) || !value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    entries.push([key, value]);
  }
  return entries;
}

export function parseHistoryQuery(input: URLSearchParams | string): HistoryQueryResult {
  const entries = queryEntries(input);
  if (!entries) return { ok: false, code: "INVALID_QUERY", message: "Invalid history query" };
  const values = new Map<string, string>();
  const allowed = new Set(["type", "limit", "cursor"]);
  for (const [key, value] of entries) {
    if (!allowed.has(key) || values.has(key) || !value) {
      return { ok: false, code: "INVALID_QUERY", message: "Invalid history query" };
    }
    values.set(key, value);
  }

  const rawType = values.get("type") ?? "all";
  if (rawType !== "all" && !HISTORY_ASSET_TYPES.includes(rawType as HistoryAssetType)) {
    return { ok: false, code: "INVALID_QUERY", message: "Invalid history type" };
  }
  const type = rawType as HistoryQueryType;

  const rawLimit = values.get("limit");
  let limit = HISTORY_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[1-9][0-9]*$/.test(rawLimit)) {
      return { ok: false, code: "INVALID_QUERY", message: "Invalid history limit" };
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > HISTORY_MAX_LIMIT) {
      return { ok: false, code: "INVALID_QUERY", message: "Invalid history limit" };
    }
  }

  const rawCursor = values.get("cursor");
  const cursor = rawCursor === undefined ? null : decodeHistoryCursor(rawCursor, type);
  if (rawCursor !== undefined && !cursor) {
    return { ok: false, code: "INVALID_CURSOR", message: "Invalid history cursor" };
  }
  return { ok: true, value: { type, limit, cursor } };
}

function buildCounts(items: readonly HistoryAssetDto[]): HistoryAssetCounts {
  const counts: HistoryAssetCounts = { all: items.length, image: 0, video: 0, audio: 0 };
  for (const item of items) counts[item.type] += 1;
  return counts;
}

function buildGroups(items: readonly HistoryAssetDto[]): HistoryAssetGroup[] {
  const groups: HistoryAssetGroup[] = [];
  for (const item of items) {
    const date = item.createdAt.slice(0, 10);
    const current = groups[groups.length - 1];
    if (!current || current.date !== date) groups.push({ date, items: [item] });
    else current.items.push(item);
  }
  return groups;
}

export function paginateHistoryAssets(items: readonly HistoryAssetDto[], query: HistoryQuery): HistoryPage {
  if (items.length > HISTORY_MAX_NORMALIZED_ITEMS) throw new HistorySourceTooLargeError("generations");
  const sorted = [...items].sort(compareHistoryAssets);
  const counts = buildCounts(sorted);
  const candidates: HistoryAssetDto[] = [];

  for (const item of sorted) {
    if (query.type !== "all" && item.type !== query.type) continue;
    if (query.cursor && compareAssetToCursor(item, query.cursor) <= 0) continue;
    candidates.push(item);
    if (candidates.length > query.limit) break;
  }

  const hasMore = candidates.length > query.limit;
  const pageItems = hasMore ? candidates.slice(0, query.limit) : candidates;
  const last = pageItems[pageItems.length - 1];
  return {
    items: pageItems,
    groups: buildGroups(pageItems),
    counts,
    nextCursor: hasMore && last
      ? encodeHistoryCursor({
          type: query.type,
          createdAt: last.createdAt,
          source: last.source,
          row: last.rowId,
          item: last.itemId,
        })
      : null,
  };
}
