"use client";

/**
 * 后台任务管理器
 * 
 * 功能：
 * 1. 在后台持续执行视频批量生成和图片批量处理任务
 * 2. 在后台持续执行 Quick Generator 视频和图片任务
 * 3. 任务完成时显示全局通知
 * 4. 页面切换不影响任务执行
 */

import { useEffect, useRef, useCallback, useReducer } from "react";
import { useRouter } from "next/navigation";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { type PipelineStep, type VideoBatchTask } from "@/types/video-batch";
import { useImageBatchStore } from "@/stores/image-batch-store";
import { useQuickGenStore } from "@/stores/quick-gen-store";
import { useSlideshowStore } from "@/stores/slideshow-store";
import { useAiGenStore, type AiGenTask } from "@/stores/ai-gen-store";
import { useToast } from "@/hooks/use-toast";
import { getCharacterReferenceMaxImages, mergeCharacterReferenceImages } from "@/lib/video-models/character-reference";
import { getCharacterAssetReferenceUrls } from "@/lib/character-assets";
import { Video, Image as ImageIcon, Sparkles, Palette, ExternalLink } from "lucide-react";

// ============================================================================
// 视频任务执行器
// ============================================================================

function useVideoTaskExecutor() {
  const { toast } = useToast();
  const tasks = useVideoBatchStore((state) => state.tasks);
  const jobStatus = useVideoBatchStore((state) => state.jobStatus);
  const globalSettings = useVideoBatchStore((state) => state.globalSettings);
  const updateTaskStatus = useVideoBatchStore((state) => state.updateTaskStatus);
  const setJobStatus = (status: string) => useVideoBatchStore.setState({ jobStatus: status as import("@/stores/video-batch-store").VideoBatchJobStatus });

  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef<string | null>(null);
  // 执行循环收尾后的自唤醒信号(见执行 effect 尾注)
  const [rescanTick, forceRescan] = useReducer((x: number) => x + 1, 0);

  // 获取用户 ID
  useEffect(() => {
    fetch("/api/user/credits")
      .then(async res => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[VideoTaskExecutor] Failed to parse credits response:", text, e);
          return {};
        }
      })
      .then(data => {
        if (data.userId) {
          userIdRef.current = data.userId;
          console.log("[VideoTaskExecutor] Got userId:", data.userId);
        }
      })
      .catch(console.error);
  }, []);

  // 执行单个视频任务
  const executeVideoTask = useCallback(async (taskId: string) => {
    // 从 store 取最新快照(执行循环会跨渲染重扫,不能依赖闭包里的旧 tasks)
    const task = useVideoBatchStore.getState().tasks.find(t => t.id === taskId);
    if (!task || task.status !== "pending") return;

    try {
      // 如果 userId 还没获取到，先获取
      if (!userIdRef.current) {
        try {
          const creditsRes = await fetch("/api/user/credits");
          const creditsText = await creditsRes.text();
          let creditsData;
          try {
            creditsData = JSON.parse(creditsText);
          } catch (e) {
            console.error("[VideoTaskExecutor] Failed to parse credits response:", creditsText, e);
            creditsData = {};
          }
          if (creditsData.userId) {
            userIdRef.current = creditsData.userId;
            console.log("[VideoTaskExecutor] Got userId on demand:", creditsData.userId);
          }
        } catch (e) {
          console.error("[VideoTaskExecutor] Failed to get userId:", e);
        }
      }

      // 【修复】优先使用任务创建时保存的模特ID，而不是当前全局设置
      const taskModelId = task.aiModelId || globalSettings.aiModelId;
      const taskUseAiModel = task.useAiModel ?? globalSettings.useAiModel;
      const taskModelTriggerWord = task.aiModelTriggerWord || globalSettings.aiModelTriggerWord;
      const taskModelType = task.modelType || globalSettings.modelType;
      const taskDuration = task.duration || globalSettings.duration;
      const taskQuality = task.quality || globalSettings.quality;
      const taskAspectRatio = task.aspectRatio || globalSettings.aspectRatio;
      const isPromptMode = task.mode === "prompt_to_video";

      // 轮询上游直到终态(正常提交与刷新恢复两条路径共用)
      const pollVideoUntilDone = async (upstreamTaskId: string) => {
        const isSeedanceBatch = taskModelType === "seedance";
        const maxAttempts = taskModelType === "happyhorse"
          ? (taskDuration === 12 ? 144 : 80)
          : isSeedanceBatch
            ? 60
            : taskModelType === "sora2-pro"
              ? 140
              : 90;
        const pollInterval = isSeedanceBatch ? 5000 : taskModelType === "happyhorse" ? 7500 : 10000;

        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, pollInterval));
          updateTaskStatus(taskId, "generating_video", { currentStep: 4, progress: Math.min(80 + Math.floor(i / 2), 98) });

          const statusRes = await fetch(`/api/video-batch/models/status?modelType=${encodeURIComponent(taskModelType)}&taskId=${encodeURIComponent(upstreamTaskId)}&aspectRatio=${encodeURIComponent(taskAspectRatio)}&durationSeconds=${taskDuration}&quality=${encodeURIComponent(taskQuality)}`);
          const statusText = await statusRes.text();
          let statusData;
          try {
            statusData = JSON.parse(statusText);
          } catch {
            continue;
          }

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.videoUrl) {
              updateTaskStatus(taskId, "success", {
                currentStep: 4 as PipelineStep,
                progress: 100,
                soraTaskId: upstreamTaskId,
                soraVideoUrl: statusData.data.videoUrl,
              });
              toast({
                title: "视频生成完成",
                description: (
                  <a href="/studio" className="text-tiktok-cyan hover:underline flex items-center gap-1">
                    Studio 视频任务已完成，点击查看 <ExternalLink className="h-3 w-3" />
                  </a>
                ),
              });
              return;
            }
            if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "视频生成失败");
            }
          }
        }

        throw new Error("视频生成任务超时");
      };

      // 刷新恢复:上游任务号已持久化的任务直接续轮询,绝不重复提交(防双扣费)
      if (task.soraTaskId) {
        updateTaskStatus(taskId, "generating_video", { currentStep: 4, progress: 80 });
        await pollVideoUntilDone(task.soraTaskId);
        return;
      }

      console.log("[VideoTaskExecutor] Task AI model config:", {
        taskId: task.id,
        taskModelId: task.aiModelId,
        taskUseAiModel: task.useAiModel,
        globalModelId: globalSettings.aiModelId,
        globalUseAiModel: globalSettings.useAiModel,
        finalModelId: taskModelId,
        finalUseAiModel: taskUseAiModel,
        hasTaskModelTriggerWord: !!task.aiModelTriggerWord,
      });

      // 【优化】如果启用了 AI 模特，在任务开始前验证合约是否有效
      if (taskUseAiModel && taskModelId) {
        try {
          const verifyRes = await fetch("/api/contracts/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: taskModelId }),
          });
          const verifyData = await verifyRes.json();

          if (!verifyData.valid) {
            console.warn("[VideoTaskExecutor] AI model contract invalid:", {
              modelId: taskModelId,
              reason: verifyData.reason,
            });
            // 合约无效时，继续执行但不使用 AI 模特
            // 可选：也可以直接报错让用户知道
          } else {
            console.log("[VideoTaskExecutor] AI model contract verified:", {
              modelId: taskModelId,
              modelName: verifyData.model?.name,
              daysRemaining: verifyData.contract?.daysRemaining,
            });
          }
        } catch (e) {
          console.error("[VideoTaskExecutor] Failed to verify contract:", e);
          // 验证失败时不阻止任务执行
        }
      }

      // 上传图片
      const uploadedUrls: string[] = [];
      if (!isPromptMode) {
        updateTaskStatus(taskId, "uploading", { currentStep: 1, progress: 10 });
        for (const img of task.images) {
        // 验证图片 URL 是否有效
        if (!img.url && !img.file) {
          console.warn("[VideoTaskExecutor] Skipping image with no URL or file:", img.id);
          continue;
        }

        if (img.file) {
          const formData = new FormData();
          formData.append("file", img.file);
          formData.append("folder", "video-batch");

          const uploadRes = await fetch("/api/upload/image", {
            method: "POST",
            body: formData,
          });
          const uploadText = await uploadRes.text();
          let uploadData;
          try {
            uploadData = JSON.parse(uploadText);
          } catch (e) {
            console.error("[VideoTaskExecutor] Failed to parse upload response:", uploadText, e);
            throw new Error("图片上传服务响应格式错误");
          }

          if (!uploadData.success) {
            throw new Error(uploadData.error || "图片上传失败");
          }
          uploadedUrls.push(uploadData.data?.url || uploadData.url);
        } else if (img.url && (img.url.startsWith("http://") || img.url.startsWith("https://"))) {
          // 只接受有效的 HTTP/HTTPS URL
          uploadedUrls.push(img.url);
        } else if (img.url && img.url.startsWith("blob:")) {
          // Blob URL 需要特殊处理 - 需要先上传
          console.warn("[VideoTaskExecutor] Blob URL found without file, skipping:", img.url);
          continue;
        } else {
          console.warn("[VideoTaskExecutor] Invalid URL format:", img.url);
          continue;
        }
      }

        if (uploadedUrls.length === 0) {
          throw new Error("没有可用的图片，请重新上传");
        }
      }

      // 转换图片为 Base64 - 对于 Supabase URL，直接使用 URL
      const happyHorseImageUrls = isPromptMode
        ? (task.referenceImageUrls?.length
          ? task.referenceImageUrls
          : (task.referenceImageUrl ? [task.referenceImageUrl] : []))
        : uploadedUrls.slice(0, 9);

      const imageBase64List: string[] = [];
      for (const url of uploadedUrls) {
        // 对于 Supabase 公开 URL，直接使用，避免浏览器端转换问题
        if (url.includes("supabase.co/storage/v1/object/public")) {
          console.log("[VideoTaskExecutor] Using Supabase URL directly:", url);
          imageBase64List.push(url);
          continue;
        }

        try {
          const response = await fetch(url);

          // 验证响应是否为图片
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok || !contentType.startsWith("image/")) {
            console.error("[VideoTaskExecutor] Invalid response for image:", url, "Content-Type:", contentType);
            // 使用原始 URL 作为 fallback
            imageBase64List.push(url);
            continue;
          }

          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          imageBase64List.push(base64);
        } catch (err) {
          console.error("[VideoTaskExecutor] 转换图片失败:", err);
          // 使用原始 URL 作为 fallback
          imageBase64List.push(url);
        }
      }

      // 生成脚本
      let finalVideoPrompt = task.customPrompt?.trim() || "";

      // prompt 模式,或图生视频任务自带用户提示词(Studio omnibox「拖图+文字」路径):
      // 跳过豆包脚本/提示词管线,直接以 customPrompt 为最终提示词。
      // 旧 video-batch 页面的图片任务从不设置 customPrompt,不受影响。
      if (isPromptMode || finalVideoPrompt) {
        updateTaskStatus(taskId, "generating_prompt", {
          currentStep: 3,
          progress: 75,
          doubaoAiVideoPrompt: finalVideoPrompt,
        });
      } else {
      updateTaskStatus(taskId, "generating_script", { currentStep: 2, progress: 30 });

      const scriptRes = await fetch("/api/video-batch/generate-talking-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: imageBase64List,
          taskId: taskId,
          language: globalSettings.language,
        }),
      });

      // 检查响应状态
      if (!scriptRes.ok) {
        const contentType = scriptRes.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          console.error("[VideoTaskExecutor] Script API returned HTML instead of JSON, status:", scriptRes.status);
          throw new Error(`脚本生成服务暂时不可用 (${scriptRes.status})，请稍后重试`);
        }
      }

      const scriptText = await scriptRes.text();
      let scriptResult;
      try {
        scriptResult = JSON.parse(scriptText);
      } catch (e) {
        console.error("[VideoTaskExecutor] Failed to parse script response:", scriptText, e);
        throw new Error("脚本生成服务响应格式错误");
      }
      if (!scriptResult.success) {
        throw new Error(scriptResult.error || "脚本生成失败");
      }

      updateTaskStatus(taskId, "generating_script", {
        currentStep: 2,
        progress: 50,
        doubaoTalkingScript: scriptResult.data.script
      });

      // 生成提示词
      updateTaskStatus(taskId, "generating_prompt", { currentStep: 3, progress: 60 });

      const promptRes = await fetch("/api/video-batch/generate-ai-video-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          talkingScript: scriptResult.data.script,
          taskId: taskId,
          // 【修复】传递任务创建时保存的模特ID，而不是当前全局设置
          userId: userIdRef.current,
          modelId: taskUseAiModel ? taskModelId : undefined,
          // 保留前端触发词作为后备（向后兼容）
          modelTriggerWord: taskUseAiModel ? taskModelTriggerWord : undefined,
        }),
      });

      // 检查响应状态
      if (!promptRes.ok) {
        const contentType = promptRes.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          console.error("[VideoTaskExecutor] Prompt API returned HTML instead of JSON, status:", promptRes.status);
          throw new Error(`提示词生成服务暂时不可用 (${promptRes.status})，请稍后重试`);
        }
      }

      const promptText = await promptRes.text();
      let promptResult;
      try {
        promptResult = JSON.parse(promptText);
      } catch (e) {
        console.error("[VideoTaskExecutor] Failed to parse prompt response:", promptText, e);
        throw new Error("提示词生成服务响应格式错误");
      }
      if (!promptResult.success) {
        throw new Error(promptResult.error || "提示词生成失败");
      }

      // 最终提示词（包含 AI 模特触发词）
      // 【修复】使用任务中保存的设置，而不是当前全局设置
      finalVideoPrompt = promptResult.data.prompt;
      if (taskUseAiModel && taskModelTriggerWord && !finalVideoPrompt.includes(taskModelTriggerWord)) {
        finalVideoPrompt = `[AI MODEL: ${taskModelTriggerWord}]\n\n${finalVideoPrompt}`;
      }

      updateTaskStatus(taskId, "generating_prompt", {
        currentStep: 3,
        progress: 75,
        doubaoAiVideoPrompt: finalVideoPrompt
      });

      // 生成视频
      }
      updateTaskStatus(taskId, "generating_video", { currentStep: 4, progress: 80 });

      const mainGridImageUrl = uploadedUrls[0];

      // 角色字段推导与页面内联路径（video-batch/page.tsx）保持一致：
      // 任务自带 → 全局设置回退 → 从 characterAsset 快照按模型上限推导
      const taskCharacterAsset = task.characterAsset || globalSettings.characterAsset || null;
      const taskCharacterReferenceImages = task.characterReferenceImages?.length
        ? task.characterReferenceImages
        : globalSettings.characterReferenceImages?.length
          ? globalSettings.characterReferenceImages
          : taskCharacterAsset
            ? getCharacterAssetReferenceUrls(taskCharacterAsset).slice(0, getCharacterReferenceMaxImages(taskModelType))
            : [];
      const taskCharacterRefUrl = taskCharacterReferenceImages[0]
        || task.characterRefUrl
        || globalSettings.characterRefUrl;

      const unifiedImageUrls = mergeCharacterReferenceImages(taskModelType, taskCharacterRefUrl, [
        ...taskCharacterReferenceImages.slice(1),
        ...(happyHorseImageUrls || []),
        ...(mainGridImageUrl ? [mainGridImageUrl] : []),
      ]);

      const videoRes = await fetch("/api/video-batch/models/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalVideoPrompt,
          aspectRatio: taskAspectRatio,
          durationSeconds: taskDuration,
          quality: taskQuality,
          modelType: taskModelType,
          imageUrls: unifiedImageUrls,
          clientTaskId: taskId,
          userId: userIdRef.current,
          mode: isPromptMode ? "prompt_to_video" : "image_to_video",
          groupName: task.groupName,
          batchId: task.batchId,
          characterId: task.characterId || taskCharacterAsset?.id,
          characterName: task.characterName || taskCharacterAsset?.name,
          characterReferenceImages: taskCharacterReferenceImages,
          characterAsset: taskCharacterAsset,
        }),
      });

      if (!videoRes.ok) {
        const contentType = videoRes.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          throw new Error(`视频生成服务暂时不可用 (${videoRes.status})，请稍后重试`);
        }
      }

      const videoText = await videoRes.text();
      let videoResult;
      try {
        videoResult = JSON.parse(videoText);
      } catch (e) {
        console.error("[VideoTaskExecutor] Failed to parse video response:", videoText, e);
        throw new Error("视频生成服务响应格式错误");
      }
      if (!videoResult.success) {
        throw new Error(videoResult.error || "视频生成失败");
      }

      const upstreamTaskId = videoResult.data.taskId;
      // 上游任务号立即持久化(刷新恢复锚点:重启后续轮询而非重复提交)
      updateTaskStatus(taskId, "generating_video", { currentStep: 4, progress: 80, soraTaskId: upstreamTaskId });
      await pollVideoUntilDone(upstreamTaskId);

    } catch (error) {
      console.error("[VideoTask] Error:", error);
      updateTaskStatus(taskId, "failed", {
        currentStep: task.currentStep,
        progress: task.progress,
        errorMessage: error instanceof Error ? error.message : "任务执行失败",
      });
    }
  }, [globalSettings, updateTaskStatus, toast]);

  // 监听并执行任务
  //
  // 执行范围裁决(S1):本执行器只执行 Studio 批次任务(带 batchId)。
  // video-batch 旧页在页面内联执行自己的任务,其暂存的 pending 草稿
  // 绝不能被这里拉起(会误提交扣积分、污染草稿)。
  useEffect(() => {
    // 刷新恢复:persist 把 running 落盘为 paused 且全站无 resume 控件——
    // 只要还有待执行的 Studio 任务就自动续跑
    if (
      jobStatus === "paused" &&
      tasks.some(t => t.status === "pending" && !!t.batchId)
    ) {
      setJobStatus("running");
      return;
    }
    if (jobStatus !== "running" || isExecutingRef.current) return;

    const isStudioPending = (t: VideoBatchTask) =>
      t.status === "pending" && !!t.batchId && !executedTasksRef.current.has(t.id);

    if (!tasks.some(isStudioPending)) {
      // 完成判定只看 Studio 任务子集(旧页残留任务不参与)
      const studioTasks = tasks.filter(t => !!t.batchId);
      const hasRunningTasks = studioTasks.some(
        t => t.status !== "pending" && t.status !== "success" && t.status !== "failed"
      );
      if (!hasRunningTasks && studioTasks.length > 0) {
        setJobStatus("completed");

        const successCount = studioTasks.filter(t => t.status === "success").length;
        const failedCount = studioTasks.filter(t => t.status === "failed").length;

        if (successCount > 0 || failedCount > 0) {
          toast({
            title: "📹 批量视频任务完成",
            description: (
              <a href="/studio" className="text-tiktok-cyan hover:underline flex items-center gap-1">
                成功: {successCount}, 失败: {failedCount} - 点击查看 <ExternalLink className="h-3 w-3" />
              </a>
            ),
          });
        }
      }
      return;
    }

    // 顺序执行:每轮从 store 重扫(执行期间新提交的批次也会被捞起)
    const executeNext = async () => {
      isExecutingRef.current = true;
      try {
        for (;;) {
          const next = useVideoBatchStore.getState().tasks.find(isStudioPending);
          if (!next) break;
          executedTasksRef.current.add(next.id);

          await executeVideoTask(next.id);

          // 任务间延迟
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } finally {
        isExecutingRef.current = false;
      }
      // 收尾自唤醒:复位 isExecutingRef 后不会再有渲染,必须主动触发
      // effect 重跑,才能进入完成判定或捞起收尾窗口内新入队的任务
      forceRescan();
    };

    executeNext();
  }, [jobStatus, tasks, executeVideoTask, setJobStatus, toast, rescanTick]);

  // 重置执行状态
  useEffect(() => {
    if (jobStatus === "idle") {
      executedTasksRef.current.clear();
      isExecutingRef.current = false;
    }
  }, [jobStatus]);
}

