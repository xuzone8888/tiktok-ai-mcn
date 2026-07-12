"use client";

/**
 * 超级画布 · 常驻「?」快捷键面板(P0 · S1 出壳)
 *
 * 只列 S1 已生效的视图按键(CANVAS_VIEW_SHORTCUTS)。S4 落全套快捷键时,把内容源换成
 * CHECKLIST A 组权威表即可,面板结构不变——「只列已生效键」是硬纪律。
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CANVAS_VIEW_SHORTCUTS } from "./canvas-shortcuts";

export function ShortcutPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>P0 画布骨架 · 仅列已生效按键</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {CANVAS_VIEW_SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.id}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="text-foreground">{shortcut.label}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
