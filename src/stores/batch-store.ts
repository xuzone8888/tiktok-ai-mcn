/**
 * Batch Store - 批量任务状态管理
 * 
 * 使用 Zustand 管理 Pro Studio 的批量任务状态
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  type OutputMode,
  type VideoModel,
  type VideoAspectRatio,
  type NanoTier,
  type ImageAspectRatio,
  type ImageResolution,
  VIDEO_MODEL_PRICING,
  NANO_PRICING,
  calculateVideoCost,
  calculateImageCost,
} from "@/types/generation";

// ============================================================================
// 类型定义
// ============================================================================

export type BatchTaskStatus = "draft" | "queued" | "processing" | "success" | "failed";

export interface BatchTaskConfig {
  outputMode: OutputMode;
  prompt: string;
  // Video Config
  videoModel?: VideoModel;
  videoAspectRatio?: VideoAspectRatio;
  sourceImageUrl?: string;
  sourceImageName?: string;
  modelId?: string;
  // Image Config
  imageTier?: NanoTier;
  imageAspectRatio?: ImageAspectRatio;
  imageResolution?: ImageResolution;
  sourceImageUrls?: string[];
}

export interface BatchTask {
  id: string;
  index: number;
  status: BatchTaskStatus;
  config: BatchTaskConfig;
  taskId?: string;
  resultUrl?: string;
  error?: string;
  progress?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type BatchJobStatus = "idle" | "running" | "paused" | "completed" | "cancelled";

export interface GlobalSettings {
  outputMode: OutputMode;
  videoModel: VideoModel;
  videoAspectRatio: VideoAspectRatio;
  imageTier: NanoTier;
  imageAspectRatio: ImageAspectRatio;
  imageResolution: ImageResolution;
  autoStartOnAdd: boolean;
}

export interface BatchState {
  // 任务列表
  tasks: BatchTask[];
  
  // 批量作业状态
  jobStatus: BatchJobStatus;
  currentTaskIndex: number;
  
  // 全局设置 (用于批量添加时的默认配置)
  globalSettings: GlobalSettings;
  
  // 选中的任务 (使用 Record 代替 Set 以避免序列化问题)
  selectedTaskIds: Record<string, boolean>;
}

// ============================================================================
// Actions 接口
// ============================================================================

export interface BatchActions {
  // ==================== 任务管理 ====================
  
  /**
   * 添加单个任务
   */
  addTask: (config: Partial<BatchTaskConfig>) => string;
  
  /**
   * 批量添加任务 (从文件)
   * @param files - 上传的文件列表
   * @returns 添加的任务 ID 列表
   */
  addTasksFromFiles: (files: File[]) => Promise<string[]>;
  
  /**
   * 批量添加任务 (从 Prompts)
   * @param prompts - Prompt 列表
   * @returns 添加的任务 ID 列表
   */
  addTasksFromPrompts: (prompts: string[]) => string[];
  
  /**
   * 更新任务配置
   */
  updateTaskConfig: <K extends keyof BatchTaskConfig>(
    id: string,
    key: K,
    value: BatchTaskConfig[K]
  ) => void;
  
  /**
   * 更新任务状态
   */
  updateTaskStatus: (
    id: string,
    status: BatchTaskStatus,
    extra?: Partial<Pick<BatchTask, "taskId" | "resultUrl" | "error" | "progress" | "startedAt" | "completedAt">>
  ) => void;
  
  /**
   * 复制任务
   */
  duplicateTask: (id: string) => string | null;
  
  /**
   * 删除任务
   */
  removeTask: (id: string) => void;
  
  /**
   * 批量删除任务
   */
  removeTasks: (ids: string[]) => void;
  
  /**
   * 清空所有任务
   */
  clearAllTasks: () => void;
  
  /**
   * 重新排序任务
   */
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  
  // ==================== 选择管理 ====================
  
  /**
   * 切换任务选中状态
   */
  toggleTaskSelection: (id: string) => void;
  
  /**
   * 全选/取消全选
   */
  selectAllTasks: (selected: boolean) => void;
  
  /**
   * 清空选择
   */
  clearSelection: () => void;
  
  /**
   * 删除选中的任务
   */
  removeSelectedTasks: () => void;
  
  // ==================== 批量作业控制 ====================
  
  /**
   * 开始批量处理
   */
  startBatch: () => void;
  
  /**
   * 暂停批量处理
   */
  pauseBatch: () => void;
  
  /**
   * 继续批量处理
   */
  resumeBatch: () => void;
  
  /**
   * 取消批量处理
   */
  cancelBatch: () => void;
  
  /**
   * 重置批量作业 (将所有任务重置为 draft)
   */
  resetBatch: () => void;
  
  /**
   * 设置当前处理的任务索引
   */
  setCurrentTaskIndex: (index: number) => void;
  
  // ==================== 全局设置 ====================
  
  /**
   * 更新全局设置
   */
  updateGlobalSettings: <K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K]
  ) => void;
  
  /**
   * 应用全局设置到所有 draft 任务
   */
  applyGlobalSettingsToAllDrafts: () => void;
}

