"use client";

/**
 * 超级画布 · 删除在途生成节点的三选一(CHECKLIST #251)
 *
 * 规格:「取消并退款 / 仅移除[任务继续产物进历史] / 返回;网关不支持取消则明示」。
 * 三个选项一律**渲染出来**——「取消并退款」在网关不支持撤单时以禁用态 + 明示原因呈现,
 * 而不是悄悄不画,否则用户无从知道这条路存在与否(P0 期 canvas-batch-delete-dialog 的注释
 * 「P0 无生成接入,故不出 running 生成三选一——不伪造」即指本组件的位置)。
 *
 * 节点级与批量删除两个入口共用本组件,保证两处文案与可用性判定不漂移。
 */
import {
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function GenerationDeleteChoices({
  cancelUnsupportedReason,
  detachLabel,
  onDetach,
}: {
  /** 非 null = 网关不支持撤单,「取消并退款」禁用并明示该原因。 */
  cancelUnsupportedReason: string | null;
  detachLabel: string;
  onDetach: () => void;
}) {
  const cancelDisabled = cancelUnsupportedReason !== null;
  return (
    <div className="flex flex-col gap-2">
      {cancelDisabled && (
        <p
          className="rounded border border-border/70 bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground"
          role="note"
        >
          {cancelUnsupportedReason}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cancelDisabled}
          title={cancelUnsupportedReason ?? undefined}
          aria-disabled={cancelDisabled}
        >
          取消并退款
        </Button>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={onDetach}
        >
          {detachLabel}
        </AlertDialogAction>
        <AlertDialogCancel>返回</AlertDialogCancel>
      </div>
    </div>
  );
}
