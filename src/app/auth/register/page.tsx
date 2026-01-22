"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Loader2, Zap, Mail, Lock, Eye, EyeOff, User, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

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

      if (error) {
        throw error;
      }

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
          // 不阻止注册流程
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

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black p-4">
        <Card className="w-full max-w-md border-white/10 bg-black/60 backdrop-blur-xl">
          <CardContent className="pt-10 pb-10 text-center space-y-6">
            <div className="flex justify-center">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center animate-bounce">
                <Mail className="h-10 w-10 text-white" />
              </div>
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-bold text-white">📧 请验证邮箱</h2>
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-amber-200 text-sm font-medium">
                  ⚠️ 重要提示：您必须点击邮件中的确认链接才能登录
                </p>
              </div>
              <p className="text-muted-foreground">
                验证邮件已发送至：
              </p>
              <p className="text-tiktok-cyan font-semibold text-lg break-all">
                {email}
              </p>
            </div>
            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-left space-y-2">
                <p className="text-sm text-muted-foreground">📋 验证步骤：</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>打开您的邮箱（包括垃圾邮件文件夹）</li>
                  <li>找到来自 ToryX 的验证邮件</li>
                  <li>点击邮件中的 &ldquo;确认邮箱&rdquo; 链接</li>
                  <li>验证成功后即可登录</li>
                </ol>
              </div>
              <Button
                onClick={() => router.push("/auth/login")}
                className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
              >
                我已验证，前往登录
              </Button>
              <p className="text-xs text-muted-foreground">
                💡 没有收到邮件？请检查垃圾邮件文件夹，或等待1-2分钟后刷新邮箱
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black p-4">
      {/* 背景动效 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-tiktok-pink/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-tiktok-cyan/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <Card className="w-full max-w-md relative z-10 border-white/10 bg-black/60 backdrop-blur-xl">
        <CardHeader className="text-center space-y-4">
          {/* Logo */}
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-tiktok-pink via-purple-500 to-tiktok-cyan flex items-center justify-center shadow-2xl">
              <Zap className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-tiktok-pink to-tiktok-cyan bg-clip-text text-transparent">
              创建账号
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              加入 ToryX 开始创作
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleRegister}>
          <CardContent className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm text-muted-foreground">
                用户名
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="您的用户名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10 bg-white/5 border-white/10 focus:border-tiktok-pink"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground">
                邮箱地址
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-white/5 border-white/10 focus:border-tiktok-pink"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-muted-foreground">
                密码
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="至少6个字符"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-tiktok-pink"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm text-muted-foreground">
                确认密码
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 bg-white/5 border-white/10 focus:border-tiktok-pink"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Bonus Info */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10 border border-white/10">
              <p className="text-sm text-center">
                🎁 新用户注册即送 <span className="text-tiktok-cyan font-bold">100 积分</span>
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-gradient-to-r from-tiktok-pink to-tiktok-cyan text-black font-semibold hover:opacity-90 transition-opacity"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  注册中...
                </>
              ) : (
                "立即注册"
              )}
            </Button>

            {/* Login Link */}
            <p className="text-sm text-muted-foreground text-center">
              已有账号？{" "}
              <Link href="/auth/login" className="text-tiktok-cyan hover:underline font-medium">
                立即登录
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

