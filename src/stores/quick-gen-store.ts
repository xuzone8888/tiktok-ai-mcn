/**
 * Quick Generator Store - 快速生成任务状态管理
 * 
 * 用于管理 Quick Generator 中的视频和图片生成任务
 * 支持后台执行和页面切换时任务不中断
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

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
  model: "nano-banana" | "nano-banana-pro";
  tier: "fast" | "pro";
  aspectRatio: string;
  resolution: "1k" | "2k" | "4k";
  sourceImageUrls: string[];
  
  // 任务状态
  status: QuickGenTaskStatus;
  progress: number;
  taskId?: string; // NanoBanana API 任务 ID
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
  // 当前活动的视频任务
  activeVideoTask: QuickGenVideoTask | null;
  
  // 当前活动的图片任务
  activeImageTask: QuickGenImageTask | null;
  
  // 历史任务（最近10个）
  recentTasks: (QuickGenVideoTask | QuickGenImageTask)[];
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
  
  // 清除当前任务
  clearActiveTask: () => void;
  clearActiveImageTask: () => void;
  
  // 清除历史
  clearHistory: () => void;
}

// ============================================================================
// Store 实现
// ============================================================================

const generateId = () => `qg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const initialState: QuickGenState = {
  activeVideoTask: null,
  activeImageTask: null,
  recentTasks: [],
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
            state.activeVideoTask = task;
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
            state.activeImageTask = task;
          });

          return id;
        },

        updateTaskStatus: (taskId, status, extra) => {
          set((state) => {
            if (state.activeVideoTask?.id === taskId) {
              state.activeVideoTask.status = status;
              if (extra?.progress !== undefined) state.activeVideoTask.progress = extra.progress;
              if (extra?.taskId !== undefined) state.activeVideoTask.taskId = extra.taskId;
              if (extra?.resultUrl !== undefined) state.activeVideoTask.resultUrl = extra.resultUrl;
              if (extra?.errorMessage !== undefined) state.activeVideoTask.errorMessage = extra.errorMessage;
              if (extra?.completedAt !== undefined) state.activeVideoTask.completedAt = extra.completedAt;
              if (extra?.creditsDeducted !== undefined) state.activeVideoTask.creditsDeducted = extra.creditsDeducted;

              // 如果任务完成或失败，移到历史记录
              if (status === "completed" || status === "failed") {
                state.recentTasks.unshift({ ...state.activeVideoTask });
                if (state.recentTasks.length > 10) {
                  state.recentTasks = state.recentTasks.slice(0, 10);
                }
              }
            }
          });
        },

        updateImageTaskStatus: (taskId, status, extra) => {
          set((state) => {
            if (state.activeImageTask?.id === taskId) {
              state.activeImageTask.status = status;
              if (extra?.progress !== undefined) state.activeImageTask.progress = extra.progress;
              if (extra?.taskId !== undefined) state.activeImageTask.taskId = extra.taskId;
              if (extra?.resultUrl !== undefined) state.activeImageTask.resultUrl = extra.resultUrl;
              if (extra?.errorMessage !== undefined) state.activeImageTask.errorMessage = extra.errorMessage;
              if (extra?.completedAt !== undefined) state.activeImageTask.completedAt = extra.completedAt;
              if (extra?.creditsDeducted !== undefined) state.activeImageTask.creditsDeducted = extra.creditsDeducted;

              // 如果任务完成或失败，移到历史记录
              if (status === "completed" || status === "failed") {
                state.recentTasks.unshift({ ...state.activeImageTask });
                if (state.recentTasks.length > 10) {
                  state.recentTasks = state.recentTasks.slice(0, 10);
                }
              }
            }
          });
        },

        clearActiveTask: () => {
          set((state) => {
            if (state.activeVideoTask && 
                !["completed", "failed", "idle"].includes(state.activeVideoTask.status)) {
              return;
            }
            state.activeVideoTask = null;
          });
        },

        clearActiveImageTask: () => {
          set((state) => {
            if (state.activeImageTask && 
                !["completed", "failed", "idle"].includes(state.activeImageTask.status)) {
              return;
            }
            state.activeImageTask = null;
          });
        },

        clearHistory: () => {
          set((state) => {
            state.recentTasks = [];
          });
        },
      })),
      { name: "quick-gen-store" }
    ),
    {
      name: "quick-gen-storage",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (state.activeVideoTask && 
              !["completed", "failed", "idle"].includes(state.activeVideoTask.status)) {
            console.log("[QuickGenStore] Rehydrated with active video task:", state.activeVideoTask.id);
          }
          if (state.activeImageTask && 
              !["completed", "failed", "idle"].includes(state.activeImageTask.status)) {
            console.log("[QuickGenStore] Rehydrated with active image task:", state.activeImageTask.id);
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
export const useQuickGenRecentTasks = () => useQuickGenStore((state) => state.recentTasks);
export const useQuickGenIsGenerating = () => useQuickGenStore((state) => 
  state.activeVideoTask !== null && 
  !["completed", "failed", "idle"].includes(state.activeVideoTask.status)
);
export const useQuickGenIsImageGenerating = () => useQuickGenStore((state) => 
  state.activeImageTask !== null && 
  !["completed", "failed", "idle"].includes(state.activeImageTask.status)
);

