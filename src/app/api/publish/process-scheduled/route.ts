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
import { processPublishQueue } from '@/lib/publish-processor'

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
        const cronSecret = request.headers.get('x-cron-secret')
        if (process.env.NODE_ENV === 'production' && CRON_SECRET && cronSecret !== CRON_SECRET) {
            console.log('[Scheduler] Unauthorized request')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[Scheduler] Starting scheduled task processing')

        // 2. 使用共用模块处理定时任务
        const result = await processPublishQueue({
            mode: 'scheduled',
            maxItems: 50
        })

        const duration = Date.now() - startTime
        console.log('[Scheduler] Completed in', duration, 'ms. Success:', result.success, 'Failed:', result.failed)

        return NextResponse.json({
            success: true,
            processed: result.success + result.failed + (result.confirming || 0),
            results: result,
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
