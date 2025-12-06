/**
 * Image Batch Store - 图片批量处理状态管理
 * 
 * 专门用于图片批量处理单元的 Zustand Store
 * 
 * 特性：
 * - 使用 persist 中间件持久化任务状态到 localStorage
 * - 页面切换时任务不会丢失
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  type ImageAspectRatio,
  type ImageResolution,
  type ImageProcessAction,
  type ImageBatchTask,
  type ImageBatchTaskConfig,
  NANO_FAST_ACTION_PRICING,
  NANO_PRO_ACTION_PRICING,
} from "@/types/generation";

// ============================================================================
// 类型定义
// ============================================================================

export type ImageBatchTaskStatus = "pending" | "processing" | "completed" | "failed";
export type ImageBatchJobStatus = "idle" | "running" | "paused" | "completed" | "cancelled";
export type ImageModelType = "nano-banana" | "nano-banana-pro";

export interface ImageBatchGlobalSettings {
  model: ImageModelType;
  action: ImageProcessAction;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution; // 仅 Pro 模式生效
  prompt: string; // 全局提示词
}

export interface ImageBatchState {
  // 任务列表
  tasks: ImageBatchTask[];
  
  // 批量作业状态
  jobStatus: ImageBatchJobStatus;
  
  // 全局设置 (用于批量添加时的默认配置)
  globalSettings: ImageBatchGlobalSettings;
  
  // 选中的任务 ID
  selectedTaskIds: Record<string, boolean>;
  
  // 并发控制
  maxConcurrent: number;
  processingCount: number;
}

// ============================================================================
// Actions 接口
// ============================================================================

export interface ImageBatchActions {
  // ==================== 任务管理 ====================
  
  /** 从文件批量添加任务 */
  addTasksFromFiles: (files: File[]) => Promise<string[]>;
  
  /** 更新任务配置 */
  updateTaskConfig: <K extends keyof ImageBatchTaskConfig>(
    id: string,
    key: K,
    value: ImageBatchTaskConfig[K]
  ) => void;
  
  /** 更新任务状态 */
  updateTaskStatus: (
    id: string,
    status: ImageBatchTaskStatus,
    extra?: Partial<Pick<ImageBatchTask, "apiTaskId" | "resultUrl" | "error" | "progress" | "startedAt" | "completedAt">>
  ) => void;
  
  /** 更新任务结果 (简化的状态更新) */
  updateTaskResult: (
    id: string,
    update: Partial<Pick<ImageBatchTask, "status" | "resultUrl" | "error" | "apiTaskId">>
  ) => void;
  
  /** 设置作业状态 */
  setJobStatus: (status: ImageBatchJobStatus) => void;
  
  /** 删除任务 */
  removeTask: (id: string) => void;
  
  /** 批量删除任务 */
  removeTasks: (ids: string[]) => void;
  
  /** 清空所有任务 */
  clearAllTasks: () => void;
  
  // ==================== 选择管理 ====================
  
  /** 切换任务选中状态 */
  toggleTaskSelection: (id: string) => void;
  
  /** 全选/取消全选 */
  selectAllTasks: (selected: boolean) => void;
  
  /** 清空选择 */
  clearSelection: () => void;
  
  /** 删除选中的任务 */
  removeSelectedTasks: () => void;
  
  // ==================== 批量作业控制 ====================
  
  /** 开始批量处理 */
  startBatch: () => void;
  
  /** 开始单个任务 */
  startSingleTask: (id: string) => void;
  
  /** 暂停批量处理 */
  pauseBatch: () => void;
  
  /** 继续批量处理 */
  resumeBatch: () => void;
  
  /** 取消批量处理 */
  cancelBatch: () => void;
  
  /** 重置批量作业 */
  resetBatch: () => void;
  
  /** 增加处理中计数 */
  incrementProcessing: () => void;
  
  /** 减少处理中计数 */
  decrementProcessing: () => void;
  
  // ==================== 全局设置 ====================
  
  /** 更新全局设置 */
  updateGlobalSettings: <K extends keyof ImageBatchGlobalSettings>(
    key: K,
    value: ImageBatchGlobalSettings[K]
  ) => void;
  
  /** 应用全局设置到所有待处理任务 */
  applyGlobalSettingsToAllPending: () => void;
}

// ============================================================================
// 工具函数
// ============================================================================

