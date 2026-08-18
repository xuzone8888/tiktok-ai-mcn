"use client";

/**
 * 超级画布 · 批量删除二次确认(P0 · S4;P1 补 #251 三选一)
 *
 * Delete 触发**一次**批量二确认(AlertDialog,非 window.confirm、非逐节点弹):汇总所选节点/连线数,
 * 确认后原子级联删除(store.removeEntities)。受控 open(无 Trigger),内容带 nodrag 防拖穿。
 *
 * P0 期这里写过「无生成接入,故不出 running 生成三选一——不伪造」;P1 生成接入后由本次补齐:
 * 所选含 running 节点时改走 `GenerationDeleteChoices`(取消并退款[明示不可用]/仅移除/返回),
 * 与节点级删除按钮共用同一组件与文案。
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { GenerationDeleteChoices } from "./nodes/generation-delete-choices";

export function CanvasBatchDeleteDialog({
  open,
  nodeCount,
  edgeCount,
  detachCount = 0,
  detachCancelUnsupportedReason = null,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  nodeCount: number;
  edgeCount: number;
  /** 所选中处于 running、只能「仅移除」的节点数;>0 时改走三选一。 */
  detachCount?: number;
  detachCancelUnsupportedReason?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const parts: string[] = [];
  if (nodeCount > 0) parts.push(`${nodeCount} 个节点`);
  if (edgeCount > 0) parts.push(`${edgeCount} 条连线`);
  const summary = parts.join(" 和 ") || "所选内容";
  const detaching = detachCount > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="nodrag">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {detaching ? "所选中有任务正在生成，如何处理？" : "删除所选?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {detaching
              ? `将删除 ${summary}(连带相关连线),其中 ${detachCount} 个节点的任务仍在生成中。仅把它们从画布移除，任务会继续跑完，产物照常进入「历史资产」，本次积分按已提交的任务照常结算。`
              : `将删除 ${summary}(连带相关连线),此操作可撤销(Ctrl+Z)。确认继续?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {detaching ? (
          <GenerationDeleteChoices
            cancelUnsupportedReason={detachCancelUnsupportedReason}
            detachLabel="仅移除所选"
            onDetach={onConfirm}
          />
        ) : (
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirm}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
