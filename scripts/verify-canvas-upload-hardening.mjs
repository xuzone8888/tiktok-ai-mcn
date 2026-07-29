#!/usr/bin/env node

/**
 * Pure/offline verifier for the Super Canvas upload boundary.
 *
 * It executes the shared metadata contract and inspects the route/client/board
 * integration. It does not require credentials and never contacts OSS.
 */
import { readFileSync } from "node:fs";

import { loadCanvasModule } from "./canvas-build.mjs";

const contract = await loadCanvasModule("upload-contract");
const route = readFileSync(
  new URL("../src/app/api/canvas/uploads/credentials/route.ts", import.meta.url),
  "utf8"
);
const finalizeRoute = readFileSync(
  new URL("../src/app/api/canvas/uploads/finalize/route.ts", import.meta.url),
  "utf8"
);
const client = readFileSync(
  new URL("../src/components/canvas/canvas-upload.ts", import.meta.url),
  "utf8"
);
const board = readFileSync(
  new URL("../src/components/canvas/canvas-board.tsx", import.meta.url),
  "utf8"
);
const checkUrlRoute = readFileSync(
  new URL("../src/app/api/upload/check-url/route.ts", import.meta.url),
  "utf8"
);
const transferRoute = readFileSync(
  new URL("../src/app/api/upload/transfer-to-oss/route.ts", import.meta.url),
  "utf8"
);
const safeMedia = readFileSync(
  new URL("../src/lib/safe-media-fetch.ts", import.meta.url),
  "utf8"
);

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function accepted(file) {
  try {
    contract.validateCanvasUploadFileMetadata(file);
    return true;
  } catch {
    return false;
  }
}

const image = {
  name: "product.webp",
  type: "image/webp",
  size: contract.CANVAS_UPLOAD_MAX_IMAGE_BYTES,
};
const video = {
  name: "demo.mp4",
  type: "video/mp4",
  size: contract.CANVAS_UPLOAD_MAX_VIDEO_BYTES,
};
const uploadId = "123e4567-e89b-42d3-a456-426614174000";
const requestImage = { id: uploadId, ...image };

ok(accepted(image), "accepts an image exactly at the 10MB boundary");
ok(accepted(video), "accepts a video exactly at the 256MB boundary");
ok(
  accepted({ name: "clip.mov", type: "video/quicktime", size: 1 }),
  "accepts a canonical QuickTime MOV"
);
ok(
  !accepted({ ...image, size: contract.CANVAS_UPLOAD_MAX_IMAGE_BYTES + 1 }),
  "rejects an image over 10MB"
);
ok(
  !accepted({ ...video, size: contract.CANVAS_UPLOAD_MAX_VIDEO_BYTES + 1 }),
  "rejects a video over 256MB"
);
ok(!accepted({ ...image, size: 0 }), "rejects an empty file");
ok(
  contract.validateCanvasUploadBatchMetadata([video, video]).length === 2,
  "accepts a batch exactly at the 512MB boundary"
);
let batchOverLimitRejected = false;
try {
  contract.validateCanvasUploadBatchMetadata([
    video,
    video,
    { name: "extra.png", type: "image/png", size: 1 },
  ]);
} catch {
  batchOverLimitRejected = true;
}
ok(batchOverLimitRejected, "rejects a batch over the 512MB boundary");
ok(
  !accepted({ ...image, name: "../product.webp" }),
  "rejects path separators in a filename"
);
ok(
  !accepted({ ...image, name: "product.webp", type: "image/png" }),
  "rejects MIME and extension mismatch"
);
ok(
  !accepted({ ...image, name: "product.svg", type: "image/svg+xml" }),
  "rejects executable SVG input"
);
ok(
  contract.CanvasUploadRequestSchema.safeParse({ files: [requestImage] }).success,
  "strict request schema accepts one canonical file"
);
ok(
  !contract.CanvasUploadRequestSchema.safeParse({
    files: [requestImage],
    publicUrl: "https://attacker.invalid/file",
  }).success,
  "strict request schema rejects unknown top-level fields"
);
ok(
  !contract.CanvasUploadRequestSchema.safeParse({
    files: Array.from(
      { length: contract.CANVAS_UPLOAD_MAX_FILES + 1 },
      () => requestImage
    ),
  }).success,
  "strict request schema rejects more than ten files"
);

ok(route.includes("auth.getUser()"), "route authenticates the cookie user");
ok(
  route.includes("canAccessSuperCanvas"),
  "route enforces the server-authoritative Canvas gate"
);
ok(
  route.includes("isOwnedObjectKey(objectKey, user.id)"),
  "route validates every generated key against the ownership policy"
);
ok(
  route.includes('`${folder}/${user.id}/${id}.${file.extension}`'),
  "route binds a retry-stable reservation id into the owner-scoped object key"
);
ok(
  route.includes('["eq", "$key", objectKey]') &&
    route.includes('["eq", "$x-oss-content-type", file.type]') &&
    route.includes('"x-oss-content-type": file.type'),
  "OSS policy locks the key and MIME"
);
ok(
  route.includes('admin.rpc("reserve_canvas_uploads_v1"') &&
    route.indexOf('admin.rpc("reserve_canvas_uploads_v1"') <
      route.indexOf("calculatePostSignature"),
  "quota and exact identity are reserved before any OSS signature"
);
ok(
  route.includes('["content-length-range", file.size, file.size]'),
  "OSS policy locks the exact object byte length"
);
ok(
  route.includes('["eq", "$x-oss-forbid-overwrite", "true"]'),
  "OSS policy rejects overwriting a previously uploaded object"
);
ok(
  contract.CANVAS_UPLOAD_SIGNATURE_TTL_SECONDS <= 5 * 60,
  "upload policy expires within five minutes"
);
ok(
  route.includes('"Cache-Control": "private, no-store"'),
  "credential responses are explicitly non-cacheable"
);
ok(
  !route.includes("publicUrl") && !route.includes("accessKeySecret: signed"),
  "route does not return a persistent media URL or access-key secret"
);

