/**
 * 电商图片工厂 - Zustand Store
 * 
 * 管理 /image-factory 页面的状态
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  type EcomImageMode,
  type EcomTaskStatus,
  type ImageModelType,
  type EcomLanguage,
  type EcomAspectRatio,
  type EcomResolution,
  type ModeConfig,
  type EcomPrompts,
  type OutputItem,
  type UploadedImage,
  type StepStatus,
  type EcomImageTask,
  type EcomFivePackConfig,
  type SceneImageConfig,
  type TryOnConfig,
  type BuyerShowConfig,
  ECOM_MODE_CONFIG,
} from "@/types/ecom-image";

// ============================================================================
// 类型定义
// ============================================================================

/** Store 状态 */
interface ImageFactoryState {
  // 当前模式
  currentMode: EcomImageMode;
  
  // 全局配置
  modelType: ImageModelType;
  language: EcomLanguage;
  ratio: EcomAspectRatio;
  resolution: EcomResolution;
  isOneClick: boolean;
  
  // 上传的图片
  uploadedImages: UploadedImage[];
  
  // 模式特有配置
  ecomFivePackConfig: EcomFivePackConfig;
  sceneImageConfig: SceneImageConfig;
  tryOnConfig: TryOnConfig;
  buyerShowConfig: BuyerShowConfig;
  
  // 当前任务
  currentTask: EcomImageTask | null;
  
  // 步骤状态
  currentStep: number;
  stepStatuses: Record<number, StepStatus>;
  
  // 提示词（用于手动模式编辑）
  editablePrompts: Record<string, string>;
  
  // 加载状态
  isCreatingTask: boolean;
  isGeneratingPrompts: boolean;
  isGeneratingImages: boolean;
  isPolling: boolean;
  
  // 错误信息
  error: string | null;
}

/** Store Actions */
interface ImageFactoryActions {
  // 模式切换
  setCurrentMode: (mode: EcomImageMode) => void;
  
  // 配置更新
  setModelType: (type: ImageModelType) => void;
  setLanguage: (lang: EcomLanguage) => void;
  setRatio: (ratio: EcomAspectRatio) => void;
  setResolution: (res: EcomResolution) => void;
  setIsOneClick: (value: boolean) => void;
  
  // 图片管理
  addImages: (images: UploadedImage[]) => void;
  removeImage: (id: string) => void;
  reorderImages: (fromIndex: number, toIndex: number) => void;
  updateImageStatus: (id: string, updates: Partial<UploadedImage>) => void;
  clearImages: () => void;
  
  // 模式配置更新
  updateEcomFivePackConfig: (config: Partial<EcomFivePackConfig>) => void;
  updateSceneImageConfig: (config: Partial<SceneImageConfig>) => void;
  updateTryOnConfig: (config: Partial<TryOnConfig>) => void;
  updateBuyerShowConfig: (config: Partial<BuyerShowConfig>) => void;
  
  // 任务管理
  setCurrentTask: (task: EcomImageTask | null) => void;
  updateCurrentTask: (updates: Partial<EcomImageTask>) => void;
  
  // 步骤管理
  setCurrentStep: (step: number) => void;
  setStepStatus: (step: number, status: StepStatus) => void;
  
  // 提示词编辑
  setEditablePrompts: (prompts: Record<string, string>) => void;
  updateEditablePrompt: (key: string, value: string) => void;
  
  // 加载状态
  setIsCreatingTask: (value: boolean) => void;
  setIsGeneratingPrompts: (value: boolean) => void;
  setIsGeneratingImages: (value: boolean) => void;
  setIsPolling: (value: boolean) => void;
  
  // 错误处理
  setError: (error: string | null) => void;
  
  // 重置
  resetTask: () => void;
  resetAll: () => void;
}

type ImageFactoryStore = ImageFactoryState & ImageFactoryActions;

// ============================================================================
// 初始状态
// ============================================================================

const initialState: ImageFactoryState = {
  currentMode: "ecom_five_pack",
  
  modelType: "nano-banana",
  language: "zh",
  ratio: "auto",
  resolution: "1k",
  isOneClick: true,
  
  uploadedImages: [],
  
  ecomFivePackConfig: {
    product_category: undefined,
  },
  sceneImageConfig: {
    scene_type: "smart_recommend",
  },
  tryOnConfig: {
    model_id: "",
    model_name: "",
    model_trigger_word: "",
    product_type: "clothing",
  },
  buyerShowConfig: {
    style: "selfie",
    persona: {
      age: "25-35",
      gender: "female",
      region: "china",
    },
  },
  
  currentTask: null,
  
  currentStep: 1,
  stepStatuses: {
    1: "pending",
    2: "pending",
    3: "pending",
  },
  
  editablePrompts: {},
  
  isCreatingTask: false,
  isGeneratingPrompts: false,
  isGeneratingImages: false,
  isPolling: false,
  
  error: null,
};

// ============================================================================
// Store 创建
// ============================================================================

