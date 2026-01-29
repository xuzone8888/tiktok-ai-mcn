import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Admin API: Get User TikTok Accounts
// ============================================================================

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const userId = params.id;

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
        const accountsWithStatus = (data || []).map(account => ({
            ...account,
            tokenExpired: new Date(account.token_expires_at) < new Date(),
        }));

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
