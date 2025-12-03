/**
 * Video Batch Store - 批量视频生产状态管理
 * 
 * 特性：
 * - 使用 persist 中间件持久化任务状态到 localStorage
 * - 页面切换时任务不会丢失
 * - 支持恢复正在进行的任务
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  type VideoBatchTask,
  type VideoBatchTaskStatus,
  type VideoAspectRatio,
  type TaskImageInfo,
  type PipelineStep,
  type VideoBatchGlobalSettings,
  getVideoBatchTotalPrice,
} from "@/types/video-batch";

// ============================================================================
// 状态类型
// ============================================================================

export type VideoBatchJobStatus = "idle" | "running" | "paused" | "completed" | "cancelled";

export interface VideoBatchState {
  // 任务列表
  tasks: VideoBatchTask[];
  
  // 批量作业状态
  jobStatus: VideoBatchJobStatus;
  
  // 全局设置
  globalSettings: VideoBatchGlobalSettings;
  
  // 选中的任务 ID
  selectedTaskIds: Record<string, boolean>;
  
  // 当前正在编辑的任务（用于添加图片）
  editingTaskId: string | null;
}

// ============================================================================
// Actions 接口
// ============================================================================

export interface VideoBatchActions {
  // ==================== 任务管理 ====================
  
  /** 创建新任务 */
  createTask: (images: TaskImageInfo[]) => string;
  
  /** 批量创建空任务 */
  createEmptyTasks: (count: number) => string[];
  
  /** 克隆任务 */
  cloneTask: (taskId: string) => string | null;
  
  /** 批量创建任务（每组图片创建一个任务） */
  createTasksFromImageGroups: (imageGroups: TaskImageInfo[][]) => string[];
  
  /** 更新任务状态 */
  updateTaskStatus: (
    taskId: string,
    status: VideoBatchTaskStatus,
    extra?: Partial<Pick<VideoBatchTask, 
      "currentStep" | "progress" | "errorMessage" | 
      "doubaoTalkingScript" | "doubaoAiVideoPrompt" | 
      "soraTaskId" | "soraVideoUrl"
    >>
  ) => void;
  
  /** 更新任务图片 */
  updateTaskImages: (taskId: string, images: TaskImageInfo[]) => void;
  
  /** 添加图片到任务 */
  addImagesToTask: (taskId: string, images: TaskImageInfo[]) => void;
  
  /** 从任务中移除图片 */
  removeImageFromTask: (taskId: string, imageId: string) => void;
  
  /** 重新排序任务图片 */
  reorderTaskImages: (taskId: string, fromIndex: number, toIndex: number) => void;
  
  /** 设置主九宫格图 */
  setMainGridImage: (taskId: string, imageId: string) => void;
  
  /** 删除任务 */
  removeTask: (taskId: string) => void;
  
  /** 批量删除任务 */
  removeTasks: (taskIds: string[]) => void;
  
  /** 清空所有任务 */
  clearAllTasks: () => void;
  
  // ==================== 选择管理 ====================
  
  /** 切换任务选中状态 */
  toggleTaskSelection: (taskId: string) => void;
  
  /** 全选/取消全选 */
  selectAllTasks: (selected: boolean) => void;
  
  /** 清空选择 */
  clearSelection: () => void;
  
  /** 删除选中的任务 */
  removeSelectedTasks: () => void;
  
  // ==================== 批量作业控制 ====================
  
  /** 开始批量处理 */
  startBatch: () => void;
  
  /** 暂停批量处理 */
  pauseBatch: () => void;
  
  /** 继续批量处理 */
  resumeBatch: () => void;
  
  /** 取消批量处理 */
  cancelBatch: () => void;
  
  /** 重置批量作业 */
  resetBatch: () => void;
  
  // ==================== 全局设置 ====================
  
  /** 更新全局设置 */
  updateGlobalSettings: <K extends keyof VideoBatchGlobalSettings>(
    key: K,
    value: VideoBatchGlobalSettings[K]
  ) => void;
  
  /** 设置正在编辑的任务 */
  setEditingTask: (taskId: string | null) => void;
}

// ============================================================================
// 工具函数
// ============================================================================

const generateId = () => `vbt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const generateImageId = () => `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** 计算单个任务的积分消耗（使用全局设置） */
export const getVideoBatchTaskCost = (globalSettings?: VideoBatchGlobalSettings): number => {
  if (!globalSettings) {
    // 默认使用 sora2 15秒标清
    return getVideoBatchTotalPrice("sora2", 15, "standard");
  }
  return getVideoBatchTotalPrice(
    globalSettings.modelType,
    globalSettings.duration,
    globalSettings.quality
  );
};

