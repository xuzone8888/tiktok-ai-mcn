"use client";

/**
 * Job 单元格 - 批次卡内网格的最小单位(S1)
 */

import { AlertTriangle, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import type { StudioJobView } from "@/lib/studio/batch-view";

interface JobCellProps {
  view: StudioJobView;
  active?: boolean;
  onClick: () => void;
}

export function JobCell({ view, active, onClick }: JobCellProps) {
  const showVideo = view.status === "success" && view.resultType === "video" && view.resultUrl;
  const coverUrl = view.resultType === "image" ? (view.resultUrl ?? view.coverUrl) : view.coverUrl;
  const photoCount = view.resultType === "photo_post" ? (view.images?.length ?? 0) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative aspect-[3/4] w-full overflow-hidden rounded-xl border bg-black/40 text-left transition-all",
        active
          ? "border-sky-400/70 ring-1 ring-sky-400/40"
          : "border-white/10 hover:border-white/25"
      )}
    >
      {showVideo ? (
        <video
          src={view.resultUrl}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          className={cn(
            "h-full w-full object-cover",
            view.status === "running" && "opacity-70",
            view.status === "failed" && "opacity-40"
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600">
          {view.status === "failed" ? (
            <AlertTriangle className="h-6 w-6 text-red-400/70" />
          ) : (
            <ImageOff className="h-6 w-6" />
          )}
        </div>
      )}

      {/* 状态角标 */}
      <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
        <StatusBadge
          status={view.status}
          label={view.status === "running" ? view.statusLabel : undefined}
        />
        {view.libraryStatus === "ready" && <StatusBadge status="library" />}
      </div>

      {/* 图文帖:图数角标(S4.1) */}
      {photoCount > 0 && (
        <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          图文×{photoCount}
        </span>
      )}

      {/* 进行中进度条 */}
      {view.status === "running" && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
          <div
            className="h-full bg-sky-400 transition-all duration-500"
            style={{ width: `${Math.min(view.progress, 98)}%` }}
          />
        </div>
      )}

      {/* 失败信息 */}
      {view.status === "failed" && view.errorMessage && (
        <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 text-[10px] text-red-300">
          {view.errorMessage}
        </div>
      )}
    </button>
  );
}
