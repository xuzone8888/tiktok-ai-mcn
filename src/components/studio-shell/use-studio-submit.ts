"use client";

/**
 * Studio 提交编译层(S1)
 *
 * omnibox 产出的 Draft → JobSpec → 适配器 → 宿主 store → BTM 自动执行。
 * 乐观 UI:提交即插批次卡(任务 id 幂等由适配器 createJobId 保证);
 * Studio 不发任何轮询,状态由 BTM 写回宿主 store 驱动(裁决,PLAN §五)。
 */

import { useCallback } from "react";
import {
  toAiGenTasks,
  toQuickGenImageTasks,
  toSlideshowTasks,
  toVideoBatchTasks,
  type AiGenJobSpec,
  type AiGenSceneSpec,
  type ImageJobSpec,
  type SlideshowJobSpec,
  type VideoJobSpec,
} from "@/lib/studio/job-spec";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { useQuickGenStore } from "@/stores/quick-gen-store";
import { useSlideshowStore } from "@/stores/slideshow-store";
import { useAiGenStore } from "@/stores/ai-gen-store";
import { useStudioStore, type StudioBatch, type StudioJobRef } from "@/stores/studio-store";
import type { StudioJobView } from "@/lib/studio/batch-view";
import { getVideoBatchTotalPrice, type VideoAspectRatio, type VideoDuration, type VideoModelType, type VideoQuality } from "@/types/video-batch";
import { getNewImageCost } from "@/lib/credits";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";
import type { ProductCard } from "@/lib/studio/product-vision";

// ============================================================================
// Draft 类型(omnibox 唯一真值:模式切换器 + 参数 chips + 附件 + @角色)
// ============================================================================

export type StudioMode = "image" | "video" | "slideshow" | "product";

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
  /** 商品成片渲染腿(S2.3):幻灯片(默认,≈分级积分)或 AI 逐镜生成(video 参数计价) */
  productRenderMode?: "slideshow" | "ai_gen";
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

/** 预估积分(展示用;权威扣退在服务端网关) */
export function estimateCredits(draft: StudioDraft): number {
  if (draft.mode === "video") {
    return (
      getVideoBatchTotalPrice(
        draft.video.modelType,
        draft.video.durationSeconds,
        draft.video.quality
      ) * draft.count
    );
  }
  if (draft.mode === "product" && draft.productRenderMode === "ai_gen") {
    // AI 生成腿:每图一镜逐镜计价(拼接不新增扣费)
    return (
      getVideoBatchTotalPrice(
        draft.video.modelType,
        draft.video.durationSeconds,
        draft.video.quality
      ) *
      Math.max(draft.attachmentUrls.length, 1) *
      draft.count
    );
  }
  if (draft.mode === "slideshow" || draft.mode === "product") {
    return slideshowCreditsPerVideo(draft.attachmentUrls.length) * draft.count;
  }
  return getNewImageCost("gpt-image-2", draft.image.resolution) * draft.count;
}

export function validateDraft(draft: StudioDraft): string | null {
  if (draft.mode === "video") {
    if (!draft.text.trim() && draft.attachmentUrls.length === 0) {
      return "视频任务需要提示词或至少一张素材图";
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
  return null;
}

function batchTitle(draft: StudioDraft): string {
  if (draft.mode === "product" && draft.productCard) return draft.productCard.title;
  const text = draft.text.trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  if (draft.mode === "video") return "图生视频批次";
  if (draft.mode === "slideshow") return "轮播成片批次";
  if (draft.mode === "product") return "商品成片批次";
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

export function useStudioSubmit() {
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

      if (draft.mode === "product") {
        // 商品图/链接腿:商品卡 → 蓝图落库 → 渲染腿出 N 条(幻灯片 | AI 逐镜生成)
        const card = draft.productCard!;
        const renderMode = draft.productRenderMode === "ai_gen" ? "ai_gen" : "slideshow";
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
                  : {
                      aspect: draft.slideshow.aspectRatio,
                      duration_per_image_ms: Math.round(draft.slideshow.durationPerImage * 1000),
                      bgm_style: draft.slideshow.bgmEnabled ? "random" : "none",
                    },
              renderMode,
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
                imageUrl:
                  ((s.slot as { asset_ref?: string } | undefined)?.asset_ref as string) ??
                  undefined,
              }))
            : [];
        } catch {
          return { ok: false, error: "蓝图保存失败,请重试" };
        }

        if (renderMode === "ai_gen") {
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
          // 每条成片生成不同角度口播;图序差异由适配器洗牌提供(素材级)
          const selectedPoints = card.selling_points.filter((p) => p.selected);
          const keywords = [card.title, ...selectedPoints.map((p) => p.text)].join(";");
          const slideshowSpec: SlideshowJobSpec = {
            kind: "slideshow",
            prompt: keywords,
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
                    : `商品成片${draft.slideshow.kenburns ? "·运镜" : ""}`
                  : "GPT Image 2",
          aspectRatio:
            draft.mode === "video"
              ? draft.video.aspectRatio
              : draft.mode === "product" && draft.productRenderMode === "ai_gen"
                ? draft.video.aspectRatio
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
    [addBatch]
  );

  /**
   * 从(编辑后的)蓝图再出一批(S2.2):渲染参数沿用原批次 spec 快照,
   * 标题+勾选卖点重建文案关键词,产出新 Batch(同 blueprintId,新 batchId)。
   * 台词行不进幻灯片腿(口播由服务端按关键词 diverse 生成),将用于 AI 生成腿。
   */
  const rerunBlueprint = useCallback(
    (
      batch: StudioBatch,
      card: ProductCard,
      blueprintId: string,
      count: number,
      /** 编辑后的分镜(AI 生成腿重跑时台词改动经此生效;幻灯片腿忽略) */
      editedScenes?: AiGenSceneSpec[]
    ): SubmitResult => {
      const baseSpec = batch.spec as unknown as SlideshowJobSpec | AiGenJobSpec;

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
        const tasks = toAiGenTasks(aiGenSpec);
        useAiGenStore.getState().addTasks(tasks);
        addBatch({
          id: batchId,
          createdAt: now.toISOString(),
          title: card.title,
          summary: {
            mode: "product",
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
      const spec: SlideshowJobSpec = {
        ...baseSpec,
        prompt: keywords,
        imageUrls,
        count: clamped,
        batchId,
        groupName: studioGroupName(now),
        blueprintId,
      };
      const tasks = toSlideshowTasks(spec);
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
      // slideshow:按批次 spec 重建(重新洗牌图序,变体差异保持)
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
        (v) => v.status === "success" && v.generationTaskId && v.libraryStatus !== "ready"
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
