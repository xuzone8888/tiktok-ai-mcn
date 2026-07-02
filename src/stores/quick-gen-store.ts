/**
 * Quick Generator Store - 快速生成任务状态管理
 *
 * 用于管理 Quick Generator 中的视频和图片生成任务
 * 支持后台执行和页面切换时任务不中断
 *
 * S0.6：单任务槽 → 多任务队列
 * - videoTasks / imageTasks 为任务事实来源（source of truth），支持并发多任务
 * - activeVideoTask / activeImageTask 保留为"兼容镜像"，指向当前关注的任务
 *   （默认为最新创建的任务），旧页面无需改动即可继续工作
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { ImageModel } from "@/types/generation";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";

// ============================================================================
// 类型定义
// ============================================================================

export type QuickGenTaskStatus = "idle" | "uploading" | "generating" | "polling" | "completed" | "failed";

export interface QuickGenVideoTask {
  id: string;
  prompt: string;
  model: string;
  aspectRatio: "9:16" | "16:9";
  quality: "standard" | "hd";
  apiModel: string;
  duration: number;
  sourceImageUrl?: string;
  modelId?: string; // AI 模特 ID
  characterAsset?: CharacterAssetSnapshot;

  // 任务状态
  status: QuickGenTaskStatus;
  progress: number;
  taskId?: string; // Sora API 任务 ID
  resultUrl?: string;
  errorMessage?: string;

  // 时间戳
  createdAt: string;
  completedAt?: string;

  // 积分
  creditCost: number;
  creditsDeducted: boolean;
}

export interface QuickGenImageTask {
  id: string;
  prompt: string;
  model: ImageModel;
  action?: "generate" | "upscale" | "nine_grid";
  tier: "fast" | "pro" | "1k" | "2k" | "4k";  // 新增分辨率 tier
  aspectRatio: string;
  resolution: "1k" | "2k" | "4k";
  sourceImageUrls: string[];
  characterAsset?: CharacterAssetSnapshot;

  // 任务状态
  status: QuickGenTaskStatus;
  progress: number;
  taskId?: string; // 图片生成任务 ID
  resultUrl?: string;
  errorMessage?: string;

  // 时间戳
  createdAt: string;
  completedAt?: string;

  // 积分
  creditCost: number;
  creditsDeducted: boolean;
}

export interface QuickGenState {
  // 多任务队列（S0.6 新增）：所有已创建、进行中或待页面消费的任务
  videoTasks: QuickGenVideoTask[];
  imageTasks: QuickGenImageTask[];

  // 兼容镜像：当前关注的视频任务（默认为最新创建的任务，随任务更新同步）
  activeVideoTask: QuickGenVideoTask | null;

  // 兼容镜像：当前关注的图片任务
  activeImageTask: QuickGenImageTask | null;

  // 历史任务（最近10个）
  recentTasks: (QuickGenVideoTask | QuickGenImageTask)[];

  // 九宫格处理结果（用于页面返回时恢复）
  processedGridImages: string[];
  selectedGridIndex: number;
}

export interface QuickGenActions {
  // 创建视频任务
  createVideoTask: (task: Omit<QuickGenVideoTask, "id" | "status" | "progress" | "createdAt" | "creditsDeducted">) => string;

  // 创建图片任务
  createImageTask: (task: Omit<QuickGenImageTask, "id" | "status" | "progress" | "createdAt" | "creditsDeducted">) => string;

  // 更新视频任务状态
  updateTaskStatus: (
    taskId: string,
    status: QuickGenTaskStatus,
    extra?: Partial<Pick<QuickGenVideoTask, "progress" | "taskId" | "resultUrl" | "errorMessage" | "completedAt" | "creditsDeducted">>
  ) => void;

  // 更新图片任务状态
  updateImageTaskStatus: (
    taskId: string,
    status: QuickGenTaskStatus,
    extra?: Partial<Pick<QuickGenImageTask, "progress" | "taskId" | "resultUrl" | "errorMessage" | "completedAt" | "creditsDeducted">>
  ) => void;

  // 清除当前任务（终态任务出队，镜像重指向队列中最新的剩余任务）
  clearActiveTask: () => void;
  clearActiveImageTask: () => void;

  // 清除历史
  clearHistory: () => void;

  // 九宫格处理结果
  setProcessedGridImages: (images: string[]) => void;
  setSelectedGridIndex: (index: number) => void;
  clearProcessedGridImages: () => void;
}

// ============================================================================
// 内部工具
// ============================================================================

const generateId = () => `qg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** 终态：任务已结束，可以被清理 */
const isTerminalStatus = (status: QuickGenTaskStatus) =>
  status === "completed" || status === "failed";

/** 可清除状态：与旧版 clearActiveTask 的守卫语义一致（进行中不可清除） */
const isClearableStatus = (status: QuickGenTaskStatus) =>
  status === "completed" || status === "failed" || status === "idle";

/** 运行中：进入执行链路且未到终态 */
const isRunningStatus = (status: QuickGenTaskStatus) =>
  !["completed", "failed", "idle"].includes(status);

