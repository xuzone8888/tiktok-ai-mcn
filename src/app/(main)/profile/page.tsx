"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    User,
    Mail,
    Shield,
    Zap,
    Settings,
    KeyRound,
    CreditCard,
    History,
    ChevronRight,
    Loader2,
    UserCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { type UserRole, isAdmin } from "@/lib/admin";

// ============================================================================
// 类型定义
// ============================================================================

interface UserProfile {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    role: UserRole;
    credits: number;
    created_at?: string;
}

// ============================================================================
// Profile Page
// ============================================================================

export default function ProfilePage() {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const supabase = createClient();
                const { data: { user: authUser } } = await supabase.auth.getUser();

                if (!authUser) {
                    setLoading(false);
                    return;
                }

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("name, avatar_url, role, credits, created_at")
                    .eq("id", authUser.id)
                    .single();

                const profileData = profile as { name?: string; avatar_url?: string; role?: string; credits?: number; created_at?: string } | null;

                setUser({
                    id: authUser.id,
                    email: authUser.email || "",
                    name: profileData?.name || authUser.email?.split("@")[0] || "User",
                    avatar_url: profileData?.avatar_url || null,
                    role: (profileData?.role as UserRole) || "user",
                    credits: profileData?.credits ?? 0,
                    created_at: profileData?.created_at,
                });
            } catch (error) {
                console.error("[ProfilePage] Failed to fetch profile:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, []);

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-mermaid-cyan" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <UserCircle className="h-16 w-16 text-white/20" />
                <p className="text-white/50">请先登录</p>
                <Link
                    href="/auth/login"
                    className="rounded-full bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] px-6 py-2 font-bold text-black transition-transform hover:scale-105"
                >
                    去登录
                </Link>
            </div>
        );
    }

    const quickLinks = [
        {
            title: "账号设置",
            description: "修改密码、绑定手机等",
            href: "/settings",
            icon: Settings,
            color: "from-[#00F2EA] to-[#00F2EA]/50",
        },
        {
            title: "积分明细",
            description: "查看积分消费记录",
            href: "/settings?tab=credits",
            icon: History,
            color: "from-[#CCFF00] to-[#CCFF00]/50",
        },
        {
            title: "API 密钥",
            description: "管理开发者密钥",
            href: "/settings?tab=api",
            icon: KeyRound,
            color: "from-[#EC4899] to-[#EC4899]/50",
        },
        {
            title: "充值中心",
            description: "购买更多积分",
            href: "/settings?tab=billing",
            icon: CreditCard,
            color: "from-[#8B5CF6] to-[#8B5CF6]/50",
        },
    ];

    return (
        <div className="container mx-auto max-w-4xl px-4 py-8">
            {/* Page Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">个人中心</h1>
                <p className="text-sm text-white/50">管理您的账户信息和偏好设置</p>
            </div>

            {/* User Profile Card */}
            <div className="relative mb-8 overflow-hidden rounded-2xl border border-white/10 bg-[#0B0C10]/80 p-6 backdrop-blur-xl">
                {/* Ambient Glow */}
                <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-mermaid-cyan/10 blur-3xl" />
                <div className="absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-mermaid-pink/10 blur-3xl" />

                <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
                    {/* Avatar */}
                    <div className={cn(
                        "relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl",
                        isAdmin(user.role)
                            ? "ring-2 ring-[#CCFF00]/50 shadow-[0_0_20px_rgba(204,255,0,0.3)]"
                            : "ring-1 ring-white/20"
                    )}>
                        {user.avatar_url ? (
                            <img
                                src={user.avatar_url}
                                alt={user.name}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-mermaid-cyan to-mermaid-pink">
                                <User className="h-10 w-10 text-white" />
                            </div>
                        )}
                        {isAdmin(user.role) && (
                            <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0B0C10] bg-[#CCFF00] shadow-[0_0_8px_rgba(204,255,0,0.6)]">
                                <Shield className="h-3 w-3 text-black" />
                            </div>
                        )}
                    </div>

                    {/* User Info */}
                    <div className="flex-1 space-y-3">
                        <div>
                            <h2 className="text-xl font-bold text-white">{user.name}</h2>
                            <div className="mt-1 flex items-center gap-2 text-sm text-white/50">
                                <Mail className="h-4 w-4" />
                                <span>{user.email}</span>
                            </div>
                        </div>

                        {/* Role Badge */}
                        <div className="flex items-center gap-3">
                            <span className={cn(
                                "rounded-full px-3 py-1 text-xs font-bold",
                                user.role === "super_admin"
                                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                    : user.role === "admin"
                                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                        : "bg-white/10 text-white/60 border border-white/10"
                            )}>
                                {user.role === "super_admin" ? "超级管理员" : user.role === "admin" ? "管理员" : "普通用户"}
                            </span>
                        </div>
                    </div>

                    {/* Credits Display */}
                    <div className="shrink-0 rounded-2xl border border-white/10 bg-black/40 p-4 text-center sm:text-right">
                        <div className="text-xs font-medium uppercase tracking-wider text-white/40">当前积分</div>
                        <div className="mt-1 flex items-center justify-center gap-2 sm:justify-end">
                            <Zap className="h-5 w-5 fill-[#CCFF00]/20 text-[#CCFF00]" />
                            <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
                                {user.credits.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Links Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
                {quickLinks.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className="group relative overflow-hidden rounded-xl border border-white/10 bg-[#0B0C10]/60 p-5 transition-all duration-300 hover:border-white/20 hover:bg-white/5"
                    >
                        {/* Icon */}
                        <div className={cn(
                            "mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br",
                            link.color
                        )}>
                            <link.icon className="h-5 w-5 text-white" />
                        </div>

                        {/* Text */}
                        <h3 className="font-bold text-white group-hover:text-mermaid-cyan transition-colors">
                            {link.title}
                        </h3>
                        <p className="mt-1 text-sm text-white/40">{link.description}</p>

                        {/* Arrow */}
                        <ChevronRight className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-white/50" />
                    </Link>
                ))}
            </div>
        </div>
    );
}
