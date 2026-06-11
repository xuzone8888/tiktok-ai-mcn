import { NextRequest, NextResponse } from "next/server";
import { processImageGenerationQueue } from "@/lib/image-generation-worker";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_CRON_MAX_RUNTIME_MS = 270_000;

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isCronRequestAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");

  if (!expectedSecret) return false;
  return providedSecret === expectedSecret || getBearerToken(request) === expectedSecret;
}

function getRuntimeMs(searchParams: URLSearchParams): number {
  const requestedRuntimeMs = parseNonNegativeInteger(searchParams.get("maxRuntimeMs"));
  return Math.min(
    requestedRuntimeMs ?? DEFAULT_CRON_MAX_RUNTIME_MS,
    DEFAULT_CRON_MAX_RUNTIME_MS
  );
}

async function handleCronRequest(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const result = await processImageGenerationQueue({
    maxRuntimeMs: getRuntimeMs(searchParams),
    maxGenerationItems: parseNonNegativeInteger(searchParams.get("maxGenerationItems")),
    maxEcomItems: parseNonNegativeInteger(searchParams.get("maxEcomItems")),
  });

  return NextResponse.json({
    success: true,
    result,
  });
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
