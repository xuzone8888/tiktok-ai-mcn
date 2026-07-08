/**
 * 定时发布任务处理器
 * 
 * GET /api/publish/process-scheduled
 * 
 * 由服务器 cron 每分钟调用，检查并执行到期的定时任务
 * 
 * 安全机制：需要 x-cron-secret 请求头验证
 */

import { NextRequest, NextResponse } from 'next/server'
import { processFacebookPublishQueue } from '@/lib/facebook/processor'
import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { processInstagramPublishQueue } from '@/lib/instagram/processor'
import { processLinkedInPublishQueue } from '@/lib/linkedin/processor'
import { processPublishQueue } from '@/lib/publish-processor'
import { processYouTubePublishQueue } from '@/lib/youtube/processor'

// 配置
const CRON_SECRET = process.env.CRON_SECRET || ''

// API 配置
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 分钟超时

export async function GET(request: NextRequest) {
    const startTime = Date.now()

    try {
        // 1. 验证 cron secret（生产环境必须）
        const authHeader = request.headers.get('authorization')
        const cronSecret = request.headers.get('x-cron-secret')
        const isAuthorized = authHeader === `Bearer ${CRON_SECRET}` || cronSecret === CRON_SECRET
        if (process.env.NODE_ENV === 'production' && CRON_SECRET && !isAuthorized) {
            console.log('[Scheduler] Unauthorized request')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[Scheduler] Starting scheduled task processing')

        // 2. 处理所有平台的到期定时任务
        //    legacy = TikTok（publish-processor，含本次合并进来的调度恢复修复 + debugRecovery 诊断开关）
        const linkedinProcessPromise = isLinkedInPublishEnabledServer()
            ? processLinkedInPublishQueue({
                mode: 'scheduled',
                maxItems: 50
            })
            : Promise.resolve({
                success: 0,
                failed: 0,
                skipped: 0,
                errors: [],
                duration_ms: 0,
                disabled: true
            })

        const [legacyResult, youtubeResult, facebookResult, instagramResult, linkedinResult] = await Promise.all([
            processPublishQueue({
                mode: 'scheduled',
                maxItems: 50,
                debugRecovery: request.nextUrl.searchParams.get('debugRecovery') === '1'
            }),
            processYouTubePublishQueue({
                mode: 'scheduled',
                maxItems: 50
            }),
            processFacebookPublishQueue({
                mode: 'scheduled',
                maxItems: 50
            }),
            processInstagramPublishQueue({
                mode: 'scheduled',
                maxItems: 50
            }),
            linkedinProcessPromise,
        ])

        const processed =
            legacyResult.success + legacyResult.failed + (legacyResult.confirming || 0) +
            youtubeResult.success + youtubeResult.failed +
            facebookResult.success + facebookResult.failed +
            instagramResult.success + instagramResult.failed + instagramResult.deferred +
            linkedinResult.success + linkedinResult.failed

        // 沿用 TikTok 修复的“错误可见化”意图：汇总各平台逐条错误，success=false 表示本轮有失败需关注。
        // 但返回 HTTP 200（非 500）——多平台下单账号/单条失败属正常运营事件，不应让整轮 cron 标记失败/触发重试；
        // 失败明细在 results.<平台>.errors 内逐平台可见。若需严格 500-on-error，把下面改为 { status: errors.length ? 500 : 200 }。
        const errors = [
            ...legacyResult.errors,
            ...youtubeResult.errors,
            ...facebookResult.errors,
            ...instagramResult.errors,
            ...linkedinResult.errors,
        ]
        const duration = Date.now() - startTime
        console.log('[Scheduler] Completed in', duration, 'ms. Processed:', processed, 'Errors:', errors.length)

        return NextResponse.json({
            success: errors.length === 0,
            processed,
            results: {
                legacy: legacyResult,
                youtube: youtubeResult,
                facebook: facebookResult,
                instagram: instagramResult,
                linkedin: linkedinResult,
            },
            ...(legacyResult.recovery_debug ? { recovery_debug: legacyResult.recovery_debug } : {}),
            duration_ms: duration
        })

    } catch (error) {
        console.error('[Scheduler] Error:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Scheduler error' },
            { status: 500 }
        )
    }
}
