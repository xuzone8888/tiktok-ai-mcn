import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOSSUrl } from "@/lib/oss";
import { stitchVideosLocally } from "@/lib/studio/local-stitch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * AI 生成腿拼接(S2.3):N 段 scene 成片 → worker /api/stitch → 一条成片落 generations
 *
 * POST {
 *   jobId: 'ag-*'(generations.task_id,幂等锚),
 *   videoUrls: string[](按 scene 顺序;必须是自有 OSS 域——scene 成片经
 *     models/status 转存,天然满足;闸掉任意 URL 防经 worker 的 SSRF),
 *   aspectRatio, batchId?, blueprintId?, title?, modelType?, sceneTaskIds?
 * } → { success, data: { videoUrl, durationSec } }
 *
 * 计费:无——scene 逐镜已在统一网关扣费/退款,拼接不新增扣费路径(裁决)。
 * 幂等:同 jobId 已有 completed 行直接返回既有成片(复水后重进 stitch 不重复落库)。
 * 落库:generations.spec 的首个写入端(blueprint_id + scene 映射,S0.1 列注释兑现)。
 * 双通道(S2.11):worker /health 预检 5s 定通道——可达走 worker(失败再回退),
 * 不可达直接服务器本地 ffmpeg(仿 generate-slideshow);双败返回友好错误,
 * 不裸透传底层 fetch failed。
 */

const MAX_SEGMENTS = 30;
const WORKER_URL = process.env.MAC_WORKER_URL || "http://127.0.0.1:9091";
const WORKER_TOKEN = process.env.MAC_WORKER_TOKEN || "";
// worker 失败后本地回退的准入窗口:worker 已烧掉太多时间就不再叠加本地耗时
// (客户端整体超时 330s),直接友好失败——重试经 task_id 幂等,零新增扣费
const LOCAL_FALLBACK_GATE_MS = 150_000;
// 客户端 AbortSignal.timeout(330s) 留 10s 余量:本地回退的总预算按此对齐,
// 服务端不做客户端早已弃单的无效功(缩小"晚成功落库"与重试的竞态窗口)
const CLIENT_STITCH_BUDGET_MS = 320_000;

// 同 jobId 在途单飞:本地回退把拼接拉长到分钟级,客户端超时重试/刷新复水
// 会在首轮落库前发来第二个请求——check-then-insert 幂等对在途零防护且
// task_id 无唯一约束(对抗审查实锤),后到请求合流到同一 Promise,
// 不双跑不双插。进程内 Map 与 parse-reference 频控同级(pm2 单实例)
const inflightStitches = new Map<
  string,
  Promise<{ videoUrl: string; durationSec?: number }>
>();

