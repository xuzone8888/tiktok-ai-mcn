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

/** 批量场景类型 */
export type BatchScenario = "prompt" | "image" | "excel";

/** Excel 导入的提示词行 */
export interface ExcelPromptRow {
  prompt: string;
  count: number;
}

/** 已上传的图片信息 */
export interface UploadedImageInfo {
  file: File;
  previewUrl: string;
  name: string;
}

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

  // ============= 场景管理 =============
  /** 当前批量场景 */
  scenario: BatchScenario;

  /** 场景2: 已上传的图片列表 */
  uploadedImages: UploadedImageInfo[];

  /** 场景3: Excel 导入的数据 */
  excelData: ExcelPromptRow[];

  /** 场景1: 纯提示词生成数量 */
  promptCount: number;
}

// ============================================================================
// Actions 接口
// ============================================================================

export interface ImageBatchActions {
  // ==================== 任务管理 ====================

  /** 从文件批量添加任务 */
  addTasksFromFiles: (files: File[]) => Promise<string[]>;

  /** 从提示词创建任务（无需图片） */
  addTaskFromPrompt: (prompt: string, count?: number) => string[];

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

  /** 应用全局设置到选中的任务（包括 pending 和 failed 任务）*/
  applyGlobalSettingsToSelected: () => void;

  // ==================== 场景管理 ====================

  /** 设置当前场景 */
  setScenario: (scenario: BatchScenario) => void;

  /** 设置已上传的图片 */
  setUploadedImages: (images: UploadedImageInfo[]) => void;

  /** 添加上传的图片 */
  addUploadedImages: (images: UploadedImageInfo[]) => void;

  /** 清除已上传的图片 */
  clearUploadedImages: () => void;

  /** 设置 Excel 数据 */
  setExcelData: (data: ExcelPromptRow[]) => void;

  /** 清除 Excel 数据 */
  clearExcelData: () => void;

  /** 设置纯提示词数量 */
  setPromptCount: (count: number) => void;

  /** 重置场景数据 */
  resetScenarioData: () => void;

