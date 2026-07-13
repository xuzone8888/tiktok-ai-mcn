// history-client.ts
//
// Client-safe, pure module for consuming the shipped D6 history feed
// (GET /api/canvas/history?type=image|video|audio&limit=30[&cursor=...]).
//
// Zero React / UI / network side effects. Pure functions and small
// stateless value objects only. All media fields are OSS object keys,
// never URLs. Parsing is defensive: every reflective read goes through
// own-data-descriptor / plain-record accessors so getters, proxies, and
// prototype-polluted inputs fail closed rather than smuggling values, and
// every reflection / iteration entrypoint is wrapped so a hostile Proxy
// input returns a parse error and never throws. Error messages are static
// client-side strings and never echo raw server values.
//
// ASCII comments only.

import { isOssObjectKey } from "@/lib/canvas/schema";

// ---------------------------------------------------------------------------
// Public runtime interfaces
// ---------------------------------------------------------------------------

export type HistoryType = "image" | "video" | "audio";
export type HistorySource = "generations" | "products" | "blueprints";
export type HistoryHealth = "available" | "unavailable";

// A single validated history row. Media-bearing fields (objectKey,
// posterKey) are always OSS object keys; posterKey is optional.
export interface HistoryItem {
  readonly type: HistoryType;
  readonly source: HistorySource;
  readonly sourceId: string;
  readonly rowId: string;
  readonly itemId: string;
  readonly createdAt: string; // canonical UTC ISO-8601 microseconds + 'Z'
  readonly title?: string;
  readonly dimensions?: HistoryDimensions;
  readonly duration?: number; // seconds, finite, > 0
  readonly objectKey: string;
  readonly posterKey?: string;
}

export interface HistoryDimensions {
  readonly width: number;
  readonly height: number;
}

// Server-provided local-date grouping. `date` is "YYYY-MM-DD" and equals
// each member item's createdAt date prefix; flattened group items exactly
// reproduce the top-level items in the same order.
export interface HistoryGroup {
  readonly date: string; // "YYYY-MM-DD"
  readonly items: readonly HistoryItem[];
}

export interface HistoryCounts {
  readonly all: number;
  readonly image: number;
  readonly video: number;
  readonly audio: number;
}

// Per-source health map (an object, not an array; no error strings).
export interface HistorySourceHealth {
  readonly health: HistoryHealth;
}

export interface HistorySources {
  readonly generations: HistorySourceHealth;
  readonly products: HistorySourceHealth;
  readonly blueprints: HistorySourceHealth;
}

export interface HistoryDiagnosticEntry {
  readonly source: HistorySource;
  readonly code: string; // bounded safe ASCII token
}

export interface HistoryDiagnostics {
  readonly total: number;
  readonly truncated: boolean; // equals total > entries.length
  readonly entries: readonly HistoryDiagnosticEntry[]; // <= 20
}

// The fully validated page payload extracted from a D6 response.
export interface HistoryPage {
  readonly type: HistoryType;
  readonly items: readonly HistoryItem[];
  readonly groups: readonly HistoryGroup[];
  readonly counts: HistoryCounts;
  readonly nextCursor: string | null;
  readonly diagnostics: HistoryDiagnostics;
  readonly sources: HistorySources;
}

// Discriminated parse result.
export type ParseHistoryResult =
  | { readonly ok: true; readonly page: HistoryPage }
  | { readonly ok: false; readonly code: ParseErrorCode; readonly message: string };

export type ParseErrorCode =
  | "internal"
  | "not_a_record"
  | "not_success"
  | "bad_data"
  | "bad_type"
  | "bad_items"
  | "too_many_items"
  | "bad_item"
  | "wrong_type"
  | "bad_source"
  | "bad_id"
  | "bad_timestamp"
  | "bad_media"
  | "bad_dimensions"
  | "bad_duration"
  | "bad_title"
  | "duplicate_source_id"
  | "duplicate_object_key"
  | "bad_counts"
  | "count_mismatch"
  | "bad_cursor"
  | "bad_diagnostics"
  | "bad_sources"
  | "bad_groups";

// Hard ceiling. The server contract caps a page at 30, but we defend
// against a lying/compromised server up to a strict absolute maximum.
const MAX_ITEMS_PER_PAGE = 100;
export const CANONICAL_PAGE_LIMIT = 30;

// ---------------------------------------------------------------------------
// Low-level defensive readers
//
// These treat every input as hostile. We never trust prototype chains,
// getters, or proxies: only own DATA properties count (no get/set), and
// every reflection / iteration call is wrapped so a throwing trap becomes
// a clean "not present" / null rather than an exception.
// ---------------------------------------------------------------------------

// True only for a plain object literal or null-prototype record. Arrays,
// functions, class instances, boxed primitives, and hostile proxies whose
// traps throw are all rejected (fail closed).
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  let isArr: boolean;
  try {
    isArr = Array.isArray(value);
  } catch {
    return false;
  }
  if (isArr) return false;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value as object);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

