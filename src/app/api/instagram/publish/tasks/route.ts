import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { processInstagramPublishQueue } from '@/lib/instagram/processor'
import { buildPlatformPublishPayload } from '@/lib/publish/platform-adapters'

export const dynamic = 'force-dynamic'

type InstagramPrivacyStatus = 'private' | 'public'
const LOCAL_SCHEDULE_PROCESS_GRACE_MS = 1000
const LOCAL_SCHEDULE_MAX_DELAY_MS = 24 * 60 * 60 * 1000
const LOCAL_CONTAINER_REPOLL_DELAY_MS = 60 * 1000
const LOCAL_CONTAINER_MAX_REPOLLS = 8

interface CreateInstagramTaskRequest {
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
  privacy_status: InstagramPrivacyStatus
  category_id?: string
  tags?: string[]
  made_for_kids?: boolean
  notify_subscribers?: boolean
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
  const terminalSuccessStatuses = new Set(['published', 'container_created'])
  const publishedCount = items.filter((item: { status: string }) => item.status === 'published').length
  const succeededCount = items.filter((item: { status: string }) => terminalSuccessStatuses.has(item.status)).length
  const failedCount = items.filter((item: { status: string }) => item.status === 'failed').length
  const pendingCount = items.filter((item: { status: string }) => ['pending', 'processing', 'uploading'].includes(item.status)).length

