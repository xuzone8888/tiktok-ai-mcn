// @ts-nocheck — shop_publish tables pending migration to database.ts
// Shop publish tasks — CRUD operations
// GET: list tasks for current user
// POST: create a new publish task with items

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: List all Shop publish tasks for the current user
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const searchParams = request.nextUrl.searchParams;

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Pagination
        const page = parseInt(searchParams.get('page') || '1', 10);
        const pageSize = parseInt(searchParams.get('page_size') || '20', 10);
        const offset = (page - 1) * pageSize;

        // Fetch tasks with count
        const { data: tasks, error, count } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型
            .from('shop_publish_tasks')
            .select('*', { count: 'exact' })
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + pageSize - 1);

        if (error) {
            console.error('Error fetching Shop tasks:', error);
            return NextResponse.json(
                { error: 'Failed to fetch tasks' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            tasks: tasks || [],
            total: count || 0,
            page,
            page_size: pageSize,
        });
    } catch (error) {
        console.error('Error in Shop tasks GET:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// POST: Create a new Shop publish task
export async function POST(request: NextRequest) {
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

        // Parse request body
        const body = await request.json();
        const {
            task_name,
            title_template,
            enable_precheck,
            items,
        } = body as {
            task_name?: string;
            title_template?: string;
            enable_precheck?: boolean;
            items: Array<{
                account_id: string;
                video_url: string;
                video_source: 'assets' | 'upload' | 'url';
                title: string;
                product_id: string;
                product_anchor_title?: string;
            }>;
        };

        // Validate items
        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json(
                { error: 'At least one item is required' },
                { status: 400 }
            );
        }

        // Validate each item has required fields
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.account_id || !item.video_url || !item.title || !item.product_id) {
                return NextResponse.json(
                    { error: `Item ${i + 1}: account_id, video_url, title, and product_id are required` },
                    { status: 400 }
                );
            }
        }

        // Create the parent task
        const { data: task, error: taskError } = await supabase
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型
            .from('shop_publish_tasks')
            .insert({
                user_id: user.id,
                task_name: task_name || `Shop publish ${new Date().toLocaleDateString()}`,
                title_template,
                total_items: items.length,
                status: 'pending',
            })
            .select('id')
            .single();

        if (taskError || !task) {
            console.error('Error creating Shop task:', taskError);
            return NextResponse.json(
                { error: 'Failed to create task' },
                { status: 500 }
            );
        }

        // Create task items
        const taskItems = items.map(item => ({
            task_id: task.id,
            account_id: item.account_id,
            video_url: item.video_url,
            video_source: item.video_source || 'url',
            title: item.title,
            product_id: item.product_id,
            product_anchor_title: item.product_anchor_title || '',
            status: 'pending' as const,
            precheck_status: enable_precheck ? ('pending' as const) : ('none' as const),
        }));

        const { error: itemsError } = await supabase
            .from('shop_publish_task_items')
            .insert(taskItems);

        if (itemsError) {
            // Rollback: delete the parent task (CASCADE will clean up any partial items)
            await supabase// @ts-expect-error — shop_publish_tasks 迁移后更新类型
            .from('shop_publish_tasks').delete().eq('id', task.id);
            console.error('Error creating Shop task items:', itemsError);
            return NextResponse.json(
                { error: 'Failed to create task items' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            task_id: task.id,
            total_items: items.length,
        }, { status: 201 });
    } catch (error) {
        console.error('Error in Shop tasks POST:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
