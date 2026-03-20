"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Lock, ArrowRight, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PageState = "loading" | "ready" | "success" | "expired";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();

  // 页面状态
  const [pageState, setPageState] = useState<PageState>("loading");

  // 表单状态
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 监听 PASSWORD_RECOVERY 事件 + 5 秒超时兜底
  useEffect(() => {
    const supabase = createClient();

    // 监听 Supabase auth 状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          // Supabase 已解析 URL hash 并建立了 recovery session
          setPageState("ready");
        }
      }
    );

    // 5 秒超时兜底：如果 PASSWORD_RECOVERY 事件没触发，说明链接无效
    const timeout = setTimeout(() => {
      setPageState((current) => {
        if (current === "loading") {
          return "expired";
        }
        return current;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // 提交新密码
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      toast({
        variant: "destructive",
        title: "请填写完整信息",
        description: "新密码和确认密码不能为空",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "密码太短",
        description: "密码至少需要 6 个字符",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "密码不匹配",
        description: "两次输入的密码不一致",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setPageState("success");
      toast({
        title: "🎉 密码重置成功！",
        description: "即将跳转到登录页...",
      });

      // 3 秒后自动跳转登录页
      setTimeout(() => {
        router.push("/auth/login");
      }, 3000);
    } catch (error: any) {
      console.error("Reset password error:", error);
      toast({
        variant: "destructive",
        title: "重置失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 统一的多重光晕背景
  const Background = () => (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div
        className="absolute top-0 left-0 w-[800px] h-[800px] -translate-x-1/4 -translate-y-1/4 mix-blend-screen"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0) 60%)' }}
      />
      <div
        className="absolute bottom-0 right-0 w-[800px] h-[800px] translate-x-1/4 translate-y-1/4 mix-blend-screen"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0) 60%)' }}
      />
      <div
        className="absolute top-1/2 left-1/2 w-[1000px] h-[1000px] -translate-x-1/2 -translate-y-1/2 mix-blend-screen opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0) 60%)' }}
      />
    </div>
  );

  // ==========================================
  // 渲染：加载中状态
  // ==========================================
  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        <Background />
        <div className="w-full max-w-[460px] relative z-10">
          <div className="w-full bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />
            <div className="flex flex-col items-center space-y-4">
              <Loader2 className="w-10 h-10 text-[#10b981] animate-spin" />
              <p className="text-white/50 text-sm">正在验证重置链接...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 渲染：链接无效/过期
  // ==========================================
  if (pageState === "expired") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        <Background />
        <div className="w-full max-w-[460px] relative z-10">
          <div className="w-full bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                    boxShadow: '0 0 40px rgba(239,68,68,0.3)'
                  }}
                >
                  <AlertTriangle className="h-10 w-10 text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">链接无效或已过期</h2>
                <p className="text-white/50 text-sm">
                  此密码重置链接可能已被使用或已过期，请重新申请
                </p>
              </div>
              <Button
                onClick={() => router.push("/auth/forgot-password")}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group"
              >
                <span className="flex items-center justify-center gap-2">
                  重新发送重置邮件
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>
              <Link
                href="/auth/login"
                className="text-sm text-white/40 hover:text-[#10b981] transition-colors inline-block"
              >
                返回登录
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 渲染：重置成功
  // ==========================================
  if (pageState === "success") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        <Background />
        <div className="w-full max-w-[460px] relative z-10">
          <ReflectiveCard className="py-10 px-10">
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center animate-bounce"
                  style={{
                    background: 'linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)',
                    boxShadow: '0 0 40px rgba(16,185,129,0.4)'
                  }}
                >
                  <CheckCircle2 className="h-10 w-10 text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">🎉 密码重置成功</h2>
                <p className="text-white/50">
                  您的密码已更新，3 秒后将自动跳转到登录页...
                </p>
              </div>
              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group"
              >
                <span className="flex items-center justify-center gap-2">
                  立即前往登录
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>
            </div>
          </ReflectiveCard>
        </div>
      </div>
    );
  }

  // ==========================================
  // 渲染：就绪状态 - 输入新密码
  // ==========================================
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      <Background />

      <div className="w-full max-w-[460px] relative z-10">
        {/* 毛玻璃容器 */}
        <div className="w-full bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
          {/* 玻璃边缘折射高光 */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />

          {/* Logo */}
          <div className="flex justify-center mb-6">
            <img
              src="/images/toryx_logo_text.png"
              alt="ToryX AI"
              className="h-10 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            />
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">设置新密码</h2>
            <p className="text-sm text-white/40">请输入您的新密码</p>
          </div>

          {/* Form */}
          <form onSubmit={handleResetPassword}>
            <div className="space-y-4">
              <ReflectiveInput
                icon={<Lock className="w-5 h-5 text-white/50" />}
                type="password"
                placeholder="新密码（至少 6 位）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isSubmitting}
              />
              <ReflectiveInput
                icon={<Lock className="w-5 h-5 text-white/50" />}
                type="password"
                placeholder="确认新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
              />

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isSubmitting || !newPassword || !confirmPassword}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      更新中...
                    </>
                  ) : (
                    <>
                      更新密码
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
