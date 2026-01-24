"use client";

import { useState } from "react";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import ReflectiveInput from "@/components/ui/ReflectiveInput";
import { Button } from "@/components/ui/button";
import { Zap, Mail, Lock, Phone, Smartphone, ArrowRight, Github, Chrome } from "lucide-react";

export default function LoginDesignPreview() {
    const [loginMethod, setLoginMethod] = useState<"password" | "phone">("phone");
    const [phone, setPhone] = useState("");
    const [code, setCode] = useState("");

    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Atmosphere */}
            <div className="absolute inset-0">
                <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#00ff9d]/[0.05] rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-[440px] relative z-10">
                <ReflectiveCard
                    className="py-8 px-10 login-expand"
                >
                    {/* Header */}
                    <div className="flex flex-col items-center mb-10">
                        {/* Logo Section */}
                        <div className="flex items-center justify-center gap-3 mb-6">
                            <div className="flex items-baseline relative">
                                <span className="text-4xl font-black tracking-tighter text-white">Tory</span>
                                <span className="text-4xl font-black tracking-tighter text-[#00ff9d]">X</span>
                                {/* Decorative dot */}
                                <div className="absolute -right-2 top-1 w-1.5 h-1.5 bg-[#00ff9d] rounded-full animate-pulse" />
                            </div>
                            <div className="h-6 w-[1px] bg-white/10 mx-1" /> {/* Divider */}
                            <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/5 text-white/50 border border-white/10 tracking-widest uppercase">
                                AI Edition
                            </div>
                        </div>

                        {/* Title Section */}
                        <div className="text-center space-y-2">
                            <h1 className="text-2xl font-bold text-white tracking-wide">Welcome Back</h1>
                            <p className="text-xs text-white/30 uppercase tracking-[0.2em] font-light">
                                Intelligent Content Creation
                            </p>
                        </div>
                    </div>

                    {/* Login Method Tabs */}
                    <div className="grid grid-cols-2 gap-2 mb-8 p-1 bg-white/5 rounded-lg border border-white/10">
                        <button
                            onClick={() => setLoginMethod("phone")}
                            className={`py-2.5 text-sm font-medium rounded-md transition-all duration-300 ${loginMethod === "phone"
                                ? "bg-white text-black shadow-lg"
                                : "text-white/50 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            手机验证码
                        </button>
                        <button
                            onClick={() => setLoginMethod("password")}
                            className={`py-2.5 text-sm font-medium rounded-md transition-all duration-300 ${loginMethod === "password"
                                ? "bg-white text-black shadow-lg"
                                : "text-white/50 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            密码登录
                        </button>
                    </div>

                    {/* Form Content */}
                    <div className="space-y-6 pb-2">
                        {loginMethod === "phone" ? (
                            <>
                                <ReflectiveInput
                                    icon={<Smartphone className="w-5 h-5" />}
                                    placeholder="请输入手机号"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                />
                                <div className="relative">
                                    <ReflectiveInput
                                        icon={<Lock className="w-5 h-5" />}
                                        placeholder="请输入验证码"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                    />
                                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#00ff9d] hover:text-[#4dffbd] transition-colors">
                                        获取验证码
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <ReflectiveInput
                                    icon={<Mail className="w-5 h-5" />}
                                    placeholder="hello@example.com"
                                />
                                <ReflectiveInput
                                    icon={<Lock className="w-5 h-5" />}
                                    type="password"
                                    placeholder="••••••••"
                                />
                            </>
                        )}

                        {/* Main Action Button */}
                        <Button className="w-full h-12 bg-white hover:bg-white/90 text-black font-bold text-base rounded-xl transition-all duration-300 hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.2)] mt-2 group relative overflow-hidden">
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                {loginMethod === "phone" ? "登录 / 注册" : "登 录"}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </span>
                        </Button>

                        {/* Divider */}
                        <div className="relative flex py-2 items-center">
                            <div className="flex-grow border-t border-white/10"></div>
                            <span className="flex-shrink mx-4 text-white/20 text-xs uppercase tracking-widest">Or continue with</span>
                            <div className="flex-grow border-t border-white/10"></div>
                        </div>

                        {/* Social Login */}
                        <div className="grid grid-cols-2 gap-4">
                            <button className="h-10 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/80 transition-all text-sm font-medium group">
                                <Github className="w-4 h-4 group-hover:text-white" />
                                GitHub
                            </button>
                            <button className="h-10 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/80 transition-all text-sm font-medium group">
                                <Chrome className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                                Google
                            </button>
                        </div>

                        {/* Footer */}
                        <div className="text-center mt-6">
                            <p className="text-white/40 text-xs">
                                登录即代表您同意
                                <a href="#" className="text-white/60 hover:text-[#00ff9d] mx-1 transition-colors underline decoration-white/20 underline-offset-4">服务条款</a>
                                和
                                <a href="#" className="text-white/60 hover:text-[#00ff9d] mx-1 transition-colors underline decoration-white/20 underline-offset-4">隐私政策</a>
                            </p>
                        </div>
                    </div>
                </ReflectiveCard>
            </div>
        </div>
    );
}
