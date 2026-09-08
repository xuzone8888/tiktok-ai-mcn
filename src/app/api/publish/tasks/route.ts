import { createHash } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'

import { processPublishQueue } from '@/lib/publish-processor'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

// TikTok Content Posting request types used by the task-creation boundary.
type VideoPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'
const REVIEW_ERROR_CODE = 'WORKER_INTERRUPTED_NEEDS_REVIEW'
const REVIEW_ERROR_CODES = new Set([
    REVIEW_ERROR_CODE,
    'TIKTOK_INIT_OUTCOME_UNKNOWN',
])

function getPlanConfigRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? value as Record<string, any> : {}
}

function summarizeTaskItems(task: any) {
    const items = Array.isArray(task.items) ? task.items : []
    const isMultiTask = task.workflow === 'multi_task'
    const publishedCount = items.filter((i: { status: string }) => i.status === 'published').length
    const scheduledCount = items.filter((i: { status: string }) => i.status === 'pending' || i.status === 'scheduled').length
    const activeCount = items.filter((i: { status: string }) => i.status === 'processing').length
    const confirmingCount = items.filter((i: { status: string }) => i.status === 'uploading').length
    const reviewCount = items.filter((i: { status: string; error_code?: string | null }) => (
        i.status === 'failed' && Boolean(i.error_code && REVIEW_ERROR_CODES.has(i.error_code))
    )).length
    const failedCount = items.filter((i: { status: string; error_code?: string | null }) => (
        i.status === 'failed' && !Boolean(i.error_code && REVIEW_ERROR_CODES.has(i.error_code))
    )).length
    const cancelledCount = items.filter((i: { status: string }) => i.status === 'cancelled').length
    const nextScheduledAt = items
        .filter((i: { status: string; scheduled_at?: string | null }) => ['pending', 'scheduled'].includes(i.status) && i.scheduled_at)
        .map((i: { scheduled_at: string }) => i.scheduled_at)
        .sort()[0] || null
    const scheduledTimes = items
        .filter((i: { scheduled_at?: string | null }) => i.scheduled_at)
        .map((i: { scheduled_at: string }) => i.scheduled_at)
        .sort()
    const lastScheduledAt = scheduledTimes.length > 0 ? scheduledTimes[scheduledTimes.length - 1] : null
    const planConfig = getPlanConfigRecord(task.plan_config)
    const group = getPlanConfigRecord(planConfig.group)

    let displayStatus = task.status
    if (reviewCount > 0) {
        displayStatus = 'needs_review'
    } else if (isMultiTask) {
        if (activeCount > 0) displayStatus = 'running'
        else if (confirmingCount > 0) displayStatus = 'confirming'
        else if (scheduledCount > 0 && publishedCount > 0) displayStatus = 'scheduled'
        else if (scheduledCount > 0) displayStatus = 'scheduled'
        else if (failedCount > 0 && publishedCount > 0) displayStatus = 'partial_failed'
        else if (failedCount > 0) displayStatus = 'failed'
        else if (publishedCount > 0 && publishedCount === items.length) displayStatus = 'completed'
    }

    return {
        isMultiTask,
        publishedCount,
        scheduledCount,
        activeCount,
        confirmingCount,
        reviewCount,
        failedCount,
        cancelledCount,
        nextScheduledAt,
        lastScheduledAt,
        displayStatus,
        accountGroupName: typeof group.name === 'string' ? group.name : null,
        videoCount: new Set(items.map((i: { video_url: string }) => i.video_url)).size,
        accountCount: new Set(items.map((i: { account_id: string }) => i.account_id)).size,
    }
}

