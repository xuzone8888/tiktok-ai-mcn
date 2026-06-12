/**
 * 角色捏脸舱 — V3 全屏步骤切换主页面
 *
 * 路由: /character/create
 * V3: 从左右分栏改为 4 个全屏步骤
 *   Step 1 — 角色设定（配置 DNA + 提示词）
 *   Step 2 — 生成中（全屏等待动效）
 *   Step 3 — 角色就位（完整设定板 + 保存）
 *   Step 4 — 活化角色视频（Veo3 图生视频）
 */

"use client";

import { useEffect } from "react";
import { CreationWorkspace } from "./components/creation-workspace";
import { CastingPreview } from "./components/casting-preview";
import {
  useCharacterStudioStore,
  useCharacterCurrentStep,
} from "@/stores/character-studio-store";

export default function CharacterCreatePage() {
  const setUserInfo = useCharacterStudioStore((s) => s.setUserInfo);
  const setCurrentStep = useCharacterStudioStore((s) => s.setCurrentStep);
  const heroImageUrl = useCharacterStudioStore((s) => s.heroImageUrl);
  const generationStatus = useCharacterStudioStore((s) => s.generationStatus);
  const currentStep = useCharacterCurrentStep();
  const isMinimized = useCharacterStudioStore((s) => s.isMinimized);
  const forgeMode = useCharacterStudioStore((s) => s.forgeMode);
  const setIsMinimized = useCharacterStudioStore((s) => s.setIsMinimized);

  // 页面标题
  useEffect(() => {
    document.title = "创建角色 | Star Gaze";
  }, []);

  // 获取用户 ID 和积分
  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const response = await fetch("/api/user/credits", {
          cache: "no-store",
        });
        const data = await response.json();
        if (data.userId) {
          setUserInfo(data.userId, data.credits ?? 0);
        }
      } catch (err) {
        console.error("[CharacterStudio] Failed to fetch user info:", err);
      }
    };

    loadUserInfo();
  }, [setUserInfo]);

  // Step 2 收起时是否应该显示 Step 1
  const showStep1 = currentStep === 1 || (currentStep === 2 && isMinimized);

  return (
    <div className="character-create-page">
      {/* Step 1 — 角色设定（保持在 container 内）*/}
      {showStep1 && <CreationWorkspace />}

      {/* 当已有生成结果且在 Step 1 时，显示"查看已生成角色"入口 */}
      {currentStep === 1 && heroImageUrl && generationStatus === "completed" && (
        <button
          className="view-result-floating"
          onClick={() => setCurrentStep(3)}
          type="button"
        >
          <span className="view-result-dot" />
          👁 查看已生成角色
        </button>
      )}

      {/* Step 2 收起时的悬浮底栏 */}
      {currentStep === 2 && isMinimized && (
        <div className="minimized-status-bar">
          <div className="status-bar-content">
            <span className="status-bar-dot" />
            <span className="status-bar-text">
              {forgeMode === "sora2" ? "🎬 影视角色铸造中..." : "🖼️ 写真角色铸造中..."}
            </span>
            <button
              type="button"
              className="status-bar-expand"
              onClick={() => setIsMinimized(false)}
            >
              展开
            </button>
          </div>
        </div>
      )}

      {/* Step 2/3/4 — 全屏步骤（收起时隐藏遮罩） */}
      {currentStep >= 2 && !(currentStep === 2 && isMinimized) && (
        <div className="fullscreen-step">
          <CastingPreview />
        </div>
      )}

      <style jsx>{`
        .character-create-page {
          min-height: 100%;
        }

        /* 全屏步骤：覆盖右侧工作区，保留左侧导航可见 */
        .fullscreen-step {
          position: fixed;
          top: 0;
          left: 260px;
          right: 0;
          bottom: 0;
          z-index: 50;
          background: #0a0a0f;
          overflow-y: auto;
        }

        .view-result-floating {
          position: fixed;
          bottom: 1.5rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 40;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.65rem 1.4rem;
          border-radius: 2rem;
          border: 1px solid rgba(0, 242, 234, 0.15);
          background: rgba(10, 10, 15, 0.85);
          backdrop-filter: blur(20px);
          color: #00F2EA;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s;
          animation: floatUp 0.5s ease-out;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        .view-result-floating:hover {
          background: rgba(0, 242, 234, 0.12);
          border-color: rgba(0, 242, 234, 0.3);
          transform: translateX(-50%) translateY(-2px);
          box-shadow: 0 8px 30px rgba(0, 242, 234, 0.15);
        }
        @keyframes floatUp {
          0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .view-result-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #00F2EA;
          box-shadow: 0 0 6px #00F2EA;
          animation: dotBlink 1.5s ease-in-out infinite;
        }
        @keyframes resultBtnPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 242, 234, 0); }
          50% { box-shadow: 0 0 0 6px rgba(0, 242, 234, 0.08); }
        }
        @keyframes dotBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .minimized-status-bar {
          position: fixed;
          bottom: 1rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
          animation: floatUp 0.4s ease-out;
        }
        .status-bar-content {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.6rem 1.2rem;
          border-radius: 2rem;
          background: rgba(10, 10, 18, 0.92);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(168, 85, 247, 0.25);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5),
                      0 0 0 1px rgba(168, 85, 247, 0.1) inset;
        }
        .status-bar-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #a855f7;
          box-shadow: 0 0 8px #a855f7;
          animation: dotBlink 1.5s ease-in-out infinite;
        }
        .status-bar-text {
          font-size: 0.82rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
          white-space: nowrap;
        }
        .status-bar-expand {
          font-size: 0.75rem;
          font-weight: 600;
          color: #a855f7;
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.2);
          border-radius: 1rem;
          padding: 0.25rem 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        .status-bar-expand:hover {
          background: rgba(168, 85, 247, 0.2);
          border-color: rgba(168, 85, 247, 0.4);
        }
      `}</style>
    </div>
  );
}
