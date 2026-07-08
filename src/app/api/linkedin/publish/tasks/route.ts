import { NextRequest, NextResponse } from 'next/server'

import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeLinkedInTags,
  validateLinkedInDescription,
  validateLinkedInTags,
  validateLinkedInTitle,
} from '@/lib/linkedin/metadata-rules'
import { isTrustedLinkedInVideoUrl } from '@/lib/linkedin/publish'
import { processLinkedInPublishQueue } from '@/lib/linkedin/processor'

export const dynamic = 'force-dynamic'

const LOCAL_SCHEDULE_PROCESS_GRACE_MS = 1000
const LOCAL_SCHEDULE_MAX_DELAY_MS = 24 * 60 * 60 * 1000
const LINKEDIN_TASK_SELECT = `
  id,
  user_id,
  task_name,
  title_template,
  description_template,
  privacy_status,
  category_id,
  tags,
  made_for_kids,
  contains_synthetic_media,
  notify_subscribers,
  scheduled_at,
  batch_interval_seconds,
  status,
  total_items,
  pending_count,
  published_count,
  failed_count,
  created_at,
  updated_at,
  started_at,
  completed_at,
  items:linkedin_publish_task_items (
    id,
    task_id,
    account_id,
    video_url,
    video_source,
    source_asset_id,
    source_video_id,
    source_video_name,
    title,
    description,
    linkedin_post_urn,
    linkedin_share_url,
    upload_asset_urn,
    status,
    error_code,
    error_message,
    scheduled_at,
    published_at,
    processing_started_at,
    video_processing_started_at,
    processing_poll_count,
    last_video_status,
    publish_attempt_count,
    created_at,
    updated_at
  )
`

interface CreateLinkedInTaskRequest {
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
  tags?: string[]
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

function getVideoBaseName(video: { name?: string }) {
  return (video.name || '').replace(/\.[^.]+$/, '').trim() || video.name || 'Untitled video'
}

function isAllowedLinkedInVideoUrl(videoUrl: string | undefined) {
  return isTrustedLinkedInVideoUrl(videoUrl)
}

function parseScheduledBaseTime(mode: 'now' | 'scheduled', scheduledAt: string | null) {
  if (mode === 'now') {
    return new Date()
  }

  if (!scheduledAt) {
    throw new Error('请选择 LinkedIn 定时发布时间')
  }

  const parsed = new Date(scheduledAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('LinkedIn 定时发布时间格式无效')
  }

  if (parsed.getTime() < Date.now() - 30 * 1000) {
    throw new Error('LinkedIn 定时发布时间不能早于当前时间')
  }

  return parsed
}

function parseBatchInterval(value: number) {
  const minutes = Number(value || 0)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('LinkedIn 发布间隔必须在 0 到 1440 分钟之间')
  }

  return minutes
}

