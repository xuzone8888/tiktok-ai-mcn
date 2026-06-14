import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { normalizeCharacterAssetImages } from "@/lib/character-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AssetImageKind = "avatar" | "sheet" | "reference";
type AssetImageVariant = "thumb" | "full";
type CachedModelAsset = {
  expiresAt: number;
  model: {
    id: string;
    is_active: boolean;
    source: string;
    owner_id: string | null;
    is_public: boolean;
    avatar_url: string | null;
    reference_sheet_url: string | null;
    reference_status: string | null;
    reference_images: unknown;
  };
};
type CachedImage = {
  expiresAt: number;
  buffer: ArrayBuffer;
  contentType: string;
};

const ASSET_IMAGE_KINDS = new Set<AssetImageKind>(["avatar", "sheet", "reference"]);
const ASSET_IMAGE_VARIANTS = new Set<AssetImageVariant>(["thumb", "full"]);
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const THUMB_CACHE_TTL_MS = 15 * 60 * 1000;
const THUMB_CACHE_MAX_ITEMS = 240;
const modelCache = new Map<string, CachedModelAsset>();
const thumbCache = new Map<string, CachedImage>();
const thumbInflight = new Map<string, Promise<CachedImage>>();

function isAssetImageKind(value: string | null): value is AssetImageKind {
  return Boolean(value && ASSET_IMAGE_KINDS.has(value as AssetImageKind));
}

function isAssetImageVariant(value: string | null): value is AssetImageVariant {
  return Boolean(value && ASSET_IMAGE_VARIANTS.has(value as AssetImageVariant));
}

function isImageElementRequest(request: NextRequest): boolean {
  return request.headers.get("sec-fetch-dest") === "image";
}

function getContentType(contentType: string | null): string {
  if (!contentType) return "image/jpeg";
  return contentType.split(";")[0] || "image/jpeg";
}

function getCacheControl(isPrivate: boolean, variant: AssetImageVariant): string {
  if (isPrivate) {
    return variant === "thumb"
      ? "private, max-age=1800"
      : "private, max-age=300";
  }
  return variant === "thumb"
    ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
    : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
}

function setThumbCache(cacheKey: string, image: CachedImage) {
  if (thumbCache.size >= THUMB_CACHE_MAX_ITEMS) {
    const oldestKey = thumbCache.keys().next().value;
    if (oldestKey) thumbCache.delete(oldestKey);
  }
  thumbCache.set(cacheKey, image);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

async function getModelAsset(modelId: string) {
  const cached = modelCache.get(modelId);
  if (cached && cached.expiresAt > Date.now()) return cached.model;

  const admin = createAdminClient();
  const { data: model, error } = await admin
    .from("ai_models")
    .select("id,is_active,source,owner_id,is_public,avatar_url,reference_sheet_url,reference_status,reference_images")
    .eq("id", modelId)
    .maybeSingle();

  if (error) throw error;
  if (model) {
    modelCache.set(modelId, {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      model,
    });
  }
  return model;
}

async function createThumbnail(buffer: ArrayBuffer, kind: AssetImageKind): Promise<ArrayBuffer> {
  const image = sharp(Buffer.from(buffer)).rotate();
  const resized = kind === "avatar"
    ? image.resize({ width: 420, height: 630, fit: "inside", withoutEnlargement: true })
    : image.resize({ width: 900, fit: "inside", withoutEnlargement: true });

  const output = await resized
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return toArrayBuffer(output);
}

async function fetchUpstreamImage(imageUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string; status: number }> {
  const upstream = await fetch(imageUrl, {
    cache: "no-store",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!upstream.ok) {
    return {
      buffer: new ArrayBuffer(0),
      contentType: "image/jpeg",
      status: upstream.status,
    };
  }

  return {
    buffer: await upstream.arrayBuffer(),
    contentType: getContentType(upstream.headers.get("content-type")),
    status: upstream.status,
  };
}

async function getThumbnailImage(cacheKey: string, imageUrl: string, kind: AssetImageKind): Promise<CachedImage> {
  const cachedImage = thumbCache.get(cacheKey);
  if (cachedImage && cachedImage.expiresAt > Date.now()) return cachedImage;

  const inflight = thumbInflight.get(cacheKey);
  if (inflight) return inflight;

  const thumbnailPromise = (async () => {
    const upstream = await fetchUpstreamImage(imageUrl);
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new Error(`Image unavailable: HTTP ${upstream.status}`);
    }

    const buffer = await createThumbnail(upstream.buffer, kind);
    const image = {
      expiresAt: Date.now() + THUMB_CACHE_TTL_MS,
      buffer,
      contentType: "image/jpeg",
    };
    setThumbCache(cacheKey, image);
    return image;
  })();

  thumbInflight.set(cacheKey, thumbnailPromise);

  try {
    return await thumbnailPromise;
  } finally {
    thumbInflight.delete(cacheKey);
  }
}

export async function GET(request: NextRequest) {
  if (!isImageElementRequest(request)) {
    return NextResponse.json({ error: "Image preview only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const modelId = searchParams.get("modelId");
  const kind = searchParams.get("kind");
  const index = Number(searchParams.get("index") || "0");
  const variant = isAssetImageVariant(searchParams.get("variant"))
    ? searchParams.get("variant") as AssetImageVariant
    : "full";

  if (!modelId || !isAssetImageKind(kind) || !Number.isFinite(index) || index < 0) {
    return NextResponse.json({ error: "Invalid image request" }, { status: 400 });
  }

  let model: Awaited<ReturnType<typeof getModelAsset>>;
  try {
    model = await getModelAsset(modelId);
  } catch (error) {
    console.error("[Model Asset Image] Database error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }

  if (!model || !model.is_active || !model.reference_sheet_url || model.reference_status !== "completed") {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  let userId: string | undefined;
  const canViewPublicAsset =
    model.source === "official" ||
    (model.source === "user_created" && model.is_public);

  if (!canViewPublicAsset) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id;
  }

  const canView =
    canViewPublicAsset ||
    (Boolean(userId) && model.owner_id === userId);

  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isPrivate = model.source === "user_created" && model.owner_id === userId && !model.is_public;
  const etag = `"asset-${model.id}-${kind}-${index}-${variant}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        "Cache-Control": getCacheControl(isPrivate, variant),
        ETag: etag,
      },
    });
  }

  const referenceImages = normalizeCharacterAssetImages(model.reference_images);
  const imageUrl =
    kind === "avatar"
      ? model.avatar_url
      : kind === "sheet"
        ? model.reference_sheet_url
        : referenceImages[index] || null;

  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  try {
    const cacheKey = `${model.id}:${kind}:${index}:${variant}`;
    if (variant === "thumb") {
      const thumbnail = await getThumbnailImage(cacheKey, imageUrl, kind);
      return new NextResponse(thumbnail.buffer, {
        headers: {
          "Cache-Control": getCacheControl(isPrivate, variant),
          "Content-Disposition": "inline",
          "Content-Type": thumbnail.contentType,
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    const upstream = await fetchUpstreamImage(imageUrl);
    if (upstream.status < 200 || upstream.status >= 300) {
      return NextResponse.json({ error: "Image unavailable" }, { status: upstream.status });
    }

    return new NextResponse(upstream.buffer, {
      headers: {
        "Cache-Control": getCacheControl(isPrivate, variant),
        "Content-Disposition": "inline",
        "Content-Type": upstream.contentType,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    console.error("[Model Asset Image] Fetch error:", error);
    return NextResponse.json({ error: "Failed to load image" }, { status: 502 });
  }
}
