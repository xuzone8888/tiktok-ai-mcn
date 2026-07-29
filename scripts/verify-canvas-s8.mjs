#!/usr/bin/env node
/**
 * Super Canvas S8 focused verifier.
 *
 * Executes the production history-client module (src/lib/canvas/history-client.ts)
 * offline against the exact shipped D6 response contract. It transpiles the real
 * TypeScript source (types stripped) and runs it with the production
 * isOssObjectKey from src/lib/canvas/schema.ts. No network, no React, no DOM.
 *
 * Deterministic assertions cover: a valid D6 fixture; every strict rejection;
 * the canonical request URL; ordered page merge with dual-key dedupe, count
 * refresh, cursor loops/mismatch, and true-end vs live-data 300-item/10-page
 * bounds; request-gate abort/generation/stale/hostile-ticket behavior;
 * local-date grouping stable order; and source hygiene.
 *
 * Exits nonzero on any failure and prints an exact pass/fail total.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCanvasModule } from "./canvas-build.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, ".temp", "canvas-verify-build");

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

function throws(fn, label) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, label);
}

function hasControlBytes(source) {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (
      code === 0 ||
      (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function boundedSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = start < 0 ? -1 : source.indexOf(endMarker, start + startMarker.length);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

function jsxTagNames(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const names = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      names.push(node.tagName.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

// --- Transpile helper (mirrors the S7 scaffold) ---------------------------
function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (match, prefix, quote, specifier, endQuote) =>
      /\.[a-z]+$/i.test(specifier)
        ? match
        : `${prefix}${quote}${specifier}.mjs${endQuote}`
  );
}

async function loadExtra(sourcePath, outputName, rewrites = {}) {
  mkdirSync(OUT, { recursive: true });
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  let code = addExt(outputText);
  for (const [from, to] of Object.entries(rewrites)) code = code.split(from).join(to);
  const outputPath = join(OUT, outputName);
  writeFileSync(outputPath, code, "utf8");
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
}

const clone = (value) => structuredClone(value);

async function main() {
  // Materialize the production schema module (writes OUT/schema.mjs), then
  // load the real history-client against it.
  const schema = await loadCanvasModule("schema");
  const { isOssObjectKey } = schema;
  ok(typeof isOssObjectKey === "function", "production isOssObjectKey is available");

  const mod = await loadExtra(
    join(ROOT, "src", "lib", "canvas", "history-client.ts"),
    "history-client-s8.mjs",
    { '"@/lib/canvas/schema"': '"./schema.mjs"' }
  );
  const {
    parseHistoryPagePayload,
    buildHistoryRequestUrl,
    createInitialHistoryState,
    mergeHistoryPage,
    createHistoryRequestGate,
    groupHistoryItemsByLocalDate,
    CANONICAL_PAGE_LIMIT,
  } = mod;

  // Pick an object-key pattern that the production key guard accepts so the
  // valid fixture uses real OSS object keys (never URLs).
  const keyPatterns = [
    (i) => `generations/2026/07/13/asset-${i}.png`,
    (i) => `canvas/history/asset-${i}`,
    (i) => `asset-${i}.bin`,
    (i) => `a/${i}`,
  ];
  const keyOf =
    keyPatterns.find(
      (p) => isOssObjectKey(p("0a")) && isOssObjectKey(p("1b")) && isOssObjectKey(p("2c"))
    ) || null;
  ok(keyOf !== null, "a conventional OSS object-key pattern is accepted by production guard");
  const K = (tag) => (keyOf ? keyOf(tag) : `asset-${tag}`);

  const T13 = "2026-07-13T10:00:00.000000Z"; // six-digit UTC microseconds
  const T12 = "2026-07-12T09:30:15.123456Z";
  const ROW0 = "00000000-0000-4000-8000-000000000000"; // canonical UUID
  const ROW1 = "11111111-1111-4111-8111-111111111111";
  const SID0 = `generations:${ROW0}:item-0`; // source:rowId:itemId
  const SID1 = `products:${ROW1}:item-1`;
  const CURSOR = "abcd0123"; // length 8, canonical unpadded base64url

  // Fresh valid D6 payload builder (image tab). Every call returns new data.
  function mkValid() {
    const item0 = {
      type: "image",
      source: "generations",
      sourceId: SID0,
      rowId: ROW0,
      itemId: "item-0",
      createdAt: T13,
      title: "Shot A",
      dimensions: { width: 1024, height: 768 },
      objectKey: K("img0"),
      posterKey: K("poster0"),
    };
    const item1 = {
      type: "image",
      source: "products",
      sourceId: SID1,
      rowId: ROW1,
      itemId: "item-1",
      createdAt: T12,
      objectKey: K("img1"),
    };
    return {
      success: true,
      data: {
        items: [item0, item1],
        groups: [
          { date: "2026-07-13", items: [item0] },
          { date: "2026-07-12", items: [item1] },
        ],
        counts: { all: 40, image: 10, video: 20, audio: 10 },
        nextCursor: CURSOR,
        diagnostics: {
          total: 1,
          truncated: false,
          entries: [{ source: "blueprints", code: "partial_scan" }],
        },
        sources: {
          generations: { health: "available" },
          products: { health: "available" },
          blueprints: { health: "available" },
        },
      },
    };
  }

  // A fresh, fully valid single generations-item payload (used to isolate a
  // single mutation under test). Identity satisfies the D6 contract.
  function mkSingle() {
    const row = "22222222-2222-4222-8222-222222222222";
    const item = {
      type: "image",
      source: "generations",
      sourceId: `generations:${row}:only-0`,
      rowId: row,
      itemId: "only-0",
      createdAt: T13,
      objectKey: K("only0"),
    };
    return {
      success: true,
      data: {
        items: [item],
        groups: [{ date: "2026-07-13", items: [item] }],
        counts: { all: 1, image: 1, video: 0, audio: 0 },
        nextCursor: null,
        diagnostics: { total: 0, truncated: false, entries: [] },
        sources: {
          generations: { health: "available" },
          products: { health: "available" },
          blueprints: { health: "available" },
        },
      },
    };
  }

  console.log("1. Valid real D6 fixture");
  const valid = parseHistoryPagePayload(mkValid(), "image");
  ok(valid.ok === true, `valid fixture parses (got ${valid.ok ? "ok" : valid.code})`);
  if (valid.ok) {
    const p = valid.page;
    eq(p.type, "image", "page type echoes requested tab");
    eq(p.items.length, 2, "all items retained");
    eq(p.items[0].objectKey, K("img0"), "object key preserved (not a URL)");
    eq(p.items[0].dimensions, { width: 1024, height: 768 }, "dimensions preserved");
    eq(p.items[0].title, "Shot A", "title preserved");
    eq(p.items[0].posterKey, K("poster0"), "poster key preserved");
    eq(p.items[1].title, undefined, "absent optional title stays absent");
    eq(p.counts, { all: 40, image: 10, video: 20, audio: 10 }, "tab-independent counts preserved");
    eq(p.nextCursor, CURSOR, "canonical cursor preserved");
    eq(p.items[0].sourceId, SID0, "canonical sourceId tuple preserved");
    eq(p.diagnostics, { total: 1, truncated: false, entries: [{ source: "blueprints", code: "partial_scan" }] }, "diagnostics {total,truncated,entries} preserved");
    eq(p.sources, {
      generations: { health: "available" },
      products: { health: "available" },
      blueprints: { health: "available" },
    }, "object-shaped sources preserved");
    eq(p.groups.length, 2, "full-item groups preserved");
    eq(p.groups[0].date, "2026-07-13", "group date preserved");
    eq(p.groups[0].items[0].itemId, "item-0", "group items are full items");
  }

  // A second valid variant: truncated=true when total > entries.length.
  const validTrunc = clone(mkValid());
  validTrunc.data.diagnostics = {
    total: 3,
    truncated: true,
    entries: [{ source: "products", code: "skipped" }],
  };
  ok(parseHistoryPagePayload(validTrunc, "image").ok === true, "valid truncated diagnostics parses");

  console.log("2. Strict rejections");
  function rej(build, code, label) {
    let res;
    try {
      res = parseHistoryPagePayload(build(), "image");
    } catch (e) {
      ok(false, `${label} (threw ${e && e.message})`);
      return;
    }
    ok(res.ok === false && res.code === code, `${label} (got ${res.ok ? "ok" : res.code})`);
  }
  function rejAny(payload, label) {
    let res;
    try {
      res = parseHistoryPagePayload(payload, "image");
    } catch (e) {
      ok(false, `${label} (threw ${e && e.message})`);
      return;
    }
    ok(res.ok === false, `${label} (got ${res.ok ? "ok" : res.code})`);
  }

  // Envelope / data shape
  rej(() => { const p = mkValid(); p.extra = 1; return p; }, "not_a_record", "unknown envelope key rejected");
  rej(() => { const p = mkValid(); p.success = false; return p; }, "not_success", "success!==true rejected");
  rej(() => { const p = mkValid(); p.data.extra = 1; return p; }, "bad_data", "unknown data key rejected");

  // Item type / source
  rej(() => { const p = mkValid(); p.data.items[0].type = "video"; return p; }, "wrong_type", "wrong item type rejected");
  rej(() => { const p = mkValid(); p.data.items[0].type = "nope"; return p; }, "bad_type", "invalid item type rejected");
  rej(() => { const p = mkValid(); p.data.items[0].source = "unknown"; return p; }, "bad_source", "invalid item source rejected");
  rej(() => { const p = mkValid(); p.data.items[0].sourceId = ""; return p; }, "bad_id", "empty id rejected");

  // Timestamps
  rej(() => { const p = mkValid(); p.data.items[0].createdAt = "2026-07-13T10:00:00.000Z"; return p; }, "bad_timestamp", "3-digit millis timestamp rejected");
  rej(() => { const p = mkValid(); p.data.items[0].createdAt = "2026-13-40T10:00:00.000000Z"; return p; }, "bad_timestamp", "out-of-range date rejected");
  rej(() => { const p = mkValid(); p.data.items[0].createdAt = "2026-07-13 10:00:00.000000Z"; return p; }, "bad_timestamp", "non-canonical separator rejected");
  const earlyYear = mkSingle();
  earlyYear.data.items[0].createdAt = "0050-02-28T10:00:00.000000Z";
  earlyYear.data.groups[0].date = "0050-02-28";
  ok(parseHistoryPagePayload(earlyYear, "image").ok === true, "D6-valid four-digit year below 100 parses");
  rej(() => {
    const p = mkSingle();
    p.data.items[0].createdAt = "0000-02-28T10:00:00.000000Z";
    p.data.groups[0].date = "0000-02-28";
    return p;
  }, "bad_timestamp", "year zero rejected to match D6 year >= 1 contract");
  rej(() => {
    const p = mkSingle();
    p.data.items[0].createdAt = "0050-02-30T10:00:00.000000Z";
    p.data.groups[0].date = "0050-02-30";
    return p;
  }, "bad_timestamp", "impossible early-year calendar date rejected");

  // Media must be object keys, never URLs / dataURLs
  rej(() => { const p = mkValid(); p.data.items[0].objectKey = "https://cdn.example/a.png"; return p; }, "bad_media", "https objectKey rejected");
  rej(() => { const p = mkValid(); p.data.items[0].objectKey = "data:image/png;base64,AAAA"; return p; }, "bad_media", "dataURL objectKey rejected");
  rej(() => { const p = mkValid(); p.data.items[0].posterKey = "http://x/y.png"; return p; }, "bad_media", "http posterKey rejected");

  // Counts
  rej(() => { const p = mkValid(); p.data.counts.all = 41; return p; }, "count_mismatch", "counts.all != sum rejected");
  rej(() => { const p = mkValid(); p.data.counts = { all: 31, image: 1, video: 20, audio: 10 }; return p; }, "count_mismatch", "page image count exceeding API count rejected");
  rej(() => { const p = mkValid(); delete p.data.counts.audio; return p; }, "bad_counts", "missing counts key rejected");
  rej(() => { const p = mkValid(); p.data.counts.image = -1; p.data.counts.all = 39; return p; }, "bad_counts", "negative count rejected");

  // Cursor
  rej(() => { const p = mkValid(); p.data.nextCursor = "has space"; return p; }, "bad_cursor", "non-base64url cursor rejected");
  rej(() => { const p = mkValid(); p.data.nextCursor = 123; return p; }, "bad_cursor", "numeric cursor rejected");
  rej(() => { const p = mkValid(); delete p.data.nextCursor; return p; }, "bad_cursor", "missing cursor rejected");

  // Diagnostics
  rej(() => { const p = mkValid(); p.data.diagnostics = { total: 0, truncated: true, entries: [] }; return p; }, "bad_diagnostics", "truncated flag inconsistency rejected");
  rej(() => { const p = mkValid(); p.data.diagnostics = { total: 0, truncated: false, entries: [{ source: "generations", code: "x" }] }; return p; }, "bad_diagnostics", "total < entries.length rejected");
  rej(() => { const p = mkValid(); p.data.diagnostics = { total: 21, truncated: true, entries: Array.from({ length: 21 }, () => ({ source: "generations", code: "e" })) }; return p; }, "bad_diagnostics", ">20 diagnostic entries rejected");
  rej(() => { const p = mkValid(); p.data.diagnostics.entries = [{ source: "generations", code: "has space" }]; p.data.diagnostics.total = 1; return p; }, "bad_diagnostics", "unsafe diagnostic code token rejected");
  rej(() => { const p = mkValid(); p.data.diagnostics.scanned = 5; return p; }, "bad_diagnostics", "unknown diagnostic key rejected");

  // Sources (object health map)
  rej(() => { const p = mkValid(); p.data.sources.generations.health = "unavailable"; return p; }, "bad_sources", "generations must be available");
  rej(() => { const p = mkValid(); p.data.sources.blueprints.health = "degraded"; return p; }, "bad_sources", "invalid blueprints health rejected");
  rej(() => { const p = mkValid(); p.data.sources = [{ health: "available" }]; return p; }, "bad_sources", "array-shaped sources rejected");
  rej(() => { const p = mkValid(); p.data.sources.extra = { health: "available" }; return p; }, "bad_sources", "unknown source key rejected");
  rej(() => { const p = mkValid(); p.data.sources.generations.error = "x"; return p; }, "bad_sources", "error string in source health rejected");
  rej(() => { const p = mkValid(); p.data.sources.products.health = "unavailable"; return p; }, "bad_sources", "products unavailable while a products item exists rejected");

  // Duplicates (identity kept internally consistent so the failure is the
  // duplicate, not the sourceId-tuple check)
  rej(() => {
    const p = mkValid();
    const a = p.data.items[0];
    const b = p.data.items[1];
    b.source = a.source;
    b.rowId = a.rowId;
    b.itemId = a.itemId;
    b.sourceId = a.sourceId;
    return p;
  }, "duplicate_source_id", "duplicate sourceId rejected");
  rej(() => { const p = mkValid(); p.data.items[1].objectKey = p.data.items[0].objectKey; return p; }, "duplicate_object_key", "duplicate objectKey rejected");

  // >100 items (length checked before parse)
  rej(() => { const p = mkValid(); p.data.items = Array.from({ length: 101 }, () => ({})); return p; }, "too_many_items", ">100 items rejected");

  // Groups
  rej(() => { const p = mkValid(); p.data.groups[0].items = []; return p; }, "bad_groups", "empty group rejected");
  rej(() => { const p = mkValid(); p.data.groups[1] = { date: "2026-07-13", items: [p.data.items[1]] }; return p; }, "bad_groups", "duplicate group date rejected");
  rej(() => { const p = mkValid(); p.data.groups[0].date = "2026-01-01"; return p; }, "bad_groups", "group date not matching item date rejected");
  rej(() => { const p = mkValid(); p.data.groups.pop(); return p; }, "bad_groups", "flattened groups omitting an item rejected");
  rej(() => { const p = mkValid(); p.data.groups[0].extra = 1; return p; }, "bad_groups", "unknown group key rejected");

  // Hostile Proxy / reflection traps must fail closed (parse error, no throw)
  const hostileEnvelope = new Proxy({}, {
    ownKeys() { throw new Error("ownKeys trap"); },
    get() { throw new Error("get trap"); },
    getOwnPropertyDescriptor() { throw new Error("descriptor trap"); },
  });
  rejAny(hostileEnvelope, "hostile proxy envelope fails closed");
  const hostileData = mkValid();
  hostileData.data = new Proxy({}, { ownKeys() { throw new Error("data ownKeys"); } });
  rejAny(hostileData, "hostile proxy data fails closed");
  const hostileItem = new Proxy(
    { type: "image", source: "generations", sourceId: "x", rowId: "x", itemId: "x", createdAt: T13, objectKey: K("img0") },
    { getOwnPropertyDescriptor() { throw new Error("item descriptor trap"); } }
  );
  const hostileItemPayload = mkValid();
  hostileItemPayload.data.items = [hostileItem];
  rejAny(hostileItemPayload, "hostile proxy item fails closed");

  // Optional keys backed by accessors reject the item (never silently absent)
  function withAccessor(field, get) {
    const row = "33333333-3333-4333-8333-333333333333";
    const item = {
      type: "image",
      source: "generations",
      sourceId: `generations:${row}:acc-0`,
      rowId: row,
      itemId: "acc-0",
      createdAt: T13,
      objectKey: K("acc0"),
    };
    Object.defineProperty(item, field, { configurable: true, enumerable: true, get });
    return {
      success: true,
      data: {
        items: [item],
        groups: [{ date: "2026-07-13", items: [item] }],
        counts: { all: 1, image: 1, video: 0, audio: 0 },
        nextCursor: null,
        diagnostics: { total: 0, truncated: false, entries: [] },
        sources: {
          generations: { health: "available" },
          products: { health: "available" },
          blueprints: { health: "available" },
        },
      },
    };
  }
  rejAny(withAccessor("title", () => "x"), "accessor-backed optional title rejected");
  rejAny(withAccessor("dimensions", () => ({ width: 10, height: 10 })), "accessor-backed optional dimensions rejected");
  rejAny(withAccessor("duration", () => 5), "accessor-backed optional duration rejected");
  rejAny(withAccessor("posterKey", () => K("acc-poster")), "accessor-backed optional posterKey rejected");

  // Dimensions / duration bounds
  rej(() => { const p = mkValid(); p.data.items[0].dimensions = { width: 0, height: 10 }; return p; }, "bad_dimensions", "non-positive dimension rejected");
  rej(() => { const p = mkValid(); p.data.items[0].dimensions = { width: 40000, height: 10 }; return p; }, "bad_dimensions", "oversized dimension rejected");
  rej(() => { const p = mkValid(); p.data.items[1].duration = 0; return p; }, "bad_duration", "zero duration rejected");
  rej(() => { const p = mkValid(); p.data.items[1].duration = 86401; return p; }, "bad_duration", "oversized duration rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "x".repeat(201); return p; }, "bad_title", "over-long title rejected");

  // Expected-type guard: image items must be rejected under a different tab.
  ok(parseHistoryPagePayload(mkValid(), "audio").ok === false, "image payload rejected under audio tab");
  ok(parseHistoryPagePayload(mkValid(), "video").ok === false, "image payload rejected under video tab");

  // D6 canonical identity / display contract
  rej(() => { const p = mkValid(); p.data.items[0].rowId = "not-a-uuid"; return p; }, "bad_id", "non-UUID rowId rejected");
  rej(() => { const p = mkValid(); p.data.items[0].rowId = ROW1; return p; }, "bad_id", "rowId inconsistent with sourceId tuple rejected");
  rej(() => { const p = mkValid(); p.data.items[0].rowId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"; return p; }, "bad_id", "uppercase-hex UUID rowId rejected");
  rej(() => { const p = mkValid(); p.data.items[0].itemId = "bad id"; return p; }, "bad_id", "itemId with a space rejected");
  rej(() => { const p = mkValid(); const a = p.data.items[0]; a.itemId = "x".repeat(81); a.sourceId = `generations:${ROW0}:${a.itemId}`; return p; }, "bad_id", "over-long itemId rejected");
  rej(() => { const p = mkValid(); p.data.items[0].sourceId = `generations:${ROW0}:wrong`; return p; }, "bad_id", "sourceId not equal to source:rowId:itemId rejected");

  // Title contract: nonempty, trimmed, no controls, not URL-ish
  rej(() => { const p = mkValid(); p.data.items[0].title = ""; return p; }, "bad_title", "empty title rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = " leading"; return p; }, "bad_title", "untrimmed (leading) title rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "trailing "; return p; }, "bad_title", "untrimmed (trailing) title rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "see http://x"; return p; }, "bad_title", "title containing :// rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "data:text/plain,hi"; return p; }, "bad_title", "data: title rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "//cdn"; return p; }, "bad_title", "// prefixed title rejected");
  rej(() => { const p = mkValid(); p.data.items[0].title = "a" + String.fromCharCode(7) + "b"; return p; }, "bad_title", "control-char title rejected");

  // Poster must differ from objectKey
  rej(() => { const p = mkValid(); p.data.items[0].posterKey = p.data.items[0].objectKey; return p; }, "bad_media", "posterKey equal to objectKey rejected");

  // Counts capped at 20000
  rej(() => { const p = mkValid(); p.data.counts = { all: 20001, image: 20001, video: 0, audio: 0 }; return p; }, "bad_counts", "count over 20000 rejected");

  // Symbol keys on records reject
  rej(() => { const p = mkValid(); p.data[Symbol("x")] = 1; return p; }, "bad_data", "symbol key on data record rejected");
  rej(() => { const p = mkValid(); p.data.items[0][Symbol("s")] = 1; return p; }, "bad_item", "symbol key on item record rejected");

  // Canonical-cursor negatives / positives via parse
  rej(() => { const p = mkValid(); p.data.nextCursor = "abcde"; return p; }, "bad_cursor", "length mod 4 == 1 cursor rejected");
  rej(() => { const p = mkValid(); p.data.nextCursor = "aB"; return p; }, "bad_cursor", "mod-2 cursor with nonzero trailing bits rejected");
  rej(() => { const p = mkValid(); p.data.nextCursor = "aaB"; return p; }, "bad_cursor", "mod-3 cursor with nonzero trailing bits rejected");
  ok(parseHistoryPagePayload((() => { const p = mkValid(); p.data.nextCursor = "aA"; return p; })(), "image").ok === true, "mod-2 cursor with zero trailing bits accepted");
  ok(parseHistoryPagePayload((() => { const p = mkValid(); p.data.nextCursor = "aaA"; return p; })(), "image").ok === true, "mod-3 cursor with zero trailing bits accepted");
  ok(parseHistoryPagePayload((() => { const p = mkValid(); p.data.nextCursor = "A".repeat(1024); return p; })(), "image").ok === true, "D6 maximum-length cursor accepted");
  rej(() => { const p = mkValid(); p.data.nextCursor = "A".repeat(1028); return p; }, "bad_cursor", "cursor beyond D6 1024-character ceiling rejected");

  // Arrays are materialized through descriptors only: element getters never
  // run, and sparse / accessor / extra-key / symbol arrays are rejected.
  {
    let itemHits = 0;
    const p = mkValid();
    const orig0 = p.data.items[0];
    Object.defineProperty(p.data.items, "0", { configurable: true, enumerable: true, get() { itemHits += 1; return orig0; } });
    const res = parseHistoryPagePayload(p, "image");
    ok(res.ok === false && res.code === "bad_items", "items array with an index accessor is rejected");
    eq(itemHits, 0, "items array element getter never runs");
  }
  {
    let groupHits = 0;
    const p = mkValid();
    const orig0 = p.data.groups[0];
    Object.defineProperty(p.data.groups, "0", { configurable: true, enumerable: true, get() { groupHits += 1; return orig0; } });
    const res = parseHistoryPagePayload(p, "image");
    ok(res.ok === false && res.code === "bad_groups", "groups array with an index accessor is rejected");
    eq(groupHits, 0, "groups array element getter never runs");
  }
  {
    let diagHits = 0;
    const p = mkValid();
    p.data.diagnostics.total = 1;
    p.data.diagnostics.truncated = false;
    const e0 = { source: "blueprints", code: "partial_scan" };
    const arr = [e0];
    Object.defineProperty(arr, "0", { configurable: true, enumerable: true, get() { diagHits += 1; return e0; } });
    p.data.diagnostics.entries = arr;
    const res = parseHistoryPagePayload(p, "image");
    ok(res.ok === false && res.code === "bad_diagnostics", "diagnostics entries array with an index accessor is rejected");
    eq(diagHits, 0, "diagnostics entries element getter never runs");
  }
  rej(() => { const p = mkValid(); const arr = p.data.items.slice(); delete arr[1]; p.data.items = arr; return p; }, "bad_items", "sparse items array rejected");
  rej(() => { const p = mkValid(); const arr = p.data.items.slice(); arr.foo = "x"; p.data.items = arr; return p; }, "bad_items", "items array with an extra string key rejected");
  rej(() => { const p = mkValid(); const arr = p.data.items.slice(); arr[Symbol("k")] = 1; p.data.items = arr; return p; }, "bad_items", "items array with a symbol key rejected");

  // An optional-field descriptor trap rejects (existed, never absent).
  {
    const row = "44444444-4444-4444-8444-444444444444";
    const base = {
      type: "image",
      source: "generations",
      sourceId: `generations:${row}:trap-0`,
      rowId: row,
      itemId: "trap-0",
      createdAt: T13,
      objectKey: K("trap0"),
      title: "ok",
    };
    const proxied = new Proxy(base, {
      getOwnPropertyDescriptor(t, k) {
        if (k === "title") throw new Error("descriptor trap");
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    });
    const p = mkSingle();
    p.data.items = [proxied];
    p.data.groups = [{ date: "2026-07-13", items: [base] }];
    const res = parseHistoryPagePayload(p, "image");
    ok(res.ok === false && res.code === "bad_title", "optional-field descriptor trap rejects (existed, not absent)");
  }

  // A valid products-unavailable payload carrying zero product items parses.
  ok(
    parseHistoryPagePayload(
      (() => { const p = mkSingle(); p.data.sources.products.health = "unavailable"; return p; })(),
      "image"
    ).ok === true,
    "products-unavailable payload with no product items parses"
  );

  console.log("3. Canonical request URL");
  eq(CANONICAL_PAGE_LIMIT, 30, "canonical page limit is 30");
  eq(buildHistoryRequestUrl("image"), "/api/canvas/history?type=image&limit=30", "no-cursor URL");
  eq(buildHistoryRequestUrl("video", CURSOR), `/api/canvas/history?type=video&limit=30&cursor=${CURSOR}`, "cursor URL");
  eq(buildHistoryRequestUrl("audio", null), "/api/canvas/history?type=audio&limit=30", "null cursor omitted");
  eq(buildHistoryRequestUrl("image", "aA"), "/api/canvas/history?type=image&limit=30&cursor=aA", "mod-2 zero-trailing-bit cursor accepted");
  throws(() => buildHistoryRequestUrl("bogus"), "invalid type throws");
  throws(() => buildHistoryRequestUrl("image", "bad cursor"), "non-canonical cursor (space) throws");
  throws(() => buildHistoryRequestUrl("image", "A"), "one-char cursor (mod 4 == 1) throws");
  throws(() => buildHistoryRequestUrl("image", "aB"), "mod-2 nonzero-trailing-bit cursor throws");
  throws(() => buildHistoryRequestUrl("image", "aaB"), "mod-3 nonzero-trailing-bit cursor throws");
  throws(() => buildHistoryRequestUrl("image", "A".repeat(1028)), "cursor beyond D6 length ceiling throws");

  console.log("4. Page merge, dedupe, counts, cursors, bounds");
  function mkItem(id, over = {}) {
    return {
      type: over.type || "image",
      source: over.source || "generations",
      sourceId: over.sourceId || `sid-${id}`,
      rowId: `row-${id}`,
      itemId: `item-${id}`,
      createdAt: over.createdAt || T13,
      objectKey: over.objectKey || `key-${id}`,
    };
  }
  function mkPage(items, nextCursor, counts, truncated = false, type = "image") {
    return {
      type,
      items,
      groups: [],
      counts: counts || { all: 999, image: 999, video: 0, audio: 0 },
      nextCursor,
      diagnostics: { total: 0, truncated, entries: [] },
      sources: {
        generations: { health: "available" },
        products: { health: "available" },
        blueprints: { health: "available" },
      },
    };
  }

  const itA = mkItem("A", { sourceId: "s-A", objectKey: "k-A" });
  const itB = mkItem("B", { sourceId: "s-B", objectKey: "k-B" });
  const s0 = createInitialHistoryState("image");
  eq(s0.items.length, 0, "initial state is empty");
  const pageA = mkPage([itA, itB], "cur1", { all: 5, image: 5, video: 0, audio: 0 });
  const r1 = mergeHistoryPage(s0, pageA, null);
  ok(r1.ok && r1.code === "ok", "first page merges");
  eq(r1.state.items.map((i) => i.itemId), ["item-A", "item-B"], "server order preserved");
  eq(r1.state.nextCursor, "cur1", "next cursor advanced");
  eq(r1.state.counts, { all: 5, image: 5, video: 0, audio: 0 }, "counts adopted");

  const dupSid = mkItem("C", { sourceId: "s-A", objectKey: "k-C" }); // dup by sourceId
  const dupKey = mkItem("D", { sourceId: "s-D", objectKey: "k-B" }); // dup by objectKey
  const fresh = mkItem("E", { sourceId: "s-E", objectKey: "k-E" });
  const pageB = mkPage([dupSid, dupKey, fresh], null, { all: 6, image: 6, video: 0, audio: 0 });
  const r2 = mergeHistoryPage(r1.state, pageB, "cur1");
  ok(r2.ok && r2.code === "ok", "second page merges");
  eq(r2.state.items.map((i) => i.itemId), ["item-A", "item-B", "item-E"], "dual-key dedupe drops both dups, keeps fresh in order");
  eq(r2.state.counts, { all: 6, image: 6, video: 0, audio: 0 }, "counts refreshed from latest page");
  ok(r2.state.atEnd === true && r2.state.nextCursor === null, "null server cursor is a normal end");

  // type mismatch
  const tm = mergeHistoryPage(s0, mkPage([itA], null, null, false, "video"), null);
  ok(!tm.ok && tm.code === "type_mismatch", "type mismatch rejected");

  // requested-cursor mismatch
  const mmState = { type: "image", items: [], counts: s0.counts, nextCursor: "c2", pagesLoaded: 1, consumedCursors: ["@@start", "c1"], atEnd: false, truncated: false };
  const mm = mergeHistoryPage(mmState, mkPage([itA], null), "c1");
  ok(!mm.ok && mm.code === "cursor_mismatch", "requested cursor not matching expected rejected");

  // requested-cursor replay (already consumed)
  const replayState = { type: "image", items: [], counts: s0.counts, nextCursor: "c1", pagesLoaded: 1, consumedCursors: ["@@start", "c1"], atEnd: false, truncated: false };
  const replay = mergeHistoryPage(replayState, mkPage([itA], null), "c1");
  ok(!replay.ok && replay.code === "cursor_loop", "replayed requested cursor rejected");

  // returned-cursor loop equal to requested
  const rl1 = mergeHistoryPage(r1.state, mkPage([fresh], "cur1", null), "cur1");
  ok(!rl1.ok && rl1.code === "cursor_loop", "returned cursor equal to requested rejected");
  // returned-cursor loop equal to an earlier consumed cursor
  const loopState = { type: "image", items: [], counts: s0.counts, nextCursor: "cB", pagesLoaded: 2, consumedCursors: ["@@start", "cA"], atEnd: false, truncated: false };
  const rl2 = mergeHistoryPage(loopState, mkPage([fresh], "cA", null), "cB");
  ok(!rl2.ok && rl2.code === "cursor_loop", "returned cursor equal to earlier consumed rejected");

  // 300-item bound: exactly-300 with a null cursor is a true end
  const exactly300 = Array.from({ length: 300 }, (_, i) => mkItem(`x300-${i}`, { sourceId: `s3-${i}`, objectKey: `k3-${i}` }));
  const end300 = mergeHistoryPage(s0, mkPage(exactly300, null), null);
  ok(end300.ok && end300.code === "ok" && end300.state.atEnd === true, "exactly-300 with null cursor is a normal end");
  eq(end300.state.items.length, 300, "retains exactly 300 items at true end");
  ok(end300.state.truncated === false, "exactly-300 true end is not marked truncated");

  const live300 = mergeHistoryPage(s0, mkPage(exactly300, "more"), null);
  ok(live300.ok && live300.code === "retention_bounded", "exactly-300 with a live cursor is retention-bounded");
  ok(
    live300.state.atEnd === true &&
      live300.state.nextCursor === null &&
      live300.state.truncated === true,
    "exactly-300 live bound stops pagination and records truncation"
  );

  // 300-item bound: live data actually cut off
  const over305 = Array.from({ length: 305 }, (_, i) => mkItem(`y305-${i}`, { sourceId: `s5-${i}`, objectKey: `k5-${i}` }));
  const cut300 = mergeHistoryPage(s0, mkPage(over305, "more"), null);
  ok(cut300.ok && cut300.code === "retention_bounded", "live data past 300 items reports retention_bounded");
  eq(cut300.state.items.length, 300, "hard-bounds retention to 300 items");
  ok(cut300.state.atEnd === true && cut300.state.nextCursor === null, "cut-off page exposes no next cursor");
  ok(cut300.state.truncated === true, "item-cap cutoff records truncation");

  // 10-page bound: build 9 chained pages
  const cursors = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];
  let chain = createInitialHistoryState("image");
  let req = null;
  let chainOk = true;
  for (let pi = 0; pi < 9; pi += 1) {
    const items = Array.from({ length: 5 }, (_, k) => mkItem(`p${pi}-${k}`, { sourceId: `sp${pi}-${k}`, objectKey: `kp${pi}-${k}` }));
    const r = mergeHistoryPage(chain, mkPage(items, cursors[pi], null), req);
    if (!r.ok) chainOk = false;
    chain = r.state;
    req = cursors[pi];
  }
  ok(chainOk && chain.pagesLoaded === 9 && chain.nextCursor === "c9", "nine pages chain cleanly");

  const page10End = mergeHistoryPage(
    chain,
    mkPage(Array.from({ length: 5 }, (_, k) => mkItem(`p9e-${k}`, { sourceId: `sp9e-${k}`, objectKey: `kp9e-${k}` })), null),
    "c9"
  );
  ok(page10End.ok && page10End.code === "ok" && page10End.state.atEnd === true, "10th page that is the true end reports normal end");
  ok(page10End.state.truncated === false, "page-10 true end is not marked truncated");

  const page10Cut = mergeHistoryPage(
    chain,
    mkPage(Array.from({ length: 5 }, (_, k) => mkItem(`p9c-${k}`, { sourceId: `sp9c-${k}`, objectKey: `kp9c-${k}` })), "c10"),
    "c9"
  );
  ok(page10Cut.ok && page10Cut.code === "retention_bounded", "10th page with more live data reports retention_bounded");
  ok(page10Cut.state.atEnd === true && page10Cut.state.nextCursor === null, "page-10 cut exposes no next cursor");
  ok(page10Cut.state.truncated === true, "page-10 live bound records truncation");

  console.log("5. Request gate");
  const gate = createHistoryRequestGate();
  const t1 = gate.begin();
  ok(gate.isCurrent(t1) && t1.signal.aborted === false, "first ticket is live and current");
  eq(gate.generation, 1, "generation starts at 1");
  const t2 = gate.begin();
  ok(t1.signal.aborted === true, "begin aborts the prior request");
  ok(!gate.isCurrent(t1) && gate.isCurrent(t2), "prior ticket is stale, new ticket is current");
  eq(gate.generation, 2, "generation increments on begin");
  gate.invalidate();
  ok(t2.signal.aborted === true, "invalidate aborts the current request");
  ok(!gate.isCurrent(t2), "invalidate makes the outstanding ticket stale");
  eq(gate.generation, 3, "invalidate advances the generation");
  const t3 = gate.begin();
  ok(gate.isCurrent(t3), "a fresh ticket after invalidate is current");
  gate.begin();
  ok(!gate.isCurrent(t3), "superseded ticket is stale");
  ok(!gate.isCurrent(null), "null ticket is not current");
  ok(!gate.isCurrent({}), "empty ticket is not current");
  ok(!gate.isCurrent({ generation: gate.generation, get signal() { throw new Error("hostile signal"); } }), "hostile signal getter fails closed");
  ok(!gate.isCurrent({ get generation() { throw new Error("hostile gen"); } }), "hostile generation getter fails closed");
  ok(!gate.isCurrent({ generation: gate.generation, signal: { get aborted() { throw new Error("hostile aborted"); } } }), "hostile aborted getter fails closed");

  console.log("6. Local-date grouping stable order");
  const gA = "2026-07-13T12:00:00.000000Z";
  const gB = "2026-03-01T12:00:00.000000Z";
  const gitems = [
    mkItem("g1", { createdAt: gA }),
    mkItem("g2", { createdAt: gA }),
    mkItem("g3", { createdAt: gB }),
    mkItem("g4", { createdAt: gA }),
    mkItem("bad", { createdAt: "not-a-timestamp" }),
  ];
  const grouped = groupHistoryItemsByLocalDate(gitems);
  eq(grouped.length, 3, "distinct local dates plus invalid bucket");
  eq(grouped[0].items.map((i) => i.itemId), ["item-g1", "item-g2", "item-g4"], "first-appearing date keeps all its items in server order");
  eq(grouped[1].items.length, 1, "second date bucket holds its single item");
  eq(grouped[2].dateKey, "invalid-date", "invalid-date bucket is placed last");
  eq(grouped[2].items.map((i) => i.itemId), ["item-bad"], "invalid createdAt item lands in the invalid bucket");
  ok(grouped[0].dateKey !== grouped[1].dateKey, "distinct dates produce distinct keys");
  const grouped2 = groupHistoryItemsByLocalDate(gitems);
  eq(
    grouped2.map((g) => [g.dateKey, g.items.map((i) => i.itemId)]),
    grouped.map((g) => [g.dateKey, g.items.map((i) => i.itemId)]),
    "grouping is deterministic across calls"
  );

  console.log("7. Source hygiene");
  const srcPath = join(ROOT, "src", "lib", "canvas", "history-client.ts");
  const src = readFileSync(srcPath, "utf8");
  let controlByte = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i);
    if (c === 0 || (c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f) {
      controlByte = true;
      break;
    }
  }
  ok(!controlByte, "history-client source has no NUL/control bytes");
  ok(!/\bfrom\s+["']react["']/.test(src) && !/\bfrom\s+["']react-dom["']/.test(src), "no React imports");
  ok(!/\bfetch\s*\(/.test(src), "no fetch calls");
  ok(!/\bXMLHttpRequest\b/.test(src), "no XMLHttpRequest");
  ok(!/\bwindow\b/.test(src) && !/\bdocument\b/.test(src), "no window/document access");
  ok(!/\bglobalThis\b/.test(src) && !/^\s*global\./m.test(src), "no global object access");
  ok(!/^(let|var)\s/m.test(src), "no top-level mutable (let/var) module state");
  ok(!/omnibox/i.test(src), "no omnibox references in S8 source");
  const importSpecifiers = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
  ok(importSpecifiers.length === 1 && importSpecifiers[0] === "@/lib/canvas/schema", `only the schema import is present (found ${JSON.stringify(importSpecifiers)})`);

  console.log("8. History panel, preview, and canvas-shell wiring");
  const uiPaths = {
    panel: join(ROOT, "src", "components", "canvas", "canvas-history-panel.tsx"),
    preview: join(ROOT, "src", "components", "canvas", "canvas-history-preview.tsx"),
    board: join(ROOT, "src", "components", "canvas", "canvas-board.tsx"),
    toolbar: join(ROOT, "src", "components", "canvas", "canvas-bottom-toolbar.tsx"),
    policy: join(ROOT, "src", "components", "canvas", "canvas-chrome-policy.ts"),
  };
  const uiSources = Object.fromEntries(
    Object.entries(uiPaths).map(([name, path]) => [name, readFileSync(path, "utf8")])
  );
  const panelSrc = uiSources.panel;
  const previewSrc = uiSources.preview;
  const boardSrc = uiSources.board;
  const toolbarSrc = uiSources.toolbar;
  const policySrc = uiSources.policy;
  const panelJsxTags = jsxTagNames(panelSrc, uiPaths.panel);
  const previewJsxTags = jsxTagNames(previewSrc, uiPaths.preview);

  for (const [name, source] of Object.entries({ client: src, ...uiSources })) {
    ok(!hasControlBytes(source), `${name} S8 source has no NUL/control bytes`);
  }
  ok(
    !Object.values({ client: src, ...uiSources }).some((source) => /omnibox/i.test(source)),
    "S8 implementation has no omnibox imports or references"
  );
  const omniboxSrc = readFileSync(
    join(ROOT, "src", "components", "studio-shell", "omnibox.tsx"),
    "utf8"
  );
  ok(
    !/canvas-history|history-client|CanvasHistoryPanel/.test(omniboxSrc),
    "omnibox remains architecturally decoupled from S8 history"
  );

  for (const helper of [
    "buildHistoryRequestUrl",
    "parseHistoryPagePayload",
    "createInitialHistoryState",
    "mergeHistoryPage",
    "createHistoryRequestGate",
    "groupHistoryItemsByLocalDate",
  ]) {
    ok(panelSrc.includes(helper), `panel uses ${helper}`);
  }
  ok((panelSrc.match(/\bfetch\s*\(/g) ?? []).length === 1, "panel has one bounded history fetch path");
  ok(panelSrc.includes('credentials: "include"'), "history fetch includes credentials");
  ok(panelSrc.includes('cache: "no-store"'), "history fetch disables browser caching");
  ok(panelSrc.includes('headers: { Accept: "application/json" }'), "history fetch requests JSON explicitly");
  ok(panelSrc.includes("signal: ticket.signal"), "history fetch uses request-ticket AbortSignal");
  ok((panelSrc.match(/gate\.isCurrent\(ticket\)/g) ?? []).length >= 4, "async panel writes are guarded by current ticket");
  ok((panelSrc.match(/gate\.invalidate\(\)/g) ?? []).length >= 3, "open/close/unmount invalidate request generations");
  ok(panelSrc.includes("pendingRef.current"), "panel blocks duplicate pagination requests");
  ok(panelSrc.includes("const sheetOpen = open && interactionEnabled"), "portal mount is identity/read-only gated");
  ok(panelSrc.includes("if (!interactionEnabled && open) onOpenChange(false)"), "loss of interaction closes controlled sheet");
  const closeSlice = boundedSlice(panelSrc, "// Closing aborts", "// Unmount cleanup");
  ok(
    closeSlice.includes("createInitialHistoryState(activeTab)") &&
      closeSlice.includes("setCounts(ZERO_COUNTS)") &&
      closeSlice.includes("stateRef.current = fresh"),
    "close/identity loss clears retained rows and API counts before reopen"
  );
  ok(panelSrc.includes("const isCurrentTabState = state.type === activeTab"), "tab switch has a stale-state render guard");
  const renderGuardSlice = boundedSlice(panelSrc, "const isCurrentTabState", "const statusText");
  ok(renderGuardSlice.includes('phase === "idle"'), "same-tab reopen renders loading instead of retained rows");
  ok(panelSrc.includes("key={item.sourceId}"), "history tiles use canonical sourceId React keys");
  ok((panelSrc.match(/\bsetCounts\(/g) ?? []).length === 2, "API-wide counts update from parsed data and reset only on close");
  ok(panelSrc.includes('groupHistoryItemsByLocalDate(state.items, "zh-CN")'), "local-date headings use the product locale");
  ok(panelSrc.includes('merged.code === "retention_bounded"'), "panel preserves retention-bound reason");
  ok(panelSrc.includes("state.truncated"), "panel surfaces diagnostic or retention truncation");
  ok(panelSrc.includes('item.type !== "image" && item.type !== "video"'), "panel permits add only for image/video");
  ok(panelSrc.includes("<Sheet") && panelSrc.includes("<Tabs") && panelSrc.includes("<ScrollArea"), "panel uses shipped Sheet/Tabs/ScrollArea primitives");
  ok(panelSrc.includes('aria-live="polite"') && panelSrc.includes("aria-label="), "panel exposes live status and labeled controls");
  ok(!/response\.status|error\.message|String\(error\)/.test(panelSrc), "panel never renders raw network/server errors");
  ok(!panelJsxTags.some((name) => name === "video" || name === "audio"), "panel mounts no video/audio players");
  ok(!/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/.test(panelSrc), "panel has no alternate network path");

  const previewKeySlice = boundedSlice(
    previewSrc,
    "const resolveKey = useMemo",
    "const containerRef"
  );
  ok(previewKeySlice.length > 0, "preview resolve-key policy slice is present");
  ok(previewKeySlice.includes('item.type === "image"') && previewKeySlice.includes("item.posterKey ?? item.objectKey"), "image preview resolves poster or object key");
  ok(previewKeySlice.includes('item.type === "video"') && previewKeySlice.includes("item.posterKey ?? null"), "video preview resolves poster only");
  ok(/return null;\s*\}, \[item\.type, item\.posterKey, item\.objectKey\]\);/.test(previewKeySlice), "audio preview has a null resolve key");
  for (const helper of ["peekMediaUrl", "resolveMediaUrl", "forgetMediaUrl"]) {
    ok(previewSrc.includes(helper), `preview uses S6 ${helper}`);
  }
  ok(previewSrc.includes("IntersectionObserver") && previewSrc.includes("PREVIEW_ROOT_MARGIN"), "preview defers URL resolution near viewport");
  ok(previewSrc.includes("new AbortController()"), "preview resolution is abortable");
  ok(previewSrc.includes("visibleKey !== resolveKey") && previewSrc.includes("media.key === resolveKey"), "preview visibility and media state are key-scoped");
  ok(previewSrc.includes("prev.key === key"), "preview async completion rejects stale keys");
  ok(previewSrc.includes('loading="lazy"') && previewSrc.includes('decoding="async"'), "preview image uses lazy async decoding");
  ok(previewSrc.includes("src={url}"), "preview img consumes only resolved URL state");
  ok(!previewJsxTags.some((name) => name === "video" || name === "audio") && !/\bautoPlay\s*=/.test(previewSrc), "preview mounts no video/audio/autoplay");
  ok(!/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/.test(previewSrc), "preview has no network path outside S6 resolver");
  ok(!/src=\{(?:item\.)?(?:objectKey|posterKey|resolveKey)\}/.test(previewSrc), "raw object keys never become media src");
  ok(!/canvas-store|useCanvasStore/.test(previewSrc), "preview has no store or persistence dependency");

  const historyHandler = boundedSlice(
    boardSrc,
    "const handleAddHistoryAsset = useCallback",
    "// 1)"
  );
  const openHandler = boundedSlice(boardSrc, "const openHistory = useCallback", "// 1)");
  ok(historyHandler.length > 0 && openHandler.length > 0, "board history handlers are present in bounded slices");
  ok(historyHandler.includes("readOnly || !interactionActive") && historyHandler.includes("useCanvasStore.getState().readOnly"), "history add rechecks closure and latest-store readOnly");
  ok(historyHandler.includes('item.type !== "image" && item.type !== "video"'), "board rejects audio history imports");
  ok((historyHandler.match(/\baddNode\s*\(/g) ?? []).length === 1, "history handler calls addNode exactly once");
  ok(historyHandler.includes("const media: CanvasMedia = { ossKey: item.objectKey }"), "history node persists OSS object key only");
  ok(historyHandler.includes("media.posterKey = item.posterKey"), "history node persists optional poster key only");
  ok(!/item\.(?:source|sourceId|rowId|itemId|url)\b/.test(historyHandler), "history handler persists no history identity or URL fields");
  ok(historyHandler.includes("HISTORY_SCREEN_OFFSETS") && historyHandler.includes("screenToFlowPosition"), "history placement projects bounded screen offsets");
  ok(historyHandler.includes("const occupied = new Set") && historyHandler.includes("firstCandidate"), "history placement checks deterministic collisions with bounded fallback");
  ok(openHandler.includes("interactionActive") && openHandler.includes("useCanvasStore.getState().readOnly") && openHandler.includes("setHistoryOpen(true)"), "history open action rechecks interaction and latest readOnly");
  ok(boardSrc.includes("onOpenHistory={openHistory}"), "board routes toolbar history action through guarded opener");
  ok(boardSrc.includes("interactionEnabled={interactionActive}") && boardSrc.includes("onAddAsset={handleAddHistoryAsset}"), "board passes controlled gate and add transaction to panel");
  ok(boardSrc.indexOf("</ReactFlow>") >= 0 && boardSrc.indexOf("</ReactFlow>") < boardSrc.indexOf("<CanvasHistoryPanel"), "history sheet is outside ReactFlow and inside board lifecycle");

  const toolbarEntries = [...policySrc.matchAll(
    /\{\s*id:\s*"([^"]+)",\s*label:\s*"[^"]+",\s*enabled:\s*(true|false)\s*\}/g
  )].map((match) => ({ id: match[1], enabled: match[2] === "true" }));
  eq(toolbarEntries.map((entry) => entry.id), [
    "add-node",
    "upload",
    "workflow",
    "assets",
    "characters",
    "history",
    "shortcuts",
    "tutorial",
  ], "toolbar policy retains exactly eight ordered entries");
  eq(toolbarEntries.filter((entry) => entry.enabled).map((entry) => entry.id), [
    "add-node",
    "upload",
    "history",
    "shortcuts",
  ], "toolbar enables only add-node/upload/history/shortcuts");
  ok(toolbarSrc.includes("onOpenHistory: () => void"), "toolbar requires history callback");
  ok(toolbarSrc.includes('entry.id === "history"') && toolbarSrc.includes("? onOpenHistory"), "history icon routes to history callback");
  ok(toolbarSrc.includes('entry.id === "shortcuts" ? false : disabled'), "shortcuts retain read-only exemption while history follows disabled gate");
  ok(!/<Card\b|from\s+["']@\/components\/ui\/card["']/.test(panelSrc + previewSrc), "history UI has no nested card dependency");

  // --- Report -------------------------------------------------------------
  const total = passed + failures.length;
  console.log("");
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log("");
  console.log(`S8 verifier: PASS ${passed} / FAIL ${failures.length} / TOTAL ${total}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  console.log(`S8 verifier: PASS ${passed} / FAIL ${failures.length + 1} / TOTAL ${passed + failures.length + 1}`);
  process.exit(1);
});
