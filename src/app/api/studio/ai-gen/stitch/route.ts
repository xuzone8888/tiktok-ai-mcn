import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOSSUrl } from "@/lib/oss";

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
 */

const MAX_SEGMENTS = 30;
const WORKER_URL = process.env.MAC_WORKER_URL || "http://127.0.0.1:9091";
const WORKER_TOKEN = process.env.MAC_WORKER_TOKEN || "";

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
      body: JSON.stringify({ videos, aspectRatio, loudnorm: true, transition: "cut" }),
      signal: AbortSignal.timeout(270_000),
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
    if (!/^ag-[\w-]{5,80}$/.test(jobId)) {
      return NextResponse.json({ success: false, error: "jobId 非法" }, { status: 400 });
    }
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
    const sceneTaskIds: string[] = Array.isArray(body?.sceneTaskIds)
      ? body.sceneTaskIds
          .filter((s: unknown): s is string => typeof s === "string")
          .slice(0, MAX_SEGMENTS)
      : [];

    const admin = createAdminClient();

    // 幂等:同 jobId 已落库直接返回(复水重进 stitch / 客户端重试)
    const { data: existing } = await admin
      .from("generations")
      .select("result_url, status")
      .eq("task_id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    const existingRow = existing as { result_url: string | null; status: string } | null;
    if (existingRow?.status === "completed" && existingRow.result_url) {
      return NextResponse.json({
        success: true,
        data: { videoUrl: existingRow.result_url, fromCache: true },
      });
    }

    // 单镜蓝图无需拼接;多镜走 worker(cut 硬切 + loudnorm)
    let stitched: { videoUrl: string; durationSec?: number };
    if (videoUrls.length === 1) {
      stitched = { videoUrl: videoUrls[0] };
    } else {
      stitched = await callWorkerStitch(videoUrls, aspectRatio);
    }

    // 落库:generations.spec 首个写入端(再跑一批/任务中心溯源)
    const nowIso = new Date().toISOString();
    const { error: insertError } = await admin.from("generations").insert({
      user_id: user.id,
      task_id: jobId,
      ...(batchId ? { batch_id: batchId } : {}),
      type: "video",
      generation_type: "video",
      source: "studio",
      prompt: title,
      model: modelType ? `ai_gen:${modelType}` : "ai_gen",
      ...(stitched.durationSec ? { duration: Math.round(stitched.durationSec) } : {}),
      aspect_ratio: aspectRatio,
      status: "completed",
      progress: 100,
      result_url: stitched.videoUrl,
      video_url: stitched.videoUrl,
      output_url: stitched.videoUrl,
      credit_cost: 0, // scene 逐镜已扣,拼接零新增
      credits_used: 0,
      spec: {
        render_mode: "ai_gen",
        ...(blueprintId ? { blueprint_id: blueprintId } : {}),
        scene_task_ids: sceneTaskIds,
        segment_count: videoUrls.length,
        model_type: modelType,
      },
      completed_at: nowIso,
      created_at: nowIso,
    } as never);
    if (insertError) {
      // 不阻断响应:成片已产出(各 scene 已扣费),落库失败只影响入库/任务中心
      console.error("[Studio AiGen Stitch] generations insert failed:", insertError.message);
    }

    return NextResponse.json({
      success: true,
      data: { videoUrl: stitched.videoUrl, durationSec: stitched.durationSec },
    });
  } catch (error) {
    console.error("[Studio AiGen Stitch] error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "拼接失败",
      },
      { status: 500 }
    );
  }
}