/** 计算所有任务的总积分消耗 */
export const getVideoBatchTotalCost = (tasks: VideoBatchTask[], globalSettings?: VideoBatchGlobalSettings): number => {
  const costPerTask = getVideoBatchTaskCost(globalSettings);
  return tasks.length * costPerTask;
};

/** 校验任务图片是否有效 */
export const validateTaskImages = (images: TaskImageInfo[]): { valid: boolean; error?: string } => {
  if (images.length === 0) {
    return { valid: false, error: "请至少上传一张图片" };
  }
  
  const hasMainGrid = images.some(img => img.isMainGrid);
  if (!hasMainGrid) {
    return { valid: false, error: "请设置第一张图片为高清九宫格图" };
  }
  
  const mainGridImage = images.find(img => img.isMainGrid);
  if (mainGridImage && mainGridImage.order !== 0) {
    return { valid: false, error: "高清九宫格图必须是第一张" };
  }
  
  return { valid: true };
};

// ============================================================================
// 初始状态
// ============================================================================

const initialState: VideoBatchState = {
  tasks: [],
  jobStatus: "idle",
  globalSettings: {
    aspectRatio: "9:16",
    modelType: "sora2",
    duration: 15,
    quality: "standard",
    language: "en",
    autoStart: false,
    useAiModel: false,
    aiModelId: null,
    aiModelTriggerWord: null,
  },
  selectedTaskIds: {},
  editingTaskId: null,
};

// ============================================================================
// Store 创建
// ============================================================================

