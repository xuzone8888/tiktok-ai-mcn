"use client";

/**
 * 超级画布 · 空态起点引导(P0 · S5)
 *
 * 真空画布(无领域节点、无 broken)时居中显示 4 个 P0 真节点起点引导:添加文本/图片/商品/脚本。
 * 明确为「起点」,不冒充 P1/P2 完整工作流;点击经 CanvasBoard 的 createNodeAtCenter 在稳定位置
 * 建对应节点。覆盖层背景不吃事件(画布可穿透操作),仅卡片可点。
 */
import { Button } from "@/components/ui/button";
import type { CanvasNodeType } from "@/lib/canvas/schema";

import { EMPTY_STATE_GUIDE_TYPES } from "./canvas-chrome-policy";
import { NODE_TYPE_ITEMS } from "./node-type-meta";

export function CanvasEmptyState({
  onCreate,
  disabled = false,
}: {
  onCreate: (type: CanvasNodeType) => void;
  disabled?: boolean;
}) {
  const guides = EMPTY_STATE_GUIDE_TYPES.map((type) =>
    NODE_TYPE_ITEMS.find((item) => item.type === type)
  ).filter((item): item is (typeof NODE_TYPE_ITEMS)[number] => Boolean(item));

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg border border-border bg-card/85 px-6 py-5 text-center shadow-sm backdrop-blur">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            从一个创作起点开始
          </p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            添加商品或文本作为创作要求，连到图片节点生成视觉，再把图片连到视频节点完成成片。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {guides.map(({ type, label, Icon }) => (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={disabled}
              onClick={() => onCreate(type)}
            >
              <Icon className="h-4 w-4" />
              添加{label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