function scheduleLocalLinkedInProcessing(taskId: string, items: Array<{ scheduled_at: string }>) {
  if (process.env.NODE_ENV === 'production') return

  const dueTimes = Array.from(new Set(
    items
      .map((item) => new Date(item.scheduled_at).getTime())
      .filter((time) => Number.isFinite(time))
  )).sort((a, b) => a - b)

  for (const dueTime of dueTimes) {
    const delayMs = Math.max(0, dueTime - Date.now() + LOCAL_SCHEDULE_PROCESS_GRACE_MS)
    if (delayMs > LOCAL_SCHEDULE_MAX_DELAY_MS) {
      console.info('Skip local LinkedIn schedule timer beyond 24h window:', { taskId, dueTime: new Date(dueTime).toISOString() })
      continue
    }

    const timer = setTimeout(() => {
      processLinkedInPublishQueue({
        taskId,
        mode: 'scheduled',
        maxItems: 20,
      }).catch((error) => {
        console.error('Local scheduled LinkedIn publish processing failed:', error)
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
      .from('linkedin_publish_tasks')
      .select(LINKEDIN_TASK_SELECT, { count: 'exact' })
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
      console.error('Failed to fetch LinkedIn tasks:', error)
      return NextResponse.json({ error: '获取 LinkedIn 发布任务失败' }, { status: 500 })
    }

    const transformed = (data || []).map((task: any) => {
      const summary = summarizeTask(task)
      return {
        ...task,
        name: task.task_name || '未命名 LinkedIn 任务',
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
        if (status === 'failed') return ['failed', 'partial_failed'].includes(task.status) || Number(task.failed_count || 0) > 0
        return task.status === status
      })
      : transformed

    return NextResponse.json({
      tasks: status ? filtered.slice(offset, offset + limit) : filtered,
      total: status ? filtered.length : count,
    })
  } catch (error) {
    console.error('LinkedIn tasks GET error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isLinkedInPublishEnabledServer()) {
      return NextResponse.json({ error: 'LinkedIn 发布功能已暂停', disabled: true }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body: CreateLinkedInTaskRequest = await request.json()
    if (!body.videos || body.videos.length === 0) {
      return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
    }
    if (!body.account_ids || body.account_ids.length === 0) {
      return NextResponse.json({ error: '请至少选择一个 LinkedIn 账号' }, { status: 400 })
    }
    const uniqueAccountIds = [...new Set(body.account_ids)]
    if (uniqueAccountIds.length !== body.account_ids.length) {
      return NextResponse.json({ error: 'LinkedIn 账号列表中存在重复账号' }, { status: 400 })
    }
    if (!['now', 'scheduled'].includes(body.publish_mode)) {
      return NextResponse.json({ error: '请选择 LinkedIn 发布方式' }, { status: 400 })
    }

    const tags = normalizeLinkedInTags(body.tags)
    const tagsError = validateLinkedInTags(tags)
    if (tagsError) {
      return NextResponse.json({ error: tagsError }, { status: 400 })
    }

    for (let index = 0; index < body.videos.length; index++) {
      const video = body.videos[index]
      if (!isAllowedLinkedInVideoUrl(video.url)) {
        return NextResponse.json({ error: `视频"${video.name}"需要可信 OSS/CDN 的 HTTPS 视频地址` }, { status: 400 })
      }

      const finalTitle = video.title?.trim() || replaceTemplate(body.title?.trim() || getVideoBaseName(video), index)
      const finalDescription = video.description?.trim() || replaceTemplate(body.description || '', index)
      const titleError = validateLinkedInTitle(finalTitle, `视频"${video.name}"标题`)
      const descriptionError = validateLinkedInDescription(finalDescription, `视频"${video.name}"描述`)
      if (titleError) {
        return NextResponse.json({ error: titleError }, { status: 400 })
      }
      if (descriptionError) {
        return NextResponse.json({ error: descriptionError }, { status: 400 })
      }
    }

    let baseTime: Date
    let batchIntervalMinutes: number
    try {
      baseTime = parseScheduledBaseTime(body.publish_mode, body.scheduled_at)
      batchIntervalMinutes = parseBatchInterval(body.batch_interval)
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'LinkedIn 发布设置无效' },
        { status: 400 }
      )
    }

    const { data: accounts, error: accountsError } = await (supabase as any)
      .from('linkedin_accounts')
      .select('id, status, owner_type, scopes')
      .eq('user_id', user.id)
      .in('id', uniqueAccountIds)

    if (accountsError) {
      return NextResponse.json({ error: `获取 LinkedIn 账号失败: ${accountsError.message}` }, { status: 500 })
    }

    if (!accounts || accounts.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 LinkedIn 账号不存在或无权访问' }, { status: 400 })
    }

    const inactiveAccounts = accounts.filter((account: { status: string }) => account.status !== 'active')
    if (inactiveAccounts.length > 0) {
      return NextResponse.json({ error: '部分 LinkedIn 账号授权不可用，请先刷新或重新绑定' }, { status: 400 })
    }

    const nonMemberAccounts = accounts.filter((account: { owner_type: string }) => account.owner_type !== 'member')
    if (nonMemberAccounts.length > 0) {
      return NextResponse.json({ error: 'LinkedIn 首版仅支持个人身份发布，请重新绑定个人账号' }, { status: 400 })
    }

    const missingPublishScope = accounts.filter((account: { scopes: unknown }) => {
      const scopes = Array.isArray(account.scopes) ? account.scopes.map(String) : []
      return !scopes.includes('w_member_social')
    })
    if (missingPublishScope.length > 0) {
      return NextResponse.json({ error: '部分 LinkedIn 账号缺少 w_member_social 发布权限，请重新授权' }, { status: 400 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRows, error: tokenRowsError } = await adminSupabase
      .from('linkedin_account_tokens')
      .select('account_id, refresh_token, access_token_expires_at')
      .in('account_id', uniqueAccountIds)

    if (tokenRowsError) {
      return NextResponse.json({ error: `检查 LinkedIn 授权令牌失败: ${tokenRowsError.message}` }, { status: 500 })
    }

    if (!tokenRows || tokenRows.length !== uniqueAccountIds.length) {
      return NextResponse.json({ error: '部分 LinkedIn 账号缺少授权令牌，请重新绑定' }, { status: 400 })
    }

    const expiredWithoutRefresh = (tokenRows || []).filter((token: { refresh_token: string | null; access_token_expires_at: string | null }) => {
      if (token.refresh_token || !token.access_token_expires_at) return false
      return new Date(token.access_token_expires_at).getTime() <= Date.now()
    })
    if (expiredWithoutRefresh.length > 0) {
      await adminSupabase
        .from('linkedin_accounts')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .in('id', expiredWithoutRefresh.map((token: { account_id: string }) => token.account_id))

      return NextResponse.json({ error: '部分 LinkedIn 账号授权已过期且无法刷新，请重新绑定' }, { status: 400 })
    }

    const totalItems = body.videos.length * uniqueAccountIds.length

    const { data: task, error: taskError } = await (supabase as any)
      .from('linkedin_publish_tasks')
      .insert({
        user_id: user.id,
        task_name: body.name || '未命名 LinkedIn 任务',
        title_template: body.title || '',
        description_template: body.description || '',
        privacy_status: 'public',
        category_id: 'linkedin',
        tags,
        made_for_kids: false,
        contains_synthetic_media: true,
        notify_subscribers: false,
        scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
        batch_interval_seconds: batchIntervalMinutes * 60,
        status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
        total_items: totalItems,
        pending_count: totalItems,
      })
      .select()
      .single()

    if (taskError) {
      return NextResponse.json({ error: `创建 LinkedIn 任务失败: ${taskError.message}` }, { status: 500 })
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
          title: video.title?.trim() || replaceTemplate(body.title?.trim() || getVideoBaseName(video), itemIndex).trim(),
          description: video.description?.trim() || replaceTemplate(body.description || '', itemIndex),
          status: 'pending',
          scheduled_at: scheduledAt.toISOString(),
        })
        itemIndex++
      }
    }

    const { error: itemsError } = await (supabase as any)
      .from('linkedin_publish_task_items')
      .insert(items)

    if (itemsError) {
      await (supabase as any).from('linkedin_publish_tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: `创建 LinkedIn 任务项失败: ${itemsError.message}` }, { status: 500 })
    }

    if (body.publish_mode === 'now') {
      processLinkedInPublishQueue({ taskId: task.id, mode: 'immediate' }).catch((error) => {
        console.error('Background LinkedIn publish processing failed:', error)
      })
    } else {
      scheduleLocalLinkedInProcessing(task.id, items)
    }

    return NextResponse.json({
      success: true,
      task: {
        ...task,
        total_items: items.length,
      },
    })
  } catch (error) {
    console.error('LinkedIn tasks POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建 LinkedIn 发布任务失败' },
      { status: 500 }
    )
  }
}
