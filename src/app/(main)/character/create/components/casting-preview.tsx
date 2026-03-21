/**
 * 铸造预览区 — 右栏组件
 *
 * 3 种状态：
 * 1. 空态（idle）— 科技感占位符
 * 2. 生成中（generating/polling）— 骨架屏动画
 * 3. 生成完毕（completed）— 3:4 角色卡片 + 命名保存
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  useCharacterStudioStore,
  useCharacterGenerationStatus,
  useCharacterHeroImage,
  useCharacterIsGenerating,
} from "@/stores/character-studio-store";

export function CastingPreview() {
  const store = useCharacterStudioStore();
  const generationStatus = useCharacterGenerationStatus();
  const generatedImageUrl = useCharacterHeroImage();
  const isGenerating = useCharacterIsGenerating();

  const [showFullImage, setShowFullImage] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showRefBanner, setShowRefBanner] = useState(false);
  const [refBannerClosing, setRefBannerClosing] = useState(false);

  // ====== 视频生成状态 ======
  const [videoStage, setVideoStage] = useState<"idle" | "generating" | "completed">("idle");
  const [genProgress, setGenProgress] = useState(0);
  const [genTimeLeft, setGenTimeLeft] = useState(60);

  // ====== 幻影进度条与终端流状态 ======
  const [fakeProgress, setFakeProgress] = useState(0);
  const [terminalLog, setTerminalLog] = useState("[SYS] 初始化引擎组件...");
  
  const LOG_MESSAGES = [
    "[SYS] 初始化引擎组件...",
    "[MOD] 挂载高分辨率纹理...",
    "[MOD] 注入风格特征基因...",
    "[AI] 运算神经网络拓扑...",
    "[SYS] 打包骨骼绑定数据...",
    "[AI] 渲染物理光影贴图...",
    "[MOD] 校验顶点色彩偏差...",
    "[SYS] 同步终端缓存数据..."
  ];

  // 当进入 generating 状态时，启动进度与日志轮询
  useEffect(() => {
    if (generationStatus === "generating" || generationStatus === "polling") {
      setFakeProgress(0);
      
      const progressTimer = setInterval(() => {
        setFakeProgress((prev) => {
          if (prev >= 92) return prev;
          // 随机跳跃假进度
          return prev + Math.floor(Math.random() * 3) + 1;
        });
      }, 600);
      
      let logIndex = 0;
      const logTimer = setInterval(() => {
        logIndex = (logIndex + 1) % LOG_MESSAGES.length;
        setTerminalLog(LOG_MESSAGES[logIndex]);
      }, 1000);

      return () => {
        clearInterval(progressTimer);
        clearInterval(logTimer);
      };
    } else if (generationStatus === "completed") {
      setFakeProgress(100);
      setTerminalLog("[SYS] 生成就绪");
    }
  }, [generationStatus]);

  // ====== 真实 API 任务轮询机制 ======
  useEffect(() => {
    if (generationStatus !== "polling" || !store.heroTaskId) return;

    let pollCount = 0;
    const MAX_POLLS = 120; // 最长等待约 6 分钟 (120 * 3s)
    let isPolling = true;

    const pollTask = async () => {
      try {
        const res = await fetch(`/api/characters/generate?taskId=${store.heroTaskId}`);
        if (!res.ok) throw new Error(`Task fetch failed: ${res.status}`);
        const data = await res.json();

        if (!data.success || !data.task) {
          throw new Error(data.error || "查询返回异常");
        }

        const task = data.task;

        // 成功出图
        if (task.status === "completed" && task.resultUrl) {
          store.setHeroResult(task.resultUrl);
          // 自动触发多角度生成（静默，不影响主流程）
          autoSubmitReference(task.resultUrl, store.refPrompt || store.prompt);
          return; // 结束轮询
        }

        // 生成失败
        if (task.status === "failed") {
          store.setGenerationFailed(task.errorMessage || "模型渲染异常");
          return;
        }

        // 继续轮询
        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed("生成超时，请稍后再试");
          return;
        }

        if (isPolling) {
          setTimeout(pollTask, 3000);
        }
      } catch (err) {
        console.error("[Polling] Error:", err);
        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed("网络连接断开，请重试");
        } else if (isPolling) {
          setTimeout(pollTask, 3000); // 发生错误也稍后再试，可能只是网络波动
        }
      }
    };

    pollTask();

    return () => {
      isPolling = false;
    };
  }, [generationStatus, store.heroTaskId, store]);
  // ===================================

  // ====== 多角度自动提交 ======
  const autoSubmitReference = async (heroUrl: string, prompt: string) => {
    try {
      const res = await fetch("/api/characters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          userId: store.userId,
          type: "reference",
          heroImageUrl: heroUrl,
        }),
      });
      const data = await res.json();
      if (data.success && data.referenceTaskId) {
        store.setReferenceTaskId(data.referenceTaskId);
      }
    } catch (err) {
      console.error("[AutoRef] 静默失败:", err);
    }
  };

  // ====== 多角度轮询 ======
  useEffect(() => {
    if (!store.referenceTaskId || store.referenceReady) return;
    let active = true;
    let count = 0;
    const MAX_POLLS = 200; // 最长等待 ~10 分钟 (200 * 3s)
    const poll = async () => {
      try {
        const res = await fetch(`/api/characters/generate?taskId=${store.referenceTaskId}`);
        const data = await res.json();
        console.log(`[RefPoll] #${count} status:`, data.task?.status);
        if (data.success && data.task?.status === "completed" && data.task.resultUrl) {
          store.setReferenceResult(data.task.resultUrl);
          console.log("[RefPoll] ✅ Reference ready!");
          return;
        }
        if (data.task?.status === "failed") {
          console.error("[RefPoll] ❌ Task failed");
          alert("多角度参考图生成失败，请重新铸造角色");
          return;
        }
        if (++count >= MAX_POLLS) {
          console.warn("[RefPoll] ⏰ Timeout after", MAX_POLLS, "polls");
          alert("多角度参考图生成超时（>10分钟），请重新铸造角色");
          return;
        }
      } catch (err) {
        console.warn("[RefPoll] Network error, retrying...", err);
      }
      if (active) setTimeout(poll, 3000);
    };
    poll();
    return () => { active = false; };
  }, [store.referenceTaskId, store.referenceReady, store]);
  // ===================================

  // ====== 多角度就绪自动弹出横幅 ======
  useEffect(() => {
    if (store.referenceReady && store.referenceSheetUrl && showSavePanel) {
      const timer = setTimeout(() => setShowRefBanner(true), 800);
      return () => clearTimeout(timer);
    }
  }, [store.referenceReady, store.referenceSheetUrl, showSavePanel]);
  // ====================================

  // ====== 视频生成真实 API 调用 + 轮询 ======
  const handleGenerateVideo = useCallback(async () => {
    if (!store.referenceReady || !generatedImageUrl || !store.userId) return;
    // 关闭横幅
    if (showRefBanner) setRefBannerClosing(true);
    setVideoStage("generating");
    setGenProgress(0);
    setGenTimeLeft(60);

    try {
      // 提交视频生成任务
      const res = await fetch("/api/characters/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceImageUrl: store.referenceSheetUrl,
          prompt: store.refPrompt || store.prompt || "A character performing a natural movement",
          userId: store.userId,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.taskId) {
        alert(data.error || "视频生成提交失败");
        setVideoStage("idle");
        return;
      }
      store.setActivationTaskId(data.taskId);
      store.setIsActivating(true);

      // 轮询视频生成状态
      let pollCount = 0;
      const poll = async () => {
        pollCount++;
        try {
          const r = await fetch(`/api/characters/activate?taskId=${data.taskId}`);
          const d = await r.json();
          if (d.success && d.task?.status === "completed" && d.task.resultUrl) {
            store.setActivationResult(d.task.resultUrl);
            store.setIsActivating(false);
            setVideoStage("completed");
            setGenProgress(100);
            return;
          }
          if (d.task?.status === "failed" || pollCount >= 120) {
            alert("视频生成失败，请重试");
            setVideoStage("idle");
            store.setIsActivating(false);
            return;
          }
        } catch { /* 静默重试 */ }
        // 更新进度条（估算）
        setGenProgress(prev => Math.min(95, prev + 0.8));
        setGenTimeLeft(prev => Math.max(0, prev - 3));
        setTimeout(poll, 3000);
      };
      poll();
    } catch (error) {
      console.error("[Activate] Error:", error);
      alert("视频生成请求失败");
      setVideoStage("idle");
    }
  }, [store, generatedImageUrl, showRefBanner]);
  // ====================================

  // 保存角色
  const handleSave = useCallback(async () => {
    if (!store.characterName.trim()) {
      alert("请先输入角色名称");
      return;
    }
    if (!generatedImageUrl) {
      alert("角色图片尚未生成完成");
      return;
    }
    if (!store.referenceReady || !store.referenceSheetUrl) {
      alert("多角度参考图尚未就绪，请稍候再保存");
      return;
    }
    if (store.isSaving) return;

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
          // Hero Shot 4K 作为展示头像
          avatar_url: store.heroImageUrl || generatedImageUrl,
          reference_images: [store.heroImageUrl || generatedImageUrl],
          // 多角度参考图状态
          reference_sheet_url: store.referenceSheetUrl || null,
          reference_status: store.referenceReady
            ? "completed"
            : store.referenceTaskId
              ? "pending"
              : "none",
          reference_task_id: store.referenceTaskId || null,
          // 活化视频（用户选择保存时才有值）
          preview_video_url: store.activationVideoUrl || null,
          // DNA 配置
          character_type: store.dnaConfig.species,
          dna_config: store.dnaConfig,
          style_tags: store.characterTags,
          gender: store.dnaConfig.gender,
          age_range: store.dnaConfig.ageGroup || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert("✅ 角色已保存至专属阵营！");
        store.reset();
        // 跳转到专属阵营查看新角色
        window.location.href = "/team";
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

      {/* 状态 2：生成中 (The Precision Ring Pro) */}
      {isGenerating && (
        <div className="preview-generating">
          <div className="gen-grid-bg" />
          <div className="gen-grid-fade" />

          {/* 居中主控环 */}
          <div className="loader-container">
            <div className="gen-outer-ring" />
            <div className="gen-inner-ring" />
            <div className="gen-data-core">
              <span className="gen-percentage tabular-nums">{fakeProgress}%</span>
              <span className="gen-eta tabular-nums">ETA 00:14s</span>
            </div>
          </div>

          {/* 状态徽章与终端流 */}
          <div className="status-terminal-area">
            <div className="gen-status-badge">
              <div className="status-dot" />
              <span className="status-text text-white">
                {generationStatus === "polling" 
                  ? "AI 正在构建角色模型..."
                  : "启动模型计算引擎..."}
              </span>
            </div>
            
            <div className="gen-terminal-stream text-xs text-white/30 truncate text-center h-4 flex items-center justify-center font-mono">
              <span key={terminalLog} className="animate-pulse">{terminalLog}</span>
            </div>
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

      {/* 状态 3：生成完毕 — 角色卡片居中展示 (Hero Reveal Card) */}
      {generationStatus === "completed" && generatedImageUrl && !showSavePanel && (
        <>
          {/* 返回/重新配置 */}
          <button
            className="btn-back-floating"
            onClick={() => store.setCurrentStep(1)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            重新配置
          </button>

          {/* 居中卡片展示区 */}
          <div className="hero-card-stage">
            {/* 模糊背景层：角色图片放大铺底 */}
            <div className="hero-blur-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={generatedImageUrl} alt="" className="hero-blur-img" />
            </div>
            {/* 出场冲击波 */}
            <div className="hero-shockwave" />
            {/* 角色卡片 */}
            <div className="hero-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={generatedImageUrl}
                className="hero-card-img"
                alt="Hero Character"
              />
            </div>

            {/* 底部操作按钮 */}
            <div className="hero-card-actions">
              <button
                className="hero-btn hero-btn--primary"
                onClick={() => setShowSavePanel(true)}
                type="button"
              >
                ✦ 保存角色
              </button>
            </div>
          </div>

          {/* 多角度参考图弹窗 */}
          {store.showRefModal && (
            <div className="ref-modal-overlay" onClick={() => store.setShowRefModal(false)}>
              <div className="ref-modal" onClick={(e) => e.stopPropagation()}>
                <button className="ref-modal-close" onClick={() => store.setShowRefModal(false)} type="button">✕</button>
                <h3 className="ref-modal-title">🎭 多角度参考图生成</h3>
                <p className="ref-modal-desc">基于当前角色 Hero Shot，生成 7 个角度的标准参考图（正面、侧面、背面等），可用于后续视频制作中的角色一致性。</p>
                
                {store.referenceSheetUrl ? (
                  <div className="ref-result">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={store.referenceSheetUrl} alt="Multi-angle Reference" className="ref-result-img" />
                    <p className="ref-result-hint">✅ 多角度参考图已生成</p>
                  </div>
                ) : store.referenceTaskId ? (
                  <div className="ref-loading">
                    <div className="ref-spinner" />
                    <p>多角度图片生成中，请稍候...</p>
                  </div>
                ) : (
                  <button
                    className="ref-generate-btn"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/characters/generate", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            prompt: store.refPrompt || store.prompt,
                            userId: store.userId,
                            type: "reference",
                            heroImageUrl: generatedImageUrl,
                          }),
                        });
                        const data = await res.json();
                        if (data.success && data.referenceTaskId) {
                          store.setTaskIds(store.heroTaskId, data.referenceTaskId);
                        }
                      } catch (err) {
                        console.error("[RefGen] Error:", err);
                      }
                    }}
                    type="button"
                  >
                    ✨ 开始生成多角度参考图
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 状态 4：保存/激活面板 (Abyssal Void Console) */}
      {generationStatus === "completed" && generatedImageUrl && showSavePanel && (
        <>
          {/* 返回英雄出场页 */}
          <button
            className="btn-back-floating"
            onClick={() => setShowSavePanel(false)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            返回预览
          </button>

          {/* 全屏沉浸英雄图层 */}
          <div className="hero-bg-container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generatedImageUrl}
              className="hero-bg-image"
              alt="Hero Background"
            />
            <div className="hero-vignette"></div>
          </div>

          {/* ===== 多角度参考图横幅弹窗（仅 idle 阶段显示） ===== */}
          {showRefBanner && store.referenceSheetUrl && videoStage === "idle" && (
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
                <button
                  className="ref-banner__close"
                  onClick={() => setRefBannerClosing(true)}
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className="ref-banner__gallery">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={store.referenceSheetUrl} alt="" className="ref-banner__bg" />
                <div className="ref-banner__bg-overlay" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={store.referenceSheetUrl} alt="Multi-angle Reference Sheet" className="ref-banner__img" />
              </div>
            </div>
          )}

          {/* ===== 视频生成中 / 完成后播放器 ===== */}
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
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    className="video-completed__player"
                    src={store.activationVideoUrl || undefined}
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

          {/* 悬浮主操作面板 (Abyssal Void Console) */}
          <div className="air-glass-console">
            <div className="console-glow-dot"></div>

            <div className="console-section">
              <label className="console-label">角色名称 <span className="text-[#00F2EA]">*</span></label>
              <input 
                type="text" 
                className="mer-input" 
                placeholder="请输入角色名称" 
                value={store.characterName}
                onChange={(e) => store.setCharacterName(e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="console-section" style={{ marginBottom: "1.5rem" }}>
              <label className="console-label">核心风格序列</label>
              <div className="pill-group">
                {store.characterTags.length > 0 ? (
                  store.characterTags.map((tag) => (
                    <span key={tag} className="mer-pill">
                      {tag}
                      <button
                        className="tag-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTag(tag);
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-white/40 text-xs">暂无风格标签</span>
                )}
                
                <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '8px' }}>
                  <input
                    type="text"
                    className="tag-input-ghost"
                    placeholder="添加标签..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    maxLength={20}
                  />
                  <button
                    className="tag-add-ghost-btn"
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    type="button"
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>

            <button 
              className="btn-save"
              onClick={handleSave}
              disabled={!store.characterName.trim() || !generatedImageUrl || !store.referenceReady || store.isSaving}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginRight: '8px' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {store.isSaving ? "保存中..." : "保存当前角色"}
            </button>
            <div className="helper-text">
              {generatedImageUrl && !store.referenceReady
                ? "多角度参考图生成中，请稍候..."
                : "保存后可在角色库中随时调用"}
            </div>

            <div className="divider">
              <div className="divider-text">动态视频</div>
            </div>

            {/* 视频资源进度条 */}
            <div className="video-prep-section">
              <div className="video-prep-header">
                <span className={`video-prep-label ${store.referenceReady ? 'is-ready' : ''}`}>
                  {store.referenceReady 
                    ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', display: 'inline', verticalAlign: '-2px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 视频资源已就绪</>
                    : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', display: 'inline', verticalAlign: '-2px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 视频资源准备中</>}
                </span>
                {store.referenceReady && (
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
              <div className="video-prep-bar">
                <div className={`video-prep-fill ${store.referenceReady ? 'is-ready' : ''}`} />
              </div>
            </div>

            <div className="console-section" style={{ opacity: store.referenceReady ? 1 : 0.4, pointerEvents: store.referenceReady ? 'auto' : 'none', marginTop: '1rem' }}>
              <label className="console-label">预设动作库</label>
              <div className="pill-group" style={{ marginBottom: '1rem' }}>
                <div className="mer-pill active">走路</div>
                <div className="mer-pill">打招呼</div>
                <div className="mer-pill">转身</div>
                <div className="mer-pill">自定义</div>
              </div>
            </div>

            {/* 生成视频按钮 — 3 阶段 */}
            {videoStage === "idle" && (
              <>
                <button 
                  className={`btn-activate ${store.referenceReady ? 'btn-activate--ready' : 'btn-activate--pending'}`}
                  onClick={handleGenerateVideo}
                  disabled={!store.referenceReady || store.isSaving}
                  type="button"
                >
                  {store.referenceReady 
                    ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', display: 'inline', verticalAlign: '-2px' }}><polygon points="5 3 19 12 5 21 5 3"/></svg> 生成动态视频 (消耗 10 积分)</>
                    : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', display: 'inline', verticalAlign: '-2px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 视频资源准备中...</>}
                </button>
                <div className="helper-text">将自动生成一段 8 秒的展示视频</div>
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
                  <div style={{ fontSize: '0.8rem', color: 'white', fontWeight: 600, marginBottom: '6px' }}>Veo3 正在生成...</div>
                  <div style={{ height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '2px', width: `${genProgress}%`, background: 'linear-gradient(90deg, #CCFF00, #00F2EA)', transition: 'width 0.3s linear', boxShadow: '0 0 8px rgba(0,242,234,0.5)' }} />
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>预计剩余 {genTimeLeft} 秒 · 9:16 竖版 · 8 秒</div>
                </div>
              </div>
            )}
            {videoStage === "completed" && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <a
                  className="btn-activate btn-activate--ready"
                  href={store.activationVideoUrl || '#'}
                  download
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', display: 'inline', verticalAlign: '-2px' }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  下载视频
                </a>
                <button
                  className="btn-activate btn-activate--pending"
                  type="button"
                  onClick={() => { setVideoStage("idle"); setGenProgress(0); setGenTimeLeft(60); }}
                  style={{ opacity: 0.7 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', display: 'inline', verticalAlign: '-2px' }}>
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  重新生成
                </button>
                <div className="helper-text">✓ 视频已生成 · 8 秒 · 9:16 竖版</div>
              </div>
            )}
          </div>
        </>
      )}

      <style jsx>{`
        .casting-preview {
          background: transparent;
          border: none;
          border-radius: 0;
          min-height: 100vh;
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

        /* ===== Generating State (The Precision Ring Pro) ===== */
        .preview-generating {
          position: fixed;
          inset: 0;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #050508;
          z-index: 1;
        }

        .gen-grid-bg {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: panGrid 60s linear infinite;
          opacity: 0.5;
        }
        
        @keyframes panGrid {
          0% { transform: translateY(0); }
          100% { transform: translateY(-400px); }
        }

        .gen-grid-fade {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at center, transparent 30%, #050508 80%);
          pointer-events: none;
        }

        .loader-container {
          position: relative;
          width: 220px;
          height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 2.5rem;
          z-index: 10;
        }

        .gen-outer-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #00F2EA, #CCFF00, #EC4899, #00F2EA);
          -webkit-mask: radial-gradient(transparent 65%, black 66%);
          mask: radial-gradient(transparent 65%, black 66%);
          animation: spinFast 3s linear infinite;
          box-shadow: 0 0 30px rgba(0,242,234,0.2);
        }

        @keyframes spinFast {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .gen-inner-ring {
          position: absolute;
          width: 85%;
          height: 85%;
          border-radius: 50%;
          border: 1px dashed rgba(255, 255, 255, 0.15);
          animation: spinReverse 20s linear infinite reverse;
        }

        @keyframes spinReverse {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .gen-data-core {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 5;
        }

        .gen-percentage {
          font-size: 3rem;
          font-weight: 700;
          background: linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1;
          margin-bottom: 0.2rem;
        }

        .gen-eta {
          font-size: 0.75rem;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.05em;
        }

        .status-terminal-area {
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }

        .gen-status-badge {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 1.25rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 2rem;
          backdrop-filter: blur(10px);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00F2EA;
          box-shadow: 0 0 10px #00F2EA;
          animation: pulseDot 1.5s ease-in-out infinite;
        }

        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }

        .status-text {
          font-size: 0.85rem;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        /* ===== Failed State ===== */
        .preview-failed {
          text-align: center;
          padding: 3rem;
           /* ===== Genshin Hero Reveal Completed State ===== */
        .hero-bg-container {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          border-radius: 1rem;
        }

        .hero-bg-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: 35% 20%;
          animation: cinematicEnter 3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }

        .hero-vignette {
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(circle at 20% 50%, transparent 0%, rgba(5, 5, 10, 0.5) 80%),
            linear-gradient(90deg, transparent 35%, rgba(5, 5, 10, 0.5) 75%, rgba(5, 5, 10, 0.85) 100%),
            linear-gradient(0deg, rgba(5, 5, 10, 0.8) 0%, transparent 20%);
          pointer-events: none;
        }

        @keyframes cinematicEnter {
          0% {
            transform: scale(1.08);
            filter: brightness(0.5) blur(10px);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            filter: brightness(1) blur(0px);
            opacity: 1;
          }
        }

        .btn-back-floating {
          position: absolute;
          top: 1.5rem;
          left: 1.5rem;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border-radius: 2rem;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.3s;
        }

        .btn-back-floating:hover {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transform: translateX(-2px);
        }

        /* ===== Abyssal Void Console ===== */
        .air-glass-console {
          position: absolute;
          right: 14rem;
          top: 50%;
          transform: translateY(-50%);
          width: 360px;
          background: rgba(15, 15, 20, 0.35);
          backdrop-filter: blur(80px);
          -webkit-backdrop-filter: blur(80px);
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 2.5rem 2rem;
          z-index: 10;
          box-shadow: 
            0 25px 60px -15px rgba(0, 0, 0, 0.6),
            0 0 30px -5px rgba(0, 242, 234, 0.08),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
          animation: consoleSlideIn 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards, consoleFloat 6s ease-in-out 1.5s infinite;
          opacity: 0;
        }

        @keyframes consoleSlideIn {
          0% { transform: translate(30px, -50%); opacity: 0; }
          100% { transform: translate(0, -50%); opacity: 1; }
        }

        @keyframes consoleFloat {
          0%, 100% { transform: translate(0, -50%); }
          50% { transform: translate(0, calc(-50% - 8px)); }
        }

        .console-glow-dot {
          position: absolute;
          top: -2px;
          right: 2rem;
          width: 60px;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(0, 242, 234, 0.8), transparent);
          filter: blur(2px);
          opacity: 0.6;
        }

        .console-section {
          margin-bottom: 2rem;
        }

        .console-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 0.75rem;
          letter-spacing: 0.02em;
        }

        .mer-input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid transparent;
          border-radius: 0.75rem;
          color: white;
          font-size: 0.9rem;
          outline: none;
          transition: all 0.3s;
        }

        .mer-input:focus {
          background: rgba(0, 242, 234, 0.05);
          border-bottom: 1px solid rgba(0, 242, 234, 0.5);
          box-shadow: 0 4px 12px -5px rgba(0, 242, 234, 0.2);
        }

        .mer-input::placeholder {
          color: rgba(255, 255, 255, 0.2);
        }

        .pill-group {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .mer-pill {
          padding: 0.4rem 0.8rem;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 2rem;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          transition: all 0.3s;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
        }

        .mer-pill:hover {
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.8);
        }

        .mer-pill.active {
          background: rgba(255, 255, 255, 1);
          color: rgba(0, 0, 0, 0.9);
          font-weight: 500;
          box-shadow: 0 0 15px -3px rgba(255, 255, 255, 0.3);
        }

        .tag-remove {
          background: none;
          border: none;
          padding: 0 2px;
          margin-left: 2px;
          color: inherit;
          opacity: 0.5;
          cursor: pointer;
        }
        .tag-remove:hover {
          opacity: 1;
          color: #ef4444;
        }
        
        .tag-input-ghost {
          flex: 1;
          background: transparent;
          border: none;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          font-size: 0.8rem;
          padding: 0.2rem 0;
          outline: none;
        }
        
        .tag-add-ghost-btn {
          background: none;
          border: none;
          color: rgba(0, 242, 234, 0.7);
          font-size: 0.8rem;
          cursor: pointer;
        }
        .tag-add-ghost-btn:disabled {
          color: rgba(255, 255, 255, 0.2);
          cursor: not-allowed;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 1.5rem 0;
        }

        .divider::before, .divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: rgba(255, 255, 255, 0.05);
        }

        .divider-text {
          padding: 0 1rem;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.3);
        }

        .btn-save {
          width: 100%;
          padding: 0.85rem 1rem;
          border-radius: 0.75rem;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.95);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 15px -3px rgba(0,0,0,0.3),
                      inset 0 1px 0 rgba(255,255,255,0.1);
        }

        .btn-save:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.14);
          border-color: rgba(255, 255, 255, 0.25);
          box-shadow: 0 6px 20px -3px rgba(0,0,0,0.4),
                      inset 0 1px 0 rgba(255,255,255,0.15);
          transform: translateY(-1px);
        }
        .btn-save:disabled {
           opacity: 0.4;
           cursor: not-allowed;
        }

        .btn-activate {
          width: 100%;
          padding: 0.9rem;
          border-radius: 0.75rem;
          border: none;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .btn-activate--pending {
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.3);
          box-shadow: none;
          cursor: not-allowed;
          font-weight: 500;
        }

        .btn-activate--ready {
          position: relative;
          background: linear-gradient(135deg, rgba(204, 255, 0, 0.9), rgba(0, 242, 234, 0.9), rgba(236, 72, 153, 0.9), rgba(204, 255, 0, 0.9));
          background-size: 300% 300%;
          animation: mermaidFlow 5s ease infinite;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-top: 1px solid rgba(255, 255, 255, 0.45);
          color: #000;
          font-weight: 800;
          letter-spacing: 0.5px;
          box-shadow: 
            0 10px 40px -10px rgba(0, 242, 234, 0.6),
            inset 0 4px 15px rgba(255, 255, 255, 0.4);
          overflow: hidden;
        }
        .btn-activate--ready::after {
          content: '';
          position: absolute;
          top: 0; left: -100%; width: 50%; height: 100%;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.6), transparent);
          transform: skewX(-20deg);
          animation: mermaidShine 6s infinite cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }
        .btn-activate--ready:hover {
          transform: scale(1.02);
          box-shadow: 
            0 14px 50px -10px rgba(236, 72, 153, 0.7),
            0 0 20px rgba(0, 242, 234, 0.5),
            inset 0 4px 20px rgba(255, 255, 255, 0.6);
          border-color: rgba(255, 255, 255, 0.6);
        }
        .btn-activate--ready:active {
          transform: scale(0.96);
          box-shadow: 0 5px 20px -5px rgba(0, 242, 234, 0.5);
        }

        /* 视频资源进度条 */
        .video-prep-section { margin: 0.8rem 0; }
        .video-prep-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
        }
        .video-prep-label { font-size: 0.75rem; color: rgba(255,255,255,0.4); transition: color 0.3s; }
        .video-prep-label.is-ready { color: #4ade80; }
        .video-prep-view-btn {
          font-size: 0.68rem; padding: 3px 10px; border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.6); cursor: pointer; transition: all 0.2s;
        }
        .video-prep-view-btn:hover {
          background: rgba(255,255,255,0.1); color: #fff;
        }
        .video-prep-bar {
          height: 4px; border-radius: 3px;
          background: rgba(255,255,255,0.04);
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
          overflow: hidden;
          position: relative;
        }
        .video-prep-fill {
          height: 100%; border-radius: 3px; width: 45%;
          background: linear-gradient(90deg, #CCFF00, #00F2EA);
          box-shadow: 0 0 8px rgba(0,242,234,0.4), 0 0 20px rgba(0,242,234,0.15);
          transition: width 0.8s cubic-bezier(0.22,1,0.36,1);
          animation: prepPulse 2s ease-in-out infinite;
          position: relative;
          overflow: hidden;
        }
        .video-prep-fill::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, transparent 60%, rgba(255,255,255,0.5) 80%, transparent 100%);
          animation: prepShimmer 2s ease-in-out infinite;
        }
        .video-prep-fill.is-ready {
          width: 100%;
          background: linear-gradient(90deg, #22c55e, #4ade80, #86efac);
          box-shadow: 0 0 10px rgba(74,222,128,0.5), 0 0 25px rgba(34,197,94,0.2);
          animation: readyGlow 3s ease-in-out infinite;
        }
        .video-prep-fill.is-ready::after {
          animation: none;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        }
        @keyframes prepPulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @keyframes prepShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes readyGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(74,222,128,0.4), 0 0 25px rgba(34,197,94,0.15); }
          50% { box-shadow: 0 0 15px rgba(74,222,128,0.6), 0 0 35px rgba(34,197,94,0.25); }
        }

        .helper-text {
          text-align: center;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.3);
          margin-top: 0.75rem;
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

      {/* Phase 9 样式必须使用 global，因为 fixed 定位元素脱离了组件 DOM 作用域 */}
      <style jsx global>{`
        /* ===== Phase 9: Genshin Hero Reveal 完成态样式 ===== */

        .btn-back-floating {
          position: fixed;
          top: 1.5rem;
          left: 1.5rem;
          z-index: 60;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 1rem;
          border-radius: 2rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(20px);
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.25s;
        }
        .btn-back-floating:hover {
          background: rgba(0, 0, 0, 0.7);
          border-color: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .hero-bg-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 0;
          overflow: hidden;
        }

        .hero-bg-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
          animation: heroBreathIn 1.2s ease-out forwards;
        }

        @keyframes heroBreathIn {
          0% {
            transform: scale(1.08);
            opacity: 0;
            filter: brightness(0.4);
          }
          100% {
            transform: scale(1);
            opacity: 1;
            filter: brightness(1);
          }
        }

        .hero-vignette {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 20% 50%, rgba(5,5,8,0.6) 0%, transparent 65%),
            linear-gradient(to right, rgba(5,5,8,0.3) 0%, transparent 40%, rgba(5,5,8,0.85) 75%),
            linear-gradient(to top, rgba(5,5,8,0.7) 0%, transparent 40%);
          pointer-events: none;
        }

        .air-glass-console {
          position: fixed;
          top: 50%;
          right: 14rem;
          transform: translateY(-50%);
          z-index: 55;
          width: 360px;
          max-height: 85vh;
          overflow-y: auto;
          padding: 2.5rem 2rem;
          background: rgba(15, 15, 20, 0.35);
          backdrop-filter: blur(80px);
          -webkit-backdrop-filter: blur(80px);
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 25px 60px -15px rgba(0,0,0,0.6), 0 0 30px -5px rgba(0,242,234,0.08), inset 0 1px 0 0 rgba(255,255,255,0.08);
          animation: consoleFadeIn 0.8s ease-out 0.3s both;
        }

        @keyframes consoleFadeIn {
          0% {
            opacity: 0;
            transform: translateY(-50%) translateX(30px);
          }
          100% {
            opacity: 1;
            transform: translateY(-50%) translateX(0);
          }
        }

        .console-glow-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #00F2EA;
          box-shadow: 0 0 8px #00F2EA;
          margin-bottom: 1.2rem;
        }

        .console-section {
          margin-bottom: 1rem;
        }

        .console-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 0.5rem;
          letter-spacing: 0.04em;
        }

        .mer-input {
          width: 100%;
          padding: 0.6rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid transparent;
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          font-size: 0.85rem;
          transition: all 0.2s;
          outline: none;
        }
        .mer-input:focus {
          border-color: rgba(0, 242, 234, 0.4);
          background: rgba(255, 255, 255, 0.06);
        }

        .pill-group {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .mer-pill {
          padding: 0.3rem 0.7rem;
          border-radius: 1rem;
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.75rem;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        .mer-pill:hover, .mer-pill.active {
          background: rgba(0, 242, 234, 0.15);
          color: #00F2EA;
        }

        .tag-remove {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.3);
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0 0.15rem;
        }
        .tag-remove:hover {
          color: #EC4899;
        }

        .tag-input-ghost {
          flex: 1;
          padding: 0.35rem 0.6rem;
          border-radius: 0.4rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.03);
          color: #fff;
          font-size: 0.75rem;
          outline: none;
        }
        .tag-input-ghost:focus {
          border-color: rgba(0, 242, 234, 0.3);
        }

        .tag-add-ghost-btn {
          padding: 0.35rem 0.75rem;
          border-radius: 0.4rem;
          border: 1px solid rgba(0, 242, 234, 0.2);
          background: rgba(0, 242, 234, 0.08);
          color: #00F2EA;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .tag-add-ghost-btn:hover:not(:disabled) {
          background: rgba(0, 242, 234, 0.15);
        }
        .tag-add-ghost-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .divider {
          position: relative;
          text-align: center;
          margin: 1.5rem 0;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .divider-text {
          position: absolute;
          top: -0.6rem;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 15, 20, 0.8);
          padding: 0 0.75rem;
          font-size: 0.65rem;
          color: rgba(255, 255, 255, 0.3);
          white-space: nowrap;
        }

        /* ===== 卡片式角色居中展示 ===== */

        .hero-card-stage {
          position: fixed;
          inset: 0;
          z-index: 50;
          background:
            radial-gradient(ellipse at 50% 45%, rgba(0, 242, 234, 0.06) 0%, transparent 55%),
            radial-gradient(ellipse at 30% 70%, rgba(79, 70, 229, 0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 30%, rgba(236, 72, 153, 0.03) 0%, transparent 50%),
            #0a0a0f;
          background-image:
            radial-gradient(ellipse at 50% 45%, rgba(0, 242, 234, 0.06) 0%, transparent 55%),
            radial-gradient(ellipse at 30% 70%, rgba(79, 70, 229, 0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 30%, rgba(236, 72, 153, 0.03) 0%, transparent 50%),
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
          background-size: 100% 100%, 100% 100%, 100% 100%, 60px 60px, 60px 60px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          animation: stageAppear 0.6s ease-out;
          overflow: visible;
          padding: 2rem 0;
        }

        .hero-card-stage::before,
        .hero-card-stage::after {
          content: '';
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(60px);
        }

        .hero-card-stage::before {
          width: 300px;
          height: 300px;
          background: rgba(0, 242, 234, 0.08);
          top: 15%;
          left: 10%;
          animation: particleDrift1 12s ease-in-out infinite;
        }

        .hero-card-stage::after {
          width: 250px;
          height: 250px;
          background: rgba(79, 70, 229, 0.06);
          bottom: 10%;
          right: 15%;
          animation: particleDrift2 15s ease-in-out infinite;
        }

        @keyframes particleDrift1 {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(40px, -30px); }
          66% { transform: translate(-20px, 20px); }
        }

        @keyframes particleDrift2 {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(-35px, 25px); }
          66% { transform: translate(30px, -40px); }
        }

        @keyframes stageAppear {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        .hero-blur-bg {
          position: absolute;
          inset: -40px;
          z-index: 0;
          overflow: hidden;
        }

        .hero-blur-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: blur(50px) brightness(0.35) saturate(1.4);
          transform: scale(1.2);
        }

        .hero-shockwave {
          position: absolute;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          border: 2px solid rgba(0, 242, 234, 0.25);
          z-index: 1;
          animation: shockwaveExpand 1.5s ease-out forwards;
          pointer-events: none;
        }

        @keyframes shockwaveExpand {
          0% {
            transform: scale(0.3);
            opacity: 1;
            border-width: 3px;
          }
          100% {
            transform: scale(3);
            opacity: 0;
            border-width: 0.5px;
          }
        }

        .hero-card {
          position: relative;
          z-index: 2;
          width: auto;
          max-width: 440px;
          max-height: 58vh;
          border-radius: 1rem;
          overflow: hidden;
          box-shadow:
            0 0 60px rgba(0, 242, 234, 0.15),
            0 0 120px rgba(0, 242, 234, 0.08),
            0 30px 80px rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(0, 242, 234, 0.2);
          animation: cardFloat 4s ease-in-out infinite, cardReveal 1s ease-out;
        }

        @keyframes cardReveal {
          0% {
            opacity: 0;
            transform: scale(0.92) translateY(20px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes cardFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        .hero-card-img {
          display: block;
          width: 100%;
          height: 100%;
          max-height: 58vh;
          object-fit: cover;
          object-position: top center;
        }

        .hero-card-badge {
          position: absolute;
          bottom: 1rem;
          left: 1rem;
          padding: 0.35rem 0.85rem;
          border-radius: 2rem;
          background: rgba(0, 242, 234, 0.12);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(0, 242, 234, 0.2);
          color: #00F2EA;
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.04em;
        }

        .badge-dot {
          margin-right: 0.2rem;
        }

        .hero-scroll-hint {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.35);
          font-size: 0.8rem;
          cursor: pointer;
          transition: color 0.2s;
          animation: hintPulse 2s ease-in-out infinite;
        }
        .hero-scroll-hint:hover {
          color: rgba(255, 255, 255, 0.6);
        }

        @keyframes hintPulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }

        .hero-card-actions {
          position: relative;
          z-index: 3;
          display: flex;
          gap: 1rem;
          align-items: center;
          margin-top: 0.5rem;
        }

        .hero-btn {
          padding: 0.75rem 1.5rem;
          border-radius: 0.75rem;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s;
        }

        .hero-btn--ghost {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(20px);
        }
        .hero-btn--ghost:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .hero-btn--primary {
          position: relative;
          background: linear-gradient(135deg, rgba(204, 255, 0, 0.9), rgba(0, 242, 234, 0.9), rgba(236, 72, 153, 0.9), rgba(204, 255, 0, 0.9));
          background-size: 300% 300%;
          animation: mermaidFlow 5s ease infinite;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-top: 1px solid rgba(255, 255, 255, 0.45);
          border-radius: 100px;
          padding: 0.85rem 2.5rem;
          color: #000;
          font-weight: 800;
          letter-spacing: 0.5px;
          box-shadow: 
            0 10px 40px -10px rgba(0, 242, 234, 0.5),
            inset 0 4px 15px rgba(255, 255, 255, 0.4);
          transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1);
          overflow: hidden;
        }
        .hero-btn--primary::after {
          content: '';
          position: absolute;
          top: 0; left: -100%; width: 50%; height: 100%;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.6), transparent);
          transform: skewX(-20deg);
          animation: mermaidShine 6s infinite cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }
        .hero-btn--primary:hover {
          transform: scale(1.04) translateY(-2px);
          box-shadow: 
            0 14px 50px -10px rgba(236, 72, 153, 0.7),
            0 0 20px rgba(0, 242, 234, 0.5),
            inset 0 4px 20px rgba(255, 255, 255, 0.6);
          border-color: rgba(255, 255, 255, 0.6);
        }
        .hero-btn--primary:active {
          transform: scale(0.96) translateY(2px);
          box-shadow: 0 5px 20px -5px rgba(0, 242, 234, 0.5);
        }

        @keyframes mermaidFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes mermaidShine {
          0% { left: -100%; opacity: 0; }
          10% { opacity: 1; }
          20% { left: 200%; opacity: 0; }
          100% { left: 200%; opacity: 0; }
        }

        /* ===== 多角度参考图弹窗 ===== */

        .ref-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.25s ease-out;
        }

        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        .ref-modal {
          position: relative;
          width: 520px;
          max-width: 90vw;
          max-height: 85vh;
          overflow-y: auto;
          padding: 2rem;
          background: rgba(20, 20, 28, 0.95);
          backdrop-filter: blur(40px);
          border-radius: 1.25rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
        }

        .ref-modal-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          transition: all 0.2s;
        }
        .ref-modal-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .ref-modal-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: #fff;
          margin-bottom: 0.75rem;
        }

        .ref-modal-desc {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.45);
          line-height: 1.5;
          margin-bottom: 1.5rem;
        }

        .ref-generate-btn {
          width: 100%;
          padding: 0.85rem;
          border-radius: 0.75rem;
          border: none;
          background: linear-gradient(135deg, rgba(0, 242, 234, 0.15), rgba(79, 70, 229, 0.15));
          border: 1px solid rgba(0, 242, 234, 0.2);
          color: #00F2EA;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s;
        }
        .ref-generate-btn:hover {
          background: linear-gradient(135deg, rgba(0, 242, 234, 0.25), rgba(79, 70, 229, 0.25));
          transform: translateY(-1px);
        }

        .ref-result { text-align: center; }
        .ref-result-img {
          width: 100%;
          border-radius: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .ref-result-hint {
          font-size: 0.8rem;
          color: #00F2EA;
        }

        .ref-loading {
          text-align: center;
          padding: 2rem;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.85rem;
        }

        .ref-spinner {
          width: 32px;
          height: 32px;
          border: 2px solid rgba(255, 255, 255, 0.1);
          border-top-color: #00F2EA;
          border-radius: 50%;
          margin: 0 auto 1rem;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ===== 多角度横幅弹窗 ===== */
        .ref-banner {
          position: absolute;
          top: 18%;
          bottom: 18%;
          left: 5%;
          right: 38%;
          z-index: 5;
          background: rgba(10, 10, 15, 0.6);
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 1rem;
          box-shadow: 0 20px 50px -10px rgba(0,0,0,0.6),
                      0 0 20px -5px rgba(0,242,234,0.1),
                      inset 0 1px 0 0 rgba(255,255,255,0.08);
          animation: refBannerSlideIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .ref-banner--closing {
          animation: refBannerSlideOut 0.4s cubic-bezier(0.4, 0, 1, 1) forwards !important;
        }
        .ref-banner__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
          flex-shrink: 0;
        }
        .ref-banner__title {
          font-size: 0.8rem;
          font-weight: 600;
          color: rgba(255,255,255,0.8);
          display: flex;
          align-items: center;
        }
        .ref-banner__close {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.5rem;
          padding: 4px;
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
        }
        .ref-banner__close:hover {
          background: rgba(255,255,255,0.12);
          color: white;
        }
        .ref-banner__gallery {
          flex: 1;
          min-height: 0;
          position: relative;
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .ref-banner__bg {
          position: absolute;
          inset: -20px;
          width: calc(100% + 40px);
          height: calc(100% + 40px);
          object-fit: cover;
          filter: blur(25px) brightness(0.4);
          z-index: 0;
        }
        .ref-banner__bg-overlay {
          position: absolute;
          inset: 0;
          background: rgba(10, 10, 15, 0.3);
          z-index: 1;
        }
        .ref-banner__img {
          position: relative;
          width: 100%;
          height: 100%;
          object-fit: contain;
          z-index: 2;
        }
        .ref-icon-btn {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px;
          padding: 3px 6px;
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
        }
        .ref-icon-btn:hover {
          background: rgba(255,255,255,0.12);
          color: white;
        }
        @keyframes refBannerSlideIn {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes refBannerSlideOut {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(20px); opacity: 0; }
        }

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
          position: absolute; inset: 0; border-radius: 1.5rem;
          animation: genPulse 3s ease-in-out infinite;
        }
        @keyframes genPulse {
          0%, 100% { box-shadow: inset 0 0 60px rgba(0,242,234,0.03); }
          50% { box-shadow: inset 0 0 100px rgba(0,242,234,0.08); }
        }
        .video-generating__icon {
          color: rgba(255,255,255,0.15); margin-bottom: 1.5rem;
          animation: genIconPulse 2s ease-in-out infinite;
        }
        @keyframes genIconPulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.05); }
        }
        .video-generating__title { color: white; font-size: 1.1rem; font-weight: 600; margin: 0 0 0.5rem; }
        .video-generating__subtitle { color: rgba(255,255,255,0.4); font-size: 0.8rem; margin: 0 0 2rem; }
        .video-generating__bar-track {
          width: 60%; height: 4px; border-radius: 3px;
          background: rgba(255,255,255,0.06); overflow: hidden;
        }
        .video-generating__bar-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, #CCFF00, #00F2EA);
          box-shadow: 0 0 10px rgba(0,242,234,0.5);
          transition: width 0.3s linear;
        }
        .video-generating__time { color: rgba(255,255,255,0.3); font-size: 0.7rem; margin: 0.75rem 0 0; }

        /* 视频播放完成 */
        .video-completed {
          width: 100%; height: 100%; border-radius: 1.5rem; overflow: hidden;
          position: relative; border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 25px 60px -10px rgba(0,0,0,0.7), 0 0 30px -5px rgba(0,242,234,0.1);
        }
        .video-completed__player { width: 100%; height: 100%; object-fit: cover; border-radius: 1.5rem; }
        .video-completed__badge {
          position: absolute; bottom: 1rem; left: 1rem;
          display: flex; align-items: center; gap: 6px;
          padding: 0.35rem 0.75rem; border-radius: 2rem;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(10px);
          color: rgba(255,255,255,0.8); font-size: 0.7rem; font-weight: 500;
        }

        /* 面板中的生成状态条 */
        .gen-status-panel {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 1rem; border-radius: 0.75rem;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
        }
        .gen-status-panel__icon { color: #00F2EA; flex-shrink: 0; padding-top: 2px; }
      `}</style>
    </div>
  );
}
