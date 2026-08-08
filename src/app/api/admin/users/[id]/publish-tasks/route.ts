import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

// ============================================================================
// Admin API: Get User Publish Tasks
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
        const limit = parseInt(searchParams.get("limit") || "20");

        // Get publish tasks with pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data: tasks, count, error } = await supabase
            .from("publish_tasks")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .range(from, to);

        if (error) {
            console.error("[Admin API] Get publish tasks error:", error);
            return NextResponse.json(
                { error: "Failed to fetch publish tasks" },
                { status: 500 }
            );
        }

        // Get task items for each task
        const taskIds = (tasks || []).map(t => t.id);
        const { data: items } = await supabase
            .from("publish_task_items")
            .select("*")
            .in("task_id", taskIds.length > 0 ? taskIds : ["00000000-0000-0000-0000-000000000000"]);

        // Group items by task
        const itemsByTask = (items || []).reduce((acc, item) => {
            if (!acc[item.task_id]) acc[item.task_id] = [];
            acc[item.task_id].push(item);
            return acc;
        }, {} as Record<string, any[]>);

        // Combine tasks with items
        const tasksWithItems = (tasks || []).map(task => ({
            ...task,
            items: itemsByTask[task.id] || [],
        }));

        return NextResponse.json({
            tasks: tasksWithItems,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    } catch (error) {
        console.error("[Admin API] Get user publish tasks error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