async function isWorkerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      ...(WORKER_TOKEN ? { headers: { Authorization: `Bearer ${WORKER_TOKEN}` } } : {}),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function callWorkerStitch(
  videos: string[],
  aspectRatio: string
): Promise<{ videoUrl: string; durationSec?: number }> {
  const attempt = async (): Promise<Response> =>
    fetch(`${WORKER_URL}/api/stitch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {}),
      },
      // worker 拼接实测秒级完成;压缩单次预算给本地回退留窗口(原 270s 会吃光
      // 客户端 330s 总预算,回退无从谈起)
      body: JSON.stringify({ videos, aspectRatio, loudnorm: true, transition: "cut" }),
      signal: AbortSignal.timeout(120_000),
    });

  let res = await attempt();
  if (res.status === 503) {
    // worker 并发上限 2(MAX_CONCURRENT_STITCHES),稍候重试一次
    await new Promise((r) => setTimeout(r, 12_000));
    res = await attempt();
  }
  const text = await res.text();
  let body: { success?: boolean; videoUrl?: string; durationSec?: number; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`worker 响应格式错误 (HTTP ${res.status})`);
  }
  if (!res.ok || !body.success || !body.videoUrl) {
    throw new Error(body.error || `拼接失败 (HTTP ${res.status})`);
  }
  return { videoUrl: body.videoUrl, durationSec: body.durationSec };
}

/** worker 优先,不可达/失败回退本地 ffmpeg;双败抛友好错误 */
async function stitchWithFallback(
  videos: string[],
  aspectRatio: string,
  userId: string
): Promise<{ videoUrl: string; durationSec?: number }> {
  const startedAt = Date.now();
  let workerError = "";
  if (await isWorkerReachable()) {
    try {
      return await callWorkerStitch(videos, aspectRatio);
    } catch (e) {
      workerError = e instanceof Error ? e.message : String(e);
      console.warn(`[Studio AiGen Stitch] worker 拼接失败(${workerError}),尝试本地 ffmpeg 回退`);
    }
  } else {
    workerError = "worker 不可达";
    console.warn("[Studio AiGen Stitch] worker 不可达,直接走本地 ffmpeg 回退");
  }
  if (Date.now() - startedAt > LOCAL_FALLBACK_GATE_MS) {
    throw new Error("拼接超时,请重试(各镜成片已保留,重试不重复扣费)");
  }
  try {
    return await stitchVideosLocally(
      videos,
      aspectRatio,
      userId,
      CLIENT_STITCH_BUDGET_MS - (Date.now() - startedAt)
    );
  } catch (localError) {
    console.error(
      "[Studio AiGen Stitch] 本地 ffmpeg 回退也失败:",
      localError,
      "| worker:",
      workerError
    );
    // 本地通道自产的友好文案(繁忙/超时,均以「拼接」开头)原样放行,
    // 其余内部错误(下载失败/ffmpeg stderr 等)收敛为通用文案
    const msg =
      localError instanceof Error && /^拼接/.test(localError.message)
        ? localError.message
        : "拼接服务暂时不可用,请稍后重试(各镜成片已保留,重试不重复扣费)";
    throw new Error(msg);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    // ag-*=AI 生成腿(S2.3);asm-*=拼装口播腿(S3.1,scene 段由 assembly/scene
    // 端点渲染扣费,拼接同样零新增扣费)
    if (!/^(ag|asm)-[\w-]{5,80}$/.test(jobId)) {
      return NextResponse.json({ success: false, error: "jobId 非法" }, { status: 400 });
    }
    const renderMode = jobId.startsWith("asm-") ? "assembly" : "ai_gen";
    const videoUrls: string[] = Array.isArray(body?.videoUrls)
      ? body.videoUrls.filter((u: unknown): u is string => typeof u === "string")
      : [];
    if (videoUrls.length === 0 || videoUrls.length > MAX_SEGMENTS) {
      return NextResponse.json({ success: false, error: "videoUrls 数量非法" }, { status: 400 });
    }
    // 只拼自有 OSS 域的成片(scene 片段经 models/status 转存,天然满足)
    if (!videoUrls.every((u) => isOSSUrl(u))) {
      return NextResponse.json(
        { success: false, error: "存在非本站存储的视频地址" },
        { status: 400 }
      );
    }
    const aspectRatio = body?.aspectRatio === "16:9" ? "16:9" : "9:16";
    const batchId =
      typeof body?.batchId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.batchId)
        ? body.batchId
        : null;
    const blueprintId = typeof body?.blueprintId === "string" ? body.blueprintId.slice(0, 64) : null;
    const title = typeof body?.title === "string" ? body.title.slice(0, 300) : null;
    const modelType = typeof body?.modelType === "string" ? body.modelType.slice(0, 40) : null;
    const groupName = typeof body?.groupName === "string" ? body.groupName.slice(0, 100) : null;
    const sceneTaskIds: string[] = Array.isArray(body?.sceneTaskIds)
      ? body.sceneTaskIds
          .filter((s: unknown): s is string => typeof s === "string")
          .slice(0, MAX_SEGMENTS)
      : [];
    // 批量矩阵变体快照(S3.4):键白名单拾取,落 spec.variant
    const rawVariant = body?.variant as Record<string, unknown> | undefined;
    const variant: Record<string, string> = {};
    if (rawVariant && typeof rawVariant === "object") {
      for (const key of ["hook_id", "hook_text", "voice_id", "aspect"] as const) {
        if (typeof rawVariant[key] === "string" && rawVariant[key]) {
          variant[key] = (rawVariant[key] as string).slice(0, 300);
        }
      }
    }

    const admin = createAdminClient();

    // 幂等:同 jobId 已有 completed 成片直接返回(复水重进 stitch / 客户端重试)。
    // 用 limit(1) 而非 maybeSingle:万一已存在同 task_id 重复行,maybeSingle
    // 报错、error 被忽略会让幂等锚对该 job 永久失效(对抗审查实锤)——
    // limit(1) 对重复行自愈,仍能命中 fromCache
    const { data: existingRows } = await admin
      .from("generations")
      .select("result_url")
      .eq("task_id", jobId)
      .eq("user_id", user.id)
      .eq("status", "completed")
      .not("result_url", "is", null)
      .limit(1);
    const existingRow = (existingRows as { result_url: string | null }[] | null)?.[0];
    if (existingRow?.result_url) {
      return NextResponse.json({
        success: true,
        data: { videoUrl: existingRow.result_url, fromCache: true },
      });
    }

    // 在途单飞:拼接+落库整体为一个航班,后到的同 jobId 请求合流等结果
    const flightKey = `${user.id}:${jobId}`;
    let flight = inflightStitches.get(flightKey);
    if (!flight) {
      flight = (async () => {
        // 单镜蓝图无需拼接;多镜 worker 优先、本地 ffmpeg 回退(cut 硬切 + loudnorm)
        const stitched: { videoUrl: string; durationSec?: number } =
          videoUrls.length === 1
            ? { videoUrl: videoUrls[0] }
            : await stitchWithFallback(videoUrls, aspectRatio, user.id);

        // 落库:generations.spec 首个写入端(再跑一批/任务中心溯源)。
        // 漂移降级链(对齐 models/submit 的 insertGenerationWithSchemaFallback 思路):
        // 完整行 → 去 spec → 去 batch_id/group_name。仍失败则抛错→500——
        // 静默吞掉会让任务置 completed 后永无补录路径,成片 URL 只剩 localStorage
        // 一份(复审确认项);500 后客户端标失败,重试经 task_id 幂等安全。
        const nowIso = new Date().toISOString();
        const baseRow: Record<string, unknown> = {
          user_id: user.id,
          task_id: jobId,
          type: "video",
          generation_type: "video",
          source: "studio",
          prompt: title,
          model:
            renderMode === "assembly"
              ? "assembly"
              : modelType
                ? `ai_gen:${modelType}`
                : "ai_gen",
          ...(stitched.durationSec ? { duration: Math.round(stitched.durationSec) } : {}),
          aspect_ratio: aspectRatio,
          status: "completed",
          progress: 100,
          result_url: stitched.videoUrl,
          video_url: stitched.videoUrl,
          output_url: stitched.videoUrl,
          credit_cost: 0, // scene 逐镜已扣,拼接零新增
          credits_used: 0,
          completed_at: nowIso,
          created_at: nowIso,
        };
        const extras: Record<string, unknown> = {
          ...(batchId ? { batch_id: batchId } : {}),
          ...(groupName ? { group_name: groupName } : {}),
        };
        const spec = {
          render_mode: renderMode,
          ...(blueprintId ? { blueprint_id: blueprintId } : {}),
          scene_task_ids: sceneTaskIds,
          segment_count: videoUrls.length,
          model_type: modelType,
          ...(Object.keys(variant).length > 0 ? { variant } : {}),
        };
        const attempts: Record<string, unknown>[] = [
          { ...baseRow, ...extras, spec },
          { ...baseRow, ...extras },
          baseRow,
        ];
        let inserted = false;
        let lastInsertError: { message: string } | null = null;
        for (const row of attempts) {
          const { error: insertError } = await admin.from("generations").insert(row as never);
          if (!insertError) {
            inserted = true;
            break;
          }
          lastInsertError = insertError;
        }
        if (!inserted) {
          console.error(
            "[Studio AiGen Stitch] generations insert failed:",
            lastInsertError?.message
          );
          throw new Error("成片已生成但任务记录保存失败,请重试(重试不重复扣费)");
        }
        return stitched;
      })();
      inflightStitches.set(flightKey, flight);
      // settle 后再摘除(合流窗口=整个在途期);catch 前置防未处理拒绝
      flight.catch(() => {}).finally(() => inflightStitches.delete(flightKey));
    }
    const stitched = await flight;

    return NextResponse.json({
      success: true,
      data: { videoUrl: stitched.videoUrl, durationSec: stitched.durationSec },
    });
  } catch (error) {
    console.error("[Studio AiGen Stitch] error:", error);
    // 底层网络/系统错误(fetch failed / ECONNREFUSED 等)不裸透传给用户
    const raw = error instanceof Error ? error.message : "";
    const friendly =
      raw && !/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(raw)
        ? raw
        : "拼接失败,请重试(各镜成片已保留,重试不重复扣费)";
    return NextResponse.json({ success: false, error: friendly }, { status: 500 });
  }
}
