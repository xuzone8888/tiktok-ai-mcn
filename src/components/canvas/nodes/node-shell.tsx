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

import { GenerationDeleteChoices } from "./generation-delete-choices";

/**
 * 在途任务的「仅移除」描述(CHECKLIST #251)。给出它 = 删除按钮**可点**,
 * 但弹窗改成三选一;与 `deleteDisabledReason`(彻底禁用)互斥,由调用方按
 * `generationDeleteDisposition` 的分类二选一传入。
 */
export interface NodeDeleteDetach {
  /** 当前状态一句话(例:任务生成中…)。 */
  reason: string;
  /** 「仅移除」的后果说明。 */
  explainer: string;
  /** 非 null = 网关不支持撤单,「取消并退款」禁用并明示。 */
  cancelUnsupportedReason: string | null;
}

interface NodeShellProps {
  nodeId: string;
  label: string;
  Icon: LucideIcon;
  selected?: boolean;
  children?: ReactNode;
  wide?: boolean;
  deleteDisabledReason?: string | null;
  deleteDetach?: NodeDeleteDetach | null;
}

export function NodeShell({
  nodeId,
  label,
  Icon,
  selected,
  children,
  wide = false,
  deleteDisabledReason = null,
  deleteDetach = null,
}: NodeShellProps) {
  const readOnly = useCanvasReadOnly();
  const removeNode = useCanvasStore((state) => state.removeNode);

  return (
    <div
      className={cn(
        wide ? "w-[304px]" : "w-[208px]",
        "rounded-lg border bg-card/95 text-card-foreground shadow-sm backdrop-blur transition-colors",
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
              title={deleteDisabledReason ?? deleteDetach?.reason ?? undefined}
              disabled={readOnly || Boolean(deleteDisabledReason)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="nodrag">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteDetach ? "任务生成中，如何处理该节点？" : "删除该节点?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteDetach
                  ? `${deleteDetach.reason}。${deleteDetach.explainer}`
                  : deleteDisabledReason
                    ? deleteDisabledReason
                    : "将同时移除该节点及相关连线，确认继续？"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteDetach ? (
              <GenerationDeleteChoices
                cancelUnsupportedReason={deleteDetach.cancelUnsupportedReason}
                detachLabel="仅移除节点"
                onDetach={() => removeNode(nodeId)}
              />
            ) : (
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={readOnly || Boolean(deleteDisabledReason)}
                  onClick={() => removeNode(nodeId)}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            )}
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
