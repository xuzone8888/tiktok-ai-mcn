"use client";

import React, { useState, useEffect } from "react";

/**
 * 满屏布局预览页 + 多角度横幅 + 视频生成流程演示
 *
 * 模拟流程：
 * 1. 页面加载 4s → 视频资源就绪 → 自动弹出多角度横幅
 * 2. 点击"生成动态视频" → 进入视频生成中状态
 * 3. 6s 后 → 视频生成完成 → 左侧显示 9:16 竖版视频播放器
 *
 * 路由: /preview-layout
 */

const MOCK_REF_SHEET_URL = "https://picsum.photos/id/1074/1200/400";
// 模拟视频用一个 mp4 示例（公开的 Sintel 预告片）
const MOCK_VIDEO_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4";

export default function PreviewLayoutPage() {
  // === 多角度参考图相关 ===
  const [referenceReady, setReferenceReady] = useState(false);
  const [showRefBanner, setShowRefBanner] = useState(false);
  const [refBannerClosing, setRefBannerClosing] = useState(false);

  // === 视频生成相关 ===
  // "idle" → "generating" → "completed"
  const [videoStage, setVideoStage] = useState<"idle" | "generating" | "completed">("idle");
  const [genProgress, setGenProgress] = useState(0);
  const [genTimeLeft, setGenTimeLeft] = useState(60);

  // 模拟 4 秒后资源就绪
  useEffect(() => {
    const timer = setTimeout(() => setReferenceReady(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  // referenceReady 变 true 后，延迟 800ms 弹出横幅
  useEffect(() => {
    if (referenceReady) {
      const timer = setTimeout(() => setShowRefBanner(true), 800);
      return () => clearTimeout(timer);
    }
  }, [referenceReady]);

  // 视频生成进度模拟
  useEffect(() => {
    if (videoStage !== "generating") return;
    setGenProgress(0);
    setGenTimeLeft(60);
    const interval = setInterval(() => {
      setGenProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setVideoStage("completed");
          return 100;
        }
        return prev + (100 / 60); // 6 秒到 100%
      });
      setGenTimeLeft(prev => Math.max(0, prev - 10));
    }, 100);
    return () => clearInterval(interval);
  }, [videoStage]);

  const closeBanner = () => setRefBannerClosing(true);

  const handleGenerateVideo = () => {
    // 关闭横幅，进入生成状态
    if (showRefBanner) setRefBannerClosing(true);
    setVideoStage("generating");
  };

  return (
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      overflow: "hidden",
      background: "#0a0a0f",
    }}>
      {/* 返回按钮 */}
      <button style={{
        position: "absolute", top: "1.5rem", left: "1.5rem", zIndex: 10,
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 1rem", borderRadius: "2rem",
        background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.6)", fontSize: "0.85rem", cursor: "pointer",
      }} type="button" onClick={() => { setVideoStage("idle"); setReferenceReady(false); setTimeout(() => setReferenceReady(true), 4000); }}>
        ‹ 重置演示
      </button>

      {/* ======= 全屏沉浸背景层 ======= */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
        <div style={{
          width: "100%", height: "100%",
          background: [
            "radial-gradient(ellipse at 30% 45%, rgba(34,80,60,0.8) 0%, transparent 60%)",
            "radial-gradient(ellipse at 25% 35%, rgba(80,60,40,0.6) 0%, transparent 50%)",
            "radial-gradient(ellipse at 35% 55%, rgba(40,70,50,0.5) 0%, transparent 55%)",
            "linear-gradient(180deg, #0a1510 0%, #0d1a14 30%, #050a08 100%)",
          ].join(", "),
        }} />
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: [
            "radial-gradient(circle at 20% 50%, transparent 0%, rgba(5,5,10,0.5) 80%)",
            "linear-gradient(90deg, transparent 35%, rgba(5,5,10,0.5) 75%, rgba(5,5,10,0.85) 100%)",
            "linear-gradient(0deg, rgba(5,5,10,0.8) 0%, transparent 20%)",
          ].join(", "),
        }} />
      </div>

      {/* ===== 多角度参考图横幅弹窗 ===== */}
      {showRefBanner && videoStage === "idle" && (
        <div
          className={`ref-banner ${refBannerClosing ? 'ref-banner--closing' : ''}`}
          onAnimationEnd={() => {
            if (refBannerClosing) {
              setShowRefBanner(false);
              setRefBannerClosing(false);
            }
          }}
        >
          <div className="ref-banner__header">
            <span className="ref-banner__title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ marginRight: '6px' }}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              多角度参考图已就绪
            </span>
            <button className="ref-banner__close" onClick={closeBanner} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="ref-banner__gallery">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MOCK_REF_SHEET_URL} alt="" className="ref-banner__bg" />
            <div className="ref-banner__bg-overlay" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MOCK_REF_SHEET_URL} alt="Multi-angle Reference Sheet" className="ref-banner__img" />
          </div>
        </div>
      )}

      {/* ===== 视频生成中/完成后的播放器 ===== */}
      {videoStage !== "idle" && (
        <div className="video-player-container">
          {videoStage === "generating" ? (
            <div className="video-generating">
              <div className="video-generating__pulse" />
              <svg className="video-generating__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <p className="video-generating__title">动态视频生成中</p>
              <p className="video-generating__subtitle">Veo3 正在为角色赋予生命...</p>
              <div className="video-generating__bar-track">
                <div className="video-generating__bar-fill" style={{ width: `${genProgress}%` }} />
              </div>
              <p className="video-generating__time">预计剩余 {genTimeLeft} 秒</p>
            </div>
          ) : (
            <div className="video-completed">
              <video
                className="video-completed__player"
                src={MOCK_VIDEO_URL}
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="video-completed__badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                8s · 9:16
              </div>
            </div>
          )}
        </div>
      )}

      {/* 模拟人脸柔光 */}
      <div style={{
        position: "absolute", left: "12%", top: "15%", width: "45vh", height: "60vh",
        borderRadius: "50%", zIndex: 1, pointerEvents: "none",
        background: "radial-gradient(ellipse, rgba(180,140,100,0.1) 0%, transparent 70%)",
        filter: "blur(30px)",
      }} />

      {/* ======= 悬浮主操作面板 ======= */}
      <div style={{
        position: "absolute",
        right: "14rem",
        top: "12%",
        bottom: "12%",
        width: "360px",
        background: "rgba(15,15,20,0.35)",
        backdropFilter: "blur(80px)",
        WebkitBackdropFilter: "blur(80px)",
        borderRadius: "1.5rem",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "2.5rem 2rem",
        zIndex: 10,
        boxShadow: "0 25px 60px -15px rgba(0,0,0,0.6), 0 0 30px -5px rgba(0,242,234,0.08), inset 0 1px 0 0 rgba(255,255,255,0.08)",
        animation: "consoleFloat 6s ease-in-out infinite",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center",
      }}>
        {/* 顶部辉光线 */}
        <div style={{
          position: "absolute", top: "-2px", right: "2rem",
          width: "60px", height: "2px",
          background: "linear-gradient(90deg, transparent, rgba(0,242,234,0.8), transparent)",
          filter: "blur(2px)", opacity: 0.6,
        }} />

        {/* 角色名称 */}
        <div style={{ marginBottom: "2rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.75rem", letterSpacing: "0.02em" }}>
            角色名称 <span style={{ color: "#00F2EA" }}>*</span>
          </label>
          <input
            type="text" placeholder="请输入角色名称" defaultValue="九尾狐" maxLength={50}
            style={{
              width: "100%", padding: "0.75rem 1rem",
              background: "rgba(255,255,255,0.03)", border: "1px solid transparent",
              borderRadius: "0.75rem", color: "white", fontSize: "0.9rem", outline: "none",
            }}
          />
        </div>

        {/* 核心风格序列 */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.75rem", letterSpacing: "0.02em" }}>
            核心风格序列
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <span style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>森林冒险</span>
            <span style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>奇幻</span>
          </div>
        </div>

        {/* 保存按钮 */}
        <button type="button" style={{
          width: "100%", padding: "0.8rem", borderRadius: "0.75rem",
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.05)",
          color: "rgba(255,255,255,0.9)", fontSize: "0.9rem", fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginRight: '6px' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          保存当前角色
        </button>
        <div style={{ textAlign: "center", fontSize: "0.7rem", color: "rgba(255,255,255,0.3)", marginTop: "0.75rem" }}>
          保存后可在角色库中随时调用
        </div>

        {/* 分割线 */}
        <div style={{ display: "flex", alignItems: "center", margin: "1.5rem 0" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
          <span style={{ padding: "0 1rem", fontSize: "0.7rem", color: "rgba(255,255,255,0.3)" }}>动态视频</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
        </div>

        {/* ===== 视频资源进度条 ===== */}
        <div style={{ margin: "0.8rem 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{
              fontSize: "0.75rem",
              color: referenceReady ? "#4ade80" : "rgba(255,255,255,0.4)",
              display: "flex", alignItems: "center",
              transition: "color 0.3s",
            }}>
              {referenceReady ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  视频资源已就绪
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  视频资源准备中
                </>
              )}
            </span>
            {referenceReady && (
              <button
                className="ref-icon-btn"
                onClick={() => { setRefBannerClosing(false); setShowRefBanner(true); }}
                title="查看多角度参考图"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </button>
            )}
          </div>
          <div style={{
            height: "4px", borderRadius: "3px",
            background: "rgba(255,255,255,0.04)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
            overflow: "hidden", position: "relative",
          }}>
            <div className={referenceReady ? "prep-fill prep-fill--ready" : "prep-fill"} />
          </div>
        </div>

        {/* 预设动作库 */}
        <div style={{ opacity: referenceReady ? 1 : 0.4, pointerEvents: referenceReady ? "auto" : "none", marginTop: "1rem", transition: "opacity 0.5s" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: "0.75rem" }}>预设动作库</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            <div style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,1)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(0,0,0,0.9)", fontWeight: 500, boxShadow: "0 0 15px -3px rgba(255,255,255,0.3)" }}>走路</div>
            <div style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>打招呼</div>
            <div style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>转身</div>
            <div style={{ padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.04)", borderRadius: "2rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>自定义</div>
          </div>
        </div>

        {/* 生成视频按钮 — 3 种状态 */}
        {videoStage === "idle" && (
          <>
            <button
              className="mermaid-ultra-btn"
              type="button"
              style={{
                opacity: referenceReady ? 1 : 0.4,
                pointerEvents: referenceReady ? "auto" : "none",
                transition: "opacity 0.5s",
              }}
              onClick={handleGenerateVideo}
            >
              <span className="mermaid-ultra-btn__inner">
                {referenceReady ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    生成动态视频 (消耗 10 积分)
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    视频资源准备中...
                  </>
                )}
              </span>
            </button>
            <div style={{ textAlign: "center", fontSize: "0.7rem", color: "rgba(255,255,255,0.3)", marginTop: "0.75rem" }}>
              将自动生成一段 8 秒的展示视频
            </div>
          </>
        )}

        {videoStage === "generating" && (
          <div className="gen-status-panel">
            <div className="gen-status-panel__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 2s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.8rem", color: "white", fontWeight: 600, marginBottom: "6px" }}>
                Veo3 正在生成...
              </div>
              <div style={{
                height: "3px", borderRadius: "2px",
                background: "rgba(255,255,255,0.06)", overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: "2px",
                  width: `${genProgress}%`,
                  background: "linear-gradient(90deg, #CCFF00, #00F2EA)",
                  transition: "width 0.1s linear",
                  boxShadow: "0 0 8px rgba(0,242,234,0.5)",
                }} />
              </div>
              <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "4px" }}>
                预计剩余 {genTimeLeft} 秒 · 9:16 竖版 · 8 秒
              </div>
            </div>
          </div>
        )}

        {videoStage === "completed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button className="mermaid-ultra-btn" type="button" style={{ padding: "0.75rem" }}>
              <span className="mermaid-ultra-btn__inner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                下载视频
              </span>
            </button>
            <button type="button" style={{
              width: "100%", padding: "0.65rem", borderRadius: "0.75rem",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }} onClick={() => setVideoStage("generating")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              重新生成
            </button>
            <div style={{ textAlign: "center", fontSize: "0.65rem", color: "rgba(255,255,255,0.25)" }}>
              ✓ 视频已生成 · 8 秒 · 9:16 竖版
            </div>
          </div>
        )}
      </div>

      {/* ======= 全局样式 ======= */}
      <style>{`
        @keyframes consoleFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* ===== 进度条 ===== */
        .prep-fill {
          height: 100%; border-radius: 3px; width: 45%;
          background: linear-gradient(90deg, #CCFF00, #00F2EA);
          box-shadow: 0 0 8px rgba(0,242,234,0.4), 0 0 20px rgba(0,242,234,0.15);
          transition: width 0.8s cubic-bezier(0.22,1,0.36,1), background 0.5s;
          animation: prepPulse 2s ease-in-out infinite;
          position: relative; overflow: hidden;
        }
        .prep-fill::after {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, transparent 60%, rgba(255,255,255,0.5) 80%, transparent 100%);
          animation: prepShimmer 2s ease-in-out infinite;
        }
        .prep-fill--ready {
          width: 100% !important;
          background: linear-gradient(90deg, #22c55e, #4ade80, #86efac) !important;
          box-shadow: 0 0 10px rgba(74,222,128,0.5), 0 0 25px rgba(34,197,94,0.2) !important;
          animation: readyGlow 3s ease-in-out infinite !important;
        }
        .prep-fill--ready::after { animation: none !important; background: transparent !important; }
        @keyframes prepPulse { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
        @keyframes prepShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes readyGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(74,222,128,0.4), 0 0 25px rgba(34,197,94,0.15); }
          50% { box-shadow: 0 0 15px rgba(74,222,128,0.6), 0 0 35px rgba(34,197,94,0.25); }
        }

        /* ===== 小图标按钮 ===== */
        .ref-icon-btn {
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px; padding: 3px 6px; color: rgba(255,255,255,0.5);
          cursor: pointer; transition: all 0.2s; display: flex; align-items: center;
        }
        .ref-icon-btn:hover { background: rgba(255,255,255,0.12); color: white; }

        /* ===== 多角度横幅弹窗 ===== */
        .ref-banner {
          position: absolute; top: 18%; bottom: 18%; left: 5%; right: 38%; z-index: 5;
          background: rgba(10,10,15,0.6); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
          border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.1); padding: 1rem;
          box-shadow: 0 20px 50px -10px rgba(0,0,0,0.6), 0 0 20px -5px rgba(0,242,234,0.1), inset 0 1px 0 0 rgba(255,255,255,0.08);
          animation: refBannerSlideIn 0.6s cubic-bezier(0.22,1,0.36,1) forwards;
          overflow: hidden; display: flex; flex-direction: column;
        }
        .ref-banner--closing { animation: refBannerSlideOut 0.4s cubic-bezier(0.4,0,1,1) forwards !important; }
        .ref-banner__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-shrink: 0; }
        .ref-banner__title { font-size: 0.8rem; font-weight: 600; color: rgba(255,255,255,0.8); display: flex; align-items: center; }
        .ref-banner__close {
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.5rem; padding: 4px; color: rgba(255,255,255,0.5);
          cursor: pointer; transition: all 0.2s; display: flex; align-items: center;
        }
        .ref-banner__close:hover { background: rgba(255,255,255,0.12); color: white; }
        .ref-banner__gallery { flex: 1; min-height: 0; position: relative; border-radius: 0.75rem; overflow: hidden; }
        .ref-banner__bg {
          position: absolute; inset: -20px; width: calc(100% + 40px); height: calc(100% + 40px);
          object-fit: cover; filter: blur(25px) brightness(0.4); z-index: 0;
        }
        .ref-banner__bg-overlay { position: absolute; inset: 0; background: rgba(10,10,15,0.3); z-index: 1; }
        .ref-banner__img { position: relative; width: 100%; height: 100%; object-fit: contain; z-index: 2; }
        @keyframes refBannerSlideIn { 0% { transform: translateY(20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        @keyframes refBannerSlideOut { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(20px); opacity: 0; } }

        /* ===== 视频播放器容器 ===== */
        .video-player-container {
          position: absolute;
          top: 5%; bottom: 5%;
          left: 22%;
          aspect-ratio: 9 / 16;
          height: 90%;
          z-index: 5;
          animation: videoContainerIn 0.8s cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes videoContainerIn {
          0% { transform: scale(0.9) translateY(20px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* 视频生成中 */
        .video-generating {
          width: 100%; height: 100%;
          background: rgba(10,10,15,0.6);
          backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
          border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.08);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
        }
        .video-generating__pulse {
          position: absolute; inset: 0;
          border-radius: 1.5rem;
          box-shadow: inset 0 0 80px rgba(0,242,234,0.05);
          animation: genPulse 3s ease-in-out infinite;
        }
        @keyframes genPulse {
          0%, 100% { box-shadow: inset 0 0 60px rgba(0,242,234,0.03); }
          50% { box-shadow: inset 0 0 100px rgba(0,242,234,0.08); }
        }
        .video-generating__icon {
          color: rgba(255,255,255,0.15);
          margin-bottom: 1.5rem;
          animation: genIconPulse 2s ease-in-out infinite;
        }
        @keyframes genIconPulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.05); }
        }
        .video-generating__title {
          color: white; font-size: 1.1rem; font-weight: 600; margin: 0 0 0.5rem;
        }
        .video-generating__subtitle {
          color: rgba(255,255,255,0.4); font-size: 0.8rem; margin: 0 0 2rem;
        }
        .video-generating__bar-track {
          width: 60%; height: 4px; border-radius: 3px;
          background: rgba(255,255,255,0.06); overflow: hidden;
        }
        .video-generating__bar-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, #CCFF00, #00F2EA);
          box-shadow: 0 0 10px rgba(0,242,234,0.5);
          transition: width 0.1s linear;
        }
        .video-generating__time {
          color: rgba(255,255,255,0.3); font-size: 0.7rem; margin: 0.75rem 0 0;
        }

        /* 视频播放完成 */
        .video-completed {
          width: 100%; height: 100%;
          border-radius: 1.5rem; overflow: hidden;
          position: relative;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 25px 60px -10px rgba(0,0,0,0.7), 0 0 30px -5px rgba(0,242,234,0.1);
        }
        .video-completed__player {
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 1.5rem;
        }
        .video-completed__badge {
          position: absolute; bottom: 1rem; left: 1rem;
          display: flex; align-items: center; gap: 6px;
          padding: 0.35rem 0.75rem; border-radius: 2rem;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
          color: rgba(255,255,255,0.8); font-size: 0.7rem; font-weight: 500;
        }

        /* ===== 面板中的生成状态 ===== */
        .gen-status-panel {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 1rem; border-radius: 0.75rem;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
        }
        .gen-status-panel__icon {
          color: #00F2EA; flex-shrink: 0; padding-top: 2px;
        }

        /* ===== Mermaid Ultra 按钮 ===== */
        .mermaid-ultra-btn {
          position: relative; width: 100%; padding: 0.95rem 1rem;
          border-radius: 0.85rem; border: none; border-top: 1px solid rgba(255,255,255,0.5);
          font-size: 0.95rem; cursor: pointer;
          background: linear-gradient(135deg, #CCFF00, #00F2EA, #EC4899, #CCFF00);
          background-size: 300% 300%; animation: mermaidFlow 5s ease infinite;
          color: #000; font-weight: 800; letter-spacing: 0.5px; overflow: hidden;
          box-shadow: 0 12px 40px -8px rgba(0,242,234,0.5), 0 4px 20px -4px rgba(236,72,153,0.3), inset 0 4px 15px rgba(255,255,255,0.35);
          transition: all 0.3s cubic-bezier(0.22,1,0.36,1);
        }
        .mermaid-ultra-btn__inner { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; }
        .mermaid-ultra-btn::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
          background: linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 60%, transparent 100%);
          border-radius: 0.85rem 0.85rem 0 0; pointer-events: none; z-index: 1;
        }
        .mermaid-ultra-btn::after {
          content: ''; position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
          background: linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.7) 50%, transparent 80%);
          transform: skewX(-20deg); animation: mermaidShine 5s infinite cubic-bezier(0.4,0,0.2,1);
          pointer-events: none; z-index: 3;
        }
        .mermaid-ultra-btn:hover {
          transform: scale(1.03) translateY(-1px);
          box-shadow: 0 16px 50px -8px rgba(236,72,153,0.6), 0 0 35px rgba(0,242,234,0.4), inset 0 4px 20px rgba(255,255,255,0.5);
        }
        .mermaid-ultra-btn:active { transform: scale(0.97); }
        @keyframes mermaidFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes mermaidShine { 0% { left: -120%; opacity: 0; } 8% { opacity: 1; } 18% { left: 200%; opacity: 0; } 100% { left: 200%; opacity: 0; } }
      `}</style>
    </div>
  );
}
