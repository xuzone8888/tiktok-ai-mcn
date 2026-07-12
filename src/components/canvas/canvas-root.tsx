"use client";

/**
 * 超级画布 · 客户端挂载根(P0 · S1)
 *
 * 唯一的 React Flow 样式 import 点——**只在 /canvas 路由子树内**,绝不进 root layout 或
 * globals.css(避免样式进入 /studio 与 (main) 共享的全局 chunk;React Flow 样式已是
 * .react-flow* 前缀,配合本处局部 import 双保险)。若 Next 对 client 组件 import CSS 报限制,
 * 退回把本 import 移到 (canvas)/canvas/layout.tsx。
 *
 * 组合:错误边界(S1 出壳)→ ReactFlowProvider(useReactFlow 依赖)→ 受控底盘。
 */
import "@xyflow/react/dist/style.css";

import { ReactFlowProvider } from "@xyflow/react";

import { CanvasBoard } from "./canvas-board";
import { CanvasErrorBoundary } from "./canvas-error-boundary";

export function CanvasRoot() {
  return (
    <CanvasErrorBoundary>
      <ReactFlowProvider>
        <CanvasBoard />
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}
