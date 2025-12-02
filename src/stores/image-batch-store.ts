/**
 * Image Batch Store - 图片批量处理状态管理
 * 
 * 专门用于图片批量处理单元的 Zustand Store
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
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
    action: "generate",
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
    immer((set, get) => ({
      ...initialState,

      // ==================== 任务管理 ====================

      addTasksFromFiles: async (files) => {
        const { globalSettings, tasks, jobStatus } = get();
        const newIds: string[] = [];

        // 使用全局提示词，如果没有设置则使用默认提示词
        const prompt = globalSettings.prompt?.trim() || getActionPromptHint(globalSettings.model, globalSettings.action);

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
          // 如果已完成或取消，自动重置为 idle 状态以允许新任务
          if (jobStatus === "completed" || jobStatus === "cancelled") {
            state.jobStatus = "idle";
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
              // 使用全局提示词，如果没有设置则使用默认提示词
              const prompt = globalSettings.prompt?.trim() || getActionPromptHint(globalSettings.model, globalSettings.action);
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

