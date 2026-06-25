import { NextRequest, NextResponse } from 'next/server'

import { processYouTubePublishQueue } from '@/lib/youtube/processor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== 'production'

  const authHeader = request.headers.get('authorization')
  const cronHeader = request.headers.get('x-cron-secret')
  return authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
}

async function handleProcessRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const taskId = request.nextUrl.searchParams.get('taskId') || undefined
  const result = await processYouTubePublishQueue({
    taskId,
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
