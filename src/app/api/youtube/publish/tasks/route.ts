import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { processYouTubePublishQueue } from '@/lib/youtube/processor'

export const dynamic = 'force-dynamic'

type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public'

interface CreateYouTubeTaskRequest {
  name: string
  videos: Array<{
    id: string
    type: 'asset' | 'upload' | 'url'
    name: string
    url?: string
    title?: string
    description?: string
  }>
  account_ids: string[]
  title: string
  description: string
  privacy_status: YouTubePrivacyStatus
  category_id?: string
  tags?: string[]
  made_for_kids: boolean
  contains_synthetic_media: boolean
  notify_subscribers: boolean
  publish_mode: 'now' | 'scheduled'
  scheduled_at: string | null
  batch_interval: number
}

function getDateRangeBounds(dateRange: string) {
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
      startDate.setDate(startDate.getDate() - 2)
      break
    case '7days':
      startDate = new Date(today)
      startDate.setDate(startDate.getDate() - 6)
      break
    case 'today':
    default:
      startDate = today
      break
  }

  return { startDate, endDate }
}

function summarizeTask(task: any) {
  const items = Array.isArray(task.items) ? task.items : []
  const publishedCount = items.filter((item: { status: string }) => item.status === 'published').length
  const failedCount = items.filter((item: { status: string }) => item.status === 'failed').length
  const pendingCount = items.filter((item: { status: string }) => ['pending', 'processing', 'uploading'].includes(item.status)).length

  let displayStatus = task.status
  if (pendingCount > 0 && task.status !== 'scheduled') displayStatus = 'processing'
  if (items.length > 0 && publishedCount === items.length) displayStatus = 'completed'
  if (failedCount > 0 && publishedCount > 0 && pendingCount === 0) displayStatus = 'partial_failed'
  if (failedCount > 0 && failedCount === items.length) displayStatus = 'failed'

  return {
    displayStatus,
    publishedCount,
    failedCount,
    pendingCount,
    videoCount: new Set(items.map((item: { video_url: string }) => item.video_url)).size,
    accountCount: new Set(items.map((item: { account_id: string }) => item.account_id)).size,
  }
}

function replaceTemplate(template: string, index: number) {
  return template
    .replace(/{n}/g, String(index + 1))
    .replace(/{date}/g, new Date().toLocaleDateString('zh-CN'))
}

function normalizeTags(tags: string[] | undefined) {
  return (tags || [])
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 30)
}

function isAllowedVideoUrl(videoUrl: string | undefined) {
  if (!videoUrl) return false

  try {
    const url = new URL(videoUrl)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false

    const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    return (
      isLocalHost &&
      url.pathname.startsWith('/api/youtube/upload/local-video/') &&
      url.searchParams.has('expires') &&
      url.searchParams.has('token')
    )
  } catch {
    return false
  }
}

function parseScheduledBaseTime(mode: 'now' | 'scheduled', scheduledAt: string | null) {
  if (mode === 'now') {
    return new Date()
  }

  if (!scheduledAt) {
    throw new Error('请选择 YouTube 定时发布时间')
  }

  const parsed = new Date(scheduledAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('YouTube 定时发布时间格式无效')
  }

  if (parsed.getTime() < Date.now() - 30 * 1000) {
    throw new Error('YouTube 定时发布时间不能早于当前时间')
  }

  return parsed
}