// Types for request body
interface CreateTaskRequest {
    idempotency_key?: string
    name: string  // 任务组名称（必填）
    videos: Array<{
        id: string
        type: 'asset' | 'upload' | 'url'
        name: string
        url?: string
        title?: string  // 视频独立标题（优先级高于全局 caption）
        coverTimestampMs?: number  // 封面帧时间戳（毫秒）
        sizeBytes?: number
        mimeType?: string
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
    transfer_method?: 'PULL_FROM_URL' | 'FILE_UPLOAD'
}

const TIKTOK_FILE_UPLOAD_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const TIKTOK_MAX_FILE_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
const ORDINARY_MAX_VIDEOS = 40
const ORDINARY_MAX_ACCOUNTS = 20
const ORDINARY_MAX_ITEMS = ORDINARY_MAX_VIDEOS * ORDINARY_MAX_ACCOUNTS
const ORDINARY_MAX_INTERVAL_MINUTES = 1440
const ORDINARY_TASK_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,160}$/
const ORDINARY_CREATE_METADATA_KEY = 'ordinary_create'
const TIKTOK_VIDEO_PRIVACY_LEVELS = new Set<VideoPrivacyLevel>([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
])
const VIDEO_SOURCE_TYPES = new Set(['asset', 'upload', 'url'])

interface OrdinaryCreateMetadata {
    version: 1
    request_fingerprint: string
    base_time_iso: string
    render_date: string
}

type PublishTaskRow = Database['public']['Tables']['publish_tasks']['Row']

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function buildOrdinaryCreateFingerprint(body: CreateTaskRequest, transferMethod: 'PULL_FROM_URL' | 'FILE_UPLOAD'): string {
    return sha256(JSON.stringify({
        name: body.name || '',
        videos: body.videos.map(video => ({
            id: video.id,
            type: video.type,
            name: video.name,
            url: transferMethod === 'FILE_UPLOAD' ? null : (video.url || null),
            title: video.title || null,
            cover_timestamp_ms: video.coverTimestampMs ?? null,
            size_bytes: transferMethod === 'FILE_UPLOAD' ? (video.sizeBytes ?? null) : null,
            mime_type: transferMethod === 'FILE_UPLOAD' ? (video.mimeType || null) : null,
        })),
        account_ids: body.account_ids,
        caption: body.caption || '',
        privacy_level: body.privacy_level,
        allow_comment: Boolean(body.allow_comment),
        allow_duet: Boolean(body.allow_duet),
        allow_stitch: Boolean(body.allow_stitch),
        brand_content_toggle: Boolean(body.brand_content_toggle),
        brand_organic_toggle: Boolean(body.brand_organic_toggle),
        is_ai_generated: Boolean(body.is_ai_generated),
        publish_mode: body.publish_mode,
        scheduled_at: body.scheduled_at,
        batch_interval: body.batch_interval,
        transfer_method: transferMethod,
    }))
}

function readOrdinaryCreateMetadata(planConfig: unknown): OrdinaryCreateMetadata | null {
    const root = getPlanConfigRecord(planConfig)
    const value = getPlanConfigRecord(root[ORDINARY_CREATE_METADATA_KEY])
    return value.version === 1
        && typeof value.request_fingerprint === 'string'
        && typeof value.base_time_iso === 'string'
        && typeof value.render_date === 'string'
        ? value as unknown as OrdinaryCreateMetadata
        : null
}

function isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestTargetsFileUploadEndpoint(request: NextRequest): boolean {
    let pathname = request.nextUrl?.pathname || ''
    if (!pathname && typeof request.url === 'string') {
        try {
            pathname = new URL(request.url).pathname
        } catch {
            pathname = ''
        }
    }
    return pathname.replace(/\/+$/, '') === '/api/publish/file-tasks'
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
    return typeof value === 'string'
        && value.length <= maxLength
        && (allowEmpty || value.trim().length > 0)
        && !value.includes('\u0000')
}

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
    return isBoundedString(value, maxLength)
        && !/[\u0000-\u0020\u007F]/.test(value)
}

function isHttpsUrl(value: string): boolean {
    if (value.length > 4096) return false
    try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash
    } catch {
        return false
    }
}

