import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  buildHistorySourceKeysetFilter,
  getHistoryTrustedOssHosts,
  HistorySourceDataError,
  HistorySourceTooLargeError,
  normalizeHistorySources,
  paginateHistoryAssets,
  parseHistoryQuery,
  readBoundedHistorySourceRows,
  type HistoryAssetSource,
  type HistoryBatchRequest,
} from "@/lib/canvas/history-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE_COLUMNS: Record<Exclude<HistoryAssetSource, "generations">, string> = {
  products: "id,user_id,name,original_image_url,processed_images,created_at",
  blueprints: "id,user_id,source_type,source_ref,product,scenes,globals,created_at",
};

const GENERATION_COLUMN_VARIANTS = [
  "id,user_id,status,type,prompt,duration,output_url,output_urls,result_url,video_url,image_url,thumbnail_url,metadata,created_at",
  "id,user_id,status,type,prompt,duration,output_url,result_url,video_url,image_url,thumbnail_url,metadata,created_at",
  "id,user_id,status,type,result_url,video_url,image_url,created_at",
  "id,user_id,status,generation_type,output_url,thumbnail_url,created_at",
] as const;

type HistorySourceFailure = "forbidden" | "relation_not_found" | "query_failed";

class HistorySourceQueryError extends Error {
  constructor(
    readonly source: HistoryAssetSource,
    readonly failure: HistorySourceFailure
  ) {
    super("History source query failed");
    this.name = "HistorySourceQueryError";
  }
}

interface DatabaseErrorShape {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

function asDatabaseError(error: unknown): DatabaseErrorShape {
  return typeof error === "object" && error !== null ? error : {};
}

function hasDatabaseErrorCode(error: unknown, codes: ReadonlySet<string>): boolean {
  const code = asDatabaseError(error).code;
  return typeof code === "string" && codes.has(code.toUpperCase());
}

function isUndefinedColumnError(error: unknown): boolean {
  return hasDatabaseErrorCode(error, new Set(["42703", "PGRST204"]));
}

function isRelationNotFoundError(error: unknown): boolean {
  return hasDatabaseErrorCode(error, new Set(["42P01", "PGRST205"]));
}

function isPermissionError(error: unknown): boolean {
  const { code, message, status } = asDatabaseError(error);
  return (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    code === "PGRST301" ||
    code === "PGRST302" ||
    (typeof message === "string" && /permission denied|row-level security|not authorized/i.test(message))
  );
}

function classifySourceError(error: unknown): HistorySourceFailure {
  if (isPermissionError(error)) return "forbidden";
  if (isRelationNotFoundError(error)) return "relation_not_found";
  return "query_failed";
}

async function executeOwnedBatch(
  db: SupabaseClient,
  userId: string,
  request: HistoryBatchRequest,
  columns: string
): Promise<{ data: unknown; error: unknown }> {
  const ownedQuery = db
    .from(request.source)
    .select(columns)
    .eq("user_id", userId);
  const sourceQuery = request.source === "generations"
    ? ownedQuery.eq("status", "completed")
    : ownedQuery;
  const orderedQuery = sourceQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });
  const keysetQuery = request.cursor
    ? orderedQuery.or(buildHistorySourceKeysetFilter(request.source, request.cursor))
    : orderedQuery;
  return keysetQuery.limit(request.limit) as unknown as Promise<{ data: unknown; error: unknown }>;
}

