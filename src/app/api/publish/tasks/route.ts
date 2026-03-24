import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processPublishQueue } from '@/lib/publish-processor'

// TikTok content posting types - define locally since we're not using the actual upload functions yet
type VideoPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'

// Types for request body
interface CreateTaskRequest {
    name: string  // 任务组名称（必填）
    videos: Array<{
        id: string
        type: 'asset' | 'upload' | 'url'
        name: string
        url?: string
        title?: string  // 视频独立标题（优先级高于全局 caption）
        coverTimestampMs?: number  // 封面帧时间戳（毫秒）
    }>
    account_ids: string[]
    caption: string
    privacy_level: VideoPrivacyLevel | null  // null = 用户未选择，后端校验必填
    allow_comment: boolean
    allow_duet: boolean
    allow_stitch: boolean
    brand_content_toggle: boolean
    brand_organic_toggle: boolean
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
        const dateRange = searchParams.get('dateRange') || 'today' // 默认只显示今天
        const limit = parseInt(searchParams.get('limit') || '50')
        const offset = parseInt(searchParams.get('offset') || '0')

        // Calculate date range
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        let startDate: Date
        let endDate: Date | null = null

        switch (dateRange) {
            case 'yesterday':
                startDate = new Date(today)
                startDate.setDate(startDate.getDate() - 1)
                endDate = new Date(today)
                break
            case '3days':
                startDate = new Date(today)
                startDate.setDate(startDate.getDate() - 2) // 今天 + 前2天 = 3天
                break
            case '7days':
                startDate = new Date(today)
                startDate.setDate(startDate.getDate() - 6) // 今天 + 前6天 = 7天
                break
            case 'today':
            default:
                startDate = today
                break
        }

        let query = supabase
            .from('publish_tasks')
            .select(`
        *,
        items:publish_task_items(*)
      `)
            .eq('user_id', user.id)
            .gte('created_at', startDate.toISOString())
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        // Add end date filter for 'yesterday'
        if (endDate) {
            query = query.lt('created_at', endDate.toISOString())
        }

        if (status) {
            if (status === 'in_progress') {
                query = query.in('status', ['pending', 'running', 'scheduled'])
            } else {
                query = query.eq('status', status)
            }
        }

        const { data: tasks, error, count } = await query

        if (error) {
            console.error('Failed to fetch tasks:', error)
            return NextResponse.json({ error: '获取发布任务失败' }, { status: 500 })
        }

        // Transform tasks to include summary info
        const transformedTasks = tasks?.map(task => ({
            ...task,
            video_count: new Set(task.items?.map((i: { video_url: string }) => i.video_url)).size,
            account_count: new Set(task.items?.map((i: { account_id: string }) => i.account_id)).size,
            total_items: task.items?.length || 0,
            completed_items: task.items?.filter((i: { status: string }) => i.status === 'published').length || 0,
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

        // 校验 privacy_level 必填（TikTok 审核要求：不可替用户选择隐私级别）
        if (!body.privacy_level) {
            return NextResponse.json({ error: '请选择可见范围' }, { status: 400 })
        }

        // Fix 4: 校验标题长度（TikTok 限制 ≤ 2200 字符）
        if (body.caption && body.caption.length > 2200) {
            return NextResponse.json({ error: '标题不能超过2200个字符' }, { status: 400 })
        }
        for (const video of body.videos) {
            if (video.title && video.title.length > 2200) {
                return NextResponse.json({ error: `视频"${video.name}"的标题超过2200个字符` }, { status: 400 })
            }
        }

        // Fix 5: 校验 Hashtag 数量（TikTok 2025 政策限制 ≤ 5 个）
        const checkHashtagLimit = (text: string, label: string) => {
            const hashtagCount = (text.match(/#[^\s#]+/g) || []).length
            if (hashtagCount > 5) {
                return NextResponse.json({ error: `${label}中Hashtag数量不能超过5个（当前${hashtagCount}个）` }, { status: 400 })
            }
            return null
        }
        if (body.caption) {
            const err = checkHashtagLimit(body.caption, '全局标题')
            if (err) return err
        }
        for (const video of body.videos) {
            if (video.title) {
                const err = checkHashtagLimit(video.title, `视频"${video.name}"的标题`)
                if (err) return err
            }
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
        const expiredAccounts = accounts.filter(a => a.token_expires_at && new Date(a.token_expires_at) <= now)
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
                name: body.name || '未命名任务组',  // 任务组名称
                status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
                title_template: body.caption,  // Database uses title_template, not caption_template
                privacy_level: body.privacy_level,
                allow_comment: body.allow_comment,
                allow_duet: body.allow_duet,
                allow_stitch: body.allow_stitch,
                brand_content_toggle: body.brand_content_toggle ?? false,
                brand_organic_toggle: body.brand_organic_toggle ?? false,
                is_aigc: body.is_ai_generated ?? true,  // ToryX 默认标记 AI 生成
                batch_interval_seconds: body.batch_interval * 60,  // Database uses seconds, convert from minutes
                total_items: totalItemsCount,  // Set total items count upfront
                pending_count: totalItemsCount,  // 初始化统计
                published_count: 0,
                failed_count: 0
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

                // 优先使用视频独立标题，否则使用全局 caption 模板
                // Priority: video.title > body.caption (with template variables)
                let title: string
                if (video.title && video.title.trim()) {
                    // 使用视频独立标题
                    title = video.title.trim()
                } else {
                    // 使用全局 caption 模板，并替换变量
                    title = body.caption || ''
                    title = title.replace(/{n}/g, String(itemIndex + 1))
                    title = title.replace(/{date}/g, new Date().toLocaleDateString('zh-CN'))
                }

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
        if (body.publish_mode === 'now') {
            // Start processing using shared module (fire and forget)
            processPublishQueue({
                taskId: task.id,
                mode: 'immediate'
            }).catch(err => {
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

// Note: processPublishItems moved to lib/publish-processor.ts for shared use