// ============================================================================
// 图片任务执行器
// ============================================================================

function useImageTaskExecutor() {
  const { toast } = useToast();
  const tasks = useImageBatchStore((state) => state.tasks);
  const jobStatus = useImageBatchStore((state) => state.jobStatus);
  const updateTaskResult = useImageBatchStore((state) => state.updateTaskResult);
  const setJobStatus = useImageBatchStore((state) => state.setJobStatus);

  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef<string | null>(null);

  // 获取用户 ID
  useEffect(() => {
    fetch("/api/user/credits")
      .then(async res => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[ImageTaskExecutor] Failed to parse credits response:", text, e);
          return {};
        }
      })
      .then(data => {
        if (data.userId) {
          userIdRef.current = data.userId;
        }
      })
      .catch(console.error);
  }, []);

  // 执行单个图片任务
  const executeImageTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== "pending") return;

    try {
      updateTaskResult(taskId, { status: "processing" });

      // 上传图片（如果是 blob URL）
      let remoteImageUrl = task.config.sourceImageUrl;
      if (task.config.sourceImageUrl.startsWith("blob:")) {
        try {
          const blobResponse = await fetch(task.config.sourceImageUrl);
          const blob = await blobResponse.blob();
          const formData = new FormData();
          formData.append("file", blob, task.config.sourceImageName);

          const uploadResponse = await fetch("/api/upload/image", {
            method: "POST",
            body: formData,
          });
          const uploadText = await uploadResponse.text();
          let uploadResult;
          try {
            uploadResult = JSON.parse(uploadText);
          } catch (e) {
            console.error("[ImageTaskExecutor] Failed to parse upload response:", uploadText, e);
            throw new Error("图片上传服务响应格式错误");
          }

          if (uploadResult.success && uploadResult.data?.url) {
            remoteImageUrl = uploadResult.data.url;
            // 更新当前任务
            useImageBatchStore.getState().updateTaskConfig(taskId, "sourceImageUrl", remoteImageUrl);
            // 批量更新所有共享同一 blob URL 的 pending 任务，
            // 避免 blob 被 revoke 后后续任务无法访问，同时避免重复上传同一张图片
            const originalBlobUrl = task.config.sourceImageUrl;
            const allTasks = useImageBatchStore.getState().tasks;
            allTasks.forEach((t) => {
              if (t.id !== taskId && t.config.sourceImageUrl === originalBlobUrl && t.status === "pending") {
                useImageBatchStore.getState().updateTaskConfig(t.id, "sourceImageUrl", remoteImageUrl);
              }
            });
          } else {
            throw new Error("图片上传失败");
          }
        } catch (uploadError) {
          throw new Error("图片上传失败: " + (uploadError instanceof Error ? uploadError.message : "未知错误"));
        }
      }

      // 调用 API - 使用正确的参数格式
      // 角色参考图放在前面，保证平台只取首图时也能稳定引用角色。
      const characterReferenceImages = task.config.characterReferenceImages?.length
        ? task.config.characterReferenceImages
        : task.config.characterRefUrl
          ? [task.config.characterRefUrl]
          : [];
      const apiSourceImageUrls = [
        ...characterReferenceImages,
        remoteImageUrl,
      ].filter((url): url is string => typeof url === "string" && url.length > 0);

      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: task.config.action,  // "generate" | "upscale" | "nine_grid"
          imageModel: "gpt-image-2",
          sourceImageUrls: apiSourceImageUrls.length > 0 ? apiSourceImageUrls : undefined,
          aspectRatio: task.config.aspectRatio,
          resolution: task.config.resolution,
          prompt: task.config.action === "generate" ? (task.config.prompt || "High quality product photo") : undefined,
          userId: userIdRef.current, // 传递用户 ID 以写入任务日志
          source: "batch_image", // 标记来源
          characterId: task.config.characterId,
          characterName: task.config.characterName,
          characterReferenceImages,
          characterAsset: task.config.characterAsset,
        }),
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.error("[ImageTaskExecutor] Failed to parse image generation response:", responseText, e);
        throw new Error("图片生成服务响应格式错误");
      }

      if (result.success && result.data?.taskId) {
        const apiTaskId = result.data.taskId;
        const taskModel = result.data.model;

        updateTaskResult(taskId, { apiTaskId });

        // 前端主动等待最多 5 分钟；超时后后台 worker 继续推进
        const maxAttempts = 60;
        let attempts = 0;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;

          const statusRes = await fetch(`/api/generate/image?taskId=${apiTaskId}&model=${taskModel}`);
          const statusText = await statusRes.text();
          let statusData;
          try {
            statusData = JSON.parse(statusText);
          } catch (e) {
            console.error("[ImageTaskExecutor] Failed to parse status response:", statusText, e);
            continue;
          }

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.imageUrl) {
              updateTaskResult(taskId, {
                status: "completed",
                resultUrl: statusData.data.imageUrl,
              });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "图片生成失败");
            }
          }
        }

        updateTaskResult(taskId, {
          status: "processing",
          error: "任务仍在后台生成，可稍后刷新查看",
        });
        return;
      } else {
        throw new Error(result.error || "提交任务失败");
      }
    } catch (error) {
      console.error("[ImageTask] Error:", error);
      updateTaskResult(taskId, {
        status: "failed",
        error: error instanceof Error ? error.message : "任务执行失败",
      });
    }
  }, [tasks, updateTaskResult]);

  // 监听并执行任务
  useEffect(() => {
    if (jobStatus !== "running" || isExecutingRef.current) return;

    const pendingTasks = tasks.filter(
      t => t.status === "pending" && !executedTasksRef.current.has(t.id)
    );

    if (pendingTasks.length === 0) {
      const hasProcessingTasks = tasks.some(t => t.status === "processing");
      if (!hasProcessingTasks && tasks.length > 0) {
        setJobStatus("completed");

        const successCount = tasks.filter(t => t.status === "completed").length;
        const failedCount = tasks.filter(t => t.status === "failed").length;

        if (successCount > 0 || failedCount > 0) {
          toast({
            title: "🖼️ 批量图片任务完成",
            description: (
              <a href="/pro-studio/image-batch" className="text-tiktok-pink hover:underline flex items-center gap-1">
                成功: {successCount}, 失败: {failedCount} - 点击查看 <ExternalLink className="h-3 w-3" />
              </a>
            ),
          });
        }
      }
      return;
    }

    // 并发执行图片任务
    const executeAll = async () => {
      isExecutingRef.current = true;

      await Promise.all(
        pendingTasks.map(async (task) => {
          if (executedTasksRef.current.has(task.id)) return;
          executedTasksRef.current.add(task.id);
          await executeImageTask(task.id);
        })
      );

      isExecutingRef.current = false;
    };

    executeAll();
  }, [jobStatus, tasks, executeImageTask, setJobStatus, toast]);

  // 重置执行状态
  useEffect(() => {
    if (jobStatus === "idle") {
      executedTasksRef.current.clear();
      isExecutingRef.current = false;
    }
  }, [jobStatus]);
}

