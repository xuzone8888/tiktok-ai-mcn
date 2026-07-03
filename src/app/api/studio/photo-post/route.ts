import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOSSUrl } from "@/lib/oss";
import { generatePhotoPostCaptions } from "@/lib/deepseek-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 图文帖生成(S4.1,BLUEPRINT §六 第四产出形态)
 *
 * POST {
 *   blueprintId: UUID,
 *   batchId?: UUID,
 *   groupName?: string,
 *   direction?: string,           // 用户创意方向(omnibox 输入框文字)
 *   tasks: [{ id: 'pp-*', imageUrls: string[1-10](自有 OSS), hookText?, hookId? }]
 * } → { success, data: { posts: [{ id, caption, images, fromCache, error? }] } }
 *
 * 产出 = 每任务一条 generations 行(source='photo_post', status='completed',
 * task_id=客户端任务 id):图=用户自有素材图序(变体差异在客户端适配器洗牌),
 * 文案=LLM 一次 diverse 出 N 条(素材级去同质化)。零积分(MVP 免费,同拆解腿:
 * 图零生成费+文案一次 LLM,频控兜滥用;付费化留数据说话)。
 *
 * 幂等:同 task_id 已落库直接返回存量(fromCache),重试/刷新恢复零重复成本。
 */

// ---------------------------------------------------------------------------
// 频控(进程内滑动窗口,同 parse-reference/deconstruct 口径)
// ---------------------------------------------------------------------------
const RATE_PER_MIN = 10;
const RATE_PER_DAY = 100;
const rateMap = new Map<string, number[]>();

/**
 * 在途任务单飞(对抗审查 high 实锤):generations.task_id 无唯一约束,
 * check-then-insert 对并发同 taskId 零防护(双击重试/双标签/网络断后立即重试
 * 而服务端首请求仍在 60s LLM 窗口内)会双插行。逐任务认领:已被其他在途
 * 请求认领的任务本请求跳过(返回 inFlight,客户端保持生成中不判死),
 * 首请求落库后按 task_id 幂等对一切后续请求生效。
 */
const inflightTasks = new Set<string>();

