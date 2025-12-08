"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Loader2, Zap, Mail, Lock, Eye, EyeOff, Video, Sparkles, Film, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// 动态背景的浮动元素
function FloatingElement({ delay, duration, icon: Icon, className }: { 
  delay: number; 
  duration: number; 
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <div 
      className={`absolute opacity-20 animate-float ${className}`}
      style={{ 
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
      }}
    >
      <Icon className="w-8 h-8 text-white/50" />
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 防止浏览器自动填充
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
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

      if (error) {
        throw error;
      }

      if (data.user) {
        toast({
          title: "登录成功！",
          description: "正在跳转到控制台...",
        });
        
        router.push("/dashboard");
        router.refresh();
      }
    } catch (error: unknown) {
      console.error("Login error:", error);
      const errorMessage = error instanceof Error ? error.message : "请检查邮箱和密码是否正确";
      toast({
        variant: "destructive",
        title: "登录失败",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black p-4 relative overflow-hidden">
      {/* 动态背景 - TikTok/AI 视频主题 */}
      <div className="absolute inset-0 overflow-hidden">
        {/* 渐变光晕 */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-tiktok-cyan/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-tiktok-pink/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
        
        {/* 网格背景 */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* 浮动视频元素 */}
        <FloatingElement icon={Video} delay={0} duration={8} className="top-[10%] left-[10%]" />
        <FloatingElement icon={Film} delay={1} duration={10} className="top-[20%] right-[15%]" />
        <FloatingElement icon={Play} delay={2} duration={7} className="bottom-[30%] left-[20%]" />
        <FloatingElement icon={Sparkles} delay={0.5} duration={9} className="bottom-[15%] right-[10%]" />
        <FloatingElement icon={Video} delay={3} duration={11} className="top-[50%] left-[5%]" />
        <FloatingElement icon={Film} delay={1.5} duration={8} className="top-[40%] right-[5%]" />
        <FloatingElement icon={Sparkles} delay={2.5} duration={10} className="bottom-[40%] right-[25%]" />
        <FloatingElement icon={Play} delay={4} duration={9} className="top-[70%] left-[30%]" />
        
        {/* 动态线条 */}
        <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f2ea" />
              <stop offset="100%" stopColor="#ff0050" />
            </linearGradient>
          </defs>
          <path 
            d="M0,100 Q250,50 500,100 T1000,100" 
            fill="none" 
            stroke="url(#lineGradient)" 
            strokeWidth="2"
            className="animate-wave"
          />
          <path 
            d="M0,200 Q250,150 500,200 T1000,200" 
            fill="none" 
            stroke="url(#lineGradient)" 
            strokeWidth="1.5"
            className="animate-wave"
            style={{ animationDelay: "0.5s" }}
          />
          <path 
            d="M0,300 Q250,250 500,300 T1000,300" 
            fill="none" 
            stroke="url(#lineGradient)" 
            strokeWidth="1"
            className="animate-wave"
            style={{ animationDelay: "1s" }}
          />
        </svg>
      </div>

      <Card className="w-full max-w-md relative z-10 border-white/10 bg-black/60 backdrop-blur-xl">
        <CardHeader className="text-center space-y-4">
          {/* Logo */}
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-tiktok-cyan via-purple-500 to-tiktok-pink flex items-center justify-center shadow-2xl">
              <Zap className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-tiktok-cyan to-tiktok-pink bg-clip-text text-transparent">
              Tok Factory
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              登录您的账号以继续
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="login-email" className="text-sm text-muted-foreground">
                邮箱地址
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                {mounted && (
                  <Input
                    id="login-email"
                    name="login-email"
                    type="email"
                    placeholder="请输入邮箱"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-white/5 border-white/10 focus:border-tiktok-cyan"
                    disabled={isLoading}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                )}
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-sm text-muted-foreground">
                密码
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                {mounted && (
                  <Input
                    id="login-password"
                    name="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-tiktok-cyan"
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Forgot Password */}
            <div className="text-right">
              <Link href="/auth/forgot-password" className="text-sm text-tiktok-cyan hover:underline">
                忘记密码？
              </Link>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90 transition-opacity"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  登录中...
                </>
              ) : (
                "登录"
              )}
            </Button>

            {/* Register Link */}
            <p className="text-sm text-muted-foreground text-center">
              还没有账号？{" "}
              <Link href="/auth/register" className="text-tiktok-pink hover:underline font-medium">
                立即注册
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

