"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Smartphone, ArrowRight, Loader2, KeyRound, Fingerprint, Sparkles, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";
import { LangToggle } from "@/components/ui/LangToggle";

// 包装组件以支持 useSearchParams
function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { lang } = useLang();

  // 获取重定向目标
  const redirectTo = searchParams.get('redirect') || '/models';

  // 登录方式: password (邮箱登录) | phone (手机登录)
  const [loginMethod, setLoginMethod] = useState<"password" | "phone">("password");

  // 表单状态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  // 处理 URL hash 中的 auth token（从 Supabase magic link 回调）
  useEffect(() => {
    const handleAuthCallback = async () => {
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        console.log("Detected auth callback with tokens in URL hash");

        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          try {
            const supabase = createClient();

            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error) {
              console.error("Failed to set session:", error);
              toast({
                variant: "destructive",
                title: lang === "en" ? "Sign In Failed" : "登录失败",
                description: lang === "en" ? "Session setup failed, please try again" : "Session 设置失败，请重试",
              });
              window.history.replaceState(null, '', window.location.pathname);
              return;
            }

            if (data.session) {
              toast({
                title: lang === "en" ? "🎉 Signed In!" : "🎉 登录成功！",
                description: lang === "en" ? "Redirecting..." : "正在跳转到控制台...",
              });
              window.location.replace(redirectTo);
            }
          } catch (err) {
            console.error("Auth callback error:", err);
          }
        }
      }
    };

    handleAuthCallback();
  }, [toast]);


  // 密码登录处理
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Please fill in all fields" : "请填写完整信息",
        description: lang === "en" ? "Email and password are required" : "邮箱和密码不能为空",
      });
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        toast({
          title: lang === "en" ? "Signed In!" : "登录成功！",
          description: lang === "en" ? "Redirecting..." : "正在跳转到控制台...",
        });
        setTimeout(() => {
          window.location.href = redirectTo;
        }, 500);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      toast({
        variant: "destructive",
        title: lang === "en" ? "Sign In Failed" : "登录失败",
        description: error.message || (lang === "en" ? "Check your email and password" : "请检查邮箱和密码是否正确"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 手机验证码状态
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [isSendingSms, setIsSendingSms] = useState(false);

  // 手机验证码倒计时
  useEffect(() => {
    if (phoneCountdown > 0) {
      const timer = setTimeout(() => setPhoneCountdown(phoneCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [phoneCountdown]);

  // 发送手机验证码
  const handleSendPhoneSms = async () => {
    if (!phone) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Phone number required" : "请输入手机号",
        description: lang === "en" ? "Please enter your phone number" : "手机号不能为空",
      });
      return;
    }

    const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');
    if (!/^1[3-9]\d{9}$/.test(formattedPhone)) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Invalid Phone Number" : "手机号格式错误",
        description: lang === "en" ? "Please enter a valid 11-digit phone number" : "请输入正确的11位手机号",
      });
      return;
    }

    setIsSendingSms(true);

    try {
      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formattedPhone }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message);
      }

      setPhoneSent(true);
      setPhoneCountdown(60);
      toast({
        title: lang === "en" ? "✅ Code Sent" : "✅ 验证码已发送",
        description: lang === "en"
          ? `Check ${formattedPhone.slice(0, 3)}****${formattedPhone.slice(-4)} for the SMS code`
          : `请查看手机 ${formattedPhone.slice(0, 3)}****${formattedPhone.slice(-4)} 短信`,
      });
    } catch (error: any) {
      console.error("Send SMS error:", error);
      toast({
        variant: "destructive",
        title: lang === "en" ? "Send Failed" : "发送失败",
        description: error.message || (lang === "en" ? "Please try again" : "请稍后重试"),
      });
    } finally {
      setIsSendingSms(false);
    }
  };

  // 手机验证码登录
  const handlePhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phone || !code) {
      toast({
        variant: "destructive",
        title: lang === "en" ? "Please fill in all fields" : "请填写完整信息",
        description: lang === "en" ? "Phone and code are required" : "手机号和验证码不能为空",
      });
      return;
    }

    setIsLoading(true);

    try {
      const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');

      const response = await fetch('/api/sms/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formattedPhone, code }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message);
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: result.email,
        token: result.token,
        type: 'magiclink',
      });

      if (error || !data.session) {
        console.warn("OTP verify failed, using adaptive actionLink:", error);
        console.log("Original actionLink:", result.actionLink);

        if (result.actionLink) {
          toast({
            title: result.isNewUser
              ? (lang === "en" ? "🎉 Registered!" : "🎉 注册成功！")
              : (lang === "en" ? "Signed In!" : "登录成功！"),
            description: lang === "en" ? "Completing sign in..." : "正在完成登录...",
          });

          const actionUrl = new URL(result.actionLink);
          const currentOrigin = window.location.origin;
          actionUrl.searchParams.set('redirect_to', `${currentOrigin}${redirectTo}`);

          const adaptedLink = actionUrl.toString();
          console.log("Adapted link:", adaptedLink);
          window.location.href = adaptedLink;
          return;
        }

        throw new Error(lang === "en" ? "Login failed, please request a new code" : "登录验证失败，请重新获取验证码");
      }

      // OTP 验证成功
      toast({
        title: result.isNewUser
          ? (lang === "en" ? "🎉 Registered!" : "🎉 注册成功！")
          : (lang === "en" ? "Signed In!" : "登录成功！"),
        description: lang === "en" ? "Redirecting..." : "正在跳转到控制台...",
      });

      setIsLoading(false);
      window.location.replace(redirectTo);
      return;
    } catch (error: any) {
      console.error("Phone login error:", error);
      toast({
        variant: "destructive",
        title: lang === "en" ? "Verification Failed" : "验证失败",
        description: error.message || (lang === "en" ? "Code incorrect or expired" : "验证码错误或已过期"),
      });
      setIsLoading(false);
    }
  };

  // Google 登录
  const handleGoogleLogin = async () => {
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
        title: lang === "en" ? "Google Sign In Failed" : "Google 登录失败",
        description: error.message || (lang === "en" ? "Please try again" : "请稍后重试"),
      });
    }
  };

  // 根据登录方式选择处理函数
  const handleSubmit =
    loginMethod === "password" ? handlePasswordLogin : handlePhoneLogin;

  return (
    <div className="min-h-screen bg-black flex relative overflow-hidden">
      {/* 右上角语言切换 */}
      <div className="absolute top-4 right-4 z-50">
        <LangToggle />
      </div>

      {/* 1. 极致深邃的全局背景层 */}
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
        {/* 2. 左侧：高定品牌叙事区 (大屏显示) */}
        <div className="hidden lg:flex flex-col flex-1 p-12 lg:p-20 justify-center">
        <div className="max-w-xl">
          {/* Logo */}
          <span className="text-3xl font-bold text-white mb-12 block drop-shadow-[0_0_30px_rgba(16,185,129,0.4)]">
            Star Gaze<br />Cultural Media
          </span>
          
          {/* 大标题 */}
          <h1 className="text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white/90 to-white/60">
              {lang === "en" ? (
                <>Your Exclusive AI Character,<br />Redefining Creation</>
              ) : (
                <>你的专属 AI 角色，<br />让创作从此不同</>
              )}
            </span>
          </h1>
          
          {/* 副标题 */}
          <p className="text-lg text-white/50 mb-12 leading-relaxed">
            {lang === "en"
              ? "Create a unique AI character · Produce professional short videos consistently · Elevate your content creation efficiency."
              : "创建独一无二的 AI 角色 · 持续产出专业级短视频 · 极大提升达人与电商内容创作效率。"}
          </p>

          {/* 特色胶囊 */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
              <Fingerprint className="w-4 h-4 text-[#a855f7]" />
              <span className="text-sm font-medium text-white/80">
                {lang === "en" ? "Character IP" : "角色 IP 孵化"}
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
              <Sparkles className="w-4 h-4 text-[#3b82f6]" />
              <span className="text-sm font-medium text-white/80">
                {lang === "en" ? "Cutting-edge AI" : "前沿 AI 模型"}
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
              <Globe className="w-4 h-4 text-[#10b981]" />
              <span className="text-sm font-medium text-white/80">
                {lang === "en" ? "Global Reach" : "内容链接全球"}
              </span>
            </div>
          </div>
        </div>
      </div>

        {/* 3. 右侧：交互表单区 */}
        <div className="w-full lg:w-[500px] xl:w-[600px] flex items-center justify-center p-6 sm:p-12">
        
        {/* 高定毛玻璃容器 */}
        <div className="w-full max-w-[460px] bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden group/card">
          {/* 玻璃边缘折射高光 */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-50" />
          
          {/* 移动端显示的 Logo */}
          <div className="flex justify-center mb-8 lg:hidden">
            <span className="text-xl font-bold text-white drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]">Star Gaze</span>
          </div>

          {/* 表单头部 */}
          <div className="text-center lg:text-left mb-8">
            <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
              {lang === "en" ? "Welcome Back" : "欢迎回来"}
            </h2>
            <p className="text-sm text-white/40">
              {lang === "en" ? "Sign in to your account" : "登录您的账号以继续"}
            </p>
          </div>

          {/* Google 大按钮 */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full h-12 flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-black font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.25)] mb-6"
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {lang === "en" ? "Continue with Google" : "继续使用 Google 登录"}
          </button>

          {/* 分割线 */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-white/20 text-xs tracking-widest uppercase">
              {lang === "en" ? "or" : "或者"}
            </span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          {/* 药丸式 Tab 切换 */}
          <div className="grid grid-cols-2 gap-1 mb-8 p-1 bg-black/40 rounded-xl relative">
            <button
              type="button"
              onClick={() => setLoginMethod("password")}
              className={`py-2.5 text-sm font-medium rounded-lg transition-all duration-300 z-10 ${
                loginMethod === "password" ? "text-white bg-white/10 shadow-sm" : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {lang === "en" ? "Password" : "密码登录"}
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod("phone")}
              className={`py-2.5 text-sm font-medium rounded-lg transition-all duration-300 z-10 ${
                loginMethod === "phone" ? "text-white bg-white/10 shadow-sm" : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {lang === "en" ? "Verification Code" : "验证码登录"}
            </button>
          </div>

          {/* 表单主体 */}
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              
              {/* --- 手机号验证码模式 --- */}
              {loginMethod === "phone" && (
                <>
                  <ReflectiveInput
                    icon={<Smartphone className="w-5 h-5 text-white/50" />}
                    placeholder={lang === "en" ? "Enter phone number" : "请输入手机号"}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isLoading || isSendingSms}
                  />
                  <div className="relative">
                    <ReflectiveInput
                      icon={<KeyRound className="w-5 h-5 text-white/50" />}
                      placeholder={lang === "en" ? "Enter 6-digit code" : "请输入 6 位验证码"}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      disabled={isLoading}
                      maxLength={6}
                    />
                    <button
                      type="button"
                      onClick={handleSendPhoneSms}
                      disabled={phoneCountdown > 0 || isSendingSms || !phone}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#10b981] hover:text-[#34d399] transition-colors disabled:text-white/20 disabled:cursor-not-allowed bg-black/20 px-3 py-1.5 rounded-md"
                    >
                      {isSendingSms
                        ? (lang === "en" ? "Sending..." : "发送中...")
                        : phoneCountdown > 0
                          ? `${phoneCountdown}s`
                          : (lang === "en" ? "Get Code" : "获取验证码")}
                    </button>
                  </div>
                  
                  <Button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="w-full h-12 mt-2 bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold text-[15px] rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] border-none group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {lang === "en" ? "Verifying..." : "验证中..."}
                        </>
                      ) : (
                        <>
                          {lang === "en" ? "Sign In / Register" : "登录 / 注册"}
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </span>
                  </Button>
                </>
              )}

              {/* --- 邮箱密码模式 --- */}
              {loginMethod === "password" && (
                <>
                  <ReflectiveInput
                    icon={<Mail className="w-5 h-5 text-white/50" />}
                    type="email"
                    placeholder={lang === "en" ? "Enter email address" : "请输入邮箱地址"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                  />
                  <ReflectiveInput
                    icon={<Lock className="w-5 h-5 text-white/50" />}
                    type="password"
                    placeholder={lang === "en" ? "Enter password" : "请输入密码"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                  
                  <div className="flex justify-end pt-1 pb-2">
                    <Link href="/auth/forgot-password" className="text-sm text-white/40 hover:text-[#10b981] hover:underline underline-offset-4 transition-all">
                      {lang === "en" ? "Forgot password?" : "忘记密码？"}
                    </Link>
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
                          {lang === "en" ? "Signing In..." : "登录中..."}
                        </>
                      ) : (
                        <>
                          {lang === "en" ? "Sign In" : "登 录"}
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </span>
                  </Button>
                </>
              )}

              {/* 底部链接 */}
              <div className="pt-6 text-center space-y-4">
                <p className="text-white/50 text-sm">
                  {lang === "en" ? "Don't have an account?" : "还没有账号？"}
                  <Link href="/auth/register" className="text-white hover:text-[#10b981] ml-2 font-medium transition-colors">
                    {lang === "en" ? "Sign Up" : "立即注册"}
                  </Link>
                </p>
                <p className="text-white/30 text-xs">
                  {lang === "en" ? "By signing in you agree to our" : "登录即代表您同意我们的"}
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

// 导出包装在 Suspense 中的组件
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/50">Loading...</div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