// ============================================================================
// Quick Gen 视频任务执行器
// ============================================================================

function useQuickGenTaskExecutor() {
  const { toast } = useToast();
  // S0.6：从"监听单槽"改为"遍历多任务队列"，支持并发多任务
  const videoTasks = useQuickGenStore((state) => state.videoTasks);
  const updateTaskStatus = useQuickGenStore((state) => state.updateTaskStatus);

  // 去重集合：每个任务只启动一次执行链（复用 image-batch 执行器的并发控制模式）
  const executedTasksRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef<string | null>(null);

  // 获取用户 ID
  useEffect(() => {
    fetch("/api/user/credits")
      .then(async res => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[QuickGenTaskExecutor] Failed to parse credits response:", text, e);
          return {};
        }
      })
      .then(data => {
        if (data.userId) {
          userIdRef.current = data.userId;
        }
      })
      .catch(console.error);
  }, []);

  // 执行单个 Quick Gen 视频任务（提交 + 轮询）
  const executeTask = useCallback(async (taskIdToRun: string) => {
      const activeTask = useQuickGenStore.getState().videoTasks.find(t => t.id === taskIdToRun);
      if (!activeTask) return;

      try {
        if (activeTask.status === "idle") {
          // 新任务，调用 API
          updateTaskStatus(activeTask.id, "generating", { progress: 10 });

          const modelName = activeTask.model || "";
          const modelType =
            modelName.startsWith("seedance") ? "seedance" :
            modelName.startsWith("happyhorse") ? "happyhorse" :
            modelName.includes("sora2-pro") ? "sora2-pro" :
            modelName.includes("grok") ? "grok" :
            modelName.includes("veo") ? "veo" :
            modelName.includes("omni") ? "omni" :
            "sora2";
          const quality = modelName.includes("pro") || activeTask.quality === "hd" ? "hd" : "standard";

          const response = await fetch("/api/video-batch/models/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: activeTask.prompt,
              aspectRatio: activeTask.aspectRatio,
              durationSeconds: activeTask.duration,
              quality,
              modelType,
              imageUrls: activeTask.sourceImageUrl ? [activeTask.sourceImageUrl] : [],
              clientTaskId: activeTask.id,
              userId: userIdRef.current,
              mode: activeTask.sourceImageUrl ? "image_to_video" : "prompt_to_video",
              // 角色元数据随任务上送；参考图推导与合并由网关完成
              characterId: activeTask.characterAsset?.id,
              characterName: activeTask.characterAsset?.name,
              characterAsset: activeTask.characterAsset,
            }),
          });

          const responseText = await response.text();
          let result;
          try {
            result = JSON.parse(responseText);
          } catch (e) {
            console.error("[QuickGenTaskExecutor] Failed to parse video submit response:", responseText, e);
            throw new Error("视频生成服务响应格式错误");
          }
          if (!result.success) throw new Error(result.error || "提交失败");

          updateTaskStatus(activeTask.id, "polling", {
            progress: 20,
            taskId: result.data.taskId,
            creditsDeducted: true,
          });
        }

        // 轮询查询结果（重新从队列取最新快照，拿到提交后写回的 taskId）
        const task = useQuickGenStore.getState().videoTasks.find(t => t.id === taskIdToRun);
        if (!task || !task.taskId) return;

        const taskModelName = task.model || "";
        const statusModelType =
          taskModelName.startsWith("seedance") ? "seedance" :
          taskModelName.startsWith("happyhorse") ? "happyhorse" :
          taskModelName.includes("sora2-pro") ? "sora2-pro" :
          taskModelName.includes("grok") ? "grok" :
          taskModelName.includes("veo") ? "veo" :
          taskModelName.includes("omni") ? "omni" :
          "sora2";
        const statusQuality = taskModelName.includes("pro") || task.quality === "hd" ? "hd" : "standard";
        const isSeedanceModel = statusModelType === "seedance";
        const isHappyHorseModel = statusModelType === "happyhorse";
        const maxAttempts = isHappyHorseModel ? (task.duration === 12 ? 144 : 80) : isSeedanceModel ? 60 : (statusModelType === "sora2-pro" ? 120 : 90);
        const pollInterval = isSeedanceModel ? 5000 : isHappyHorseModel ? 7500 : 10000;

        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, pollInterval));
          updateTaskStatus(task.id, "polling", { progress: Math.min(20 + i * 2, 90) });

          const statusRes = await fetch(`/api/video-batch/models/status?modelType=${encodeURIComponent(statusModelType)}&taskId=${encodeURIComponent(task.taskId)}&aspectRatio=${encodeURIComponent(task.aspectRatio)}&durationSeconds=${task.duration}&quality=${encodeURIComponent(statusQuality)}`);

          const statusText = await statusRes.text();
          let statusData;
          try {
            statusData = JSON.parse(statusText);
          } catch (e) {
            console.error("[QuickGenTaskExecutor] Failed to parse status response:", statusText, e);
            continue;
          }

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && (statusData.data.videoUrl || statusData.data.video_url)) {
              updateTaskStatus(task.id, "completed", {
                progress: 100, resultUrl: statusData.data.videoUrl || statusData.data.video_url, completedAt: new Date().toISOString()
              });
              toast({
                title: "🎉 快速视频生成完成",
                description: (
                  <a href="/quick-gen" className="text-amber-400 hover:underline flex items-center gap-1">
                    点击查看结果 <ExternalLink className="h-3 w-3" />
                  </a>
                ),
              });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "生成失败");
            }
          }
        }
        throw new Error("任务超时");
      } catch (error) {
        updateTaskStatus(taskIdToRun, "failed", {
          errorMessage: error instanceof Error ? error.message : "执行失败",
          completedAt: new Date().toISOString()
        });
        toast({ variant: "destructive", title: "❌ 快速视频生成失败", description: error instanceof Error ? error.message : "未知错误" });
      }
  }, [updateTaskStatus, toast]);

  // 监听队列：把所有待执行（idle）/ 待恢复轮询（polling）且未启动过的任务并发拉起
  useEffect(() => {
    const pendingTasks = videoTasks.filter(
      t => (t.status === "idle" || t.status === "polling") && !executedTasksRef.current.has(t.id)
    );
    if (pendingTasks.length === 0) return;

    for (const task of pendingTasks) {
      executedTasksRef.current.add(task.id);
      void executeTask(task.id);
    }
  }, [videoTasks, executeTask]);

  // 清理：任务离开队列（被页面消费/清除）后释放去重记录
  useEffect(() => {
    if (executedTasksRef.current.size === 0) return;
    const liveIds = new Set(videoTasks.map(t => t.id));
    for (const id of Array.from(executedTasksRef.current)) {
      if (!liveIds.has(id)) executedTasksRef.current.delete(id);
    }
  }, [videoTasks]);
}

