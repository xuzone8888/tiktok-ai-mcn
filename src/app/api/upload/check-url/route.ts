import { NextRequest, NextResponse } from "next/server";

import { isOwnedObjectKey } from "@/lib/canvas/media-ownership";
import { extractObjectPath, isOSSUrl } from "@/lib/oss";
import {
  ExternalMediaFetchError,
  probeExternalMediaUrl,
} from "@/lib/safe-media-fetch";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 10;
export const dynamic = "force-dynamic";

function inaccessible(reason: string, status = 0, httpStatus = 200) {
  return NextResponse.json(
    { accessible: false, status, reason },
    { status: httpStatus }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return inaccessible("Authentication required", 0, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return inaccessible("Invalid JSON body", 0, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "url") ||
    typeof (body as { url?: unknown }).url !== "string"
  ) {
    return inaccessible("Invalid URL parameter", 0, 400);
  }
  const url = (body as { url: string }).url;
  if (url.length < 1 || url.length > 4096 || url !== url.trim()) {
    return inaccessible("Invalid URL parameter", 0, 400);
  }

  // Do not turn this endpoint into a cross-account OSS existence oracle.
  if (isOSSUrl(url)) {
    const objectKey = extractObjectPath(url);
    if (!objectKey || !isOwnedObjectKey(objectKey, user.id)) {
      return inaccessible("Media does not belong to this account", 0, 403);
    }
  }

  try {
    const result = await probeExternalMediaUrl(url, { timeoutMs: 8_000 });
    return NextResponse.json({
      accessible: result.accessible,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof ExternalMediaFetchError) {
      return inaccessible(
        error.statusCode
          ? `HTTP ${error.statusCode}`
          : "URL is unavailable or not permitted",
        error.statusCode ?? 0
      );
    }
    console.error("[Check URL] safe probe failed");
    return inaccessible("Check failed", 0, 500);
  }
}
