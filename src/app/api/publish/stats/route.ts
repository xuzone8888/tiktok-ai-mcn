import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - Get publishing statistics for the current user
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // Get account count
        const { count: accountCount } = await supabase
            .from('tiktok_accounts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)

        // Get today's date range
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)

        // Get this month's date range
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1)

        // Get today's published count
        const { count: todayPublished } = await supabase
            .from('publish_task_items')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('published_at', today.toISOString())
            .lt('published_at', tomorrow.toISOString())
            .in('task_id',
                supabase
                    .from('publish_tasks')
                    .select('id')
                    .eq('user_id', user.id) as unknown as string[]
            )

        // Get this month's published count
        const { count: monthPublished } = await supabase
            .from('publish_task_items')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('published_at', monthStart.toISOString())
            .lt('published_at', monthEnd.toISOString())
            .in('task_id',
                supabase
                    .from('publish_tasks')
                    .select('id')
                    .eq('user_id', user.id) as unknown as string[]
            )

        // Get total counts for success rate calculation
        const { count: totalCompleted } = await supabase
            .from('publish_task_items')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed')
            .in('task_id',
                supabase
                    .from('publish_tasks')
                    .select('id')
                    .eq('user_id', user.id) as unknown as string[]
            )

        const { count: totalFailed } = await supabase
            .from('publish_task_items')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'failed')
            .in('task_id',
                supabase
                    .from('publish_tasks')
                    .select('id')
                    .eq('user_id', user.id) as unknown as string[]
            )

        // Calculate success rate
        const totalAttempted = (totalCompleted || 0) + (totalFailed || 0)
        const successRate = totalAttempted > 0
            ? ((totalCompleted || 0) / totalAttempted * 100).toFixed(1)
            : '100.0'

        // Get pending scheduled tasks count
        const { count: pendingScheduled } = await supabase
            .from('publish_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'scheduled')

        // Get recent task activity (last 7 days)
        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)

        const { data: recentActivity } = await supabase
            .from('publish_task_items')
            .select('published_at, status')
            .gte('created_at', weekAgo.toISOString())
            .in('task_id',
                supabase
                    .from('publish_tasks')
                    .select('id')
                    .eq('user_id', user.id) as unknown as string[]
            )
            .order('published_at', { ascending: false })
            .limit(100)

        // Group by date for chart data
        const dailyStats: Record<string, { completed: number; failed: number }> = {}

        for (let i = 6; i >= 0; i--) {
            const date = new Date()
            date.setDate(date.getDate() - i)
            const dateStr = date.toISOString().split('T')[0]
            dailyStats[dateStr] = { completed: 0, failed: 0 }
        }

        recentActivity?.forEach(item => {
            if (item.published_at) {
                const dateStr = new Date(item.published_at).toISOString().split('T')[0]
                if (dailyStats[dateStr]) {
                    if (item.status === 'completed') {
                        dailyStats[dateStr].completed++
                    } else if (item.status === 'failed') {
                        dailyStats[dateStr].failed++
                    }
                }
            }
        })

        return NextResponse.json({
            stats: {
                account_count: accountCount || 0,
                today_published: todayPublished || 0,
                month_published: monthPublished || 0,
                success_rate: parseFloat(successRate),
                pending_scheduled: pendingScheduled || 0,
                total_completed: totalCompleted || 0,
                total_failed: totalFailed || 0
            },
            daily_activity: Object.entries(dailyStats).map(([date, counts]) => ({
                date,
                ...counts
            }))
        })

    } catch (error) {
        console.error('Error fetching stats:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
