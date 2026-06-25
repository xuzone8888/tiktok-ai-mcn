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
import { processInstagramPublishQueue } from '@/lib/instagram/processor'
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
        const [legacyResult, youtubeResult, facebookResult, instagramResult] = await Promise.all([
            processPublishQueue({
                mode: 'scheduled',
                maxItems: 50
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
        ])

        const processed =
            legacyResult.success + legacyResult.failed + (legacyResult.confirming || 0) +
            youtubeResult.success + youtubeResult.failed +
            facebookResult.success + facebookResult.failed +
            instagramResult.success + instagramResult.failed + instagramResult.deferred

        const duration = Date.now() - startTime
        console.log('[Scheduler] Completed in', duration, 'ms. Processed:', processed)

        return NextResponse.json({
            success: true,
            processed,
            results: {
                legacy: legacyResult,
                youtube: youtubeResult,
                facebook: facebookResult,
                instagram: instagramResult,
            },
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
