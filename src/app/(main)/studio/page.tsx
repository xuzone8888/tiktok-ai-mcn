"use client";

/**
 * /studio - Studio 统一创作工作台(S1)
 *
 * 形态(STUDIO_REDESIGN_PLAN §三):Omnibox 壳 + 任务队列芯。
 * 主区 = 垂直批次流(Batch 卡 + Job 网格),底部 = 悬浮 omnibox,
 * 右栏 = Job 详情抽屉。任务执行全部由 BTM 承担,本页不发轮询。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ImagePlus, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStudioStore, type StudioBatch } from "@/stores/studio-store";
import { buildBatchJobViews, useHostTaskMaps, type StudioJobView } from "@/lib/studio/batch-view";
import { Omnibox, type StudioAttachment } from "@/components/studio-shell/omnibox";
import { BatchCard } from "@/components/studio-shell/batch-card";
import { JobDrawer } from "@/components/studio-shell/job-drawer";
import {
  useStudioSubmit,
  type StudioDraft,
} from "@/components/studio-shell/use-studio-submit";

let attachmentSeq = 0;
const nextAttachmentId = () => `att-${Date.now()}-${attachmentSeq++}`;

export default function StudioPage() {
  const { toast } = useToast();
  const batches = useStudioStore((state) => state.batches);
  const activeJob = useStudioStore((state) => state.activeJob);
  const setActiveJob = useStudioStore((state) => state.setActiveJob);
  const removeBatch = useStudioStore((state) => state.removeBatch);
  const { submit, retryJob, markLibrary } = useStudioSubmit();

  // ==================== 积分余额 ====================
  const [credits, setCredits] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch("/api/user/credits", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && typeof data.credits === "number") setCredits(data.credits);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("credits-updated", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.removeEventListener("credits-updated", refresh);
      clearInterval(timer);
    };
  }, []);

  // ==================== 附件上传 ====================
  const [attachments, setAttachments] = useState<StudioAttachment[]>([]);

  // 卸载时回收 blob 预览 URL(removeAttachment 只覆盖单删路径)
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      attachmentsRef.current.forEach((a) => {
        if (a.previewUrl.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl);
      });
    },
    []
  );

  const uploadFile = useCallback(
    async (id: string, file: File) => {
      const markFailed = () => {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "failed" as const } : a))
        );
        toast({ title: "素材上传失败", description: file.name, variant: "destructive" });
      };
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/image", { method: "POST", body: formData });
        const data = await res.json();
        const url: string | undefined = data?.data?.url;
        if (url) {
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "done" as const, url } : a))
          );
        } else {
          markFailed();
        }
      } catch {
        markFailed();
      }
    },
    [toast]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter((f) => f.type.startsWith("image/"));
      if (accepted.length === 0) return;
      const items = accepted.map((file) => ({
        id: nextAttachmentId(),
        previewUrl: URL.createObjectURL(file),
        status: "uploading" as const,
        name: file.name,
        file,
      }));
      setAttachments((prev) => [...prev, ...items]);
      items.forEach((item) => void uploadFile(item.id, item.file));
    },
    [uploadFile]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const addReferenceUrl = useCallback((url: string) => {
    setAttachments((prev) => [
      ...prev,
      { id: nextAttachmentId(), previewUrl: url, status: "done", url },
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"] },
    noClick: true,
    noKeyboard: true,
  });

  // ==================== 提交 / 重试 / 入库 ====================
  const handleSubmit = useCallback(
    (draft: StudioDraft): boolean => {
      const result = submit(draft);
      if (!result.ok) {
        toast({ title: "提交失败", description: result.error, variant: "destructive" });
        return false;
      }
      // 清空前回收 blob 预览 URL(提交携带的是 OSS URL,回收安全)
      setAttachments((prev) => {
        prev.forEach((a) => {
          if (a.previewUrl.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl);
        });
        return [];
      });
      return true;
    },
    [submit, toast]
  );

  const handleRetryFailed = useCallback(
    (batch: StudioBatch, failedViews: StudioJobView[]) => {
      let ok = 0;
      failedViews.forEach((view) => {
        if (retryJob(batch, view.taskId).ok) ok += 1;
      });
      toast({ title: `已重新排队 ${ok} 条任务` });
    },
    [retryJob, toast]
  );

  const handleRetryOne = useCallback(
    (batch: StudioBatch, view: StudioJobView) => {
      const result = retryJob(batch, view.taskId);
      if (result.ok) {
        setActiveJob(null);
        toast({ title: "已重新排队" });
      } else {
        toast({ title: "重试失败", description: result.error, variant: "destructive" });
      }
    },
    [retryJob, setActiveJob, toast]
  );

  const handleMarkLibrary = useCallback(
    async (batch: StudioBatch, views: StudioJobView[]) => {
      const result = await markLibrary(batch.id, views);
      if (result.ok) {
        toast({ title: "已入库", description: result.error });
      } else {
        toast({ title: "入库失败", description: result.error, variant: "destructive" });
      }
    },
    [markLibrary, toast]
  );

  // ==================== 宿主任务索引 + 抽屉数据 ====================
  const maps = useHostTaskMaps();
  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeJob?.batchId),
    [batches, activeJob]
  );
  const activeView = useMemo(() => {
    if (!activeBatch) return undefined;
    return buildBatchJobViews(activeBatch, maps).find((v) => v.taskId === activeJob?.taskId);
  }, [activeBatch, maps, activeJob]);

  return (
    <div
      {...getRootProps()}
      className="relative flex h-full overflow-hidden bg-zinc-950 text-zinc-100"
    >
      <input {...getInputProps()} />

      {/* 主区:批次流 + omnibox */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-48">
          {batches.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
              <Sparkles className="h-8 w-8" />
              <p className="text-sm">输入提示词或拖入图片,开始你的第一个批次</p>
              <p className="text-xs text-zinc-700">
                图片 / 视频任务在后台执行,切换页面不中断
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-4">
              {batches.map((batch) => (
                <BatchCard
                  key={batch.id}
                  batch={batch}
                  maps={maps}
                  activeTaskId={activeJob?.batchId === batch.id ? activeJob.taskId : undefined}
                  onJobClick={(view) =>
                    setActiveJob(
                      activeJob?.taskId === view.taskId
                        ? null
                        : { batchId: batch.id, taskId: view.taskId }
                    )
                  }
                  onRetryFailed={handleRetryFailed}
                  onMarkLibrary={handleMarkLibrary}
                  onRemove={removeBatch}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部悬浮 omnibox */}
        <div className="pointer-events-none absolute inset-x-0 bottom-6 px-6">
          <Omnibox
            attachments={attachments}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
            credits={credits}
            onSubmit={handleSubmit}
          />
        </div>
      </div>

      {/* 右栏抽屉 */}
      {activeBatch && activeView && (
        <JobDrawer
          batch={activeBatch}
          view={activeView}
          onClose={() => setActiveJob(null)}
          onRetry={handleRetryOne}
          onMarkLibrary={handleMarkLibrary}
          onUseAsReference={(url) => {
            addReferenceUrl(url);
            setActiveJob(null);
          }}
        />
      )}

      {/* 拖拽投放蒙层 */}
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-sky-400/60 bg-sky-500/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-sky-300">
            <ImagePlus className="h-10 w-10" />
            <p className="text-sm font-medium">松开以添加素材图</p>
          </div>
        </div>
      )}
    </div>
  );
}
