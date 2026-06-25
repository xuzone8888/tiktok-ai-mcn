import { NextRequest, NextResponse } from 'next/server'

import { processFacebookPublishQueue } from '@/lib/facebook/processor'

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
