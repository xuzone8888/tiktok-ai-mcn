import { Sidebar, Header } from "@/components/layout";
import { BackgroundTaskManager } from "@/components/background-task-manager";
import { DownloadWidget } from "@/components/download-widget";
import { ForgeStatusFloat } from "@/components/forge-status-float";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen h-screen overflow-hidden bg-titanium-grid relative selection:bg-white/20">
      {/* JCUI 1.0: 已移除旧版彩色渐变光球，使用干净的钛空银网格背景 */}

      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden relative z-10">
        <Header />
        <main className="flex-1 overflow-y-auto relative">
          {/* Content container */}
          <div className="container mx-auto p-6 pb-20 min-h-full">
            {children}
          </div>

          {/* Bottom fade gradient - 底部渐变淡出 */}
          <div className="fixed bottom-0 left-[var(--sidebar-width,280px)] right-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10" />
        </main>
      </div>
      {/* 后台任务管理器 - 处理视频/图片批量任务 */}
      <BackgroundTaskManager />
      {/* 全局下载管理器浮窗 */}
      <DownloadWidget />
      {/* 全局铸造状态浮窗 — 离开角色创建页面后仍可见 */}
      <ForgeStatusFloat />
    </div>
  );
}
