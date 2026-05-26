import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

const ACTIVE_MULTI_TASK_STATUSES = ['pending', 'scheduled', 'running', 'partial_failed'] as const
const UNFINISHED_ITEM_STATUSES = ['pending', 'scheduled', 'processing', 'uploading'] as const

export interface ActiveMultiTaskGroupTask {
    id: string
    task_name: string | null
    status: string | null
    total_items: number | null
    published_count: number | null
    pending_count: number | null
    failed_count: number | null
    created_at: string | null
}

export async function findActiveMultiTaskGroupTask(
    supabase: SupabaseClient<Database>,
    userId: string,
    groupId: string
): Promise<ActiveMultiTaskGroupTask | null> {
    const { data: candidateTasks, error: taskError } = await supabase
        .from('publish_tasks')
        .select('id, task_name, status, total_items, published_count, pending_count, failed_count, created_at')
        .eq('user_id', userId)
        .eq('workflow', 'multi_task')
        .eq('source_account_group_id', groupId)
        .in('status', [...ACTIVE_MULTI_TASK_STATUSES])
        .order('created_at', { ascending: false })
        .limit(20)

    if (taskError) {
        throw taskError
    }

    if (!candidateTasks || candidateTasks.length === 0) {
        return null
    }

    const taskIds = candidateTasks.map((task) => task.id)
    const { data: unfinishedItems, error: itemError } = await supabase
        .from('publish_task_items')
        .select('task_id')
        .in('task_id', taskIds)
        .in('status', [...UNFINISHED_ITEM_STATUSES])
        .limit(1)

    if (itemError) {
        throw itemError
    }

    const activeTaskId = unfinishedItems?.[0]?.task_id
    if (!activeTaskId) {
        return null
    }

    return candidateTasks.find((task) => task.id === activeTaskId) || candidateTasks[0]
}

