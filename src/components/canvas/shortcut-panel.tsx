"use client";

/**
 * 超级画布 · 常驻「?」快捷键面板(P0 · S1 出壳 / S4 补全权威表)
 *
 * 权威表=CHECKLIST A 组,**只列已生效键**(硬纪律)。分两段:视图段=S1 的 CANVAS_VIEW_SHORTCUTS
 * (Space 拖画布 / Ctrl+0 适应 / Alt+Shift+F 整理 / ?);命令段=S4 的 CANVAS_COMMAND_SHORTCUTS
 * (成组/解组/连接/复制/删除/撤销/重做/缩放 + 两条拖拽复制手势)。
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CANVAS_VIEW_SHORTCUTS } from "./canvas-shortcuts";
import { CANVAS_COMMAND_SHORTCUTS } from "./canvas-command-shortcuts";

interface ShortcutRow {
  id: string;
  keys: string;
  label: string;
}

function ShortcutList({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border">
        {rows.map((shortcut) => (
          <li
            key={shortcut.id}
            className="flex items-center justify-between gap-4 py-2 text-sm"
          >
            <span className="text-foreground">{shortcut.label}</span>
            <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
        <div className="max-h-[70vh] space-y-4 overflow-auto">
          <ShortcutList title="视图 · View" rows={CANVAS_VIEW_SHORTCUTS} />
          <ShortcutList title="操作 · Commands" rows={CANVAS_COMMAND_SHORTCUTS} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
