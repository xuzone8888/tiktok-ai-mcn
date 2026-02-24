/**
 * Admin API 鉴权工具
 * 
 * 提供统一的管理员身份验证函数，用于保护所有 /api/admin/* 路由。
 * 
 * 使用方法:
 *   const auth = await requireAdmin();
 *   if (auth.error) return auth.error;
 *   const { user, profile } = auth;
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin, type UserRole } from "@/lib/admin";

export interface AdminAuthSuccess {
    user: { id: string; email?: string };
    profile: {
        id: string;
        email: string;
        name: string | null;
        role: UserRole;
        credits: number;
    };
    error?: never;
}

export interface AdminAuthError {
    error: NextResponse;
    user?: never;
    profile?: never;
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthError;

/**
 * 验证当前请求是否来自已登录的管理员用户。
 * 
 * 流程:
 * 1. 从 cookie 获取 Supabase session
 * 2. 调用 getUser() 验证身份
 * 3. 查询 profiles 表获取角色
 * 4. 检查是否为 admin 或 super_admin
 * 
 * @returns AdminAuthSuccess (包含 user 和 profile) 或 AdminAuthError (包含 NextResponse)
 */
export async function requireAdmin(): Promise<AdminAuthResult> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return {
                error: NextResponse.json(
                    { success: false, error: "未登录" },
                    { status: 401 }
                ),
            };
        }

        // 使用 admin client 查询 profile（绕过 RLS 确保能读到角色信息）
        const adminClient = createAdminClient();
        const { data: profileData, error: profileError } = await adminClient
            .from("profiles")
            .select("id, email, name, role, credits")
            .eq("id", user.id)
            .single();

        // 显式类型转换（Database types 与实际 schema 不匹配，将在阶段二修复）
        const profile = profileData as { id: string; email: string; name: string | null; role: string; credits: number } | null;

        if (profileError || !profile) {
            return {
                error: NextResponse.json(
                    { success: false, error: "用户资料不存在" },
                    { status: 403 }
                ),
            };
        }

        if (!isAdmin(profile.role as UserRole)) {
            return {
                error: NextResponse.json(
                    { success: false, error: "需要管理员权限" },
                    { status: 403 }
                ),
            };
        }

        return {
            user: { id: user.id, email: user.email },
            profile: {
                id: profile.id,
                email: profile.email || "",
                name: profile.name || null,
                role: profile.role as UserRole,
                credits: profile.credits || 0,
            },
        };
    } catch (error) {
        console.error("[Admin Auth] 鉴权异常:", error);
        return {
            error: NextResponse.json(
                { success: false, error: "鉴权服务异常" },
                { status: 500 }
            ),
        };
    }
}
