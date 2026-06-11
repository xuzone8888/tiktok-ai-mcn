import { NextRequest, NextResponse } from "next/server";
import { processImageGenerationQueue } from "@/lib/image-generation-worker";

export const maxDuration = 360;
export const dynamic = "force-dynamic";

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const result = await processImageGenerationQueue({
    maxRuntimeMs: parseNonNegativeInteger(searchParams.get("maxRuntimeMs")),
    maxGenerationItems: parseNonNegativeInteger(searchParams.get("maxGenerationItems")),
    maxEcomItems: parseNonNegativeInteger(searchParams.get("maxEcomItems")),
  });

  return NextResponse.json({
    success: true,
    result,
  });
}