// ============================================================================
// 工具函数
// ============================================================================

const generateId = () => `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const createDefaultConfig = (settings: GlobalSettings): BatchTaskConfig => ({
  outputMode: settings.outputMode,
  prompt: "",
  videoModel: settings.videoModel,
  videoAspectRatio: settings.videoAspectRatio,
  imageTier: settings.imageTier,
  imageAspectRatio: settings.imageAspectRatio,
  imageResolution: settings.imageResolution,
});

/**
 * 计算任务的积分消耗
 */
export const getTaskCost = (config: BatchTaskConfig): number => {
  if (config.outputMode === "video" && config.videoModel) {
    return calculateVideoCost(config.videoModel);
  } else if (config.outputMode === "image" && config.imageTier) {
    return calculateImageCost(
      config.imageTier,
      config.imageResolution || "1k",
      config.imageTier === "pro"
    );
  }
  return 0;
};

/**
 * 计算所有任务的总积分消耗
 */
export const getTotalCost = (tasks: BatchTask[]): number => {
  return tasks.reduce((sum, task) => sum + getTaskCost(task.config), 0);
};

// ============================================================================
// 初始状态
// ============================================================================

const initialState: BatchState = {
  tasks: [],
  jobStatus: "idle",
  currentTaskIndex: 0,
  globalSettings: {
    outputMode: "video",
    videoModel: "sora-2",
    videoAspectRatio: "9:16",
    imageTier: "fast",
    imageAspectRatio: "auto",
    imageResolution: "1k",
    autoStartOnAdd: false,
  },
  selectedTaskIds: {},
};

// ============================================================================
// Store 创建
// ============================================================================

export const useBatchStore = create<BatchState & BatchActions>()(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,

        // ==================== 任务管理 ====================

        addTask: (config) => {
          const id = generateId();
          const { globalSettings, tasks } = get();
          
          const newTask: BatchTask = {
            id,
            index: tasks.length,
            status: "draft",
            config: {
              ...createDefaultConfig(globalSettings),
              ...config,
            },
            createdAt: new Date().toISOString(),
          };

          set((state) => {
            state.tasks.push(newTask);
          });

          return id;
        },

        addTasksFromFiles: async (files) => {
          const { globalSettings, tasks } = get();
          const newIds: string[] = [];

          const newTasks: BatchTask[] = await Promise.all(
            files.map(async (file, i) => {
              const id = generateId();
              newIds.push(id);

              // 创建 blob URL
              const blobUrl = URL.createObjectURL(file);

              // 根据文件类型决定输出模式
              const isImage = file.type.startsWith("image/");
              const outputMode = isImage ? globalSettings.outputMode : "video";

              return {
                id,
                index: tasks.length + i,
                status: "draft" as BatchTaskStatus,
                config: {
                  ...createDefaultConfig(globalSettings),
                  outputMode,
                  prompt: `Generate content from ${file.name}`,
                  sourceImageUrl: blobUrl,
                  sourceImageName: file.name,
                },
                createdAt: new Date().toISOString(),
              };
            })
          );

          set((state) => {
            state.tasks.push(...newTasks);
          });

          return newIds;
        },

        addTasksFromPrompts: (prompts) => {
          const { globalSettings, tasks } = get();
          const newIds: string[] = [];

          const newTasks: BatchTask[] = prompts
            .filter((p) => p.trim())
            .map((prompt, i) => {
              const id = generateId();
              newIds.push(id);

              return {
                id,
                index: tasks.length + i,
                status: "draft" as BatchTaskStatus,
                config: {
                  ...createDefaultConfig(globalSettings),
                  prompt: prompt.trim(),
                },
                createdAt: new Date().toISOString(),
              };
            });

          set((state) => {
            state.tasks.push(...newTasks);
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

        duplicateTask: (id) => {
          const { tasks } = get();
          const task = tasks.find((t) => t.id === id);
          
          if (!task) return null;

          const newId = generateId();
          const newTask: BatchTask = {
            ...task,
            id: newId,
            index: tasks.length,
            status: "draft",
            taskId: undefined,
            resultUrl: undefined,
            error: undefined,
            progress: undefined,
            createdAt: new Date().toISOString(),
            startedAt: undefined,
            completedAt: undefined,
            config: { ...task.config },
          };

          set((state) => {
            state.tasks.push(newTask);
          });

          return newId;
        },

        removeTask: (id) => {
          set((state) => {
            state.tasks = state.tasks
              .filter((t) => t.id !== id)
              .map((t, i) => ({ ...t, index: i }));
            delete state.selectedTaskIds[id];
          });
        },

        removeTasks: (ids) => {
          const idsSet = new Set(ids);
          set((state) => {
            state.tasks = state.tasks
              .filter((t) => !idsSet.has(t.id))
              .map((t, i) => ({ ...t, index: i }));
            ids.forEach((id) => delete state.selectedTaskIds[id]);
          });
        },

        clearAllTasks: () => {
          set((state) => {
            state.tasks = [];
            state.selectedTaskIds = {};
            state.jobStatus = "idle";
            state.currentTaskIndex = 0;
          });
        },

        reorderTasks: (fromIndex, toIndex) => {
          set((state) => {
            const [removed] = state.tasks.splice(fromIndex, 1);
            state.tasks.splice(toIndex, 0, removed);
            // 重新计算索引
            state.tasks.forEach((t, i) => {
              t.index = i;
            });
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
            // 将所有 draft 任务标记为 queued
            state.tasks.forEach((t) => {
              if (t.status === "draft") {
                t.status = "queued";
              }
            });
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
            state.currentTaskIndex = 0;
            state.tasks.forEach((t) => {
              t.status = "draft";
              t.taskId = undefined;
              t.resultUrl = undefined;
              t.error = undefined;
              t.progress = undefined;
              t.startedAt = undefined;
              t.completedAt = undefined;
            });
          });
        },

        setCurrentTaskIndex: (index) => {
          set((state) => {
            state.currentTaskIndex = index;
          });
        },

        // ==================== 全局设置 ====================

        updateGlobalSettings: (key, value) => {
          set((state) => {
            (state.globalSettings as Record<string, unknown>)[key] = value;
          });
        },

        applyGlobalSettingsToAllDrafts: () => {
          const { globalSettings } = get();
          set((state) => {
            state.tasks.forEach((t) => {
              if (t.status === "draft") {
                t.config = {
                  ...t.config,
                  outputMode: globalSettings.outputMode,
                  videoModel: globalSettings.videoModel,
                  videoAspectRatio: globalSettings.videoAspectRatio,
                  imageTier: globalSettings.imageTier,
                  imageAspectRatio: globalSettings.imageAspectRatio,
                  imageResolution: globalSettings.imageResolution,
                };
              }
            });
          });
        },
      })),
      {
        name: "batch-store",
        // 只持久化部分状态
        partialize: (state) => ({
          globalSettings: state.globalSettings,
          // 不持久化任务列表，避免 blob URL 失效问题
        }),
      }
    ),
    { name: "BatchStore" }
  )
);

// ============================================================================
// Selector Hooks (性能优化)
// ============================================================================

/**
 * 获取任务列表
 */
export const useBatchTasks = () => useBatchStore((state) => state.tasks);

/**
 * 获取作业状态
 */
export const useBatchJobStatus = () => useBatchStore((state) => state.jobStatus);

/**
 * 获取全局设置
 */
export const useBatchGlobalSettings = () => useBatchStore((state) => state.globalSettings);

/**
 * 获取选中的任务 ID 数量
 */
export const useBatchSelectedCount = () => useBatchStore((state) => Object.keys(state.selectedTaskIds).length);

/**
 * 获取选中的任务 ID (作为 Record)
 */
export const useBatchSelectedIds = () => useBatchStore((state) => state.selectedTaskIds);

/**
 * 检查任务是否被选中
 */
export const useIsTaskSelected = (id: string) => useBatchStore((state) => !!state.selectedTaskIds[id]);

/**
 * 获取统计数据
 */
export const useBatchStats = () => {
  const tasks = useBatchStore((state) => state.tasks);
  return {
    total: tasks.length,
    draft: tasks.filter((t) => t.status === "draft").length,
    queued: tasks.filter((t) => t.status === "queued").length,
    processing: tasks.filter((t) => t.status === "processing").length,
    success: tasks.filter((t) => t.status === "success").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    totalCost: getTotalCost(tasks),
  };
};

/**
 * 获取当前处理的任务
 */
export const useCurrentTask = () => useBatchStore((state) => {
  const { tasks, currentTaskIndex } = state;
  return tasks[currentTaskIndex] || null;
});

/**
 * 获取单个任务
 */
export const useTask = (id: string) => useBatchStore((state) => 
  state.tasks.find((t) => t.id === id)
);

