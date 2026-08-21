/**
 * 铸造预览区 — 右栏组件
 *
 * 3 种状态：
 * 1. 空态（idle）— 科技感占位符
 * 2. 生成中（generating/polling）— 骨架屏动画
 * 3. 生成完毕（completed）— 3:4 角色卡片 + 命名保存
 */

"use client";

import { Images, ListChecks, Minimize2, ScanLine, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useCallback, useEffect, useMemo } from "react";

import { useLang } from "@/contexts/LangContext";
import {
  useCharacterStudioStore,
  useCharacterGenerationStatus,
  useCharacterHeroImage,
  useCharacterIsGenerating,
} from "@/stores/character-studio-store";

import { CharacterBoardSuccess } from "./character-board-success";

export function CastingPreview() {
  const t = useTranslations("characterCreate");
  const { lang } = useLang();
  const generationLogMessages = useMemo(
    () => Object.values(t.raw("casting.logs") as Record<string, string>),
    [t]
  );
  const router = useRouter();
  const store = useCharacterStudioStore();
  const generationStatus = useCharacterGenerationStatus();
  const generatedImageUrl = useCharacterHeroImage();
  const isGenerating = useCharacterIsGenerating();

  const [tagInput, setTagInput] = useState("");
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [sora2Confirming, setSora2Confirming] = useState(false);
  const [sora2ConfirmStep, setSora2ConfirmStep] = useState(""); // "" | "oss" | "pid" | "done" | "error"
  const [sora2PidError, setSora2PidError] = useState(""); // PID 提取失败时的错误信息




  // ====== 幻影进度条与终端流状态 ======
  const [fakeProgress, setFakeProgress] = useState(() =>
    generationStatus === "polling" ? 60 : 0
  );
  const [terminalLog, setTerminalLog] = useState(generationLogMessages[0]);

  // 当进入 generating 状态时，启动进度与日志轮询
  useEffect(() => {
    if (generationStatus === "generating" || generationStatus === "polling") {
      
      const progressTimer = setInterval(() => {
        setFakeProgress((prev) => {
          if (prev >= 92) return prev;
          // 随机跳跃假进度
          return prev + Math.floor(Math.random() * 3) + 1;
        });
      }, 600);
      
      let logIndex = 0;
      const logTimer = setInterval(() => {
        logIndex = (logIndex + 1) % generationLogMessages.length;
        setTerminalLog(generationLogMessages[logIndex]);
      }, 1000);

      return () => {
        clearInterval(progressTimer);
        clearInterval(logTimer);
      };
    } else if (generationStatus === "completed") {
      setFakeProgress(100);
      setTerminalLog(t("casting.readyLog"));
    }
  }, [generationLogMessages, generationStatus, t]);

  // ====== 真实 API 任务轮询机制（VEO 专用）======
  useEffect(() => {
    // Sora2 模式走自己的轮询，此处仅处理 VEO
    if (generationStatus !== "polling" || !store.heroTaskId || store.forgeMode === "sora2") return;

    let pollCount = 0;
    const MAX_POLLS = 120; // 最长等待约 6 分钟 (120 * 3s)
    let isPolling = true;

    const pollTask = async () => {
      try {
        const res = await fetch(`/api/characters/generate?taskId=${store.heroTaskId}`);
        if (!res.ok) throw new Error(`Task fetch failed: ${res.status}`);
        const data = await res.json();

        if (!data.success || !data.task) {
          throw new Error(data.error || t("errors.query"));
        }

        const task = data.task;

        // 成功出图
        if (task.status === "completed" && task.resultUrl) {
          store.setCharacterBoardResult(task.resultUrl, null, store.refPrompt || store.prompt);
          return; // 结束轮询
        }

        // 生成失败
        if (task.status === "failed") {
          store.setGenerationFailed(
            lang === "zh" && task.errorMessage ? task.errorMessage : t("errors.render")
          );
          return;
        }

        // 继续轮询
        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed(t("errors.timeout"));
          return;
        }

        if (isPolling) {
          setTimeout(pollTask, 3000);
        }
      } catch (err) {
        console.error("[Polling] Error:", err);
        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed(t("errors.disconnected"));
        } else if (isPolling) {
          setTimeout(pollTask, 3000); // 发生错误也稍后再试，可能只是网络波动
        }
      }
    };

    pollTask();

    return () => {
      isPolling = false;
    };
  }, [generationStatus, lang, store.heroTaskId, store.forgeMode, store, t]);

  // ====== Sora2 视频生成轮询 ======
  useEffect(() => {
    if (generationStatus !== "polling" || !store.heroTaskId || store.forgeMode !== "sora2") return;

    let pollCount = 0;
    const MAX_POLLS = 200; // Sora2 耗时更长，约 10 分钟
    let isPolling = true;

    const pollSora2 = async () => {
      try {
        const res = await fetch(`/api/video-batch/sora-status/${store.heroTaskId}`);
        if (!res.ok) throw new Error(`Sora2 poll failed: ${res.status}`);
        const json = await res.json();

        // sora-status API 返回 { success, data: { status, videoUrl, ... } }
        const task = json.data;
        if (!task) {
          console.warn("[Sora2-Poll] No data in response:", json);
          pollCount++;
          if (pollCount >= MAX_POLLS) {
            store.setGenerationFailed(t("errors.videoTimeout"));
          } else if (isPolling) {
            setTimeout(pollSora2, 3000);
          }
          return;
        }

        console.log(`[Sora2-Poll] #${pollCount} status:`, task.status);

        if (task.status === "completed" && task.videoUrl) {
          console.log("[Sora2-Poll] ✅ Video ready:", task.videoUrl.substring(0, 80));
          store.setSora2VideoResult(task.videoUrl);
          return;
        }

        if (task.status === "failed") {
          store.setGenerationFailed(
            lang === "zh" && task.errorMessage ? task.errorMessage : t("errors.soraVideo")
          );
          return;
        }

        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed(t("errors.videoTimeout"));
          return;
        }

        if (isPolling) setTimeout(pollSora2, 3000);
      } catch (err) {
        console.error("[Sora2-Poll] Error:", err);
        pollCount++;
        if (pollCount >= MAX_POLLS) {
          store.setGenerationFailed(t("errors.disconnected"));
        } else if (isPolling) {
          setTimeout(pollSora2, 3000);
        }
      }
    };

    pollSora2();
    return () => { isPolling = false; };
  }, [generationStatus, lang, store.heroTaskId, store.forgeMode, store, t]);
  // ===================================

  // ====== 保存角色（通用内部函数）======
  const doSaveCharacter = async (): Promise<string | null> => {
    const boardUrl = store.characterBoardUrl || store.referenceSheetUrl || generatedImageUrl;
    const avatarUrl = store.characterAvatarUrl || generatedImageUrl || boardUrl;
    const referenceImages = [boardUrl, avatarUrl, store.referenceImageUrl].filter(
      (url): url is string => typeof url === "string" && url.length > 0
    );

    if (!store.characterName.trim()) {
      alert(t("errors.nameRequired"));
      return null;
    }
    if (!boardUrl) {
      alert(t("errors.boardIncomplete"));
      return null;
    }
    if (!store.userId) {
      alert(t("errors.signIn"));
      return null;
    }

    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: store.userId,
        name: store.characterName.trim(),
        description: store.prompt,
        avatar_url: avatarUrl,
        reference_images: referenceImages,
        reference_sheet_url: boardUrl,
        reference_status: "completed",
        reference_task_id: null,
        preview_video_url: null,
        character_type: store.dnaConfig.species,
        dna_config: {
          ...store.dnaConfig,
          characterBoard: {
            url: boardUrl,
            crop: store.characterBoardCrop,
            prompt: store.characterBoardPrompt || store.refPrompt || store.prompt,
          },
          sourceReferenceImageUrl: store.referenceImageUrl,
        },
        style_tags: store.characterTags,
        gender: store.dnaConfig.gender,
        age_range: store.dnaConfig.ageGroup || null,
        forge_type: "veo",
      }),
    });

    const data = await response.json();
    if (!data.success) {
      alert(lang === "zh" && data.error ? data.error : t("errors.save"));
      return null;
    }

    store.setSavedCharacterId(data.data.id);
    return data.data.id;
  };

  // ====== Sora2 角色保存 ======
  const doSaveSora2Character = async (): Promise<string | null> => {
    if (!store.characterName.trim()) {
      alert(t("errors.nameRequired"));
      return null;
    }
    if (!store.sora2Pid) {
      alert(t("errors.pidIncomplete"));
      return null;
    }
    if (!store.userId) {
      alert(t("errors.signIn"));
      return null;
    }

    // 使用视频第一帧截图作为头像（如果有 OSS URL 则用 OSS，否则用临时 URL）
    const videoUrl = store.sora2VideoOssUrl || store.sora2VideoUrl;

    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: store.userId,
        name: store.characterName.trim(),
        description: store.prompt,
        avatar_url: videoUrl, // Sora2 角色用视频 URL 作为头像占位
        reference_images: [videoUrl],
        preview_video_url: store.sora2VideoOssUrl || null,
        character_type: store.dnaConfig.species,
        dna_config: store.dnaConfig,
        style_tags: store.characterTags,
        gender: store.dnaConfig.gender,
        age_range: store.dnaConfig.ageGroup || null,
        trigger_word: store.sora2Pid,
        forge_type: "sora2",
      }),
    });

    const data = await response.json();
    if (!data.success) {
      alert(lang === "zh" && data.error ? data.error : t("errors.save"));
      return null;
    }

    store.setSavedCharacterId(data.data.id);
    console.log("[Save] ✅ Sora2 Character saved, ID:", data.data.id, "PID:", store.sora2Pid);
    return data.data.id;
  };



  // ====== 仅保存角色（不生成视频）======
  const handleSaveOnly = useCallback(async () => {
    if (store.isSaving || store.savedCharacterId) return;
    store.setIsSaving(true);
    try {
      const characterId = store.forgeMode === "sora2"
        ? await doSaveSora2Character()
        : await doSaveCharacter();
      if (!characterId) return;
      store.reset();
      router.push("/models?tab=my");
    } catch (error) {
      console.error("[SaveOnly] Error:", error);
      alert(t("errors.save"));
    } finally {
      store.setIsSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, generatedImageUrl, router]);

  const handleDiscardAndExit = useCallback(() => {
    store.reset();
    router.push("/models");
  }, [router, store]);

  const handleViewMyRoles = useCallback(() => {
    store.reset();
    router.push("/models?tab=my");
  }, [router, store]);

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

  const progressValue = Math.min(99, Math.max(6, fakeProgress));
  const isVideoForge = store.forgeMode === "sora2";
  const generationTitle = isVideoForge ? t("casting.titleVideo") : t("casting.titlePhoto");
  const generationDescription = isVideoForge
    ? t("casting.descriptionVideo")
    : t("casting.descriptionPhoto");
  const pipelineSteps = [
    { label: t("casting.parse"), detail: t("casting.parseDetail"), threshold: 8 },
    { label: t("casting.cover"), detail: t("casting.coverDetail"), threshold: 28 },
    { label: isVideoForge ? t("casting.video") : t("casting.sheet"), detail: isVideoForge ? t("casting.videoDetail") : t("casting.sheetDetail"), threshold: 54 },
    { label: t("casting.quality"), detail: t("casting.qualityDetail"), threshold: 78 },
  ];

  return (
    <div className="casting-preview">
      {/* 状态 1：空态 */}
      {generationStatus === "idle" && (
        <div className="preview-idle">
          <div className="idle-glow" />
          <div className="idle-icon">
            <div className="dna-helix">🧬</div>
          </div>
          <p className="idle-text">{t("casting.waiting")}</p>
          <p className="idle-hint">{t("casting.waitingHint")}</p>
        </div>
      )}

      {/* 状态 2：生成中 */}
      {isGenerating && (
        <div className="preview-generating">
          <div className="gen-grid-bg" />
          <div className="gen-shell">
            <div className="gen-topbar">
              <div>
                <div className="gen-kicker">
                  <Sparkles size={16} />
                  {t("casting.pipeline")}
                </div>
                <h1>{generationTitle}</h1>
                <p>{generationDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => store.setIsMinimized(true)}
                className="gen-minimize-button"
              >
                <Minimize2 size={15} />
                {t("casting.minimize")}
              </button>
            </div>

            <div className="gen-workbench">
              <section className="gen-status-card">
                <div className="gen-status-head">
                  <span className="gen-live-pill">
                    <span className="status-dot" />
                    {generationStatus === "polling" ? t("casting.processing") : t("casting.starting")}
                  </span>
                  <span className="gen-percent tabular-nums">{progressValue}%</span>
                </div>
                <div className="gen-progress-track" aria-hidden="true">
                  <span style={{ width: `${progressValue}%` }} />
                </div>
                <div className="gen-terminal-stream">
                  <ScanLine size={15} />
                  <span key={terminalLog}>{terminalLog}</span>
                </div>
              </section>

              <section className="gen-preview-card" aria-label={t("casting.previewLabel")}>
                <div className="gen-preview-cover">
                  <Images size={22} />
                  <span>{t("casting.portraitCover")}</span>
                </div>
                <div className="gen-preview-sheet">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <span key={index} />
                  ))}
                </div>
                <div className="gen-preview-caption">
                  <ListChecks size={15} />
                  {t("casting.saveAfter")}
                </div>
              </section>
            </div>

            <div className="gen-step-list">
              {pipelineSteps.map((step) => {
                const isActive = progressValue >= step.threshold;
                return (
                  <div key={step.label} className={isActive ? "gen-step gen-step-active" : "gen-step"}>
                    <span className="gen-step-dot" />
                    <div>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 状态 2b：生成失败 */}
      {generationStatus === "failed" && (
        <div className="preview-failed">
          {/* 返回按钮 — 防止用户被锁在全屏错误界面 */}
          <button
            className="btn-back-floating"
            onClick={() => store.setCurrentStep(1)}
            type="button"
            style={{ position: "absolute", top: 24, left: 24, zIndex: 10 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            {t("casting.back")}
          </button>
          <div className="failed-icon">❌</div>
          <p className="failed-text">{store.errorMessage || t("casting.failed")}</p>
          <button
            className="retry-btn"
            onClick={() => store.startGeneration()}
            type="button"
          >
            {t("casting.retry")}
          </button>
        </div>
      )}

      {/* 状态 3：生成完毕 — 写真角色完整设定板 */}
      {generationStatus === "completed" && store.forgeMode !== "sora2" && (store.characterBoardUrl || store.referenceSheetUrl || generatedImageUrl) && (
        <CharacterBoardSuccess
          boardUrl={store.characterBoardUrl || store.referenceSheetUrl || generatedImageUrl || ""}
          cropMeta={store.characterBoardCrop}
          dnaConfig={store.dnaConfig}
          prompt={store.prompt}
          boardPrompt={store.characterBoardPrompt}
          characterName={store.characterName}
          isSaving={store.isSaving}
          savedCharacterId={store.savedCharacterId}
          onNameChange={store.setCharacterName}
          onSave={handleSaveOnly}
          onBack={() => store.setCurrentStep(1)}
          onRegenerate={() => store.setCurrentStep(1)}
          onDiscard={handleDiscardAndExit}
          onViewMyRoles={handleViewMyRoles}
        />
      )}

      {/* 状态 3-Sora2：影视角色视频预览 + 确认 */}
      {generationStatus === "completed" && store.forgeMode === "sora2" && store.sora2VideoUrl && !showSavePanel && (
        <>
          {/* 返回/重新配置 */}
          <button
            className="btn-back-floating"
            onClick={() => store.setCurrentStep(1)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            {t("casting.reconfigure")}
          </button>

          <div className="hero-card-stage">
            {/* 视频背景层 */}
            <div className="hero-blur-bg" style={{ background: "radial-gradient(circle at center, rgba(168,85,247,0.15), transparent 70%)" }} />
            <div className="hero-shockwave" />

            {/* 视频播放器 */}
            <div className="hero-card" style={{ aspectRatio: "9/16", maxHeight: "70vh" }}>
              <video
                src={store.sora2VideoUrl}
                className="hero-card-img"
                style={{ objectFit: "cover", width: "100%", height: "100%" }}
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            </div>

            {/* 操作按钮 */}
            <div className="hero-card-actions">
              {!sora2Confirming && !store.sora2Pid && (
                <>
                  <button
                    className="hero-btn hero-btn--primary"
                    onClick={async () => {
                      // 先缓存视频 URL — 防止异步过程中 store 状态被清空
                      const videoUrl = store.sora2VideoUrl;
                      if (!videoUrl) {
                        alert(t("casting.videoMissing"));
                        return;
                      }
                      setSora2Confirming(true);
                      setSora2ConfirmStep("oss");
                      try {
                        // 并行执行 OSS 转存 + PID 提取（更快）
                        const ossPromise = fetch("/api/upload/transfer-to-oss", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            sourceUrl: videoUrl,
                            userId: store.userId,
                            folder: "model-demos",
                          }),
                        }).then(r => r.json());

                        const pidPromise = fetch("/api/characters/create-sora", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            videoUrl: videoUrl,
                            timestamps: "0,3",  // 文档要求最多3秒，取前3秒提取角色特征
                          }),
                        }).then(r => r.json());

                        const [ossResult, pidResult] = await Promise.all([ossPromise, pidPromise]);

                        // OSS 转存结果 — 注意 API 返回 { success, data: { url } }
                        if (ossResult.success && ossResult.data?.url) {
                          store.setSora2VideoOssUrl(ossResult.data.url);
                          console.log("[Sora2-Confirm] OSS URL:", ossResult.data.url);
                        } else {
                          console.warn("[Sora2-Confirm] OSS transfer failed:", ossResult.error);
                        }

                        // PID 提取任务提交
                        if (pidResult.success && pidResult.taskId) {
                          store.setSora2PidTaskId(pidResult.taskId);
                          setSora2ConfirmStep("pid");
                          // 轮询 pid 状态
                          let pidPollCount = 0;
                          const MAX_PID_POLLS = 200; // 增加到 200 次 (10分钟)
                          const pollPid = async () => {
                            try {
                              const res = await fetch(`/api/characters/create-sora?taskId=${pidResult.taskId}`);
                              const data = await res.json();
                              if (data.status === "completed" && data.pid) {
                                store.setSora2Pid(data.pid);
                                setSora2ConfirmStep("done");
                                setSora2Confirming(false);
                                console.log("[Sora2-Confirm] PID:", data.pid);
                                return;
                              }
                              if (data.status === "failed") {
                                setSora2Confirming(false);
                                setSora2ConfirmStep("error");
                                setSora2PidError(lang === "zh" && data.error ? data.error : t("errors.pidExtract"));
                                return;
                              }
                              pidPollCount++;
                              if (pidPollCount >= MAX_PID_POLLS) {
                                setSora2Confirming(false);
                                setSora2ConfirmStep("error");
                                setSora2PidError(t("errors.pidTimeout"));
                                return;
                              }
                              setTimeout(pollPid, 3000);
                            } catch {
                              pidPollCount++;
                              if (pidPollCount < MAX_PID_POLLS) setTimeout(pollPid, 3000);
                            }
                          };
                          pollPid();
                        } else {
                          setSora2ConfirmStep("error");
                          setSora2PidError(lang === "zh" && pidResult.error ? pidResult.error : t("errors.pidSubmit"));
                          setSora2Confirming(false);
                        }
                      } catch (error) {
                        console.error("[Sora2-Confirm] Error:", error);
                        alert(t("casting.confirmFailed"));
                        setSora2Confirming(false);
                        setSora2ConfirmStep("");
                      }
                    }}
                    type="button"
                  >
                    {t("casting.confirm")}
                  </button>
                  <button
                    className="hero-btn"
                    onClick={() => {
                      store.startGeneration();
                      store.setForgeMode("sora2");
                    }}
                    type="button"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)" }}
                  >
                    {t("casting.recast")}
                  </button>
                </>
              )}

              {sora2Confirming && (
                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px #a855f7", animation: "dotBlink 1.5s ease-in-out infinite", display: "inline-block" }} />
                    {sora2ConfirmStep === "oss" && t("casting.transferring")}
                    {sora2ConfirmStep === "pid" && t("casting.extracting")}
                  </div>
                </div>
              )}

              {/* PID 提取失败：显示错误 + 重试按钮 */}
              {sora2ConfirmStep === "error" && sora2PidError && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, padding: "8px 12px", background: "rgba(248,113,113,0.1)", borderRadius: 8, border: "1px solid rgba(248,113,113,0.2)" }}>
                    ⚠ {sora2PidError}
                  </div>
                  <button
                    className="hero-btn hero-btn--primary"
                    onClick={() => {
                      setSora2ConfirmStep("");
                      setSora2PidError("");
                    }}
                    type="button"
                    style={{ fontSize: 14 }}
                  >
                    {t("casting.retryPid")}
                  </button>
                </div>
              )}

              {store.sora2Pid && (
                <button
                  className="hero-btn hero-btn--primary"
                  onClick={() => setShowSavePanel(true)}
                  type="button"
                >
                  ✦ {t("casting.saveCharacter")} (PID: {store.sora2Pid.substring(0, 15)}...)
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Sora2 保存面板：写真角色已改为完整设定板页面内保存 */}
      {store.forgeMode === "sora2" && ((generationStatus === "completed" && store.sora2VideoUrl) || store.sora2Pid) && showSavePanel && (
        <>
          {/* 返回英雄出场页 */}
          <button
            className="btn-back-floating"
            onClick={() => setShowSavePanel(false)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            {t("casting.backPreview")}
          </button>

          {/* 全屏沉浸英雄图层 */}
          <div className="hero-bg-container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                store.forgeMode === "sora2"
                  ? (store.heroImageUrl || "/sora2-hero-bg.png")  // Sora2 模式：用参考图或占位背景
                  : (generatedImageUrl || "/sora2-hero-bg.png")
              }
              className="hero-bg-image"
              alt="Hero Background"
            />
            <div className="hero-vignette"></div>
          </div>

          {/* 悬浮主操作面板 (Abyssal Void Console) */}
          <div className="air-glass-console">
            <div className="console-glow-dot"></div>

            <div className="console-section">
              <label className="console-label">{t("casting.characterName")} <span className="text-[#00F2EA]">*</span></label>
              <input 
                type="text" 
                className="mer-input" 
                placeholder={t("casting.namePlaceholder")}
                value={store.characterName}
                onChange={(e) => store.setCharacterName(e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="console-section" style={{ marginBottom: "1.5rem" }}>
              <label className="console-label">{t("casting.styleTags")}</label>
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
                  <span className="text-white/40 text-xs">{t("casting.noTags")}</span>
                )}
                
                <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '8px' }}>
                  <input
                    type="text"
                    className="tag-input-ghost"
                    placeholder={t("casting.tagPlaceholder")}
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
                    {t("casting.addTag")}
                  </button>
                </div>
              </div>
            </div>

            {/* ===== 保存 + 视频 合并操作区 ===== */}
            {store.savedCharacterId ? (
              /* 阶段 C/D: 已保存 */
              <>
                <div className="btn-save" style={{ opacity: 1, cursor: 'default', background: 'linear-gradient(135deg, rgba(0, 200, 83, 0.15), rgba(0, 200, 83, 0.08))', borderColor: 'rgba(0, 200, 83, 0.4)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00c853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  {t("casting.saved")}
                </div>
                <div className="helper-text" style={{ marginBottom: '0.5rem' }}>
                  <a href="/models?tab=my" style={{ color: 'rgba(0, 242, 234, 0.8)', textDecoration: 'none', fontSize: '0.75rem' }}>{t("casting.viewAssets")}</a>
                </div>
              </>
            ) : (
              /* 阶段 A/B: 未保存 */
              <>
                <button 
                  className="btn-save"
                  onClick={handleSaveOnly}
                  disabled={!store.characterName.trim() || !store.sora2Pid || store.isSaving}
                  type="button"
                >
                  {store.isSaving ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> {t("casting.saving")}</>
                  ) : store.sora2Pid ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> {t("casting.saveCharacter")}</>
                  ) : (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', animation: 'spin 2s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> {t("casting.encoding")}</>
                  )}
                </button>
                <div className="helper-text">
                  {t("casting.savedHint")}
                </div>
              </>
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

        /* ===== Generating State ===== */
        .preview-generating {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background:
            linear-gradient(135deg, rgba(0, 242, 234, 0.08), transparent 28%),
            linear-gradient(315deg, rgba(236, 72, 153, 0.08), transparent 32%),
            #05070b;
          z-index: 1;
          padding: clamp(1.25rem, 3vw, 3rem);
        }

        .gen-grid-bg {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: panGrid 60s linear infinite;
          opacity: 0.38;
        }
        
        @keyframes panGrid {
          0% { transform: translateY(0); }
          100% { transform: translateY(-400px); }
        }

        .gen-shell {
          position: relative;
          width: min(1080px, 100%);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 32px;
          background: rgba(10, 13, 20, 0.84);
          box-shadow: 0 28px 90px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.08);
          backdrop-filter: blur(28px);
          padding: clamp(1.25rem, 3vw, 2rem);
          z-index: 10;
          overflow: hidden;
        }

        .gen-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(255,255,255,0.08), transparent 28%, transparent 72%, rgba(255,255,255,0.05));
          pointer-events: none;
        }

        .gen-topbar {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1.5rem;
          margin-bottom: 1.25rem;
        }

        .gen-kicker {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          color: #5ffff7;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 0.7rem;
        }

        .gen-topbar h1 {
          color: white;
          font-size: clamp(1.8rem, 4vw, 3.35rem);
          line-height: 1.05;
          font-weight: 850;
          margin: 0;
        }

        .gen-topbar p {
          max-width: 620px;
          color: rgba(255,255,255,0.52);
          font-size: 0.96rem;
          line-height: 1.7;
          margin: 0.85rem 0 0;
        }

        .gen-minimize-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
          min-width: 118px;
          height: 40px;
          padding: 0 16px;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.78);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
        }

        .gen-minimize-button:hover {
          border-color: rgba(0, 242, 234, 0.32);
          background: rgba(0, 242, 234, 0.12);
          color: #fff;
          transform: translateY(-1px);
        }

        .gen-workbench {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
          gap: 1rem;
          margin-top: 1.6rem;
        }

        .gen-status-card,
        .gen-preview-card,
        .gen-step {
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.045);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
        }

        .gen-status-card {
          border-radius: 24px;
          padding: 1.25rem;
        }

        .gen-status-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .gen-live-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.45rem 0.75rem;
          border-radius: 999px;
          color: rgba(255,255,255,0.78);
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 0.8rem;
          font-weight: 700;
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

        .gen-percent {
          color: white;
          font-size: clamp(2rem, 6vw, 4.4rem);
          font-weight: 850;
          letter-spacing: 0;
          line-height: 0.9;
        }

        .gen-progress-track {
          height: 14px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.06);
        }

        .gen-progress-track span {
          display: block;
          height: 100%;
          min-width: 24px;
          border-radius: inherit;
          background: linear-gradient(90deg, #00F2EA, #CCFF00, #EC4899);
          box-shadow: 0 0 28px rgba(0,242,234,0.22);
          transition: width 0.45s ease;
        }

        .gen-terminal-stream {
          min-height: 46px;
          margin-top: 1rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.8rem 0.9rem;
          border-radius: 16px;
          color: rgba(255,255,255,0.52);
          background: rgba(0,0,0,0.24);
          border: 1px solid rgba(255,255,255,0.07);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.78rem;
        }

        .gen-terminal-stream span {
          animation: fadeLog 0.45s ease both;
        }

        @keyframes fadeLog {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        .gen-preview-card {
          border-radius: 24px;
          padding: 1rem;
          display: grid;
          grid-template-columns: 0.8fr 1fr;
          gap: 0.8rem;
          align-items: stretch;
        }

        .gen-preview-cover,
        .gen-preview-sheet {
          min-height: 220px;
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.08);
          background: linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.035));
          position: relative;
        }

        .gen-preview-cover {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          color: rgba(255,255,255,0.48);
          font-size: 0.82rem;
          font-weight: 700;
        }

        .gen-preview-cover::before {
          content: "";
          width: 42%;
          max-width: 78px;
          aspect-ratio: 1;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          box-shadow: 0 68px 0 28px rgba(255,255,255,0.08);
          animation: breathePreview 2.4s ease-in-out infinite;
        }

        @keyframes breathePreview {
          0%, 100% { opacity: 0.65; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-4px); }
        }

        .gen-preview-sheet {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: 1.2fr 0.8fr;
          gap: 0.5rem;
          padding: 0.65rem;
        }

        .gen-preview-sheet span {
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.045));
          animation: skeletonSweep 1.8s ease-in-out infinite;
        }

        .gen-preview-sheet span:nth-child(1) {
          grid-column: span 2;
        }

        .gen-preview-sheet span:nth-child(2) {
          animation-delay: 0.12s;
        }

        .gen-preview-sheet span:nth-child(3) {
          animation-delay: 0.24s;
        }

        .gen-preview-sheet span:nth-child(4) {
          animation-delay: 0.36s;
        }

        .gen-preview-sheet span:nth-child(5) {
          animation-delay: 0.48s;
        }

        .gen-preview-sheet span:nth-child(6) {
          animation-delay: 0.6s;
        }

        @keyframes skeletonSweep {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.86; }
        }

        .gen-preview-caption {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: rgba(255,255,255,0.5);
          font-size: 0.8rem;
          font-weight: 650;
          padding: 0 0.2rem;
        }

        .gen-step-list {
          position: relative;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.75rem;
          margin-top: 0.9rem;
        }

        .gen-step {
          min-height: 82px;
          border-radius: 18px;
          padding: 0.9rem;
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          opacity: 0.58;
          transition: all 0.3s ease;
        }

        .gen-step-active {
          opacity: 1;
          border-color: rgba(95,255,247,0.22);
          background: rgba(0,242,234,0.065);
        }

        .gen-step-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.26);
          margin-top: 0.35rem;
          flex: none;
        }

        .gen-step-active .gen-step-dot {
          background: #5ffff7;
          box-shadow: 0 0 16px rgba(95,255,247,0.55);
        }

        .gen-step strong {
          display: block;
          color: white;
          font-size: 0.9rem;
          margin-bottom: 0.28rem;
        }

        .gen-step small {
          display: block;
          color: rgba(255,255,255,0.44);
          font-size: 0.74rem;
          line-height: 1.45;
        }

        @media (max-width: 1024px) {
          .preview-generating {
            align-items: flex-start;
            overflow-y: auto;
          }

          .gen-topbar,
          .gen-workbench {
            grid-template-columns: 1fr;
          }

          .gen-topbar {
            flex-direction: column;
          }

          .gen-step-list {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 640px) {
          .gen-shell {
            border-radius: 24px;
          }

          .gen-preview-card {
            grid-template-columns: 1fr;
          }

          .gen-step-list {
            grid-template-columns: 1fr;
          }
        }

        /* ===== Failed State ===== */
        .preview-failed {
          text-align: center;
          padding: 3rem;
        }

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
          padding: 1rem 1.2rem;
          border-radius: 0.75rem;
          background: linear-gradient(135deg, rgba(0, 242, 234, 0.15), rgba(204, 255, 0, 0.1));
          border: 1px solid rgba(0, 242, 234, 0.3);
          color: rgba(255, 255, 255, 0.95);
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
          box-shadow: 0 4px 15px -3px rgba(0, 242, 234, 0.2),
                      inset 0 1px 0 rgba(255,255,255,0.1);
        }

        .btn-save:hover:not(:disabled) {
          background: linear-gradient(135deg, rgba(0, 242, 234, 0.25), rgba(204, 255, 0, 0.18));
          border-color: rgba(0, 242, 234, 0.5);
          box-shadow: 0 6px 20px -3px rgba(0, 242, 234, 0.3),
                      inset 0 1px 0 rgba(255,255,255,0.15);
          transform: translateY(-1px);
        }
        .btn-save:disabled {
           opacity: 0.5;
           cursor: not-allowed;
           background: rgba(255, 255, 255, 0.06);
           border-color: rgba(255, 255, 255, 0.1);
           box-shadow: none;
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
          padding: 1rem 3rem;
          min-width: 200px;
          color: #000;
          font-size: 1rem;
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

        @keyframes spin {
          to { transform: rotate(360deg); }
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
