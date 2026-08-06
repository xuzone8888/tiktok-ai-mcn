import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { isOwnedObjectKey } from "@/lib/canvas/media-ownership";
import {
  extractObjectPath,
  getFileMetadataStrict,
  getPublicUrl,
  isOSSUrl,
} from "@/lib/oss";
import {
  ExternalMediaFetchError,
  fetchExternalMediaToTempFile,
  type ExternalMediaTempFileResult,
} from "@/lib/safe-media-fetch";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require("ali-oss");

const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;
const ossConfig = {
  region: process.env.ALIYUN_OSS_REGION || "oss-cn-beijing",
  accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || "",
  accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || "",
  bucket: process.env.ALIYUN_OSS_BUCKET || "tokfactory-videos",
  endpoint:
    process.env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
  secure: true,
  timeout: 300_000,
};

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

class TransferInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TransferInputError";
    this.status = status;
  }
}

function fail(error: string, status: number, expired = false) {
  return NextResponse.json(
    { success: false, error, ...(expired ? { expired: true } : {}) },
    { status }
  );
}

async function detectVideoType(
  filePath: string
): Promise<{ contentType: string; extension: string }> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "AVI "
    ) {
      return { contentType: "video/x-msvideo", extension: "avi" };
    }
    if (
      bytesRead >= 4 &&
      header[0] === 0x1a &&
      header[1] === 0x45 &&
      header[2] === 0xdf &&
      header[3] === 0xa3
    ) {
      return { contentType: "video/webm", extension: "webm" };
    }
    if (
      bytesRead >= 12 &&
      header.subarray(4, 8).toString("ascii") === "ftyp"
    ) {
      const brand = header.subarray(8, 12).toString("ascii");
      return brand === "qt  "
        ? { contentType: "video/quicktime", extension: "mov" }
        : { contentType: "video/mp4", extension: "mp4" };
    }
  } finally {
    await handle.close();
  }
  throw new TransferInputError("Source is not a supported video file", 415);
}

function parseBody(body: unknown): {
  sourceUrl: string;
  requestedUserId?: string;
  folder: "videos" | "model-demos";
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TransferInputError("Invalid request body");
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "sourceUrl" &&
        key !== "filename" &&
        key !== "userId" &&
        key !== "folder"
    ) ||
    typeof record.sourceUrl !== "string" ||
    record.sourceUrl.length < 1 ||
    record.sourceUrl.length > 4096 ||
    record.sourceUrl !== record.sourceUrl.trim() ||
    !(
      record.filename === undefined ||
      (typeof record.filename === "string" &&
        record.filename.length <= 200 &&
        !/[/\\\u0000-\u001f\u007f]/.test(record.filename))
    ) ||
    !(
      record.userId === undefined ||
      (typeof record.userId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          record.userId
        ))
    ) ||
    !(
      record.folder === undefined ||
      record.folder === "videos" ||
      record.folder === "model-demos"
    )
  ) {
    throw new TransferInputError("Invalid source video URL");
  }
  return {
    sourceUrl: record.sourceUrl,
    ...(typeof record.userId === "string"
      ? { requestedUserId: record.userId }
      : {}),
    folder: record.folder === "model-demos" ? "model-demos" : "videos",
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return fail("Authentication required. Please log in first.", 401);
  }

  let input: {
    sourceUrl: string;
    requestedUserId?: string;
    folder: "videos" | "model-demos";
  };
  try {
    input = parseBody(await request.json());
  } catch (error) {
    return fail(
      error instanceof TransferInputError
        ? error.message
        : "Invalid JSON body",
      error instanceof TransferInputError ? error.status : 400
    );
  }
  if (input.requestedUserId && input.requestedUserId !== user.id) {
    return fail("Cannot transfer media for another account", 403);
  }

  if (
    !ossConfig.accessKeyId ||
    !ossConfig.accessKeySecret ||
    !ossConfig.bucket
  ) {
    console.error("[Transfer OSS] OSS is not configured");
    return fail("Storage service not configured", 503);
  }

  // A Canvas asset already in this user's OSS namespace is permanent. Return
  // its canonical URL instead of downloading and duplicating it.
  if (isOSSUrl(input.sourceUrl)) {
    const objectKey = extractObjectPath(input.sourceUrl);
    if (!objectKey || !isOwnedObjectKey(objectKey, user.id)) {
      return fail("Media does not belong to this account", 403);
    }
    try {
      const metadata = await getFileMetadataStrict(objectKey, {
        timeoutMs: 10_000,
      });
      if (!metadata) return fail("Video not found", 404, true);
      if (!metadata.contentType.toLowerCase().startsWith("video/")) {
        return fail("Selected media is not a video", 415);
      }
      return NextResponse.json({
        success: true,
        data: {
          url: getPublicUrl(objectKey),
          key: objectKey,
          size: metadata.size,
          reused: true,
        },
      });
    } catch {
      console.error("[Transfer OSS] owned object HEAD failed");
      return fail("Storage service temporarily unavailable", 503);
    }
  }

  let downloaded: ExternalMediaTempFileResult | null = null;
  try {
    downloaded = await fetchExternalMediaToTempFile(input.sourceUrl, {
      maxBytes: MAX_TRANSFER_BYTES,
      timeoutMs: 180_000,
    });
    const detected = await detectVideoType(downloaded.filePath);
    const key = `${input.folder}/${user.id}/${randomUUID()}.${detected.extension}`;
    if (!isOwnedObjectKey(key, user.id)) {
      throw new Error("generated object key violated ownership policy");
    }

    const client = new OSS(ossConfig);
    const result = await client.putStream(
      key,
      createReadStream(downloaded.filePath),
      {
        mime: detected.contentType,
        headers: {
          "Content-Type": detected.contentType,
          "Content-Length": downloaded.size,
          "Content-Disposition": "inline",
          "x-oss-forbid-overwrite": "true",
          "x-oss-storage-class": "Standard",
        },
      }
    );
    if (!result?.name) {
      throw new Error("OSS upload returned no object name");
    }

    console.info("[Transfer OSS] completed", {
      userId: user.id,
      key,
      size: downloaded.size,
    });
    return NextResponse.json({
      success: true,
      data: {
        url: getPublicUrl(key),
        key,
        size: downloaded.size,
      },
    });
  } catch (error) {
    if (error instanceof TransferInputError) {
      return fail(error.message, error.status);
    }
    if (error instanceof ExternalMediaFetchError) {
      const expired =
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 410;
      if (error.message.includes("超过")) {
        return fail("Source video exceeds the 256MB limit", 413);
      }
      return fail(
        expired
          ? `Video is unavailable (HTTP ${error.statusCode})`
          : "Unable to download source video",
        502,
        expired
      );
    }
    console.error("[Transfer OSS] transfer failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fail("Video transfer failed. Please try again later.", 502);
  } finally {
    await downloaded?.cleanup().catch(() => {});
  }
}
