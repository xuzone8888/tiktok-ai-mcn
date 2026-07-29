import { NextResponse } from "next/server";

import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { getSignedDownloadUrl } from "@/lib/oss";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GenerationDownloadRow {
  id: string;
  user_id: string;
  source: string | null;
  status: string | null;
  type: string | null;
  output_oss_key: string | null;
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
) {
  const { generationId } = await params;
  if (!UUID_RE.test(generationId)) {
    return jsonError("INVALID_ID", "生成记录编号无效", 400);
  }

  const db = await createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) {
    return jsonError("UNAUTHORIZED", "请先登录", 401);
  }
  if (!canAccessSuperCanvas(user)) {
    return jsonError("CANVAS_DISABLED", "超级画布暂未对该账号开放", 404);
  }

  // generated database.ts predates the additive Canvas columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawData, error } = await (db as any)
    .from("generations")
    .select("id, user_id, source, status, type, output_oss_key")
    .eq("id", generationId)
    .eq("user_id", user.id)
    .maybeSingle();
  const data = rawData as GenerationDownloadRow | null;
  if (error) {
    console.error("[Canvas download] generation lookup failed", {
      generationId,
      code: error.code,
    });
    return jsonError("LOOKUP_FAILED", "读取生成结果失败", 500);
  }
  if (
    !data ||
    data.source !== "canvas" ||
    data.status !== "completed" ||
    (data.type !== "image" && data.type !== "video") ||
    typeof data.output_oss_key !== "string"
  ) {
    return jsonError("NOT_FOUND", "生成结果不存在或尚未完成", 404);
  }

  const extension = data.type === "image" ? "jpg" : "mp4";
  const expected = new RegExp(
    `^${data.type === "image" ? "images" : "videos"}/${user.id}/canvas-${generationId}-[0-9a-f]{32}\\.${extension}$`,
    "i"
  );
  if (!expected.test(data.output_oss_key)) {
    console.error("[Canvas download] authoritative object key failed identity check", {
      generationId,
    });
    return jsonError("OBJECT_IDENTITY_INVALID", "生成结果身份校验失败", 409);
  }

  const filename = `canvas-${data.type}-${generationId.slice(0, 8)}.${extension}`;
  const signedUrl = getSignedDownloadUrl(data.output_oss_key, filename);
  return NextResponse.redirect(signedUrl, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
