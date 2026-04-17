"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight, ArrowLeft, Loader2, Sparkles, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";
import { LangToggle } from "@/components/ui/LangToggle";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { lang } = useLang();

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Email Required" : "请输入邮箱",
        description: lang === "en" ? "Please enter your email address" : "邮箱地址不能为空",
      });
      return;
    }

    if (!emailRegex.test(email)) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Invalid Email" : "邮箱格式错误",
        description: lang === "en" ? "Please enter a valid email address" : "请输入正确的邮箱地址",
      });
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (error) throw error;

      setIsSent(true);
      toast({
        title: lang === "en" ? "✅ Reset Email Sent" : "✅ 重置邮件已发送",
        description: lang === "en" ? `Check ${email} inbox` : `请查看 ${email} 收件箱`,
      });
    } catch (error: any) {
      console.error("Reset password error:", error);
      toast({
        variant: "destructive",
        title: lang === "en" ? "Send Failed" : "发送失败",
        description: error.message || (lang === "en" ? "Please try again" : "请稍后重试"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 背景层
  const BG = () => (
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

  // 发送成功页面
  if (isSent) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-4 right-4 z-50"><LangToggle /></div>
        <BG />
        <div className="w-full max-w-[440px] relative z-10">
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
                  <Mail className="h-10 w-10 text-white" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-bold text-white">
                  {lang === "en" ? "📧 Check Your Inbox" : "📧 请查看邮箱"}
                </h2>
                <p className="text-white/50">
                  {lang === "en" ? "Password reset email sent to:" : "密码重置邮件已发送至："}
                </p>
                <p className="text-[#10b981] font-semibold text-lg break-all">{email}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-left space-y-2">
                <p className="text-sm text-white/60">
                  {lang === "en" ? "📋 Steps:" : "📋 重置步骤："}
                </p>
                <ol className="text-sm text-white/40 space-y-1 list-decimal list-inside">
                  <li>{lang === "en" ? "Open your inbox (including spam)" : "打开您的邮箱（包括垃圾邮件文件夹）"}</li>
                  <li>{lang === "en" ? "Find the password reset email in your inbox" : "找到密码重置邮件"}</li>
                  <li>{lang === "en" ? 'Click the "Reset Password" link' : '点击邮件中的"重置密码"链接'}</li>
                  <li>{lang === "en" ? "Set your new password" : "设置新密码即可"}</li>
                </ol>
              </div>

              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group"
              >
                <span className="flex items-center justify-center gap-2">
                  {lang === "en" ? "Back to Sign In" : "返回登录"}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>

              <p className="text-xs text-white/30">
                {lang === "en"
                  ? "💡 No email? Check spam or wait 1-2 min and refresh"
                  : "💡 没有收到邮件？请检查垃圾邮件文件夹，或等待 1-2 分钟后刷新邮箱"}
              </p>
            </div>
          </ReflectiveCard>
        </div>
      </div>
    );
  }

  // 初始状态：输入邮箱
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-50"><LangToggle /></div>
      <BG />

      <div className="w-full max-w-[460px] relative z-10">
        <div className="w-full bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />

          <div className="flex justify-center mb-6">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-2">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden shadow-[0_4_15px_rgba(34,211,238,0.3)]">
                  <img src="/images/toryx_logo_icon_new.png" alt="Star Gaze Logo" className="h-full w-full object-cover scale-[1.05]" />
                </div>
                <div className="flex items-center tracking-wide">
                  <span className="text-xl font-bold text-white tracking-tight">Star</span>
                  <span className="text-xl font-light text-white/70 ml-1">Gaze</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
              {lang === "en" ? "Forgot Password" : "找回密码"}
            </h2>
            <p className="text-sm text-white/40">
              {lang === "en"
                ? "Enter your email and we'll send a reset link"
                : "输入您的注册邮箱，我们将发送密码重置链接"}
            </p>
          </div>

          <form onSubmit={handleSendResetEmail}>
            <div className="space-y-4">
              <ReflectiveInput
                icon={<Mail className="w-5 h-5 text-white/50" />}
                type="email"
                placeholder={lang === "en" ? "Enter your registered email" : "请输入注册邮箱"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />

              <Button
                type="submit"
                disabled={isLoading || !email}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {lang === "en" ? "Sending..." : "发送中..."}
                    </>
                  ) : (
                    <>
                      {lang === "en" ? "Send Reset Email" : "发送重置邮件"}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
              </Button>

              <div className="text-center pt-2">
                <Link
                  href="/auth/login"
                  className="text-sm text-white/50 hover:text-[#10b981] transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {lang === "en" ? "Back to Sign In" : "返回登录"}
                </Link>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
