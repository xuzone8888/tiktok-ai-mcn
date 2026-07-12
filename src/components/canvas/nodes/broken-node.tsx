"use client";

/**
 * 超级画布 · 损坏节点占位卡(P0 · S3)
 *
 * 渲染 D2 loadCanvasDoc 隔离出的 brokenNodes(纯视图 __broken RF 节点):展示 rawType + issues,
 * 二次确认后可显式删除(store.removeBrokenNode,只读禁用)。**绝不**是领域 node——不可拖/连,
 * 不进持久化。删除是永久丢弃 raw,故用 destructive 二次确认。rawType 为不可信长文本,强制截断,
 * 任何字符串都不撑破固定 208px。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { AlertTriangle, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useCanvasReadOnly, useCanvasStore } from "@/stores/canvas-store";

interface BrokenNodeData {
  rawType?: unknown;
  issues?: unknown;
}

export const BrokenNode = memo(function BrokenNode({ id, data }: NodeProps) {
  const readOnly = useCanvasReadOnly();
  const removeBrokenNode = useCanvasStore((state) => state.removeBrokenNode);
  const brokenData = (data ?? {}) as BrokenNodeData;
  const rawType = brokenData.rawType == null ? "未知" : String(brokenData.rawType);
  const issues = Array.isArray(brokenData.issues)
    ? brokenData.issues.filter((issue): issue is string => typeof issue === "string")
    : [];

  return (
    <div className="w-[208px] overflow-hidden rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          损坏节点
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="nodrag nopan shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              aria-label="删除损坏节点"
              disabled={readOnly}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="nodrag">
            <AlertDialogHeader>
              <AlertDialogTitle>删除损坏节点?</AlertDialogTitle>
              <AlertDialogDescription>
                将永久丢弃该损坏节点及其原始数据,确认继续?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => removeBrokenNode(id)}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="mt-1 flex items-baseline gap-1 text-[11px] text-muted-foreground">
        <span className="shrink-0">原始类型:</span>
        <span className="min-w-0 flex-1 truncate font-mono" title={rawType}>
          {rawType}
        </span>
      </div>
      {issues.length > 0 && (
        <ul className="mt-1 max-h-16 space-y-0.5 overflow-auto text-[10px] leading-snug text-muted-foreground">
          {issues.slice(0, 4).map((issue, index) => (
            <li key={index} className="truncate" title={issue}>
              · {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
