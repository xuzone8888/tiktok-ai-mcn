import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { isOwnedObjectKey } from "@/lib/canvas/media-ownership";
import { CANVAS_UPLOAD_ID_RE } from "@/lib/canvas/upload-contract";
import { getFileMetadataStrict } from "@/lib/oss";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require("ali-oss");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX_BYTES = 32;
const FinalizeRequestSchema = z.strictObject({
  reservationId: z.string().regex(CANVAS_UPLOAD_ID_RE),
  objectKey: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]*$/),
});

const ossConfig = {
  region: process.env.ALIYUN_OSS_REGION || "oss-cn-beijing",
  accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || "",
  accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || "",
  bucket: process.env.ALIYUN_OSS_BUCKET || "tokfactory-videos",
  endpoint:
    process.env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
  secure: true,
};

interface ReservationRow {
  id: string;
  user_id: string;
  object_key: string;
  file_extension: string;
  content_type: string;
  expected_size: number;
  status: string;
  expires_at: string;
  ready_at: string | null;
}

interface FinalizeRow {
  reservation_id: string;
  object_key: string;
  result_status: string;
  ready_at: string | null;
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

function success(row: ReservationRow | FinalizeRow) {
  const reservationId =
    "reservation_id" in row ? row.reservation_id : row.id;
  const objectKey = "object_key" in row ? row.object_key : "";
  const readyAt = "ready_at" in row ? row.ready_at : null;
  return NextResponse.json(
    {
      success: true,
      data: {
        reservationId,
        objectKey,
        status: "ready",
        readyAt,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

function isReservationRow(value: unknown): value is ReservationRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.user_id === "string" &&
    typeof row.object_key === "string" &&
    typeof row.file_extension === "string" &&
    typeof row.content_type === "string" &&
    typeof row.expected_size === "number" &&
    Number.isSafeInteger(row.expected_size) &&
    row.expected_size > 0 &&
    typeof row.status === "string" &&
    typeof row.expires_at === "string" &&
    (row.ready_at === null || typeof row.ready_at === "string")
  );
}

function isFinalizeRow(value: unknown): value is FinalizeRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.reservation_id === "string" &&
    typeof row.object_key === "string" &&
    typeof row.result_status === "string" &&
    (row.ready_at === null || typeof row.ready_at === "string")
  );
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return null;
}

async function readObjectPrefixStrict(
  objectKey: string,
  expectedSize: number
): Promise<Buffer> {
  const client = new OSS(ossConfig);
  const result = await client.getStream(objectKey, {
    timeout: 30_000,
    headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` },
  });
  const stream = result?.stream as
    | (AsyncIterable<unknown> & { destroy?: (error?: Error) => void })
    | undefined;
  if (!stream || result?.res?.status !== 206) {
    stream?.destroy?.();
    throw new Error("OSS did not honor the bounded range request");
  }

  const contentRange = headerValue(
    result.res.headers as Record<string, unknown> | undefined,
    "content-range"
  );
  const match = /^bytes 0-(\d+)\/(\d+)$/.exec(contentRange ?? "");
  if (
    !match ||
    Number(match[1]) >= PREFIX_BYTES ||
    !Number.isSafeInteger(Number(match[2])) ||
    Number(match[2]) !== expectedSize
  ) {
    stream.destroy?.();
    throw new Error("OSS returned an invalid content range");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let overflow = false;
  try {
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (total + value.length > PREFIX_BYTES) {
        overflow = true;
        stream.destroy?.();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (error) {
    if (!overflow) throw error;
  }
  if (overflow || total !== Number(match[1]) + 1) {
    throw new Error("OSS range response exceeded its declared boundary");
  }
  return Buffer.concat(chunks, total);
}

function bytesEqual(value: Buffer, expected: readonly number[], offset = 0) {
  return (
    value.length >= offset + expected.length &&
    expected.every((byte, index) => value[offset + index] === byte)
  );
}

function asciiAt(value: Buffer, expected: string, offset = 0) {
  return (
    value.length >= offset + expected.length &&
    value.subarray(offset, offset + expected.length).toString("ascii") ===
      expected
  );
}

function hasExpectedMagic(prefix: Buffer, extension: string): boolean {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return bytesEqual(prefix, [0xff, 0xd8, 0xff]);
    case "png":
      return bytesEqual(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "webp":
      return asciiAt(prefix, "RIFF") && asciiAt(prefix, "WEBP", 8);
    case "gif":
      return asciiAt(prefix, "GIF87a") || asciiAt(prefix, "GIF89a");
    case "mp4":
    case "mov":
      return asciiAt(prefix, "ftyp", 4);
    case "webm":
      return bytesEqual(prefix, [0x1a, 0x45, 0xdf, 0xa3]);
    case "avi":
      return asciiAt(prefix, "RIFF") && asciiAt(prefix, "AVI ", 8);
    default:
      return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return fail("UNAUTHENTICATED", "请先登录", 401);
  if (
    !canAccessSuperCanvas({
      id: user.id,
      email: user.email ?? null,
    })
  ) {
    return fail("CANVAS_NOT_ENABLED", "超级画布尚未对当前账号开放", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
  const parsed = FinalizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_FINALIZE_REQUEST", "上传确认信息不合法", 400);
  }
  const { reservationId, objectKey } = parsed.data;
  if (!isOwnedObjectKey(objectKey, user.id)) {
    return fail("UPLOAD_NOT_OWNED", "上传对象不属于当前账号", 403);
  }
  if (
    !ossConfig.accessKeyId ||
    !ossConfig.accessKeySecret ||
    !ossConfig.bucket
  ) {
    console.error("[Canvas uploads] OSS is not configured for finalize");
    return fail("STORAGE_UNAVAILABLE", "存储服务暂时不可用", 503);
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: reservationData, error: reservationError } = await admin
    .from("canvas_upload_reservations")
    .select(
      "id, user_id, object_key, file_extension, content_type, expected_size, status, expires_at, ready_at"
    )
    .eq("id", reservationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (reservationError) {
    console.error("[Canvas uploads] finalize reservation read failed", {
      code: reservationError.code,
    });
    return fail("STORAGE_UNAVAILABLE", "无法确认上传预留", 503);
  }
  if (!isReservationRow(reservationData)) {
    return fail("UPLOAD_RESERVATION_NOT_FOUND", "上传预留不存在", 404);
  }
  const reservation = reservationData;
  if (
    reservation.id !== reservationId ||
    reservation.user_id !== user.id ||
    reservation.object_key !== objectKey
  ) {
    return fail("UPLOAD_RESERVATION_MISMATCH", "上传预留身份不匹配", 409);
  }
  if (reservation.status === "ready") {
    if (
      !reservation.ready_at ||
      !Number.isFinite(Date.parse(reservation.ready_at))
    ) {
      console.error("[Canvas uploads] ready reservation is internally invalid");
      return fail("STORAGE_UNAVAILABLE", "上传确认结果无法验证", 503);
    }
    return success(reservation);
  }
  if (
    reservation.status !== "reserved" ||
    !Number.isFinite(Date.parse(reservation.expires_at)) ||
    Date.parse(reservation.expires_at) <= Date.now()
  ) {
    return fail("UPLOAD_RESERVATION_EXPIRED", "上传预留已过期，请重新上传", 409);
  }

  try {
    const metadata = await getFileMetadataStrict(objectKey, {
      timeoutMs: 30_000,
    });
    if (!metadata) {
      return fail("UPLOAD_OBJECT_MISSING", "OSS 尚未收到该文件", 409);
    }
    const observedContentType = metadata.contentType.trim().toLowerCase();
    if (
      !Number.isSafeInteger(metadata.size) ||
      metadata.size !== reservation.expected_size ||
      observedContentType !== reservation.content_type
    ) {
      return fail(
        "UPLOAD_OBJECT_MISMATCH",
        "OSS 文件大小或类型与上传预留不一致",
        422
      );
    }

    const prefix = await readObjectPrefixStrict(
      objectKey,
      reservation.expected_size
    );
    if (!hasExpectedMagic(prefix, reservation.file_extension)) {
      return fail(
        "UPLOAD_SIGNATURE_MISMATCH",
        "文件内容与扩展名不一致，已拒绝加入画布",
        422
      );
    }

    const { data: finalizedData, error: finalizedError } = await admin.rpc(
      "finalize_canvas_upload_v1",
      {
        p_user_id: user.id,
        p_reservation_id: reservationId,
        p_object_key: objectKey,
        p_observed_size: metadata.size,
        p_observed_content_type: observedContentType,
      }
    );
    if (finalizedError) {
      console.error("[Canvas uploads] finalize RPC failed", {
        code: finalizedError.code,
      });
      return fail("STORAGE_UNAVAILABLE", "上传确认暂时不可用", 503);
    }
    const finalized = Array.isArray(finalizedData)
      ? finalizedData[0]
      : finalizedData;
    if (
      !isFinalizeRow(finalized) ||
      finalized.reservation_id !== reservationId ||
      finalized.object_key !== objectKey
    ) {
      console.error("[Canvas uploads] finalize RPC returned invalid identity");
      return fail("STORAGE_UNAVAILABLE", "上传确认结果无法验证", 503);
    }
    if (finalized.result_status === "expired") {
      return fail("UPLOAD_RESERVATION_EXPIRED", "上传预留已过期，请重新上传", 409);
    }
    if (finalized.result_status !== "ready" || !finalized.ready_at) {
      return fail("UPLOAD_OBJECT_MISMATCH", "上传对象未通过最终校验", 422);
    }
    return success(finalized);
  } catch (error) {
    console.error("[Canvas uploads] OSS finalize verification failed", {
      name: error instanceof Error ? error.name : "unknown_error",
      code:
        error && typeof error === "object"
          ? (error as { code?: unknown }).code
          : undefined,
      status:
        error && typeof error === "object"
          ? (error as { status?: unknown }).status
          : undefined,
    });
    return fail("STORAGE_UNAVAILABLE", "OSS 文件校验暂时失败，请重试", 503);
  }
}
