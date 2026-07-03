"use client";

/**
 * Batch 批次卡(S1)
 *
 * 卡头 = 提交回显(标题 + 参数 chips 快照)+ 进度统计「32/50 · 失败3」;
 * 卡体 = Job 网格(≤8 条直接展开,>8 条折叠预览可展开);
 * 卡底 = 批量重试失败 / 批量入库。
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, FileText, RotateCcw, Trash2, Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildBatchJobViews,
  computeBatchStats,
  type HostTaskMaps,
  type StudioJobView,
} from "@/lib/studio/batch-view";
import type { StudioBatch } from "@/stores/studio-store";
import { JobCell } from "./job-cell";

const COLLAPSED_LIMIT = 8;

interface BatchCardProps {
  batch: StudioBatch;
  /** 宿主任务索引(页面级 useHostTaskMaps 单次构建后下发) */
  maps: HostTaskMaps;
  activeTaskId?: string;
  onJobClick: (view: StudioJobView) => void;
  onRetryFailed: (batch: StudioBatch, views: StudioJobView[]) => void;
  onMarkLibrary: (batch: StudioBatch, views: StudioJobView[]) => Promise<void>;
  onRemove: (batchId: string) => void;
  /** 蓝图编辑入口(S2.2;batch.blueprintId 存在时显示) */
  onOpenBlueprint?: (batch: StudioBatch) => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
      {children}
    </span>
  );
}

export function BatchCard({
  batch,
  maps,
  activeTaskId,
  onJobClick,
  onRetryFailed,
  onMarkLibrary,
  onRemove,
  onOpenBlueprint,
}: BatchCardProps) {
  const views = useMemo(() => buildBatchJobViews(batch, maps), [batch, maps]);
  const stats = useMemo(() => computeBatchStats(views), [views]);
  const [expanded, setExpanded] = useState(false);
  const [marking, setMarking] = useState(false);

  const finished = stats.success + stats.failed;
  const failedViews = views.filter((v) => v.status === "failed");
  const librariable = views.filter(
    (v) => v.status === "success" && v.generationTaskId && v.libraryStatus !== "ready"
  );

  const visibleViews = expanded ? views : views.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = views.length - visibleViews.length;

  const createdLabel = useMemo(() => {
    const d = new Date(batch.createdAt);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${mm}.${dd} ${hh}:${mi}`;
  }, [batch.createdAt]);

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
      {/* 卡头 */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100" title={batch.title}>
            {batch.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip>
              {batch.summary.mode === "video"
                ? "视频"
                : batch.summary.mode === "image"
                  ? "图片"
                  : batch.summary.mode === "slideshow"
                    ? "幻灯片"
                    : batch.summary.mode === "product"
                      ? "商品成片"
                      : batch.summary.mode === "deconstruct"
                        ? "爆款拆解"
                        : batch.summary.mode === "structure_rerun"
                          ? "结构复刻"
                          : batch.summary.mode}
            </Chip>
            {batch.summary.modelLabel && <Chip>{batch.summary.modelLabel}</Chip>}
            {batch.summary.aspectRatio && <Chip>{batch.summary.aspectRatio === "auto" ? "自动比例" : batch.summary.aspectRatio}</Chip>}
            {batch.summary.durationSeconds && <Chip>{batch.summary.durationSeconds}s</Chip>}
            {batch.summary.resolution && <Chip>{batch.summary.resolution.toUpperCase()}</Chip>}
            {batch.summary.characterName && <Chip>@{batch.summary.characterName}</Chip>}
            {typeof batch.summary.estimatedCredits === "number" && (
              <Chip>≈{batch.summary.estimatedCredits} 积分</Chip>
            )}
            {batch.blueprintId && onOpenBlueprint && (
              <button
                type="button"
                onClick={() => onOpenBlueprint(batch)}
                className="flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                title={
                  batch.summary.mode === "deconstruct"
                    ? "打开结构报告:hook/台词/节奏,可用此结构出片"
                    : "打开蓝图:改卖点/台词,再出一批"
                }
              >
                <FileText className="h-3 w-3" />
                {batch.summary.mode === "deconstruct" ? "报告" : "蓝图"}
              </button>
            )}
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">
              <Clock className="h-3 w-3" />
              {createdLabel}
            </span>
          </div>
        </div>

        {/* 进度统计(数字优先,tabular-nums) */}
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tabular-nums text-zinc-100">
            {finished}
            <span className="text-zinc-500">/{stats.total}</span>
          </span>
          {stats.failed > 0 && (
            <span className="text-sm tabular-nums text-red-400">失败{stats.failed}</span>
          )}
          {stats.running > 0 && (
            <span className="flex items-center gap-1 text-sm tabular-nums text-sky-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
              {stats.running}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(batch.id)}
            title="移除批次记录(不删除任务与产出)"
            className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Job 网格 */}
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {visibleViews.map((view) => (
          <JobCell
            key={view.taskId}
            view={view}
            active={view.taskId === activeTaskId}
            onClick={() => onJobClick(view)}
          />
        ))}
      </div>

      {/* 卡底 */}
      {(hiddenCount > 0 || expanded || failedViews.length > 0 || librariable.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-2.5">
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-zinc-400"
              onClick={() => setExpanded(true)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              展开全部 {views.length} 条
            </Button>
          )}
          {expanded && views.length > COLLAPSED_LIMIT && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-zinc-400"
              onClick={() => setExpanded(false)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              收起
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {failedViews.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => onRetryFailed(batch, failedViews)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重试失败 {failedViews.length} 条
              </Button>
            )}
            {librariable.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={marking}
                className={cn("h-7 gap-1.5 px-2.5 text-xs text-amber-400 hover:text-amber-300")}
                onClick={async () => {
                  setMarking(true);
                  try {
                    await onMarkLibrary(batch, librariable);
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
                批量入库 {librariable.length} 条
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
