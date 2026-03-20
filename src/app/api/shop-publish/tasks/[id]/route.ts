// @ts-nocheck — shop_publish tables pending migration to database.ts
// Shop publish task detail — GET single task + items, DELETE task
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: Get task details with all items
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch task (RLS ensures user can only see their own)
        const { data: task, error: taskError } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型
            .from('shop_publish_tasks')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (taskError || !task) {
            return NextResponse.json(
                { error: 'Task not found' },
                { status: 404 }
            );
        }

        // Fetch all items for this task
        const { data: items, error: itemsError } = await supabase
            .from('shop_publish_task_items')
            .select('*')
            .eq('task_id', id)
            .order('created_at', { ascending: true });

        if (itemsError) {
            console.error('Error fetching task items:', itemsError);
            return NextResponse.json(
                { error: 'Failed to fetch task items' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            task,
            items: items || [],
        });
    } catch (error) {
        console.error('Error in Shop task GET:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// DELETE: Delete a task (CASCADE removes items automatically)
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Delete task (CASCADE will auto-delete all items)
        const { error: deleteError } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型
            .from('shop_publish_tasks')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id); // RLS + explicit user check

        if (deleteError) {
            console.error('Error deleting Shop task:', deleteError);
            return NextResponse.json(
                { error: 'Failed to delete task' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error in Shop task DELETE:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
