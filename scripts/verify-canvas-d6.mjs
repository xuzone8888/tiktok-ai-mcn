#!/usr/bin/env node
/** D6 behavioral verifier: helper, bounded keysets, and route orchestration. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, ".temp", "canvas-verify-build");
const HELPER_OUT = join(OUT_DIR, "history-assets-d6.mjs");
const OWNERSHIP_OUT = join(OUT_DIR, "media-ownership.mjs");

let passed = 0;
const failures = [];
function ok(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}
async function rejectsCode(action, code, message) {
  try {
    await action();
    ok(false, `${message}: did not reject`);
  } catch (error) {
    eq(error?.code, code, message);
  }
}

const helperPath = join(ROOT, "src", "lib", "canvas", "history-assets.ts");
const ownershipPath = join(ROOT, "src", "lib", "canvas", "media-ownership.ts");
const ownershipCompatPath = join(ROOT, "src", "app", "api", "storage", "media-url", "ownership.ts");
const routePath = join(ROOT, "src", "app", "api", "canvas", "history", "route.ts");
const generationsPolicyPath = join(
  ROOT,
  "supabase",
  "migrations",
  "20260715_generations_service_role_policy.sql"
);
const generationsBasePath = join(ROOT, "supabase", "migrations", "006_generations_table.sql");
const helperSource = readFileSync(helperPath, "utf8");
const ownershipSource = readFileSync(ownershipPath, "utf8");
const ownershipCompatSource = readFileSync(ownershipCompatPath, "utf8");
const routeSource = readFileSync(routePath, "utf8");
const generationsPolicySource = readFileSync(generationsPolicyPath, "utf8");
const generationsBaseSource = readFileSync(generationsBasePath, "utf8");
mkdirSync(OUT_DIR, { recursive: true });

function transpile(source, fileName, moduleKind) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: moduleKind,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
    fileName,
    reportDiagnostics: true,
  });
}

const ownershipBuilt = transpile(ownershipSource, ownershipPath, ts.ModuleKind.ESNext);
writeFileSync(OWNERSHIP_OUT, ownershipBuilt.outputText, "utf8");
const helperBuilt = transpile(helperSource, helperPath, ts.ModuleKind.ESNext);
writeFileSync(
  HELPER_OUT,
  helperBuilt.outputText.replace('"./media-ownership"', '"./media-ownership.mjs"'),
  "utf8"
);
const history = await import(`${pathToFileURL(HELPER_OUT).href}?t=${Date.now()}`);
const ownership = await import(`${pathToFileURL(OWNERSHIP_OUT).href}?t=${Date.now()}`);

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CURRENT_BUCKET = "current-media-bucket";
const CURRENT_REGION = "oss-cn-shanghai";
const CURRENT_OSS_HOST = `${CURRENT_BUCKET}.${CURRENT_REGION}.aliyuncs.com`;
const CURRENT_CUSTOM_HOST = "media.current.example";
const hosts = history.getHistoryTrustedOssHosts({
  ALIYUN_OSS_BUCKET: CURRENT_BUCKET,
  ALIYUN_OSS_REGION: CURRENT_REGION,
  ALIYUN_OSS_CUSTOM_DOMAIN: `https://${CURRENT_CUSTOM_HOST}`,
});
const at = "2026-07-13T01:02:03.123456Z";
const ROW_IDS = {
  genMulti: "10000000-0000-4000-8000-000000000001",
  genLegacyVideo: "10000000-0000-4000-8000-000000000002",
  genResultAudio: "10000000-0000-4000-8000-000000000003",
  genPending: "10000000-0000-4000-8000-000000000004",
  genFailed: "10000000-0000-4000-8000-000000000005",
  productOne: "10000000-0000-4000-8000-000000000006",
  blueprintReference: "10000000-0000-4000-8000-000000000007",
  blueprintProductLink: "10000000-0000-4000-8000-000000000008",
  sameGeneration: "10000000-0000-4000-8000-000000000009",
  sameProduct: "10000000-0000-4000-8000-00000000000a",
  tooManyProducts: "10000000-0000-4000-8000-00000000000b",
  routeGeneration: "10000000-0000-4000-8000-00000000000c",
  routePending: "10000000-0000-4000-8000-00000000000d",
  routeProduct: "10000000-0000-4000-8000-00000000000e",
  routeBlueprint: "10000000-0000-4000-8000-00000000000f",
};
const imageA = `images/${USER}/a.png`;
const imageB = `products/${USER}/b.webp`;
const imageC = `user-uploads/${USER}/c.jpg`;
const imageD = `products/${USER}/product-only.png`;
const videoA = `videos/${USER}/a.mp4`;
const videoB = `quick-gen/${USER}/b.webm`;
const audioA = `misc/${USER}/a.mp3`;
const poster = `images/${USER}/poster.jpg`;

console.log("D6 trusted media ownership");
eq([...hosts].sort(), [CURRENT_CUSTOM_HOST, CURRENT_OSS_HOST].sort(), "hosts derive only from current config");
eq(
  [...history.getHistoryTrustedOssHosts({})].sort(),
  ["media.toryxai.com", "tokfactory-videos.oss-cn-beijing.aliyuncs.com"].sort(),
  "missing OSS config matches the current oss.ts defaults"
);
const switchedWithoutCustom = history.getHistoryTrustedOssHosts({
  ALIYUN_OSS_BUCKET: CURRENT_BUCKET,
  ALIYUN_OSS_REGION: CURRENT_REGION,
});
eq([...switchedWithoutCustom], [CURRENT_OSS_HOST], "a switched bucket does not inherit the old custom-domain default");
ok(!switchedWithoutCustom.has("tokfactory-videos.oss-cn-beijing.aliyuncs.com"), "a switched bucket drops the old bucket host");
ok(!switchedWithoutCustom.has("media.toryxai.com"), "a switched bucket drops the old custom host unless explicit");
eq(
  [...history.getHistoryTrustedOssHosts({ ALIYUN_OSS_BUCKET: CURRENT_BUCKET })],
  [`${CURRENT_BUCKET}.oss-cn-beijing.aliyuncs.com`],
  "a missing region uses its default without reviving the old custom host"
);
ok(!hosts.has("tokfactory-videos.oss-cn-beijing.aliyuncs.com"), "old bucket is not trusted after drift");
eq(
  history.extractOwnedHistoryObjectKey(`https://${CURRENT_OSS_HOST}/${videoA}`, USER, hosts),
  videoA,
  "clean current bucket URL reduces to an object key"
);
eq(
  history.extractOwnedHistoryObjectKey(`https://${CURRENT_OSS_HOST}/${videoA}?x=1`, USER, hosts),
  null,
  "current bucket URL with query parameters fails closed"
);
eq(
  history.extractOwnedHistoryObjectKey(
    `https://${CURRENT_CUSTOM_HOST}/${videoA}?x-oss-signature=redacted`,
    USER,
    hosts
  ),
  null,
  "current custom host signed URL fails closed"
);
eq(
  history.extractOwnedHistoryObjectKey(`https://other-bucket.${CURRENT_REGION}.aliyuncs.com/${videoA}`, USER, hosts),
  null,
  "another Aliyun bucket is not trusted"
);
eq(
  history.extractOwnedHistoryObjectKey(`https://${CURRENT_CUSTOM_HOST}/videos/${OTHER}/x.mp4`, USER, hosts),
  null,
  "trusted host cannot bypass owner segment"
);
eq(
  history.extractOwnedHistoryObjectKey(`https://${CURRENT_CUSTOM_HOST}/images/${USER}/a%2Fb.png`, USER, hosts),
  null,
  "encoded path ambiguity fails closed"
);
eq(
  history.extractOwnedHistoryObjectKey(`https://user:pass@${CURRENT_CUSTOM_HOST}/${imageA}`, USER, hosts),
  null,
  "URL credentials fail closed"
);
ok(history.isHistoryOwnedObjectKey(imageA, USER), "shared owner layout accepts the owner");
ok(!history.isHistoryOwnedObjectKey(imageA, OTHER), "shared owner layout rejects another owner");
ok(ownership.isOwnedObjectKey(imageA, USER) === history.isHistoryOwnedObjectKey(imageA, USER), "D6 reuses S6 ownership behavior");
ok(!ownership.isOwnedObjectKey(`secret/${USER}/x.png`, USER), "unknown media folders remain rejected");
for (const key of [`veo-videos/${USER}/veo.mp4`, `videos/assembly/${USER}/assembled.mp4`]) {
  ok(ownership.isOwnedObjectKey(key, USER), `real owned layout is accepted: ${key}`);
  ok(history.isHistoryOwnedObjectKey(key, USER), `history accepts the shared owned layout: ${key}`);
}
for (const key of [
  `veo-videos/${OTHER}/veo.mp4`,
  `veo-videos/${USER}/extra/veo.mp4`,
  `videos/assembly/${OTHER}/assembled.mp4`,
  `videos/assembly/${USER}/extra/assembled.mp4`,
  `videos/assembly/${USER}/../${OTHER}`,
]) {
  ok(!ownership.isOwnedObjectKey(key, USER), `owner bypass is rejected: ${key}`);
}

console.log("D6 three-source normalization");
const generationRows = [
  {
    id: ROW_IDS.genMulti,
    user_id: USER,
    status: "completed",
    type: "image",
    prompt: "Generated set",
    output_urls: [imageA, imageB],
    output_url: imageC,
    result_url: imageA,
    image_url: imageB,
    thumbnail_url: poster,
    metadata: { width: 1024, height: 1024 },
    created_at: at,
  },
  {
    id: ROW_IDS.genLegacyVideo,
    user_id: USER,
    status: "completed",
    type: "video",
    output_url: `https://${CURRENT_CUSTOM_HOST}/${videoA}`,
    video_url: videoA,
    created_at: "2026-07-13T01:01:00.000Z",
  },
  {
    id: ROW_IDS.genResultAudio,
    user_id: USER,
    status: "completed",
    type: "audio",
    result_url: audioA,
    created_at: "2026-07-13T01:00:00.000Z",
  },
  {
    id: ROW_IDS.genPending,
    user_id: USER,
    status: "pending",
    type: "image",
    output_url: `images/${USER}/pending.png`,
    created_at: at,
  },
  {
    id: ROW_IDS.genFailed,
    user_id: USER,
    status: "failed",
    type: "video",
    result_url: `videos/${USER}/failed.mp4`,
    created_at: at,
  },
];
const productRows = [
  {
    id: ROW_IDS.productOne,
    user_id: USER,
    name: "Product one",
    original_image_url: imageA,
    processed_images: { grid_images: [imageB, `https://${CURRENT_CUSTOM_HOST}/${imageC}`, imageD] },
    created_at: "2026-07-13T00:59:00.000Z",
  },
];
const blueprintRows = [
  {
    id: ROW_IDS.blueprintReference,
    user_id: USER,
    source_type: "reference_video",
    source_ref: {
      url: `https://${CURRENT_CUSTOM_HOST}/${videoB}`,
      upload_url: videoB,
      asset_urls: [imageC],
    },
    product: { title: "Snapshot", images: [imageB] },
    scenes: [
      { visual: "Close-up shot with warm lighting", slot: { kind: "product_image", asset_ref: imageA } },
      { visual: "https://evil.example/not-media.mp4", slot: { kind: "video", asset_ref: videoA } },
    ],
    globals: { bgm_url: audioA },
    created_at: "2026-07-13T00:58:00.000Z",
  },
  {
    id: ROW_IDS.blueprintProductLink,
    user_id: USER,
    source_type: "product_link",
    source_ref: { url: "https://shop.example/product/42" },
    scenes: [{ visual: "A textual visual direction" }],
    created_at: "2026-07-13T00:57:00.000Z",
  },
];
const normalized = history.normalizeHistorySources({
  generations: generationRows,
  products: productRows,
  blueprints: blueprintRows,
  userId: USER,
  trustedHosts: hosts,
});
eq(
  normalized.items.map((item) => item.objectKey).sort(),
  [imageA, imageB, imageC, imageD, videoA, videoB, audioA].sort(),
  "generations, products, and blueprint snapshots normalize with strict key dedupe"
);
eq(
  normalized.items.filter((item) => item.rowId === ROW_IDS.genMulti).map((item) => item.objectKey).sort(),
  [imageA, imageB, imageC].sort(),
  "output_urls and legacy output_url emit every distinct product"
);
ok(normalized.items.some((item) => item.rowId === ROW_IDS.productOne && item.source === "products"), "products are a real source");
ok(normalized.items.some((item) => item.rowId === ROW_IDS.blueprintReference && item.objectKey === videoB), "reference_video source_ref.url is media");
ok(!normalized.items.some((item) => item.rowId === ROW_IDS.genPending || item.rowId === ROW_IDS.genFailed), "helper rejects pending and failed generations");
ok(normalized.diagnostics.entries.filter((entry) => entry.code === "GENERATION_NOT_COMPLETED").length === 2, "non-completed rows have stable diagnostics");
ok(normalized.items.every((item) => !JSON.stringify(item).includes("https://")), "DTOs contain object keys, not media URLs");
ok(new Set(normalized.items.map((item) => item.sourceId)).size === normalized.items.length, "every emitted product has a stable unique id");
ok(normalized.items.every((item) => item.sourceId.startsWith(`${item.source}:`)), "stable ids include the real source namespace");
const normalizedAgain = history.normalizeHistorySources({
  generations: generationRows,
  products: productRows,
  blueprints: blueprintRows,
  userId: USER,
  trustedHosts: hosts,
});
eq(normalizedAgain.items.map((item) => item.sourceId), normalized.items.map((item) => item.sourceId), "product ids are deterministic");
const visualOnly = history.normalizeHistorySources({
  generations: [],
  products: [],
  blueprints: [blueprintRows[1]],
  userId: USER,
  trustedHosts: hosts,
});
eq(visualOnly, { items: [], diagnostics: { total: 0, truncated: false, entries: [] } }, "visual descriptions and product links are ignored without diagnostics");
const diagnosticText = JSON.stringify(normalized.diagnostics);
ok(!diagnosticText.includes(ROW_IDS.genPending) && !diagnosticText.includes("evil.example") && !diagnosticText.includes(imageA), "diagnostics expose no row id, URL, or key");

console.log("D6 strict query and type-bound cursor");
eq(
  history.canonicalizeHistoryTimestamp("2026-07-13T01:02:03.1Z"),
  "2026-07-13T01:02:03.100000Z",
  "one-digit PostgreSQL fractions pad to six digits"
);
eq(
  history.canonicalizeHistoryTimestamp("2026-07-13T01:02:03.123456+00:00"),
  at,
  "six-digit PostgreSQL UTC offsets preserve microseconds"
);
eq(
  history.canonicalizeHistoryTimestamp("2024-02-29T23:59:59.000001Z"),
  "2024-02-29T23:59:59.000001Z",
  "valid leap-day microseconds are accepted"
);
for (const timestamp of [
  "2026-07-13T01:02:03Z",
  "2026-07-13T01:02:03.1234567Z",
  "2026-07-13T01:02:03.123456+08:00",
  "2026-02-29T01:02:03.123456Z",
  "2026-07-13T24:00:00.123456Z",
]) {
  eq(history.canonicalizeHistoryTimestamp(timestamp), null, `invalid PostgreSQL timestamp is rejected: ${timestamp}`);
}
eq(history.parseHistoryQuery("").value, { type: "all", limit: 30, cursor: null }, "query defaults");
for (const query of [
  "foo=1",
  "type=image&type=video",
  "type=",
  "limit=",
  "cursor=",
  "type",
  "type=%69mage",
  "type=image+",
  "type=IMAGE",
  "limit=0",
  "limit=01",
  "limit=101",
  "limit=1.5",
  "type=image&",
  "type=image&&limit=1",
  "Type=image",
]) {
  ok(!history.parseHistoryQuery(query).ok, `strict query rejects ${query}`);
}
for (const type of ["all", "image", "video", "audio"]) {
  ok(history.parseHistoryQuery(`limit=1&type=${type}`).ok, `query accepts canonical ${type}`);
}
const cursorKey = {
  type: "image",
  createdAt: at,
  source: "generations",
  row: ROW_IDS.genMulti,
  item: "0000-output-urls-000000",
};
const encoded = history.encodeHistoryCursor(cursorKey);
eq(history.decodeHistoryCursor(encoded), cursorKey, "versioned cursor round trip");
ok(history.parseHistoryQuery(`type=image&cursor=${encoded}`).ok, "cursor accepts its bound tab");
eq(history.parseHistoryQuery(`type=video&cursor=${encoded}`).code, "INVALID_CURSOR", "cursor rejects another tab");
eq(history.decodeHistoryCursor(`${encoded}=`), null, "padded base64url is noncanonical");
const reordered = Buffer.from(JSON.stringify({
  type: cursorKey.type,
  v: 2,
  createdAt: cursorKey.createdAt,
  source: cursorKey.source,
  row: cursorKey.row,
  item: cursorKey.item,
})).toString("base64url");
eq(history.decodeHistoryCursor(reordered), null, "cursor JSON has one canonical encoding");
const oldVersion = Buffer.from(JSON.stringify({ v: 1, ...cursorKey })).toString("base64url");
eq(history.decodeHistoryCursor(oldVersion), null, "cursor rejects another version");
const extraField = Buffer.from(JSON.stringify({ v: 2, ...cursorKey, extra: true })).toString("base64url");
eq(history.decodeHistoryCursor(extraField), null, "cursor rejects unknown fields");
const safeFilter = history.buildHistorySourceKeysetFilter("generations", {
  createdAt: at,
  rowId: ROW_IDS.genMulti,
});
eq(
  safeFilter,
  `created_at.lt.${at},and(created_at.eq.${at},id.gt.${ROW_IDS.genMulti})`,
  "keyset filter is generated from canonical timestamp and UUID tokens"
);
for (const unsafeCursor of [
  { createdAt: "2026-07-13T01:02:03Z", rowId: ROW_IDS.genMulti },
  { createdAt: `${at},and(id.gt.attack)`, rowId: ROW_IDS.genMulti },
  { createdAt: `${at}(attack)`, rowId: ROW_IDS.genMulti },
  { createdAt: at, rowId: ROW_IDS.sameProduct.toUpperCase() },
  { createdAt: at, rowId: `${ROW_IDS.genMulti},id.gt.attack` },
  { createdAt: at, rowId: `${ROW_IDS.genMulti}(attack)` },
  { createdAt: at, rowId: `${ROW_IDS.genMulti}.attack` },
]) {
  await rejectsCode(
    async () => history.buildHistorySourceKeysetFilter("generations", unsafeCursor),
    "SOURCE_QUERY_FAILED",
    `keyset filter rejects ${JSON.stringify(unsafeCursor)}`
  );
}
const injectedCursor = Buffer.from(JSON.stringify({
  v: 2,
  type: "image",
  createdAt: at,
  source: "generations",
  row: `${ROW_IDS.genMulti},id.gt.attack`,
  item: "0000-output-urls-000000",
})).toString("base64url");
eq(history.decodeHistoryCursor(injectedCursor), null, "public cursor rejects a filter-injection row token");

console.log("D6 same-time multi-product pagination");
const sameTime = history.normalizeHistorySources({
  generations: [{
    id: ROW_IDS.sameGeneration,
    user_id: USER,
    status: "completed",
    type: "image",
    output_urls: [imageA, imageB, imageC],
    output_url: imageA,
    created_at: at,
  }],
  products: [{
    id: ROW_IDS.sameProduct,
    user_id: USER,
    name: "Same time",
    original_image_url: `images/${USER}/same-time.png`,
    processed_images: null,
    created_at: at,
  }],
  blueprints: [],
  userId: USER,
  trustedHosts: hosts,
});
const expectedOrder = [...sameTime.items].sort(history.compareHistoryAssets).map((item) => item.sourceId);
const pagedIds = [];
let cursor = null;
do {
  const queryText = cursor ? `limit=1&cursor=${cursor}` : "limit=1";
  const page = history.paginateHistoryAssets(sameTime.items, history.parseHistoryQuery(queryText).value);
  pagedIds.push(...page.items.map((item) => item.sourceId));
  cursor = page.nextCursor;
} while (cursor);
eq(pagedIds, expectedOrder, "row/item tie-break pages have no skips or repeats");
eq(new Set(pagedIds).size, sameTime.items.length, "same-time duplicate keys emit once");
const firstPage = history.paginateHistoryAssets(sameTime.items, history.parseHistoryQuery("limit=2").value);
eq(firstPage.counts, { all: 4, image: 4, video: 0, audio: 0 }, "counts are exact over deduped multi-products");
ok(firstPage.nextCursor !== null && firstPage.items.length === 2, "limit drives page extraction with lookahead");

console.log("D6 bounded compound keyset scanning");
function isAfterRow(row, cursorValue) {
  if (!cursorValue) return true;
  const createdAt = history.canonicalizeHistoryTimestamp(row.created_at);
  if (!createdAt) throw new Error(`Invalid fixture timestamp: ${row.created_at}`);
  return createdAt < cursorValue.createdAt ||
    (createdAt === cursorValue.createdAt && row.id > cursorValue.rowId);
}
function makeBatchReader(rows, requests) {
  return async (request) => {
    requests.push(request);
    return rows.filter((row) => isAfterRow(row, request.cursor)).slice(0, request.limit);
  };
}
function datedRow(index, extra = {}) {
  return {
    id: `30000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    user_id: USER,
    status: "completed",
    type: "image",
    output_url: `https://evil.example/${index}.png`,
    created_at: new Date(Date.parse(at) - index).toISOString(),
    ...extra,
  };
}
const crossBatchRows = Array.from(
  { length: history.HISTORY_SOURCE_BATCH_SIZE + 2 },
  (_, index) => datedRow(index)
);
crossBatchRows[crossBatchRows.length - 2].output_url = `images/${USER}/late-a.png`;
crossBatchRows[crossBatchRows.length - 1].output_url = `images/${USER}/late-b.png`;
const crossBatchRequests = [];
const scanned = await history.readBoundedHistorySourceRows(
  "generations",
  makeBatchReader(crossBatchRows, crossBatchRequests)
);
eq(scanned.length, crossBatchRows.length, "scanner advances beyond a full bad-media batch");
ok(crossBatchRequests.length === 2 && crossBatchRequests[1].cursor !== null, "scanner uses a compound continuation cursor");
const crossBatchNormalized = history.normalizeHistorySources({
  generations: scanned,
  products: [],
  blueprints: [],
  userId: USER,
  trustedHosts: hosts,
});
eq(crossBatchNormalized.items.map((item) => item.objectKey), [`images/${USER}/late-a.png`, `images/${USER}/late-b.png`], "bad rows do not permanently hide later valid products");
ok(crossBatchNormalized.diagnostics.entries.length === history.HISTORY_DIAGNOSTIC_LIMIT && crossBatchNormalized.diagnostics.truncated, "bad-row diagnostics have a fixed output bound");

const microsecondRows = Array.from({ length: history.HISTORY_SOURCE_BATCH_SIZE + 1 }, (_, index) => ({
  id: `60000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  user_id: USER,
  status: "completed",
  type: "image",
  output_url: `images/${USER}/micro-${index}.png`,
  created_at: index < history.HISTORY_SOURCE_BATCH_SIZE
    ? "2026-07-13T01:02:03.123456+00:00"
    : "2026-07-13T01:02:03.123455+00:00",
}));
const microsecondRequests = [];
const microsecondScan = await history.readBoundedHistorySourceRows(
  "generations",
  makeBatchReader(microsecondRows, microsecondRequests)
);
eq(microsecondScan.length, 129, "129 rows spanning equal and adjacent microseconds are all scanned");
eq(microsecondRequests.length, 2, "the 129-row microsecond case crosses exactly one keyset boundary");
eq(
  microsecondRequests[1].cursor.createdAt,
  "2026-07-13T01:02:03.123456Z",
  "the continuation cursor preserves all six fractional digits"
);
const normalizedMicroseconds = history.normalizeHistorySources({
  generations: microsecondScan,
  products: [],
  blueprints: [],
  userId: USER,
  trustedHosts: hosts,
});
eq(normalizedMicroseconds.items.length, 129, "normalization does not lose equal or adjacent microsecond rows");
ok(
  normalizedMicroseconds.items.some((item) => item.createdAt.endsWith(".123455Z")) &&
    normalizedMicroseconds.items.some((item) => item.createdAt.endsWith(".123456Z")),
  "sorting retains both adjacent microsecond values"
);

const exactCapRows = Array.from({ length: history.HISTORY_MAX_SOURCE_ROWS }, (_, index) => datedRow(index));
const exactCapRequests = [];
const exactCap = await history.readBoundedHistorySourceRows(
  "generations",
  makeBatchReader(exactCapRows, exactCapRequests)
);
eq(exactCap.length, history.HISTORY_MAX_SOURCE_ROWS, "exact source cap succeeds after an empty probe");
ok(exactCapRequests.at(-1).limit === 1, "exact-cap scan performs a one-row overflow probe");

const overflowRows = [...exactCapRows, datedRow(history.HISTORY_MAX_SOURCE_ROWS)];
const overflowRequests = [];
await rejectsCode(
  () => history.readBoundedHistorySourceRows("generations", makeBatchReader(overflowRows, overflowRequests)),
  "HISTORY_SOURCE_TOO_LARGE",
  "source overflow fails closed"
);
ok(overflowRequests.length <= history.HISTORY_MAX_BATCHES, "database batch count has a hard ceiling");
ok(overflowRequests.every((request) => request.limit <= history.HISTORY_SOURCE_BATCH_SIZE), "every database read has a hard row limit");
await rejectsCode(
  async () => history.normalizeHistorySources({
    generations: [{
      id: ROW_IDS.tooManyProducts,
      user_id: USER,
      status: "completed",
      type: "image",
      output_urls: Array.from({ length: history.HISTORY_MAX_ITEMS_PER_ROW + 1 }, (_, index) => `images/${USER}/${index}.png`),
      created_at: at,
    }],
    products: [],
    blueprints: [],
    userId: USER,
    trustedHosts: hosts,
  }),
  "HISTORY_SOURCE_TOO_LARGE",
  "normalization product fanout has a hard ceiling"
);

console.log("D6 route behavior with an in-memory Supabase keyset");
let activeClient;
const routeBuilt = transpile(routeSource, routePath, ts.ModuleKind.CommonJS);
const routeModule = { exports: {} };
const quietConsole = { error() {}, log() {}, warn() {} };
const routeContext = vm.createContext({
  module: routeModule,
  exports: routeModule.exports,
  require(specifier) {
    if (specifier === "next/server") {
      return {
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status ?? 200, headers: init.headers ?? {} };
          },
        },
      };
    }
    if (specifier === "@/lib/supabase/server") return { createClient: async () => activeClient };
    if (specifier === "@/lib/canvas/history-assets") return history;
    if (specifier === "@supabase/supabase-js") return {};
    throw new Error(`Unexpected route dependency: ${specifier}`);
  },
  URL,
  console: quietConsole,
  process,
  Promise,
  Object,
  Array,
  Error,
  RegExp,
  String,
  Number,
  Boolean,
  JSON,
  Map,
  Set,
});
new vm.Script(routeBuilt.outputText, { filename: routePath }).runInContext(routeContext);
const route = routeModule.exports;

function makeSupabase(tables, options = {}) {
  const calls = [];
  class Query {
    constructor(source) {
      this.source = source;
      this.filters = [];
      this.columns = "";
      this.cursor = null;
      this.expression = null;
    }
    select(columns) {
      this.columns = columns;
      return this;
    }
    eq(field, value) {
      this.filters.push([field, value]);
      return this;
    }
    order() {
      return this;
    }
    or(expression) {
      const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)$/.exec(expression);
      if (!match || match[1] !== match[2]) throw new Error(`Invalid keyset expression: ${expression}`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(match[1])) {
        throw new Error(`Noncanonical keyset timestamp: ${expression}`);
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(match[3])) {
        throw new Error(`Noncanonical keyset UUID: ${expression}`);
      }
      this.cursor = { createdAt: match[1], rowId: match[3] };
      this.expression = expression;
      return this;
    }
    async limit(limit) {
      calls.push({
        source: this.source,
        columns: this.columns,
        filters: this.filters.map((entry) => [...entry]),
        cursor: this.cursor && { ...this.cursor },
        expression: this.expression,
        limit,
      });
      const relationErrorCode = options.missingRelations?.[this.source];
      if (relationErrorCode) {
        return {
          data: null,
          error: { status: 404, code: relationErrorCode, message: "sensitive missing relation detail" },
        };
      }
      const undefinedColumn = (options.undefinedColumns ?? []).find((column) =>
        this.columns.split(",").includes(column)
      );
      if (undefinedColumn) {
        return {
          data: null,
          error: {
            status: 400,
            code: options.undefinedColumnCode ?? "42703",
            message: `sensitive missing column detail: ${undefinedColumn}`,
          },
        };
      }
      if (options.failSource === this.source) {
        return {
          data: null,
          error: options.permission
            ? { status: 403, code: "42501", message: "sensitive database detail" }
            : {
                status: 500,
                code: options.errorCode ?? "XX000",
                message: "sensitive database detail",
              },
        };
      }
      let rows = [...(tables[this.source] ?? [])];
      for (const [field, value] of this.filters) rows = rows.filter((row) => row[field] === value);
      rows.sort((a, b) => {
        const aCreatedAt = history.canonicalizeHistoryTimestamp(a.created_at);
        const bCreatedAt = history.canonicalizeHistoryTimestamp(b.created_at);
        if (!aCreatedAt || !bCreatedAt) throw new Error("Invalid route fixture timestamp");
        return bCreatedAt.localeCompare(aCreatedAt) || a.id.localeCompare(b.id);
      });
      rows = rows.filter((row) => isAfterRow(row, this.cursor));
      const selectedColumns = this.columns.split(",");
      return {
        data: rows.slice(0, limit).map((row) => Object.fromEntries(
          selectedColumns
            .filter((column) => Object.prototype.hasOwnProperty.call(row, column))
            .map((column) => [column, row[column]])
        )),
        error: null,
      };
    }
  }
  return {
    calls,
    auth: {
      async getUser() {
        if (options.unauthenticated) return { data: { user: null }, error: { code: "AUTH" } };
        return { data: { user: { id: USER } }, error: null };
      },
      async getClaims() {
        if (options.unauthenticated) {
          return { data: null, error: { code: "AUTH" } };
        }
        return { data: { claims: { sub: USER } }, error: null };
      },
      async getSession() {
        if (options.unauthenticated) {
          return { data: { session: null }, error: { code: "AUTH" } };
        }
        return {
          data: { session: { access_token: "verified-by-postgrest" } },
          error: null,
        };
      },
    },
    from(source) {
      return new Query(source);
    },
  };
}

const routeTables = {
  generations: [{
    id: ROW_IDS.routeGeneration,
    user_id: USER,
    status: "completed",
    type: "image",
    output_urls: [imageA, imageB],
    output_url: imageA,
    created_at: at,
  }, {
    id: ROW_IDS.routePending,
    user_id: USER,
    status: "pending",
    type: "image",
    output_url: `images/${USER}/pending-route.png`,
    created_at: at,
  }],
  products: [{
    id: ROW_IDS.routeProduct,
    user_id: USER,
    name: "Route product",
    original_image_url: imageC,
    processed_images: { grid_images: [imageA] },
    created_at: "2026-07-13T01:01:00.000Z",
  }],
  blueprints: [{
    id: ROW_IDS.routeBlueprint,
    user_id: USER,
    source_type: "reference_video",
    source_ref: { url: videoA },
    scenes: [{ visual: "Text only" }],
    created_at: "2026-07-13T01:00:00.000Z",
  }],
};
activeClient = makeSupabase(routeTables);
const routeResponse = await route.GET({ url: "https://app.example/api/canvas/history?limit=2" });
ok(routeResponse.status === 200 && routeResponse.body.success, "route returns a successful bounded read");
eq(routeResponse.body.data.counts, { all: 4, image: 3, video: 1, audio: 0 }, "route counts all deduped JSON products exactly");
ok(routeResponse.body.data.items.length === 2 && routeResponse.body.data.nextCursor, "route page honors the requested limit");
eq([...new Set(activeClient.calls.map((call) => call.source))].sort(), ["blueprints", "generations", "products"].sort(), "route reads exactly the three existing sources");
ok(activeClient.calls.every((call) => call.filters.some(([field, value]) => field === "user_id" && value === USER)), "every route query has an explicit owner predicate");
ok(activeClient.calls.filter((call) => call.source === "generations").every((call) => call.filters.some(([field, value]) => field === "status" && value === "completed")), "generation queries only read completed rows");
ok(activeClient.calls.some((call) => call.source === "products" && call.columns.includes("original_image_url") && call.columns.includes("processed_images")), "route selects real product media columns");
ok(activeClient.calls.some((call) => call.source === "generations" && call.columns.includes("output_url") && call.columns.includes("output_urls")), "route selects legacy generation output columns");
eq(routeResponse.body.data.diagnostics.total, 0, "route does not diagnose filtered pending rows or visual copy");
eq(
  routeResponse.body.data.sources,
  {
    generations: { health: "available" },
    products: { health: "available" },
    blueprints: { health: "available" },
  },
  "successful responses expose stable health for every source"
);
ok(
  routeResponse.body.data.items.some(
    (item) => item.rowId === ROW_IDS.routeGeneration && item.objectKey === imageB
  ),
  "the full generations schema returns every output_urls product"
);

const currentSchemaRows = Array.from(
  { length: history.HISTORY_SOURCE_BATCH_SIZE + 1 },
  (_, index) => ({
    id: `70000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    user_id: USER,
    status: "completed",
    type: "image",
    output_url: `images/${USER}/current-schema-${index}.png`,
    created_at: new Date(Date.parse("2026-07-13T01:00:00.000Z") - index).toISOString(),
  })
);
activeClient = makeSupabase(
  { generations: currentSchemaRows, products: [], blueprints: [] },
  { undefinedColumns: ["output_urls"], undefinedColumnCode: "PGRST204" }
);
const currentSchemaResponse = await route.GET({ url: "https://app.example/api/canvas/history?limit=1" });
ok(currentSchemaResponse.status === 200 && currentSchemaResponse.body.success, "missing output_urls negotiates to the current schema");
eq(currentSchemaResponse.body.data.counts.all, 129, "the current schema scans all rows after negotiation");
const currentGenerationCalls = activeClient.calls.filter((call) => call.source === "generations");
eq(currentGenerationCalls.length, 3, "one failed enhanced probe is followed by two cached current-schema batches");
ok(currentGenerationCalls[0].columns.includes("output_urls"), "enhanced generation columns are tried first");
ok(
  currentGenerationCalls.slice(1).every((call) => !call.columns.includes("output_urls")),
  "later generation batches do not repeat the failed output_urls probe"
);

const minimalSchemaRows = currentSchemaRows.map((row, index) => ({
  ...row,
  output_urls: [`images/${USER}/unavailable-list-${index}.png`],
  result_url: `images/${USER}/minimal-schema-${index}.png`,
}));
activeClient = makeSupabase(
  { generations: minimalSchemaRows, blueprints: routeTables.blueprints },
  {
    undefinedColumns: ["output_urls", "output_url"],
    undefinedColumnCode: "42703",
    missingRelations: { products: "42P01" },
  }
);
const productionSchemaResponse = await route.GET({ url: "https://app.example/api/canvas/history?limit=2" });
ok(
  productionSchemaResponse.status === 200 && productionSchemaResponse.body.success,
  "production schema succeeds with products absent and generations on the minimal variant"
);
eq(
  productionSchemaResponse.body.data.sources.products,
  { health: "unavailable" },
  "PostgreSQL 42P01 marks only the optional products source unavailable"
);
ok(
  productionSchemaResponse.body.data.counts.all === 130 &&
    productionSchemaResponse.body.data.items.some((item) => item.source === "generations"),
  "generations and blueprints still contribute when products is unavailable"
);
const minimalGenerationCalls = activeClient.calls.filter((call) => call.source === "generations");
eq(minimalGenerationCalls.length, 4, "two bounded schema probes precede two cached minimal-schema batches");
ok(
  minimalGenerationCalls.slice(2).every(
    (call) => !call.columns.includes("output_urls") && !call.columns.includes("output_url")
  ),
  "the selected minimal generation variant is reused without re-probing"
);
ok(
  !JSON.stringify(productionSchemaResponse.body).includes("sensitive missing"),
  "optional-source health does not leak database messages"
);

const legacySchemaRows = [{
  id: "71000000-0000-4000-8000-000000000001",
  user_id: USER,
  status: "completed",
  generation_type: "video",
  output_url: `videos/${USER}/legacy-schema.mp4`,
  thumbnail_url: `images/${USER}/legacy-schema.jpg`,
  created_at: "2026-07-13T01:00:00.123456+00:00",
}];
activeClient = makeSupabase(
  { generations: legacySchemaRows, products: [], blueprints: [] },
  { undefinedColumns: ["output_urls", "result_url", "type"], undefinedColumnCode: "42703" }
);
const legacySchemaResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(
  legacySchemaResponse.status === 200 && legacySchemaResponse.body.success,
  "legacy generation_type plus output_url schema succeeds after bounded negotiation"
);
eq(legacySchemaResponse.body.data.counts, { all: 1, image: 0, video: 1, audio: 0 }, "legacy schema media is normalized");
eq(
  legacySchemaResponse.body.data.items[0]?.objectKey,
  `videos/${USER}/legacy-schema.mp4`,
  "legacy output_url remains available without exposing a full URL"
);
const legacyGenerationCalls = activeClient.calls.filter((call) => call.source === "generations");
eq(legacyGenerationCalls.length, 4, "legacy schema selects and caches the fourth generation variant");
ok(
  legacyGenerationCalls[3].columns.includes("generation_type") &&
    !legacyGenerationCalls[3].columns.includes("result_url"),
  "legacy fallback requests only columns present in the historical migration"
);

activeClient = makeSupabase(
  { generations: [], blueprints: [] },
  { missingRelations: { products: "PGRST205" } }
);
const schemaCacheMissingProducts = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(schemaCacheMissingProducts.status === 200 && schemaCacheMissingProducts.body.success, "PostgREST PGRST205 is also an optional products absence");
eq(schemaCacheMissingProducts.body.data.sources.products.health, "unavailable", "PGRST205 has stable unavailable health");

activeClient = makeSupabase(routeTables);
const noncanonicalResponse = await route.GET({ url: "https://app.example/api/canvas/history?type=%69mage" });
ok(noncanonicalResponse.status === 400 && noncanonicalResponse.body.error.code === "INVALID_QUERY", "route rejects a noncanonical raw query");
eq(activeClient.calls.length, 0, "invalid query performs no source reads");

activeClient = makeSupabase(routeTables, { failSource: "products" });
const failedSourceResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(failedSourceResponse.status === 500 && failedSourceResponse.body.error.code === "SOURCE_QUERY_FAILED", "an added-source failure is not an empty history");
eq(failedSourceResponse.body.error.source, "products", "source failure reports only the stable source name");
ok(!JSON.stringify(failedSourceResponse.body).includes("sensitive database detail"), "database messages never enter source errors");

activeClient = makeSupabase(routeTables, { failSource: "blueprints", permission: true });
const forbiddenResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(forbiddenResponse.status === 403 && forbiddenResponse.body.error.code === "SOURCE_FORBIDDEN", "permission failure is explicit");

activeClient = makeSupabase(routeTables, { failSource: "generations", permission: true });
const generationForbiddenResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(
  generationForbiddenResponse.status === 403 && generationForbiddenResponse.body.error.code === "SOURCE_FORBIDDEN",
  "generation permission errors never trigger schema downgrade"
);
eq(
  activeClient.calls.filter((call) => call.source === "generations").length,
  1,
  "generation permission failure performs one schema attempt"
);

activeClient = makeSupabase(routeTables, { failSource: "generations", errorCode: "08006" });
const generationNetworkResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(
  generationNetworkResponse.status === 500 && generationNetworkResponse.body.error.code === "SOURCE_QUERY_FAILED",
  "generation network errors remain hard failures"
);
eq(
  activeClient.calls.filter((call) => call.source === "generations").length,
  1,
  "generation network failure is not mistaken for an undefined column"
);

const routeOverflowProducts = Array.from({ length: history.HISTORY_MAX_SOURCE_ROWS + 1 }, (_, index) => ({
  id: `40000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  user_id: USER,
  name: "Bounded",
  original_image_url: `products/${USER}/${index}.png`,
  processed_images: null,
  created_at: new Date(Date.parse(at) - index).toISOString(),
}));
activeClient = makeSupabase({ generations: [], products: routeOverflowProducts, blueprints: [] });
const overflowResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(overflowResponse.status === 413 && overflowResponse.body.error.code === "HISTORY_SOURCE_TOO_LARGE", "route fails closed instead of returning truncated counts");
eq(overflowResponse.body.error.source, "products", "overflow identifies only its stable source");
ok(!overflowResponse.body.data, "overflow response contains no partial page or counts");
ok(activeClient.calls.filter((call) => call.source === "products").length <= history.HISTORY_MAX_BATCHES, "route enforces the batch ceiling");
ok(
  activeClient.calls
    .filter((call) => call.source === "products" && call.cursor)
    .every((call) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(call.cursor.createdAt) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(call.cursor.rowId)
    ),
  "every route continuation uses only canonical filter tokens"
);

const maliciousFullBatch = Array.from({ length: history.HISTORY_SOURCE_BATCH_SIZE }, (_, index) => ({
  id: index === history.HISTORY_SOURCE_BATCH_SIZE - 1
    ? `${ROW_IDS.routeProduct},id.gt.attack`
    : `50000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  user_id: USER,
  name: "Untrusted row",
  original_image_url: `products/${USER}/untrusted-${index}.png`,
  processed_images: null,
  created_at: new Date(Date.parse(at) - index).toISOString(),
}));
activeClient = makeSupabase({ generations: [], products: maliciousFullBatch, blueprints: [] });
const maliciousRowResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(maliciousRowResponse.status === 500 && maliciousRowResponse.body.error.code === "SOURCE_QUERY_FAILED", "malicious full-batch row id fails before filter construction");
eq(activeClient.calls.filter((call) => call.source === "products").length, 1, "malicious row id never reaches a continuation query");

activeClient = makeSupabase(routeTables, { unauthenticated: true });
const authResponse = await route.GET({ url: "https://app.example/api/canvas/history" });
ok(authResponse.status === 401 && authResponse.body.error.code === "UNAUTHENTICATED", "route requires an authenticated user");
eq(activeClient.calls.length, 0, "unauthenticated requests read no source");

console.log("D6 generations RLS repair migration");
const servicePolicy = generationsPolicySource.match(
  /CREATE POLICY "generations_service_role_all"[\s\S]*?;/i
)?.[0] ?? "";
ok(
  /DROP POLICY IF EXISTS "Service can manage all generations" ON public\.generations\s*;/i.test(
    generationsPolicySource
  ),
  "the follow-up migration drops the legacy fictional service policy"
);
ok(
  /DROP POLICY IF EXISTS "allow_all" ON public\.generations\s*;/i.test(
    generationsPolicySource
  ),
  "the follow-up migration drops the measured live PUBLIC catch-all policy"
);
ok(
  /FOR ALL\s+TO service_role\s+USING\s*\(\s*true\s*\)\s+WITH CHECK\s*\(\s*true\s*\)/i.test(
    servicePolicy
  ),
  "the reviewed generations service policy is scoped to service_role"
);
ok(
  !/\bTO\s+(?:PUBLIC|authenticated)\b/i.test(servicePolicy),
  "the repair does not retain public or authenticated access"
);
ok(
  !/DROP POLICY[^;]+Users can (?:view|insert|update) own generations/i.test(generationsPolicySource),
  "the repair leaves authenticated own-row policies in place"
);
for (const policyName of [
  "Users can view own generations",
  "Users can insert own generations",
  "Users can update own generations",
]) {
  ok(
    new RegExp(`CREATE POLICY "${policyName}" ON public\\.generations`, "i").test(generationsBaseSource),
    `the base migration retains own-row policy: ${policyName}`
  );
}

console.log("D6 source hygiene");
const routeAst = ts.createSourceFile(routePath, routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let selectStar = false;
let adminIdentifier = false;
function visit(node) {
  if (ts.isStringLiteral(node) && node.text === "*") selectStar = true;
  if (ts.isIdentifier(node) && /createAdminClient|serviceRole/i.test(node.text)) adminIdentifier = true;
  ts.forEachChild(node, visit);
}
visit(routeAst);
ok(!selectStar, "route AST contains no select-star query");
ok(!adminIdentifier, "route AST contains no admin bypass identifier");
ok(ownershipCompatSource.includes('from "@/lib/canvas/media-ownership"'), "S6 compatibility path still delegates to shared ownership");
ok(
  !/[\u0080-\uffff]/.test(
    helperSource +
      routeSource +
      generationsPolicySource.replace(/--.*$/gm, "") +
      readFileSync(fileURLToPath(import.meta.url), "utf8")
  ),
  "D6 executable implementation and verifier remain ASCII (SQL comments may be UTF-8)"
);

console.log(`D6 result: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
