"use client";

/**
 * 超级画布 · 左侧节点类型工具条(P0 · S2 建节点入口 + S6 窄屏图标态)
 *
 * 6 类白名单节点各一入口按钮,点击在当前视口中心建对应默认节点(坐标由 CanvasBoard 用
 * screenToFlowPosition 计算)。安静图标风格,配 tooltip;只读时禁用。
 *
 * S6 响应式(#33):侧栏**默认图标态**(不展开成大卡片/营销面板),并夹 max-height + 内部滚动 ——
 * 即便 1366×768 或未来入口更多,也绝不纵向溢出视口、不与其它面板重叠。
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

import { CREATABLE_NODE_TYPE_ITEMS } from "./node-type-meta";

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
          data-sidebar-mode="icon"
          className="flex max-h-[calc(100vh-5rem)] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur"
        >
          {CREATABLE_NODE_TYPE_ITEMS.map(({ type, label, Icon }) => (
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
