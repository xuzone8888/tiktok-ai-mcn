"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Zap, Mail, Lock, Smartphone, ArrowRight, Github, Chrome, Loader2, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// 包装组件以支持 useSearchParams
function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // 获取重定向目标
  const redirectTo = searchParams.get('redirect') || '/dashboard';

  // 登录方式: password (密码登录) | phone (手机验证码) | email (邮箱验证码)
  const [loginMethod, setLoginMethod] = useState<"password" | "phone" | "email">("password");

  // 表单状态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpEmail, setOtpEmail] = useState(""); // 用于邮箱验证码的邮箱

  // OTP 流程状态
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  // 倒计时效果
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 处理 URL hash 中的 auth token（从 Supabase magic link 回调）
  useEffect(() => {
    const handleAuthCallback = async () => {
      // 检查 URL hash 中是否有 access_token
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        console.log("Detected auth callback with tokens in URL hash");

        // 解析 hash 中的参数
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          try {
            const supabase = createClient();

            // 使用 token 设置 session
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error) {
              console.error("Failed to set session:", error);
              toast({
                variant: "destructive",
                title: "登录失败",
                description: "Session 设置失败，请重试",
              });
              // 清除 URL hash
              window.history.replaceState(null, '', window.location.pathname);
              return;
            }

            if (data.session) {
              toast({
                title: "🎉 登录成功！",
                description: "正在跳转到控制台...",
              });

              // 跳转到目标页面
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

  // 发送邮箱验证码
  const handleSendEmailOtp = async () => {
    if (!otpEmail) {
      toast({
        variant: "destructive",
        title: "请输入邮箱",
        description: "邮箱地址不能为空",
      });
      return;
    }

    // 简单的邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(otpEmail)) {
      toast({
        variant: "destructive",
        title: "邮箱格式错误",
        description: "请输入正确的邮箱地址",
      });
      return;
    }

    setIsSendingOtp(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: otpEmail,
        options: {
          shouldCreateUser: true, // 如果用户不存在，自动创建
        },
      });

      if (error) throw error;

      setOtpSent(true);
      setCountdown(60); // 60秒倒计时
      toast({
        title: "✅ 验证码已发送",
        description: `请查看 ${otpEmail} 收件箱`,
      });
    } catch (error: any) {
      console.error("Send OTP error:", error);
      toast({
        variant: "destructive",
        title: "发送失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // 验证邮箱验证码登录
  const handleEmailOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!otpEmail || !code) {
      toast({
        variant: "destructive",
        title: "请填写完整信息",
        description: "邮箱和验证码不能为空",
      });
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: otpEmail,
        token: code,
        type: "email",
      });

      if (error) throw error;

      if (data.user) {
        // 检查是否需要创建 profile
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", data.user.id)
          .single();

        if (!profileData) {
          // 新用户，创建 profile
          await supabase.from("profiles").insert({
            id: data.user.id,
            email: data.user.email!,
            name: data.user.email?.split("@")[0] || "用户",
            role: "user",
            credits: 100, // 新用户赠送积分
          });
        }

        toast({
          title: "🎉 登录成功！",
          description: "正在跳转到控制台...",
        });
        setTimeout(() => {
          window.location.href = redirectTo;
        }, 500);
      }
    } catch (error: any) {
      console.error("Verify OTP error:", error);
      toast({
        variant: "destructive",
        title: "验证失败",
        description: error.message || "验证码错误或已过期",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 密码登录处理
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({
        variant: "destructive",
        title: "请填写完整信息",
        description: "邮箱和密码不能为空",
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
          title: "登录成功！",
          description: "正在跳转到控制台...",
        });
        setTimeout(() => {
          window.location.href = redirectTo;
        }, 500);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      toast({
        variant: "destructive",
        title: "登录失败",
        description: error.message || "请检查邮箱和密码是否正确",
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
        title: "请输入手机号",
        description: "手机号不能为空",
      });
      return;
    }

    // 格式化并验证手机号
    const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');
    if (!/^1[3-9]\d{9}$/.test(formattedPhone)) {
      toast({
        variant: "destructive",
        title: "手机号格式错误",
        description: "请输入正确的11位手机号",
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
        title: "✅ 验证码已发送",
        description: `请查看手机 ${formattedPhone.slice(0, 3)}****${formattedPhone.slice(-4)} 短信`,
      });
    } catch (error: any) {
      console.error("Send SMS error:", error);
      toast({
        variant: "destructive",
        title: "发送失败",
        description: error.message || "请稍后重试",
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
        title: "请填写完整信息",
        description: "手机号和验证码不能为空",
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

      // 使用返回的 token 登录
      const supabase = createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: result.email,
        token: result.token,
        type: 'magiclink',
      });

      if (error || !data.session) {
        // OTP 验证失败，使用 actionLink 作为备选方案
        // 但要把 redirect_to 参数改成当前环境的域名
        console.warn("OTP verify failed, using adaptive actionLink:", error);
        console.log("Original actionLink:", result.actionLink);

        if (result.actionLink) {
          toast({
            title: result.isNewUser ? "🎉 注册成功！" : "登录成功！",
            description: "正在完成登录...",
          });

          // 只修改 redirect_to 参数，保持 Supabase 的 auth 域名不变
          const actionUrl = new URL(result.actionLink);
          const currentOrigin = window.location.origin;

          // 更新 redirect_to 参数为当前域名 + 目标页面
          actionUrl.searchParams.set('redirect_to', `${currentOrigin}${redirectTo}`);

          const adaptedLink = actionUrl.toString();
          console.log("Adapted link:", adaptedLink);
          window.location.href = adaptedLink;
          return;
        }

        throw new Error("登录验证失败，请重新获取验证码");
      }

      // OTP 验证成功
      toast({
        title: result.isNewUser ? "🎉 注册成功！" : "登录成功！",
        description: "正在跳转到控制台...",
      });

      setIsLoading(false);
      window.location.replace(redirectTo);
      return;
    } catch (error: any) {
      console.error("Phone login error:", error);
      toast({
        variant: "destructive",
        title: "验证失败",
        description: error.message || "验证码错误或已过期",
      });
      setIsLoading(false);
    }
  };

  // 根据登录方式选择处理函数
  const handleSubmit =
    loginMethod === "email" ? handleEmailOtpLogin :
      loginMethod === "password" ? handlePasswordLogin :
        handlePhoneLogin;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#00ff9d]/[0.05] rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[460px] relative z-10">
        <ReflectiveCard className="py-8 px-10 login-expand">
          {/* Header - Premium ToryX Logo */}
          <div className="flex flex-col items-center mb-6">
            <img
              src="/images/toryx_logo_icon.png"
              alt="ToryX Logo"
              className="w-16 h-16 mb-2 mt-4 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            />
            <div className="flex items-baseline mb-1">
              <span
                className="text-[32px] font-semibold tracking-[-0.02em]"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 25%, #c0c0c0 50%, #a0a0a0 75%, #d0d0d0 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                }}
              >
                Tory
              </span>
              <span
                className="text-[32px] font-black tracking-[-0.02em] ml-[-1px]"
                style={{
                  background: 'linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 0 16px rgba(16,185,129,0.4))',
                }}
              >
                X
              </span>
            </div>
            <span className="text-xs text-white/30 tracking-[0.15em] uppercase">
              AI 内容智造工厂
            </span>
          </div>

          {/* Login Method Tabs - 3 Options */}
          <div className="grid grid-cols-3 gap-1 mb-6 p-1.5 bg-white/5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setLoginMethod("password")}
              className={`py-3.5 text-sm font-medium rounded-lg transition-all duration-300 ${loginMethod === "password"
                ? "bg-white text-black shadow-lg"
                : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
            >
              密码登录
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod("phone")}
              className={`py-3.5 text-sm font-medium rounded-lg transition-all duration-300 ${loginMethod === "phone"
                ? "bg-white text-black shadow-lg"
                : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
            >
              手机验证码
            </button>
            <button
              type="button"
              onClick={() => { setLoginMethod("email"); setOtpSent(false); setCode(""); }}
              className={`py-3.5 text-sm font-medium rounded-lg transition-all duration-300 ${loginMethod === "email"
                ? "bg-white text-black shadow-lg"
                : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
            >
              邮箱验证码
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 pb-2">
              {/* 邮箱验证码登录 */}
              {loginMethod === "email" && (
                <>
                  <ReflectiveInput
                    icon={<Mail className="w-5 h-5" />}
                    type="email"
                    placeholder="请输入邮箱"
                    value={otpEmail}
                    onChange={(e) => setOtpEmail(e.target.value)}
                    disabled={isLoading || isSendingOtp}
                  />
                  {otpSent && (
                    <div className="relative">
                      <ReflectiveInput
                        icon={<KeyRound className="w-5 h-5" />}
                        placeholder="请输入6位验证码"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        disabled={isLoading}
                        maxLength={6}
                      />
                    </div>
                  )}
                  {!otpSent ? (
                    <Button
                      type="button"
                      onClick={handleSendEmailOtp}
                      disabled={isSendingOtp || !otpEmail}
                      className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] group border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="flex items-center justify-center gap-2">
                        {isSendingOtp ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            发送中...
                          </>
                        ) : (
                          <>
                            发送验证码
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </>
                        )}
                      </span>
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="submit"
                        disabled={isLoading || code.length !== 6}
                        className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] group border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="flex items-center justify-center gap-2">
                          {isLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              验证中...
                            </>
                          ) : (
                            <>
                              验证并登录
                              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </>
                          )}
                        </span>
                      </Button>
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={handleSendEmailOtp}
                          disabled={countdown > 0 || isSendingOtp}
                          className="text-xs text-white/40 hover:text-[#10b981] transition-colors disabled:cursor-not-allowed"
                        >
                          {countdown > 0 ? `${countdown}秒后可重新发送` : "重新发送验证码"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* 手机验证码登录 */}
              {loginMethod === "phone" && (
                <>
                  <ReflectiveInput
                    icon={<Smartphone className="w-5 h-5" />}
                    placeholder="请输入手机号"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isLoading || isSendingSms}
                  />
                  <div className="relative">
                    <ReflectiveInput
                      icon={<KeyRound className="w-5 h-5" />}
                      placeholder="请输入6位验证码"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      disabled={isLoading}
                      maxLength={6}
                    />
                    <button
                      type="button"
                      onClick={handleSendPhoneSms}
                      disabled={phoneCountdown > 0 || isSendingSms || !phone}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#10b981] hover:text-[#34d399] transition-colors disabled:text-white/30 disabled:cursor-not-allowed"
                    >
                      {isSendingSms ? "发送中..." : phoneCountdown > 0 ? `${phoneCountdown}s` : "获取验证码"}
                    </button>
                  </div>
                  <Button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] mt-2 group border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          验证中...
                        </>
                      ) : (
                        <>
                          登录 / 注册
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </span>
                  </Button>
                </>
              )}

              {/* 密码登录 */}
              {loginMethod === "password" && (
                <>
                  <ReflectiveInput
                    icon={<Mail className="w-5 h-5" />}
                    type="email"
                    placeholder="请输入邮箱"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                  />
                  <ReflectiveInput
                    icon={<Lock className="w-5 h-5" />}
                    type="password"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-12 bg-gradient-to-b from-white to-gray-100 hover:to-white text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] mt-2 group border-t border-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          登录中...
                        </>
                      ) : (
                        <>
                          登 录
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </span>
                  </Button>
                </>
              )}

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

              {/* Register Link */}
              <div className="text-center mt-2">
                <p className="text-white/50 text-sm">
                  还没有账号？
                  <Link href="/auth/register" className="text-[#10b981] hover:text-[#34d399] ml-1 font-medium transition-colors">
                    立即注册
                  </Link>
                </p>
              </div>

              {/* Footer */}
              <div className="text-center mt-4">
                <p className="text-white/30 text-xs">
                  登录即代表您同意
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
        </ReflectiveCard >
      </div >
    </div >
  );
}

// 导出包装在 Suspense 中的组件
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/50">加载中...</div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
