"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    User,
    Mail,
    Phone,
    Lock,
    Bell,
    Palette,
    Shield,
    Loader2,
    Save,
    ArrowLeft,
    Check,
    X
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";

// ============================================================================
// 类型定义
// ============================================================================

interface UserProfile {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    phone?: string;
}

// ============================================================================
// Settings Page
// ============================================================================

export default function SettingsPage() {
    const router = useRouter();
    const { toast } = useToast();
    const { lang } = useLang();
    const t = lang === "en";
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const supabase = createClient();
                const { data: { user: authUser } } = await supabase.auth.getUser();

                if (!authUser) {
                    router.push("/auth/login");
                    return;
                }

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("name, avatar_url, phone")
                    .eq("id", authUser.id)
                    .single();

                const profileData = profile as { name?: string; avatar_url?: string; phone?: string } | null;

                const userData = {
                    id: authUser.id,
                    email: authUser.email || "",
                    name: profileData?.name || authUser.email?.split("@")[0] || "User",
                    avatar_url: profileData?.avatar_url || null,
                    phone: profileData?.phone || "",
                };

                setUser(userData);
                setName(userData.name);
                setPhone(userData.phone || "");
            } catch (error) {
                console.error("[SettingsPage] Failed to fetch profile:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, [router]);

    const handleSave = async () => {
        if (!user) return;

        setSaving(true);
        try {
            const supabase = createClient();
            const { error } = await supabase
                .from("profiles")
                .update({ name, phone })
                .eq("id", user.id);

            if (error) throw error;

            toast({
                title: t ? "Saved" : "保存成功",
                description: t ? "Your profile has been updated" : "您的个人信息已更新",
            });

            // Update local state
            setUser({ ...user, name, phone });
        } catch (error) {
            console.error("[SettingsPage] Save error:", error);
            toast({
                title: t ? "Save Failed" : "保存失败",
                description: t ? "Please try again" : "请稍后重试",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-mermaid-cyan" />
            </div>
        );
    }

    if (!user) {
        return null;
    }

    const settingsSections = [
        {
            id: "profile",
            title: t ? "Profile" : "个人信息",
            icon: User,
            description: t ? "Manage your basic info" : "管理您的基本资料",
        },
        {
            id: "security",
            title: t ? "Security" : "安全设置",
            icon: Lock,
            description: t ? "Password & login security" : "密码和登录安全",
            comingSoon: true,
        },
        {
            id: "notifications",
            title: t ? "Notifications" : "通知偏好",
            icon: Bell,
            description: t ? "Message notification settings" : "消息通知设置",
            comingSoon: true,
        },
        {
            id: "appearance",
            title: t ? "Appearance" : "外观主题",
            icon: Palette,
            description: t ? "UI display settings" : "界面显示设置",
            comingSoon: true,
        },
    ];

    return (
        <div className="container mx-auto max-w-4xl px-4 py-8">
            {/* Page Header */}
            <div className="mb-8 flex items-center gap-4">
                <Link
                    href="/profile"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition-all hover:border-white/20 hover:text-white"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-white">{t ? "Account Settings" : "账号设置"}</h1>
                    <p className="text-sm text-white/50">{t ? "Manage your account" : "管理您的账户信息和偏好"}</p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
                {/* Sidebar Navigation */}
                <div className="space-y-1">
                    {settingsSections.map((section) => (
                        <button
                            key={section.id}
                            disabled={section.comingSoon}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all",
                                section.id === "profile"
                                    ? "bg-mermaid-cyan/10 text-mermaid-cyan border border-mermaid-cyan/20"
                                    : section.comingSoon
                                        ? "text-white/30 cursor-not-allowed"
                                        : "text-white/60 hover:bg-white/5 hover:text-white"
                            )}
                        >
                            <section.icon className="h-4 w-4" />
                            <span className="flex-1">{section.title}</span>
                            {section.comingSoon && (
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                                    {t ? "Soon" : "即将推出"}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Main Content */}
                <div className="rounded-2xl border border-white/10 bg-[#0B0C10]/80 p-6 backdrop-blur-xl">
                    <h2 className="mb-6 text-lg font-bold text-white">{t ? "Personal Info" : "个人信息"}</h2>

                    <div className="space-y-6">
                        {/* Avatar Section */}
                        <div className="flex items-center gap-4">
                            <div className="relative h-20 w-20 overflow-hidden rounded-2xl ring-1 ring-white/20">
                                {user.avatar_url ? (
                                    <img
                                        src={user.avatar_url}
                                        alt={user.name}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-mermaid-cyan to-mermaid-pink">
                                        <User className="h-8 w-8 text-white" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
                                    disabled
                                >
                                    {t ? "Change Avatar" : "更换头像"}
                                </Button>
                                <p className="mt-1 text-xs text-white/40">{t ? "Coming soon" : "即将支持"}</p>
                            </div>
                        </div>

                        {/* Form Fields */}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-white/60">
                                    {t ? "Display Name" : "显示名称"}
                                </Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-mermaid-cyan/50"
                                    placeholder={t ? "Enter your name" : "请输入您的名称"}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-white/60">
                                    {t ? "Email" : "邮箱地址"}
                                </Label>
                                <Input
                                    id="email"
                                    value={user.email}
                                    disabled
                                    className="border-white/10 bg-white/5 text-white/50"
                                />
                                <p className="text-xs text-white/40">{t ? "Email cannot be changed" : "邮箱暂不支持修改"}</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-white/60">
                                    {t ? "Phone Number" : "手机号码"}
                                </Label>
                                <Input
                                    id="phone"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-mermaid-cyan/50"
                                    placeholder={t ? "Enter phone number" : "请输入手机号"}
                                />
                            </div>
                        </div>

                        {/* Save Button */}
                        <div className="flex justify-end border-t border-white/10 pt-6">
                            <Button
                                onClick={handleSave}
                                disabled={saving}
                                className="bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] text-black font-bold hover:opacity-90 disabled:opacity-50"
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {t ? "Saving..." : "保存中..."}
                                    </>
                                ) : (
                                    <>
                                        <Save className="mr-2 h-4 w-4" />
                                        {t ? "Save Changes" : "保存更改"}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
