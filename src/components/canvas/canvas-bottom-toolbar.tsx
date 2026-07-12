"use client";

/**
 * 超级画布 · 底部工具栏(P0 · S5)
 *
 * 看板 7 入口(添加节点/工作流/素材库/角色库/历史记录/快捷键/教程),lucide 图标 + tooltip、
 * 稳定尺寸。P0 只点亮「添加节点」(下拉复用 S2 的 6 类列表 NODE_TYPE_ITEMS,不复制类型定义)与
 * 「快捷键」(开现有 ShortcutPanel);其余未来入口 disabled——tooltip 仅名称,不写开发状态/操作说明。
 *
 * 无障碍:disabled 的 Button 不接 pointer/focus,Radix tooltip 不可达;故 disabled 时用可 hover/
 * focus 的 span 包裹(tabIndex+role+aria-disabled),保证 tooltip 可达且键盘可聚焦;启用按钮保持原语义。
 */
import { type ReactNode } from "react";
import { Panel } from "@xyflow/react";
import {
  GraduationCap,
  History,
  Keyboard,
  Library,
  Plus,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CanvasNodeType } from "@/lib/canvas/schema";

import {
  BOTTOM_TOOLBAR_ENTRIES,
  type BottomToolbarAction,
} from "./canvas-chrome-policy";
import { NODE_TYPE_ITEMS } from "./node-type-meta";

const ICONS: Record<BottomToolbarAction, LucideIcon> = {
  "add-node": Plus,
  workflow: Workflow,
  assets: Library,
  characters: Users,
  history: History,
  shortcuts: Keyboard,
  tutorial: GraduationCap,
};

/** tooltip 包裹的图标按钮;disabled 时用可聚焦 span 包裹(tooltip 可达 + 无障碍)。 */
function ToolbarIconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      // 启用:按钮承载 aria-label 且可聚焦。禁用:名称/焦点交给外层 span,按钮 aria-hidden 且移出
      // tab 序 —— 避免「span[role=button] 内嵌 button」的嵌套交互语义。
      aria-label={disabled ? undefined : label}
      aria-hidden={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span
            tabIndex={0}
            aria-label={label}
            aria-disabled="true"
            className="inline-flex cursor-not-allowed"
          >
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CanvasBottomToolbar({
  onCreate,
  onOpenShortcuts,
  disabled = false,
}: {
  onCreate: (type: CanvasNodeType) => void;
  onOpenShortcuts: () => void;
  disabled?: boolean;
}) {
  return (
    <Panel position="bottom-center" className="!mb-2">
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur">
          {BOTTOM_TOOLBAR_ENTRIES.map((entry) => {
            const Icon = ICONS[entry.id];

            if (entry.id === "add-node") {
              // 只读时禁用建节点(纯 disabled 图标,span 包裹保 tooltip);启用时下拉 6 类。
              if (disabled) {
                return (
                  <ToolbarIconButton key={entry.id} label={entry.label} disabled>
                    <Icon className="h-4 w-4" />
                  </ToolbarIconButton>
                );
              }
              return (
                <DropdownMenu key={entry.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={entry.label}
                        >
                          <Icon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">{entry.label}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent side="top" align="center" className="min-w-[136px]">
                    {NODE_TYPE_ITEMS.map(({ type, label, Icon: TypeIcon }) => (
                      <DropdownMenuItem
                        key={type}
                        className="gap-2"
                        onSelect={() => onCreate(type)}
                      >
                        <TypeIcon className="h-4 w-4" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            // 快捷键=纯视图动作(只读仍可用);未来入口=disabled(仅名称 tooltip)。
            const entryDisabled =
              (entry.id === "shortcuts" ? false : disabled) || !entry.enabled;
            return (
              <ToolbarIconButton
                key={entry.id}
                label={entry.label}
                disabled={entryDisabled}
                onClick={entry.id === "shortcuts" ? onOpenShortcuts : undefined}
              >
                <Icon className="h-4 w-4" />
              </ToolbarIconButton>
            );
          })}
        </div>
      </TooltipProvider>
    </Panel>
  );
}
