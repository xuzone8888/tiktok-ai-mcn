/**
 * 角色捏脸舱 — 主页面
 *
 * 路由: /character/create
 * 布局: flex 左右两栏（左 40% / 右 60%）
 * 职责: 仅负责布局编排，不持有任何业务状态（Zustand 通信）
 */

"use client";

import { useEffect } from "react";
import { CreationWorkspace } from "./components/creation-workspace";
import { CastingPreview } from "./components/casting-preview";

export default function CharacterCreatePage() {
  // 页面标题
  useEffect(() => {
    document.title = "角色捏脸舱 | ToryX AI MCN";
  }, []);

  return (
    <div className="character-studio-page">
      {/* 页面标题栏 */}
      <div className="studio-header">
        <div className="studio-header-glow" />
        <h1 className="studio-title">
          <span className="studio-title-icon">✨</span>
          角色捏脸舱
          <span className="studio-title-sub">Character Studio</span>
        </h1>
        <p className="studio-subtitle">
          注入 DNA 特征，铸造专属数字角色
        </p>
      </div>

      {/* 两栏布局 */}
      <div className="studio-content">
        {/* 左栏 40% — 创作工作台 */}
        <div className="studio-left">
          <CreationWorkspace />
        </div>

        {/* 右栏 60% — 铸造预览区 */}
        <div className="studio-right">
          <CastingPreview />
        </div>
      </div>

      <style jsx>{`
        .character-studio-page {
          min-height: 100vh;
          padding: 1.5rem;
          max-width: 1600px;
          margin: 0 auto;
        }

        .studio-header {
          position: relative;
          margin-bottom: 1.5rem;
          padding: 1.25rem 1.5rem;
          background: linear-gradient(
            135deg,
            rgba(0, 242, 234, 0.08) 0%,
            rgba(79, 70, 229, 0.08) 100%
          );
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 1rem;
          overflow: hidden;
        }

        .studio-header-glow {
          position: absolute;
          top: -50%;
          right: -10%;
          width: 300px;
          height: 300px;
          background: radial-gradient(
            circle,
            rgba(0, 242, 234, 0.15) 0%,
            transparent 70%
          );
          pointer-events: none;
        }

        .studio-title {
          position: relative;
          font-size: 1.5rem;
          font-weight: 700;
          color: #f0f0f0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0;
        }

        .studio-title-icon {
          font-size: 1.25rem;
        }

        .studio-title-sub {
          font-size: 0.75rem;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.35);
          margin-left: 0.5rem;
          letter-spacing: 0.05em;
        }

        .studio-subtitle {
          position: relative;
          margin: 0.25rem 0 0;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.45);
        }

        .studio-content {
          display: flex;
          gap: 1.5rem;
          align-items: flex-start;
        }

        .studio-left {
          width: 40%;
          min-width: 380px;
          flex-shrink: 0;
        }

        .studio-right {
          flex: 1;
          min-width: 0;
        }

        @media (max-width: 1024px) {
          .studio-content {
            flex-direction: column;
          }
          .studio-left {
            width: 100%;
            min-width: 0;
          }
        }
      `}</style>
    </div>
  );
}
