import { assertAllowedMultiTaskVideoUrl } from '@/lib/publish/multi-task-policy'

export const MULTI_TASK_MAX_VIDEOS = 40
export const MULTI_TASK_MAX_ACCOUNTS = 20
export const MULTI_TASK_MIN_INTERVAL_MINUTES = 10
export const MULTI_TASK_DEFAULT_INTERVAL_MINUTES = 360
export const MULTI_TASK_ACCOUNT_SPACING_MINUTES = 2
export const MULTI_TASK_MAX_TITLE_LENGTH = 2200
export const MULTI_TASK_MAX_HASHTAGS = 5
export const MULTI_TASK_MAX_COMPLETION_DAYS = 30

export type MultiTaskAssignmentStrategy = 'round_robin' | 'random_balanced'
export type MultiTaskTimingMode = 'now' | 'scheduled'

export interface MultiTaskVideoInput {
    id: string
    name: string
    url: string
    source?: 'upload' | 'asset' | 'url'
    title?: string
    durationMs?: number | null
}

export interface MultiTaskAccountInput {
    id: string
    displayName?: string | null
    username?: string | null
}

export interface MultiTaskTimingInput {
    mode: MultiTaskTimingMode
    startAt?: string | null
    intervalMinutes: number
    jitterEnabled?: boolean
    jitterMinSeconds?: number
    jitterMaxSeconds?: number
}

export interface MultiTaskPlanInput {
    videos: MultiTaskVideoInput[]
    accounts: MultiTaskAccountInput[]
    assignmentStrategy?: MultiTaskAssignmentStrategy
    timing: MultiTaskTimingInput
    seed?: string
    now?: Date
}

export interface MultiTaskPlanItem {
    sequence: number
    videoId: string
    videoName: string
    videoUrl: string
    videoSource: 'upload' | 'asset' | 'url'
    title: string
    accountId: string
    accountDisplayName?: string | null
    planRound: number
    accountPosition: number
    scheduledAt: string
    dedupeKey: string
}