export const useVideoBatchStore = create<VideoBatchState & VideoBatchActions>()(
  persist(
    devtools(
      immer((set, get) => ({
        ...initialState,

      // ==================== 任务管理 ====================

      createTask: (images) => {
        const id = generateId();
        const { globalSettings } = get();
        
        // 确保第一张图片标记为主九宫格图
        const processedImages = images.map((img, index) => ({
          ...img,
          id: img.id || generateImageId(),
          order: index,
          isMainGrid: index === 0,
        }));

        const newTask: VideoBatchTask = {
          id,
          images: processedImages,
          aspectRatio: globalSettings.aspectRatio,
          doubaoTalkingScript: null,
          doubaoAiVideoPrompt: null,
          soraTaskId: null,
          soraVideoUrl: null,
          status: "pending",
          currentStep: 0,
          progress: 0,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => {
          state.tasks.push(newTask);
        });

        return id;
      },

      createEmptyTasks: (count) => {
        const ids: string[] = [];
        const { globalSettings } = get();

        const newTasks: VideoBatchTask[] = Array.from({ length: count }, () => {
          const id = generateId();
          ids.push(id);

          return {
            id,
            images: [],
            aspectRatio: globalSettings.aspectRatio,
            doubaoTalkingScript: null,
            doubaoAiVideoPrompt: null,
            soraTaskId: null,
            soraVideoUrl: null,
            status: "pending" as const,
            currentStep: 0 as PipelineStep,
            progress: 0,
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });

        set((state) => {
          state.tasks.push(...newTasks);
        });

        return ids;
      },

      cloneTask: (taskId) => {
        const { tasks, globalSettings } = get();
        const sourceTask = tasks.find((t) => t.id === taskId);
        
        if (!sourceTask) return null;

        const newId = generateId();
        
        // 深拷贝图片（创建新的 ID）
        const clonedImages = sourceTask.images.map((img, index) => ({
          ...img,
          id: generateImageId(),
          order: index,
        }));

        const clonedTask: VideoBatchTask = {
          id: newId,
          images: clonedImages,
          aspectRatio: sourceTask.aspectRatio,
          doubaoTalkingScript: null,  // 重置生成结果
          doubaoAiVideoPrompt: null,
          soraTaskId: null,
          soraVideoUrl: null,
          status: "pending",
          currentStep: 0,
          progress: 0,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => {
          // 在源任务后面插入克隆的任务
          const sourceIndex = state.tasks.findIndex((t) => t.id === taskId);
          if (sourceIndex !== -1) {
            state.tasks.splice(sourceIndex + 1, 0, clonedTask);
          } else {
            state.tasks.push(clonedTask);
          }
        });

        return newId;
      },

      createTasksFromImageGroups: (imageGroups) => {
        const ids: string[] = [];
        const { globalSettings } = get();

        const newTasks: VideoBatchTask[] = imageGroups.map((images) => {
          const id = generateId();
          ids.push(id);

          const processedImages = images.map((img, index) => ({
            ...img,
            id: img.id || generateImageId(),
            order: index,
            isMainGrid: index === 0,
          }));

          return {
            id,
            images: processedImages,
            aspectRatio: globalSettings.aspectRatio,
            doubaoTalkingScript: null,
            doubaoAiVideoPrompt: null,
            soraTaskId: null,
            soraVideoUrl: null,
            status: "pending" as const,
            currentStep: 0 as PipelineStep,
            progress: 0,
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });

        set((state) => {
          state.tasks.push(...newTasks);
        });

        return ids;
      },

      updateTaskStatus: (taskId, status, extra) => {
        set((state) => {
          const taskIndex = state.tasks.findIndex((t) => t.id === taskId);
          if (taskIndex !== -1) {
            const task = state.tasks[taskIndex];
            // 防止状态被错误覆盖：如果任务已经成功，不允许被设置为失败（除非是明确的重置）
            if (task.status === "success" && status === "failed") {
              console.warn(`[VideoBatchStore] Ignoring status change from success to failed for task ${taskId}`);
              return;
            }
            task.status = status;
            task.updatedAt = new Date().toISOString();
            if (extra) {
              // 使用展开运算符确保正确的属性合并
              if (extra.currentStep !== undefined) task.currentStep = extra.currentStep;
              if (extra.progress !== undefined) task.progress = extra.progress;
              if (extra.errorMessage !== undefined) task.errorMessage = extra.errorMessage;
              if (extra.doubaoTalkingScript !== undefined) task.doubaoTalkingScript = extra.doubaoTalkingScript;
              if (extra.doubaoAiVideoPrompt !== undefined) task.doubaoAiVideoPrompt = extra.doubaoAiVideoPrompt;
              if (extra.soraTaskId !== undefined) task.soraTaskId = extra.soraTaskId;
              if (extra.soraVideoUrl !== undefined) task.soraVideoUrl = extra.soraVideoUrl;
            }
            console.log(`[VideoBatchStore] Task ${taskId} status updated to ${status}`, extra);
          }
        });
      },

      updateTaskImages: (taskId, images) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            task.images = images.map((img, index) => ({
              ...img,
              order: index,
              isMainGrid: index === 0,
            }));
            task.updatedAt = new Date().toISOString();
          }
        });
      },

      addImagesToTask: (taskId, images) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            const startOrder = task.images.length;
            const newImages = images.map((img, index) => ({
              ...img,
              id: img.id || generateImageId(),
              order: startOrder + index,
              isMainGrid: false, // 新添加的图片不是主图
            }));
            task.images.push(...newImages);
            task.updatedAt = new Date().toISOString();
          }
        });
      },

      removeImageFromTask: (taskId, imageId) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            const removedImage = task.images.find((img) => img.id === imageId);
            task.images = task.images
              .filter((img) => img.id !== imageId)
              .map((img, index) => ({
                ...img,
                order: index,
                // 如果删除的是主图，将新的第一张设为主图
                isMainGrid: index === 0,
              }));
            
            // 清理 blob URL
            if (removedImage?.url.startsWith("blob:")) {
              URL.revokeObjectURL(removedImage.url);
            }
            
            task.updatedAt = new Date().toISOString();
          }
        });
      },

      reorderTaskImages: (taskId, fromIndex, toIndex) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            const [removed] = task.images.splice(fromIndex, 1);
            task.images.splice(toIndex, 0, removed);
            
            // 重新计算 order 和 isMainGrid
            task.images = task.images.map((img, index) => ({
              ...img,
              order: index,
              isMainGrid: index === 0,
            }));
            
            task.updatedAt = new Date().toISOString();
          }
        });
      },

      setMainGridImage: (taskId, imageId) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            // 找到目标图片
            const targetIndex = task.images.findIndex((img) => img.id === imageId);
            if (targetIndex > 0) {
              // 将目标图片移到第一位
              const [targetImage] = task.images.splice(targetIndex, 1);
              task.images.unshift(targetImage);
              
              // 重新计算 order 和 isMainGrid
              task.images = task.images.map((img, index) => ({
                ...img,
                order: index,
                isMainGrid: index === 0,
              }));
            }
            task.updatedAt = new Date().toISOString();
          }
        });
      },

      removeTask: (taskId) => {
        set((state) => {
          const task = state.tasks.find((t) => t.id === taskId);
          if (task) {
            // 清理 blob URLs
            task.images.forEach((img) => {
              if (img.url.startsWith("blob:")) {
                URL.revokeObjectURL(img.url);
              }
            });
          }
          state.tasks = state.tasks.filter((t) => t.id !== taskId);
          delete state.selectedTaskIds[taskId];
        });
      },

      removeTasks: (taskIds) => {
        const idsSet = new Set(taskIds);
        set((state) => {
          state.tasks.forEach((task) => {
            if (idsSet.has(task.id)) {
              task.images.forEach((img) => {
                if (img.url.startsWith("blob:")) {
                  URL.revokeObjectURL(img.url);
                }
              });
            }
          });
          state.tasks = state.tasks.filter((t) => !idsSet.has(t.id));
          taskIds.forEach((id) => delete state.selectedTaskIds[id]);
        });
      },

      clearAllTasks: () => {
        const { tasks } = get();
        tasks.forEach((task) => {
          task.images.forEach((img) => {
            if (img.url.startsWith("blob:")) {
              URL.revokeObjectURL(img.url);
            }
          });
        });
        set((state) => {
          state.tasks = [];
          state.selectedTaskIds = {};
          state.jobStatus = "idle";
          state.editingTaskId = null;
        });
      },

      // ==================== 选择管理 ====================

      toggleTaskSelection: (taskId) => {
        set((state) => {
          if (state.selectedTaskIds[taskId]) {
            delete state.selectedTaskIds[taskId];
          } else {
            state.selectedTaskIds[taskId] = true;
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
          state.tasks.forEach((t) => {
            if (t.status !== "success") {
              t.status = "pending";
              t.currentStep = 0;
              t.progress = 0;
              t.errorMessage = null;
            }
          });
        });
      },

      // ==================== 全局设置 ====================

      updateGlobalSettings: (key, value) => {
        set((state) => {
          (state.globalSettings as Record<string, unknown>)[key] = value;
        });
      },

      setEditingTask: (taskId) => {
        set((state) => {
          state.editingTaskId = taskId;
        });
      },
    })),
    { name: "VideoBatchStore" }
  ),
  {
    name: "video-batch-storage",
    storage: createJSONStorage(() => {
      // 只在客户端使用 localStorage
      if (typeof window !== "undefined") {
        return localStorage;
      }
      // 服务端返回空存储
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };
    }),
    // 只持久化任务和全局设置，不持久化临时状态
    partialize: (state) => ({
      tasks: state.tasks.map(task => ({
        ...task,
        // 清理 blob URLs，只保留已上传的 http URLs
        images: task.images.map(img => ({
          ...img,
          url: img.url.startsWith("blob:") ? "" : img.url,
          file: undefined, // 不持久化文件对象
        })).filter(img => img.url), // 移除空 URL 的图片
      })),
      globalSettings: state.globalSettings,
      // 如果页面刷新时正在运行，标记为需要恢复
      jobStatus: ["running", "paused"].includes(state.jobStatus) ? "paused" : state.jobStatus,
    }),
    // 恢复时处理
    onRehydrateStorage: () => (state) => {
      if (state) {
        console.log("[VideoBatchStore] Rehydrated from localStorage:", {
          taskCount: state.tasks.length,
          jobStatus: state.jobStatus,
        });
        // 将正在处理中的任务重置为待处理
        state.tasks.forEach(task => {
          if (["uploading", "generating_script", "generating_prompt", "generating_video"].includes(task.status)) {
            task.status = "pending";
            task.currentStep = 0;
            task.progress = 0;
            task.errorMessage = "任务被中断，请重新开始";
          }
        });
      }
    },
  }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useVideoBatchTasks = () => useVideoBatchStore((state) => state.tasks);
export const useVideoBatchJobStatus = () => useVideoBatchStore((state) => state.jobStatus);
export const useVideoBatchGlobalSettings = () => useVideoBatchStore((state) => state.globalSettings);
export const useVideoBatchSelectedIds = () => useVideoBatchStore((state) => state.selectedTaskIds);
export const useVideoBatchSelectedCount = () => useVideoBatchStore((state) => Object.keys(state.selectedTaskIds).length);

export const useVideoBatchStats = () => {
  const tasks = useVideoBatchStore((state) => state.tasks);
  const globalSettings = useVideoBatchStore((state) => state.globalSettings);
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => 
      ["uploading", "generating_script", "generating_prompt", "generating_video"].includes(t.status)
    ).length,
    success: tasks.filter((t) => t.status === "success").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    totalCost: getVideoBatchTotalCost(tasks, globalSettings),
  };
};

