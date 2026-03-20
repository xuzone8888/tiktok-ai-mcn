// Trigger the Shop publish processor to execute pending tasks
// POST: start processing pending task items
// In the future, this can be called by a cron job

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
    try {
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Check if user has any pending tasks
        const { data: pendingTasks, error: queryError } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型定义
            .from('shop_publish_tasks')
            .select('id')
            .eq('user_id', user.id)
            .eq('status', 'pending');

        if (queryError) {
            console.error('Error querying pending tasks:', queryError);
            return NextResponse.json(
                { error: 'Failed to query pending tasks' },
                { status: 500 }
            );
        }

        if (!pendingTasks || pendingTasks.length === 0) {
            return NextResponse.json({
                message: 'No pending tasks to process',
                processed: 0,
            });
        }

        // Import and invoke the processor
        // ⚠️ shop-publish-processor.ts will be created in Cycle C
        // For now, we mark tasks as processing and return
        // The actual processor logic will be implemented in Cycle C
        const taskIds = pendingTasks.map(t => t.id);

        // Mark tasks as processing
        const { error: updateError } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型定义
            .from('shop_publish_tasks')
            .update({
                status: 'processing',
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .in('id', taskIds);

        if (updateError) {
            console.error('Error updating task status:', updateError);
            return NextResponse.json(
                { error: 'Failed to start processing' },
                { status: 500 }
            );
        }

        // Invoke the processor asynchronously (fire-and-forget).
        // Each task is processed independently in the background.
        // The client can poll task status via GET /api/shop-publish/tasks/[id].
        const { processShopPublishTask } = await import('@/lib/shop-publish-processor');

        for (const taskId of taskIds) {
            // Fire-and-forget: don't await, let it run in the background
            processShopPublishTask(taskId).catch(err => {
                console.error(`[Process Route] Background processing failed for task ${taskId}:`, err);
            });
        }

        return NextResponse.json({
            message: `Started processing ${taskIds.length} task(s)`,
            task_ids: taskIds,
            processed: taskIds.length,
        });
    } catch (error) {
        console.error('Error in Shop process trigger:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to trigger processing' },
            { status: 500 }
        );
    }
}
