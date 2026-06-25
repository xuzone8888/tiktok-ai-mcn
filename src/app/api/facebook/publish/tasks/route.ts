import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { processFacebookPublishQueue } from '@/lib/facebook/processor'
import { buildPlatformPublishPayload } from '@/lib/publish/platform-adapters'

export const dynamic = 'force-dynamic'

type FacebookPrivacyStatus = 'public'
const LOCAL_SCHEDULE_PROCESS_GRACE_MS = 1000
const LOCAL_SCHEDULE_MAX_DELAY_MS = 24 * 60 * 60 * 1000

interface CreateFacebookTaskRequest {
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
  privacy_status: FacebookPrivacyStatus
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
  const terminalSuccessStatuses = new Set(['published', 'draft_created'])
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

function normalizeTaskItems(task: any) {
  const items = Array.isArray(task.items) ? task.items : []
  return items.map((item: any) => {
    const hasPublishedResult = Boolean(item.published_at || item.facebook_watch_url)
    if (!hasPublishedResult || item.status === 'failed') return item

    return {
      ...item,
      status: 'published',
    }
  })
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

const FACEBOOK_TITLE_MAX_LENGTH = 255
const FACEBOOK_DESCRIPTION_MAX_LENGTH = 63206
const META_TAGS_MAX_LENGTH = 500
const FACEBOOK_CONTENT_CATEGORIES = new Set([
  'BEAUTY_FASHION',
  'BUSINESS',
  'CARS_TRUCKS',
  'COMEDY',
  'CUTE_ANIMALS',
  'ENTERTAINMENT',
  'FAMILY',
  'FOOD_HEALTH',
  'HOME',
  'LIFESTYLE',
  'MUSIC',
  'NEWS',
  'POLITICS',
  'SCIENCE',
  'SPORTS',
  'TECHNOLOGY',
  'VIDEO_GAMING',
  'OTHER',
])

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

function appendTagsToDescription(description: string, tags: string[]) {
  return [description.trim(), formatTags(tags)].filter(Boolean).join('\n\n')
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
      url.pathname.startsWith('/api/facebook/upload/local-video/') &&
      url.searchParams.has('expires') &&
      url.searchParams.has('token')
    )
  } catch {
    return false
  }
}

const FACEBOOK_MAX_SCHEDULE_AHEAD_MS = 183 * 24 * 60 * 60 * 1000

function parseScheduledBaseTime(mode: 'now' | 'scheduled', scheduledAt: string | null) {
  if (mode === 'now') {
    return new Date()
  }

  if (!scheduledAt) {
    throw new Error('请选择 Facebook 本地预约队列时间')
  }

  const parsed = new Date(scheduledAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Facebook 本地预约队列时间格式无效')
  }

  const now = Date.now()
  if (parsed.getTime() <= now) {
    throw new Error('Facebook 本地预约队列时间不能早于当前时间')
  }
  if (parsed.getTime() > now + FACEBOOK_MAX_SCHEDULE_AHEAD_MS) {
    throw new Error('Facebook 本地预约队列时间不能超过 6 个月')
  }

  return parsed
}

