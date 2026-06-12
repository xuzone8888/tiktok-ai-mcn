import { Sidebar, Header, type HeaderUser } from "@/components/layout";
import { BackgroundTaskManager } from "@/components/background-task-manager";
import { DownloadWidget } from "@/components/download-widget";
import { ForgeStatusFloat } from "@/components/forge-status-float";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/admin";

async function getInitialHeaderUser(): Promise<HeaderUser | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const adminSupabase = createAdminClient();
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("name, avatar_url, role, credits")
      .eq("id", user.id)
      .single();

    const profileData = profile as {
      name?: string | null;
      avatar_url?: string | null;
      role?: string | null;
      credits?: number | null;
    } | null;

    return {
      id: user.id,
      email: user.email || "",
      name: profileData?.name || user.email?.split("@")[0] || "User",
      avatar_url: profileData?.avatar_url || null,
      role: (profileData?.role as UserRole) || "user",
      credits: typeof profileData?.credits === "number" ? profileData.credits : 0,
    };
  } catch {
    return null;
  }
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialUser = await getInitialHeaderUser();

  return (
    <div className="flex min-h-screen h-screen overflow-hidden bg-titanium-grid relative selection:bg-white/20">
      {/* JCUI 1.0: 已移除旧版彩色渐变光球，使用干净的钛空银网格背景 */}

      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden relative z-10">
        <Header initialUser={initialUser} />
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