function createOwnedBatchReader(
  db: SupabaseClient,
  userId: string
): (request: HistoryBatchRequest) => Promise<readonly unknown[]> {
  let selectedGenerationVariant: number | null = null;

  return async (request) => {
    if (request.source !== "generations") {
      const { data, error } = await executeOwnedBatch(
        db,
        userId,
        request,
        SOURCE_COLUMNS[request.source]
      );
      if (error) throw new HistorySourceQueryError(request.source, classifySourceError(error));
      return (data ?? []) as unknown[];
    }

    const firstVariant = selectedGenerationVariant ?? 0;
    const lastVariant = selectedGenerationVariant ?? GENERATION_COLUMN_VARIANTS.length - 1;
    for (let variant = firstVariant; variant <= lastVariant; variant += 1) {
      const { data, error } = await executeOwnedBatch(
        db,
        userId,
        request,
        GENERATION_COLUMN_VARIANTS[variant]
      );
      if (!error) {
        selectedGenerationVariant = variant;
        return (data ?? []) as unknown[];
      }
      if (
        selectedGenerationVariant === null &&
        variant < GENERATION_COLUMN_VARIANTS.length - 1 &&
        isUndefinedColumnError(error)
      ) {
        continue;
      }
      throw new HistorySourceQueryError(request.source, classifySourceError(error));
    }
    throw new HistorySourceQueryError(request.source, "query_failed");
  };
}

async function readOwnedSource(
  source: HistoryAssetSource,
  readBatch: (request: HistoryBatchRequest) => Promise<readonly unknown[]>
): Promise<unknown[]> {
  return readBoundedHistorySourceRows(source, readBatch);
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401);
    }

    const url = new URL(request.url);
    const parsedQuery = parseHistoryQuery(url.search ? url.search.slice(1) : "");
    if (!parsedQuery.ok) {
      return json(
        { success: false, error: { code: parsedQuery.code, message: parsedQuery.message } },
        400
      );
    }

    const db = supabase as unknown as SupabaseClient;
    const readBatch = createOwnedBatchReader(db, user.id);
    const productsRead = readOwnedSource("products", readBatch)
      .then((rows) => ({ rows, health: "available" as const }))
      .catch((error: unknown) => {
        if (
          error instanceof HistorySourceQueryError &&
          error.source === "products" &&
          error.failure === "relation_not_found"
        ) {
          return { rows: [], health: "unavailable" as const };
        }
        throw error;
      });
    const [generations, productsResult, blueprints] = await Promise.all([
      readOwnedSource("generations", readBatch),
      productsRead,
      readOwnedSource("blueprints", readBatch),
    ]);

    const normalized = normalizeHistorySources({
      generations,
      products: productsResult.rows,
      blueprints,
      userId: user.id,
      trustedHosts: getHistoryTrustedOssHosts(),
    });
    const page = paginateHistoryAssets(normalized.items, parsedQuery.value);
    return json({
      success: true,
      data: {
        ...page,
        diagnostics: normalized.diagnostics,
        sources: {
          generations: { health: "available" },
          products: { health: productsResult.health },
          blueprints: { health: "available" },
        },
      },
    });
  } catch (error) {
    if (error instanceof HistorySourceTooLargeError) {
      console.error("[Canvas History] bounded source limit exceeded", {
        source: error.source,
        code: error.code,
      });
      return json(
        {
          success: false,
          error: {
            code: error.code,
            source: error.source,
            message: "History source exceeds bounded limits",
          },
        },
        413
      );
    }
    if (error instanceof HistorySourceQueryError) {
      const forbidden = error.failure === "forbidden";
      const code = forbidden ? "SOURCE_FORBIDDEN" : "SOURCE_QUERY_FAILED";
      console.error("[Canvas History] source query failed", { source: error.source, code });
      return json(
        {
          success: false,
          error: {
            code,
            source: error.source,
            message: forbidden ? "History source access denied" : "History source query failed",
          },
        },
        forbidden ? 403 : 500
      );
    }
    if (error instanceof HistorySourceDataError) {
      console.error("[Canvas History] source keyset contract failed", {
        source: error.source,
        code: error.code,
      });
      return json(
        {
          success: false,
          error: {
            code: error.code,
            source: error.source,
            message: "History source query failed",
          },
        },
        500
      );
    }
    console.error("[Canvas History] unexpected failure", { code: "INTERNAL" });
    return json(
      { success: false, error: { code: "INTERNAL", message: "History query failed" } },
      500
    );
  }
}