export interface MultiTaskPlan {
    items: MultiTaskPlanItem[]
    summary: {
        videoCount: number
        accountCount: number
        minPerAccount: number
        maxPerAccount: number
        firstScheduledAt: string
        lastScheduledAt: string
        intervalMinutes: number
        accountSpacingMinutes: number
        jitterEnabled: boolean
        assignmentStrategy: MultiTaskAssignmentStrategy
    }
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function countHashtags(text: string) {
    return (text.match(/#[^\s#]+/g) || []).length
}

function makeSeededRandom(seed: string) {
    let hash = 2166136261
    for (let index = 0; index < seed.length; index++) {
        hash ^= seed.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return () => {
        hash += 0x6D2B79F5
        let value = hash
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

function shuffleIndexes(length: number, seed: string) {
    const random = makeSeededRandom(seed)
    const values = Array.from({ length }, (_, index) => index)

    for (let index = values.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1))
        const current = values[index]
        values[index] = values[swapIndex]
        values[swapIndex] = current
    }

    return values
}

function getBaseDate(timing: MultiTaskTimingInput, now: Date) {
    if (timing.mode === 'scheduled') {
        if (!timing.startAt) {
            throw new Error('请选择开始时间')
        }

        const parsed = new Date(timing.startAt)
        if (Number.isNaN(parsed.getTime())) {
            throw new Error('开始时间格式无效')
        }

        return parsed
    }

    return now
}

function validatePlanInput(input: MultiTaskPlanInput) {
    const videos = input.videos || []
    const accounts = input.accounts || []
    const intervalMinutes = Number(input.timing?.intervalMinutes)

    if (videos.length < 1) {
        throw new Error('请先上传视频')
    }

    if (videos.length > MULTI_TASK_MAX_VIDEOS) {
        throw new Error(`一次最多选择 ${MULTI_TASK_MAX_VIDEOS} 个视频`)
    }

    if (accounts.length < 1) {
        throw new Error('请选择账号分组')
    }

    if (accounts.length > MULTI_TASK_MAX_ACCOUNTS) {
        throw new Error(`每个分组最多 ${MULTI_TASK_MAX_ACCOUNTS} 个账号`)
    }

    if (videos.length < accounts.length) {
        throw new Error('视频数量不能少于账号数量')
    }

    const videoIds = new Set<string>()
    const videoUrls = new Set<string>()
    for (const video of videos) {
        const id = normalizeText(video.id)
        const url = normalizeText(video.url)
        const source = video.source || 'upload'

        if (!id || !url) {
            throw new Error('视频数据不完整')
        }

        if (!['upload', 'asset', 'url'].includes(source)) {
            throw new Error(`"${video.name || id}" 的视频来源无效`)
        }

        assertAllowedMultiTaskVideoUrl(url, `视频 "${video.name || id}"`)

        if (videoIds.has(id) || videoUrls.has(url)) {
            throw new Error('视频列表中存在重复内容')
        }

        videoIds.add(id)
        videoUrls.add(url)

        const title = normalizeText(video.title)
        if (!title) {
            throw new Error(`请填写 "${video.name || id}" 的标题`)
        }

        if (title.length > MULTI_TASK_MAX_TITLE_LENGTH) {
            throw new Error(`"${video.name || id}" 的标题超过 ${MULTI_TASK_MAX_TITLE_LENGTH} 个字符`)
        }

        if (countHashtags(title) > MULTI_TASK_MAX_HASHTAGS) {
            throw new Error(`"${video.name || id}" 的话题数量不能超过 ${MULTI_TASK_MAX_HASHTAGS} 个`)
        }
    }

    const accountIds = new Set<string>()
    for (const account of accounts) {
        const id = normalizeText(account.id)
        if (!id) {
            throw new Error('账号数据不完整')
        }
        if (accountIds.has(id)) {
            throw new Error('账号分组中存在重复账号')
        }
        accountIds.add(id)
    }

    if (!Number.isFinite(intervalMinutes) || intervalMinutes < MULTI_TASK_MIN_INTERVAL_MINUTES) {
        throw new Error(`同账号发布时间间隔不能少于 ${MULTI_TASK_MIN_INTERVAL_MINUTES} 分钟`)
    }

    if (input.timing.mode === 'scheduled') {
        const now = input.now || new Date()
        const baseDate = getBaseDate(input.timing, now)
        if (baseDate.getTime() < now.getTime() - 30 * 1000) {
            throw new Error('开始时间不能早于当前时间')
        }
    }
}

function assignVideos(input: MultiTaskPlanInput) {
    const strategy = input.assignmentStrategy || 'round_robin'
    const buckets = input.accounts.map((account, accountPosition) => ({
        account,
        accountPosition,
        videos: [] as MultiTaskVideoInput[],
    }))

    if (strategy === 'round_robin') {
        input.videos.forEach((video, index) => {
            buckets[index % buckets.length].videos.push(video)
        })
        return buckets
    }

    const random = makeSeededRandom(input.seed || 'multi-task')
    const shuffledVideoIndexes = shuffleIndexes(input.videos.length, `${input.seed || 'multi-task'}:videos`)

    for (const videoIndex of shuffledVideoIndexes) {
        const minCount = Math.min(...buckets.map((bucket) => bucket.videos.length))
        const candidates = buckets.filter((bucket) => bucket.videos.length === minCount)
        const bucket = candidates[Math.floor(random() * candidates.length)] || candidates[0]
        bucket.videos.push(input.videos[videoIndex])
    }

    return buckets
}

export function buildMultiTaskPlan(input: MultiTaskPlanInput): MultiTaskPlan {
    validatePlanInput(input)

    const now = input.now || new Date()
    const baseDate = getBaseDate(input.timing, now)
    const intervalMs = input.timing.intervalMinutes * 60 * 1000
    const accountSpacingMs = MULTI_TASK_ACCOUNT_SPACING_MINUTES * 60 * 1000
    const jitterEnabled = input.timing.jitterEnabled === true
    const jitterMinSeconds = Math.max(0, input.timing.jitterMinSeconds ?? 60)
    const jitterMaxSeconds = Math.max(jitterMinSeconds, input.timing.jitterMaxSeconds ?? 300)
    const random = makeSeededRandom(`${input.seed || 'multi-task'}:time`)
    const buckets = assignVideos(input)
    const maxRound = Math.max(...buckets.map((bucket) => bucket.videos.length))
    const items: MultiTaskPlanItem[] = []
    const lastScheduledByAccount = new Map<string, number>()

    for (let round = 0; round < maxRound; round++) {
        for (const bucket of buckets) {
            const video = bucket.videos[round]
            if (!video) {
                continue
            }

            let scheduledMs = baseDate.getTime() + round * intervalMs + bucket.accountPosition * accountSpacingMs
            const shouldApplyJitter = jitterEnabled && (input.timing.mode !== 'now' || round > 0)
            if (shouldApplyJitter) {
                const spreadSeconds = jitterMinSeconds + Math.floor(random() * (jitterMaxSeconds - jitterMinSeconds + 1))
                scheduledMs += spreadSeconds * 1000
            }

            const lastForAccount = lastScheduledByAccount.get(bucket.account.id)
            if (lastForAccount && scheduledMs < lastForAccount + intervalMs) {
                scheduledMs = lastForAccount + intervalMs
            }
            lastScheduledByAccount.set(bucket.account.id, scheduledMs)

            items.push({
                sequence: items.length,
                videoId: video.id,
                videoName: video.name,
                videoUrl: video.url,
                videoSource: video.source || 'upload',
                title: normalizeText(video.title),
                accountId: bucket.account.id,
                accountDisplayName: bucket.account.displayName || bucket.account.username || null,
                planRound: round,
                accountPosition: bucket.accountPosition,
                scheduledAt: new Date(scheduledMs).toISOString(),
                dedupeKey: `${video.id}:${bucket.account.id}`,
            })
        }
    }

    items.sort((left, right) => {
        const timeDiff = new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
        return timeDiff || left.sequence - right.sequence
    })

    const perAccountCounts = buckets.map((bucket) => bucket.videos.length)
    const scheduledTimes = items.map((item) => new Date(item.scheduledAt).getTime())
    const lastScheduledAt = scheduledTimes.length ? Math.max(...scheduledTimes) : baseDate.getTime()

    if (lastScheduledAt > now.getTime() + MULTI_TASK_MAX_COMPLETION_DAYS * 24 * 60 * 60 * 1000) {
        throw new Error(`预计完成时间不能超过 ${MULTI_TASK_MAX_COMPLETION_DAYS} 天`)
    }

    return {
        items,
        summary: {
            videoCount: input.videos.length,
            accountCount: input.accounts.length,
            minPerAccount: Math.min(...perAccountCounts),
            maxPerAccount: Math.max(...perAccountCounts),
            firstScheduledAt: scheduledTimes.length ? new Date(Math.min(...scheduledTimes)).toISOString() : baseDate.toISOString(),
            lastScheduledAt: new Date(lastScheduledAt).toISOString(),
            intervalMinutes: input.timing.intervalMinutes,
            accountSpacingMinutes: MULTI_TASK_ACCOUNT_SPACING_MINUTES,
            jitterEnabled,
            assignmentStrategy: input.assignmentStrategy || 'round_robin',
        },
    }
}

export function deriveTitleFromFilename(fileName: string) {
    return fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function applyTitlesToVideos(
    videos: MultiTaskVideoInput[],
    titles: string[],
    mode: 'same' | 'different' | 'filename'
) {
    if (mode === 'filename') {
        return videos.map((video) => ({
            ...video,
            title: deriveTitleFromFilename(video.name),
        }))
    }

    if (mode === 'same') {
        const title = normalizeText(titles[0])
        return videos.map((video) => ({
            ...video,
            title,
        }))
    }

    return videos.map((video, index) => ({
        ...video,
        title: normalizeText(titles[index]),
    }))
}
