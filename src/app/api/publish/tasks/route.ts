import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { initVideoPublishFromUrl, waitForPublishComplete } from '@/lib/tiktok/content-posting'

// TikTok content posting types - define locally since we're not using the actual upload functions yet
type VideoPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY'

// Types for request body
interface CreateTaskRequest {
    videos: Array<{
        id: string
        type: 'asset' | 'upload' | 'url'
        name: string
        url?: string
        coverTimestampMs?: number  // 封面帧时间戳（毫秒）
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
            .select('id, open_id, access_token, token_expires_at')
            .eq('user_id', user.id)
            .in('id', body.account_ids)

        if (accountsError) {
            console.error('Failed to fetch accounts:', accountsError)
            return NextResponse.json({ error: '获取账号信息失败: ' + accountsError.message }, { status: 500 })
        }

        if (!accounts || accounts.length !== body.account_ids.length) {
            return NextResponse.json({ error: '部分账号不存在或无权访问' }, { status: 400 })
        }

        // Check authorization status
        const now = new Date()
        const expiredAccounts = accounts.filter(a => new Date(a.token_expires_at) <= now)
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

        // Create the main task (field names match database schema)
        // Calculate total items upfront: videos × accounts
        const totalItemsCount = body.videos.length * body.account_ids.length

        const { data: task, error: taskError } = await supabase
            .from('publish_tasks')
            .insert({
                user_id: user.id,
                status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
                title_template: body.caption,  // Database uses title_template, not caption_template
                privacy_level: body.privacy_level,
                allow_comment: body.allow_comments,  // Database uses allow_comment (singular)
                allow_duet: body.allow_duet,
                allow_stitch: body.allow_stitch,
                brand_content_toggle: body.is_brand_content,  // Database uses brand_content_toggle
                is_aigc: body.is_ai_generated,  // Database uses is_aigc
                batch_interval_seconds: body.batch_interval * 60,  // Database uses seconds, convert from minutes
                total_items: totalItemsCount  // Set total items count upfront
            })
            .select()
            .single()

        if (taskError) {
            console.error('Failed to create task:', taskError)
            return NextResponse.json({ error: '创建任务失败: ' + taskError.message }, { status: 500 })
        }

        // Create task items for each video x account combination
        // Field names match database schema: account_id, title, video_url
        const items: Array<{
            task_id: string
            account_id: string  // Database uses account_id, not tiktok_account_id
            video_url: string  // Database requires video_url (NOT NULL)
            video_source: string
            title: string  // Database uses title, not caption
            status: string
            scheduled_at: string | null
            cover_timestamp_ms?: number  // 封面帧时间戳
        }> = []

        let itemIndex = 0
        for (const video of body.videos) {
            for (const accountId of body.account_ids) {
                // Calculate scheduled time with interval
                const scheduledTime = new Date(baseTime.getTime() + (itemIndex * body.batch_interval * 60 * 1000))

                // Replace template variables in caption
                let title = body.caption
                title = title.replace(/{n}/g, String(itemIndex + 1))
                title = title.replace(/{date}/g, new Date().toLocaleDateString('zh-CN'))

                // Ensure video_url is not null - use a placeholder if not provided
                const videoUrl = video.url || `placeholder://asset/${video.id}`

                items.push({
                    task_id: task.id,
                    account_id: accountId,  // Correct field name
                    video_url: videoUrl,  // Required field
                    video_source: video.type === 'asset' ? 'assets' : video.type,
                    title,  // Correct field name
                    status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                    scheduled_at: scheduledTime.toISOString(),
                    cover_timestamp_ms: video.coverTimestampMs,
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
        account_id: string  // Fixed field name
        video_url: string
        video_source: string
        title: string  // Fixed field name
        status: string
        scheduled_at: string | null
        cover_timestamp_ms?: number  // 封面帧时间戳
    }>,
    accounts: Array<{ id: string; access_token: string }>,
    supabase: Awaited<ReturnType<typeof createClient>>
) {
    const accountMap = new Map(accounts.map(a => [a.id, a]))
    let completedCount = 0
    let failedCount = 0

    for (const item of items) {
        try {
            const account = accountMap.get(item.account_id)
            if (!account) {
                throw new Error('账号不存在')
            }

            // Update item status to processing
            await supabase
                .from('publish_task_items')
                .update({ status: 'processing' })
                .eq('task_id', item.task_id)
                .eq('account_id', item.account_id)
                .eq('video_url', item.video_url)

            // Check if video URL is valid for TikTok publishing
            if (!item.video_url || item.video_url.startsWith('placeholder://')) {
                throw new Error('视频URL无效，无法发布到TikTok')
            }

            // Validate URL is HTTPS (required by TikTok)
            if (!item.video_url.startsWith('https://')) {
                throw new Error('TikTok要求视频URL必须使用HTTPS协议')
            }

            console.log(`Publishing video to TikTok: ${item.video_url}`)

            // Call actual TikTok publish API
            const publishId = await initVideoPublishFromUrl(
                account.access_token,
                item.video_url,
                {
                    title: item.title,
                    privacyLevel: 'SELF_ONLY',  // Use SELF_ONLY for sandbox testing to avoid content issues
                    disableDuet: false,
                    disableComment: false,
                    disableStitch: false,
                    isAigc: true,  // Mark as AI-generated content
                    videoCoverTimestampMs: item.cover_timestamp_ms,  // 传递封面帧时间戳
                }
            )

            console.log(`TikTok publish initiated, publish_id: ${publishId}`)

            // Update item with publish_id
            await supabase
                .from('publish_task_items')
                .update({
                    status: 'uploading',
                    tiktok_publish_id: publishId
                })
                .eq('task_id', item.task_id)
                .eq('account_id', item.account_id)
                .eq('video_url', item.video_url)

            // Wait for publish to complete (with timeout)
            const result = await waitForPublishComplete(account.access_token, publishId, 120000, 5000)

            if (result.success) {
                console.log(`TikTok publish successful! Post ID: ${result.postId}`)

                // Update item status to published
                await supabase
                    .from('publish_task_items')
                    .update({
                        status: 'published',
                        tiktok_share_id: result.postId,
                        published_at: new Date().toISOString()
                    })
                    .eq('task_id', item.task_id)
                    .eq('account_id', item.account_id)
                    .eq('video_url', item.video_url)

                completedCount++
            } else {
                throw new Error(result.error || 'TikTok发布失败')
            }
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
                .eq('account_id', item.account_id)
                .eq('video_url', item.video_url)

            failedCount++
        }
    }

    // Update task status based on results
    const finalStatus = failedCount === items.length
        ? 'failed'
        : failedCount > 0
            ? 'partial_failed'  // Schema uses 'partial_failed' not 'partial'
            : 'completed'

    await supabase
        .from('publish_tasks')
        .update({
            status: finalStatus,
            completed_at: new Date().toISOString(),
            success_count: completedCount,
            failed_count: failedCount
        })
        .eq('id', taskId)
}