function parseBatchInterval(value: number) {
  const minutes = Number(value || 0)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('Facebook 发布间隔必须在 0 到 1440 分钟之间')
  }

  return minutes
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get('host') || request.nextUrl.host
  const hostname = host.split(':')[0]
  return process.env.NODE_ENV !== 'production' || ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function scheduleLocalFacebookProcessing(taskId: string, items: Array<{ scheduled_at: string }>) {
  const dueTimes = Array.from(new Set(
    items
      .map((item) => new Date(item.scheduled_at).getTime())
      .filter((time) => Number.isFinite(time))
  )).sort((a, b) => a - b)

  for (const dueTime of dueTimes) {
    const delayMs = Math.max(0, dueTime - Date.now() + LOCAL_SCHEDULE_PROCESS_GRACE_MS)
    if (delayMs > LOCAL_SCHEDULE_MAX_DELAY_MS) {
      console.info('Skip local Facebook schedule timer beyond 24h window:', { taskId, dueTime: new Date(dueTime).toISOString() })
      continue
    }

    const timer = setTimeout(() => {
      processFacebookPublishQueue({
        taskId,
        mode: 'scheduled',
        maxItems: 20,
      }).catch((error) => {
        console.error('Local scheduled Facebook publish processing failed:', error)
      })
    }, delayMs) as ReturnType<typeof setTimeout> & { unref?: () => void }

    timer.unref?.()
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
      .from('facebook_publish_tasks')
      .select('*, items:facebook_publish_task_items(*)', { count: 'exact' })
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
      console.error('Failed to fetch Facebook tasks:', error)
      return NextResponse.json({ error: '获取 Facebook 发布任务失败' }, { status: 500 })
    }

    const transformed = (data || []).map((task: any) => {
      const items = normalizeTaskItems(task)
      const normalizedTask = { ...task, items }
      const summary = summarizeTask(normalizedTask)
      return {
        ...normalizedTask,
        name: task.task_name || '未命名 Facebook 任务',
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
    console.error('Facebook tasks GET error:', error)
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

    const body = await request.json() as CreateFacebookTaskRequest

    if (!body.videos || body.videos.length === 0) {
      return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
    }
    if (!body.account_ids || body.account_ids.length === 0) {
      return NextResponse.json({ error: '请至少选择一个 Facebook 账号' }, { status: 400 })
    }
    const uniqueAccountIds = [...new Set(body.account_ids)]
    if (uniqueAccountIds.length !== body.account_ids.length) {
      return NextResponse.json({ error: 'Facebook 账号列表中存在重复账号' }, { status: 400 })
    }
    if (!['now', 'scheduled'].includes(body.publish_mode)) {
      return NextResponse.json({ error: '请选择 Facebook 发布方式' }, { status: 400 })
    }
    if (body.privacy_status !== 'public') {
      return NextResponse.json({
        error: 'Facebook 当前仅支持公开发布。未发布/广告草稿需要 Page 的 ADVERTISE 权限和 pages_manage_ads，后续请作为独立能力接入。',
      }, { status: 400 })
    }
    const tags = normalizeTags(body.tags)
    const formattedTags = formatTags(tags)
    if (formattedTags.length > META_TAGS_MAX_LENGTH) {
      return NextResponse.json({ error: `Facebook 标签不能超过 ${META_TAGS_MAX_LENGTH} 个字符` }, { status: 400 })
    }
    const categoryId = body.category_id || 'OTHER'
    if (!FACEBOOK_CONTENT_CATEGORIES.has(categoryId)) {
      return NextResponse.json({ error: 'Facebook 分类无效' }, { status: 400 })
    }
    if (body.title && body.title.length > FACEBOOK_TITLE_MAX_LENGTH) {
      return NextResponse.json({ error: `Facebook 标题不能超过 ${FACEBOOK_TITLE_MAX_LENGTH} 个字符` }, { status: 400 })
    }
    if (appendTagsToDescription(body.description || '', tags).length > FACEBOOK_DESCRIPTION_MAX_LENGTH) {
      return NextResponse.json({ error: `Facebook 描述和标签合计不能超过 ${FACEBOOK_DESCRIPTION_MAX_LENGTH} 个字符` }, { status: 400 })
    }

    for (const video of body.videos) {
      if (!isAllowedVideoUrl(video.url)) {
        return NextResponse.json({ error: `视频"${video.name}"缺少有效视频地址` }, { status: 400 })
      }
      if (video.title && video.title.length > FACEBOOK_TITLE_MAX_LENGTH) {
        return NextResponse.json({ error: `视频"${video.name}"的标题不能超过 ${FACEBOOK_TITLE_MAX_LENGTH} 个字符` }, { status: 400 })
      }
      const finalVideoDescription = appendTagsToDescription(video.description || body.description || '', tags)
      if (finalVideoDescription.length > FACEBOOK_DESCRIPTION_MAX_LENGTH) {
        return NextResponse.json({ error: `视频"${video.name}"的描述和标签合计不能超过 ${FACEBOOK_DESCRIPTION_MAX_LENGTH} 个字符` }, { status: 400 })
      }
    }

    let baseTime: Date
    let batchIntervalMinutes: number
    try {
      baseTime = parseScheduledBaseTime(body.publish_mode, body.scheduled_at)
      batchIntervalMinutes = parseBatchInterval(body.batch_interval)
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Facebook 发布设置无效' },
        { status: 400 }
      )
    }

    const { data: accounts, error: accountsError } = await (supabase as any)
      .from('facebook_accounts')
      .select('id, status')
      .eq('user_id', user.id)
      .in('id', uniqueAccountIds)

    if (accountsError) {
      return NextResponse.json({ error: `获取 Facebook 账号失败: ${accountsError.message}` }, { status: 500 })
    }

    if (!accounts || accounts.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 Facebook 账号不存在或无权访问' }, { status: 400 })
    }

    const inactiveAccounts = accounts.filter((account: { status: string }) => account.status !== 'active')
    if (inactiveAccounts.length > 0) {
      return NextResponse.json({ error: '部分 Facebook 账号授权不可用，请先刷新或重新绑定' }, { status: 400 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRows, error: tokenRowsError } = await adminSupabase
      .from('facebook_account_tokens')
      .select('account_id')
      .in('account_id', uniqueAccountIds)

    if (tokenRowsError) {
      return NextResponse.json({ error: `检查 Facebook 授权令牌失败: ${tokenRowsError.message}` }, { status: 500 })
    }

    if (!tokenRows || tokenRows.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 Facebook 账号缺少授权令牌，请重新绑定' }, { status: 400 })
    }

    const totalItems = body.videos.length * uniqueAccountIds.length
    const descriptionTemplate = appendTagsToDescription(body.description || '', tags)

    const { data: task, error: taskError } = await (supabase as any)
      .from('facebook_publish_tasks')
      .insert({
        user_id: user.id,
        task_name: body.name || '未命名 Facebook 任务',
        title_template: body.title || '',
        description_template: descriptionTemplate,
        privacy_status: body.privacy_status,
        category_id: categoryId,
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
      return NextResponse.json({ error: `创建 Facebook 任务失败: ${taskError.message}` }, { status: 500 })
    }

    const items = []
    let itemIndex = 0
    for (const video of body.videos) {
      for (const accountId of uniqueAccountIds) {
        const scheduledAt = new Date(baseTime.getTime() + itemIndex * batchIntervalMinutes * 60 * 1000)
        const itemTitle = video.title?.trim() || replaceTemplate(body.title || getDefaultVideoTitle(video.name), itemIndex)
        const itemRawDescription = video.description?.trim() || replaceTemplate(body.description || '', itemIndex)
        const platformPayload = buildPlatformPublishPayload('facebook', {
          title: itemTitle,
          description: itemRawDescription,
          videos: [{
            id: video.id,
            name: video.name,
            url: video.url,
            title: itemTitle,
            description: itemRawDescription,
          }],
          account_ids: [accountId],
          publish_mode: body.publish_mode,
          scheduled_at: scheduledAt.toISOString(),
          tags,
          platform_settings: {
            content_category: categoryId,
            published: true,
          },
        }).items[0]
        items.push({
          task_id: task.id,
          account_id: accountId,
          video_url: video.url,
          video_source: video.type === 'asset' ? 'assets' : video.type,
          source_video_id: video.id,
          source_video_name: video.name,
          title: platformPayload.title,
          description: platformPayload.description,
          status: body.publish_mode === 'scheduled' ? 'pending' : 'pending',
          scheduled_at: scheduledAt.toISOString(),
        })
        itemIndex++
      }
    }

    const { error: itemsError } = await (supabase as any)
      .from('facebook_publish_task_items')
      .insert(items)

    if (itemsError) {
      await (supabase as any).from('facebook_publish_tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: `创建 Facebook 任务项失败: ${itemsError.message}` }, { status: 500 })
    }

    let processingResult = null
    let message = body.publish_mode === 'scheduled'
      ? 'Facebook 本地预约队列任务已创建'
      : 'Facebook 发布任务已创建'

    if (body.publish_mode === 'now') {
      if (isLocalRequest(request)) {
        processingResult = await processFacebookPublishQueue({ taskId: task.id, mode: 'immediate' })
        if (processingResult.failed > 0 && processingResult.success === 0) {
          return NextResponse.json({
            success: false,
            error: `Facebook 任务已创建，但立即发布失败: ${processingResult.errors[0] || '请查看任务详情'}`,
            task: {
              ...task,
              total_items: items.length,
            },
            processing: processingResult,
          }, { status: 500 })
        }
        message = processingResult.failed > 0
          ? 'Facebook 任务已创建，本地立即处理完成但存在失败项'
          : 'Facebook 任务已创建并已完成本地立即处理'
      } else {
        message = 'Facebook 任务已创建，等待 cron 处理'
      }
    } else if (isLocalRequest(request)) {
      scheduleLocalFacebookProcessing(task.id, items)
    }

    return NextResponse.json({
      success: true,
      message,
      task: {
        ...task,
        total_items: items.length,
      },
      ...(processingResult ? { processing: processingResult } : {}),
    })
  } catch (error) {
    console.error('Facebook tasks POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建 Facebook 发布任务失败' },
      { status: 500 }
    )
  }
}
