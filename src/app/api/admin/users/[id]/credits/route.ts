import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

// ============================================================================
// Admin API: Get User Credit Transactions
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
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const userId = params.id;
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limit = parseInt(searchParams.get("limit") || "50");
        const type = searchParams.get("type"); // 'purchase' | 'consume' | 'refund' | 'bonus' | null

        // Build query
        let query = supabase
            .from("credit_transactions")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (type) {
            query = query.eq("type", type);
        }

        // Pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to);

        const { data, count, error } = await query;

        if (error) {
            console.error("[Admin API] Get credit transactions error:", error);
            return NextResponse.json(
                { error: "Failed to fetch credit transactions" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            transactions: data || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    } catch (error) {
        console.error("[Admin API] Get user credit transactions error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