function checkRate(userId: string): string | null {
  const now = Date.now();
  const stamps = (rateMap.get(userId) ?? []).filter((t) => now - t < 24 * 3600_000);
  if (stamps.filter((t) => now - t < 60_000).length >= RATE_PER_MIN) {
    return "请求过于频繁,请一分钟后再试";
  }
  if (stamps.length >= RATE_PER_DAY) {
    return "今日图文帖生成次数已达上限";
  }
  stamps.push(now);
  rateMap.set(userId, stamps);
  // 防 Map 无界增长(同 deconstruct 剪枝口径)
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if (v.every((t) => now - t > 24 * 3600_000)) rateMap.delete(k);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 文案兜底(LLM 不可用时的规则模板:轮转卖点起笔,保持变体差异)
// ---------------------------------------------------------------------------
function fallbackCaptions(
  title: string,
  points: string[],
  count: number,
  isZh: boolean
): string[] {
  const tag = title.replace(/[#\s]/g, "").slice(0, 20);
  return Array.from({ length: count }, (_, i) => {
    const rotated = points.length > 0 ? [...points.slice(i % points.length), ...points.slice(0, i % points.length)] : [];
    const body = rotated.map((p) => `✅ ${p}`).join("\n");
    return isZh
      ? `${title}\n${body}\n🛒 点击下方链接马上入手!\n#${tag} #好物推荐 #买它`
      : `${title}\n${body}\n🛒 Tap the link below to get yours!\n#${tag} #musthave #tiktokfinds`;
  });
}

interface TaskPayload {
  id: string;
  imageUrls: string[];
  hookText?: string;
  hookId?: string;
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

    // ---- 入参校验 ----
    const blueprintId: string = typeof body?.blueprintId === "string" ? body.blueprintId : "";
    if (!/^[0-9a-f-]{36}$/i.test(blueprintId)) {
      return NextResponse.json({ success: false, error: "blueprintId 非法" }, { status: 400 });
    }
    const batchId: string | null =
      typeof body?.batchId === "string" && /^[0-9a-f-]{36}$/i.test(body.batchId)
        ? body.batchId
        : null;
    const groupName: string | null =
      typeof body?.groupName === "string" ? body.groupName.slice(0, 100) : null;
    const direction: string =
      typeof body?.direction === "string" ? body.direction.slice(0, 500) : "";

    const rawTasks = Array.isArray(body?.tasks) ? (body.tasks as unknown[]) : [];
    if (rawTasks.length === 0 || rawTasks.length > 20) {
      return NextResponse.json(
        { success: false, error: "tasks 数量需在 1-20 之间" },
        { status: 400 }
      );
    }
    const tasks: TaskPayload[] = [];
    for (const raw of rawTasks) {
      const t = raw as Record<string, unknown>;
      const id = typeof t.id === "string" ? t.id : "";
      const imageUrls = Array.isArray(t.imageUrls)
        ? t.imageUrls.filter((u): u is string => typeof u === "string")
        : [];
      if (!/^pp-[\w-]{1,60}$/.test(id)) {
        return NextResponse.json({ success: false, error: "任务 id 非法" }, { status: 400 });
      }
      if (imageUrls.length < 1 || imageUrls.length > 10) {
        return NextResponse.json(
          { success: false, error: "每条图文帖需 1-10 张图" },
          { status: 400 }
        );
      }
      // 只收自有 OSS 素材(发布可拉取 + 防外链盗用面)
      if (!imageUrls.every((u) => isOSSUrl(u))) {
        return NextResponse.json(
          { success: false, error: "素材图必须先上传到本站" },
          { status: 400 }
        );
      }
      tasks.push({
        id,
        imageUrls,
        hookText: typeof t.hookText === "string" ? t.hookText.slice(0, 300) : undefined,
        hookId: typeof t.hookId === "string" ? t.hookId.slice(0, 64) : undefined,
      });
    }
    // 同请求任务 id 去重(重复 id 会双插 generations)
    if (new Set(tasks.map((t) => t.id)).size !== tasks.length) {
      return NextResponse.json({ success: false, error: "任务 id 重复" }, { status: 400 });
    }

    // ---- 蓝图(RLS own:0 行 = 不存在或非属主) ----
    const db = supabase as unknown as SupabaseClient;
    const { data: bp } = await db
      .from("blueprints")
      .select("id, product, scenes")
      .eq("id", blueprintId)
      .maybeSingle();
    if (!bp) {
      return NextResponse.json({ success: false, error: "蓝图不存在" }, { status: 404 });
    }
    const product = (bp as { product?: Record<string, unknown> | null }).product ?? {};
    const title =
      typeof (product as { title?: unknown }).title === "string"
        ? ((product as { title: string }).title as string).slice(0, 200)
        : "商品";
    const sellingPoints = Array.isArray((product as { selling_points?: unknown }).selling_points)
      ? ((product as { selling_points: Array<{ text?: unknown; selected?: unknown }> })
          .selling_points || [])
          .filter((p) => p?.selected === true && typeof p.text === "string")
          .map((p) => (p.text as string).slice(0, 200))
          .slice(0, 10)
      : [];
    const sceneLines = Array.isArray((bp as { scenes?: unknown }).scenes)
      ? ((bp as { scenes: Array<{ line?: unknown }> }).scenes || [])
          .map((s) => (typeof s?.line === "string" ? s.line.trim() : ""))
          .filter(Boolean)
          .slice(0, 15)
      : [];

    // ---- 幂等:已落库任务直接返回存量 ----
    const admin = createAdminClient();
    const ids = tasks.map((t) => t.id);
    const { data: existingRows } = await admin
      .from("generations")
      .select("task_id, prompt, spec")
      .eq("user_id", user.id)
      .eq("source", "photo_post")
      .in("task_id", ids);
    const existingById = new Map<string, { caption: string; images: string[] }>();
    // spec 列未进 database.ts 生成类型(S0.1 已知),经 unknown 断言
    for (const row of (existingRows ?? []) as unknown as Array<{
      task_id: string;
      prompt: string | null;
      spec: { caption?: unknown; images?: unknown } | null;
    }>) {
      const spec = row.spec ?? {};
      const images = Array.isArray(spec.images)
        ? (spec.images as unknown[]).filter((u): u is string => typeof u === "string")
        : [];
      const caption =
        typeof spec.caption === "string" && spec.caption
          ? spec.caption
          : (row.prompt ?? "");
      existingById.set(row.task_id, { caption, images });
    }

    // ---- 在途认领:被其他请求占用的任务本请求跳过(防并发双插) ----
    const notCached = tasks.filter((t) => !existingById.has(t.id));
    const missing: TaskPayload[] = [];
    const inFlightIds = new Set<string>();
    for (const t of notCached) {
      const flightKey = `${user.id}:${t.id}`;
      if (inflightTasks.has(flightKey)) {
        inFlightIds.add(t.id);
      } else {
        inflightTasks.add(flightKey);
        missing.push(t);
      }
    }

    try {
      // 频控只对真实生成计费(fromCache 重放/纯在途合流不烧配额——审查实锤:
      // 首发整批 1 个戳而逐条重试每条 1 个戳,>10 条批量重试必撞分钟闸)
      if (missing.length > 0) {
        const rateError = checkRate(user.id);
        if (rateError) {
          return NextResponse.json({ success: false, error: rateError }, { status: 429 });
        }
      }

      // ---- 文案:一次 LLM diverse 出 N 条;失败降级规则模板(变体差异仍在) ----
      const isZh = /[一-鿿]/.test(`${title}${sellingPoints.join("")}`);
      let bodies: string[] = [];
      let captionSource: "llm" | "fallback" = "llm";
      if (missing.length > 0) {
        try {
          bodies = await generatePhotoPostCaptions({
            title,
            sellingPoints,
            sceneLines,
            direction,
            count: missing.length,
            language: isZh ? "zh" : "en",
          });
        } catch (error) {
          console.error("[Studio PhotoPost] captions LLM failed, using fallback:", error);
          bodies = fallbackCaptions(title, sellingPoints, missing.length, isZh);
          captionSource = "fallback";
        }
      }

      // ---- 逐任务落库(独立 try:单条失败不作废整批,客户端可单条重试) ----
      const nowIso = new Date().toISOString();
      const results = new Map<string, { caption: string; images: string[]; error?: string }>();
      for (let i = 0; i < missing.length; i++) {
        const task = missing[i];
        const caption = (
          task.hookText ? `${task.hookText}\n\n${bodies[i]}` : bodies[i]
        ).slice(0, 2000);
        const baseRow: Record<string, unknown> = {
          user_id: user.id,
          task_id: task.id,
          type: "image",
          generation_type: "image",
          source: "photo_post",
          prompt: caption,
          model: "photo-post",
          status: "completed",
          progress: 100,
          result_url: task.imageUrls[0],
          image_url: task.imageUrls[0],
          credit_cost: 0,
          credits_used: 0,
          completed_at: nowIso,
          created_at: nowIso,
        };
        const extras: Record<string, unknown> = {
          ...(batchId ? { batch_id: batchId } : {}),
          ...(groupName ? { group_name: groupName } : {}),
        };
        const variant = {
          ...(task.hookId ? { hook_id: task.hookId } : {}),
          ...(task.hookText ? { hook_text: task.hookText } : {}),
        };
        const spec = {
          render_mode: "photo_post",
          blueprint_id: blueprintId,
          images: task.imageUrls,
          caption,
          title,
          cover_index: 0,
          caption_source: captionSource,
          ...(Object.keys(variant).length > 0 ? { variant } : {}),
        };
        // 漂移降级链(对齐 stitch 四档口径,spec 是图序/文案本体尽量保住):
        // 完整行 → 去 batch/group(保 spec)→ 去 spec(保 batch/group)→ 裸行。
        // 全败必须响亮报错,否则任务置 completed 后图序只剩 localStorage 一份
        const attempts: Record<string, unknown>[] = [
          { ...baseRow, ...extras, spec },
          { ...baseRow, spec },
          { ...baseRow, ...extras },
          baseRow,
        ];
        let inserted = false;
        let lastError: { message: string } | null = null;
        for (const row of attempts) {
          const { error: insertError } = await admin.from("generations").insert(row as never);
          if (!insertError) {
            inserted = true;
            break;
          }
          lastError = insertError;
        }
        if (inserted) {
          results.set(task.id, { caption, images: task.imageUrls });
        } else {
          console.error("[Studio PhotoPost] insert failed:", task.id, lastError?.message);
          results.set(task.id, {
            caption,
            images: task.imageUrls,
            error: "任务记录保存失败,请重试(重试不重复生成)",
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          posts: tasks.map((t) => {
            const cached = existingById.get(t.id);
            if (cached) {
              return {
                id: t.id,
                caption: cached.caption,
                // 存量行缺图序(降级行)时回退请求图序,保证客户端可渲染
                images: cached.images.length > 0 ? cached.images : t.imageUrls,
                fromCache: true,
              };
            }
            if (inFlightIds.has(t.id)) {
              // 另一在途请求正在生成:客户端保持「生成中」,由该请求写回/
              // 复水重试按幂等恢复,不判死不双跑
              return { id: t.id, inFlight: true };
            }
            const r = results.get(t.id)!;
            return { id: t.id, caption: r.caption, images: r.images, fromCache: false, ...(r.error ? { error: r.error } : {}) };
          }),
        },
      });
    } finally {
      for (const t of missing) inflightTasks.delete(`${user.id}:${t.id}`);
    }
  } catch (error) {
    console.error("[Studio PhotoPost] error:", error);
    return NextResponse.json(
      { success: false, error: "图文帖生成失败,请重试" },
      { status: 500 }
    );
  }
}
