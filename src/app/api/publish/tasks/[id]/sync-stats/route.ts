import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams {
    params: Promise<{ id: string }>
}

// POST - Sync video statistics from TikTok
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const { id: taskId } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // Get task with published items that have tiktok_video_id
        const { data: task, error: fetchError } = await supabase
            .from('publish_tasks')
            .select(`
                id, user_id,
                items:publish_task_items(
                    id,
                    status,
                    tiktok_video_id,
                    account:tiktok_accounts(
                        id,
                        open_id,
                        access_token,
                        token_expires_at
                    )
                )
            `)
            .eq('id', taskId)
            .eq('user_id', user.id)
            .single()

        if (fetchError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        // Filter published items with tiktok_video_id
        const publishedItems = ((task as any).items || []).filter(
            (item: any) => item.status === 'published' && item.tiktok_video_id
        )

        if (publishedItems.length === 0) {
            return NextResponse.json({
                success: true,
                message: '没有已发布的视频需要同步',
                synced: 0
            })
        }

        // Group items by account for batch API calls
        const itemsByAccount = new Map<string, { account: any; items: any[] }>()
        for (const item of publishedItems) {
            const account = item.account
            if (!account?.access_token) continue

            const key = account.id
            if (!itemsByAccount.has(key)) {
                itemsByAccount.set(key, { account, items: [] })
            }
            itemsByAccount.get(key)!.items.push(item)
        }

        let totalSynced = 0
        let totalViews = 0
        let totalLikes = 0
        const errors: string[] = []

        // Fetch stats for each account's videos
        const accountEntries = Array.from(itemsByAccount.values())
        for (const { account, items } of accountEntries) {
            try {
                // Check if token is expired
                if (new Date(account.token_expires_at) < new Date()) {
                    errors.push(`账号 ${account.open_id} token已过期`)
                    continue
                }

                const videoIds = items.map((item: any) => item.tiktok_video_id)

                // TikTok API: Query video info
                // Note: TikTok API allows max 20 video IDs per request
                const batchSize = 20
                for (let i = 0; i < videoIds.length; i += batchSize) {
                    const batchIds = videoIds.slice(i, i + batchSize)

                    const response = await fetch(
                        `https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
                        {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${account.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                filters: {
                                    video_ids: batchIds
                                }
                            })
                        }
                    )

                    if (!response.ok) {
                        const errorText = await response.text()
                        console.error('TikTok API error:', errorText)
                        errors.push(`TikTok API错误: ${response.status}`)
                        continue
                    }

                    const data = await response.json()
                    const videos = data.data?.videos || []

                    // Update each item with stats
                    for (const video of videos) {
                        const item = items.find((i: any) => i.tiktok_video_id === video.id)
                        if (!item) continue

                        const stats = {
                            view_count: video.view_count || 0,
                            like_count: video.like_count || 0,
                            comment_count: video.comment_count || 0,
                            share_count: video.share_count || 0,
                            stats_updated_at: new Date().toISOString()
                        }

                        await supabase
                            .from('publish_task_items')
                            .update(stats)
                            .eq('id', item.id)

                        totalViews += stats.view_count
                        totalLikes += stats.like_count
                        totalSynced++
                    }
                }
            } catch (err) {
                console.error('Error syncing stats for account:', err)
                errors.push(`同步失败: ${err}`)
            }
        }

        // Update task totals
        await supabase
            .from('publish_tasks')
            .update({
                total_views: totalViews,
                total_likes: totalLikes
            })
            .eq('id', taskId)

        return NextResponse.json({
            success: true,
            synced: totalSynced,
            total_views: totalViews,
            total_likes: totalLikes,
            errors: errors.length > 0 ? errors : undefined
        })

    } catch (error) {
        console.error('Error syncing video stats:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
