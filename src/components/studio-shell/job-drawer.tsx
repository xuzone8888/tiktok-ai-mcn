"use client";

/**
 * Job 详情抽屉 - 右栏 360px(S1)
 * 大预览 / 参数 / 单条重试 / 入库 / 下载 / 以此为参考(推回 omnibox)
 */

import { useState } from "react";
import {
  Archive,
  Download,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import type { StudioJobView } from "@/lib/studio/batch-view";
import type { StudioBatch } from "@/stores/studio-store";

interface JobDrawerProps {
  batch: StudioBatch;
  view: StudioJobView;
  onClose: () => void;
  onRetry: (batch: StudioBatch, view: StudioJobView) => void;
  onMarkLibrary: (batch: StudioBatch, views: StudioJobView[]) => Promise<void>;
  onUseAsReference: (url: string) => void;
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-14 shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 break-words text-zinc-300">{value}</span>
    </div>
  );
}

export function JobDrawer({
  batch,
  view,
  onClose,
  onRetry,
  onMarkLibrary,
  onUseAsReference,
}: JobDrawerProps) {
  const [marking, setMarking] = useState(false);
  const canLibrary =
    view.status === "success" && !!view.generationTaskId && view.libraryStatus !== "ready";
  const referenceUrl = view.resultType === "image" ? view.resultUrl : view.coverUrl;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusBadge
            status={view.status}
            label={view.status === "running" ? view.statusLabel : undefined}
          />
          {view.libraryStatus === "ready" && <StatusBadge status="library" />}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 预览 */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/50">
            {view.status === "success" && view.resultUrl ? (
              view.resultType === "video" ? (
                <video src={view.resultUrl} controls playsInline className="w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.resultUrl} alt="" className="w-full" />
              )
            ) : view.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.coverUrl} alt="" className="w-full opacity-70" />
            ) : (
              <div className="flex aspect-[3/4] items-center justify-center text-xs text-zinc-600">
                {view.status === "failed"
                  ? "任务失败,无产出"
                  : view.status === "missing"
                    ? "任务记录已被清理,无预览"
                    : "生成中…"}
              </div>
            )}
          </div>

          {view.status === "failed" && view.errorMessage && (
            <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {view.errorMessage}
            </p>
          )}

          {/* 参数 */}
          <div className="mt-4 space-y-2">
            <Row label="批次" value={batch.title} />
            <Row label="提示词" value={view.prompt} />
            <Row label="模型" value={batch.summary.modelLabel} />
            <Row
              label="规格"
              value={[
                batch.summary.aspectRatio,
                batch.summary.durationSeconds ? `${batch.summary.durationSeconds}s` : null,
                batch.summary.resolution?.toUpperCase(),
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <Row label="任务 ID" value={view.taskId} />
            {view.generationTaskId && <Row label="生成 ID" value={view.generationTaskId} />}
          </div>
        </div>
      </div>

      {/* 动作区 */}
      <div className="space-y-2 border-t border-white/5 p-4">
        {view.status === "failed" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => onRetry(batch, view)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重试该任务
          </Button>
        )}
        {canLibrary && (
          <Button
            variant="outline"
            size="sm"
            disabled={marking}
            className="w-full gap-1.5 text-amber-400 hover:text-amber-300"
            onClick={async () => {
              setMarking(true);
              try {
                await onMarkLibrary(batch, [view]);
              } finally {
                setMarking(false);
              }
            }}
          >
            {marking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            入库
          </Button>
        )}
        {view.status === "success" && view.resultUrl && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => window.open(view.resultUrl, "_blank")}
          >
            <Download className="h-3.5 w-3.5" />
            打开 / 下载
          </Button>
        )}
        {referenceUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-zinc-400"
            onClick={() => onUseAsReference(referenceUrl)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            以此为参考(推回输入框)
          </Button>
        )}
      </div>
    </aside>
  );
}