function validateCreateTaskBody(value: unknown): string | null {
    if (!isRecord(value)) return '发布请求格式无效'

    if (!Array.isArray(value.videos) || value.videos.length === 0) return '请至少选择一个视频'
    if (value.videos.length > ORDINARY_MAX_VIDEOS) return `一次最多选择 ${ORDINARY_MAX_VIDEOS} 个视频`
    if (!Array.isArray(value.account_ids) || value.account_ids.length === 0) return '请至少选择一个发布账号'
    if (value.account_ids.length > ORDINARY_MAX_ACCOUNTS) return `一次最多选择 ${ORDINARY_MAX_ACCOUNTS} 个账号`
    if (value.videos.length * value.account_ids.length > ORDINARY_MAX_ITEMS) {
        return `一次最多创建 ${ORDINARY_MAX_ITEMS} 个发布任务项`
    }

    if (value.name !== undefined && !isBoundedString(value.name, 100, true)) return '任务名称格式无效'
    if (!isBoundedString(value.caption, 2200, true)) return '标题格式无效'
    if (value.idempotency_key !== undefined && !isBoundedIdentifier(value.idempotency_key, 160)) return '发布请求标识无效'
    if (!TIKTOK_VIDEO_PRIVACY_LEVELS.has(value.privacy_level as VideoPrivacyLevel)) return '请选择有效的可见范围'
    if (value.publish_mode !== 'now' && value.publish_mode !== 'scheduled') return '发布方式无效'
    if (!Number.isSafeInteger(value.batch_interval)
        || Number(value.batch_interval) < 0
        || Number(value.batch_interval) > ORDINARY_MAX_INTERVAL_MINUTES) {
        return `发布间隔必须是 0 到 ${ORDINARY_MAX_INTERVAL_MINUTES} 分钟之间的整数`
    }

    for (const field of [
        'allow_comment',
        'allow_duet',
        'allow_stitch',
        'brand_content_toggle',
        'brand_organic_toggle',
        'is_ai_generated',
    ]) {
        if (typeof value[field] !== 'boolean') return '发布设置格式无效'
    }

    if (value.publish_mode === 'scheduled') {
        if (!isBoundedString(value.scheduled_at, 64)) return '请选择定时发布时间'
        const scheduledAt = new Date(value.scheduled_at)
        if (Number.isNaN(scheduledAt.getTime())) return '定时发布时间无效'
    } else if (value.scheduled_at !== null && value.scheduled_at !== undefined) {
        return '立即发布不应包含定时时间'
    }

    for (const accountId of value.account_ids) {
        if (!isBoundedIdentifier(accountId, 160)) return '发布账号标识无效'
    }

    for (const candidate of value.videos) {
        if (!isRecord(candidate)) return '视频参数无效'
        if (!isBoundedIdentifier(candidate.id, 200) || !isBoundedString(candidate.name, 255)) return '视频标识或名称无效'
        if (!VIDEO_SOURCE_TYPES.has(String(candidate.type))) return '视频来源类型无效'
        if (candidate.title !== undefined && !isBoundedString(candidate.title, 2200, true)) return '视频标题格式无效'
        if (candidate.coverTimestampMs !== undefined && (
            !Number.isSafeInteger(candidate.coverTimestampMs) || Number(candidate.coverTimestampMs) < 0
        )) return '视频封面时间无效'
        if (candidate.url !== undefined && typeof candidate.url !== 'string') return '视频地址格式无效'
        if (candidate.sizeBytes !== undefined && !Number.isSafeInteger(candidate.sizeBytes)) return '视频文件大小无效'
        if (candidate.mimeType !== undefined && typeof candidate.mimeType !== 'string') return '视频文件类型无效'
    }

    return null
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
      `, { count: 'exact' })
            .eq('user_id', user.id)
            .gte('created_at', startDate.toISOString())
            .order('created_at', { ascending: false })

        // Add end date filter for 'yesterday'
        if (endDate) {
            query = query.lt('created_at', endDate.toISOString())
        }

        if (!status) {
            query = query.range(offset, offset + limit - 1)
        }

        const { data: tasks, error, count } = await query

        if (error) {
            console.error('Failed to fetch tasks:', error)
            return NextResponse.json({ error: '获取发布任务失败' }, { status: 500 })
        }

        // Transform tasks to include summary info
        const transformedTasks = tasks?.map(task => {
            const summary = summarizeTaskItems(task)
            const totalItems = task.items?.length || 0
            const isMultiTask = summary.isMultiTask
            const {
                items: _items,
                plan_config: _planConfig,
                idempotency_key: _idempotencyKey,
                ...publicTask
            } = task

            return {
                ...publicTask,
                name: task.name || task.task_name || '未命名任务组',
                display_status: summary.displayStatus,
                account_group_name: summary.accountGroupName,
                video_count: summary.videoCount,
                account_count: summary.accountCount,
                total_items: totalItems,
                published_count: isMultiTask ? summary.publishedCount : (task.published_count ?? summary.publishedCount),
                pending_count: isMultiTask ? summary.scheduledCount : (task.pending_count ?? summary.scheduledCount),
                failed_count: isMultiTask ? summary.failedCount : (task.failed_count ?? summary.failedCount),
                active_count: summary.activeCount,
                confirming_count: summary.confirmingCount,
                review_count: summary.reviewCount,
                cancelled_count: summary.cancelledCount,
                next_scheduled_at: summary.nextScheduledAt,
                last_scheduled_at: summary.lastScheduledAt,
                completed_items: summary.publishedCount,
                failed_items: summary.failedCount,
            }
        }) || []

        const matchesStatus = (task: { status: string; display_status?: string | null }) => {
            if (!status) return true
            const effectiveStatus = task.display_status || task.status
            if (status === 'in_progress') {
                return ['pending', 'running', 'scheduled', 'confirming'].includes(effectiveStatus)
            }
            if (status === 'failed') {
                return ['failed', 'partial_failed', 'needs_review'].includes(effectiveStatus)
            }
            return effectiveStatus === status
        }

        const filteredTasks = transformedTasks.filter(matchesStatus)
        const pagedTasks = status ? filteredTasks.slice(offset, offset + limit) : filteredTasks

        return NextResponse.json({
            tasks: pagedTasks,
            total: status ? filteredTasks.length : count
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

        const rawBody = await request.json().catch(() => null)
        const validationError = validateCreateTaskBody(rawBody)
        if (validationError) {
            return NextResponse.json({ error: validationError }, { status: 400 })
        }
        const body = rawBody as unknown as CreateTaskRequest

        // Validate required fields
        if (!body.videos || body.videos.length === 0) {
            return NextResponse.json({ error: '请至少选择一个视频' }, { status: 400 })
        }
        if (!body.account_ids || body.account_ids.length === 0) {
            return NextResponse.json({ error: '请至少选择一个发布账号' }, { status: 400 })
        }


        const transferMethod = body.transfer_method ?? 'PULL_FROM_URL'
        if (transferMethod !== 'PULL_FROM_URL' && transferMethod !== 'FILE_UPLOAD') {
            return NextResponse.json({ error: '不支持的视频传输方式' }, { status: 400 })
        }
        const endpointTransferMethod = requestTargetsFileUploadEndpoint(request)
            ? 'FILE_UPLOAD'
            : 'PULL_FROM_URL'
        if (transferMethod !== endpointTransferMethod) {
            return NextResponse.json({ error: '视频传输方式与请求入口不匹配' }, { status: 400 })
        }
        const idempotencyKey = typeof body.idempotency_key === 'string'
            ? body.idempotency_key.trim()
            : ''
        if (idempotencyKey && !ORDINARY_TASK_IDEMPOTENCY_KEY.test(idempotencyKey)) {
            return NextResponse.json({ error: '发布请求标识无效，请刷新页面后重试' }, { status: 400 })
        }
        if (new Set(body.videos.map(video => video.id)).size !== body.videos.length) {
            return NextResponse.json({ error: '视频标识重复，请重新选择视频' }, { status: 400 })
        }
        if (transferMethod === 'FILE_UPLOAD') {
            if (!idempotencyKey) {
                return NextResponse.json({ error: '本地直传缺少发布请求标识，请刷新页面后重试' }, { status: 400 })
            }
            if (body.publish_mode !== 'now') {
                return NextResponse.json({ error: 'TikTok 本地文件直传仅支持立即发布' }, { status: 400 })
            }
            const invalidFile = body.videos.find(video => (
                video.type !== 'upload'
                || Boolean(video.url)
                || !Number.isSafeInteger(video.sizeBytes)
                || Number(video.sizeBytes) <= 0
                || Number(video.sizeBytes) > TIKTOK_MAX_FILE_UPLOAD_BYTES
                || !TIKTOK_FILE_UPLOAD_MIME_TYPES.has(video.mimeType || '')
            ))
            if (invalidFile) {
                return NextResponse.json({ error: '本地直传文件参数无效，请重新选择视频' }, { status: 400 })
            }
        } else {
            const invalidUrlVideo = body.videos.find(video => !video.url || !isHttpsUrl(video.url))
            if (invalidUrlVideo) {
                return NextResponse.json({ error: '视频地址无效，请重新选择视频' }, { status: 400 })
            }
        }
        if (new Set(body.account_ids).size !== body.account_ids.length) {
            return NextResponse.json({ error: '发布账号重复，请重新选择账号' }, { status: 400 })
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

        // Calculate total items upfront: videos × accounts. A supplied idempotency
        // key is bound to the complete semantic request, so a replay can repair a
        // partially-created task without ever creating a second parent task.
        const totalItemsCount = body.videos.length * body.account_ids.length
        const requestFingerprint = idempotencyKey
            ? buildOrdinaryCreateFingerprint(body, transferMethod)
            : null
        const freshBaseTime = body.publish_mode === 'scheduled' && body.scheduled_at
            ? new Date(body.scheduled_at)
            : new Date()
        if (Number.isNaN(freshBaseTime.getTime())) {
            return NextResponse.json({ error: '定时发布时间无效' }, { status: 400 })
        }

        let task: PublishTaskRow | null = null
        let createMetadata: OrdinaryCreateMetadata = {
            version: 1,
            request_fingerprint: requestFingerprint || '',
            base_time_iso: freshBaseTime.toISOString(),
            render_date: new Date().toLocaleDateString('zh-CN'),
        }

        const readIdempotentTask = async () => {
            if (!idempotencyKey) return { data: null, error: null }
            return supabase
                .from('publish_tasks')
                .select('*')
                .eq('user_id', user.id)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle()
        }

        if (idempotencyKey) {
            const existingResult = await readIdempotentTask()
            if (existingResult.error) {
                console.error('Failed to read idempotent publish task:', existingResult.error)
                return NextResponse.json({ error: '创建任务状态暂时无法确认，请使用原页面重试' }, { status: 500 })
            }
            task = existingResult.data
            if (task) {
                const storedMetadata = readOrdinaryCreateMetadata(task.plan_config)
                if (!storedMetadata || storedMetadata.request_fingerprint !== requestFingerprint) {
                    return NextResponse.json({ error: '该发布请求标识已用于不同内容，请检查任务列表' }, { status: 409 })
                }
                createMetadata = storedMetadata
            }
        }

        // A matching task proves that this exact request already passed the
        // ownership/type/expiry checks before its parent row was created. Replays
        // must reach that task even if authorization expires after a lost response;
        // item init/complete routes independently re-authorize sensitive actions.
        if (!task) {
            const { data: accounts, error: accountsError } = await supabase
                .from('tiktok_accounts')
                .select('id, open_id, token_expires_at')
                .eq('user_id', user.id)
                .eq('account_type', 'normal')
                .eq('status', 'active')
                .in('id', body.account_ids)

            if (accountsError) {
                console.error('Failed to fetch accounts:', accountsError)
                return NextResponse.json({ error: '获取账号信息失败' }, { status: 500 })
            }

            if (!accounts || accounts.length !== body.account_ids.length) {
                return NextResponse.json({ error: '部分账号不存在或无权访问' }, { status: 400 })
            }

            const now = new Date()
            const expiredAccounts = accounts.filter(a => a.token_expires_at && new Date(a.token_expires_at) <= now)
            if (expiredAccounts.length > 0) {
                return NextResponse.json({
                    error: '部分账号授权已过期，请先刷新授权',
                    expired_count: expiredAccounts.length
                }, { status: 400 })
            }
        }

        if (!task) {
            const taskInsert = await supabase
                .from('publish_tasks')
                .insert({
                    user_id: user.id,
                    task_name: body.name || '未命名任务组',
                    status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                    scheduled_at: body.publish_mode === 'scheduled' ? body.scheduled_at : null,
                    title_template: body.caption,
                    privacy_level: body.privacy_level,
                    allow_comment: body.allow_comment,
                    allow_duet: body.allow_duet,
                    allow_stitch: body.allow_stitch,
                    brand_content_toggle: body.brand_content_toggle ?? false,
                    brand_organic_toggle: body.brand_organic_toggle ?? false,
                    is_aigc: body.is_ai_generated ?? true,
                    batch_interval_seconds: body.batch_interval * 60,
                    total_items: totalItemsCount,
                    pending_count: totalItemsCount,
                    published_count: 0,
                    failed_count: 0,
                    workflow: 'standard',
                    ...(idempotencyKey ? {
                        idempotency_key: idempotencyKey,
                        plan_config: {
                            [ORDINARY_CREATE_METADATA_KEY]: {
                                version: createMetadata.version,
                                request_fingerprint: createMetadata.request_fingerprint,
                                base_time_iso: createMetadata.base_time_iso,
                                render_date: createMetadata.render_date,
                            },
                        },
                    } : {}),
                })
                .select()
                .single()

            if (taskInsert.error && idempotencyKey && isUniqueViolation(taskInsert.error)) {
                const winnerResult = await readIdempotentTask()
                if (winnerResult.error || !winnerResult.data) {
                    console.error('Failed to resolve concurrent publish task creation')
                    return NextResponse.json({ error: '创建任务状态暂时无法确认，请使用原页面重试' }, { status: 500 })
                }
                const storedMetadata = readOrdinaryCreateMetadata(winnerResult.data.plan_config)
                if (!storedMetadata || storedMetadata.request_fingerprint !== requestFingerprint) {
                    return NextResponse.json({ error: '该发布请求标识已用于不同内容，请检查任务列表' }, { status: 409 })
                }
                task = winnerResult.data
                createMetadata = storedMetadata
            } else if (taskInsert.error) {
                console.error('Failed to create task:', taskInsert.error)
                return NextResponse.json({ error: '创建任务失败' }, { status: 500 })
            } else {
                task = taskInsert.data
            }
        }

        if (!task) {
            return NextResponse.json({ error: '创建任务状态暂时无法确认，请使用原页面重试' }, { status: 500 })
        }

        const baseTime = new Date(createMetadata.base_time_iso)
        if (Number.isNaN(baseTime.getTime())) {
            console.error('Stored publish task idempotency metadata is invalid')
            return NextResponse.json({ error: '任务数据异常，请联系管理员并勿重复创建' }, { status: 500 })
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
            source_video_id?: string
            source_video_name?: string
            tiktok_transfer_method?: 'PULL_FROM_URL' | 'FILE_UPLOAD'
            source_video_size_bytes?: number
            source_video_mime_type?: string
            dedupe_key?: string
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
                    title = title.replace(/{date}/g, createMetadata.render_date)
                }

                // Ensure video_url is not null - use a placeholder if not provided
                const videoUrl = transferMethod === 'FILE_UPLOAD'
                    ? `file-upload://${encodeURIComponent(video.id)}`
                    : video.url || `placeholder://asset/${video.id}`

                items.push({
                    task_id: task.id,
                    account_id: accountId,  // Correct field name
                    video_url: videoUrl,  // Required field
                    video_source: video.type === 'asset' ? 'assets' : video.type,
                    title,  // Correct field name
                    status: body.publish_mode === 'scheduled' ? 'scheduled' : 'pending',
                    scheduled_at: scheduledTime.toISOString(),
                    cover_timestamp_ms: video.coverTimestampMs,
                    source_video_id: video.id,
                    source_video_name: video.name,
                    ...(idempotencyKey ? {
                        dedupe_key: `ordinary:${sha256(`${video.id}\u0000${accountId}`)}`,
                    } : {}),
                    ...(transferMethod === 'FILE_UPLOAD' ? {
                        tiktok_transfer_method: 'FILE_UPLOAD' as const,
                        source_video_size_bytes: Number(video.sizeBytes),
                        source_video_mime_type: video.mimeType,
                    } : {}),
                })

                itemIndex++
            }
        }

        let createdItems: Array<{ id: string; account_id: string; source_video_id: string | null; dedupe_key?: string | null }> = []
        if (idempotencyKey) {
            const expectedDedupeKeys = new Set(items.map(item => item.dedupe_key as string))
            const readTaskItems = () => supabase
                .from('publish_task_items')
                .select('id, account_id, source_video_id, dedupe_key')
                .eq('task_id', task.id)

            const currentResult = await readTaskItems()
            if (currentResult.error) {
                console.error('Failed to read idempotent publish task items:', currentResult.error)
                return NextResponse.json({ error: '创建任务项状态暂时无法确认，请使用原页面重试' }, { status: 500 })
            }
            const currentItems = currentResult.data || []
            if (currentItems.some(item => !item.dedupe_key || !expectedDedupeKeys.has(item.dedupe_key))) {
                return NextResponse.json({ error: '任务项与原发布请求不一致，请联系管理员并勿重复创建' }, { status: 409 })
            }
            const currentKeys = new Set(currentItems.flatMap(item => item.dedupe_key ? [item.dedupe_key] : []))
            const missingItems = items.filter(item => !currentKeys.has(item.dedupe_key as string))
            if (missingItems.length > 0) {
                const missingInsert = await supabase
                    .from('publish_task_items')
                    .insert(missingItems)
                    .select('id')
                if (missingInsert.error && !isUniqueViolation(missingInsert.error)) {
                    console.error('Failed to create idempotent publish task items:', missingInsert.error)
                    return NextResponse.json({ error: '创建任务项未完成，请使用原页面重试以继续' }, { status: 500 })
                }
            }

            // Always re-read: PostgREST can lose the representation response after
            // the database committed, and a concurrent replay can win an insert.
            const finalResult = await readTaskItems()
            if (finalResult.error) {
                console.error('Failed to confirm idempotent publish task items:', finalResult.error)
                return NextResponse.json({ error: '创建任务项状态暂时无法确认，请使用原页面重试' }, { status: 500 })
            }
            createdItems = finalResult.data || []
            const finalKeys = new Set(createdItems.flatMap(item => item.dedupe_key ? [item.dedupe_key] : []))
            if (
                createdItems.length !== items.length
                || finalKeys.size !== expectedDedupeKeys.size
                || [...expectedDedupeKeys].some(key => !finalKeys.has(key))
            ) {
                return NextResponse.json({ error: '任务项创建尚未完成，请使用原页面重试以继续' }, { status: 500 })
            }
        } else {
            const itemsInsert = await supabase
                .from('publish_task_items')
                .insert(items)
                .select('id, account_id, source_video_id')
            if (itemsInsert.error) {
                console.error('Failed to create task items:', itemsInsert.error)
                await supabase.from('publish_tasks').delete().eq('id', task.id)
                return NextResponse.json({ error: '创建任务项失败' }, { status: 500 })
            }
            createdItems = itemsInsert.data || []
        }

        // If immediate publishing, start processing in the background
        if (body.publish_mode === 'now' && transferMethod === 'PULL_FROM_URL') {
            // Start processing using shared module (fire and forget)
            processPublishQueue({
                taskId: task.id,
                mode: 'immediate'
            }).catch(err => {
                console.error('Background publish processing failed:', err)
            })
        }

        const {
            plan_config: _planConfig,
            idempotency_key: _idempotencyKey,
            ...publicTask
        } = task
        const publicUploadItems = createdItems.map(item => ({
            id: item.id,
            account_id: item.account_id,
            source_video_id: item.source_video_id,
        }))

        return NextResponse.json({
            success: true,
            task: {
                ...publicTask,
                total_items: items.length
            },
            upload_items: transferMethod === 'FILE_UPLOAD' ? publicUploadItems : [],
        })

    } catch (error) {
        console.error('Error creating publish task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

// Note: processPublishItems moved to lib/publish-processor.ts for shared use
