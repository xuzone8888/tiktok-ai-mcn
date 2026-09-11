import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

// ============================================================================
// Admin API: Get User Detail with Activity Stats
// ============================================================================

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // 鉴权：验证管理员身份
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const supabase = createAdminClient();
        const { id: userId } = await params;

        // 1. Get user profile
        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();

        if (profileError || !profile) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 404 }
            );
        }

        // 2. Get generation stats
        const { data: generations, error: genError } = await supabase
            .from("generations")
            .select("id, type, status, created_at")
            .eq("user_id", userId);

        const generationStats = {
            total: generations?.length || 0,
            video: generations?.filter(g => g.type === "video").length || 0,
            image: generations?.filter(g => g.type === "image").length || 0,
            completed: generations?.filter(g => g.status === "completed").length || 0,
            failed: generations?.filter(g => g.status === "failed").length || 0,
        };

        // 3. Get TikTok accounts count
        const { count: tiktokAccountsCount } = await supabase
            .from("tiktok_accounts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);

        // 4. Get publish tasks count
        const { count: publishTasksCount } = await supabase
            .from("publish_tasks")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);

        // 5. Get credit transactions summary
        const { data: creditTx } = await supabase
            .from("credit_transactions")
            .select("type, amount")
            .eq("user_id", userId);

        const creditStats = {
            totalSpent: creditTx?.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0,
            totalEarned: creditTx?.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0) || 0,
            transactionCount: creditTx?.length || 0,
        };

        // 6. Get contracts count
        const { count: contractsCount } = await supabase
            .from("contracts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);

        return NextResponse.json({
            user: profile,
            stats: {
                generations: generationStats,
                tiktokAccounts: tiktokAccountsCount || 0,
                publishTasks: publishTasksCount || 0,
                credits: creditStats,
                contracts: contractsCount || 0,
            },
        });
    } catch (error) {
        console.error("[Admin API] Get user detail error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
