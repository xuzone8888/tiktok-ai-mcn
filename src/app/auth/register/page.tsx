"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Mail, Lock, User, ArrowRight, Loader2, Gift, Fingerprint, Sparkles, Globe, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";
import { LangToggle } from "@/components/ui/LangToggle";

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { lang } = useLang();

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
        title: lang === "en" ? "Please fill in all fields" : "请填写完整信息",
        description: lang === "en" ? "All fields are required" : "所有字段都是必填的",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Passwords Don't Match" : "密码不匹配",
        description: lang === "en" ? "Your passwords don't match" : "两次输入的密码不一致",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Password Too Short" : "密码太短",
        description: lang === "en" ? "Password must be at least 6 characters" : "密码至少需要6个字符",
      });
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });

      if (error) throw error;

      if (data.user) {
        setIsSuccess(true);
        toast({
          title: lang === "en" ? "🎉 Registration Successful!" : "🎉 注册成功！",
          description: lang === "en" ? "Please check your email to confirm" : "请检查您的邮箱确认账号",
        });

        if (data.session) {
          setTimeout(() => {
            router.push("/models");
            router.refresh();
          }, 2000);
        }
      }
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        variant: "destructive",
        title: lang === "en" ? "Registration Failed" : "注册失败",
        description: error.message || (lang === "en" ? "Please try again" : "请稍后重试"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Google 注册
  const handleGoogleRegister = async () => {
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/login`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Google Sign Up Failed" : "Google 注册失败",
        description: error.message || (lang === "en" ? "Please try again" : "请稍后重试"),
      });
    }
  };

  // 注册成功后的邮箱验证提示页面
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* 右上角语言切换 */}
        <div className="absolute top-4 right-4 z-50">
          <LangToggle />
        </div>

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
        </div>

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
                  {lang === "en" ? "📧 Verify Your Email" : "📧 请验证邮箱"}
                </h2>
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-amber-200 text-sm font-medium">
                    {lang === "en"
                      ? "⚠️ Important: You must click the link in the email to sign in"
                      : "⚠️ 重要提示：您必须点击邮件中的确认链接才能登录"}
                  </p>
                </div>
                <p className="text-white/50">
                  {lang === "en" ? "Verification email sent to:" : "验证邮件已发送至："}
                </p>
                <p className="text-[#10b981] font-semibold text-lg break-all">{email}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-left space-y-2">
                <p className="text-sm text-white/60">
                  {lang === "en" ? "📋 Steps:" : "📋 验证步骤："}
                </p>
                <ol className="text-sm text-white/40 space-y-1 list-decimal list-inside">
                  <li>{lang === "en" ? "Open your inbox (including spam)" : "打开您的邮箱（包括垃圾邮件文件夹）"}</li>
                  <li>{lang === "en" ? "Find the verification email in your inbox" : "找到验证邮件"}</li>
                  <li>{lang === "en" ? 'Click the "Confirm Email" link' : '点击邮件中的 "确认邮箱" 链接'}</li>
                  <li>{lang === "en" ? "Sign in after verification" : "验证成功后即可登录"}</li>
                </ol>
              </div>

              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group"
              >
                <span className="flex items-center justify-center gap-2">
                  {lang === "en" ? "I've Verified, Go Sign In" : "我已验证，前往登录"}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>

              <p className="text-xs text-white/30">
                {lang === "en"
                  ? "💡 No email? Check spam or wait 1-2 min and refresh"
                  : "💡 没有收到邮件？请检查垃圾邮件文件夹，或等待1-2分钟后刷新邮箱"}
              </p>
            </div>
          </ReflectiveCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex relative overflow-hidden">
      {/* 右上角语言切换 */}
      <div className="absolute top-4 right-4 z-50">
        <LangToggle />
      </div>

      {/* 1. 多重光晕全局背景 */}
      <div className="absolute inset-0 pointer-events-none z-0">
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

      <div className="w-full max-w-7xl mx-auto flex relative z-10">
        {/* 2. 左侧：品牌叙事区 (大屏显示) */}
        <div className="hidden lg:flex flex-col flex-1 p-12 lg:p-16 justify-between pb-12">
          
          {/* 中央视觉聚合区 (Logo + 文案) */}
          <div className="flex-1 flex flex-col justify-center max-w-xl self-start">
            
            {/* 品牌 Logo (回归视觉中心，放大尺寸) */}
            <div className="flex items-center gap-4 mb-16">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.2rem] overflow-hidden shadow-[0_10_40px_rgba(34,211,238,0.25)] ring-1 ring-white/10">
                <img src="/images/toryx_logo_icon_new.png" alt="Star Gaze Logo" className="h-full w-full object-cover scale-[1.05]" />
              </div>
              <h1 className="text-[34px] tracking-tight flex items-center gap-2">
                <span className="font-extrabold text-white drop-shadow-md">Star</span>
                <span className="font-light text-white/70">Gaze</span>
              </h1>
            </div>

            <h1 className="text-5xl lg:text-[64px] font-extrabold tracking-tight mb-8 leading-[1.08]">
              {lang === "en" ? (
                <>
                  <span className="block text-white mb-2">Start Your</span>
                  <span className="block bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-[#00f2ea] to-cyan-500">AI Creative</span>
                  <span className="block text-white/90 mt-2">Journey</span>
                </>
              ) : (
                <>
                  <span className="block text-white mb-2">开启你的</span>
                  <span className="block bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-[#00f2ea] to-cyan-500">AI 创作</span>
                  <span className="block text-white/90 mt-2">之旅</span>
                </>
              )}
            </h1>

            <p className="text-lg text-white/50 mb-10 leading-relaxed font-light">
              {lang === "en"
                ? "Create your account · Build your exclusive AI character · Generate professional short videos in one click."
                : "创建账号 · 打造专属 AI 角色 · 一键生成专业级带货短视频。"}
            </p>

            {/* 特色胶囊: 毛玻璃高定 */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-xl hover:bg-white/[0.08] transition-colors shadow-sm">
                <Fingerprint className="w-4 h-4 text-[#a855f7]" />
                <span className="text-sm font-medium text-white/70">
                  {lang === "en" ? "Character IP" : "角色 IP 孵化"}
                </span>
              </div>
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-xl hover:bg-white/[0.08] transition-colors shadow-sm">
                <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                <span className="text-sm font-medium text-white/70">
                  {lang === "en" ? "Cutting-edge AI" : "前沿 AI 模型"}
                </span>
              </div>
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-xl hover:bg-white/[0.08] transition-colors shadow-sm">
                <Globe className="w-4 h-4 text-[#10b981]" />
                <span className="text-sm font-medium text-white/70">
                  {lang === "en" ? "Global Reach" : "内容链接全球"}
                </span>
              </div>
            </div>
          </div>
          
          {/* 底部: 公司实体法务声明区域 */}
          <div className="pt-6 flex items-center gap-4 opacity-40 hover:opacity-100 transition-opacity mt-auto">
            <div className="h-px w-8 bg-white/20"></div>
            <p className="text-[10px] text-white/60 uppercase tracking-[0.2em] font-medium leading-tight">
              Operated by Wuhan Guanxing Cultural Media Co., Ltd.
            </p>
          </div>
        </div>

        {/* 3. 右侧：注册表单区 */}
        <div className="w-full lg:w-[500px] xl:w-[600px] flex items-center justify-center p-6 sm:p-12">

          <div className="w-full max-w-[460px] bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden group/card">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />

            <div className="flex justify-center mb-8 lg:hidden">
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

            <div className="text-center lg:text-left mb-6">
              <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
                {lang === "en" ? "Create Account" : "创建账号"}
              </h2>
              <p className="text-sm text-white/40">
                {lang === "en" ? "Start creating with Star Gaze" : "注册账号以开始创作"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoogleRegister}
              className="w-full h-12 flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-black font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.25)] mb-5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {lang === "en" ? "Continue with Google" : "继续使用 Google 注册"}
            </button>

            <div className="flex items-center gap-4 mb-5">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-white/20 text-xs tracking-widest uppercase">
                {lang === "en" ? "or" : "或者"}
              </span>
              <div className="flex-1 h-px bg-white/5" />
            </div>

            <form onSubmit={handleRegister}>
              <div className="space-y-3">
                <ReflectiveInput
                  icon={<User className="w-5 h-5 text-white/50" />}
                  placeholder={lang === "en" ? "Username" : "用户名"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                />
                <ReflectiveInput
                  icon={<Mail className="w-5 h-5 text-white/50" />}
                  type="email"
                  placeholder={lang === "en" ? "Email address" : "邮箱地址"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
                <ReflectiveInput
                  icon={<Lock className="w-5 h-5 text-white/50" />}
                  type="password"
                  placeholder={lang === "en" ? "Password (min. 6 chars)" : "密码（至少6位）"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
                <ReflectiveInput
                  icon={<Lock className="w-5 h-5 text-white/50" />}
                  type="password"
                  placeholder={lang === "en" ? "Confirm password" : "确认密码"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                />

                <div className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20">
                  <Gift className="w-4 h-4 text-[#10b981]" />
                  <p className="text-sm text-white/70">
                    {lang === "en" ? "New users get" : "新用户注册即送"}{" "}
                    <span className="text-[#10b981] font-bold">
                      {lang === "en" ? "100 free credits" : "100 积分"}
                    </span>
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center justify-center gap-2">
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {lang === "en" ? "Signing Up..." : "注册中..."}
                      </>
                    ) : (
                      <>
                        {lang === "en" ? "Sign Up" : "立即注册"}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </span>
                </Button>

                <div className="pt-4 text-center space-y-3">
                  <p className="text-white/50 text-sm">
                    {lang === "en" ? "Already have an account?" : "已有账号？"}
                    <Link href="/auth/login" className="text-white hover:text-[#10b981] ml-2 font-medium transition-colors">
                      {lang === "en" ? "Sign In" : "立即登录"}
                    </Link>
                  </p>
                  <p className="text-white/30 text-xs">
                    {lang === "en" ? "By signing up you agree to our" : "注册即代表您同意我们的"}
                    <Link href="/terms" className="text-white/50 hover:text-white mx-1 transition-colors hover:underline underline-offset-4">
                      {lang === "en" ? "Terms of Service" : "服务条款"}
                    </Link>
                    {lang === "en" ? "and" : "和"}
                    <Link href="/privacy" className="text-white/50 hover:text-white mx-1 transition-colors hover:underline underline-offset-4">
                      {lang === "en" ? "Privacy Policy" : "隐私政策"}
                    </Link>
                  </p>
                </div>

              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
