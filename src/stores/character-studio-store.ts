/**
 * Character Studio Store — 角色捏脸舱状态管理
 *
 * 使用与 quick-gen-store.ts 完全一致的 persist + immer + devtools 三件套。
 * 左栏 CreationWorkspace 和右栏 CastingPreview 通过此 Store 通信，
 * 不使用 Props 传递或 Context。
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
  // 创作模式
  creationMode: "dna" | "freeform";

  // DNA 配置（特征刻画模式）— 所有字段使用英文 key
  dnaConfig: CharacterDna;

  // 提示词（两种模式共用）
  prompt: string;

  // 参考图（两种模式共用）
  referenceImageUrl: string | null;

  // 生成状态
  generationStatus: GenerationStatus;
  generatedImageUrl: string | null;
  taskId: string | null;
  errorMessage: string | null;

  // 保存阶段
  characterName: string;
  characterTags: string[];
  isSaving: boolean;

  // AI 魔法棒
  isEnhancing: boolean;
}

export interface CharacterStudioActions {
  setCreationMode: (mode: "dna" | "freeform") => void;
  updateDnaConfig: (partial: Partial<CharacterDna>) => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrl: (url: string | null) => void;
  buildPromptFromDna: () => string;
  startGeneration: () => void;
  setGenerationPolling: (taskId: string) => void;
  setGenerationResult: (imageUrl: string) => void;
  setGenerationFailed: (error: string) => void;
  setCharacterName: (name: string) => void;
  setCharacterTags: (tags: string[]) => void;
  setIsSaving: (saving: boolean) => void;
  setIsEnhancing: (enhancing: boolean) => void;
  reset: () => void;
}

// ============================================================================
// 初始状态
// ============================================================================

const initialState: CharacterStudioState = {
  creationMode: "dna",
  dnaConfig: { ...DEFAULT_DNA },
  prompt: "",
  referenceImageUrl: null,
  generationStatus: "idle",
  generatedImageUrl: null,
  taskId: null,
  errorMessage: null,
  characterName: "",
  characterTags: [],
  isSaving: false,
  isEnhancing: false,
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

        /**
         * 纯函数：从当前 DNA 配置构建英文 prompt
         * 不修改 Store 状态，仅返回字符串
         */
        buildPromptFromDna: () => {
          const dna = get().dnaConfig;
          const parts: string[] = [];

          // 按照逻辑顺序拼接：物种 → 基础特征 → 性别 → 年龄 → 身材 → 发型 → 发色 → 穿搭
          const fields: (keyof CharacterDna)[] = [
            "species",
            "baseDna",
            "gender",
            "ageGroup",
            "bodyType",
            "hairStyle",
            "hairColor",
            "outfit",
          ];

          for (const field of fields) {
            const value = dna[field];
            if (value && dnaPromptDict[value]) {
              parts.push(dnaPromptDict[value]);
            }
          }

          if (parts.length === 0) {
            return "";
          }

          // 组合为自然流畅的英文描述
          return parts.join(", ") + ", professional studio lighting, high quality";
        },

        startGeneration: () => {
          set((state) => {
            state.generationStatus = "generating";
            state.generatedImageUrl = null;
            state.taskId = null;
            state.errorMessage = null;
          });
        },

        setGenerationPolling: (taskId) => {
          set((state) => {
            state.generationStatus = "polling";
            state.taskId = taskId;
          });
        },

        setGenerationResult: (imageUrl) => {
          set((state) => {
            state.generationStatus = "completed";
            state.generatedImageUrl = imageUrl;
          });
        },

        setGenerationFailed: (error) => {
          set((state) => {
            state.generationStatus = "failed";
            state.errorMessage = error;
          });
        },

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

        setIsEnhancing: (enhancing) => {
          set((state) => {
            state.isEnhancing = enhancing;
          });
        },

        reset: () => {
          set(() => ({ ...initialState, dnaConfig: { ...DEFAULT_DNA } }));
        },
      })),
      { name: "character-studio-store" }
    ),
    {
      name: "character-studio-storage",
      storage: createJSONStorage(() => localStorage),
      // 只持久化关键的创作状态，不持久化生成中间状态
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

export const useCharacterGeneratedImage = () =>
  useCharacterStudioStore((state) => state.generatedImageUrl);