/** 队列上限：超出时只清理最早的终态任务，绝不丢弃进行中的任务 */
const MAX_TRACKED_TASKS = 20;

type QuickGenTaskUpdate = Partial<
  Pick<QuickGenVideoTask, "progress" | "taskId" | "resultUrl" | "errorMessage" | "completedAt" | "creditsDeducted">
>;

function applyTaskUpdate(
  task: QuickGenVideoTask | QuickGenImageTask,
  status: QuickGenTaskStatus,
  extra?: QuickGenTaskUpdate
) {
  task.status = status;
  if (extra?.progress !== undefined) task.progress = extra.progress;
  if (extra?.taskId !== undefined) task.taskId = extra.taskId;
  if (extra?.resultUrl !== undefined) task.resultUrl = extra.resultUrl;
  if (extra?.errorMessage !== undefined) task.errorMessage = extra.errorMessage;
  if (extra?.completedAt !== undefined) task.completedAt = extra.completedAt;
  if (extra?.creditsDeducted !== undefined) task.creditsDeducted = extra.creditsDeducted;
}

function pruneFinishedTasks<T extends { status: QuickGenTaskStatus }>(tasks: T[]) {
  while (tasks.length > MAX_TRACKED_TASKS) {
    const idx = tasks.findIndex((t) => isTerminalStatus(t.status));
    if (idx === -1) break; // 全部在进行中，不丢任务
    tasks.splice(idx, 1);
  }
}

// ============================================================================
// Store 实现
// ============================================================================

const initialState: QuickGenState = {
  videoTasks: [],
  imageTasks: [],
  activeVideoTask: null,
  activeImageTask: null,
  recentTasks: [],
  processedGridImages: [],
  selectedGridIndex: 0,
};

