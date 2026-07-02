/**
 * Reference Cache - reference_cache 表读写封装(S2.1)
 *
 * 表由 S0.1 迁移建立(20260702_studio_foundation.sql:107-135,设计沿用
 * migration 007 product_link_cache 的 url_hash / raw+parsed 双层 / parse_status)。
 * RLS 已启用且无策略 = 仅 service role 可访问,必须走 createAdminClient。
 * 表未进 database.ts 生成类型,沿用 blueprints 路由的 untyped client 断言惯例。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductCard } from "@/lib/studio/product-vision";

/** 成功解析结果的缓存有效期(过期后重抓,商品页信息会变) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedReference {
  card: ProductCard;
  sourceUrl: string;
}

function adminDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/**
 * 查缓存:仅命中 parse_status='success' 且未过期的行。
 * 命中时顺手 +1 hit_count(fire-and-forget,失败不影响主流程)。
 */
export async function getCachedReference(urlHash: string): Promise<CachedReference | null> {
  try {
    const db = adminDb();
    const { data, error } = await db
      .from("reference_cache")
      .select("source_url, parsed, parse_status, expires_at, hit_count")
      .eq("url_hash", urlHash)
      .eq("parse_status", "success")
      .maybeSingle();
    if (error || !data) return null;

    const row = data as {
      source_url: string;
      parsed: unknown;
      expires_at: string | null;
      hit_count: number | null;
    };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

    const card = row.parsed as ProductCard | null;
    if (!card || typeof card.title !== "string" || !Array.isArray(card.selling_points)) {
      return null;
    }

    void db
      .from("reference_cache")
      .update({ hit_count: (row.hit_count ?? 0) + 1 } as never)
      .eq("url_hash", urlHash)
      .then(() => {});

    return { card, sourceUrl: row.source_url };
  } catch {
    return null;
  }
}

/** 写缓存:成功带 parsed 商品卡与 TTL;失败记 error_message(便于观察哪些站抓不动)。 */
export async function saveReference(entry: {
  urlHash: string;
  sourceUrl: string;
  raw: Record<string, unknown>;
  parsed?: ProductCard;
  status: "success" | "failed";
  errorMessage?: string;
}): Promise<void> {
  try {
    const db = adminDb();
    await db.from("reference_cache").upsert(
      {
        url_hash: entry.urlHash,
        source_url: entry.sourceUrl,
        source_type: "product_link",
        raw: entry.raw,
        parsed: entry.parsed ?? null,
        parse_status: entry.status,
        error_message: entry.errorMessage ?? null,
        expires_at:
          entry.status === "success" ? new Date(Date.now() + CACHE_TTL_MS).toISOString() : null,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "url_hash" }
    );
  } catch (error) {
    console.error("[ReferenceCache] save failed:", error);
  }
}
