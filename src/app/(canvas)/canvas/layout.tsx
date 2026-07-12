import type { Metadata } from "next";

/**
 * 超级画布 · 路由组 layout(P0 · S1)
 *
 * 顶级路由组 (canvas) 与 (main)/(landing) 平级:它**不经过** (main) 的
 * Sidebar/Header/MainContentFrame/BackgroundTaskManager 链路,因此不影响 /studio,
 * 也不继承 studio 的 chrome。root layout 已提供 ThemeProvider/LangProvider/Toaster/字体,
 * 这里**不重声明任何 provider**(重声明会双挂主题/toast)。
 *
 * 只加一件事:整屏无溢出的容器——React Flow 必须有显式尺寸,否则渲染 0 高。
 * 硬鉴权由中间件 PROTECTED_ROUTES 追加 /canvas 提供(审核窗跨目录改,非本窗)。
 * BTM 不在本组挂载(P0 不接生成;P1 接生成前另做布局接入验收)。
 */
export const metadata: Metadata = {
  title: "超级画布 · Star Gaze",
  description: "Super Canvas 无限画布节点编排(P0 内部骨架)",
};

export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">{children}</div>
  );
}
