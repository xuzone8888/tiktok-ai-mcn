import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CreditTransactionType } from "@/types/database";

// ============================================================================
// Admin API: Get User Credit Transactions
// ============================================================================

const CREDIT_TRANSACTION_TYPES = new Set<CreditTransactionType>([
    "purchase",
    "consume",
    "refund",
    "bonus",
    "expire",
]);

function isCreditTransactionType(value: string): value is CreditTransactionType {
    return CREDIT_TRANSACTION_TYPES.has(value as CreditTransactionType);
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireAdmin();
        if (auth.error) return auth.error;

        const { id: userId } = await params;
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limit = parseInt(searchParams.get("limit") || "50");
        const type = searchParams.get("type"); // 'purchase' | 'consume' | 'refund' | 'bonus' | null
        if (type && !isCreditTransactionType(type)) {
            return NextResponse.json(
                { error: "Unsupported credit transaction type" },
                { status: 400 }
            );
        }

        // Build query
        let query = supabase
            .from("credit_transactions")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (type && isCreditTransactionType(type)) {
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
