/**
 * Studio 占位页(S0.5 验证全屏豁免;S1 实装 omnibox + 批次流)
 * 见 docs/STUDIO_REDESIGN_PLAN.md
 */
export default function StudioPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <p className="text-lg font-medium">Studio</p>
      <p className="text-sm">统一创作工作台建设中(S1)</p>
    </div>
  );
}
