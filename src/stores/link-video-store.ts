/**
 * 链接秒变视频 Zustand Store
 * 
 * 管理整个链接转视频流程的状态
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  LinkVideoJob,
  LinkVideoJobStatus,
  VideoConfig,
  ParsedProductData,
  ManualProductInfo,
  ProductImage,
  DEFAULT_VIDEO_CONFIG,
} from '@/types/link-video';

// ============================================================================
// 状态类型
// ============================================================================

interface LinkVideoState {
  // 当前任务
  currentJob: LinkVideoJob | null;
  
  // 步骤控制
  currentStep: number;  // 1-5
  
  // Step 1: 链接输入
  inputUrl: string;
  isParsingLink: boolean;
  parsedData: ParsedProductData | null;
  parseError: string | null;
  productLinkId: string | null;
  
  // 图片选择
  selectedImages: ProductImage[];
  primaryImageUrl: string | null;
  
  // Step 2: 视频配置
  videoConfig: VideoConfig;
  selectedModelId: string | null;
  
  // Step 3: 脚本
  scriptText: string;
  isGeneratingScript: boolean;
  scriptError: string | null;
  scriptVersion: number;
  
  // Step 4: 九宫格
  gridImageUrl: string | null;
  isGeneratingGrid: boolean;
  gridError: string | null;
  gridTaskId: string | null;
  
  // Step 5: 视频
  videoUrl: string | null;
  isGeneratingVideo: boolean;
  videoError: string | null;
  videoTaskId: string | null;
  videoProgress: number;
  
  // 手动模式
  isManualMode: boolean;
  manualProductInfo: ManualProductInfo | null;
  
  // 全局状态
  isLoading: boolean;
  error: string | null;
}

interface LinkVideoActions {
  // 步骤导航
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  
  // Step 1: 链接解析
  setInputUrl: (url: string) => void;
  startParseLink: () => void;
  setParsedData: (data: ParsedProductData, productLinkId: string) => void;
  setParseError: (error: string) => void;
  
  // 图片选择
  toggleImageSelection: (imageUrl: string) => void;
  setPrimaryImage: (imageUrl: string) => void;
  setSelectedImages: (images: ProductImage[]) => void;
  
  // Step 2: 配置
  setVideoConfig: (config: Partial<VideoConfig>) => void;
  setSelectedModelId: (modelId: string | null) => void;
  
  // Step 3: 脚本
  setScriptText: (text: string) => void;
  startGenerateScript: () => void;
  setScriptGenerated: (script: string, version: number) => void;
  setScriptError: (error: string) => void;
  
  // Step 4: 九宫格
  startGenerateGrid: () => void;
  setGridGenerated: (url: string) => void;
  setGridTaskId: (taskId: string) => void;
  setGridError: (error: string) => void;
  
  // Step 5: 视频
  startGenerateVideo: () => void;
  setVideoGenerated: (url: string) => void;
  setVideoTaskId: (taskId: string) => void;
  setVideoProgress: (progress: number) => void;
  setVideoError: (error: string) => void;
  
  // 手动模式
  enableManualMode: () => void;
  setManualProductInfo: (info: ManualProductInfo) => void;
  
  // 任务管理
  setCurrentJob: (job: LinkVideoJob | null) => void;
  updateJobStatus: (status: LinkVideoJobStatus) => void;
  
  // 重置
  reset: () => void;
  resetStep: (step: number) => void;
  
  // 全局
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type LinkVideoStore = LinkVideoState & LinkVideoActions;

// ============================================================================
// 初始状态
// ============================================================================

const initialState: LinkVideoState = {
  currentJob: null,
  currentStep: 1,
  
  inputUrl: '',
  isParsingLink: false,
  parsedData: null,
  parseError: null,
  productLinkId: null,
  
  selectedImages: [],
  primaryImageUrl: null,
  
  videoConfig: {
    duration: 15,
    aspect_ratio: '9:16',
    video_style: 'selfie_talking',
    platform_style: 'tiktok_us',
    language: 'en',
  },
  selectedModelId: null,
  
  scriptText: '',
  isGeneratingScript: false,
  scriptError: null,
  scriptVersion: 0,
  
  gridImageUrl: null,
  isGeneratingGrid: false,
  gridError: null,
  gridTaskId: null,
  
  videoUrl: null,
  isGeneratingVideo: false,
  videoError: null,
  videoTaskId: null,
  videoProgress: 0,
  
  isManualMode: false,
  manualProductInfo: null,
  
  isLoading: false,
  error: null,
};

// ============================================================================
// Store 创建
// ============================================================================

export const useLinkVideoStore = create<LinkVideoStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ========================================
      // 步骤导航
      // ========================================
      
      setStep: (step) => set({ currentStep: step }),
      
      nextStep: () => {
        const { currentStep } = get();
        if (currentStep < 5) {
          set({ currentStep: currentStep + 1 });
        }
      },
      
      prevStep: () => {
        const { currentStep } = get();
        if (currentStep > 1) {
          set({ currentStep: currentStep - 1 });
        }
      },

      // ========================================
      // Step 1: 链接解析
      // ========================================
      
      setInputUrl: (url) => set({ inputUrl: url, parseError: null }),
      
      startParseLink: () => set({ 
        isParsingLink: true, 
        parseError: null,
        parsedData: null,
      }),
      
      setParsedData: (data, productLinkId) => {
        // 自动选择所有图片，第一张为主图
        const selectedImages = data.images.map((img, idx) => ({
          ...img,
          selected: true,
          is_primary: idx === 0,
        }));
        
        set({
          isParsingLink: false,
          parsedData: data,
          productLinkId,
          parseError: null,
          selectedImages,
          primaryImageUrl: selectedImages.find(i => i.is_primary)?.url || null,
          isManualMode: false,
        });
      },
      
      setParseError: (error) => set({
        isParsingLink: false,
        parseError: error,
      }),

      // ========================================
      // 图片选择
      // ========================================
      
      toggleImageSelection: (imageUrl) => {
        const { selectedImages } = get();
        set({
          selectedImages: selectedImages.map(img =>
            img.url === imageUrl ? { ...img, selected: !img.selected } : img
          ),
        });
      },
      
      setPrimaryImage: (imageUrl) => {
        const { selectedImages } = get();
        set({
          selectedImages: selectedImages.map(img => ({
            ...img,
            is_primary: img.url === imageUrl,
          })),
          primaryImageUrl: imageUrl,
        });
      },
      
      setSelectedImages: (images) => set({ 
        selectedImages: images,
        primaryImageUrl: images.find(i => i.is_primary)?.url || images[0]?.url || null,
      }),

      // ========================================
      // Step 2: 配置
      // ========================================
      
      setVideoConfig: (config) => set(state => ({
        videoConfig: { ...state.videoConfig, ...config },
      })),
      
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),

      // ========================================
      // Step 3: 脚本
      // ========================================
      
      setScriptText: (text) => set({ scriptText: text }),
      
      startGenerateScript: () => set({
        isGeneratingScript: true,
        scriptError: null,
      }),
      
      setScriptGenerated: (script, version) => set({
        isGeneratingScript: false,
        scriptText: script,
        scriptVersion: version,
        scriptError: null,
      }),
      
      setScriptError: (error) => set({
        isGeneratingScript: false,
        scriptError: error,
      }),

      // ========================================
      // Step 4: 九宫格
      // ========================================
      
      startGenerateGrid: () => set({
        isGeneratingGrid: true,
        gridError: null,
        gridImageUrl: null,
      }),
      
      setGridGenerated: (url) => set({
        isGeneratingGrid: false,
        gridImageUrl: url,
        gridError: null,
      }),
      
      setGridTaskId: (taskId) => set({ gridTaskId: taskId }),
      
      setGridError: (error) => set({
        isGeneratingGrid: false,
        gridError: error,
      }),

      // ========================================
      // Step 5: 视频
      // ========================================
      
      startGenerateVideo: () => set({
        isGeneratingVideo: true,
        videoError: null,
        videoUrl: null,
        videoProgress: 0,
      }),
      
      setVideoGenerated: (url) => set({
        isGeneratingVideo: false,
        videoUrl: url,
        videoError: null,
        videoProgress: 100,
      }),
      
      setVideoTaskId: (taskId) => set({ videoTaskId: taskId }),
      
      setVideoProgress: (progress) => set({ videoProgress: progress }),
      
      setVideoError: (error) => set({
        isGeneratingVideo: false,
        videoError: error,
      }),

      // ========================================
      // 手动模式
      // ========================================
      
      enableManualMode: () => set({ 
        isManualMode: true,
        parsedData: null,
        productLinkId: null,
      }),
      
      setManualProductInfo: (info) => {
        const images: ProductImage[] = info.images.map((url, idx) => ({
          url,
          type: 'main' as const,
          selected: true,
          is_primary: idx === 0,
        }));
        
        set({
          manualProductInfo: info,
          selectedImages: images,
          primaryImageUrl: images[0]?.url || null,
        });
      },

      // ========================================
      // 任务管理
      // ========================================
      
      setCurrentJob: (job) => set({ currentJob: job }),
      
      updateJobStatus: (status) => set(state => ({
        currentJob: state.currentJob ? { ...state.currentJob, status } : null,
      })),

      // ========================================
      // 重置
      // ========================================
      
      reset: () => set(initialState),
      
      resetStep: (step) => {
        switch (step) {
          case 1:
            set({
              inputUrl: '',
              parsedData: null,
              parseError: null,
              productLinkId: null,
              selectedImages: [],
              primaryImageUrl: null,
              isManualMode: false,
              manualProductInfo: null,
            });
            break;
          case 2:
            set({
              videoConfig: initialState.videoConfig,
              selectedModelId: null,
            });
            break;
          case 3:
            set({
              scriptText: '',
              scriptError: null,
              scriptVersion: 0,
            });
            break;
          case 4:
            set({
              gridImageUrl: null,
              gridError: null,
              gridTaskId: null,
            });
            break;
          case 5:
            set({
              videoUrl: null,
              videoError: null,
              videoTaskId: null,
              videoProgress: 0,
            });
            break;
        }
      },

      // ========================================
      // 全局
      // ========================================
      
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'link-video-store',
      storage: createJSONStorage(() => localStorage), // 使用 localStorage，持久化保存
      partialize: (state) => ({
        // 持久化所有关键状态，确保离开页面后任务可以恢复
        currentStep: state.currentStep,
        inputUrl: state.inputUrl,
        parsedData: state.parsedData,
        productLinkId: state.productLinkId,
        selectedImages: state.selectedImages,
        primaryImageUrl: state.primaryImageUrl,
        videoConfig: state.videoConfig,
        selectedModelId: state.selectedModelId,
        scriptText: state.scriptText,
        scriptVersion: state.scriptVersion,
        isManualMode: state.isManualMode,
        manualProductInfo: state.manualProductInfo,
        currentJob: state.currentJob,
        // 新增：持久化生成状态
        gridImageUrl: state.gridImageUrl,
        gridTaskId: state.gridTaskId,
        videoUrl: state.videoUrl,
        videoTaskId: state.videoTaskId,
        videoProgress: state.videoProgress,
        // 持久化生成中状态，便于恢复轮询
        isGeneratingGrid: state.isGeneratingGrid,
        isGeneratingVideo: state.isGeneratingVideo,
      }),
    }
  )
);

// ============================================================================
// 选择器 Hooks
// ============================================================================

/** 获取当前步骤是否可以继续 */
export function useCanProceed(): boolean {
  const store = useLinkVideoStore();
  
  switch (store.currentStep) {
    case 1:
      // Step 1: 需要有解析数据或手动输入，且选中了主图
      return (
        (store.parsedData !== null || store.manualProductInfo !== null) &&
        store.primaryImageUrl !== null
      );
    case 2:
      // Step 2: 配置总是可以继续
      return true;
    case 3:
      // Step 3: 需要有脚本
      return store.scriptText.trim().length > 0;
    case 4:
      // Step 4: 需要有九宫格图片
      return store.gridImageUrl !== null;
    case 5:
      // Step 5: 完成
      return store.videoUrl !== null;
    default:
      return false;
  }
}

/** 获取当前是否在加载中 */
export function useIsStepLoading(): boolean {
  const store = useLinkVideoStore();
  return (
    store.isParsingLink ||
    store.isGeneratingScript ||
    store.isGeneratingGrid ||
    store.isGeneratingVideo
  );
}

/** 获取当前步骤的错误 */
export function useStepError(): string | null {
  const store = useLinkVideoStore();
  
  switch (store.currentStep) {
    case 1:
      return store.parseError;
    case 3:
      return store.scriptError;
    case 4:
      return store.gridError;
    case 5:
      return store.videoError;
    default:
      return store.error;
  }
}




