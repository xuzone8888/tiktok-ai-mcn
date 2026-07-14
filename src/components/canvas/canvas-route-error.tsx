/**
 * 超级画布 · 无效 /canvas?id= 的 fail-closed 面板(P0 · D-runtime)。
 *
 * 用户带着一个非法/歧义的画布 id 进来时,**绝不**静默回退到可编辑的本地空画布(那会掩盖
 * 「打不开目标画布」并可能误新建)。这里给出明确的失败态与两个安全出口:回到空白画布 / 返回工作台。
 */
export interface CanvasRouteErrorProps {
  reason: string;
}

export function CanvasRouteError({ reason }: CanvasRouteErrorProps) {
  return (
    <div
      className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-4 p-8 text-center"
      data-canvas-route-error
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold text-foreground">无法打开该画布</h1>
        <p className="text-sm text-muted-foreground">{reason}</p>
        <p className="text-xs text-muted-foreground">
          链接可能已损坏或被截断。请检查地址,或从下面的入口重新开始。
        </p>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="/canvas"
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
        >
          新建空白画布
        </a>
        <a
          href="/studio"
          className="inline-flex h-9 items-center rounded-md px-4 text-sm text-muted-foreground hover:text-foreground"
        >
          返回工作台
        </a>
      </div>
    </div>
  );
}