export const useQuickGenStore = create<QuickGenState & QuickGenActions>()(
  persist(
    devtools(
      immer((set) => ({
        ...initialState,

        createVideoTask: (taskData) => {
          const id = generateId();
          const task: QuickGenVideoTask = {
            ...taskData,
            id,
            status: "idle",
            progress: 0,
            createdAt: new Date().toISOString(),
            creditsDeducted: false,
          };

          set((state) => {
            state.videoTasks.push(task);
            pruneFinishedTasks(state.videoTasks);
            // 兼容镜像指向最新任务
            state.activeVideoTask = { ...task };
          });

          return id;
        },

        createImageTask: (taskData) => {
          const id = generateId();
          const task: QuickGenImageTask = {
            ...taskData,
            id,
            status: "idle",
            progress: 0,
            createdAt: new Date().toISOString(),
            creditsDeducted: false,
          };

          set((state) => {
            state.imageTasks.push(task);
            pruneFinishedTasks(state.imageTasks);
            // 兼容镜像指向最新任务
            state.activeImageTask = { ...task };
          });

          return id;
        },

        updateTaskStatus: (taskId, status, extra) => {
          set((state) => {
            const task = state.videoTasks.find((t) => t.id === taskId);
            const mirrorMatches = state.activeVideoTask?.id === taskId;
            const current = task ?? (mirrorMatches ? state.activeVideoTask : null);

            // 终态不可降级守卫：completed/failed 后到达的异状态更新一律忽略
            // （多任务并发下，轮询链路的迟到写入会把已完成任务拖回进行中）
            const wasTerminal = current ? isTerminalStatus(current.status) : false;
            if (current && wasTerminal && current.status !== status) {
              return;
            }

            if (task) {
              applyTaskUpdate(task, status, extra);
            }

            // 同步兼容镜像（若指向该任务）
            if (mirrorMatches && state.activeVideoTask) {
              applyTaskUpdate(state.activeVideoTask, status, extra);
            }

            // 首次到达终态时追加历史记录（重复终态写入只合并字段，不重复追加）
            if (!wasTerminal && (status === "completed" || status === "failed")) {
              const source = task ?? (mirrorMatches ? state.activeVideoTask : null);
              if (source) {
                state.recentTasks.unshift({ ...source });
                if (state.recentTasks.length > 10) {
                  state.recentTasks = state.recentTasks.slice(0, 10);
                }
              }
            }
          });
        },

        updateImageTaskStatus: (taskId, status, extra) => {
          set((state) => {
            const task = state.imageTasks.find((t) => t.id === taskId);
            const mirrorMatches = state.activeImageTask?.id === taskId;
            const current = task ?? (mirrorMatches ? state.activeImageTask : null);

            // 终态不可降级守卫：completed/failed 后到达的异状态更新一律忽略
            const wasTerminal = current ? isTerminalStatus(current.status) : false;
            if (current && wasTerminal && current.status !== status) {
              return;
            }

            if (task) {
              applyTaskUpdate(task, status, extra);
            }

            // 同步兼容镜像（若指向该任务）
            if (mirrorMatches && state.activeImageTask) {
              applyTaskUpdate(state.activeImageTask, status, extra);
            }

            // 首次到达终态时追加历史记录（重复终态写入只合并字段，不重复追加）
            if (!wasTerminal && (status === "completed" || status === "failed")) {
              const source = task ?? (mirrorMatches ? state.activeImageTask : null);
              if (source) {
                state.recentTasks.unshift({ ...source });
                if (state.recentTasks.length > 10) {
                  state.recentTasks = state.recentTasks.slice(0, 10);
                }
              }
            }
          });
        },

        clearActiveTask: () => {
          set((state) => {
            const active = state.activeVideoTask;
            // 与旧行为一致：进行中的任务不允许清除
            if (active && !isClearableStatus(active.status)) {
              return;
            }
            if (active) {
              const idx = state.videoTasks.findIndex((t) => t.id === active.id);
              if (idx !== -1) state.videoTasks.splice(idx, 1);
            }
            // 镜像重指向：让旧页面逐个消费队列中剩余任务（含已完成待展示的）
            const next = state.videoTasks[state.videoTasks.length - 1];
            state.activeVideoTask = next ? { ...next } : null;
          });
        },

        clearActiveImageTask: () => {
          set((state) => {
            const active = state.activeImageTask;
            // 与旧行为一致：进行中的任务不允许清除
            if (active && !isClearableStatus(active.status)) {
              return;
            }
            if (active) {
              const idx = state.imageTasks.findIndex((t) => t.id === active.id);
              if (idx !== -1) state.imageTasks.splice(idx, 1);
            }
            // 镜像重指向：让旧页面逐个消费队列中剩余任务（含已完成待展示的）
            const next = state.imageTasks[state.imageTasks.length - 1];
            state.activeImageTask = next ? { ...next } : null;
          });
        },

        clearHistory: () => {
          set((state) => {
            state.recentTasks = [];
          });
        },

        setProcessedGridImages: (images) => {
          set((state) => {
            state.processedGridImages = images;
          });
        },

        setSelectedGridIndex: (index) => {
          set((state) => {
            state.selectedGridIndex = index;
          });
        },

        clearProcessedGridImages: () => {
          set((state) => {
            state.processedGridImages = [];
            state.selectedGridIndex = 0;
          });
        },
      })),
      { name: "quick-gen-store" }
    ),
    {
      name: "quick-gen-storage",
      // v1（S0.6）：单任务槽 → 多任务队列
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<QuickGenState>;

        if (version < 1) {
          // 旧形状（v0）：只有 activeVideoTask / activeImageTask 单槽。
          // 平滑迁移：把单槽任务装进多任务队列，镜像字段原样保留。
          const videoTasks = Array.isArray(state.videoTasks)
            ? state.videoTasks
            : state.activeVideoTask
              ? [state.activeVideoTask]
              : [];
          const imageTasks = Array.isArray(state.imageTasks)
            ? state.imageTasks
            : state.activeImageTask
              ? [state.activeImageTask]
              : [];

          return {
            ...state,
            videoTasks,
            imageTasks,
          } as QuickGenState & QuickGenActions;
        }

        return state as QuickGenState & QuickGenActions;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 防御：极端情况下（storage 被手工改动）保证数组字段存在
          if (!Array.isArray(state.videoTasks) || !Array.isArray(state.imageTasks)) {
            useQuickGenStore.setState({
              videoTasks: Array.isArray(state.videoTasks)
                ? state.videoTasks
                : state.activeVideoTask
                  ? [state.activeVideoTask]
                  : [],
              imageTasks: Array.isArray(state.imageTasks)
                ? state.imageTasks
                : state.activeImageTask
                  ? [state.activeImageTask]
                  : [],
            });
          }

          const runningVideo = (state.videoTasks ?? []).filter((t) => isRunningStatus(t.status));
          const runningImage = (state.imageTasks ?? []).filter((t) => isRunningStatus(t.status));
          if (runningVideo.length > 0) {
            console.log("[QuickGenStore] Rehydrated with active video tasks:", runningVideo.map((t) => t.id));
          }
          if (runningImage.length > 0) {
            console.log("[QuickGenStore] Rehydrated with active image tasks:", runningImage.map((t) => t.id));
          }
        }
      },
    }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useQuickGenActiveTask = () => useQuickGenStore((state) => state.activeVideoTask);
export const useQuickGenActiveImageTask = () => useQuickGenStore((state) => state.activeImageTask);
export const useQuickGenVideoTasks = () => useQuickGenStore((state) => state.videoTasks);
export const useQuickGenImageTasks = () => useQuickGenStore((state) => state.imageTasks);
export const useQuickGenRecentTasks = () => useQuickGenStore((state) => state.recentTasks);
export const useQuickGenIsGenerating = () => useQuickGenStore((state) =>
  state.videoTasks.some((t) => isRunningStatus(t.status)) ||
  (state.activeVideoTask !== null && isRunningStatus(state.activeVideoTask.status))
);
export const useQuickGenIsImageGenerating = () => useQuickGenStore((state) =>
  state.imageTasks.some((t) => isRunningStatus(t.status)) ||
  (state.activeImageTask !== null && isRunningStatus(state.activeImageTask.status))
);
export const useQuickGenProcessedGridImages = () => useQuickGenStore((state) => state.processedGridImages);
export const useQuickGenSelectedGridIndex = () => useQuickGenStore((state) => state.selectedGridIndex);
