"use client";

/**
 * 超级画布 · 内容节点通用外框(P0 · S3)
 *
 * 紧凑稳定尺寸(固定宽度)、左右 Handle(与 S2 空白连线语义一致:默认 null handle)、
 * 头部图标+标签、右上删除按钮(AlertDialog 二次确认 → store.removeNode,级联删边)。
 * 交互控件带 nodrag/nopan;只读时禁用删除。类型专属正文由 children 承担。
 */
import { type ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { Trash2, type LucideIcon } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { useCanvasReadOnly, useCanvasStore } from "@/stores/canvas-store";

interface NodeShellProps {
  nodeId: string;
  label: string;
  Icon: LucideIcon;
  selected?: boolean;
  children?: ReactNode;
}

export function NodeShell({ nodeId, label, Icon, selected, children }: NodeShellProps) {
  const readOnly = useCanvasReadOnly();
  const removeNode = useCanvasStore((state) => state.removeNode);

  return (
    <div
      className={cn(
        "w-[208px] rounded-lg border bg-card/95 text-card-foreground shadow-sm backdrop-blur transition-colors",
        selected ? "border-ring ring-1 ring-ring" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border !border-border !bg-muted"
      />
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="nodrag nopan rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              aria-label={`删除${label}节点`}
              disabled={readOnly}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="nodrag">
            <AlertDialogHeader>
              <AlertDialogTitle>删除该节点?</AlertDialogTitle>
              <AlertDialogDescription>
                将同时移除该节点及相关连线,确认继续?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => removeNode(nodeId)}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="px-2.5 py-2">{children}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border !border-border !bg-muted"
      />
    </div>
  );
}