// Read an own DATA property. Returns { present, value }. If the key is
// absent, inherited, backed by an accessor (get/set), or any reflection
// call throws, it is treated as not present so accessors/proxies cannot
// inject side effects or exceptions.
// One single descriptor read, no [[Get]] and no hasOwnProperty.
//  - present: a safe own DATA descriptor whose materialized value is usable.
//  - existed: the key is physically present in some form. A throwing
//    getOwnPropertyDescriptor trap, an accessor descriptor, or a descriptor
//    with no value slot all set existed=true / present=false, so an
//    optional field backed by such a descriptor is REJECTED by its caller
//    (never silently treated as absent). Only a genuinely undefined
//    descriptor (no trap) is treated as absent.
function ownData(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; existed: boolean; value: unknown } {
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    // A throwing trap counts as an existing-but-unsafe key.
    return { present: false, existed: true, value: undefined };
  }
  if (desc === undefined) {
    return { present: false, existed: false, value: undefined };
  }
  if ("get" in desc || "set" in desc || !("value" in desc)) {
    return { present: false, existed: true, value: undefined };
  }
  // desc.value is a materialized data slot; reading it triggers no trap.
  return { present: true, existed: true, value: desc.value };
}

// Confirm the record's own keys are all inside the allowed set, considering
// ALL own keys. Any own symbol key is rejected outright, and a throwing
// enumeration trap fails closed.
function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  let names: string[];
  let symbols: symbol[];
  try {
    names = Object.getOwnPropertyNames(record);
    symbols = Object.getOwnPropertySymbols(record);
  } catch {
    return false;
  }
  if (symbols.length > 0) return false;
  const allowedSet = new Set(allowed);
  for (const key of names) {
    if (!allowedSet.has(key)) return false;
  }
  return true;
}

// A canonical array-index string ("0".."len-1", no sign, no leading zero),
// or -1 if the string is not one. "length" is handled separately.
function canonicalIndex(name: string, len: number): number {
  if (name.length === 0) return -1;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return -1; // not a digit
  }
  if (name.length > 1 && name.charCodeAt(0) === 0x30) return -1; // leading zero
  const n = Number(name);
  if (!Number.isSafeInteger(n) || n < 0 || n >= len) return -1;
  return n;
}

// Safely materialize an array value into a plain unknown[]. Accepts ONLY a
// normal dense JSON-style array: a real array with an own DATA `length`
// descriptor, an own DATA descriptor for every index 0..length-1 (no holes,
// no accessors), and no extra string keys or any symbol keys. Every value is
// read from its materialized descriptor slot, so no element getter body runs
// and no [[Get]] / index trap is ever invoked. All reflection traps fail
// closed (return null).
function safeArray(value: unknown): unknown[] | null {
  let isArr: boolean;
  try {
    isArr = Array.isArray(value);
  } catch {
    return null;
  }
  if (!isArr) return null;

  // length must be an own data property with a safe non-negative integer.
  let lenDesc: PropertyDescriptor | undefined;
  try {
    lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    return null;
  }
  if (!lenDesc || "get" in lenDesc || "set" in lenDesc || !("value" in lenDesc)) {
    return null;
  }
  const len = lenDesc.value;
  if (typeof len !== "number" || !Number.isSafeInteger(len) || len < 0) return null;

  // Enumerate every own key exactly once; reject symbols outright.
  let names: string[];
  let symbols: symbol[];
  try {
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    return null;
  }
  if (symbols.length > 0) return null;

  // Every non-"length" own key must be a canonical index, dense and in
  // ascending order, each backed by an own data descriptor.
  const out: unknown[] = [];
  let expected = 0;
  for (const name of names) {
    if (name === "length") continue;
    const idx = canonicalIndex(name, len);
    if (idx < 0) return null; // extra / non-index string key
    if (idx !== expected) return null; // hole or out-of-order index
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(value, name);
    } catch {
      return null;
    }
    if (!desc || "get" in desc || "set" in desc || !("value" in desc)) {
      return null; // accessor / unsafe index descriptor
    }
    out.push(desc.value);
    expected += 1;
  }
  if (expected !== len) return null; // sparse / missing trailing indices
  return out;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

// A safe integer within an inclusive, non-negative range.
function isSafeCount(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

// D6 canonical identity contract. rowId is a lowercase hyphenated UUID;
// itemId is a bounded display-safe token; sourceId is exactly the tuple
// `${source}:${rowId}:${itemId}` (validated at the call site).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function isRowId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isItemId(value: unknown): value is string {
  return typeof value === "string" && ITEM_ID_RE.test(value);
}

// An optional display title: non-empty, already trimmed, bounded, free of
// C0/DEL controls, and never a URL-ish string (no data:, // prefix, ://).
function isValidTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_TITLE_LENGTH) return false;
  if (value.trim() !== value) return false; // must already be trimmed
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false; // no C0 / DEL
  }
  const lower = value.toLowerCase();
  if (lower.startsWith("data:")) return false;
  if (value.startsWith("//")) return false;
  if (lower.includes("://")) return false;
  return true;
}

// Diagnostic codes are short, safe ASCII tokens.
function isSafeCodeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
}

// Canonical six-digit UTC microseconds: YYYY-MM-DDTHH:mm:ss.ffffffZ, with
// real calendar validity (rejects e.g. 2026-13-40 or Feb 30 via UTC
// round-trip of the component fields). Microseconds 000000-999999 are all
// valid and do not affect calendar validity.
function isCanonicalUtcMicros(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (y < 1 || mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || s > 59) return false;
  // Date.UTC treats years 0..99 as 1900..1999. Build from a neutral epoch and
  // set the full year explicitly so this validator matches D6's year >= 1
  // timestamp contract even for synthetic/imported early dates.
  const back = new Date(0);
  back.setUTCFullYear(y, mo - 1, d);
  back.setUTCHours(h, mi, s, 0);
  if (!Number.isFinite(back.getTime())) return false;
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === d &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === mi &&
    back.getUTCSeconds() === s
  );
}

