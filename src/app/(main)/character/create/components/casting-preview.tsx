/**
 * 铸造预览区 — 右栏组件
 *
 * 3 种状态：
 * 1. 空态（idle）— 科技感占位符
 * 2. 生成中（generating/polling）— 骨架屏动画
 * 3. 生成完毕（completed）— 3:4 角色卡片 + 命名保存
 */

"use client";

import { useState, useCallback } from "react";
import {
  useCharacterStudioStore,
  useCharacterGenerationStatus,
  useCharacterGeneratedImage,
  useCharacterIsGenerating,
} from "@/stores/character-studio-store";

export function CastingPreview() {
  const store = useCharacterStudioStore();
  const generationStatus = useCharacterGenerationStatus();
  const generatedImageUrl = useCharacterGeneratedImage();
  const isGenerating = useCharacterIsGenerating();

  const [showFullImage, setShowFullImage] = useState(false);
  const [tagInput, setTagInput] = useState("");

  // 保存角色
  const handleSave = useCallback(async () => {
    if (!store.characterName.trim() || !generatedImageUrl || store.isSaving) return;

    store.setIsSaving(true);
    try {
      const userDataStr = localStorage.getItem("user-data");
      let userId = "";
      if (userDataStr) {
        try {
          const userData = JSON.parse(userDataStr);
          userId = userData?.id || userData?.user?.id || "";
        } catch { /* ignore */ }
      }

      if (!userId) {
        alert("请先登录");
        store.setIsSaving(false);
        return;
      }

      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: store.characterName.trim(),
          description: store.prompt,
          avatar_url: generatedImageUrl,
          reference_images: [generatedImageUrl],
          character_type: store.dnaConfig.species,
          dna_config: store.dnaConfig,
          style_tags: store.characterTags,
          gender: store.dnaConfig.gender,
          age_range: store.dnaConfig.ageGroup || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert("✅ 角色已保存至角色库！");
        store.reset();
        // 跳转到角色列表（可选）
        // window.location.href = "/character";
      } else {
        alert(`保存失败: ${data.error}`);
      }
    } catch (error) {
      console.error("[Save Character] Error:", error);
      alert("保存失败，请重试");
    } finally {
      store.setIsSaving(false);
    }
  }, [store, generatedImageUrl]);

  // 添加标签
  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !store.characterTags.includes(tag)) {
      store.setCharacterTags([...store.characterTags, tag]);
    }
    setTagInput("");
  };

  // 删除标签
  const handleRemoveTag = (tag: string) => {
    store.setCharacterTags(store.characterTags.filter((t) => t !== tag));
  };

  return (
    <div className="casting-preview">
      {/* 状态 1：空态 */}
      {generationStatus === "idle" && (
        <div className="preview-idle">
          <div className="idle-glow" />
          <div className="idle-icon">
            <div className="dna-helix">🧬</div>
          </div>
          <p className="idle-text">等待注入角色 DNA...</p>
          <p className="idle-hint">在左侧选择特征或输入描述，然后点击生成</p>
        </div>
      )}

      {/* 状态 2：生成中 */}
      {isGenerating && (
        <div className="preview-generating">
          <div className="generating-skeleton">
            <div className="skeleton-card">
              <div className="skeleton-avatar skeleton-pulse" />
              <div className="skeleton-line skeleton-pulse" style={{ width: "60%" }} />
              <div className="skeleton-line skeleton-pulse" style={{ width: "40%" }} />
            </div>
          </div>
          <p className="generating-text">
            {generationStatus === "polling"
              ? "⚡ 角色铸造中，请耐心等待..."
              : "🚀 正在启动角色铸造引擎..."}
          </p>
          <div className="generating-progress">
            <div className="progress-bar" />
          </div>
        </div>
      )}

      {/* 状态 2b：生成失败 */}
      {generationStatus === "failed" && (
        <div className="preview-failed">
          <div className="failed-icon">❌</div>
          <p className="failed-text">{store.errorMessage || "生成失败"}</p>
          <button
            className="retry-btn"
            onClick={() => store.startGeneration()}
            type="button"
          >
            🔄 重试
          </button>
        </div>
      )}

      {/* 状态 3：生成完毕 */}
      {generationStatus === "completed" && generatedImageUrl && (
        <div className="preview-completed">
          {/* 主视觉：3:4 角色数字档案卡 */}
          <div className="casting-card">
            <div className="casting-card-glow" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generatedImageUrl}
              alt="角色预览"
              className="casting-card-avatar"
            />
            <div className="casting-card-badge">✨ Digital Character</div>
          </div>

          {/* 折叠按钮：查看完整 16:9 多角度源图 */}
          <button
            className="toggle-full-btn"
            onClick={() => setShowFullImage(!showFullImage)}
            type="button"
          >
            {showFullImage ? "🔽 收起源文件" : "👁️ 查看 AI 多角度源文件"}
          </button>

          {showFullImage && (
            <div className="full-image-container">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={generatedImageUrl}
                alt="完整多角度图"
                className="full-image"
              />
            </div>
          )}

          {/* 命名区 */}
          <div className="name-section">
            <label className="name-label">
              角色名称 <span className="required">*</span>
            </label>
            <input
              type="text"
              className="name-input"
              placeholder="给你的角色起个名字..."
              value={store.characterName}
              onChange={(e) => store.setCharacterName(e.target.value)}
              maxLength={50}
            />
          </div>

          {/* 标签区 */}
          <div className="tags-section">
            <label className="tags-label">角色标签</label>
            <div className="tags-input-row">
              <input
                type="text"
                className="tag-input"
                placeholder="添加标签..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                maxLength={20}
              />
              <button
                className="tag-add-btn"
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                type="button"
              >
                +
              </button>
            </div>
            {store.characterTags.length > 0 && (
              <div className="tags-list">
                {store.characterTags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button
                      className="tag-remove"
                      onClick={() => handleRemoveTag(tag)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="action-buttons">
            <button
              className="save-btn"
              onClick={handleSave}
              disabled={!store.characterName.trim() || store.isSaving}
              type="button"
            >
              {store.isSaving ? "保存中..." : "💾 保存至角色库"}
            </button>
            <button
              className="regenerate-btn"
              onClick={() => {
                // 重置生成状态回到 idle，保留当前 prompt，
                // 用户可在左侧微调 DNA/提示词后重新点击生成按钮
                useCharacterStudioStore.setState({
                  generationStatus: "idle",
                  generatedImageUrl: null,
                  taskId: null,
                  errorMessage: null,
                  characterName: "",
                  characterTags: [],
                });
              }}
              type="button"
            >
              🔄 微调并重新生成
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .casting-preview {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 1rem;
          min-height: 600px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ===== Idle State ===== */
        .preview-idle {
          text-align: center;
          padding: 3rem;
        }

        .idle-glow {
          position: absolute;
          width: 200px;
          height: 200px;
          background: radial-gradient(
            circle,
            rgba(0, 242, 234, 0.08) 0%,
            transparent 70%
          );
          pointer-events: none;
        }

        .idle-icon {
          margin-bottom: 1.5rem;
        }

        .dna-helix {
          font-size: 3rem;
          animation: float 3s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        .idle-text {
          font-size: 1.1rem;
          color: rgba(255, 255, 255, 0.4);
          margin-bottom: 0.5rem;
        }

        .idle-hint {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.2);
        }

        /* ===== Generating State ===== */
        .preview-generating {
          text-align: center;
          padding: 3rem;
          width: 100%;
        }

        .generating-skeleton {
          margin-bottom: 1.5rem;
        }

        .skeleton-card {
          max-width: 250px;
          margin: 0 auto;
          padding: 1.5rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .skeleton-avatar {
          width: 100%;
          aspect-ratio: 3/4;
          border-radius: 0.75rem;
          margin-bottom: 1rem;
          background: rgba(255, 255, 255, 0.06);
        }

        .skeleton-line {
          height: 0.75rem;
          border-radius: 0.375rem;
          margin-bottom: 0.5rem;
          background: rgba(255, 255, 255, 0.06);
        }

        .skeleton-pulse {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .generating-text {
          font-size: 0.9rem;
          color: rgba(0, 242, 234, 0.7);
          margin-bottom: 1rem;
        }

        .generating-progress {
          max-width: 300px;
          margin: 0 auto;
          height: 3px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          width: 30%;
          background: linear-gradient(90deg, #00f2ea, #4f46e5);
          border-radius: 2px;
          animation: progress-slide 2s ease-in-out infinite;
        }

        @keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }

        /* ===== Failed State ===== */
        .preview-failed {
          text-align: center;
          padding: 3rem;
        }

        .failed-icon {
          font-size: 2.5rem;
          margin-bottom: 1rem;
        }

        .failed-text {
          font-size: 0.9rem;
          color: rgba(239, 68, 68, 0.8);
          margin-bottom: 1.25rem;
        }

        .retry-btn {
          padding: 0.5rem 1.5rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(239, 68, 68, 0.3);
          background: rgba(239, 68, 68, 0.1);
          color: #fca5a5;
          cursor: pointer;
          transition: all 0.2s;
        }

        .retry-btn:hover {
          background: rgba(239, 68, 68, 0.2);
        }

        /* ===== Completed State ===== */
        .preview-completed {
          width: 100%;
          padding: 1.5rem;
        }

        /* Casting Card */
        .casting-card {
          position: relative;
          max-width: 320px;
          margin: 0 auto 1.25rem;
          border-radius: 1.5rem;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 0 40px -10px rgba(0, 242, 234, 0.3);
        }

        .casting-card-glow {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            transparent 60%,
            rgba(0, 0, 0, 0.6) 100%
          );
          pointer-events: none;
          z-index: 1;
        }

        .casting-card-avatar {
          width: 100%;
          aspect-ratio: 3/4;
          object-fit: cover;
          object-position: 12.5% 25%;
          display: block;
        }

        .casting-card-badge {
          position: absolute;
          bottom: 0.75rem;
          left: 0.75rem;
          z-index: 2;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(0, 242, 234, 0.3);
          border-radius: 2rem;
          padding: 0.25rem 0.75rem;
          font-size: 0.7rem;
          color: rgba(0, 242, 234, 0.9);
          letter-spacing: 0.03em;
        }

        /* Toggle Full Image */
        .toggle-full-btn {
          display: block;
          width: 100%;
          max-width: 320px;
          margin: 0 auto 1.25rem;
          padding: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.5rem;
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toggle-full-btn:hover {
          border-color: rgba(0, 242, 234, 0.2);
          color: rgba(0, 242, 234, 0.7);
        }

        .full-image-container {
          max-width: 100%;
          margin-bottom: 1.25rem;
          border-radius: 0.75rem;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .full-image {
          width: 100%;
          display: block;
        }

        /* Name Section */
        .name-section {
          max-width: 320px;
          margin: 0 auto 1rem;
        }

        .name-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 0.35rem;
        }

        .required {
          color: #ef4444;
        }

        .name-input {
          width: 100%;
          padding: 0.6rem 0.75rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          color: #f0f0f0;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s;
        }

        .name-input:focus {
          border-color: rgba(0, 242, 234, 0.4);
        }

        .name-input::placeholder {
          color: rgba(255, 255, 255, 0.2);
        }

        /* Tags Section */
        .tags-section {
          max-width: 320px;
          margin: 0 auto 1.25rem;
        }

        .tags-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 0.35rem;
        }

        .tags-input-row {
          display: flex;
          gap: 0.5rem;
        }

        .tag-input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          color: #f0f0f0;
          font-size: 0.8rem;
          outline: none;
        }

        .tag-input:focus {
          border-color: rgba(0, 242, 234, 0.3);
        }

        .tag-add-btn {
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(0, 242, 234, 0.3);
          background: rgba(0, 242, 234, 0.1);
          color: #00f2ea;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tag-add-btn:hover:not(:disabled) {
          background: rgba(0, 242, 234, 0.2);
        }

        .tag-add-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin-top: 0.5rem;
        }

        .tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.2rem 0.6rem;
          background: rgba(79, 70, 229, 0.15);
          border: 1px solid rgba(79, 70, 229, 0.3);
          border-radius: 2rem;
          font-size: 0.72rem;
          color: #a5b4fc;
        }

        .tag-remove {
          background: none;
          border: none;
          color: rgba(239, 68, 68, 0.7);
          font-size: 0.8rem;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }

        /* Action Buttons */
        .action-buttons {
          max-width: 320px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .save-btn {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.75rem;
          border: none;
          background: linear-gradient(135deg, #00f2ea 0%, #4f46e5 100%);
          color: white;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 0 25px -5px rgba(0, 242, 234, 0.3);
        }

        .save-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 0 35px -5px rgba(0, 242, 234, 0.5);
        }

        .save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .regenerate-btn {
          width: 100%;
          padding: 0.6rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .regenerate-btn:hover {
          border-color: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
}
