import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTikTokUserInfo } from '@/lib/tiktok/oauth'
import { initializeVideoUpload, uploadVideoFromUrl, publishVideo, VideoPrivacyLevel } from '@/lib/tiktok/content-posting'

// Types for request body
interface CreateTaskRequest {
    videos: Array<{
        id: string
        type: 'asset' | 'upload' | 'url'
        name: string
        url?: string
    }>
    account_ids: string[]
    caption: string
    privacy_level: VideoPrivacyLevel
    allow_comments: boolean
    allow_duet: boolean
    allow_stitch: boolean
    is_brand_content: boolean
    is_ai_generated: boolean
    publish_mode: 'now' | 'scheduled'
    scheduled_at: string | null
    batch_interval: number
}

// GET - List all publish tasks for the current user
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // Get query params for filtering
        const searchParams = request.nextUrl.searchParams
        const status = searchParams.get('status')
        const limit = parseInt(searchParams.get('limit') || '50')
        const offset = parseInt(searchParams.get('offset') || '0')

        let query = supabase
            .from('publish_tasks')
            .select(`
        *,
        items:publish_task_items(*)
      `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (status) {
            query = query.eq('status', status)
        }

        const { data: tasks, error, count } = await query

        if (error) {
            console.error('Failed to fetch tasks:', error)
            return NextResponse.json({ error: '获取发布任务失败' }, { status: 500 })
        }

        // Transform tasks to include summary info
        const transformedTasks = tasks?.map(task => ({
            ...task,
            video_count: new Set(task.items?.map((i: { video_id: string }) => i.video_id)).size,
            account_count: new Set(task.items?.map((i: { tiktok_account_id: string }) => i.tiktok_account_id)).size,
            total_items: task.items?.length || 0,
            completed_items: task.items?.filter((i: { status: string }) => i.status === 'completed').length || 0,
            failed_items: task.items?.filter((i: { status: string }) => i.status === 'failed').length || 0
        }))

        return NextResponse.json({
            tasks: transformedTasks,
            total: count
        })

    } catch (error) {
        console.error('Error fetching publish tasks:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

// POST - Create a new publish task
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        const body: CreateTaskRequest = await request.json()

        // Validate required fields
        if (!body.videos || body.videos.length === 0) {
            return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
        }
        if (!body.account_ids || body.account_ids.length === 0) {
            return NextResponse.json({ error: '请至少选择一个发布账号' }, { status: 400 })
        }

        // Verify all accounts belong to the user and are authorized
        const { data: accounts, error: accountsError } = await supabase
            .from('tiktok_accounts')
            .select('id, open_id, access_token, access_token_expires_at')
            .eq('user_id', user.id)
            .in('id', body.account_ids)

        if (accountsError) {
            console.error('Failed to fetch accounts:', accountsError)
            return NextResponse.json({ error: '获取账号信息失败' }, { status: 500 })
        }

        if (!accounts || accounts.length !== body.account_ids.length) {
            return NextResponse.json({ error: '部分账号不存在或无权访问' }, { status: 400 })
        }

        // Check authorization status
        const now = new Date()
        const expiredAccounts = accounts.filter(a => new Date(a.access_token_expires_at) <= now)
        if (expiredAccounts.length > 0) {
            return NextResponse.json({
                error: '部分账号授权已过期，请先刷新授权',
                expired_count: expiredAccounts.length
            }, { status: 400 })
        }

        // Calculate scheduled times for batch publishing
        const baseTime = body.publish_mode === 'scheduled' && body.scheduled_at
            ? new Date(body.scheduled_at)
            : new Date()

        // Create the main task
        const { data: task, error: taskError } = await supabase
            .from('publish_tasks')
            .insert({
                user_id: user.id,
                status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
                caption_template: body.caption,
                privacy_level: body.privacy_level,
                allow_comments: body.allow_comments,
                allow_duet: body.allow_duet,
                allow_stitch: body.allow_stitch,
                is_brand_content: body.is_brand_content,
                is_ai_generated: body.is_ai_generated,
                batch_interval_minutes: body.batch_interval
            })
            .select()
            .single()

        if (taskError) {
            console.error('Failed to create task:', taskError)
            return NextResponse.json({ error: '创建任务失败' }, { status: 500 })
        }

        // Create task items for each video x account combination
        const items: Array<{
            task_id: string
            video_id: string
            video_name: string
            video_url: string | null
            tiktok_account_id: string
            status: string
            scheduled_at: string | null
            caption: string
        }> = []

        let itemIndex = 0
        for (const video of body.videos) {
            for (const accountId of body.account_ids) {
                // Calculate scheduled time with interval
                const scheduledTime = new Date(baseTime.getTime() + (itemIndex * body.batch_interval * 60 * 1000))

                // Replace template variables in caption
                let caption = body.caption
                caption = caption.replace(/{n}/g, String(itemIndex + 1))
                caption = caption.replace(/{date}/g, new Date().toLocaleDateString('zh-CN'))

                items.push({
                    task_id: task.id,
                    video_id: video.id,
                    video_name: video.name,
                    video_url: video.url || null,
                    tiktok_account_id: accountId,
                    status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                    scheduled_at: scheduledTime.toISOString(),
                    caption
                })

                itemIndex++
            }
        }

        const { error: itemsError } = await supabase
            .from('publish_task_items')
            .insert(items)

        if (itemsError) {
            console.error('Failed to create task items:', itemsError)
            // Clean up the task if items creation failed
            await supabase.from('publish_tasks').delete().eq('id', task.id)
            return NextResponse.json({ error: '创建任务项失败' }, { status: 500 })
        }

        // If immediate publishing, start processing in the background
        // Note: In production, this would be handled by a background job/queue
        if (body.publish_mode === 'now') {
            // Update task status to processing
            await supabase
                .from('publish_tasks')
                .update({ status: 'processing' })
                .eq('id', task.id)

            // Start processing (fire and forget for now)
            // In production, use a proper job queue
            processPublishItems(task.id, items, accounts, supabase).catch(err => {
                console.error('Background publish processing failed:', err)
            })
        }

        return NextResponse.json({
            success: true,
            task: {
                ...task,
                total_items: items.length
            }
        })

    } catch (error) {
        console.error('Error creating publish task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

// Background processing function
async function processPublishItems(
    taskId: string,
    items: Array<{
        task_id: string
        video_id: string
        video_name: string
        video_url: string | null
        tiktok_account_id: string
        caption: string
    }>,
    accounts: Array<{ id: string; access_token: string }>,
    supabase: Awaited<ReturnType<typeof createClient>>
) {
    const accountMap = new Map(accounts.map(a => [a.id, a]))
    let completedCount = 0
    let failedCount = 0

    for (const item of items) {
        try {
            const account = accountMap.get(item.tiktok_account_id)
            if (!account) {
                throw new Error('账号不存在')
            }

            // Update item status to processing
            await supabase
                .from('publish_task_items')
                .update({ status: 'processing' })
                .eq('task_id', item.task_id)
                .eq('video_id', item.video_id)
                .eq('tiktok_account_id', item.tiktok_account_id)

            // For demo purposes, we're using URL upload
            // In production, you'd handle different video sources (local files, asset library, etc.)
            if (item.video_url) {
                const uploadResult = await uploadVideoFromUrl(account.access_token, item.video_url)

                if (uploadResult.error) {
                    throw new Error(uploadResult.error.message)
                }

                // Note: TikTok's Content Posting API creates the video as a draft or directly posts
                // The exact flow depends on the API version and permissions
            }

            // Update item status to completed
            await supabase
                .from('publish_task_items')
                .update({
                    status: 'completed',
                    published_at: new Date().toISOString()
                })
                .eq('task_id', item.task_id)
                .eq('video_id', item.video_id)
                .eq('tiktok_account_id', item.tiktok_account_id)

            completedCount++
        } catch (error) {
            console.error(`Failed to publish item:`, error)

            // Update item status to failed
            await supabase
                .from('publish_task_items')
                .update({
                    status: 'failed',
                    error_message: error instanceof Error ? error.message : '发布失败'
                })
                .eq('task_id', item.task_id)
                .eq('video_id', item.video_id)
                .eq('tiktok_account_id', item.tiktok_account_id)

            failedCount++
        }
    }

    // Update task status based on results
    const finalStatus = failedCount === items.length
        ? 'failed'
        : failedCount > 0
            ? 'partial'
            : 'completed'

    await supabase
        .from('publish_tasks')
        .update({
            status: finalStatus,
            completed_at: new Date().toISOString()
        })
        .eq('id', taskId)
}
