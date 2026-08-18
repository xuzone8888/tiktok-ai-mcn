import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { isOwnedObjectKey } from "@/lib/canvas/media-ownership";
import {
  CANVAS_UPLOAD_SIGNATURE_TTL_SECONDS,
  CanvasUploadRequestSchema,
  type CanvasUploadKind,
  type ValidCanvasUploadFile,
  validateCanvasUploadBatchMetadata,
} from "@/lib/canvas/upload-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require("ali-oss");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ossConfig = {
  region: process.env.ALIYUN_OSS_REGION || "oss-cn-beijing",
  accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || "",
  accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || "",
  bucket: process.env.ALIYUN_OSS_BUCKET || "tokfactory-videos",
  endpoint:
    process.env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
  secure: true,
};

interface UploadReservationRow {
  reservation_id: string;
  object_key: string;
  kind: CanvasUploadKind;
  file_extension: string;
  content_type: string;
  expected_size: number;
  reservation_status: string;
  expires_at: string;
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

function databaseMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [value.message, value.details, value.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function reservationError(error: unknown) {
  const message = databaseMessage(error);
  if (/daily_(file|byte)_quota|storage_(file|byte)_quota/i.test(message)) {
    return fail(
      "UPLOAD_QUOTA_EXCEEDED",
      "上传配额已用完，请稍后重试或清理不再需要的素材",
      429
    );
  }
  if (/batch_(count|bytes)_limit|file_limit|invalid_|mismatch/i.test(message)) {
    return fail("INVALID_UPLOAD_REQUEST", "上传文件信息不符合限制", 400);
  }
  if (/idempotency_conflict|reservation_expired|duplicate|23505/i.test(message)) {
    return fail(
      "UPLOAD_RESERVATION_CONFLICT",
      "上传预留已冲突或过期，请重新选择文件",
      409
    );
  }
  console.error("[Canvas uploads] reservation RPC failed", {
    code:
      error && typeof error === "object"
        ? (error as { code?: unknown }).code
        : undefined,
  });
  return fail("STORAGE_UNAVAILABLE", "上传配额服务暂时不可用", 503);
}

function isReservationRow(
  value: unknown,
  expectedId: string,
  expectedKey: string,
  expected: ValidCanvasUploadFile
): value is UploadReservationRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.reservation_id === expectedId &&
    row.object_key === expectedKey &&
    row.kind === expected.kind &&
    row.file_extension === expected.extension &&
    row.content_type === expected.type &&
    row.expected_size === expected.size &&
    row.reservation_status === "reserved" &&
    typeof row.expires_at === "string" &&
    Number.isFinite(Date.parse(row.expires_at)) &&
    Date.parse(row.expires_at) > Date.now()
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return fail("UNAUTHENTICATED", "请先登录", 401);
  }
  if (
    !canAccessSuperCanvas({
      id: user.id,
      email: user.email ?? null,
    })
  ) {
    return fail(
      "CANVAS_NOT_ENABLED",
      "超级画布尚未对当前账号开放",
      403
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
  const parsed = CanvasUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_UPLOAD_REQUEST", "上传文件信息不合法", 400);
  }

  let files;
  try {
    files = validateCanvasUploadBatchMetadata(parsed.data.files);
  } catch (error) {
    return fail(
      "INVALID_UPLOAD_FILE",
      error instanceof Error ? error.message : "上传文件信息不合法",
      400
    );
  }

  if (
    !ossConfig.accessKeyId ||
    !ossConfig.accessKeySecret ||
    !ossConfig.bucket
  ) {
    console.error("[Canvas uploads] OSS is not configured");
    return fail("STORAGE_UNAVAILABLE", "存储服务暂时不可用", 503);
  }

  try {
    const client = new OSS(ossConfig);
    const uploadUrl = client.generateObjectUrl("");
    if (
      typeof uploadUrl !== "string" ||
      new URL(uploadUrl).protocol !== "https:"
    ) {
      throw new Error("OSS upload endpoint must use HTTPS");
    }
    const reservationItems = files.map((file, index) => {
      const id = parsed.data.files[index].id;
      const folder = file.kind === "image" ? "images" : "videos";
      const objectKey = `${folder}/${user.id}/${id}.${file.extension}`;
      if (!isOwnedObjectKey(objectKey, user.id)) {
        throw new Error("generated object key violated Canvas ownership policy");
      }
      return {
        id,
        objectKey,
        kind: file.kind,
        extension: file.extension,
        contentType: file.type,
        size: file.size,
      };
    });

    // The quota/identity transaction is the authorization boundary. No OSS
    // signature is created until all files have been atomically reserved.
    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data: reservationData, error: reservationRpcError } =
      await admin.rpc("reserve_canvas_uploads_v1", {
        p_user_id: user.id,
        p_items: reservationItems,
      });
    if (reservationRpcError) return reservationError(reservationRpcError);
    if (
      !Array.isArray(reservationData) ||
      reservationData.length !== files.length
    ) {
      console.error("[Canvas uploads] reservation RPC returned invalid cardinality");
      return fail("STORAGE_UNAVAILABLE", "上传预留结果无法确认", 503);
    }

    for (let index = 0; index < files.length; index += 1) {
      const expected = reservationItems[index];
      if (
        !isReservationRow(
          reservationData[index],
          expected.id,
          expected.objectKey,
          files[index]
        )
      ) {
        console.error("[Canvas uploads] reservation RPC returned invalid identity");
        return fail("STORAGE_UNAVAILABLE", "上传预留结果无法确认", 503);
      }
    }

    const expiration = new Date(
      Date.now() + CANVAS_UPLOAD_SIGNATURE_TTL_SECONDS * 1000
    ).toISOString();
    const uploads = files.map((file, index) => {
      const reservation = reservationData[index] as UploadReservationRow;
      const objectKey = reservation.object_key;

      // POST policy conditions are evaluated by OSS itself. An altered key,
      // MIME or byte length is rejected even if a caller bypasses this client.
      const policy = {
        expiration,
        conditions: [
          { bucket: ossConfig.bucket },
          ["eq", "$key", objectKey],
          ["eq", "$x-oss-content-type", file.type],
          ["content-length-range", file.size, file.size],
          ["eq", "$x-oss-forbid-overwrite", "true"],
          ["eq", "$success_action_status", "204"],
        ],
      };
      const signed = client.calculatePostSignature(policy);

      return {
        reservationId: reservation.reservation_id,
        reservationExpiresAt: reservation.expires_at,
        kind: file.kind,
        objectKey,
        uploadUrl,
        expiresIn: CANVAS_UPLOAD_SIGNATURE_TTL_SECONDS,
        fields: {
          key: objectKey,
          "x-oss-content-type": file.type,
          "x-oss-forbid-overwrite": "true",
          success_action_status: "204",
          OSSAccessKeyId: signed.OSSAccessKeyId,
          policy: signed.policy,
          Signature: signed.Signature,
        },
      };
    });

    return NextResponse.json(
      { success: true, data: { uploads } },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[Canvas uploads] failed to create upload policy", {
      name: error instanceof Error ? error.name : "unknown_error",
    });
    return fail("STORAGE_UNAVAILABLE", "无法创建上传凭证，请稍后重试", 503);
  }
}