export const useImageFactoryStore = create<ImageFactoryStore>()(
  persist(
    immer((set, get) => ({
      ...initialState,
      
      // ========================
      // 模式切换
      // ========================
      setCurrentMode: (mode) => set((state) => {
        state.currentMode = mode;
        // 切换模式时重置任务状态
        state.currentTask = null;
        state.currentStep = 1;
        state.stepStatuses = { 1: "pending", 2: "pending", 3: "pending" };
        state.editablePrompts = {};
        state.error = null;
      }),
      
      // ========================
      // 配置更新
      // ========================
      setModelType: (type) => set((state) => {
        state.modelType = type;
      }),
      
      setLanguage: (lang) => set((state) => {
        state.language = lang;
      }),
      
      setRatio: (ratio) => set((state) => {
        state.ratio = ratio;
      }),
      
      setResolution: (res) => set((state) => {
        state.resolution = res;
      }),
      
      setIsOneClick: (value) => set((state) => {
        state.isOneClick = value;
      }),
      
      // ========================
      // 图片管理
      // ========================
      addImages: (images) => set((state) => {
        state.uploadedImages.push(...images);
      }),
      
      removeImage: (id) => set((state) => {
        state.uploadedImages = state.uploadedImages.filter((img) => img.id !== id);
      }),
      
      reorderImages: (fromIndex, toIndex) => set((state) => {
        const images = [...state.uploadedImages];
        const [removed] = images.splice(fromIndex, 1);
        images.splice(toIndex, 0, removed);
        state.uploadedImages = images;
      }),
      
      updateImageStatus: (id, updates) => set((state) => {
        const index = state.uploadedImages.findIndex((img) => img.id === id);
        if (index !== -1) {
          Object.assign(state.uploadedImages[index], updates);
        }
      }),
      
      clearImages: () => set((state) => {
        state.uploadedImages = [];
      }),
      
      // ========================
      // 模式配置更新
      // ========================
      updateEcomFivePackConfig: (config) => set((state) => {
        Object.assign(state.ecomFivePackConfig, config);
      }),
      
      updateSceneImageConfig: (config) => set((state) => {
        Object.assign(state.sceneImageConfig, config);
      }),
      
      updateTryOnConfig: (config) => set((state) => {
        Object.assign(state.tryOnConfig, config);
      }),
      
      updateBuyerShowConfig: (config) => set((state) => {
        Object.assign(state.buyerShowConfig, config);
      }),
      
      // ========================
      // 任务管理
      // ========================
      setCurrentTask: (task) => set((state) => {
        state.currentTask = task;
        if (task) {
          state.currentStep = task.current_step;
          // 更新步骤状态
          if (task.status === "created") {
            state.stepStatuses = { 1: "completed", 2: "pending", 3: "pending" };
          } else if (task.status === "generating_prompts") {
            state.stepStatuses = { 1: "completed", 2: "active", 3: "pending" };
          } else if (task.status === "generating_images") {
            state.stepStatuses = { 1: "completed", 2: "completed", 3: "active" };
          } else if (task.status === "success" || task.status === "partial_success") {
            state.stepStatuses = { 1: "completed", 2: "completed", 3: "completed" };
          } else if (task.status === "failed") {
            const failedStep = task.current_step;
            state.stepStatuses = {
              1: failedStep === 1 ? "failed" : "completed",
              2: failedStep === 2 ? "failed" : failedStep > 2 ? "completed" : "pending",
              3: failedStep === 3 ? "failed" : "pending",
            };
          }
        }
      }),
      
      updateCurrentTask: (updates) => set((state) => {
        if (state.currentTask) {
          Object.assign(state.currentTask, updates);
        }
      }),
      
      // ========================
      // 步骤管理
      // ========================
      setCurrentStep: (step) => set((state) => {
        state.currentStep = step;
      }),
      
      setStepStatus: (step, status) => set((state) => {
        state.stepStatuses[step] = status;
      }),
      
      // ========================
      // 提示词编辑
      // ========================
      setEditablePrompts: (prompts) => set((state) => {
        state.editablePrompts = prompts;
      }),
      
      updateEditablePrompt: (key, value) => set((state) => {
        state.editablePrompts[key] = value;
      }),
      
      // ========================
      // 加载状态
      // ========================
      setIsCreatingTask: (value) => set((state) => {
        state.isCreatingTask = value;
      }),
      
      setIsGeneratingPrompts: (value) => set((state) => {
        state.isGeneratingPrompts = value;
      }),
      
      setIsGeneratingImages: (value) => set((state) => {
        state.isGeneratingImages = value;
      }),
      
      setIsPolling: (value) => set((state) => {
        state.isPolling = value;
      }),
      
      // ========================
      // 错误处理
      // ========================
      setError: (error) => set((state) => {
        state.error = error;
      }),
      
      // ========================
      // 重置
      // ========================
      resetTask: () => set((state) => {
        state.currentTask = null;
        state.currentStep = 1;
        state.stepStatuses = { 1: "pending", 2: "pending", 3: "pending" };
        state.editablePrompts = {};
        state.error = null;
        state.isCreatingTask = false;
        state.isGeneratingPrompts = false;
        state.isGeneratingImages = false;
        state.isPolling = false;
      }),
      
      resetAll: () => set(() => initialState),
    })),
    {
      name: "image-factory-store",
      // 只持久化部分状态
      partialize: (state) => ({
        currentMode: state.currentMode,
        modelType: state.modelType,
        language: state.language,
        ratio: state.ratio,
        resolution: state.resolution,
        isOneClick: state.isOneClick,
        ecomFivePackConfig: state.ecomFivePackConfig,
        sceneImageConfig: state.sceneImageConfig,
        buyerShowConfig: state.buyerShowConfig,
      }),
    }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

/** 获取当前模式配置 */
export const useCurrentModeConfig = () => {
  const currentMode = useImageFactoryStore((state) => state.currentMode);
  return ECOM_MODE_CONFIG[currentMode];
};

/** 获取当前模式的特有配置 */
export const useModeSpecificConfig = (): ModeConfig => {
  const currentMode = useImageFactoryStore((state) => state.currentMode);
  const ecomFivePackConfig = useImageFactoryStore((state) => state.ecomFivePackConfig);
  const sceneImageConfig = useImageFactoryStore((state) => state.sceneImageConfig);
  const tryOnConfig = useImageFactoryStore((state) => state.tryOnConfig);
  const buyerShowConfig = useImageFactoryStore((state) => state.buyerShowConfig);
  
  switch (currentMode) {
    case "ecom_five_pack":
      return ecomFivePackConfig;
    case "scene_image":
      return sceneImageConfig;
    case "try_on":
      return tryOnConfig;
    case "buyer_show":
      return buyerShowConfig;
    default:
      return {};
  }
};

/** 获取上传图片数量 */
export const useUploadedImageCount = () => {
  return useImageFactoryStore((state) => state.uploadedImages.length);
};

/** 获取是否可以开始任务 */
export const useCanStartTask = () => {
  const uploadedImages = useImageFactoryStore((state) => state.uploadedImages);
  const currentMode = useImageFactoryStore((state) => state.currentMode);
  const tryOnConfig = useImageFactoryStore((state) => state.tryOnConfig);
  const isCreatingTask = useImageFactoryStore((state) => state.isCreatingTask);
  const isGeneratingPrompts = useImageFactoryStore((state) => state.isGeneratingPrompts);
  const isGeneratingImages = useImageFactoryStore((state) => state.isGeneratingImages);
  
  // 正在处理中
  if (isCreatingTask || isGeneratingPrompts || isGeneratingImages) {
    return false;
  }
  
  // 需要至少一张图片
  if (uploadedImages.length === 0) {
    return false;
  }
  
  // 试穿模式需要选择模特
  if (currentMode === "try_on" && !tryOnConfig.model_id) {
    return false;
  }
  
  return true;
};

/** 获取当前任务是否正在进行 */
export const useIsTaskInProgress = () => {
  const currentTask = useImageFactoryStore((state) => state.currentTask);
  if (!currentTask) return false;
  
  return ["created", "generating_prompts", "generating_images"].includes(currentTask.status);
};

/** 获取步骤列表 */
export const useSteps = () => {
  const currentMode = useImageFactoryStore((state) => state.currentMode);
  const stepStatuses = useImageFactoryStore((state) => state.stepStatuses);
  const modeConfig = ECOM_MODE_CONFIG[currentMode];
  
  const steps = [
    {
      id: 1,
      title: "上传图片",
      description: "上传产品图片并设置参数",
      status: stepStatuses[1],
    },
  ];
  
  if (modeConfig.needsPromptGeneration) {
    steps.push({
      id: 2,
      title: "生成提示词",
      description: "AI 分析图片生成优化提示词",
      status: stepStatuses[2],
    });
  }
  
  steps.push({
    id: modeConfig.needsPromptGeneration ? 3 : 2,
    title: "生成图片",
    description: "AI 根据提示词生成图片",
    status: stepStatuses[modeConfig.needsPromptGeneration ? 3 : 2],
  });
  
  return steps;
};

// ============================================================================
// 积分计算
// ============================================================================

import { IMAGE_CREDITS } from "@/lib/credits";

/** 计算任务积分消耗 */
export function calculateTaskCredits(
  mode: EcomImageMode,
  modelType: ImageModelType,
  imageCount: number
): number {
  const unitCost = IMAGE_CREDITS[modelType];
  
  if (mode === "ecom_five_pack") {
    // 电商五图套装固定生成5张
    return unitCost * 5;
  }
  
  // 其他模式按输入图片数量计费
  return unitCost * imageCount;
}

/** 获取当前任务的积分消耗 */
export const useTaskCredits = () => {
  const currentMode = useImageFactoryStore((state) => state.currentMode);
  const modelType = useImageFactoryStore((state) => state.modelType);
  const uploadedImages = useImageFactoryStore((state) => state.uploadedImages);
  
  return calculateTaskCredits(currentMode, modelType, uploadedImages.length);
};