  let displayStatus = task.status
  if (pendingCount > 0 && task.status !== 'scheduled') displayStatus = 'processing'
  if (items.length > 0 && succeededCount === items.length) displayStatus = 'completed'
  if (failedCount > 0 && succeededCount > 0 && pendingCount === 0) displayStatus = 'partial_failed'
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

const INSTAGRAM_TITLE_MAX_LENGTH = 255
const INSTAGRAM_CAPTION_MAX_LENGTH = 2200
const META_TAGS_MAX_LENGTH = 500

function stripVideoExtension(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDefaultVideoTitle(name: string) {
  return stripVideoExtension(name) || 'Untitled video'
}

function formatTags(tags: string[]) {
  return tags.map((tag) => `#${tag}`).join(' ')
}

function buildInstagramAdapterCaption(title: string, description: string, tags: string[], videoName = 'video') {
  return buildPlatformPublishPayload('instagram', {
    title,
    description,
    videos: [{
      id: 'validation',
      name: videoName,
      title,
      description,
    }],
    account_ids: ['validation'],
    publish_mode: 'now',
    scheduled_at: null,
    tags,
  }).items[0].caption
}

function isAllowedVideoUrl(videoUrl: string | undefined) {
  if (!videoUrl) return false

  try {
    const url = new URL(videoUrl)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseScheduledBaseTime(mode: 'now' | 'scheduled', scheduledAt: string | null) {
  if (mode === 'now') {
    return new Date()
  }

  if (!scheduledAt) {
    throw new Error('请选择 Instagram 本地预约队列时间')
  }

  const parsed = new Date(scheduledAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Instagram 本地预约队列时间格式无效')
  }

  if (parsed.getTime() < Date.now() - 30 * 1000) {
    throw new Error('Instagram 本地预约队列时间不能早于当前时间')
  }

  return parsed
}

function parseBatchInterval(value: number) {
  const minutes = Number(value || 0)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('Instagram 发布间隔必须在 0 到 1440 分钟之间')
  }

  return minutes
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get('host') || request.nextUrl.host
  const hostname = host.split(':')[0]
  return process.env.NODE_ENV !== 'production' || ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function scheduleLocalInstagramQueueProcessing(
  taskId: string,
  mode: 'immediate' | 'scheduled',
  delayMs = 0,
  repollCount = 0
) {
  const timer = setTimeout(() => {
    processInstagramPublishQueue({
      taskId,
      mode,
      maxItems: 20,
    })
      .then((result) => {
        if (result.deferred > 0 && repollCount < LOCAL_CONTAINER_MAX_REPOLLS) {
          scheduleLocalInstagramQueueProcessing(taskId, mode, LOCAL_CONTAINER_REPOLL_DELAY_MS, repollCount + 1)
        }
      })
      .catch((error) => {
        console.error('Local Instagram publish processing failed:', error)
      })
  }, delayMs) as ReturnType<typeof setTimeout> & { unref?: () => void }

  timer.unref?.()
}

function scheduleLocalInstagramProcessing(taskId: string, items: Array<{ scheduled_at: string }>) {
  const dueTimes = Array.from(new Set(
    items
      .map((item) => new Date(item.scheduled_at).getTime())
      .filter((time) => Number.isFinite(time))
  )).sort((a, b) => a - b)

  for (const dueTime of dueTimes) {
    const delayMs = Math.max(0, dueTime - Date.now() + LOCAL_SCHEDULE_PROCESS_GRACE_MS)
    if (delayMs > LOCAL_SCHEDULE_MAX_DELAY_MS) {
      console.info('Skip local Instagram schedule timer beyond 24h window:', { taskId, dueTime: new Date(dueTime).toISOString() })
      continue
    }

    scheduleLocalInstagramQueueProcessing(taskId, 'scheduled', delayMs)
  }
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
      .from('instagram_publish_tasks')
      .select('*, items:instagram_publish_task_items(*)', { count: 'exact' })
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
      console.error('Failed to fetch Instagram tasks:', error)
      return NextResponse.json({ error: '获取 Instagram 发布任务失败' }, { status: 500 })
    }

    const transformed = (data || []).map((task: any) => {
      const summary = summarizeTask(task)
      return {
        ...task,
        name: task.task_name || '未命名 Instagram 任务',
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
    console.error('Instagram tasks GET error:', error)
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

    const body = await request.json() as CreateInstagramTaskRequest

    if (!body.videos || body.videos.length === 0) {
      return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
    }
    if (!body.account_ids || body.account_ids.length === 0) {
      return NextResponse.json({ error: '请至少选择一个 Instagram 账号' }, { status: 400 })
    }
    const uniqueAccountIds = [...new Set(body.account_ids)]
    if (uniqueAccountIds.length !== body.account_ids.length) {
      return NextResponse.json({ error: 'Instagram 账号列表中存在重复账号' }, { status: 400 })
    }
    if (!['now', 'scheduled'].includes(body.publish_mode)) {
      return NextResponse.json({ error: '请选择 Instagram 发布方式' }, { status: 400 })
    }
    if (!body.privacy_status || !['private', 'public'].includes(body.privacy_status)) {
      return NextResponse.json({ error: '请选择 Instagram 可见范围' }, { status: 400 })
    }
    if (body.privacy_status === 'private') {
      return NextResponse.json({ error: 'Instagram 暂不支持草稿发布，请选择公开发布' }, { status: 400 })
    }
    const tags = normalizeTags(body.tags)
    const formattedTags = formatTags(tags)
    if (formattedTags.length > META_TAGS_MAX_LENGTH) {
      return NextResponse.json({ error: `Instagram 标签不能超过 ${META_TAGS_MAX_LENGTH} 个字符` }, { status: 400 })
    }
    if (body.title && body.title.length > INSTAGRAM_TITLE_MAX_LENGTH) {
      return NextResponse.json({ error: `Instagram 标题不能超过 ${INSTAGRAM_TITLE_MAX_LENGTH} 个字符` }, { status: 400 })
    }
    if (body.description && body.description.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
      return NextResponse.json({ error: `Instagram 描述不能超过 ${INSTAGRAM_CAPTION_MAX_LENGTH} 个字符` }, { status: 400 })
    }
    if (buildInstagramAdapterCaption(body.title || '', body.description || '', tags).length > INSTAGRAM_CAPTION_MAX_LENGTH) {
      return NextResponse.json({ error: `Instagram 标题、描述和标签合计不能超过 ${INSTAGRAM_CAPTION_MAX_LENGTH} 个字符` }, { status: 400 })
    }

    for (const video of body.videos) {
      if (!isAllowedVideoUrl(video.url)) {
        return NextResponse.json({ error: `视频"${video.name}"必须使用可由 Meta 服务器访问的公网 HTTPS 地址` }, { status: 400 })
      }
      if (video.title && video.title.length > INSTAGRAM_TITLE_MAX_LENGTH) {
        return NextResponse.json({ error: `视频"${video.name}"的标题不能超过 ${INSTAGRAM_TITLE_MAX_LENGTH} 个字符` }, { status: 400 })
      }
      if (video.description && video.description.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
        return NextResponse.json({ error: `视频"${video.name}"的描述不能超过 ${INSTAGRAM_CAPTION_MAX_LENGTH} 个字符` }, { status: 400 })
      }
      const finalTitle = video.title?.trim() || body.title || getDefaultVideoTitle(video.name)
      const finalDescription = video.description?.trim() || body.description || ''
      if (buildInstagramAdapterCaption(finalTitle, finalDescription, tags, video.name).length > INSTAGRAM_CAPTION_MAX_LENGTH) {
        return NextResponse.json({ error: `视频"${video.name}"的标题、描述和标签合计不能超过 ${INSTAGRAM_CAPTION_MAX_LENGTH} 个字符` }, { status: 400 })
      }
    }

    let baseTime: Date
    let batchIntervalMinutes: number
    try {
      baseTime = parseScheduledBaseTime(body.publish_mode, body.scheduled_at)
      batchIntervalMinutes = parseBatchInterval(body.batch_interval)
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Instagram 发布设置无效' },
        { status: 400 }
      )
    }

    const { data: accounts, error: accountsError } = await (supabase as any)
      .from('instagram_accounts')
      .select('id, status')
      .eq('user_id', user.id)
      .in('id', uniqueAccountIds)

    if (accountsError) {
      return NextResponse.json({ error: `获取 Instagram 账号失败: ${accountsError.message}` }, { status: 500 })
    }

    if (!accounts || accounts.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 Instagram 账号不存在或无权访问' }, { status: 400 })
    }

    const inactiveAccounts = accounts.filter((account: { status: string }) => account.status !== 'active')
    if (inactiveAccounts.length > 0) {
      return NextResponse.json({ error: '部分 Instagram 账号授权不可用，请先刷新或重新绑定' }, { status: 400 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRows, error: tokenRowsError } = await adminSupabase
      .from('instagram_account_tokens')
      .select('account_id')
      .in('account_id', uniqueAccountIds)

    if (tokenRowsError) {
      return NextResponse.json({ error: `检查 Instagram 授权令牌失败: ${tokenRowsError.message}` }, { status: 500 })
    }

    if (!tokenRows || tokenRows.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 Instagram 账号缺少授权令牌，请重新绑定' }, { status: 400 })
    }

    const totalItems = body.videos.length * uniqueAccountIds.length
    const descriptionTemplate = body.description || ''

    const { data: task, error: taskError } = await (supabase as any)
      .from('instagram_publish_tasks')
      .insert({
        user_id: user.id,
        task_name: body.name || '未命名 Instagram 任务',
        title_template: body.title || '',
        description_template: descriptionTemplate,
        privacy_status: body.privacy_status,
        category_id: body.category_id || '22',
        tags,
        made_for_kids: body.made_for_kids ?? false,
        contains_synthetic_media: false,
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
      return NextResponse.json({ error: `创建 Instagram 任务失败: ${taskError.message}` }, { status: 500 })
    }

    const items = []
    let itemIndex = 0
    for (const video of body.videos) {
      for (const accountId of uniqueAccountIds) {
        const scheduledAt = new Date(baseTime.getTime() + itemIndex * batchIntervalMinutes * 60 * 1000)
        const itemTitle = video.title?.trim() || replaceTemplate(body.title || getDefaultVideoTitle(video.name), itemIndex)
        const itemDescription = video.description?.trim() || replaceTemplate(body.description || '', itemIndex)
        items.push({
          task_id: task.id,
          account_id: accountId,
          video_url: video.url,
          video_source: video.type === 'asset' ? 'assets' : video.type,
          source_video_id: video.id,
          source_video_name: video.name,
          title: itemTitle,
          description: itemDescription,
          status: body.publish_mode === 'scheduled' ? 'pending' : 'pending',
          scheduled_at: scheduledAt.toISOString(),
        })
        itemIndex++
      }
    }

    const { error: itemsError } = await (supabase as any)
      .from('instagram_publish_task_items')
      .insert(items)

    if (itemsError) {
      await (supabase as any).from('instagram_publish_tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: `创建 Instagram 任务项失败: ${itemsError.message}` }, { status: 500 })
    }

    let message = body.publish_mode === 'scheduled'
      ? 'Instagram 本地预约队列任务已创建'
      : 'Instagram 发布任务已创建'

    if (body.publish_mode === 'now') {
      if (isLocalRequest(request)) {
        scheduleLocalInstagramQueueProcessing(task.id, 'immediate', 0)
        message = 'Instagram 任务已创建，正在后台发布'
      } else {
        message = 'Instagram 任务已创建，等待 cron 处理'
      }
    } else if (isLocalRequest(request)) {
      scheduleLocalInstagramProcessing(task.id, items)
    }

    return NextResponse.json({
      success: true,
      message,
      task: {
        ...task,
        total_items: items.length,
      },
    })
  } catch (error) {
    console.error('Instagram tasks POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建 Instagram 发布任务失败' },
      { status: 500 }
    )
  }
}
