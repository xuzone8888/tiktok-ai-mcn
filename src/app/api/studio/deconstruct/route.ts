import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isOSSUrl } from "@/lib/oss";
import { buildDeconstructBlueprint, deconstructVideo } from "@/lib/studio/deconstruct";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 门B 爆款拆解(S3.2,BLUEPRINT §五)
 *
 * POST {
 *   videoUrl: 用户上传的 mp4(强制自有 OSS 域——门B 只收上传文件,
 *     贴链接腿已裁决砍掉,服务端下载他人视频违平台 ToS),
 *   rightsAck: 必须显式 true(权利确认,红队裁决门B强制勾选;
 *     注意与商品腿相反——那边自传自有素材缺省 true),
 *   title?: string(来源视频备注名)
 * } → { success, data: { blueprintId, report, scenes, hooks } }
 *
 * 产物:blueprints 一行(source_type='reference_video',origin 携带
 * license='structure_only' 溯源 + 完整结构报告);拆解产物只有文本结构,
 * 原片像素与原声永不进入生成物(§五版权产品化)。
 *
 * 计费:MVP 免费(分析属拉新价值,成本≈一次 qwen omni-plus 视频调用),
 * 频控兜底滥用;付费化留数据说话后再定。
 * UI 门槛:20 条真实爆款基准达标前不开 UI(本路由先行,供基准 harness 打)。
 */

// 进程内滑动窗口频控(pm2 单实例;与 parse-reference 同级):
// 拆解是分钟级重活+真金 token,比链接解析更严
const RATE_PER_MIN = 3;
const RATE_PER_DAY = 30;
const MAX_CONCURRENT_PER_USER = 1;
const rateLog = new Map<string, number[]>();
const inflightByUser = new Map<string, number>();

function checkRate(userId: string): string | null {
  const now = Date.now();
  // Map 无界增长剪枝(parse-reference 同款纪律):超阈值时清掉全过期用户
  if (rateLog.size > 5000) {
    for (const [key, times] of rateLog) {
      if (times.every((t) => now - t >= 24 * 3600_000)) rateLog.delete(key);
    }
  }
  const log = (rateLog.get(userId) ?? []).filter((t) => now - t < 24 * 3600_000);
  if (log.filter((t) => now - t < 60_000).length >= RATE_PER_MIN) {
    return "拆解请求太频繁,请一分钟后再试";
  }
  if (log.length >= RATE_PER_DAY) {
    return "今日拆解次数已达上限";
  }
  log.push(now);
  rateLog.set(userId, log);
  return null;
}

