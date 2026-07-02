/**
 * Batch View - Studio 批次流的跨 store 聚合层(S1)
 *
 * 任务数据留在宿主 store(video-batch / quick-gen / slideshow),
 * 本模块把三种任务形状映射成统一的 StudioJobView 供批次卡渲染;
 * Studio 自己不发任何轮询,状态全部由 BTM 写回宿主 store 驱动。
 */

import { useMemo } from "react";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { useQuickGenStore, type QuickGenImageTask } from "@/stores/quick-gen-store";
import { useSlideshowStore, type SlideshowTask } from "@/stores/slideshow-store";
import { useAiGenStore, type AiGenTask } from "@/stores/ai-gen-store";
import { getStatusLabel, type VideoBatchTask } from "@/types/video-batch";
import type { StudioBatch, StudioJobRef } from "@/stores/studio-store";

// ============================================================================
// 统一 Job 视图
// ============================================================================

/** 全站唯一状态语义:排队灰/进行蓝/成功绿/失败红(+宿主已清理) */
export type StudioJobStatus = "queued" | "running" | "success" | "failed" | "missing";

export interface StudioJobView {
  ref: StudioJobRef;
  kind: StudioJobRef["kind"];
  taskId: string;
  status: StudioJobStatus;
  /** 中文细分状态(生成脚本/轮询中…) */
  statusLabel: string;
  progress: number;
  resultType: "video" | "image";
  resultUrl?: string;
  /** 缩略用:图片=成图;视频=首张素材图 */
  coverUrl?: string;
  errorMessage?: string;
  /** 入库匹配键 = generations.task_id(上游任务 id);任务未提交成功时为空 */
  generationTaskId?: string;
  libraryStatus?: StudioJobRef["libraryStatus"];
  prompt?: string;
}

export interface StudioBatchStats {
  total: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
  missing: number;
}

// ============================================================================
// 各宿主任务 → 统一视图
// ============================================================================

function fromVideoTask(ref: StudioJobRef, task: VideoBatchTask): StudioJobView {
  const status: StudioJobStatus =
    task.status === "pending"
      ? "queued"
      : task.status === "success"
        ? "success"
        : task.status === "failed"
          ? "failed"
          : "running";
  return {
    ref,
    kind: "video",
    taskId: task.id,
    status,
    statusLabel: getStatusLabel(task.status),
    progress: task.progress,
    resultType: "video",
    resultUrl: task.soraVideoUrl ?? undefined,
    coverUrl: task.images[0]?.url,
    errorMessage: task.errorMessage ?? undefined,
    generationTaskId: task.soraTaskId ?? undefined,
    libraryStatus: ref.libraryStatus,
    prompt: task.customPrompt,
  };
}

const IMAGE_STATUS_LABELS: Record<QuickGenImageTask["status"], string> = {
  idle: "排队中",
  uploading: "上传素材",
  generating: "生成中",
  polling: "生成中",
  completed: "已完成",
  failed: "失败",
};

function fromImageTask(ref: StudioJobRef, task: QuickGenImageTask): StudioJobView {
  const status: StudioJobStatus =
    task.status === "idle"
      ? "queued"
      : task.status === "completed"
        ? "success"
        : task.status === "failed"
          ? "failed"
          : "running";
  return {
    ref,
    kind: "image",
    taskId: task.id,
    status,
    statusLabel: IMAGE_STATUS_LABELS[task.status],
    progress: task.progress,
    resultType: "image",
    resultUrl: task.resultUrl,
    coverUrl: task.resultUrl ?? task.sourceImageUrls[0],
    errorMessage: task.errorMessage,
    generationTaskId: task.taskId,
    libraryStatus: ref.libraryStatus,
    prompt: task.prompt,
  };
}

const SLIDESHOW_STATUS_LABELS: Record<SlideshowTask["status"], string> = {
  pending: "排队中",
  uploading: "上传素材",
  generating: "合成中",
  completed: "已完成",
  failed: "失败",
};

function fromSlideshowTask(ref: StudioJobRef, task: SlideshowTask): StudioJobView {
  const status: StudioJobStatus =
    task.status === "pending"
      ? "queued"
      : task.status === "completed"
        ? "success"
        : task.status === "failed"
          ? "failed"
          : "running";
  return {
    ref,
    kind: "slideshow",
    taskId: task.id,
    status,
    statusLabel: SLIDESHOW_STATUS_LABELS[task.status],
    progress: task.progress,
    resultType: "video",
    resultUrl: task.outputUrl,
    coverUrl: task.thumbnailUrl,
    errorMessage: task.errorMessage,
    // 幻灯片腿 generations.task_id = 客户端任务 id(generate-slideshow 落库时写入)
    generationTaskId: task.status === "completed" ? task.id : undefined,
    libraryStatus: ref.libraryStatus,
  };
}

