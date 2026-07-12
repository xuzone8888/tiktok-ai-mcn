"use client";

/**
 * 超级画布 · 左侧节点类型工具条(P0 · S2)
 *
 * 6 类白名单节点各一入口按钮,点击在当前视口中心建对应默认节点(坐标由 CanvasBoard 用
 * screenToFlowPosition 计算)。安静图标风格,配 tooltip;只读时禁用。
 */
import { Panel } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CanvasNodeType } from "@/lib/canvas/schema";

import { NODE_TYPE_ITEMS } from "./node-type-meta";

export function NodePalette({
  onCreate,
  disabled = false,
}: {
  onCreate: (type: CanvasNodeType) => void;
  disabled?: boolean;
}) {
  return (
    <Panel position="top-left" className="!m-2">
      <TooltipProvider delayDuration={300}>
        <div
          role="toolbar"
          aria-label="添加节点"
          className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur"
        >
          {NODE_TYPE_ITEMS.map(({ type, label, Icon }) => (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`添加${label}节点`}
                  disabled={disabled}
                  onClick={() => onCreate(type)}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{`添加${label}节点`}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </Panel>
  );
}