/**
 * 拆解结果对账查询(S3.3):按 videoUrl 查同用户 24h 内的 ready 拆解蓝图。
 * 供客户端刷新恢复用——提交后刷新/关页,服务端仍会完成并落库,
 * reconciler 轮询本端点把「拆解中」乐观卡接回结果(零 qwen 调用,纯 select)。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }
    const videoUrl = request.nextUrl.searchParams.get("videoUrl")?.trim() ?? "";
    if (!isOSSUrl(videoUrl)) {
      return NextResponse.json({ success: false, error: "videoUrl 非法" }, { status: 400 });
    }
    const db = supabase as unknown as SupabaseClient;
    const { data: rows } = await db
      .from("blueprints")
      .select("id, scenes, hooks, origin, created_at")
      .eq("user_id", user.id)
      .eq("source_type", "reference_video")
      .eq("status", "ready")
      .filter("source_ref->>url", "eq", videoUrl)
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const hit = (rows as Array<{
      id: string;
      scenes: unknown;
      hooks: unknown;
      origin: { report?: unknown } | null;
    }> | null)?.[0];
    if (!hit?.origin?.report) {
      return NextResponse.json({ success: true, data: { found: false } });
    }
    return NextResponse.json({
      success: true,
      data: {
        found: true,
        blueprintId: hit.id,
        report: hit.origin.report,
        scenes: hit.scenes,
        hooks: hit.hooks,
      },
    });
  } catch (error) {
    console.error("[Studio Deconstruct GET] error:", error);
    return NextResponse.json({ success: false, error: "查询失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();

    // 权利确认:门B 必须显式勾选,缺省/false 一律拒(与商品腿缺省 true 相反)
    if (body?.rightsAck !== true) {
      return NextResponse.json(
        { success: false, error: "请先确认:你拥有分析该视频的权利,且仅复用其结构与创意" },
        { status: 400 }
      );
    }

    const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";
    if (!isOSSUrl(videoUrl)) {
      return NextResponse.json(
        { success: false, error: "只支持分析本站上传的视频文件(请先上传 mp4)" },
        { status: 400 }
      );
    }
    const title =
      typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";

    // 幂等锚(审查实锤:无锚时响应丢失→重试重跑真金 qwen 调用+重复插行):
    // 同用户同 URL 24h 内已有 ready 拆解蓝图,直接返回既有产物;body.force=true
    // 显式绕过(重新分析)
    const db = supabase as unknown as SupabaseClient;
    if (body?.force !== true) {
      const { data: existing } = await db
        .from("blueprints")
        .select("id, scenes, hooks, origin, created_at")
        .eq("user_id", user.id)
        .eq("source_type", "reference_video")
        .eq("status", "ready")
        .filter("source_ref->>url", "eq", videoUrl)
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      const hit = (existing as Array<{
        id: string;
        scenes: unknown;
        hooks: unknown;
        origin: { report?: unknown } | null;
      }> | null)?.[0];
      if (hit?.origin?.report) {
        return NextResponse.json({
          success: true,
          data: {
            blueprintId: hit.id,
            report: hit.origin.report,
            scenes: hit.scenes,
            hooks: hit.hooks,
            fromCache: true,
          },
        });
      }
    }

    // 并发闸:同用户同时只允许一路拆解(qwen 调用分钟级)
    if ((inflightByUser.get(user.id) ?? 0) >= MAX_CONCURRENT_PER_USER) {
      return NextResponse.json(
        { success: false, error: "有一条视频正在拆解中,请等它完成" },
        { status: 429 }
      );
    }
    const rateError = checkRate(user.id);
    if (rateError) {
      return NextResponse.json({ success: false, error: rateError }, { status: 429 });
    }

    userId = user.id;
    inflightByUser.set(user.id, (inflightByUser.get(user.id) ?? 0) + 1);

    // ---------- Qwen omni 一次调用拆解(分钟级) ----------
    const report = await deconstructVideo(videoUrl);
    const { scenes, hooks } = buildDeconstructBlueprint(report);

    // ---------- 蓝图落库(cookie client,RLS own;blueprints 未进生成类型) ----------
    const { data, error } = await db
      .from("blueprints")
      .insert({
        user_id: user.id,
        source_type: "reference_video",
        source_ref: { url: videoUrl, ...(title ? { title } : {}) },
        rights_ack: true,
        product: null,
        hooks,
        scenes,
        globals: {
          aspect: "9:16",
          total_sec: Math.round(report.suggested_duration),
          ...(report.cta?.text ? { cta_text: report.cta.text.slice(0, 100) } : {}),
        },
        render_mode: null, // 出片腿在报告页/抽屉里选
        origin: {
          viral_ref: videoUrl,
          why_viral: report.why_viral.join("\n"),
          license: "structure_only",
          report,
        },
        status: "ready",
      } as never)
      .select("id")
      .single();

    if (error || !data) {
      console.error("[Studio Deconstruct] blueprint insert failed:", error);
      return NextResponse.json(
        { success: false, error: "拆解完成但蓝图保存失败,请重试" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        blueprintId: (data as { id: string }).id,
        report,
        scenes,
        hooks,
      },
    });
  } catch (error) {
    console.error("[Studio Deconstruct] error:", error);
    const raw = error instanceof Error ? error.message : "";
    const friendly =
      raw && !/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(raw)
        ? raw
        : "拆解失败,请重试";
    return NextResponse.json({ success: false, error: friendly }, { status: 500 });
  } finally {
    if (userId) {
      const n = (inflightByUser.get(userId) ?? 1) - 1;
      if (n <= 0) inflightByUser.delete(userId);
      else inflightByUser.set(userId, n);
    }
  }
}
