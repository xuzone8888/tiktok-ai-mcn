import { Sidebar, Header } from "@/components/layout";
import { BackgroundTaskManager } from "@/components/background-task-manager";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
      {/* 后台任务管理器 - 处理视频/图片批量任务 */}
      <BackgroundTaskManager />
    </div>
  );
}



