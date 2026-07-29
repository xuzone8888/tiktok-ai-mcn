#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const storage = read("src/lib/video-models/storage.ts");
const oss = read("src/lib/oss.ts");
const safeFetch = read("src/lib/safe-media-fetch.ts");
const reconciliation = read("src/lib/canvas/generation-reconciliation.ts");
const seedance = read("src/lib/video-models/adapters/seedance.ts");
const upscaler = read("src/lib/video-upscale.ts");
const downloadRoute = read(
  "src/app/api/canvas/generations/[generationId]/download/route.ts"
);
const taskListRoute = read("src/app/api/user/tasks/route.ts");

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

check(
  storage.includes("fetchExternalMediaToTempFile") &&
    storage.includes("createReadStream") &&
    storage.includes("uploadVideoStream"),
  "generated video persistence is temp-file-to-stream"
);
check(
  !storage.includes("fetchExternalMediaBuffer") &&
    !storage.includes("uploadVideoBuffer") &&
    !storage.includes("fetchVideoBuffer"),
  "generated video persistence has no full-buffer fallback"
);
check(
  storage.includes("MAX_GENERATED_VIDEO_BYTES = 256 * 1024 * 1024") &&
    storage.includes('toString("ascii") !== "ftyp"'),
  "download size and MP4 signature are enforced"
);
check(
  storage.includes("videoPersistenceActive") &&
    storage.includes("videoPersistenceQueue") &&
    storage.includes("withVideoPersistenceSlot"),
  "media persistence has an independent single-slot semaphore"
);
check(
  storage.includes("signal: params.signal") &&
    oss.includes("options.signal?.addEventListener('abort', abortUpload") &&
    safeFetch.includes('input.signal?.addEventListener("abort", abortRequest') &&
    safeFetch.includes('input.signal?.addEventListener("abort", abortResponse'),
  "abort propagates through download response/request and OSS source stream"
);
check(
  oss.includes("meta: options.metadata") &&
    oss.includes("'Content-Disposition': 'inline'"),
  "stream uploads preserve identity metadata and playback disposition"
);
check(
  reconciliation.includes("withinAbortableDeadline") &&
    reconciliation.includes("(signal) =>\n        persistCompletedVideo") &&
    reconciliation.includes("signal: input.signal"),
  "reconciliation waits for cancel-aware media persistence"
);
check(
  reconciliation.indexOf('"sweep_stale_canvas_not_started_v1"') <
    reconciliation.indexOf('"claim_canvas_generation_reconciliation_v1"'),
  "provably pre-provider crash recovery runs before slow provider work"
);
check(
  seedance.includes("transferVideoToOss") &&
    seedance.includes("upscaleVideoFile") &&
    !seedance.includes("uploadVideoBuffer") &&
    !seedance.includes("fetchVideoBuffer"),
  "Seedance completion also stays file/stream based"
);
check(
  upscaler.includes("execFileAsync") &&
    upscaler.includes("inputPath") &&
    upscaler.includes("outputPath") &&
    upscaler.includes("if (acquired) releaseSlot()"),
  "file upscaling avoids shell interpolation and releases only acquired slots"
);
check(
  downloadRoute.includes("canAccessSuperCanvas(user)") &&
    downloadRoute.includes('.eq("user_id", user.id)') &&
    downloadRoute.includes("output_oss_key") &&
    downloadRoute.includes("getSignedDownloadUrl"),
  "downloads are owner-authorized and use the authoritative output object"
);
check(
  oss.includes("'content-disposition': `attachment; filename=") &&
    taskListRoute.includes('"output_oss_key"') &&
    taskListRoute.includes("task.output_oss_key ? getPublicUrl"),
  "forced downloads and publication fallback survive legacy projection loss"
);

console.log(
  `Canvas media persistence verification passed: ${passed}/${passed}`
);