// ============================================================================
// Quick Gen 图片任务执行器
// ============================================================================

function useQuickGenImageTaskExecutor() {
  const { toast } = useToast();
  // S0.6：从"监听单槽"改为"遍历多任务队列"，支持并发多任务
  const imageTasks = useQuickGenStore((state) => state.imageTasks);
  const updateTaskStatus = useQuickGenStore((state) => state.updateImageTaskStatus);

  // 去重集合：每个任务只启动一次执行链（复用 image-batch 执行器的并发控制模式）
  const executedTasksRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef<string | null>(null);

  // 获取用户 ID
  useEffect(() => {
    fetch("/api/user/credits")
      .then(async res => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[QuickGenImageTaskExecutor] Failed to parse credits response:", text, e);
          return {};
        }
      })
      .then(data => {
        if (data.userId) {
          userIdRef.current = data.userId;
        }
      })
      .catch(console.error);
  }, []);

  // 执行单个 Quick Gen 图片任务（提交 + 轮询）
  const executeTask = useCallback(async (taskIdToRun: string) => {
      const activeTask = useQuickGenStore.getState().imageTasks.find(t => t.id === taskIdToRun);
      if (!activeTask) return;

      try {
        if (activeTask.status === "idle") {
          updateTaskStatus(activeTask.id, "generating", { progress: 10 });

          // 调用图片生成 API
          const imageAction = activeTask.action || "generate";
          const response = await fetch("/api/generate/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: imageAction,
              imageModel: "gpt-image-2",
              prompt: activeTask.prompt,
              sourceImageUrls: activeTask.sourceImageUrls.length > 0 ? activeTask.sourceImageUrls : undefined,
              tier: activeTask.tier,
              aspectRatio: activeTask.aspectRatio,
              resolution: activeTask.resolution,
              userId: userIdRef.current, // 传递用户 ID 以写入任务日志
              batchId: activeTask.batchId,
              // 以本地任务 id 作服务端 task_id:防并发提交撞 openai-${Date.now()},
              // 同时让 generations.task_id 可与本地任务对账(入库匹配)
              requestId: activeTask.id,
              characterId: activeTask.characterAsset?.id,
              characterName: activeTask.characterAsset?.name,
              characterReferenceImages: activeTask.characterAsset
                ? [
                  activeTask.characterAsset.reference_sheet_url,
                  ...activeTask.characterAsset.reference_images,
                  activeTask.characterAsset.avatar_url,
                ].filter(Boolean)
                : undefined,
              characterAsset: activeTask.characterAsset,
            }),
          });

          const responseText = await response.text();
          console.log("[QuickGenImageTaskExecutor] Response:", response.status, responseText.substring(0, 300));
          
          // 先检查 HTTP 状态码
          if (!response.ok) {
            // 尝试从 JSON 中提取错误信息
            try {
              const errJson = JSON.parse(responseText);
              throw new Error(errJson.error || errJson.message || `服务器错误 (${response.status})`);
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) {
                throw new Error(`服务器返回错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
              }
              throw parseErr; // Re-throw the error we constructed above
            }
          }

          let result;
          try {
            result = JSON.parse(responseText);
          } catch (e) {
            console.error("[QuickGenImageTaskExecutor] JSON parse failed:", responseText.substring(0, 200), e);
            throw new Error(`图片生成服务响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 80)}`);
          }
          if (!result.success) throw new Error(result.error || "提交失败");

          // 对于 GPT Image 2 / 新图片模型，POST 直接返回 completed + imageUrl
          // 不需要进入轮询循环
          if (result.data?.status === "completed" && result.data?.imageUrl) {
            updateTaskStatus(activeTask.id, "completed", {
              progress: 100,
              taskId: result.data.taskId,
              resultUrl: result.data.imageUrl,
              completedAt: new Date().toISOString(),
              creditsDeducted: true,
            });
            toast({
              title: "🎉 单图生成完成",
              description: (
                <a href="/quick-gen" className="text-violet-400 hover:underline flex items-center gap-1">
                  点击查看结果 <ExternalLink className="h-3 w-3" />
                </a>
              ),
            });
            return; // 直接返回，不进入轮询
          }

          // 对于 Pro 模式或异步任务，进入轮询
          updateTaskStatus(activeTask.id, "polling", {
            progress: 20, taskId: result.data.taskId, creditsDeducted: true
          });
        }

        // 轮询查询结果（重新从队列取最新快照，拿到提交后写回的 taskId）
        const task = useQuickGenStore.getState().imageTasks.find(t => t.id === taskIdToRun);
        if (!task || !task.taskId) return;

        const maxAttempts = 100; // 100 * 3s = 5 分钟

        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, 3000));
          updateTaskStatus(task.id, "polling", { progress: Math.min(20 + i * 2, 90) });

          const statusRes = await fetch(`/api/generate/image?taskId=${task.taskId}&model=${task.model}`);
          const statusText = await statusRes.text();
          let statusData;
          try {
            statusData = JSON.parse(statusText);
          } catch (e) {
            console.error("[QuickGenImageTaskExecutor] Failed to parse status response:", statusText, e);
            continue;
          }

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.imageUrl) {
              updateTaskStatus(task.id, "completed", {
                progress: 100, resultUrl: statusData.data.imageUrl, completedAt: new Date().toISOString()
              });
              toast({
                title: "🎉 单图生成完成",
                description: (
                  <a href="/quick-gen" className="text-violet-400 hover:underline flex items-center gap-1">
                    点击查看结果 <ExternalLink className="h-3 w-3" />
                  </a>
                ),
              });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "生成失败");
            }
          }
        }
        updateTaskStatus(task.id, "polling", {
          progress: 95,
          errorMessage: "任务仍在后台生成，可稍后刷新查看",
        });
        toast({
          title: "后台生成中",
          description: "任务仍在后台生成，可稍后刷新查看",
        });
        return;
      } catch (error) {
        updateTaskStatus(taskIdToRun, "failed", {
          errorMessage: error instanceof Error ? error.message : "执行失败",
          completedAt: new Date().toISOString()
        });
        toast({ variant: "destructive", title: "❌ 单图生成失败", description: error instanceof Error ? error.message : "未知错误" });
      }
  }, [updateTaskStatus, toast]);

  // 监听队列：把所有待执行（idle）/ 待恢复轮询（polling）且未启动过的任务并发拉起
  useEffect(() => {
    const pendingTasks = imageTasks.filter(
      t => (t.status === "idle" || t.status === "polling") && !executedTasksRef.current.has(t.id)
    );
    if (pendingTasks.length === 0) return;

    for (const task of pendingTasks) {
      executedTasksRef.current.add(task.id);
      void executeTask(task.id);
    }
  }, [imageTasks, executeTask]);

  // 清理：任务离开队列（被页面消费/清除）后释放去重记录
  useEffect(() => {
    if (executedTasksRef.current.size === 0) return;
    const liveIds = new Set(imageTasks.map(t => t.id));
    for (const id of Array.from(executedTasksRef.current)) {
      if (!liveIds.has(id)) executedTasksRef.current.delete(id);
    }
  }, [imageTasks]);
}

// ============================================================================
// Studio 幻灯片渲染执行器(S1.2)
// ============================================================================

/**
 * 只执行带 renderRequest 的任务(Studio 提交腿产物);
 * 旧 image-slideshow 页任务无此字段,保持页面自驱语义不受影响。
 * 串行执行:每次调用 = 一条成片,服务端同步渲染(worker 优先,失败回退本地)。
 */
function useSlideshowTaskExecutor() {
  const { toast } = useToast();
  const slideshowTasks = useSlideshowStore((state) => state.tasks);
  const updateTaskStatus = useSlideshowStore((state) => state.updateTaskStatus);

  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());
  const [rescanTick, forceRescan] = useReducer((x: number) => x + 1, 0);

  const executeSlideshowTask = useCallback(async (taskId: string) => {
    const task = useSlideshowStore.getState().tasks.find(t => t.id === taskId);
    if (!task || task.status !== "pending" || !task.renderRequest) return;

    try {
      updateTaskStatus(taskId, "generating", { stage: "composing", progress: 15 });

      const res = await fetch("/api/video-batch/generate-slideshow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task.renderRequest),
        // 略大于服务端 maxDuration=300s:挂起请求会饿死整条串行队列
        signal: AbortSignal.timeout(330_000),
      });
      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`幻灯片服务响应格式错误 (HTTP ${res.status})`);
      }
      if (!res.ok || !result.success) {
        throw new Error(result.error || `幻灯片合成失败 (HTTP ${res.status})`);
      }

      const url: string | undefined = result.videos?.[0]?.url;
      if (!url) throw new Error("合成完成但未返回视频地址");

      updateTaskStatus(taskId, "completed", { progress: 100, outputUrl: url, videoCount: 1 });
      // 服务端已按实际成功数扣分,通知余额胶囊刷新
      window.dispatchEvent(new CustomEvent("credits-updated"));
      toast({
        title: "🎬 幻灯片成片完成",
        description: (
          <a href="/studio" className="text-tiktok-cyan hover:underline flex items-center gap-1">
            点击查看成片 <ExternalLink className="h-3 w-3" />
          </a>
        ),
      });
    } catch (error) {
      console.error("[SlideshowTaskExecutor] Error:", error);
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      updateTaskStatus(taskId, "failed", {
        errorMessage: isTimeout
          ? "渲染超时,请重试(若已扣费,成片可在生成记录查看)"
          : error instanceof Error
            ? error.message
            : "幻灯片合成失败",
      });
    }
  }, [updateTaskStatus, toast]);

  useEffect(() => {
    if (isExecutingRef.current) return;

    const isRunnable = (t: { id: string; status: string; renderRequest?: Record<string, unknown> }) =>
      t.status === "pending" && !!t.renderRequest && !executedTasksRef.current.has(t.id);

    if (!slideshowTasks.some(isRunnable)) return;

    const executeNext = async () => {
      isExecutingRef.current = true;
      try {
        const runLoop = async () => {
          // 串行 + 每轮重扫:执行期间新提交的幻灯片批次也会被捞起
          for (;;) {
            const next = useSlideshowStore.getState().tasks.find(isRunnable);
            if (!next) break;
            executedTasksRef.current.add(next.id);
            await executeSlideshowTask(next.id);
          }
        };

        // 跨标签页单飞:persist 的 pending 任务会被每个标签各自水合,
        // 无锁时两个标签会对同一任务双重渲染+双重扣费
        if (typeof navigator !== "undefined" && navigator.locks) {
          await navigator.locks.request("stargaze-slideshow-executor", async () => {
            // 拿到锁后重新水合:吸收其他标签页已写回的终态,避免重复执行。
            // 水合是 storage 整表覆盖(last-writer-wins):等锁期间本页新提交的
            // 任务可能已被他页进度写从 storage 冲掉,须按 id 差集补回(复审确认项)
            const memoryTasks = useSlideshowStore.getState().tasks;
            await useSlideshowStore.persist.rehydrate();
            const storedIds = new Set(useSlideshowStore.getState().tasks.map(t => t.id));
            const missing = memoryTasks.filter(t => !storedIds.has(t.id));
            if (missing.length > 0) useSlideshowStore.getState().addTasks(missing);
            await runLoop();
          });
        } else {
          await runLoop();
        }
      } finally {
        isExecutingRef.current = false;
      }
      forceRescan();
    };

    executeNext();
  }, [slideshowTasks, executeSlideshowTask, rescanTick]);

  // 任务离开队列或已失败(等待显式重试)时清理去重集合:
  // failed→pending 的重试要能被重新拉起;去重只防同状态重复执行
  useEffect(() => {
    const liveIds = new Set(
      slideshowTasks.filter(t => t.status !== "failed").map(t => t.id)
    );
    for (const id of Array.from(executedTasksRef.current)) {
      if (!liveIds.has(id)) executedTasksRef.current.delete(id);
    }
  }, [slideshowTasks]);
}

// ============================================================================
// Studio AI 生成腿执行器(S2.3)
// ============================================================================

/**
 * 一个 job = N 个 scene 逐镜走统一视频网关 → 全部完成后 stitch 成一条成片。
 * 只执行 ai-gen store 的任务(独立 store,零交叉污染);串行跑 job,
 * job 内 scene 先全量提交(拿上游任务号即持久化为恢复锚点,防双扣费),
 * 再统一轮询;失败镜留待显式重试(retryTask 只复位失败镜,成功镜不重生成)。
 */
function useAiGenTaskExecutor() {
  const { toast } = useToast();
  const aiGenTasks = useAiGenStore((state) => state.tasks);
  const updateTask = useAiGenStore((state) => state.updateTask);
  const updateScene = useAiGenStore((state) => state.updateScene);

  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());
  const [rescanTick, forceRescan] = useReducer((x: number) => x + 1, 0);

  const executeAiGenTask = useCallback(async (taskId: string) => {
    const getTask = (): AiGenTask | undefined =>
      useAiGenStore.getState().tasks.find(t => t.id === taskId);
    const task = getTask();
    if (!task || task.status !== "pending") return;

    const { modelType, aspectRatio, durationSeconds, quality, groupName } = task;
    const totalScenes = task.scenes.length;

    try {
      updateTask(taskId, { status: "generating", progress: 3 });

      // ---------- 阶段一:逐镜提交(带锚点的 scene 只续轮询,绝不重提交) ----------
      for (const scene of task.scenes) {
        // 每镜取最新快照:重试/复水后的状态以 store 为准,不吃循环外的旧闭包。
        // 任务已从 store 消失(MAX_TASKS 裁剪/删除)必须立即中止——继续提交会
        // 扣费但锚点无处持久化、无人轮询,纯白扣钱(复审确认项)
        const snap = getTask();
        if (!snap) return;
        const fresh = snap.scenes.find(s => s.idx === scene.idx);
        if (!fresh) continue;
        if (fresh.status === "completed" || fresh.status === "failed") continue;
        if (fresh.upstreamTaskId) {
          // 复水恢复/超时重试:锚点在手说明上游已受理已扣费——置回 generating
          // 进入阶段二续轮询(否则轮询过滤器认不出 pending 态,缺片直进 stitch)
          if (fresh.status !== "generating") {
            updateScene(taskId, fresh.idx, { status: "generating" });
          }
          continue;
        }

        try {
          const submitRes = await fetch("/api/video-batch/models/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelType,
              prompt: fresh.prompt,
              aspectRatio,
              durationSeconds,
              quality,
              imageUrls: fresh.imageUrl ? [fresh.imageUrl] : [],
              mode: fresh.imageUrl ? "image_to_video" : "prompt_to_video",
              clientTaskId: fresh.clientTaskId,
              groupName,
            }),
            signal: AbortSignal.timeout(120_000),
          });
          const submitText = await submitRes.text();
          let submitData;
          try {
            submitData = JSON.parse(submitText);
          } catch {
            submitData = null;
          }

          if (submitRes.ok && submitData?.success && submitData.data?.taskId) {
            // 上游任务号拿到即持久化:刷新后按锚点续轮询,绝不重提交(防双扣费)
            updateScene(taskId, fresh.idx, {
              status: "generating",
              upstreamTaskId: submitData.data.taskId,
            });
            window.dispatchEvent(new CustomEvent("credits-updated"));
          } else {
            const message: string = submitData?.error || `提交失败 (HTTP ${submitRes.status})`;
            updateScene(taskId, fresh.idx, { status: "failed", errorMessage: message });
            // 积分不足时后续镜必然同败,直接止损;但带锚点的 pending 镜
            // (重试场景:已提交已扣费)不能误标「未提交」——置回 generating
            // 交阶段二续轮询取回成片
            if (/积分|credits|insufficient/i.test(message)) {
              getTask()?.scenes.forEach(s => {
                if (s.status !== "pending") return;
                if (s.upstreamTaskId) {
                  updateScene(taskId, s.idx, { status: "generating" });
                } else {
                  updateScene(taskId, s.idx, { status: "failed", errorMessage: "积分不足,未提交" });
                }
              });
              break;
            }
          }
        } catch (submitError) {
          // 提交网络错误/超时只失败该镜,不落进外层 catch 误标「拼接超时」;
          // 服务端可能已受理并扣费(无锚点无从对账),提示用户核对生成记录
          console.error("[AiGenTaskExecutor] scene submit error:", submitError);
          updateScene(taskId, fresh.idx, {
            status: "failed",
            errorMessage: "提交超时或网络错误(若已扣费,该镜片段会出现在生成记录)",
          });
        }
      }

      // ---------- 阶段二:统一轮询直到全部终态 ----------
      const isSeedance = modelType === "seedance";
      const isHappyHorse = modelType === "happyhorse";
      const pollInterval = isSeedance ? 5000 : isHappyHorse ? 7500 : 10000;
      const maxAttempts = isHappyHorse
        ? (durationSeconds === 12 ? 144 : 80)
        : isSeedance
          ? 60
          : modelType === "sora2-pro"
            ? 140
            : 90;

      for (let i = 0; i < maxAttempts; i++) {
        const snapshot = getTask();
        if (!snapshot) return;
        const active = snapshot.scenes.filter(
          s => s.status === "generating" && s.upstreamTaskId
        );
        if (active.length === 0) break;

        await new Promise(r => setTimeout(r, pollInterval));

        for (const scene of active) {
          try {
            const statusRes = await fetch(
              `/api/video-batch/models/status?modelType=${encodeURIComponent(modelType)}&taskId=${encodeURIComponent(scene.upstreamTaskId!)}&aspectRatio=${encodeURIComponent(aspectRatio)}&durationSeconds=${durationSeconds}&quality=${encodeURIComponent(quality)}`
            );
            const statusText = await statusRes.text();
            let statusData;
            try {
              statusData = JSON.parse(statusText);
            } catch {
              continue;
            }
            if (statusData.success && statusData.data) {
              if (statusData.data.status === "completed" && statusData.data.videoUrl) {
                updateScene(taskId, scene.idx, {
                  status: "completed",
                  videoUrl: statusData.data.videoUrl,
                });
              } else if (statusData.data.status === "failed") {
                // 服务端已幂等退款;清锚点=重试时重提交(重新扣费,与退款对账)。
                // 超时失败(下方 sweep)保留锚点=重试只续轮询,防上游实际已成的双扣费
                updateScene(taskId, scene.idx, {
                  status: "failed",
                  errorMessage: statusData.data.errorMessage || "该镜生成失败",
                  upstreamTaskId: null,
                });
              }
            }
          } catch {
            // 单次查询失败不致命,下一轮继续
          }
        }

        const done = getTask()?.scenes.filter(s => s.status === "completed").length ?? 0;
        updateTask(taskId, { progress: Math.min(5 + Math.round((done / totalScenes) * 75), 80) });
      }

      // 轮询预算耗尽仍在途的镜 → 超时失败
      getTask()?.scenes.forEach(s => {
        if (s.status === "generating") {
          updateScene(taskId, s.idx, { status: "failed", errorMessage: "该镜生成超时" });
        }
      });

      const finalSnapshot = getTask();
      if (!finalSnapshot) return;
      // 防缺片直进 stitch:任何非 completed / 无成片 URL 的镜都算未完成
      const incomplete = finalSnapshot.scenes.filter(
        s => s.status !== "completed" || !s.videoUrl
      );
      if (incomplete.length > 0) {
        const firstError = incomplete.find(s => s.errorMessage)?.errorMessage ?? "";
        updateTask(taskId, {
          status: "failed",
          errorMessage: `${incomplete.length}/${totalScenes} 镜未完成:${firstError}(重试只补未完成镜)`,
        });
        return;
      }

      // ---------- 阶段三:stitch 拼接落库 ----------
      updateTask(taskId, { status: "stitching", progress: 85 });
      const orderedUrls = [...finalSnapshot.scenes]
        .sort((a, b) => a.idx - b.idx)
        .map(s => s.videoUrl!)
        .filter(Boolean);
      const stitchRes = await fetch("/api/studio/ai-gen/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: taskId,
          videoUrls: orderedUrls,
          aspectRatio,
          batchId: finalSnapshot.batchId,
          blueprintId: finalSnapshot.blueprintId,
          title: finalSnapshot.title,
          modelType,
          groupName: finalSnapshot.groupName,
          sceneTaskIds: finalSnapshot.scenes.map(s => s.upstreamTaskId ?? s.clientTaskId),
        }),
        // 略大于服务端 maxDuration=300s(挂起请求会饿死串行队列,同 S1.2)
        signal: AbortSignal.timeout(330_000),
      });
      const stitchText = await stitchRes.text();
      let stitchData;
      try {
        stitchData = JSON.parse(stitchText);
      } catch {
        throw new Error(`拼接服务响应格式错误 (HTTP ${stitchRes.status})`);
      }
      if (!stitchRes.ok || !stitchData.success || !stitchData.data?.videoUrl) {
        throw new Error(stitchData.error || `拼接失败 (HTTP ${stitchRes.status})`);
      }

      updateTask(taskId, {
        status: "completed",
        progress: 100,
        stitchedUrl: stitchData.data.videoUrl,
      });
      toast({
        title: "🎬 AI 生成成片完成",
        description: (
          <a href="/studio" className="text-tiktok-cyan hover:underline flex items-center gap-1">
            逐镜生成 + 拼接完成,点击查看 <ExternalLink className="h-3 w-3" />
          </a>
        ),
      });
    } catch (error) {
      console.error("[AiGenTaskExecutor] Error:", error);
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      updateTask(taskId, {
        status: "failed",
        errorMessage: isTimeout
          ? "拼接超时,请重试(各镜成片已保留,重试不重新生成)"
          : error instanceof Error
            ? error.message
            : "AI 生成成片失败",
      });
    }
  }, [updateTask, updateScene, toast]);

  useEffect(() => {
    if (isExecutingRef.current) return;

    const isRunnable = (t: AiGenTask) =>
      t.status === "pending" && !executedTasksRef.current.has(t.id);

    if (!aiGenTasks.some(isRunnable)) return;

    const executeNext = async () => {
      isExecutingRef.current = true;
      try {
        const runLoop = async () => {
          for (;;) {
            const next = useAiGenStore.getState().tasks.find(isRunnable);
            if (!next) break;
            executedTasksRef.current.add(next.id);
            await executeAiGenTask(next.id);
          }
        };

        // 跨标签页单飞:persist 的 pending 任务会被每个标签各自水合,
        // 无锁时两个标签会对同一 job 双重提交+双重扣费
        if (typeof navigator !== "undefined" && navigator.locks) {
          await navigator.locks.request("stargaze-aigen-executor", async () => {
            // 水合是 storage 整表覆盖(last-writer-wins):等锁期间本页新提交的
            // job 可能已被他页进度写从 storage 冲掉,须按 id 差集补回(复审确认项)
            const memoryTasks = useAiGenStore.getState().tasks;
            await useAiGenStore.persist.rehydrate();
            const storedIds = new Set(useAiGenStore.getState().tasks.map(t => t.id));
            const missing = memoryTasks.filter(t => !storedIds.has(t.id));
            if (missing.length > 0) useAiGenStore.getState().addTasks(missing);
            await runLoop();
          });
        } else {
          await runLoop();
        }
      } finally {
        isExecutingRef.current = false;
      }
      forceRescan();
    };

    executeNext();
  }, [aiGenTasks, executeAiGenTask, rescanTick]);

  // failed 任务从去重集合放行:retryTask(failed→pending)要能被重新拉起
  useEffect(() => {
    const liveIds = new Set(
      aiGenTasks.filter(t => t.status !== "failed").map(t => t.id)
    );
    for (const id of Array.from(executedTasksRef.current)) {
      if (!liveIds.has(id)) executedTasksRef.current.delete(id);
    }
  }, [aiGenTasks]);
}

// ============================================================================
// 任务状态指示器组件 - 右下角悬浮通知
// ============================================================================

function TaskStatusIndicator() {
  const router = useRouter();
  const videoTasks = useVideoBatchStore((state) => state.tasks);
  const videoJobStatus = useVideoBatchStore((state) => state.jobStatus);
  const imageTasks = useImageBatchStore((state) => state.tasks);
  const imageJobStatus = useImageBatchStore((state) => state.jobStatus);
  // S0.6：从多任务队列统计运行中的 Quick Gen 任务（而非单槽镜像）
  const quickGenVideoTasks = useQuickGenStore((state) => state.videoTasks);
  const quickGenImageTasks = useQuickGenStore((state) => state.imageTasks);

  const runningVideoTasks = videoTasks.filter(
    t => t.status !== "pending" && t.status !== "success" && t.status !== "failed"
  ).length;

  const runningImageTasks = imageTasks.filter(t => t.status === "processing").length;

  const runningQuickGenVideos = quickGenVideoTasks.filter(t => !["completed", "failed", "idle"].includes(t.status));
  const runningQuickGenImages = quickGenImageTasks.filter(t => !["completed", "failed", "idle"].includes(t.status));

  const isQuickGenRunning = runningQuickGenVideos.length > 0;
  const isQuickGenImageRunning = runningQuickGenImages.length > 0;

  // 进度条展示最新一个运行中的任务
  const quickGenTask = runningQuickGenVideos[runningQuickGenVideos.length - 1];
  const quickGenImageTask = runningQuickGenImages[runningQuickGenImages.length - 1];

  const hasRunningTasks = videoJobStatus === "running" || imageJobStatus === "running" ||
    runningVideoTasks > 0 || runningImageTasks > 0 || isQuickGenRunning || isQuickGenImageRunning;

  if (!hasRunningTasks) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 animate-in slide-in-from-right-5 fade-in duration-300">
      {/* 单图生成 */}
      {isQuickGenImageRunning && (
        <div
          onClick={() => router.push("/quick-gen")}
          className="flex items-center gap-3 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 backdrop-blur-xl border border-violet-500/30 rounded-xl px-4 py-3 shadow-xl shadow-violet-500/10 hover:scale-[1.02] transition-transform cursor-pointer group"
        >
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-violet-500/20">
            <Palette className="h-5 w-5 text-violet-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-violet-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-violet-400 rounded-full" />
          </div>
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium text-violet-100">
              单图生成中{runningQuickGenImages.length > 1 ? ` · ${runningQuickGenImages.length} 个任务` : ""}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-24 h-1.5 bg-violet-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400 rounded-full transition-all duration-500"
                  style={{ width: `${quickGenImageTask?.progress || 0}%` }}
                />
              </div>
              <span className="text-xs text-violet-400/80">{quickGenImageTask?.progress || 0}%</span>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-violet-400/50 group-hover:text-violet-400 transition-colors" />
        </div>
      )}

      {/* 快速视频生成 */}
      {isQuickGenRunning && (
        <div
          onClick={() => router.push("/quick-gen")}
          className="flex items-center gap-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 backdrop-blur-xl border border-amber-500/30 rounded-xl px-4 py-3 shadow-xl shadow-amber-500/10 hover:scale-[1.02] transition-transform cursor-pointer group"
        >
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/20">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-amber-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-amber-400 rounded-full" />
          </div>
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium text-amber-100">
              快速视频生成中{runningQuickGenVideos.length > 1 ? ` · ${runningQuickGenVideos.length} 个任务` : ""}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-24 h-1.5 bg-amber-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-500"
                  style={{ width: `${quickGenTask?.progress || 0}%` }}
                />
              </div>
              <span className="text-xs text-amber-400/80">{quickGenTask?.progress || 0}%</span>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-amber-400/50 group-hover:text-amber-400 transition-colors" />
        </div>
      )}

      {/* 批量视频生成 */}
      {(videoJobStatus === "running" || runningVideoTasks > 0) && (
        <div
          onClick={() => router.push("/pro-studio/video-batch")}
          className="flex items-center gap-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 backdrop-blur-xl border border-cyan-500/30 rounded-xl px-4 py-3 shadow-xl shadow-cyan-500/10 hover:scale-[1.02] transition-transform cursor-pointer group"
        >
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/20">
            <Video className="h-5 w-5 text-cyan-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-cyan-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-cyan-400 rounded-full" />
          </div>
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium text-cyan-100">批量视频生成中</span>
            <span className="text-xs text-cyan-400/80 mt-0.5">
              {runningVideoTasks > 0 ? runningVideoTasks : videoTasks.filter(t => t.status === "pending").length} 个任务处理中
            </span>
          </div>
          <ExternalLink className="h-4 w-4 text-cyan-400/50 group-hover:text-cyan-400 transition-colors" />
        </div>
      )}

      {/* 批量图片处理 */}
      {(imageJobStatus === "running" || runningImageTasks > 0) && (
        <div
          onClick={() => router.push("/pro-studio/image-batch")}
          className="flex items-center gap-3 bg-gradient-to-r from-pink-500/10 to-purple-500/10 backdrop-blur-xl border border-pink-500/30 rounded-xl px-4 py-3 shadow-xl shadow-pink-500/10 hover:scale-[1.02] transition-transform cursor-pointer group"
        >
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-pink-500/20">
            <ImageIcon className="h-5 w-5 text-pink-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-pink-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-pink-400 rounded-full" />
          </div>
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium text-pink-100">批量图片处理中</span>
            <span className="text-xs text-pink-400/80 mt-0.5">
              {runningImageTasks} 个任务处理中
            </span>
          </div>
          <ExternalLink className="h-4 w-4 text-pink-400/50 group-hover:text-pink-400 transition-colors" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export function BackgroundTaskManager() {
  // 启动视频批量任务执行器
  useVideoTaskExecutor();

  // 启动图片批量任务执行器
  useImageTaskExecutor();

  // 启动 Quick Gen 视频任务执行器
  useQuickGenTaskExecutor();

  // 启动 Quick Gen 图片任务执行器
  useQuickGenImageTaskExecutor();

  // 启动 Studio 幻灯片渲染执行器(S1.2)
  useSlideshowTaskExecutor();

  // 启动 Studio AI 生成腿执行器(S2.3)
  useAiGenTaskExecutor();

  return <TaskStatusIndicator />;
}
