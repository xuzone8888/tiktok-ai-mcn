"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();

  // 状态
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  // 邮箱格式验证
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 发送重置邮件
  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({
        variant: "destructive",
        title: "请输入邮箱",
        description: "邮箱地址不能为空",
      });
      return;
    }

    if (!emailRegex.test(email)) {
      toast({
        variant: "destructive",
        title: "邮箱格式错误",
        description: "请输入正确的邮箱地址",
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
        title: "✅ 重置邮件已发送",
        description: `请查看 ${email} 收件箱`,
      });
    } catch (error: any) {
      console.error("Reset password error:", error);
      toast({
        variant: "destructive",
        title: "发送失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 发送成功后的提示页面
  if (isSent) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Atmosphere */}
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#00ff9d]/[0.05] rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-[440px] relative z-10">
          <ReflectiveCard className="py-10 px-10">
            <div className="text-center space-y-6">
              {/* Success Icon */}
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

              {/* Title */}
              <div className="space-y-3">
                <h2 className="text-2xl font-bold text-white">📧 请查看邮箱</h2>
                <p className="text-white/50">密码重置邮件已发送至：</p>
                <p className="text-[#10b981] font-semibold text-lg break-all">{email}</p>
              </div>

              {/* Steps */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-left space-y-2">
                <p className="text-sm text-white/60">📋 重置步骤：</p>
                <ol className="text-sm text-white/40 space-y-1 list-decimal list-inside">
                  <li>打开您的邮箱（包括垃圾邮件文件夹）</li>
                  <li>找到来自 ToryX 的密码重置邮件</li>
                  <li>点击邮件中的"重置密码"链接</li>
                  <li>设置新密码即可</li>
                </ol>
              </div>

              {/* Action Button */}
              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] group border-t border-white"
              >
                <span className="flex items-center justify-center gap-2">
                  返回登录
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>

              <p className="text-xs text-white/30">
                💡 没有收到邮件？请检查垃圾邮件文件夹，或等待 1-2 分钟后刷新邮箱
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
      {/* Background Atmosphere */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#00ff9d]/[0.05] rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[460px] relative z-10">
        <ReflectiveCard className="py-8 px-10 login-expand">
          {/* Header - ToryX Logo */}
          <div className="flex flex-col items-center mb-6">
            <img
              src="/images/toryx_logo_text.png"
              alt="ToryX AI"
              className="h-12 mt-4 mb-3 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            />
            <span className="text-xs text-white/30 tracking-[0.15em] uppercase">
              AI 内容智造工厂
            </span>
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h1
              className="text-[24px] font-semibold tracking-[-0.02em] mb-2"
              style={{
                background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 25%, #c0c0c0 50%, #a0a0a0 75%, #d0d0d0 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
              }}
            >
              找回密码
            </h1>
            <p className="text-sm text-white/40">
              输入您的注册邮箱，我们将发送密码重置链接
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSendResetEmail}>
            <div className="space-y-4 pb-2">
              <ReflectiveInput
                icon={<Mail className="w-5 h-5" />}
                type="email"
                placeholder="请输入注册邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading || !email}
                className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] mt-2 group border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      发送中...
                    </>
                  ) : (
                    <>
                      发送重置邮件
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
              </Button>

              {/* Back to Login */}
              <div className="text-center mt-4">
                <Link
                  href="/auth/login"
                  className="text-sm text-white/50 hover:text-[#10b981] transition-colors inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回登录
                </Link>
              </div>
            </div>
          </form>
        </ReflectiveCard>
      </div>
    </div>
  );
}
