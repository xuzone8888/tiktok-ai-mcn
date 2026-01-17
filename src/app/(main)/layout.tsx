import { Sidebar, Header } from "@/components/layout";
import { BackgroundTaskManager } from "@/components/background-task-manager";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen h-screen overflow-hidden bg-background relative">
      {/* Decorative gradient orbs - 底部装饰渐变 */}
      <div className="fixed bottom-0 left-1/4 w-[500px] h-[500px] bg-gradient-to-r from-tiktok-cyan/5 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[400px] bg-gradient-to-l from-tiktok-pink/5 to-transparent rounded-full blur-3xl pointer-events-none" />

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
    </div>
  );
}
