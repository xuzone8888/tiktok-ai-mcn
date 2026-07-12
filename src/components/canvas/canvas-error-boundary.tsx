"use client";

/**
 * 超级画布 · 组件级错误边界(P0 · S1 出壳)
 *
 * S1 只交付壳:任一渲染异常不白屏,提供「尝试恢复 / 重新加载画布」。
 * S7 在此基础上加固——store 层防护 hook + 触发进监控(单画布 >1 次/日报警),
 * 不需要改动本组件结构。这里刻意不接监控上报,避免冒领 S7。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // S7 接监控上报;S1 仅本地记录,保证可诊断。
    console.error("[canvas] 渲染错误被错误边界捕获", error, info.componentStack);
  }

  private handleRecover = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="space-y-1">
            <p className="text-base font-medium text-foreground">画布渲染出错</p>
            <p className="max-w-md text-sm text-muted-foreground">
              画布组件抛出异常,已被隔离以避免整页白屏。可尝试恢复;若仍异常请重新加载画布。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={this.handleRecover}>
              尝试恢复
            </Button>
            <Button variant="outline" size="sm" onClick={this.handleReload}>
              重新加载画布
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
