import crypto from 'crypto'

import { MULTI_TASK_DEFAULT_INTERVAL_MINUTES } from '@/lib/publish/multi-task-scheduler'

const TOKEN_VERSION = 'v1'

function getSigningSecret() {
    return process.env.MULTI_TASK_PREVIEW_SECRET
        || process.env.NEXTAUTH_SECRET
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
        || process.env.TIKTOK_CLIENT_SECRET
        || 'local-multi-task-preview-secret'
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown, fallback: number) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : fallback
}

export function buildMultiTaskPreviewTokenPayload(userId: string, body: Record<string, unknown>) {
    const timing = typeof body.timing === 'object' && body.timing !== null
        ? body.timing as Record<string, unknown>
        : {}
    const timingMode = timing.mode === 'scheduled' ? 'scheduled' : 'now'
    const videos = Array.isArray(body.videos) ? body.videos : []

    return {
        version: 1,
        user_id: userId,
        account_group_id: normalizeText(body.account_group_id),
        privacy_level: normalizeText(body.privacy_level),
        seed: normalizeText(body.seed),
        videos: videos.map((item) => {
            const video = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
            const source = video.source === 'asset' || video.source === 'url' ? video.source : 'upload'

            return {
                id: normalizeText(video.id),
                name: normalizeText(video.name),
                url: normalizeText(video.url),
                source,
                title: normalizeText(video.title),
                duration_ms: normalizeNumber(video.duration_ms ?? video.durationMs, 0),
            }
        }),
        assignment_strategy: body.assignment_strategy === 'random_balanced' ? 'random_balanced' : 'round_robin',
        timing: {
            mode: timingMode,
            start_at: timingMode === 'scheduled' ? normalizeText(timing.start_at) : null,
            interval_minutes: normalizeNumber(timing.interval_minutes, MULTI_TASK_DEFAULT_INTERVAL_MINUTES),
            jitter_enabled: timing.jitter_enabled === true,
            jitter_min_seconds: normalizeNumber(timing.jitter_min_seconds, 60),
            jitter_max_seconds: normalizeNumber(timing.jitter_max_seconds, 300),
        },
    }
}

export function signMultiTaskPreviewToken(userId: string, body: Record<string, unknown>) {
    const payload = buildMultiTaskPreviewTokenPayload(userId, body)
    const signature = crypto
        .createHmac('sha256', getSigningSecret())
        .update(JSON.stringify(payload))
        .digest('hex')

    return `${TOKEN_VERSION}.${signature}`
}

export function verifyMultiTaskPreviewToken(userId: string, body: Record<string, unknown>, token: string) {
    if (!token.startsWith(`${TOKEN_VERSION}.`)) {
        return false
    }

    const expected = signMultiTaskPreviewToken(userId, body)
    const expectedBuffer = Buffer.from(expected)
    const tokenBuffer = Buffer.from(token)

    return expectedBuffer.length === tokenBuffer.length && crypto.timingSafeEqual(expectedBuffer, tokenBuffer)
}