  /** 基于当前场景创建任务 */
  createTasksFromScenario: () => string[];
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
    action: "generate",  // 默认使用 AI 生成
    aspectRatio: "auto",
    resolution: "1k",
    prompt: "",
  },
  selectedTaskIds: {},
  maxConcurrent: 3,
  processingCount: 0,
  // 场景管理初始状态
  scenario: "prompt",
  uploadedImages: [],
  excelData: [],
  promptCount: 1,
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

        addTaskFromPrompt: (prompt, count = 1) => {
          const { globalSettings, tasks, jobStatus } = get();
          const newIds: string[] = [];

          // 纯提示词模式只能用于 AI 生成
          const action: ImageProcessAction = "generate";

          const newTasks: ImageBatchTask[] = Array.from({ length: count }, (_, i) => {
            const id = generateId();
            newIds.push(id);

            return {
              id,
              index: tasks.length + i,
              status: "pending" as const,
              config: {
                sourceImageUrl: "", // 纯提示词模式无源图片
                sourceImageName: `提示词任务 ${tasks.length + i + 1}`,
                model: globalSettings.model,
                action,
                aspectRatio: globalSettings.aspectRatio,
                resolution: globalSettings.resolution,
                prompt: prompt.trim(),
              },
              createdAt: new Date().toISOString(),
            };
          });

          set((state) => {
            state.tasks.push(...newTasks);
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

        applyGlobalSettingsToSelected: () => {
          const { globalSettings, selectedTaskIds } = get();
          set((state) => {
            state.tasks.forEach((t) => {
              // 应用到选中的 pending 或 failed 任务
              if (selectedTaskIds[t.id] && (t.status === "pending" || t.status === "failed")) {
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
                // 如果是 failed 任务，重置为 pending
                if (t.status === "failed") {
                  t.status = "pending";
                  t.error = undefined;
                  t.apiTaskId = undefined;
                }
              }
            });
          });
        },

        // ==================== 场景管理 ====================

        setScenario: (scenario) => {
          set((state) => {
            state.scenario = scenario;
          });
        },

        setUploadedImages: (images) => {
          set((state) => {
            // 先清理旧的 blob URLs
            state.uploadedImages.forEach((img) => {
              if (img.previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(img.previewUrl);
              }
            });
            state.uploadedImages = images;
            // 有图片时自动切换到图片场景
            if (images.length > 0) {
              state.scenario = "image";
            }
          });
        },

        addUploadedImages: (images) => {
          set((state) => {
            state.uploadedImages.push(...images);
            // 有图片时自动切换到图片场景
            if (images.length > 0) {
              state.scenario = "image";
            }
          });
        },

        clearUploadedImages: () => {
          set((state) => {
            state.uploadedImages.forEach((img) => {
              if (img.previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(img.previewUrl);
              }
            });
            state.uploadedImages = [];
            // 清除图片后如果没有 Excel 数据，切回提示词模式
            if (state.excelData.length === 0) {
              state.scenario = "prompt";
            }
          });
        },

        setExcelData: (data) => {
          set((state) => {
            state.excelData = data;
            // 有 Excel 数据时自动切换到 Excel 场景
            if (data.length > 0) {
              state.scenario = "excel";
            }
          });
        },

        clearExcelData: () => {
          set((state) => {
            state.excelData = [];
            // 清除 Excel 后如果没有图片，切回提示词模式
            if (state.uploadedImages.length === 0) {
              state.scenario = "prompt";
            }
          });
        },

        setPromptCount: (count) => {
          set((state) => {
            state.promptCount = Math.max(1, Math.min(50, count));
          });
        },

        resetScenarioData: () => {
          set((state) => {
            // 清理 blob URLs
            state.uploadedImages.forEach((img) => {
              if (img.previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(img.previewUrl);
              }
            });
            state.scenario = "prompt";
            state.uploadedImages = [];
            state.excelData = [];
            state.promptCount = 1;
          });
        },

        createTasksFromScenario: () => {
          const { scenario, globalSettings, uploadedImages, excelData, promptCount, tasks } = get();
          const newIds: string[] = [];

          const createTask = (prompt: string, sourceUrl = "", sourceName = ""): ImageBatchTask => {
            const id = generateId();
            newIds.push(id);
            return {
              id,
              index: tasks.length + newIds.length - 1,
              status: "pending" as const,
              config: {
                sourceImageUrl: sourceUrl,
                sourceImageName: sourceName || `提示词任务 ${newIds.length}`,
                model: globalSettings.model,
                action: globalSettings.action,
                aspectRatio: globalSettings.aspectRatio,
                resolution: globalSettings.resolution,
                prompt: prompt,  // 始终传递提示词，图生图也需要
              },
              createdAt: new Date().toISOString(),
            };
          };

          set((state) => {
            switch (scenario) {
              case "prompt":
                // 场景1: 纯提示词，创建 promptCount 个任务
                for (let i = 0; i < promptCount; i++) {
                  state.tasks.push(createTask(globalSettings.prompt.trim()));
                }
                break;

              case "image":
                // 场景2: 图片改造，每张图片一个任务
                uploadedImages.forEach((img, i) => {
                  const task = createTask(
                    globalSettings.prompt.trim(),
                    img.previewUrl,
                    img.name || `上传图片 ${i + 1}`
                  );
                  state.tasks.push(task);
                });
                break;

              case "excel":
                // 场景3: Excel 批量，按行创建任务
                excelData.forEach((row) => {
                  for (let i = 0; i < row.count; i++) {
                    state.tasks.push(createTask(row.prompt));
                  }
                });
                break;
            }

            // 重置作业状态为 idle，允许启动
            if (state.jobStatus === "completed" || state.jobStatus === "cancelled") {
              state.jobStatus = "idle";
            }
          });

          return newIds;
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
            setItem: () => { },
            removeItem: () => { },
          };
        }),
        // 持久化所有任务和设置（包括待处理任务）
        partialize: (state) => ({
          tasks: state.tasks.map(task => ({
            ...task,
            config: {
              ...task.config,
              // 不持久化 blob URLs (这些任务重载后无法恢复图片)
              sourceImageUrl: task.config.sourceImageUrl?.startsWith("blob:") ? "" : task.config.sourceImageUrl,
            },
          })),
          globalSettings: state.globalSettings,
          jobStatus: state.jobStatus === "running" ? "idle" : state.jobStatus,
        }),
        onRehydrateStorage: () => (state) => {
          if (state) {
            // 将中断的 processing 任务重置为 pending
            state.tasks = state.tasks.map(task =>
              task.status === "processing"
                ? { ...task, status: "pending" as const, progress: undefined, startedAt: undefined }
                : task
            );
            console.log("[ImageBatchStore] Rehydrated from localStorage:", {
              taskCount: state.tasks.length,
              pending: state.tasks.filter(t => t.status === "pending").length,
              completed: state.tasks.filter(t => t.status === "completed").length,
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

// 场景相关 selectors
export const useImageBatchScenario = () => useImageBatchStore((state) => state.scenario);
export const useImageBatchUploadedImages = () => useImageBatchStore((state) => state.uploadedImages);
export const useImageBatchExcelData = () => useImageBatchStore((state) => state.excelData);
export const useImageBatchPromptCount = () => useImageBatchStore((state) => state.promptCount);

/** 获取当前场景的任务数量预估 */
export const useImageBatchScenarioTaskCount = () => {
  const scenario = useImageBatchStore((state) => state.scenario);
  const uploadedImages = useImageBatchStore((state) => state.uploadedImages);
  const excelData = useImageBatchStore((state) => state.excelData);
  const promptCount = useImageBatchStore((state) => state.promptCount);

  switch (scenario) {
    case "prompt":
      return promptCount;
    case "image":
      return uploadedImages.length;
    case "excel":
      return excelData.reduce((sum, row) => sum + row.count, 0);
    default:
      return 0;
  }
};

