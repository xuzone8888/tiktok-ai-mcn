"use client";

/**
 * Super Canvas component boundary. Recovery is user-triggered and controlled by the root.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  canvasErrorMonitor,
  type CanvasErrorMonitor,
} from "@/lib/canvas/canvas-monitoring";

export interface CanvasErrorBoundaryProps {
  children: ReactNode;
  canvasId?: string | null;
  onRecover: () => boolean | void | Promise<boolean | void>;
  onReload?: () => void;
  monitor?: Pick<CanvasErrorMonitor, "capture">;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
  recovering: boolean;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null, recovering: false };
  private recoveryAttempt = 0;
  private mounted = true;
  private fallbackElement: HTMLDivElement | null = null;

  private focusFallback = (element: HTMLDivElement | null): void => {
    if (element === this.fallbackElement) return;
    this.fallbackElement = element;
    if (element) element.focus();
  };

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error, recovering: false };
  }

  componentDidMount(): void {
    this.mounted = true;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.captureError({
      canvasId: this.props.canvasId,
      error,
      componentStack: info.componentStack,
      boundary: "canvas-critical-area",
      action: "render_error",
    });
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.recoveryAttempt += 1;
    this.fallbackElement = null;
  }

  private handleRecover = (): void => {
    if (!this.mounted || this.state.recovering || !this.state.error) return;
    const attempt = ++this.recoveryAttempt;
    const fallbackError = this.state.error;
    this.setState({ recovering: true }, () => {
      if (!this.mounted || attempt !== this.recoveryAttempt) return;
      let recovery: boolean | void | Promise<boolean | void>;
      try {
        recovery = this.props.onRecover();
      } catch (error) {
        this.finishRecoveryFailure(error, attempt, fallbackError);
        return;
      }

      void Promise.resolve(recovery)
        .then((result) => {
          if (result === false) throw new Error("Canvas recovery callback rejected the reset");
          if (!this.mounted || attempt !== this.recoveryAttempt) return;
          // Children remount only after the controlled recovery has completed successfully.
          this.setState({ error: null, recovering: false });
        })
        .catch((error) => this.finishRecoveryFailure(error, attempt, fallbackError));
    });
  };

  private handleReload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    if (typeof window !== "undefined") window.location.reload();
  };

  private finishRecoveryFailure(error: unknown, attempt: number, fallbackError: Error): void {
    if (!this.mounted || attempt !== this.recoveryAttempt) return;
    const normalized = error instanceof Error ? error : new Error("Canvas recovery failed");
    this.captureError({
      canvasId: this.props.canvasId,
      error: normalized,
      boundary: "canvas-critical-area",
      action: "recovery_failed",
    });
    this.setState({ error: fallbackError, recovering: false });
  }

  private captureError(input: Parameters<CanvasErrorMonitor["capture"]>[0]): void {
    try {
      void (this.props.monitor ?? canvasErrorMonitor).capture(input).catch(() => {});
    } catch {
      // Monitoring must never replace the boundary error or block recovery.
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          ref={this.focusFallback}
          className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center"
          role="alert"
          tabIndex={-1}
          aria-busy={this.state.recovering}
        >
          <div className="space-y-1">
            <p className="text-base font-medium text-foreground">画布渲染出错</p>
            <p className="max-w-md text-sm text-muted-foreground">
              画布组件抛出异常,已被隔离以避免整页白屏。可尝试恢复;若仍异常请重新加载画布。
            </p>
          </div>
          <TooltipProvider>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={this.handleRecover}
                    disabled={this.state.recovering}
                    aria-label="尝试恢复画布"
                  >
                    {this.state.recovering ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )}
                    尝试恢复
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重新校验并恢复当前画布状态</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={this.handleReload}
                    aria-label="重新加载画布"
                  >
                    <RefreshCw aria-hidden="true" />
                    重新加载画布
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重新加载当前页面</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      );
    }
    return this.props.children;
  }
}
