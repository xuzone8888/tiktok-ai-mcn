"use client";

/**
 * 超级画布 · 批量删除二次确认(P0 · S4)
 *
 * Delete 触发**一次**批量二确认(AlertDialog,非 window.confirm、非逐节点弹):汇总所选节点/连线数,
 * 确认后原子级联删除(store.removeEntities)。P0 无生成接入,故不出「running 生成三选一」——不伪造。
 * 受控 open(无 Trigger),内容带 nodrag 防拖穿。
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

export function CanvasBatchDeleteDialog({
  open,
  nodeCount,
  edgeCount,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  nodeCount: number;
  edgeCount: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const parts: string[] = [];
  if (nodeCount > 0) parts.push(`${nodeCount} 个节点`);
  if (edgeCount > 0) parts.push(`${edgeCount} 条连线`);
  const summary = parts.join(" 和 ") || "所选内容";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="nodrag">
        <AlertDialogHeader>
          <AlertDialogTitle>删除所选?</AlertDialogTitle>
          <AlertDialogDescription>
            将删除 {summary}(连带相关连线),此操作可撤销(Ctrl+Z)。确认继续?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
