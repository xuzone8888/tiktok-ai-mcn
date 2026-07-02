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
  toQuickGenImageTasks,
  toVideoBatchTasks,
  type ImageJobSpec,
  type VideoJobSpec,
} from "@/lib/studio/job-spec";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { useQuickGenStore } from "@/stores/quick-gen-store";
import { useStudioStore, type StudioBatch, type StudioJobRef } from "@/stores/studio-store";
import type { StudioJobView } from "@/lib/studio/batch-view";
import { getVideoBatchTotalPrice, type VideoAspectRatio, type VideoDuration, type VideoModelType, type VideoQuality } from "@/types/video-batch";
import { getNewImageCost } from "@/lib/credits";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";

// ============================================================================
// Draft 类型(omnibox 唯一真值:模式切换器 + 参数 chips + 附件 + @角色)
// ============================================================================

export type StudioMode = "image" | "video";

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

export interface StudioDraft {
  mode: StudioMode;
  text: string;
  /** 已上传完成的附件(OSS URL) */
  attachmentUrls: string[];
  character?: CharacterAssetSnapshot;
  video: VideoParams;
  image: ImageParams;
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
  return getNewImageCost("gpt-image-2", draft.image.resolution) * draft.count;
}

export function validateDraft(draft: StudioDraft): string | null {
  if (draft.mode === "video") {
    if (!draft.text.trim() && draft.attachmentUrls.length === 0) {
      return "视频任务需要提示词或至少一张素材图";
    }
  } else {
    if (!draft.text.trim()) return "图片任务需要提示词";
  }
  if (draft.count < 1 || draft.count > 100) return "数量需在 1-100 之间";
  return null;
}

function batchTitle(draft: StudioDraft): string {
  const text = draft.text.trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return draft.mode === "video" ? "图生视频批次" : "图片批次";
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
    (draft: StudioDraft): SubmitResult => {
      const invalid = validateDraft(draft);
      if (invalid) return { ok: false, error: invalid };

      const batchId = crypto.randomUUID();
      const now = new Date();
      const groupName = studioGroupName(now);
      let jobRefs: StudioJobRef[];
      let spec: Record<string, unknown>;

      if (draft.mode === "video") {
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
            draft.mode === "video" ? VIDEO_MODEL_LABELS[draft.video.modelType] : "GPT Image 2",
          aspectRatio: draft.mode === "video" ? draft.video.aspectRatio : draft.image.aspectRatio,
          durationSeconds: draft.mode === "video" ? draft.video.durationSeconds : undefined,
          resolution: draft.mode === "image" ? draft.image.resolution : undefined,
          count: draft.count,
          characterName: draft.character?.name,
          attachmentCount: draft.attachmentUrls.length,
          estimatedCredits: estimateCredits(draft),
        },
        spec,
        jobRefs,
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
      // slideshow 重试在 S1.2 接入
      return { ok: false, error: "该任务类型暂不支持重试" };
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

  return { submit, retryJob, markLibrary };
}