const generateId = () => `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * 计算单个任务的积分消耗
 */
export const getImageTaskCost = (config: ImageBatchTaskConfig): number => {
  const { model, action, resolution = "1k" } = config;
  
  if (model === "nano-banana") {
    // 快速模式
    return NANO_FAST_ACTION_PRICING[action]?.credits || 10;
  } else {
    // Pro 模式
    const actionConfig = NANO_PRO_ACTION_PRICING[action as "generate" | "nine_grid"];
    if (actionConfig?.resolutionPricing) {
      return actionConfig.resolutionPricing[resolution] || actionConfig.credits;
    }
    return actionConfig?.credits || 28;
  }
};

/**
 * 计算所有任务的总积分消耗
 */
export const getImageTotalCost = (tasks: ImageBatchTask[]): number => {
  return tasks.reduce((sum, task) => sum + getImageTaskCost(task.config), 0);
};

/**
 * 获取动作的提示词
 */
export const getActionPromptHint = (model: ImageModelType, action: ImageProcessAction): string => {
  if (model === "nano-banana") {
    return NANO_FAST_ACTION_PRICING[action]?.promptHint || "";
  } else {
    return NANO_PRO_ACTION_PRICING[action as "generate" | "nine_grid"]?.promptHint || "";
  }
};

// ============================================================================
// 初始状态
// ============================================================================

const initialState: ImageBatchState = {
  tasks: [],
  jobStatus: "idle",
  globalSettings: {
    model: "nano-banana",
    action: "upscale",  // 默认使用高清放大，更实用
    aspectRatio: "auto",
    resolution: "1k",
    prompt: "",
  },
  selectedTaskIds: {},
  maxConcurrent: 3,
  processingCount: 0,
};

// ============================================================================
// Store 创建
// ============================================================================

export const useImageBatchStore = create<ImageBatchState & ImageBatchActions>()(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,

      // ==================== 任务管理 ====================

      addTasksFromFiles: async (files) => {
        const { globalSettings, tasks, jobStatus } = get();
        const newIds: string[] = [];

        // 只有 AI 生成模式才使用提示词，高清放大和九宫格不需要
        const prompt = globalSettings.action === "generate"
          ? (globalSettings.prompt?.trim() || getActionPromptHint(globalSettings.model, globalSettings.action))
          : "";

        const newTasks: ImageBatchTask[] = files
          .filter((f) => f.type.startsWith("image/"))
          .map((file, i) => {
            const id = generateId();
            newIds.push(id);

            const blobUrl = URL.createObjectURL(file);

            return {
              id,
              index: tasks.length + i,
              status: "pending" as const,
              config: {
                sourceImageUrl: blobUrl,
                sourceImageName: file.name,
                model: globalSettings.model,
                action: globalSettings.action,
                aspectRatio: globalSettings.aspectRatio,
                resolution: globalSettings.resolution,
                prompt,
              },
              createdAt: new Date().toISOString(),
            };
          });

        set((state) => {
          state.tasks.push(...newTasks);
          // 如果已完成、取消或 running 但没有 pending/processing 任务，重置为 idle 状态以允许新任务
          if (jobStatus === "completed" || jobStatus === "cancelled") {
            state.jobStatus = "idle";
          } else if (jobStatus === "running") {
            // 检查是否有正在处理的任务
            const hasProcessing = state.tasks.some(t => t.status === "processing");
            if (!hasProcessing) {
              // 没有正在处理的任务，重置为 idle
              state.jobStatus = "idle";
            }
          }
        });

        return newIds;
      },

      updateTaskConfig: (id, key, value) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task) {
            (task.config as Record<string, unknown>)[key] = value;
          }
        });
      },

      updateTaskStatus: (id, status, extra) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task) {
            task.status = status;
            if (extra) {
              Object.assign(task, extra);
            }
          }
        });
      },

      updateTaskResult: (id, update) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task) {
            if (update.status) task.status = update.status;
            if (update.resultUrl) task.resultUrl = update.resultUrl;
            if (update.error) task.error = update.error;
            if (update.apiTaskId) task.apiTaskId = update.apiTaskId;
            if (update.status === "completed") {
              task.completedAt = new Date().toISOString();
            }
          }
        });
      },

      setJobStatus: (status) => {
        set((state) => {
          state.jobStatus = status;
        });
      },

      removeTask: (id) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task?.config.sourceImageUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(task.config.sourceImageUrl);
          }
          state.tasks = state.tasks
            .filter((t) => t.id !== id)
            .map((t, i) => ({ ...t, index: i }));
          delete state.selectedTaskIds[id];
          
          // 如果删除后没有任务了，重置状态
          if (state.tasks.length === 0) {
            state.jobStatus = "idle";
            state.processingCount = 0;
          }
          // 如果没有 pending 任务且没有 processing 任务，也重置为 idle
          else {
            const hasPending = state.tasks.some(t => t.status === "pending");
            const hasProcessing = state.tasks.some(t => t.status === "processing");
            if (!hasPending && !hasProcessing && state.jobStatus === "running") {
              state.jobStatus = "completed";
            }
          }
        });
      },

      removeTasks: (ids) => {
        const idsSet = new Set(ids);
        set((state) => {
          state.tasks.forEach((t) => {
            if (idsSet.has(t.id) && t.config.sourceImageUrl?.startsWith("blob:")) {
              URL.revokeObjectURL(t.config.sourceImageUrl);
            }
          });
          state.tasks = state.tasks
            .filter((t) => !idsSet.has(t.id))
            .map((t, i) => ({ ...t, index: i }));
          ids.forEach((id) => delete state.selectedTaskIds[id]);
        });
      },

      clearAllTasks: () => {
        const { tasks } = get();
        tasks.forEach((t) => {
          if (t.config.sourceImageUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(t.config.sourceImageUrl);
          }
        });
        set((state) => {
          state.tasks = [];
          state.selectedTaskIds = {};
          state.jobStatus = "idle";
          state.processingCount = 0;
        });
      },

      // ==================== 选择管理 ====================

      toggleTaskSelection: (id) => {
        set((state) => {
          if (state.selectedTaskIds[id]) {
            delete state.selectedTaskIds[id];
          } else {
            state.selectedTaskIds[id] = true;
          }
        });
      },

      selectAllTasks: (selected) => {
        set((state) => {
          if (selected) {
            state.tasks.forEach((t) => {
              state.selectedTaskIds[t.id] = true;
            });
          } else {
            state.selectedTaskIds = {};
          }
        });
      },

      clearSelection: () => {
        set((state) => {
          state.selectedTaskIds = {};
        });
      },

      removeSelectedTasks: () => {
        const { selectedTaskIds } = get();
        get().removeTasks(Object.keys(selectedTaskIds));
      },

      // ==================== 批量作业控制 ====================

      startBatch: () => {
        set((state) => {
          state.jobStatus = "running";
        });
      },

      startSingleTask: (id) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === id);
          if (task && task.status === "pending") {
            task.status = "processing";
            task.startedAt = new Date().toISOString();
          }
        });
      },

      pauseBatch: () => {
        set((state) => {
          state.jobStatus = "paused";
        });
      },

      resumeBatch: () => {
        set((state) => {
          state.jobStatus = "running";
        });
      },

      cancelBatch: () => {
        set((state) => {
          state.jobStatus = "cancelled";
        });
      },

      resetBatch: () => {
        set((state) => {
          state.jobStatus = "idle";
          state.processingCount = 0;
          state.tasks.forEach((t) => {
            t.status = "pending";
            t.apiTaskId = undefined;
            t.resultUrl = undefined;
            t.error = undefined;
            t.progress = undefined;
            t.startedAt = undefined;
            t.completedAt = undefined;
          });
        });
      },

      incrementProcessing: () => {
        set((state) => {
          state.processingCount++;
        });
      },

      decrementProcessing: () => {
        set((state) => {
          state.processingCount = Math.max(0, state.processingCount - 1);
        });
      },

      // ==================== 全局设置 ====================

      updateGlobalSettings: (key, value) => {
        set((state) => {
          (state.globalSettings as Record<string, unknown>)[key] = value;
          
          // 如果切换模型，需要校验 action
          if (key === "model") {
            const model = value as ImageModelType;
            if (model === "nano-banana-pro" && state.globalSettings.action === "upscale") {
              // Pro 模式不支持单独的 upscale，重置为 generate
              state.globalSettings.action = "generate";
            }
          }
        });
      },

      applyGlobalSettingsToAllPending: () => {
        const { globalSettings } = get();
        set((state) => {
          state.tasks.forEach((t) => {
            if (t.status === "pending") {
              // 只有 AI 生成模式才使用提示词
              const prompt = globalSettings.action === "generate"
                ? (globalSettings.prompt?.trim() || getActionPromptHint(globalSettings.model, globalSettings.action))
                : "";
              t.config = {
                ...t.config,
                model: globalSettings.model,
                action: globalSettings.action,
                aspectRatio: globalSettings.aspectRatio,
                resolution: globalSettings.resolution,
                prompt,
              };
            }
          });
        });
      },
    })),
    {
      name: "image-batch-storage",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") {
          return localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      // 只持久化已完成的任务和设置
      partialize: (state) => ({
        tasks: state.tasks
          .filter(task => task.status === "completed" || task.resultUrl)
          .map(task => ({
            ...task,
            config: {
              ...task.config,
              // 不持久化 blob URLs
              sourceImageUrl: task.config.sourceImageUrl?.startsWith("blob:") ? "" : task.config.sourceImageUrl,
            },
          }))
          .filter(task => task.config.sourceImageUrl || task.resultUrl),
        globalSettings: state.globalSettings,
        jobStatus: state.jobStatus === "running" ? "idle" : state.jobStatus,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log("[ImageBatchStore] Rehydrated from localStorage:", {
            taskCount: state.tasks.length,
          });
        }
      },
    }
  ),
  { name: "ImageBatchStore" }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useImageBatchTasks = () => useImageBatchStore((state) => state.tasks);
export const useImageBatchJobStatus = () => useImageBatchStore((state) => state.jobStatus);
export const useImageBatchGlobalSettings = () => useImageBatchStore((state) => state.globalSettings);
export const useImageBatchSelectedIds = () => useImageBatchStore((state) => state.selectedTaskIds);
export const useImageBatchSelectedCount = () => useImageBatchStore((state) => Object.keys(state.selectedTaskIds).length);

export const useImageBatchStats = () => {
  const tasks = useImageBatchStore((state) => state.tasks);
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    processing: tasks.filter((t) => t.status === "processing").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    totalCost: getImageTotalCost(tasks),
  };
};

