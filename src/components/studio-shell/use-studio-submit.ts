"use client";

/**
 * Studio 提交编译层(S1)
 *
 * omnibox 产出的 Draft → JobSpec → 适配器 → 宿主 store → BTM 自动执行。
 * 乐观 UI:提交即插批次卡(任务 id 幂等由适配器 createJobId 保证);
 * Studio 不发任何轮询,状态由 BTM 写回宿主 store 驱动(裁决,PLAN §五)。
 */

import { useCallback, useEffect } from "react";
import {
  buildMatrixPlan,
  createJobId,
  toAiGenTasks,
  toAiGenTasksWithMatrix,
  toAssemblyTasks,
  toAssemblyTasksWithMatrix,
  toPhotoPostTasks,
  toPhotoPostTasksWithMatrix,
  toQuickGenImageTasks,
  toSlideshowTasks,
  toSlideshowTasksWithMatrix,
  toVideoBatchTasks,
  type AiGenJobSpec,
  type AiGenSceneSpec,
  type AssemblyJobSpec,
  type ImageJobSpec,
  type PhotoPostJobSpec,
  type SlideshowJobSpec,
  type VideoJobSpec,
} from "@/lib/studio/job-spec";
import { useToast } from "@/hooks/use-toast";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { useQuickGenStore } from "@/stores/quick-gen-store";
import { useSlideshowStore } from "@/stores/slideshow-store";
import { useAiGenStore } from "@/stores/ai-gen-store";
import { useAssemblyStore } from "@/stores/assembly-store";
import { usePhotoPostStore, type PhotoPostTask } from "@/stores/photo-post-store";
import { useStudioStore, type StudioBatch, type StudioJobRef } from "@/stores/studio-store";
import type { StudioJobView } from "@/lib/studio/batch-view";
import { getVideoBatchTotalPrice, type VideoAspectRatio, type VideoDuration, type VideoModelType, type VideoQuality } from "@/types/video-batch";
import { getNewImageCost } from "@/lib/credits";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";
import type { ProductCard } from "@/lib/studio/product-vision";

// ============================================================================
// Draft 类型(omnibox 唯一真值:模式切换器 + 参数 chips + 附件 + @角色)
// ============================================================================

export type StudioMode = "image" | "video" | "slideshow" | "product" | "deconstruct";

/** 门B UI 开关(红队裁决:20 条真实爆款基准达标才开;服务端路由不受此限,供基准 harness 打) */
export const DECONSTRUCT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DECONSTRUCT === "1";

export interface VideoParams {
  modelType: VideoModelType;
  aspectRatio: VideoAspectRatio;
  durationSeconds: VideoDuration;
  quality: VideoQuality;
}

export interface ImageParams {
  aspectRatio: string; // auto/1:1/9:16/16:9…
  resolution: "1k" | "2k" | "4k";
}

export interface SlideshowParams {
  aspectRatio: "9:16" | "16:9";
  durationPerImage: number;
  transition: string;
  kenburns: boolean;
  voiceEnabled: boolean;
  bgmEnabled: boolean;
}

export interface StudioDraft {
  mode: StudioMode;
  text: string;
  /** 已上传完成的附件(OSS URL) */
  attachmentUrls: string[];
  character?: CharacterAssetSnapshot;
  video: VideoParams;
  image: ImageParams;
  /** 商品成片模式复用幻灯片渲染参数 */
  slideshow: SlideshowParams;
  /** 商品成片模式:分析完成的商品卡(勾选态在卡内) */
  productCard?: ProductCard | null;
  /** 链接腿(S2.1):商品卡来自链接解析时的来源 URL(蓝图 source_ref 溯源) */
  linkUrl?: string;
  /** 商品成片渲染腿:幻灯片(默认,分级积分)| AI 逐镜生成(video 计价)| 拼装口播(1分/镜,S3.1)| 图文帖(免费,S4.1) */
  productRenderMode?: "slideshow" | "ai_gen" | "assembly" | "photo_post";
  /** 配方实例化(S3.5):seed-* 内置或用户配方 UUID;蓝图 scenes 按配方骨架填槽 */
  recipeId?: string;
  /** 选中配方的镜数(S3.5 审查实锤:assembly/ai_gen 逐镜计价按配方镜数而非图数) */
  recipeSceneCount?: number;
  /** 门B 爆款拆解(S3.3):已直传 OSS 的视频 */
  deconstructVideo?: { url: string; name?: string } | null;
  /** 门B 权利确认(强制显式勾选,服务端二次校验) */
  deconstructRightsAck?: boolean;
  count: number;
}

export const VIDEO_MODEL_LABELS: Record<VideoModelType, string> = {
  sora2: "Sora 2",
  "sora2-pro": "Sora 2 Pro",
  seedance: "Seedance",
  happyhorse: "HappyHorse",
  veo: "VEO",
  grok: "Grok",
  omni: "Omni",
};

/** 幻灯片单条成本(镜像服务端 calculateCredits:≤5图=1分,≤10图=2分,否则3分) */
export function slideshowCreditsPerVideo(imageCount: number): number {
  if (imageCount <= 5) return 1;
  if (imageCount <= 10) return 2;
  return 3;
}

/** 拼装口播单条成本(镜像服务端 assembly/scene:1 积分/镜,拼接零新增) */
export function assemblyCreditsPerVideo(sceneCount: number): number {
  return Math.max(sceneCount, 1);
}