function parseBatchInterval(value: number) {
  const minutes = Number(value || 0)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('YouTube 发布间隔必须在 0 到 1440 分钟之间')
  }

  return minutes
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const dateRange = searchParams.get('dateRange') || 'today'
    const limit = Number(searchParams.get('limit') || 50)
    const offset = Number(searchParams.get('offset') || 0)
    const { startDate, endDate } = getDateRangeBounds(dateRange)

    let query = (supabase as any)
      .from('youtube_publish_tasks')
      .select('*, items:youtube_publish_task_items(*)', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })

    if (endDate) {
      query = query.lt('created_at', endDate.toISOString())
    }

    if (!status) {
      query = query.range(offset, offset + limit - 1)
    }

    const { data, error, count } = await query
    if (error) {
      console.error('Failed to fetch YouTube tasks:', error)
      return NextResponse.json({ error: '获取 YouTube 发布任务失败' }, { status: 500 })
    }

    const transformed = (data || []).map((task: any) => {
      const summary = summarizeTask(task)
      return {
        ...task,
        name: task.task_name || '未命名 YouTube 任务',
        status: summary.displayStatus,
        video_count: summary.videoCount,
        account_count: summary.accountCount,
        published_count: task.published_count ?? summary.publishedCount,
        failed_count: task.failed_count ?? summary.failedCount,
        pending_count: task.pending_count ?? summary.pendingCount,
      }
    })

    const filtered = status
      ? transformed.filter((task: any) => {
        if (status === 'in_progress') return ['pending', 'scheduled', 'processing'].includes(task.status)
        if (status === 'failed') return ['failed', 'partial_failed'].includes(task.status)
        return task.status === status
      })
      : transformed

    return NextResponse.json({
      tasks: status ? filtered.slice(offset, offset + limit) : filtered,
      total: status ? filtered.length : count,
    })
  } catch (error) {
    console.error('YouTube tasks GET error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body: CreateYouTubeTaskRequest = await request.json()
    if (!body.videos || body.videos.length === 0) {
      return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
    }
    if (!body.account_ids || body.account_ids.length === 0) {
      return NextResponse.json({ error: '请至少选择一个 YouTube 账号' }, { status: 400 })
    }
    const uniqueAccountIds = [...new Set(body.account_ids)]
    if (uniqueAccountIds.length !== body.account_ids.length) {
      return NextResponse.json({ error: 'YouTube 账号列表中存在重复账号' }, { status: 400 })
    }
    if (!['now', 'scheduled'].includes(body.publish_mode)) {
      return NextResponse.json({ error: '请选择 YouTube 发布方式' }, { status: 400 })
    }
    if (!body.privacy_status || !['private', 'unlisted', 'public'].includes(body.privacy_status)) {
      return NextResponse.json({ error: '请选择 YouTube 可见范围' }, { status: 400 })
    }
    if (body.title && body.title.length > 100) {
      return NextResponse.json({ error: 'YouTube 标题不能超过 100 个字符' }, { status: 400 })
    }
    if (body.description && body.description.length > 5000) {
      return NextResponse.json({ error: 'YouTube 描述不能超过 5000 个字符' }, { status: 400 })
    }

    for (const video of body.videos) {
      if (!isAllowedVideoUrl(video.url)) {
        return NextResponse.json({ error: `视频"${video.name}"缺少有效视频地址` }, { status: 400 })
      }
      if (video.title && video.title.length > 100) {
        return NextResponse.json({ error: `视频"${video.name}"的标题不能超过 100 个字符` }, { status: 400 })
      }
      if (video.description && video.description.length > 5000) {
        return NextResponse.json({ error: `视频"${video.name}"的描述不能超过 5000 个字符` }, { status: 400 })
      }
    }

    let baseTime: Date
    let batchIntervalMinutes: number
    try {
      baseTime = parseScheduledBaseTime(body.publish_mode, body.scheduled_at)
      batchIntervalMinutes = parseBatchInterval(body.batch_interval)
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'YouTube 发布设置无效' },
        { status: 400 }
      )
    }

    const { data: accounts, error: accountsError } = await (supabase as any)
      .from('youtube_accounts')
      .select('id, status')
      .eq('user_id', user.id)
      .in('id', uniqueAccountIds)

    if (accountsError) {
      return NextResponse.json({ error: `获取 YouTube 账号失败: ${accountsError.message}` }, { status: 500 })
    }

    if (!accounts || accounts.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 YouTube 账号不存在或无权访问' }, { status: 400 })
    }

    const inactiveAccounts = accounts.filter((account: { status: string }) => account.status !== 'active')
    if (inactiveAccounts.length > 0) {
      return NextResponse.json({ error: '部分 YouTube 账号授权不可用，请先刷新或重新绑定' }, { status: 400 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRows, error: tokenRowsError } = await adminSupabase
      .from('youtube_account_tokens')
      .select('account_id')
      .in('account_id', uniqueAccountIds)

    if (tokenRowsError) {
      return NextResponse.json({ error: `检查 YouTube 授权令牌失败: ${tokenRowsError.message}` }, { status: 500 })
    }

    if (!tokenRows || tokenRows.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 YouTube 账号缺少授权令牌，请重新绑定' }, { status: 400 })
    }

    const totalItems = body.videos.length * uniqueAccountIds.length
    const tags = normalizeTags(body.tags)

    const { data: task, error: taskError } = await (supabase as any)
      .from('youtube_publish_tasks')
      .insert({
        user_id: user.id,
        task_name: body.name || '未命名 YouTube 任务',
        title_template: body.title || '',
        description_template: body.description || '',
        privacy_status: body.privacy_status,
        category_id: body.category_id || '22',
        tags,
        made_for_kids: body.made_for_kids ?? false,
        contains_synthetic_media: body.contains_synthetic_media ?? true,
        notify_subscribers: body.notify_subscribers ?? false,
        scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
        batch_interval_seconds: batchIntervalMinutes * 60,
        status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
        total_items: totalItems,
        pending_count: totalItems,
      })
      .select()
      .single()

    if (taskError) {
      return NextResponse.json({ error: `创建 YouTube 任务失败: ${taskError.message}` }, { status: 500 })
    }

    const items = []
    let itemIndex = 0
    for (const video of body.videos) {
      for (const accountId of uniqueAccountIds) {
        const scheduledAt = new Date(baseTime.getTime() + itemIndex * batchIntervalMinutes * 60 * 1000)
        items.push({
          task_id: task.id,
          account_id: accountId,
          video_url: video.url,
          video_source: video.type === 'asset' ? 'assets' : video.type,
          source_video_id: video.id,
          source_video_name: video.name,
          title: video.title?.trim() || replaceTemplate(body.title || video.name || 'Untitled video', itemIndex),
          description: video.description?.trim() || replaceTemplate(body.description || '', itemIndex),
          status: body.publish_mode === 'scheduled' ? 'pending' : 'pending',
          scheduled_at: scheduledAt.toISOString(),
        })
        itemIndex++
      }
    }

    const { error: itemsError } = await (supabase as any)
      .from('youtube_publish_task_items')
      .insert(items)

    if (itemsError) {
      await (supabase as any).from('youtube_publish_tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: `创建 YouTube 任务项失败: ${itemsError.message}` }, { status: 500 })
    }

    if (body.publish_mode === 'now') {
      processYouTubePublishQueue({ taskId: task.id, mode: 'immediate' }).catch((error) => {
        console.error('Background YouTube publish processing failed:', error)
      })
    }

    return NextResponse.json({
      success: true,
      task: {
        ...task,
        total_items: items.length,
      },
    })
  } catch (error) {
    console.error('YouTube tasks POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建 YouTube 发布任务失败' },
      { status: 500 }
    )
  }
}
