/**
 * Character Studio Store — V3 全屏步骤流程状态管理
 *
 * V3 变更:
 * - 新增 currentStep (1-4) 控制全屏步骤切换
 * - 写真角色：完整设定板（characterBoardUrl + cropMeta）
 * - 兼容旧字段（heroImageUrl + referenceSheetUrl）
 * - 新增 Step 4 活化视频状态
 * - GenerationStatus 由 currentStep + 子状态替代
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { dnaPromptDict } from "@/app/(main)/character/create/data/dna-options";
import { DEFAULT_DNA } from "@/types/character";
import type { CharacterBoardCropMeta, CharacterDna } from "@/types/character";

// ============================================================================
// 类型定义
// ============================================================================

export type GenerationStatus =
  | "idle"
  | "generating"
  | "polling"
  | "completed"
  | "failed";

export interface CharacterStudioState {
  // 全屏步骤 (1=角色设定, 2=生成中, 3=角色就位, 4=活化角色视频)
  currentStep: 1 | 2 | 3 | 4;

  // 创作模式
  creationMode: "dna" | "freeform";

  // DNA 配置
  dnaConfig: CharacterDna;

  // 提示词
  prompt: string;

  // 参考图
  referenceImageUrl: string | null;

  // 生成状态
  generationStatus: GenerationStatus;
  errorMessage: string | null;

  // 写真角色完整设定板
  characterBoardUrl: string | null;
  characterAvatarUrl: string | null;
  characterBoardCrop: CharacterBoardCropMeta | null;
  characterBoardPrompt: string | null;

  // V3: 兼容旧双图双任务字段
  heroImageUrl: string | null;
  referenceSheetUrl: string | null;
  heroTaskId: string | null;
  referenceTaskId: string | null;
  heroReady: boolean;
  referenceReady: boolean;

  // V3: Step 4 活化
  activationVideoUrl: string | null;
  activationTaskId: string | null;
  isActivating: boolean;

  // V3: Step 3 绽放弹窗
  showRefModal: boolean;

  // V4: 后台孵化——翻译后的英文 prompt
  refPrompt: string | null;

  // 保存阶段
  characterName: string;
  characterTags: string[];
  isSaving: boolean;
  savedCharacterId: string | null;

  // AI 魔法棒
  isEnhancing: boolean;

  // V5: Sora2 影视角色创建
  forgeMode: "veo" | "sora2";
  sora2VideoUrl: string | null;
  sora2VideoOssUrl: string | null;
  sora2VideoTaskId: string | null;
  sora2Pid: string | null;
  sora2PidTaskId: string | null;
  isMinimized: boolean;

  // 用户信息
  userId: string | null;
  userCredits: number;
}

export interface CharacterStudioActions {
  setCreationMode: (mode: "dna" | "freeform") => void;
  updateDnaConfig: (partial: Partial<CharacterDna>) => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrl: (url: string | null) => void;
  buildPromptFromDna: () => string;

  // 步骤控制
  setCurrentStep: (step: 1 | 2 | 3 | 4) => void;

  // 生成流程
  startGeneration: () => void;
  setTaskIds: (heroId: string | null, refId: string | null) => void;
  setHeroResult: (imageUrl: string) => void;
  setCharacterBoardResult: (
    imageUrl: string,
    crop: CharacterBoardCropMeta | null,
    prompt?: string | null,
    avatarUrl?: string | null
  ) => void;
  setReferenceResult: (imageUrl: string) => void;
  setReferenceTaskId: (id: string) => void;
  setGenerationFailed: (error: string) => void;

  // Step 4 活化
  setActivationTaskId: (id: string) => void;
  setIsActivating: (v: boolean) => void;
  setActivationResult: (url: string) => void;

  // Step 3 绽放弹窗
  setShowRefModal: (v: boolean) => void;

  // V4: 后台孵化
  setRefPrompt: (p: string) => void;

  // 保存
  setCharacterName: (name: string) => void;
  setCharacterTags: (tags: string[]) => void;
  setIsSaving: (saving: boolean) => void;
  setSavedCharacterId: (id: string | null) => void;
  setIsEnhancing: (enhancing: boolean) => void;
  setUserInfo: (userId: string, credits: number) => void;

  // V5: Sora2 影视角色
  setForgeMode: (mode: "veo" | "sora2") => void;
  setSora2VideoResult: (url: string) => void;
  setSora2VideoOssUrl: (url: string) => void;
  setSora2Pid: (pid: string) => void;
  setSora2PidTaskId: (taskId: string) => void;
  setIsMinimized: (v: boolean) => void;

  reset: () => void;
}

// ============================================================================
// 初始状态
// ============================================================================

const DEFAULT_DNA_PROMPT =
  "A photorealistic human of a female. Cinematic studio lighting, high quality, 8K.";

const initialState: CharacterStudioState = {
  currentStep: 1,
  creationMode: "freeform",
  dnaConfig: { ...DEFAULT_DNA },
  prompt: "",
  referenceImageUrl: null,
  generationStatus: "idle",
  errorMessage: null,
  characterBoardUrl: null,
  characterAvatarUrl: null,
  characterBoardCrop: null,
  characterBoardPrompt: null,
  heroImageUrl: null,
  referenceSheetUrl: null,
  heroTaskId: null,
  referenceTaskId: null,
  heroReady: false,
  referenceReady: false,
  activationVideoUrl: null,
  activationTaskId: null,
  isActivating: false,
  showRefModal: false,
  refPrompt: null,
  characterName: "",
  characterTags: [],
  isSaving: false,
  savedCharacterId: null,
  isEnhancing: false,
  forgeMode: "veo",
  sora2VideoUrl: null,
  sora2VideoOssUrl: null,
  sora2VideoTaskId: null,
  sora2Pid: null,
  sora2PidTaskId: null,
  isMinimized: false,
  userId: null,
  userCredits: 0,
};

// ============================================================================
// Store 实现
// ============================================================================

export const useCharacterStudioStore = create<
  CharacterStudioState & CharacterStudioActions
>()(
  persist(
    devtools(
      immer((set, get) => ({
        ...initialState,

        setCreationMode: (mode) => {
          set((state) => {
            state.creationMode = mode;
            if (mode === "freeform" && state.prompt === DEFAULT_DNA_PROMPT) {
              state.prompt = "";
            }
            if (mode === "dna" && !state.prompt.trim()) {
              state.prompt = DEFAULT_DNA_PROMPT;
            }
          });
        },

        updateDnaConfig: (partial) => {
          set((state) => {
            Object.assign(state.dnaConfig, partial);
          });
        },

        setPrompt: (prompt) => {
          set((state) => {
            state.prompt = prompt;
          });
        },

        setReferenceImageUrl: (url) => {
          set((state) => {
            state.referenceImageUrl = url;
          });
        },

        buildPromptFromDna: () => {
          const dna = get().dnaConfig;
          const dict = dnaPromptDict;
          const sentences: string[] = [];

          // 1.0 空值早期返回保护
          const hasAnySelection = [
            dna.species, dna.gender, dna.baseDna, dna.ageGroup, dna.bodyType,
            dna.hairStyle, dna.hairColor, dna.outfit,
          ].some((v) => v && dict[v]);
          if (!hasAnySelection) return "";

          // 1.1 按物种分支选择开头模板
          const speciesText = dict[dna.species] || "photorealistic human";
          if (dna.species === "anime") {
            sentences.push(`An ${speciesText}`);
          } else if (dna.species === "animal") {
            sentences.push(`An ${speciesText}`);
          } else {
            sentences.push(`A ${speciesText}`);
          }

          // 1.2 拼装身份特征句（逐字段判空）
          const identityParts: string[] = [];
          if (dna.ageGroup && dict[dna.ageGroup]) identityParts.push(dict[dna.ageGroup]);
          if (dna.gender && dict[dna.gender]) identityParts.push(dict[dna.gender]);
          if (dna.baseDna && dict[dna.baseDna]) identityParts.push(`with ${dict[dna.baseDna]}`);
          if (dna.bodyType && dict[dna.bodyType]) identityParts.push(`${dict[dna.bodyType]} build`);

          if (identityParts.length > 0) {
            // realistic/anime 用 "of a ..." 连接；mascot/animal 用 ", ..." 连接
            if (dna.species === "realistic" || dna.species === "anime") {
              sentences[0] += ` of a ${identityParts.join(", ")}`;
            } else {
              sentences[0] += `, ${identityParts.join(", ")}`;
            }
          }

          // 1.3 拼装发型句（三路分支防空）
          const hasHairStyle = dna.hairStyle && dict[dna.hairStyle];
          const hasHairColor = dna.hairColor && dict[dna.hairColor];
          if (hasHairStyle && hasHairColor) {
            sentences.push(`Featuring ${dict[dna.hairStyle]} in ${dict[dna.hairColor]}`);
          } else if (hasHairStyle) {
            sentences.push(`Featuring ${dict[dna.hairStyle]}`);
          } else if (hasHairColor) {
            sentences.push(`With ${dict[dna.hairColor]}`);
          }

          // 1.4 拼装服装句（判空保护）
          if (dna.outfit && dict[dna.outfit]) {
            sentences.push(`Wearing ${dict[dna.outfit]}`);
          }

          // 1.5 拼装尾句 + 句号连接
          sentences.push("Cinematic studio lighting, high quality, 8K");
          return sentences.join(". ") + ".";
        },

        // ===== 步骤控制 =====

        setCurrentStep: (step) => {
          set((state) => {
            state.currentStep = step;
          });
        },

        // ===== 生成流程 =====

        startGeneration: () => {
          set((state) => {
            state.generationStatus = "generating";
            state.currentStep = 2;
            state.savedCharacterId = null;
            state.isSaving = false;
            state.characterBoardUrl = null;
            state.characterAvatarUrl = null;
            state.characterBoardCrop = null;
            state.characterBoardPrompt = null;
            state.heroImageUrl = null;
            state.referenceSheetUrl = null;
            state.heroTaskId = null;
            state.referenceTaskId = null;
            state.heroReady = false;
            state.referenceReady = false;
            state.errorMessage = null;
            state.refPrompt = null;
            // Sora2 重置
            state.sora2VideoUrl = null;
            state.sora2VideoOssUrl = null;
            state.sora2VideoTaskId = null;
            state.sora2Pid = null;
            state.sora2PidTaskId = null;
            state.isMinimized = false;
          });
        },

        setTaskIds: (heroId, refId) => {
          set((state) => {
            state.generationStatus = "polling";
            state.heroTaskId = heroId;
            state.referenceTaskId = refId;
          });
        },

        setHeroResult: (imageUrl) => {
          set((state) => {
            state.heroImageUrl = imageUrl;
            state.heroReady = true;
            // Hero 完成即跳 Step 3
            if (state.currentStep === 2) {
              state.currentStep = 3;
              state.generationStatus = "completed";
            }
          });
        },

        setCharacterBoardResult: (imageUrl, crop, prompt, avatarUrl) => {
          set((state) => {
            state.characterBoardUrl = imageUrl;
            state.characterAvatarUrl = avatarUrl || state.characterAvatarUrl || null;
            state.characterBoardCrop = crop;
            state.characterBoardPrompt = prompt || state.characterBoardPrompt || state.refPrompt || state.prompt;
            state.heroImageUrl = avatarUrl || imageUrl;
            state.referenceSheetUrl = imageUrl;
            state.heroReady = true;
            state.referenceReady = true;
            state.referenceTaskId = null;
            if (state.currentStep === 2) {
              state.currentStep = 3;
              state.generationStatus = "completed";
            }
          });
        },

        setReferenceResult: (imageUrl) => {
          set((state) => {
            state.referenceSheetUrl = imageUrl;
            state.referenceReady = true;
          });
        },

        setReferenceTaskId: (id) => {
          set((state) => {
            state.referenceTaskId = id;
            // 注意：不改 generationStatus，避免从 completed 跳回 polling
          });
        },

        setGenerationFailed: (error) => {
          set((state) => {
            state.generationStatus = "failed";
            state.errorMessage = error;
          });
        },

        // ===== Step 4 活化 =====

        setActivationTaskId: (id) => {
          set((state) => {
            state.activationTaskId = id;
            state.isActivating = true;
          });
        },

        setIsActivating: (v) => {
          set((state) => {
            state.isActivating = v;
          });
        },

        setActivationResult: (url) => {
          set((state) => {
            state.activationVideoUrl = url;
            state.isActivating = false;
          });
        },

        setShowRefModal: (v) => {
          set((state) => {
            state.showRefModal = v;
          });
        },

        setRefPrompt: (p) => {
          set((state) => {
            state.refPrompt = p;
          });
        },

        // ===== 通用 =====

        setCharacterName: (name) => {
          set((state) => {
            state.characterName = name;
          });
        },

        setCharacterTags: (tags) => {
          set((state) => {
            state.characterTags = tags;
          });
        },

        setIsSaving: (saving) => {
          set((state) => {
            state.isSaving = saving;
          });
        },

        setSavedCharacterId: (id) => {
          set((state) => {
            state.savedCharacterId = id;
          });
        },

        setIsEnhancing: (enhancing) => {
          set((state) => {
            state.isEnhancing = enhancing;
          });
        },

        setUserInfo: (userId, credits) => {
          set((state) => {
            state.userId = userId;
            state.userCredits = credits;
          });
        },

        // ===== V5: Sora2 影视角色 =====

        setForgeMode: (mode) => {
          set((state) => {
            state.forgeMode = mode;
          });
        },

        setSora2VideoResult: (url) => {
          set((state) => {
            state.sora2VideoUrl = url;
            // 视频生成完成 → 跳 Step 3
            if (state.currentStep === 2) {
              state.currentStep = 3;
              state.generationStatus = "completed";
            }
          });
        },

        setSora2VideoOssUrl: (url) => {
          set((state) => {
            state.sora2VideoOssUrl = url;
          });
        },

        setSora2Pid: (pid) => {
          set((state) => {
            state.sora2Pid = pid;
          });
        },

        setSora2PidTaskId: (taskId) => {
          set((state) => {
            state.sora2PidTaskId = taskId;
          });
        },

        setIsMinimized: (v) => {
          set((state) => {
            state.isMinimized = v;
          });
        },

        reset: () => {
          const currentUserId = get().userId;
          const currentCredits = get().userCredits;
          set(() => ({
            ...initialState,
            dnaConfig: { ...DEFAULT_DNA },
            userId: currentUserId,
            userCredits: currentCredits,
          }));
        },
      })),
      { name: "character-studio-store" }
    ),
    {
      name: "character-studio-storage",
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<CharacterStudioState> | undefined;
        if (!state) return state;

        if (
          version < 2 &&
          state.currentStep === 1 &&
          state.creationMode === "dna" &&
          (!state.prompt || state.prompt === DEFAULT_DNA_PROMPT)
        ) {
          return {
            ...state,
            creationMode: "freeform",
            prompt: "",
          };
        }

        return state;
      },
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<CharacterStudioState> | undefined;
        const merged = {
          ...current,
          ...persistedState,
        } as CharacterStudioState & CharacterStudioActions;

        if (merged.creationMode === "dna" && !merged.prompt.trim()) {
          merged.prompt = DEFAULT_DNA_PROMPT;
        }

        return merged;
      },
      // 持久化可恢复的创作/保存状态；不持久化 isSaving 这类瞬时 UI 状态
      partialize: (state) => ({
        creationMode: state.creationMode,
        dnaConfig: state.dnaConfig,
        prompt: state.prompt,
        // Sora2 关键状态 — 防止 Next.js 水合时被 rehydration 重置为 null
        forgeMode: state.forgeMode,
        currentStep: state.currentStep,
        generationStatus: state.generationStatus,
        savedCharacterId: state.savedCharacterId,
        characterName: state.characterName,
        characterTags: state.characterTags,
        heroTaskId: state.heroTaskId,
        characterBoardUrl: state.characterBoardUrl,
        characterAvatarUrl: state.characterAvatarUrl,
        characterBoardCrop: state.characterBoardCrop,
        characterBoardPrompt: state.characterBoardPrompt,
        heroImageUrl: state.heroImageUrl,
        heroReady: state.heroReady,
        referenceTaskId: state.referenceTaskId,
        referenceSheetUrl: state.referenceSheetUrl,
        referenceReady: state.referenceReady,
        refPrompt: state.refPrompt,
        sora2VideoUrl: state.sora2VideoUrl,
        sora2VideoOssUrl: state.sora2VideoOssUrl,
        sora2Pid: state.sora2Pid,
        sora2PidTaskId: state.sora2PidTaskId,
        errorMessage: state.errorMessage,
      }),
    }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useCharacterCurrentStep = () =>
  useCharacterStudioStore((state) => state.currentStep);

export const useCharacterDnaConfig = () =>
  useCharacterStudioStore((state) => state.dnaConfig);

export const useCharacterPrompt = () =>
  useCharacterStudioStore((state) => state.prompt);

export const useCharacterGenerationStatus = () =>
  useCharacterStudioStore((state) => state.generationStatus);

export const useCharacterIsGenerating = () =>
  useCharacterStudioStore(
    (state) =>
      state.generationStatus === "generating" ||
      state.generationStatus === "polling"
  );

export const useCharacterHeroImage = () =>
  useCharacterStudioStore((state) => state.heroImageUrl);

export const useCharacterReferenceSheet = () =>
  useCharacterStudioStore((state) => state.referenceSheetUrl);