/** 预估积分(展示用;权威扣退在服务端网关) */
export function estimateCredits(draft: StudioDraft): number {
  if (draft.mode === "deconstruct") return 0; // 拆解 MVP 免费(服务端频控兜滥用)
  // 图文帖免费(图=自有素材零生成费,文案一次 LLM;服务端频控兜滥用)
  if (draft.mode === "product" && draft.productRenderMode === "photo_post") return 0;
  if (draft.mode === "video") {
    return (
      getVideoBatchTotalPrice(
        draft.video.modelType,
        draft.video.durationSeconds,
        draft.video.quality
      ) * draft.count
    );
  }
  // 逐镜腿镜数:配方实例化=配方镜数(与图数可不同,估价/门控按实扣口径——审查实锤);
  // 默认结构=每图一镜
  const sceneCount = Math.max(
    draft.recipeId && draft.recipeSceneCount
      ? draft.recipeSceneCount
      : draft.attachmentUrls.length,
    1
  );
  if (draft.mode === "product" && draft.productRenderMode === "ai_gen") {
    // AI 生成腿:逐镜计价(拼接不新增扣费)
    return (
      getVideoBatchTotalPrice(
        draft.video.modelType,
        draft.video.durationSeconds,
        draft.video.quality
      ) *
      sceneCount *
      draft.count
    );
  }
  if (draft.mode === "product" && draft.productRenderMode === "assembly") {
    // 拼装口播腿:1 积分/镜(TTS+渲染;拼接不新增扣费)
    return assemblyCreditsPerVideo(sceneCount) * draft.count;
  }
  if (draft.mode === "slideshow" || draft.mode === "product") {
    return slideshowCreditsPerVideo(draft.attachmentUrls.length) * draft.count;
  }
  return getNewImageCost("gpt-image-2", draft.image.resolution) * draft.count;
}

export function validateDraft(draft: StudioDraft): string | null {
  if (draft.mode === "deconstruct") {
    if (!draft.deconstructVideo?.url) return "请先上传要拆解的爆款视频(mp4)";
    if (draft.deconstructRightsAck !== true) {
      return "请勾选权利确认(仅复用结构与创意)";
    }
    return null;
  }
  if (draft.mode === "video") {
    if (!draft.text.trim() && draft.attachmentUrls.length === 0) {
      return "视频任务需要提示词或至少一张素材图";
    }
  } else if (draft.mode === "product" && draft.productRenderMode === "photo_post") {
    // 图文帖:服务端契约 1-10 图;上限对齐视觉分析管线 9(与其他商品腿同因)
    if (draft.attachmentUrls.length < 1) return "图文帖至少需要 1 张图";
    if (draft.attachmentUrls.length > 9) return "图文帖最多 9 张图(视觉分析上限)";
    if (!draft.productCard) return "等待商品卡分析完成";
    if (!draft.productCard.selling_points.some((p) => p.selected)) {
      return "至少勾选一个卖点";
    }
  } else if (draft.mode === "slideshow" || draft.mode === "product") {
    if (draft.attachmentUrls.length < 2) return "轮播成片至少需要 2 张图";
    // product 上限 9:与视觉分析管线(analyze-product slice 9)对齐,
    // 否则蓝图/商品卡只覆盖前 9 张而成片用了全部图,素材账对不上
    const maxImages = draft.mode === "product" ? 9 : 15;
    if (draft.attachmentUrls.length > maxImages) {
      return draft.mode === "product"
        ? "商品成片最多 9 张图(视觉分析上限)"
        : "轮播成片最多 15 张图";
    }
    if (draft.mode === "product") {
      if (!draft.productCard) return "等待商品卡分析完成";
      if (!draft.productCard.selling_points.some((p) => p.selected)) {
        return "至少勾选一个卖点";
      }
    }
  } else {
    if (!draft.text.trim()) return "图片任务需要提示词";
  }
  if (draft.count < 1 || draft.count > 100) return "数量需在 1-100 之间";
  if (
    draft.mode === "product" &&
    draft.productRenderMode === "photo_post" &&
    draft.count > 20
  ) {
    return "图文帖单批最多 20 条(服务端上限)";
  }
  return null;
}

function batchTitle(draft: StudioDraft): string {
  if (draft.mode === "product" && draft.productCard) return draft.productCard.title;
  const text = draft.text.trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  if (draft.mode === "video") return "图生视频批次";
  if (draft.mode === "slideshow") return "轮播成片批次";
  if (draft.mode === "product") return "商品成片批次";
  if (draft.mode === "deconstruct") {
    return draft.deconstructVideo?.name ? `拆解·${draft.deconstructVideo.name}` : "爆款拆解";
  }
  return "图片批次";
}

function studioGroupName(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `Studio·${mm}.${dd} ${hh}:${mi}`;
}

// ============================================================================
// 提交 / 重试 / 入库
// ============================================================================

export interface SubmitResult {
  ok: boolean;
  error?: string;
  batchId?: string;
}

// ---------------------------------------------------------------------------
// 门B 拆解(S3.3,审查重构):提交即插「拆解中」乐观卡立刻返回,fetch 在页面
// 后台续跑;刷新丢请求由 reconciler 按 videoUrl 对账恢复(服务端幂等锚保证
// 同 URL 不重跑 qwen)。以下为共享的结果落卡/判死助手(模块级,store 经
// getState 访问,供在途回调与 reconciler 两条路径复用)。
// ---------------------------------------------------------------------------

interface DeconstructResultData {
  blueprintId: string;
  scenes?: unknown;
  report?: { summary?: string };
}

function applyDeconstructResult(batchId: string, data: DeconstructResultData): void {
  const store = useStudioStore.getState();
  const batch = store.batches.find((b) => b.id === batchId);
  if (!batch || !batch.deconstructPending) return; // 已解析/已移除
  const sceneList = Array.isArray(data.scenes)
    ? (data.scenes as Array<Record<string, unknown>>)
    : [];
  // spec 存 ai_gen 骨架:报告抽屉「用此结构出片」直接走既有 rerun 链
  const aiGenSpec: AiGenJobSpec = {
    kind: "ai_gen",
    prompt: "",
    modelType: "grok",
    aspectRatio: "9:16",
    durationSeconds: 10,
    quality: "standard",
    scenes: sceneList.map((s) => ({
      idx: s.idx as number,
      line: (s.line as string) ?? "",
      visual: (s.visual as string) ?? "",
      beat: s.beat as AiGenSceneSpec["beat"],
    })),
    productTitle: batch.title,
    count: 1,
    batchId,
    blueprintId: data.blueprintId,
  };
  store.updateBatchMeta(batchId, {
    blueprintId: data.blueprintId,
    spec: aiGenSpec as unknown as Record<string, unknown>,
    summary: {
      ...batch.summary,
      modelLabel: "结构报告",
      attachmentCount: sceneList.length,
    },
    deconstructPending: null,
  });
  // 右栏空闲才自动打开报告(不打断用户正在看的任务/蓝图)
  const fresh = useStudioStore.getState();
  if (!fresh.activeJob && !fresh.activeBlueprintBatchId) {
    fresh.setActiveBlueprintBatch(batchId);
  }
}

