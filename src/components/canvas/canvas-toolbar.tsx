"use client";

/**
 * 超级画布 · 底盘工具条(P0 · S1)
 *
 * 用 React Flow 的 Panel 停靠(刻意避开顶栏——LibTV 教训:窄窗被自家站头遮挡)。
 * 只放 S1 自持的视图开关:小地图收起/展开、隐藏连线、网格吸附,加「?」快捷键面板。
 * 缩放/适应视图用 React Flow 原生 <Controls>,不在此重复。底部工具栏(素材库/角色库/
 * 历史/教程)属 S5,不在此实现。
 */
import { Panel } from "@xyflow/react";
import { Eye, EyeOff, Grid3x3, Keyboard, Map as MapIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useCanvasEdgesHidden,
  useCanvasMinimapCollapsed,
  useCanvasSnapToGrid,
  useCanvasStore,
} from "@/stores/canvas-store";

interface ToolbarToggleProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarToggle({ label, active, onClick, children }: ToolbarToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn("h-8 w-8", active && "bg-accent text-accent-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CanvasToolbar({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const edgesHidden = useCanvasEdgesHidden();
  const snapToGrid = useCanvasSnapToGrid();
  const minimapCollapsed = useCanvasMinimapCollapsed();
  const toggleEdgesHidden = useCanvasStore((state) => state.toggleEdgesHidden);
  const toggleSnapToGrid = useCanvasStore((state) => state.toggleSnapToGrid);
  const toggleMinimapCollapsed = useCanvasStore((state) => state.toggleMinimapCollapsed);

  return (
    <Panel position="top-left" className="!m-2">
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur">
          <ToolbarToggle
            label={minimapCollapsed ? "展开小地图" : "收起小地图"}
            active={!minimapCollapsed}
            onClick={toggleMinimapCollapsed}
          >
            <MapIcon className="h-4 w-4" />
          </ToolbarToggle>
          <ToolbarToggle
            label={edgesHidden ? "显示连线" : "隐藏连线"}
            active={edgesHidden}
            onClick={toggleEdgesHidden}
          >
            {edgesHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </ToolbarToggle>
          <ToolbarToggle
            label={snapToGrid ? "关闭网格吸附" : "开启网格吸附"}
            active={snapToGrid}
            onClick={toggleSnapToGrid}
          >
            <Grid3x3 className="h-4 w-4" />
          </ToolbarToggle>
          <Separator orientation="vertical" className="mx-0.5 h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="快捷键面板"
                onClick={onOpenShortcuts}
                className="h-8 w-8"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">快捷键面板 · ?</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </Panel>
  );
}