const AI_GEN_STATUS_LABELS: Record<AiGenTask["status"], string> = {
  pending: "排队中",
  generating: "逐镜生成中",
  stitching: "拼接中",
  completed: "已完成",
  failed: "失败",
};

function fromAiGenTask(ref: StudioJobRef, task: AiGenTask): StudioJobView {
  const status: StudioJobStatus =
    task.status === "pending"
      ? "queued"
      : task.status === "completed"
        ? "success"
        : task.status === "failed"
          ? "failed"
          : "running";
  const doneScenes = task.scenes.filter((s) => s.status === "completed").length;
  return {
    ref,
    kind: "ai_gen",
    taskId: task.id,
    status,
    statusLabel:
      task.status === "generating"
        ? `逐镜生成 ${doneScenes}/${task.scenes.length}`
        : AI_GEN_STATUS_LABELS[task.status],
    progress: task.progress,
    resultType: "video",
    resultUrl: task.stitchedUrl ?? undefined,
    coverUrl: task.scenes[0]?.imageUrl,
    errorMessage: task.errorMessage ?? undefined,
    // stitch 落库 generations.task_id = job id
    generationTaskId: task.status === "completed" ? task.id : undefined,
    libraryStatus: ref.libraryStatus,
    prompt: task.title,
  };
}

function missingView(ref: StudioJobRef): StudioJobView {
  return {
    ref,
    kind: ref.kind,
    taskId: ref.taskId,
    status: "missing",
    statusLabel: "记录已清理",
    progress: 0,
    resultType: ref.kind === "image" ? "image" : "video",
    libraryStatus: ref.libraryStatus,
  };
}

// ============================================================================
// Hooks
// ============================================================================

export interface HostTaskMaps {
  videoById: Map<string, VideoBatchTask>;
  imageById: Map<string, QuickGenImageTask>;
  slideshowById: Map<string, SlideshowTask>;
  aiGenById: Map<string, AiGenTask>;
}

/**
 * 宿主 store 的任务索引(页面级调用一次,经 props 下发给各批次卡)。
 * BTM 高频写回进度时只重建这一组 Map,而不是每张卡各建一组。
 */
export function useHostTaskMaps(): HostTaskMaps {
  const videoTasks = useVideoBatchStore((state) => state.tasks);
  const imageTasks = useQuickGenStore((state) => state.imageTasks);
  const slideshowTasks = useSlideshowStore((state) => state.tasks);
  const aiGenTasks = useAiGenStore((state) => state.tasks);

  return useMemo(
    () => ({
      videoById: new Map(videoTasks.map((t) => [t.id, t])),
      imageById: new Map(imageTasks.map((t) => [t.id, t])),
      slideshowById: new Map(slideshowTasks.map((t) => [t.id, t])),
      aiGenById: new Map(aiGenTasks.map((t) => [t.id, t])),
    }),
    [videoTasks, imageTasks, slideshowTasks, aiGenTasks]
  );
}

/** 聚合一个批次的全部 Job 视图(纯函数,配合 useHostTaskMaps 使用) */
export function buildBatchJobViews(batch: StudioBatch, maps: HostTaskMaps): StudioJobView[] {
  return batch.jobRefs.map((ref) => {
    if (ref.kind === "video") {
      const task = maps.videoById.get(ref.taskId);
      return task ? fromVideoTask(ref, task) : missingView(ref);
    }
    if (ref.kind === "image") {
      const task = maps.imageById.get(ref.taskId);
      return task ? fromImageTask(ref, task) : missingView(ref);
    }
    if (ref.kind === "ai_gen") {
      const task = maps.aiGenById.get(ref.taskId);
      return task ? fromAiGenTask(ref, task) : missingView(ref);
    }
    const task = maps.slideshowById.get(ref.taskId);
    return task ? fromSlideshowTask(ref, task) : missingView(ref);
  });
}

export function computeBatchStats(views: StudioJobView[]): StudioBatchStats {
  const stats: StudioBatchStats = {
    total: views.length,
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    missing: 0,
  };
  views.forEach((v) => {
    stats[v.status] += 1;
  });
  return stats;
}