function markDeconstructFailed(batchId: string, message: string): void {
  const store = useStudioStore.getState();
  const batch = store.batches.find((b) => b.id === batchId);
  if (!batch || !batch.deconstructPending || batch.deconstructPending.failedAt) return;
  store.updateBatchMeta(batchId, {
    summary: { ...batch.summary, modelLabel: `拆解失败:${message.slice(0, 40)}` },
    deconstructPending: {
      ...batch.deconstructPending,
      failedAt: new Date().toISOString(),
    },
  });
}

/** 拆解在途卡对账:刷新后按 videoUrl 轮询服务端结果,15 分钟未见判死 */
export function useDeconstructReconciler() {
  const batches = useStudioStore((s) => s.batches);
  const pendingKey = batches
    .filter((b) => b.deconstructPending && !b.deconstructPending.failedAt)
    .map((b) => b.id)
    .join(",");

  useEffect(() => {
    if (!pendingKey) return;
    let cancelled = false;
    const tick = async () => {
      const list = useStudioStore
        .getState()
        .batches.filter((b) => b.deconstructPending && !b.deconstructPending.failedAt);
      for (const b of list) {
        try {
          const res = await fetch(
            `/api/studio/deconstruct?videoUrl=${encodeURIComponent(b.deconstructPending!.videoUrl)}`
          );
          const body = await res.json();
          if (cancelled) return;
          if (body.success && body.data?.found) {
            applyDeconstructResult(b.id, body.data as DeconstructResultData);
          } else if (Date.now() - new Date(b.createdAt).getTime() > 15 * 60_000) {
            markDeconstructFailed(b.id, "超时未完成,可移除本卡后重新提交");
          }
        } catch {
          // 单次查询失败不致命,下一轮继续
        }
      }
    };
    // 首查延迟 20s(同页在途 fetch 先行),之后每 30s 对账一次
    const first = setTimeout(tick, 20_000);
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [pendingKey]);
}

// ---------------------------------------------------------------------------
// 图文帖(S4.1):任务写入 store 即插卡(状态=生成文案中),本函数在页面后台
// POST /api/studio/photo-post 并写回结果。服务端按 task_id 幂等落库:
// 网络中断后重试(retryJob→retryTask 复位)已落库变体直接命中零重复成本;
// 刷新中断由 store 复水归一化判失败,同样走重试恢复。
// ---------------------------------------------------------------------------

/**
 * 重试合流(对抗审查实锤):批次卡「重试失败 N 条」逐任务调 retryJob,若每条
 * 各发一个 POST,服务端频控按请求计数,N>10 直接 429 再度全失败。同批次
 * 250ms 窗口内的重试合并为一个 POST(与首发同口径:整批一个请求)。
 */
const pendingPhotoPostRetries = new Map<
  string,
  { spec: PhotoPostJobSpec; tasks: PhotoPostTask[]; timer: ReturnType<typeof setTimeout> }
>();

function queuePhotoPostRetry(spec: PhotoPostJobSpec, task: PhotoPostTask): void {
  const key = spec.batchId ?? task.batchId ?? task.id;
  const pending = pendingPhotoPostRetries.get(key);
  if (pending) {
    if (!pending.tasks.some((t) => t.id === task.id)) pending.tasks.push(task);
    return;
  }
  const entry = {
    spec,
    tasks: [task],
    timer: setTimeout(() => {
      pendingPhotoPostRetries.delete(key);
      runPhotoPostGeneration(entry.spec, entry.tasks);
    }, 250),
  };
  pendingPhotoPostRetries.set(key, entry);
}

function runPhotoPostGeneration(
  spec: PhotoPostJobSpec,
  tasks: PhotoPostTask[]
): void {
  void (async () => {
    const store = usePhotoPostStore.getState();
    try {
      const res = await fetch("/api/studio/photo-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: spec.blueprintId,
          batchId: spec.batchId,
          groupName: spec.groupName,
          direction: spec.prompt,
          tasks: tasks.map((t) => ({
            id: t.id,
            imageUrls: t.imageUrls,
            ...(t.hookText ? { hookText: t.hookText } : {}),
            ...(t.variant?.hook_id ? { hookId: t.variant.hook_id } : {}),
          })),
        }),
        signal: AbortSignal.timeout(110_000),
      });
      const result = await res.json();
      if (result.success && Array.isArray(result.data?.posts)) {
        const posts = result.data.posts as Array<{
          id: string;
          caption?: string;
          error?: string;
          inFlight?: boolean;
        }>;
        const seen = new Set<string>();
        for (const post of posts) {
          seen.add(post.id);
          if (post.inFlight) {
            // 另一在途请求(双击/双标签)正在生成同任务:保持「生成中」,
            // 由该请求写回;若其响应也丢失,复水归一化 + 重试幂等兜底
            continue;
          }
          if (post.error) {
            usePhotoPostStore.getState().updateTask(post.id, {
              status: "failed",
              errorMessage: post.error,
            });
          } else {
            usePhotoPostStore.getState().updateTask(post.id, {
              status: "completed",
              caption: typeof post.caption === "string" ? post.caption : "",
              errorMessage: null,
            });
          }
        }
        // 响应缺失的任务(理论不发生)判失败,不留永久转圈
        for (const t of tasks) {
          if (!seen.has(t.id)) {
            usePhotoPostStore.getState().updateTask(t.id, {
              status: "failed",
              errorMessage: "服务端未返回该条结果,请重试",
            });
          }
        }
      } else {
        const message = result?.error || "图文帖生成失败,请重试";
        for (const t of tasks) {
          store.updateTask(t.id, { status: "failed", errorMessage: message });
        }
      }
    } catch {
      // 网络断/超时:服务端可能已落库部分变体,重试按 task_id 幂等恢复
      for (const t of tasks) {
        usePhotoPostStore.getState().updateTask(t.id, {
          status: "failed",
          errorMessage: "网络中断,点击重试恢复(已生成的不重复计费)",
        });
      }
    }
  })();
}

