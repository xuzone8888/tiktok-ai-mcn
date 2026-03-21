/**
 * Character Studio Store — V3 全屏步骤流程状态管理
 *
 * V3 变更:
 * - 新增 currentStep (1-4) 控制全屏步骤切换
 * - 单图 → 双图（heroImageUrl + referenceSheetUrl）
 * - 单 taskId → 双 taskId（heroTaskId + referenceTaskId）
 * - 新增 Step 4 活化视频状态
 * - GenerationStatus 由 currentStep + 子状态替代
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { CharacterDna } from "@/types/character";
import { DEFAULT_DNA } from "@/types/character";
import { dnaPromptDict } from "@/app/(main)/character/create/data/dna-options";

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

  // V3: 双图双任务
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
  reset: () => void;
}

// ============================================================================
// 初始状态
// ============================================================================

const initialState: CharacterStudioState = {
  currentStep: 1,
  creationMode: "dna",
  dnaConfig: { ...DEFAULT_DNA },
  prompt: "",
  referenceImageUrl: null,
  generationStatus: "idle",
  errorMessage: null,
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
            dna.baseDna, dna.ageGroup, dna.bodyType,
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
            state.heroImageUrl = null;
            state.referenceSheetUrl = null;
            state.heroTaskId = null;
            state.referenceTaskId = null;
            state.heroReady = false;
            state.referenceReady = false;
            state.errorMessage = null;
            state.refPrompt = null;
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
      storage: createJSONStorage(() => localStorage),
      // 只持久化创作状态，不持久化 currentStep 和生成中间状态
      partialize: (state) => ({
        creationMode: state.creationMode,
        dnaConfig: state.dnaConfig,
        prompt: state.prompt,
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