// Media values must be OSS object keys, never URLs or data URIs.
function isMediaKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  const lowered = value.toLowerCase();
  if (
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("blob:") ||
    lowered.startsWith("//")
  ) {
    return false;
  }
  return isOssObjectKey(value);
}

const VALID_TYPES: readonly HistoryType[] = ["image", "video", "audio"];
const VALID_SOURCES: readonly HistorySource[] = ["generations", "products", "blueprints"];

function isHistoryType(value: unknown): value is HistoryType {
  return typeof value === "string" && (VALID_TYPES as readonly string[]).includes(value);
}

function isHistorySource(value: unknown): value is HistorySource {
  return typeof value === "string" && (VALID_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Cursor validation
//
// nextCursor is either null or a canonical base64url token. We do not
// decode it (opaque to the client), but we enforce shape so a hostile
// value cannot smuggle path/query characters into a later request URL.
// ---------------------------------------------------------------------------

// base64url alphabet value (A-Z=0..25, a-z=26..51, 0-9=52..61, -=62, _=63).
// Assumes the char already passed the alphabet regex.
function base64urlValue(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 0x41 && c <= 0x5a) return c - 0x41; // A-Z
  if (c >= 0x61 && c <= 0x7a) return c - 0x61 + 26; // a-z
  if (c >= 0x30 && c <= 0x39) return c - 0x30 + 52; // 0-9
  if (c === 0x2d) return 62; // '-'
  return 63; // '_'
}

// Canonical unpadded base64url: browser-safe alphabet, no padding, length
// mod 4 never 1, and unused trailing bits are zero (a 2-char tail's final
// symbol has its low 4 bits zero; a 3-char tail's final symbol has its low
// 2 bits zero). The token stays opaque; we never decode it.
function isCanonicalCursor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Match the D6 decoder's exact 1,024-character ceiling. Accepting a longer
  // hostile cursor here would only turn the next otherwise-valid request into
  // a server-side INVALID_CURSOR response.
  if (value.length === 0 || value.length > 1024) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const rem = value.length % 4;
  if (rem === 1) return false;
  if (rem === 2) {
    // 2 chars encode 1 byte; the last symbol's low 4 bits must be zero.
    if ((base64urlValue(value[value.length - 1]) & 0x0f) !== 0) return false;
  } else if (rem === 3) {
    // 3 chars encode 2 bytes; the last symbol's low 2 bits must be zero.
    if ((base64urlValue(value[value.length - 1]) & 0x03) !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// parseHistoryPagePayload
// ---------------------------------------------------------------------------

function fail(code: ParseErrorCode, message: string): ParseHistoryResult {
  return { ok: false, code, message };
}

const ITEM_KEYS = [
  "type",
  "source",
  "sourceId",
  "rowId",
  "itemId",
  "createdAt",
  "title",
  "dimensions",
  "duration",
  "objectKey",
  "posterKey",
] as const;

const DIMENSION_KEYS = ["width", "height"] as const;
const COUNTS_KEYS = ["all", "image", "video", "audio"] as const;
const DIAG_KEYS = ["total", "truncated", "entries"] as const;
const DIAG_ENTRY_KEYS = ["source", "code"] as const;
const SOURCES_KEYS = ["generations", "products", "blueprints"] as const;
const HEALTH_KEYS = ["health"] as const;
const GROUP_KEYS = ["date", "items"] as const;
const DATA_KEYS = [
  "items",
  "groups",
  "counts",
  "nextCursor",
  "diagnostics",
  "sources",
] as const;
const ENVELOPE_KEYS = ["success", "data"] as const;

const MAX_DIMENSION = 32768;
const MAX_DURATION_SECONDS = 86400;
const MAX_TITLE_LENGTH = 200;
const MAX_DIAG_ENTRIES = 20;
const MAX_COUNT = 20000;

function parseDimensions(value: unknown): HistoryDimensions | null {
  if (!isPlainRecord(value)) return null;
  if (!hasOnlyKeys(value, DIMENSION_KEYS)) return null;
  const w = ownData(value, "width");
  const h = ownData(value, "height");
  if (!w.present || !h.present) return null;
  if (
    typeof w.value !== "number" ||
    typeof h.value !== "number" ||
    !Number.isSafeInteger(w.value) ||
    !Number.isSafeInteger(h.value) ||
    w.value <= 0 ||
    h.value <= 0 ||
    w.value > MAX_DIMENSION ||
    h.value > MAX_DIMENSION
  ) {
    return null;
  }
  return { width: w.value, height: h.value };
}

function parseItem(
  value: unknown,
  expectedType: HistoryType,
): ParseHistoryResult | HistoryItem {
  if (!isPlainRecord(value)) return fail("bad_item", "item is not a plain record");
  if (!hasOnlyKeys(value, ITEM_KEYS)) return fail("bad_item", "item has unknown keys");

  const typeR = ownData(value, "type");
  if (!typeR.present || !isHistoryType(typeR.value)) {
    return fail("bad_type", "item.type invalid");
  }
  if (typeR.value !== expectedType) {
    return fail("wrong_type", "item.type does not match requested type");
  }

  const sourceR = ownData(value, "source");
  if (!sourceR.present || !isHistorySource(sourceR.value)) {
    return fail("bad_source", "item.source invalid");
  }
  const source = sourceR.value;

  const rowIdR = ownData(value, "rowId");
  if (!rowIdR.present || !isRowId(rowIdR.value)) {
    return fail("bad_id", "item.rowId is not a canonical UUID");
  }
  const rowId = rowIdR.value;

  const itemIdR = ownData(value, "itemId");
  if (!itemIdR.present || !isItemId(itemIdR.value)) {
    return fail("bad_id", "item.itemId is not a valid identifier");
  }
  const itemId = itemIdR.value;

  // sourceId must be exactly the canonical identity tuple.
  const sourceIdR = ownData(value, "sourceId");
  if (
    !sourceIdR.present ||
    typeof sourceIdR.value !== "string" ||
    sourceIdR.value !== `${source}:${rowId}:${itemId}`
  ) {
    return fail("bad_id", "item.sourceId is not source:rowId:itemId");
  }
  const sourceId = sourceIdR.value;

  const createdAtR = ownData(value, "createdAt");
  if (!createdAtR.present || !isCanonicalUtcMicros(createdAtR.value)) {
    return fail("bad_timestamp", "item.createdAt is not a canonical UTC timestamp");
  }

  const objectKeyR = ownData(value, "objectKey");
  if (!objectKeyR.present || !isMediaKey(objectKeyR.value)) {
    return fail("bad_media", "item.objectKey is not an OSS object key");
  }
  const objectKey = objectKeyR.value;

  const item: {
    type: HistoryType;
    source: HistorySource;
    sourceId: string;
    rowId: string;
    itemId: string;
    createdAt: string;
    objectKey: string;
    title?: string;
    dimensions?: HistoryDimensions;
    duration?: number;
    posterKey?: string;
  } = {
    type: typeR.value,
    source,
    sourceId,
    rowId,
    itemId,
    createdAt: createdAtR.value,
    objectKey,
  };

  // Optional keys: a physically-present key backed by an accessor / unsafe
  // descriptor (existed but not present) rejects the item; it is never
  // silently skipped.
  const titleR = ownData(value, "title");
  if (titleR.existed && !titleR.present) {
    return fail("bad_title", "item.title has an unsafe descriptor");
  }
  if (titleR.present) {
    if (!isValidTitle(titleR.value)) {
      return fail("bad_title", "item.title invalid");
    }
    item.title = titleR.value;
  }

  const dimsR = ownData(value, "dimensions");
  if (dimsR.existed && !dimsR.present) {
    return fail("bad_dimensions", "item.dimensions has an unsafe descriptor");
  }
  if (dimsR.present) {
    const dims = parseDimensions(dimsR.value);
    if (!dims) return fail("bad_dimensions", "item.dimensions invalid");
    item.dimensions = dims;
  }

  const durationR = ownData(value, "duration");
  if (durationR.existed && !durationR.present) {
    return fail("bad_duration", "item.duration has an unsafe descriptor");
  }
  if (durationR.present) {
    if (
      typeof durationR.value !== "number" ||
      !Number.isFinite(durationR.value) ||
      durationR.value <= 0 ||
      durationR.value > MAX_DURATION_SECONDS
    ) {
      return fail("bad_duration", "item.duration invalid");
    }
    item.duration = durationR.value;
  }

  const posterR = ownData(value, "posterKey");
  if (posterR.existed && !posterR.present) {
    return fail("bad_media", "item.posterKey has an unsafe descriptor");
  }
  if (posterR.present) {
    if (!isMediaKey(posterR.value)) {
      return fail("bad_media", "item.posterKey is not an OSS object key");
    }
    if (posterR.value === objectKey) {
      return fail("bad_media", "item.posterKey must differ from objectKey");
    }
    item.posterKey = posterR.value;
  }

  return item as HistoryItem;
}

function isParseError(value: ParseHistoryResult | HistoryItem): value is ParseHistoryResult {
  return (value as ParseHistoryResult).ok === false;
}

// Deep equality across all validated item fields (used to prove group
// items exactly reproduce top-level items).
function itemsEqual(a: HistoryItem, b: HistoryItem): boolean {
  if (
    a.type !== b.type ||
    a.source !== b.source ||
    a.sourceId !== b.sourceId ||
    a.rowId !== b.rowId ||
    a.itemId !== b.itemId ||
    a.createdAt !== b.createdAt ||
    a.objectKey !== b.objectKey
  ) {
    return false;
  }
  if ((a.title ?? undefined) !== (b.title ?? undefined)) return false;
  if ((a.duration ?? undefined) !== (b.duration ?? undefined)) return false;
  if ((a.posterKey ?? undefined) !== (b.posterKey ?? undefined)) return false;
  const ad = a.dimensions;
  const bd = b.dimensions;
  if ((ad === undefined) !== (bd === undefined)) return false;
  if (ad && bd && (ad.width !== bd.width || ad.height !== bd.height)) return false;
  return true;
}

function parseCounts(value: unknown): HistoryCounts | null {
  if (!isPlainRecord(value)) return null;
  if (!hasOnlyKeys(value, COUNTS_KEYS)) return null;
  const out: Partial<Record<(typeof COUNTS_KEYS)[number], number>> = {};
  for (const key of COUNTS_KEYS) {
    const r = ownData(value, key);
    if (!r.present || !isSafeCount(r.value, MAX_COUNT)) return null;
    out[key] = r.value as number;
  }
  return {
    all: out.all as number,
    image: out.image as number,
    video: out.video as number,
    audio: out.audio as number,
  };
}

function parseDiagEntry(value: unknown): HistoryDiagnosticEntry | null {
  if (!isPlainRecord(value)) return null;
  if (!hasOnlyKeys(value, DIAG_ENTRY_KEYS)) return null;
  const sourceR = ownData(value, "source");
  const codeR = ownData(value, "code");
  if (!sourceR.present || !isHistorySource(sourceR.value)) return null;
  if (!codeR.present || !isSafeCodeToken(codeR.value)) return null;
  return { source: sourceR.value, code: codeR.value };
}

function parseDiagnostics(value: unknown): HistoryDiagnostics | null {
  if (!isPlainRecord(value)) return null;
  if (!hasOnlyKeys(value, DIAG_KEYS)) return null;
  const totalR = ownData(value, "total");
  const truncR = ownData(value, "truncated");
  const entriesR = ownData(value, "entries");
  if (!totalR.present || !isSafeCount(totalR.value)) return null;
  if (!truncR.present || !isBoolean(truncR.value)) return null;
  if (!entriesR.present) return null;
  const total: number = totalR.value;
  const truncated: boolean = truncR.value;
  const rawEntries = safeArray(entriesR.value);
  if (!rawEntries) return null;
  if (rawEntries.length > MAX_DIAG_ENTRIES) return null;
  const entries: HistoryDiagnosticEntry[] = [];
  for (const raw of rawEntries) {
    const entry = parseDiagEntry(raw);
    if (!entry) return null;
    entries.push(entry);
  }
  // total must cover the returned entries, and truncated is exactly the
  // "there were more than we returned" flag.
  if (total < entries.length) return null;
  if (truncated !== (total > entries.length)) return null;
  return { total, truncated, entries };
}

// Read one source-health record, requiring its health to be within the
// exact allowed set for that source. generations and blueprints may only
// be "available"; products may be "available" or "unavailable".
function readHealth(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly HistoryHealth[],
): HistorySourceHealth | null {
  const r = ownData(record, key);
  if (!r.present || !isPlainRecord(r.value)) return null;
  if (!hasOnlyKeys(r.value, HEALTH_KEYS)) return null;
  const h = ownData(r.value, "health");
  if (!h.present || typeof h.value !== "string") return null;
  if (!(allowed as readonly string[]).includes(h.value)) return null;
  return { health: h.value as HistoryHealth };
}

function parseSources(value: unknown): HistorySources | null {
  if (!isPlainRecord(value)) return null;
  if (!hasOnlyKeys(value, SOURCES_KEYS)) return null;
  const generations = readHealth(value, "generations", ["available"]);
  const products = readHealth(value, "products", ["available", "unavailable"]);
  const blueprints = readHealth(value, "blueprints", ["available"]);
  if (!generations || !products || !blueprints) return null;
  return { generations, products, blueprints };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate and normalize a raw D6 response into a HistoryPage. Returns a
// discriminated result. `expectedType` is the type the UI requested; any
// item of another type is a hard error (the API always returns one type).
export function parseHistoryPagePayload(
  payload: unknown,
  expectedType: HistoryType,
): ParseHistoryResult {
  // Outer backstop: any unexpected throw from a hostile input surfaces as
  // a static client error instead of propagating.
  try {
    return parseHistoryPagePayloadInner(payload, expectedType);
  } catch {
    return fail("internal", "history payload parse failed");
  }
}

function parseHistoryPagePayloadInner(
  payload: unknown,
  expectedType: HistoryType,
): ParseHistoryResult {
  if (!isHistoryType(expectedType)) {
    return fail("bad_type", "expectedType is not a valid history type");
  }
  if (!isPlainRecord(payload)) return fail("not_a_record", "payload is not a plain record");
  if (!hasOnlyKeys(payload, ENVELOPE_KEYS)) {
    return fail("not_a_record", "payload has unknown envelope keys");
  }

  const successR = ownData(payload, "success");
  if (!successR.present || successR.value !== true) {
    return fail("not_success", "payload.success is not true");
  }

  const dataR = ownData(payload, "data");
  if (!dataR.present || !isPlainRecord(dataR.value)) {
    return fail("bad_data", "payload.data is not a plain record");
  }
  const data = dataR.value;
  if (!hasOnlyKeys(data, DATA_KEYS)) return fail("bad_data", "payload.data has unknown keys");

  // items ---------------------------------------------------------------
  const itemsR = ownData(data, "items");
  if (!itemsR.present) return fail("bad_items", "data.items missing");
  const rawItems = safeArray(itemsR.value);
  if (!rawItems) return fail("bad_items", "data.items is not an array");
  if (rawItems.length > MAX_ITEMS_PER_PAGE) {
    return fail("too_many_items", "data.items exceeds hard maximum");
  }

  const items: HistoryItem[] = [];
  const seenSourceIds = new Set<string>();
  const seenObjectKeys = new Set<string>();
  let imageN = 0;
  let videoN = 0;
  let audioN = 0;
  for (const raw of rawItems) {
    const parsed = parseItem(raw, expectedType);
    if (isParseError(parsed)) return parsed;
    if (seenSourceIds.has(parsed.sourceId)) {
      return fail("duplicate_source_id", "duplicate sourceId within page");
    }
    if (seenObjectKeys.has(parsed.objectKey)) {
      return fail("duplicate_object_key", "duplicate objectKey within page");
    }
    seenSourceIds.add(parsed.sourceId);
    seenObjectKeys.add(parsed.objectKey);
    if (parsed.type === "image") imageN++;
    else if (parsed.type === "video") videoN++;
    else audioN++;
    items.push(parsed);
  }

  // counts --------------------------------------------------------------
  const countsR = ownData(data, "counts");
  const counts = parseCounts(countsR.present ? countsR.value : undefined);
  if (!counts) return fail("bad_counts", "data.counts invalid");
  if (counts.all !== counts.image + counts.video + counts.audio) {
    return fail("count_mismatch", "counts.all != image+video+audio");
  }
  if (imageN > counts.image || videoN > counts.video || audioN > counts.audio) {
    return fail("count_mismatch", "per-type page count exceeds API-wide count");
  }

  // nextCursor ----------------------------------------------------------
  const cursorR = ownData(data, "nextCursor");
  if (!cursorR.present) return fail("bad_cursor", "data.nextCursor missing");
  let nextCursor: string | null;
  if (cursorR.value === null) {
    nextCursor = null;
  } else if (isCanonicalCursor(cursorR.value)) {
    nextCursor = cursorR.value;
  } else {
    return fail("bad_cursor", "data.nextCursor is neither null nor a canonical cursor");
  }

  // diagnostics ---------------------------------------------------------
  const diagR = ownData(data, "diagnostics");
  const diagnostics = parseDiagnostics(diagR.present ? diagR.value : undefined);
  if (!diagnostics) return fail("bad_diagnostics", "data.diagnostics invalid");

  // sources -------------------------------------------------------------
  const sourcesR = ownData(data, "sources");
  const sources = parseSources(sourcesR.present ? sourcesR.value : undefined);
  if (!sources) return fail("bad_sources", "data.sources invalid");
  // When products is reported unavailable, no item may originate from the
  // products source (top-level; groups are proven equal to top-level below).
  if (sources.products.health === "unavailable") {
    for (const it of items) {
      if (it.source === "products") {
        return fail("bad_sources", "products unavailable but a products item is present");
      }
    }
  }

  // groups --------------------------------------------------------------
  // Each nested item is validated with the same strict parser; each
  // group's date must equal every member's createdAt date prefix; and the
  // flattened group items must exactly reproduce the top-level items in
  // the same order (no omissions, no duplicates, no reordering).
  const groupsR = ownData(data, "groups");
  if (!groupsR.present) return fail("bad_groups", "data.groups missing");
  const rawGroups = safeArray(groupsR.value);
  if (!rawGroups) return fail("bad_groups", "data.groups is not an array");

  const groups: HistoryGroup[] = [];
  const flat: HistoryItem[] = [];
  const seenGroupDates = new Set<string>();
  for (const rawGroup of rawGroups) {
    if (!isPlainRecord(rawGroup)) return fail("bad_groups", "group is not a plain record");
    if (!hasOnlyKeys(rawGroup, GROUP_KEYS)) return fail("bad_groups", "group has unknown keys");
    const dateR = ownData(rawGroup, "date");
    if (!dateR.present || typeof dateR.value !== "string" || !YMD_RE.test(dateR.value)) {
      return fail("bad_groups", "group.date invalid");
    }
    const groupDate = dateR.value;
    // Duplicate group dates are not a shape D6 emits.
    if (seenGroupDates.has(groupDate)) {
      return fail("bad_groups", "duplicate group date");
    }
    seenGroupDates.add(groupDate);
    const groupItemsR = ownData(rawGroup, "items");
    if (!groupItemsR.present) return fail("bad_groups", "group.items missing");
    const rawGroupItems = safeArray(groupItemsR.value);
    if (!rawGroupItems) return fail("bad_groups", "group.items is not an array");
    // Empty groups are not a shape D6 emits.
    if (rawGroupItems.length === 0) {
      return fail("bad_groups", "group has no items");
    }

    const groupItems: HistoryItem[] = [];
    for (const raw of rawGroupItems) {
      const parsed = parseItem(raw, expectedType);
      if (isParseError(parsed)) return fail("bad_groups", "group item invalid");
      if (groupDate !== parsed.createdAt.slice(0, 10)) {
        return fail("bad_groups", "group.date does not match item date");
      }
      groupItems.push(parsed);
      flat.push(parsed);
    }
    groups.push({ date: groupDate, items: groupItems });
  }

  if (flat.length !== items.length) {
    return fail("bad_groups", "flattened group items do not match top-level items");
  }
  for (let i = 0; i < items.length; i++) {
    if (!itemsEqual(flat[i], items[i])) {
      return fail("bad_groups", "flattened group items diverge from top-level order");
    }
  }

  return {
    ok: true,
    page: {
      type: expectedType,
      items,
      groups,
      counts,
      nextCursor,
      diagnostics,
      sources,
    },
  };
}

// ---------------------------------------------------------------------------
// buildHistoryRequestUrl
// ---------------------------------------------------------------------------

// Build the relative request path for the D6 endpoint. Always pins the
// canonical fixed limit (30). The cursor, if supplied, must already be a
// canonical base64url token or the call throws (callers should only ever
// pass a nextCursor emitted by a parsed page).
export function buildHistoryRequestUrl(type: HistoryType, cursor?: string | null): string {
  if (!isHistoryType(type)) {
    throw new Error("buildHistoryRequestUrl: invalid type");
  }
  const params = new URLSearchParams();
  params.set("type", type);
  params.set("limit", String(CANONICAL_PAGE_LIMIT));
  if (cursor !== undefined && cursor !== null) {
    if (!isCanonicalCursor(cursor)) {
      throw new Error("buildHistoryRequestUrl: non-canonical cursor");
    }
    params.set("cursor", cursor);
  }
  return `/api/canvas/history?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Accumulated client-side history state + merge
// ---------------------------------------------------------------------------

export interface HistoryState {
  readonly type: HistoryType;
  readonly items: readonly HistoryItem[];
  readonly counts: HistoryCounts;
  readonly nextCursor: string | null;
  readonly pagesLoaded: number;
  // Cursors already consumed (including the initial start sentinel), used
  // to detect a looping or repeated cursor from the server.
  readonly consumedCursors: readonly string[];
  readonly atEnd: boolean;
  readonly truncated: boolean;
}

export type MergeResultCode =
  | "ok"
  | "type_mismatch"
  | "cursor_mismatch"
  | "cursor_loop"
  | "page_limit_reached"
  | "retention_bounded";

export type MergeHistoryResult =
  | {
      readonly ok: true;
      readonly code: "ok" | "retention_bounded";
      readonly state: HistoryState;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<MergeResultCode, "ok" | "retention_bounded">;
      readonly state: HistoryState;
    };

// Absolute retention bounds. These cap client memory regardless of what
// the server claims; when live server data would be cut off we STOP
// paginating and mark atEnd so the UI never pretends more data exists
// behind an exhausted buffer.
const MAX_RETAINED_ITEMS = 300;
const MAX_PAGES = 10;

// Sentinel for the initial (cursorless) request. Uses a character outside
// the base64url alphabet so it can never collide with a real cursor.
const START_CURSOR = "@@start";

export function createInitialHistoryState(type: HistoryType): HistoryState {
  if (!isHistoryType(type)) {
    throw new Error("createInitialHistoryState: invalid type");
  }
  return {
    type,
    items: [],
    counts: { all: 0, image: 0, video: 0, audio: 0 },
    nextCursor: null,
    pagesLoaded: 0,
    consumedCursors: [],
    atEnd: false,
    truncated: false,
  };
}

// Merge a freshly parsed page into accumulated state.
//
// `requestedCursor` is the cursor that was sent to obtain `page` (null for
// the first page). It must equal the cursor the state currently expects
// (state.nextCursor) and must not repeat a previously consumed cursor. The
// page's returned nextCursor is also rejected immediately if it equals the
// requested cursor or any consumed cursor (server-side loop / replay).
//
// Server order is preserved. New items are appended in arrival order,
// skipping any whose sourceId OR objectKey was already retained. API-wide
// counts always come from the latest page. Retention is hard-bounded to
// MAX_RETAINED_ITEMS items and MAX_PAGES pages; when hitting a bound
// actually cuts off live server data we stop and report retention_bounded,
// but when the bound coincides with the true end we report a normal end.
export function mergeHistoryPage(
  state: HistoryState,
  page: HistoryPage,
  requestedCursor: string | null,
): MergeHistoryResult {
  if (page.type !== state.type) {
    return { ok: false, code: "type_mismatch", state };
  }

  const expected = state.nextCursor;
  const normReq = requestedCursor === null ? START_CURSOR : requestedCursor;

  // The requested cursor must match what state expects to fetch next.
  if ((requestedCursor ?? null) !== (expected ?? null)) {
    return { ok: false, code: "cursor_mismatch", state };
  }

  // Reject a request cursor we have already consumed (replay / loop).
  if (state.consumedCursors.includes(normReq)) {
    return { ok: false, code: "cursor_loop", state };
  }

  // Already at a hard page ceiling before consuming this page.
  if (state.pagesLoaded >= MAX_PAGES) {
    return {
      ok: false,
      code: "page_limit_reached",
      state: { ...state, atEnd: true },
    };
  }

  // Dedupe against retained items by both keys.
  const seenSourceIds = new Set(state.items.map((i) => i.sourceId));
  const seenObjectKeys = new Set(state.items.map((i) => i.objectKey));

  const merged = state.items.slice();
  let boundedOut = false;
  let idx = 0;
  for (; idx < page.items.length; idx++) {
    const item = page.items[idx];
    if (merged.length >= MAX_RETAINED_ITEMS) {
      boundedOut = true;
      break;
    }
    if (seenSourceIds.has(item.sourceId) || seenObjectKeys.has(item.objectKey)) {
      continue;
    }
    seenSourceIds.add(item.sourceId);
    seenObjectKeys.add(item.objectKey);
    merged.push(item);
  }

  // A retention break only truly cuts off data if at least one unprocessed
  // page item would have been a NEW (non-duplicate) item.
  let itemCutoff = false;
  if (boundedOut) {
    for (let j = idx; j < page.items.length; j++) {
      const it = page.items[j];
      if (!seenSourceIds.has(it.sourceId) && !seenObjectKeys.has(it.objectKey)) {
        itemCutoff = true;
        break;
      }
    }
  }

  const consumed = state.consumedCursors.concat(normReq);
  const pagesLoaded = state.pagesLoaded + 1;
  const serverHasMore = page.nextCursor !== null;

  // Immediately reject a returned nextCursor that equals the requested
  // cursor or any consumed cursor (covers "equal to requestedCursor").
  if (serverHasMore && consumed.includes(page.nextCursor as string)) {
    return { ok: false, code: "cursor_loop", state };
  }

  const reachedItemCap = merged.length >= MAX_RETAINED_ITEMS;
  const pageCeiling = pagesLoaded >= MAX_PAGES;

  let nextCursor: string | null;
  let atEnd: boolean;
  let code: "ok" | "retention_bounded";

  if (itemCutoff) {
    // Cut off mid-page by the item cap: live data was dropped right now.
    nextCursor = null;
    atEnd = true;
    code = "retention_bounded";
  } else if (reachedItemCap && serverHasMore) {
    // Accepting this page exactly reached the item cap while the server
    // still has more we cannot hold: stop immediately, do not advance the
    // cursor and do not pretend more was loaded.
    nextCursor = null;
    atEnd = true;
    code = "retention_bounded";
  } else if (pageCeiling && serverHasMore) {
    // Hit the page ceiling while the server still has more.
    nextCursor = null;
    atEnd = true;
    code = "retention_bounded";
  } else if (serverHasMore) {
    // Under both caps: keep paginating.
    nextCursor = page.nextCursor;
    atEnd = false;
    code = "ok";
  } else {
    // The server reports no more data: a true end, even when it coincides
    // with exactly the item cap (300) or the page ceiling (page 10).
    nextCursor = null;
    atEnd = true;
    code = "ok";
  }

  const bounded = code === "retention_bounded";
  const nextState: HistoryState = {
    type: state.type,
    items: merged,
    counts: page.counts,
    nextCursor,
    pagesLoaded,
    consumedCursors: consumed,
    atEnd,
    // Any retention-bounded result (item cap or page cap) truncates the
    // true history and must be recorded as such.
    truncated: state.truncated || page.diagnostics.truncated || bounded,
  };

  return { ok: true, code, state: nextState };
}

// ---------------------------------------------------------------------------
// Request gate: single-flight ticketing with abort + generation counter
// ---------------------------------------------------------------------------

export interface HistoryRequestTicket {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface HistoryRequestGate {
  // Start a new request, aborting any prior in-flight one. Returns a
  // ticket whose signal is live and whose generation is unique+increasing.
  begin(): HistoryRequestTicket;
  // Abort the current request and advance the generation so any ticket
  // issued before this call is permanently stale (used on reset/retype).
  invalidate(): void;
  // True only if the ticket is the latest issued AND not aborted. Never
  // throws, even for a hostile ticket object.
  isCurrent(ticket: HistoryRequestTicket): boolean;
  // The current generation (for diagnostics/tests).
  readonly generation: number;
}

// Create a per-instance request gate. No globals. No network.
export function createHistoryRequestGate(): HistoryRequestGate {
  let generation = 0;
  let controller: AbortController | null = null;

  function abortCurrent(): void {
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    controller = null;
  }

  return {
    begin(): HistoryRequestTicket {
      abortCurrent();
      generation += 1;
      controller = new AbortController();
      return { generation, signal: controller.signal };
    },
    invalidate(): void {
      abortCurrent();
      generation += 1;
    },
    isCurrent(ticket: HistoryRequestTicket): boolean {
      // Hostile ticket reads (throwing getters/proxies) fail closed.
      try {
        if (!ticket || typeof ticket !== "object") return false;
        if (ticket.generation !== generation) return false;
        const signal = ticket.signal;
        if (!signal || signal.aborted) return false;
        return controller !== null && controller.signal === signal;
      } catch {
        return false;
      }
    },
    get generation(): number {
      return generation;
    },
  };
}

// ---------------------------------------------------------------------------
// groupHistoryItemsByLocalDate
//
// Deterministic client-only grouping by the viewer's local calendar date.
// Stable output: groups are ordered by first appearance of a member item
// (server order is preserved), and items within a group keep server order.
// Items with an unparseable createdAt fall into a dedicated "invalid-date"
// bucket placed last, so a bad row never crashes the UI.
// ---------------------------------------------------------------------------

export interface HistoryLocalDateGroup {
  readonly dateKey: string; // "YYYY-MM-DD" local, or "invalid-date"
  readonly label: string; // localized display label (or raw key)
  readonly items: readonly HistoryItem[];
}

const INVALID_DATE_KEY = "invalid-date";

function localDateKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  const mm = m < 10 ? `0${m}` : String(m);
  const dd = day < 10 ? `0${day}` : String(day);
  return `${y}-${mm}-${dd}`;
}

function localDateLabel(dateKey: string, iso: string, locale?: string): string {
  if (dateKey === INVALID_DATE_KEY) return "Unknown date";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return dateKey;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    // Bad locale or environment without full Intl: fall back to the key.
    return dateKey;
  }
}

export function groupHistoryItemsByLocalDate(
  items: readonly HistoryItem[],
  locale?: string,
): readonly HistoryLocalDateGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, HistoryItem[]>();
  const labels = new Map<string, string>();

  for (const item of items) {
    const key = localDateKey(item.createdAt) ?? INVALID_DATE_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
      labels.set(key, localDateLabel(key, item.createdAt, locale));
    }
    bucket.push(item);
  }

  // Stable ordering: valid dates in first-appearance order, then the
  // invalid-date bucket (if any) always last.
  const validOrder = order.filter((k) => k !== INVALID_DATE_KEY);
  const finalOrder = order.includes(INVALID_DATE_KEY)
    ? validOrder.concat(INVALID_DATE_KEY)
    : validOrder;

  return finalOrder.map((key) => ({
    dateKey: key,
    label: labels.get(key) ?? key,
    items: buckets.get(key) ?? [],
  }));
}
