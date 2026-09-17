import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSocialCommentPlatformEnabled, isSocialCommentsApiEnabled } from '@/lib/social-comments/feature-flag'
import { recoverFacebookIdentityAfterSync } from '@/lib/social-comments/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!isSocialCommentsApiEnabled() || !isSocialCommentPlatformEnabled('facebook')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (typeof body?.logId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.logId)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    const status = await recoverFacebookIdentityAfterSync(user.id, body.logId)
    return NextResponse.json({ status }, { status: status === 'not_owned' ? 404 : status === 'failed' ? 503 : 200 })
  } catch {
    return NextResponse.json({ status: 'failed' }, { status: 503 })
  }
}