ok(
  client.includes('fetch("/api/canvas/uploads/credentials"'),
  "client uses the Canvas-only credential route"
);
ok(
  !client.includes("/api/upload/image") &&
    !client.includes("/api/upload/video"),
  "client no longer sends large multipart bodies through Next.js"
);
ok(
  client.includes('xhr.open("POST", item.prepared.uploadUrl)'),
  "client uploads directly to OSS"
);
ok(
  client.includes('fetch("/api/canvas/uploads/finalize"') &&
    client.indexOf('xhr.open("POST", item.prepared.uploadUrl)') <
      client.indexOf('fetch("/api/canvas/uploads/finalize"'),
  "client finalizes the reservation after direct OSS upload"
);
ok(
  client.includes('form.append("file", item.file, item.file.name)'),
  "client appends the OSS file field last"
);
ok(
  client.includes('ossKey: item.prepared.objectKey') &&
    !client.includes("publicUrl"),
  "client result persists only the OSS object key"
);
ok(
  client.includes("AbortSignal") &&
    client.includes('signal?.addEventListener("abort"'),
  "client supports cancellation"
);
ok(client.includes("onProgress"), "client exposes upload progress");

ok(
  finalizeRoute.includes("getFileMetadataStrict(objectKey") &&
    finalizeRoute.includes("metadata.size !== reservation.expected_size") &&
    finalizeRoute.includes("observedContentType !== reservation.content_type"),
  "finalize verifies exact OSS HEAD size and content type"
);
ok(
  finalizeRoute.includes("readObjectPrefixStrict(") &&
    finalizeRoute.includes("hasExpectedMagic(prefix, reservation.file_extension)") &&
    finalizeRoute.includes("result?.res?.status !== 206"),
  "finalize requires a bounded range response and verifies file magic"
);

ok(
  board.includes("CANVAS_UPLOAD_MAX_CONCURRENCY"),
  "board uses the shared hard concurrency limit"
);
ok(
  board.includes("uploadBatchActiveRef.current") &&
    board.includes("上一批文件仍在上传"),
  "board prevents overlapping batches from bypassing the global concurrency cap"
);
ok(
  board.includes("prepareCanvasUploads") &&
    board.includes("uploadPreparedCanvasFile"),
  "board preflights one batch and schedules prepared direct uploads"
);

ok(
  checkUrlRoute.includes("auth.getUser()"),
  "URL probe requires an authenticated user"
);
ok(
  checkUrlRoute.includes("probeExternalMediaUrl") &&
    !checkUrlRoute.includes("fetch(url"),
  "URL probe uses DNS-pinned safe media probing instead of arbitrary fetch"
);
ok(
  checkUrlRoute.includes("isOwnedObjectKey(objectKey, user.id)"),
  "URL probe does not disclose cross-account OSS object existence"
);
ok(
  transferRoute.includes("isOSSUrl(input.sourceUrl)") &&
    transferRoute.includes("isOwnedObjectKey(objectKey, user.id)") &&
    transferRoute.includes("reused: true"),
  "transfer route reuses an existing owner-scoped OSS object"
);
ok(
  transferRoute.includes("fetchExternalMediaToTempFile") &&
    transferRoute.includes("MAX_TRANSFER_BYTES = 256 * 1024 * 1024"),
  "external transfer is SSRF-safe and capped at 256MB"
);
ok(
  transferRoute.includes("createReadStream(downloaded.filePath)") &&
    !transferRoute.includes(".arrayBuffer()"),
  "external transfer streams a bounded temporary file instead of buffering it"
);
ok(
  transferRoute.includes("detectVideoType") &&
    transferRoute.includes('toString("ascii") === "ftyp"'),
  "external transfer validates video magic bytes before OSS upload"
);
ok(
  transferRoute.includes("await downloaded?.cleanup()"),
  "external transfer always cleans its private temporary file"
);
ok(
  safeMedia.includes('mkdtemp(join(tmpdir(), "stargaze-media-"))') &&
    safeMedia.includes('createWriteStream(destination, { flags: "wx", mode: 0o600 })'),
  "safe downloader creates a private non-overwriting temporary file"
);

if (failures.length > 0) {
  console.error(
    `Canvas upload hardening verification failed (${passed} passed, ${failures.length} failed):`
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Canvas upload hardening verification passed: ${passed}/${passed}`);
}
