"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Zap, Mail, Lock, User, ArrowRight, Github, Chrome, Loader2, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();

  // 表单状态
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 加载和成功状态
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // 注册处理
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password || !confirmPassword) {
      toast({
        variant: "destructive",
        title: "请填写完整信息",
        description: "所有字段都是必填的",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "密码不匹配",
        description: "两次输入的密码不一致",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: "destructive",
        title: "密码太短",
        description: "密码至少需要6个字符",
      });
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // 注册用户
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        // 创建用户 profile
        const { error: profileError } = await supabase
          .from("profiles")
          .insert({
            id: data.user.id,
            email: data.user.email!,
            name,
            role: "user",
            credits: 100, // 新用户赠送 100 积分
          });

        if (profileError) {
          console.error("Profile creation error:", profileError);
        }

        setIsSuccess(true);
        toast({
          title: "🎉 注册成功！",
          description: "请检查您的邮箱确认账号",
        });

        // 如果邮箱验证被禁用，直接跳转
        if (data.session) {
          setTimeout(() => {
            router.push("/dashboard");
            router.refresh();
          }, 2000);
        }
      }
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        variant: "destructive",
        title: "注册失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 注册成功后的邮箱验证提示页面
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
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
                <h2 className="text-2xl font-bold text-white">📧 请验证邮箱</h2>
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-amber-200 text-sm font-medium">
                    ⚠️ 重要提示：您必须点击邮件中的确认链接才能登录
                  </p>
                </div>
                <p className="text-white/50">验证邮件已发送至：</p>
                <p className="text-[#10b981] font-semibold text-lg break-all">{email}</p>
              </div>

              {/* Steps */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-left space-y-2">
                <p className="text-sm text-white/60">📋 验证步骤：</p>
                <ol className="text-sm text-white/40 space-y-1 list-decimal list-inside">
                  <li>打开您的邮箱（包括垃圾邮件文件夹）</li>
                  <li>找到来自 ToryX 的验证邮件</li>
                  <li>点击邮件中的 "确认邮箱" 链接</li>
                  <li>验证成功后即可登录</li>
                </ol>
              </div>

              {/* Action Button */}
              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] group border-t border-white"
              >
                <span className="flex items-center justify-center gap-2">
                  我已验证，前往登录
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>

              <p className="text-xs text-white/30">
                💡 没有收到邮件？请检查垃圾邮件文件夹，或等待1-2分钟后刷新邮箱
              </p>
            </div>
          </ReflectiveCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#00ff9d]/[0.05] rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[480px] relative z-10">
        <ReflectiveCard className="py-8 px-10 login-expand">
          {/* Header - Premium ToryX Logo */}
          <div className="flex flex-col items-center mb-5">
            <img
              src="/images/toryx_logo_icon.png"
              alt="ToryX Logo"
              className="w-14 h-14 mb-2 mt-2 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            />
            <div className="flex items-baseline mb-1">
              <span
                className="text-[28px] font-semibold tracking-[-0.02em]"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 25%, #c0c0c0 50%, #a0a0a0 75%, #d0d0d0 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                }}
              >
                创建账号
              </span>
            </div>
            <span className="text-xs text-white/30 tracking-[0.1em]">
              加入 ToryX 开始创作
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleRegister}>
            <div className="space-y-4 pb-2">
              {/* Name */}
              <ReflectiveInput
                icon={<User className="w-5 h-5" />}
                placeholder="用户名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />

              {/* Email */}
              <ReflectiveInput
                icon={<Mail className="w-5 h-5" />}
                type="email"
                placeholder="邮箱地址"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />

              {/* Password */}
              <ReflectiveInput
                icon={<Lock className="w-5 h-5" />}
                type="password"
                placeholder="密码（至少6位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />

              {/* Confirm Password */}
              <ReflectiveInput
                icon={<Lock className="w-5 h-5" />}
                type="password"
                placeholder="确认密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
              />

              {/* Bonus Info */}
              <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20">
                <Gift className="w-4 h-4 text-[#10b981]" />
                <p className="text-sm text-white/70">
                  新用户注册即送 <span className="text-[#10b981] font-bold">100 积分</span>
                </p>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] mt-2 group relative overflow-hidden border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      注册中...
                    </>
                  ) : (
                    <>
                      立即注册
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
              </Button>

              {/* Divider */}
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-white/10" />
                <span className="flex-shrink mx-4 text-white/20 text-xs uppercase tracking-widest">
                  Or continue with
                </span>
                <div className="flex-grow border-t border-white/10" />
              </div>

              {/* Social Login */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  className="h-10 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/80 transition-all text-sm font-medium group"
                >
                  <Github className="w-4 h-4 group-hover:text-white" />
                  GitHub
                </button>
                <button
                  type="button"
                  className="h-10 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/80 transition-all text-sm font-medium group"
                >
                  <Chrome className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                  Google
                </button>
              </div>

              {/* Login Link */}
              <div className="text-center">
                <p className="text-white/40 text-sm">
                  已有账号？
                  <Link href="/auth/login" className="text-[#10b981] hover:text-[#34d399] ml-1 transition-colors font-medium">
                    立即登录
                  </Link>
                </p>
              </div>

              {/* Footer */}
              <div className="text-center">
                <p className="text-white/30 text-xs">
                  注册即代表您同意
                  <Link href="/terms" className="text-white/50 hover:text-[#10b981] mx-1 transition-colors underline decoration-white/20 underline-offset-4">
                    服务条款
                  </Link>
                  和
                  <Link href="/privacy" className="text-white/50 hover:text-[#10b981] mx-1 transition-colors underline decoration-white/20 underline-offset-4">
                    隐私政策
                  </Link>
                </p>
              </div>
            </div>
          </form>
        </ReflectiveCard>
      </div>
    </div>
  );
}