export function useStudioSubmit() {
  const { toast } = useToast();
  const addBatch = useStudioStore((state) => state.addBatch);
  const replaceJobRef = useStudioStore((state) => state.replaceJobRef);
  const markJobsLibrary = useStudioStore((state) => state.markJobsLibrary);

  const submit = useCallback(
    async (draft: StudioDraft): Promise<SubmitResult> => {
      const invalid = validateDraft(draft);
      if (invalid) return { ok: false, error: invalid };

      const batchId = crypto.randomUUID();
      const now = new Date();
      const groupName = studioGroupName(now);
      let jobRefs: StudioJobRef[];
      let spec: Record<string, unknown>;
      let blueprintId: string | undefined;

      if (draft.mode === "deconstruct") {
        // 门B(S3.3,审查重构):提交即插「拆解中」乐观卡立刻返回,不阻塞
        // omnibox(原同步等待 1-5 分钟:刷新丢卡出孤儿蓝图、成功回调清掉
        // 用户切走后编辑的草稿——均为审查实锤)。fetch 在页面后台续跑;
        // 刷新/关页由 useDeconstructReconciler 按 videoUrl 对账恢复,
        // 服务端同 URL 24h 幂等锚保证不重跑 qwen。
        const videoUrl = draft.deconstructVideo!.url;
        const title = batchTitle(draft);
        const reportTitle = draft.text.trim() || draft.deconstructVideo!.name || "";
        addBatch({
          id: batchId,
          createdAt: now.toISOString(),
          title,
          summary: { mode: "deconstruct", modelLabel: "拆解中…", count: 1, estimatedCredits: 0 },
          spec: { kind: "deconstruct", videoUrl },
          jobRefs: [],
          deconstructPending: { videoUrl },
        });
        void (async () => {
          try {
            const res = await fetch("/api/studio/deconstruct", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ videoUrl, rightsAck: true, title: reportTitle }),
              signal: AbortSignal.timeout(420_000),
            });
            const result = await res.json();
            if (result.success && result.data?.blueprintId) {
              applyDeconstructResult(batchId, result.data as DeconstructResultData);
              toast({ title: "📋 结构报告已就绪", description: title });
            } else {
              // 服务端明确业务失败(频控/无口播/格式异常)→ 判死可重试
              markDeconstructFailed(batchId, result.error || "拆解失败");
              toast({
                title: "拆解失败",
                description: result.error || "请移除该卡后重试",
                variant: "destructive",
              });
            }
          } catch {
            // 网络断/超时:服务端可能仍在跑,不判死——交 reconciler 对账
            console.warn("[Studio Deconstruct] 在途请求中断,等待 reconciler 对账恢复");
          }
        })();
        return { ok: true, batchId };
      }

      if (draft.mode === "product") {
        // 商品图/链接腿:商品卡 → 蓝图落库 → 渲染腿出 N 条(幻灯片|AI 逐镜|拼装口播|图文帖)
        const card = draft.productCard!;
        const renderMode =
          draft.productRenderMode === "ai_gen" ||
          draft.productRenderMode === "assembly" ||
          draft.productRenderMode === "photo_post"
            ? draft.productRenderMode
            : "slideshow";
        let blueprintScenes: AiGenSceneSpec[] = [];
        try {
          const res = await fetch("/api/studio/blueprints", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // 素材集以实际附件为准:链接解析卡的 images 可能为空(转存全败)
              // 或与用户增删后的附件不一致,蓝图 scenes 必须覆盖真实成片素材
              product: { ...card, images: draft.attachmentUrls },
              globals:
                renderMode === "ai_gen"
                  ? {
                      aspect: draft.video.aspectRatio,
                      duration_per_image_ms: draft.video.durationSeconds * 1000,
                    }
                  : renderMode === "assembly"
                    ? {
                        aspect: draft.slideshow.aspectRatio,
                        duration_per_image_ms: Math.round(
                          draft.slideshow.durationPerImage * 1000
                        ),
                      }
                    : renderMode === "photo_post"
                      ? {} // 图文帖无渲染参数(render_intent 由路由写入)
                      : {
                          aspect: draft.slideshow.aspectRatio,
                          duration_per_image_ms: Math.round(draft.slideshow.durationPerImage * 1000),
                          bgm_style: draft.slideshow.bgmEnabled ? "random" : "none",
                        },
              renderMode,
              ...(draft.recipeId ? { recipeId: draft.recipeId } : {}),
              ...(draft.linkUrl
                ? { sourceType: "product_link", sourceUrl: draft.linkUrl }
                : {}),
            }),
          });
          const result = await res.json();
          if (!result.success) {
            return { ok: false, error: result.error || "蓝图保存失败" };
          }
          blueprintId = result.data?.blueprintId;
          blueprintScenes = Array.isArray(result.data?.scenes)
            ? (result.data.scenes as Array<Record<string, unknown>>).map((s) => ({
                idx: s.idx as number,
                line: (s.line as string) ?? "",
                visual: (s.visual as string) ?? "",
                beat: s.beat as AiGenSceneSpec["beat"],
                // 空串必须归一为 undefined:'' 非 nullish 会击穿下游
                // 「visual 是 URL 则作参考图」的兜底链(审查实锤)
                imageUrl:
                  ((s.slot as { asset_ref?: string } | undefined)?.asset_ref as string) ||
                  undefined,
              }))
            : [];
        } catch {
          return { ok: false, error: "蓝图保存失败,请重试" };
        }

        if (renderMode === "photo_post") {
          // 图文帖腿(S4.1):图=素材图序(每变体独立洗牌),文案=服务端 LLM。
          // 任务即插即显(生成文案中),后台 fetch 写回;无 BTM 执行器
          const selectedPoints = card.selling_points.filter((p) => p.selected);
          const photoSpec: PhotoPostJobSpec = {
            kind: "photo_post",
            prompt: draft.text.trim(),
            imageUrls: draft.attachmentUrls,
            productTitle: card.title,
            sellingPoints: selectedPoints.map((p) => p.text),
            sceneLines: blueprintScenes.map((s) => s.line.trim()).filter(Boolean),
            count: draft.count,
            batchId,
            groupName,
            blueprintId,
          };
          const tasks = toPhotoPostTasks(photoSpec);
          usePhotoPostStore.getState().addTasks(tasks);
          runPhotoPostGeneration(photoSpec, tasks);
          jobRefs = tasks.map((t) => ({ kind: "photo_post" as const, taskId: t.id }));
          spec = photoSpec as unknown as Record<string, unknown>;
        } else if (renderMode === "assembly") {
          // 拼装口播腿(S3.1):蓝图 scenes 逐镜 TTS+字幕出段 → stitch
          if (blueprintScenes.length === 0) {
            return { ok: false, error: "蓝图分镜为空,无法拼装出片" };
          }
          const assemblyScenes = blueprintScenes
            .filter((s) => !!s.imageUrl)
            .map((s) => ({ idx: s.idx, line: s.line, imageUrl: s.imageUrl! }));
          if (assemblyScenes.length === 0) {
            return { ok: false, error: "蓝图分镜缺少素材图,无法拼装出片" };
          }
          const assemblySpec: AssemblyJobSpec = {
            kind: "assembly",
            prompt: draft.text.trim(),
            aspectRatio: draft.slideshow.aspectRatio,
            durationPerImage: draft.slideshow.durationPerImage,
            kenburns: draft.slideshow.kenburns,
            scenes: assemblyScenes,
            productTitle: card.title,
            count: draft.count,
            batchId,
            groupName,
            blueprintId,
          };
          const tasks = toAssemblyTasks(assemblySpec);
          useAssemblyStore.getState().addTasks(tasks);
          jobRefs = tasks.map((t) => ({ kind: "assembly" as const, taskId: t.id }));
          spec = assemblySpec as unknown as Record<string, unknown>;
        } else if (renderMode === "ai_gen") {
          // AI 生成腿(S2.3):蓝图 scenes 逐镜编译 prompt → 统一网关 → stitch
          if (blueprintScenes.length === 0) {
            return { ok: false, error: "蓝图分镜为空,无法逐镜生成" };
          }
          const aspectRatio = draft.video.aspectRatio === "16:9" ? "16:9" : "9:16";
          const aiGenSpec: AiGenJobSpec = {
            kind: "ai_gen",
            prompt: draft.text.trim(),
            modelType: draft.video.modelType,
            aspectRatio,
            durationSeconds: draft.video.durationSeconds,
            quality: draft.video.quality,
            scenes: blueprintScenes,
            productTitle: card.title,
            count: draft.count,
            batchId,
            groupName,
            blueprintId,
          };
          const tasks = toAiGenTasks(aiGenSpec);
          useAiGenStore.getState().addTasks(tasks);
          jobRefs = tasks.map((t) => ({ kind: "ai_gen" as const, taskId: t.id }));
          spec = aiGenSpec as unknown as Record<string, unknown>;
        } else {
          // 变体在脚本层做:标题+勾选卖点作为文案关键词,服务端 diverse 模式
          // 每条成片生成不同角度口播;图序差异由适配器洗牌提供(素材级)。
          // 配方实例化时:配方台词拼成整片脚本直达渲染端(否则配方对幻灯片
          // 腿零效果——审查实锤)
          const selectedPoints = card.selling_points.filter((p) => p.selected);
          const keywords = [card.title, ...selectedPoints.map((p) => p.text)].join(";");
          const recipeScript =
            draft.recipeId && blueprintScenes.length > 0
              ? blueprintScenes
                  .map((s) => s.line.trim())
                  .filter(Boolean)
                  .map((l) => (/[。!?!?.]$/.test(l) ? l : `${l}。`))
                  .join("")
              : undefined;
          const slideshowSpec: SlideshowJobSpec = {
            kind: "slideshow",
            prompt: keywords,
            scriptText: recipeScript,
            imageUrls: draft.attachmentUrls,
            aspectRatio: draft.slideshow.aspectRatio,
            durationPerImage: draft.slideshow.durationPerImage,
            transition: draft.slideshow.transition,
            kenburns: draft.slideshow.kenburns,
            voiceEnabled: draft.slideshow.voiceEnabled,
            bgmEnabled: draft.slideshow.bgmEnabled,
            count: draft.count,
            batchId,
            groupName,
            blueprintId,
          };
          const tasks = toSlideshowTasks(slideshowSpec);
          useSlideshowStore.getState().addTasks(tasks);
          jobRefs = tasks.map((t) => ({ kind: "slideshow" as const, taskId: t.id }));
          spec = slideshowSpec as unknown as Record<string, unknown>;
        }
      } else if (draft.mode === "video") {
        const videoSpec: VideoJobSpec = {
          kind: "video",
          prompt: draft.text.trim(),
          modelType: draft.video.modelType,
          aspectRatio: draft.video.aspectRatio,
          durationSeconds: draft.video.durationSeconds,
          quality: draft.video.quality,
          imageUrls: draft.attachmentUrls,
          character: draft.character,
          count: draft.count,
          batchId,
          groupName,
        };
        const tasks = toVideoBatchTasks(videoSpec);
        useVideoBatchStore.getState().addTasks(tasks);
        // BTM 视频执行器由 jobStatus==="running" 门控(侦查结论):显式开跑
        useVideoBatchStore.getState().startBatch();
        jobRefs = tasks.map((t) => ({ kind: "video" as const, taskId: t.id }));
        spec = videoSpec as unknown as Record<string, unknown>;
      } else if (draft.mode === "slideshow") {
        const slideshowSpec: SlideshowJobSpec = {
          kind: "slideshow",
          prompt: draft.text.trim(),
          imageUrls: draft.attachmentUrls,
          aspectRatio: draft.slideshow.aspectRatio,
          durationPerImage: draft.slideshow.durationPerImage,
          transition: draft.slideshow.transition,
          kenburns: draft.slideshow.kenburns,
          voiceEnabled: draft.slideshow.voiceEnabled,
          bgmEnabled: draft.slideshow.bgmEnabled,
          count: draft.count,
          batchId,
          groupName,
        };
        const tasks = toSlideshowTasks(slideshowSpec);
        // BTM 幻灯片执行器扫描带 renderRequest 的 pending 任务,写入即自动拉起
        useSlideshowStore.getState().addTasks(tasks);
        jobRefs = tasks.map((t) => ({ kind: "slideshow" as const, taskId: t.id }));
        spec = slideshowSpec as unknown as Record<string, unknown>;
      } else {
        const perTaskCost = getNewImageCost("gpt-image-2", draft.image.resolution);
        const imageSpec: ImageJobSpec = {
          kind: "image",
          prompt: draft.text.trim(),
          imageModel: "gpt-image-2",
          aspectRatio: draft.image.aspectRatio,
          resolution: draft.image.resolution,
          sourceImageUrls: draft.attachmentUrls,
          character: draft.character,
          count: draft.count,
          batchId,
          creditCost: perTaskCost,
        };
        const tasks = toQuickGenImageTasks(imageSpec);
        // quick-gen 执行器无门控,写入 idle 任务即自动拉起(侦查结论)
        useQuickGenStore.getState().addImageTasks(tasks);
        jobRefs = tasks.map((t) => ({ kind: "image" as const, taskId: t.id }));
        spec = imageSpec as unknown as Record<string, unknown>;
      }

      const batch: StudioBatch = {
        id: batchId,
        createdAt: now.toISOString(),
        title: batchTitle(draft),
        summary: {
          mode: draft.mode,
          modelLabel:
            draft.mode === "video"
              ? VIDEO_MODEL_LABELS[draft.video.modelType]
              : draft.mode === "slideshow"
                ? `幻灯片${draft.slideshow.kenburns ? "·运镜" : ""}`
                : draft.mode === "product"
                  ? draft.productRenderMode === "ai_gen"
                    ? `AI 生成·${VIDEO_MODEL_LABELS[draft.video.modelType]}`
                    : draft.productRenderMode === "assembly"
                      ? `拼装口播${draft.slideshow.kenburns ? "·运镜" : ""}`
                      : draft.productRenderMode === "photo_post"
                        ? "图文帖"
                        : `商品成片${draft.slideshow.kenburns ? "·运镜" : ""}`
                  : "GPT Image 2",
          aspectRatio:
            draft.mode === "video"
              ? draft.video.aspectRatio
              : draft.mode === "product" && draft.productRenderMode === "ai_gen"
                ? draft.video.aspectRatio
                : draft.mode === "product" && draft.productRenderMode === "photo_post"
                  ? undefined // 图文帖无比例语义
                  : draft.mode === "slideshow" || draft.mode === "product"
                    ? draft.slideshow.aspectRatio
                    : draft.image.aspectRatio,
          durationSeconds:
            draft.mode === "video"
              ? draft.video.durationSeconds
              : draft.mode === "product" && draft.productRenderMode === "ai_gen"
                ? draft.video.durationSeconds
                : undefined,
          resolution: draft.mode === "image" ? draft.image.resolution : undefined,
          count: draft.count,
          characterName: draft.character?.name,
          attachmentCount: draft.attachmentUrls.length,
          estimatedCredits: estimateCredits(draft),
        },
        spec,
        jobRefs,
        blueprintId,
        character: draft.character
          ? {
              id: draft.character.id,
              name: draft.character.name,
              avatar_url: draft.character.avatar_url,
            }
          : undefined,
      };
      addBatch(batch);
      return { ok: true, batchId };
    },
    [addBatch, toast]
  );

  /**
   * 从(编辑后的)蓝图再出一批(S2.2;S3.4 加批量矩阵):渲染参数沿用原批次
   * spec 快照,标题+勾选卖点重建文案关键词,产出新 Batch(同 blueprintId,新
   * batchId)。矩阵维度(选中 hooks × 比例 × 音色轮转)逐格变异 spec:
   * hook 注入 hook 镜台词(幻灯片=关键词前缀),变体参数落 generations.spec.variant。
   */
  const rerunBlueprint = useCallback(
    (
      batch: StudioBatch,
      card: ProductCard,
      blueprintId: string,
      count: number,
      /** 编辑后的分镜(AI 生成腿重跑时台词改动经此生效;幻灯片腿忽略) */
      editedScenes?: AiGenSceneSpec[],
      /** 批量矩阵(S3.4):选中 hooks 与比例多选,空=沿用基础 spec */
      matrix?: { hooks?: Array<{ id: string; text: string }>; aspects?: Array<"9:16" | "16:9"> }
    ): SubmitResult => {
      const baseSpec = batch.spec as unknown as
        | SlideshowJobSpec
        | AiGenJobSpec
        | AssemblyJobSpec
        | PhotoPostJobSpec;

      if (baseSpec?.kind === "photo_post") {
        // 图文帖重跑:卖点勾选/台词编辑经商品卡+蓝图 scenes 重建文案上下文;
        // hook 矩阵作文案开头行;比例维度无意义(适配器忽略)
        const selected = card.selling_points.filter((p) => p.selected);
        if (selected.length === 0) return { ok: false, error: "至少勾选一个卖点" };
        const imageUrls =
          card.images.length >= 1 ? card.images.slice(0, 10) : baseSpec.imageUrls;
        if (!imageUrls || imageUrls.length === 0) {
          return { ok: false, error: "图文帖至少需要 1 张图" };
        }
        const clamped = Math.max(1, Math.min(20, Math.floor(count) || 1));
        const batchId = crypto.randomUUID();
        const now = new Date();
        const photoSpec: PhotoPostJobSpec = {
          ...baseSpec,
          imageUrls,
          productTitle: card.title,
          sellingPoints: selected.map((p) => p.text),
          sceneLines:
            editedScenes && editedScenes.length > 0
              ? editedScenes.map((s) => s.line.trim()).filter(Boolean)
              : baseSpec.sceneLines,
          count: clamped,
          batchId,
          groupName: studioGroupName(now),
          blueprintId,
        };
        const tasks = toPhotoPostTasksWithMatrix(photoSpec, buildMatrixPlan(clamped, matrix));
        usePhotoPostStore.getState().addTasks(tasks);
        runPhotoPostGeneration(photoSpec, tasks);
        addBatch({
          id: batchId,
          createdAt: now.toISOString(),
          title: card.title,
          summary: {
            mode: "product",
            modelLabel: "图文帖",
            count: clamped,
            attachmentCount: imageUrls.length,
            estimatedCredits: 0,
          },
          spec: photoSpec as unknown as Record<string, unknown>,
          jobRefs: tasks.map((t) => ({ kind: "photo_post" as const, taskId: t.id })),
          blueprintId,
        });
        return { ok: true, batchId };
      }

      if (baseSpec?.kind === "assembly") {
        // 拼装口播腿重跑:台词/卖点编辑经蓝图 scenes 生效,新批次独立随机音色
        const sceneList =
          editedScenes && editedScenes.length > 0
            ? editedScenes
                .filter((s) => !!(s.imageUrl ?? (s.visual.startsWith("http") ? s.visual : "")))
                .map((s) => ({
                  idx: s.idx,
                  line: s.line,
                  imageUrl: (s.imageUrl ?? s.visual)!,
                }))
            : baseSpec.scenes;
        if (!sceneList || sceneList.length === 0) {
          return { ok: false, error: "蓝图分镜为空,无法拼装出片" };
        }
        const clamped = Math.max(1, Math.min(100, Math.floor(count) || 1));
        const batchId = crypto.randomUUID();
        const now = new Date();
        const assemblySpec: AssemblyJobSpec = {
          ...baseSpec,
          scenes: sceneList,
          productTitle: card.title,
          count: clamped,
          batchId,
          groupName: studioGroupName(now),
          blueprintId,
        };
        const tasks = toAssemblyTasksWithMatrix(assemblySpec, buildMatrixPlan(clamped, matrix));
        useAssemblyStore.getState().addTasks(tasks);
        addBatch({
          id: batchId,
          createdAt: now.toISOString(),
          title: card.title,
          summary: {
            mode: "product",
            modelLabel: `拼装口播${assemblySpec.kenburns ? "·运镜" : ""}`,
            aspectRatio: assemblySpec.aspectRatio,
            count: clamped,
            attachmentCount: sceneList.length,
            estimatedCredits: assemblyCreditsPerVideo(sceneList.length) * clamped,
          },
          spec: assemblySpec as unknown as Record<string, unknown>,
          jobRefs: tasks.map((t) => ({ kind: "assembly" as const, taskId: t.id })),
          blueprintId,
        });
        return { ok: true, batchId };
      }

      if (baseSpec?.kind === "ai_gen") {
        // AI 生成腿重跑:台词编辑重新逐镜编译(scene 结构贯穿到生成端)
        const sceneList =
          editedScenes && editedScenes.length > 0 ? editedScenes : baseSpec.scenes;
        if (!sceneList || sceneList.length === 0) {
          return { ok: false, error: "蓝图分镜为空,无法逐镜生成" };
        }
        const clamped = Math.max(1, Math.min(100, Math.floor(count) || 1));
        const batchId = crypto.randomUUID();
        const now = new Date();
        const aiGenSpec: AiGenJobSpec = {
          ...baseSpec,
          scenes: sceneList,
          productTitle: card.title,
          count: clamped,
          batchId,
          groupName: studioGroupName(now),
          blueprintId,
        };
        const tasks = toAiGenTasksWithMatrix(aiGenSpec, buildMatrixPlan(clamped, matrix));
        useAiGenStore.getState().addTasks(tasks);
        addBatch({
          id: batchId,
          createdAt: now.toISOString(),
          title: card.title,
          summary: {
            // 拆解蓝图出片的批次标「结构复刻」,保住 structure_only 溯源链(审查实锤)
            mode: batch.summary.mode === "deconstruct" ? "structure_rerun" : "product",
            modelLabel: `AI 生成·${VIDEO_MODEL_LABELS[aiGenSpec.modelType]}`,
            aspectRatio: aiGenSpec.aspectRatio,
            durationSeconds: aiGenSpec.durationSeconds,
            count: clamped,
            attachmentCount: sceneList.length,
            estimatedCredits:
              getVideoBatchTotalPrice(
                aiGenSpec.modelType,
                aiGenSpec.durationSeconds,
                aiGenSpec.quality ?? "standard"
              ) *
              sceneList.length *
              clamped,
          },
          spec: aiGenSpec as unknown as Record<string, unknown>,
          jobRefs: tasks.map((t) => ({ kind: "ai_gen" as const, taskId: t.id })),
          blueprintId,
        });
        return { ok: true, batchId };
      }

      if (baseSpec?.kind !== "slideshow") {
        return { ok: false, error: "该批次不支持从蓝图重跑" };
      }
      const selected = card.selling_points.filter((p) => p.selected);
      if (selected.length === 0) return { ok: false, error: "至少勾选一个卖点" };
      const clamped = Math.max(1, Math.min(100, Math.floor(count) || 1));
      const imageUrls = card.images.length >= 2 ? card.images : baseSpec.imageUrls;
      if (!imageUrls || imageUrls.length < 2) {
        return { ok: false, error: "轮播成片至少需要 2 张图" };
      }

      const keywords = [card.title, ...selected.map((p) => p.text)].join(";");
      const batchId = crypto.randomUUID();
      const now = new Date();
      // 配方腿重跑:台词编辑经 scriptText 重建生效(否则沿用基础 spec 快照)
      const rerunScript =
        baseSpec.scriptText && editedScenes && editedScenes.length > 0
          ? editedScenes
              .map((s) => s.line.trim())
              .filter(Boolean)
              .map((l) => (/[。!?!?.]$/.test(l) ? l : `${l}。`))
              .join("")
          : baseSpec.scriptText;
      const spec: SlideshowJobSpec = {
        ...baseSpec,
        prompt: keywords,
        scriptText: rerunScript,
        imageUrls,
        count: clamped,
        batchId,
        groupName: studioGroupName(now),
        blueprintId,
      };
      const tasks = toSlideshowTasksWithMatrix(spec, buildMatrixPlan(clamped, matrix));
      useSlideshowStore.getState().addTasks(tasks);

      addBatch({
        id: batchId,
        createdAt: now.toISOString(),
        title: card.title,
        summary: {
          mode: "product",
          modelLabel: batch.summary.modelLabel ?? "商品成片",
          aspectRatio: spec.aspectRatio,
          count: clamped,
          attachmentCount: imageUrls.length,
          estimatedCredits: slideshowCreditsPerVideo(imageUrls.length) * clamped,
        },
        spec: spec as unknown as Record<string, unknown>,
        jobRefs: tasks.map((t) => ({ kind: "slideshow" as const, taskId: t.id })),
        blueprintId,
      });
      return { ok: true, batchId };
    },
    [addBatch]
  );

  /** 单条重试:按批次 spec 重建 1 个任务,替换失败的 jobRef(旧任务留在宿主 store) */
  const retryJob = useCallback(
    (batch: StudioBatch, failedTaskId: string): SubmitResult => {
      const kind = batch.jobRefs.find((r) => r.taskId === failedTaskId)?.kind;
      if (!kind) return { ok: false, error: "任务不在批次内" };

      if (kind === "video") {
        const spec = { ...(batch.spec as unknown as VideoJobSpec), count: 1 };
        const [task] = toVideoBatchTasks(spec);
        useVideoBatchStore.getState().addTasks([task]);
        useVideoBatchStore.getState().startBatch();
        replaceJobRef(batch.id, failedTaskId, { kind, taskId: task.id });
        return { ok: true, batchId: batch.id };
      }
      if (kind === "image") {
        const spec = { ...(batch.spec as unknown as ImageJobSpec), count: 1 };
        const [task] = toQuickGenImageTasks(spec);
        useQuickGenStore.getState().addImageTasks([task]);
        replaceJobRef(batch.id, failedTaskId, { kind, taskId: task.id });
        return { ok: true, batchId: batch.id };
      }
      if (kind === "ai_gen") {
        // 逐镜任务原地重试:只复位失败镜(成功镜已扣费,不重生成),jobRef 不变
        useAiGenStore.getState().retryTask(failedTaskId);
        return { ok: true, batchId: batch.id };
      }
      if (kind === "assembly") {
        // 拼装任务原地重试:只补失败镜(服务端内容寻址幂等,已渲染镜零扣费)
        useAssemblyStore.getState().retryTask(failedTaskId);
        return { ok: true, batchId: batch.id };
      }
      if (kind === "photo_post") {
        // 图文帖原地重试:保留本变体图序,服务端按 task_id 幂等(已落库直接命中);
        // 同批次 250ms 内的多条重试合流为一个 POST(批量重试防撞频控)
        const store = usePhotoPostStore.getState();
        const failedTask = store.tasks.find((t) => t.id === failedTaskId);
        if (failedTask) {
          store.retryTask(failedTaskId);
          queuePhotoPostRetry(
            batch.spec as unknown as PhotoPostJobSpec,
            { ...failedTask, status: "generating" }
          );
          return { ok: true, batchId: batch.id };
        }
        // 兜底(任务已被裁剪):按批次 spec 重建 1 条(重新洗牌图序)
        const spec = { ...(batch.spec as unknown as PhotoPostJobSpec), count: 1 };
        const [task] = toPhotoPostTasks(spec);
        usePhotoPostStore.getState().addTasks([task]);
        runPhotoPostGeneration(spec, [task]);
        replaceJobRef(batch.id, failedTaskId, { kind, taskId: task.id });
        return { ok: true, batchId: batch.id };
      }
      // slideshow:优先克隆失败任务的 renderRequest(保矩阵变体——hook 前缀
      // 关键词/比例/variant 快照;按基础 spec 重建会让重试变回「基础组合」,
      // 变体溯源跑偏还照常扣费,审查 high 实锤),仅换任务 id
      const failedTask = useSlideshowStore.getState().tasks.find((t) => t.id === failedTaskId);
      if (failedTask?.renderRequest) {
        const id = createJobId("slideshow");
        const nowIso = new Date().toISOString();
        useSlideshowStore.getState().addTasks([
          {
            ...failedTask,
            id,
            status: "pending",
            progress: 0,
            outputUrl: undefined,
            outputUrls: undefined,
            thumbnailUrl: undefined,
            errorMessage: undefined,
            renderRequest: { ...failedTask.renderRequest, clientTaskIds: [id] },
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ]);
        replaceJobRef(batch.id, failedTaskId, { kind, taskId: id });
        return { ok: true, batchId: batch.id };
      }
      // 兜底(失败任务已被裁剪):按批次 spec 重建(重新洗牌图序)
      const spec = { ...(batch.spec as unknown as SlideshowJobSpec), count: 1 };
      const [task] = toSlideshowTasks(spec);
      useSlideshowStore.getState().addTasks([task]);
      replaceJobRef(batch.id, failedTaskId, { kind, taskId: task.id });
      return { ok: true, batchId: batch.id };
    },
    [replaceJobRef]
  );

  /** 入库:按 generations.task_id 批量标记 ready,成功后乐观更新本地角标 */
  const markLibrary = useCallback(
    async (batchId: string, views: StudioJobView[]): Promise<SubmitResult> => {
      const candidates = views.filter(
        (v) =>
          v.status === "success" &&
          v.generationTaskId &&
          v.libraryStatus !== "ready" &&
          // published 是直发成功的权威终态,批量入库不得把它降回 ready(审查实锤)
          v.libraryStatus !== "published"
      );
      if (candidates.length === 0) return { ok: false, error: "没有可入库的成片" };

      try {
        const res = await fetch("/api/studio/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskIds: candidates.map((v) => v.generationTaskId),
            libraryStatus: "ready",
          }),
        });
        const result = await res.json();
        if (!result.success) return { ok: false, error: result.error || "入库失败" };

        const updatedSet = new Set<string>(result.data?.taskIds ?? []);
        const localIds = candidates
          .filter((v) => updatedSet.has(v.generationTaskId!))
          .map((v) => v.taskId);
        if (localIds.length > 0) markJobsLibrary(batchId, localIds, "ready");
        if (localIds.length < candidates.length) {
          return {
            ok: true,
            batchId,
            error: `已入库 ${localIds.length}/${candidates.length} 条(其余任务记录未找到)`,
          };
        }
        return { ok: true, batchId };
      } catch {
        return { ok: false, error: "入库请求失败,请重试" };
      }
    },
    [markJobsLibrary]
  );

  return { submit, retryJob, markLibrary, rerunBlueprint };
}
