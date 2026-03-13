/**
 * 创作工作台 — 左栏组件
 *
 * 包含：
 * 1. 顶部 Tabs（DNA Forge / Freeform）
 * 2. DNA 模式：6 行 DnaPillRow 胶囊选择器
 * 3. Freeform 模式：深色全高 textarea
 * 4. 智能提示词区 + 🪄 魔法棒按钮
 * 5. 参考图上传
 * 6. 生成按钮
 */

"use client";

import { useState, useCallback, useRef } from "react";
import {
  useCharacterStudioStore,
  useCharacterIsGenerating,
} from "@/stores/character-studio-store";
import {
  getDnaOptionGroups,
  type DnaOption,
} from "../data/dna-options";
import type { CharacterDna } from "@/types/character";

// ============================================================================
// DNA Pill Row 子组件
// ============================================================================

function DnaPillRow({
  label,
  options,
  selectedValues,
  onSelect,
}: {
  label: string;
  options: DnaOption[];
  selectedValues: string[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="dna-pill-row">
      <div className="dna-pill-label">{label}</div>
      <div className="dna-pill-options">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`dna-pill ${
              selectedValues.includes(opt.value) ? "dna-pill-active" : ""
            }`}
            onClick={() => onSelect(opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CreationWorkspace() {
  const store = useCharacterStudioStore();
  const isGenerating = useCharacterIsGenerating();

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当前 species 的选项组
  const optionGroups = getDnaOptionGroups(store.dnaConfig.species);

  // DNA pill 点击处理
  const handleDnaPillSelect = useCallback(
    (groupKey: string, value: string) => {
      // 根据 groupKey 确定更新哪个 dnaConfig 字段
      const fieldMap: Record<string, keyof CharacterDna> = {
        species: "species",
        baseDna: "baseDna",
        bodyType: "bodyType",
        outfit: "outfit",
      };

      if (groupKey === "species") {
        // species 变化时，清空依赖项
        store.updateDnaConfig({
          species: value as CharacterDna["species"],
          baseDna: "",
          bodyType: "",
          hairStyle: "",
          hairColor: "",
          outfit: "",
        });
      } else if (groupKey === "genderAge") {
        // 性别/年龄选项混合在一行，需要判断
        const genderValues = ["female", "male", "neutral"];
        if (genderValues.includes(value)) {
          store.updateDnaConfig({ gender: value as CharacterDna["gender"] });
        } else {
          store.updateDnaConfig({ ageGroup: value });
        }
      } else if (groupKey === "hair") {
        // 发型/发色混合在一行
        const hairColorValues = [
          "natural_black", "tea_brown", "ash_blonde", "silver_white",
          "dream_pink", "honey_brown", "cherry_red", "ocean_blue",
          "sakura_pink", "emerald_green", "gradient_rainbow",
          "solid_color", "two_tone", "natural_fur", "orange_tabby",
          "snow_white", "midnight_black", "golden",
        ];
        if (hairColorValues.includes(value)) {
          store.updateDnaConfig({ hairColor: value });
        } else {
          store.updateDnaConfig({ hairStyle: value });
        }
      } else if (fieldMap[groupKey]) {
        store.updateDnaConfig({ [fieldMap[groupKey]]: value });
      }

      // 自动更新 prompt
      setTimeout(() => {
        const prompt = store.buildPromptFromDna();
        if (prompt) {
          store.setPrompt(prompt);
        }
      }, 0);
    },
    [store]
  );

  // 获取当前选中的值列表
  const getSelectedValues = (groupKey: string): string[] => {
    const dna = store.dnaConfig;
    switch (groupKey) {
      case "species":
        return [dna.species];
      case "baseDna":
        return dna.baseDna ? [dna.baseDna] : [];
      case "genderAge":
        return [dna.gender, dna.ageGroup].filter(Boolean);
      case "bodyType":
        return dna.bodyType ? [dna.bodyType] : [];
      case "hair":
        return [dna.hairStyle, dna.hairColor].filter(Boolean);
      case "outfit":
        return dna.outfit ? [dna.outfit] : [];
      default:
        return [];
    }
  };

  // AI 魔法棒
  const handleEnhancePrompt = async () => {
    if (!store.prompt.trim() || store.isEnhancing) return;

    store.setIsEnhancing(true);
    try {
      const response = await fetch("/api/characters/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: store.prompt, mode: "expand" }),
      });
      const data = await response.json();
      if (data.success && data.enhancedPrompt) {
        store.setPrompt(data.enhancedPrompt);
      } else {
        console.error("[Magic Wand] Failed:", data.error);
      }
    } catch (error) {
      console.error("[Magic Wand] Error:", error);
    } finally {
      store.setIsEnhancing(false);
    }
  };

  // 参考图上传
  const handleImageUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.url) {
        store.setReferenceImageUrl(data.url);
      }
    } catch (error) {
      console.error("[Upload] Error:", error);
    } finally {
      setIsUploading(false);
    }
  };

  // 生成角色
  const handleGenerate = async () => {
    if (!store.prompt.trim() || isGenerating) return;

    store.startGeneration();

    try {
      // 获取 userId（从 localStorage 或 session）
      const userDataStr = localStorage.getItem("user-data");
      let userId = "";
      if (userDataStr) {
        try {
          const userData = JSON.parse(userDataStr);
          userId = userData?.id || userData?.user?.id || "";
        } catch { /* ignore */ }
      }

      if (!userId) {
        store.setGenerationFailed("请先登录");
        return;
      }

      const response = await fetch("/api/characters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: store.prompt,
          sourceImageUrl: store.referenceImageUrl || undefined,
          userId,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        store.setGenerationFailed(data.error || "生成失败");
        return;
      }

      if (data.imageUrl) {
        // 同步返回（Gemini 等）
        store.setGenerationResult(data.imageUrl);
      } else if (data.taskId) {
        // 异步任务，开始轮询
        store.setGenerationPolling(data.taskId);
        pollTaskResult(data.taskId);
      }
    } catch (error) {
      console.error("[Generate] Error:", error);
      store.setGenerationFailed("网络错误，请重试");
    }
  };

  // 轮询生成结果
  const pollTaskResult = async (taskId: string) => {
    const maxAttempts = 60;
    const interval = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, interval));

      try {
        const response = await fetch(
          `/api/characters/generate?taskId=${taskId}`
        );
        const data = await response.json();

        if (!data.success) continue;

        const task = data.task;
        if (task?.status === "completed" && task?.resultUrl) {
          store.setGenerationResult(task.resultUrl);
          return;
        } else if (task?.status === "failed") {
          store.setGenerationFailed(task.errorMessage || "生成失败");
          return;
        }
        // else: still pending/processing, continue polling
      } catch {
        // network error, continue polling
      }
    }

    store.setGenerationFailed("生成超时，请重试");
  };

  return (
    <div className="creation-workspace">
      {/* Mode Tabs */}
      <div className="workspace-tabs">
        <button
          className={`workspace-tab ${
            store.creationMode === "dna" ? "workspace-tab-active" : ""
          }`}
          onClick={() => store.setCreationMode("dna")}
          type="button"
        >
          ✨ 特征刻画 (DNA Forge)
        </button>
        <button
          className={`workspace-tab ${
            store.creationMode === "freeform" ? "workspace-tab-active" : ""
          }`}
          onClick={() => store.setCreationMode("freeform")}
          type="button"
        >
          ⌨️ 自由创作 (Freeform)
        </button>
      </div>

      {/* DNA Forge Mode */}
      {store.creationMode === "dna" && (
        <div className="dna-forge-area">
          {optionGroups.map((group) => (
            <DnaPillRow
              key={group.key}
              label={group.label}
              options={group.options}
              selectedValues={getSelectedValues(group.key)}
              onSelect={(value) => handleDnaPillSelect(group.key, value)}
            />
          ))}
        </div>
      )}

      {/* Freeform Mode */}
      {store.creationMode === "freeform" && (
        <div className="freeform-area">
          <textarea
            className="freeform-editor"
            placeholder="描述你想要的角色特征...&#10;&#10;例如：一位身穿新中式汉服的清冷气质少女，黑色长直发，肤白如玉，眼神冷淡但透着灵气。"
            value={store.prompt}
            onChange={(e) => store.setPrompt(e.target.value)}
            rows={12}
          />
        </div>
      )}

      {/* 智能提示词区（两种模式共用） */}
      <div className="prompt-section">
        <div className="prompt-section-header">
          <span className="prompt-section-title">💡 智能提示词</span>
          <button
            className="magic-wand-btn"
            onClick={handleEnhancePrompt}
            disabled={!store.prompt.trim() || store.isEnhancing}
            type="button"
            title="AI 扩写魔法"
          >
            {store.isEnhancing ? "✦ 施法中..." : "🪄 AI 扩写"}
          </button>
        </div>
        <textarea
          className="prompt-display"
          value={store.prompt}
          onChange={(e) => store.setPrompt(e.target.value)}
          placeholder="点击上方特征胶囊自动生成，或直接输入..."
          rows={4}
        />
      </div>

      {/* 参考图上传 */}
      <div
        className={`reference-upload ${
          store.referenceImageUrl ? "has-image" : ""
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith("image/")) {
            handleImageUpload(file);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file);
          }}
        />
        {isUploading ? (
          <span className="upload-status">⏳ 上传中...</span>
        ) : store.referenceImageUrl ? (
          <div className="upload-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={store.referenceImageUrl}
              alt="参考图"
              className="upload-preview-img"
            />
            <button
              className="upload-remove"
              onClick={(e) => {
                e.stopPropagation();
                store.setReferenceImageUrl(null);
              }}
              type="button"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="upload-placeholder">
            <span className="upload-icon">🖼️</span>
            <span className="upload-text">拖拽或点击上传参考图（可选）</span>
          </div>
        )}
      </div>

      {/* 生成按钮 */}
      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={!store.prompt.trim() || isGenerating}
        type="button"
      >
        {isGenerating ? (
          <>
            <span className="generate-spinner" />
            生成中...
          </>
        ) : (
          <>✨ 生成角色</>
        )}
      </button>

      <style jsx>{`
        .creation-workspace {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 1rem;
          padding: 1.25rem;
        }

        /* Tabs */
        .workspace-tabs {
          display: flex;
          gap: 0.25rem;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 0.75rem;
          padding: 0.25rem;
          margin-bottom: 1.25rem;
        }

        .workspace-tab {
          flex: 1;
          padding: 0.6rem 0.75rem;
          border-radius: 0.5rem;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .workspace-tab:hover {
          color: rgba(255, 255, 255, 0.7);
        }

        .workspace-tab-active {
          background: rgba(0, 242, 234, 0.15);
          color: #00f2ea;
          box-shadow: 0 0 20px -5px rgba(0, 242, 234, 0.2);
        }

        /* DNA Forge */
        .dna-forge-area {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.25rem;
        }

        /* Freeform */
        .freeform-area {
          margin-bottom: 1.25rem;
        }

        .freeform-editor {
          width: 100%;
          min-height: 200px;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.75rem;
          padding: 1rem;
          color: #e0e0e0;
          font-family: "JetBrains Mono", "Fira Code", monospace;
          font-size: 0.85rem;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
        }

        .freeform-editor:focus {
          border-color: rgba(0, 242, 234, 0.3);
        }

        .freeform-editor::placeholder {
          color: rgba(255, 255, 255, 0.25);
        }

        /* Prompt Section */
        .prompt-section {
          margin-bottom: 1rem;
        }

        .prompt-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .prompt-section-title {
          font-size: 0.8rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.6);
        }

        .magic-wand-btn {
          padding: 0.35rem 0.75rem;
          border-radius: 2rem;
          border: 1px solid rgba(168, 85, 247, 0.3);
          background: rgba(168, 85, 247, 0.1);
          color: #c084fc;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .magic-wand-btn:hover:not(:disabled) {
          background: rgba(168, 85, 247, 0.2);
          border-color: rgba(168, 85, 247, 0.5);
          box-shadow: 0 0 15px -5px rgba(168, 85, 247, 0.3);
        }

        .magic-wand-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .prompt-display {
          width: 100%;
          min-height: 80px;
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.75rem;
          padding: 0.75rem;
          color: rgba(0, 242, 234, 0.9);
          font-size: 0.8rem;
          line-height: 1.5;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
        }

        .prompt-display:focus {
          border-color: rgba(0, 242, 234, 0.3);
        }

        .prompt-display::placeholder {
          color: rgba(255, 255, 255, 0.2);
        }

        /* Reference Upload */
        .reference-upload {
          margin-bottom: 1.25rem;
          border: 2px dashed rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
        }

        .reference-upload:hover {
          border-color: rgba(0, 242, 234, 0.3);
          background: rgba(0, 242, 234, 0.02);
        }

        .reference-upload.has-image {
          border-style: solid;
          border-color: rgba(0, 242, 234, 0.2);
          padding: 0.5rem;
        }

        .upload-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
        }

        .upload-icon {
          font-size: 1.5rem;
          opacity: 0.5;
        }

        .upload-text {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.35);
        }

        .upload-status {
          font-size: 0.8rem;
          color: rgba(0, 242, 234, 0.7);
        }

        .upload-preview {
          position: relative;
          display: inline-block;
        }

        .upload-preview-img {
          max-height: 120px;
          border-radius: 0.5rem;
          object-fit: cover;
        }

        .upload-remove {
          position: absolute;
          top: -0.5rem;
          right: -0.5rem;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          border: none;
          background: rgba(239, 68, 68, 0.9);
          color: white;
          font-size: 0.7rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Generate Button */
        .generate-btn {
          width: 100%;
          padding: 0.85rem;
          border-radius: 0.75rem;
          border: none;
          background: linear-gradient(135deg, #00f2ea 0%, #4f46e5 100%);
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          box-shadow: 0 0 30px -5px rgba(0, 242, 234, 0.3);
        }

        .generate-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 0 40px -5px rgba(0, 242, 234, 0.5);
        }

        .generate-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .generate-spinner {
          display: inline-block;
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* DNA Pill Row 样式 — 全局生效 */}
      <style jsx global>{`
        .dna-pill-row {
          padding: 0.5rem 0;
        }

        .dna-pill-label {
          font-size: 0.72rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.4);
          margin-bottom: 0.4rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .dna-pill-options {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .dna-pill {
          padding: 0.3rem 0.7rem;
          border-radius: 2rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .dna-pill:hover {
          border-color: rgba(0, 242, 234, 0.3);
          color: rgba(255, 255, 255, 0.8);
          background: rgba(0, 242, 234, 0.05);
        }

        .dna-pill-active {
          border-color: rgba(0, 242, 234, 0.5);
          background: rgba(0, 242, 234, 0.12);
          color: #00f2ea;
          box-shadow: 0 0 10px -3px rgba(0, 242, 234, 0.3);
        }
      `}</style>
    </div>
  );
}
