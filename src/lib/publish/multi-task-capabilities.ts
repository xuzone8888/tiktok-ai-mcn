import {
    MULTI_TASK_DEFAULT_PUBLISH_OPTIONS,
    MULTI_TASK_PRIVACY_LEVELS,
    type MultiTaskPrivacyLevel,
} from '@/lib/publish/multi-task-policy'
import { getCreatorInfo, type CreatorInfo } from '@/lib/tiktok/content-posting'
import { calculateTokenExpiration, refreshAccessToken } from '@/lib/tiktok/oauth'
import { isTikTokAccessTokenFresh } from '@/lib/tiktok/token-manager'
import type { TikTokRefreshTokenResponse } from '@/lib/tiktok/types'

const CREATOR_INFO_CONCURRENCY = 3

export interface MultiTaskCapabilityAccountInput {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    status: string
    token_expires_at: string | null
    access_token_expires_at?: string | null
    access_token: string
    refresh_token: string
}

export interface MultiTaskAccountCapability {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    status: 'ready' | 'blocked'
    error?: string
    privacy_level_options: MultiTaskPrivacyLevel[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
}

export interface MultiTaskCapabilitySummary {
    ready_count: number
    blocked_count: number
    privacy_level_options: MultiTaskPrivacyLevel[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
    defaults: {
        allow_comment: boolean
        allow_duet: boolean
        allow_stitch: boolean
        brand_content_toggle: boolean
        brand_organic_toggle: boolean
        is_ai_generated: boolean
        cover_timestamp_ms: number
    }
    warnings: string[]
}

export interface MultiTaskCapabilityResult {
    accounts: MultiTaskAccountCapability[]
    summary: MultiTaskCapabilitySummary
}

export interface MultiTaskCapabilityVideo {
    name: string
    durationMs?: number | null
}

interface ResolveOptions {
    onTokenRefresh?: (accountId: string, token: TikTokRefreshTokenResponse) => Promise<void>
}

function isAuthorized(account: MultiTaskCapabilityAccountInput) {
    return account.status === 'active'
        && !!account.token_expires_at
        && new Date(account.token_expires_at) > new Date()
}

function normalizePrivacyOptions(options: unknown): MultiTaskPrivacyLevel[] {
    if (!Array.isArray(options)) return []

    return options.filter((option): option is MultiTaskPrivacyLevel => (
        MULTI_TASK_PRIVACY_LEVELS.includes(option as MultiTaskPrivacyLevel)
    ))
}

function toCapability(account: MultiTaskCapabilityAccountInput, creatorInfo: CreatorInfo): MultiTaskAccountCapability {
    return {
        id: account.id,
        display_name: account.display_name || creatorInfo.creator_nickname || null,
        username: account.username || creatorInfo.creator_username || null,
        avatar_url: account.avatar_url || creatorInfo.creator_avatar_url || null,
        status: 'ready',
        privacy_level_options: normalizePrivacyOptions(creatorInfo.privacy_level_options),
        comment_disabled: creatorInfo.comment_disabled === true,
        duet_disabled: creatorInfo.duet_disabled === true,
        stitch_disabled: creatorInfo.stitch_disabled === true,
        max_video_post_duration_sec: Number(creatorInfo.max_video_post_duration_sec || 0),
    }
}

function blockedCapability(account: MultiTaskCapabilityAccountInput, error: string): MultiTaskAccountCapability {
    return {
        id: account.id,
        display_name: account.display_name,
        username: account.username,
        avatar_url: account.avatar_url,
        status: 'blocked',
        error,
        privacy_level_options: [],
        comment_disabled: true,
        duet_disabled: true,
        stitch_disabled: true,
        max_video_post_duration_sec: 0,
    }
}

function intersectPrivacyOptions(accounts: MultiTaskAccountCapability[]) {
    const ready = accounts.filter((account) => account.status === 'ready')
    if (ready.length === 0) return []

    return ready.reduce<MultiTaskPrivacyLevel[]>((current, account, index) => {
        if (index === 0) return account.privacy_level_options
        return current.filter((option) => account.privacy_level_options.includes(option))
    }, [])
}

function summarizeCapabilities(accounts: MultiTaskAccountCapability[]): MultiTaskCapabilitySummary {
    const ready = accounts.filter((account) => account.status === 'ready')
    const blocked = accounts.length - ready.length
    const maxDurations = ready
        .map((account) => account.max_video_post_duration_sec)
        .filter((duration) => Number.isFinite(duration) && duration > 0)
    const commentDisabled = ready.some((account) => account.comment_disabled)
    const duetDisabled = ready.some((account) => account.duet_disabled)
    const stitchDisabled = ready.some((account) => account.stitch_disabled)
    const warnings: string[] = []

    if (commentDisabled) {
        warnings.push('部分账号已关闭评论，任务将按关闭评论执行。')
    }
    if (stitchDisabled) {
        warnings.push('部分账号已关闭引用，任务将按关闭引用执行。')
    }
    if (blocked > 0) {
        warnings.push(`${blocked} 个账号暂不可用，请先处理授权或账号状态。`)
    }

    return {
        ready_count: ready.length,
        blocked_count: blocked,
        privacy_level_options: intersectPrivacyOptions(accounts),
        comment_disabled: commentDisabled,
        duet_disabled: duetDisabled,
        stitch_disabled: stitchDisabled,
        max_video_post_duration_sec: maxDurations.length ? Math.min(...maxDurations) : 0,
        defaults: {
            allow_comment: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowComment && !commentDisabled,
            allow_duet: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowDuet && !duetDisabled,
            allow_stitch: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowStitch && !stitchDisabled,
            brand_content_toggle: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.brandContentToggle,
            brand_organic_toggle: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.brandOrganicToggle,
            is_ai_generated: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.isAiGenerated,
            cover_timestamp_ms: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.coverTimestampMs,
        },
        warnings,
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
) {
    const results = new Array<R>(items.length)
    let cursor = 0

    async function worker() {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await mapper(items[index])
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
    return results
}

export async function resolveMultiTaskCapabilities(
    accounts: MultiTaskCapabilityAccountInput[],
    options: ResolveOptions = {}
): Promise<MultiTaskCapabilityResult> {
    const resolvedAccounts = await mapWithConcurrency(accounts, CREATOR_INFO_CONCURRENCY, async (account) => {
        if (!isAuthorized(account)) {
            return blockedCapability(account, '账号未授权或授权已过期')
        }

        try {
            let accessToken = account.access_token
            if (account.refresh_token && !isTikTokAccessTokenFresh(account.access_token_expires_at)) {
                const refreshed = await refreshAccessToken(account.refresh_token)
                accessToken = refreshed.access_token
                account.access_token_expires_at = calculateTokenExpiration(refreshed.expires_in).toISOString()
                await options.onTokenRefresh?.(account.id, refreshed)
            }

            const creatorInfo = await getCreatorInfo(accessToken)
            const capability = toCapability(account, creatorInfo)
            if (capability.privacy_level_options.length === 0) {
                return blockedCapability(account, '未获取到可用可见范围')
            }
            return capability
        } catch (error) {
            return blockedCapability(account, error instanceof Error ? error.message : '获取账号能力失败')
        }
    })

    return {
        accounts: resolvedAccounts,
        summary: summarizeCapabilities(resolvedAccounts),
    }
}

export function assertMultiTaskCapabilityPolicy(
    capabilityResult: MultiTaskCapabilityResult,
    privacyLevel: MultiTaskPrivacyLevel,
    videos: MultiTaskCapabilityVideo[]
) {
    const { summary } = capabilityResult

    if (summary.blocked_count > 0) {
        throw new Error('分组内有账号暂不可用，请先处理账号授权或状态')
    }

    if (!summary.privacy_level_options.includes(privacyLevel)) {
        throw new Error('所选可见范围不适用于当前账号分组')
    }

    if (summary.max_video_post_duration_sec > 0) {
        const overDuration = videos.find((video) => {
            const durationMs = Number(video.durationMs || 0)
            return durationMs > summary.max_video_post_duration_sec * 1000
        })

        if (overDuration) {
            throw new Error(`"${overDuration.name}" 超过当前账号分组允许的视频时长`)
        }
    }

    return summary.defaults
}
