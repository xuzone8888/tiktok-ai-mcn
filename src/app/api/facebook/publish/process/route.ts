import { NextRequest, NextResponse } from 'next/server'

import { processFacebookPublishQueue } from '@/lib/facebook/processor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  // fail-closed：未配置 CRON_SECRET 一律拒绝（含非生产环境），避免任何环境下被未授权触发真实发布。
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization')
  const cronHeader = request.headers.get('x-cron-secret')
  return authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
}

async function handleProcessRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 跨境出口隔离：CN（够不到 Meta/Google）设 PUBLISH_SKIP_OVERSEAS 后，per-platform /process 也 no-op，
  // 杜绝独立 per-platform cron 绕开 omnibus 继续烧 failed。海外 worker 不设此开关 → 正常处理。
  if (process.env.PUBLISH_SKIP_OVERSEAS === '1' || process.env.PUBLISH_SKIP_OVERSEAS === 'true') {
    return NextResponse.json({ success: true, skipped: 'overseas_disabled' })
  }

  const result = await processFacebookPublishQueue({
    mode: 'scheduled',
    maxItems: 20,
  })

  return NextResponse.json({ success: true, result })
}

export async function GET(request: NextRequest) {
  return handleProcessRequest(request)
}

export async function POST(request: NextRequest) {
  return handleProcessRequest(request)
}
