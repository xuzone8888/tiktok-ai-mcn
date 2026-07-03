/**
 * Studio Store - Studio 批次流 UI 状态(S1)
 *
 * 裁决约束(STUDIO_REDESIGN_PLAN §五「技术要点」):
 * - 这是唯一新增的 studio-ui store;任务数据留在现有 store
 *   (video-batch / quick-gen / slideshow),本 store 只存批次元数据
 *   与 jobRefs 指针,渲染时经跨 store selector 聚合(见 lib/studio/batch-view.ts)。
 * - 一次提交 = 1 个 Batch = N 个 Job;batchId 随提交透传落 generations.batch_id。
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";

// ============================================================================
// 类型
// ============================================================================

/** Job 引用:指向任务真正所在的 store */
export type StudioJobKind = "video" | "image" | "slideshow" | "ai_gen" | "assembly";

export interface StudioJobRef {
  kind: StudioJobKind;
  /** 任务在宿主 store 里的 id(vbt-* / qg-* / 幻灯片任务 id) */
  taskId: string;
  /** 已入库标记(乐观 UI;权威在 generations.library_status) */
  libraryStatus?: "draft" | "ready" | "published";
}

/** 批次卡头回显用的参数快照(展示层;重跑用 spec) */
export interface StudioBatchSummary {
  mode: string;              // omnibox 模式标识(image/video/slideshow/product)
  modelLabel?: string;       // 模型显示名
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  count: number;
  characterName?: string;
  attachmentCount?: number;
  estimatedCredits?: number;
}

export interface StudioBatch {
  /** UUID,与 generations.batch_id 对应 */
  id: string;
  createdAt: string;
  /** 卡头标题:prompt 摘要或商品标题 */
  title: string;
  summary: StudioBatchSummary;
  /**
   * 重跑用规格快照(JobSpec 或幻灯片规格的 JSON 序列化对象)。
   * 不用具体类型以免 store 与 lib 相互依赖加深;消费方自行断言。
   */
  spec: Record<string, unknown>;
  jobRefs: StudioJobRef[];
  /** 商品图腿:蓝图 id(S1.3) */
  blueprintId?: string;
  /** @角色快照(卡头回显) */
  character?: Pick<CharacterAssetSnapshot, "id" | "name" | "avatar_url">;
  /**
   * 门B 拆解在途标记(S3.3):提交即插乐观卡,后台 fetch/刷新恢复由
   * reconciler 按 videoUrl 对账(GET /api/studio/deconstruct);
   * 解析成功(拿到 blueprintId)后清空。failedAt 非空 = 对账判死,可移除重试。
   */
  deconstructPending?: { videoUrl: string; failedAt?: string } | null;
}

export interface StudioState {
  batches: StudioBatch[];
  /** 右栏抽屉当前查看的 Job(不持久化) */
  activeJob: { batchId: string; taskId: string } | null;
  /** 右栏蓝图编辑器当前批次(S2.2;与 activeJob 互斥,不持久化) */
  activeBlueprintBatchId: string | null;
}

export interface StudioActions {
  addBatch: (batch: StudioBatch) => void;
  removeBatch: (batchId: string) => void;
  /** 批次元数据补写(拆解卡从「拆解中」置为已解析/失败;只合并给定键) */
  updateBatchMeta: (
    batchId: string,
    patch: Partial<
      Pick<StudioBatch, "title" | "summary" | "spec" | "blueprintId" | "deconstructPending">
    >
  ) => void;
  /** 单条重试后替换 jobRef(旧任务 id → 新任务 id) */
  replaceJobRef: (batchId: string, oldTaskId: string, newRef: StudioJobRef) => void;
  /** 入库成功后标记(乐观 UI) */
  markJobsLibrary: (
    batchId: string,
    taskIds: string[],
    libraryStatus: NonNullable<StudioJobRef["libraryStatus"]>
  ) => void;
  setActiveJob: (job: StudioState["activeJob"]) => void;
  setActiveBlueprintBatch: (batchId: string | null) => void;
}

// ============================================================================
// Store
// ============================================================================

/** 批次上限:超过时裁掉最旧的批次(任务数据仍在宿主 store,自行按其规则清理) */
const MAX_BATCHES = 50;

const initialState: StudioState = {
  batches: [],
  activeJob: null,
  activeBlueprintBatchId: null,
};

export const useStudioStore = create<StudioState & StudioActions>()(
  persist(
    devtools(
      immer((set) => ({
        ...initialState,

        addBatch: (batch) => {
          set((state) => {
            // 新批次置顶(批次流最新在上)
            state.batches.unshift(batch);
            if (state.batches.length > MAX_BATCHES) {
              state.batches.length = MAX_BATCHES;
            }
          });
        },

        updateBatchMeta: (batchId, patch) => {
          set((state) => {
            const batch = state.batches.find((b) => b.id === batchId);
            if (!batch) return;
            if (patch.title !== undefined) batch.title = patch.title;
            if (patch.summary !== undefined) batch.summary = patch.summary;
            if (patch.spec !== undefined) batch.spec = patch.spec;
            if (patch.blueprintId !== undefined) batch.blueprintId = patch.blueprintId;
            if (patch.deconstructPending !== undefined) {
              batch.deconstructPending = patch.deconstructPending;
            }
          });
        },

        removeBatch: (batchId) => {
          set((state) => {
            const idx = state.batches.findIndex((b) => b.id === batchId);
            if (idx !== -1) state.batches.splice(idx, 1);
            if (state.activeJob?.batchId === batchId) state.activeJob = null;
            if (state.activeBlueprintBatchId === batchId) state.activeBlueprintBatchId = null;
          });
        },

        replaceJobRef: (batchId, oldTaskId, newRef) => {
          set((state) => {
            const batch = state.batches.find((b) => b.id === batchId);
            if (!batch) return;
            const idx = batch.jobRefs.findIndex((r) => r.taskId === oldTaskId);
            if (idx !== -1) batch.jobRefs[idx] = newRef;
          });
        },

        markJobsLibrary: (batchId, taskIds, libraryStatus) => {
          set((state) => {
            const batch = state.batches.find((b) => b.id === batchId);
            if (!batch) return;
            const idSet = new Set(taskIds);
            batch.jobRefs.forEach((ref) => {
              if (idSet.has(ref.taskId)) ref.libraryStatus = libraryStatus;
            });
          });
        },

        setActiveJob: (job) => {
          set((state) => {
            state.activeJob = job;
            if (job) state.activeBlueprintBatchId = null; // 右栏互斥
          });
        },

        setActiveBlueprintBatch: (batchId) => {
          set((state) => {
            state.activeBlueprintBatchId = batchId;
            if (batchId) state.activeJob = null; // 右栏互斥
          });
        },
      })),
      { name: "studio-store" }
    ),
    {
      name: "studio-storage",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ batches: state.batches }),
    }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useStudioBatches = () => useStudioStore((state) => state.batches);
export const useStudioActiveJob = () => useStudioStore((state) => state.activeJob);
