"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, LockKeyhole, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkDocSize, formatBytes } from "@/lib/canvas/doc-limits";
import {
  createCanvasDocSizeController,
  type CanvasDocSizeController,
} from "@/lib/canvas/canvas-size-controller";
import type { CanvasDoc } from "@/lib/canvas/schema";
import type { WriterLockStatus } from "@/lib/canvas/writer-lock";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";

interface CanvasHealthBannersProps {
  persistent: boolean;
  writerStatus: WriterLockStatus | null;
}

export function writerBannerMessage(status: WriterLockStatus | null): string {
  switch (status?.reason) {
    case "held-by-other-tab":
      return "此画布已在另一个标签页编辑,当前标签页保持只读。";
    case "held-by-server":
      return "此画布正由另一个会话编辑,当前会话保持只读。";
    case "no-locks-api":
      return "浏览器不支持安全写者锁,为保护画布已切换为只读。";
    case "error":
      return "写者心跳异常,为保护画布已切换为只读。";
    case "stopped":
      return "写者会话已停止,当前画布只读。";
    default:
      return "正在确认画布编辑权限,确认前保持只读。";
  }
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs leading-5",
        tone === "info" && "border-border bg-muted/80 text-muted-foreground",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {children}
      </div>
    </div>
  );
}

export function CanvasHealthBanners({
  persistent,
  writerStatus,
}: CanvasHealthBannersProps) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const groups = useCanvasStore((state) => state.groups);
  const recoveryRequired = useCanvasStore((state) => state.recoveryRequired);
  const loadIssues = useCanvasStore((state) => state.loadIssues);
  const brokenEdges = useCanvasStore((state) => state.brokenEdges);
  const readOnly = useCanvasStore((state) => state.readOnly);
  const removeBrokenEdges = useCanvasStore((state) => state.removeBrokenEdges);

  const latestDocRef = useRef<CanvasDoc>({ nodes, edges, groups });
  latestDocRef.current = { nodes, edges, groups };
  const [size, setSize] = useState(() => checkDocSize(latestDocRef.current));
  const initialSizeRef = useRef(size);
  const sizeControllerRef = useRef<CanvasDocSizeController | null>(null);

  useEffect(() => {
    const controller = createCanvasDocSizeController({
      initial: latestDocRef.current,
      initialSize: initialSizeRef.current,
    });
    sizeControllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSize);
    return () => {
      unsubscribe();
      controller.dispose();
      if (sizeControllerRef.current === controller) sizeControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    sizeControllerRef.current?.update(latestDocRef.current);
  }, [nodes, edges, groups]);

  return (
    <div className="relative z-20 shrink-0" aria-live="polite" data-canvas-health-banners>
      {persistent && !writerStatus?.canWrite && (
        <Banner tone="warning" icon={<LockKeyhole className="h-3.5 w-3.5" />}>
          {writerBannerMessage(writerStatus)}
        </Banner>
      )}
      {recoveryRequired && (
        <Banner tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
          <span className="min-w-0 flex-1">
            {brokenEdges.length > 0
              ? `检测到 ${brokenEdges.length} 条损坏连线,修复前不会保存。`
              : "画布包含待恢复内容,修复前不会保存。"}
            {loadIssues.length > 0 ? ` 诊断 ${loadIssues.length} 项。` : ""}
          </span>
          {brokenEdges.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={removeBrokenEdges}
              disabled={readOnly}
              aria-label={`清除 ${brokenEdges.length} 条损坏连线`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              清除 {brokenEdges.length} 条损坏连线
            </Button>
          )}
        </Banner>
      )}
      {size.overWarnLimit && (
        <Banner
          tone={size.overHardLimit ? "danger" : "warning"}
          icon={
            size.overHardLimit ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Info className="h-3.5 w-3.5" />
            )
          }
        >
          {size.overHardLimit
            ? `画布文档 ${formatBytes(size.bytes)} 已超过 2MB,保存预检将拒绝。`
            : `画布偏大 (${formatBytes(size.bytes)}),建议拆分;当前仍可编辑。`}
        </Banner>
      )}
    </div>
  );
}
