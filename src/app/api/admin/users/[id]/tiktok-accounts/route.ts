import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Admin API: Get User TikTok Accounts
// ============================================================================

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id: userId } = await params;
        const supabase = createAdminClient();

        const { data, error } = await supabase
            .from("tiktok_accounts")
            .select(`
        id,
        open_id,
        display_name,
        avatar_url,
        follower_count,
        following_count,
        likes_count,
        video_count,
        account_type,
        status,
        token_expires_at,
        created_at,
        updated_at
      `)
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("[Admin API] Get TikTok accounts error:", error);
            return NextResponse.json(
                { error: "Failed to fetch TikTok accounts" },
                { status: 500 }
            );
        }

        // Add token status
        const accountsWithStatus = (data || []).map(account => {
            const expiresAt = account.token_expires_at
                ? Date.parse(account.token_expires_at)
                : Number.NaN;
            return {
                ...account,
                tokenExpired: !Number.isFinite(expiresAt) || expiresAt <= Date.now(),
            };
        });

        return NextResponse.json({
            accounts: accountsWithStatus,
            total: accountsWithStatus.length,
        });
    } catch (error) {
        console.error("[Admin API] Get user TikTok accounts error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
